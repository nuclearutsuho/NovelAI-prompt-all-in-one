// ========== 核心数据与状态 (Phase 1) ==========
let customGroupsData = null;
let defaultGroupsData = { categories: [] };
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let hasInitializedGroupTagsPanel = false;
const groupTagsDataUtils = window.GroupTagsDataUtils || {};
const groupTagsFavoritesUtils = window.GroupTagsFavoritesUtils || {};
const SPECIAL_FAVORITES_CATEGORY_ID = groupTagsFavoritesUtils.SPECIAL_CATEGORY_ID || '__group_tags_favorites__';
const SPECIAL_FAVORITES_CATEGORY_NAME = groupTagsFavoritesUtils.SPECIAL_CATEGORY_NAME || '收藏片段';
const SPECIAL_FAVORITES_ROOT_GROUP_ID = groupTagsFavoritesUtils.ROOT_GROUP_ID || '__favorites_unfiled__';
const GROUP_ITEM_TYPE_TAG = 'tag';
const GROUP_ITEM_TYPE_SENTENCE = 'sentence';
let autocompleteDict = []; // 全局字典缓存
let activeTagsContext = []; // 当前聚焦输入框的 tags
let inactiveTagsContext = []; // 另一个输入框的 tags
let specialCategoryPosition = 0;
let draggedFavoriteItemId = null;
let draggedTagInfo = null; // 普通标签拖拽状态：{ tag, sourceCategoryIndex, sourceGroupIndex, sourceTagIndex }
let favoritePreviewPopover = null;
let favoritesHistorySnapshot = null;
let favoritePreviewHideTimer = null;
let sentenceCardEditState = null;

function normalizeGroupItemType(value) {
  if (groupTagsDataUtils.normalizeGroupItemType) {
    return groupTagsDataUtils.normalizeGroupItemType(value);
  }
  return value === GROUP_ITEM_TYPE_SENTENCE ? GROUP_ITEM_TYPE_SENTENCE : GROUP_ITEM_TYPE_TAG;
}

function isSentenceGroupItem(value) {
  if (groupTagsDataUtils.isSentenceGroupItem) {
    return groupTagsDataUtils.isSentenceGroupItem(value);
  }
  return normalizeGroupItemType(value?.type) === GROUP_ITEM_TYPE_SENTENCE;
}

function isTagGroupItem(value) {
  if (groupTagsDataUtils.isTagGroupItem) {
    return groupTagsDataUtils.isTagGroupItem(value);
  }
  return !isSentenceGroupItem(value);
}

function buildSentenceItemKey(value) {
  if (groupTagsDataUtils.buildSentenceItemKey) {
    return groupTagsDataUtils.buildSentenceItemKey(value);
  }
  const en = typeof value?.en === 'string' ? value.en.trim() : '';
  const zh = typeof value?.zh === 'string' ? value.zh.trim() : '';
  if (!en || !zh) return '';
  return `${en}\u0000${zh}`;
}

function getGroupItemPromptText(value) {
  if (groupTagsDataUtils.getGroupItemPromptText) {
    return groupTagsDataUtils.getGroupItemPromptText(value);
  }
  if (isSentenceGroupItem(value)) {
    return typeof value?.en === 'string' ? value.en.trim() : '';
  }
  return typeof value?.en === 'string' ? value.en.trim() : '';
}

function getGroupItemTranslationText(value) {
  if (groupTagsDataUtils.getGroupItemTranslationText) {
    return groupTagsDataUtils.getGroupItemTranslationText(value);
  }
  if (isSentenceGroupItem(value)) {
    return typeof value?.zh === 'string' ? value.zh.trim() : '';
  }
  return typeof value?.zh === 'string' ? value.zh.trim() : '';
}

// ========== 密度控制逻辑 ==========
const GROUP_TAGS_EXPORT_FORMAT = 'group-tags-export';
const GROUP_TAGS_SCHEMA_VERSION = 1;

const densitySlider = document.getElementById('density-slider');
const root = document.documentElement;
const STORAGE_KEY_DENSITY = 'groupTagsDensity';

// 基于 0-100 滑块值，映射到具体的 CSS 变量
function applyDensity(value) {
  // 反转逻辑：value 越大 (向右滑) -> r 越小 -> 对应尺寸越大 (稀疏)
  const r = (100 - value) / 100;
  
  // Interpolate values
  // Gap: 6px -> 1px
  const gap = 6 - (5 * r);
  const padV = 10 - (6 * r);
  // PadH (Tabs): 14px -> 6px
  const padH = 14 - (8 * r);
  // Tab Font: 14px -> 10px
  const fontTab = 14 - (4 * r);
  // Card PadV: 5px -> 1px
  const cardPadV = 5 - (4 * r);
  // Card PadH: 8px -> 3px
  const cardPadH = 8 - (5 * r);
  // Card Font ZH: 13px -> 9px
  const fontZh = 13 - (4 * r);
  // Card Font EN: 14px -> 10px
  const fontEn = 14 - (4 * r);
  // Grid Padding: 16px -> 4px
  const gridPad = 16 - (12 * r);
  const previewWidth = 320 - (90 * r);
  const previewHeight = 360 - (110 * r);
  const previewPad = 12 - (4 * r);
  const previewTitleFont = 13 - (2 * r);
  const previewLabelFont = 11 - (1 * r);
  const previewTextFont = 12 - (2 * r);
  const previewGap = 10 - (4 * r);

  root.style.setProperty('--density-gap', `${gap}px`);
  root.style.setProperty('--density-pad-v', `${padV}px`);
  root.style.setProperty('--density-pad-h', `${padH}px`);
  root.style.setProperty('--density-font-tab', `${fontTab}px`);
  
  root.style.setProperty('--density-card-pad-v', `${cardPadV}px`);
  root.style.setProperty('--density-card-pad-h', `${cardPadH}px`);
  root.style.setProperty('--density-font-zh', `${fontZh}px`);
  root.style.setProperty('--density-font-en', `${fontEn}px`);
  
  root.style.setProperty('--density-grid-pad', `${gridPad}px`);
  root.style.setProperty('--favorites-preview-width', `${previewWidth}px`);
  root.style.setProperty('--favorites-preview-max-height', `${previewHeight}px`);
  root.style.setProperty('--favorites-preview-pad', `${previewPad}px`);
  root.style.setProperty('--favorites-preview-title-font', `${previewTitleFont}px`);
  root.style.setProperty('--favorites-preview-label-font', `${previewLabelFont}px`);
  root.style.setProperty('--favorites-preview-text-font', `${previewTextFont}px`);
  root.style.setProperty('--favorites-preview-gap', `${previewGap}px`);
}

// 初始化读取存储
chrome.storage.local.get(STORAGE_KEY_DENSITY, (data) => {
  // 默认设置为目前的高密度状态 (大致相当于 value=80)
  const val = data[STORAGE_KEY_DENSITY] !== undefined ? data[STORAGE_KEY_DENSITY] : 80;
  densitySlider.value = val;
  applyDensity(val);
});

// 监听拖动并实时应用并保存
densitySlider.addEventListener('input', (e) => {
  const val = e.target.value;
  applyDensity(val);
  chrome.storage.local.set({ [STORAGE_KEY_DENSITY]: val });
});

// ========== 颜色自定义与同步 ==========

// 构建全局 tag→color 的扁平映射表
function buildColorMap() {
  // 优先复用共享工具，确保 popup 和 Group Tags 面板生成完全一致的颜色映射
  if (groupTagsDataUtils.buildColorMap) {
    return groupTagsDataUtils.buildColorMap(customGroupsData);
  }

  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    (cat.groups || []).forEach(group => {
      const color = group.color || '#4a4a6a';
      (group.tags || []).forEach(t => {
        const key = normalizeTagKey(getGroupItemPromptText(t));
        if (key) map[key] = color;
      });
    });
  });
  return map;
}

// 将颜色映射发送给父窗口
function syncColorsToParent() {
  const colorMap = buildColorMap();
  window.parent.postMessage({ type: '__SYNC_GROUP_COLORS__', colorMap }, '*');
}

// 构建全局 tag→zh 的翻译映射表
function buildTranslationMap() {
  // 优先复用共享工具，避免 popup / Group Tags 面板对翻译映射的规则产生漂移
  if (groupTagsDataUtils.buildTranslationMap) {
    return groupTagsDataUtils.buildTranslationMap(customGroupsData);
  }

  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    (cat.groups || []).forEach(group => {
      (group.tags || []).forEach(t => {
        const key = normalizeTagKey(getGroupItemPromptText(t));
        const translationText = getGroupItemTranslationText(t);
        if (key && translationText) map[key] = translationText;
      });
    });
  });
  return map;
}

// 将翻译映射直接写入 chrome.storage.local（无需经过 bridge 中继）
function syncTranslationsToParent() {
  const translationMap = buildTranslationMap();
  chrome.storage.local.set({ groupTranslationMap: translationMap });
}
// ========== 渲染逻辑 ==========
let isEditMode = false;
const pendingDictionaryUpserts = new Map();
let dataSnapshot = null; // 编辑模式开始时的数据快照，用于取消时恢复

const dom = {
  app: document.getElementById('app'),
  primaryTabs: document.getElementById('primary-tabs-container'),
  secondaryTabs: document.getElementById('secondary-tabs-container'),
  tagsGrid: document.getElementById('tags-grid'),
  inlineAddPanel: document.getElementById('inline-add-panel'),
  colorPicker: document.getElementById('group-color'),
  colorPickerWrapper: document.querySelector('.color-picker-wrapper'),
  modalOverlay: document.getElementById('modal-overlay'),
  modalDialog: document.getElementById('modal-dialog'),
  btnEdit: document.getElementById('btn-edit-group'),
  btnExport: document.getElementById('btn-export-group-tags'),
  btnImport: document.getElementById('btn-import-group-tags'),
  btnSave: document.getElementById('btn-save'),
  btnCancel: document.getElementById('btn-cancel'),
  btnAddCategory: document.getElementById('btn-add-category'),
  btnAddGroup: document.getElementById('btn-add-group'),
  importFileInput: document.getElementById('import-group-tags-input')
};

function isSpecialFavoritesCategory(category) {
  return category?.id === SPECIAL_FAVORITES_CATEGORY_ID || category?.isSpecialFavoritesCategory;
}

function isSpecialFavoritesActive() {
  const currentCategory = customGroupsData?.categories?.[activeCategoryIndex];
  return isSpecialFavoritesCategory(currentCategory);
}

function getSpecialFavoritesIndex(data = customGroupsData) {
  return data?.categories?.findIndex?.(category => isSpecialFavoritesCategory(category)) ?? -1;
}

function stripSpecialFavoritesCategory(data) {
  const nextData = cloneData(data || { categories: [] });
  nextData.categories = Array.isArray(nextData.categories)
    ? nextData.categories.filter(category => !isSpecialFavoritesCategory(category))
    : [];
  return nextData;
}

function getPersistableGroupTagsData(data = customGroupsData) {
  return stripSpecialFavoritesCategory(data);
}

function isDefaultCategory(categoryId) {
  const normalizedCategoryId = sanitizeText(categoryId);
  if (!normalizedCategoryId || !defaultGroupsData?.categories) return false;
  return defaultGroupsData.categories.some(category => sanitizeText(category?.id) === normalizedCategoryId);
}

function isDefaultGroup(categoryId, groupId) {
  const normalizedCategoryId = sanitizeText(categoryId);
  const normalizedGroupId = sanitizeText(groupId);
  if (!normalizedCategoryId || !normalizedGroupId || !defaultGroupsData?.categories) return false;
  const category = defaultGroupsData.categories.find(item => sanitizeText(item?.id) === normalizedCategoryId);
  return Array.isArray(category?.groups) && category.groups.some(group => sanitizeText(group?.id) === normalizedGroupId);
}

function markDeletedDefaultCategory(categoryId) {
  if (!isDefaultCategory(categoryId) || !groupTagsDataUtils.markDefaultCategoryDeleted) return;
  customGroupsData = groupTagsDataUtils.markDefaultCategoryDeleted(customGroupsData, categoryId);
}

function markDeletedDefaultGroup(categoryId, groupId) {
  if (!isDefaultGroup(categoryId, groupId) || !groupTagsDataUtils.markDefaultGroupDeleted) return;
  customGroupsData = groupTagsDataUtils.markDefaultGroupDeleted(customGroupsData, categoryId, groupId);
}

async function loadSpecialCategoryPosition() {
  if (groupTagsFavoritesUtils.loadSpecialCategoryPosition) {
    specialCategoryPosition = await groupTagsFavoritesUtils.loadSpecialCategoryPosition();
  } else {
    specialCategoryPosition = 0;
  }
  return specialCategoryPosition;
}

async function saveSpecialCategoryPosition() {
  const specialIndex = getSpecialFavoritesIndex();
  if (specialIndex < 0) return;
  specialCategoryPosition = specialIndex;
  if (groupTagsFavoritesUtils.saveSpecialCategoryPosition) {
    await groupTagsFavoritesUtils.saveSpecialCategoryPosition(specialCategoryPosition);
  }
}

async function buildSpecialFavoritesCategory() {
  if (groupTagsFavoritesUtils.loadFavoritesCategoryView) {
    const view = await groupTagsFavoritesUtils.loadFavoritesCategoryView();
    specialCategoryPosition = view.position ?? specialCategoryPosition;
    return view.category || {
      id: SPECIAL_FAVORITES_CATEGORY_ID,
      name: SPECIAL_FAVORITES_CATEGORY_NAME,
      isSpecialFavoritesCategory: true,
      groups: []
    };
  }

  return {
    id: SPECIAL_FAVORITES_CATEGORY_ID,
    name: SPECIAL_FAVORITES_CATEGORY_NAME,
    isSpecialFavoritesCategory: true,
    groups: []
  };
}

async function injectSpecialFavoritesCategory(baseData) {
  const nextData = stripSpecialFavoritesCategory(baseData);
  const specialCategory = await buildSpecialFavoritesCategory();
  const categories = Array.isArray(nextData.categories) ? nextData.categories : [];
  const insertIndex = Math.max(0, Math.min(specialCategoryPosition, categories.length));
  categories.splice(insertIndex, 0, specialCategory);
  nextData.categories = categories;
  return nextData;
}

async function rebuildWithSpecialFavorites(baseData, options = {}) {
  const nextData = await injectSpecialFavoritesCategory(baseData);
  if (options.apply !== false) {
    customGroupsData = nextData;
  }
  return nextData;
}

function getFavoriteItemsCount(category) {
  if (!isSpecialFavoritesCategory(category)) return 0;
  return (category.groups || []).reduce((total, group) => total + ((group.items || []).length), 0);
}

function getCurrentSpecialFavoritesGroup() {
  if (!isSpecialFavoritesActive()) return null;
  return customGroupsData?.categories?.[activeCategoryIndex]?.groups?.[activeGroupIndex] || null;
}

function ensureFavoritePreviewPopover() {
  if (favoritePreviewPopover) return favoritePreviewPopover;
  favoritePreviewPopover = document.createElement('div');
  favoritePreviewPopover.className = 'favorites-preview-popover';
  favoritePreviewPopover.addEventListener('wheel', (event) => {
    const body = favoritePreviewPopover?.querySelector('.favorites-preview-body');
    if (!body || body.scrollHeight <= body.clientHeight) return;
    // 预览浮层是 fixed 元素，这里主动接管滚轮，避免事件落回底层网格导致看得见却滚不动。
    event.preventDefault();
    event.stopPropagation();
    body.scrollTop += event.deltaY;
  }, { passive: false });
  favoritePreviewPopover.addEventListener('mouseenter', () => {
    if (favoritePreviewHideTimer) {
      clearTimeout(favoritePreviewHideTimer);
      favoritePreviewHideTimer = null;
    }
  });
  favoritePreviewPopover.addEventListener('mouseleave', () => {
    hideFavoritePreviewPopover();
  });
  document.body.appendChild(favoritePreviewPopover);
  return favoritePreviewPopover;
}

function hideFavoritePreviewPopover() {
  if (favoritePreviewHideTimer) {
    clearTimeout(favoritePreviewHideTimer);
    favoritePreviewHideTimer = null;
  }
  if (!favoritePreviewPopover) return;
  favoritePreviewPopover.classList.remove('visible');
}

function scheduleHideFavoritePreviewPopover() {
  if (favoritePreviewHideTimer) {
    clearTimeout(favoritePreviewHideTimer);
  }
  // 给鼠标从卡片移动到浮层预留一点时间，避免刚想滚动就被立刻隐藏。
  favoritePreviewHideTimer = setTimeout(() => {
    favoritePreviewHideTimer = null;
    hideFavoritePreviewPopover();
  }, 80);
}

function clampPreviewPosition(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function updateSpecialCategoryControls() {
  const specialActive = isSpecialFavoritesActive();
  if (dom.app) {
    dom.app.classList.toggle('special-favorites-mode', specialActive);
  }
  if (dom.inlineAddPanel) {
    // 收藏片段分类不支持直接新增收藏项，因此沿用现有面板时直接隐藏普通 tag 新增区。
    dom.inlineAddPanel.style.display = specialActive ? 'none' : '';
  }
  if (dom.colorPickerWrapper) {
    dom.colorPickerWrapper.style.display = specialActive ? 'none' : '';
  }
  if (dom.btnAddGroup) {
    dom.btnAddGroup.title = specialActive ? 'Add Folder' : 'Add Group';
  }
}

// ========== 拖拽排序 ==========
let sortableRefreshFrame = null;
const sortableInstances = {
  primary: null,
  secondary: null,
  tags: null
};

function destroySortableInstance(key) {
  const instance = sortableInstances[key];
  if (!instance) return;
  try {
    instance.destroy();
  } catch (err) {
    console.warn(`[GroupTags] Failed to destroy ${key} sortable:`, err);
  }
  sortableInstances[key] = null;
}

function destroyAllSortables() {
  if (sortableRefreshFrame !== null) {
    cancelAnimationFrame(sortableRefreshFrame);
    sortableRefreshFrame = null;
  }
  destroySortableInstance('primary');
  destroySortableInstance('secondary');
  destroySortableInstance('tags');
}

function moveArrayItem(list, oldIndex, newIndex) {
  if (!Array.isArray(list)) return null;
  if (oldIndex === newIndex) return list[oldIndex] || null;
  if (oldIndex < 0 || newIndex < 0 || oldIndex >= list.length || newIndex >= list.length) return null;
  const [item] = list.splice(oldIndex, 1);
  list.splice(newIndex, 0, item);
  return item || null;
}

function remapActiveIndex(activeIndex, oldIndex, newIndex) {
  // 拖拽后保持“激活对象”不变，只修正它所在的新下标
  if (oldIndex === newIndex) return activeIndex;
  if (activeIndex === oldIndex) return newIndex;
  if (oldIndex < newIndex && activeIndex > oldIndex && activeIndex <= newIndex) return activeIndex - 1;
  if (oldIndex > newIndex && activeIndex >= newIndex && activeIndex < oldIndex) return activeIndex + 1;
  return activeIndex;
}

function getSortableIndices(evt) {
  return {
    oldIndex: evt.oldDraggableIndex ?? evt.oldIndex,
    newIndex: evt.newDraggableIndex ?? evt.newIndex
  };
}

function createCommonSortableOptions() {
  // 过滤交互控件，避免重命名输入框和删除按钮被误判为拖拽起点
  return {
    animation: 150,
    fallbackTolerance: 4,
    preventOnFilter: false,
    filter: '.add-tab-btn, .inline-rename-input, .tab-inline-delete, .card-delete-badge'
  };
}

function initPrimaryTabsSortable() {
  destroySortableInstance('primary');
  if (!isEditMode || typeof Sortable === 'undefined') return;
  if (!dom.primaryTabs || !customGroupsData?.categories?.length) return;

  sortableInstances.primary = new Sortable(dom.primaryTabs, {
    ...createCommonSortableOptions(),
    draggable: '.tab-btn:not(.add-tab-btn)',
    onEnd(evt) {
      const { oldIndex, newIndex } = getSortableIndices(evt);
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

      const movedCategory = moveArrayItem(customGroupsData.categories, oldIndex, newIndex);
      if (!movedCategory) return;

      if (!isSpecialFavoritesCategory(movedCategory)) {
        movedCategory._modified = true;
      }
      activeCategoryIndex = remapActiveIndex(activeCategoryIndex, oldIndex, newIndex);
      if (getSpecialFavoritesIndex() >= 0) {
        saveSpecialCategoryPosition();
      }
      renderPrimaryTabs();
      renderSecondaryTabs();
    }
  });
}

function initSecondaryTabsSortable() {
  destroySortableInstance('secondary');
  if (!isEditMode || typeof Sortable === 'undefined') return;

  const currentCategory = customGroupsData?.categories?.[activeCategoryIndex];
  if (!dom.secondaryTabs || !currentCategory?.groups?.length) return;
  const isSpecialCategory = isSpecialFavoritesCategory(currentCategory);

  sortableInstances.secondary = new Sortable(dom.secondaryTabs, {
    ...createCommonSortableOptions(),
    draggable: isSpecialCategory ? '.tab-btn.special-folder-tab' : '.tab-btn:not(.add-tab-btn)',
    onEnd(evt) {
      const { oldIndex, newIndex } = getSortableIndices(evt);
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

      const movedGroup = moveArrayItem(currentCategory.groups, oldIndex, newIndex);
      if (!movedGroup) return;

      if (!isSpecialCategory) {
        movedGroup._modified = true;
        currentCategory._modified = true;
      } else if (groupTagsFavoritesUtils.reorderFavoriteFolders) {
        // 特殊分类的二级分组直接映射收藏文件夹顺序，拖拽后立即回写到 promptHistory。
        const folderIds = currentCategory.groups
          .filter(group => group.id !== SPECIAL_FAVORITES_ROOT_GROUP_ID)
          .map(group => group.id);
        groupTagsFavoritesUtils.reorderFavoriteFolders(folderIds).then(async () => {
          customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
          renderSecondaryTabs();
        });
      }
      activeGroupIndex = remapActiveIndex(activeGroupIndex, oldIndex, newIndex);
      renderSecondaryTabs();
    }
  });
}

function initTagsGridSortable() {
  destroySortableInstance('tags');
  if (!isEditMode || typeof Sortable === 'undefined') return;

  const currentCategory = customGroupsData?.categories?.[activeCategoryIndex];
  const currentGroup = currentCategory?.groups?.[activeGroupIndex];
  if (!dom.tagsGrid) return;

  if (isSpecialFavoritesCategory(currentCategory)) {
    if (!currentGroup?.items?.length) return;

    sortableInstances.tags = new Sortable(dom.tagsGrid, {
      ...createCommonSortableOptions(),
      draggable: '.tag-card',
      onStart(evt) {
        draggedFavoriteItemId = evt.item?.dataset?.favoriteId || null;
      },
      onEnd(evt) {
        const { oldIndex, newIndex } = getSortableIndices(evt);
        draggedFavoriteItemId = null;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

        moveArrayItem(currentGroup.items, oldIndex, newIndex);
        const orderedIds = currentGroup.items.map(item => item.id);
        if (groupTagsFavoritesUtils.reorderFavoriteItemsInGroup) {
          groupTagsFavoritesUtils.reorderFavoriteItemsInGroup(currentGroup.id, orderedIds).then(async () => {
            customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
            renderTagsGrid();
          });
        } else {
          renderTagsGrid();
        }
      }
    });
    return;
  }

  if (!currentGroup?.tags?.length) return;

  sortableInstances.tags = new Sortable(dom.tagsGrid, {
    ...createCommonSortableOptions(),
    draggable: '.tag-card',
    onStart(evt) {
      // 同步设置 draggedTagInfo，使 Sortable 拖拽也能触发跨分组 drop
      const tagIndex = evt.oldDraggableIndex ?? evt.oldIndex;
      const tag = currentGroup.tags?.[tagIndex];
      if (tag) {
        draggedTagInfo = {
          tag: cloneData(tag),
          sourceCategoryIndex: activeCategoryIndex,
          sourceGroupIndex: activeGroupIndex,
          sourceTagIndex: tagIndex
        };
      }
    },
    onEnd(evt) {
      const { oldIndex, newIndex } = getSortableIndices(evt);
      draggedTagInfo = null; // 拖拽结束时清除状态
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

      const movedTag = moveArrayItem(currentGroup.tags, oldIndex, newIndex);
      if (!movedTag) return;

      currentGroup._modified = true;
      currentCategory._modified = true;
      renderTagsGrid();
    }
  });
}

function refreshSortables() {
  if (!isEditMode) {
    destroyAllSortables();
    return;
  }

  if (typeof Sortable === 'undefined') {
    console.warn('[GroupTags] Sortable.js 未加载，跳过拖拽初始化');
    return;
  }

  initPrimaryTabsSortable();
  initSecondaryTabsSortable();
  initTagsGridSortable();
}

function scheduleSortableRefresh() {
  // 统一合并到下一帧重建，避免一次交互里反复销毁/创建实例
  if (sortableRefreshFrame !== null) return;
  sortableRefreshFrame = requestAnimationFrame(() => {
    sortableRefreshFrame = null;
    refreshSortables();
  });
}

// ========== 弹窗工具 ==========
function showModal(html) {
  dom.modalDialog.innerHTML = html;
  dom.modalOverlay.classList.add('active');
  // 自动聚焦第一个输入框
  const firstInput = dom.modalDialog.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function hideModal() {
  dom.modalOverlay.classList.remove('active');
  dom.modalDialog.innerHTML = '';
}

// 点击 overlay 背景关闭弹窗
dom.modalOverlay.addEventListener('click', (e) => {
  if (e.target === dom.modalOverlay) hideModal();
});

// ========== 编辑模式切换 ==========
async function enterEditMode() {
  isEditMode = true;
  sentenceCardEditState = null;
  // 收藏片段分类的数据直接来自 promptHistory，取消编辑时只回滚普通 Group Tags 数据。
  dataSnapshot = JSON.parse(JSON.stringify(getPersistableGroupTagsData(customGroupsData)));
  if (groupTagsFavoritesUtils.loadPromptHistory) {
    favoritesHistorySnapshot = await groupTagsFavoritesUtils.loadPromptHistory();
  } else {
    favoritesHistorySnapshot = null;
  }
  dom.app.classList.add('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
}

function exitEditMode(save) {
  return finalizeEditMode(save);
}

async function finalizeEditMode(save) {
  destroyAllSortables();
  if (save) {
    const persistableData = getPersistableGroupTagsData(customGroupsData);

    if (groupTagsDataUtils.saveGroupTagsStorage) {
      await groupTagsDataUtils.saveGroupTagsStorage(persistableData);
    } else {
      await new Promise(resolve => {
        chrome.storage.local.set({ groupTagsUserData: persistableData }, resolve);
      });
    }

    await saveSpecialCategoryPosition();

    await flushPendingDictionaryUpserts();
    if (groupTagsDataUtils.syncStoredGroupTagsTranslationsFromDictionary) {
      const synced = await groupTagsDataUtils.syncStoredGroupTagsTranslationsFromDictionary();
      customGroupsData = await rebuildWithSpecialFavorites(synced.data || persistableData, { apply: false });
    } else {
      customGroupsData = await rebuildWithSpecialFavorites(persistableData, { apply: false });
    }

    syncColorsToParent();
    syncTranslationsToParent();
  } else {
    if (favoritesHistorySnapshot && groupTagsFavoritesUtils.savePromptHistory) {
      await groupTagsFavoritesUtils.savePromptHistory(favoritesHistorySnapshot);
    }
    if (dataSnapshot) {
      customGroupsData = await rebuildWithSpecialFavorites(dataSnapshot, { apply: false });
    }
    pendingDictionaryUpserts.clear();
  }

  dataSnapshot = null;
  favoritesHistorySnapshot = null;
  sentenceCardEditState = null;
  isEditMode = false;
  dom.app.classList.remove('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
}

// ========== ID 生成 ==========
function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ========== 导入导出与数据归一化 ==========
function cloneData(data) {
  if (groupTagsDataUtils.cloneData) {
    return groupTagsDataUtils.cloneData(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function sanitizeText(value) {
  if (groupTagsDataUtils.sanitizeText) {
    return groupTagsDataUtils.sanitizeText(value);
  }
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeColor(value) {
  if (groupTagsDataUtils.sanitizeColor) {
    return groupTagsDataUtils.sanitizeColor(value);
  }
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#4a4a6a';
}

function normalizeTagKey(value) {
  if (groupTagsDataUtils.normalizeTagKey) {
    return groupTagsDataUtils.normalizeTagKey(value);
  }
  return sanitizeText(value).toLowerCase();
}

function toCanonicalTagKey(value) {
  if (groupTagsDataUtils.toCanonicalTagKey) {
    return groupTagsDataUtils.toCanonicalTagKey(value);
  }
  return normalizeTagKey(value);
}

function toDisplayTagText(value) {
  if (groupTagsDataUtils.canonicalToDisplayTag) {
    return groupTagsDataUtils.canonicalToDisplayTag(value);
  }
  return sanitizeText(value).replace(/_/g, ' ');
}

function buildLegacyId(prefix, parts) {
  if (groupTagsDataUtils.buildLegacyId) {
    return groupTagsDataUtils.buildLegacyId(prefix, parts);
  }
  const slug = parts
    .map(part => sanitizeText(String(part || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .map(part => part.replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_');
  return `${prefix}_${slug || 'item'}`;
}

function createEmptyGroupTagsData() {
  if (groupTagsDataUtils.createEmptyGroupTagsData) {
    return groupTagsDataUtils.createEmptyGroupTagsData();
  }
  return { categories: [] };
}

function createMergeSummary() {
  if (groupTagsDataUtils.createMergeSummary) {
    return groupTagsDataUtils.createMergeSummary();
  }
  return {
    addedCategories: 0,
    addedGroups: 0,
    addedTags: 0,
    skippedCategories: 0,
    skippedGroups: 0,
    skippedTags: 0,
    skippedInvalid: 0
  };
}

function countSummarySkipped(summary) {
  if (groupTagsDataUtils.countSummarySkipped) {
    return groupTagsDataUtils.countSummarySkipped(summary);
  }
  return summary.skippedCategories + summary.skippedGroups + summary.skippedTags + summary.skippedInvalid;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeGroupTagsData(rawData) {
  if (groupTagsDataUtils.normalizeGroupTagsData) {
    return groupTagsDataUtils.normalizeGroupTagsData(rawData);
  }

  const result = createEmptyGroupTagsData();
  const summary = createMergeSummary();
  const categories = Array.isArray(rawData?.categories) ? rawData.categories : [];
  const seenCategoryIds = new Set();

  categories.forEach((rawCategory, categoryIndex) => {
    if (!rawCategory || typeof rawCategory !== 'object') {
      summary.skippedInvalid += 1;
      return;
    }

    const categoryName = sanitizeText(rawCategory.name) || `Category ${categoryIndex + 1}`;
    let categoryId = sanitizeText(rawCategory.id) || buildLegacyId('cat', [categoryIndex + 1, categoryName]);
    if (seenCategoryIds.has(categoryId)) {
      summary.skippedCategories += 1;
      categoryId = `${categoryId}_${categoryIndex + 1}`;
    }
    seenCategoryIds.add(categoryId);

    const normalizedCategory = {
      id: categoryId,
      name: categoryName,
      groups: []
    };

    const groups = Array.isArray(rawCategory.groups) ? rawCategory.groups : [];
    const seenGroupIds = new Set();
    groups.forEach((rawGroup, groupIndex) => {
      if (!rawGroup || typeof rawGroup !== 'object') {
        summary.skippedInvalid += 1;
        return;
      }

      const groupName = sanitizeText(rawGroup.name) || `Group ${groupIndex + 1}`;
      let groupId = sanitizeText(rawGroup.id) || buildLegacyId('grp', [categoryId, groupIndex + 1, groupName]);
      if (seenGroupIds.has(groupId)) {
        summary.skippedGroups += 1;
        groupId = `${groupId}_${groupIndex + 1}`;
      }
      seenGroupIds.add(groupId);

      const normalizedGroup = {
        id: groupId,
        name: groupName,
        color: sanitizeColor(rawGroup.color),
        tags: []
      };

      const tags = Array.isArray(rawGroup.tags) ? rawGroup.tags : [];
      const seenItemKeys = new Set();
      tags.forEach(rawTag => {
        if (typeof rawTag === 'string') {
          const tagKey = normalizeTagKey(rawTag);
          if (!tagKey || seenItemKeys.has(`tag:${tagKey}`)) {
            summary.skippedInvalid += tagKey ? 0 : 1;
            summary.skippedTags += tagKey ? 1 : 0;
            return;
          }
          seenItemKeys.add(`tag:${tagKey}`);
          normalizedGroup.tags.push({ type: GROUP_ITEM_TYPE_TAG, en: tagKey, zh: '' });
          return;
        }

        if (!rawTag || typeof rawTag !== 'object') {
          summary.skippedInvalid += 1;
          return;
        }

        if (isSentenceGroupItem(rawTag) || rawTag.sourceText || rawTag.resultText) {
          const en = sanitizeText(rawTag.en) || sanitizeText(rawTag.sourceText);
          const zh = sanitizeText(rawTag.zh) || sanitizeText(rawTag.resultText);
          const sentenceKey = buildSentenceItemKey({ en, zh });
          if (!sentenceKey) {
            summary.skippedInvalid += 1;
            return;
          }
          if (seenItemKeys.has(`sentence:${sentenceKey}`)) {
            summary.skippedTags += 1;
            return;
          }
          seenItemKeys.add(`sentence:${sentenceKey}`);
          normalizedGroup.tags.push({
            type: GROUP_ITEM_TYPE_SENTENCE,
            en,
            zh
          });
          return;
        }

        const en = sanitizeText(rawTag.en);
        const zh = sanitizeText(rawTag.zh);
        const tagKey = normalizeTagKey(en);
        if (!tagKey) {
          summary.skippedInvalid += 1;
          return;
        }

        if (seenItemKeys.has(`tag:${tagKey}`)) {
          summary.skippedTags += 1;
          return;
        }

        seenItemKeys.add(`tag:${tagKey}`);
        normalizedGroup.tags.push({ type: GROUP_ITEM_TYPE_TAG, en: tagKey, zh });
      });

      normalizedCategory.groups.push(normalizedGroup);
    });

    result.categories.push(normalizedCategory);
  });

  return { data: result, summary };
}

function mergeGroupTagsData(baseData, sourceData) {
  if (groupTagsDataUtils.mergeGroupTagsData) {
    return groupTagsDataUtils.mergeGroupTagsData(baseData, sourceData);
  }

  const target = cloneData(baseData);
  const summary = createMergeSummary();

  sourceData.categories.forEach(sourceCategory => {
    const targetCategory = target.categories.find(category => category.id === sourceCategory.id);
    if (!targetCategory) {
      target.categories.push(cloneData(sourceCategory));
      summary.addedCategories += 1;
      summary.addedGroups += sourceCategory.groups.length;
      summary.addedTags += sourceCategory.groups.reduce((count, group) => count + group.tags.length, 0);
      return;
    }

    summary.skippedCategories += 1;

    sourceCategory.groups.forEach(sourceGroup => {
      const targetGroup = targetCategory.groups.find(group => group.id === sourceGroup.id);
      if (!targetGroup) {
        targetCategory.groups.push(cloneData(sourceGroup));
        summary.addedGroups += 1;
        summary.addedTags += sourceGroup.tags.length;
        return;
      }

      summary.skippedGroups += 1;
      const existingItemKeys = new Set(targetGroup.tags.map((tag) => {
        if (isSentenceGroupItem(tag)) {
          const sentenceKey = buildSentenceItemKey(tag);
          return sentenceKey ? `sentence:${sentenceKey}` : '';
        }
        const tagKey = normalizeTagKey(tag.en);
        return tagKey ? `tag:${tagKey}` : '';
      }).filter(Boolean));
      sourceGroup.tags.forEach(sourceTag => {
        const itemKey = isSentenceGroupItem(sourceTag)
          ? (() => {
              const sentenceKey = buildSentenceItemKey(sourceTag);
              return sentenceKey ? `sentence:${sentenceKey}` : '';
            })()
          : (() => {
              const tagKey = normalizeTagKey(sourceTag.en);
              return tagKey ? `tag:${tagKey}` : '';
            })();
        if (!itemKey) {
          summary.skippedInvalid += 1;
          return;
        }
        if (existingItemKeys.has(itemKey)) {
          summary.skippedTags += 1;
          return;
        }
        existingItemKeys.add(itemKey);
        targetGroup.tags.push(cloneData(sourceTag));
        summary.addedTags += 1;
      });
    });
  });

  return { data: target, summary };
}

function extractImportData(payload) {
  if (payload && Array.isArray(payload.categories)) return payload;
  if (payload?.format === GROUP_TAGS_EXPORT_FORMAT && payload.data && Array.isArray(payload.data.categories)) {
    return payload.data;
  }
  if (payload?.data && Array.isArray(payload.data.categories)) return payload.data;
  throw new Error('导入文件格式无效，未找到 categories 数组');
}

function clampActiveIndices() {
  if (!customGroupsData?.categories?.length) {
    activeCategoryIndex = 0;
    activeGroupIndex = 0;
    return;
  }

  activeCategoryIndex = Math.min(activeCategoryIndex, customGroupsData.categories.length - 1);
  activeCategoryIndex = Math.max(activeCategoryIndex, 0);

  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory?.groups?.length) {
    activeGroupIndex = 0;
    return;
  }

  activeGroupIndex = Math.min(activeGroupIndex, currentCategory.groups.length - 1);
  activeGroupIndex = Math.max(activeGroupIndex, 0);
}

function getActiveSelectionIds() {
  // 外部刷新前记住当前选中的分类/分组，避免刷新后总是跳回第一个
  const currentCategory = customGroupsData?.categories?.[activeCategoryIndex];
  const currentGroup = currentCategory?.groups?.[activeGroupIndex];
  return {
    categoryId: currentCategory?.id || null,
    groupId: currentGroup?.id || null
  };
}

function restoreActiveSelectionByIds(selection) {
  if (!selection?.categoryId || !customGroupsData?.categories?.length) {
    clampActiveIndices();
    return;
  }

  const nextCategoryIndex = customGroupsData.categories.findIndex(category => category.id === selection.categoryId);
  if (nextCategoryIndex >= 0) {
    activeCategoryIndex = nextCategoryIndex;
  }

  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!selection.groupId || !currentCategory?.groups?.length) {
    clampActiveIndices();
    return;
  }

  const nextGroupIndex = currentCategory.groups.findIndex(group => group.id === selection.groupId);
  if (nextGroupIndex >= 0) {
    activeGroupIndex = nextGroupIndex;
  }

  clampActiveIndices();
}

function resolveEffectiveGroupTagsData(storedData) {
  // Group Tags 面板与 popup 共用同一套“用户数据优先，默认库补新增”的合并规则
  if (groupTagsDataUtils.resolveEffectiveGroupTagsData) {
    return groupTagsDataUtils.resolveEffectiveGroupTagsData(defaultGroupsData, storedData);
  }

  if (storedData && storedData.categories) {
    const normalizedStored = normalizeGroupTagsData(storedData).data;
    return mergeGroupTagsData(normalizedStored, defaultGroupsData).data;
  }
  return cloneData(defaultGroupsData);
}

function findGlobalTagLocation(tagText, options = {}) {
  const normalizedTarget = normalizeTagKey(tagText);
  if (!normalizedTarget || !customGroupsData?.categories) return null;

  // 全局查重：同一个英文 tag 只允许在整个 Group Tags 中出现一次
  const exclude = options.exclude || null;
  for (let categoryIndex = 0; categoryIndex < customGroupsData.categories.length; categoryIndex += 1) {
    const category = customGroupsData.categories[categoryIndex];
    const groups = Array.isArray(category.groups) ? category.groups : [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const tags = Array.isArray(group.tags) ? group.tags : [];
      for (let tagIndex = 0; tagIndex < tags.length; tagIndex += 1) {
        if (
          exclude &&
          exclude.categoryIndex === categoryIndex &&
          exclude.groupIndex === groupIndex &&
          exclude.tagIndex === tagIndex
        ) {
          continue;
        }

        if (isTagGroupItem(tags[tagIndex]) && normalizeTagKey(tags[tagIndex].en) === normalizedTarget) {
          return {
            categoryIndex,
            groupIndex,
            tagIndex,
            categoryName: category.name,
            groupName: group.name
          };
        }
      }
    }
  }
  return null;
}

function formatTagLocation(location) {
  if (!location) return '';
  return `${location.categoryName} > ${location.groupName}`;
}

async function loadEffectiveDictionaryData() {
  if (groupTagsDataUtils.loadEffectiveDictionaryData) {
    return groupTagsDataUtils.loadEffectiveDictionaryData();
  }
  return { entries: [], entryMap: new Map() };
}

async function upsertDictionaryEntry(tagKey, patch = {}) {
  if (groupTagsDataUtils.upsertDictionaryEntry) {
    return groupTagsDataUtils.upsertDictionaryEntry(tagKey, patch);
  }
  return {
    tagKey: toCanonicalTagKey(tagKey),
    entry: null
  };
}

async function ensureDictionaryTagMeta(tagText, zhText) {
  const canonicalTag = toCanonicalTagKey(tagText);
  if (!canonicalTag) {
    return { tagKey: '', entry: null };
  }

  const patch = {};
  if (zhText !== undefined) {
    patch.zhCN = sanitizeText(zhText);
  }
  const result = await upsertDictionaryEntry(canonicalTag, patch);
  return {
    tagKey: result.tagKey || canonicalTag,
    entry: result.entry || null
  };
}

function queueDictionaryTagMeta(tagText, zhText) {
  const canonicalTag = toCanonicalTagKey(tagText);
  if (!canonicalTag) return;
  pendingDictionaryUpserts.set(canonicalTag, {
    zhCN: sanitizeText(zhText)
  });
}

async function flushPendingDictionaryUpserts() {
  if (!pendingDictionaryUpserts.size) return;

  for (const [tagKey, patch] of pendingDictionaryUpserts.entries()) {
    await upsertDictionaryEntry(tagKey, patch);
  }
  pendingDictionaryUpserts.clear();
}

function getCurrentExportData() {
  return normalizeGroupTagsData(getPersistableGroupTagsData(customGroupsData)).data;
}

function buildExportPayload() {
  return {
    format: GROUP_TAGS_EXPORT_FORMAT,
    schemaVersion: GROUP_TAGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: getCurrentExportData()
  };
}

function getTimestampForFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function applyGroupTagsData(nextData) {
  destroyAllSortables();
  const previousSelection = getActiveSelectionIds();
  customGroupsData = nextData;
  // 导入、覆盖等全量应用数据时，尽量保留用户当前浏览位置
  restoreActiveSelectionByIds(previousSelection);
  dataSnapshot = null;
  isEditMode = false;
  dom.app.classList.remove('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
  syncColorsToParent();
  syncTranslationsToParent();
}

function saveGroupTagsData(nextData) {
  const persistableData = getPersistableGroupTagsData(nextData);
  if (groupTagsDataUtils.saveGroupTagsStorage) {
    return groupTagsDataUtils.saveGroupTagsStorage(persistableData);
  }
  return new Promise(resolve => {
    chrome.storage.local.set({ groupTagsUserData: persistableData }, () => resolve(persistableData));
  });
}

function showInfoModal(title, message) {
  showModal(`
    <h3>${escapeHtml(title)}</h3>
    <div style="color:#d1d5db;font-size:12px;line-height:1.6;white-space:pre-line;">${escapeHtml(message)}</div>
    <div class="modal-buttons">
      <button class="modal-btn primary" id="modal-info-confirm">确定</button>
    </div>
  `);
  document.getElementById('modal-info-confirm').onclick = () => hideModal();
}

function promptImportMode() {
  return new Promise(resolve => {
    showModal(`
      <h3>选择导入方式</h3>
      <div style="color:#d1d5db;font-size:12px;line-height:1.6;">
        覆盖：用文件内容替换当前数据，再补齐默认库新增项。<br>
        合并：保留当前数据，只补充文件中的缺失项。
      </div>
      <div class="modal-buttons">
        <button class="modal-btn" id="modal-import-cancel">取消</button>
        <button class="modal-btn" id="modal-import-merge">合并</button>
        <button class="modal-btn primary" id="modal-import-overwrite">覆盖</button>
      </div>
    `);

    document.getElementById('modal-import-cancel').onclick = () => {
      hideModal();
      resolve(null);
    };
    document.getElementById('modal-import-merge').onclick = () => {
      hideModal();
      resolve('merge');
    };
    document.getElementById('modal-import-overwrite').onclick = () => {
      hideModal();
      resolve('overwrite');
    };
  });
}

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function buildImportSummaryMessage(mode, summary, normalizationSummary, defaultSummary) {
  const lines = [];

  if (mode === 'overwrite') {
    lines.push('已用导入文件覆盖当前数据。');
  } else {
    lines.push('已将导入文件合并到当前数据。');
    lines.push(`新增分类 ${summary.addedCategories} 个，分组 ${summary.addedGroups} 个，标签 ${summary.addedTags} 个。`);
  }

  if (defaultSummary.addedCategories || defaultSummary.addedGroups || defaultSummary.addedTags) {
    lines.push(`默认库补增：分类 ${defaultSummary.addedCategories} 个，分组 ${defaultSummary.addedGroups} 个，标签 ${defaultSummary.addedTags} 个。`);
  }

  lines.push(`跳过重复或无效项 ${countSummarySkipped(summary) + countSummarySkipped(normalizationSummary)} 个。`);
  return lines.join('\n');
}

async function exportGroupTagsData() {
  if (!customGroupsData?.categories) {
    showInfoModal('导出失败', '当前没有可导出的分组标签数据。');
    return;
  }

  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `group-tags-${getTimestampForFilename()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importGroupTagsData(file) {
  if (!file) return;

  if (isEditMode) {
    showInfoModal('无法导入', '请先保存或取消当前编辑，再执行导入。');
    return;
  }

  try {
    const payload = await readJsonFile(file);
    const importMode = await promptImportMode();
    if (!importMode) return;

    const rawData = extractImportData(payload);
    const normalizedImport = normalizeGroupTagsData(rawData);
    let nextData;
    let importSummary = createMergeSummary();

    if (importMode === 'overwrite') {
      nextData = cloneData(normalizedImport.data);
    } else {
      const mergedImport = mergeGroupTagsData(getCurrentExportData(), normalizedImport.data);
      nextData = mergedImport.data;
      importSummary = mergedImport.summary;
    }

    const mergedWithDefault = mergeGroupTagsData(nextData, defaultGroupsData);
    nextData = mergedWithDefault.data;

    nextData = await saveGroupTagsData(nextData);
    nextData = await rebuildWithSpecialFavorites(nextData, { apply: false });
    applyGroupTagsData(nextData);

    showInfoModal(
      '导入完成',
      buildImportSummaryMessage(importMode, importSummary, normalizedImport.summary, mergedWithDefault.summary)
    );
  } catch (err) {
    console.error('[GroupTags] Failed to import data:', err);
    showInfoModal('导入失败', err?.message || '无法解析导入文件，请确认 JSON 格式正确。');
  } finally {
    dom.importFileInput.value = '';
  }
}

// ========== 分类操作 ==========
function addCategory() {
  showModal(`
    <h3>新建分类</h3>
    <input class="modal-input" id="modal-cat-name" placeholder="分类名称" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-cat-cancel">取消</button>
      <button class="modal-btn primary" id="modal-cat-confirm">确认</button>
    </div>
  `);
  document.getElementById('modal-cat-cancel').onclick = () => hideModal();
  document.getElementById('modal-cat-confirm').onclick = () => {
    const name = document.getElementById('modal-cat-name').value.trim();
    if (!name) return;
    customGroupsData.categories.push({
      id: generateId('cat'),
      name,
      _modified: true,
      groups: []
    });
    hideModal();
    activeCategoryIndex = customGroupsData.categories.length - 1;
    activeGroupIndex = 0;
    renderPrimaryTabs();
    renderSecondaryTabs();
  };
  // 回车确认
  document.getElementById('modal-cat-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-cat-confirm').click();
  });
}

function deleteCategory(index) {
  const cat = customGroupsData.categories[index];
  if (!cat) return;
  showModal(`
    <h3>确认删除分类</h3>
    <p style="color:#ccc;font-size:13px;">确定要删除分类 "<strong>${cat.name}</strong>" 及其所有分组和标签吗？</p>
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-del-cancel">取消</button>
      <button class="modal-btn danger" id="modal-del-confirm">删除</button>
    </div>
  `);
  document.getElementById('modal-del-cancel').onclick = () => hideModal();
  document.getElementById('modal-del-confirm').onclick = () => {
    markDeletedDefaultCategory(cat.id);
    customGroupsData.categories.splice(index, 1);
    if (activeCategoryIndex >= customGroupsData.categories.length) {
      activeCategoryIndex = Math.max(0, customGroupsData.categories.length - 1);
    }
    activeGroupIndex = 0;
    hideModal();
    renderPrimaryTabs();
    renderSecondaryTabs();
  };
}

// ========== 分组操作 ==========
function addGroup() {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const isSpecialCategory = isSpecialFavoritesCategory(currentCategory);
  const dialogTitle = isSpecialCategory ? '新建文件夹' : '新建分组';
  const inputPlaceholder = isSpecialCategory ? '文件夹名称' : '分组名称';
  showModal(`
    <h3>${dialogTitle}</h3>
    <input class="modal-input" id="modal-grp-name" placeholder="${inputPlaceholder}" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-grp-cancel">取消</button>
      <button class="modal-btn primary" id="modal-grp-confirm">确认</button>
    </div>
  `);
  document.getElementById('modal-grp-cancel').onclick = () => hideModal();
  document.getElementById('modal-grp-confirm').onclick = async () => {
    const name = document.getElementById('modal-grp-name').value.trim();
    if (!name) return;
    if (isSpecialFavoritesCategory(currentCategory)) {
      if (!groupTagsFavoritesUtils.createFavoriteFolder) return;
      await groupTagsFavoritesUtils.createFavoriteFolder(name);
      customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
      const specialCategory = customGroupsData.categories[activeCategoryIndex];
      if (specialCategory?.groups?.length) {
        activeGroupIndex = specialCategory.groups.length - 1;
      }
      hideModal();
      renderSecondaryTabs();
      return;
    }
    currentCategory.groups.push({
      id: generateId('grp'),
      name,
      color: '#4a4a6a',
      _modified: true,
      tags: []
    });
    currentCategory._modified = true;
    hideModal();
    activeGroupIndex = currentCategory.groups.length - 1;
    renderSecondaryTabs();
  };
  document.getElementById('modal-grp-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-grp-confirm').click();
  });
}

function deleteGroup(index) {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  if (isSpecialFavoritesCategory(currentCategory)) {
    const specialGroup = currentCategory.groups[index];
    if (!specialGroup || specialGroup.id === SPECIAL_FAVORITES_ROOT_GROUP_ID || !groupTagsFavoritesUtils.deleteFavoriteFolder) return;
    hideFavoritePreviewPopover();
    showModal(`
      <h3>确认删除文件夹</h3>
      <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认删除文件夹 <strong>${escapeHtml(specialGroup.name)}</strong> 吗？文件夹内收藏会回到未归档分组，这项修改在当前编辑态下可通过取消恢复。</div>
      <div class="modal-buttons">
        <button class="modal-btn" id="modal-special-group-cancel">取消</button>
        <button class="modal-btn danger" id="modal-special-group-confirm">删除</button>
      </div>
    `);
    document.getElementById('modal-special-group-cancel').onclick = () => hideModal();
    document.getElementById('modal-special-group-confirm').onclick = () => {
      hideModal();
      groupTagsFavoritesUtils.deleteFavoriteFolder(specialGroup.id).then(async () => {
        customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
        activeGroupIndex = Math.max(0, Math.min(activeGroupIndex, (customGroupsData.categories[activeCategoryIndex]?.groups?.length || 1) - 1));
        renderSecondaryTabs();
      });
    };
    return;
  }
  const grp = currentCategory.groups[index];
  if (!grp) return;
  showModal(`
    <h3>确认删除分组</h3>
    <p style="color:#ccc;font-size:13px;">确定要删除分组 "<strong>${grp.name}</strong>" 及其所有标签吗？</p>
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-del-grp-cancel">取消</button>
      <button class="modal-btn danger" id="modal-del-grp-confirm">删除</button>
    </div>
  `);
  document.getElementById('modal-del-grp-cancel').onclick = () => hideModal();
  document.getElementById('modal-del-grp-confirm').onclick = () => {
    markDeletedDefaultGroup(currentCategory.id, grp.id);
    const nextCategory = customGroupsData.categories[activeCategoryIndex];
    if (!nextCategory) return;
    nextCategory.groups.splice(index, 1);
    nextCategory._modified = true;
    if (activeGroupIndex >= nextCategory.groups.length) {
      activeGroupIndex = Math.max(0, nextCategory.groups.length - 1);
    }
    hideModal();
    renderSecondaryTabs();
  };
}

// ========== 底部内联添加面板 (Plan A) ==========
function setupInlineAddPanel() {
  const enInput = document.getElementById('inline-tag-en');
  const zhInput = document.getElementById('inline-tag-zh');
  const wrapper = document.getElementById('inline-autocomplete-wrapper');
  const dropdown = document.getElementById('inline-autocomplete-dropdown');
  const resizer = document.getElementById('inline-autocomplete-resizer');
  const submitBtn = document.getElementById('inline-add-submit');

  let selectedIndex = -1;
  let currentMatches = [];

  // 初始化拉拽调高
  let startY = 0;
  let startHeight = 0;

  // 读取可能的已保存高度
  chrome.storage.local.get(['groupTagsAutocompleteHeight'], (data) => {
    if (data.groupTagsAutocompleteHeight) {
      wrapper.style.height = data.groupTagsAutocompleteHeight;
    }
  });

  const onMouseMove = (e) => {
    // 鼠标往上拖动（Y减小），拉长容器；反之缩短 (弹窗在上方，bottom固定)
    const dy = startY - e.clientY; 
    let newHeight = Math.max(100, startHeight + dy);
    wrapper.style.height = `${newHeight}px`;
  };

  const onMouseUp = () => {
    document.body.style.cursor = "";
    resizer.classList.remove('active');
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    chrome.storage.local.set({
      groupTagsAutocompleteHeight: wrapper.style.height,
    });
  };

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Prevent blur on input
    startY = e.clientY;
    startHeight = wrapper.getBoundingClientRect().height;
    document.body.style.cursor = "row-resize";
    resizer.classList.add('active');
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  const closeDropdown = () => {
    wrapper.style.display = 'none';
    selectedIndex = -1;
  };

  const renderDropdown = (matches, query) => {
    if (matches.length === 0) {
      closeDropdown();
      return;
    }
    dropdown.innerHTML = '';
    currentMatches = matches;
    const formatCount = (n) => {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return n + "";
    };

    matches.forEach((m, idx) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      if (idx === selectedIndex) item.classList.add('selected');
      const displayWord = m.displayWord || toDisplayTagText(m.word);
      
      const highlight = (text) => {
        if (!query) return text;
        return text.replace(new RegExp(query, 'gi'), match => `<strong>${match}</strong>`);
      };
      
      item.innerHTML = `
        <span class="ac-en" style="color: ${m.color}">${highlight(displayWord)}</span>
        <span class="ac-zh"><span class="autocomplete-trans">${m.zhCN ? highlight(m.zhCN) : ''}</span> <span class="autocomplete-count">(${formatCount(m.pop)})</span></span>
      `;
      
      item.onclick = () => {
        // 用户期望：只填充输入框，并将词汇中的下划线去掉换成空格，随后聚焦中文框
        enInput.value = m.word.replace(/_/g, ' ');
        if (m.zhCN) zhInput.value = m.zhCN;
        closeDropdown();
        zhInput.focus();
      };
      dropdown.appendChild(item);
    });
    // 使用绝对定位的底部拉起
    wrapper.style.display = 'flex';
  };

  enInput.addEventListener('input', () => {
    // 允许输入下划线，但在匹配逻辑里，将输入的下划线视为空格（与原版字典兼容）
    let valQuery = enInput.value.trim().toLowerCase();
    if (!valQuery) {
      closeDropdown();
      return;
    }
    const valMatch = valQuery.replace(/_/g, ' '); // 将搜索词里的下划线转为空格，对应字典格式
    
    // wildcards-for-novelai-diffusion 的字典中的 word 是带下划线的还是带空格的？原版 Danbooru 是下划线。
    // 但是在 Autocomplete.js 中，字典可能被转换了，或者用户打字去掉了下划线。
    const matches = autocompleteDict.filter(item => 
      item.search.includes(valMatch) || item.word.toLowerCase().includes(valQuery)
    ).slice(0, 50); // 向主页看齐，最大显示50条
    
    selectedIndex = -1;
    renderDropdown(matches, valQuery); // 保持高亮原输入值
  });

  enInput.addEventListener('keydown', (e) => {
    if (wrapper.style.display === 'flex') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % currentMatches.length;
        renderDropdown(currentMatches, enInput.value.trim());
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length;
        renderDropdown(currentMatches, enInput.value.trim());
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && currentMatches[selectedIndex]) {
          const m = currentMatches[selectedIndex];
          enInput.value = m.word.replace(/_/g, ' ');
          if (m.zhCN) zhInput.value = m.zhCN;
          closeDropdown();
          // 如果用户用方向键选中，只做填充并聚焦中文框，不自动提交
          zhInput.focus();
        } else {
          closeDropdown();
          if (!zhInput.value.trim()) zhInput.focus();
          else submitTag();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown();
      }
    } else {
      if (e.key === 'Enter') {
        if (!zhInput.value.trim() && enInput.value.trim()) zhInput.focus();
        else submitTag();
      }
    }
    
    // 从当前滚动位置让选中项可见
    setTimeout(() => {
      if (wrapper.style.display === 'flex') {
        const activeItem = dropdown.querySelector('.selected');
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest' });
        }
      }
    }, 10);
  });

  zhInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTag();
  });

  submitBtn.onclick = submitTag;

  document.addEventListener('mousedown', (e) => {
    if (!wrapper.contains(e.target) && e.target !== enInput) closeDropdown();
  });

  async function submitTag() {
    const displayEn = enInput.value.trim();
    if (!displayEn) return;
    if (isSpecialFavoritesActive()) return;
    const canonicalEn = toCanonicalTagKey(displayEn);
    if (!canonicalEn) return;
    const zh = zhInput.value.trim();
    
    const currentCategory = customGroupsData.categories[activeCategoryIndex];
    if (!currentCategory) return;
    const currentGroup = currentCategory.groups[activeGroupIndex];
    if (!currentGroup) return;

    const existingLocation = findGlobalTagLocation(canonicalEn);
    if (existingLocation) {
      enInput.style.borderColor = '#e74c3c';
      enInput.value = '';
      // 这里直接提示已有位置，避免用户再去猜到底是哪个分组占用了该 tag
      enInput.placeholder = `已存在于 ${formatTagLocation(existingLocation)}`;
      setTimeout(() => {
        enInput.style.borderColor = '';
        enInput.placeholder = 'Input English Tag (e.g. sunny)';
      }, 2000);
      return;
    }

    const dictionaryData = await loadEffectiveDictionaryData();
    const existingEntry = dictionaryData.entryMap?.get(canonicalEn) || null;
    const nextZh = zh || (existingEntry ? (existingEntry.zhCN || '') : '');
    queueDictionaryTagMeta(canonicalEn, nextZh);
    currentGroup.tags.push({
      en: canonicalEn,
      zh: nextZh
    });
    currentGroup._modified = true;
    currentCategory._modified = true;
    
    // 清空重置输入框，连发模式
    enInput.value = '';
    zhInput.value = '';
    enInput.focus();
    renderTagsGrid();
    
    // 让滚动条滑到底部
    setTimeout(() => {
      const gridContainer = document.querySelector('.tags-grid-container');
      if (gridContainer) gridContainer.scrollTop = gridContainer.scrollHeight;
    }, 50);
  }
}

function deleteTag(tagIndex) {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;
  currentGroup.tags.splice(tagIndex, 1);
  currentGroup._modified = true;
  currentCategory._modified = true;
  renderTagsGrid();
}

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFavoritePreviewHtml(item) {
  const preview = item?.preview || { sections: [] };
  const sectionsHtml = (preview.sections || []).map(section => `
    <div class="favorites-preview-section">
      <div class="favorites-preview-label">${escapeHtmlText(section.label)}</div>
      <div class="favorites-preview-text">${escapeHtmlText(section.text)}</div>
    </div>
  `).join('');

  return `
    <div class="favorites-preview-title">
      <div>
        <div>${escapeHtmlText(item.name)}</div>
        <div class="favorites-preview-meta">${escapeHtmlText(groupTagsFavoritesUtils.formatTime ? groupTagsFavoritesUtils.formatTime(item.timestamp) : '')}</div>
      </div>
      <span class="favorite-type-badge ${escapeHtmlText(item.typeClass)}">${escapeHtmlText(item.typeLabel)}</span>
    </div>
    <div class="favorites-preview-body">
      ${sectionsHtml || '<div class="favorites-preview-section"><div class="favorites-preview-text">暂无内容</div></div>'}
    </div>
  `;
}

function buildSentencePreviewHtml(item) {
  const zh = escapeHtmlText(item?.zh || '');
  const en = escapeHtmlText(item?.en || '');
  return `
    <div class="favorites-preview-title">
      <div>
        <div>句子预览</div>
        <div class="favorites-preview-meta">Sentence</div>
      </div>
      <span class="favorite-type-badge sentence-preview-badge">Sentence</span>
    </div>
    <div class="favorites-preview-body">
      <div class="favorites-preview-section">
        <div class="favorites-preview-label">中文</div>
        <div class="favorites-preview-text">${zh || '暂无内容'}</div>
      </div>
      <div class="favorites-preview-section">
        <div class="favorites-preview-label">English</div>
        <div class="favorites-preview-text">${en || 'No content'}</div>
      </div>
    </div>
  `;
}

function positionFavoritePreviewPopover(anchorRect) {
  if (!favoritePreviewPopover) return;
  if (!anchorRect) return;
  const offset = 2;
  favoritePreviewPopover.style.maxWidth = '';
  favoritePreviewPopover.style.maxHeight = '';
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const space = {
    right: Math.max(0, viewportWidth - anchorRect.right - offset - 12),
    left: Math.max(0, anchorRect.left - offset - 12),
    bottom: Math.max(0, viewportHeight - anchorRect.bottom - offset - 12),
    top: Math.max(0, anchorRect.top - offset - 12)
  };
  const naturalRect = favoritePreviewPopover.getBoundingClientRect();
  const preferredOrder = ['right', 'left', 'bottom', 'top'].sort((a, b) => space[b] - space[a]);
  let placement = preferredOrder[0];

  for (const direction of preferredOrder) {
    if ((direction === 'right' || direction === 'left') && space[direction] >= 220) {
      placement = direction;
      break;
    }
    if ((direction === 'bottom' || direction === 'top') && space[direction] >= 180) {
      placement = direction;
      break;
    }
  }

  if (placement === 'right' || placement === 'left') {
    favoritePreviewPopover.style.maxWidth = `${Math.max(220, space[placement])}px`;
    favoritePreviewPopover.style.maxHeight = `${Math.max(160, viewportHeight - 24)}px`;
  } else {
    favoritePreviewPopover.style.maxWidth = `${Math.max(220, viewportWidth - 24)}px`;
    favoritePreviewPopover.style.maxHeight = `${Math.max(160, space[placement])}px`;
  }

  const rect = favoritePreviewPopover.getBoundingClientRect();
  const maxLeft = Math.max(12, viewportWidth - rect.width - 12);
  const maxTop = Math.max(12, viewportHeight - rect.height - 12);

  let left = 12;
  let top = 12;

  if (placement === 'right') {
    left = clampPreviewPosition(anchorRect.right + offset, 12, maxLeft);
    top = clampPreviewPosition(anchorRect.top + ((anchorRect.height - rect.height) / 2), 12, maxTop);
  } else if (placement === 'left') {
    left = clampPreviewPosition(anchorRect.left - rect.width - offset, 12, maxLeft);
    top = clampPreviewPosition(anchorRect.top + ((anchorRect.height - rect.height) / 2), 12, maxTop);
  } else if (placement === 'bottom') {
    left = clampPreviewPosition(anchorRect.left + ((anchorRect.width - rect.width) / 2), 12, maxLeft);
    top = clampPreviewPosition(anchorRect.bottom + offset, 12, maxTop);
  } else {
    left = clampPreviewPosition(anchorRect.left + ((anchorRect.width - rect.width) / 2), 12, maxLeft);
    top = clampPreviewPosition(anchorRect.top - rect.height - offset, 12, maxTop);
  }

  favoritePreviewPopover.style.left = `${left}px`;
  favoritePreviewPopover.style.top = `${top}px`;
}

function bindFavoritePreview(card, item) {
  const updatePosition = () => positionFavoritePreviewPopover(card.getBoundingClientRect());

  card.addEventListener('mouseenter', () => {
    if (favoritePreviewHideTimer) {
      clearTimeout(favoritePreviewHideTimer);
      favoritePreviewHideTimer = null;
    }
    const popover = ensureFavoritePreviewPopover();
    popover.innerHTML = buildFavoritePreviewHtml(item);
    popover.classList.add('visible');
    updatePosition();
  });

  card.addEventListener('mousemove', () => {
    updatePosition();
  });

  card.addEventListener('mouseleave', () => {
    scheduleHideFavoritePreviewPopover();
  });
}

function bindSentencePreview(card, item) {
  const updatePosition = () => positionFavoritePreviewPopover(card.getBoundingClientRect());

  card.addEventListener('mouseenter', () => {
    if (favoritePreviewHideTimer) {
      clearTimeout(favoritePreviewHideTimer);
      favoritePreviewHideTimer = null;
    }
    const popover = ensureFavoritePreviewPopover();
    popover.innerHTML = buildSentencePreviewHtml(item);
    popover.classList.add('visible');
    updatePosition();
  });

  card.addEventListener('mousemove', () => {
    updatePosition();
  });

  card.addEventListener('mouseleave', () => {
    scheduleHideFavoritePreviewPopover();
  });
}

function requestRestoreFavoriteSnapshot(snapshot) {
  if (chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'RESTORE_HISTORY_SNAPSHOT', snapshot });
    return;
  }
  window.parent.postMessage({ type: '__RESTORE_HISTORY__', snapshot }, '*');
}

function requestAppendFavoriteSnippet(snapshot, target) {
  if (chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'APPEND_HISTORY_SNIPPET', snapshot, target });
    return;
  }
  window.parent.postMessage({ type: '__APPEND_HISTORY_SNIPPET__', snapshot, target }, '*');
}

function openFavoriteActionModal(item) {
  hideFavoritePreviewPopover();
  const snapshot = cloneData(item.snapshot);
  if (!snapshot) return;

  if (item.type === 'full') {
    showModal(`
      <h3>恢复整条收藏</h3>
      <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认恢复 <strong>${escapeHtml(item.name)}</strong> 的完整提示词状态？</div>
      <div class="modal-buttons">
        <button class="modal-btn" id="modal-fav-cancel">取消</button>
        <button class="modal-btn primary" id="modal-fav-restore">确认恢复</button>
      </div>
    `);
    document.getElementById('modal-fav-cancel').onclick = () => hideModal();
    document.getElementById('modal-fav-restore').onclick = () => {
      hideModal();
      requestRestoreFavoriteSnapshot(snapshot);
    };
    return;
  }

  if (item.type === 'positive' || item.type === 'negative') {
    const targetLabel = item.type === 'positive' ? '正面' : '负面';
    showModal(`
      <h3>${escapeHtml(item.name)}</h3>
      <div style="color:#d1d5db;font-size:12px;line-height:1.6;">选择对 ${targetLabel} 提示词执行的动作。</div>
      <div class="modal-buttons">
        <button class="modal-btn" id="modal-fav-cancel">取消</button>
        <button class="modal-btn" id="modal-fav-append">追加到${targetLabel}</button>
        <button class="modal-btn primary" id="modal-fav-restore">局部恢复${targetLabel}</button>
      </div>
    `);
    document.getElementById('modal-fav-cancel').onclick = () => hideModal();
    document.getElementById('modal-fav-append').onclick = () => {
      hideModal();
      requestAppendFavoriteSnippet(snapshot, item.type === 'positive' ? 'positive' : 'negative');
    };
    document.getElementById('modal-fav-restore').onclick = () => {
      hideModal();
      requestRestoreFavoriteSnapshot(snapshot);
    };
    return;
  }

  if (item.type === 'character') {
    showModal(`
      <h3>${escapeHtml(item.name)}</h3>
      <div style="color:#d1d5db;font-size:12px;line-height:1.6;">角色片段仅支持局部恢复到对应角色块。</div>
      <div class="modal-buttons">
        <button class="modal-btn" id="modal-fav-cancel">取消</button>
        <button class="modal-btn primary" id="modal-fav-restore">局部恢复角色片段</button>
      </div>
    `);
    document.getElementById('modal-fav-cancel').onclick = () => hideModal();
    document.getElementById('modal-fav-restore').onclick = () => {
      hideModal();
      requestRestoreFavoriteSnapshot(snapshot);
    };
  }
}

function bindFavoriteDropOnGroupTab(button, groupId, groupIndex) {
  if (!isEditMode || !isSpecialFavoritesActive()) return;

  button.addEventListener('dragover', (event) => {
    if (!draggedFavoriteItemId) return;
    event.preventDefault();
    button.classList.add('special-favorites-drop-target');
  });

  button.addEventListener('dragleave', () => {
    button.classList.remove('special-favorites-drop-target');
  });

  button.addEventListener('drop', async (event) => {
    if (!draggedFavoriteItemId || !groupTagsFavoritesUtils.moveFavoriteItemToGroup) return;
    event.preventDefault();
    button.classList.remove('special-favorites-drop-target');
    await groupTagsFavoritesUtils.moveFavoriteItemToGroup(draggedFavoriteItemId, groupId);
    draggedFavoriteItemId = null;
    customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
    activeGroupIndex = groupIndex;
    renderSecondaryTabs();
  });
}

// ========== 普通标签跨分组/跨分类拖拽 ==========
// 将标签卡片拖到二级分组 Tab 上时，把标签从原分组移到目标分组
function bindTagDropOnGroupTab(button, targetCategoryIndex, targetGroupIndex) {
  if (!isEditMode) return;
  // 不在特殊分类的分组上绑定普通标签拖放
  const targetCategory = customGroupsData?.categories?.[targetCategoryIndex];
  if (!targetCategory || isSpecialFavoritesCategory(targetCategory)) return;

  button.addEventListener('dragover', (event) => {
    if (!draggedTagInfo) return; // 只接受普通标签的拖拽，不接受收藏卡片
    event.preventDefault();
    button.classList.add('tag-drop-target');
  });

  button.addEventListener('dragleave', () => {
    button.classList.remove('tag-drop-target');
  });

  button.addEventListener('drop', (event) => {
    if (!draggedTagInfo) return;
    event.preventDefault();
    button.classList.remove('tag-drop-target');

    const { tag, sourceCategoryIndex, sourceGroupIndex, sourceTagIndex } = draggedTagInfo;
    const sourceCategory = customGroupsData?.categories?.[sourceCategoryIndex];
    const sourceGroup = sourceCategory?.groups?.[sourceGroupIndex];
    const targetGroup = targetCategory.groups?.[targetGroupIndex];

    // 不允许放到自身所在的同一分组
    if (sourceCategoryIndex === targetCategoryIndex && sourceGroupIndex === targetGroupIndex) {
      draggedTagInfo = null;
      return;
    }

    if (!sourceGroup?.tags || !targetGroup) {
      draggedTagInfo = null;
      return;
    }

    // 从源分组移除标签
    sourceGroup.tags.splice(sourceTagIndex, 1);
    sourceGroup._modified = true;
    sourceCategory._modified = true;

    // 添加到目标分组末尾
    if (!targetGroup.tags) targetGroup.tags = [];
    targetGroup.tags.push(cloneData(tag));
    targetGroup._modified = true;
    targetCategory._modified = true;

    draggedTagInfo = null;

    // 切换到目标分组并刷新界面
    if (activeCategoryIndex !== targetCategoryIndex) {
      activeCategoryIndex = targetCategoryIndex;
      renderPrimaryTabs();
    }
    activeGroupIndex = targetGroupIndex;
    renderSecondaryTabs();
  });
}

// 将标签卡片拖到一级分类 Tab 上时，把标签移动到目标分类的第一个分组中
function bindTagDropOnPrimaryTab(button, targetCategoryIndex) {
  if (!isEditMode) return;
  const targetCategory = customGroupsData?.categories?.[targetCategoryIndex];
  if (!targetCategory || isSpecialFavoritesCategory(targetCategory)) return;

  button.addEventListener('dragover', (event) => {
    if (!draggedTagInfo) return;
    // 目标分类必须有至少一个分组才能接受放置
    if (!targetCategory.groups?.length) return;
    event.preventDefault();
    button.classList.add('tag-drop-target');
  });

  button.addEventListener('dragleave', () => {
    button.classList.remove('tag-drop-target');
  });

  button.addEventListener('drop', (event) => {
    if (!draggedTagInfo) return;
    event.preventDefault();
    button.classList.remove('tag-drop-target');

    const { tag, sourceCategoryIndex, sourceGroupIndex, sourceTagIndex } = draggedTagInfo;
    const sourceCategory = customGroupsData?.categories?.[sourceCategoryIndex];
    const sourceGroup = sourceCategory?.groups?.[sourceGroupIndex];

    // 默认放到目标分类的第一个分组
    const targetGroupIndex = 0;
    const targetGroup = targetCategory.groups?.[targetGroupIndex];

    // 如果拖放的目标就是原分类的第一个分组，忽略
    if (sourceCategoryIndex === targetCategoryIndex && sourceGroupIndex === targetGroupIndex) {
      draggedTagInfo = null;
      return;
    }

    if (!sourceGroup?.tags || !targetGroup) {
      draggedTagInfo = null;
      return;
    }

    // 从源分组移除标签
    sourceGroup.tags.splice(sourceTagIndex, 1);
    sourceGroup._modified = true;
    sourceCategory._modified = true;

    // 添加到目标分组末尾
    if (!targetGroup.tags) targetGroup.tags = [];
    targetGroup.tags.push(cloneData(tag));
    targetGroup._modified = true;
    targetCategory._modified = true;

    draggedTagInfo = null;

    // 切换到目标分类的第一个分组并刷新
    activeCategoryIndex = targetCategoryIndex;
    activeGroupIndex = targetGroupIndex;
    renderPrimaryTabs();
    renderSecondaryTabs();
  });
}

function renderSpecialFavoritesGrid(currentCategory, currentGroup) {
  const items = currentGroup?.items || [];
  dom.tagsGrid.innerHTML = '';

  if (dom.colorPicker) {
    dom.colorPicker.value = '#4a4a6a';
  }
  const colorBtn = document.getElementById('color-picker-btn');
  if (colorBtn) {
    colorBtn.style.backgroundColor = '#2f3346';
  }

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-grid-tip';
    empty.textContent = '当前分组没有收藏项';
    dom.tagsGrid.appendChild(empty);
    scheduleSortableRefresh();
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'tag-card special-favorite-card';
    card.dataset.favoriteId = item.id;
    card.dataset.favoriteGroupId = currentGroup.id;

    const zhPart = document.createElement('div');
    zhPart.className = 'tag-zh-part';
    zhPart.style.backgroundColor = '#374151';
    zhPart.innerHTML = `
      <span>${escapeHtmlText(item.name)}</span>
      <span class="favorite-type-badge ${escapeHtmlText(item.typeClass)}">${escapeHtmlText(item.typeLabel)}</span>
    `;

    const enPart = document.createElement('div');
    enPart.className = 'tag-en-part';
    enPart.textContent = item.subtitle || '';

    if (!isEditMode) {
      card.onclick = () => openFavoriteActionModal(item);
    }

    if (isEditMode) {
      // 收藏项在编辑模式下允许拖拽排序，同时仍支持拖到分组 Tab 完成跨文件夹移动。
      card.draggable = true;
      card.addEventListener('dragstart', () => {
        draggedFavoriteItemId = item.id;
      });
      card.addEventListener('dragend', () => {
        draggedFavoriteItemId = null;
      });

      const badge = document.createElement('span');
      badge.className = 'card-delete-badge';
      badge.textContent = '×';
      badge.onclick = (event) => {
        event.stopPropagation();
        hideFavoritePreviewPopover();
        if (!groupTagsFavoritesUtils.deleteFavoriteItem) return;
        showModal(`
          <h3>确认删除收藏片段</h3>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认删除 <strong>${escapeHtml(item.name)}</strong> 吗？这项修改在当前编辑态下可通过取消恢复。</div>
          <div class="modal-buttons">
            <button class="modal-btn" id="modal-favorite-delete-cancel">取消</button>
            <button class="modal-btn danger" id="modal-favorite-delete-confirm">删除</button>
          </div>
        `);
        document.getElementById('modal-favorite-delete-cancel').onclick = () => hideModal();
        document.getElementById('modal-favorite-delete-confirm').onclick = async () => {
          hideModal();
          await groupTagsFavoritesUtils.deleteFavoriteItem(item.id);
          customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
          renderTagsGrid();
        };
      };
      card.appendChild(badge);
    }

    card.appendChild(zhPart);
    card.appendChild(enPart);
    bindFavoritePreview(card, item);
    dom.tagsGrid.appendChild(card);
  });

  scheduleSortableRefresh();
}

// ========== 渲染函数 ==========
function renderPrimaryTabs() {
  if (!customGroupsData || !customGroupsData.categories) {
    scheduleSortableRefresh();
    return;
  }
  
  const addBtn = dom.primaryTabs.querySelector('#btn-add-category');
  dom.primaryTabs.innerHTML = '';
  
  customGroupsData.categories.forEach((cat, index) => {
    const isSpecialCategory = isSpecialFavoritesCategory(cat);
    // 普通分类显示使用中的 tag 数量，特殊分类显示收藏总数。
    let usageCount = 0;
    if (isSpecialCategory) {
      usageCount = getFavoriteItemsCount(cat);
    } else if (cat.groups) {
      cat.groups.forEach(g => {
        if (g.tags) {
          g.tags.forEach(t => {
            const promptKey = normalizeTagKey(getGroupItemPromptText(t));
            if (promptKey && activeTagsContext.includes(promptKey)) usageCount++;
          });
        }
      });
    }

    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeCategoryIndex ? 'active' : ''}`;
    if (isSpecialCategory) {
      btn.classList.add('special-category-tab');
    }
    
    // 构建带徽章的文本内容
    const titleSpan = document.createElement('span');
    titleSpan.textContent = cat.name;
    btn.appendChild(titleSpan);

    if (usageCount > 0) {
      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'usage-badge has-usage';
      badgeSpan.textContent = usageCount > 99 ? '99+' : usageCount;
      btn.appendChild(badgeSpan);
    }

    btn.onclick = () => {
      if (index === activeCategoryIndex) return; // 已激活则跳过，避免打断双击
      activeCategoryIndex = index;
      activeGroupIndex = 0;
      renderPrimaryTabs();
      renderSecondaryTabs();
    };

    // 编辑模式：双击重命名 + 悬浮提示
    if (isEditMode && !isSpecialCategory) {
      btn.title = '双击重命名';
      btn.style.cursor = 'text';
      btn.ondblclick = (e) => {
        e.stopPropagation();
        
        // 锁定当前宽度，避免被输入框撑开
        const origWidth = btn.getBoundingClientRect().width;
        btn.style.width = origWidth + 'px';
        btn.style.paddingLeft = '0';
        btn.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = cat.name;
        btn.innerHTML = ''; // 清除 title 和 badge
        btn.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== cat.name) {
            cat.name = newName;
            cat._modified = true;
          }
          renderPrimaryTabs();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderPrimaryTabs();
        });
      };
      // 内嵌删除图标（仅在活跃 Tab 上显示）
      if (index === activeCategoryIndex) {
        const del = document.createElement('span');
        del.className = 'tab-inline-delete';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); deleteCategory(index); };
        btn.appendChild(del);
      }
    }

    // 编辑模式下为非特殊分类 Tab 绑定普通标签拖放接收
    if (isEditMode && !isSpecialCategory) {
      bindTagDropOnPrimaryTab(btn, index);
    }
    dom.primaryTabs.appendChild(btn);
  });
  if (addBtn) dom.primaryTabs.appendChild(addBtn);
  scheduleSortableRefresh();
}

function renderSecondaryTabs() {
  hideFavoritePreviewPopover();
  if (!customGroupsData || !customGroupsData.categories.length) {
    updateSpecialCategoryControls();
    scheduleSortableRefresh();
    return;
  }
  
  const addBtn = dom.secondaryTabs.querySelector('#btn-add-group');
  dom.secondaryTabs.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  const isSpecialCategory = isSpecialFavoritesCategory(currentCategory);
  updateSpecialCategoryControls();
  if (!currentCategory || !currentCategory.groups) {
    scheduleSortableRefresh();
    return;
  }
  
  currentCategory.groups.forEach((grp, index) => {
    // 普通分组显示使用中的 tag 数量，收藏分组显示当前组项目数。
    let usageCount = 0;
    if (isSpecialCategory) {
      usageCount = (grp.items || []).length;
    } else if (grp.tags) {
      grp.tags.forEach(t => {
        const promptKey = normalizeTagKey(getGroupItemPromptText(t));
        if (promptKey && activeTagsContext.includes(promptKey)) usageCount++;
      });
    }

    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeGroupIndex ? 'active' : ''}`;
    if (isSpecialCategory) {
      btn.classList.add('special-favorites-group-tab');
    }
    if (isSpecialCategory && grp.id !== SPECIAL_FAVORITES_ROOT_GROUP_ID) {
      btn.classList.add('special-folder-tab');
    }
    if (isSpecialCategory && grp.id === SPECIAL_FAVORITES_ROOT_GROUP_ID) {
      btn.classList.add('special-root-tab');
    }
    
    // 构建带徽章的文本内容
    const titleSpan = document.createElement('span');
    titleSpan.textContent = grp.name;
    btn.appendChild(titleSpan);

    if (usageCount > 0) {
      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'usage-badge has-usage';
      badgeSpan.textContent = usageCount > 99 ? '99+' : usageCount;
      btn.appendChild(badgeSpan);
    }

    btn.onclick = () => {
      if (index === activeGroupIndex) return; // 已激活则跳过，避免打断双击
      activeGroupIndex = index;
      renderSecondaryTabs();
    };

    // 编辑模式：双击重命名 + 悬浮提示
    if (isEditMode && !isSpecialCategory) {
      btn.title = '双击重命名';
      btn.style.cursor = 'text';
      btn.ondblclick = (e) => {
        e.stopPropagation();
        
        const origWidth = btn.getBoundingClientRect().width;
        btn.style.width = origWidth + 'px';
        btn.style.paddingLeft = '0';
        btn.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = grp.name;
        btn.innerHTML = ''; // 清除 title 和 badge
        btn.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== grp.name) {
            grp.name = newName;
            grp._modified = true;
            currentCategory._modified = true;
          }
          renderSecondaryTabs();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderSecondaryTabs();
        });
      };
      // 内嵌删除图标（仅在活跃 Tab 上显示）
      if (index === activeGroupIndex) {
        const del = document.createElement('span');
        del.className = 'tab-inline-delete';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); deleteGroup(index); };
        btn.appendChild(del);
      }
    }

    if (isEditMode && isSpecialCategory) {
      if (grp.id !== SPECIAL_FAVORITES_ROOT_GROUP_ID) {
        btn.title = '双击重命名文件夹';
        btn.style.cursor = 'text';
        btn.ondblclick = (event) => {
          event.stopPropagation();
          const input = document.createElement('input');
          input.className = 'inline-rename-input';
          input.value = grp.name;
          btn.innerHTML = '';
          btn.appendChild(input);
          input.focus();
          input.select();
          const commit = async () => {
            const nextName = input.value.trim();
            if (nextName && groupTagsFavoritesUtils.renameFavoriteFolder) {
              await groupTagsFavoritesUtils.renameFavoriteFolder(grp.id, nextName);
              customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
            }
            renderSecondaryTabs();
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') renderSecondaryTabs();
          });
        };

        if (index === activeGroupIndex) {
          const del = document.createElement('span');
          del.className = 'tab-inline-delete';
          del.textContent = '×';
          del.onclick = (event) => {
            event.stopPropagation();
            hideFavoritePreviewPopover();
            if (!groupTagsFavoritesUtils.deleteFavoriteFolder) return;
            showModal(`
              <h3>确认删除文件夹</h3>
              <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认删除文件夹 <strong>${escapeHtml(grp.name)}</strong> 吗？文件夹内收藏会回到未归档分组，这项修改在当前编辑态下可通过取消恢复。</div>
              <div class="modal-buttons">
                <button class="modal-btn" id="modal-folder-delete-cancel">取消</button>
                <button class="modal-btn danger" id="modal-folder-delete-confirm">删除</button>
              </div>
            `);
            document.getElementById('modal-folder-delete-cancel').onclick = () => hideModal();
            document.getElementById('modal-folder-delete-confirm').onclick = async () => {
              hideModal();
              await groupTagsFavoritesUtils.deleteFavoriteFolder(grp.id);
              customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
              activeGroupIndex = Math.max(0, activeGroupIndex - 1);
              renderSecondaryTabs();
            };
          };
          btn.appendChild(del);
        }
      }

      bindFavoriteDropOnGroupTab(btn, grp.id, index);
    }

    // 编辑模式下为非特殊分类的分组 Tab 绑定普通标签拖放接收
    if (isEditMode && !isSpecialCategory) {
      bindTagDropOnGroupTab(btn, activeCategoryIndex, index);
    }

    dom.secondaryTabs.appendChild(btn);
  });
  if (addBtn) dom.secondaryTabs.appendChild(addBtn);
  
  renderTagsGrid();
  scheduleSortableRefresh();
}

function renderTagsGrid() {
  hideFavoritePreviewPopover();
  if (!customGroupsData || !customGroupsData.categories.length) {
    updateSpecialCategoryControls();
    scheduleSortableRefresh();
    return;
  }
  dom.tagsGrid.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  updateSpecialCategoryControls();
  if (!currentCategory || !currentCategory.groups.length) {
    scheduleSortableRefresh();
    return;
  }
  
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) {
    scheduleSortableRefresh();
    return;
  }

  if (isSpecialFavoritesCategory(currentCategory)) {
    renderSpecialFavoritesGrid(currentCategory, currentGroup);
    return;
  }

  // 更新底部的颜色选择器
  if (dom.colorPicker) {
    const color = currentGroup.color || '#4a4a6a';
    dom.colorPicker.value = color;
    const btn = document.getElementById('color-picker-btn');
    if (btn) btn.style.backgroundColor = color;
  }

  const isEditingSentenceCard = (tagIndex) => (
    !!sentenceCardEditState
    && sentenceCardEditState.categoryIndex === activeCategoryIndex
    && sentenceCardEditState.groupIndex === activeGroupIndex
    && sentenceCardEditState.tagIndex === tagIndex
  );

  const openSentenceCardEditor = (tagIndex, item) => {
    sentenceCardEditState = {
      categoryIndex: activeCategoryIndex,
      groupIndex: activeGroupIndex,
      tagIndex,
      draftZh: sanitizeText(item.zh),
      draftEn: sanitizeText(item.en)
    };
    renderTagsGrid();
  };

  const closeSentenceCardEditor = () => {
    sentenceCardEditState = null;
    renderTagsGrid();
  };

  const commitSentenceCardEditor = (item) => {
    if (!sentenceCardEditState) return;
    const nextZh = sanitizeText(sentenceCardEditState.draftZh);
    const nextEn = sanitizeText(sentenceCardEditState.draftEn);
    if (!nextZh || !nextEn) {
      showInfoModal('句子不能为空', '句子的中文和英文内容都不能为空。');
      return;
    }
    item.zh = nextZh;
    item.en = nextEn;
    currentGroup._modified = true;
    currentCategory._modified = true;
    sentenceCardEditState = null;
    renderTagsGrid();
  };

  currentGroup.tags.forEach((t, tagIndex) => {
    const isSentence = isSentenceGroupItem(t);
    const isSentenceEditing = isSentence && isEditingSentenceCard(tagIndex);
    const promptText = getGroupItemPromptText(t);
    const promptKey = normalizeTagKey(promptText);
    const translationText = getGroupItemTranslationText(t);
    const isUsedHere = !!promptKey && activeTagsContext.includes(promptKey);
    const isUsedOther = !!promptKey && inactiveTagsContext.includes(promptKey);
    const displayEn = isSentence ? '' : toDisplayTagText(t.en);
    const sentenceEn = isSentence ? sanitizeText(t.en) : '';
    const sentenceZh = isSentence ? sanitizeText(t.zh) : '';

    const card = document.createElement('div');
    card.className = `tag-card ${isSentence ? 'sentence-card' : ''} ${isSentenceEditing ? 'sentence-card-editing' : ''} ${isUsedHere ? 'used' : ''} ${isUsedOther && !isUsedHere ? 'used-other' : ''}`.trim();
    if (!isSentence) {
      card.title = `${t.zh}\n${displayEn}`;
    }
    
    // 点击事件：编辑模式下禁用追加/移除
    if (!isEditMode) {
      card.onclick = () => {
        if (isUsedHere) {
          window.parent.postMessage({ type: '__REMOVE_TAG_FROM_PANEL__', tag: isSentence ? promptText : displayEn }, '*');
        } else if (isUsedOther) {
          card.style.transform = 'translateX(5px)';
          setTimeout(() => card.style.transform = 'translateX(-5px)', 50);
          setTimeout(() => card.style.transform = 'translateX(5px)', 100);
          setTimeout(() => card.style.transform = 'translateX(0)', 150);
        } else {
          window.parent.postMessage({
            type: '__APPEND_TAG_FROM_PANEL__',
            tag: isSentence ? promptText : displayEn,
            zh: isSentence ? translationText : t.zh
          }, '*');
        }
      };
    }
    if (isSentence && !isSentenceEditing) {
      bindSentencePreview(card, t);
    }

    if (isEditMode && isSentence && !isSentenceEditing) {
      card.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSentenceCardEditor(tagIndex, t);
      };
    }

    if (isSentenceEditing) {
      card.title = '';
      const zhEditor = document.createElement('textarea');
      zhEditor.className = 'inline-rename-input sentence-inline-input sentence-inline-zh';
      zhEditor.placeholder = '中文';
      zhEditor.value = sentenceCardEditState?.draftZh || '';
      zhEditor.addEventListener('input', () => {
        if (!sentenceCardEditState) return;
        sentenceCardEditState.draftZh = zhEditor.value;
      });
      zhEditor.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
          ev.preventDefault();
          commitSentenceCardEditor(t);
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeSentenceCardEditor();
        }
      });

      const enEditor = document.createElement('textarea');
      enEditor.className = 'inline-rename-input sentence-inline-input sentence-inline-en';
      enEditor.placeholder = 'English';
      enEditor.value = sentenceCardEditState?.draftEn || '';
      enEditor.addEventListener('input', () => {
        if (!sentenceCardEditState) return;
        sentenceCardEditState.draftEn = enEditor.value;
      });
      enEditor.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
          ev.preventDefault();
          commitSentenceCardEditor(t);
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeSentenceCardEditor();
        }
      });

      const actions = document.createElement('div');
      actions.className = 'sentence-edit-actions';

      const btnSaveSentence = document.createElement('button');
      btnSaveSentence.type = 'button';
      btnSaveSentence.className = 'sentence-edit-btn primary';
      btnSaveSentence.textContent = '保存';
      btnSaveSentence.addEventListener('click', (e) => {
        e.stopPropagation();
        commitSentenceCardEditor(t);
      });

      const btnCancelSentence = document.createElement('button');
      btnCancelSentence.type = 'button';
      btnCancelSentence.className = 'sentence-edit-btn';
      btnCancelSentence.textContent = '取消';
      btnCancelSentence.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSentenceCardEditor();
      });

      actions.appendChild(btnSaveSentence);
      actions.appendChild(btnCancelSentence);

      card.appendChild(zhEditor);
      card.appendChild(enEditor);
      card.appendChild(actions);
      dom.tagsGrid.appendChild(card);
      setTimeout(() => {
        if (document.activeElement !== zhEditor && document.body.contains(zhEditor)) {
          zhEditor.focus();
          zhEditor.setSelectionRange(zhEditor.value.length, zhEditor.value.length);
        }
      }, 0);
      return;
    }

    const zhPart = document.createElement('div');
    zhPart.className = `tag-zh-part ${isSentence ? 'sentence-result-part' : ''}`.trim();
    zhPart.style.backgroundColor = currentGroup.color || '#4a4a6a';
    zhPart.textContent = isSentence ? sentenceZh : t.zh;

    // 编辑模式：双击编辑翻译 + 悬浮提示
    if (isEditMode) {
      zhPart.title = isSentence ? '双击编辑句子' : '双击编辑翻译';
      zhPart.style.cursor = 'text';
      zhPart.ondblclick = (e) => {
        e.stopPropagation();
        if (isSentence) {
          openSentenceCardEditor(tagIndex, t);
          return;
        }

        const origWidth = zhPart.getBoundingClientRect().width;
        zhPart.style.width = origWidth + 'px';
        zhPart.style.boxSizing = 'border-box';
        zhPart.style.paddingLeft = '0';
        zhPart.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = t.zh;
        zhPart.textContent = '';
        zhPart.appendChild(input);
        input.focus();
        input.select();
        const commit = async () => {
          const newZh = input.value.trim();
          queueDictionaryTagMeta(t.en, newZh);
          t.zh = newZh;
          currentGroup._modified = true;
          currentCategory._modified = true;
          renderTagsGrid();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderTagsGrid();
        });
      };
    }

    const enPart = document.createElement('div');
    enPart.className = `tag-en-part ${isSentence ? 'sentence-source-part' : ''}`.trim();
    enPart.textContent = isSentence ? sentenceEn : displayEn;
    
    // 编辑模式：双方皆可双击编辑
    if (isEditMode) {
      enPart.title = isSentence ? '双击编辑句子' : '双击编辑英文';
      enPart.style.cursor = 'text';
      enPart.ondblclick = (e) => {
        e.stopPropagation();
        if (isSentence) {
          openSentenceCardEditor(tagIndex, t);
          return;
        }

        const origWidth = enPart.getBoundingClientRect().width;
        enPart.style.width = origWidth + 'px';
        enPart.style.boxSizing = 'border-box';
        enPart.style.paddingLeft = '0';
        enPart.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = displayEn;
        enPart.textContent = '';
        enPart.appendChild(input);
        input.focus();
        input.select();
        const commit = async () => {
          const newDisplayEn = input.value.trim();
          const newEn = toCanonicalTagKey(newDisplayEn);
          const existingLocation = findGlobalTagLocation(newEn, {
            exclude: { categoryIndex: activeCategoryIndex, groupIndex: activeGroupIndex, tagIndex }
          });
          if (existingLocation) {
            showInfoModal('标签已存在', `该标签已存在于 ${formatTagLocation(existingLocation)}，不能重复添加到多个分组。`);
          } else if (newEn && newEn !== t.en) {
            const dictionaryData = await loadEffectiveDictionaryData();
            const existingEntry = dictionaryData.entryMap?.get(newEn) || null;
            t.en = newEn;
            t.zh = existingEntry ? (existingEntry.zhCN || '') : t.zh;
            queueDictionaryTagMeta(newEn, t.zh);
            currentGroup._modified = true;
            currentCategory._modified = true;
          }
          renderTagsGrid();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderTagsGrid();
        });
      };
    }

    card.appendChild(zhPart);
    card.appendChild(enPart);

    // 编辑模式：拖拽 + × 删除角标
    if (isEditMode) {
      // 允许拖拽到其他分组或分类的 Tab 上来跨组移动
      card.draggable = !isSentenceEditing;
      card.addEventListener('dragstart', () => {
        if (isSentenceEditing) return;
        draggedTagInfo = {
          tag: cloneData(t),
          sourceCategoryIndex: activeCategoryIndex,
          sourceGroupIndex: activeGroupIndex,
          sourceTagIndex: tagIndex
        };
      });
      card.addEventListener('dragend', () => {
        draggedTagInfo = null;
      });

      const badge = document.createElement('span');
      badge.className = 'card-delete-badge';
      badge.textContent = '×';
      badge.onclick = (e) => { e.stopPropagation(); deleteTag(tagIndex); };
      card.appendChild(badge);
    }

    dom.tagsGrid.appendChild(card);
  });

  scheduleSortableRefresh();

  // 移除之前充当占位的“+”卡片，因为现在我们有底部输入面板了
}

// ========== 监听来自父窗口的消息（标签同步等） ==========
window.addEventListener('message', (e) => {
  if (e.data?.type === '__SYNC_ACTIVE_TAGS__') {
    const parseTags = (tagsArray) => {
      if (!Array.isArray(tagsArray)) return [];
      return tagsArray.map(t => {
        let v = (t.value || '').trim();
        while (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
        while (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
        const blockMatch = v.match(/^[-?\d\.]+::(.*?)\s*::$/);
        if (blockMatch) v = blockMatch[1];
        return toCanonicalTagKey(v);
      }).filter(Boolean);
    };

    activeTagsContext = parseTags(e.data.activeTags);
    inactiveTagsContext = parseTags(e.data.inactiveTags);
    
    if (e.data.targetLabel) {
      const labelEl = document.getElementById('target-label');
      if (labelEl) labelEl.textContent = e.data.targetLabel;
    }

    renderTagsGrid();
    // 根据最新同步的 active tags 更新顶部 Tab 栏上的数字角标
    // 如果处于编辑模式下正在双击输入改名，强制刷新可能会打断焦点，所以避开
    if (!isEditMode) {
      renderPrimaryTabs();
      renderSecondaryTabs();
    }
  }
});

// ========== 字典加载 ==========
const getColor = (code) => {
  const colorMap = { 0: "lightblue", 1: "indianred", 3: "violet", 4: "lightgreen", 5: "orange", 6: "red", 7: "lightblue", 8: "gold", 9: "gold", 10: "violet", 11: "lightgreen", 12: "tomato", 14: "whitesmoke", 15: "seagreen" };
  return colorMap[code] || "lightblue";
};

async function loadDictionary() {
  try {
    const dictionaryData = await loadEffectiveDictionaryData();
    autocompleteDict = (dictionaryData.entries || []).map(entry => {
      const word = toCanonicalTagKey(entry.tag);
      const aliases = sanitizeText(entry.aliases);
      const zhCN = sanitizeText(entry.zhCN);
      const displayWord = toDisplayTagText(word);
      return {
        word,
        displayWord,
        zhCN,
        color: getColor(entry.color),
        pop: Number(entry.count) || 0,
        search: `${word} ${displayWord} ${aliases} ${zhCN}`.toLowerCase()
      };
    }).filter(item => item.word);
    
    // 按热度排序
    autocompleteDict.sort((a, b) => b.pop - a.pop);
    console.log('[GroupTags] Dictionary loaded, count:', autocompleteDict.length);
  } catch (err) {
    console.error('[GroupTags] Failed to load dictionary:', err);
  }
}

// ========== 初始化 ==========
async function init() {
  try {
    // 加载字典
    await loadDictionary();
    await loadSpecialCategoryPosition();
    const jsonUrl = chrome.runtime.getURL('data/default_group_tags.json');
    const res = await fetch(jsonUrl);
    const defaultData = await res.json();
    defaultGroupsData = normalizeGroupTagsData(defaultData).data;
    
    // 2. 从 chrome.storage.local 加载用户自定义数据
    let stored = await new Promise(resolve => {
      chrome.storage.local.get('groupTagsUserData', (data) => resolve(data.groupTagsUserData));
    });
    if (stored?.categories && groupTagsDataUtils.migrateStoredGroupTagsData) {
      // 初始化时自动迁移旧格式 tag，并把翻译回填到主库规范
      const migrated = await groupTagsDataUtils.migrateStoredGroupTagsData();
      stored = migrated.data || stored;
    }
    
    const resolvedData = resolveEffectiveGroupTagsData(stored);
    customGroupsData = await rebuildWithSpecialFavorites(resolvedData, { apply: false });
    
    // 3. 渲染 UI 与事件绑定
    setupInlineAddPanel();
    renderPrimaryTabs();
    renderSecondaryTabs();
    
    // 4. 推送颜色映射和翻译映射
    syncColorsToParent();
    syncTranslationsToParent();
    hasInitializedGroupTagsPanel = true;
    
    console.log('[GroupTags] Initialized, categories:', customGroupsData.categories.length);
  } catch (err) {
    console.error('[GroupTags] Failed to init:', err);
    customGroupsData = await rebuildWithSpecialFavorites({ categories: [] }, { apply: false });
    renderPrimaryTabs();
    renderSecondaryTabs();
  }
}

init();

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !hasInitializedGroupTagsPanel) return;
  if (isEditMode) {
    // 编辑模式下不自动覆盖，避免把用户未保存的本地修改冲掉
    if (changes.groupTagsUserData || changes.promptHistory || changes.groupTagsSpecialCategoryPosition) {
      console.info('[GroupTags] 检测到外部数据更新，当前处于编辑模式，暂不自动刷新。');
    }
    return;
  }

  if (!changes.groupTagsUserData && !changes.promptHistory && !changes.groupTagsSpecialCategoryPosition) return;

  const previousSelection = getActiveSelectionIds();
  // 非编辑模式下允许响应 popup 的 +G 写入，并沿用默认库补增规则重新生成有效数据
  const persistableData = changes.groupTagsUserData
    ? resolveEffectiveGroupTagsData(changes.groupTagsUserData.newValue)
    : stripSpecialFavoritesCategory(customGroupsData);
  customGroupsData = await rebuildWithSpecialFavorites(persistableData, { apply: false });
  restoreActiveSelectionByIds(previousSelection);
  renderPrimaryTabs();
  renderSecondaryTabs();
  syncColorsToParent();
  syncTranslationsToParent();
});

// ========== 按钮事件绑定 ==========

// 颜色选择器
dom.colorPicker.addEventListener('input', (e) => {
  if (isSpecialFavoritesActive()) return;
  const newColor = e.target.value;
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;
  
  currentGroup.color = newColor;
  currentGroup._modified = true;
  currentCategory._modified = true;
  
  const btn = document.getElementById('color-picker-btn');
  if (btn) btn.style.backgroundColor = newColor;
  
  renderTagsGrid();
  syncColorsToParent();
});

// Edit / Save / Cancel
dom.btnEdit.addEventListener('click', () => enterEditMode());
dom.btnExport.addEventListener('click', () => exportGroupTagsData());
dom.btnImport.addEventListener('click', () => dom.importFileInput.click());
dom.btnSave.addEventListener('click', () => finalizeEditMode(true));
dom.btnCancel.addEventListener('click', () => finalizeEditMode(false));
dom.importFileInput.addEventListener('change', (e) => {
  const [file] = e.target.files || [];
  importGroupTagsData(file);
});

// + 按钮（编辑模式下才可用）
dom.btnAddCategory.addEventListener('click', () => {
  if (isEditMode) addCategory();
});
dom.btnAddGroup.addEventListener('click', () => {
  if (isEditMode) addGroup();
});
