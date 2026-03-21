// Background Service Worker for Wildcard Sync
// 处理来自 sync.html 的存储请求 (Handle storage requests from sync.html)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getWildcards') {
        chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
            sendResponse(data);
        });
        return true; // 异步响应 (Async response)
    }

    if (request.action === 'setWildcards') {
        chrome.storage.local.set({
            wildcards: request.wildcards,
            wildcardFolders: request.wildcardFolders
        }, () => {
            sendResponse({ success: true });
        });
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
            const data = await chrome.storage.local.get(['wildcards']);
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
                    await chrome.storage.local.set({ wildcards });
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
        timeUpdates.promptHistory_lastModified = now;
    }
    if (changes.groupTagsUserData && !changes.groupTagsUserData_lastModified) {
        timeUpdates.groupTagsUserData_lastModified = now;
    }
    if (changes.dictOverlay && !changes.dictOverlay_lastModified) {
        timeUpdates.dictOverlay_lastModified = now;
    }

    if (Object.keys(timeUpdates).length > 0) {
        chrome.storage.local.set(timeUpdates);
    }
});

// ===== Sync 页面存活心跳 =====
// sync.html 打开时通过 Port 连接通知后台，关闭/崩溃时 Chrome 自动触发 onDisconnect
let syncPagePort = null;
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sync-heartbeat') return;
    syncPagePort = port;
    chrome.storage.local.set({ syncPageActive: true });
    port.onDisconnect.addListener(() => {
        syncPagePort = null;
        chrome.storage.local.set({ syncPageActive: false });
    });
});
