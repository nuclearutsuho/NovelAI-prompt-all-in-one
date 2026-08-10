// Group Tags 拖拽排序控制器：统一管理 Sortable 实例和排序后的状态回写。
(function initGroupTagsSortableController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GroupTagsSortableController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSortableApi() {
  'use strict';

  function moveArrayItem(list, oldIndex, newIndex) {
    if (!Array.isArray(list)) return null;
    if (oldIndex === newIndex) return list[oldIndex] || null;
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= list.length || newIndex >= list.length) return null;
    const [item] = list.splice(oldIndex, 1);
    list.splice(newIndex, 0, item);
    return item || null;
  }

  function remapActiveIndex(activeIndex, oldIndex, newIndex) {
    if (oldIndex === newIndex) return activeIndex;
    if (activeIndex === oldIndex) return newIndex;
    if (oldIndex < newIndex && activeIndex > oldIndex && activeIndex <= newIndex) return activeIndex - 1;
    if (oldIndex > newIndex && activeIndex >= newIndex && activeIndex < oldIndex) return activeIndex + 1;
    return activeIndex;
  }

  function getSortableIndices(event = {}) {
    return {
      oldIndex: event.oldDraggableIndex ?? event.oldIndex,
      newIndex: event.newDraggableIndex ?? event.newIndex
    };
  }

  /**
   * 收藏分类包含一个不可拖拽的“未归档”根分组，而 Sortable 返回的是仅包含
   * 可拖拽文件夹的索引。这里先隔离根分组，再按文件夹 ID/索引重排，避免错移根分组。
   */
  function reorderSpecialFavoriteGroups(groups, options = {}) {
    if (!Array.isArray(groups)) return null;
    const {
      rootGroupId,
      draggedGroupId,
      oldFolderIndex,
      newFolderIndex
    } = options;
    if (newFolderIndex == null) return null;

    const rootGroup = groups.find(group => group?.id === rootGroupId) || null;
    const folders = groups.filter(group => group?.id !== rootGroupId);
    const resolvedOldIndex = draggedGroupId
      ? folders.findIndex(group => group?.id === draggedGroupId)
      : oldFolderIndex;
    const movedGroup = moveArrayItem(folders, resolvedOldIndex, newFolderIndex);
    if (!movedGroup) return null;

    groups.splice(0, groups.length, ...(rootGroup ? [rootGroup] : []), ...folders);
    return movedGroup;
  }

  function createController(options = {}) {
    const {
      scope,
      SortableCtor,
      elements,
      getState,
      setActiveCategoryIndex,
      setActiveGroupIndex,
      setDraggedFavoriteItemId,
      setDraggedTagInfo,
      cloneData,
      isSpecialCategory,
      getSpecialCategoryIndex,
      saveSpecialCategoryPosition,
      favoritesUtils = {},
      specialRootGroupId,
      rebuildSpecialFavorites,
      renderPrimaryTabs,
      renderSecondaryTabs,
      renderTagsGrid,
      logger = console
    } = options;

    if (!scope?.frame || !scope?.cancelFrame || !elements || !getState) {
      throw new Error('[GroupTagsSortable] 缺少生命周期、DOM 或状态依赖');
    }

    const instances = { primary: null, secondary: null, tags: null };
    let refreshFrame = null;

    function commonOptions() {
      return {
        animation: 150,
        fallbackTolerance: 4,
        preventOnFilter: false,
        filter: '.add-tab-btn, .inline-rename-input, .tab-inline-delete, .card-delete-badge'
      };
    }

    function destroyInstance(key) {
      const instance = instances[key];
      if (!instance) return;
      try {
        instance.destroy();
      } catch (error) {
        logger.warn?.(`[GroupTags] 销毁 ${key} 排序实例失败:`, error);
      }
      instances[key] = null;
    }

    function destroy() {
      if (refreshFrame !== null) {
        scope.cancelFrame(refreshFrame);
        refreshFrame = null;
      }
      destroyInstance('primary');
      destroyInstance('secondary');
      destroyInstance('tags');
    }

    function initPrimaryTabs() {
      destroyInstance('primary');
      const state = getState();
      if (!state.isEditMode || !SortableCtor || !elements.primaryTabs || !state.data?.categories?.length) return;

      instances.primary = new SortableCtor(elements.primaryTabs, {
        ...commonOptions(),
        draggable: '.tab-btn:not(.add-tab-btn)',
        onEnd(event) {
          const { oldIndex, newIndex } = getSortableIndices(event);
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
          const movedCategory = moveArrayItem(state.data.categories, oldIndex, newIndex);
          if (!movedCategory) return;

          if (!isSpecialCategory(movedCategory)) movedCategory._modified = true;
          setActiveCategoryIndex(remapActiveIndex(state.activeCategoryIndex, oldIndex, newIndex));
          if (getSpecialCategoryIndex() >= 0) {
            Promise.resolve(saveSpecialCategoryPosition()).catch(error => {
              logger.warn?.('[GroupTags] 保存收藏分类位置失败:', error);
            });
          }
          renderPrimaryTabs();
          renderSecondaryTabs();
        }
      });
    }

    function initSecondaryTabs() {
      destroyInstance('secondary');
      const state = getState();
      if (!state.isEditMode || !SortableCtor) return;
      const currentCategory = state.data?.categories?.[state.activeCategoryIndex];
      if (!elements.secondaryTabs || !currentCategory?.groups?.length) return;
      const specialCategory = isSpecialCategory(currentCategory);

      instances.secondary = new SortableCtor(elements.secondaryTabs, {
        ...commonOptions(),
        draggable: specialCategory ? '.tab-btn.special-folder-tab' : '.tab-btn:not(.add-tab-btn)',
        onEnd(event) {
          const { oldIndex, newIndex } = getSortableIndices(event);
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
          const activeGroupId = currentCategory.groups[state.activeGroupIndex]?.id || null;

          if (specialCategory) {
            const previousGroups = currentCategory.groups.slice();
            const movedGroup = reorderSpecialFavoriteGroups(currentCategory.groups, {
              rootGroupId: specialRootGroupId,
              draggedGroupId: event.item?.dataset?.groupId,
              oldFolderIndex: oldIndex,
              newFolderIndex: newIndex
            });
            if (!movedGroup) return;

            const nextActiveIndex = currentCategory.groups.findIndex(group => group.id === activeGroupId);
            setActiveGroupIndex(nextActiveIndex >= 0 ? nextActiveIndex : 0);
            renderSecondaryTabs();

            if (favoritesUtils.reorderFavoriteFolders) {
              const folderIds = currentCategory.groups
                .filter(group => group.id !== specialRootGroupId)
                .map(group => group.id);
              Promise.resolve(favoritesUtils.reorderFavoriteFolders(folderIds))
                .then(rebuildSpecialFavorites)
                .then(renderSecondaryTabs)
                .catch(error => {
                  // 持久化失败时回滚内存顺序，避免界面与 promptHistory 长期分叉。
                  currentCategory.groups.splice(0, currentCategory.groups.length, ...previousGroups);
                  const rollbackActiveIndex = currentCategory.groups.findIndex(group => group.id === activeGroupId);
                  setActiveGroupIndex(rollbackActiveIndex >= 0 ? rollbackActiveIndex : 0);
                  renderSecondaryTabs();
                  logger.error?.('[GroupTags] 收藏文件夹排序回写失败:', error);
                });
            }
            return;
          }

          const movedGroup = moveArrayItem(currentCategory.groups, oldIndex, newIndex);
          if (!movedGroup) return;
          movedGroup._modified = true;
          currentCategory._modified = true;
          setActiveGroupIndex(remapActiveIndex(state.activeGroupIndex, oldIndex, newIndex));
          renderSecondaryTabs();
        }
      });
    }

    function initTagsGrid() {
      destroyInstance('tags');
      const state = getState();
      if (!state.isEditMode || !SortableCtor || !elements.tagsGrid) return;
      const currentCategory = state.data?.categories?.[state.activeCategoryIndex];
      const currentGroup = currentCategory?.groups?.[state.activeGroupIndex];

      if (isSpecialCategory(currentCategory)) {
        if (!currentGroup?.items?.length) return;
        instances.tags = new SortableCtor(elements.tagsGrid, {
          ...commonOptions(),
          draggable: '.tag-card',
          onStart(event) {
            setDraggedFavoriteItemId(event.item?.dataset?.favoriteId || null);
          },
          onEnd(event) {
            const { oldIndex, newIndex } = getSortableIndices(event);
            setDraggedFavoriteItemId(null);
            if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
            moveArrayItem(currentGroup.items, oldIndex, newIndex);
            const orderedIds = currentGroup.items.map(item => item.id);
            if (favoritesUtils.reorderFavoriteItemsInGroup) {
              Promise.resolve(favoritesUtils.reorderFavoriteItemsInGroup(currentGroup.id, orderedIds))
                .then(rebuildSpecialFavorites)
                .then(renderTagsGrid)
                .catch(error => logger.error?.('[GroupTags] 收藏项排序回写失败:', error));
            } else {
              renderTagsGrid();
            }
          }
        });
        return;
      }

      if (!currentGroup?.tags?.length) return;
      instances.tags = new SortableCtor(elements.tagsGrid, {
        ...commonOptions(),
        draggable: '.tag-card',
        onStart(event) {
          const tagIndex = event.oldDraggableIndex ?? event.oldIndex;
          const tag = currentGroup.tags?.[tagIndex];
          if (!tag) return;
          setDraggedTagInfo({
            tag: cloneData(tag),
            sourceCategoryIndex: state.activeCategoryIndex,
            sourceGroupIndex: state.activeGroupIndex,
            sourceTagIndex: tagIndex
          });
        },
        onEnd(event) {
          const { oldIndex, newIndex } = getSortableIndices(event);
          setDraggedTagInfo(null);
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
          const movedTag = moveArrayItem(currentGroup.tags, oldIndex, newIndex);
          if (!movedTag) return;
          currentGroup._modified = true;
          currentCategory._modified = true;
          renderTagsGrid();
        }
      });
    }

    function refresh() {
      if (!getState().isEditMode) {
        destroy();
        return;
      }
      if (!SortableCtor) {
        logger.warn?.('[GroupTags] Sortable.js 未加载，跳过拖拽初始化');
        return;
      }
      initPrimaryTabs();
      initSecondaryTabs();
      initTagsGrid();
    }

    function schedule() {
      if (refreshFrame !== null) return;
      refreshFrame = scope.frame(() => {
        refreshFrame = null;
        refresh();
      });
    }

    scope.add?.(destroy);
    return Object.freeze({ destroy, refresh, schedule });
  }

  return Object.freeze({
    createController,
    getSortableIndices,
    moveArrayItem,
    reorderSpecialFavoriteGroups,
    remapActiveIndex
  });
});
