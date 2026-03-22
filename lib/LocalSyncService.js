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
        // 同步成功事件回调 (用于 UI 感知)
        this.onSyncSuccess = null;
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
     * 写前强行备份机制：如果核心配置表将被覆盖，强行把上一秒的内容镜像拷贝到保险箱中
     */
    async createPreWriteBackup(fileName, sourceFileHandle) {
        if (!this.boundDirHandle) return;
        try {
            let oldFile;
            try { oldFile = await sourceFileHandle.getFile(); } catch(e) { return; }
            if (oldFile.size === 0) return; // 空文件无备份价值
            
            const content = await oldFile.text();
            
            // 拿到隐藏快照保险库的句柄
            const naiSyncHandle = await this.boundDirHandle.getDirectoryHandle('_nai_sync', { create: true });
            const snapshotsHandle = await naiSyncHandle.getDirectoryHandle('.snapshots', { create: true });
            
            // 生成时间戳文件名
            const now = new Date();
            const ts = now.getFullYear().toString() +
                      (now.getMonth() + 1).toString().padStart(2, '0') +
                      now.getDate().toString().padStart(2, '0') + '_' +
                      now.getHours().toString().padStart(2, '0') +
                      now.getMinutes().toString().padStart(2, '0') +
                      now.getSeconds().toString().padStart(2, '0');
            
            const extMatch = fileName.match(/\.([^\.]+)$/);
            const ext = extMatch ? `.${extMatch[1]}` : '';
            const baseName = extMatch ? fileName.substring(0, fileName.length - ext.length) : fileName;
            
            const backupName = `${baseName}_${ts}${ext}`;
            const backupHandle = await snapshotsHandle.getFileHandle(backupName, { create: true });
            const backupWritable = await backupHandle.createWritable();
            await backupWritable.write(content);
            await backupWritable.close();
            
            await this.pruneBackups(snapshotsHandle, baseName, ext, 10);
        } catch (e) {
            console.error(`[LocalSyncService] 预写入快照保存失败: ${fileName}`, e);
        }
    }

    async pruneBackups(snapshotsHandle, baseName, ext, maxCount) {
        try {
            const backups = [];
            for await (const [name, handle] of snapshotsHandle.entries()) {
                if (handle.kind === 'file' && name.startsWith(baseName + '_') && name.endsWith(ext)) {
                    const file = await handle.getFile();
                    backups.push({ name, time: file.lastModified });
                }
            }
            if (backups.length <= maxCount) return;
            
            // 删除旧的，保留最新的 maxCount 份
            backups.sort((a, b) => a.time - b.time);
            const toDeleteCount = backups.length - maxCount;
            for (let i = 0; i < toDeleteCount; i++) {
                await snapshotsHandle.removeEntry(backups[i].name);
            }
        } catch (e) {
            console.warn(`[LocalSyncService] 清理旧快照失败`, e);
        }
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

            // 【写前快照挂载点】：如果触犯致命名单，必须写前备份尸体
            const STRICT_BACKUP_TARGETS = ['favorites.json', 'group_tags.json', 'user_dict.csv'];
            if (STRICT_BACKUP_TARGETS.includes(fileName)) {
                await this.createPreWriteBackup(fileName, fileHandle);
            }

            // 安全写入
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();
            
            if (this.onSyncSuccess) {
                const count = this._countEntries(fileName, newContent);
                this.onSyncSuccess(fileName, count);
            }

            // 【Phase 14】广播物理同步成功事件，用于触发全域（含主界面）的绿色涟漪
            const resourceMap = {
                'favorites.json': 'favorites',
                'group_tags.json': 'grouptags',
                'user_dict.csv': 'userdict'
            };
            const resId = resourceMap[fileName];
            if (resId) {
                chrome.storage.local.set({ 
                    'last_sync_event': { id: resId, ts: Date.now(), rand: Math.random() } 
                });
            }

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
                } else if ((!prefix || prefix === '_nai_sync') && this.jsonTargets.includes(entry.name)) {
                    // 读取根目录或管理目录下的特殊配置实体 (JSON/CSV)
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
     * 【新功能】全量回传：将浏览器内存中的所有通配符写入当前绑定的磁盘文件夹
     */
    async pushAllWildcards() {
        if (!this.boundDirHandle) return { success: false, error: 'no_bound_handle' };
        
        try {
            const data = await new Promise(r => chrome.storage.local.get(['wildcards'], r));
            const wildcards = data.wildcards || {};
            let count = 0;

            for (const [key, content] of Object.entries(wildcards)) {
                await this.safeWriteFile(`${key}.txt`, content);
                count++;
            }
            console.log(`[LocalSyncService] 全量回传完成，处理了 ${count} 个文件`);
            return { success: true, count };
        } catch (e) {
            console.error('[LocalSyncService] 全量回传失败', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 自动比较并拉取变更
     */
    async scanAndPullChanges(options = { silent: false, initialBind: false }) {
        if (!this.boundDirHandle) return false;
        if (this.isSyncing) {
            console.log('[LocalSyncService Probe] isSyncing 锁定，驳回');
            return false;
        }

        this.isSyncing = true;
        let hasChanges = false;
        let local = { files: new Map(), folders: [], jsonFiles: new Map() };
        
        try {
            local = await this.scanLocalDir(this.boundDirHandle);
            
            // 1. 先进行老版本配置迁移：将根目录遗留的 JSON 配置文件迁移到 _nai_sync 目录中
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
            
            // 2. 顺手清理 _nai_sync 中可能残留的 user_dict.json
            try { await this.deleteFile('_nai_sync/user_dict.json'); } catch(e) {}

            // 3. 加载现在的全新配置大本营 _nai_sync 中的文件情况
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

            // === 【核心修复】：空目录防清空拦截 ===
            if (local.files.size === 0 && Object.keys(oldWildcards).length > 0) {
                console.warn('[LocalSyncService] 拦截到空目录同步请求，防止误清空浏览器数据。');
                this.isSyncing = false;
                return { hasChanges: false, error: 'empty_local_dir_risk' };
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
                    // 本地没有遇到此 JSON 文件
                    if (options.initialBind) {
                        // 初次绑定模式：本地没有此文件，不推送浏览器数据（因为可能是空的默认数据）
                        console.log(`[LocalSyncService] initialBind 模式：本地不存在 ${file}，跳过推送`);
                    } else if (storageDataObj && storageAge > 0) {
                        pushTasks.push({ fileName: file, key, data: storageDataObj });
                    }
                } else {
                    if (options.initialBind) {
                        // 初次绑定模式：无条件从本地 Pull，忽略浏览器时间戳
                        console.log(`[LocalSyncService] initialBind 模式：强制从本地拉取 ${file}`);
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
                    } else if (storageAge > meta.lastModified) {
                        // 日常模式：浏览器时间戳更新，Push 到磁盘
                        console.log(`[LocalSyncService] 发现 Web 离线端的修改记录 (${file}) 较本地磁盘更新，准备进行覆写回传...`);
                        pushTasks.push({ fileName: file, key, data: storageDataObj });
                    } else if (storageAge < meta.lastModified) {
                        // 日常模式：磁盘时间戳更新，Pull 到浏览器
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
                    const newContent = lines.join('\n');

                    // 【内容比对】：与磁盘现有内容对比，一致则跳过写入
                    const existingMeta = local.jsonFiles.get(task.fileName);
                    if (existingMeta && existingMeta.content.trim() === newContent.trim()) {
                        console.log(`[LocalSyncService] Push 跳过 ${task.fileName}：内容无变化`);
                        // 只拉齐浏览器端时间戳，避免下次再比
                        await new Promise(r => chrome.storage.local.set({ [`${task.key}_lastModified`]: existingMeta.lastModified }, r));
                        continue;
                    }

                    await this.safeWriteFile(`_nai_sync/${task.fileName}`, newContent);
                    await new Promise(r => chrome.storage.local.set({ [`${task.key}_lastModified`]: Date.now() }, r));
                    continue;
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

                // 【内容比对】：与磁盘现有内容对比，一致则跳过写入
                const existingJsonMeta = local.jsonFiles.get(task.fileName);
                if (existingJsonMeta) {
                    // 对于 group_tags.json，磁盘内容里的 exportedAt 每次都不同，需要剔除后比对
                    const normalize = (s) => s.replace(/"exportedAt"\s*:\s*"[^"]*"/g, '').trim();
                    if (normalize(existingJsonMeta.content) === normalize(dataStr)) {
                        console.log(`[LocalSyncService] Push 跳过 ${task.fileName}：内容无变化`);
                        await new Promise(r => chrome.storage.local.set({ [`${task.key}_lastModified`]: existingJsonMeta.lastModified }, r));
                        continue;
                    }
                }

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

        // 【Phase 16.2 修复】如果发生过变更（含 Push 写入），需要重新读取 _nai_sync 中的最新文件
        // 否则 stats 统计用的还是开头扫描时的旧 local.jsonFiles，导致 popup 徽章数量和黄灯不更新
        // 注意：不能用 scanLocalDir() 全量重扫，因为它默认跳过 _nai_sync 目录
        if (hasChanges) {
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
                    } catch(e) { /* 文件可能不存在 */ }
                }
            } catch (e) {
                console.warn('[LocalSyncService] Push 后重读 _nai_sync 失败，使用旧快照统计', e);
            }
        }

        // 计算通配符集群的最新物理时间
        let latestWildcardTime = 0;
        for (const meta of local.files.values()) {
            if (meta.lastModified > latestWildcardTime) latestWildcardTime = meta.lastModified;
        }

        const stats = {
            wildcards: {
                count: local.files.size,
                lastModified: latestWildcardTime
            },
            favorites: {
                count: this._countEntries('favorites.json', local.jsonFiles.get('favorites.json')?.content),
                lastModified: local.jsonFiles.get('favorites.json')?.lastModified || 0
            },
            grouptags: {
                count: this._countEntries('group_tags.json', local.jsonFiles.get('group_tags.json')?.content),
                lastModified: local.jsonFiles.get('group_tags.json')?.lastModified || 0
            },
            userdict: {
                count: this._countEntries('user_dict.csv', local.jsonFiles.get('user_dict.csv')?.content),
                lastModified: local.jsonFiles.get('user_dict.csv')?.lastModified || 0
            }
        };

        // 【Phase 16.4 修复】清理挂起的专属防抖标志，表示已将脏数据成功落盘
        await new Promise(r => chrome.storage.local.remove([
            'sync_pending_favorites', 'sync_pending_grouptags', 'sync_pending_userdict'
        ], r));

        // 【Phase 14】持久化统计快照，供主界面（Popup）在无需重新扫描的情况下展示
        chrome.storage.local.set({ 'sync_stats_cache': stats });

        return { hasChanges, stats };
    }

    /**
     * 辅助统计不同格式文件的条目数
     */
    _countEntries(fileName, content) {
        try {
            if (!content) return 0;
            if (fileName.endsWith('.json')) {
                let data = JSON.parse(content);
                // 兼容多层嵌套的外壳格式
                if (data && data.format === 'prompt-history-export' && data.data) data = data.data;
                if (data && data.format === 'group-tags-export' && data.data) data = data.data;
                if (data && data.data && !data.categories) data = data.data; // 再次纠偏


                if (fileName === 'favorites.json') {
                    // 仅统计真正的收藏条目，排除文件夹本身
                    return Array.isArray(data) ? data.filter(s => s && s.isFavorite && !s.isFolder).length : 0;
                }
                if (fileName === 'group_tags.json') {
                    let total = 0;
                    if (data.categories) {
                        data.categories.forEach(c => {
                            (c.groups || []).forEach(g => {
                                total += (g.tags || []).length;
                            });
                        });
                    }
                    return total;
                }
            }
            if (fileName.endsWith('.csv')) {
                const lines = content.split('\n').filter(l => l.trim());
                // 排除表头，且兼容没有内容的情况
                return Math.max(0, lines.length - 1);
            }
        } catch (e) {
            console.warn(`[LocalSyncService] 统计文件 ${fileName} 失败:`, e);
        }
        return 0;
    }
}

// 导出一个单例实例
export const localSyncService = new LocalSyncService();
