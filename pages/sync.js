// ============================================================
// Wildcard Sync Manager - sync.js
// Features: Bidirectional Sync, Snapshot Backup, CodeMirror Editor, Drag-and-Drop Organization
// ============================================================

// ============================
// Section 1: Constants & State
// ============================
const DIR_HANDLE_KEY = 'wildcardDirHandle';
const DB_NAME = 'WildcardSyncDB';
const DB_VERSION = 3;
const HANDLE_STORE = 'handles';
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_DIR = '.snapshots';
const MAX_AUTO_SNAPSHOTS = 20;

let currentFile = null;       // key of the file being edited
let localContent = '';        // last saved content in editor
let editorView = null;        // CodeMirror EditorView instance
let autocompleteDict = null;  // parsed dictionary for autocomplete
const groupTagsDataUtils = window.GroupTagsDataUtils || {};
let expandedFolders = new Set(); // track expanded folders in tree
let selectedFolder = null;    // currently selected folder for creation
let draggedItem = null;       // item being dragged
let snapshotSettings = { maxSnapshots: 20, confirmDelete: true };
let selectedSnapshots = new Set();

// ============================
// Section 2: DOM References
// ============================
const statusText = document.getElementById('statusText');
const linkBtn = document.getElementById('linkBtn');
const unlinkBtn = document.getElementById('unlinkBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const fileTree = document.getElementById('fileTree');
const newItemName = document.getElementById('newItemName');
const newFileBtn = document.getElementById('newFileBtn');
const newFolderBtn = document.getElementById('newFolderBtn');
const editorHeader = document.getElementById('editorHeader');
const editorPlaceholder = document.getElementById('editorPlaceholder');
const editorContainer = document.getElementById('editorContainer');
const editorStatusbar = document.getElementById('editorStatusbar');
const fileNameInput = document.getElementById('fileNameInput');
const saveBtn = document.getElementById('saveBtn');
const lineInfo = document.getElementById('lineInfo');
const saveStatus = document.getElementById('saveStatus');
const logPanel = document.getElementById('logPanel');
const snapshotList = document.getElementById('snapshotList');
const noSnapshots = document.getElementById('noSnapshots');
const extChangeBanner = document.getElementById('extChangeBanner');
const reloadFileBtn = document.getElementById('reloadFileBtn');
const dismissBannerBtn = document.getElementById('dismissBannerBtn');
const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
const bottomContent = document.getElementById('bottomContent');
const toggleBottom = document.getElementById('toggleBottom');
const sidebar = document.getElementById('sidebar');
const resizeHandle = document.getElementById('resizeHandle');
const resizeHandleBottom = document.getElementById('resizeHandleBottom');
const bottomPanel = document.getElementById('bottomPanel');

// Snapshot Toolbar & Modals
const selectAllSnapshots = document.getElementById('selectAllSnapshots');
const batchDeleteBtn = document.getElementById('batchDeleteBtn');
const batchExportBtn = document.getElementById('batchExportBtn');
const snapshotSettingsBtn = document.getElementById('snapshotSettingsBtn');
const snapSettingsModal = document.getElementById('snapSettingsModal');
const settingMaxSnapshots = document.getElementById('settingMaxSnapshots');
const settingConfirmDelete = document.getElementById('settingConfirmDelete');
const saveSnapSettingsBtn = document.getElementById('saveSnapSettingsBtn');
const closeSnapSettingsBtn = document.getElementById('closeSnapSettingsBtn');
const diffModal = document.getElementById('diffModal');
const diffSummary = document.getElementById('diffSummary');
const diffContainer = document.getElementById('diffContainer');
const closeDiffBtn = document.getElementById('closeDiffBtn');

// ============================
// Section 3: Utility Functions
// ============================
function log(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logPanel.prepend(entry);
    // logPanel.scrollTop = 0; // Optional: ensure top is visible if user scrolled down, but usually not needed if prepending
}

function showToast(msg, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

function customConfirm(message) {
    return new Promise(resolve => {
        confirmMessage.textContent = message;
        confirmModal.classList.add('show');
        const cleanup = () => { confirmModal.classList.remove('show'); confirmYes.onclick = null; confirmNo.onclick = null; };
        confirmYes.onclick = () => { cleanup(); resolve(true); };
        confirmNo.onclick = () => { cleanup(); resolve(false); };
    });
}

// ============================
// Section 4: IndexedDB
// ============================
function openSyncDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
            if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveDirHandle(handle) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(handle, DIR_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getDirHandle() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const req = tx.objectStore(HANDLE_STORE).get(DIR_HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function removeDirHandle() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).delete(DIR_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function verifyPermission(handle) {
    if (!handle) return false;
    try {
        if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
        if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') return true;
    } catch (e) { console.error('verifyPermission error:', e); }
    return false;
}

// ============================
// Section 5: Snapshot System
// ============================
async function saveSnapshot(snapshot) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        tx.objectStore(SNAPSHOT_STORE).put(snapshot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function listSnapshots() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const req = tx.objectStore(SNAPSHOT_STORE).getAll();
        req.onsuccess = () => {
            const list = req.result || [];
            list.sort((a, b) => b.timestamp - a.timestamp);
            resolve(list);
        };
        req.onerror = () => reject(req.error);
    });
}

async function getSnapshot(id) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const req = tx.objectStore(SNAPSHOT_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function deleteSnapshotFromDB(id) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        tx.objectStore(SNAPSHOT_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function computeDiff(oldWildcards, newWildcards) {
    const oldKeys = new Set(Object.keys(oldWildcards || {}));
    const newKeys = new Set(Object.keys(newWildcards || {}));
    const added = [], removed = [], modified = [];
    for (const k of newKeys) {
        if (!oldKeys.has(k)) added.push(k);
        else if (oldWildcards[k] !== newWildcards[k]) modified.push(k);
    }
    for (const k of oldKeys) { if (!newKeys.has(k)) removed.push(k); }
    return { added, removed, modified };
}

async function createSnapshot(label, type = 'auto') {
    const data = await new Promise(r => chrome.storage.local.get(['wildcards', 'wildcardFolders'], r));
    const wildcards = data.wildcards || {};
    const folders = data.wildcardFolders || [];

    // Compute diff with previous snapshot
    const allSnaps = await listSnapshots();
    const prev = allSnaps.length > 0 ? allSnaps[0] : null;
    const diff = computeDiff(prev ? prev.wildcards : {}, wildcards);

    const snapshot = {
        id: `snap_${Date.now()}`,
        timestamp: Date.now(),
        label,
        type,
        wildcards: { ...wildcards },
        wildcardFolders: [...folders],
        diff
    };

    await saveSnapshot(snapshot);

    // Save to local .snapshots/ if directory is bound
    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle)) {
            await saveSnapshotToLocal(handle, snapshot);
        }
    } catch (e) {
        log(`本地快照保存失败: ${e.message}`, 'warn');
    }

    // Auto-cleanup: keep max N auto snapshots
    const autoSnaps = allSnaps.filter(s => s.type === 'auto');
    if (autoSnaps.length >= snapshotSettings.maxSnapshots) {
        const toDelete = autoSnaps.slice(snapshotSettings.maxSnapshots - 1);
        for (const old of toDelete) {
            await deleteSnapshotFull(old.id);
        }
    }

    log(`快照已创建: ${label} (${type})`, 'success');
    await renderSnapshotList();
    return snapshot;
}

async function loadSnapshotSettings() {
    const data = await new Promise(r => chrome.storage.local.get('snapshotSettings', r));
    if (data.snapshotSettings) {
        snapshotSettings = { ...snapshotSettings, ...data.snapshotSettings };
    }
}

async function saveSnapshotSettings() {
    await new Promise(r => chrome.storage.local.set({ snapshotSettings }, r));
}

// ... existing saveSnapshotToLocal ...

async function saveSnapshotToLocal(rootHandle, snapshot) {
    const snapDir = await rootHandle.getDirectoryHandle(SNAPSHOT_DIR, { create: true });
    const idDir = await snapDir.getDirectoryHandle(snapshot.id, { create: true });

    // Write metadata.json
    const metaFile = await idDir.getFileHandle('metadata.json', { create: true });
    const metaWritable = await metaFile.createWritable();
    await metaWritable.write(JSON.stringify({
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        label: snapshot.label,
        type: snapshot.type,
        diff: snapshot.diff,
        wildcardFolders: snapshot.wildcardFolders
    }, null, 2));
    await metaWritable.close();

    // Write wildcard files
    for (const [key, content] of Object.entries(snapshot.wildcards)) {
        const parts = key.split('/');
        const fileName = parts.pop() + '.txt';
        let targetDir = idDir;
        for (const part of parts) {
            targetDir = await targetDir.getDirectoryHandle(part, { create: true });
        }
        const fh = await targetDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(content);
        await w.close();
    }
}

async function deleteSnapshotFull(id) {
    // Delete from IndexedDB
    await deleteSnapshotFromDB(id);

    // Delete from local .snapshots/
    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle)) {
            const snapDir = await handle.getDirectoryHandle(SNAPSHOT_DIR, { create: false });
            await snapDir.removeEntry(id, { recursive: true });
        }
    } catch (e) {
        // Local snapshot dir may not exist, that's OK
    }
}

async function restoreSnapshot(id) {
    const snap = await getSnapshot(id);
    if (!snap) return showToast('快照不存在', 'error');

    // Auto snapshot before restoring
    await createSnapshot('恢复前自动备份', 'auto');

    await new Promise(r => chrome.storage.local.set({
        wildcards: snap.wildcards,
        wildcardFolders: snap.wildcardFolders
    }, r));

    log(`已从快照恢复: ${snap.label}`, 'success');
    showToast('快照已恢复', 'success');
    refreshFileTree();
}

async function renderSnapshotList() {
    const list = await listSnapshots();
    snapshotList.innerHTML = '';
    noSnapshots.style.display = list.length ? 'none' : 'block';

    // Validate selectedSnapshots
    const currentIds = new Set(list.map(s => s.id));
    for (const id of selectedSnapshots) {
        if (!currentIds.has(id)) selectedSnapshots.delete(id);
    }
    updateBatchButtons();

    for (const snap of list) {
        const li = document.createElement('li');
        li.className = 'snapshot-item';
        if (selectedSnapshots.has(snap.id)) li.classList.add('selected');

        const time = new Date(snap.timestamp).toLocaleString();
        const tagClass = snap.type === 'auto' ? 'auto' : 'manual';

        // Generate Diff Tags
        let diffHtml = '';
        if (snap.diff) {
            const allChanges = [];
            snap.diff.added.forEach(f => allChanges.push({ type: 'added', name: f, icon: '+' }));
            snap.diff.removed.forEach(f => allChanges.push({ type: 'removed', name: f, icon: '-' }));
            snap.diff.modified.forEach(f => allChanges.push({ type: 'modified', name: f, icon: '~' }));

            if (allChanges.length > 0) {
                // Show up to 100 tags, then use "more"
                const maxTags = 100;
                const showTags = allChanges.slice(0, maxTags);
                const remaining = allChanges.length - maxTags;

                diffHtml = '<div class="snapshot-diff-container">';
                showTags.forEach(item => {
                    // Extract just filename for display if path is long
                    const dispName = item.name.split('/').pop();
                    diffHtml += `<span class="diff-file-tag ${item.type}" title="${item.name}">${item.icon} ${dispName}</span>`;
                });
                if (remaining > 0) {
                    diffHtml += `<span class="diff-more-tag" title="还有 ${remaining} 个文件变动">+${remaining} more...</span>`;
                }
                diffHtml += '</div>';
            } else {
                diffHtml = '<div class="snapshot-diff-container"><span class="diff-more-tag">No changes</span></div>';
            }
        }

        li.innerHTML = `
            <div class="snapshot-select">
                <input type="checkbox" class="snap-checkbox" data-id="${snap.id}" ${selectedSnapshots.has(snap.id) ? 'checked' : ''}>
            </div>
            <div class="snapshot-content">
                <div class="snapshot-header">
                    <span class="snapshot-time">${time}</span>
                    <span class="snapshot-tag-type ${tagClass}">${snap.type}</span>
                    <span class="snapshot-label">${snap.label}</span>
                </div>
                ${diffHtml}
            </div>
            <div class="snapshot-actions">
                <button class="btn-sm" data-action="diff" data-id="${snap.id}" title="对比当前">🔍</button>
                <button class="btn-sm btn-success" data-action="restore" data-id="${snap.id}" title="恢复">↩</button>
                <button class="btn-sm" data-action="export" data-id="${snap.id}" title="导出 JSON">💾</button>
                <button class="btn-sm btn-danger" data-action="delete" data-id="${snap.id}" title="删除">✕</button>
            </div>
        `;
        snapshotList.appendChild(li);
    }

    // Event delegation... (kept same logic, just re-attaching)
    snapshotList.onclick = async (e) => {
        // Handle checkbox
        if (e.target.classList.contains('snap-checkbox')) {
            const id = e.target.dataset.id;
            if (e.target.checked) selectedSnapshots.add(id);
            else selectedSnapshots.delete(id);
            updateBatchButtons();
            // Toggle visual selected state
            const item = e.target.closest('.snapshot-item');
            if (item) {
                if (e.target.checked) item.classList.add('selected');
                else item.classList.remove('selected');
            }
            return;
        }

        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'restore') {
            if (await customConfirm('确认从此快照恢复？当前数据将被覆盖（已自动备份）。')) {
                await restoreSnapshot(id);
            }
        } else if (action === 'delete') {
            if (snapshotSettings.confirmDelete && !await customConfirm('确认删除此快照？')) return;
            await deleteSnapshotFull(id);
            log(`快照已删除: ${id}`, 'info');
            await renderSnapshotList();
        } else if (action === 'export') {
            await exportSnapshots([id]);
        } else if (action === 'diff') {
            await showDiff(id);
        }
    };
}

function updateBatchButtons() {
    const count = selectedSnapshots.size;
    batchDeleteBtn.disabled = count === 0;
    batchExportBtn.disabled = count === 0;
    batchDeleteBtn.innerHTML = `🗑️ 批量删除 ${count ? `(${count})` : ''}`;
    batchExportBtn.innerHTML = `💾 批量导出 ${count ? `(${count})` : ''}`;

    // Update selectAll
    const checkboxes = document.querySelectorAll('.snap-checkbox');
    if (checkboxes.length > 0) {
        selectAllSnapshots.checked = count === checkboxes.length;
        selectAllSnapshots.indeterminate = count > 0 && count < checkboxes.length;
    } else {
        selectAllSnapshots.checked = false;
        selectAllSnapshots.indeterminate = false;
    }
}

async function exportSnapshots(ids) {
    for (const id of ids) {
        const snap = await getSnapshot(id);
        if (!snap) continue;
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${snap.label}_${new Date(snap.timestamp).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    log(`已导出 ${ids.length} 个快照`, 'success');
}

async function deleteSnapshots(ids) {
    if (snapshotSettings.confirmDelete && !await customConfirm(`确认彻底删除选中的 ${ids.length} 个快照？`)) return;

    let count = 0;
    for (const id of ids) {
        await deleteSnapshotFull(id);
        count++;
    }
    log(`已批量删除 ${count} 个快照`, 'success');
    selectedSnapshots.clear();
    await renderSnapshotList();
}

async function showDiff(id) {
    const snap = await getSnapshot(id);
    if (!snap) return showToast('快照不存在', 'error');

    // Get current data
    const currentData = await new Promise(r => chrome.storage.local.get('wildcards', r));
    const currentWildcards = currentData.wildcards || {};

    // Calculate diff using full content
    const diff = computeDiff(snap.wildcards, currentWildcards);

    diffSummary.innerHTML = `
        <span style="margin-right:10px;">对比: [快照] ${snap.label} vs [当前]</span>
        <span class="diff-added">+${diff.added.length}</span>
        <span class="diff-removed">-${diff.removed.length}</span>
        <span class="diff-modified">~${diff.modified.length}</span>
    `;

    diffContainer.innerHTML = '';

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
        diffContainer.textContent = '内容完全一致';
    } else {
        const createItem = (key, type, icon) => {
            const div = document.createElement('div');
            div.style.padding = '4px';
            div.style.marginBottom = '2px';
            div.className = `diff-${type}`;
            div.style.cursor = 'pointer';
            div.textContent = `${icon} ${key}`;
            div.onclick = () => {
                // Show file diff Detail (simple)
                const oldContent = snap.wildcards[key] || '';
                const newContent = currentWildcards[key] || '';
                alert(`文件: ${key}\n\n[快照内容]:\n${oldContent}\n\n[当前内容]:\n${newContent}`);
            };
            return div;
        };

        diff.added.forEach(k => diffContainer.appendChild(createItem(k, 'added', '+')));
        diff.removed.forEach(k => diffContainer.appendChild(createItem(k, 'removed', '-')));
        diff.modified.forEach(k => diffContainer.appendChild(createItem(k, 'modified', '~')));
    }

    diffModal.classList.add('show');
}

// ============================
// Section 6: Sync (Export/Import with Delete)
// ============================

// Recursively scan local directory, returns { files: Map<key, content>, folders: string[] }
async function scanLocalDir(handle, prefix = '', skipDirs = [SNAPSHOT_DIR]) {
    const files = new Map();
    const folders = [];

    for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
            if (skipDirs.includes(entry.name)) continue;
            const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            folders.push(folderPath);
            const subDir = await handle.getDirectoryHandle(entry.name);
            const sub = await scanLocalDir(subDir, folderPath, skipDirs);
            for (const [k, v] of sub.files) files.set(k, v);
            for (const f of sub.folders) folders.push(f);
        } else if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
            const file = await entry.getFile();
            const baseName = entry.name.replace(/\.txt$/i, '');
            const key = prefix ? `${prefix}/${baseName}` : baseName;
            files.set(key, await file.text());
        }
    }
    return { files, folders };
}

// Recursively create nested folders
async function ensureDir(rootHandle, pathParts) {
    let current = rootHandle;
    for (const part of pathParts) {
        current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
}

// Recursively remove empty directories (bottom-up)
async function removeEmptyDirs(handle, allowedDirs = new Set(), prefix = '', skipDirs = [SNAPSHOT_DIR]) {
    for await (const entry of handle.values()) {
        if (entry.kind === 'directory' && !skipDirs.includes(entry.name)) {
            const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const subDir = await handle.getDirectoryHandle(entry.name);
            await removeEmptyDirs(subDir, allowedDirs, folderPath, skipDirs);

            // Check if directory is now empty
            let isEmpty = true;
            for await (const _ of subDir.values()) { isEmpty = false; break; }

            // Delete only if empty AND not in valid wildcardFolders
            if (isEmpty && !allowedDirs.has(folderPath)) {
                try {
                    await handle.removeEntry(entry.name);
                } catch (e) {
                    // Ignore errors (e.g. system files preventing deletion)
                }
            }
        }
    }
}

// Export: browser → local (with deletion of stale files)
async function doExport() {
    const handle = await getDirHandle();
    if (!handle || !await verifyPermission(handle)) {
        return log('请先绑定文件夹', 'error');
    }

    log('开始导出...', 'info');

    // 1. Auto snapshot
    await createSnapshot('导出前自动备份', 'auto');

    // 2. Get browser data
    const data = await new Promise(r => chrome.storage.local.get(['wildcards', 'wildcardFolders'], r));
    const wildcards = data.wildcards || {};
    const folders = data.wildcardFolders || [];

    // 3. Scan local files
    log('扫描本地文件...', 'info');
    const local = await scanLocalDir(handle);
    const browserKeys = new Set(Object.keys(wildcards));

    // 4. Delete local files not in browser
    let deleteCount = 0;
    for (const [localKey] of local.files) {
        if (!browserKeys.has(localKey)) {
            const parts = localKey.split('/');
            const fileName = parts.pop() + '.txt';
            let parentDir = handle;
            if (parts.length > 0) {
                try {
                    parentDir = await ensureDir(handle, parts);
                } catch { continue; }
            }
            try {
                await parentDir.removeEntry(fileName);
                log(`删除本地文件: ${localKey}`, 'warn');
                deleteCount++;
            } catch (e) {
                log(`删除失败: ${localKey} - ${e.message}`, 'error');
            }
        }
    }

    // 5. Create folders
    for (const folder of folders) {
        await ensureDir(handle, folder.split('/'));
    }

    // 6. Write files
    let writeCount = 0;
    for (const [key, content] of Object.entries(wildcards)) {
        const parts = key.split('/');
        const fileName = parts.pop() + '.txt';
        let targetDir = handle;
        if (parts.length > 0) targetDir = await ensureDir(handle, parts);
        const fh = await targetDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(content);
        await w.close();
        writeCount++;
    }

    // 7. Clean up empty dirs
    const allowedFolders = new Set(folders);
    await removeEmptyDirs(handle, allowedFolders);

    log(`导出完成! 写入 ${writeCount} 个文件, 删除 ${deleteCount} 个文件`, 'success');
    showToast(`导出完成: ${writeCount} 写入, ${deleteCount} 删除`, 'success');
}

// Import: local → browser (full replace)
async function doImport() {
    const handle = await getDirHandle();
    if (!handle || !await verifyPermission(handle)) {
        return log('请先绑定文件夹', 'error');
    }

    log('开始导入...', 'info');

    // 1. Auto snapshot
    await createSnapshot('导入前自动备份', 'auto');

    // 2. Scan local
    const local = await scanLocalDir(handle);

    // 3. Build data
    const wildcards = {};
    for (const [key, content] of local.files) {
        wildcards[key] = content;
    }

    // 4. Save to storage
    await new Promise(r => chrome.storage.local.set({
        wildcards,
        wildcardFolders: local.folders
    }, r));

    const fileCount = Object.keys(wildcards).length;
    log(`导入完成! ${fileCount} 个文件, ${local.folders.length} 个文件夹`, 'success');
    showToast(`导入完成: ${fileCount} 个文件`, 'success');
    refreshFileTree();
}

// ============================
// Section 7: File Tree & Drag-and-Drop
// ============================
function buildTreeData(wildcards, folders) {
    const root = { name: '', children: {}, files: [] };
    for (const f of folders) {
        const parts = f.split('/');
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) node.children[part] = { name: part, children: {}, files: [] };
            node = node.children[part];
        }
    }
    for (const key of Object.keys(wildcards)) {
        const parts = key.split('/');
        const fileName = parts.pop();
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) node.children[part] = { name: part, children: {}, files: [] };
            node = node.children[part];
        }
        node.files.push({ key, name: fileName });
    }
    return root;
}

function handleDragStart(e, type, path) {
    e.dataTransfer.setData('application/wildcard-type', type);
    e.dataTransfer.setData('application/wildcard-path', path);
    e.dataTransfer.effectAllowed = 'move';
    draggedItem = { type, path };
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    target.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetFolder) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const type = e.dataTransfer.getData('application/wildcard-type');
    const oldPath = e.dataTransfer.getData('application/wildcard-path');

    if (!type || !oldPath) return;

    // Avoid moving into self or child
    if (type === 'folder' && (targetFolder === oldPath || targetFolder.startsWith(oldPath + '/'))) {
        return showToast('不能移动到自身或子文件夹中', 'warn');
    }

    // New path construction
    const name = oldPath.split('/').pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;

    if (newPath === oldPath) return; // No change

    log(`Moving ${type}: ${oldPath} -> ${newPath}`, 'info');

    // Perform move logic
    chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
        const wildcards = data.wildcards || {};
        const folders = data.wildcardFolders || [];

        let modified = false;

        if (type === 'file') {
            if (wildcards[newPath]) {
                if (!confirm(`文件 "${newPath}" 已存在，是否覆盖？`)) return;
            }
            wildcards[newPath] = wildcards[oldPath];
            delete wildcards[oldPath];
            modified = true;
        } else if (type === 'folder') {
            // Check if destination folder already exists
            const existingFolder = folders.includes(newPath);
            // Move all files/folders inside
            const oldPrefix = oldPath + '/';
            const newPrefix = newPath + '/';

            // Update folders
            const newFolders = folders.map(f => {
                if (f === oldPath) return newPath;
                if (f.startsWith(oldPrefix)) return newPrefix + f.slice(oldPrefix.length);
                return f;
            });

            // Update files
            const newWildcards = {};
            let conflict = false;
            Object.keys(wildcards).forEach(k => {
                if (k.startsWith(oldPrefix)) {
                    const newK = newPrefix + k.slice(oldPrefix.length);
                    if (wildcards[newK] && !confirm(`文件 "${newK}" 已存在，是否覆盖？`)) conflict = true;
                    newWildcards[newK] = wildcards[k];
                } else {
                    newWildcards[k] = wildcards[k];
                }
            });

            if (conflict) return;

            // Apply changes (filtering out old keys)
            chrome.storage.local.set({
                wildcardFolders: newFolders,
                wildcards: newWildcards
            }, () => {
                refreshFileTree();
                log(`移动完成: ${oldPath} -> ${newPath}`, 'success');
            });
            return; // Exit early as we process folders differently above
        }

        if (modified) {
            chrome.storage.local.set({ wildcards, wildcardFolders: folders }, () => {
                refreshFileTree();
                if (currentFile === oldPath) {
                    currentFile = newPath;
                    fileNameInput.value = newPath.split('/').pop();
                }
                log(`已移动: ${oldPath} -> ${newPath}`, 'success');
            });
        }
    });
}

function renderTreeNode(node, path = '', depth = 0) {
    const fragment = document.createDocumentFragment();

    const folderNames = Object.keys(node.children).sort();
    for (const folderName of folderNames) {
        const child = node.children[folderName];
        const folderPath = path ? `${path}/${folderName}` : folderName;
        const isExpanded = expandedFolders.has(folderPath);
        const isSelected = selectedFolder === folderPath;

        const item = document.createElement('div');
        item.className = `tree-item ${isSelected ? 'selected' : ''}`;
        item.style.paddingLeft = `${16 + depth * 14}px`;
        item.draggable = true;
        item.innerHTML = `
            <span class="icon">${isExpanded ? '📂' : '📁'}</span>
            <span class="name">${folderName}</span>
            <div class="actions">
                <button data-folder-delete="${folderPath}" title="删除文件夹">✕</button>
            </div>
        `;

        // Click to expand/collapse + select
        item.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            // Toggle expand
            if (expandedFolders.has(folderPath)) expandedFolders.delete(folderPath);
            else expandedFolders.add(folderPath);
            // Select folder
            selectedFolder = folderPath;
            refreshFileTree();
        });

        // Drag events
        item.addEventListener('dragstart', (e) => handleDragStart(e, 'folder', folderPath));
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, folderPath));

        fragment.appendChild(item);

        const childContainer = document.createElement('div');
        childContainer.className = `tree-folder-children${isExpanded ? '' : ' collapsed'}`;
        childContainer.appendChild(renderTreeNode(child, folderPath, depth + 1));
        fragment.appendChild(childContainer);
    }

    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
        const item = document.createElement('div');
        item.className = `tree-item${currentFile === file.key ? ' active' : ''}`;
        item.style.paddingLeft = `${16 + depth * 14}px`;
        item.draggable = true;
        item.innerHTML = `
            <span class="icon">📄</span>
            <span class="name">${file.name}</span>
            <div class="actions">
                <button data-file-delete="${file.key}" title="删除文件">✕</button>
            </div>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openFile(file.key);
            // Select parent folder implicitly or stay as is? 
            // Better to let user explicitly select folders for creation context.
        });

        // Drag events
        item.addEventListener('dragstart', (e) => handleDragStart(e, 'file', file.key));
        // Files can't be drop targets for folders, but could drag onto them to mean "into same folder"? 
        // Standard behavior is dropping ONTO folders.

        fragment.appendChild(item);
    }

    return fragment;
}

function refreshFileTree() {
    chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
        const wildcards = data.wildcards || {};
        const folders = data.wildcardFolders || [];
        const tree = buildTreeData(wildcards, folders);
        fileTree.innerHTML = '';

        // Root droppable area
        const rootDrop = document.createElement('div');
        rootDrop.style.minHeight = '100%';
        rootDrop.addEventListener('dragover', handleDragOver);
        rootDrop.addEventListener('dragleave', handleDragLeave);
        rootDrop.addEventListener('drop', (e) => handleDrop(e, '')); // Drop to root with empty path

        // Clicking empty area deselects folder
        rootDrop.addEventListener('click', (e) => {
            if (e.target === rootDrop) {
                selectedFolder = null;
                refreshFileTree();
            }
        });

        rootDrop.appendChild(renderTreeNode(tree));
        fileTree.appendChild(rootDrop);

        // Update placeholder to show where file will be created
        if (selectedFolder) {
            newItemName.placeholder = `新建于: ${selectedFolder.split('/').pop()}`;
        } else {
            newItemName.placeholder = '新建于: 根目录';
        }

        // Attach delete handlers (same as before)
        rootDrop.querySelectorAll('[data-file-delete]').forEach(btn => { /* ... existing delete logic ... */ });
        // ... (Due to space, I'm keeping the previous delete logic but need to re-bind it here)
        attachDeleteHandlers();
    });
}

function attachDeleteHandlers() {
    fileTree.querySelectorAll('[data-file-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const key = btn.dataset.fileDelete;
            if (!await customConfirm(`确认删除文件 "${key}"？`)) return;
            chrome.storage.local.get('wildcards', d => {
                const map = d.wildcards || {};
                delete map[key];
                chrome.storage.local.set({ wildcards: map }, () => {
                    if (currentFile === key) closeEditor();
                    log(`已删除文件: ${key}`, 'info');
                    refreshFileTree();
                });
            });
        });
    });

    fileTree.querySelectorAll('[data-folder-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const folder = btn.dataset.folderDelete;
            if (!await customConfirm(`确认删除文件夹 "${folder}" 及其所有文件？`)) return;
            chrome.storage.local.get(['wildcards', 'wildcardFolders'], d => {
                const map = d.wildcards || {};
                const folders = d.wildcardFolders || [];
                const newMap = {};
                Object.keys(map).forEach(k => { if (!k.startsWith(folder + '/')) newMap[k] = map[k]; });
                const newFolders = folders.filter(f => f !== folder && !f.startsWith(folder + '/'));
                chrome.storage.local.set({ wildcards: newMap, wildcardFolders: newFolders }, () => {
                    if (currentFile && currentFile.startsWith(folder + '/')) closeEditor();
                    expandedFolders.delete(folder);
                    log(`已删除文件夹: ${folder}`, 'info');
                    refreshFileTree();
                });
            });
        });
    });
}


// ============================
// Section 8: CodeMirror Editor & Web Worker
// ============================
let searchWorker = null;
let pendingSearches = new Map();
let searchIdCounter = 0;

function initWorker() {
    if (searchWorker) return;
    try {
        const workerUrl = chrome.runtime.getURL('worker.js');
        searchWorker = new Worker(workerUrl);
        searchWorker.onmessage = (e) => {
            const { type, id, results, count } = e.data;
            if (type === 'ready') {
                log(`后台搜索服务就绪: ${count} 条目`, 'success');
            } else if (type === 'searchResults') {
                const resolve = pendingSearches.get(id);
                if (resolve) {
                    resolve(results);
                    pendingSearches.delete(id);
                }
            }
        };
        searchWorker.onerror = (err) => {
            console.error('Worker Error:', err);
            log('搜索服务出错', 'error');
        };
    } catch (e) {
        log('无法启动搜索服务: ' + e.message, 'error');
    }
}

function initEditor() {
    const {
        EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, EditorState, defaultKeymap, indentWithTab, history, historyKeymap,
        searchKeymap, highlightSelectionMatches, autocompletion, completionKeymap, acceptCompletion,
        bracketMatching, oneDark
    } = CM;

    async function tagCompletions(context) {
        // Init worker if not ready (fallback logic needed? No, loadDictionary handles it)
        if (!searchWorker) return null;

        const line = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);
        const lastSep = Math.max(textBefore.lastIndexOf(','), textBefore.lastIndexOf('\n'));
        const wordStart = lastSep + 1;
        const word = textBefore.slice(wordStart).trim().toLowerCase();

        // User requested 1-char search support via Worker
        if (word.length < 1) return null;

        const from = line.from + wordStart + (textBefore.slice(wordStart).length - textBefore.slice(wordStart).trimStart().length);

        return new Promise(resolve => {
            const id = ++searchIdCounter;

            // Timeout safety (if worker hangs, though unlikely for linear scan of 150k)
            const timeoutId = setTimeout(() => {
                pendingSearches.delete(id);
                resolve(null);
            }, 1000);

            pendingSearches.set(id, (results) => {
                clearTimeout(timeoutId);
                if (!results || results.length === 0) resolve(null);
                else {
                    const options = results.map(entry => ({
                        label: entry.tag,
                        detail: entry.zhCN || '',
                        apply: entry.tag,
                        boost: entry.popCount || 0
                    }));
                    // Worker already sorts
                    resolve({ from, options, filter: false });
                }
            });

            searchWorker.postMessage({ type: 'search', payload: { id, query: word, limit: 50 } });
        });
    }

    const extensions = [
        lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), bracketMatching(), highlightActiveLine(), highlightSelectionMatches(),
        keymap.of([
            ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab,
            { key: 'Mod-s', run: () => { saveCurrentFile(); return true; } },
            { key: 'Tab', run: acceptCompletion }
        ]),
        autocompletion({ override: [tagCompletions], activateOnTyping: true, maxRenderedOptions: 25 }),
        oneDark,
        EditorView.updateListener.of(update => {
            if (update.docChanged || update.selectionSet) updateLineInfo(update.state);
            if (update.docChanged) markModified();
        }),
        EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" },
            '.cm-content': { padding: '8px 0' },
            '.cm-gutters': { background: '#1a1a2e', borderRight: '1px solid #2a2a44' },
            '.cm-activeLineGutter': { background: '#252545' },
            '.cm-tooltip.cm-tooltip-autocomplete': { background: '#1e1e35', border: '1px solid #3a3a55', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' },
            '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', fontSize: '13px' },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#3d3d6a' },
            '.cm-completionLabel': { color: '#d4d4e0' },
            '.cm-completionDetail': { color: '#888', fontStyle: 'italic', marginLeft: '8px' }
        })
    ];
    editorView = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent: editorContainer });
}

function updateLineInfo(state) {
    const cursor = state.selection.main.head;
    const line = state.doc.lineAt(cursor);
    const totalLines = state.doc.lines;
    lineInfo.textContent = `第 ${line.number} 行 / 共 ${totalLines} 行`;
}

function markModified() {
    if (currentFile) {
        const current = editorView.state.doc.toString();
        if (current !== localContent) {
            saveStatus.textContent = '● 未保存';
            saveStatus.className = 'modified';
        }
    }
}

function markSaved() {
    saveStatus.textContent = '✓ 已保存';
    saveStatus.className = 'saved';
    setTimeout(() => {
        if (saveStatus.className === 'saved') {
            saveStatus.textContent = '';
            saveStatus.className = '';
        }
    }, 2000);
}

function openFile(key) {
    if (currentFile && editorView) {
        try {
            const current = editorView.state.doc.toString().replace(/\r\n/g, '\n');
            const local = (localContent || '').replace(/\r\n/g, '\n');
            if (current !== local && !confirm('当前文件有未保存的更改，是否放弃？')) return;
        } catch (e) {
            console.error('Check unsaved failed:', e);
            if (!confirm('检测未保存更改时出错，是否强制切换？')) return;
        }
    }
    chrome.storage.local.get('wildcards', data => {
        try {
            const map = data.wildcards || {};
            if (!(key in map)) {
                showToast('文件不存在', 'error');
                refreshFileTree(); // Sync tree state
                return;
            }
            currentFile = key;
            localContent = map[key] || '';
            const fileName = key.includes('/') ? key.split('/').pop() : key;
            fileNameInput.value = fileName;

            editorHeader.style.display = 'flex';
            editorPlaceholder.style.display = 'none';
            editorContainer.style.display = 'block';
            editorStatusbar.style.display = 'flex';
            extChangeBanner.classList.remove('show');

            if (!editorView) initEditor();

            // Safe dispatch
            editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: localContent } });

            saveStatus.textContent = '';
            saveStatus.className = '';
            updateLineInfo(editorView.state);
        } catch (e) {
            log('打开文件失败: ' + e.message, 'error');
            showToast('打开文件出错', 'error');
            // Recovery: Destroy potentially corrupted editor
            if (editorView) {
                try { editorView.destroy(); } catch (err) { }
                editorView = null;
                editorContainer.innerHTML = '';
            }
        } finally {
            refreshFileTree(); // Always refresh to ensure UI state is consistent
        }
    });
}

function closeEditor() {
    currentFile = null;
    localContent = '';
    editorHeader.style.display = 'none';
    editorPlaceholder.style.display = 'flex';
    editorContainer.style.display = 'none';
    editorStatusbar.style.display = 'none';
    extChangeBanner.classList.remove('show');
    refreshFileTree();
}

function saveCurrentFile() {
    if (!currentFile || !editorView) return;
    const content = editorView.state.doc.toString();
    const newName = fileNameInput.value.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
    if (!newName) return showToast('请输入文件名', 'error');
    chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
        const map = data.wildcards || {};
        const oldParts = currentFile.split('/');
        oldParts.pop();
        const newKey = oldParts.length > 0 ? `${oldParts.join('/')}/${newName}` : newName;
        if (newKey !== currentFile && map[newKey]) return showToast(`文件已存在: ${newKey}`, 'error');
        if (newKey !== currentFile) delete map[currentFile];
        map[newKey] = content;
        localContent = content;
        currentFile = newKey;
        chrome.storage.local.set({ wildcards: map }, () => {
            markSaved();
            log(`已保存: ${newKey}`, 'success');
            refreshFileTree();
        });
    });
}

// ============================
// Section 9: Dictionary Loading
// ============================
async function loadDictionary() {
    try {
        if (groupTagsDataUtils.loadEffectiveDictionaryData) {
            const dictionaryData = await groupTagsDataUtils.loadEffectiveDictionaryData();
            autocompleteDict = (dictionaryData.entries || []).map(entry => ({
                tag: entry.tag,
                colorCode: String(entry.color || 0),
                popCount: parseInt(entry.count, 10) || 0,
                aliases: String(entry.aliases || '').split(',').map(a => a.trim()).filter(Boolean),
                zhCN: entry.zhCN ? entry.zhCN.trim() : ''
            }));
        } else {
            const csvUrl = chrome.runtime.getURL('data/dictionary.csv');
            const res = await fetch(csvUrl);
            const text = await res.text();
            autocompleteDict = text.split(/\r?\n/).filter(Boolean).map(line => {
                const regex = /"([^"]*(?:""[^"]*)*)"|([^,]+)/g;
                const row = [];
                let match;
                while ((match = regex.exec(line)) !== null) row.push(match[1] !== undefined ? match[1] : match[2]);
                while (row.length < 5) row.push('');
                const [tag, colorCode, popCount, aliases, zhCN] = row;
                return {
                    tag: tag.trim(),
                    colorCode: colorCode.trim(),
                    popCount: parseInt(popCount) || 0,
                    aliases: aliases.replace(/"/g, '').split(',').map(a => a.trim()).filter(Boolean),
                    zhCN: zhCN ? zhCN.trim() : ''
                };
            });
        }
        log(`字典加载完成: ${autocompleteDict.length} 个标签`, 'success');

        // Send to worker
        initWorker();
        if (searchWorker) {
            searchWorker.postMessage({ type: 'init', payload: autocompleteDict });
        }
    } catch (e) {
        log(`字典加载失败: ${e.message}`, 'error');
        autocompleteDict = [];
    }
}

// ============================
// Section 10: UI Setup & Events
// ============================
function updateTopUI(dirName) {
    if (dirName) {
        statusText.textContent = `已绑定: ${dirName}`;
        statusText.classList.add('linked');
        linkBtn.style.display = 'none';
        unlinkBtn.style.display = '';
        exportBtn.style.display = '';
        importBtn.style.display = '';
        snapshotBtn.style.display = '';
    } else {
        statusText.textContent = '未绑定本地文件夹';
        statusText.classList.remove('linked');
        linkBtn.style.display = '';
        unlinkBtn.style.display = 'none';
        exportBtn.style.display = 'none';
        importBtn.style.display = 'none';
        snapshotBtn.style.display = 'none';
    }
}

document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        bottomContent.querySelectorAll(':scope > div').forEach(d => d.classList.remove('active'));
        document.getElementById(target + 'Panel').classList.add('active');
    });
});

let bottomExpanded = true;
toggleBottom.addEventListener('click', () => {
    bottomExpanded = !bottomExpanded;
    bottomContent.style.display = bottomExpanded ? '' : 'none';
    toggleBottom.textContent = bottomExpanded ? '▼ 折叠' : '▲ 展开';
});

let isResizing = false;
resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
    if (isResizing) {
        const newWidth = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.5);
        sidebar.style.width = newWidth + 'px';
    } else if (isResizingBottom) {
        const newHeight = Math.max(36, window.innerHeight - e.clientY);
        bottomPanel.style.height = newHeight + 'px';
        bottomPanel.style.maxHeight = 'none'; // release max-height restriction
    }
});
document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    } else if (isResizingBottom) {
        isResizingBottom = false;
        resizeHandleBottom.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

let isResizingBottom = false;
resizeHandleBottom.addEventListener('mousedown', (e) => {
    isResizingBottom = true;
    resizeHandleBottom.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

newFileBtn.addEventListener('click', () => {
    let raw = newItemName.value.trim();
    let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');
    if (!name) return showToast('请输入文件名', 'error');

    // Handle creation in selected folder
    const fullName = selectedFolder ? `${selectedFolder}/${name}` : name;

    chrome.storage.local.get('wildcards', data => {
        const map = data.wildcards || {};
        if (map[fullName]) return showToast(`文件已存在: ${fullName}`, 'error');
        map[fullName] = '';
        chrome.storage.local.set({ wildcards: map }, () => {
            newItemName.value = '';
            log(`创建文件: ${fullName}`, 'info');
            refreshFileTree();
            openFile(fullName);
        });
    });
});

newFolderBtn.addEventListener('click', () => {
    let raw = newItemName.value.trim();
    let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');
    if (!name) return showToast('请输入文件夹名', 'error');

    // Handle creation in selected folder
    const fullName = selectedFolder ? `${selectedFolder}/${name}` : name;

    chrome.storage.local.get('wildcardFolders', data => {
        const folders = data.wildcardFolders || [];
        if (folders.includes(fullName)) return showToast(`文件夹已存在: ${fullName}`, 'error');
        folders.push(fullName);
        chrome.storage.local.set({ wildcardFolders: folders }, () => {
            newItemName.value = '';
            expandedFolders.add(fullName);
            log(`创建文件夹: ${fullName}`, 'info');
            refreshFileTree();
        });
    });
});

linkBtn.addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker();
        await saveDirHandle(dirHandle);
        updateTopUI(dirHandle.name);
        log(`已绑定: ${dirHandle.name}`, 'success');
    } catch (e) {
        if (e.name === 'AbortError') log('用户取消选择', 'info');
        else log(`绑定失败: ${e.message}`, 'error');
    }
});

unlinkBtn.addEventListener('click', async () => {
    await removeDirHandle();
    updateTopUI(null);
    log('已解除绑定', 'info');
});

exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try { await doExport(); }
    catch (e) { log(`导出失败: ${e.message}`, 'error'); showToast('导出失败', 'error'); }
    finally { exportBtn.disabled = false; }
});

importBtn.addEventListener('click', async () => {
    if (!await customConfirm('导入将用本地文件完全替换浏览器数据。操作前会自动创建快照。继续？')) return;
    importBtn.disabled = true;
    try { await doImport(); }
    catch (e) { log(`导入失败: ${e.message}`, 'error'); showToast('导入失败', 'error'); }
    finally { importBtn.disabled = false; }
});

snapshotBtn.addEventListener('click', async () => {
    await createSnapshot('手动快照', 'manual');
    showToast('手动快照已创建', 'success');
});

saveBtn.addEventListener('click', saveCurrentFile);
reloadFileBtn.addEventListener('click', () => { if (currentFile) openFile(currentFile); });
dismissBannerBtn.addEventListener('click', () => { extChangeBanner.classList.remove('show'); });

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.wildcards || changes.wildcardFolders) {
        refreshFileTree();
        if (currentFile && changes.wildcards) {
            const newData = changes.wildcards.newValue || {};
            if (currentFile in newData) {
                const externalContent = newData[currentFile];
                const editorContent = editorView ? editorView.state.doc.toString() : '';
                if (externalContent !== editorContent && externalContent !== localContent) extChangeBanner.classList.add('show');
            } else {
                showToast('当前编辑的文件已被外部删除', 'error');
                closeEditor();
            }
        }
    }
});

// Snapshot Toolbar Events
selectAllSnapshots.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.snap-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const id = cb.dataset.id;
        if (e.target.checked) selectedSnapshots.add(id);
        else selectedSnapshots.delete(id);
    });
    updateBatchButtons();
});

batchDeleteBtn.addEventListener('click', () => deleteSnapshots(Array.from(selectedSnapshots)));
batchExportBtn.addEventListener('click', () => exportSnapshots(Array.from(selectedSnapshots)));

// Settings Modal Events
snapshotSettingsBtn.addEventListener('click', () => {
    settingMaxSnapshots.value = snapshotSettings.maxSnapshots;
    settingConfirmDelete.checked = snapshotSettings.confirmDelete;
    snapSettingsModal.classList.add('show');
});

saveSnapSettingsBtn.addEventListener('click', async () => {
    const max = parseInt(settingMaxSnapshots.value, 10);
    if (isNaN(max) || max < 1) return showToast('请输入有效的数量', 'error');

    snapshotSettings.maxSnapshots = max;
    snapshotSettings.confirmDelete = settingConfirmDelete.checked;
    await saveSnapshotSettings();
    showToast('设置已保存', 'success');
    snapSettingsModal.classList.remove('show');
});

closeSnapSettingsBtn.addEventListener('click', () => snapSettingsModal.classList.remove('show'));

// Diff Modal Events
closeDiffBtn.addEventListener('click', () => diffModal.classList.remove('show'));
// Close modals on outside click
window.addEventListener('click', (e) => {
    if (e.target === snapSettingsModal) snapSettingsModal.classList.remove('show');
    if (e.target === snapSettingsModal) snapSettingsModal.classList.remove('show');
    if (e.target === diffModal) diffModal.classList.remove('show');
    if (e.target === dictChangesModal) dictChangesModal.classList.remove('show');
});
// ============================
// Section 12: Dictionary Editor (Virtual Scroll)
// ============================

const dictView = document.getElementById('dictView');
const dictViewport = document.getElementById('dictViewport');
const dictSpacer = document.getElementById('dictSpacer');
const dictWindow = document.getElementById('dictWindow');
const dictSearch = document.getElementById('dictSearch');
const dictFilterType = document.getElementById('dictFilterType');
const dictStatTotal = document.getElementById('dictStatTotal');
const dictStatModified = document.getElementById('dictStatModified');
const dictAddBtn = document.getElementById('dictAddBtn');
const dictImportBtn = document.getElementById('dictImportBtn');
const dictExportBtn = document.getElementById('dictExportBtn');
const dictToggleChangesBtn = document.getElementById('dictToggleChangesBtn');
const dictResetBtn = document.getElementById('dictResetBtn');
const viewSwitcher = document.getElementById('viewSwitcher');
const syncActions = document.getElementById('syncActions');

let dictBaseData = [];
let dictOverlay = {};
let dictNewEntries = [];
let dictFilteredIndices = [];
let dictMergedView = [];
let dictSearchIdx = [];
let dictLoaded = false;
let dictCurrentQuery = '';
let dictShowChanges = false;

const CARD_HEIGHT = 105;
const CARD_MIN_WIDTH = 220;
const CARD_GAP = 8;
const GRID_PAD_X = 16;
const GRID_PAD_Y = 12;
let dictCols = 1;
let dictVisibleRows = 0;
let dictTotalRows = 0;
let dictLastStartRow = -1;
let dictRafId = null;

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current); current = ''; }
            else { current += ch; }
        }
    }
    result.push(current);
    return result;
}

async function loadDictForEditor() {
    if (dictLoaded) return;
    const t0 = performance.now();
    try {
        const resp = await fetch(chrome.runtime.getURL('data/dictionary.csv'));
        const text = await resp.text();
        const lines = text.split('\n');
        dictBaseData = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = parseCSVLine(line);
            dictBaseData.push({
                tag: parts[0] || '', color: parseInt(parts[1]) || 0,
                count: parseInt(parts[2]) || 0, aliases: parts[3] || '',
                zhCN: parts[4] || '', _idx: i
            });
        }
        if (groupTagsDataUtils.loadStoredDictionaryOverlay) {
            const normalizedOverlay = await groupTagsDataUtils.loadStoredDictionaryOverlay();
            dictOverlay = normalizedOverlay.overlay || {};
            dictNewEntries = normalizedOverlay.newEntries || [];
        } else {
            const stored = await new Promise(r => chrome.storage.local.get('dictOverlay', r));
            if (stored.dictOverlay) {
                try {
                    const parsed = JSON.parse(stored.dictOverlay);
                    dictOverlay = parsed.overlay || {};
                    dictNewEntries = parsed.newEntries || [];
                } catch (e) { dictOverlay = {}; dictNewEntries = []; }
            }
        }
        buildMergedView();
        buildSearchIndex();
        filterDict(dictCurrentQuery);
        dictLoaded = true;
        const dt = ((performance.now() - t0) / 1000).toFixed(2);
        log(`字典加载完成: ${dictBaseData.length.toLocaleString()} 条 (${dt}s)`, 'success');
    } catch (e) {
        log(`字典加载失败: ${e.message}`, 'error');
    }
}

function buildMergedView() {
    dictMergedView = dictBaseData.map(item => {
        const ov = dictOverlay[item.tag];
        if (ov) return { ...item, ...ov, _modified: true, _key: item.tag };
        return { ...item, _key: item.tag };
    });
    for (const ne of dictNewEntries) {
        if (!ne._deleted) dictMergedView.push({ ...ne, _modified: true, _new: true });
    }
    // We keep _deleted items in dictMergedView now, to support "Show Changes" view
}

function buildSearchIndex() {
    dictSearchIdx = dictMergedView.map((item, i) => ({
        idx: i,
        tag: (item.tag || '').toLowerCase(),
        zhCN: (item.zhCN || '').toLowerCase(),
        aliases: (item.aliases || '').toLowerCase(),
    }));
}

function filterDict(query) {
    dictCurrentQuery = query;
    const typeFilter = parseInt(dictFilterType.value);
    const q = query.trim().toLowerCase();

    // Always filter to ensure deleted items are hidden by default
    dictFilteredIndices = [];
    for (let i = 0; i < dictSearchIdx.length; i++) {
        const s = dictSearchIdx[i];

        // Check type first
        if (typeFilter !== -1) {
            const item = dictMergedView[s.idx];
            if (item.color !== typeFilter) continue;
        }

        const item = dictMergedView[s.idx];
        if (dictShowChanges) {
            if (!item._modified) continue;
        } else {
            if (item._deleted) continue;
        }

        if (!q || s.tag.includes(q) || s.zhCN.includes(q) || s.aliases.includes(q)) {
            dictFilteredIndices.push(s.idx);
        }
    }

    // Sort by modification time if showing changes
    if (dictShowChanges) {
        dictFilteredIndices.sort((a, b) => {
            const itemA = dictMergedView[a];
            const itemB = dictMergedView[b];
            const timeA = itemA._lastModified || 0;
            const timeB = itemB._lastModified || 0;
            return timeB - timeA; // Descending (Newest first)
        });
    }
    updateDictStatus();
    recalcGrid();
    dictLastStartRow = -1;
    renderVirtualGrid();
}

async function saveDictOverlay() {
    if (groupTagsDataUtils.saveDictionaryOverlayData) {
        const normalized = await groupTagsDataUtils.saveDictionaryOverlayData(dictOverlay, dictNewEntries);
        dictOverlay = normalized.overlay || {};
        dictNewEntries = normalized.newEntries || [];
    } else {
        const data = JSON.stringify({ overlay: dictOverlay, newEntries: dictNewEntries });
        await new Promise(r => chrome.storage.local.set({ dictOverlay: data }, r));
    }
    if (groupTagsDataUtils.syncStoredGroupTagsTranslationsFromDictionary) {
        await groupTagsDataUtils.syncStoredGroupTagsTranslationsFromDictionary();
    }
    updateDictStatus();
}

function recalcGrid() {
    const vpWidth = dictViewport.clientWidth - GRID_PAD_X * 2;
    dictCols = Math.max(1, Math.floor((vpWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
    dictTotalRows = Math.ceil(dictFilteredIndices.length / dictCols);
    const totalHeight = dictTotalRows * (CARD_HEIGHT + CARD_GAP) + GRID_PAD_Y * 2;
    dictSpacer.style.height = totalHeight + 'px';
    dictVisibleRows = Math.ceil(dictViewport.clientHeight / (CARD_HEIGHT + CARD_GAP)) + 2;
}

function renderVirtualGrid() {
    if (dictRafId) cancelAnimationFrame(dictRafId);
    dictRafId = requestAnimationFrame(() => {
        dictRafId = null;
        const scrollTop = dictViewport.scrollTop;
        const startRow = Math.max(0, Math.floor((scrollTop - GRID_PAD_Y) / (CARD_HEIGHT + CARD_GAP)));
        if (startRow === dictLastStartRow) return;
        dictLastStartRow = startRow;
        const endRow = Math.min(dictTotalRows, startRow + dictVisibleRows);
        const startIdx = startRow * dictCols;
        const endIdx = Math.min(dictFilteredIndices.length, endRow * dictCols);
        const windowTop = GRID_PAD_Y + startRow * (CARD_HEIGHT + CARD_GAP);
        dictWindow.style.transform = `translateY(${windowTop}px)`;
        const fragment = document.createDocumentFragment();
        for (let i = startIdx; i < endIdx; i++) {
            const dataIdx = dictFilteredIndices[i];
            const item = dictMergedView[dataIdx];
            if (!item) continue;
            fragment.appendChild(createDictCard(item, dataIdx));
        }
        dictWindow.innerHTML = '';
        dictWindow.appendChild(fragment);
    });
}

function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function createDictCard(item, dataIdx) {
    const card = document.createElement('div');
    card.className = 'dict-card' + (item._modified ? ' modified' : '') + (item._deleted ? ' deleted' : '');
    card.dataset.idx = dataIdx;
    const colorClass = `color-${item.color || 0}`;
    // Restore/Revert for modified/deleted items (except new ones), Delete for others
    const isRestore = (item._modified || item._deleted) && !item._new;
    const actionBtn = isRestore
        ? `<button data-action="restore" title="恢复" style="color:#4ade80">↺</button>`
        : `<button data-action="delete" title="删除">✕</button>`;

    card.innerHTML = `
        <div class="dict-card-header">
            <span class="dict-color-dot ${colorClass}"></span>
            <span class="dict-count">${formatCount(item.count)}</span>
        </div>
        <div class="dict-tag editable" data-field="tag" title="${escHtml(item.tag)}">${escHtml(item.tag)}</div>
        <div class="dict-aliases editable" data-field="aliases" title="${escHtml(item.aliases || '')}">${escHtml(item.aliases || '')}</div>
        <div class="dict-zh editable" data-field="zhCN">${escHtml(item.zhCN || '')}</div>
        <div class="dict-card-actions">${actionBtn}</div>
    `;
    return card;
}

dictWindow.addEventListener('click', (e) => {
    const delBtn = e.target.closest('button[data-action="delete"]');
    if (delBtn) {
        const card = delBtn.closest('.dict-card');
        const idx = parseInt(card.dataset.idx);
        const item = dictMergedView[idx];
        const key = item._new ? item.tag : (item._key || item.tag);

        if (item._new) {
            // For new items, we can either mark deleted or remove?
            // Since we want to show changes, marking deleted is better if we want to show "I added then deleted"?
            // But usually deleting a new item simply removes it.
            // Let's stick to removal for new items to avoid clutter.
            // User: "Show changed tags". If I add then delete, there is NO change relative to base.
            dictNewEntries = dictNewEntries.filter(ne => ne.tag !== item.tag);
        } else {
            if (!dictOverlay[key]) dictOverlay[key] = {};
            dictOverlay[key]._deleted = true;
            dictOverlay[key]._lastModified = Date.now();
        }
        item._deleted = true; // optimize immediate feedback
        saveDictOverlay();
        rebuildAndRender();
        return;
    }

    const restoreBtn = e.target.closest('button[data-action="restore"]');
    if (restoreBtn) {
        const card = restoreBtn.closest('.dict-card');
        const idx = parseInt(card.dataset.idx);
        const item = dictMergedView[idx];
        const key = item._key || item.tag;

        if (dictOverlay[key]) {
            delete dictOverlay[key]; // Remove entire overlay entry to revert to base
        }
        // item object in view is stale, but rebuild will fix it
        saveDictOverlay();
        rebuildAndRender();
        return;
    }
    const editable = e.target.closest('.editable');
    if (!editable || editable.querySelector('input')) return;
    const field = editable.dataset.field;
    const card = editable.closest('.dict-card');
    const idx = parseInt(card.dataset.idx);
    const item = dictMergedView[idx];
    const currentValue = item[field] || '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dict-edit-input';
    input.value = currentValue;
    editable.textContent = '';
    editable.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
        const newVal = input.value.trim();
        input.remove();
        editable.textContent = newVal || '';
        if (newVal !== currentValue) {
            if (item._new) {
                const ne = dictNewEntries.find(x => x.tag === (field === 'tag' ? currentValue : item.tag));
                if (ne) {
                    ne[field] = newVal;
                    ne._lastModified = Date.now();
                }
            } else {
                const key = item._key || item.tag;
                if (!dictOverlay[key]) dictOverlay[key] = {};
                dictOverlay[key][field] = newVal;
                dictOverlay[key]._lastModified = Date.now();
            }
            saveDictOverlay();
            rebuildAndRender();
        }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = currentValue; input.blur(); }
    });
});

function rebuildAndRender() {
    buildMergedView();
    buildSearchIndex();
    filterDict(dictCurrentQuery);
}

// --- Custom prompt (native prompt() is blocked in extension pages) ---
function customPrompt(title, placeholder = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('promptModal');
        const input = document.getElementById('promptInput');
        const okBtn = document.getElementById('promptOkBtn');
        const cancelBtn = document.getElementById('promptCancelBtn');
        document.getElementById('promptTitle').textContent = title;
        input.value = '';
        input.placeholder = placeholder;
        modal.classList.add('show');
        input.focus();

        const cleanup = () => {
            modal.classList.remove('show');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
            modal.removeEventListener('click', onBg);
        };
        const onOk = () => { cleanup(); resolve(input.value); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKey = (e) => {
            if (e.key === 'Enter') onOk();
            if (e.key === 'Escape') onCancel();
        };
        const onBg = (e) => { if (e.target === modal) onCancel(); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
        modal.addEventListener('click', onBg);
    });
}

dictAddBtn.addEventListener('click', async () => {
    const tag = await customPrompt('输入新 Tag 名称', '例如: blue_sky');
    if (!tag || !tag.trim()) return;
    const canonicalTag = groupTagsDataUtils.toCanonicalTagKey ? groupTagsDataUtils.toCanonicalTagKey(tag) : tag.trim();
    if (dictMergedView.some(d => d.tag === canonicalTag)) { showToast('该 Tag 已存在', 'error'); return; }
    dictNewEntries.push({ tag: canonicalTag, color: 0, count: 0, aliases: '', zhCN: '', _new: true });
    saveDictOverlay();
    rebuildAndRender();
    showToast('已添加: ' + canonicalTag, 'success');
});

dictExportBtn.addEventListener('click', () => {
    if (!dictMergedView.length) { showToast('无数据可导出', 'error'); return; }
    const lines = dictMergedView.map(item => {
        const alias = item.aliases.includes(',') ? `"${item.aliases}"` : item.aliases;
        return `${item.tag},${item.color},${item.count},${alias},${item.zhCN}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dictionary_merged.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${lines.length.toLocaleString()} 条`, 'success');
});

dictImportBtn.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv';
    inp.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const lines = text.split('\n');
        let count = 0;
        for (const line of lines) {
            const l = line.trim();
            if (!l) continue;
            const parts = parseCSVLine(l);
            const tag = groupTagsDataUtils.toCanonicalTagKey ? groupTagsDataUtils.toCanonicalTagKey(parts[0]) : parts[0];
            if (!tag) continue;
            const existing = dictBaseData.find(d => d.tag === tag);
            if (existing) {
                dictOverlay[tag] = {
                    color: parseInt(parts[1]) || existing.color,
                    count: parseInt(parts[2]) || existing.count,
                    aliases: parts[3] !== undefined ? parts[3] : existing.aliases,
                    zhCN: parts[4] !== undefined ? parts[4] : existing.zhCN,
                };
            } else {
                dictNewEntries.push({
                    tag, color: parseInt(parts[1]) || 0, count: parseInt(parts[2]) || 0,
                    aliases: parts[3] || '', zhCN: parts[4] || '', _new: true
                });
            }
            count++;
        }
        await saveDictOverlay();
        rebuildAndRender();
        showToast(`已导入 ${count} 条记录`, 'success');
    };
    inp.click();
});

/* dictChangesBtn.addEventListener('click', () => {
    const changes = [];
    // 1. New Entries
    dictNewEntries.forEach(item => {
        if (!item._deleted) changes.push({ type: 'new', item });
    });
    // 2. Modified / Deleted in Base
    // Iterate base data once to match overlay keys (O(N) is fast enough for 150k)
    for (const base of dictBaseData) {
        if (dictOverlay[base.tag]) {
            const ov = dictOverlay[base.tag];
            if (ov._deleted) {
                changes.push({ type: 'del', item: base });
            } else {
                changes.push({ type: 'mod', original: base, current: { ...base, ...ov } });
            }
        }
    }

    if (changes.length === 0) {
        dictChangesList.innerHTML = '<div style="text-align:center; color:#666; padding:20px;">暂无修改</div>';
    } else {
        dictChangesList.innerHTML = changes.map(c => {
            if (c.type === 'new') {
                return `
                <div style="padding:8px; border-bottom:1px solid #3a3a55;">
                    <span style="background:rgba(34,197,94,0.2); color:#86efac; padding:2px 6px; border-radius:4px; font-size:0.75em; margin-right:6px;">新增</span>
                    <span style="color:#e0e0f0; font-weight:bold;">${escHtml(c.item.tag)}</span>
                    <div style="font-size:0.8em; color:#aaa; margin-top:4px;">
                        CN: ${escHtml(c.item.zhCN)} | Alias: ${escHtml(c.item.aliases)} | Color: ${c.item.color}
                    </div>
                </div>`;
            } else if (c.type === 'del') {
                return `
                <div style="padding:8px; border-bottom:1px solid #3a3a55;">
                    <span style="background:rgba(239,68,68,0.2); color:#fca5a5; padding:2px 6px; border-radius:4px; font-size:0.75em; margin-right:6px;">删除</span>
                    <span style="color:#e0e0f0; text-decoration:line-through;">${escHtml(c.item.tag)}</span>
                    <div style="font-size:0.8em; color:#666;">
                        CN: ${escHtml(c.item.zhCN)}
                    </div>
                </div>`;
            } else {
                // Modified
                const o = c.original;
                const n = c.current;
                const changesTxt = [];
                if (o.tag !== n.tag) changesTxt.push(`<span style="color:#fcd34d">Tag: ${escHtml(o.tag)} → ${escHtml(n.tag)}</span>`);
                if (o.zhCN !== n.zhCN) changesTxt.push(`CN: ${escHtml(o.zhCN)} → ${escHtml(n.zhCN)}`);
                if (o.aliases !== n.aliases) changesTxt.push(`Alias: ${escHtml(o.aliases)} → ${escHtml(n.aliases)}`);
                if (o.color !== n.color) changesTxt.push(`Color: ${o.color} → ${n.color}`);
                if (o.count !== n.count) changesTxt.push(`Count: ${o.count} → ${n.count}`);

                return `
                <div style="padding:8px; border-bottom:1px solid #3a3a55;">
                    <span style="background:rgba(234,179,8,0.2); color:#fde047; padding:2px 6px; border-radius:4px; font-size:0.75em; margin-right:6px;">修改</span>
                    <span style="color:#e0e0f0; font-weight:bold;">${escHtml(n.tag)}</span>
                    <div style="font-size:0.8em; color:#aaa; margin-top:4px;">
                        ${changesTxt.join('<br>')}
                    </div>
                </div>`;
            }
        }).join('');
    }
    dictChangesModal.classList.add('show');
}); */

dictToggleChangesBtn.addEventListener('click', () => {
    dictShowChanges = !dictShowChanges;
    if (dictShowChanges) {
        dictToggleChangesBtn.classList.add('btn-primary');
    } else {
        dictToggleChangesBtn.classList.remove('btn-primary');
    }
    filterDict(dictSearch.value);
});



dictResetBtn.addEventListener('click', async () => {
    if (!await customConfirm('确认重置所有修改？将恢复为原始 CSV 数据。')) return;
    dictOverlay = {};
    dictNewEntries = [];
    await saveDictOverlay();
    rebuildAndRender();
    showToast('已重置所有修改', 'success');
});

let dictSearchTimer = null;
dictSearch.addEventListener('input', () => {
    clearTimeout(dictSearchTimer);
    dictSearchTimer = setTimeout(() => filterDict(dictSearch.value), 150);
});

dictFilterType.addEventListener('change', () => {
    filterDict(dictSearch.value);
});

dictViewport.addEventListener('scroll', () => renderVirtualGrid());

const dictResizeObs = new ResizeObserver(() => {
    if (dictLoaded && dictView.classList.contains('active')) {
        recalcGrid();
        dictLastStartRow = -1;
        renderVirtualGrid();
    }
});
dictResizeObs.observe(dictViewport);

function updateDictStatus() {
    const total = dictMergedView.length;
    const filtered = dictFilteredIndices.length;
    const modCount = Object.keys(dictOverlay).length + dictNewEntries.length;
    dictStatTotal.textContent = dictCurrentQuery
        ? `已筛选 ${filtered.toLocaleString()} / 共 ${total.toLocaleString()} 条`
        : `共 ${total.toLocaleString()} 条`;
    dictStatModified.textContent = modCount > 0 ? `已修改 ${modCount} 条` : '';
    dictStatModified.className = modCount > 0 ? 'stat-modified' : '';
}

// ============================
// Section 13: View Switching
// ============================
const syncViewEls = {
    main: document.querySelector('.main'),
    bottomResize: document.getElementById('resizeHandleBottom'),
    bottomPanel: document.getElementById('bottomPanel'),
};

viewSwitcher.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.classList.contains('active')) return;
    viewSwitcher.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if (view === 'dict') {
        syncViewEls.main.style.display = 'none';
        syncViewEls.bottomResize.style.display = 'none';
        syncViewEls.bottomPanel.style.display = 'none';
        syncActions.style.display = 'none';
        dictView.classList.add('active');
        if (!dictLoaded) await loadDictForEditor();
        recalcGrid();
        dictLastStartRow = -1;
        renderVirtualGrid();
    } else {
        syncViewEls.main.style.display = '';
        syncViewEls.bottomResize.style.display = '';
        syncViewEls.bottomPanel.style.display = '';
        syncActions.style.display = '';
        dictView.classList.remove('active');
    }
});

// ============================
// Section 14: Initialization
// ============================
async function init() {
    log('初始化...', 'info');
    if (typeof chrome === 'undefined' || typeof chrome.storage === 'undefined') {
        log('错误: Chrome API 不可用', 'error');
        statusText.textContent = 'Chrome API 不可用';
        linkBtn.disabled = true;
        return;
    }
    if (typeof window.showDirectoryPicker !== 'function') {
        log('错误: File System Access API 不可用', 'error');
        statusText.textContent = 'API 不可用';
        linkBtn.disabled = true;
        return;
    }

    await loadSnapshotSettings();

    // Restore bound directory
    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle)) {
            updateTopUI(handle.name);
            log(`已恢复绑定: ${handle.name}`, 'success');
        } else {
            updateTopUI(null);
            log('未绑定文件夹', 'info');
        }
    } catch (e) {
        log(`初始化错误: ${e.message}`, 'error');
        updateTopUI(null);
    }
    refreshFileTree();
    await loadDictionary();
    await renderSnapshotList();
    log('初始化完成', 'success');
}

document.addEventListener('DOMContentLoaded', init);
