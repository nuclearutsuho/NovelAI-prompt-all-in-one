(function () {
  const PROMPT_HISTORY_STORAGE_KEY = 'promptHistory';
  const POSITION_STORAGE_KEY = 'groupTagsSpecialCategoryPosition';
  const SPECIAL_CATEGORY_ID = '__group_tags_favorites__';
  const SPECIAL_CATEGORY_NAME = '收藏片段';
  const ROOT_GROUP_ID = '__favorites_unfiled__';
  const ROOT_GROUP_NAME = '未归档';

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function sanitizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function sortByStoredOrder(a, b) {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.sortOrder !== undefined) return -1;
    if (b.sortOrder !== undefined) return 1;
    return (b.timestamp || 0) - (a.timestamp || 0);
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function getFavoriteItemKind(snapshot) {
    if (!snapshot) return 'full';
    if (!snapshot.isPartial) return 'full';
    if (snapshot.partialType === 'positive') return 'positive';
    if (snapshot.partialType === 'negative') return 'negative';
    if (snapshot.partialType === 'character' || String(snapshot.partialType || '').startsWith('character-')) return 'character';
    return 'partial';
  }

  function buildFavoritePreview(snapshot) {
    if (!snapshot) {
      return { sections: [] };
    }

    const sections = [];
    const kind = getFavoriteItemKind(snapshot);

    const pushSection = (label, value) => {
      const text = sanitizeText(value);
      if (!text) return;
      sections.push({ label, text });
    };

    if (kind === 'full' || kind === 'positive') {
      pushSection('正面', snapshot.positive);
    }
    if (kind === 'full' || kind === 'negative') {
      pushSection('负面', snapshot.negative);
    }
    if (kind === 'full' || kind === 'character') {
      (snapshot.characters || []).forEach((character, index) => {
        const parts = [];
        const pos = sanitizeText(character.posPrompt);
        const neg = sanitizeText(character.negPrompt);
        if (pos) parts.push(`正面: ${pos}`);
        if (neg) parts.push(`负面: ${neg}`);
        if (parts.length) {
          sections.push({
            label: `角色 ${index + 1}`,
            text: parts.join('\n')
          });
        }
      });
    }

    return { sections };
  }

  function buildFavoriteSubtitle(snapshot) {
    const kind = getFavoriteItemKind(snapshot);
    const posCount = Array.isArray(snapshot?.positiveTags)
      ? snapshot.positiveTags.length
      : sanitizeText(snapshot?.positive).split(',').filter(Boolean).length;
    const negCount = Array.isArray(snapshot?.negativeTags)
      ? snapshot.negativeTags.length
      : sanitizeText(snapshot?.negative).split(',').filter(Boolean).length;
    const charCount = Array.isArray(snapshot?.characters)
      ? snapshot.characters.filter(character => sanitizeText(character?.posPrompt) || sanitizeText(character?.negPrompt)).length
      : 0;

    if (kind === 'positive') {
      return `${posCount} tags`;
    }
    if (kind === 'negative') {
      return `${negCount} tags`;
    }
    if (kind === 'character') {
      const character = (snapshot.characters || [])[0] || {};
      const charPosCount = Array.isArray(character?.posTags)
        ? character.posTags.length
        : sanitizeText(character?.posPrompt).split(',').filter(Boolean).length;
      const charNegCount = Array.isArray(character?.negTags)
        ? character.negTags.length
        : sanitizeText(character?.negPrompt).split(',').filter(Boolean).length;
      return `正${charPosCount} / 负${charNegCount}`;
    }

    return `正${posCount} / 负${negCount} / 角${charCount}`;
  }

  function buildFavoriteItem(snapshot) {
    const kind = getFavoriteItemKind(snapshot);
    const typeLabelMap = {
      full: '全量',
      positive: '正面',
      negative: '负面',
      character: '角色',
      partial: '片段'
    };
    const typeClassMap = {
      full: 'full',
      positive: 'positive',
      negative: 'negative',
      character: 'character',
      partial: 'partial'
    };

    return {
      id: snapshot.id,
      name: sanitizeText(snapshot.name) || formatTime(snapshot.timestamp),
      subtitle: buildFavoriteSubtitle(snapshot),
      type: kind,
      typeLabel: typeLabelMap[kind] || '片段',
      typeClass: typeClassMap[kind] || 'partial',
      folderId: snapshot.folderId || ROOT_GROUP_ID,
      timestamp: snapshot.timestamp || 0,
      sortOrder: snapshot.sortOrder,
      snapshot: cloneData(snapshot),
      preview: buildFavoritePreview(snapshot)
    };
  }

  function buildFavoritesCategory(history) {
    const list = Array.isArray(history) ? cloneData(history) : [];
    const favorites = list.filter(item => item && (item.isFavorite || item.isFolder));
    const folders = favorites.filter(item => item.isFolder).sort(sortByStoredOrder);
    const items = favorites.filter(item => !item.isFolder && item.isFavorite).sort(sortByStoredOrder);

    const groups = [{
      id: ROOT_GROUP_ID,
      name: ROOT_GROUP_NAME,
      isSpecialFavoritesGroup: true,
      isDefaultRoot: true,
      items: []
    }];

    folders.forEach(folder => {
      groups.push({
        id: folder.id,
        name: sanitizeText(folder.name) || '未命名文件夹',
        isSpecialFavoritesGroup: true,
        isFolderGroup: true,
        items: []
      });
    });

    const groupMap = new Map(groups.map(group => [group.id, group]));
    items.forEach(snapshot => {
      const groupId = snapshot.folderId && groupMap.has(snapshot.folderId) ? snapshot.folderId : ROOT_GROUP_ID;
      groupMap.get(groupId).items.push(buildFavoriteItem(snapshot));
    });

    return {
      id: SPECIAL_CATEGORY_ID,
      name: SPECIAL_CATEGORY_NAME,
      isSpecialFavoritesCategory: true,
      groups,
      totalCount: items.length
    };
  }

  async function loadPromptHistory() {
    const data = await chrome.storage.local.get(PROMPT_HISTORY_STORAGE_KEY);
    return Array.isArray(data[PROMPT_HISTORY_STORAGE_KEY]) ? cloneData(data[PROMPT_HISTORY_STORAGE_KEY]) : [];
  }

  async function savePromptHistory(history) {
    const nextHistory = Array.isArray(history) ? cloneData(history) : [];
    await chrome.storage.local.set({ [PROMPT_HISTORY_STORAGE_KEY]: nextHistory });
    return nextHistory;
  }

  async function loadSpecialCategoryPosition() {
    const data = await chrome.storage.local.get(POSITION_STORAGE_KEY);
    const value = Number(data[POSITION_STORAGE_KEY]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  async function saveSpecialCategoryPosition(position) {
    const nextPosition = Math.max(0, Number(position) || 0);
    await chrome.storage.local.set({ [POSITION_STORAGE_KEY]: nextPosition });
    return nextPosition;
  }

  async function loadFavoritesCategoryView() {
    const [history, position] = await Promise.all([
      loadPromptHistory(),
      loadSpecialCategoryPosition()
    ]);

    return {
      history,
      position,
      category: buildFavoritesCategory(history)
    };
  }

  function setFolderSortOrders(history, orderedFolderIds) {
    const orderMap = new Map(orderedFolderIds.map((id, index) => [id, index]));
    history.forEach(item => {
      if (!item?.isFolder) return;
      if (orderMap.has(item.id)) {
        item.sortOrder = orderMap.get(item.id);
      }
    });
  }

  function getGroupedFavoriteItems(history) {
    const grouped = new Map();
    history.forEach(item => {
      if (!item || item.isFolder || !item.isFavorite) return;
      const groupId = item.folderId || ROOT_GROUP_ID;
      if (!grouped.has(groupId)) {
        grouped.set(groupId, []);
      }
      grouped.get(groupId).push(item);
    });
    grouped.forEach(items => items.sort(sortByStoredOrder));
    return grouped;
  }

  function applyGroupedFavoriteItems(history, grouped) {
    grouped.forEach((items, groupId) => {
      items.forEach((item, index) => {
        item.folderId = groupId === ROOT_GROUP_ID ? undefined : groupId;
        item.sortOrder = index;
      });
    });

    history.forEach(item => {
      if (!item || item.isFolder || !item.isFavorite) return;
      const groupId = item.folderId || ROOT_GROUP_ID;
      if (!grouped.has(groupId)) {
        item.folderId = undefined;
        item.sortOrder = undefined;
      }
    });
  }

  async function createFavoriteFolder(name) {
    const folderName = sanitizeText(name) || '未命名文件夹';
    const history = await loadPromptHistory();
    const folders = history.filter(item => item?.isFolder).sort(sortByStoredOrder);
    history.unshift({
      id: createId('folder'),
      isFolder: true,
      isFavorite: true,
      name: folderName,
      timestamp: Date.now(),
      sortOrder: folders.length
    });
    await savePromptHistory(history);
    return loadFavoritesCategoryView();
  }

  async function renameFavoriteFolder(folderId, nextName) {
    const folderName = sanitizeText(nextName);
    if (!folderName) return loadFavoritesCategoryView();
    const history = await loadPromptHistory();
    const folder = history.find(item => item?.isFolder && item.id === folderId);
    if (folder) {
      folder.name = folderName;
      await savePromptHistory(history);
    }
    return loadFavoritesCategoryView();
  }

  async function deleteFavoriteFolder(folderId) {
    const history = await loadPromptHistory();
    history.forEach(item => {
      if (item?.folderId === folderId) {
        delete item.folderId;
      }
    });
    const nextHistory = history.filter(item => item?.id !== folderId);
    await savePromptHistory(nextHistory);
    return loadFavoritesCategoryView();
  }

  async function deleteFavoriteItem(itemId) {
    const history = await loadPromptHistory();
    const nextHistory = history.filter(item => item?.id !== itemId);
    await savePromptHistory(nextHistory);
    return loadFavoritesCategoryView();
  }

  async function reorderFavoriteFolders(folderIds) {
    const history = await loadPromptHistory();
    // 只同步文件夹自身顺序，未归档分组不落 storage。
    setFolderSortOrders(history, folderIds);
    await savePromptHistory(history);
    return loadFavoritesCategoryView();
  }

  async function reorderFavoriteItemsInGroup(groupId, orderedItemIds) {
    const history = await loadPromptHistory();
    const grouped = getGroupedFavoriteItems(history);
    const currentItems = grouped.get(groupId) || [];
    const currentMap = new Map(currentItems.map(item => [item.id, item]));
    const nextItems = orderedItemIds.map(id => currentMap.get(id)).filter(Boolean);

    currentItems.forEach(item => {
      if (!nextItems.find(entry => entry.id === item.id)) {
        nextItems.push(item);
      }
    });

    grouped.set(groupId, nextItems);
    applyGroupedFavoriteItems(history, grouped);
    await savePromptHistory(history);
    return loadFavoritesCategoryView();
  }

  async function moveFavoriteItemToGroup(itemId, targetGroupId, targetIndex = null) {
    const history = await loadPromptHistory();
    const grouped = getGroupedFavoriteItems(history);
    let movedItem = null;

    grouped.forEach(items => {
      const index = items.findIndex(item => item.id === itemId);
      if (index >= 0) {
        movedItem = items.splice(index, 1)[0];
      }
    });

    if (!movedItem) {
      return loadFavoritesCategoryView();
    }

    const nextGroupId = targetGroupId || ROOT_GROUP_ID;
    const targetItems = grouped.get(nextGroupId) || [];
    const insertIndex = targetIndex == null ? targetItems.length : Math.max(0, Math.min(targetIndex, targetItems.length));
    targetItems.splice(insertIndex, 0, movedItem);
    grouped.set(nextGroupId, targetItems);

    applyGroupedFavoriteItems(history, grouped);
    await savePromptHistory(history);
    return loadFavoritesCategoryView();
  }

  window.GroupTagsFavoritesUtils = {
    SPECIAL_CATEGORY_ID,
    SPECIAL_CATEGORY_NAME,
    ROOT_GROUP_ID,
    ROOT_GROUP_NAME,
    formatTime,
    getFavoriteItemKind,
    buildFavoritePreview,
    buildFavoritesCategory,
    loadPromptHistory,
    savePromptHistory,
    loadSpecialCategoryPosition,
    saveSpecialCategoryPosition,
    loadFavoritesCategoryView,
    createFavoriteFolder,
    renameFavoriteFolder,
    deleteFavoriteFolder,
    deleteFavoriteItem,
    reorderFavoriteFolders,
    reorderFavoriteItemsInGroup,
    moveFavoriteItemToGroup
  };
})();
