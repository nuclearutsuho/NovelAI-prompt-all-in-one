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
let autocompleteMetaMap = new Map();
const groupTagsDataUtils = window.GroupTagsDataUtils || {};
let expandedFolders = new Set(); // track expanded folders in tree
let selectedFolder = null;    // currently selected folder for creation
let draggedItem = null;       // item being dragged
let snapshotSettings = { maxSnapshots: 20, confirmDelete: true, debounceTime: 10 };
let selectedSnapshots = new Set();
let boundDirHandle = null;
let currentLang = DEFAULT_LANG;
let currentTopUiState = 'unbound';
let organizerVisible = true;
let organizerRefreshTimer = null;
let organizerPinnedSaveTimer = null;
let organizerPinnedItemsCache = [];
let organizerCommonCategoryKey = 'artists';
let organizerGroupTagsCategoryKey = '';
let organizerGroupTagsGroupKey = '';
let organizerGroupTagsTagSet = new Set();
let organizerGroupTagsMembershipMap = new Map();
let organizerGroupTagsTranslationMap = new Map();
let organizerGroupTagsLoaded = false;
let organizerGroupTagsLoadError = false;
let organizerGroupTagsLoadPromise = null;
let organizerAnalysisCache = {
    dirty: true,
    model: null,
    candidates: null,
    sortedEntries: new Map()
};
let organizerPendingRefresh = {
    analysis: false,
    candidates: false,
    list: false,
    summary: false
};
let organizerListRenderState = {
    entries: [],
    renderedCount: 0,
    highlightRegex: null,
    version: 0
};
let organizerListChunkFrame = 0;
let organizerPinDrawerHeight = 280;
let organizerLargeFileState = {
    active: false,
    lineCount: 0
};
const ORGANIZER_PIN_DRAWER_DEFAULT_HEIGHT = 280;
const ORGANIZER_PIN_DRAWER_MIN_HEIGHT = 150;
const ORGANIZER_PANEL_BOTTOM_MIN_HEIGHT = 180;
const ORGANIZER_LIST_CHUNK_SIZE = 240;
const ORGANIZER_LIST_CHUNK_THRESHOLD = 320;
const ORGANIZER_LARGE_FILE_THRESHOLD = 5000;
// 资产状态管理 (用于顶栏看板)
const assetMetadata = {
    wildcards: { count: 0, lastSync: 0 },
    favorites: { count: 0, lastSync: 0 },
    grouptags: { count: 0, lastSync: 0 },
    userdict: { count: 0, lastSync: 0 }
};

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
const editorWorkspace = document.getElementById('editorWorkspace');
const editorContainer = document.getElementById('editorContainer');
const editorStatusbar = document.getElementById('editorStatusbar');
const fileNameInput = document.getElementById('fileNameInput');
const saveBtn = document.getElementById('saveBtn');
const discardChangesBtn = document.getElementById('discardChangesBtn');
const toggleOrganizerBtn = document.getElementById('toggleOrganizerBtn');
const lineInfo = document.getElementById('lineInfo');
const saveStatus = document.getElementById('saveStatus');
const organizerPanel = document.getElementById('organizerPanel');
const organizerSortMode = document.getElementById('organizerSortMode');
const organizerSearch = document.getElementById('organizerSearch');
const organizerSummary = document.getElementById('organizerSummary');
const organizerList = document.getElementById('organizerList');
const applyOrganizerSortBtn = document.getElementById('applyOrganizerSortBtn');
const dedupeOrganizerBtn = document.getElementById('dedupeOrganizerBtn');
const normalizeOrganizerBtn = document.getElementById('normalizeOrganizerBtn');
const organizerPinnedInput = document.getElementById('organizerPinnedInput');
const addOrganizerPinnedBtn = document.getElementById('addOrganizerPinnedBtn');
const organizerCommonTags = document.getElementById('organizerCommonTags');
const organizerCommonCategories = document.getElementById('organizerCommonCategories');
const organizerPinnedList = document.getElementById('organizerPinnedList');
const organizerPriorityStatus = document.getElementById('organizerPriorityStatus');
const applyOrganizerPriorityBtn = document.getElementById('applyOrganizerPriorityBtn');
const organizerPinResizeHandle = document.getElementById('organizerPinResizeHandle');
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

// Sync Settings UI (Scheme 2 Popover)
const syncSettingsBtn = document.getElementById('syncSettingsBtn');
const syncQuickPopover = document.getElementById('syncQuickPopover');
const settingSyncDebounceRange = document.getElementById('settingSyncDebounceRange');
const settingSyncDebounceInput = document.getElementById('settingSyncDebounceInput');

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
                    diffHtml += `<span class="diff-file-tag ${item.type}" title="${escapeHtml(item.name)}">${item.icon} ${escapeHtml(dispName)}</span>`;
                });
                if (remaining > 0) {
                    diffHtml += `<span class="diff-more-tag" title="${escapeHtml(tf('snapshot_more_files_title', { count: remaining }))}">${escapeHtml(tf('snapshot_more_files', { count: remaining }))}</span>`;
                }
                diffHtml += '</div>';
            } else {
                diffHtml = `<div class="snapshot-diff-container"><span class="diff-more-tag">${escapeHtml(t('snapshot_no_changes'))}</span></div>`;
            }
        }

        const snapshotId = escapeHtml(String(snap.id || ''));

        li.innerHTML = `
            <div class="snapshot-select">
                <input type="checkbox" class="snap-checkbox" data-id="${snapshotId}" ${selectedSnapshots.has(snap.id) ? 'checked' : ''}>
            </div>
            <div class="snapshot-content">
                <div class="snapshot-header">
                    <span class="snapshot-time">${escapeHtml(time)}</span>
                    <span class="snapshot-tag-type ${tagClass}">${escapeHtml(t(`snapshot_type_${snap.type}`, snap.type))}</span>
                    <span class="snapshot-label">${escapeHtml(snap.label || '')}</span>
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
            <span class="name">${escapeHtml(folderName)}</span>
            <div class="actions">
                <button data-folder-delete="${escapeHtml(folderPath)}" title="${escapeHtml(t('action_delete'))}">✕</button>
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
            <span class="name">${escapeHtml(file.name)}</span>
            <div class="actions">
                <button data-file-delete="${escapeHtml(file.key)}" title="${escapeHtml(t('action_delete'))}">✕</button>
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
// Section 8: Wildcard Organizer
// ============================
function escapeHtml(value = '') {
    const el = document.createElement('div');
    el.textContent = value;
    return el.innerHTML;
}

function normalizeOrganizerLine(line = '') {
    return String(line || '')
        .trim()
        .replace(/\s*,\s*/g, ', ')
        .replace(/[ \t]{2,}/g, ' ');
}

function createOrganizerPinnedItem(value = '', type = 'exact') {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return null;
    const normalizedType = type === 'prefix' ? 'prefix' : 'exact';
    const normalizedMatchValue = normalizedType === 'exact' && groupTagsDataUtils.normalizeTagKey
        ? groupTagsDataUtils.normalizeTagKey(normalizedValue)
        : normalizedValue.toLocaleLowerCase();
    return {
        type: normalizedType,
        value: normalizedValue,
        normalizedValue: normalizedMatchValue
    };
}

function inferPinnedItemType(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (normalized.endsWith(':') || normalized.endsWith('_')) return 'prefix';
    return 'exact';
}

function serializePinnedItems(items = []) {
    return JSON.stringify((items || []).map(item => ({
        type: item.type === 'prefix' ? 'prefix' : 'exact',
        value: String(item.value || '').trim()
    })));
}

function parsePinnedItems(raw = '[]') {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(item => createOrganizerPinnedItem(item?.value, item?.type))
            .filter(Boolean);
    } catch (error) {
        console.warn('parsePinnedItems failed:', error);
        return [];
    }
}

function scheduleSaveOrganizerPinnedItems() {
    if (organizerPinnedSaveTimer) clearTimeout(organizerPinnedSaveTimer);
    organizerPinnedSaveTimer = setTimeout(async () => {
        organizerPinnedSaveTimer = null;
        try {
            await new Promise(resolve => chrome.storage.local.set({
                organizerPinnedItems: serializePinnedItems(organizerPinnedItemsCache)
            }, resolve));
        } catch (error) {
            console.warn('saveOrganizerPinnedItems failed:', error);
        }
    }, 200);
}

async function loadOrganizerPriorityRules() {
    try {
        const data = await new Promise(resolve => chrome.storage.local.get('organizerPinnedItems', resolve));
        if (typeof data.organizerPinnedItems === 'string') {
            organizerPinnedItemsCache = parsePinnedItems(data.organizerPinnedItems);
        }
    } catch (error) {
        console.warn('loadOrganizerPinnedItems failed:', error);
    }
    renderOrganizerPinnedList();
    updateOrganizerPriorityStatus();
}

function updateOrganizerPriorityStatus() {
    if (!organizerPriorityStatus) return;
    if (!organizerPinnedItemsCache.length) {
        organizerPriorityStatus.textContent = '已置顶 0';
        return;
    }
    organizerPriorityStatus.textContent = `已置顶 ${organizerPinnedItemsCache.length}`;
}

function renderOrganizerPinnedList() {
    if (!organizerPinnedList) return;

    if (!organizerPinnedItemsCache.length) {
        organizerPinnedList.innerHTML = '<div class="organizer-rule-empty">还没有置顶项。点击上方候选，或手动输入后加入。</div>';
        return;
    }

    organizerPinnedList.innerHTML = organizerPinnedItemsCache.map((item, index) => `
        <div class="organizer-pinned-card" data-index="${index}" draggable="true">
            <div class="organizer-pinned-content">
                <span class="organizer-pinned-kind">${item.type === 'prefix' ? '前缀' : 'Tag'}</span>
                <span class="organizer-pinned-label">${escapeHtml(item.value)}</span>
            </div>
            <button type="button" class="pin-remove-btn" data-action="remove" title="删除">✕</button>
        </div>
    `).join('');
}

function findOrganizerPinnedItemIndex(value = '', type = inferPinnedItemType(value)) {
    const item = createOrganizerPinnedItem(value, type);
    if (!item) return -1;

    return organizerPinnedItemsCache.findIndex(existing =>
        existing.type === item.type && existing.normalizedValue === item.normalizedValue
    );
}

function addOrganizerPinnedItem(value = '', type = inferPinnedItemType(value)) {
    const item = createOrganizerPinnedItem(value, type);
    if (!item) return false;

    if (findOrganizerPinnedItemIndex(item.value, item.type) !== -1) return false;

    organizerPinnedItemsCache.push(item);
    renderOrganizerPinnedList();
    updateOrganizerPriorityStatus();
    scheduleSaveOrganizerPinnedItems();
    return true;
}

function removeOrganizerPinnedItem(value = '', type = inferPinnedItemType(value)) {
    const index = findOrganizerPinnedItemIndex(value, type);
    if (index === -1) return false;

    organizerPinnedItemsCache.splice(index, 1);
    renderOrganizerPinnedList();
    updateOrganizerPriorityStatus();
    scheduleSaveOrganizerPinnedItems();
    return true;
}

function toggleOrganizerPinnedItem(value = '', type = inferPinnedItemType(value)) {
    if (findOrganizerPinnedItemIndex(value, type) !== -1) {
        removeOrganizerPinnedItem(value, type);
        return 'removed';
    }

    return addOrganizerPinnedItem(value, type) ? 'added' : 'noop';
}

function isOrganizerWrappedToken(text = '', left = '(', right = ')') {
    if (!text.startsWith(left) || !text.endsWith(right)) return false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === left) depth++;
        if (char === right) {
            depth--;
            if (depth === 0 && i < text.length - 1) return false;
        }
    }
    return depth === 0;
}

function splitOrganizerTags(line = '') {
    const parts = [];
    let current = '';
    let roundDepth = 0;
    let squareDepth = 0;
    let braceDepth = 0;

    for (const char of String(line || '')) {
        if (char === ',' && roundDepth === 0 && squareDepth === 0 && braceDepth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }

        current += char;
        if (char === '(') roundDepth++;
        else if (char === ')') roundDepth = Math.max(0, roundDepth - 1);
        else if (char === '[') squareDepth++;
        else if (char === ']') squareDepth = Math.max(0, squareDepth - 1);
        else if (char === '{') braceDepth++;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
}

function stripNovelAiWeightWrapper(token = '') {
    let current = String(token || '').trim();
    let extractedWeight = 1;
    let hasExplicitWeight = false;
    let changed = true;

    while (changed) {
        changed = false;

        const weightedMatch = current.match(/^([+-]?\d+(?:\.\d+)?)::([\s\S]*?)::$/);
        if (weightedMatch) {
            current = weightedMatch[2].trim();
            if (!hasExplicitWeight) {
                extractedWeight = parseFloat(weightedMatch[1]);
                hasExplicitWeight = Number.isFinite(extractedWeight);
                if (!hasExplicitWeight) extractedWeight = 1;
            }
            changed = true;
        }
    }

    return {
        text: current,
        weight: extractedWeight,
        hasExplicitWeight
    };
}

function getOrganizerWrapperWeight(wrapperType = '') {
    switch (wrapperType) {
        case 'curly':
            return 1.1;
        case 'paren':
            return 1.05;
        case 'square':
            return 0.9;
        default:
            return 1;
    }
}

function getOrganizerDictionaryMetaByTag(tag = '') {
    const normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized) return null;

    const directMeta = autocompleteMetaMap.get(normalized) || null;
    if (directMeta) return directMeta;

    const canonicalKey = groupTagsDataUtils.normalizeTagKey
        ? groupTagsDataUtils.normalizeTagKey(normalized)
        : normalized;
    if (canonicalKey && canonicalKey !== normalized) {
        return autocompleteMetaMap.get(canonicalKey) || null;
    }

    return null;
}

function canonicalizeOrganizerTagByDictionary(tag = '') {
    const normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized) return '';

    const prefixedMatchers = [
        { pattern: /^artist:(.+)$/, colorCode: '1' },
        { pattern: /^character:(.+)$/, colorCode: '4' }
    ];

    for (const matcher of prefixedMatchers) {
        const match = normalized.match(matcher.pattern);
        if (!match) continue;
        const bareTag = match[1].trim();
        const bareMeta = getOrganizerDictionaryMetaByTag(bareTag);
        if (bareMeta?.colorCode === matcher.colorCode) return bareTag;
    }

    const canonicalKey = groupTagsDataUtils.normalizeTagKey
        ? groupTagsDataUtils.normalizeTagKey(normalized)
        : normalized;
    if (canonicalKey) return canonicalKey;

    return normalized;
}

function parseOrganizerToken(token = '') {
    let current = String(token || '').trim();
    if (!current) return null;
    let extractedWeight = 1;
    let wrapperWeight = 1;
    const wrappers = [];

    let changed = true;
    while (changed) {
        changed = false;
        const strippedWeight = stripNovelAiWeightWrapper(current);
        current = strippedWeight.text;
        if (strippedWeight.hasExplicitWeight) extractedWeight = strippedWeight.weight;
        if (isOrganizerWrappedToken(current, '{', '}')) {
            current = current.slice(1, -1).trim();
            wrapperWeight *= getOrganizerWrapperWeight('curly');
            wrappers.push('curly');
            changed = true;
        } else if (isOrganizerWrappedToken(current, '(', ')')) {
            current = current.slice(1, -1).trim();
            wrapperWeight *= getOrganizerWrapperWeight('paren');
            wrappers.push('paren');
            changed = true;
        } else if (isOrganizerWrappedToken(current, '[', ']')) {
            current = current.slice(1, -1).trim();
            wrapperWeight *= getOrganizerWrapperWeight('square');
            wrappers.push('square');
            changed = true;
        }
    }

    const strippedWeight = stripNovelAiWeightWrapper(current);
    current = strippedWeight.text;
    if (strippedWeight.hasExplicitWeight) extractedWeight = strippedWeight.weight;

    const weightedMatch = current.match(/^(.*):([0-9]+(?:\.[0-9]+)?)$/);
    if (weightedMatch) {
        current = weightedMatch[1].trim();
        const fallbackWeight = parseFloat(weightedMatch[2]);
        if (Number.isFinite(fallbackWeight)) extractedWeight = fallbackWeight;
    }

    const rawCoreTag = current.toLocaleLowerCase();
    const canonicalTag = canonicalizeOrganizerTagByDictionary(rawCoreTag);
    return {
        rawToken: String(token || '').trim(),
        rawCoreTag,
        canonicalTag,
        explicitWeight: extractedWeight,
        wrapperWeight,
        weight: extractedWeight * wrapperWeight,
        wrappers,
        explicitPrefixGroup: getExplicitPrefixGroup(rawCoreTag)
    };
}

function extractOrganizerCoreTag(token = '') {
    return parseOrganizerToken(token)?.canonicalTag || '';
}

function getExplicitPrefixGroup(tag = '') {
    const normalized = String(tag || '').trim().toLocaleLowerCase();
    const match = normalized.match(/^([a-z0-9_]+:)[^:\s].*$/i);
    return match ? match[1] : '';
}

function getOrganizerParsedDictionaryMeta(parsedToken = null) {
    if (!parsedToken) return null;

    const candidateKeys = [];
    const pushKey = (value) => {
        const normalized = String(value || '').trim().toLocaleLowerCase();
        if (!normalized || candidateKeys.includes(normalized)) return;
        candidateKeys.push(normalized);
    };

    pushKey(parsedToken.canonicalTag);
    pushKey(parsedToken.rawCoreTag);

    const rawCoreTag = String(parsedToken.rawCoreTag || '').trim().toLocaleLowerCase();
    const artistMatch = rawCoreTag.match(/^artist:(.+)$/);
    if (artistMatch) pushKey(artistMatch[1].trim());
    const characterMatch = rawCoreTag.match(/^character:(.+)$/);
    if (characterMatch) pushKey(characterMatch[1].trim());

    for (const key of candidateKeys) {
        const meta = getOrganizerDictionaryMetaByTag(key);
        if (meta) return { key, ...meta };
    }

    return null;
}

function buildOrganizerGroupTagsTagSet(groupTagsData = null) {
    const tagSet = new Set();
    const membershipMap = new Map();
    const translationMap = new Map();
    const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];

    categories.forEach(category => {
        const categoryId = String(category?.id || category?.name || '').trim();
        const categoryName = String(category?.name || category?.id || '未命名分类').trim() || '未命名分类';
        const groups = Array.isArray(category?.groups) ? category.groups : [];
        groups.forEach(group => {
            const groupId = String(group?.id || group?.name || '').trim();
            const groupName = String(group?.name || group?.id || '未命名分组').trim() || '未命名分组';
            const categoryKey = categoryId || categoryName;
            const groupKey = `${categoryKey}::${groupId || groupName}`;
            const tags = Array.isArray(group?.tags) ? group.tags : [];
            tags.forEach(item => {
                if (groupTagsDataUtils.isTagGroupItem && !groupTagsDataUtils.isTagGroupItem(item)) return;
                const promptText = groupTagsDataUtils.getGroupItemPromptText
                    ? groupTagsDataUtils.getGroupItemPromptText(item)
                    : (item?.en || '');
                const normalizedKey = groupTagsDataUtils.normalizeTagKey
                    ? groupTagsDataUtils.normalizeTagKey(promptText)
                    : String(promptText || '').trim().toLocaleLowerCase();
                if (!normalizedKey) return;
                tagSet.add(normalizedKey);
                const translationText = groupTagsDataUtils.getGroupItemTranslationText
                    ? groupTagsDataUtils.getGroupItemTranslationText(item)
                    : (item?.zh || '');
                if (translationText && !translationMap.has(normalizedKey)) {
                    translationMap.set(normalizedKey, String(translationText).trim());
                }
                if (!membershipMap.has(normalizedKey)) membershipMap.set(normalizedKey, []);
                membershipMap.get(normalizedKey).push({
                    categoryKey,
                    categoryTitle: categoryName,
                    groupKey,
                    groupTitle: groupName
                });
            });
        });
    });

    return { tagSet, membershipMap, translationMap };
}

async function loadOrganizerGroupTagsIndex({ force = false } = {}) {
    if (organizerGroupTagsLoadPromise && !force) return organizerGroupTagsLoadPromise;

    organizerGroupTagsLoadPromise = (async () => {
        organizerGroupTagsLoaded = false;
        organizerGroupTagsLoadError = false;

        try {
            let storedGroupTagsData = (await chrome.storage.local.get('groupTagsUserData')).groupTagsUserData;
            if (storedGroupTagsData?.categories && groupTagsDataUtils.migrateStoredGroupTagsData) {
                try {
                    const migrated = await groupTagsDataUtils.migrateStoredGroupTagsData();
                    storedGroupTagsData = migrated.data || storedGroupTagsData;
                } catch (migrationError) {
                    console.warn('loadOrganizerGroupTagsIndex migrate failed:', migrationError);
                }
            }

            let defaultGroupTagsData = groupTagsDataUtils.createEmptyGroupTagsData
                ? groupTagsDataUtils.createEmptyGroupTagsData()
                : { categories: [] };
            try {
                const response = await fetch(chrome.runtime.getURL('data/default_group_tags.json'));
                if (response.ok) {
                    defaultGroupTagsData = await response.json();
                }
            } catch (fetchError) {
                console.warn('loadOrganizerGroupTagsIndex default data failed:', fetchError);
            }

            const effectiveGroupTagsData = groupTagsDataUtils.resolveEffectiveGroupTagsData
                ? groupTagsDataUtils.resolveEffectiveGroupTagsData(defaultGroupTagsData, storedGroupTagsData)
                : (storedGroupTagsData?.categories ? storedGroupTagsData : defaultGroupTagsData);

            const groupTagsIndex = buildOrganizerGroupTagsTagSet(effectiveGroupTagsData);
            organizerGroupTagsTagSet = groupTagsIndex.tagSet;
            organizerGroupTagsMembershipMap = groupTagsIndex.membershipMap;
            organizerGroupTagsTranslationMap = groupTagsIndex.translationMap;
            organizerGroupTagsLoaded = true;
            organizerGroupTagsLoadError = false;
        } catch (error) {
            console.warn('loadOrganizerGroupTagsIndex failed:', error);
            organizerGroupTagsTagSet = new Set();
            organizerGroupTagsMembershipMap = new Map();
            organizerGroupTagsTranslationMap = new Map();
            organizerGroupTagsLoaded = true;
            organizerGroupTagsLoadError = true;
        } finally {
            organizerGroupTagsLoadPromise = null;
            invalidateOrganizerAnalysisCache();
            scheduleOrganizerRefresh();
        }
    })();

    return organizerGroupTagsLoadPromise;
}

function extractOrganizerCandidates(text = '') {
    const tagCounts = new Map();
    const artistLineCounts = new Map();
    const characterLineCounts = new Map();
    const groupTagLineCounts = new Map();
    const groupCategoryMap = new Map();

    String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .forEach(line => {
            const lineArtists = new Set();
            const lineCharacters = new Set();
            const lineGroupTags = new Set();
            const lineGroupHits = new Map();

            splitOrganizerTags(line).forEach(token => {
                const parsedToken = parseOrganizerToken(token);
                if (!parsedToken?.canonicalTag) return;

                tagCounts.set(parsedToken.canonicalTag, (tagCounts.get(parsedToken.canonicalTag) || 0) + 1);

                const dictionaryMeta = getOrganizerParsedDictionaryMeta(parsedToken);
                if (dictionaryMeta?.colorCode === '1') lineArtists.add(parsedToken.canonicalTag);
                if (dictionaryMeta?.colorCode === '4') lineCharacters.add(parsedToken.canonicalTag);
                if (organizerGroupTagsTagSet.has(parsedToken.canonicalTag)) {
                    lineGroupTags.add(parsedToken.canonicalTag);
                    const memberships = organizerGroupTagsMembershipMap.get(parsedToken.canonicalTag) || [];
                    memberships.forEach(membership => {
                        if (!groupCategoryMap.has(membership.categoryKey)) {
                            groupCategoryMap.set(membership.categoryKey, {
                                key: membership.categoryKey,
                                title: membership.categoryTitle,
                                groups: new Map()
                            });
                        }
                        const category = groupCategoryMap.get(membership.categoryKey);
                        if (!category.groups.has(membership.groupKey)) {
                            category.groups.set(membership.groupKey, {
                                key: membership.groupKey,
                                title: membership.groupTitle,
                                items: new Map()
                            });
                        }
                        if (!lineGroupHits.has(membership.groupKey)) lineGroupHits.set(membership.groupKey, new Set());
                        lineGroupHits.get(membership.groupKey).add(parsedToken.canonicalTag);
                    });
                }
            });

            lineArtists.forEach(tag => artistLineCounts.set(tag, (artistLineCounts.get(tag) || 0) + 1));
            lineCharacters.forEach(tag => characterLineCounts.set(tag, (characterLineCounts.get(tag) || 0) + 1));
            lineGroupTags.forEach(tag => groupTagLineCounts.set(tag, (groupTagLineCounts.get(tag) || 0) + 1));
            lineGroupHits.forEach((tagSet, groupKey) => {
                for (const category of groupCategoryMap.values()) {
                    if (!category.groups.has(groupKey)) continue;
                    const group = category.groups.get(groupKey);
                    tagSet.forEach(tag => group.items.set(tag, (group.items.get(tag) || 0) + 1));
                    break;
                }
            });
        });

    const sortEntries = (entries) => Array.from(entries.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));

    const sortSemanticEntries = (entries) => Array.from(entries.entries())
        .sort((a, b) => {
            const aMeta = getOrganizerDictionaryMetaByTag(a[0]);
            const bMeta = getOrganizerDictionaryMetaByTag(b[0]);
            const aPopCount = aMeta?.popCount ?? 0;
            const bPopCount = bMeta?.popCount ?? 0;
            return b[1] - a[1]
                || bPopCount - aPopCount
                || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
        });

    const groupTagsEmptyText = organizerGroupTagsLoadError
        ? '暂时无法读取 GroupTags 数据。'
        : organizerGroupTagsLoaded
            ? '当前文件中没有命中 GroupTags 已保存的 tag。'
            : '正在载入 GroupTags 数据。';

    const sortedGroupTagCategories = Array.from(groupCategoryMap.values())
        .map(category => ({
            key: category.key,
            title: category.title,
            groups: Array.from(category.groups.values())
                .map(group => ({
                    key: group.key,
                    title: group.title,
                    items: sortEntries(group.items)
                }))
                .filter(group => group.items.length > 0)
                .sort((a, b) => {
                    const aCount = a.items.reduce((sum, [, count]) => sum + count, 0);
                    const bCount = b.items.reduce((sum, [, count]) => sum + count, 0);
                    return bCount - aCount
                        || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
                })
        }))
        .filter(category => category.groups.length > 0)
        .sort((a, b) => {
            const aCount = a.groups.reduce((sum, group) => sum + group.items.reduce((inner, [, count]) => inner + count, 0), 0);
            const bCount = b.groups.reduce((sum, group) => sum + group.items.reduce((inner, [, count]) => inner + count, 0), 0);
            return bCount - aCount
                || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
        });

    return {
        commonTags: sortEntries(tagCounts).filter(([tag, count]) => count > 1),
        commonCategories: [
            {
                key: 'artists',
                title: '画师',
                type: 'exact',
                items: sortSemanticEntries(artistLineCounts),
                emptyText: '当前文件中没有识别到画师 tag。'
            },
            {
                key: 'characters',
                title: '角色',
                type: 'exact',
                items: sortSemanticEntries(characterLineCounts),
                emptyText: '当前文件中没有识别到角色 tag。'
            },
            {
                key: 'groupTags',
                title: 'GroupTags',
                type: 'exact',
                items: sortEntries(groupTagLineCounts),
                categories: sortedGroupTagCategories,
                emptyText: groupTagsEmptyText
            }
        ]
    };
}

function renderOrganizerCandidateChips(container, items = [], type = 'exact', emptyText = '') {
    if (!container) return;
    if (!items.length) {
        container.innerHTML = `<div class="organizer-rule-empty">${emptyText}</div>`;
        return;
    }

    container.innerHTML = items.map(([value, count]) => renderOrganizerChipMarkup(value, count, type)).join('');
}

function resolveActiveOrganizerCategoryKey(groups = []) {
    const availableKeys = (groups || []).map(group => group?.key).filter(Boolean);
    if (availableKeys.includes(organizerCommonCategoryKey)) return organizerCommonCategoryKey;
    organizerCommonCategoryKey = availableKeys[0] || 'artists';
    return organizerCommonCategoryKey;
}

function getOrganizerTagTranslation(tag = '') {
    const normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized) return '';

    const canonicalKey = groupTagsDataUtils.normalizeTagKey
        ? groupTagsDataUtils.normalizeTagKey(normalized)
        : normalized;

    const dictTranslation = String(getOrganizerDictionaryMetaByTag(canonicalKey)?.zhCN || '').trim();
    if (dictTranslation) return dictTranslation;

    return String(organizerGroupTagsTranslationMap.get(canonicalKey) || '').trim();
}

function getOrganizerDisplayTag(tag = '') {
    const normalized = String(tag || '').trim();
    if (!normalized) return '';

    return groupTagsDataUtils.canonicalToDisplayTag
        ? groupTagsDataUtils.canonicalToDisplayTag(normalized)
        : normalized.replace(/_/g, ' ');
}

function getOrganizerChipSearchTexts(tag = '') {
    const normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized) return [];

    const displayTag = getOrganizerDisplayTag(normalized).toLocaleLowerCase();
    const translation = getOrganizerTagTranslation(normalized).toLocaleLowerCase();
    const canonicalKey = groupTagsDataUtils.normalizeTagKey
        ? groupTagsDataUtils.normalizeTagKey(normalized)
        : normalized;

    return [normalized, canonicalKey, displayTag, translation].filter(Boolean);
}

function isOrganizerChipPinned(value = '', type = 'exact') {
    return findOrganizerPinnedItemIndex(value, type) !== -1;
}

function renderOrganizerChipMarkup(value = '', count = 0, type = 'exact') {
    const displayTag = getOrganizerDisplayTag(value);
    const translation = getOrganizerTagTranslation(value);
    const isPinned = isOrganizerChipPinned(value, type);
    return `
        <button
            type="button"
            class="organizer-chip counted${isPinned ? ' pinned' : ''}"
            data-type="${type}"
            data-value="${escapeHtml(value)}"
            title="${escapeHtml((translation || displayTag || value) + (isPinned ? ' · 已置顶' : ''))}">
            <span class="organizer-chip-main">
                <span class="organizer-chip-text">${escapeHtml(displayTag || value)}</span>
                ${translation ? `<span class="organizer-chip-translation">${escapeHtml(translation)}</span>` : ''}
            </span>
            <span class="organizer-chip-count">${count}</span>
        </button>
    `;
}

function resolveOrganizerGroupTagsSelection(categories = []) {
    const availableCategoryKeys = (categories || []).map(category => category?.key).filter(Boolean);
    if (!availableCategoryKeys.length) {
        organizerGroupTagsCategoryKey = '';
        organizerGroupTagsGroupKey = '';
        return { activeCategory: null, activeGroup: null };
    }

    if (organizerGroupTagsCategoryKey && !availableCategoryKeys.includes(organizerGroupTagsCategoryKey)) {
        organizerGroupTagsCategoryKey = '';
        organizerGroupTagsGroupKey = '';
    }

    if (!organizerGroupTagsCategoryKey) {
        organizerGroupTagsGroupKey = '';
        return { activeCategory: null, activeGroup: null };
    }

    const activeCategory = categories.find(category => category.key === organizerGroupTagsCategoryKey) || categories[0];
    const availableGroupKeys = (activeCategory?.groups || []).map(group => group?.key).filter(Boolean);
    if (!availableGroupKeys.length) {
        organizerGroupTagsGroupKey = '';
        return { activeCategory, activeGroup: null };
    }

    if (organizerGroupTagsGroupKey && !availableGroupKeys.includes(organizerGroupTagsGroupKey)) {
        organizerGroupTagsGroupKey = '';
    }

    if (!organizerGroupTagsGroupKey) {
        return { activeCategory, activeGroup: null };
    }

    const activeGroup = activeCategory.groups.find(group => group.key === organizerGroupTagsGroupKey) || activeCategory.groups[0];
    return { activeCategory, activeGroup };
}

function renderOrganizerCategorySections(container, groups = [], emptyText = '') {
    if (!container) return;
    if (!groups.length) {
        container.innerHTML = `<div class="organizer-rule-empty">${emptyText}</div>`;
        return;
    }

    const activeKey = resolveActiveOrganizerCategoryKey(groups);
    const activeGroup = groups.find(group => group.key === activeKey) || groups[0];

    if (activeGroup?.key === 'groupTags') {
        const { activeCategory, activeGroup: activeGroupTagsGroup } = resolveOrganizerGroupTagsSelection(activeGroup.categories || []);
        container.innerHTML = `
            <div class="organizer-category-switcher">
                ${groups.map(group => `
                    <button
                        type="button"
                        class="organizer-category-tab${group.key === activeKey ? ' active' : ''}"
                        data-category-switch="${escapeHtml(group.key || '')}">
                        <span>${escapeHtml(group.title || '')}</span>
                        <span class="organizer-category-tab-count">${(group.items || []).length}</span>
                    </button>
                `).join('')}
            </div>
            <section class="organizer-category-group" data-category="${escapeHtml(activeGroup.key || '')}">
                ${(activeGroup.categories || []).length
                    ? `
                        <div class="organizer-group-tags-browser">
                            <div class="organizer-breadcrumb">
                                <button type="button" class="organizer-browser-btn${!activeCategory ? ' active' : ''}" data-group-tags-root="1">
                                    <span>分类</span>
                                </button>
                                ${activeCategory ? `
                                    <span class="organizer-breadcrumb-sep">/</span>
                                    <button type="button" class="organizer-browser-btn${activeCategory && !activeGroupTagsGroup ? ' active' : ''}" data-group-tags-category="${escapeHtml(activeCategory.key || '')}">
                                        <span>${escapeHtml(activeCategory.title || '')}</span>
                                    </button>
                                ` : ''}
                                ${activeGroupTagsGroup ? `
                                    <span class="organizer-breadcrumb-sep">/</span>
                                    <button type="button" class="organizer-browser-btn active" data-group-tags-group="${escapeHtml(activeGroupTagsGroup.key || '')}">
                                        <span>${escapeHtml(activeGroupTagsGroup.title || '')}</span>
                                    </button>
                                ` : ''}
                            </div>
                            <div class="organizer-subpanel">
                                <div class="organizer-category-body">
                                    ${!activeCategory
                                        ? `
                                            <div class="organizer-browser-grid">
                                                ${(activeGroup.categories || []).map(category => `
                                                    <button
                                                        type="button"
                                                        class="organizer-browser-btn"
                                                        data-group-tags-category="${escapeHtml(category.key || '')}">
                                                        <span>${escapeHtml(category.title || '')}</span>
                                                        <span class="organizer-browser-btn-count">${(category.groups || []).length}</span>
                                                    </button>
                                                `).join('')}
                                            </div>
                                        `
                                        : !activeGroupTagsGroup
                                            ? (activeCategory.groups || []).length
                                                ? `
                                                    <div class="organizer-browser-grid">
                                                        ${(activeCategory.groups || []).map(group => `
                                                            <button
                                                                type="button"
                                                                class="organizer-browser-btn"
                                                                data-group-tags-group="${escapeHtml(group.key || '')}">
                                                                <span>${escapeHtml(group.title || '')}</span>
                                                                <span class="organizer-browser-btn-count">${(group.items || []).length}</span>
                                                            </button>
                                                        `).join('')}
                                                    </div>
                                                `
                                                : `<div class="organizer-rule-empty">${escapeHtml(activeGroup.emptyText || '当前分类下没有命中的分组。')}</div>`
                                            : (activeGroupTagsGroup.items || []).length
                                                ? (activeGroupTagsGroup.items || []).map(([value, count]) => renderOrganizerChipMarkup(value, count, activeGroup.type || 'exact')).join('')
                                                : `<div class="organizer-rule-empty">${escapeHtml(activeGroup.emptyText || '当前分组没有命中的 tag。')}</div>`
                                    }
                                </div>
                            </div>
                        </div>
                    `
                    : `<div class="organizer-rule-empty">${escapeHtml(activeGroup.emptyText || '当前文件中没有命中 GroupTags 已保存的 tag。')}</div>`
                }
            </section>
        `;
        return;
    }

    container.innerHTML = `
        <div class="organizer-category-switcher">
            ${groups.map(group => `
                <button
                    type="button"
                    class="organizer-category-tab${group.key === activeKey ? ' active' : ''}"
                    data-category-switch="${escapeHtml(group.key || '')}">
                    <span>${escapeHtml(group.title || '')}</span>
                    <span class="organizer-category-tab-count">${(group.items || []).length}</span>
                </button>
            `).join('')}
        </div>
        <section class="organizer-category-group" data-category="${escapeHtml(activeGroup.key || '')}">
            <div class="organizer-category-body">
                ${(activeGroup.items || []).length
                    ? (activeGroup.items || []).map(([value, count]) => renderOrganizerChipMarkup(value, count, activeGroup.type || 'exact')).join('')
                    : `<div class="organizer-rule-empty">${escapeHtml(activeGroup.emptyText || '暂无结果。')}</div>`
                }
            </div>
        </section>
    `;
}

function getPinnedMatchIndex(coreTag = '', pinnedItems = organizerPinnedItemsCache) {
    const normalizedTag = String(coreTag || '').trim().toLocaleLowerCase();
    if (!normalizedTag || !pinnedItems.length) return Number.POSITIVE_INFINITY;

    for (let i = 0; i < pinnedItems.length; i++) {
        const item = pinnedItems[i];
        if (item.type === 'exact' && normalizedTag === item.normalizedValue) return i;
        if (item.type === 'prefix' && normalizedTag.startsWith(item.normalizedValue)) return i;
    }
    return Number.POSITIVE_INFINITY;
}

function reorderLineTagsByPriority(line = '', pinnedItems = organizerPinnedItemsCache) {
    const tokens = splitOrganizerTags(line);
    if (tokens.length <= 1 || !pinnedItems.length) return normalizeOrganizerLine(line);

    const enrichedTokens = tokens.map((token, index) => ({
        token: token.trim(),
        index,
        matchIndex: getPinnedMatchIndex(parseOrganizerToken(token)?.canonicalTag, pinnedItems)
    }));

    enrichedTokens.sort((a, b) => {
        const aMatched = Number.isFinite(a.matchIndex);
        const bMatched = Number.isFinite(b.matchIndex);
        if (aMatched && bMatched) return a.matchIndex - b.matchIndex || a.index - b.index;
        if (aMatched) return -1;
        if (bMatched) return 1;
        return a.index - b.index;
    });

    return enrichedTokens.map(item => item.token).join(', ');
}

function buildLinePinnedPriorityMeta(line = '', pinnedItems = organizerPinnedItemsCache) {
    const matchedIndices = [];
    const seen = new Set();
    const weightMap = new Map();

    splitOrganizerTags(line).forEach(token => {
        const parsedToken = parseOrganizerToken(token);
        const matchIndex = getPinnedMatchIndex(parsedToken?.canonicalTag, pinnedItems);
        if (!Number.isFinite(matchIndex) || seen.has(matchIndex)) return;
        seen.add(matchIndex);
        matchedIndices.push(matchIndex);
        weightMap.set(matchIndex, Math.max(weightMap.get(matchIndex) || Number.NEGATIVE_INFINITY, parsedToken?.weight ?? 1));
    });

    splitOrganizerTags(line).forEach(token => {
        const parsedToken = parseOrganizerToken(token);
        const matchIndex = getPinnedMatchIndex(parsedToken?.canonicalTag, pinnedItems);
        if (!Number.isFinite(matchIndex)) return;
        weightMap.set(matchIndex, Math.max(weightMap.get(matchIndex) || Number.NEGATIVE_INFINITY, parsedToken?.weight ?? 1));
    });

    matchedIndices.sort((a, b) => a - b);

    return {
        matchedIndices,
        matchedWeights: matchedIndices.map(index => weightMap.get(index) ?? 1),
        firstMatchIndex: matchedIndices.length ? matchedIndices[0] : Number.POSITIVE_INFINITY,
        matchedCount: matchedIndices.length
    };
}

function comparePinnedPriorityMeta(aMeta, bMeta) {
    const aMatched = Number.isFinite(aMeta.firstMatchIndex);
    const bMatched = Number.isFinite(bMeta.firstMatchIndex);
    if (aMatched && !bMatched) return -1;
    if (!aMatched && bMatched) return 1;
    if (!aMatched && !bMatched) return 0;

    const maxLen = Math.max(aMeta.matchedIndices.length, bMeta.matchedIndices.length);
    for (let i = 0; i < maxLen; i++) {
        const aVal = aMeta.matchedIndices[i];
        const bVal = bMeta.matchedIndices[i];
        if (aVal === undefined && bVal === undefined) break;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;
        if (aVal !== bVal) return aVal - bVal;

        const aWeight = aMeta.matchedWeights[i] ?? 1;
        const bWeight = bMeta.matchedWeights[i] ?? 1;
        if (aWeight !== bWeight) return bWeight - aWeight;
    }

    if (aMeta.matchedCount !== bMeta.matchedCount) return bMeta.matchedCount - aMeta.matchedCount;
    return 0;
}

function buildOrganizerModel(text = '') {
    const source = String(text || '').replace(/\r\n/g, '\n');
    const rawLines = source.split('\n');
    const nonEmptyEntries = [];
    let blankLines = 0;

    rawLines.forEach((rawLine, index) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            blankLines++;
            return;
        }

        const normalized = normalizeOrganizerLine(trimmed);
        const tokenCount = splitOrganizerTags(trimmed).length;
        nonEmptyEntries.push({
            lineNumber: index + 1,
            raw: rawLine,
            text: trimmed,
            normalized,
            tokenCount,
            charCount: normalized.length
        });
    });

    const duplicateMap = new Map();
    nonEmptyEntries.forEach(entry => {
        const key = entry.normalized.toLocaleLowerCase();
        duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    });

    nonEmptyEntries.forEach(entry => {
        entry.duplicateCount = duplicateMap.get(entry.normalized.toLocaleLowerCase()) || 1;
    });

    const duplicateGroups = Array.from(duplicateMap.values()).filter(count => count > 1).length;
    return {
        entries: nonEmptyEntries,
        stats: {
            totalLines: rawLines.length,
            nonEmptyLines: nonEmptyEntries.length,
            blankLines,
            uniqueLines: duplicateMap.size,
            duplicateLines: Math.max(0, nonEmptyEntries.length - duplicateMap.size),
            duplicateGroups
        }
    };
}

function getSortedOrganizerEntries(entries = [], mode = 'original') {
    const list = [...entries];
    const compareText = (a, b) => a.normalized.localeCompare(b.normalized, undefined, { numeric: true, sensitivity: 'base' });

    switch (mode) {
        case 'alphaAsc':
            list.sort((a, b) => compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'alphaDesc':
            list.sort((a, b) => compareText(b, a) || a.lineNumber - b.lineNumber);
            break;
        case 'tokenAsc':
            list.sort((a, b) => a.tokenCount - b.tokenCount || compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'tokenDesc':
            list.sort((a, b) => b.tokenCount - a.tokenCount || compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'lengthAsc':
            list.sort((a, b) => a.charCount - b.charCount || compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'lengthDesc':
            list.sort((a, b) => b.charCount - a.charCount || compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'duplicatesFirst':
            list.sort((a, b) => b.duplicateCount - a.duplicateCount || compareText(a, b) || a.lineNumber - b.lineNumber);
            break;
        case 'pinnedPriority':
            const pinnedPriorityMetaCache = new Map();
            list.forEach(entry => {
                pinnedPriorityMetaCache.set(entry.lineNumber, buildLinePinnedPriorityMeta(entry.text, organizerPinnedItemsCache));
            });
            list.sort((a, b) => {
                const aMeta = pinnedPriorityMetaCache.get(a.lineNumber);
                const bMeta = pinnedPriorityMetaCache.get(b.lineNumber);
                return comparePinnedPriorityMeta(aMeta, bMeta) || a.lineNumber - b.lineNumber;
            });
            break;
        default:
            list.sort((a, b) => a.lineNumber - b.lineNumber);
            break;
    }

    return list;
}

function updateOrganizerToggleText() {
    toggleOrganizerBtn.textContent = organizerVisible ? '隐藏整理' : '整理视图';
}

function setOrganizerVisibility(nextVisible) {
    organizerVisible = !!nextVisible;
    organizerPanel.classList.toggle('collapsed', !organizerVisible);
    toggleOrganizerBtn.classList.toggle('active', organizerVisible); // 同步方案 2 的激活状态类
    updateOrganizerToggleText();
    saveOrganizerLayoutState();
}

function getOrganizerPinDrawerHeightBounds() {
    const safeFallbackMax = Math.max(
        ORGANIZER_PIN_DRAWER_MIN_HEIGHT,
        organizerPinDrawerHeight,
        ORGANIZER_PIN_DRAWER_DEFAULT_HEIGHT
    );

    if (!organizerPanel) {
        return {
            min: ORGANIZER_PIN_DRAWER_MIN_HEIGHT,
            max: safeFallbackMax
        };
    }

    const panelHeight = organizerPanel.clientHeight || 0;
    const toolbarHeight = organizerPanel.querySelector('.organizer-toolbar')?.offsetHeight || 0;
    const summaryHeight = organizerSummary?.offsetHeight || 32;
    const handleHeight = organizerPinResizeHandle?.offsetHeight || 6;

    if (!panelHeight) {
        return {
            min: ORGANIZER_PIN_DRAWER_MIN_HEIGHT,
            max: safeFallbackMax
        };
    }

    const maxHeight = Math.max(
        ORGANIZER_PIN_DRAWER_MIN_HEIGHT,
        panelHeight - toolbarHeight - summaryHeight - handleHeight - ORGANIZER_PANEL_BOTTOM_MIN_HEIGHT
    );

    return {
        min: ORGANIZER_PIN_DRAWER_MIN_HEIGHT,
        max: maxHeight
    };
}

function applyOrganizerPinDrawerHeight(nextHeight, { save = false } = {}) {
    const { min, max } = getOrganizerPinDrawerHeightBounds();
    const numericHeight = Number.isFinite(nextHeight) ? nextHeight : parseFloat(nextHeight);
    const fallbackHeight = Number.isFinite(numericHeight) ? numericHeight : organizerPinDrawerHeight;
    organizerPinDrawerHeight = Math.round(Math.min(Math.max(fallbackHeight, min), max));

    if (organizerPanel) {
        organizerPanel.style.setProperty('--organizer-pin-drawer-height', `${organizerPinDrawerHeight}px`);
    }

    if (save) saveOrganizerLayoutState();
}

/**
 * 持久化保存整理面板布局状态
 */
function saveOrganizerLayoutState() {
    const pinDrawer = document.getElementById('pinDrawer');
    if (!organizerPanel) return;
    
    // 获取当前有效宽度
    let currentWidth = organizerPanel.style.width;
    if (!currentWidth && organizerVisible) {
        currentWidth = organizerPanel.offsetWidth + 'px';
    }

    // 获取当前激活的视图 (通配符 vs 字典)
    const activeViewBtn = viewSwitcher?.querySelector('button.active');
    const currentView = activeViewBtn ? activeViewBtn.dataset.view : 'sync';

    const state = {
        visible: organizerVisible,
        width: currentWidth,
        flexBasis: currentWidth,
        drawerOpen: pinDrawer ? pinDrawer.classList.contains('open') : false,
        drawerHeight: pinDrawer && pinDrawer.classList.contains('open')
            ? pinDrawer.offsetHeight || organizerPinDrawerHeight
            : organizerPinDrawerHeight,
        lastOpenedFile: currentFile,
        currentView: currentView,
        dictShowChanges: typeof dictShowChanges !== 'undefined' ? dictShowChanges : false
    };
    chrome.storage.local.set({ organizerLayoutState: state });
}

function scrollEditorToLine(lineNumber) {
    if (!editorView || !lineNumber) return;
    try {
        const line = editorView.state.doc.line(lineNumber);
        editorView.dispatch({
            selection: { anchor: line.from },
            effects: CM.EditorView.scrollIntoView(line.from, { y: 'center' })
        });
        editorView.focus();
    } catch (error) {
        console.warn('scrollEditorToLine failed:', error);
    }
}

function invalidateOrganizerAnalysisCache() {
    organizerAnalysisCache.dirty = true;
    organizerAnalysisCache.model = null;
    organizerAnalysisCache.candidates = null;
    organizerAnalysisCache.sortedEntries = new Map();
}

function normalizeOrganizerRefreshRequest(options = {}) {
    if (!options || !Object.keys(options).length) {
        return {
            analysis: true,
            candidates: true,
            list: true,
            summary: true
        };
    }

    return {
        analysis: false,
        candidates: false,
        list: false,
        summary: false,
        ...options
    };
}

function scheduleOrganizerRefresh(options = {}) {
    const request = normalizeOrganizerRefreshRequest(options);
    organizerPendingRefresh.analysis = organizerPendingRefresh.analysis || request.analysis;
    organizerPendingRefresh.candidates = organizerPendingRefresh.candidates || request.candidates;
    organizerPendingRefresh.list = organizerPendingRefresh.list || request.list;
    organizerPendingRefresh.summary = organizerPendingRefresh.summary || request.summary;

    if (organizerRefreshTimer) clearTimeout(organizerRefreshTimer);
    organizerRefreshTimer = setTimeout(() => {
        organizerRefreshTimer = null;
        const nextRefresh = { ...organizerPendingRefresh };
        organizerPendingRefresh = {
            analysis: false,
            candidates: false,
            list: false,
            summary: false
        };
        renderOrganizerPreview(nextRefresh);
    }, 120);
}

function getOrganizerPinnedItemsSignature() {
    if (!organizerPinnedItemsCache.length) return '';
    return organizerPinnedItemsCache
        .map(item => `${item.type}:${item.normalizedValue}`)
        .join('|');
}

function ensureOrganizerAnalysisCache() {
    if (!currentFile || !editorView) return null;
    if (!organizerAnalysisCache.dirty && organizerAnalysisCache.model && organizerAnalysisCache.candidates) {
        return organizerAnalysisCache;
    }

    const editorText = editorView.state.doc.toString();
    const isLargeFileMode = isOrganizerLargeFileMode();
    organizerAnalysisCache = {
        dirty: false,
        model: isLargeFileMode ? buildOrganizerLightweightModel(editorText) : buildOrganizerModel(editorText),
        candidates: isLargeFileMode
            ? { commonTags: [], commonCategories: [] }
            : extractOrganizerCandidates(editorText),
        sortedEntries: new Map()
    };
    return organizerAnalysisCache;
}

function getCachedOrganizerSortedEntries(mode = 'original') {
    const analysis = ensureOrganizerAnalysisCache();
    if (!analysis?.model?.entries) return [];

    const effectiveMode = isOrganizerLargeFileMode()
        ? syncOrganizerLargeFileSortMode({ notify: false, fallbackMode: mode })
        : mode;

    const cacheKey = effectiveMode === 'pinnedPriority'
        ? `${effectiveMode}::${getOrganizerPinnedItemsSignature()}`
        : effectiveMode;

    if (!analysis.sortedEntries.has(cacheKey)) {
        analysis.sortedEntries.set(cacheKey, getSortedOrganizerEntries(analysis.model.entries, effectiveMode));
    }

    return analysis.sortedEntries.get(cacheKey) || [];
}

function buildOrganizerHighlightRegex(highlightTerms = []) {
    const normalizedTerms = Array.from(new Set(
        (highlightTerms || [])
            .map(term => String(term || '').trim())
            .filter(Boolean)
    ));

    if (!normalizedTerms.length) return null;

    const pattern = normalizedTerms
        .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    return new RegExp(`(${pattern})`, 'gi');
}

function buildOrganizerListItemMarkup(entry, highlightRegex = null) {
    let contentHtml = escapeHtml(entry.normalized);
    if (highlightRegex) {
        contentHtml = contentHtml.replace(highlightRegex, '<mark>$1</mark>');
    }

    return `
        <div class="organizer-item${entry.duplicateCount > 1 ? ' duplicate' : ''}" data-line-number="${entry.lineNumber}">
            <div class="organizer-item-header">
                <span class="organizer-item-line">L${entry.lineNumber}</span>
                <span class="organizer-badge">${entry.tokenCount} tags</span>
                ${entry.duplicateCount > 1 ? `<span class="organizer-badge warn">重复 ${entry.duplicateCount}</span>` : ''}
            </div>
            <div class="organizer-item-text">${contentHtml}</div>
        </div>
    `;
}

function removeOrganizerListTail() {
    organizerList?.querySelector('.organizer-list-tail')?.remove();
}

function updateOrganizerListTail() {
    if (!organizerList) return;
    removeOrganizerListTail();

    const total = organizerListRenderState.entries.length;
    if (!total || organizerListRenderState.renderedCount >= total) return;

    const tail = document.createElement('div');
    tail.className = 'organizer-list-tail';
    tail.textContent = `已显示 ${organizerListRenderState.renderedCount} / ${total}，继续滚动加载更多`;
    organizerList.appendChild(tail);
}

function scheduleOrganizerListChunkAppend() {
    if (!organizerList || organizerListChunkFrame) return;

    const renderVersion = organizerListRenderState.version;
    organizerListChunkFrame = requestAnimationFrame(() => {
        organizerListChunkFrame = 0;
        if (renderVersion !== organizerListRenderState.version) return;

        if (organizerListRenderState.renderedCount >= organizerListRenderState.entries.length) {
            removeOrganizerListTail();
            return;
        }

        removeOrganizerListTail();

        const nextEntries = organizerListRenderState.entries.slice(
            organizerListRenderState.renderedCount,
            organizerListRenderState.renderedCount + ORGANIZER_LIST_CHUNK_SIZE
        );

        if (nextEntries.length) {
            organizerList.insertAdjacentHTML(
                'beforeend',
                nextEntries.map(entry => buildOrganizerListItemMarkup(entry, organizerListRenderState.highlightRegex)).join('')
            );
            organizerListRenderState.renderedCount += nextEntries.length;
        }

        updateOrganizerListTail();

        if (
            organizerListRenderState.renderedCount < organizerListRenderState.entries.length
            && organizerList.scrollHeight <= organizerList.clientHeight + 48
        ) {
            scheduleOrganizerListChunkAppend();
        }
    });
}

function renderOrganizerCandidatePanels(candidates, searchQuery = '', pinQuery = '') {
    const queries = [searchQuery, pinQuery].filter(q => q.length > 0);
    const filterByQuery = (items) => {
        if (!queries.length) return items;
        return items.filter(([value]) => {
            const searchTexts = getOrganizerChipSearchTexts(value);
            return queries.some(q => searchTexts.some(text => text.includes(q)));
        });
    };

    const filterGroupTagCategories = (categories = []) => {
        return (categories || [])
            .map(category => ({
                ...category,
                groups: (category.groups || [])
                    .map(group => ({
                        ...group,
                        items: filterByQuery(group.items || [])
                    }))
                    .filter(group => group.items.length > 0)
            }))
            .filter(category => category.groups.length > 0);
    };

    const filteredCommonTags = filterByQuery(candidates.commonTags);
    const commonTagsEmptyText = candidates.commonTags.length
        ? '当前筛选条件下没有匹配的常见 tag。'
        : '当前文件中没有重复出现的常见 tag';

    renderOrganizerCandidateChips(organizerCommonTags, filteredCommonTags, 'exact', commonTagsEmptyText);
    renderOrganizerCategorySections(organizerCommonCategories, candidates.commonCategories.map(group => ({
        ...group,
        items: filterByQuery(group.items),
        categories: group.key === 'groupTags' ? filterGroupTagCategories(group.categories || []) : group.categories
    })), '当前文件里还没有识别到可用的分类标签。');
}

function renderOrganizerSummarySection(model) {
    if (!organizerSummary) return;
    organizerSummary.innerHTML = `
        <span><b>${model.stats.nonEmptyLines}</b> 条有效 · <b>${model.stats.uniqueLines}</b> 唯一 · <b>${model.stats.duplicateLines}</b> 重复</span>
    `;
}

function buildOrganizerLightweightModel(text = '') {
    const source = String(text || '').replace(/\r\n/g, '\n');
    const rawLines = source.split('\n');
    const entries = [];
    let blankLines = 0;

    rawLines.forEach((rawLine, index) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            blankLines++;
            return;
        }

        const normalized = normalizeOrganizerLine(trimmed);
        entries.push({
            lineNumber: index + 1,
            raw: rawLine,
            text: trimmed,
            normalized,
            tokenCount: 1,
            charCount: normalized.length
        });
    });

    const duplicateMap = new Map();
    entries.forEach(entry => {
        const key = entry.normalized.toLocaleLowerCase();
        duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    });

    entries.forEach(entry => {
        entry.duplicateCount = duplicateMap.get(entry.normalized.toLocaleLowerCase()) || 1;
    });

    return {
        entries,
        stats: {
            totalLines: rawLines.length,
            nonEmptyLines: entries.length,
            blankLines,
            uniqueLines: duplicateMap.size,
            duplicateLines: Math.max(0, entries.length - duplicateMap.size),
            duplicateGroups: Array.from(duplicateMap.values()).filter(count => count > 1).length
        }
    };
}

function syncOrganizerLargeFileState() {
    const lineCount = currentFile && editorView ? (editorView.state.doc.lines || 0) : 0;
    const isLargeFile = !!currentFile && lineCount >= ORGANIZER_LARGE_FILE_THRESHOLD;

    organizerLargeFileState.active = isLargeFile;
    organizerLargeFileState.lineCount = lineCount;
    return organizerLargeFileState;
}

function resetOrganizerLargeFileState() {
    organizerLargeFileState = {
        active: false,
        lineCount: 0
    };
}

function isOrganizerLargeFileMode() {
    return organizerLargeFileState.active;
}

function isOrganizerLargeFileUnsupportedSort(mode = organizerSortMode?.value || 'original') {
    return mode === 'pinnedPriority' || mode === 'tokenAsc' || mode === 'tokenDesc';
}

function getOrganizerLargeFileAllowedSortLabel() {
    return '大文件模式仅支持原始顺序、字母顺序、长度顺序和重复项优先';
}

function syncOrganizerLargeFileSortMode({ notify = false, fallbackMode } = {}) {
    const currentMode = fallbackMode || organizerSortMode?.value || 'original';
    if (!isOrganizerLargeFileMode()) return currentMode;
    if (!isOrganizerLargeFileUnsupportedSort(currentMode)) {
        return currentMode;
    }

    if (organizerSortMode) organizerSortMode.value = 'original';
    if (notify) showToast(getOrganizerLargeFileAllowedSortLabel(), 'info');
    return 'original';
}

function getOrganizerLargeFileDisabledMessage() {
    return `当前文件较大（${organizerLargeFileState.lineCount.toLocaleString()} 行），已关闭常见 Tag / 分类分析，仅保留简单排序、去重和规范功能。`;
}

function renderOrganizerListSection(entries = [], searchQuery = '', pinQuery = '') {
    if (!organizerList) return;

    const visibleEntries = searchQuery
        ? entries.filter(entry => entry.normalized.toLocaleLowerCase().includes(searchQuery))
        : entries;

    const searchBadge = document.getElementById('searchBadge');
    if (searchBadge) {
        if (searchQuery) {
            searchBadge.textContent = visibleEntries.length;
            searchBadge.style.display = 'block';
        } else {
            searchBadge.style.display = 'none';
        }
    }

    organizerListRenderState.version += 1;
    organizerListRenderState.entries = visibleEntries;
    organizerListRenderState.renderedCount = 0;
    organizerListRenderState.highlightRegex = buildOrganizerHighlightRegex([searchQuery, pinQuery].filter(Boolean));

    if (organizerListChunkFrame) {
        cancelAnimationFrame(organizerListChunkFrame);
        organizerListChunkFrame = 0;
    }

    if (!visibleEntries.length) {
        organizerList.innerHTML = '<div class="organizer-empty">没有匹配条件的行。</div>';
        return;
    }

    organizerList.innerHTML = '';
    organizerList.scrollTop = 0;
    scheduleOrganizerListChunkAppend();
}

// ----- 改进版整理面板交互逻辑 -----
function togglePinDrawer(forceState) {
    const pinDrawer = document.getElementById('pinDrawer');
    const toggleBtn = document.getElementById('togglePinDrawerBtn');
    if (!pinDrawer || !toggleBtn) return;

    const isOpen = forceState !== undefined ? forceState : !pinDrawer.classList.contains('open');
    pinDrawer.classList.toggle('open', isOpen);
    toggleBtn.classList.toggle('active', isOpen);
    if (isOpen) applyOrganizerPinDrawerHeight(organizerPinDrawerHeight);
    saveOrganizerLayoutState();
}

function switchPinTab(tabId) {
    const tabs = document.querySelectorAll('.pin-tab');
    const panels = document.querySelectorAll('.pin-tab-panel');
    
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    
    panels.forEach(panel => {
        panel.classList.toggle('active', panel.id === (tabId + 'Panel'));
    });
}

function renderOrganizerPreview(refreshRequest = {}) {
    if (!organizerList || !organizerSummary) return;

    const request = normalizeOrganizerRefreshRequest(refreshRequest);
    if (applyOrganizerPriorityBtn) {
        applyOrganizerPriorityBtn.disabled = false;
        applyOrganizerPriorityBtn.title = '';
    }

    if (!currentFile || !editorView) {
        organizerListRenderState.version += 1;
        organizerListRenderState.entries = [];
        organizerListRenderState.renderedCount = 0;
        organizerListRenderState.highlightRegex = null;
        if (organizerListChunkFrame) {
            cancelAnimationFrame(organizerListChunkFrame);
            organizerListChunkFrame = 0;
        }
        organizerSummary.innerHTML = '<span>尚未载入文件内容。</span>';
        organizerList.innerHTML = '<div class="organizer-empty">打开通配符文件后，这里会展示内容。</div>';
        renderOrganizerCandidateChips(organizerCommonTags, [], 'exact', '打开文件后会自动提取常见 tag。');
        renderOrganizerCategorySections(organizerCommonCategories, [], '打开文件后会自动提取当前文件中的画师、角色和 GroupTags 标签。');
        return;
    }

    if (isOrganizerLargeFileMode() && applyOrganizerPriorityBtn) {
        applyOrganizerPriorityBtn.disabled = true;
        applyOrganizerPriorityBtn.title = '大文件模式下已关闭 Tag 重排功能';
    }

    const analysis = ensureOrganizerAnalysisCache();
    if (!analysis) return;

    const searchQuery = organizerSearch.value.trim().toLocaleLowerCase();
    const pinQuery = organizerPinnedInput.value.trim().toLocaleLowerCase();

    if (request.candidates) {
        if (isOrganizerLargeFileMode()) {
            const disabledMessage = getOrganizerLargeFileDisabledMessage();
            renderOrganizerCandidateChips(organizerCommonTags, [], 'exact', disabledMessage);
            renderOrganizerCategorySections(organizerCommonCategories, [], disabledMessage);
        } else {
            renderOrganizerCandidatePanels(analysis.candidates, searchQuery, pinQuery);
        }
    }

    if (request.summary) {
        renderOrganizerSummarySection(analysis.model);
        if (isOrganizerLargeFileMode() && organizerSummary) {
            organizerSummary.insertAdjacentHTML('beforeend', '<span class="organizer-summary-note">大文件轻量模式</span>');
        }
    }

    if (request.list) {
        renderOrganizerListSection(
            getCachedOrganizerSortedEntries(syncOrganizerLargeFileSortMode({ notify: false })),
            searchQuery,
            pinQuery
        );
    }
}

function replaceEditorContent(text) {
    if (!editorView) return;
    editorView.dispatch({
        changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: text
        }
    });
}

function getOrganizerTransformationPreview({ dedupe = false, normalizeOnly = false, priorityTagReorder = false } = {}) {
    if (!editorView) return null;
    if (isOrganizerLargeFileMode() && priorityTagReorder) {
        return { error: '当前文件较大，已关闭 Tag 重排功能' };
    }

    const currentSortMode = syncOrganizerLargeFileSortMode({ notify: false });
    const model = isOrganizerLargeFileMode()
        ? buildOrganizerLightweightModel(editorView.state.doc.toString())
        : buildOrganizerModel(editorView.state.doc.toString());
    if (priorityTagReorder && !organizerPinnedItemsCache.length) {
        return { error: '请先添加至少一个置顶项' };
    }
    if (!priorityTagReorder && currentSortMode === 'pinnedPriority' && !organizerPinnedItemsCache.length) {
        return { error: '请先添加至少一个置顶项，再使用置顶顺序优先排序' };
    }

    const preview = {
        model,
        affectedLineCount: 0,
        removedCount: 0
    };

    if (normalizeOnly) {
        preview.affectedLineCount = model.entries.reduce((count, entry) => {
            return count + (normalizeOrganizerLine(entry.text) !== entry.normalized ? 1 : 0);
        }, 0);
        return preview;
    }

    if (priorityTagReorder) {
        preview.affectedLineCount = model.entries.reduce((count, entry) => {
            const reordered = reorderLineTagsByPriority(entry.text, organizerPinnedItemsCache);
            return count + (reordered !== entry.normalized ? 1 : 0);
        }, 0);
        return preview;
    }

    if (dedupe) {
        const entries = getSortedOrganizerEntries(model.entries, currentSortMode);
        const seen = new Set();
        let removedCount = 0;
        entries.forEach(entry => {
            const key = entry.normalized.toLocaleLowerCase();
            if (seen.has(key)) {
                removedCount++;
                return;
            }
            seen.add(key);
        });
        preview.removedCount = removedCount;
    }

    return preview;
}

async function confirmOrganizerTransformation(options = {}) {
    const preview = getOrganizerTransformationPreview(options);
    if (!preview) return;
    if (preview.error) {
        showToast(preview.error, 'error');
        return;
    }

    if (options.dedupe) {
        if (!preview.removedCount) {
            showToast('当前没有可删除的重复内容', 'info');
            return;
        }
        const confirmed = await customConfirm(`将删除 ${preview.removedCount} 条重复内容，确认继续？`);
        if (!confirmed) return;
    }

    applyOrganizerTransformation(options);
}

function applyOrganizerTransformation({ dedupe = false, normalizeOnly = false, priorityTagReorder = false } = {}) {
    if (!editorView) return;
    if (isOrganizerLargeFileMode() && priorityTagReorder) {
        showToast('当前文件较大，已关闭 Tag 重排功能', 'info');
        return;
    }

    const currentSortMode = syncOrganizerLargeFileSortMode({ notify: true });
    const model = isOrganizerLargeFileMode()
        ? buildOrganizerLightweightModel(editorView.state.doc.toString())
        : buildOrganizerModel(editorView.state.doc.toString());
    if (priorityTagReorder && !organizerPinnedItemsCache.length) {
        showToast('请先添加至少一个置顶项', 'error');
        return;
    }
    if (!priorityTagReorder && currentSortMode === 'pinnedPriority' && !organizerPinnedItemsCache.length) {
        showToast('请先添加至少一个置顶项，再使用置顶顺序优先排序', 'error');
        return;
    }

    let entries;
    if (normalizeOnly) {
        entries = model.entries.map(entry => ({ ...entry, normalized: normalizeOrganizerLine(entry.text) }));
    } else if (priorityTagReorder) {
        entries = model.entries.map(entry => ({
            ...entry,
            normalized: reorderLineTagsByPriority(entry.text, organizerPinnedItemsCache)
        }));
    } else {
        entries = getSortedOrganizerEntries(model.entries, currentSortMode);
    }

    if (dedupe) {
        const seen = new Set();
        entries = entries.filter(entry => {
            const key = entry.normalized.toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    const nextText = entries.map(entry => normalizeOnly ? entry.normalized : entry.normalized).join('\n');
    replaceEditorContent(nextText);

    const actionLabel = normalizeOnly
        ? '已按统一格式规范当前文件'
        : priorityTagReorder
            ? dedupe
                ? '已按置顶项重排 Tag 并去重'
                : '已按置顶项重排当前文件中的 Tag'
            : dedupe
                ? '已按当前规则排序并去重'
                : '已按当前规则排序';
    showToast(actionLabel, 'success');
    log(actionLabel + `：${currentFile}`, 'success');
    scheduleOrganizerRefresh();
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
            if (update.docChanged) {
                markModified();
                syncOrganizerLargeFileState();
                invalidateOrganizerAnalysisCache();
                scheduleOrganizerRefresh({ analysis: true, candidates: true, list: true, summary: true });
            }
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

function normalizeEditorContent(text = '') {
    return String(text || '').replace(/\r\n/g, '\n');
}

function hasUnsavedEditorChanges() {
    if (!currentFile || !editorView) return false;
    return normalizeEditorContent(editorView.state.doc.toString()) !== normalizeEditorContent(localContent);
}

function markModified() {
    if (!currentFile || !editorView) return;

    if (hasUnsavedEditorChanges()) {
        saveStatus.textContent = t('save_status_unsaved');
        saveStatus.className = 'modified';
        if (discardChangesBtn) discardChangesBtn.disabled = false;
    } else {
        saveStatus.textContent = '';
        saveStatus.className = '';
        if (discardChangesBtn) discardChangesBtn.disabled = true;
    }
}

function markSaved() {
    saveStatus.textContent = t('save_status_saved');
    saveStatus.className = 'saved';
    if (discardChangesBtn) discardChangesBtn.disabled = true;
    setTimeout(() => {
        if (saveStatus.className === 'saved') {
            saveStatus.textContent = '';
            saveStatus.className = '';
        }
    }, 2000);
}

async function openFile(key) {
    if (currentFile && editorView) {
        try {
            if (hasUnsavedEditorChanges() && !await customConfirm(t('confirm_discard_unsaved'))) return;
        } catch (e) {
            console.error('Check unsaved failed:', e);
            if (!await customConfirm(t('confirm_force_switch'))) return;
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
            editorWorkspace.style.display = 'flex';
            editorStatusbar.style.display = 'flex';
            extChangeBanner.classList.remove('show');

            if (!editorView) initEditor();

            // Safe dispatch
            editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: localContent } });

            saveStatus.textContent = '';
            saveStatus.className = '';
            if (discardChangesBtn) discardChangesBtn.disabled = true;
            updateLineInfo(editorView.state);
            syncOrganizerLargeFileState();
            syncOrganizerLargeFileSortMode({ notify: false });
            invalidateOrganizerAnalysisCache();
            scheduleOrganizerRefresh({ analysis: true, candidates: true, list: true, summary: true });
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
            saveOrganizerLayoutState(); // 持久化记录当前打开的文件
        }
    });
}

function closeEditor() {
    currentFile = null;
    localContent = '';
    resetOrganizerLargeFileState();
    invalidateOrganizerAnalysisCache();
    editorHeader.style.display = 'none';
    editorPlaceholder.style.display = 'flex';
    editorWorkspace.style.display = 'none';
    editorStatusbar.style.display = 'none';
    extChangeBanner.classList.remove('show');
    if (discardChangesBtn) discardChangesBtn.disabled = true;
    renderOrganizerPreview();
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
        autocompleteMetaMap = new Map(
            (autocompleteDict || []).map(entry => [
                String(entry.tag || '').trim().toLocaleLowerCase(),
                {
                    colorCode: String(entry.colorCode || ''),
                    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
                    popCount: parseInt(entry.popCount, 10) || 0,
                    zhCN: String(entry.zhCN || '').trim()
                }
            ])
        );
        log(tf('log_dictionary_loaded', { count: autocompleteDict.length }), 'success');

        // Send to worker
        initWorker();
        if (searchWorker) {
            searchWorker.postMessage({ type: 'init', payload: autocompleteDict });
        }
    } catch (e) {
        log(tf('log_dictionary_failed', { message: e.message }), 'error');
        autocompleteDict = [];
        autocompleteMetaMap = new Map();
    }
}

// ============================
// Section 10: UI Setup & Events
// ============================
function updateTopUI(dirName, state = dirName ? 'bound' : 'unbound') {
    currentTopUiState = state;
    const syncDashboard = document.getElementById('syncDashboard');
    const badges = syncDashboard.querySelectorAll('.sync-badge');

    if (state === 'bound' && dirName) {
        statusText.textContent = tf('status_bound', { dirName });
        statusText.classList.add('linked');
        linkBtn.style.display = 'none';
        linkBtn.textContent = t('action_bind_folder');
        unlinkBtn.style.display = '';
        exportBtn.style.display = '';
        importBtn.style.display = '';
        importBtn.textContent = '🔄 从本地加载/刷新';
        snapshotBtn.style.display = '';
        
        syncDashboard.classList.add('show');
        badges.forEach(b => {
            b.classList.add('ready');
        });
        // 刷新一次看板数据
        refreshDashboardUI();
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
        syncDashboard.classList.remove('show');
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
    syncDashboard.classList.remove('show');
}

/**
 * 刷新看板 UI 文字 (数量 | 相对时间)
 */
function refreshDashboardUI() {
    const formatTime = (ts) => {
        if (!ts) return '未同步';
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 30) return '刚刚';
        if (diff < 60) return '1 分钟前';
        if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
        return new Date(ts).toLocaleDateString();
    };

    const updateBadge = (id, meta, unit) => {
        const status = document.querySelector(`#badge-${id} .sync-badge-status`);
        if (status) {
            status.textContent = `${meta.count}${unit} | ${formatTime(meta.lastSync)}`;
        }
    };

    updateBadge('wildcards', assetMetadata.wildcards, ' 个');
    updateBadge('favorites', assetMetadata.favorites, ' 条');
    updateBadge('grouptags', assetMetadata.grouptags, ' 词');
    updateBadge('userdict', assetMetadata.userdict, ' 词');
}

/**
 * 外部推入全量统计数据 (由 scanAndPullChanges 触发)
 * 仅依赖底层传回的绝对修改时间，不盲目刷新 `lastSync`。
 */
function updateDashboardStats(stats) {
    if (!stats) return;

    // 获取到全量统计说明已完成读取/对齐，清除所有挂起状态
    document.querySelectorAll('.sync-badge').forEach(b => b.classList.remove('pending'));

    if (stats.wildcards !== undefined) {
        assetMetadata.wildcards.count = stats.wildcards.count;
        if (stats.wildcards.lastModified) assetMetadata.wildcards.lastSync = stats.wildcards.lastModified;
    }
    if (stats.favorites !== undefined) {
        assetMetadata.favorites.count = stats.favorites.count;
        if (stats.favorites.lastModified) assetMetadata.favorites.lastSync = stats.favorites.lastModified;
    }
    if (stats.grouptags !== undefined) {
        assetMetadata.grouptags.count = stats.grouptags.count;
        if (stats.grouptags.lastModified) assetMetadata.grouptags.lastSync = stats.grouptags.lastModified;
    }
    if (stats.userdict !== undefined) {
        assetMetadata.userdict.count = stats.userdict.count;
        if (stats.userdict.lastModified) assetMetadata.userdict.lastSync = stats.userdict.lastModified;
    }
    refreshDashboardUI();
}

// 每 60 秒自动刷新看板的相对时间
setInterval(refreshDashboardUI, 60000);


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
let isResizingBottom = false;
let isResizingRight = false;
let isResizingPinDrawer = false;
let startXForRight = 0;
let startWidthForRight = 0;
let startYForPinDrawer = 0;
let startHeightForPinDrawer = 0;

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
    } else if (isResizingRight) {
        const deltaX = startXForRight - e.clientX;
        const newWidthPx = Math.min(Math.max(startWidthForRight + deltaX, 360), window.innerWidth * 0.60) + 'px';
        organizerPanel.style.width = newWidthPx;
        organizerPanel.style.flexBasis = newWidthPx; // 同步更新以应对持久化后的覆盖
        organizerPanel.style.maxWidth = '80vw';
        organizerPanel.style.flexShrink = '0';
    } else if (isResizingPinDrawer) {
        const nextHeight = startHeightForPinDrawer + (e.clientY - startYForPinDrawer);
        applyOrganizerPinDrawerHeight(nextHeight);
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
    // 先快照「是否正在拖拽」，再清零标记，最后根据快照决定是否保存
    const wasDragging = isResizing || isResizingRight || isResizingPinDrawer || isResizingBottom;

    if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    } else if (isResizingRight) {
        isResizingRight = false;
        resizeHandleRight.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    } else if (isResizingPinDrawer) {
        isResizingPinDrawer = false;
        organizerPinResizeHandle?.classList.remove('dragging');
        document.getElementById('pinDrawer')?.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    } else if (isResizingBottom) {
        isResizingBottom = false;
        resizeHandleBottom.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    // 拖拽结束时保存状态（使用之前的快照值，而非已被清零的标记）
    if (wasDragging) {
        saveOrganizerLayoutState();
        console.log('[Layout] Drag ended, state saved. Width:', organizerPanel.style.width);
    }
});

// Removed redundant declarations that were moved up

const resizeHandleRight = document.getElementById('resizeHandleRight');
if (resizeHandleRight) {
    resizeHandleRight.addEventListener('mousedown', (e) => {
        isResizingRight = true;
        startXForRight = e.clientX;
        startWidthForRight = organizerPanel.offsetWidth;
        resizeHandleRight.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
}

if (organizerPinResizeHandle) {
    organizerPinResizeHandle.addEventListener('mousedown', (e) => {
        const pinDrawer = document.getElementById('pinDrawer');
        if (!pinDrawer?.classList.contains('open')) return;

        isResizingPinDrawer = true;
        startYForPinDrawer = e.clientY;
        startHeightForPinDrawer = pinDrawer.offsetHeight || organizerPinDrawerHeight;
        organizerPinResizeHandle.classList.add('dragging');
        pinDrawer.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
}

if (resizeHandleBottom) {
    resizeHandleBottom.addEventListener('mousedown', (e) => {
        isResizingBottom = true;
        resizeHandleBottom.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
}

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

        // 方案A：初次绑定强制 Pull（"认祖归宗"模式）
        // 先建立自动快照保护当前浏览器数据，再以 initialBind 模式执行首次同步
        await createSnapshot('绑定文件夹前自动备份', 'auto');
        const res = await localSyncService.scanAndPullChanges({ silent: false, initialBind: true });
        await handleSyncResult(res);
        refreshFileTree();
        log('初次绑定同步完成：已从本地文件夹加载数据', 'success');
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
    if (!boundDirHandle) return showToast(t('log_bind_first'), 'error');
    if (!await customConfirm(t('confirm_push_to_local_desc') || '确认将浏览器当前所有通配符回传到本地文件夹？这可能覆盖同名文件。')) return;
    
    exportBtn.disabled = true;
    try {
        log(t('log_push_start'), 'info');
        const res = await localSyncService.pushAllWildcards();
        if (res.success) {
            log(tf('log_push_complete', { count: res.count }), 'success');
            showToast(tf('toast_push_success', { count: res.count }), 'success');
        } else {
            throw new Error(res.error);
        }
    } catch (e) {
        log(tf('log_export_failed', { message: e.message }), 'error');
        showToast(t('toast_export_failed'), 'error');
    } finally {
        exportBtn.disabled = false;
    }
});

importBtn.addEventListener('click', async () => {
    if (!await customConfirm(t('confirm_import_overwrite'))) return;
    importBtn.disabled = true;
    try { 
        log('开始基于本地文件更新...', 'info');
        await createSnapshot(t('snapshot_label_before_import'), 'auto');
        const res = await localSyncService.scanAndPullChanges(); 
        await handleSyncResult(res);
        log('成功基于本地文件更新', 'success');
        showToast('从本地加载成功', 'success');
    }
    catch (e) { log(tf('log_import_failed', { message: e.message }), 'error'); showToast(t('toast_import_failed'), 'error'); }
    finally { importBtn.disabled = false; }
});

/**
 * 统一处理同步结果，包括拦截风险提示
 */
async function handleSyncResult(res) {
    if (!res) return;
    
    if (res.error === 'empty_local_dir_risk') {
        const choice = await customConfirm(t('confirm_empty_dir_push'));
        if (choice) {
            // 用户选择补齐本地
            await exportBtn.click();
        } else {
            log('同步已取消：本地目录为空。请手动通过“回传到本地”初始化文件夹。', 'warning');
        }
        return;
    }

    const hasChanges = res === true || res.hasChanges;
    if (hasChanges) refreshFileTree();
    if (res.stats) updateDashboardStats(res.stats);
}

snapshotBtn.addEventListener('click', async () => {
    await createSnapshot(t('snapshot_label_manual'), 'manual');
    showToast(t('toast_manual_snapshot_created'), 'success');
});

toggleOrganizerBtn.addEventListener('click', () => {
    setOrganizerVisibility(!organizerVisible);
});

organizerSortMode.addEventListener('change', () => {
    syncOrganizerLargeFileSortMode({ notify: true });
    scheduleOrganizerRefresh({ list: true });
});
organizerSearch.addEventListener('input', () => {
    scheduleOrganizerRefresh({ candidates: !isOrganizerLargeFileMode(), list: true });
});

function handleAddPinnedInput() {
    const value = organizerPinnedInput.value.trim();
    if (!value) return;
    const added = addOrganizerPinnedItem(value);
    if (!added) {
        showToast('该置顶项已存在，或内容为空', 'error');
        return;
    }
    organizerPinnedInput.value = '';
    scheduleOrganizerRefresh({
        candidates: true,
        list: organizerSortMode.value === 'pinnedPriority'
    });
}

addOrganizerPinnedBtn.addEventListener('click', handleAddPinnedInput);
organizerPinnedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleAddPinnedInput();
    }
});

organizerCommonTags.addEventListener('click', (event) => {
    const chip = event.target.closest('.organizer-chip.counted');
    if (!chip) return;
    const value = chip.dataset.value || '';
    const type = chip.dataset.type || inferPinnedItemType(value);
    toggleOrganizerPinnedItem(value, type);
    scheduleOrganizerRefresh({
        candidates: true,
        list: organizerSortMode.value === 'pinnedPriority'
    });
});

organizerCommonCategories.addEventListener('click', (event) => {
    const switchButton = event.target.closest('[data-category-switch]');
    if (switchButton) {
        const nextKey = switchButton.dataset.categorySwitch || '';
        if (nextKey && organizerCommonCategoryKey !== nextKey) {
            organizerCommonCategoryKey = nextKey;
            if (nextKey !== 'groupTags') {
                organizerGroupTagsCategoryKey = '';
                organizerGroupTagsGroupKey = '';
            }
            renderOrganizerPreview({ candidates: true });
        }
        return;
    }

    const groupRootButton = event.target.closest('[data-group-tags-root]');
    if (groupRootButton) {
        organizerGroupTagsCategoryKey = '';
        organizerGroupTagsGroupKey = '';
        renderOrganizerPreview({ candidates: true });
        return;
    }

    const groupCategoryButton = event.target.closest('[data-group-tags-category]');
    if (groupCategoryButton) {
        const nextCategoryKey = groupCategoryButton.dataset.groupTagsCategory || '';
        if (nextCategoryKey) {
            organizerGroupTagsCategoryKey = nextCategoryKey;
            organizerGroupTagsGroupKey = '';
            renderOrganizerPreview({ candidates: true });
        }
        return;
    }

    const groupButton = event.target.closest('[data-group-tags-group]');
    if (groupButton) {
        const nextGroupKey = groupButton.dataset.groupTagsGroup || '';
        if (nextGroupKey && organizerGroupTagsGroupKey !== nextGroupKey) {
            organizerGroupTagsGroupKey = nextGroupKey;
            renderOrganizerPreview({ candidates: true });
        }
        return;
    }

    const chip = event.target.closest('.organizer-chip.counted');
    if (!chip) return;
    const value = chip.dataset.value || '';
    const type = chip.dataset.type || inferPinnedItemType(value);
    toggleOrganizerPinnedItem(value, type);
    scheduleOrganizerRefresh({
        candidates: true,
        list: organizerSortMode.value === 'pinnedPriority'
    });
});

organizerPinnedList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const card = button.closest('.organizer-pinned-card');
    if (!card) return;

    const index = parseInt(card.dataset.index, 10);
    if (!Number.isFinite(index) || index < 0 || index >= organizerPinnedItemsCache.length) return;

    if (button.dataset.action === 'remove') {
        organizerPinnedItemsCache.splice(index, 1);
    } else if (button.dataset.action === 'move-up' && index > 0) {
        [organizerPinnedItemsCache[index - 1], organizerPinnedItemsCache[index]] = [organizerPinnedItemsCache[index], organizerPinnedItemsCache[index - 1]];
    } else if (button.dataset.action === 'move-down' && index < organizerPinnedItemsCache.length - 1) {
        [organizerPinnedItemsCache[index + 1], organizerPinnedItemsCache[index]] = [organizerPinnedItemsCache[index], organizerPinnedItemsCache[index + 1]];
    }

    renderOrganizerPinnedList();
    updateOrganizerPriorityStatus();
    scheduleSaveOrganizerPinnedItems();
    scheduleOrganizerRefresh({
        candidates: button.dataset.action === 'remove',
        list: organizerSortMode.value === 'pinnedPriority'
    });
});

// --- 置顶列表拖拽排序实现 ---
let pinnedDragSourceIndex = null;

organizerPinnedList.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.organizer-pinned-card');
    if (!card) return;
    pinnedDragSourceIndex = parseInt(card.dataset.index, 10);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.index);
});

organizerPinnedList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.organizer-pinned-card');
    if (card && parseInt(card.dataset.index, 10) !== pinnedDragSourceIndex) {
        card.classList.add('drag-over');
    }
});

organizerPinnedList.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.organizer-pinned-card');
    if (card) card.classList.remove('drag-over');
});

organizerPinnedList.addEventListener('drop', (e) => {
    e.preventDefault();
    const card = e.target.closest('.organizer-pinned-card');
    if (!card) return;
    
    const targetIndex = parseInt(card.dataset.index, 10);
    if (pinnedDragSourceIndex !== null && pinnedDragSourceIndex !== targetIndex) {
        const item = organizerPinnedItemsCache.splice(pinnedDragSourceIndex, 1)[0];
        organizerPinnedItemsCache.splice(targetIndex, 0, item);
        
        renderOrganizerPinnedList();
        updateOrganizerPriorityStatus();
        scheduleSaveOrganizerPinnedItems();
        scheduleOrganizerRefresh({
            candidates: false,
            list: organizerSortMode.value === 'pinnedPriority'
        });
    }
});

organizerPinnedList.addEventListener('dragend', (e) => {
    const cards = organizerPinnedList.querySelectorAll('.organizer-pinned-card');
    cards.forEach(c => {
        c.classList.remove('dragging');
        c.classList.remove('drag-over');
    });
    pinnedDragSourceIndex = null;
});

    // Organizer Events
    organizerSortMode.oninput = () => {
        syncOrganizerLargeFileSortMode({ notify: true });
        scheduleOrganizerRefresh({ list: true });
    };
    organizerSearch.oninput = () => scheduleOrganizerRefresh({ candidates: !isOrganizerLargeFileMode(), list: true });

    // 新增置顶抽屉与标签页事件
    const togglePinDrawerBtn = document.getElementById('togglePinDrawerBtn');
    if (togglePinDrawerBtn) {
        togglePinDrawerBtn.onclick = () => togglePinDrawer();
    }

    document.querySelectorAll('.pin-tab').forEach(tab => {
        tab.onclick = () => switchPinTab(tab.dataset.tab);
    });

    // 列表项点击跳转与悬停高亮
    let lastHighlightedLine = null;
    const setLineHighlight = (window.CM && CM.StateEffect) ? CM.StateEffect.define() : null;

    const highlightLine = (line) => {
        if (!editorView || !setLineHighlight) return;
        if (lastHighlightedLine !== null) {
            editorView.dispatch({ effects: setLineHighlight.of({ line: lastHighlightedLine, active: false }) });
        }
        if (line !== null) {
            editorView.dispatch({ effects: setLineHighlight.of({ line, active: true }) });
        }
        lastHighlightedLine = line;
    };

    organizerList.addEventListener('scroll', () => {
        if (
            organizerList.scrollTop + organizerList.clientHeight
            >= organizerList.scrollHeight - ORGANIZER_LIST_CHUNK_THRESHOLD
        ) {
            scheduleOrganizerListChunkAppend();
        }
    });

    organizerList.onclick = (event) => {
        const item = event.target.closest('.organizer-item');
        if (!item) return;
        const lineNumber = parseInt(item.dataset.lineNumber, 10);
        if (Number.isFinite(lineNumber)) scrollEditorToLine(lineNumber);
    };

    organizerList.onmouseover = (event) => {
        const item = event.target.closest('.organizer-item');
        if (!item) return;
        const lineNumber = parseInt(item.dataset.lineNumber, 10);
        if (Number.isFinite(lineNumber)) highlightLine(lineNumber);
    };

    organizerList.onmouseout = (event) => {
        if (!event.relatedTarget || !organizerList.contains(event.relatedTarget)) {
            highlightLine(null);
        }
    };

    applyOrganizerSortBtn.onclick = () => applyOrganizerTransformation();
    dedupeOrganizerBtn.onclick = () => confirmOrganizerTransformation({ dedupe: true });
    normalizeOrganizerBtn.onclick = () => applyOrganizerTransformation({ normalizeOnly: true });
    applyOrganizerPriorityBtn.onclick = () => applyOrganizerTransformation({ priorityTagReorder: true });
discardChangesBtn.addEventListener('click', async () => {
    if (!currentFile || !editorView) return;
    if (!hasUnsavedEditorChanges()) {
        showToast('当前没有未保存修改', 'info');
        return;
    }

    const confirmed = await customConfirm('确定要放弃当前未保存修改并恢复到上次保存状态吗？');
    if (!confirmed) return;

    replaceEditorContent(localContent || '');
    saveStatus.textContent = '';
    saveStatus.className = '';
    discardChangesBtn.disabled = true;
    scheduleOrganizerRefresh();
    showToast('已取消当前未保存修改', 'success');
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
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.groupTagsUserData) return;
    loadOrganizerGroupTagsIndex({ force: true });
});

// JSON 资源智能节流回推（3秒防抖）
let jsonSyncDebounceTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !boundDirHandle || localSyncService.isSyncing) return;
    
    // 监听专属防抖脏信号，避免被底层引擎刷入的 _lastModified 干扰循环
    const hasDirtyMark = (changes.sync_pending_favorites && changes.sync_pending_favorites.newValue) || 
                         (changes.sync_pending_grouptags && changes.sync_pending_grouptags.newValue) || 
                         (changes.sync_pending_userdict && changes.sync_pending_userdict.newValue);
                         
    if (hasDirtyMark) {
        if (changes.sync_pending_favorites && changes.sync_pending_favorites.newValue) document.getElementById('badge-favorites')?.classList.add('pending');
        if (changes.sync_pending_grouptags && changes.sync_pending_grouptags.newValue) document.getElementById('badge-grouptags')?.classList.add('pending');
        if (changes.sync_pending_userdict && changes.sync_pending_userdict.newValue) document.getElementById('badge-userdict')?.classList.add('pending');

        clearTimeout(jsonSyncDebounceTimer);
        const delayMs = (snapshotSettings.debounceTime || 10) * 1000;
        jsonSyncDebounceTimer = setTimeout(() => {
            if (boundDirHandle && !localSyncService.isSyncing) {
                // 触发底层的全维安全同步引擎，它带有 15 份快照和防呆机制
                localSyncService.scanAndPullChanges({ silent: true }).then(handleSyncResult);
            }
        }, delayMs);
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

function repositionQuickPopover() {
    if (!syncQuickPopover.classList.contains('show')) return;
    const rect = syncSettingsBtn.getBoundingClientRect();
    syncQuickPopover.style.top = `${rect.bottom + 10}px`;
    syncQuickPopover.style.left = 'auto';
    syncQuickPopover.style.right = `${window.innerWidth - rect.right}px`;
}

// Sync Settings Modal Events (Scheme 2 Popover)
syncSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShow = syncQuickPopover.classList.contains('show');
    if (!isShow) {
        const val = snapshotSettings.debounceTime || 10;
        settingSyncDebounceRange.value = val;
        settingSyncDebounceInput.value = val;
        syncQuickPopover.classList.add('show');
        repositionQuickPopover();
    } else {
        syncQuickPopover.classList.remove('show');
    }
});

settingSyncDebounceRange.addEventListener('input', () => {
    settingSyncDebounceInput.value = settingSyncDebounceRange.value;
});

settingSyncDebounceRange.addEventListener('change', async () => {
    snapshotSettings.debounceTime = parseInt(settingSyncDebounceRange.value, 10);
    await saveSnapshotSettings();
});

settingSyncDebounceInput.addEventListener('input', () => {
    let val = parseInt(settingSyncDebounceInput.value, 10);
    if (!isNaN(val)) {
        if (val < 1) val = 1;
        if (val > 60) val = 60;
        settingSyncDebounceRange.value = val;
    }
});

settingSyncDebounceInput.addEventListener('change', async () => {
    let val = parseInt(settingSyncDebounceInput.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 60) val = 60;
    settingSyncDebounceInput.value = val;
    settingSyncDebounceRange.value = val;
    snapshotSettings.debounceTime = val;
    await saveSnapshotSettings();
});

// Window and Layout Events for Popover Tracking
window.addEventListener('resize', repositionQuickPopover);
window.addEventListener('resize', () => applyOrganizerPinDrawerHeight(organizerPinDrawerHeight));
document.querySelector('.topbar').addEventListener('scroll', repositionQuickPopover);

// Diff Modal Events
closeDiffBtn.addEventListener('click', () => diffModal.classList.remove('show'));
// Close modals on outside click
// Close modals/popovers on outside click
window.addEventListener('click', (e) => {
    if (syncQuickPopover.classList.contains('show') && !syncQuickPopover.contains(e.target)) {
        syncQuickPopover.classList.remove('show');
    }
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
    saveOrganizerLayoutState(); // 保存筛选状态
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
    saveOrganizerLayoutState(); // 切换视图后保存状态
});

// ============================
// Section 14: Initialization
// ============================
async function init() {
    await initI18n();
    log(t('log_initializing'), 'info');
    
    // 恢复布局持久化状态 (通过延迟确保 DOM 变量已载入)
    chrome.storage.local.get('organizerLayoutState', (data) => {
        const layoutState = data.organizerLayoutState;
        if (layoutState && organizerPanel) {
            // 强力恢复宽度：设置 width 后再设置 flex-basis 以覆盖 CSS clamp
            if (layoutState.width) {
                organizerPanel.style.width = layoutState.width;
                organizerPanel.style.flexBasis = layoutState.flexBasis || layoutState.width;
            }

            applyOrganizerPinDrawerHeight(layoutState.drawerHeight ?? ORGANIZER_PIN_DRAWER_DEFAULT_HEIGHT);
            setOrganizerVisibility(layoutState.visible !== false);
            if (layoutState.drawerOpen) togglePinDrawer(true);
            
            // 恢复最后一次打开的文件
            if (layoutState.lastOpenedFile) {
                console.log('[Layout] Restoring file:', layoutState.lastOpenedFile);
                openFile(layoutState.lastOpenedFile);
            }
            console.log('[Layout] Memory Loaded:', {
                "上次文件": layoutState.lastOpenedFile,
                "面板宽度": layoutState.width,
                "是否显示": layoutState.visible,
                "抽屉状态": layoutState.drawerOpen ? '展开' : '收起',
                "抽屉高度": layoutState.drawerHeight ?? ORGANIZER_PIN_DRAWER_DEFAULT_HEIGHT,
                "当前视图": layoutState.currentView === 'dict' ? '字典编辑' : '通配符管理'
            });

            // 恢复视图状态 (通配符 vs 字典)
            if (layoutState.currentView === 'dict') {
                const dictBtn = viewSwitcher.querySelector('button[data-view="dict"]');
                if (dictBtn) dictBtn.click();

                // 恢复「只看变更」筛选状态
                if (layoutState.dictShowChanges && dictToggleChangesBtn) {
                    // 等待字典加载完成后再触发
                    const waitForDict = setInterval(() => {
                        if (dictLoaded) {
                            clearInterval(waitForDict);
                            if (!dictShowChanges) {
                                dictToggleChangesBtn.click();
                            }
                        }
                    }, 100);
                    // 安全超时，5秒后放弃
                    setTimeout(() => clearInterval(waitForDict), 5000);
                }
            }
        } else {
            applyOrganizerPinDrawerHeight(ORGANIZER_PIN_DRAWER_DEFAULT_HEIGHT);
            updateOrganizerToggleText();
            setOrganizerVisibility(true);
        }
    });

    renderOrganizerPreview();

    // 挂载同步看板交互反馈
    localSyncService.onSyncSuccess = (fileName, count) => {
        let id = '';
        if (fileName.endsWith('.txt')) id = 'wildcards';
        else if (fileName === 'favorites.json') id = 'favorites';
        else if (fileName === 'group_tags.json') id = 'grouptags';
        else if (fileName === 'user_dict.csv') id = 'userdict';

        if (id) {
            if (count !== undefined) assetMetadata[id].count = count;
            assetMetadata[id].lastSync = Date.now();
            
            const badge = document.getElementById(`badge-${id}`);
            if (badge) {
                badge.classList.remove('pending'); 
                badge.classList.remove('pinging');
                void badge.offsetWidth; // trigger reflow
                badge.classList.add('pinging');
                refreshDashboardUI(); 
            }
        }
    };
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
    await loadOrganizerPriorityRules();

    // Restore bound directory
    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle, false)) {
            boundDirHandle = handle;
            localSyncService.init(handle);
            updateTopUI(handle.name, 'bound');
            log(tf('log_restored_bound', { dirName: handle.name }), 'success');
            
            // 初始化安全拉取，保证用户刷新 F5 时能读取到外部最新修改
            localSyncService.scanAndPullChanges({ silent: true }).then(handleSyncResult);
            
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
    await loadOrganizerGroupTagsIndex();
    await renderSnapshotList();
    log(t('log_init_complete'), 'success');
}

document.addEventListener('DOMContentLoaded', init);

// 生命周期：当用户切回浏览器窗口时，静默自本地拉取更新
window.addEventListener('focus', async () => {
    if (boundDirHandle && !localSyncService.isSyncing && currentTopUiState === 'bound') {
        const res = await localSyncService.scanAndPullChanges({ silent: true });
        await handleSyncResult(res);
    }
});

// 核心增强：置顶项输入监听与占位符动态缩减
if (organizerPinnedInput) {
    organizerPinnedInput.addEventListener('input', () => {
        scheduleOrganizerRefresh({ candidates: true, list: true });
    });

    // 智能占位符策略：空间不足时缩减文字
    const updatePlaceholder = (width) => {
        if (width < 400) {
            organizerPinnedInput.setAttribute('placeholder', '添加项...');
        } else {
            organizerPinnedInput.setAttribute('placeholder', '添加置顶 (如 1girl)');
        }
    };

    // 监听面板宽度变化
    const panelResizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            updatePlaceholder(entry.contentRect.width);
        }
    });
    if (document.getElementById('organizerPanel')) {
        panelResizeObserver.observe(document.getElementById('organizerPanel'));
    }
}

window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedEditorChanges()) return;
    event.preventDefault();
    event.returnValue = '';
});
