// ========== 核心数据与状态 (Phase 1) ==========
const groupTagsRuntime = globalThis.NaiAioRuntime;
const groupTagsStorageApi = globalThis.NaiAioStorage;
if (!groupTagsRuntime?.acquire || !groupTagsStorageApi?.createRepository) {
  throw new Error('[GroupTagsPanel] 运行时内核或扩展存储仓库未加载');
}
const groupTagsScope = groupTagsRuntime.acquire('extension:group-tags-panel');
const groupTagsStorage = groupTagsStorageApi.createRepository(chrome.storage.local, { logger: console });

let customGroupsData = null;
let defaultGroupsData = { categories: [] };
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let hasInitializedGroupTagsPanel = false;
const groupTagsDataUtils = window.GroupTagsDataUtils;
if (!groupTagsDataUtils) {
  throw new Error('[GroupTagsPanel] 共享数据模块 lib/group-tags-data.js 未加载');
}
const requiredGroupTagsDataMethods = [
  'cloneData',
  'sanitizeText',
  'sanitizeColor',
  'normalizeGroupItemType',
  'isSentenceGroupItem',
  'isTagGroupItem',
  'buildSentenceItemKey',
  'getGroupItemPromptText',
  'getGroupItemTranslationText',
  'normalizeTagKey',
  'toCanonicalTagKey',
  'canonicalToDisplayTag',
  'buildLegacyId',
  'createMergeSummary',
  'countSummarySkipped',
  'normalizeGroupTagsData',
  'mergeGroupTagsData',
  'buildColorMap',
  'buildTranslationMap',
  'resolveEffectiveGroupTagsData',
  'loadEffectiveDictionaryData',
  'upsertDictionaryEntry',
  'markDefaultCategoryDeleted',
  'markDefaultGroupDeleted',
  'migrateStoredGroupTagsData',
  'saveGroupTagsStorage',
  'syncStoredGroupTagsTranslationsFromDictionary',
  'syncTranslationsToDictionary'
];
const missingGroupTagsDataMethods = requiredGroupTagsDataMethods.filter(
  methodName => typeof groupTagsDataUtils[methodName] !== 'function'
);
if (missingGroupTagsDataMethods.length > 0) {
  throw new Error(`[GroupTagsPanel] 共享数据模块不完整: ${missingGroupTagsDataMethods.join(', ')}`);
}
const groupTagsFavoritesUtils = window.GroupTagsFavoritesUtils || {};
const groupTagsPreviewApi = window.GroupTagsPreviewController;
if (!groupTagsPreviewApi?.createController) {
  throw new Error('[GroupTagsPanel] 悬浮预览控制器 lib/group-tags-preview-controller.js 未加载');
}
const groupTagsSortableApi = window.GroupTagsSortableController;
if (!groupTagsSortableApi?.createController) {
  throw new Error('[GroupTagsPanel] 排序控制器 lib/group-tags-sortable-controller.js 未加载');
}
const groupTagsImportExportApi = window.GroupTagsImportExportController;
if (!groupTagsImportExportApi?.createController) {
  throw new Error('[GroupTagsPanel] 导入导出控制器 lib/group-tags-import-export-controller.js 未加载');
}
const groupTagsInlineAddApi = window.GroupTagsInlineAddController;
if (!groupTagsInlineAddApi?.createController) {
  throw new Error('[GroupTagsPanel] 标签新增控制器 lib/group-tags-inline-add-controller.js 未加载');
}
const groupTagsEditApi = window.GroupTagsEditController;
if (!groupTagsEditApi?.createController) {
  throw new Error('[GroupTagsPanel] 编辑控制器 lib/group-tags-edit-controller.js 未加载');
}
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
let favoritesHistorySnapshot = null;
let sentenceCardEditState = null;
let specialFavoritesDirty = false;

function normalizeGroupItemType(value) {
  return groupTagsDataUtils.normalizeGroupItemType(value);
}

function isSentenceGroupItem(value) {
  return groupTagsDataUtils.isSentenceGroupItem(value);
}

function isTagGroupItem(value) {
  return groupTagsDataUtils.isTagGroupItem(value);
}

function buildSentenceItemKey(value) {
  return groupTagsDataUtils.buildSentenceItemKey(value);
}

function getGroupItemPromptText(value) {
  return groupTagsDataUtils.getGroupItemPromptText(value);
}

function getGroupItemTranslationText(value) {
  return groupTagsDataUtils.getGroupItemTranslationText(value);
}

// ========== 密度控制逻辑 ==========
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
groupTagsStorage.get(STORAGE_KEY_DENSITY).then(data => {
  // 默认设置为目前的高密度状态 (大致相当于 value=80)
  const val = data[STORAGE_KEY_DENSITY] !== undefined ? data[STORAGE_KEY_DENSITY] : 80;
  densitySlider.value = val;
  applyDensity(val);
}).catch(error => console.error('[GroupTags] 读取密度设置失败:', error));

// 监听拖动并实时应用并保存
groupTagsScope.on(densitySlider, 'input', (e) => {
  const val = e.target.value;
  applyDensity(val);
  groupTagsStorage.set({ [STORAGE_KEY_DENSITY]: val }).catch(() => {});
});

// ========== 颜色自定义与同步 ==========

// 构建全局 tag→color 的扁平映射表
function buildColorMap() {
  return groupTagsDataUtils.buildColorMap(customGroupsData);
}

// 将颜色映射发送给父窗口
function syncColorsToParent() {
  const colorMap = buildColorMap();
  window.parent.postMessage({ type: '__SYNC_GROUP_COLORS__', colorMap }, '*');
}

// 构建全局 tag→zh 的翻译映射表
function buildTranslationMap() {
  return groupTagsDataUtils.buildTranslationMap(customGroupsData);
}

// 将翻译映射直接写入 chrome.storage.local（无需经过 bridge 中继）
function syncTranslationsToParent() {
  const translationMap = buildTranslationMap();
  groupTagsStorage.set({ groupTranslationMap: translationMap }).catch(error => {
    console.error('[GroupTags] 保存翻译映射失败:', error);
  });
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
  tagsGridContainer: document.querySelector('.tags-grid-container'),
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

// ========== 辅助交互 (滚轮横向滚动) (Phase 16.18) ==========
[dom.primaryTabs, dom.secondaryTabs].forEach(el => {
  if (el) {
    groupTagsScope.on(el, 'wheel', (e) => {
      if (e.deltaY !== 0) {
        // 将垂直滚轮偏移量转换为平滑的横向滚动 (Phase 16.19)
        e.preventDefault();
        el.scrollBy({
          left: e.deltaY,
          behavior: 'smooth'
        });
      }
    }, { passive: false });
  }
});

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
  if (!isDefaultCategory(categoryId)) return;
  customGroupsData = groupTagsDataUtils.markDefaultCategoryDeleted(customGroupsData, categoryId);
}

function markDeletedDefaultGroup(categoryId, groupId) {
  if (!isDefaultGroup(categoryId, groupId)) return;
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

async function refreshSpecialFavoritesCategoryInPlace(options = {}) {
  const preserveSelection = options.preserveSelection !== false;
  const previousSelection = preserveSelection ? getActiveSelectionIds() : null;
  customGroupsData = await rebuildWithSpecialFavorites(stripSpecialFavoritesCategory(customGroupsData), { apply: false });
  if (preserveSelection && previousSelection) {
    restoreActiveSelectionByIds(previousSelection);
  }
  specialFavoritesDirty = false;
}

function getFavoriteItemsCount(category) {
  if (!isSpecialFavoritesCategory(category)) return 0;
  return (category.groups || []).reduce((total, group) => total + ((group.items || []).length), 0);
}

const favoritePreviewController = groupTagsPreviewApi.createController({
  scope: groupTagsScope,
  favoritesUtils: groupTagsFavoritesUtils,
  cloneData,
  showModal,
  hideModal,
  modalRoot: dom.modalDialog,
  getIsEditMode: () => isEditMode
});

// 主面板只保留稳定门面，预览 DOM 与计时器由控制器自行管理。
function hideFavoritePreviewPopover() {
  favoritePreviewController.hide();
}

function bindFavoritePreview(card, item) {
  favoritePreviewController.bindFavoritePreview(card, item);
}

function bindSentencePreview(card, item, currentCategory, currentGroup, zhPart, enPart) {
  favoritePreviewController.bindSentencePreview(card, item, {
    currentCategory,
    currentGroup,
    zhPart,
    enPart
  });
}

function openFavoriteActionModal(item) {
  favoritePreviewController.openFavoriteActionModal(item);
}

function updateSpecialCategoryControls() {
  const specialActive = isSpecialFavoritesActive();
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

function applyVisibleCurrentGroupColor(newColor) {
  if (!dom.tagsGrid) return;
  dom.tagsGrid.querySelectorAll('.tag-card:not(.special-favorite-card) .tag-zh-part').forEach((part) => {
    part.style.backgroundColor = newColor;
  });
}

// ========== 拖拽排序 ==========
const sortableController = groupTagsSortableApi.createController({
  scope: groupTagsScope,
  SortableCtor: globalThis.Sortable,
  elements: {
    primaryTabs: dom.primaryTabs,
    secondaryTabs: dom.secondaryTabs,
    tagsGrid: dom.tagsGrid
  },
  getState: () => ({
    isEditMode,
    data: customGroupsData,
    activeCategoryIndex,
    activeGroupIndex
  }),
  setActiveCategoryIndex: value => { activeCategoryIndex = value; },
  setActiveGroupIndex: value => { activeGroupIndex = value; },
  setDraggedFavoriteItemId: value => { draggedFavoriteItemId = value; },
  setDraggedTagInfo: value => { draggedTagInfo = value; },
  cloneData,
  isSpecialCategory: isSpecialFavoritesCategory,
  getSpecialCategoryIndex: () => getSpecialFavoritesIndex(),
  saveSpecialCategoryPosition,
  favoritesUtils: groupTagsFavoritesUtils,
  specialRootGroupId: SPECIAL_FAVORITES_ROOT_GROUP_ID,
  async rebuildSpecialFavorites() {
    customGroupsData = await rebuildWithSpecialFavorites(
      stripSpecialFavoritesCategory(customGroupsData),
      { apply: false }
    );
  },
  renderPrimaryTabs,
  renderSecondaryTabs,
  renderTagsGrid,
  logger: console
});

function destroyAllSortables() {
  sortableController.destroy();
}

function scheduleSortableRefresh() {
  sortableController.schedule();
}



// ========== 弹窗工具 ==========
function showModal(html) {
  dom.modalDialog.innerHTML = html;
  dom.modalOverlay.classList.add('active');
  // 自动聚焦第一个输入框
  const firstInput = dom.modalDialog.querySelector('input');
  if (firstInput) groupTagsScope.timeout(() => firstInput.focus(), 50);
}

function hideModal() {
  dom.modalOverlay.classList.remove('active');
  dom.modalDialog.innerHTML = '';
}

let importExportController = null;

// 点击 overlay 背景关闭弹窗
groupTagsScope.on(dom.modalOverlay, 'click', (e) => {
  if (e.target !== dom.modalOverlay) return;
  // 若导入方式弹窗仍在等待选择，需要同步结束 Promise，避免留下悬空任务。
  importExportController?.cancelPendingDialog({ hide: false });
  hideModal();
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

async function finalizeEditMode(save) {
  destroyAllSortables();
  if (save) {
    const persistableData = getPersistableGroupTagsData(customGroupsData);

    await groupTagsDataUtils.saveGroupTagsStorage(persistableData);

    await saveSpecialCategoryPosition();

    await flushPendingDictionaryUpserts();
    const synced = await groupTagsDataUtils.syncStoredGroupTagsTranslationsFromDictionary();
    customGroupsData = await rebuildWithSpecialFavorites(synced.data || persistableData, { apply: false });

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
  return groupTagsDataUtils.cloneData(data);
}

function sanitizeText(value) {
  return groupTagsDataUtils.sanitizeText(value);
}

function sanitizeColor(value) {
  return groupTagsDataUtils.sanitizeColor(value);
}

function normalizeTagKey(value) {
  return groupTagsDataUtils.normalizeTagKey(value);
}

function toCanonicalTagKey(value) {
  return groupTagsDataUtils.toCanonicalTagKey(value);
}

function toDisplayTagText(value) {
  return groupTagsDataUtils.canonicalToDisplayTag(value);
}

function buildLegacyId(prefix, parts) {
  return groupTagsDataUtils.buildLegacyId(prefix, parts);
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
  return groupTagsDataUtils.normalizeGroupTagsData(rawData);
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
  return groupTagsDataUtils.resolveEffectiveGroupTagsData(defaultGroupsData, storedData);
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
  return groupTagsDataUtils.loadEffectiveDictionaryData();
}

async function upsertDictionaryEntry(tagKey, patch = {}) {
  return groupTagsDataUtils.upsertDictionaryEntry(tagKey, patch);
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
  return groupTagsDataUtils.saveGroupTagsStorage(persistableData);
}

importExportController = groupTagsImportExportApi.createController({
  scope: groupTagsScope,
  dataUtils: groupTagsDataUtils,
  documentRef: document,
  modalRoot: dom.modalDialog,
  importFileInput: dom.importFileInput,
  showModal,
  hideModal,
  getIsEditMode: () => isEditMode,
  getCurrentData: () => normalizeGroupTagsData(getPersistableGroupTagsData(customGroupsData)).data,
  getDefaultData: () => defaultGroupsData,
  saveData: saveGroupTagsData,
  syncTranslations: nextData => groupTagsDataUtils.syncTranslationsToDictionary(nextData),
  rebuildData: nextData => rebuildWithSpecialFavorites(nextData, { apply: false }),
  applyData: applyGroupTagsData,
  logger: console
});

function showInfoModal(title, message) {
  // 编辑操作仍通过统一控制器显示信息，避免面板内维护第二套弹窗协议。
  importExportController.showInfo?.(title, message);
}

function exportGroupTagsData() {
  return importExportController.exportData();
}

function importGroupTagsData(file) {
  return importExportController.importData(file);
}

// ========== 分类操作 ==========
const editController = groupTagsEditApi.createController({
  modalRoot: dom.modalDialog,
  showModal,
  hideModal,
  showInfo: showInfoModal,
  getState: () => ({
    isEditMode,
    data: customGroupsData,
    activeCategoryIndex,
    activeGroupIndex
  }),
  setData: value => { customGroupsData = value; },
  setActiveCategoryIndex: value => { activeCategoryIndex = value; },
  setActiveGroupIndex: value => { activeGroupIndex = value; },
  generateId,
  isSpecialCategory: isSpecialFavoritesCategory,
  specialRootGroupId: SPECIAL_FAVORITES_ROOT_GROUP_ID,
  favoritesUtils: groupTagsFavoritesUtils,
  markDeletedDefaultCategory,
  markDeletedDefaultGroup,
  hideFavoritePreview: hideFavoritePreviewPopover,
  refreshSpecialData: () => rebuildWithSpecialFavorites(
    stripSpecialFavoritesCategory(customGroupsData),
    { apply: false }
  ),
  renderPrimaryTabs,
  renderSecondaryTabs,
  renderTagsGrid,
  logger: console
});

function addCategory() {
  return editController.addCategory();
}

function deleteCategory(index) {
  return editController.deleteCategory(index);
}

function addGroup() {
  return editController.addGroup();
}

function deleteGroup(index) {
  return editController.deleteGroup(index);
}

// ========== 底部内联添加面板 (Plan A) ==========
const inlineAddController = groupTagsInlineAddApi.createController({
  scope: groupTagsScope,
  storage: groupTagsStorage,
  documentRef: document,
  elements: {
    enInput: document.getElementById('inline-tag-en'),
    zhInput: document.getElementById('inline-tag-zh'),
    wrapper: document.getElementById('inline-autocomplete-wrapper'),
    dropdown: document.getElementById('inline-autocomplete-dropdown'),
    resizer: document.getElementById('inline-autocomplete-resizer'),
    submitButton: document.getElementById('inline-add-submit'),
    gridContainer: dom.tagsGridContainer
  },
  getDictionary: () => autocompleteDict,
  getState: () => ({
    data: customGroupsData,
    activeCategoryIndex,
    activeGroupIndex
  }),
  isSpecialCategoryActive: isSpecialFavoritesActive,
  toCanonicalTagKey,
  toDisplayTagText,
  findGlobalTagLocation,
  formatTagLocation,
  loadEffectiveDictionaryData,
  queueDictionaryTagMeta,
  renderTagsGrid,
  onSubmitError: error => showInfoModal('新增失败', error?.message || '无法新增标签，请稍后重试。'),
  logger: console
});

function setupInlineAddPanel() {
  inlineAddController.start();
}
function deleteTag(tagIndex) {
  return editController.deleteTag(tagIndex);
}

// 收藏与句子悬浮预览已迁移到独立控制器。


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
  dom.secondaryTabs?.classList.add('special-favorites-surface');
  dom.tagsGridContainer?.classList.add('special-favorites-surface');

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
    const favoriteTypeClass = /^[a-z0-9_-]+$/i.test(item.typeClass || '') ? item.typeClass : 'partial';
    zhPart.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <span class="favorite-type-badge ${favoriteTypeClass}">${escapeHtml(item.typeLabel)}</span>
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
        editController.deleteFavoriteItem(item);
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

    btn.onclick = async () => {
      if (index === activeCategoryIndex) return; // 已激活则跳过，避免打断双击
      activeCategoryIndex = index;
      activeGroupIndex = 0;
      if (isSpecialFavoritesCategory(customGroupsData.categories[activeCategoryIndex]) && specialFavoritesDirty) {
        await refreshSpecialFavoritesCategoryInPlace({ preserveSelection: false });
        activeCategoryIndex = getSpecialFavoritesIndex();
        activeGroupIndex = 0;
      }
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
    btn.dataset.groupId = grp.id || '';
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
            deleteGroup(index);
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
    dom.secondaryTabs?.classList.remove('special-favorites-surface');
    dom.tagsGridContainer?.classList.remove('special-favorites-surface');
    updateSpecialCategoryControls();
    scheduleSortableRefresh();
    return;
  }
  dom.tagsGrid.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  dom.secondaryTabs?.classList.remove('special-favorites-surface');
  dom.tagsGridContainer?.classList.remove('special-favorites-surface');
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

  currentGroup.tags.forEach((t, tagIndex) => {
    const isSentence = isSentenceGroupItem(t);
    const promptText = getGroupItemPromptText(t);
    const promptKey = normalizeTagKey(promptText);
    const translationText = getGroupItemTranslationText(t);
    const isUsedHere = !!promptKey && activeTagsContext.includes(promptKey);
    const isUsedOther = !!promptKey && inactiveTagsContext.includes(promptKey);
    const displayEn = isSentence ? '' : toDisplayTagText(t.en);
    const sentenceEn = isSentence ? sanitizeText(t.en) : '';
    const sentenceZh = isSentence ? sanitizeText(t.zh) : '';

    const card = document.createElement('div');
    card.className = `tag-card ${isSentence ? 'sentence-card' : ''} ${isUsedHere ? 'used' : ''} ${isUsedOther && !isUsedHere ? 'used-other' : ''}`.trim();
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
          groupTagsScope.timeout(() => card.style.transform = 'translateX(-5px)', 50);
          groupTagsScope.timeout(() => card.style.transform = 'translateX(5px)', 100);
          groupTagsScope.timeout(() => card.style.transform = 'translateX(0)', 150);
        } else {
          window.parent.postMessage({
            type: '__APPEND_TAG_FROM_PANEL__',
            tag: isSentence ? promptText : displayEn,
            zh: isSentence ? translationText : t.zh
          }, '*');
        }
      };
    }

    const zhPart = document.createElement('div');
    zhPart.className = `tag-zh-part ${isSentence ? 'sentence-result-part' : ''}`.trim();
    zhPart.style.backgroundColor = currentGroup.color || '#4a4a6a';
    zhPart.textContent = isSentence ? sentenceZh : t.zh;

    // 编辑模式：双击编辑翻译 + 悬浮提示
    if (isEditMode && !isSentence) {
      zhPart.title = '双击编辑翻译';
      zhPart.style.cursor = 'text';
      zhPart.ondblclick = (e) => {
        e.stopPropagation();

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
    } else if (isEditMode && isSentence) {
      zhPart.title = '悬停在卡片上以编辑句子';
    }

    const enPart = document.createElement('div');
    enPart.className = `tag-en-part ${isSentence ? 'sentence-source-part' : ''}`.trim();
    enPart.textContent = isSentence ? sentenceEn : displayEn;
    
    // 编辑模式：双方皆可双击编辑
    if (isEditMode && !isSentence) {
      enPart.title = '双击编辑英文';
      enPart.style.cursor = 'text';
      enPart.ondblclick = (e) => {
        e.stopPropagation();

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
    } else if (isEditMode && isSentence) {
      enPart.title = '悬停在卡片上以编辑句子';
    }

    if (isSentence) {
      bindSentencePreview(card, t, currentCategory, currentGroup, zhPart, enPart);
    }

    card.appendChild(zhPart);
    card.appendChild(enPart);

    // 编辑模式：拖拽 + × 删除角标
    if (isEditMode) {
      // 允许拖拽到其他分组或分类的 Tab 上来跨组移动
      card.draggable = true;
      card.addEventListener('dragstart', () => {
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
groupTagsScope.on(window, 'message', (e) => {
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
    const storedData = await groupTagsStorage.get('groupTagsUserData');
    let stored = storedData.groupTagsUserData;
    if (stored?.categories) {
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

groupTagsScope.on(window, 'pagehide', () => {
  groupTagsScope.dispose('pagehide');
});

groupTagsScope.chromeEvent(chrome.storage.onChanged, async (changes, area) => {
  if (area !== 'local' || !hasInitializedGroupTagsPanel) return;
  if (isEditMode) {
    // 编辑模式下不自动覆盖，避免把用户未保存的本地修改冲掉
    if (changes.groupTagsUserData || changes.promptHistory || changes.groupTagsSpecialCategoryPosition) {
      console.info('[GroupTags] 检测到外部数据更新，当前处于编辑模式，暂不自动刷新。');
    }
    return;
  }

  if (!changes.groupTagsUserData && !changes.promptHistory && !changes.groupTagsSpecialCategoryPosition) return;
  const onlyPromptHistoryChanged = !!changes.promptHistory && !changes.groupTagsUserData && !changes.groupTagsSpecialCategoryPosition;

  if (onlyPromptHistoryChanged && !isSpecialFavoritesActive()) {
    specialFavoritesDirty = true;
    return;
  }

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
groupTagsScope.on(dom.colorPicker, 'input', (e) => {
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
  applyVisibleCurrentGroupColor(newColor);
});

groupTagsScope.on(dom.colorPicker, 'change', (e) => {
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
groupTagsScope.on(dom.btnEdit, 'click', () => enterEditMode());
groupTagsScope.on(dom.btnExport, 'click', () => exportGroupTagsData());
groupTagsScope.on(dom.btnImport, 'click', () => dom.importFileInput.click());
groupTagsScope.on(dom.btnSave, 'click', () => finalizeEditMode(true));
groupTagsScope.on(dom.btnCancel, 'click', () => finalizeEditMode(false));
groupTagsScope.on(dom.importFileInput, 'change', (e) => {
  const [file] = e.target.files || [];
  importGroupTagsData(file);
});

// + 按钮（编辑模式下才可用）
groupTagsScope.on(dom.btnAddCategory, 'click', () => {
  if (isEditMode) addCategory();
});
groupTagsScope.on(dom.btnAddGroup, 'click', () => {
  if (isEditMode) addGroup();
});
