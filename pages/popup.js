import TagEditor from '../lib/TagEditor.js';
import common from '../lib/common.js';
import Autocomplete from '../lib/Autocomplete.js';
import { DEFAULT_LANG, getI18nDict, getI18nText } from '../lib/i18n/index.js';
import createAiTranslateController from './popup/ai-translate-controller.js';
import createGroupTagsController from './popup/group-tags-controller.js';
import createHistoryController from './popup/history-controller.js';
import createPromptSyncController from './popup/prompt-sync-controller.js';

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
let currentSequentialCounters = {};
let popupToastTimer = null;
let popupToastFrame = null;

let currentLang = DEFAULT_LANG;
let aiTranslateController = null;
let groupTagsController = null;
let historyController = null;
let promptSyncController = null;

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

// 将 tag 统一序列化为可安全存储/传输的纯对象。
function normalizeTagObject(tag = {}) {
  const value = String(tag.value || '').trim();
  if (!value) return null;

  const normalized = {
    value,
    disabled: !!tag.disabled
  };

  if (tag.isStart) normalized.isStart = true;

  const dynWeight = Number(tag.dynWeight);
  if (!Number.isNaN(dynWeight) && dynWeight !== 1) {
    normalized.dynWeight = dynWeight;
  }

  if (typeof tag.aiOriginal === 'string' && tag.aiOriginal.trim()) {
    normalized.aiOriginal = tag.aiOriginal.trim();
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
  clearTimeout(popupToastTimer);
  popupToastTimer = null;

  if (!toastEl) return;
  const removeToast = () => {
    if (popupToastFrame !== null) {
      cancelAnimationFrame(popupToastFrame);
      popupToastFrame = null;
    }
    toastEl.remove();
  };

  if (immediate) {
    removeToast();
    return;
  }

  toastEl.classList.remove('visible');
  window.setTimeout(removeToast, 180);
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
  popupToastFrame = requestAnimationFrame(() => {
    popupToastFrame = null;
    toastEl.classList.add('visible');
  });

  popupToastTimer = window.setTimeout(() => {
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
    editor.setTags(nextPositiveTags);
  }
  if (currentMode === 'negative' && shouldUpdateNeg) {
    editor.setTags(nextNegativeTags);
  }
}

function updateCharacterPromptSyncEditor({ index, shouldUpdatePos = false, shouldUpdateNeg = false, posTags = [], negTags = [] } = {}) {
  const charEditorObj = charEditors[index];
  if (!charEditorObj?.editor) return;

  if (charEditorObj.activeTab === 'pos' && shouldUpdatePos) {
    charEditorObj.editor.setTags(posTags);
  } else if (charEditorObj.activeTab === 'neg' && shouldUpdateNeg) {
    charEditorObj.editor.setTags(negTags);
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

document.addEventListener('DOMContentLoaded', async () => {
  initUI();
  await initData();
  initCommunication();
});

window.addEventListener('pagehide', () => {
  aiTranslateController?.destroy();
  groupTagsController?.destroy();
  historyController?.destroy();
  promptSyncController?.destroy();
});

function applySequentialCountersToEditors(counters) {
  currentSequentialCounters = counters || {};
  if (editor) {
    editor.setSequentialCounters(currentSequentialCounters);
  }
  charEditors.forEach((charEditorObj) => {
    if (charEditorObj?.editor) {
      charEditorObj.editor.setSequentialCounters(currentSequentialCounters);
    }
  });
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

function getSequentialCountersFromTab(tabId) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !tabId) {
      resolve({});
      return;
    }
    chrome.tabs.sendMessage(tabId, { type: 'GET_SEQUENTIAL_COUNTERS' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(response?.sequentialCounters || {});
    });
  });
}

async function refreshSequentialCountersFromActiveTab() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    applySequentialCountersToEditors({});
    return;
  }
  applySequentialCountersToEditors(await getSequentialCountersFromTab(activeTab.id));
}

function shouldIgnoreRuntimeMessage(msg) {
  if (!isEmbeddedPopup) return false;
  if (!msg?.hostSessionId) return false;
  return msg.hostSessionId !== popupHostSessionId;
}

async function initData() {
  const data = await chrome.storage.local.get(['promptHistory']);
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

  await refreshSequentialCountersFromActiveTab();

  // Listen for storage changes to keep counters in sync and hot-reload dictionary
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if ((changes.dictOverlay || changes.wildcards) && autocomplete) {
        // Hot-reload dictionary and wildcards
        autocomplete.loaded = false;
        autocomplete.load().then(() => {
          if (editor) editor.render();
          charEditors.forEach(c => {
            if (c.editor) c.editor.render();
          });
        });
      }
    }
  });
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

  if(input && dict.input_placeholder) input.placeholder = dict.input_placeholder;
  
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
    dict: dict, // Pass localization dict down to TagEditor
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
    onAddToGroupTags: (tagData) => groupTagsController?.addTagToGroupTags(tagData),
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
        charEditor.setTags(characterPromptsData[index].posTags || []);
    } else {
        btnNeg.classList.add('active');
        btnPos.classList.remove('active');
        editorContainer.classList.add('negative-mode');
        // Load neg tags
        charEditor.setTags(characterPromptsData[index].negTags || []);
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
        setTimeout(() => { if (input.value.trim()) addTag(); }, 100);
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

function initUI() {
  // Autocomplete
  autocomplete = new Autocomplete();
  autocomplete.load();
  if (!aiTranslateController) {
    aiTranslateController = createAiTranslateController({
      getLocalizedText,
      showToast: showPopupToast,
      normalizeTargetContext: normalizeAiTargetContext,
      getTargetTagList: getAiTargetTagList,
      renderTargetIfVisible: renderAiTargetIfVisible,
      syncTargetAfterResolve: syncAiTargetAfterResolve,
      refreshPendingVisuals: refreshPendingAiVisuals
    });
  }
  aiTranslateController.bindSettingsUI();

  if (!groupTagsController) {
    groupTagsController = createGroupTagsController({
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
    chrome.storage.local.set({ lastResolution: { width: w, height: h } });
  }

  function syncMultiResStorage() {
    const config = { all: multiResAll, active: multiResActive, mode: multiResMode };
    // 只保存配置，供 injector.js 在生成请求拦截时使用
    // 注意：此处不发 SET_RESOLUTION 消息，不修改网页 UI 输入框。
    // 原因：NovelAI 网页将输入框的值通过 CSS aspect-ratio 全局绑定到所有预览卡片。
    // 若修改网页输入框，所有已生成的预览图都会被强制拉伸到新比例，导致视觉错乱。
    // 多选模式下通过 fetch/XHR 拦截层静默改写请求参数，与网页 UI 完全解耦。
    chrome.storage.local.set({ multiResConfig: config });
    
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
  document.addEventListener('click', (e) => {
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

  chrome.storage.local.get(['lastResolution', 'multiResConfig'], (data) => {
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
  });

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', (e) => switchTab('positive', e.isTrusted));
  tabNegative.addEventListener('click', (e) => switchTab('negative', e.isTrusted));

  // Editor
  const container = document.getElementById('editor-container');
  const dict = getPopupDict();
  editor = new TagEditor(container, {
    dict: dict,
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
    onAddToGroupTags: (tagData) => groupTagsController?.addTagToGroupTags(tagData),
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
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Save user preference
      chrome.storage.local.set({ charSectionHeight: charSection.style.height });
    };

    resizer.addEventListener('mousedown', (e) => {
      if (charSection.classList.contains('minimized')) return;
      startY = e.clientY;
      startHeight = charSection.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      resizer.classList.add('active');
      charSection.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    if (btnMinChar) {
      btnMinChar.addEventListener('mousedown', (e) => e.stopPropagation());
      btnMinChar.addEventListener('click', () => {
        const isMinimized = charSection.classList.toggle('minimized');
        btnMinChar.textContent = isMinimized ? '+' : '_';
        resizer.classList.toggle('disabled', isMinimized);
        chrome.storage.local.set({ charSectionMinimized: isMinimized });
      });
    }
    
    // Initialize saved state
    chrome.storage.local.get(['charSectionHeight', 'charSectionMinimized'], (data) => {
        if (data.charSectionHeight) {
            charSection.style.height = data.charSectionHeight;
        }
        if (data.charSectionMinimized) {
            charSection.classList.add('minimized');
            if (btnMinChar) btnMinChar.textContent = '+';
            resizer.classList.add('disabled');
        }
    });
  }

  // Global split button close logic
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.split-btn-group')) {
      document.querySelectorAll('.split-dropdown').forEach(d => d.style.display = 'none');
    }
  });

  // Shared generic function for Split Button
  window.setupDrawSplitButton = function(groupEl, inputEl, getEditorFn) {
    if (!groupEl) return;
    const mainBtn = groupEl.querySelector('.split-main');
    const arrowBtn = groupEl.querySelector('.split-arrow');
    const dropdown = groupEl.querySelector('.split-dropdown');
    const items = dropdown.querySelectorAll('.split-dropdown-item');

    chrome.storage.local.get(['drawSplitMode'], (data) => {
      const mode = data.drawSplitMode || 'wildcard';
      updateSplitUI(mode);
    });

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
        chrome.storage.local.set({ drawSplitMode: action });
        
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

  btnAdd.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && btnAiTranslate) {
        btnAiTranslate.click();
      } else {
        // Small timeout to allow autocomplete to process first if it's active
        setTimeout(() => {
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
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const baseKey = el.getAttribute('data-i18n');
      const shortKey = `${baseKey}_short`;
      const isDropdownItem = el.classList.contains('split-dropdown-item');
      const key = (!isDropdownItem && isShortMode && (dict[shortKey] || fallbackDict[shortKey])) ? shortKey : baseKey;
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
      onImageTitle: dict.ac_mode_on_image_title || fallbackDict.ac_mode_on_image_title || 'On Image'
    };
    chrome.storage.local.set({ autoClickerI18n: acI18n });

    // 刷新多选分辨率按钮文字
    if (typeof syncMultiResStorage === 'function') syncMultiResStorage();
    groupTagsController?.handleLanguageChange();
  };

  const setLanguage = (lang) => {
    applyTranslations(lang);
    chrome.storage.local.set({ language: lang });
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
  chrome.storage.local.get('language', (data) => {
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
  });

  // Observe width for responsive short-text mode
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const isNarrow = entry.contentRect.width < 540;
      if (isShortMode !== isNarrow) {
        isShortMode = isNarrow;
        applyTranslations(currentLang);
      }
    }
  });
  resizeObserver.observe(document.body);

  // Settings Persistence
  const settings = [
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'triggerSpace',
    'triggerTab',
    'renderNewlines',
    'hideAutoClicker',
    'tagEditorDensity'
  ];

  // Load Settings
  chrome.storage.local.get(settings, (data) => {
    settings.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        let val = data[key];
        if (val === undefined) {
          // 默认开启的选项
          if (key === 'alternativeDanbooruAutocomplete') {
            val = true;
          } else {
            val = false;
          }
          // 在首次初始化时立刻存储默认值，确保整个应用能够同步
          chrome.storage.local.set({ [key]: val });
        }
        el.checked = !!val;

        // Initial state for editor
        if (key === 'renderNewlines') {
          editor.options.renderNewlines = el.checked;
        }

        el.addEventListener('change', () => {
          chrome.storage.local.set({ [key]: el.checked });
          if (key === 'renderNewlines') {
            editor.options.renderNewlines = el.checked;
            editor.render();
          }
        });
      }
    });

    if (data.tagEditorDensity !== undefined) {
      applyTagEditorDensity(data.tagEditorDensity);
    } else {
      applyTagEditorDensity(50);
    }
  });

  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');

  btnSettings.addEventListener('click', () => {
    modal.style.display = 'flex';
    updateStorageMonitor();
  });
  
  closeSettings.addEventListener('click', () => { modal.style.display = 'none'; });

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
    chrome.storage.local.get('hotkeys', (data) => {
      if (data.hotkeys) {
        // 合并已保存的配置和默认值（确保新增的快捷键有默认值）
        currentHotkeys = { ...DEFAULT_HOTKEYS, ...data.hotkeys };
      }
      // 更新所有按钮的显示
      updateHotkeyBtnDisplay('toggleMinimize');
      updateHotkeyBtnDisplay('triggerGenerate');
      updateHotkeyBtnDisplay('focusBase');
    });

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
      chrome.storage.local.set({ hotkeys: currentHotkeys });
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
    document.addEventListener('keydown', (e) => {
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
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.hotkeys) {
        currentHotkeys = { ...DEFAULT_HOTKEYS, ...(changes.hotkeys.newValue || {}) };
        updateHotkeyBtnDisplay('toggleMinimize');
        updateHotkeyBtnDisplay('triggerGenerate');
        updateHotkeyBtnDisplay('focusBase');
      }
    });

    // 监听来自 bridge.js 的通知（例如宿主页面监听到 focusBase，转发进来执行界面逻辑）
    window.addEventListener('message', (e) => {
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
    editor.setTags(positiveTags);
  } else {
    editor.setTags(negativeTags);
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

  activeTags.forEach((t, i) => {
    const val = t.value;
    const isDynStart = val.startsWith('||') && (val !== '||' || t.isStart);
    const isDynEnd = val === '||' && !t.isStart;
    const isHeader = val.match(/^([-?\d\.]+)::$/);
    const isFooter = val === ' ::';

    if (val === '\n') {
      result += '\n';
    } else {
      if (isDynStart) inDynamic = true;
      
      // Handle native value
      let outputVal = val;
      if (inDynamic && !isDynStart && !isDynEnd && t.dynWeight && t.dynWeight !== 1) {
          // Correct Fix: Always append to the very end of the value string.
          // If val is "2::tag ::", output should be "2::tag :: :5"
          // If val is "tag", output should be "tag:5"
          outputVal = val + `:${t.dynWeight}`;
      }

      result += outputVal;
      if (isDynEnd) inDynamic = false;

      if (i < activeTags.length - 1) {
        const next = activeTags[i + 1];
        const nextVal = next.value;
        const nextIsNL = nextVal === '\n';
        const nextIsFooter = nextVal === ' ::';
        const nextIsDynEnd = nextVal === '||';
        const nextIsDynStart = nextVal.startsWith('||') && nextVal !== '||';

        if (inDynamic) {
          // Inside dynamic: use | between members
          if (!isDynStart && !nextIsDynEnd && !nextIsNL) {
            result += '|';
          }
        } else {
          // Outside dynamic: use ,
          // Optimized: Allow comma before newline, but avoid double commas
          if (!isHeader && !nextIsFooter) {
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
      const isFooter = p === ' ::';
      // Preserve ' ::' exactly, otherwise trim
      result.push({ value: (isNL || isFooter) ? p : p.trim(), disabled: false });
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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (shouldIgnoreRuntimeMessage(msg)) return;
    if (msg.type === 'SEQUENTIAL_COUNTERS_UPDATED') {
      const senderTabId = sender?.tab?.id;
      if (senderTabId) {
        getActiveTab().then((activeTab) => {
          if (activeTab?.id === senderTabId) {
            applySequentialCountersToEditors(msg.counters || {});
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

chrome.runtime.onMessage.addListener((msg) => {
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
window.addEventListener('message', (e) => {
    if (e.data?.type === '__UPDATE_TE_DENSITY__') {
        applyTagEditorDensity(e.data.value);
    }
});

