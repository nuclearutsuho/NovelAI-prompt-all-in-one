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
