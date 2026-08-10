/**
 * 将扁平通配符路径转换为树形结构。
 */
export function buildFileTreeData(wildcards = {}, folders = []) {
    const root = { name: '', children: {}, files: [] };

    for (const folder of folders || []) {
        const parts = String(folder || '').split('/').filter(Boolean);
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) {
                node.children[part] = { name: part, children: {}, files: [] };
            }
            node = node.children[part];
        }
    }

    for (const key of Object.keys(wildcards || {})) {
        const parts = key.split('/');
        const fileName = parts.pop();
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) {
                node.children[part] = { name: part, children: {}, files: [] };
            }
            node = node.children[part];
        }
        node.files.push({ key, name: fileName });
    }

    return root;
}

/**
 * 文件夹移动后同步重写自身及子路径。
 */
export function remapNestedPath(path, oldPath, newPath) {
    const value = String(path || '');
    if (value === oldPath) return newPath;
    const prefix = `${oldPath}/`;
    if (!value.startsWith(prefix)) return value;
    return `${newPath}/${value.slice(prefix.length)}`;
}

function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * 同步页文件树控制器：统一管理选择、展开、拖放、删除和渲染。
 */
export default function createFileTreeController(options = {}) {
    const {
        storage,
        localSyncService,
        scope,
        elements,
        t,
        tf,
        log,
        showToast,
        confirmDelete,
        confirmOverwrite = globalThis.confirm,
        escapeHtml,
        openFile,
        closeEditor,
        getCurrentFile,
        onCurrentFileMoved,
        documentRef = globalThis.document
    } = options;

    if (!storage || !localSyncService || !scope?.on || !elements?.fileTree) {
        throw new Error('[FileTreeController] 缺少存储、同步服务、生命周期或文件树元素');
    }

    const { fileTree, newItemName } = elements;
    const expandedFolders = new Set();
    let selectedFolder = null;
    let refreshSequence = 0;

    function getSelectedFolder() {
        return selectedFolder;
    }

    function expandFolder(folder) {
        const path = String(folder || '').trim();
        if (path) expandedFolders.add(path);
    }

    function handleDragStart(event, type, path) {
        event.dataTransfer.setData('application/wildcard-type', type);
        event.dataTransfer.setData('application/wildcard-path', path);
        event.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.classList.add('drag-over');
    }

    function handleDragLeave(event) {
        event.currentTarget.classList.remove('drag-over');
    }

    function remapFolderUiState(oldPath, newPath) {
        const nextExpanded = Array.from(expandedFolders, path => remapNestedPath(path, oldPath, newPath));
        expandedFolders.clear();
        nextExpanded.forEach(path => expandedFolders.add(path));
        if (selectedFolder) selectedFolder = remapNestedPath(selectedFolder, oldPath, newPath);
    }

    async function moveFile(oldPath, newPath, wildcards, folders) {
        if (hasOwn(wildcards, newPath) && !confirmOverwrite(tf('confirm_overwrite_file', { key: newPath }))) {
            return false;
        }

        if (localSyncService.boundDirHandle) {
            const moved = await localSyncService.moveFile(`${oldPath}.txt`, `${newPath}.txt`, wildcards[oldPath]);
            if (!moved) throw new Error(`无法移动本地文件 ${oldPath}`);
        }

        wildcards[newPath] = wildcards[oldPath];
        delete wildcards[oldPath];
        await storage.set({ wildcards, wildcardFolders: folders });

        if (getCurrentFile() === oldPath) onCurrentFileMoved(newPath);
        return true;
    }

    async function moveFolder(oldPath, newPath, wildcards, folders) {
        const oldPrefix = `${oldPath}/`;
        const newPrefix = `${newPath}/`;
        const movingEntries = Object.entries(wildcards).filter(([key]) => key.startsWith(oldPrefix));

        // 在触碰本地文件之前一次性完成冲突确认，避免用户取消后留下半次移动。
        for (const [oldKey] of movingEntries) {
            const newKey = `${newPrefix}${oldKey.slice(oldPrefix.length)}`;
            if (hasOwn(wildcards, newKey) && !confirmOverwrite(tf('confirm_overwrite_file', { key: newKey }))) {
                return false;
            }
        }

        const nextWildcards = {};
        for (const [key, content] of Object.entries(wildcards)) {
            if (!key.startsWith(oldPrefix)) nextWildcards[key] = content;
        }
        for (const [oldKey, content] of movingEntries) {
            nextWildcards[`${newPrefix}${oldKey.slice(oldPrefix.length)}`] = content;
        }

        const nextFolders = Array.from(new Set(folders.map(folder => (
            remapNestedPath(folder, oldPath, newPath)
        ))));

        if (localSyncService.boundDirHandle) {
            const moved = await localSyncService.moveFolder(
                oldPath,
                newPath,
                Object.fromEntries(movingEntries),
                folders
            );
            if (!moved) throw new Error(`无法移动本地文件夹 ${oldPath}`);
        }

        await storage.set({ wildcards: nextWildcards, wildcardFolders: nextFolders });
        remapFolderUiState(oldPath, newPath);

        const currentFile = getCurrentFile();
        if (currentFile?.startsWith(oldPrefix)) {
            onCurrentFileMoved(remapNestedPath(currentFile, oldPath, newPath));
        }
        return true;
    }

    async function handleDrop(event, targetFolder) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');

        const type = event.dataTransfer.getData('application/wildcard-type');
        const oldPath = event.dataTransfer.getData('application/wildcard-path');
        if (!type || !oldPath) return;

        if (type === 'folder' && (targetFolder === oldPath || targetFolder.startsWith(`${oldPath}/`))) {
            showToast(t('toast_move_into_self'), 'warn');
            return;
        }

        const name = oldPath.split('/').pop();
        const newPath = targetFolder ? `${targetFolder}/${name}` : name;
        if (newPath === oldPath) return;

        const moveTypeLabel = t(`move_type_${type}`, type);
        log(tf('log_move_start', { type: moveTypeLabel, oldPath, newPath }), 'info');

        try {
            const data = await storage.get(['wildcards', 'wildcardFolders']);
            const wildcards = data.wildcards || {};
            const folders = Array.isArray(data.wildcardFolders) ? data.wildcardFolders : [];
            const moved = type === 'file'
                ? await moveFile(oldPath, newPath, wildcards, folders)
                : await moveFolder(oldPath, newPath, wildcards, folders);

            if (!moved) return;
            await refresh();
            log(tf('log_move_completed', { oldPath, newPath }), 'success');
        } catch (error) {
            log(tf('log_move_failed', { message: error.message }, `移动失败: ${error.message}`), 'error');
        }
    }

    function renderTreeNode(node, path = '', depth = 0) {
        const fragment = documentRef.createDocumentFragment();
        const folderNames = Object.keys(node.children).sort();

        for (const folderName of folderNames) {
            const child = node.children[folderName];
            const folderPath = path ? `${path}/${folderName}` : folderName;
            const isExpanded = expandedFolders.has(folderPath);
            const item = documentRef.createElement('div');
            item.className = `tree-item ${selectedFolder === folderPath ? 'selected' : ''}`;
            item.style.paddingLeft = `${16 + depth * 14}px`;
            item.draggable = true;
            item.innerHTML = `
                <span class="icon">${isExpanded ? '📂' : '📁'}</span>
                <span class="name">${escapeHtml(folderName)}</span>
                <div class="actions">
                    <button data-folder-delete="${escapeHtml(folderPath)}" title="${escapeHtml(t('action_delete'))}">✕</button>
                </div>
            `;

            item.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                if (expandedFolders.has(folderPath)) expandedFolders.delete(folderPath);
                else expandedFolders.add(folderPath);
                selectedFolder = folderPath;
                refresh();
            });
            item.addEventListener('dragstart', event => handleDragStart(event, 'folder', folderPath));
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('dragleave', handleDragLeave);
            item.addEventListener('drop', event => handleDrop(event, folderPath));
            fragment.appendChild(item);

            const childContainer = documentRef.createElement('div');
            childContainer.className = `tree-folder-children${isExpanded ? '' : ' collapsed'}`;
            childContainer.appendChild(renderTreeNode(child, folderPath, depth + 1));
            fragment.appendChild(childContainer);
        }

        const files = [...node.files].sort((left, right) => left.name.localeCompare(right.name));
        for (const file of files) {
            const item = documentRef.createElement('div');
            item.className = `tree-item${getCurrentFile() === file.key ? ' active' : ''}`;
            item.style.paddingLeft = `${16 + depth * 14}px`;
            item.draggable = true;
            item.innerHTML = `
                <span class="icon">📄</span>
                <span class="name">${escapeHtml(file.name)}</span>
                <div class="actions">
                    <button data-file-delete="${escapeHtml(file.key)}" title="${escapeHtml(t('action_delete'))}">✕</button>
                </div>
            `;
            item.addEventListener('click', event => {
                if (!event.target.closest('button')) openFile(file.key);
            });
            item.addEventListener('dragstart', event => handleDragStart(event, 'file', file.key));
            fragment.appendChild(item);
        }

        return fragment;
    }

    async function refresh() {
        const sequence = ++refreshSequence;
        try {
            const data = await storage.get(['wildcards', 'wildcardFolders']);
            if (sequence !== refreshSequence) return;
            const wildcards = data.wildcards || {};
            const folders = Array.isArray(data.wildcardFolders) ? data.wildcardFolders : [];
            const rootDrop = documentRef.createElement('div');
            rootDrop.style.minHeight = '100%';
            rootDrop.addEventListener('dragover', handleDragOver);
            rootDrop.addEventListener('dragleave', handleDragLeave);
            rootDrop.addEventListener('drop', event => handleDrop(event, ''));
            rootDrop.addEventListener('click', event => {
                if (event.target !== rootDrop) return;
                selectedFolder = null;
                refresh();
            });
            rootDrop.appendChild(renderTreeNode(buildFileTreeData(wildcards, folders)));
            fileTree.replaceChildren(rootDrop);

            newItemName.placeholder = selectedFolder
                ? tf('placeholder_new_item_in_folder', { folderName: selectedFolder.split('/').pop() })
                : t('placeholder_new_item_root');
        } catch (error) {
            log(tf('log_refresh_tree_failed', { message: error.message }), 'error');
        }
    }

    async function deleteFile(key) {
        if (!await confirmDelete(tf('confirm_delete_file', { key }))) return;
        const data = await storage.get('wildcards');
        const wildcards = data.wildcards || {};

        if (localSyncService.boundDirHandle) {
            const deleted = await localSyncService.deleteFile(`${key}.txt`);
            if (!deleted) throw new Error(`无法删除本地文件 ${key}`);
        }

        delete wildcards[key];
        await storage.set({ wildcards });
        if (getCurrentFile() === key) closeEditor();
        log(tf('log_file_deleted', { key }), 'info');
        await refresh();
    }

    async function deleteFolder(folder) {
        if (!await confirmDelete(tf('confirm_delete_folder', { folder }))) return;
        const data = await storage.get(['wildcards', 'wildcardFolders']);
        const wildcards = data.wildcards || {};
        const folders = Array.isArray(data.wildcardFolders) ? data.wildcardFolders : [];
        const prefix = `${folder}/`;
        const nextWildcards = Object.fromEntries(
            Object.entries(wildcards).filter(([key]) => !key.startsWith(prefix))
        );
        const nextFolders = folders.filter(path => path !== folder && !path.startsWith(prefix));

        if (localSyncService.boundDirHandle) {
            const deleted = await localSyncService.deleteFolder(folder);
            if (!deleted) throw new Error(`无法删除本地文件夹 ${folder}`);
        }

        await storage.set({ wildcards: nextWildcards, wildcardFolders: nextFolders });
        if (getCurrentFile()?.startsWith(prefix)) closeEditor();
        if (selectedFolder === folder || selectedFolder?.startsWith(prefix)) selectedFolder = null;
        for (const path of Array.from(expandedFolders)) {
            if (path === folder || path.startsWith(prefix)) expandedFolders.delete(path);
        }
        log(tf('log_folder_deleted', { folder }), 'info');
        await refresh();
    }

    scope.on(fileTree, 'click', event => {
        const fileButton = event.target.closest?.('[data-file-delete]');
        const folderButton = event.target.closest?.('[data-folder-delete]');
        if (!fileButton && !folderButton) return;
        event.stopPropagation();
        const operation = fileButton
            ? deleteFile(fileButton.dataset.fileDelete)
            : deleteFolder(folderButton.dataset.folderDelete);
        operation.catch(error => {
            log(tf('log_tree_operation_failed', { message: error.message }, `文件树操作失败: ${error.message}`), 'error');
        });
    });

    return Object.freeze({
        deleteFile,
        deleteFolder,
        expandFolder,
        getSelectedFolder,
        moveFile,
        moveFolder,
        refresh
    });
}
