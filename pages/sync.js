// ============================================================
import { DEFAULT_LANG, getI18nDict, getI18nText } from '../lib/i18n/index.js';
import { localSyncService } from '../lib/LocalSyncService.js';

// 向后台注册心跳长连接，让 popup 等其他组件感知到同步页面已打开
const syncHeartbeat = chrome.runtime.connect({ name: 'sync-heartbeat' });

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
let boundDirHandle = null;
let currentLang = DEFAULT_LANG;
let currentTopUiState = 'unbound';

function getSyncDict() {
    return getI18nDict(currentLang, 'sync');
}

function t(key, fallback = '') {
    return getI18nText(currentLang, 'sync', key, fallback);
}

function tf(key, values = {}, fallback = '') {
    return t(key, fallback).replace(/\{(\w+)\}/g, (_, token) => values[token] ?? '');
}

function resolveDefaultLang() {
    const browserLang = (navigator.language || navigator.userLanguage || DEFAULT_LANG).toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh';
    if (browserLang.startsWith('ja')) return 'jp';
    return DEFAULT_LANG;
}

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

function updateBottomToggleText() {
    toggleBottom.textContent = bottomExpanded ? t('toggle_bottom_collapse') : t('toggle_bottom_expand');
}

function applyStaticTranslations(lang = currentLang) {
    currentLang = lang;
    const dict = getSyncDict();

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) el.textContent = dict[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dict[key]) el.placeholder = dict[key];
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (dict[key]) el.title = dict[key];
    });

    updateBottomToggleText();

    if (typeof updateBatchButtons === 'function') updateBatchButtons();
    if (typeof updateTopUI === 'function') updateTopUI(boundDirHandle?.name || null, currentTopUiState);
    if (editorView) updateLineInfo(editorView.state);
    if (typeof updateDictStatus === 'function') updateDictStatus();
}

async function initI18n() {
    let lang = resolveDefaultLang();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await new Promise(resolve => chrome.storage.local.get('language', resolve));
        if (data.language) lang = data.language;
    }

    applyStaticTranslations(lang);

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.language) {
                applyStaticTranslations(changes.language.newValue || resolveDefaultLang());
            }
        });
    }
}

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

async function verifyPermission(handle, request = true) {
    if (!handle) return false;
    try {
        if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
        if (request && await handle.requestPermission({ mode: 'readwrite' }) === 'granted') return true;
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

    // Auto-cleanup: keep max N auto snapshots
    const autoSnaps = allSnaps.filter(s => s.type === 'auto');
    if (autoSnaps.length >= snapshotSettings.maxSnapshots) {
        const toDelete = autoSnaps.slice(snapshotSettings.maxSnapshots - 1);
        for (const old of toDelete) {
            await deleteSnapshotFull(old.id);
        }
    }

    log(tf('log_snapshot_created', { label, type: t(`snapshot_type_${type}`, type) }), 'success');
    await renderSnapshotList();
    return snapshot;
}

// ============================
// 注册核心引擎的防灾拦截图腾
// 当 LocalSyncService 在对比本地文件发现大面积被删时，触发自动兜底快照
// ============================
localSyncService.registerSnapshotCallback(async (reason, type) => {
    // 转发到底层的快照创建器（它会自动连带存储此时的 wildcards 全貌）
    await createSnapshot(reason, type);
});

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
}

async function restoreSnapshot(id) {
    const snap = await getSnapshot(id);
    if (!snap) return showToast(t('toast_snapshot_missing'), 'error');

    // Auto snapshot before restoring
    await createSnapshot(t('snapshot_label_before_restore'), 'auto');

    await new Promise(r => chrome.storage.local.set({
        wildcards: snap.wildcards,
        wildcardFolders: snap.wildcardFolders
    }, r));

    log(tf('log_snapshot_restored', { label: snap.label }), 'success');
    showToast(t('toast_snapshot_restored'), 'success');
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
                    diffHtml += `<span class="diff-more-tag" title="${tf('snapshot_more_files_title', { count: remaining })}">${tf('snapshot_more_files', { count: remaining })}</span>`;
                }
                diffHtml += '</div>';
            } else {
                diffHtml = `<div class="snapshot-diff-container"><span class="diff-more-tag">${t('snapshot_no_changes')}</span></div>`;
            }
        }

        li.innerHTML = `
            <div class="snapshot-select">
                <input type="checkbox" class="snap-checkbox" data-id="${snap.id}" ${selectedSnapshots.has(snap.id) ? 'checked' : ''}>
            </div>
            <div class="snapshot-content">
                <div class="snapshot-header">
                    <span class="snapshot-time">${time}</span>
                    <span class="snapshot-tag-type ${tagClass}">${t(`snapshot_type_${snap.type}`, snap.type)}</span>
                    <span class="snapshot-label">${snap.label}</span>
                </div>
                ${diffHtml}
            </div>
            <div class="snapshot-actions">
                <button class="btn-sm" data-action="diff" data-id="${snap.id}" title="${t('snapshot_action_compare_title')}">🔍</button>
                <button class="btn-sm btn-success" data-action="restore" data-id="${snap.id}" title="${t('snapshot_action_restore_title')}">↩</button>
                <button class="btn-sm" data-action="export" data-id="${snap.id}" title="${t('snapshot_action_export_json_title')}">💾</button>
                <button class="btn-sm btn-danger" data-action="delete" data-id="${snap.id}" title="${t('snapshot_action_delete_title')}">✕</button>
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
            if (await customConfirm(t('confirm_restore_snapshot'))) {
                await restoreSnapshot(id);
            }
        } else if (action === 'delete') {
            if (snapshotSettings.confirmDelete && !await customConfirm(t('confirm_delete_snapshot'))) return;
            await deleteSnapshotFull(id);
            log(tf('log_snapshot_deleted', { id }), 'info');
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
    batchDeleteBtn.textContent = `${t('batch_delete')}${count ? ` (${count})` : ''}`;
    batchExportBtn.textContent = `${t('batch_export')}${count ? ` (${count})` : ''}`;

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
    log(tf('log_exported_snapshots', { count: ids.length }), 'success');
}

async function deleteSnapshots(ids) {
    if (snapshotSettings.confirmDelete && !await customConfirm(tf('confirm_delete_snapshots', { count: ids.length }))) return;

    let count = 0;
    for (const id of ids) {
        await deleteSnapshotFull(id);
        count++;
    }
    log(tf('log_deleted_snapshots', { count }), 'success');
    selectedSnapshots.clear();
    await renderSnapshotList();
}

async function showDiff(id) {
    const snap = await getSnapshot(id);
    if (!snap) return showToast(t('toast_snapshot_missing'), 'error');

    // Get current data
    const currentData = await new Promise(r => chrome.storage.local.get('wildcards', r));
    const currentWildcards = currentData.wildcards || {};

    // Calculate diff using full content
    const diff = computeDiff(snap.wildcards, currentWildcards);

    diffSummary.innerHTML = `
        <span style="margin-right:10px;">${tf('diff_summary', { label: snap.label })}</span>
        <span class="diff-added">+${diff.added.length}</span>
        <span class="diff-removed">-${diff.removed.length}</span>
        <span class="diff-modified">~${diff.modified.length}</span>
    `;

    diffContainer.innerHTML = '';

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
        diffContainer.textContent = t('diff_identical');
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
                alert(tf('diff_alert_template', { key, oldContent, newContent }));
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

// [已移除] doExport / doImport 已被 LocalSyncService 的实时双向同步完全取代

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
        return showToast(t('toast_move_into_self'), 'warn');
    }

    // New path construction
    const name = oldPath.split('/').pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;

    if (newPath === oldPath) return; // No change

    const moveTypeLabel = t(`move_type_${type}`, type);
    log(tf('log_move_start', { type: moveTypeLabel, oldPath, newPath }), 'info');

    // Perform move logic
    chrome.storage.local.get(['wildcards', 'wildcardFolders'], async data => {
        const wildcards = data.wildcards || {};
        const folders = data.wildcardFolders || [];

        let modified = false;

        if (type === 'file') {
            if (wildcards[newPath]) {
                if (!confirm(tf('confirm_overwrite_file', { key: newPath }))) return;
            }
            // 物理移动
            await localSyncService.moveFile(oldPath + '.txt', newPath + '.txt', wildcards[oldPath]);
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
                    if (wildcards[newK] && !confirm(tf('confirm_overwrite_file', { key: newK }))) conflict = true;
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
                log(tf('log_move_completed', { oldPath, newPath }), 'success');
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
                log(tf('log_move_completed', { oldPath, newPath }), 'success');
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
                <button data-folder-delete="${folderPath}" title="${t('action_delete')}">✕</button>
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
                <button data-file-delete="${file.key}" title="${t('action_delete')}">✕</button>
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
            newItemName.placeholder = tf('placeholder_new_item_in_folder', { folderName: selectedFolder.split('/').pop() });
        } else {
            newItemName.placeholder = t('placeholder_new_item_root');
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
            if (!await customConfirm(tf('confirm_delete_file', { key }))) return;
            chrome.storage.local.get('wildcards', async d => {
                const map = d.wildcards || {};
                delete map[key];
                await localSyncService.deleteFile(key + '.txt');
                chrome.storage.local.set({ wildcards: map }, () => {
                    if (currentFile === key) closeEditor();
                    log(tf('log_file_deleted', { key }), 'info');
                    refreshFileTree();
                });
            });
        });
    });

    fileTree.querySelectorAll('[data-folder-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const folder = btn.dataset.folderDelete;
            if (!await customConfirm(tf('confirm_delete_folder', { folder }))) return;
            chrome.storage.local.get(['wildcards', 'wildcardFolders'], async d => {
                const map = d.wildcards || {};
                const folders = d.wildcardFolders || [];
                const newMap = {};
                Object.keys(map).forEach(k => { if (!k.startsWith(folder + '/')) newMap[k] = map[k]; });
                const newFolders = folders.filter(f => f !== folder && !f.startsWith(folder + '/'));
                await localSyncService.deleteFolder(folder);
                chrome.storage.local.set({ wildcards: newMap, wildcardFolders: newFolders }, () => {
                    if (currentFile && currentFile.startsWith(folder + '/')) closeEditor();
                    expandedFolders.delete(folder);
                    log(tf('log_folder_deleted', { folder }), 'info');
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
                log(tf('log_search_ready', { count }), 'success');
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
            log(t('log_search_error'), 'error');
        };
    } catch (e) {
        log(tf('log_search_start_failed', { message: e.message }), 'error');
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
    lineInfo.textContent = tf('line_info', { line: line.number, total: totalLines });
}

function markModified() {
    if (currentFile) {
        const current = editorView.state.doc.toString();
        if (current !== localContent) {
            saveStatus.textContent = t('save_status_unsaved');
            saveStatus.className = 'modified';
        }
    }
}

function markSaved() {
    saveStatus.textContent = t('save_status_saved');
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
            if (current !== local && !confirm(t('confirm_discard_unsaved'))) return;
        } catch (e) {
            console.error('Check unsaved failed:', e);
            if (!confirm(t('confirm_force_switch'))) return;
        }
    }
    chrome.storage.local.get('wildcards', data => {
        try {
            const map = data.wildcards || {};
            if (!(key in map)) {
                showToast(t('toast_file_missing'), 'error');
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
            log(tf('log_open_file_failed', { message: e.message }), 'error');
            showToast(t('toast_open_file_error'), 'error');
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
    if (!newName) return showToast(t('toast_enter_file_name'), 'error');
    chrome.storage.local.get(['wildcards', 'wildcardFolders'], async data => {
        const map = data.wildcards || {};
        const oldParts = currentFile.split('/');
        oldParts.pop();
        const newKey = oldParts.length > 0 ? `${oldParts.join('/')}/${newName}` : newName;
        if (newKey !== currentFile && map[newKey]) return showToast(tf('toast_file_exists', { name: newKey }), 'error');
        
        // 核心接入：写回物理硬盘
        const writeSuccess = await localSyncService.safeWriteFile(newKey + '.txt', content);
        if (!writeSuccess) {
            return showToast('保存失败或遇到冲突拦截', 'error');
        }

        if (newKey !== currentFile) {
            delete map[currentFile];
            await localSyncService.deleteFile(currentFile + '.txt');
        }
        
        map[newKey] = content;
        localContent = content;
        currentFile = newKey;
        chrome.storage.local.set({ wildcards: map }, () => {
            markSaved();
            log(tf('log_saved', { key: newKey }), 'success');
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
        log(tf('log_dictionary_loaded', { count: autocompleteDict.length }), 'success');

        // Send to worker
        initWorker();
        if (searchWorker) {
            searchWorker.postMessage({ type: 'init', payload: autocompleteDict });
        }
    } catch (e) {
        log(tf('log_dictionary_failed', { message: e.message }), 'error');
        autocompleteDict = [];
    }
}

// ============================
// Section 10: UI Setup & Events
// ============================
function updateTopUI(dirName, state = dirName ? 'bound' : 'unbound') {
    currentTopUiState = state;

    if (state === 'bound' && dirName) {
        statusText.textContent = tf('status_bound', { dirName });
        statusText.classList.add('linked');
        linkBtn.style.display = 'none';
        linkBtn.textContent = t('action_bind_folder');
        unlinkBtn.style.display = '';
        exportBtn.style.display = 'none';
        importBtn.style.display = '';
        importBtn.textContent = '🔄 从本地加载/刷新';
        snapshotBtn.style.display = '';
        return;
    }

    if (state === 'reauthorize' && dirName) {
        statusText.textContent = tf('status_reauthorize', { dirName });
        statusText.classList.remove('linked');
        linkBtn.style.display = '';
        linkBtn.textContent = t('action_reauthorize_folder');
        unlinkBtn.style.display = '';
        exportBtn.style.display = 'none';
        importBtn.style.display = 'none';
        snapshotBtn.style.display = 'none';
        return;
    }

    statusText.textContent = t('status_unbound');
    statusText.classList.remove('linked');
    linkBtn.style.display = '';
    linkBtn.textContent = t('action_bind_folder');
    unlinkBtn.style.display = 'none';
    exportBtn.style.display = 'none';
    importBtn.style.display = 'none';
    snapshotBtn.style.display = 'none';
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
    if (bottomExpanded) {
        bottomPanel.classList.remove('collapsed');
    } else {
        bottomPanel.classList.add('collapsed');
    }
    updateBottomToggleText();
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
        if (!bottomExpanded) {
            bottomExpanded = true;
            bottomContent.style.display = '';
            bottomPanel.classList.remove('collapsed');
            updateBottomToggleText();
        }
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
    if (!name) return showToast(t('toast_enter_file_name'), 'error');

    // Handle creation in selected folder
    const fullName = selectedFolder ? `${selectedFolder}/${name}` : name;

    chrome.storage.local.get('wildcards', async data => {
        const map = data.wildcards || {};
        if (map[fullName]) return showToast(tf('toast_file_exists', { name: fullName }), 'error');
        map[fullName] = '';
        await localSyncService.safeWriteFile(fullName + '.txt', '');
        chrome.storage.local.set({ wildcards: map }, () => {
            newItemName.value = '';
            log(tf('log_created_file', { key: fullName }), 'info');
            refreshFileTree();
            openFile(fullName);
        });
    });
});

newFolderBtn.addEventListener('click', () => {
    let raw = newItemName.value.trim();
    let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');
    if (!name) return showToast(t('toast_enter_folder_name'), 'error');

    // Handle creation in selected folder
    const fullName = selectedFolder ? `${selectedFolder}/${name}` : name;

    chrome.storage.local.get('wildcardFolders', data => {
        const folders = data.wildcardFolders || [];
        if (folders.includes(fullName)) return showToast(tf('toast_folder_exists', { name: fullName }), 'error');
        folders.push(fullName);
        chrome.storage.local.set({ wildcardFolders: folders }, () => {
            newItemName.value = '';
            expandedFolders.add(fullName);
            log(tf('log_created_folder', { folder: fullName }), 'info');
            refreshFileTree();
        });
    });
});

linkBtn.addEventListener('click', async () => {
    try {
        if (boundDirHandle) {
            if (await verifyPermission(boundDirHandle, true)) {
                updateTopUI(boundDirHandle.name, 'bound');
                log(tf('log_reauthorized', { dirName: boundDirHandle.name }), 'success');
            } else {
                updateTopUI(boundDirHandle.name, 'reauthorize');
                log(tf('log_reauthorize_failed', { dirName: boundDirHandle.name }), 'error');
            }
            return;
        }

        const dirHandle = await window.showDirectoryPicker();
        await saveDirHandle(dirHandle);
        boundDirHandle = dirHandle;
        localSyncService.init(boundDirHandle);
        updateTopUI(dirHandle.name, 'bound');
        log(tf('log_bound', { dirName: dirHandle.name }), 'success');
    } catch (e) {
        if (e.name === 'AbortError') log(t('log_user_cancelled'), 'info');
        else log(tf('log_bind_failed', { message: e.message }), 'error');
    }
});

unlinkBtn.addEventListener('click', async () => {
    await removeDirHandle();
    boundDirHandle = null;
    localSyncService.clear();
    updateTopUI(null, 'unbound');
    log(t('log_unbound'), 'info');
});

exportBtn.addEventListener('click', async () => {
    showToast('该功能已被实时双向同步取代', 'info');
});

importBtn.addEventListener('click', async () => {
    if (!await customConfirm(t('confirm_import_overwrite'))) return;
    importBtn.disabled = true;
    try { 
        log('开始基于本地文件更新...', 'info');
        await createSnapshot(t('snapshot_label_before_import'), 'auto');
        const hasChanges = await localSyncService.scanAndPullChanges(); 
        if (hasChanges) refreshFileTree();
        log('成功基于本地文件更新', 'success');
        showToast('从本地加载成功', 'success');
    }
    catch (e) { log(tf('log_import_failed', { message: e.message }), 'error'); showToast(t('toast_import_failed'), 'error'); }
    finally { importBtn.disabled = false; }
});

snapshotBtn.addEventListener('click', async () => {
    await createSnapshot(t('snapshot_label_manual'), 'manual');
    showToast(t('toast_manual_snapshot_created'), 'success');
});

saveBtn.addEventListener('click', saveCurrentFile);
reloadFileBtn.addEventListener('click', () => { if (currentFile) openFile(currentFile); });
dismissBannerBtn.addEventListener('click', () => { extChangeBanner.classList.remove('show'); });

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    // 同步资源树 UI 与通配符
    if (changes.wildcards || changes.wildcardFolders) {
        refreshFileTree();
        if (currentFile && changes.wildcards) {
            const newData = changes.wildcards.newValue || {};
            if (currentFile in newData) {
                const externalContent = newData[currentFile];
                const editorContent = editorView ? editorView.state.doc.toString() : '';
                
                const normalize = s => (s || '').replace(/\r\n/g, '\n');
                
                // 如果外部内容和编辑器内不一样 (忽略换行符差异)
                if (normalize(externalContent) !== normalize(editorContent)) {
                    if (normalize(editorContent) === normalize(localContent)) {
                        // 且用户在扩展内并未进行任何改动（编辑器是干净的/与上次保存一致），则直接安全覆盖刷新
                        openFile(currentFile);
                        showToast(`文件 ${currentFile} 已自动从本地同步最新内容`, 'info');
                        extChangeBanner.classList.remove('show');
                    } else {
                        // 用户敲了字但没保存，弹窗警告避免丢字
                        extChangeBanner.classList.add('show');
                    }
                }
            } else {
                showToast(t('toast_current_file_deleted'), 'error');
                closeEditor();
            }
        }
    }

    // JSON 资源实体变更写回物理环境
    if (boundDirHandle && !localSyncService.isSyncing) {
        const trySyncJson = async (fileName, dataObj) => {
            if (!dataObj) return;
            const dataStr = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj, null, 2);
            const ok = await localSyncService.safeWriteFile(fileName, dataStr);
            if (!ok) showToast(`【安全网】写入 ${fileName} 失败，本地已有新版本，请自顶部刷新`, 'error');
        };

        if (changes.promptHistory) trySyncJson('favorites.json', changes.promptHistory.newValue);
        if (changes.groupTagsUserData) trySyncJson('group_tags.json', changes.groupTagsUserData.newValue);
        if (changes.dictOverlay) trySyncJson('user_dict.json', changes.dictOverlay.newValue);
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
    if (isNaN(max) || max < 1) return showToast(t('toast_enter_valid_number'), 'error');

    snapshotSettings.maxSnapshots = max;
    snapshotSettings.confirmDelete = settingConfirmDelete.checked;
    await saveSnapshotSettings();
    showToast(t('toast_settings_saved'), 'success');
    snapSettingsModal.classList.remove('show');
});

closeSnapSettingsBtn.addEventListener('click', () => snapSettingsModal.classList.remove('show'));

// Diff Modal Events
closeDiffBtn.addEventListener('click', () => diffModal.classList.remove('show'));
// Close modals on outside click
window.addEventListener('click', (e) => {
    if (e.target === snapSettingsModal) snapSettingsModal.classList.remove('show');
    if (e.target === diffModal) diffModal.classList.remove('show');
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
        log(tf('log_dict_editor_loaded', { count: dictBaseData.length.toLocaleString(), seconds: dt }), 'success');
    } catch (e) {
        log(tf('log_dict_editor_failed', { message: e.message }), 'error');
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
        ? `<button data-action="restore" title="${t('action_restore')}" style="color:#4ade80">↺</button>`
        : `<button data-action="delete" title="${t('action_delete')}">✕</button>`;

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
    const tag = await customPrompt(t('prompt_new_tag_title'), t('prompt_new_tag_placeholder'));
    if (!tag || !tag.trim()) return;
    const canonicalTag = groupTagsDataUtils.toCanonicalTagKey ? groupTagsDataUtils.toCanonicalTagKey(tag) : tag.trim();
    if (dictMergedView.some(d => d.tag === canonicalTag)) { showToast(t('toast_tag_exists'), 'error'); return; }
    dictNewEntries.push({ tag: canonicalTag, color: 0, count: 0, aliases: '', zhCN: '', _new: true });
    saveDictOverlay();
    rebuildAndRender();
    showToast(tf('toast_tag_added', { tag: canonicalTag }), 'success');
});

dictExportBtn.addEventListener('click', () => {
    if (!dictMergedView.length) { showToast(t('toast_no_data_to_export'), 'error'); return; }
    const escapeCsv = (str) => {
        if (typeof str !== 'string') return str;
        return /[,"\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const lines = dictMergedView.map(item => {
        return `${escapeCsv(item.tag)},${item.color},${item.count},${escapeCsv(item.aliases)},${escapeCsv(item.zhCN)}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dictionary_merged.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast(tf('toast_dict_exported', { count: lines.length.toLocaleString() }), 'success');
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
        showToast(tf('toast_dict_imported', { count }), 'success');
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
    if (!await customConfirm(t('confirm_reset_dict_changes'))) return;
    dictOverlay = {};
    dictNewEntries = [];
    await saveDictOverlay();
    rebuildAndRender();
    showToast(t('toast_dict_reset'), 'success');
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
        ? tf('dict_stat_total_filtered', { filtered: filtered.toLocaleString(), total: total.toLocaleString() })
        : tf('dict_stat_total_all', { total: total.toLocaleString() });
    dictStatModified.textContent = modCount > 0 ? tf('dict_stat_modified', { count: modCount }) : '';
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
    await initI18n();
    log(t('log_initializing'), 'info');
    if (typeof chrome === 'undefined' || typeof chrome.storage === 'undefined') {
        log(t('log_error_chrome_api'), 'error');
        statusText.textContent = t('status_chrome_api_unavailable');
        linkBtn.disabled = true;
        return;
    }
    if (typeof window.showDirectoryPicker !== 'function') {
        log(t('log_error_fs_api'), 'error');
        statusText.textContent = t('status_fs_api_unavailable');
        linkBtn.disabled = true;
        return;
    }

    await loadSnapshotSettings();

    // Restore bound directory
    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle, false)) {
            boundDirHandle = handle;
            localSyncService.init(handle);
            updateTopUI(handle.name, 'bound');
            log(tf('log_restored_bound', { dirName: handle.name }), 'success');
            
            // 初始化安全拉取，保证用户刷新 F5 时能读取到外部最新修改
            localSyncService.scanAndPullChanges({ silent: true }).then(hasChanges => {
                if (hasChanges) refreshFileTree();
            });
            
        } else if (handle) {
            boundDirHandle = handle;
            updateTopUI(handle.name, 'reauthorize');
            log(tf('log_restored_waiting_reauth', { dirName: handle.name }), 'info');
        } else {
            boundDirHandle = null;
            updateTopUI(null, 'unbound');
            log(t('log_no_folder_bound'), 'info');
        }
    } catch (e) {
        log(tf('log_init_error', { message: e.message }), 'error');
        boundDirHandle = null;
        updateTopUI(null, 'unbound');
    }
    refreshFileTree();
    await loadDictionary();
    await renderSnapshotList();
    log(t('log_init_complete'), 'success');
}

document.addEventListener('DOMContentLoaded', init);

// 生命周期：当用户切回浏览器窗口时，静默自本地拉取更新
window.addEventListener('focus', async () => {
    if (boundDirHandle && !localSyncService.isSyncing && currentTopUiState === 'bound') {
        const hasChanges = await localSyncService.scanAndPullChanges({ silent: true });
        if (hasChanges) {
            refreshFileTree();
            // 注意：如果有已经被打开的文件发生了更新，chrome.storage.onChanged 会接到通知并显示更新 Banner
        }
    }
});
