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
        chrome.tabs.create({ url: chrome.runtime.getURL('sync.html') });
        sendResponse({ success: true });
        return false;
    }
});
