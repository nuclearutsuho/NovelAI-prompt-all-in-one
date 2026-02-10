// Wildcard Local Sync - File System Access API
const DIR_HANDLE_KEY = 'wildcardDirHandle';
const DB_NAME = 'WildcardSyncDB';
const STORE_NAME = 'handles';

const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const linkBtn = document.getElementById('linkBtn');
const unlinkBtn = document.getElementById('unlinkBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const syncActions = document.getElementById('syncActions');
const logEl = document.getElementById('log');

function log(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

// IndexedDB 函数
function openSyncDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveDirHandle(handle) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, DIR_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getDirHandle() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(DIR_HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function removeDirHandle() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(DIR_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function verifyPermission(handle) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    try {
        if (await handle.queryPermission(opts) === 'granted') return true;
        if (await handle.requestPermission(opts) === 'granted') return true;
    } catch (e) {
        console.error('verifyPermission error:', e);
    }
    return false;
}

function updateUI(dirName) {
    if (dirName) {
        statusText.textContent = `已绑定: ${dirName}`;
        statusEl.classList.add('linked');
        linkBtn.style.display = 'none';
        unlinkBtn.style.display = 'inline-block';
        syncActions.style.display = 'block';
    } else {
        statusText.textContent = '未绑定本地文件夹';
        statusEl.classList.remove('linked');
        linkBtn.style.display = 'inline-block';
        unlinkBtn.style.display = 'none';
        syncActions.style.display = 'none';
    }
}

async function init() {
    log('初始化...', 'info');

    // 检查 chrome API 是否可用 (Check if chrome API is available)
    if (typeof chrome === 'undefined') {
        log('错误: chrome API 不可用！请确保通过扩展打开此页面', 'error');
        statusText.textContent = 'Chrome API 不可用';
        linkBtn.disabled = true;
        return;
    }

    log('chrome API 可用', 'success');

    if (typeof chrome.storage === 'undefined') {
        log('错误: chrome.storage 不可用', 'error');
        statusText.textContent = 'Storage API 不可用';
        linkBtn.disabled = true;
        return;
    }

    log('chrome.storage API 可用', 'success');

    // 检查 File System API 是否可用
    if (typeof window.showDirectoryPicker !== 'function') {
        log('错误: File System Access API 不可用', 'error');
        statusText.textContent = 'API 不可用';
        linkBtn.disabled = true;
        return;
    }

    log('File System Access API 可用', 'success');

    try {
        const handle = await getDirHandle();
        if (handle && await verifyPermission(handle)) {
            updateUI(handle.name);
            log(`已恢复绑定: ${handle.name}`, 'success');
        } else {
            updateUI(null);
            log('未绑定文件夹', 'info');
        }
    } catch (e) {
        log(`初始化错误: ${e.message}`, 'error');
        updateUI(null);
    }
}

linkBtn.addEventListener('click', async () => {
    log('点击绑定按钮...', 'info');
    try {
        log('正在打开文件夹选择器...', 'info');
        const dirHandle = await window.showDirectoryPicker();
        log(`已选择: ${dirHandle.name}`, 'info');
        await saveDirHandle(dirHandle);
        updateUI(dirHandle.name);
        log(`已绑定: ${dirHandle.name}`, 'success');
    } catch (e) {
        if (e.name === 'AbortError') {
            log('用户取消选择', 'info');
        } else {
            log(`绑定失败: ${e.name} - ${e.message}`, 'error');
            console.error('linkDirectory error:', e);
        }
    }
});

unlinkBtn.addEventListener('click', async () => {
    await removeDirHandle();
    updateUI(null);
    log('已解除绑定', 'info');
});

exportBtn.addEventListener('click', async () => {
    try {
        const handle = await getDirHandle();
        if (!handle || !await verifyPermission(handle)) {
            return log('请先绑定文件夹', 'error');
        }

        log('开始导出...', 'info');

        // 直接使用 chrome.storage (Use chrome.storage directly)
        const data = await new Promise(r => chrome.storage.local.get(['wildcards', 'wildcardFolders'], r));
        const wildcards = data.wildcards || {};
        const folders = data.wildcardFolders || [];

        // 辅助函数: 递归创建嵌套文件夹 (Helper: recursively create nested folders)
        async function ensureDir(rootHandle, pathParts) {
            let current = rootHandle;
            for (const part of pathParts) {
                current = await current.getDirectoryHandle(part, { create: true });
            }
            return current;
        }

        // 创建文件夹 (Create folders)
        for (const folder of folders) {
            const parts = folder.split('/');
            await ensureDir(handle, parts);
            log(`创建文件夹: ${folder}`, 'info');
        }

        // 写入文件 (Write files)
        let count = 0;
        for (const [key, content] of Object.entries(wildcards)) {
            const parts = key.split('/');
            const fileName = parts.pop() + '.txt';

            // 获取目标文件夹 (Get target folder)
            let targetDir = handle;
            if (parts.length > 0) {
                targetDir = await ensureDir(handle, parts);
            }

            const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            count++;
        }

        log(`导出完成! 共 ${count} 个文件`, 'success');
    } catch (e) {
        log(`导出失败: ${e.message}`, 'error');
        console.error('Export error:', e);
    }
});

importBtn.addEventListener('click', async () => {
    try {
        const handle = await getDirHandle();
        if (!handle || !await verifyPermission(handle)) {
            return log('请先绑定文件夹', 'error');
        }

        log('开始导入...', 'info');

        const wildcards = {};
        const folders = [];

        async function readDir(dirHandle, prefix = '') {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'directory') {
                    const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                    folders.push(folderPath);
                    log(`发现文件夹: ${folderPath}`, 'info');
                    const subDir = await dirHandle.getDirectoryHandle(entry.name);
                    await readDir(subDir, folderPath);
                } else if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
                    const file = await entry.getFile();
                    const baseName = entry.name.replace(/\.txt$/i, '');
                    const key = prefix ? `${prefix}/${baseName}` : baseName;
                    wildcards[key] = await file.text();
                }
            }
        }

        await readDir(handle);

        // 直接使用 chrome.storage 保存数据 (Save data via chrome.storage directly)
        await new Promise(r => chrome.storage.local.set({
            wildcards,
            wildcardFolders: folders
        }, r));

        const fileCount = Object.keys(wildcards).length;
        log(`导入完成! ${fileCount} 个文件, ${folders.length} 个文件夹`, 'success');
    } catch (e) {
        log(`导入失败: ${e.message}`, 'error');
    }
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
