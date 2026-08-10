// Group Tags 编辑控制器：统一分类、分组、收藏文件夹和标签的增删流程。
(function initGroupTagsEditController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GroupTagsEditController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEditApi() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampIndexAfterRemoval(activeIndex, remainingLength) {
    if (remainingLength <= 0) return 0;
    return Math.max(0, Math.min(Number(activeIndex) || 0, remainingLength - 1));
  }

  function createCategoryRecord(name, id) {
    return {
      id,
      name: String(name || '').trim(),
      _modified: true,
      groups: []
    };
  }

  function createGroupRecord(name, id) {
    return {
      id,
      name: String(name || '').trim(),
      color: '#4a4a6a',
      _modified: true,
      tags: []
    };
  }

  function createController(options = {}) {
    const {
      modalRoot,
      showModal,
      hideModal,
      showInfo,
      getState,
      setData,
      setActiveCategoryIndex,
      setActiveGroupIndex,
      generateId,
      isSpecialCategory,
      specialRootGroupId,
      favoritesUtils = {},
      markDeletedDefaultCategory,
      markDeletedDefaultGroup,
      hideFavoritePreview,
      refreshSpecialData,
      renderPrimaryTabs,
      renderSecondaryTabs,
      renderTagsGrid,
      logger = console
    } = options;

    const requiredFunctions = {
      showModal,
      hideModal,
      getState,
      setData,
      setActiveCategoryIndex,
      setActiveGroupIndex,
      generateId,
      isSpecialCategory,
      markDeletedDefaultCategory,
      markDeletedDefaultGroup,
      refreshSpecialData,
      renderPrimaryTabs,
      renderSecondaryTabs,
      renderTagsGrid
    };
    const missingFunctions = Object.entries(requiredFunctions)
      .filter(([, value]) => typeof value !== 'function')
      .map(([name]) => name);
    if (!modalRoot || missingFunctions.length) {
      throw new Error(`[GroupTagsEdit] 缺少控制器依赖${missingFunctions.length ? `: ${missingFunctions.join(', ')}` : ''}`);
    }

    function bindAction(action, handler) {
      const target = modalRoot.querySelector(`[data-action="${action}"]`);
      if (target) target.onclick = handler;
      return target;
    }

    function bindEnter(input, confirmButton) {
      if (!input || !confirmButton) return;
      input.onkeydown = event => {
        if (event.key === 'Enter') confirmButton.click();
      };
    }

    function reportFailure(action, error) {
      logger.error?.(`[GroupTags] ${action}失败:`, error);
      showInfo?.(`${action}失败`, error?.message || '操作未完成，请稍后重试。');
    }

    function addCategory() {
      const state = getState();
      if (!state.isEditMode) return false;
      showModal(`
        <h3>新建分类</h3>
        <input class="modal-input" data-field="category-name" placeholder="分类名称" />
        <div class="modal-buttons">
          <button class="modal-btn" data-action="category-cancel">取消</button>
          <button class="modal-btn primary" data-action="category-confirm">确认</button>
        </div>
      `);
      const input = modalRoot.querySelector('[data-field="category-name"]');
      const confirm = bindAction('category-confirm', () => {
        const name = input?.value.trim();
        if (!name) return;
        const nextState = getState();
        nextState.data.categories.push(createCategoryRecord(name, generateId('cat')));
        setActiveCategoryIndex(nextState.data.categories.length - 1);
        setActiveGroupIndex(0);
        hideModal();
        renderPrimaryTabs();
        renderSecondaryTabs();
      });
      bindAction('category-cancel', hideModal);
      bindEnter(input, confirm);
      return true;
    }

    function deleteCategory(index) {
      const state = getState();
      if (!state.isEditMode) return false;
      const category = state.data?.categories?.[index];
      if (!category || isSpecialCategory(category)) return false;
      showModal(`
        <h3>确认删除分类</h3>
        <p style="color:#ccc;font-size:13px;">确定要删除分类 “<strong>${escapeHtml(category.name)}</strong>” 及其所有分组和标签吗？</p>
        <div class="modal-buttons">
          <button class="modal-btn" data-action="category-delete-cancel">取消</button>
          <button class="modal-btn danger" data-action="category-delete-confirm">删除</button>
        </div>
      `);
      bindAction('category-delete-cancel', hideModal);
      bindAction('category-delete-confirm', () => {
        markDeletedDefaultCategory(category.id);
        const nextState = getState();
        nextState.data.categories.splice(index, 1);
        setActiveCategoryIndex(clampIndexAfterRemoval(nextState.activeCategoryIndex, nextState.data.categories.length));
        setActiveGroupIndex(0);
        hideModal();
        renderPrimaryTabs();
        renderSecondaryTabs();
      });
      return true;
    }

    function addGroup() {
      const state = getState();
      if (!state.isEditMode) return false;
      const currentCategory = state.data?.categories?.[state.activeCategoryIndex];
      if (!currentCategory) return false;
      const specialCategory = isSpecialCategory(currentCategory);
      showModal(`
        <h3>${specialCategory ? '新建文件夹' : '新建分组'}</h3>
        <input class="modal-input" data-field="group-name" placeholder="${specialCategory ? '文件夹名称' : '分组名称'}" />
        <div class="modal-buttons">
          <button class="modal-btn" data-action="group-cancel">取消</button>
          <button class="modal-btn primary" data-action="group-confirm">确认</button>
        </div>
      `);
      const input = modalRoot.querySelector('[data-field="group-name"]');
      let isSaving = false;
      const confirm = bindAction('group-confirm', async () => {
        const name = input?.value.trim();
        if (!name || isSaving) return;
        isSaving = true;
        confirm.disabled = true;
        try {
          if (specialCategory) {
            if (typeof favoritesUtils.createFavoriteFolder !== 'function') return;
            await favoritesUtils.createFavoriteFolder(name);
            const nextData = await refreshSpecialData();
            setData(nextData);
            const nextState = getState();
            const category = nextState.data?.categories?.[nextState.activeCategoryIndex];
            setActiveGroupIndex(Math.max(0, (category?.groups?.length || 1) - 1));
          } else {
            const nextState = getState();
            const category = nextState.data?.categories?.[nextState.activeCategoryIndex];
            if (!category) return;
            category.groups.push(createGroupRecord(name, generateId('grp')));
            category._modified = true;
            setActiveGroupIndex(category.groups.length - 1);
          }
          hideModal();
          renderSecondaryTabs();
        } catch (error) {
          reportFailure(specialCategory ? '新建文件夹' : '新建分组', error);
        } finally {
          isSaving = false;
          if (confirm?.isConnected) confirm.disabled = false;
        }
      });
      bindAction('group-cancel', hideModal);
      bindEnter(input, confirm);
      return true;
    }

    function deleteGroup(index) {
      const state = getState();
      if (!state.isEditMode) return false;
      const currentCategory = state.data?.categories?.[state.activeCategoryIndex];
      const group = currentCategory?.groups?.[index];
      if (!group) return false;

      if (isSpecialCategory(currentCategory)) {
        if (group.id === specialRootGroupId || typeof favoritesUtils.deleteFavoriteFolder !== 'function') return false;
        hideFavoritePreview?.();
        showModal(`
          <h3>确认删除文件夹</h3>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认删除文件夹 <strong>${escapeHtml(group.name)}</strong> 吗？文件夹内收藏会回到未归档分组，这项修改在当前编辑态下可通过取消恢复。</div>
          <div class="modal-buttons">
            <button class="modal-btn" data-action="group-delete-cancel">取消</button>
            <button class="modal-btn danger" data-action="group-delete-confirm">删除</button>
          </div>
        `);
        bindAction('group-delete-cancel', hideModal);
        bindAction('group-delete-confirm', async event => {
          const button = event?.currentTarget;
          if (button?.disabled) return;
          if (button) button.disabled = true;
          hideModal();
          try {
            await favoritesUtils.deleteFavoriteFolder(group.id);
            const nextData = await refreshSpecialData();
            setData(nextData);
            const nextState = getState();
            const category = nextState.data?.categories?.[nextState.activeCategoryIndex];
            setActiveGroupIndex(clampIndexAfterRemoval(nextState.activeGroupIndex, category?.groups?.length || 0));
            renderSecondaryTabs();
          } catch (error) {
            reportFailure('删除文件夹', error);
          }
        });
        return true;
      }

      showModal(`
        <h3>确认删除分组</h3>
        <p style="color:#ccc;font-size:13px;">确定要删除分组 “<strong>${escapeHtml(group.name)}</strong>” 及其所有标签吗？</p>
        <div class="modal-buttons">
          <button class="modal-btn" data-action="group-delete-cancel">取消</button>
          <button class="modal-btn danger" data-action="group-delete-confirm">删除</button>
        </div>
      `);
      bindAction('group-delete-cancel', hideModal);
      bindAction('group-delete-confirm', () => {
        markDeletedDefaultGroup(currentCategory.id, group.id);
        const nextState = getState();
        const category = nextState.data?.categories?.[nextState.activeCategoryIndex];
        if (!category) return;
        category.groups.splice(index, 1);
        category._modified = true;
        setActiveGroupIndex(clampIndexAfterRemoval(nextState.activeGroupIndex, category.groups.length));
        hideModal();
        renderSecondaryTabs();
      });
      return true;
    }

    function deleteTag(tagIndex) {
      const state = getState();
      if (!state.isEditMode) return false;
      const category = state.data?.categories?.[state.activeCategoryIndex];
      const group = category?.groups?.[state.activeGroupIndex];
      if (!Array.isArray(group?.tags) || tagIndex < 0 || tagIndex >= group.tags.length) return false;
      group.tags.splice(tagIndex, 1);
      group._modified = true;
      category._modified = true;
      renderTagsGrid();
      return true;
    }

    function deleteFavoriteItem(item) {
      const state = getState();
      if (!state.isEditMode || !item?.id || typeof favoritesUtils.deleteFavoriteItem !== 'function') return false;
      hideFavoritePreview?.();
      showModal(`
        <h3>确认删除收藏片段</h3>
        <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认删除 <strong>${escapeHtml(item.name)}</strong> 吗？这项修改在当前编辑态下可通过取消恢复。</div>
        <div class="modal-buttons">
          <button class="modal-btn" data-action="favorite-delete-cancel">取消</button>
          <button class="modal-btn danger" data-action="favorite-delete-confirm">删除</button>
        </div>
      `);
      bindAction('favorite-delete-cancel', hideModal);
      bindAction('favorite-delete-confirm', async event => {
        const button = event?.currentTarget;
        if (button?.disabled) return;
        if (button) button.disabled = true;
        hideModal();
        try {
          await favoritesUtils.deleteFavoriteItem(item.id);
          const nextData = await refreshSpecialData();
          setData(nextData);
          renderTagsGrid();
        } catch (error) {
          reportFailure('删除收藏片段', error);
        }
      });
      return true;
    }

    return {
      addCategory,
      deleteCategory,
      addGroup,
      deleteGroup,
      deleteTag,
      deleteFavoriteItem
    };
  }

  return {
    escapeHtml,
    clampIndexAfterRemoval,
    createCategoryRecord,
    createGroupRecord,
    createController
  };
});
