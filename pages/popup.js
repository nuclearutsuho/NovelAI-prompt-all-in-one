import TagEditor, { BUTTON_DEFS } from '../lib/TagEditor.js';
import Sortable from '../lib/Sortable.js';
import common from '../lib/common.js';
import Autocomplete from '../lib/Autocomplete.js';
import { DEFAULT_LANG, getI18nDict, getI18nText } from '../lib/i18n/index.js';
import createAiTranslateController from './popup/ai-translate-controller.js';
import createGroupTagsController from './popup/group-tags-controller.js';
import createHistoryController from './popup/history-controller.js';
import createPromptSyncController from './popup/prompt-sync-controller.js';
import createSyncStatusController from './popup/sync-status-controller.js';

const popupRuntime = globalThis.NaiAioRuntime;
const popupStorageApi = globalThis.NaiAioStorage;
if (!popupRuntime?.acquire || !popupStorageApi?.createRepository) {
  throw new Error('[Popup] 运行时内核或扩展存储仓库未加载');
}
const popupScope = popupRuntime.acquire('extension:popup');
const popupStorage = popupStorageApi.createRepository(chrome.storage.local, { logger: console });

let editor;
let autocomplete;
let currentMode = 'positive'; // 'positive' | 'negative'
let rawPositive = '';
let rawNegative = '';
let positiveTags = [];
let negativeTags = [];
const isEmbeddedPopup = window !== window.top;
const popupHostSessionId = new URLSearchParams(window.location.search).get('hostSession') || '';
// State now stores an object per character with both positive and negative prompts
let characterPromptsData = []; // [{ posPrompt: "", posTags: [], negPrompt: "", negTags: [], gender: "other" }]
let charEditors = []; // Array of { editor: TagEditor, activeTab: 'pos' | 'neg' }
let maxCharacters = 6;
let isShortMode = false;
let isInputShortMode = false;
let currentSequentialCounters = {};
let currentSequentialStepProgress = {};
let currentRandomWildcardLocks = {};

let currentSequentialStepSettings = {};
let popupToastTimer = null;
let popupToastFrame = null;

let currentLang = DEFAULT_LANG;
let aiTranslateController = null;
let groupTagsController = null;
let historyController = null;
let promptSyncController = null;
let syncStatusController = null;

/**
 * Toolbar Configuration Manager
 * Handles UI button reordering, visibility, and sticky state.
 */
const ToolbarConfigManager = {
  currentScene: 'standard',

  // Mock data for different simulation scenes
  SIMULATED_CONTEXTS: {
    standard: {
      tag: { value: 's__poses__' },
      ctx: { 
        isAiPending: false, isAiPendingFailed: false, isNewline: false, isCompHeader: false, isCompFooter: false, isDynHeader: false, isDynFooter: false, isDynMember: false, isDynSeparator: false,
        canAnnotate: true, canSplit: true, isMultiSelect: false, hasWeight: true, weightVal: 1.0,
        wildcardInfo: { name: 'poses', slot: 0, key: 'poses', count: 0, step: 1, isSequential: true },
        editorInstance: null,
        titles: { 
          decWeightTitle: '减少权重', editWeightTitle: '编辑权重', incWeightTitle: '增加权重',
          decDynWeightTitle: '减少选中项权重', editDynWeightTitle: '编辑选中项权重', incDynWeightTitle: '增加选中项权重',
          toggleTitle: '启用/禁用', splitTitle: '拆分为独立 Tag', mergeTitle: '合并为组合'
        } 
      }
    },
    ai: {
      tag: { value: 'tag', aiOriginal: '某个中文原文' },
      ctx: { 
        isAiPending: false, isAiPendingFailed: false, isNewline: false, isCompHeader: false, isCompFooter: false, isDynHeader: false, isDynFooter: false, isDynMember: false, isDynSeparator: false,
        canAnnotate: false, canSplit: false, isMultiSelect: false, hasWeight: true, weightVal: 1.0,
        wildcardInfo: null,
        editorInstance: null,
        titles: { 
          decWeightTitle: '减少权重', editWeightTitle: '编辑权重', incWeightTitle: '增加权重',
          decDynWeightTitle: '减少选中项权重', editDynWeightTitle: '编辑选中项权重', incDynWeightTitle: '增加选中项权重',
          toggleTitle: '启用/禁用', splitTitle: '拆分为独立 Tag', mergeTitle: '合并为组合'
        } 
      }
    }
  },

  async init() {
    this.listEl = document.getElementById('toolbar-sortable-list');
    if (!this.listEl) return;

    // Bind Scene Switcher Events
    const switcher = document.getElementById('toolbar-scene-switcher');
    if (switcher) {
      switcher.querySelectorAll('.scene-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          switcher.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentScene = btn.dataset.scene;
          this.renderList();
        });
      });
    }

    const data = await popupStorage.get(['toolbarConfig']);
    const defaultConfig = {
      order: ['fav', 'copy', 'annotate', 'weight', 'dynWeight', 'insertDynSeparator', 'seqStep', 'smartGroup', 'retranslate', 'toggle', 'link', 'newline', 'del'],
      stickyIds: ['del'],
      hiddenIds: [],
      sceneHiddenIds: { standard: [], ai: [] }
    };
    this.config = { ...defaultConfig, ...(data.toolbarConfig || {}) };
    this.config.order = this.config.order || defaultConfig.order;
    this.config.stickyIds = this.config.stickyIds || defaultConfig.stickyIds;
    this.config.sceneHiddenIds = this.config.sceneHiddenIds || defaultConfig.sceneHiddenIds;

    // Migrate old 'split' and 'merge' IDs to 'smartGroup' if present in existing storage
    if (this.config.order) {
      this.config.order = this.config.order.map(id => (id === 'split' || id === 'merge') ? 'smartGroup' : id);
      // Remove duplicates after mapping
      this.config.order = [...new Set(this.config.order)];
    }

    // --- 迁移逻辑统一管理 ---
    let needsSave = false;

    // Migrate: inject 'insertDynSeparator' if not present in existing saved configs
    if (this.config.order && !this.config.order.includes('insertDynSeparator')) {
      const anchor = this.config.order.indexOf('smartGroup');
      const insertAt = anchor !== -1 ? anchor : Math.max(0, this.config.order.indexOf('del'));
      this.config.order.splice(insertAt, 0, 'insertDynSeparator');
      needsSave = true;
    }

    // Migrate: inject 'seqStep' if not present in existing saved configs
    if (this.config.order && !this.config.order.includes('seqStep')) {
      const anchor = this.config.order.indexOf('smartGroup');
      const insertAt = anchor !== -1 ? anchor : Math.max(0, this.config.order.indexOf('del'));
      this.config.order.splice(insertAt, 0, 'seqStep');
      needsSave = true;
    }

    // Migrate: 清理可能被误放入 hiddenIds / sceneHiddenIds 的核心按钮
    // 这些按钮由 showFor 逻辑自行控制可见性，不应该被设置面板隐藏
    const protectedIds = ['weight', 'dynWeight', 'insertDynSeparator', 'seqStep'];
    if (this.config.hiddenIds) {
      const before = this.config.hiddenIds.length;
      this.config.hiddenIds = this.config.hiddenIds.filter(id => !protectedIds.includes(id));
      if (this.config.hiddenIds.length !== before) needsSave = true;
    }
    if (this.config.sceneHiddenIds) {
      for (const scene of Object.keys(this.config.sceneHiddenIds)) {
        const list = this.config.sceneHiddenIds[scene];
        if (list) {
          const before = list.length;
          this.config.sceneHiddenIds[scene] = list.filter(id => !protectedIds.includes(id));
          if (this.config.sceneHiddenIds[scene].length !== before) needsSave = true;
        }
      }
    }

    if (needsSave) this.save();


    this.renderList();
    this.initSortable();
    this.updateEditors();
  },

  renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    const dict = getPopupDict();
    
    // Get mock context for current scene
    const sceneData = this.SIMULATED_CONTEXTS[this.currentScene] || this.SIMULATED_CONTEXTS.standard;

    this.config.order.forEach(id => {
      const def = BUTTON_DEFS[id];
      if (!def) return;

      // 根据当前场景读取显隐状态
      const currentHiddenList = this.config.sceneHiddenIds[this.currentScene] || [];
      const isHidden = currentHiddenList.includes(id);
      const isSticky = (this.config.stickyIds || []).includes(id);
      const isWeight = id === 'weight'; // 识别权重按键
      
      // Determine if it should be dimmed in this scene
      const isActiveInScene = def.showFor ? def.showFor(sceneData.tag, sceneData.ctx) : true;
      
      let titleBase = def.title || (def.titleKey ? (dict[def.titleKey] || id) : id);
      let fullTitle = titleBase;
      if (isHidden || !isActiveInScene) {
        const hiddenPart = isHidden ? ` [${dict[def.status_hidden] || dict.status_hidden || 'Hidden'}]` : '';
        const inactivePart = !isActiveInScene ? ` (${dict[def.scene_not_applicable] || dict.scene_not_applicable || 'Not applicable'})` : '';
        fullTitle = `${titleBase}${hiddenPart}${inactivePart}`;
      }

      const li = document.createElement('li');
      li.className = `toolbar-sort-item ${def.className || ''} ${isHidden ? 'hidden-btn' : ''} ${isSticky ? 'is-sticky' : ''} ${isActiveInScene ? '' : 'dimmed-btn'} ${isWeight ? 'is-complex-weight' : ''}`;
      li.dataset.id = id;

      li.innerHTML = `
        ${def.svg}
        ${isHidden ? '<div class="hidden-indicator">✕</div>' : ''}
        <div class="sticky-star">★<div class="star-label">${escapeHtml(dict.btn_pin_to_edge || 'Prioritize position (Next to mouse)')}</div></div>
        <div class="btn-label">${escapeHtml(fullTitle)}</div>
      `;

      // Main click toggles hidden
      li.addEventListener('click', (e) => {
        if (e.target.closest('.sticky-star')) return;
        
        if (!isActiveInScene) {
          return;
        }

        if (isHidden) {
          this.config.sceneHiddenIds[this.currentScene] = this.config.sceneHiddenIds[this.currentScene].filter(hid => hid !== id);
        } else {
          this.config.sceneHiddenIds[this.currentScene].push(id);
        }
        this.save();
        this.renderList();
      });

      // Star click toggles sticky
      const star = li.querySelector('.sticky-star');
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isSticky) {
          this.config.stickyIds = this.config.stickyIds.filter(sid => sid !== id);
        } else {
          this.config.stickyIds.push(id);
        }
        this.save();
        this.renderList();
      });

      this.listEl.appendChild(li);
    });
  },

  initSortable() {
    this.sortable = new Sortable(this.listEl, {
      animation: 150,
      ghostClass: 'ghost',
      direction: 'horizontal',
      onEnd: () => {
        const newOrder = Array.from(this.listEl.querySelectorAll('.toolbar-sort-item')).map(el => el.dataset.id);
        this.config.order = newOrder;
        this.save();
      }
    });
  },

  save() {
    popupStorage.set({ toolbarConfig: this.config }).catch(() => {});
    this.updateEditors();
  },

  updateEditors() {
    // Inject the new config into the global editor and character editors
    if (editor) {
      editor.options.toolbarConfig = this.config;
      editor.render();
    }
    charEditors.forEach(ce => {
      if (ce.editor) {
        ce.editor.options.toolbarConfig = this.config;
        ce.editor.render();
      }
    });
  }
};

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

// 将 tag 统一序列化为可安全存储/传输的纯对象。
function normalizeTagObject(tag = {}) {
  // 关键保护：换行符不可被 trim() 消灭
  const raw = String(tag.value || '');
  const value = raw === '\n' ? '\n' : raw.trim();
  if (!value) return null;

  const normalized = {
    value,
    disabled: !!tag.disabled
  };

  // 透传分组命名（仅存在于换行符对象上）
  if (typeof tag.dividerName === 'string' && tag.dividerName) {
    normalized.dividerName = tag.dividerName;
  }
  // 透传分组颜色（仅存在于换行符对象上）
  if (typeof tag.groupColor === 'string' && tag.groupColor) {
    normalized.groupColor = tag.groupColor;
  }

  if (tag.isStart) normalized.isStart = true;

  const dynWeight = Number(tag.dynWeight);
  if (!Number.isNaN(dynWeight) && dynWeight !== 1) {
    normalized.dynWeight = dynWeight;
  }

  if (typeof tag.aiOriginal === 'string' && tag.aiOriginal.trim()) {
    normalized.aiOriginal = tag.aiOriginal.trim();
  }

  if (typeof tag.aiZhTranslation === 'string' && tag.aiZhTranslation.trim()) {
    normalized.aiZhTranslation = tag.aiZhTranslation.trim();
  }

  if (tag.aiZhPending) normalized.aiZhPending = true;

  const aiZhPendingStartedAt = Number(tag.aiZhPendingStartedAt);
  if (Number.isFinite(aiZhPendingStartedAt) && aiZhPendingStartedAt > 0) {
    normalized.aiZhPendingStartedAt = aiZhPendingStartedAt;
  }

  if (typeof tag.aiZhPendingRequestId === 'string' && tag.aiZhPendingRequestId.trim()) {
    normalized.aiZhPendingRequestId = tag.aiZhPendingRequestId.trim();
  }

  if (typeof tag.aiZhErrorMessage === 'string' && tag.aiZhErrorMessage.trim()) {
    normalized.aiZhErrorMessage = tag.aiZhErrorMessage.trim();
  }

  return normalized;
}

function isPendingAiTag(tag = {}) {
  return aiTranslateController?.isPendingTag(tag) || !!tag?.aiPending;
}

function getSyncableTagList(tags = []) {
  if (aiTranslateController) {
    return aiTranslateController.getSyncableTagList(tags);
  }
  return (tags || []).filter((tag) => !tag?.aiPending);
}

function serializeTagList(tags = [], { includePending = false } = {}) {
  const tagList = includePending ? (tags || []) : getSyncableTagList(tags);
  return tagList.map(normalizeTagObject).filter(Boolean);
}

function preservePendingAiTags(oldTags = [], newTags = []) {
  if (aiTranslateController) {
    return aiTranslateController.preservePendingTags(oldTags, newTags);
  }
  return Array.isArray(newTags) ? newTags.slice() : [];
}

// 首次回读网页时，如果 prompt 文本没变且本地已有更完整的结构化 tag，
// 就保留本地状态，避免刷新页面后把 AI 原文和单胶囊结构冲掉。
function shouldApplyIncomingPromptState({
  isFirstTime = false,
  incomingPrompt,
  incomingTags,
  currentPrompt = '',
  currentTags = [],
  pendingInitialPromptRetries = 0
}) {
  if (incomingPrompt === undefined) return false;

  // 刷新后的启动窗口期里，网页可能只恢复了一半字段。
  // 对于本地已有内容的一侧，先忽略这轮空值，等后续重试把真正内容取回来。
  const hasCurrentState = hasMeaningfulPromptState(currentPrompt, currentTags);
  if (isFirstTime && pendingInitialPromptRetries > 0 && hasCurrentState && normalizePrompt(incomingPrompt || '') === '' && !Array.isArray(incomingTags)) {
    return false;
  }

  const samePrompt = normalizePrompt(incomingPrompt || '') === normalizePrompt(currentPrompt || '');
  if (!isFirstTime) {
    return !samePrompt;
  }

  if (!samePrompt) return true;
  if (Array.isArray(incomingTags)) return true;
  return !Array.isArray(currentTags) || currentTags.length === 0;
}

function getPopupDict() {
  return getI18nDict(currentLang, 'popup');
}

function getLocalizedText(key, fallback = '') {
  return getI18nText(currentLang, 'popup', key, fallback);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToastMeta(type) {
  const dict = getPopupDict();
  if (type === 'success') {
    return {
      title: dict.toast_success || 'Success',
      icon: '✓',
      duration: 1800
    };
  }
  if (type === 'warning') {
    return {
      title: dict.toast_warning || 'Notice',
      icon: '!',
      duration: 2800
    };
  }
  return {
    title: dict.toast_error || 'Error',
    icon: '×',
    duration: 4200
  };
}

function getSafeToastMeta(type) {
  const meta = getToastMeta(type) || {};
  if (type === 'success') {
    return { ...meta, icon: '✓' };
  }
  if (type === 'error') {
    return { ...meta, icon: '×' };
  }
  return { ...meta, icon: '!' };
}

function dismissPopupToast(immediate = false) {
  const root = document.getElementById('popup-toast-root');
  const toastEl = root?.querySelector('.popup-toast');
  if (popupToastTimer !== null) popupScope.cancelTimeout(popupToastTimer);
  popupToastTimer = null;

  if (!toastEl) return;
  const removeToast = () => {
    if (popupToastFrame !== null) {
      popupScope.cancelFrame(popupToastFrame);
      popupToastFrame = null;
    }
    toastEl.remove();
  };

  if (immediate) {
    removeToast();
    return;
  }

  toastEl.classList.remove('visible');
  popupScope.timeout(removeToast, 180);
}

function showPopupToast(type, message) {
  const root = document.getElementById('popup-toast-root');
  if (!root) return;

  dismissPopupToast(true);
  const meta = getSafeToastMeta(type);
  const toastEl = document.createElement('div');
  toastEl.className = `popup-toast ${type}`;

  const closeBtnHtml = type === 'error'
    ? `<button type="button" class="popup-toast-close" aria-label="${getLocalizedText('toast_close')}">×</button>`
    : '';

  toastEl.innerHTML = `
    <span class="popup-toast-icon" aria-hidden="true">${meta.icon}</span>
    <div class="popup-toast-body">
      <div class="popup-toast-title">${escapeHtml(meta.title)}</div>
      <div class="popup-toast-message">${escapeHtml(message)}</div>
    </div>
    ${closeBtnHtml}
  `;

  const iconEl = toastEl.querySelector('.popup-toast-icon');
  if (iconEl) iconEl.textContent = meta.icon;
  const closeBtn = toastEl.querySelector('.popup-toast-close');
  if (closeBtn) closeBtn.textContent = '×';

  if (type === 'error') {
    closeBtn?.addEventListener('click', () => dismissPopupToast());
  }

  root.appendChild(toastEl);
  popupToastFrame = popupScope.frame(() => {
    popupToastFrame = null;
    toastEl.classList.add('visible');
  });

  popupToastTimer = popupScope.timeout(() => {
    popupToastTimer = null;
    dismissPopupToast();
  }, meta.duration);
}

function getBasePromptSyncState() {
  return {
    rawPositive,
    rawNegative,
    positiveTags,
    negativeTags,
    currentMode
  };
}

function setBasePromptSyncState(nextState = {}) {
  if (Object.prototype.hasOwnProperty.call(nextState, 'rawPositive')) {
    rawPositive = nextState.rawPositive || '';
  }
  if (Object.prototype.hasOwnProperty.call(nextState, 'rawNegative')) {
    rawNegative = nextState.rawNegative || '';
  }
  if (Array.isArray(nextState.positiveTags)) {
    positiveTags = nextState.positiveTags;
  }
  if (Array.isArray(nextState.negativeTags)) {
    negativeTags = nextState.negativeTags;
  }
}

function getCharacterPromptSyncState() {
  return {
    characterPromptsData,
    charEditors
  };
}

function setCharacterPromptSyncState(nextState = {}) {
  if (Array.isArray(nextState.characterPromptsData)) {
    characterPromptsData = nextState.characterPromptsData;
  }
  if (Array.isArray(nextState.charEditors)) {
    charEditors = nextState.charEditors;
  }
}

function renderBasePromptSyncEditor({ shouldUpdatePos = false, shouldUpdateNeg = false, positiveTags: nextPositiveTags = positiveTags, negativeTags: nextNegativeTags = negativeTags } = {}) {
  if (!editor) return;
  if (currentMode === 'positive' && shouldUpdatePos) {
    editor.setTags(nextPositiveTags, { skipInherit: true });
  }
  if (currentMode === 'negative' && shouldUpdateNeg) {
    editor.setTags(nextNegativeTags, { skipInherit: true });
  }
}

function updateCharacterPromptSyncEditor({ index, shouldUpdatePos = false, shouldUpdateNeg = false, posTags = [], negTags = [] } = {}) {
  const charEditorObj = charEditors[index];
  if (!charEditorObj?.editor) return;

  if (charEditorObj.activeTab === 'pos' && shouldUpdatePos) {
    charEditorObj.editor.setTags(posTags, { skipInherit: true });
  } else if (charEditorObj.activeTab === 'neg' && shouldUpdateNeg) {
    charEditorObj.editor.setTags(negTags, { skipInherit: true });
  }
}

function refreshPendingAiVisuals() {
  editor?.refreshPendingAiVisuals?.();
  charEditors.forEach((charEditorObj) => {
    charEditorObj?.editor?.refreshPendingAiVisuals?.();
  });
}

function handleRemovedPendingAiTags(removedTags = [], reason = 'user') {
  aiTranslateController?.handleRemovedTags(removedTags, reason);
}

function syncPendingAiVisualTimer() {
  aiTranslateController?.syncPendingVisualTimer();
}

function normalizeAiTargetContext(targetContext = {}) {
  if (targetContext?.type === 'character') {
    const charIndex = Number(targetContext.charIndex);
    if (!Number.isInteger(charIndex) || charIndex < 0) return null;
    return {
      type: 'character',
      charIndex,
      mode: targetContext.mode === 'negative' ? 'negative' : 'positive'
    };
  }

  return {
    type: 'base',
    mode: targetContext?.mode === 'negative' ? 'negative' : 'positive'
  };
}

function getAiTargetTagList(targetContext) {
  const target = normalizeAiTargetContext(targetContext);
  if (!target) return null;

  if (target.type === 'base') {
    return target.mode === 'negative' ? negativeTags : positiveTags;
  }

  const charData = characterPromptsData[target.charIndex];
  if (!charData) return null;
  if (target.mode === 'negative') {
    if (!Array.isArray(charData.negTags)) charData.negTags = [];
    return charData.negTags;
  }

  if (!Array.isArray(charData.posTags)) charData.posTags = [];
  return charData.posTags;
}

function renderAiTargetIfVisible(targetContext) {
  const target = normalizeAiTargetContext(targetContext);
  if (!target) return;

  if (target.type === 'base') {
    if (editor && currentMode === target.mode) {
      editor.render();
    }
    return;
  }

  const charEditorObj = charEditors[target.charIndex];
  if (!charEditorObj?.editor) return;
  const activeMode = charEditorObj.activeTab === 'neg' ? 'negative' : 'positive';
  if (activeMode === target.mode) {
    charEditorObj.editor.render();
  }
}

function syncAiTargetAfterResolve(targetContext, source = 'popup') {
  const target = normalizeAiTargetContext(targetContext);
  if (!target) return;

  if (target.type === 'base') {
    if (target.mode === 'negative') {
      rawNegative = tagsToString(negativeTags);
    } else {
      rawPositive = tagsToString(positiveTags);
    }
    renderAiTargetIfVisible(target);
    syncToPage(source);
    return;
  }

  const charData = characterPromptsData[target.charIndex];
  if (!charData) return;

  if (target.mode === 'negative') {
    charData.negPrompt = tagsToString(charData.negTags || []);
  } else {
    charData.posPrompt = tagsToString(charData.posTags || []);
  }

  renderAiTargetIfVisible(target);
  syncCharactersToPage(source);
}
function getCurrentGroupTagsTarget() {
  return groupTagsController?.getActiveTarget?.() || { type: 'base', mode: currentMode };
}

function setCurrentGroupTagsTarget(target) {
  return groupTagsController?.setActiveTarget?.(target) || target || { type: 'base', mode: currentMode };
}

function addTagToGroupTarget(target, tag) {
  if (target?.type === 'character') {
    const charEditorObj = charEditors[target.charIndex];
    if (charEditorObj?.editor) {
      charEditorObj.editor.addTag(tag);
      return;
    }
  }

  if (editor) {
    editor.addTag(tag);
  }
}

function removeTagFromGroupTarget(target, tag) {
  if (target?.type === 'character') {
    const charEditorObj = charEditors[target.charIndex];
    if (charEditorObj?.editor) {
      charEditorObj.editor.removeTagByText(tag);
      return;
    }
  }

  if (editor) {
    editor.removeTagByText(tag);
  }
}

popupScope.on(document, 'DOMContentLoaded', async () => {
  await initUI();
  await initData();
  initCommunication();
}, { once: true });

popupScope.on(window, 'pagehide', () => {
  aiTranslateController?.destroy();
  groupTagsController?.destroy();
  historyController?.destroy();
  promptSyncController?.destroy();
  syncStatusController?.dispose();
  popupScope.dispose('pagehide');
});

function applyRuntimeStateToEditors() {
  if (editor) {
    if (editor.setSequentialCounters) editor.setSequentialCounters(currentSequentialCounters);
    if (editor.setSequentialStepProgress) editor.setSequentialStepProgress(currentSequentialStepProgress);
    if (editor.setRandomWildcardLocks) editor.setRandomWildcardLocks(currentRandomWildcardLocks);
  }
  charEditors.forEach((charEditorObj) => {
    if (charEditorObj?.editor) {
      if (charEditorObj.editor.setSequentialCounters) charEditorObj.editor.setSequentialCounters(currentSequentialCounters);
      if (charEditorObj.editor.setSequentialStepProgress) charEditorObj.editor.setSequentialStepProgress(currentSequentialStepProgress);
      if (charEditorObj.editor.setRandomWildcardLocks) charEditorObj.editor.setRandomWildcardLocks(currentRandomWildcardLocks);
    }
  });
}

function normalizeSequentialStepValue(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

function normalizeSequentialStepSettings(settings) {
  const normalized = {};
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (!key) return;
    const step = normalizeSequentialStepValue(value);
    if (step > 1) normalized[key] = step;
  });
  return normalized;
}

function applySequentialStepSettingsToEditors(settings) {
  currentSequentialStepSettings = normalizeSequentialStepSettings(settings);
  if (editor) {
    editor.setSequentialStepSettings(currentSequentialStepSettings);
  }
  charEditors.forEach((charEditorObj) => {
    if (charEditorObj?.editor) {
      charEditorObj.editor.setSequentialStepSettings(currentSequentialStepSettings);
    }
  });
}

async function saveSequentialStepSetting(key, value) {
  if (!key) return;
  const nextSettings = { ...currentSequentialStepSettings };
  const normalizedValue = normalizeSequentialStepValue(value);
  if (normalizedValue > 1) nextSettings[key] = normalizedValue;
  else delete nextSettings[key];
  applySequentialStepSettingsToEditors(nextSettings);
  await popupStorage.set({ sequentialStepSettings: nextSettings });
}

async function saveSequentialCounter(name, value) {
  if (!name) return;
  const parsed = Number.parseInt(value, 10);
  const normalizedValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  // 更新本地缓存
  currentSequentialCounters[name] = normalizedValue;
  applyRuntimeStateToEditors();
  // 发送到 content script（bridge.js）同步到 injector
  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, {
      type: 'SET_SEQUENTIAL_COUNTER',
      name,
      value: normalizedValue
    });
  }
}

async function resetStepProgress(key, isSequential) {
  if (!key) return;
  // 更新本地缓存
  if (isSequential) {
    delete currentSequentialStepProgress[key];
  } else {
    delete currentRandomWildcardLocks[key];
  }
  applyRuntimeStateToEditors();
  // 发送到 content script（bridge.js）同步到 injector
  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    chrome.tabs.sendMessage(activeTab.id, {
      type: 'RESET_STEP_PROGRESS',
      key,
      isSequential
    });
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    if (!chrome.tabs) {
      resolve(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function getRuntimeStateFromTab(tabId) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !tabId) {
      resolve({});
      return;
    }
    chrome.tabs.sendMessage(tabId, { type: 'GET_RUNTIME_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(response || {});
    });
  });
}

async function refreshRuntimeStateFromActiveTab() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    applyRuntimeStateToEditors();
    return;
  }
  const state = await getRuntimeStateFromTab(activeTab.id);
  currentSequentialCounters = state.sequentialCounters || {};
  currentSequentialStepProgress = state.sequentialStepProgress || {};
  currentRandomWildcardLocks = state.randomWildcardLocks || {};
  applyRuntimeStateToEditors();
}

function shouldIgnoreRuntimeMessage(msg) {
  if (!isEmbeddedPopup) return false;
  if (!msg?.hostSessionId) return false;
  return msg.hostSessionId !== popupHostSessionId;
}

async function initData() {
  const data = await popupStorage.get(['promptHistory', 'sequentialStepSettings']);
  const activeTab = await getActiveTab();
  const historyScopeId = isEmbeddedPopup && popupHostSessionId
    ? `host:${popupHostSessionId}`
    : (activeTab?.id ? `tab:${activeTab.id}` : '');
  historyController?.setScopeId(historyScopeId);

  if (data.promptHistory && data.promptHistory.length > 0) {
    // 启动时优先用同作用域最近一条历史初始化状态与去重指纹。
    historyController?.primeFromStoredHistory(data.promptHistory, {
      restoreBase: !isEmbeddedPopup,
      restoreCharacters: !isEmbeddedPopup
    });
  }

  applySequentialStepSettingsToEditors(data.sequentialStepSettings || {});
  await refreshRuntimeStateFromActiveTab();

  // ===== 同步页面存活状态指示器 =====
  const libraryBtn = document.getElementById('btn-library');
  function updateSyncLiveIndicator(isActive) {
    if (!libraryBtn) return;
    if (isActive) {
      libraryBtn.classList.add('sync-live');
      libraryBtn.setAttribute('data-sync-tooltip', '⚡ 实时同步中');
    } else {
      libraryBtn.classList.remove('sync-live');
      libraryBtn.setAttribute('data-sync-tooltip', '点击打开以启用同步');
    }
  }
  // 初始化时读取当前状态
  popupStorage.get(['syncPageActive'])
    .then(d => updateSyncLiveIndicator(!!d.syncPageActive))
    .catch(() => updateSyncLiveIndicator(false));

  // Listen for storage changes to keep counters in sync and hot-reload dictionary
  popupScope.chromeEvent(chrome.storage.onChanged, (changes, area) => {
    if (area === 'local') {
      if ((changes.dictOverlay || changes.wildcards || changes.wildcardFolders || changes.wildcardUsageStats) && autocomplete) {
        // Hot-reload dictionary and wildcards
        autocomplete.loaded = false;
        autocomplete.load().then(() => {
          if (editor) editor.render();
          charEditors.forEach(c => {
            if (c.editor) c.editor.render();
          });
        });
      }
      if (changes.sequentialStepSettings) {
        applySequentialStepSettingsToEditors(changes.sequentialStepSettings.newValue || {});
      }
      // 同步页面存活状态变化时，实时更新按钮指示器
      if (changes.syncPageActive) {
        updateSyncLiveIndicator(!!changes.syncPageActive.newValue);
      }
    }
  });

  syncStatusController = createSyncStatusController({
    runtime: popupRuntime,
    storageRepository: popupStorage,
    storageChangedEvent: chrome.storage.onChanged
  });
  await syncStatusController.init();
}

// === Character Prompts Logic ===
function updateCharAddButton() {
  const btnAddChar = document.getElementById('btn-add-char');
  if (btnAddChar) {
    btnAddChar.style.display = characterPromptsData.length < maxCharacters ? 'block' : 'none';
  }
}

function syncCharactersToPage(source) {
  promptSyncController?.syncCharacters(source);
}

function createCharacterEditor(index, initialPos = '', initialNeg = '', initialTab = 'pos') {
  const template = document.getElementById('char-prompt-template');
  const container = document.getElementById('char-list-container');
  
  if (!template || !container) return;
  
  const clone = template.content.cloneNode(true);
  const block = clone.querySelector('.char-prompt-block');
  const inputArea = clone.querySelector('.char-input-area');

  // Insert Character Index Label at the start
  const indexLabel = document.createElement('span');
  indexLabel.className = 'char-index-label';
  indexLabel.textContent = '#' + (index + 1);
  inputArea.insertBefore(indexLabel, inputArea.firstChild);

  const editorContainer = clone.querySelector('.char-editor-container');
  const input = clone.querySelector('.char-quick-input');
  const btnAdd = clone.querySelector('.primary-add-btn');
  const charDrawSplit = clone.querySelector('.char-draw-split');
  const btnAiTranslate = clone.querySelector('.char-btn-ai-translate');
  const deleteBtn = clone.querySelector('.char-delete');

  // Apply translations directly to the new clone components
  const dict = getPopupDict();
  const getKey = (base) => (isShortMode && dict[base + '_short']) ? base + '_short' : base;

  if(input && dict.char_input_placeholder) input.placeholder = dict.char_input_placeholder;
  
  if (btnAiTranslate) {
      const aiTranslateKey = getKey('btn_ai_translate');
      btnAiTranslate.title = dict.btn_ai_translate || getLocalizedText('btn_ai_translate', 'AI Translate');
      btnAiTranslate.textContent = dict[aiTranslateKey] || getLocalizedText(aiTranslateKey, 'AI');
  }

  // Initialize data if not fully set
  if (!characterPromptsData[index]) {
    characterPromptsData[index] = { 
        posPrompt: initialPos, 
        posTags: parsePromptToTags(initialPos), 
        negPrompt: initialNeg,
        negTags: parsePromptToTags(initialNeg),
        gender: "other",
        activeTab: initialTab === 'neg' ? 'negative' : 'positive'
    };
  } else {
    // Sync the internal state tracking and force 'other' explicitly
    characterPromptsData[index].gender = 'other';
    characterPromptsData[index].activeTab = initialTab === 'neg' ? 'negative' : 'positive';
  }

  // Set up Delete
  deleteBtn.addEventListener('click', () => {
    const activeTarget = getCurrentGroupTagsTarget();
    if (activeTarget.type === 'character') {
      if (activeTarget.charIndex === index) {
        setCurrentGroupTagsTarget({ type: 'base', mode: currentMode });
      } else if (activeTarget.charIndex > index) {
        setCurrentGroupTagsTarget({
          type: 'character',
          charIndex: activeTarget.charIndex - 1,
          mode: activeTarget.mode
        });
      }
    }

    handleRemovedPendingAiTags([
      ...(characterPromptsData[index]?.posTags || []),
      ...(characterPromptsData[index]?.negTags || [])
    ], 'target-removed');
    syncPendingAiVisualTimer();
    characterPromptsData.splice(index, 1);
    const editorObj = charEditors[index];
    if (editorObj && editorObj.editor && typeof editorObj.editor.destroy === 'function') {
        try { editorObj.editor.destroy(); } catch(e){}
    }
    charEditors.splice(index, 1);
    rebuildCharacterPromptsUI();
    syncActiveTagsToPanel();
    syncCharactersToPage();
  });

  // Set up Editor
  const charEditor = new TagEditor(editorContainer, {
    dict: dict,
    toolbarConfig: ToolbarConfigManager.config,
    toolbarTriggerMode: document.getElementById('tagToolbarClickMode')?.checked ? 'click' : 'hover',
    onRemoveTags: handleRemovedPendingAiTags,
    onRetryPendingTag: (tag) => aiTranslateController?.translateFromInput({
      buttonEl: btnAiTranslate,
      tagEditor: charEditor,
      scrollContainer: editorContainer,
      targetContext: {
        type: 'character',
        charIndex: index,
        mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
      },
      pendingTag: tag
    }),
    onRetranslateAiTag: (tag) => aiTranslateController?.translateFromInput({
      buttonEl: btnAiTranslate,
      tagEditor: charEditor,
      scrollContainer: editorContainer,
      targetContext: {
        type: 'character',
        charIndex: index,
        mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
      },
      existingTag: tag
    }),
    onAnnotateTag: (tag, buttonEl) => aiTranslateController?.annotateTags({
      buttonEl,
      targetContext: {
        type: 'character',
        charIndex: index,
        mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
      },
      tags: [tag]
    }),
    onAnnotateSelectedTags: (tags, buttonEl) => aiTranslateController?.annotateTags({
      buttonEl,
      targetContext: {
        type: 'character',
        charIndex: index,
        mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
      },
      tags
    }),
    onAddToGroupTags: (tagData) => groupTagsController?.addTagToGroupTags(tagData),
    onSequentialStepChange: (key, value) => saveSequentialStepSetting(key, value),
    onSequentialCounterChange: (name, value) => saveSequentialCounter(name, value),
    onStepProgressReset: (key, isSequential) => resetStepProgress(key, isSequential),
    onChange: (tags) => {
      const active = charEditors[index]?.activeTab || 'pos';
      // 检测是否为结构性变更（tag 数量变化）
      const prevCharTags = active === 'pos' ? characterPromptsData[index].posTags : characterPromptsData[index].negTags;
      const isStructural = tags.length !== (prevCharTags || []).length;
      if (active === 'pos') {
          characterPromptsData[index].posTags = tags;
          characterPromptsData[index].posPrompt = tagsToString(tags);
      } else {
          characterPromptsData[index].negTags = tags;
          characterPromptsData[index].negPrompt = tagsToString(tags);
      }
      syncCharactersToPage(isStructural ? 'immediate' : 'popup');
      
      // 同步当前角色编辑器的 tags 到 GroupTags 面板
      const activeTarget = getCurrentGroupTagsTarget();
      if (activeTarget.type === 'character' && activeTarget.charIndex === index) {
        syncActiveTagsToPanel();
      }
    }
  });
  charEditor.setSequentialCounters(currentSequentialCounters);
  charEditor.setSequentialStepSettings(currentSequentialStepSettings);
  if (charEditor.setSequentialStepProgress) charEditor.setSequentialStepProgress(currentSequentialStepProgress);
  if (charEditor.setRandomWildcardLocks) charEditor.setRandomWildcardLocks(currentRandomWildcardLocks);

  // ── 焦点追踪：点击角色编辑器容器时设为活动目标 ──
  editorContainer.addEventListener('mousedown', () => {
    setCurrentGroupTagsTarget({
      type: 'character',
      charIndex: index,
      mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
    });
    syncActiveTagsToPanel();
  });


  // Set up Pos/Neg Toggles
  const btnPos = clone.querySelector('.char-tab-pos');
  const btnNeg = clone.querySelector('.char-tab-neg');

  if(btnPos && dict.tab_positive) btnPos.title = dict.tab_positive;
  if(btnNeg && dict.tab_negative) btnNeg.title = dict.tab_negative;
  if(deleteBtn && dict.btn_remove_char) deleteBtn.title = dict.btn_remove_char;

  const switchTab = (tab, fromUserClick = true) => {
    charEditors[index].activeTab = tab;
    // Sync to data model so syncCharactersToPage() sends the correct Tab state
    characterPromptsData[index].activeTab = tab === 'neg' ? 'negative' : 'positive';
    
    // Update active UI classes
    if (tab === 'pos') {
        btnPos.classList.add('active');
        btnNeg.classList.remove('active');
        editorContainer.classList.remove('negative-mode');
        // Load pos tags
        charEditor.setTags(characterPromptsData[index].posTags || [], { skipInherit: true });
    } else {
        btnNeg.classList.add('active');
        btnPos.classList.remove('active');
        editorContainer.classList.add('negative-mode');
        // Load neg tags
        charEditor.setTags(characterPromptsData[index].negTags || [], { skipInherit: true });
    }
    syncPendingAiVisualTimer();
    
    // Sync the tab switch to the injecting page so it switches the active view there
    if (fromUserClick && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SWITCH_TAB',
            data: {
                tab: tab === 'pos' ? 'positive' : 'negative',
                index: index
            }
          });
        }
      });
    }

    // 如果当前焦点正好在这个角色编辑器上，更新面板状态
    let activeTarget = getCurrentGroupTagsTarget();
    if (fromUserClick || (activeTarget.type === 'character' && activeTarget.charIndex === index)) {
      setCurrentGroupTagsTarget({
        type: 'character',
        charIndex: index,
        mode: tab === 'neg' ? 'negative' : 'positive'
      });
      activeTarget = getCurrentGroupTagsTarget();
    }

    if (activeTarget.type === 'character' && activeTarget.charIndex === index) {
      syncActiveTagsToPanel();
    }
  };
  
  // Track the state wrapper and expose switchTab
  charEditors[index] = { editor: charEditor, activeTab: 'pos', switchTab };

  btnPos.addEventListener('click', () => switchTab('pos'));
  btnNeg.addEventListener('click', () => switchTab('neg'));

  // Attach autocomplete logic so TagEditor can render translations and weights
  if (autocomplete) {
    charEditor.bindAutocomplete(autocomplete);
  }

  // Initial load, explicitly do NOT broadcast to page
  switchTab(initialTab, false);

  // Bind autocomplete to this new input
  autocomplete.attach(input, (val) => {
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    const cleanTags = newTags.map(t => {
      const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
      return isWildcard ? t : t.replace(/_/g, ' ');
    });
    // Use local closure reference 'charEditor' not the mutable charEditors[]
    cleanTags.forEach(t => charEditor.addTag(t));
    input.value = '';
  input.focus();
  });

  // Attach buttons
  const addTag = () => {
    const val = input.value.trim();
    if (val) {
      const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
      const cleanTags = newTags.map(t => {
        const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
        return isWildcard ? t : t.replace(/_/g, ' ');
      });
      // Use local closure reference 'charEditor'
      cleanTags.forEach(t => charEditor.addTag(t));
      input.value = '';
    }
    if (autocomplete) autocomplete.hide();
  };

  btnAdd.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && btnAiTranslate) {
        btnAiTranslate.click();
      } else {
        popupScope.timeout(() => { if (input.value.trim()) addTag(); }, 100);
      }
    }
  });

  if (charDrawSplit) {
    window.setupDrawSplitButton(charDrawSplit, input, () => charEditor);
  }

  btnAiTranslate?.addEventListener('click', () => {
    aiTranslateController?.translateFromInput({
      inputEl: input,
      buttonEl: btnAiTranslate,
      tagEditor: charEditor,
      targetContext: {
        type: 'character',
        charIndex: index,
        mode: (charEditors[index]?.activeTab === 'neg') ? 'negative' : 'positive'
      }
    });
  });

  container.appendChild(block);
}

function rebuildCharacterPromptsUI() {
  const container = document.getElementById('char-list-container');
  if (!container) return;
  
  // Clear existing
  container.innerHTML = '';
  charEditors = [];

  // Re-render
  characterPromptsData.forEach((charData, index) => {
    createCharacterEditor(index, charData.posPrompt, charData.negPrompt, charData.activeTab === 'negative' ? 'neg' : 'pos');
  });

  groupTagsController?.applyEditorMaps();
  
  updateCharAddButton();
}

async function initUI() {
  await ToolbarConfigManager.init();
  // Autocomplete
  autocomplete = new Autocomplete({
    storageRepository: popupStorage,
    lifecycleScope: popupScope
  });
  autocomplete.load();
  if (!aiTranslateController) {
    aiTranslateController = createAiTranslateController({
      storageRepository: popupStorage,
      lifecycleScope: popupScope,
      getLocalizedText,
      showToast: showPopupToast,
      normalizeTargetContext: normalizeAiTargetContext,
      getTargetTagList: getAiTargetTagList,
      renderTargetIfVisible: renderAiTargetIfVisible,
      syncTargetAfterResolve: syncAiTargetAfterResolve,
      refreshPendingVisuals: refreshPendingAiVisuals,
      recordAnnotationChange: () => recordHistory('immediate')
    });
  }
  aiTranslateController.bindSettingsUI();

  if (!groupTagsController) {
    groupTagsController = createGroupTagsController({
      storageRepository: popupStorage,
      lifecycleScope: popupScope,
      getLocalizedText,
      showToast: showPopupToast,
      getActiveTab,
      getBaseEditor: () => editor,
      getCharacterEditors: () => charEditors,
      addTagToTarget: addTagToGroupTarget,
      removeTagFromTarget: removeTagFromGroupTarget,
      setActiveTarget: () => {},
      getActiveTarget: () => ({ type: 'base', mode: currentMode }),
      onMapsChanged: () => {},
      onPickerStateChanged: () => {},
      loadPopupDict: () => getPopupDict()
    });
  }
  groupTagsController.bindUI();

  if (!historyController) {
    historyController = createHistoryController({
      storageRepository: popupStorage,
      lifecycleScope: popupScope,
      getBaseState: getBasePromptSyncState,
      setBaseState: setBasePromptSyncState,
      getCharacterState: getCharacterPromptSyncState,
      setCharacterState: setCharacterPromptSyncState,
      getCurrentMode: () => currentMode,
      getEditor: () => editor,
      getActiveEditorTarget: getCurrentGroupTagsTarget,
      rebuildCharacterUI: rebuildCharacterPromptsUI,
      parsePromptToTags,
      tagsToString,
      normalizePrompt,
      serializeTagList,
      syncAll: async (source) => {
        await promptSyncController?.syncAll(source);
      }
    });
  }

  if (!promptSyncController) {
    promptSyncController = createPromptSyncController({
      lifecycleScope: popupScope,
      isEmbeddedPopup,
      popupHostSessionId,
      getActiveTab,
      shouldIgnoreRuntimeMessage,
      getBaseState: getBasePromptSyncState,
      setBaseState: setBasePromptSyncState,
      getCharacterState: getCharacterPromptSyncState,
      setCharacterState: setCharacterPromptSyncState,
      renderBaseEditor: renderBasePromptSyncEditor,
      updateCharacterEditor: updateCharacterPromptSyncEditor,
      rebuildCharacterUI: rebuildCharacterPromptsUI,
      syncActiveTagsToPanel,
      handleRemovedPendingTags: handleRemovedPendingAiTags,
      syncPendingVisualTimer: syncPendingAiVisualTimer,
      tagsToString,
      parsePromptToTags,
      normalizePrompt,
      mergeTagsPreservingDisabled,
      preservePendingAiTags,
      serializeTagList,
      shouldApplyIncomingPromptState,
      onLocalSync: ({ source }) => {
        recordHistory(source || 'popup');
      },
      onRemoteStateApplied: ({ source }) => {
        recordHistory(source || 'webpage');
      }
    });
  }

  // Resolution controls
  const resWidth = document.getElementById('res-width');
  const resHeight = document.getElementById('res-height');
  const resSwapBtn = document.getElementById('res-swap-btn');
  
  // Custom Dropdown UI
  const resTrigger = document.getElementById('res-multi-trigger');
  const resPanel = document.getElementById('res-dropdown-panel');
  const resModeSeq = document.getElementById('res-mode-seq');
  const resModeRnd = document.getElementById('res-mode-rnd');
  const resListContainer = document.getElementById('res-list-container');
  const resBtnAdd = document.getElementById('res-btn-add');
  const resAddW = document.getElementById('res-add-w');
  const resAddH = document.getElementById('res-add-h');

  let defaultPresets = [
    '512x768', '768x512', '640x640', '832x1216', '1216x832', 
    '1024x1024', '1024x1536', '1536x1024', '1472x1472'
  ];
  let multiResAll = [...defaultPresets];
  let multiResActive = ['832x1216'];
  let multiResMode = 'seq';

  function sendResolutionUpdate(w, h) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_RESOLUTION',
          data: { width: w, height: h }
        });
      }
    });
    popupStorage.set({ lastResolution: { width: w, height: h } }).catch(() => {});
  }

  function syncMultiResStorage() {
    const config = { all: multiResAll, active: multiResActive, mode: multiResMode };
    // 只保存配置，供 injector.js 在生成请求拦截时使用
    // 注意：此处不发 SET_RESOLUTION 消息，不修改网页 UI 输入框。
    // 原因：NovelAI 网页将输入框的值通过 CSS aspect-ratio 全局绑定到所有预览卡片。
    // 若修改网页输入框，所有已生成的预览图都会被强制拉伸到新比例，导致视觉错乱。
    // 多选模式下通过 fetch/XHR 拦截层静默改写请求参数，与网页 UI 完全解耦。
    popupStorage.set({ multiResConfig: config }).catch(() => {});
    
    // 更新触发按钮的文本
    const dict = getPopupDict();
    const getKey = (base) => (isShortMode && dict[base + '_short']) ? base + '_short' : base;

    if (multiResActive.length === 0) {
      resTrigger.textContent = getLocalizedText(getKey('res_selected_none')) + ' ⏷';
    } else if (multiResActive.length === 1) {
      resTrigger.textContent = multiResActive[0].replace('x', ' × ') + ' ⏷';
      // 单选时：同步网页 UI（用户预期看到该比例）
      const [w, h] = multiResActive[0].split('x');
      resWidth.value = w; resHeight.value = h;
      sendResolutionUpdate(parseInt(w), parseInt(h));
    } else {
      // 多选时：仅更新按钮文字，不触碰网页 UI
      const t = getLocalizedText(getKey('res_selected_count'));
      resTrigger.textContent = t.replace('{n}', multiResActive.length) + ' ⏷';
    }
  }

  function renderResList() {
    resListContainer.innerHTML = '';
    multiResAll.forEach(res => {
      const item = document.createElement('div');
      item.className = 'res-list-item';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = multiResActive.includes(res);
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!multiResActive.includes(res)) multiResActive.push(res);
        } else {
          multiResActive = multiResActive.filter(r => r !== res);
        }
        syncMultiResStorage();
      });

      const text = document.createElement('div');
      text.className = 'res-list-text';
      text.textContent = res.replace('x', ' × ');
      // click text toggles checkbox
      text.addEventListener('click', () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });

      item.appendChild(cb);
      item.appendChild(text);

      if (!defaultPresets.includes(res)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'res-list-del';
        delBtn.textContent = '×';
        delBtn.title = getLocalizedText('btn_del');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          multiResAll = multiResAll.filter(r => r !== res);
          multiResActive = multiResActive.filter(r => r !== res);
          renderResList();
          syncMultiResStorage();
        });
        item.appendChild(delBtn);
      }
      resListContainer.appendChild(item);
    });
  }

  resTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    resPanel.style.display = resPanel.style.display === 'none' ? 'flex' : 'none';
  });

  // Close panel on outside click
  popupScope.on(document, 'click', (e) => {
    if (!e.target.closest('.res-multi-select-container')) {
      resPanel.style.display = 'none';
    }
  });

  resPanel.addEventListener('click', (e) => e.stopPropagation());

  const setResMode = (mode) => {
    multiResMode = mode;
    if (mode === 'seq') {
      resModeSeq.classList.add('active');
      resModeRnd.classList.remove('active');
    } else {
      resModeRnd.classList.add('active');
      resModeSeq.classList.remove('active');
    }
    syncMultiResStorage();
  };

  resModeSeq.addEventListener('click', () => setResMode('seq'));
  resModeRnd.addEventListener('click', () => setResMode('rnd'));

  resBtnAdd.addEventListener('click', () => {
    let w = parseInt(resAddW.value, 10);
    let h = parseInt(resAddH.value, 10);
    if (!w || !h) return;
    w = Math.max(64, Math.round(w / 64) * 64);
    h = Math.max(64, Math.round(h / 64) * 64);
    const newRes = `${w}x${h}`;
    if (!multiResAll.includes(newRes)) {
      multiResAll.push(newRes);
    }
    if (!multiResActive.includes(newRes)) {
      multiResActive.push(newRes);
    }
    resAddW.value = '';
    resAddH.value = '';
    renderResList();
    syncMultiResStorage();
  });

  const onDimensionChange = () => {
    let w = parseInt(resWidth.value, 10) || 832;
    let h = parseInt(resHeight.value, 10) || 1216;
    w = Math.max(64, Math.round(w / 64) * 64);
    h = Math.max(64, Math.round(h / 64) * 64);
    resWidth.value = w;
    resHeight.value = h;
    sendResolutionUpdate(w, h);
  };

  resWidth.addEventListener('change', onDimensionChange);
  resHeight.addEventListener('change', onDimensionChange);

  resSwapBtn.addEventListener('click', () => {
    const temp = resWidth.value;
    resWidth.value = resHeight.value;
    resHeight.value = temp;
    sendResolutionUpdate(parseInt(resWidth.value, 10), parseInt(resHeight.value, 10));
  });

  popupStorage.get(['lastResolution', 'multiResConfig']).then(data => {
    if (data.multiResConfig) {
      multiResAll = data.multiResConfig.all || multiResAll;
      multiResActive = data.multiResConfig.active || [];
      setResMode(data.multiResConfig.mode || 'seq');
    } else {
      syncMultiResStorage();
    }
    renderResList();

    if (data.lastResolution) {
      resWidth.value = data.lastResolution.width;
      resHeight.value = data.lastResolution.height;
    } else if (multiResActive.length === 1) {
      const [w, h] = multiResActive[0].split('x');
      resWidth.value = w; resHeight.value = h;
    }
    
    // Ensure properly synced state for trigger visual
    const noneLabel = getLocalizedText('res_selected_none');
    const selectedLabel = getLocalizedText('res_selected_count').replace('{n}', multiResActive.length);
    if (multiResActive.length === 0) resTrigger.textContent = `${noneLabel} ⏷`;
    else if (multiResActive.length === 1) resTrigger.textContent = multiResActive[0].replace('x', ' × ') + ' ⏷';
    else resTrigger.textContent = `${selectedLabel} ⏷`;
  }).catch(error => {
    console.error('[Popup] 读取分辨率配置失败:', error);
    renderResList();
  });

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', (e) => switchTab('positive', e.isTrusted));
  tabNegative.addEventListener('click', (e) => switchTab('negative', e.isTrusted));

  // Editor
  const container = document.getElementById('editor-container');
  const dict = getPopupDict();
  const toolbarConfig = ToolbarConfigManager.config;
  editor = new TagEditor(container, {
    dict: dict,
    toolbarConfig: toolbarConfig,
    toolbarTriggerMode: document.getElementById('tagToolbarClickMode')?.checked ? 'click' : 'hover',
    onRemoveTags: handleRemovedPendingAiTags,
    onRetryPendingTag: (tag) => aiTranslateController?.translateFromInput({
      buttonEl: btnAiTranslate,
      tagEditor: editor,
      scrollContainer: container,
      targetContext: {
        type: 'base',
        mode: currentMode
      },
      pendingTag: tag
    }),
    onRetranslateAiTag: (tag) => aiTranslateController?.translateFromInput({
      buttonEl: btnAiTranslate,
      tagEditor: editor,
      scrollContainer: container,
      targetContext: {
        type: 'base',
        mode: currentMode
      },
      existingTag: tag
    }),
    onAnnotateTag: (tag, buttonEl) => aiTranslateController?.annotateTags({
      buttonEl,
      targetContext: {
        type: 'base',
        mode: currentMode
      },
      tags: [tag]
    }),
    onAnnotateSelectedTags: (tags, buttonEl) => aiTranslateController?.annotateTags({
      buttonEl,
      targetContext: {
        type: 'base',
        mode: currentMode
      },
      tags
    }),
    onAddToGroupTags: (tagData) => groupTagsController?.addTagToGroupTags(tagData),
    onSequentialStepChange: (key, value) => saveSequentialStepSetting(key, value),
    onSequentialCounterChange: (name, value) => saveSequentialCounter(name, value),
    onStepProgressReset: (key, isSequential) => resetStepProgress(key, isSequential),
    onChange: (tags) => {
      // 检测是否为结构性变更（tag 数量变化 = 增删操作）
      const prevTags = currentMode === 'positive' ? positiveTags : negativeTags;
      const isStructural = tags.length !== prevTags.length;
      updateTagsFromEditor(tags);
      syncToPage(isStructural ? 'immediate' : 'popup');
      
      // 同步最新 tags 到 Group Tags Panel
      syncActiveTagsToPanel();
    }
  });
  editor.setSequentialStepSettings(currentSequentialStepSettings);
  if (editor.setSequentialStepProgress) editor.setSequentialStepProgress(currentSequentialStepProgress);
  if (editor.setRandomWildcardLocks) editor.setRandomWildcardLocks(currentRandomWildcardLocks);

  // Bind Autocomplete to Editor (for inline edit)
  editor.bindAutocomplete(autocomplete);
  groupTagsController?.init().catch((error) => {
    console.error('[Popup] Failed to initialize Group Tags controller:', error);
  });

  // ── 焦点追踪：点击 base editor 容器时设为活动目标 ──
  container.addEventListener('mousedown', () => {
    setCurrentGroupTagsTarget({ type: 'base', mode: currentMode });
    syncActiveTagsToPanel();
  });

  // Character Prompt Add Button
  const btnAddChar = document.getElementById('btn-add-char');
  if (btnAddChar) {
    btnAddChar.addEventListener('mousedown', (e) => e.stopPropagation());
    btnAddChar.addEventListener('click', () => {
      if (characterPromptsData.length < maxCharacters) {
        characterPromptsData.push({ 
            posPrompt: '', posTags: [], 
            negPrompt: '', negTags: [], 
            gender: 'other' 
        });
        rebuildCharacterPromptsUI();
        syncCharactersToPage();
      }
    });
  }

  // Resizer Logic
  const resizer = document.getElementById('resizer');
  const charSection = document.getElementById('character-prompts-section');
  const btnMinChar = document.getElementById('btn-min-char');

  if (resizer && charSection) {
    let startY = 0;
    let startHeight = 0;
    let removeMouseMove = null;
    let removeMouseUp = null;

    const onMouseMove = (e) => {
      // Calculate delta relative to movement UPWARD
      const dy = startY - e.clientY;
      const newHeight = Math.max(80, startHeight + dy);
      charSection.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      resizer.classList.remove('active');
      charSection.classList.remove('resizing');
      removeMouseMove?.();
      removeMouseUp?.();
      removeMouseMove = null;
      removeMouseUp = null;
      // Save user preference
      popupStorage.set({ charSectionHeight: charSection.style.height }).catch(() => {});
    };

    resizer.addEventListener('mousedown', (e) => {
      if (charSection.classList.contains('minimized')) return;
      startY = e.clientY;
      startHeight = charSection.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      resizer.classList.add('active');
      charSection.classList.add('resizing');
      removeMouseMove?.();
      removeMouseUp?.();
      removeMouseMove = popupScope.on(document, 'mousemove', onMouseMove);
      removeMouseUp = popupScope.on(document, 'mouseup', onMouseUp);
    });

    if (btnMinChar) {
      btnMinChar.addEventListener('mousedown', (e) => e.stopPropagation());
      btnMinChar.addEventListener('click', () => {
        const isMinimized = charSection.classList.toggle('minimized');
        btnMinChar.textContent = isMinimized ? '+' : '_';
        resizer.classList.toggle('disabled', isMinimized);
        popupStorage.set({ charSectionMinimized: isMinimized }).catch(() => {});
      });
    }
    
    // Initialize saved state
    popupStorage.get(['charSectionHeight', 'charSectionMinimized']).then(data => {
        if (data.charSectionHeight) {
            charSection.style.height = data.charSectionHeight;
        }
        if (data.charSectionMinimized) {
            charSection.classList.add('minimized');
            if (btnMinChar) btnMinChar.textContent = '+';
            resizer.classList.add('disabled');
        }
    }).catch(() => {});
  }

  // Global split button close logic
  popupScope.on(document, 'click', (e) => {
    if (!e.target.closest('.split-btn-group')) {
      document.querySelectorAll('.split-dropdown').forEach(d => d.style.display = 'none');
    }
  });

  // Shared generic function for Split Button
  const setupDrawSplitButton = function(groupEl, inputEl, getEditorFn) {
    if (!groupEl) return;
    const mainBtn = groupEl.querySelector('.split-main');
    const arrowBtn = groupEl.querySelector('.split-arrow');
    const dropdown = groupEl.querySelector('.split-dropdown');
    const items = dropdown.querySelectorAll('.split-dropdown-item');

    popupStorage.get(['drawSplitMode']).then(data => {
      const mode = data.drawSplitMode || 'wildcard';
      updateSplitUI(mode);
    }).catch(() => updateSplitUI('wildcard'));

    function updateSplitUI(action) {
      const targetItem = Array.from(items).find(item => item.dataset.action === action) || items[0];
      if (!targetItem) return;
      mainBtn.dataset.action = targetItem.dataset.action;
      
      const localDict = typeof getPopupDict === 'function' ? getPopupDict() : {};
      const fallbackDict = typeof getI18nDict === 'function' ? getI18nDict('en', 'popup') : {};
      const baseKey = targetItem.getAttribute('data-i18n');
      
      if (baseKey) {
        mainBtn.setAttribute('data-i18n', baseKey);
        mainBtn.setAttribute('data-i18n-title', baseKey);
        
        let finalKey = baseKey;
        const shortKey = `${baseKey}_short`;
        if (typeof isShortMode !== 'undefined' && isShortMode && (localDict[shortKey] || fallbackDict[shortKey])) {
           finalKey = shortKey;
        }
        
        mainBtn.textContent = localDict[finalKey] || fallbackDict[finalKey] || targetItem.textContent;
        mainBtn.title = localDict[baseKey] || fallbackDict[baseKey] || targetItem.textContent;
      } else {
        mainBtn.textContent = targetItem.textContent;
      }
    }

    function executeDraw(action) {
      if (action === 'wildcard') {
        inputEl.value += '__';
      } else if (action === 'seq-wildcard') {
        inputEl.value += 's__';
      } else if (action === 'random') {
        const _editor = getEditorFn ? getEditorFn() : null;
        if (_editor) {
          _editor.addTag('||');
          const container = groupEl.closest('.char-prompt-block') ? groupEl.closest('.char-prompt-block').querySelector('.char-editor-container') : document.getElementById('editor-container');
          if (container) container.scrollTop = container.scrollHeight;
          inputEl.focus();
          return;
        } else {
          inputEl.value += '||';
        }
      }
      inputEl.focus();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    mainBtn.addEventListener('mousedown', (e) => e.preventDefault());
    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      executeDraw(mainBtn.dataset.action);
    });

    arrowBtn.addEventListener('mousedown', (e) => e.preventDefault());
    arrowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = dropdown.style.display === 'flex';
      document.querySelectorAll('.split-dropdown').forEach(d => d.style.display = 'none');
      dropdown.style.display = isVisible ? 'none' : 'flex';
    });

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        popupStorage.set({ drawSplitMode: action }).catch(() => {});
        
        document.querySelectorAll('.split-btn-group').forEach(group => {
            const mBtn = group.querySelector('.split-main');
            const tItem = group.querySelector(`.split-dropdown-item[data-action="${action}"]`);
            if (mBtn && tItem) {
                mBtn.dataset.action = action;
                
                const localDict = typeof getPopupDict === 'function' ? getPopupDict() : {};
                const fallbackDict = typeof getI18nDict === 'function' ? getI18nDict('en', 'popup') : {};
                const baseKey = tItem.getAttribute('data-i18n');
                
                if (baseKey) {
                  mBtn.setAttribute('data-i18n', baseKey);
                  mBtn.setAttribute('data-i18n-title', baseKey);
                  
                  let finalKey = baseKey;
                  const shortKey = `${baseKey}_short`;
                  if (typeof isShortMode !== 'undefined' && isShortMode && (localDict[shortKey] || fallbackDict[shortKey])) {
                     finalKey = shortKey;
                  }
                  
                  mBtn.textContent = localDict[finalKey] || fallbackDict[finalKey] || tItem.textContent;
                  mBtn.title = localDict[baseKey] || fallbackDict[baseKey] || tItem.textContent;
                } else {
                  mBtn.textContent = tItem.textContent;
                }
            }
        });
        
        dropdown.style.display = 'none';
        executeDraw(action);
      });
    });
  };
  popupScope.patch(window, 'setupDrawSplitButton', setupDrawSplitButton);

  // Input Area
  const input = document.getElementById('quick-input');
  const btnAdd = document.getElementById('btn-add');
  const mainDrawSplit = document.getElementById('main-draw-split');
  const btnAiTranslate = document.getElementById('btn-ai-translate');

  if (mainDrawSplit) {
    window.setupDrawSplitButton(mainDrawSplit, input, () => editor);
  }

  btnAiTranslate?.addEventListener('click', () => {
    aiTranslateController?.translateFromInput({
      inputEl: input,
      buttonEl: btnAiTranslate,
      tagEditor: editor,
      scrollContainer: container,
      targetContext: {
        type: 'base',
        mode: currentMode
      }
    });
  });

  // Attach Autocomplete to Input
  autocomplete.attach(input, (val) => {
    // When autocomplete selects, add tag
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    // Replace _ with space, UNLESS it's a wildcard format
    const cleanTags = newTags.map(t => {
      const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
      return isWildcard ? t : t.replace(/_/g, ' ');
    });
    cleanTags.forEach(t => editor.addTag(t));
    input.value = '';
    input.focus();
  });

  const addTag = () => {
    const val = input.value.trim();
    if (val) {
      // Split by comma if user pasted multiple
      const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
      // Replace _ with space, UNLESS it's a wildcard format
      const cleanTags = newTags.map(t => {
        const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
        return isWildcard ? t : t.replace(/_/g, ' ');
      });
      cleanTags.forEach(t => editor.addTag(t));
      input.value = '';
      // scroll to bottom
      container.scrollTop = container.scrollHeight;
    }
    // Always hide autocomplete when adding tag via Enter or button
    if (autocomplete) autocomplete.hide();
  };

  btnAdd.addEventListener('click', () => {
    if (editor) editor.addTag('\n');
    if (autocomplete) autocomplete.hide();
    const container = document.getElementById('tag-editor-container');
    if (container) container.scrollTop = container.scrollHeight;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && btnAiTranslate) {
        btnAiTranslate.click();
      } else {
        // Small timeout to allow autocomplete to process first if it's active
        popupScope.timeout(() => {
          if (input.value.trim()) addTag();
        }, 100);
      }
    }
  });

  // Library & Settings
  document.getElementById('btn-library').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/sync.html') });
  });

  // Language Support translations now at top level

  const applyTranslations = (lang) => {
    currentLang = lang;
    const dict = getI18nDict(lang, 'popup');
    const fallbackDict = getI18nDict(DEFAULT_LANG, 'popup');

    // Update global editor and character editors
    if (editor) {
      editor.options.dict = dict;
      editor.render();
    }
    charEditors.forEach(ce => {
      if (ce.editor) {
        ce.editor.options.dict = dict;
        ce.editor.render();
      }
    });

    // Update Toolbar Settings UI
    if (ToolbarConfigManager && typeof ToolbarConfigManager.renderList === 'function') {
      ToolbarConfigManager.renderList();
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const baseKey = el.getAttribute('data-i18n');
      const shortKey = `${baseKey}_short`;
      const isDropdownItem = el.classList.contains('split-dropdown-item');
      const isInputItem = el.closest('#input-area');
      const useShort = isInputItem ? isInputShortMode : isShortMode;
      const key = (!isDropdownItem && useShort && (dict[shortKey] || fallbackDict[shortKey])) ? shortKey : baseKey;
      const text = dict[key] || fallbackDict[key];
      
      if (text) {
        // If element has children (like Settings title with close button), preserve them
        if (el.children.length === 0) {
          el.textContent = text;
        } else {
          // Find text node and replace it
          for (let node of el.childNodes) {
            if (node.nodeType === 3) {
              node.textContent = text + ' ';
              break;
            }
          }
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const text = dict[key] || fallbackDict[key];
      if (text) el.placeholder = text;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const text = dict[key] || fallbackDict[key];
      if (text) el.title = text;
    });

    if (editor) {
      if (dict.tag_help_tooltip) {
        editor.options.helpTooltip = dict.tag_help_tooltip;
      }
      editor.options.dict = dict;
      editor.render();
    }
    
    // Also update all character editors
    charEditors.forEach(charEditorObj => {
        if (charEditorObj.editor) {
            charEditorObj.editor.options.dict = dict;
            charEditorObj.editor.render();
        }
    });

    // Handle button active state
    ['btn-zh', 'btn-en', 'btn-jp'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-${lang}`);
    });

    const acI18n = {
      fixedShort: dict.ac_mode_fixed_short || fallbackDict.ac_mode_fixed_short || 'Fixed',
      onImageShort: dict.ac_mode_on_image_short || fallbackDict.ac_mode_on_image_short || 'On Img',
      fixedTitle: dict.ac_mode_fixed_title || fallbackDict.ac_mode_fixed_title || 'Fixed Interval',
      onImageTitle: dict.ac_mode_on_image_title || fallbackDict.ac_mode_on_image_title || 'On Image',
      loopCapTitle: dict.ac_loop_cap_title || fallbackDict.ac_loop_cap_title || 'Task limit is {cap} generations',
      loopCapReason1: dict.ac_loop_cap_reason1 || fallbackDict.ac_loop_cap_reason1 || 'NovelAI has strict rate limits for high-frequency image generation requests.',
      loopCapReason2: dict.ac_loop_cap_reason2 || fallbackDict.ac_loop_cap_reason2 || 'Exceeding the threshold may result in a permanent account restriction.',
      loopCapReason3: dict.ac_loop_cap_reason3 || fallbackDict.ac_loop_cap_reason3 || 'To protect your account, the maximum limit for a single auto-clicker task is set to {cap}.',
      loopCapReason4: dict.ac_loop_cap_reason4 || fallbackDict.ac_loop_cap_reason4 || 'You can start a new loop manually once the task is completed.',
      loopCapOk: dict.ac_loop_cap_ok || fallbackDict.ac_loop_cap_ok || 'I Understand'
    };
    popupStorage.set({ autoClickerI18n: acI18n }).catch(() => {});

    // 刷新多选分辨率按钮文字
    if (typeof syncMultiResStorage === 'function') syncMultiResStorage();
    groupTagsController?.handleLanguageChange();
  };

  const setLanguage = (lang) => {
    applyTranslations(lang);
    popupStorage.set({ language: lang }).catch(() => {});
  };

  // Language Toggle
  const langBtns = {
    'btn-zh': 'zh',
    'btn-en': 'en',
    'btn-jp': 'jp'
  };
  Object.keys(langBtns).forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      setLanguage(langBtns[id]);
    });
  });

  // Load language preference
  popupStorage.get('language').then(data => {
    if (data.language) {
      applyTranslations(data.language);
    } else {
      // 首次加载，获取浏览器语言
      const browserLang = navigator.language || navigator.userLanguage || 'en';
      let defaultLang = DEFAULT_LANG;
      if (browserLang.toLowerCase().startsWith('zh')) {
        defaultLang = 'zh';
      } else if (browserLang.toLowerCase().startsWith('ja')) {
        defaultLang = 'jp';
      }
      setLanguage(defaultLang);
    }
  }).catch(error => {
    console.error('[Popup] 读取语言配置失败:', error);
    applyTranslations(DEFAULT_LANG);
  });

  // Observe width for responsive short-text mode
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const w = entry.contentRect.width;
      
      // 1. SVG 按键文字隐藏阈值 (改为 < 540px 时隐藏，确保拉宽展开时有足够空间不顶爆)
      const hideIcons = w < 560;
      document.body.classList.toggle('hide-icon-text', hideIcons);

      // 2. 超窄屏阈值 (< 420px 时隐藏自定义分辨率输入框)
      const hideResCustom = w < 410;
      document.body.classList.toggle('hide-res-custom', hideResCustom);

      // 3. 顶部区域：Tab 和 分辨率文字缩短阈值 (维持宽度 < 720px 时缩短)
      const isNarrow = w < 720;
      if (isShortMode !== isNarrow) {
        isShortMode = isNarrow;
        applyTranslations(currentLang);
      }

      // 4. 红框区域：输入区 (AI/下拉) 文字缩短阈值 (设为 < 640px 时缩短，不影响顶部)
      const isInputNarrow = w < 460;
      if (isInputShortMode !== isInputNarrow) {
        isInputShortMode = isInputNarrow;
        applyTranslations(currentLang);
      }
    }
  });
  popupScope.trackObserver(resizeObserver);
  resizeObserver.observe(document.body);

  // Settings Persistence
  const settings = [
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'hideAutoClicker',
    'settingSyncPulse',
    'tagToolbarClickMode',
    'tagEditorDensity',
    'triggerSpace',
    'triggerTab',
    'autoOpenSync',
    'enableGrouping'
  ];

  // Load Settings
  popupStorage.get(settings).then(data => {
    settings.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        let val = data[key];
        if (val === undefined) {
          // 默认开启的选项
          if (key === 'alternativeDanbooruAutocomplete' || 
              key === 'settingSyncPulse' || 
              key === 'autoOpenSync' || 
              key === 'triggerTab' ||
              key === 'enableGrouping') {
            val = true;
          } else {
            val = false;
          }
          // 在首次初始化时立刻存储默认值，确保整个应用能够同步
          popupStorage.set({ [key]: val }).catch(() => {});
        }
        el.checked = !!val;

        // Apply initial state
        
        // Phase 14.7: Breathing Light toggle
        if (key === 'settingSyncPulse') {
            document.body.classList.toggle('disable-pulse', !el.checked);
        }

        if (key === 'tagToolbarClickMode') {
          const toolbarTriggerMode = el.checked ? 'click' : 'hover';
          if (editor) {
            editor.options.toolbarTriggerMode = toolbarTriggerMode;
            editor.applyToolbarTriggerMode?.();
            editor.render();
          }
          charEditors.forEach(charEdObj => {
            if (charEdObj.editor) {
              charEdObj.editor.options.toolbarTriggerMode = toolbarTriggerMode;
              charEdObj.editor.applyToolbarTriggerMode?.();
              charEdObj.editor.render();
            }
          });
        }

        // Phase 14.8: Auto-open Sync Page toggle
        // 由于 manifest 中没有 tabs 权限，无法用 chrome.tabs.query 按 URL 检索。
        // 改用 sync.html 自身写入的 syncPageActive 标记来判断是否已有活跃页面。
        if (key === 'autoOpenSync' && el.checked) {
          popupStorage.get('syncPageActive').then(result => {
            if (!result.syncPageActive) {
              const syncUrl = chrome.runtime.getURL("pages/sync.html");
              chrome.tabs.create({ url: syncUrl, active: false });
            }
          }).catch(error => console.error('[Popup] 读取同步页面状态失败:', error));
        }

        el.addEventListener('change', () => {
          popupStorage.set({ [key]: el.checked }).catch(() => {});
          if (key === 'settingSyncPulse') {
            document.body.classList.toggle('disable-pulse', !el.checked);
          }
          if (key === 'tagToolbarClickMode') {
            const toolbarTriggerMode = el.checked ? 'click' : 'hover';
            if (editor) {
              editor.options.toolbarTriggerMode = toolbarTriggerMode;
              editor.applyToolbarTriggerMode?.();
              editor.render();
            }
            charEditors.forEach(charEdObj => {
              if (charEdObj.editor) {
                charEdObj.editor.options.toolbarTriggerMode = toolbarTriggerMode;
                charEdObj.editor.applyToolbarTriggerMode?.();
                charEdObj.editor.render();
              }
            });
          }
          if (key === 'enableGrouping') {
            if (editor) {
              editor.options.enableGrouping = el.checked;
              editor.render();
            }
            charEditors.forEach(charEdObj => {
              if (charEdObj.editor) {
                charEdObj.editor.options.enableGrouping = el.checked;
                charEdObj.editor.render();
              }
            });
          }
        });
      }
    });

    if (data.tagEditorDensity !== undefined) {
      applyTagEditorDensity(data.tagEditorDensity);
    } else {
      applyTagEditorDensity(50);
    }
  }).catch(error => console.error('[Popup] 读取设置失败:', error));

  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');
  const closeSettingsModal = () => {
    modal.style.display = 'none';
  };

  // Update Chrome Storage Monitor
  function updateStorageMonitor() {
    const barFill = document.getElementById('storage-bar-fill');
    const textDesc = document.getElementById('storage-usage-text');
    if (!barFill || !textDesc) return;

    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      chrome.runtime.lastError; // Ignore errors silently
      const usageMb = bytesInUse / (1024 * 1024);
      
      // 动态推导软上限档位，因为插件声明了 unlimitedStorage 权限
      let limitMb = 10;
      if (usageMb > 500) limitMb = 1024;
      else if (usageMb > 100) limitMb = 500;
      else if (usageMb > 50) limitMb = 100;
      else if (usageMb > 10) limitMb = 50;

      const maxBytes = limitMb * 1024 * 1024;
      let percentage = (bytesInUse / maxBytes) * 100;
      
      // Cap at 100% just in case 
      percentage = Math.min(percentage, 100);

      textDesc.textContent = `${usageMb.toFixed(2)} / ${limitMb} MB (${percentage.toFixed(1)}%)`;
      barFill.style.width = `${percentage}%`;

      // Visual warnings
      barFill.classList.remove('warning', 'critical');
      if (percentage >= 90) {
        barFill.classList.add('critical');
      } else if (percentage >= 70) {
        barFill.classList.add('warning');
      }
    });
  }

  // Settings Tabs Logic (Navigation and State Memory)
  const initSettingsTabs = () => {
    const tabs = document.querySelectorAll('.settings-nav-btn');
    const panes = document.querySelectorAll('.settings-pane');
    if (!tabs.length) return;

    // Load last active tab
    popupStorage.get(['lastActiveSettingsTab']).then(res => {
      const activeTabId = res.lastActiveSettingsTab || 'pane-general';
      
      const applyTab = (targetId) => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        const targetBtn = document.querySelector(`.settings-nav-btn[data-target="${targetId}"]`);
        const targetPane = document.getElementById(targetId);
        if (targetBtn) targetBtn.classList.add('active');
        if (targetPane) targetPane.classList.add('active');
      };

      // Set initial state
      applyTab(activeTabId);

      // Bind click events
      tabs.forEach(btn => {
        btn.onclick = (e) => {
          const targetId = btn.getAttribute('data-target');
          if (!targetId) return;
          applyTab(targetId);
          popupStorage.set({ lastActiveSettingsTab: targetId }).catch(() => {});
        };
      });
    }).catch(error => console.error('[Popup] 读取设置页签状态失败:', error));
  };

  btnSettings.addEventListener('click', () => {
    if (modal.style.display === 'flex') {
      closeSettingsModal();
    } else {
      modal.style.display = 'flex';
      updateStorageMonitor();
      initSettingsTabs();
    }
  });

  closeSettings.addEventListener('click', closeSettingsModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeSettingsModal();
    }
  });

  // History & Favorites Modal trigger
  const btnHistory = document.getElementById('btn-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', async () => {
      // 在打开历史窗口前，强行将当前所有挂起的防抖修改立即转正记录，并等待其写入完成
      await recordHistory('immediate');
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_HISTORY_MODAL' });
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // 全局快捷键设置系统
  // ══════════════════════════════════════════════════════════

  // 默认快捷键配置
  const DEFAULT_HOTKEYS = {
    toggleMinimize: { key: 'm', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
    triggerGenerate: { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
    focusBase: { key: 'q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }
  };

  // 当前快捷键配置（运行时缓存）
  let currentHotkeys = JSON.parse(JSON.stringify(DEFAULT_HOTKEYS));

  /**
   * 判断按键事件是否匹配快捷键配置
   * @param {KeyboardEvent} event - 键盘事件
   * @param {object} hotkeyConfig - 快捷键配置对象 { key, ctrlKey, altKey, shiftKey, metaKey }
   * @returns {boolean}
   */
  function matchHotkey(event, hotkeyConfig) {
    if (!hotkeyConfig || !hotkeyConfig.key) return false;
    // 对单字符按键（字母键）做大小写不敏感比较
    // 因为 event.key 返回的是小写（如 'm'），除非同时按了 Shift
    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const configKey = hotkeyConfig.key.length === 1 ? hotkeyConfig.key.toLowerCase() : hotkeyConfig.key;
    return eventKey === configKey
      && !!event.ctrlKey === !!hotkeyConfig.ctrlKey
      && !!event.altKey === !!hotkeyConfig.altKey
      && !!event.shiftKey === !!hotkeyConfig.shiftKey
      && !!event.metaKey === !!hotkeyConfig.metaKey;
  }

  /**
   * 将快捷键配置格式化为可读字符串（如 "Ctrl+Alt+M"）
   * @param {object} hotkeyConfig - 快捷键配置对象
   * @returns {string}
   */
  function formatHotkey(hotkeyConfig) {
    if (!hotkeyConfig || !hotkeyConfig.key) return '';
    const parts = [];
    if (hotkeyConfig.ctrlKey) parts.push('Ctrl');
    if (hotkeyConfig.altKey) parts.push('Alt');
    if (hotkeyConfig.shiftKey) parts.push('Shift');
    if (hotkeyConfig.metaKey) parts.push('Meta');

    // 特殊键名的显示友好化
    let keyName = hotkeyConfig.key;
    if (keyName === ' ') keyName = 'Space';
    else if (keyName === 'ArrowUp') keyName = '↑';
    else if (keyName === 'ArrowDown') keyName = '↓';
    else if (keyName === 'ArrowLeft') keyName = '←';
    else if (keyName === 'ArrowRight') keyName = '→';
    else if (keyName.length === 1) keyName = keyName.toUpperCase();

    parts.push(keyName);
    return parts.join('+');
  }

  /**
   * 更新快捷键按钮的显示
   * @param {string} action - 快捷键动作名 ('toggleMinimize' | 'triggerGenerate' | 'focusBase')
   */
  function updateHotkeyBtnDisplay(action) {
    let btnId;
    if (action === 'toggleMinimize') btnId = 'hotkey-minimize';
    else if (action === 'triggerGenerate') btnId = 'hotkey-generate';
    else if (action === 'focusBase') btnId = 'hotkey-focus-base';
    
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const config = currentHotkeys[action];
    const text = formatHotkey(config);
    if (text) {
      btn.textContent = text;
      btn.classList.remove('empty');
    } else {
      btn.textContent = getLocalizedText('hotkey_not_set') || 'Not Set';
      btn.classList.add('empty');
    }
  }

  // 初始化快捷键设置 UI
  function initHotkeySettings() {
    let recordingBtn = null; // 当前正在录制的按钮

    // 从 chrome.storage 加载快捷键
    popupStorage.get('hotkeys').then(data => {
      if (data.hotkeys) {
        // 合并已保存的配置和默认值（确保新增的快捷键有默认值）
        currentHotkeys = { ...DEFAULT_HOTKEYS, ...data.hotkeys };
      }
      // 更新所有按钮的显示
      updateHotkeyBtnDisplay('toggleMinimize');
      updateHotkeyBtnDisplay('triggerGenerate');
      updateHotkeyBtnDisplay('focusBase');
    }).catch(error => console.error('[Popup] 读取快捷键配置失败:', error));

    /**
     * 停止录制状态
     */
    function stopRecording() {
      if (recordingBtn) {
        recordingBtn.classList.remove('recording');
        const action = recordingBtn.dataset.hotkey;
        updateHotkeyBtnDisplay(action);
        recordingBtn = null;
      }
    }

    /**
     * 保存当前快捷键到 chrome.storage
     */
    function saveHotkeys() {
      popupStorage.set({ hotkeys: currentHotkeys }).catch(() => {});
    }

    // 为每个快捷键按钮和清除按钮绑定事件
    ['toggleMinimize', 'triggerGenerate', 'focusBase'].forEach(action => {
      let btnId;
      if (action === 'toggleMinimize') btnId = 'hotkey-minimize';
      else if (action === 'triggerGenerate') btnId = 'hotkey-generate';
      else if (action === 'focusBase') btnId = 'hotkey-focus-base';
      
      const clearId = btnId + '-clear';
      const btn = document.getElementById(btnId);
      const clearBtn = document.getElementById(clearId);

      if (btn) {
        btn.addEventListener('click', () => {
          if (recordingBtn === btn) {
            // 再次点击同一个按钮 → 取消录制
            stopRecording();
            return;
          }
          // 停止其他按钮的录制
          stopRecording();
          // 进入录制状态
          recordingBtn = btn;
          btn.classList.add('recording');
          btn.textContent = getLocalizedText('hotkey_press_key') || '⌨ Press a Key...';
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          stopRecording();
          currentHotkeys[action] = { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
          updateHotkeyBtnDisplay(action);
          saveHotkeys();
        });
      }
    });

    // 全局 keydown 监听器 — 处理录制和快捷键触发
    popupScope.on(document, 'keydown', (e) => {
      // ── 录制模式：捕获按键组合 ──
      if (recordingBtn) {
        e.preventDefault();
        e.stopPropagation();

        // 纯修饰键按下时不终止录制（等用户加上字母/功能键）
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

        // Escape = 取消录制
        if (e.key === 'Escape') {
          stopRecording();
          return;
        }

        const action = recordingBtn.dataset.hotkey;

        // Delete/Backspace = 清除该快捷键
        if (e.key === 'Delete' || e.key === 'Backspace') {
          currentHotkeys[action] = { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
          stopRecording();
          saveHotkeys();
          return;
        }

        // 记录组合键
        currentHotkeys[action] = {
          key: e.key,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey
        };
        stopRecording();
        saveHotkeys();
        return;
      }

      // ── 非录制模式：检查是否匹配已配置的快捷键 ──
      // 如果焦点在输入框/文本框中，跳过快捷键检查（避免干扰正常文本输入）
      const target = e.target;
      // 排除快捷键设置页面中作为展示用的非录制状态的按键
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (matchHotkey(e, currentHotkeys.focusBase)) {
        e.preventDefault();
        // 如果是从 iframe 内触发，自身直接执行切换逻辑
        executeFocusBase();
        
        // 同时也通知宿主页面（如果面板没有打开/被最小化，宿主页面需要将其展开）
        if (isEmbeddedPopup) {
          window.parent.postMessage({ type: '__HOTKEY_ACTION__', action: 'focusBase' }, '*');
        }
        return;
      }

      if (matchHotkey(e, currentHotkeys.toggleMinimize)) {
        // 无论在输入框还是其他地方，最小化快捷键都应该工作（因为它不产生文字输入冲突）
        e.preventDefault();
        if (isEmbeddedPopup) {
          // iframe 模式：通知宿主页面
          window.parent.postMessage({ type: '__HOTKEY_ACTION__', action: 'toggleMinimize' }, '*');
        }
        return;
      }

      if (matchHotkey(e, currentHotkeys.triggerGenerate)) {
        // 生成图像快捷键：在输入框中时要额外判断（避免和 Enter 添加 tag 冲突）
        // 如果是纯 Enter（没有 Ctrl/Alt/Shift 修饰），不拦截，让原有添加 tag 逻辑处理
        if (isInput && !e.ctrlKey && !e.altKey && !e.metaKey) return;
        e.preventDefault();
        if (isEmbeddedPopup) {
          window.parent.postMessage({ type: '__HOTKEY_ACTION__', action: 'triggerGenerate' }, '*');
        }
        return;
      }
    }, true); // 使用 capture 阶段以高优先级捕获

    // 监听 storage 变化以保持多页面同步
    popupScope.chromeEvent(chrome.storage.onChanged, (changes, area) => {
      if (area === 'local' && changes.hotkeys) {
        currentHotkeys = { ...DEFAULT_HOTKEYS, ...(changes.hotkeys.newValue || {}) };
        updateHotkeyBtnDisplay('toggleMinimize');
        updateHotkeyBtnDisplay('triggerGenerate');
        updateHotkeyBtnDisplay('focusBase');
      }
    });

    // 监听来自 bridge.js 的通知（例如宿主页面监听到 focusBase，转发进来执行界面逻辑）
    popupScope.on(window, 'message', (e) => {
      if (e.data?.type === '__HOTKEY_ACTION__' && e.data.action === 'focusBase') {
        executeFocusBase();
      }
    });

  }

  /**
   * 切换到 Base Tab 并聚焦于的主输入框
   */
  function executeFocusBase() {
    // 切换到正面词 (Base) 标签页
    if (currentMode !== 'positive') {
      switchTab('positive', true);
    }
    // 焦点放入快速输入框
    const quickInput = document.getElementById('quick-input');
    if (quickInput) {
      quickInput.focus();
    }
  }

  initHotkeySettings();
}

function switchTab(mode, fromUserClick = false) {
  currentMode = mode;

  document.getElementById('tab-positive').classList.toggle('active', mode === 'positive');
  document.getElementById('tab-negative').classList.toggle('active', mode === 'negative');

  if (mode === 'positive') {
    editor.setTags(positiveTags, { skipInherit: true });
  } else {
    editor.setTags(negativeTags, { skipInherit: true });
  }
  syncPendingAiVisualTimer();

  // Notify webpage about the tab switch
  if (fromUserClick) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SWITCH_TAB',
          data: {
              tab: mode,
              index: -1 // -1 indicates Base Prompt
          }
        });
      }
    });
  }

  const activeTarget = getCurrentGroupTagsTarget();
  if (fromUserClick || activeTarget.type === 'base') {
    setCurrentGroupTagsTarget({ type: 'base', mode });
  }

  // 切换后立即同步正确的 tags 状态给面板，刷新灰阶
  syncActiveTagsToPanel();
}

function syncActiveTagsToPanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
    if (tabsList[0]) {
      let activeTags, inactiveTags, targetLabel;
      let activeTarget = getCurrentGroupTagsTarget();

      if (activeTarget.type === 'base') {
        // 当前焦点在 Base 编辑器
        if (activeTarget.mode !== currentMode) {
          activeTarget = setCurrentGroupTagsTarget({ type: 'base', mode: currentMode });
        }
        activeTags = currentMode === 'positive' ? positiveTags : negativeTags;
        inactiveTags = currentMode === 'positive' ? negativeTags : positiveTags;
        targetLabel = currentMode === 'positive' ? 'Base (+)' : 'Base (-)';
      } else if (activeTarget.type === 'character') {
        const idx = activeTarget.charIndex;
        const charData = characterPromptsData[idx];
        const charEdObj = charEditors[idx];
        if (charData && charEdObj) {
          const mode = activeTarget.mode === 'negative' ? 'negative' : 'positive';
          activeTags = mode === 'positive' ? (charData.posTags || []) : (charData.negTags || []);
          inactiveTags = mode === 'positive' ? (charData.negTags || []) : (charData.posTags || []);
          targetLabel = `Char ${idx + 1} (${mode === 'positive' ? '+' : '-'})`;
        } else {
          // 角色已被删除，回退到 base
          activeTarget = setCurrentGroupTagsTarget({ type: 'base', mode: currentMode });
          activeTags = currentMode === 'positive' ? positiveTags : negativeTags;
          inactiveTags = currentMode === 'positive' ? negativeTags : positiveTags;
          targetLabel = currentMode === 'positive' ? 'Base (+)' : 'Base (-)';
        }
      }

      chrome.tabs.sendMessage(tabsList[0].id, { 
        type: 'SYNC_ACTIVE_TAGS', 
        activeTags: getSyncableTagList(activeTags),
        inactiveTags: getSyncableTagList(inactiveTags),
        targetLabel
      });
    }
  });
}

function updateTagsFromEditor(updatedTags) {
  if (currentMode === 'positive') {
    positiveTags = updatedTags;
  } else {
    negativeTags = updatedTags;
  }
}

function tagsToString(tags) {
  let result = '';
  const activeTags = getSyncableTagList(tags).filter(t => !t.disabled);
  let inDynamic = false;
  let compDepthForComma = 0; // 追踪深度以决定是否省略逗号
  let pendingDynWeight = null; // 暂存当前选项块的权重

  activeTags.forEach((t, i) => {
    const val = t.value;
    const isDynStart = val.startsWith('||') && (val !== '||' || t.isStart);
    const isDynEnd = val === '||' && !t.isStart;
    const isDynSep = val === '|';
    const isHeader = !!val.match(/^([-?\d\.]+)::$/);
    const isFooter = val === ' ::' || val === '::';
    const isTrulyFooter = isFooter && compDepthForComma > 0;

    if (val === '\n') {
      result += '\n';
      pendingDynWeight = null; // 换行通常意味着上下文断开
    } else {
      if (isDynStart) {
        inDynamic = true;
        pendingDynWeight = null;
      }
      if (isHeader) compDepthForComma++;
      if (isTrulyFooter) compDepthForComma--;
      
      // 记录权重逻辑：如果在动态块内且不是分隔符，尝试记录权重
      // 在多标签模式下，任何一个标签有权重都会被暂存，最后统一输出给该选项
      if (inDynamic && !isDynStart && !isDynEnd && !isDynSep) {
        if (t.dynWeight && t.dynWeight !== 1) {
          pendingDynWeight = t.dynWeight;
        }
      }

      // Handle native value
      let outputVal = val;
      if (isTrulyFooter) outputVal = ' ::'; // Canonicalize during output
      
      const next = activeTags[i + 1];
      const nextVal = next ? next.value : '';
      const nextIsDynEnd = nextVal === '||' && !next.isStart;
      const nextIsDynSep = nextVal === '|';
      const nextIsNL = nextVal === '\n';

      // 权重输出逻辑：如果下一个是分隔符或结尾，就把暂存的权重吐出来
      if (inDynamic && pendingDynWeight && (nextIsDynSep || nextIsDynEnd || nextIsNL || !next)) {
        outputVal += `:${pendingDynWeight}`;
        pendingDynWeight = null;
      }

      result += outputVal;
      if (isDynEnd) inDynamic = false;

      if (i < activeTags.length - 1) {
        const nextIsTrulyFooter = (nextVal === ' ::' || nextVal === '::') && compDepthForComma > 0;

        if (inDynamic) {
          // Inside dynamic: determine connection between tags
          if (isDynStart && !nextIsDynEnd && !nextIsNL) {
            // Space after header ||...$$
            result += ' ';
          } else if (isDynSep && !nextIsDynEnd && !nextIsNL) {
            // Space after OR separator |
            result += ' ';
          } else if (!isDynStart && !nextIsDynEnd && !nextIsNL && !isDynSep && nextIsDynSep) {
            // Space before OR separator |
            result += ' ';
          } else if (!isDynStart && !nextIsDynEnd && !nextIsNL && !isDynSep && !nextIsDynSep) {
            // Comma between tags in the same option group
            result += ', ';
          }
        } else {
          // Outside dynamic: use ,
          if (!isHeader && !nextIsTrulyFooter) {
            if (!outputVal.trim().endsWith(',')) {
              result += ', ';
            } else if (!outputVal.endsWith(' ')) {
              result += ' '; // Add space if user provided comma but no space
            }
          }
        }
      }
    }
  });
  return result;
}

function parsePromptToTags(promptText) {
  if (!promptText) return [];
  // Use common.splitTags logic
  const parts = common.splitTags(promptText);
  const result = [];

  let inDynamic = false;
  parts.forEach(p => {
    // Check if part is a dynamic block: ||...||
    if (p.startsWith('||') && p.endsWith('||') && p.length >= 4) {
      const content = p.slice(2, -2);
      let options = content;
      let config = '';

      if (content.includes('$$')) {
        const dParts = content.split('$$');
        options = dParts.pop();
        config = dParts.join('$$');
      }

      // Push start marker
      result.push({ value: `||${config}${config ? '$$' : ''}`, isStart: true, disabled: false });

      // Push members
      options.split('|').forEach(opt => {
        let val = opt.trim();
        if (!val) return;

        let dynWeight = 1;
        // Match :weight at the end, support decimals
        const dMatch = val.match(/^(.*?)\s*:\s*(\d+(\.\d+)?)\s*$/);
        if (dMatch && dMatch[2]) {
            val = dMatch[1];
            dynWeight = parseFloat(dMatch[2]);
        }

        result.push({ value: val, dynWeight: dynWeight, disabled: false });
      });

      // Push end marker
      result.push({ value: '||', disabled: false });
    } else if (p === '||') {
      if (!inDynamic) {
        result.push({ value: '||', isStart: true, disabled: false });
        inDynamic = true;
      } else {
        result.push({ value: '||', disabled: false });
        inDynamic = false;
      }
    } else if (p.startsWith('||') && !p.endsWith('||')) {
      // Half-finished block like ||tag1|tag2
      const content = p.slice(2);
      let options = content;
      let config = '';
      if (content.includes('$$')) {
        const dParts = content.split('$$');
        options = dParts.pop();
        config = dParts.join('$$');
      }
      result.push({ value: `||${config}${config ? '$$' : ''}`, isStart: true, disabled: false });
      inDynamic = true;
      options.split('|').forEach(opt => {
        let val = opt.trim();
        if (!val) return;
        result.push({ value: val, disabled: false });
      });
    } else {
      const isNL = p === '\n';
      const isFooter = p === ' ::' || p === '::';
      const isDynSep = p === '|';
      let val = isFooter ? ' ::' : (isNL ? p : p.trim());

      // 动态块内的普通 tag：提取 :weight 后缀作为 dynWeight
      if (inDynamic && !isNL && !isFooter && !isDynSep && val) {
        let dynWeight = 1;
        const dMatch = val.match(/^(.*?)\s*:\s*(\d+(\.\d+)?)\s*$/);
        if (dMatch && dMatch[2]) {
          val = dMatch[1];
          dynWeight = parseFloat(dMatch[2]);
        }
        result.push({ value: val, dynWeight: dynWeight, disabled: false });
      } else {
        result.push({ value: val, disabled: false });
      }
    }
  });

  return result.filter(t => t.value !== '');
}

/* Communication */

function normalizePrompt(str) {
  // Remove all whitespace and newlines for comparison
  // Also remove commas to handle "a, b" vs "a,b"
  if (!str) return '';
  return str.replace(/[\s\r\n,]/g, '');
}

function hasMeaningfulPromptState(promptText = '', tags = []) {
  return normalizePrompt(promptText) !== '' || serializeTagList(tags).length > 0;
}

function mergeTagMetadata(oldTag = {}, newTag = {}) {
  const mergedTag = { ...newTag };

  // 网页侧直接编辑时只会回传纯字符串解析结果。
  // 对于仍然同值的 tag，这里把 popup 本地持有的元数据缝回去，避免 aiOriginal 等信息丢失。
  if (oldTag.isStart && !mergedTag.isStart) {
    mergedTag.isStart = true;
  }

  const oldDynWeight = Number(oldTag.dynWeight);
  const nextDynWeight = Number(mergedTag.dynWeight);
  if (!Number.isNaN(oldDynWeight) && oldDynWeight !== 1 && (Number.isNaN(nextDynWeight) || nextDynWeight === 1)) {
    mergedTag.dynWeight = oldDynWeight;
  }

  if (typeof oldTag.aiOriginal === 'string' && oldTag.aiOriginal.trim() && !mergedTag.aiOriginal) {
    mergedTag.aiOriginal = oldTag.aiOriginal;
  }

  if (typeof oldTag.aiZhTranslation === 'string' && oldTag.aiZhTranslation.trim() && !mergedTag.aiZhTranslation) {
    mergedTag.aiZhTranslation = oldTag.aiZhTranslation;
  }

  if (oldTag.aiZhPending && !mergedTag.aiZhPending) {
    mergedTag.aiZhPending = true;
  }

  const oldAiZhPendingStartedAt = Number(oldTag.aiZhPendingStartedAt);
  if (Number.isFinite(oldAiZhPendingStartedAt) && oldAiZhPendingStartedAt > 0 && !mergedTag.aiZhPendingStartedAt) {
    mergedTag.aiZhPendingStartedAt = oldAiZhPendingStartedAt;
  }

  if (typeof oldTag.aiZhPendingRequestId === 'string' && oldTag.aiZhPendingRequestId.trim() && !mergedTag.aiZhPendingRequestId) {
    mergedTag.aiZhPendingRequestId = oldTag.aiZhPendingRequestId;
  }

  if (typeof oldTag.aiZhErrorMessage === 'string' && oldTag.aiZhErrorMessage.trim() && !mergedTag.aiZhErrorMessage) {
    mergedTag.aiZhErrorMessage = oldTag.aiZhErrorMessage;
  }

  return mergedTag;
}

function mergeTagsPreservingDisabled(oldTags, newTags) {
  const merged = [];
  let newIdx = 0;
  for (let i = 0; i < oldTags.length; i++) {
    const old = oldTags[i];
    if (old.disabled) {
      merged.push(old);
    } else {
      let foundIdx = -1;
      for (let k = newIdx; k < newTags.length; k++) {
        if (newTags[k].value === old.value) {
          foundIdx = k;
          break;
        }
      }
      if (foundIdx !== -1) {
        // Output any new active tags that were inserted *before* this match
        while (newIdx < foundIdx) {
          merged.push(newTags[newIdx]);
          newIdx++;
        }
        merged.push(mergeTagMetadata(old, newTags[foundIdx]));
        newIdx = foundIdx + 1;
      } else if (old.value === '\n') {
        // 换行符如果未在 incoming 匹配（如被网页格式化去掉），像 disabled 一样无条件保留。
        // 但如果 incoming 里有（网页发送回来的换行），会被上方逻辑正常匹配消耗，从而防止重复生成。
        merged.push(old);
      }
    }
  }
  // Flush remaining new active tags
  while (newIdx < newTags.length) {
    merged.push(newTags[newIdx]);
    newIdx++;
  }
  return merged;
}

function initCommunication() {
  promptSyncController?.init();

  popupScope.chromeEvent(chrome.runtime.onMessage, (msg, sender) => {
    if (shouldIgnoreRuntimeMessage(msg)) return;
    if (msg.type === 'RUNTIME_STATE_UPDATED') {
      const senderTabId = sender?.tab?.id;
      if (senderTabId) {
        getActiveTab().then((activeTab) => {
          if (activeTab?.id === senderTabId) {
            currentSequentialCounters = msg.counters || {};
            currentSequentialStepProgress = msg.stepProgress || {};
            currentRandomWildcardLocks = msg.randomLocks || {};
            applyRuntimeStateToEditors();
          }
        });
      }
      return;
    }

    if (msg.type === '__CLEAN_NUMERIC_PREFIXES__') {
      console.log('[Popup] Received cleanup request for numeric prefixes');
      let changed = false;
      const clean = (tag) => {
        const old = tag.value;
        const fixed = old.replace(/^(([sS])(\d+)__.*?__)$/, (match, full, prefix, num) => {
          if (num) {
            const parts = match.split('__');
            return (prefix || 's') + '__' + parts[1] + '__'; // Simple split index logic
          }
          return match;
        });
        if (fixed !== old) {
          changed = true;
          tag.value = fixed;
        }
      };

      positiveTags.forEach(clean);
      negativeTags.forEach(clean);

      if (changed) {
        editor.setTags(currentMode === 'positive' ? positiveTags : negativeTags);
        syncToPage();
      }
    }

    if (msg.type === 'SYNC_TAB') {
      const payload = msg.data;
      if (typeof payload === 'string') {
        // Backwards compatibility or direct base tab switch
        if (currentMode !== payload) {
          switchTab(payload, false);
        }
      } else if (payload && payload.tab) {
        const { tab, index } = payload;
        if (index === -1) {
          if (currentMode !== tab) {
            switchTab(tab, false);
          }
        } else if (index >= 0 && index < charEditors.length) {
          const charEd = charEditors[index];
          const innerTab = tab === 'positive' ? 'pos' : 'neg';
          if (charEd && charEd.activeTab !== innerTab && charEd.switchTab) {
            charEd.switchTab(innerTab, false);
          }
        }
      }
    }
  });

  // Initial Request — retry a few times to handle timing issues
  // (injector.js might not have registered its listeners yet)
  promptSyncController?.requestPromptWithRetry(5, 800);
}

function requestPromptWithRetry(retries, delayMs) {
  promptSyncController?.requestPromptWithRetry(retries, delayMs);
}

function requestPrompt() {
  promptSyncController?.requestPrompt();
}

function syncToPage(source) {
  promptSyncController?.syncPrompt(source);
}

// ═══════════════════════════════════════════════════════
// 历史记录 & 收藏夹 核心逻辑
// 历史状态机已经迁入 history-controller，这里只保留 popup 入口包装。
function recordHistory(source = 'popup') {
  return historyController?.recordHistory(source) || Promise.resolve();
}

async function restoreFromSnapshot(snapshot) {
  await historyController?.restoreFromSnapshot(snapshot);
}

async function appendHistorySnippet(snapshot, target) {
  await historyController?.appendHistorySnippet(snapshot, target);
}

popupScope.chromeEvent(chrome.runtime.onMessage, (msg) => {
  const isSessionBoundHistoryAction = msg?.type === 'RESTORE_HISTORY_SNAPSHOT'
    || msg?.type === 'APPEND_HISTORY_SNIPPET';
  if (isEmbeddedPopup && isSessionBoundHistoryAction && msg?.hostSessionId !== popupHostSessionId) {
    // 内嵌面板只接受当前宿主标签页转发的收藏动作；缺失会话标识也必须拒绝，
    // 避免独立扩展页或其他 NovelAI 标签页把恢复动作广播到所有已打开面板。
    return;
  }
  if (shouldIgnoreRuntimeMessage(msg)) return;
  if (groupTagsController?.handleRuntimeMessage(msg)) return;
  if (msg.type === 'RESTORE_HISTORY_SNAPSHOT' && msg.snapshot) {
    restoreFromSnapshot(msg.snapshot);
  }

  if (msg.type === 'APPEND_HISTORY_SNIPPET' && msg.snapshot && msg.target) {
    appendHistorySnippet(msg.snapshot, msg.target);
  }
});

function applyTagEditorDensity(value) {
    // value ranges from 0 to 100
    // Density calculation logic based on linear interpolation
    const ratio = value / 100;
    
    // min constraints at 0, max at 100
    const gap = 2 + (8 * ratio);          // 2px -> 10px
    const padV = 0 + (4 * ratio);         // 0px -> 4px
    const padH = 4 + (8 * ratio);         // 4px -> 12px
    const minHeight = 20 + (12 * ratio);  // 20px -> 32px
    const fontEn = 11 + (4 * ratio);      // 11px -> 15px
    const fontZh = 10 + (3 * ratio);      // 10px -> 13px
    const btnSize = 18 + (10 * ratio);    // 18px -> 28px
    
    document.documentElement.style.setProperty('--te-density-gap', `${gap}px`);
    document.documentElement.style.setProperty('--te-density-pad-v', `${padV}px`);
    document.documentElement.style.setProperty('--te-density-pad-h', `${padH}px`);
    document.documentElement.style.setProperty('--te-density-min-height', `${minHeight}px`);
    document.documentElement.style.setProperty('--te-density-font-en', `${fontEn}px`);
    document.documentElement.style.setProperty('--te-density-font-zh', `${fontZh}px`);
    document.documentElement.style.setProperty('--te-density-btn-size', `${btnSize}px`);
}

// 监听跨 iframe 传来的 Density Slider 信号
popupScope.on(window, 'message', (e) => {
    if (e.data?.type === '__UPDATE_TE_DENSITY__') {
        applyTagEditorDensity(e.data.value);
    }
});

