export default function createGroupTagsController(deps = {}) {
  const {
    getLocalizedText = (_key, fallback = '') => fallback,
    showToast = () => {},
    getActiveTab = async () => null,
    getBaseEditor = () => null,
    getCharacterEditors = () => [],
    addTagToTarget = () => {},
    removeTagFromTarget = () => {},
    setActiveTarget: notifyActiveTargetChanged = () => {},
    getActiveTarget: getExternalActiveTarget = () => null,
    onMapsChanged = () => {},
    onPickerStateChanged = () => {},
    loadPopupDict = () => ({})
  } = deps;

  const groupTagsDataUtils = window.GroupTagsDataUtils || {};
  const EMPTY_GROUP_TAGS_DATA = { categories: [] };

  let currentGroupColorMap = {};
  let currentGroupTranslationMap = {};
  let defaultGroupTagsPromise = null;
  let activeEditorTarget = normalizeActiveTarget(getExternalActiveTarget()) || { type: 'base', mode: 'positive' };
  let storageChangeListener = null;
  let pickerKeydownListener = null;
  let uiBound = false;

  const groupTagsPickerState = {
    resolve: null,
    activeCategoryId: null,
    tagData: null,
    groupTagsData: null
  };

  function cloneDeep(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeActiveTarget(target = null) {
    if (!target || typeof target !== 'object') {
      return null;
    }

    if (target.type === 'character') {
      const charIndex = Number(target.charIndex);
      if (!Number.isInteger(charIndex) || charIndex < 0) return null;
      return {
        type: 'character',
        charIndex,
        mode: target.mode === 'negative' ? 'negative' : 'positive'
      };
    }

    return {
      type: 'base',
      mode: target.mode === 'negative' ? 'negative' : 'positive'
    };
  }

  function getAddToGroupTagsText() {
    const dict = loadPopupDict() || {};
    return dict.btn_add_to_group_tags || `${dict.btn_add || 'Add'} ${dict.btn_group_tags || 'Group Tags'}`.trim();
  }

  function cloneGroupTagsData(data) {
    if (groupTagsDataUtils.cloneData) {
      return groupTagsDataUtils.cloneData(data || EMPTY_GROUP_TAGS_DATA);
    }
    return cloneDeep(data || EMPTY_GROUP_TAGS_DATA);
  }

  function buildGroupTagsColorMap(data) {
    if (groupTagsDataUtils.buildColorMap) {
      return groupTagsDataUtils.buildColorMap(data);
    }
    return {};
  }

  function buildGroupTagsTranslationMap(data) {
    if (groupTagsDataUtils.buildTranslationMap) {
      return groupTagsDataUtils.buildTranslationMap(data);
    }
    return {};
  }

  function normalizeGroupTagKey(value) {
    if (groupTagsDataUtils.normalizeTagKey) {
      return groupTagsDataUtils.normalizeTagKey(value);
    }
    return String(value || '').trim().toLowerCase();
  }

  function toCanonicalGroupTagKey(value) {
    if (groupTagsDataUtils.toCanonicalTagKey) {
      return groupTagsDataUtils.toCanonicalTagKey(value);
    }
    return normalizeGroupTagKey(value);
  }

  function toDisplayGroupTagText(value) {
    if (groupTagsDataUtils.canonicalToDisplayTag) {
      return groupTagsDataUtils.canonicalToDisplayTag(value);
    }
    return String(value || '').trim().replace(/_/g, ' ');
  }

  async function loadEffectiveDictionaryData() {
    if (groupTagsDataUtils.loadEffectiveDictionaryData) {
      return groupTagsDataUtils.loadEffectiveDictionaryData();
    }
    return { entryMap: new Map() };
  }

  async function upsertDictionaryEntry(tagKey, patch = {}) {
    if (groupTagsDataUtils.upsertDictionaryEntry) {
      return groupTagsDataUtils.upsertDictionaryEntry(tagKey, patch);
    }
    return {
      tagKey: toCanonicalGroupTagKey(tagKey),
      entry: null
    };
  }

  function applyEditorMapsToTargets(shouldRender = true) {
    const baseEditor = getBaseEditor();
    if (baseEditor) {
      baseEditor.groupColorMap = currentGroupColorMap;
      baseEditor.groupTranslationMap = currentGroupTranslationMap;
      if (shouldRender) baseEditor.render();
    }

    (getCharacterEditors() || []).forEach((charEditorObj) => {
      if (!charEditorObj?.editor) return;
      charEditorObj.editor.groupColorMap = currentGroupColorMap;
      charEditorObj.editor.groupTranslationMap = currentGroupTranslationMap;
      if (shouldRender) charEditorObj.editor.render();
    });

    onMapsChanged({
      colorMap: currentGroupColorMap,
      translationMap: currentGroupTranslationMap
    });
  }

  async function loadDefaultGroupTagsData() {
    if (!defaultGroupTagsPromise) {
      // 默认库只加载一次，避免重复 fetch。
      defaultGroupTagsPromise = fetch(chrome.runtime.getURL('data/default_group_tags.json'))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load default Group Tags: ${response.status}`);
          }
          return response.json();
        })
        .catch((error) => {
          console.error('[Popup] Failed to load default Group Tags:', error);
          return cloneGroupTagsData(EMPTY_GROUP_TAGS_DATA);
        });
    }

    return cloneGroupTagsData(await defaultGroupTagsPromise);
  }

  async function loadEffectiveGroupTagsData() {
    let storedGroupTagsData = (await chrome.storage.local.get('groupTagsUserData')).groupTagsUserData;
    if (storedGroupTagsData?.categories && groupTagsDataUtils.migrateStoredGroupTagsData) {
      const migrated = await groupTagsDataUtils.migrateStoredGroupTagsData();
      storedGroupTagsData = migrated.data || storedGroupTagsData;
    }

    const defaultData = await loadDefaultGroupTagsData();
    if (groupTagsDataUtils.resolveEffectiveGroupTagsData) {
      return groupTagsDataUtils.resolveEffectiveGroupTagsData(defaultData, storedGroupTagsData);
    }
    return storedGroupTagsData?.categories ? cloneGroupTagsData(storedGroupTagsData) : cloneGroupTagsData(defaultData);
  }

  function findExistingGroupTagLocation(groupTagsData, tagText) {
    const targetKey = normalizeGroupTagKey(tagText);
    if (!targetKey || !Array.isArray(groupTagsData?.categories)) return null;

    for (const category of groupTagsData.categories) {
      const groups = Array.isArray(category.groups) ? category.groups : [];
      for (const group of groups) {
        const tags = Array.isArray(group.tags) ? group.tags : [];
        const existingTag = tags.find((tag) => normalizeGroupTagKey(tag.en) === targetKey);
        if (existingTag) {
          return {
            categoryId: category.id,
            categoryName: category.name,
            groupId: group.id,
            groupName: group.name
          };
        }
      }
    }

    return null;
  }

  function formatGroupTagLocation(location) {
    if (!location) return '';
    return `${location.categoryName} > ${location.groupName}`;
  }

  function updateGroupTagsPickerStaticText() {
    const titleEl = document.getElementById('group-tags-picker-title');
    const closeBtn = document.getElementById('group-tags-picker-close');
    if (titleEl) titleEl.textContent = getLocalizedText('group_tags_picker_title', getAddToGroupTagsText());
    if (closeBtn) closeBtn.setAttribute('aria-label', getLocalizedText('group_tags_picker_close'));
  }

  function notifyPickerStateChanged() {
    onPickerStateChanged({
      visible: !!groupTagsPickerState.resolve,
      tagData: groupTagsPickerState.tagData,
      groupTagsData: groupTagsPickerState.groupTagsData,
      activeCategoryId: groupTagsPickerState.activeCategoryId
    });
  }

  function closeGroupTagsPicker(selection = null) {
    const modal = document.getElementById('group-tags-picker-modal');
    if (modal) {
      modal.classList.remove('visible');
    }

    groupTagsPickerState.tagData = null;
    groupTagsPickerState.groupTagsData = null;
    groupTagsPickerState.activeCategoryId = null;

    if (groupTagsPickerState.resolve) {
      const resolve = groupTagsPickerState.resolve;
      groupTagsPickerState.resolve = null;
      resolve(selection);
    }

    notifyPickerStateChanged();
  }

  function initGroupTagsPickerModal() {
    const modal = document.getElementById('group-tags-picker-modal');
    const closeBtn = document.getElementById('group-tags-picker-close');

    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';

    closeBtn?.addEventListener('click', () => closeGroupTagsPicker(null));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeGroupTagsPicker(null);
      }
    });

    pickerKeydownListener = (event) => {
      if (event.key === 'Escape' && modal.classList.contains('visible')) {
        closeGroupTagsPicker(null);
      }
    };
    document.addEventListener('keydown', pickerKeydownListener);

    updateGroupTagsPickerStaticText();
  }

  function renderPickerTagContent(tagData) {
    const en = toDisplayGroupTagText(String(tagData?.en || '').trim());
    const zh = String(tagData?.zh || '').trim();

    const container = document.createElement('div');
    container.className = 'group-tags-picker-tag-inner';

    const createEditableText = (initialText, className, fieldName) => {
      const textEl = document.createElement('span');
      textEl.className = className;
      textEl.textContent = initialText;

      textEl.addEventListener('click', (event) => {
        event.stopPropagation();
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = `${className} editing`;
        inputEl.value = groupTagsPickerState.tagData[fieldName] || '';

        const finishEditing = () => {
          const newValue = inputEl.value.trim();
          groupTagsPickerState.tagData[fieldName] = newValue;

          let displayValue = fieldName === 'en' ? toDisplayGroupTagText(newValue) : newValue;
          if (!displayValue) {
            displayValue = fieldName === 'en' ? '...' : getLocalizedText('group_tags_picker_trans_placeholder');
          }
          textEl.textContent = displayValue;

          if (inputEl.parentNode) {
            inputEl.parentNode.replaceChild(textEl, inputEl);
          }

          notifyPickerStateChanged();
        };

        inputEl.addEventListener('blur', finishEditing);
        inputEl.addEventListener('keydown', (keyEvent) => {
          if (keyEvent.key === 'Enter') {
            keyEvent.preventDefault();
            inputEl.blur();
          } else if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            inputEl.value = groupTagsPickerState.tagData[fieldName] || '';
            inputEl.blur();
          }
        });

        textEl.parentNode.replaceChild(inputEl, textEl);
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      });

      return textEl;
    };

    const enSpan = createEditableText(en || '...', 'group-tags-picker-tag-en', 'en');
    container.appendChild(enSpan);

    const divider = document.createElement('span');
    divider.className = 'group-tags-picker-tag-divider';
    container.appendChild(divider);

    const zhSpan = createEditableText(
      zh || getLocalizedText('group_tags_picker_trans_placeholder'),
      'group-tags-picker-tag-zh',
      'zh'
    );
    container.appendChild(zhSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'group-tags-picker-tag-close';
    closeBtn.setAttribute('aria-label', getLocalizedText('group_tags_picker_close'));
    closeBtn.textContent = '×';
    closeBtn.innerHTML = '×';
    closeBtn.textContent = '×';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeGroupTagsPicker(null);
    });
    container.appendChild(closeBtn);

    return container;
  }

  function setPickerCategory(categoryId) {
    groupTagsPickerState.activeCategoryId = categoryId;
    notifyPickerStateChanged();
  }

  function renderGroupTagsPickerList(tagData, groupTagsData) {
    const listEl = document.getElementById('group-tags-picker-list');
    const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];
    const hasGroups = categories.some((category) => Array.isArray(category.groups) && category.groups.length > 0);

    if (!listEl) return;
    listEl.innerHTML = '';

    if (!hasGroups) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'group-tags-picker-empty';
      emptyEl.textContent = getLocalizedText('group_tags_picker_empty');
      listEl.appendChild(emptyEl);
      return;
    }

    const primaryTabsEl = document.createElement('div');
    primaryTabsEl.className = 'group-tags-picker-primary-tabs';

    categories.forEach((category) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `group-tags-picker-tab-btn ${groupTagsPickerState.activeCategoryId === category.id ? 'active' : ''}`;
      btn.textContent = category.name || category.id || getLocalizedText('group_tags_picker_category');
      btn.addEventListener('click', () => {
        setPickerCategory(category.id);
        renderGroupTagsPickerList(tagData, groupTagsData);
      });
      primaryTabsEl.appendChild(btn);
    });

    const secondaryTabsEl = document.createElement('div');
    secondaryTabsEl.className = 'group-tags-picker-secondary-tabs';

    const activeCategory = categories.find((category) => category.id === groupTagsPickerState.activeCategoryId) || categories[0];
    if (activeCategory) {
      groupTagsPickerState.activeCategoryId = activeCategory.id;
      const groups = Array.isArray(activeCategory.groups) ? activeCategory.groups : [];

      groups.forEach((group) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'group-tags-picker-group-btn';
        button.textContent = group.name || group.id || getLocalizedText('group_tags_picker_group');
        button.addEventListener('click', () => {
          closeGroupTagsPicker({
            categoryId: activeCategory.id,
            groupId: group.id,
            editedEn: groupTagsPickerState.tagData?.en,
            editedZh: groupTagsPickerState.tagData?.zh
          });
        });
        secondaryTabsEl.appendChild(button);
      });
    }

    listEl.appendChild(primaryTabsEl);
    listEl.appendChild(secondaryTabsEl);
    notifyPickerStateChanged();
  }

  function openGroupTagsPicker(tagData, groupTagsData) {
    initGroupTagsPickerModal();
    if (groupTagsPickerState.resolve) {
      closeGroupTagsPicker(null);
    }

    const modal = document.getElementById('group-tags-picker-modal');
    const tagEl = document.getElementById('group-tags-picker-tag');
    const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];

    groupTagsPickerState.tagData = tagData;
    groupTagsPickerState.groupTagsData = groupTagsData;
    groupTagsPickerState.activeCategoryId = categories[0]?.id || null;

    updateGroupTagsPickerStaticText();
    if (tagEl) {
      tagEl.innerHTML = '';
      tagEl.appendChild(renderPickerTagContent(tagData));
    }
    renderGroupTagsPickerList(tagData, groupTagsData);

    modal?.classList.add('visible');
    notifyPickerStateChanged();
    return new Promise((resolve) => {
      groupTagsPickerState.resolve = resolve;
    });
  }

  async function persistGroupTagsData(groupTagsData) {
    let nextGroupTagsData = groupTagsData;
    if (groupTagsDataUtils.saveGroupTagsStorage) {
      nextGroupTagsData = await groupTagsDataUtils.saveGroupTagsStorage(groupTagsData);
    } else {
      const colorMap = buildGroupTagsColorMap(groupTagsData);
      const translationMap = buildGroupTagsTranslationMap(groupTagsData);
      await chrome.storage.local.set({
        groupTagsUserData: groupTagsData,
        groupColorMap: colorMap,
        groupTranslationMap: translationMap
      });
    }

    currentGroupColorMap = buildGroupTagsColorMap(nextGroupTagsData);
    currentGroupTranslationMap = buildGroupTagsTranslationMap(nextGroupTagsData);
    applyEditorMapsToTargets(true);
  }

  async function addTagToGroupTags(tagData) {
    const en = String(tagData?.en || '').trim();
    const zh = String(tagData?.zh || '').trim();
    if (!en) return;

    const canonicalEn = toCanonicalGroupTagKey(en);
    if (!canonicalEn) return;

    const effectiveData = await loadEffectiveGroupTagsData();
    const existingLocation = findExistingGroupTagLocation(effectiveData, canonicalEn);
    if (existingLocation) {
      showToast('warning', `${getLocalizedText('group_tags_picker_duplicate')}: ${formatGroupTagLocation(existingLocation)}`);
      return;
    }

    const selection = await openGroupTagsPicker({ en: toDisplayGroupTagText(canonicalEn), zh }, effectiveData);
    if (!selection) return;

    const latestData = await loadEffectiveGroupTagsData();
    const finalEn = toCanonicalGroupTagKey(String(selection.editedEn || en).trim());
    const finalZh = String(selection.editedZh || zh).trim();
    if (!finalEn) return;

    const latestExistingLocation = findExistingGroupTagLocation(latestData, finalEn);
    if (latestExistingLocation) {
      showToast('warning', `${getLocalizedText('group_tags_picker_duplicate')}: ${formatGroupTagLocation(latestExistingLocation)}`);
      return;
    }

    const targetCategory = latestData.categories.find((category) => category.id === selection.categoryId);
    const targetGroup = targetCategory?.groups?.find((group) => group.id === selection.groupId);
    if (!targetGroup) {
      showToast('error', getLocalizedText('group_tags_picker_missing'));
      return;
    }

    const dictResult = await upsertDictionaryEntry(finalEn, { zhCN: finalZh });
    const finalEntry = dictResult.entry || (await loadEffectiveDictionaryData()).entryMap.get(finalEn) || null;

    targetGroup.tags.push({
      en: finalEn,
      zh: finalEntry ? (finalEntry.zhCN || '') : finalZh
    });
    await persistGroupTagsData(latestData);

    const locationName = `${targetCategory.name} > ${targetGroup.name}`;
    const displayTag = toDisplayGroupTagText(finalEn);
    showToast('success', `${getLocalizedText('group_tags_picker_added_prefix')}: ${displayTag} -> ${locationName}`);
  }

  async function handleTogglePanel() {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_GROUP_TAGS_PANEL' });
  }

  function handleStorageChange(changes, area) {
    if (area !== 'local') return;
    if (!changes.groupColorMap && !changes.groupTranslationMap) return;

    currentGroupColorMap = changes.groupColorMap ? (changes.groupColorMap.newValue || {}) : currentGroupColorMap;
    currentGroupTranslationMap = changes.groupTranslationMap ? (changes.groupTranslationMap.newValue || {}) : currentGroupTranslationMap;
    applyEditorMapsToTargets(true);
  }

  function handleRuntimeMessage(msg) {
    if (msg.type === 'APPEND_TAG_FROM_PANEL' && msg.tag) {
      addTagToTarget(activeEditorTarget, msg.tag);
      return true;
    }

    if (msg.type === 'REMOVE_TAG_FROM_PANEL' && msg.tag) {
      removeTagFromTarget(activeEditorTarget, msg.tag);
      return true;
    }

    if (msg.type === 'SYNC_GROUP_COLORS' && msg.colorMap) {
      chrome.storage.local.set({ groupColorMap: msg.colorMap });
      currentGroupColorMap = msg.colorMap || {};
      applyEditorMapsToTargets(true);
      return true;
    }

    if (msg.type === 'SYNC_GROUP_TRANSLATIONS' && msg.translationMap) {
      chrome.storage.local.set({ groupTranslationMap: msg.translationMap });
      currentGroupTranslationMap = msg.translationMap || {};
      applyEditorMapsToTargets(true);
      return true;
    }

    return false;
  }

  function setActiveTarget(target) {
    const normalizedTarget = normalizeActiveTarget(target);
    if (!normalizedTarget) return activeEditorTarget;
    activeEditorTarget = normalizedTarget;
    notifyActiveTargetChanged(activeEditorTarget);
    return activeEditorTarget;
  }

  function getActiveTarget() {
    return activeEditorTarget;
  }

  function applyEditorMaps() {
    applyEditorMapsToTargets(true);
  }

  function handleLanguageChange() {
    updateGroupTagsPickerStaticText();
    const modal = document.getElementById('group-tags-picker-modal');
    if (!modal?.classList.contains('visible')) return;

    const { tagData, groupTagsData } = groupTagsPickerState;
    if (tagData) {
      const tagEl = document.getElementById('group-tags-picker-tag');
      if (tagEl) {
        tagEl.innerHTML = '';
        tagEl.appendChild(renderPickerTagContent(tagData));
      }
    }
    if (tagData && groupTagsData) {
      renderGroupTagsPickerList(tagData, groupTagsData);
    }
  }

  async function init() {
    const data = await chrome.storage.local.get(['groupColorMap', 'groupTranslationMap']);
    currentGroupColorMap = data.groupColorMap || {};
    currentGroupTranslationMap = data.groupTranslationMap || {};
    // 初始化完成后立即刷新所有编辑器，保证 popup 打开时就拿到正确映射。
    applyEditorMapsToTargets(true);

    if (!storageChangeListener) {
      storageChangeListener = (changes, area) => handleStorageChange(changes, area);
      chrome.storage.onChanged.addListener(storageChangeListener);
    }
  }

  function bindUI() {
    if (uiBound) return;
    uiBound = true;

    initGroupTagsPickerModal();

    const btnGroupTags = document.getElementById('btn-group-tags');
    if (btnGroupTags) {
      btnGroupTags.addEventListener('click', () => {
        handleTogglePanel();
      });
    }
  }

  function destroy() {
    if (storageChangeListener) {
      chrome.storage.onChanged.removeListener(storageChangeListener);
      storageChangeListener = null;
    }
    if (pickerKeydownListener) {
      document.removeEventListener('keydown', pickerKeydownListener);
      pickerKeydownListener = null;
    }
    closeGroupTagsPicker(null);
  }

  return {
    init,
    destroy,
    bindUI,
    handleRuntimeMessage,
    setActiveTarget,
    applyEditorMaps,
    handleLanguageChange,
    addTagToGroupTags,
    getActiveTarget
  };
}
