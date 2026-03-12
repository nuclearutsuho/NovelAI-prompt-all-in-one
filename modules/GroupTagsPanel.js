// ========== 核心数据与状态 (Phase 1) ==========
let customGroupsData = null;
let defaultGroupsData = { categories: [] };
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let autocompleteDict = []; // 全局字典缓存
let activeTagsContext = []; // 当前聚焦输入框的 tags
let inactiveTagsContext = []; // 另一个输入框的 tags

// ========== 密度控制逻辑 ==========
const GROUP_TAGS_EXPORT_FORMAT = 'group-tags-export';
const GROUP_TAGS_SCHEMA_VERSION = 1;

const densitySlider = document.getElementById('density-slider');
const root = document.documentElement;
const STORAGE_KEY_DENSITY = 'groupTagsDensity';

// 基于 0-100 滑块值，映射到具体的 CSS 变量（0=最稀疏/大，100=最密集/紧凑）
function applyDensity(value) {
  // ratio: 0 (稀疏) -> 1 (密集)
  const r = value / 100;
  
  // Interpolate values
  // Gap: 6px -> 1px
  const gap = 6 - (5 * r);
  // PadV (Tabs): 10px -> 4px
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

  root.style.setProperty('--density-gap', `${gap}px`);
  root.style.setProperty('--density-pad-v', `${padV}px`);
  root.style.setProperty('--density-pad-h', `${padH}px`);
  root.style.setProperty('--density-font-tab', `${fontTab}px`);
  
  root.style.setProperty('--density-card-pad-v', `${cardPadV}px`);
  root.style.setProperty('--density-card-pad-h', `${cardPadH}px`);
  root.style.setProperty('--density-font-zh', `${fontZh}px`);
  root.style.setProperty('--density-font-en', `${fontEn}px`);
  
  root.style.setProperty('--density-grid-pad', `${gridPad}px`);
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
  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    cat.groups.forEach(group => {
      const color = group.color || '#4a4a6a';
      group.tags.forEach(t => {
        map[t.en] = color;
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
  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    cat.groups.forEach(group => {
      group.tags.forEach(t => {
        if (t.en && t.zh) map[t.en] = t.zh;
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
let dataSnapshot = null; // 编辑模式开始时的数据快照，用于取消时恢复

const dom = {
  app: document.getElementById('app'),
  primaryTabs: document.getElementById('primary-tabs-container'),
  secondaryTabs: document.getElementById('secondary-tabs-container'),
  tagsGrid: document.getElementById('tags-grid'),
  colorPicker: document.getElementById('group-color'),
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

      movedCategory._modified = true;
      activeCategoryIndex = remapActiveIndex(activeCategoryIndex, oldIndex, newIndex);
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

  sortableInstances.secondary = new Sortable(dom.secondaryTabs, {
    ...createCommonSortableOptions(),
    draggable: '.tab-btn:not(.add-tab-btn)',
    onEnd(evt) {
      const { oldIndex, newIndex } = getSortableIndices(evt);
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

      const movedGroup = moveArrayItem(currentCategory.groups, oldIndex, newIndex);
      if (!movedGroup) return;

      movedGroup._modified = true;
      currentCategory._modified = true;
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
  if (!dom.tagsGrid || !currentGroup?.tags?.length) return;

  sortableInstances.tags = new Sortable(dom.tagsGrid, {
    ...createCommonSortableOptions(),
    draggable: '.tag-card',
    onEnd(evt) {
      const { oldIndex, newIndex } = getSortableIndices(evt);
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
function enterEditMode() {
  isEditMode = true;
  // 保存当前数据快照（深拷贝），取消时可恢复
  dataSnapshot = JSON.parse(JSON.stringify(customGroupsData));
  dom.app.classList.add('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
}

function exitEditMode(save) {
  destroyAllSortables();
  if (save) {
    // 保存到 chrome.storage.local
    chrome.storage.local.set({ groupTagsUserData: customGroupsData }, () => {
      console.log('[GroupTags] Data saved to storage');
    });
    // 同步颜色映射和翻译映射到 TagEditor
    syncColorsToParent();
    syncTranslationsToParent();
  } else {
    // 取消：恢复快照
    if (dataSnapshot) {
      customGroupsData = dataSnapshot;
    }
  }
  dataSnapshot = null;
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
  return JSON.parse(JSON.stringify(data));
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#4a4a6a';
}

function normalizeTagKey(value) {
  return sanitizeText(value).toLowerCase();
}

function buildLegacyId(prefix, parts) {
  const slug = parts
    .map(part => sanitizeText(String(part || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .map(part => part.replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_');
  return `${prefix}_${slug || 'item'}`;
}

function createEmptyGroupTagsData() {
  return { categories: [] };
}

function createMergeSummary() {
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
      const seenTagKeys = new Set();
      tags.forEach(rawTag => {
        let en = '';
        let zh = '';

        if (typeof rawTag === 'string') {
          en = sanitizeText(rawTag);
        } else if (rawTag && typeof rawTag === 'object') {
          en = sanitizeText(rawTag.en);
          zh = sanitizeText(rawTag.zh);
        } else {
          summary.skippedInvalid += 1;
          return;
        }

        const tagKey = normalizeTagKey(en);
        if (!tagKey) {
          summary.skippedInvalid += 1;
          return;
        }

        if (seenTagKeys.has(tagKey)) {
          summary.skippedTags += 1;
          return;
        }

        seenTagKeys.add(tagKey);
        normalizedGroup.tags.push({ en, zh });
      });

      normalizedCategory.groups.push(normalizedGroup);
    });

    result.categories.push(normalizedCategory);
  });

  return { data: result, summary };
}

function mergeGroupTagsData(baseData, sourceData) {
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
      const existingTagKeys = new Set(targetGroup.tags.map(tag => normalizeTagKey(tag.en)));
      sourceGroup.tags.forEach(sourceTag => {
        const tagKey = normalizeTagKey(sourceTag.en);
        if (!tagKey || existingTagKeys.has(tagKey)) {
          summary.skippedTags += 1;
          return;
        }
        existingTagKeys.add(tagKey);
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

function getCurrentExportData() {
  return normalizeGroupTagsData(customGroupsData).data;
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
  customGroupsData = nextData;
  clampActiveIndices();
  dataSnapshot = null;
  isEditMode = false;
  dom.app.classList.remove('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
  syncColorsToParent();
  syncTranslationsToParent();
}

function saveGroupTagsData(nextData) {
  return new Promise(resolve => {
    chrome.storage.local.set({ groupTagsUserData: nextData }, () => resolve());
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

    await saveGroupTagsData(nextData);
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
  showModal(`
    <h3>新建分组</h3>
    <input class="modal-input" id="modal-grp-name" placeholder="分组名称" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-grp-cancel">取消</button>
      <button class="modal-btn primary" id="modal-grp-confirm">确认</button>
    </div>
  `);
  document.getElementById('modal-grp-cancel').onclick = () => hideModal();
  document.getElementById('modal-grp-confirm').onclick = () => {
    const name = document.getElementById('modal-grp-name').value.trim();
    if (!name) return;
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
    currentCategory.groups.splice(index, 1);
    currentCategory._modified = true;
    if (activeGroupIndex >= currentCategory.groups.length) {
      activeGroupIndex = Math.max(0, currentCategory.groups.length - 1);
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
      
      const highlight = (text) => {
        if (!query) return text;
        return text.replace(new RegExp(query, 'gi'), match => `<strong>${match}</strong>`);
      };
      
      item.innerHTML = `
        <span class="ac-en" style="color: ${m.color}">${highlight(m.word)}</span>
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

  function submitTag() {
    const en = enInput.value.trim();
    if (!en) return;
    const zh = zhInput.value.trim() || en; 
    
    const currentCategory = customGroupsData.categories[activeCategoryIndex];
    if (!currentCategory) return;
    const currentGroup = currentCategory.groups[activeGroupIndex];
    if (!currentGroup) return;

    if (currentGroup.tags.some(t => t.en === en)) {
      enInput.style.borderColor = '#e74c3c';
      enInput.value = '';
      enInput.placeholder = '该标签已存在！';
      setTimeout(() => {
        enInput.style.borderColor = '';
        enInput.placeholder = 'Input English Tag (e.g. sunny)';
      }, 2000);
      return;
    }

    currentGroup.tags.push({ en, zh });
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

// ========== 渲染函数 ==========
function renderPrimaryTabs() {
  if (!customGroupsData || !customGroupsData.categories) {
    scheduleSortableRefresh();
    return;
  }
  
  const addBtn = dom.primaryTabs.querySelector('#btn-add-category');
  dom.primaryTabs.innerHTML = '';
  
  customGroupsData.categories.forEach((cat, index) => {
    // 统计当前大分类下所有 group 中正被使用的 tags 数量
    let usageCount = 0;
    if (cat.groups) {
      cat.groups.forEach(g => {
        if (g.tags) {
          g.tags.forEach(t => {
            if (activeTagsContext.includes(t.en)) usageCount++;
          });
        }
      });
    }

    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeCategoryIndex ? 'active' : ''}`;
    
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
    if (isEditMode) {
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

    dom.primaryTabs.appendChild(btn);
  });
  if (addBtn) dom.primaryTabs.appendChild(addBtn);
  scheduleSortableRefresh();
}

function renderSecondaryTabs() {
  if (!customGroupsData || !customGroupsData.categories.length) {
    scheduleSortableRefresh();
    return;
  }
  
  const addBtn = dom.secondaryTabs.querySelector('#btn-add-group');
  dom.secondaryTabs.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory || !currentCategory.groups) {
    scheduleSortableRefresh();
    return;
  }
  
  currentCategory.groups.forEach((grp, index) => {
    // 统计当前分组正被使用的 tags 数量
    let usageCount = 0;
    if (grp.tags) {
      grp.tags.forEach(t => {
        if (activeTagsContext.includes(t.en)) usageCount++;
      });
    }

    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeGroupIndex ? 'active' : ''}`;
    
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
    if (isEditMode) {
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

    dom.secondaryTabs.appendChild(btn);
  });
  if (addBtn) dom.secondaryTabs.appendChild(addBtn);
  
  renderTagsGrid();
  scheduleSortableRefresh();
}

function renderTagsGrid() {
  if (!customGroupsData || !customGroupsData.categories.length) {
    scheduleSortableRefresh();
    return;
  }
  dom.tagsGrid.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory || !currentCategory.groups.length) {
    scheduleSortableRefresh();
    return;
  }
  
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) {
    scheduleSortableRefresh();
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
    const isUsedHere = activeTagsContext.includes(t.en);
    const isUsedOther = inactiveTagsContext.includes(t.en);

    const card = document.createElement('div');
    card.className = `tag-card ${isUsedHere ? 'used' : ''} ${isUsedOther && !isUsedHere ? 'used-other' : ''}`;
    card.title = `${t.zh}\n${t.en}`;
    
    // 点击事件：编辑模式下禁用追加/移除
    if (!isEditMode) {
      card.onclick = () => {
        if (isUsedHere) {
          window.parent.postMessage({ type: '__REMOVE_TAG_FROM_PANEL__', tag: t.en }, '*');
        } else if (isUsedOther) {
          card.style.transform = 'translateX(5px)';
          setTimeout(() => card.style.transform = 'translateX(-5px)', 50);
          setTimeout(() => card.style.transform = 'translateX(5px)', 100);
          setTimeout(() => card.style.transform = 'translateX(0)', 150);
        } else {
          window.parent.postMessage({ type: '__APPEND_TAG_FROM_PANEL__', tag: t.en, zh: t.zh }, '*');
        }
      };
    }

    const zhPart = document.createElement('div');
    zhPart.className = 'tag-zh-part';
    zhPart.style.backgroundColor = currentGroup.color || '#4a4a6a';
    zhPart.textContent = t.zh;

    // 编辑模式：双击编辑翻译 + 悬浮提示
    if (isEditMode) {
      zhPart.title = '双击编辑翻译';
      zhPart.style.cursor = 'text';
      zhPart.ondblclick = (e) => {
        e.stopPropagation();
        
        // 锁定原始宽度，防止撑大卡片
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
        const commit = () => {
          const newZh = input.value.trim();
          if (newZh) {
            t.zh = newZh;
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

    const enPart = document.createElement('div');
    enPart.className = 'tag-en-part';
    enPart.textContent = t.en;
    
    // 编辑模式：双方皆可双击编辑
    if (isEditMode) {
      enPart.title = '双击编辑英文';
      enPart.style.cursor = 'text';
      enPart.ondblclick = (e) => {
        e.stopPropagation();
        
        // 同样锁定原始宽度
        const origWidth = enPart.getBoundingClientRect().width;
        enPart.style.width = origWidth + 'px';
        enPart.style.boxSizing = 'border-box';
        enPart.style.paddingLeft = '0';
        enPart.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = t.en;
        enPart.textContent = '';
        enPart.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newEn = input.value.trim();
          // 防止重名或为空
          if (newEn && newEn !== t.en && !currentGroup.tags.some(x => x.en === newEn)) {
            t.en = newEn;
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

    // 编辑模式：× 删除角标
    if (isEditMode) {
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
        return v;
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
    const csvUrl = chrome.runtime.getURL('data/dictionary.csv');
    const res = await fetch(csvUrl);
    const text = await res.text();
    autocompleteDict = text.split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const row = [];
        let currentField = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuote && line[i + 1] === '"') { currentField += '"'; i++; } 
            else { inQuote = !inQuote; }
          } else if (char === ',' && !inQuote) {
            row.push(currentField);
            currentField = '';
          } else {
            currentField += char;
          }
        }
        row.push(currentField);
        let [word, colorCode, popCount, aliases, zhCN] = row;
        const parsedZhCN = zhCN ? zhCN.trim() : '';
        const parsedWord = word ? word.trim() : '';
        const parsedAliases = aliases ? aliases.replace(/"/g, '') : '';
        
        return {
          word: parsedWord,
          zhCN: parsedZhCN,
          color: getColor(colorCode ? colorCode.trim() : '0'),
          pop: popCount ? parseInt(popCount) : 0,
          search: (parsedWord + " " + parsedAliases + " " + parsedZhCN).toLowerCase().replace(/_/g, ' ')
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
    const jsonUrl = chrome.runtime.getURL('data/default_group_tags.json');
    const res = await fetch(jsonUrl);
    const defaultData = await res.json();
    defaultGroupsData = normalizeGroupTagsData(defaultData).data;
    
    // 2. 从 chrome.storage.local 加载用户自定义数据
    const stored = await new Promise(resolve => {
      chrome.storage.local.get('groupTagsUserData', (data) => resolve(data.groupTagsUserData));
    });
    
    if (stored && stored.categories) {
      // 合并预设与用户数据：用户数据优先，预设仅补增
      const normalizedStored = normalizeGroupTagsData(stored).data;
      customGroupsData = mergeGroupTagsData(normalizedStored, defaultGroupsData).data;
    } else {
      customGroupsData = cloneData(defaultGroupsData);
    }
    
    // 3. 渲染 UI 与事件绑定
    setupInlineAddPanel();
    renderPrimaryTabs();
    renderSecondaryTabs();
    
    // 4. 推送颜色映射和翻译映射
    syncColorsToParent();
    syncTranslationsToParent();
    
    console.log('[GroupTags] Initialized, categories:', customGroupsData.categories.length);
  } catch (err) {
    console.error('[GroupTags] Failed to init:', err);
    customGroupsData = { categories: [] };
    renderPrimaryTabs();
    renderSecondaryTabs();
  }
}

init();

// ========== 按钮事件绑定 ==========

// 颜色选择器
dom.colorPicker.addEventListener('input', (e) => {
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
dom.btnSave.addEventListener('click', () => exitEditMode(true));
dom.btnCancel.addEventListener('click', () => exitEditMode(false));
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
