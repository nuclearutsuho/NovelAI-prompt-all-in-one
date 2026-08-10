const DEFAULT_SNAPSHOT_SETTINGS = Object.freeze({
    maxSnapshots: 20,
    confirmDelete: true,
    debounceTime: 10
});

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

/**
 * 统一清洗快照设置，避免旧版本或损坏数据把同步页带入非法状态。
 */
export function normalizeSnapshotSettings(value = {}) {
    return {
        maxSnapshots: clampInteger(value.maxSnapshots, DEFAULT_SNAPSHOT_SETTINGS.maxSnapshots, 1, 100),
        confirmDelete: value.confirmDelete === undefined
            ? DEFAULT_SNAPSHOT_SETTINGS.confirmDelete
            : Boolean(value.confirmDelete),
        debounceTime: clampInteger(value.debounceTime, DEFAULT_SNAPSHOT_SETTINGS.debounceTime, 1, 60)
    };
}

/**
 * 对比两份通配符数据，只返回文件级变化，不关心界面状态。
 */
export function computeSnapshotDiff(oldWildcards = {}, newWildcards = {}) {
    const oldKeys = new Set(Object.keys(oldWildcards || {}));
    const newKeys = new Set(Object.keys(newWildcards || {}));
    const added = [];
    const removed = [];
    const modified = [];

    for (const key of newKeys) {
        if (!oldKeys.has(key)) added.push(key);
        else if (oldWildcards[key] !== newWildcards[key]) modified.push(key);
    }
    for (const key of oldKeys) {
        if (!newKeys.has(key)) removed.push(key);
    }

    return { added, removed, modified };
}

function normalizeDiff(diff) {
    return {
        added: Array.isArray(diff?.added) ? diff.added : [],
        removed: Array.isArray(diff?.removed) ? diff.removed : [],
        modified: Array.isArray(diff?.modified) ? diff.modified : []
    };
}

/**
 * 快照功能控制器：集中管理设置、选择状态、持久化与列表交互。
 */
export default function createSnapshotController(options = {}) {
    const {
        repository,
        storage,
        scope,
        elements,
        t,
        tf,
        log,
        showToast,
        confirm: customConfirm,
        escapeHtml,
        refreshFileTree,
        documentRef = globalThis.document,
        BlobCtor = globalThis.Blob,
        urlApi = globalThis.URL,
        alertFn = globalThis.alert
    } = options;

    if (!repository || !storage || !elements) {
        throw new Error('[SnapshotController] 缺少快照仓库、扩展存储或界面元素');
    }

    const {
        snapshotList,
        noSnapshots,
        batchDeleteBtn,
        batchExportBtn,
        selectAllSnapshots,
        diffSummary,
        diffContainer,
        diffModal
    } = elements;

    let settings = normalizeSnapshotSettings();
    const selectedSnapshots = new Set();
    let fallbackCleanup = null;

    function getSettings() {
        return { ...settings };
    }

    function updateSettings(patch = {}) {
        settings = normalizeSnapshotSettings({ ...settings, ...patch });
        return getSettings();
    }

    async function loadSettings() {
        const data = await storage.get('snapshotSettings');
        settings = normalizeSnapshotSettings(data.snapshotSettings);
        return getSettings();
    }

    async function saveSettings(patch) {
        if (patch) updateSettings(patch);
        await storage.set({ snapshotSettings: getSettings() });
        return getSettings();
    }

    function getSelectedIds() {
        return Array.from(selectedSnapshots);
    }

    async function deleteSnapshot(id) {
        await repository.deleteSnapshot(id);
        selectedSnapshots.delete(id);
    }

    async function createSnapshot(label, type = 'auto') {
        const data = await storage.get(['wildcards', 'wildcardFolders']);
        const wildcards = data.wildcards || {};
        const folders = Array.isArray(data.wildcardFolders) ? data.wildcardFolders : [];
        const allSnapshots = await repository.listSnapshots();
        const previous = allSnapshots[0] || null;

        const snapshot = {
            id: `snap_${Date.now()}`,
            timestamp: Date.now(),
            label,
            type,
            wildcards: { ...wildcards },
            wildcardFolders: [...folders],
            diff: computeSnapshotDiff(previous?.wildcards || {}, wildcards)
        };

        await repository.saveSnapshot(snapshot);

        // 仅自动清理自动快照，手动快照始终由用户显式管理。
        const automaticSnapshots = allSnapshots.filter(item => item.type === 'auto');
        if (automaticSnapshots.length >= settings.maxSnapshots) {
            const expiredSnapshots = automaticSnapshots.slice(settings.maxSnapshots - 1);
            for (const expired of expiredSnapshots) {
                await deleteSnapshot(expired.id);
            }
        }

        log(tf('log_snapshot_created', {
            label,
            type: t(`snapshot_type_${type}`, type)
        }), 'success');
        await renderList();
        return snapshot;
    }

    async function restoreSnapshot(id) {
        const snapshot = await repository.getSnapshot(id);
        if (!snapshot) {
            showToast(t('toast_snapshot_missing'), 'error');
            return;
        }

        // 恢复前再生成一次兜底快照，确保操作可以反悔。
        await createSnapshot(t('snapshot_label_before_restore'), 'auto');
        await storage.set({
            wildcards: snapshot.wildcards || {},
            wildcardFolders: Array.isArray(snapshot.wildcardFolders) ? snapshot.wildcardFolders : []
        });

        log(tf('log_snapshot_restored', { label: snapshot.label }), 'success');
        showToast(t('toast_snapshot_restored'), 'success');
        refreshFileTree();
    }

    function buildDiffHtml(snapshot) {
        const diff = normalizeDiff(snapshot.diff);
        const allChanges = [];
        diff.added.forEach(name => allChanges.push({ type: 'added', name, icon: '+' }));
        diff.removed.forEach(name => allChanges.push({ type: 'removed', name, icon: '-' }));
        diff.modified.forEach(name => allChanges.push({ type: 'modified', name, icon: '~' }));

        if (allChanges.length === 0) {
            return `<div class="snapshot-diff-container"><span class="diff-more-tag">${escapeHtml(t('snapshot_no_changes'))}</span></div>`;
        }

        const maxTags = 100;
        const visibleChanges = allChanges.slice(0, maxTags);
        const remaining = allChanges.length - visibleChanges.length;
        let html = '<div class="snapshot-diff-container">';

        for (const item of visibleChanges) {
            const fullName = String(item.name || '');
            const displayName = fullName.split('/').pop();
            html += `<span class="diff-file-tag ${item.type}" title="${escapeHtml(fullName)}">${item.icon} ${escapeHtml(displayName)}</span>`;
        }
        if (remaining > 0) {
            html += `<span class="diff-more-tag" title="${escapeHtml(tf('snapshot_more_files_title', { count: remaining }))}">${escapeHtml(tf('snapshot_more_files', { count: remaining }))}</span>`;
        }

        return `${html}</div>`;
    }

    async function renderList() {
        const snapshots = await repository.listSnapshots();
        snapshotList.replaceChildren();
        noSnapshots.style.display = snapshots.length ? 'none' : 'block';

        // 清除已不存在的选择，避免批量操作命中过期 ID。
        const currentIds = new Set(snapshots.map(item => item.id));
        for (const id of selectedSnapshots) {
            if (!currentIds.has(id)) selectedSnapshots.delete(id);
        }

        for (const snapshot of snapshots) {
            const item = documentRef.createElement('li');
            item.className = 'snapshot-item';
            if (selectedSnapshots.has(snapshot.id)) item.classList.add('selected');

            const snapshotId = escapeHtml(String(snapshot.id || ''));
            const type = snapshot.type === 'auto' ? 'auto' : 'manual';
            const time = new Date(snapshot.timestamp).toLocaleString();
            const diffHtml = snapshot.diff ? buildDiffHtml(snapshot) : '';

            item.innerHTML = `
                <div class="snapshot-select">
                    <input type="checkbox" class="snap-checkbox" data-id="${snapshotId}" ${selectedSnapshots.has(snapshot.id) ? 'checked' : ''}>
                </div>
                <div class="snapshot-content">
                    <div class="snapshot-header">
                        <span class="snapshot-time">${escapeHtml(time)}</span>
                        <span class="snapshot-tag-type ${type}">${escapeHtml(t(`snapshot_type_${type}`, type))}</span>
                        <span class="snapshot-label">${escapeHtml(snapshot.label || '')}</span>
                    </div>
                    ${diffHtml}
                </div>
                <div class="snapshot-actions">
                    <button class="btn-sm" data-action="diff" data-id="${snapshotId}" title="${escapeHtml(t('snapshot_action_compare_title'))}">🔍</button>
                    <button class="btn-sm btn-success" data-action="restore" data-id="${snapshotId}" title="${escapeHtml(t('snapshot_action_restore_title'))}">↩</button>
                    <button class="btn-sm" data-action="export" data-id="${snapshotId}" title="${escapeHtml(t('snapshot_action_export_json_title'))}">💾</button>
                    <button class="btn-sm btn-danger" data-action="delete" data-id="${snapshotId}" title="${escapeHtml(t('snapshot_action_delete_title'))}">✕</button>
                </div>
            `;
            snapshotList.appendChild(item);
        }

        updateBatchButtons();
    }

    function updateBatchButtons() {
        const count = selectedSnapshots.size;
        batchDeleteBtn.disabled = count === 0;
        batchExportBtn.disabled = count === 0;
        batchDeleteBtn.textContent = `${t('batch_delete')}${count ? ` (${count})` : ''}`;
        batchExportBtn.textContent = `${t('batch_export')}${count ? ` (${count})` : ''}`;

        const checkboxes = snapshotList.querySelectorAll('.snap-checkbox');
        selectAllSnapshots.checked = checkboxes.length > 0 && count === checkboxes.length;
        selectAllSnapshots.indeterminate = count > 0 && count < checkboxes.length;
    }

    function selectAll(checked) {
        const checkboxes = snapshotList.querySelectorAll('.snap-checkbox');
        for (const checkbox of checkboxes) {
            checkbox.checked = checked;
            const id = checkbox.dataset.id;
            if (checked) selectedSnapshots.add(id);
            else selectedSnapshots.delete(id);
            checkbox.closest('.snapshot-item')?.classList.toggle('selected', checked);
        }
        updateBatchButtons();
    }

    async function exportSnapshots(ids) {
        let exportedCount = 0;
        for (const id of ids) {
            const snapshot = await repository.getSnapshot(id);
            if (!snapshot) continue;

            const blob = new BlobCtor([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
            const url = urlApi.createObjectURL(blob);
            const anchor = documentRef.createElement('a');
            const safeTimestamp = new Date(snapshot.timestamp).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            anchor.href = url;
            anchor.download = `${snapshot.label}_${safeTimestamp}.json`;
            anchor.style.display = 'none';
            documentRef.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            urlApi.revokeObjectURL(url);
            exportedCount += 1;
        }
        log(tf('log_exported_snapshots', { count: exportedCount }), 'success');
    }

    async function deleteSnapshots(ids) {
        if (settings.confirmDelete && !await customConfirm(tf('confirm_delete_snapshots', { count: ids.length }))) {
            return;
        }

        let deletedCount = 0;
        for (const id of ids) {
            await deleteSnapshot(id);
            deletedCount += 1;
        }
        log(tf('log_deleted_snapshots', { count: deletedCount }), 'success');
        selectedSnapshots.clear();
        await renderList();
    }

    async function showDiff(id) {
        const snapshot = await repository.getSnapshot(id);
        if (!snapshot) {
            showToast(t('toast_snapshot_missing'), 'error');
            return;
        }

        const currentData = await storage.get('wildcards');
        const currentWildcards = currentData.wildcards || {};
        const diff = computeSnapshotDiff(snapshot.wildcards || {}, currentWildcards);

        // 使用 DOM 节点展示摘要，避免导入快照的标签进入 innerHTML。
        const summaryText = documentRef.createElement('span');
        summaryText.style.marginRight = '10px';
        summaryText.textContent = tf('diff_summary', { label: snapshot.label });
        const counts = [
            ['diff-added', `+${diff.added.length}`],
            ['diff-removed', `-${diff.removed.length}`],
            ['diff-modified', `~${diff.modified.length}`]
        ].map(([className, text]) => {
            const element = documentRef.createElement('span');
            element.className = className;
            element.textContent = text;
            return element;
        });
        diffSummary.replaceChildren(summaryText, ...counts);
        diffContainer.replaceChildren();

        if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
            diffContainer.textContent = t('diff_identical');
        } else {
            const createItem = (key, type, icon) => {
                const item = documentRef.createElement('div');
                item.style.padding = '4px';
                item.style.marginBottom = '2px';
                item.className = `diff-${type}`;
                item.style.cursor = 'pointer';
                item.textContent = `${icon} ${key}`;
                item.addEventListener('click', () => {
                    const oldContent = snapshot.wildcards?.[key] || '';
                    const newContent = currentWildcards[key] || '';
                    alertFn(tf('diff_alert_template', { key, oldContent, newContent }));
                });
                return item;
            };

            diff.added.forEach(key => diffContainer.appendChild(createItem(key, 'added', '+')));
            diff.removed.forEach(key => diffContainer.appendChild(createItem(key, 'removed', '-')));
            diff.modified.forEach(key => diffContainer.appendChild(createItem(key, 'modified', '~')));
        }

        diffModal.classList.add('show');
    }

    async function handleListClick(event) {
        const checkbox = event.target.closest?.('.snap-checkbox');
        if (checkbox) {
            const id = checkbox.dataset.id;
            if (checkbox.checked) selectedSnapshots.add(id);
            else selectedSnapshots.delete(id);
            checkbox.closest('.snapshot-item')?.classList.toggle('selected', checkbox.checked);
            updateBatchButtons();
            return;
        }

        const button = event.target.closest?.('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;

        if (action === 'restore') {
            if (await customConfirm(t('confirm_restore_snapshot'))) await restoreSnapshot(id);
        } else if (action === 'delete') {
            if (settings.confirmDelete && !await customConfirm(t('confirm_delete_snapshot'))) return;
            await deleteSnapshot(id);
            log(tf('log_snapshot_deleted', { id }), 'info');
            await renderList();
        } else if (action === 'export') {
            await exportSnapshots([id]);
        } else if (action === 'diff') {
            await showDiff(id);
        }
    }

    if (scope?.on) {
        scope.on(snapshotList, 'click', handleListClick);
    } else {
        snapshotList.addEventListener('click', handleListClick);
        fallbackCleanup = () => snapshotList.removeEventListener('click', handleListClick);
    }

    return Object.freeze({
        createSnapshot,
        deleteSnapshots,
        exportSnapshots,
        getSelectedIds,
        getSettings,
        loadSettings,
        renderList,
        saveSettings,
        selectAll,
        showDiff,
        updateBatchButtons,
        updateSettings,
        dispose() {
            fallbackCleanup?.();
            fallbackCleanup = null;
            selectedSnapshots.clear();
        }
    });
}
