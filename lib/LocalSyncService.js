/**
 * LocalSyncService.js
 * 同步中心：实时增量同步的核心引擎
 */

export class LocalSyncService {
    constructor() {
        this.boundDirHandle = null;
        this.isSyncing = false;
        
        // 我们监控的具体文件路径列表（支持扩展）
        // 对于 wildcards 本地的目录树，我们不硬编码，通过 scan 获取
        // 对于特定的 json 文件，我们予以特判
        this.jsonTargets = [
            'favorites.json',
            'group_tags.json',
            'user_dict.csv'
        ];
        this.legacyTargets = [
            'user_dict.json'
        ];
        
        // 自动快照委托回调
        this.snapshotCallback = null;
    }

    /**
     * 注册快照回调函数 (通常由 sync.js 提供，因 IDB 操作在 sync 中)
     */
    registerSnapshotCallback(callback) {
        this.snapshotCallback = callback;
    }

    init(dirHandle) {
        this.boundDirHandle = dirHandle;
    }

    clear() {
        this.boundDirHandle = null;
    }

    /**
     * 安全地向本地写入文件数据
     * @param {string} filePath 文件相对路径 (例如 'wildcards/characters/alice.txt' 或 'favorites.json')
     * @param {string} newContent 文件内容
     * @param {number|null} lastKnownModifiedTime 内存中已知该文件的最后修改时间。用于防冲突检查。
     * @returns {Promise<boolean>} 是否写入成功
     */
    async safeWriteFile(filePath, newContent, lastKnownModifiedTime = null) {
        if (!this.boundDirHandle) return false;
        
        try {
            const parts = filePath.split('/');
            const fileName = parts.pop();
            let targetDir = this.boundDirHandle;
            
            // 确保全路径文件夹都存在
            for (const part of parts) {
                targetDir = await targetDir.getDirectoryHandle(part, { create: true });
            }

            const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
            
            // 防冲突机制 (Conflict Assertion)
            if (lastKnownModifiedTime) {
                const file = await fileHandle.getFile();
                if (file.lastModified > lastKnownModifiedTime) {
                    console.warn(`[LocalSyncService] 冲突拦截: 本地文件 ${filePath} 已被外部编辑器修改，阻止了覆盖写入。`);
                    return false; // 抛弃写入，由后续的 pull 逻辑去解决冲突
                }
            }

            // 安全写入
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();
            
            console.log(`[LocalSyncService] 成功写入本地: ${filePath}`);
            return true;
        } catch (e) {
            console.error(`[LocalSyncService] 写入失败: ${filePath}`, e);
            return false;
        }
    }

    /**
     * 删除文件
     */
    async deleteFile(filePath) {
        if (!this.boundDirHandle) return false;
        
        try {
            const parts = filePath.split('/');
            const fileName = parts.pop();
            let targetDir = this.boundDirHandle;
            
            for (const part of parts) {
                targetDir = await targetDir.getDirectoryHandle(part, { create: false });
            }
            
            await targetDir.removeEntry(fileName);
            console.log(`[LocalSyncService] 成功删除本地文件: ${filePath}`);
            return true;
        } catch (e) {
            // 文件不存在就算了
            console.warn(`[LocalSyncService] 删除本地文件失败或文件已不存在: ${filePath}`);
            return false;
        }
    }

    /**
     * 删除文件夹
     */
    async deleteFolder(folderPath) {
        if (!this.boundDirHandle) return false;
        try {
            const parts = folderPath.split('/');
            const folderName = parts.pop();
            let targetDir = this.boundDirHandle;

            for (const part of parts) {
                targetDir = await targetDir.getDirectoryHandle(part, { create: false });
            }

            await targetDir.removeEntry(folderName, { recursive: true });
            console.log(`[LocalSyncService] 成功删除本地目录: ${folderPath}`);
            return true;
        } catch (e) {
            console.warn(`[LocalSyncService] 删除本地目录失败或已不存在: ${folderPath}`);
            return false;
        }
    }

    /**
     * 重命名/移动文件
     */
    async moveFile(oldPath, newPath, newContent) {
        if (!this.boundDirHandle) return false;
        // 因为 File System Access API 目前缺乏直接的 rename，我们以写+删来实现
        const writeSuccess = await this.safeWriteFile(newPath, newContent);
        if (writeSuccess) {
            await this.deleteFile(oldPath);
            return true;
        }
        return false;
    }

    /**
     * 递归扫描本地目录的内容和修改时间
     */
    async scanLocalDir(handle, prefix = '', skipDirs = ['.snapshots', '_nai_sync']) {
        const files = new Map();
        const folders = [];
        const jsonFiles = new Map(); // 用于存放根目录的系统 JSON 配置

        for await (const entry of handle.values()) {
            if (entry.kind === 'directory') {
                if (skipDirs.includes(entry.name)) continue;
                const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                folders.push(folderPath);
                
                const subDir = await handle.getDirectoryHandle(entry.name);
                const sub = await this.scanLocalDir(subDir, folderPath, skipDirs);
                for (const [k, v] of sub.files) files.set(k, v);
                for (const f of sub.folders) folders.push(f);
                
            } else if (entry.kind === 'file') {
                if (entry.name.endsWith('.txt')) {
                    const file = await entry.getFile();
                    const baseName = entry.name.replace(/\.txt$/i, '');
                    const key = prefix ? `${prefix}/${baseName}` : baseName;
                    files.set(key, {
                        content: await file.text(),
                        lastModified: file.lastModified
                    });
                } else if (!prefix && this.jsonTargets.includes(entry.name)) {
                    // 只读取根目录下的特殊 JSON
                    const file = await entry.getFile();
                    jsonFiles.set(entry.name, {
                        content: await file.text(),
                        lastModified: file.lastModified
                    });
                }
            }
        }
        return { files, folders, jsonFiles }; // 放回 jsonFiles
    }

    /**
     * 自动比较并拉取变更
     */
    async scanAndPullChanges(options = { silent: false }) {
        if (!this.boundDirHandle) return false;
        if (this.isSyncing) {
            console.log('[LocalSyncService Probe] isSyncing 锁定，驳回');
            return false;
        }

        this.isSyncing = true;
        let hasChanges = false;
        
        try {
            const local = await this.scanLocalDir(this.boundDirHandle);
            
            const allTargets = [...this.jsonTargets, ...this.legacyTargets];
            for (const target of allTargets) {
                 if (local.jsonFiles.has(target)) {
                     if (this.legacyTargets.includes(target)) {
                         // 废弃旧的 user_dict.json，因为内存里有热数据，同步会自动生成新的 .csv
                         await this.deleteFile(target);
                         local.jsonFiles.delete(target);
                         continue;
                     }
                     const meta = local.jsonFiles.get(target);
                     await this.safeWriteFile(`_nai_sync/${target}`, meta.content);
                     await this.deleteFile(target);
                     console.log(`[LocalSyncService] 成功将老版本根目录配置 ${target} 迁移至 _nai_sync/ 文件夹保护区`);
                     local.jsonFiles.delete(target);
                 }
            }
            
            // 顺手清理 _nai_sync 中可能残留的 user_dict.json
            try { await this.deleteFile('_nai_sync/user_dict.json'); } catch(e) {}

            // 加载现在的全新配置大本营 _nai_sync 中的文件情况
            try {
                const configDirHandle = await this.boundDirHandle.getDirectoryHandle('_nai_sync');
                for (const target of this.jsonTargets) {
                    try {
                        const fileHandle = await configDirHandle.getFileHandle(target);
                        const file = await fileHandle.getFile();
                        local.jsonFiles.set(target, {
                            content: await file.text(),
                            lastModified: file.lastModified
                        });
                    } catch(e) { }
                }
            } catch(e) {
                // _nai_sync 此时可能还未创建，无需报错，后续有写入时自然会自动创建
            }

            // 读取最新的存储信息以判断 JSON 与本地文件的修改新旧，以及取出 wildcards 用于落差比对
            const storageData = await new Promise(r => chrome.storage.local.get([
                'wildcards', 'lastAutoSnapshotTime',
                'promptHistory', 'promptHistory_lastModified',
                'groupTagsUserData', 'groupTagsUserData_lastModified',
                'dictOverlay', 'dictOverlay_lastModified'
            ], r));

            const updates = {};
            const pushTasks = [];
            
            // 1. 通配符数据比对与防灾备份
            const oldWildcards = storageData.wildcards || {};
            const localWildcards = {};
            for (const [key, meta] of local.files) {
                localWildcards[key] = meta.content;
            }

            // === 拦截网：智能大落差检测与自动快照兜底 ===
            if (this.snapshotCallback) {
                let triggerReason = null;
                const now = Date.now();
                const lastSnap = storageData.lastAutoSnapshotTime || 0;
                
                // 方案一：定期兜底 (距离上次超过 1 小时)
                if (now - lastSnap > 60 * 60 * 1000) {
                    triggerReason = '阶段性自动备份';
                } else {
                    // 方案二：智能血条判定
                    const oldKeys = Object.keys(oldWildcards);
                    const newKeys = Object.keys(localWildcards);
                    let oldLen = 0, newLen = 0;
                    for (const k of oldKeys) oldLen += oldWildcards[k].length;
                    for (const k of newKeys) newLen += localWildcards[k].length;

                    if (oldKeys.length > 0 && newKeys.length === 0) {
                        triggerReason = '【极危】本地通配符全部丢失前备份';
                    } else if (oldKeys.length - newKeys.length >= 3 || (oldKeys.length > 0 && newKeys.length < oldKeys.length * 0.8)) {
                        triggerReason = '【警告】本地文件大面积流失前备份';
                    } else if (oldLen - newLen > 5000 || (oldLen > 0 && newLen < oldLen * 0.9)) {
                        triggerReason = '【警告】本地内容大面积截断前备份';
                    }
                }

                if (triggerReason) {
                    try {
                        console.log(`[LocalSyncService] 触发安全快照拦截: ${triggerReason}`);
                        await this.snapshotCallback(triggerReason, 'auto');
                        updates.lastAutoSnapshotTime = now;
                    } catch (e) {
                        console.error('[LocalSyncService] 自动快照拦截执行失败:', e);
                    }
                }
            }

            updates.wildcards = localWildcards;
            updates.wildcardFolders = local.folders;
            
            const jsonSchema = [
                { file: 'favorites.json', key: 'promptHistory' },
                { file: 'group_tags.json', key: 'groupTagsUserData' },
                { file: 'user_dict.csv', key: 'dictOverlay' }
            ];

            // 2. JSON 数据双向合并
            for (const { file, key } of jsonSchema) {
                const meta = local.jsonFiles.get(file);
                const storageAge = storageData[`${key}_lastModified`] || 0;
                const storageDataObj = storageData[key];

                if (!meta) {
                    // 本地没有遇到此 JSON 文件，如果是本地有缓存且有过变动，则推送到本地创建它
                    if (storageDataObj && storageAge > 0) {
                        pushTasks.push({ fileName: file, key, data: storageDataObj });
                    }
                } else {
                    // 有此文件，时间戳竞强
                    if (storageAge > meta.lastModified) {
                        console.log(`[LocalSyncService] 发现 Web 离线端的修改记录 (${file}) 较本地磁盘更新，准备进行覆写回传...`);
                        pushTasks.push({ fileName: file, key, data: storageDataObj });
                    } else if (storageAge < meta.lastModified) {
                        try {
                            let parsed;
                            if (file === 'user_dict.csv') {
                                const lines = meta.content.split('\n');
                                const parsedOverlay = {};
                                const parsedNewEntries = [];
                                
                                const parseCSVLine = (line) => {
                                    const result = [];
                                    let current = '';
                                    let inQuotes = false;
                                    for (let i = 0; i < line.length; i++) {
                                        const char = line[i];
                                        if (inQuotes) {
                                            if (char === '"') {
                                                if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
                                            } else { current += char; }
                                        } else {
                                            if (char === '"') { inQuotes = true; } 
                                            else if (char === ',') { result.push(current); current = ''; } 
                                            else { current += char; }
                                        }
                                    }
                                    result.push(current);
                                    return result;
                                };

                                for (const line of lines) {
                                    const l = line.trim();
                                    if (!l) continue;
                                    const parts = parseCSVLine(l);
                                    const tag = parts[0];
                                    if (!tag) continue;
                                    
                                    const color = parseInt(parts[1]) || 0;
                                    const count = parseInt(parts[2]) || 0;
                                    const aliases = parts[3] || '';
                                    const zhCN = parts[4] || '';
                                    const type = parts[5] || '';
                                    
                                    if (type === 'new') {
                                        parsedNewEntries.push({ tag, color, count, aliases, zhCN, _new: true });
                                    } else {
                                        parsedOverlay[tag] = { color, count, aliases, zhCN };
                                    }
                                }
                                parsed = JSON.stringify({ overlay: parsedOverlay, newEntries: parsedNewEntries });
                            } else {
                                parsed = JSON.parse(meta.content);
                                // 兼容 GroupTags 手动导出格式的外壳剥离
                                if (file === 'group_tags.json' && parsed.format === 'group-tags-export' && parsed.data) { parsed = parsed.data; }
                                else if (file === 'favorites.json' && Array.isArray(parsed)) {
                                    const currentHistory = storageDataObj || [];
                                    const normalHistory = currentHistory.filter(s => !s.isFavorite && !s.isFolder);
                                    parsed = normalHistory.concat(parsed).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
                                }
                            }
                            updates[key] = parsed;
                            updates[`${key}_lastModified`] = meta.lastModified;
                            hasChanges = true;
                        } catch (e) {
                            console.error(`[LocalSyncService] JSON 解析失败: ${file}`, e);
                        }
                    }
                }
            }

            if (Object.keys(updates).length > 0) {
                await new Promise(r => chrome.storage.local.set(updates, r));
                // 这里本身由于包含了 _lastModified，因此后台拦截器不会再次踩踏
            }

            // 3. 处理需要退写到文件的变脏节点
            for (const task of pushTasks) {
                if (task.fileName === 'user_dict.csv') {
                    const escapeCsv = (str) => {
                        if (typeof str !== 'string') return str;
                        return /[,"\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
                    };
                    let dictObj = { overlay: {}, newEntries: [] };
                    try {
                        if (typeof task.data === 'string') dictObj = JSON.parse(task.data);
                        else dictObj = task.data;
                    } catch(e) {}
                    
                    const lines = [];
                    const overlay = dictObj.overlay || {};
                    for (const [tag, item] of Object.entries(overlay)) {
                        if (item._deleted) continue;
                        lines.push(`${escapeCsv(tag)},${item.color||0},${item.count||0},${escapeCsv(item.aliases||'')},${escapeCsv(item.zhCN||'')},ov`);
                    }
                    const newEntries = dictObj.newEntries || [];
                    for (const item of newEntries) {
                        lines.push(`${escapeCsv(item.tag)},${item.color||0},${item.count||0},${escapeCsv(item.aliases||'')},${escapeCsv(item.zhCN||'')},new`);
                    }
                    await this.safeWriteFile(`_nai_sync/${task.fileName}`, lines.join('\n'));
                    await new Promise(r => chrome.storage.local.set({ [`${task.key}_lastModified`]: Date.now() }, r));
                    continue; // 跨过下方 JSON 的常规逻辑
                }

                let exportPayload = task.data;
                // 兼容 GroupTags 手动导出格式的外壳包裹
                if (task.fileName === 'group_tags.json') {
                    exportPayload = {
                        format: 'group-tags-export',
                        schemaVersion: 1,
                        exportedAt: new Date().toISOString(),
                        data: task.data
                    };
                } else if (task.fileName === 'favorites.json' && Array.isArray(task.data)) {
                    // 仅向硬盘输出纯正的收藏内容，剔除掉普通临时历史记录
                    exportPayload = task.data.filter(s => s.isFavorite || s.isFolder);
                }
                const dataStr = typeof exportPayload === 'string' ? exportPayload : JSON.stringify(exportPayload, null, 2);
                await this.safeWriteFile(`_nai_sync/${task.fileName}`, dataStr);
                
                // 写回后，为了拉齐防止下次又因为外部时间被意外拔高造成拉取覆盖，用 Date.now() 更新内存记录
                await new Promise(r => chrome.storage.local.set({ [`${task.key}_lastModified`]: Date.now() }, r));
            }

            hasChanges = hasChanges || pushTasks.length > 0;

        } catch (e) {
            console.error('[LocalSyncService] 发生崩溃异常', e);
        } finally {
            this.isSyncing = false;
        }

        return hasChanges;
    }
}

// 导出一个单例实例
export const localSyncService = new LocalSyncService();
