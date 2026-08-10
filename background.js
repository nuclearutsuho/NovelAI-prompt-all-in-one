// 后台 Service Worker：负责跨页面消息、默认数据安装和同步脏标记。
importScripts('lib/storage/extension-storage.js');

const storageRepository = globalThis.NaiAioStorage.createRepository(chrome.storage.local, {
    logger: console
});

storageRepository.ensureMigrated().catch(error => {
    console.error('[Background] 扩展存储迁移失败:', error);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getWildcards') {
        storageRepository.get(['wildcards', 'wildcardFolders'])
            .then(sendResponse)
            .catch(error => sendResponse({ error: String(error) }));
        return true;
    }

    if (request.action === 'setWildcards') {
        storageRepository.set({
            wildcards: request.wildcards,
            wildcardFolders: request.wildcardFolders
        })
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: String(error) }));
        return true;
    }

    if (request.action === 'openSyncPage') {
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/sync.html') });
        sendResponse({ success: true });
        return false;
    }
});

// 初次安装时注入默认通配符词库
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        try {
            const data = await storageRepository.get(['wildcards']);
            if (!data.wildcards || Object.keys(data.wildcards).length === 0) {
                const defaultFiles = ['东方人物.txt', '画师1348-danbooru超过1000张图的.txt'];
                const wildcards = {};
                for (const file of defaultFiles) {
                    try {
                        const url = chrome.runtime.getURL(`default_wildcards/${file}`);
                        const response = await fetch(url);
                        if (response.ok) {
                            wildcards[file] = await response.text();
                            console.log(`Loaded default wildcard: ${file}`);
                        }
                    } catch (err) {
                        console.error(`Failed to load default wildcard: ${file}`, err);
                    }
                }
                if (Object.keys(wildcards).length > 0) {
                    await storageRepository.set({ wildcards });
                    console.log('Default wildcards injected successfully.');
                }
            }
        } catch (e) {
            console.error('Error injecting default wildcards:', e);
        }
    }
});

// ===== JSON 变脏拦截器 =====
// 当扩展跨域修改诸如收藏夹、标签组等资源时，由于当前没有绑定目录读写权限，
// 借助 background 在内存标出最新的修改时间，供 Sync 引擎重联时执行 Push 同步
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    const timeUpdates = {};
    const now = Date.now();

    // 如果修改伴随了 _lastModified 字段（来自 sync 拉取时的操作），则绕过
    if (changes.promptHistory && !changes.promptHistory_lastModified) {
        // 只在收藏/文件夹部分真正变化时才打时间戳，忽略临时历史记录的更新
        const extractFavFingerprint = (arr) => {
            if (!Array.isArray(arr)) return '';
            return JSON.stringify(
                arr.filter(s => s && (s.isFavorite || s.isFolder))
                   .map(s => ({ id: s.id, name: s.name, positive: s.positive, negative: s.negative, isFavorite: s.isFavorite, isFolder: s.isFolder, children: s.children, folderId: s.folderId, sortOrder: s.sortOrder }))
            );
        };
        const oldFav = extractFavFingerprint(changes.promptHistory.oldValue);
        const newFav = extractFavFingerprint(changes.promptHistory.newValue);
        if (oldFav !== newFav) {
            timeUpdates.promptHistory_lastModified = now;
            timeUpdates.sync_pending_favorites = true;
        }
    }
    if (changes.groupTagsUserData && !changes.groupTagsUserData_lastModified) {
        timeUpdates.groupTagsUserData_lastModified = now;
        timeUpdates.sync_pending_grouptags = true;
    }
    if (changes.dictOverlay && !changes.dictOverlay_lastModified) {
        timeUpdates.dictOverlay_lastModified = now;
        timeUpdates.sync_pending_userdict = true;
    }

    if (Object.keys(timeUpdates).length > 0) {
        storageRepository.set(timeUpdates).catch(error => {
            console.error('[Background] 保存同步脏标记失败:', error);
        });
    }
});

// ===== Sync 页面存活心跳 (支持多开检测) =====
// sync.html 打开时通过 Port 连接通知后台，关闭/崩溃时 Chrome 自动触发 onDisconnect
const activeSyncPorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sync-heartbeat') return;
    
    activeSyncPorts.add(port);
    storageRepository.set({ syncPageActive: true }).catch(() => {});
    
    port.onDisconnect.addListener(() => {
        activeSyncPorts.delete(port);
        // 只有当所有 sync 页面都关闭时，才将挂载状态标为 false
        if (activeSyncPorts.size === 0) {
            storageRepository.set({ syncPageActive: false }).catch(() => {});
        }
    });
});
