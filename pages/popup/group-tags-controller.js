export default function createGroupTagsController(deps = {}) {
  const {
    storageRepository,
    lifecycleScope,
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

  if (!storageRepository?.get || !storageRepository?.set) {
    throw new TypeError('[Group Tags] 缺少扩展存储仓库');
  }
  if (!lifecycleScope?.on || !lifecycleScope?.chromeEvent) {
    throw new TypeError('[Group Tags] 缺少生命周期作用域');
  }

  const groupTagsDataUtils = window.GroupTagsDataUtils || {};
  const EMPTY_GROUP_TAGS_DATA = { categories: [] };
  const GROUP_ITEM_TYPE_TAG = 'tag';
  const GROUP_ITEM_TYPE_SENTENCE = 'sentence';

  let currentGroupColorMap = {};
  let currentGroupTranslationMap = {};
  let defaultGroupTagsPromise = null;
  let activeEditorTarget = normalizeActiveTarget(getExternalActiveTarget()) || { type: 'base', mode: 'positive' };
  let storageChangeListener = null;
  let pickerKeydownListener = null;
  let removeStorageChangeListener = () => {};
  let removePickerKeydownListener = () => {};
  let uiBound = false;

  const groupTagsPickerState = {
    resolve: null,
    activeCategoryId: null,
    tagData: null,
    groupTagsData: null,
    itemMode: GROUP_ITEM_TYPE_TAG
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
    const map = {};
    (data?.categories || []).forEach((category) => {
      (category.groups || []).forEach((group) => {
        const color = group.color || '#4a4a6a';
        (group.tags || []).forEach((item) => {
          const promptText = groupTagsDataUtils.getGroupItemPromptText
            ? groupTagsDataUtils.getGroupItemPromptText(item)
            : (item?.en || '');
          const key = normalizeGroupTagKey(promptText);
          if (key) map[key] = color;
        });
      });
    });
    return map;
  }

  function buildGroupTagsTranslationMap(data) {
    if (groupTagsDataUtils.buildTranslationMap) {
      return groupTagsDataUtils.buildTranslationMap(data);
    }
    const map = {};
    (data?.categories || []).forEach((category) => {
      (category.groups || []).forEach((group) => {
        (group.tags || []).forEach((item) => {
          const promptText = groupTagsDataUtils.getGroupItemPromptText
            ? groupTagsDataUtils.getGroupItemPromptText(item)
            : (item?.en || '');
          const translationText = groupTagsDataUtils.getGroupItemTranslationText
            ? groupTagsDataUtils.getGroupItemTranslationText(item)
            : (item?.zh || '');
          const key = normalizeGroupTagKey(promptText);
          if (key && translationText) map[key] = translationText;
        });
      });
    });
    return map;
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
      // 使用值比较（非引用比较）判断映射内容是否真的发生了变化
      // 每次消息传入时 currentGroupColorMap 都是新对象引用，但内容可能完全相同
      // 只有内容确实改变时才执行破坏性 render()，避免工具栏被无意义地销毁
      const oldColor = JSON.stringify(baseEditor.groupColorMap || {});
      const oldTrans = JSON.stringify(baseEditor.groupTranslationMap || {});
      baseEditor.groupColorMap = currentGroupColorMap;
      baseEditor.groupTranslationMap = currentGroupTranslationMap;
      const newColor = JSON.stringify(currentGroupColorMap || {});
      const newTrans = JSON.stringify(currentGroupTranslationMap || {});
      if (shouldRender && (oldColor !== newColor || oldTrans !== newTrans)) baseEditor.render();
    }

    (getCharacterEditors() || []).forEach((charEditorObj) => {
      if (!charEditorObj?.editor) return;
      const oldColor = JSON.stringify(charEditorObj.editor.groupColorMap || {});
      const oldTrans = JSON.stringify(charEditorObj.editor.groupTranslationMap || {});
      charEditorObj.editor.groupColorMap = currentGroupColorMap;
      charEditorObj.editor.groupTranslationMap = currentGroupTranslationMap;
      const newColor = JSON.stringify(currentGroupColorMap || {});
      const newTrans = JSON.stringify(currentGroupTranslationMap || {});
      if (shouldRender && (oldColor !== newColor || oldTrans !== newTrans)) charEditorObj.editor.render();
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
    let storedGroupTagsData = (await storageRepository.get('groupTagsUserData')).groupTagsUserData;
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
        const existingTag = tags.find((tag) => normalizePickerMode(tag?.type) !== GROUP_ITEM_TYPE_SENTENCE && normalizeGroupTagKey(tag.en) === targetKey);
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

  function normalizePickerMode(value) {
    return value === GROUP_ITEM_TYPE_SENTENCE ? GROUP_ITEM_TYPE_SENTENCE : GROUP_ITEM_TYPE_TAG;
  }

  function normalizeGroupTagsPickerData(tagData = {}) {
    const rawEn = String(tagData?.en || '').trim();
    const rawZh = String(tagData?.zh || '').trim();
    const sentenceEnText = String(
      tagData?.sentenceEnText
      || tagData?.sentenceCandidate?.en
      || rawEn
    ).trim();
    const sentenceZhText = String(
      tagData?.sentenceZhText
      || tagData?.sentenceCandidate?.zh
      || rawZh
    ).trim();
    return {
      type: normalizePickerMode(tagData?.type),
      en: rawEn,
      zh: rawZh,
      sentenceEnText,
      sentenceZhText
    };
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
      activeCategoryId: groupTagsPickerState.activeCategoryId,
      itemMode: groupTagsPickerState.itemMode
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
    groupTagsPickerState.itemMode = GROUP_ITEM_TYPE_TAG;

    if (groupTagsPickerState.resolve) {
      const resolve = groupTagsPickerState.resolve;
      groupTagsPickerState.resolve = null;
      resolve(selection);
    }

    notifyPickerStateChanged();
  }

  function updateEarButtons(mode) {
    const btnTagMode = document.getElementById('group-tags-picker-ear-tag');
    const btnSentenceMode = document.getElementById('group-tags-picker-ear-sentence');
    if (mode === GROUP_ITEM_TYPE_TAG) {
      btnTagMode?.classList.add('active');
      btnSentenceMode?.classList.remove('active');
    } else {
      btnSentenceMode?.classList.add('active');
      btnTagMode?.classList.remove('active');
    }
  }

  function initGroupTagsPickerModal() {
    const modal = document.getElementById('group-tags-picker-modal');
    const closeBtn = document.getElementById('group-tags-picker-close');

    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';

    const btnTagMode = document.getElementById('group-tags-picker-ear-tag');
    const btnSentenceMode = document.getElementById('group-tags-picker-ear-sentence');

    const handleEarClick = (mode) => {
      if (groupTagsPickerState.itemMode === mode) return;
      groupTagsPickerState.itemMode = mode;
      updateEarButtons(mode);
      notifyPickerStateChanged();
      rerenderPickerTagContent();
    };

    btnTagMode?.addEventListener('click', () => handleEarClick(GROUP_ITEM_TYPE_TAG));
    btnSentenceMode?.addEventListener('click', () => handleEarClick(GROUP_ITEM_TYPE_SENTENCE));

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
    removePickerKeydownListener = lifecycleScope.on(document, 'keydown', pickerKeydownListener);

    updateGroupTagsPickerStaticText();
  }

  function rerenderPickerTagContent() {
    const tagEl = document.getElementById('group-tags-picker-tag');
    const tagData = groupTagsPickerState.tagData;
    if (!tagEl || !tagData) return;
    tagEl.innerHTML = '';
    tagEl.appendChild(renderPickerTagContent(tagData));
  }

  function renderPickerTagContent(tagData) {
    const displayEn = toDisplayGroupTagText(String(tagData?.en || '').trim());
    const zh = String(tagData?.zh || '').trim();
    const sentenceEnText = String(tagData?.sentenceEnText || '').trim();
    const sentenceZhText = String(tagData?.sentenceZhText || '').trim();
    const container = document.createElement('div');
    container.className = 'group-tags-picker-item';

    const buildCloseButton = () => {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'group-tags-picker-tag-close';
      closeBtn.setAttribute('aria-label', getLocalizedText('group_tags_picker_close'));
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeGroupTagsPicker(null);
      });
      return closeBtn;
    };

    if (groupTagsPickerState.itemMode === GROUP_ITEM_TYPE_SENTENCE) {
      const shell = document.createElement('div');
      shell.className = 'group-tags-picker-sentence-shell';

      const toolbar = document.createElement('div');
      toolbar.className = 'group-tags-picker-sentence-toolbar';
      toolbar.appendChild(buildCloseButton());
      shell.appendChild(toolbar);

      const body = document.createElement('div');
      body.className = 'group-tags-picker-sentence-body';

      const buildTextAreaField = (labelKey, fallback, className, fieldName, value) => {
        const field = document.createElement('label');
        field.className = 'group-tags-picker-sentence-field';

        const label = document.createElement('span');
        label.className = 'group-tags-picker-sentence-label';
        label.textContent = getLocalizedText(labelKey, fallback);
        field.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.className = className;
        textarea.spellcheck = false;
        textarea.value = value;
        textarea.addEventListener('input', () => {
          groupTagsPickerState.tagData[fieldName] = textarea.value;
          notifyPickerStateChanged();
        });
        field.appendChild(textarea);
        return field;
      };

      body.appendChild(buildTextAreaField('group_tags_picker_source_label', 'English', 'group-tags-picker-sentence-source', 'sentenceEnText', sentenceEnText));
      body.appendChild(buildTextAreaField('group_tags_picker_result_label', 'Chinese', 'group-tags-picker-sentence-result', 'sentenceZhText', sentenceZhText));
      shell.appendChild(body);
      container.appendChild(shell);
      return container;
    }

    const tagRow = document.createElement('div');
    tagRow.className = 'group-tags-picker-tag-inner';

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

    const content = document.createElement('div');
    content.className = 'group-tags-picker-tag-main';
    content.appendChild(createEditableText(displayEn || '...', 'group-tags-picker-tag-en', 'en'));

    const divider = document.createElement('span');
    divider.className = 'group-tags-picker-tag-divider';
    content.appendChild(divider);

    content.appendChild(createEditableText(
      zh || getLocalizedText('group_tags_picker_trans_placeholder'),
      'group-tags-picker-tag-zh',
      'zh'
    ));
    tagRow.appendChild(content);
    tagRow.appendChild(buildCloseButton());

    container.appendChild(tagRow);
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
            itemMode: groupTagsPickerState.itemMode,
            editedEn: groupTagsPickerState.tagData?.en,
            editedZh: groupTagsPickerState.tagData?.zh,
            editedSentenceEnText: groupTagsPickerState.tagData?.sentenceEnText,
            editedSentenceZhText: groupTagsPickerState.tagData?.sentenceZhText
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

    groupTagsPickerState.tagData = normalizeGroupTagsPickerData(tagData);
    groupTagsPickerState.groupTagsData = groupTagsData;
    groupTagsPickerState.activeCategoryId = categories[0]?.id || null;
    groupTagsPickerState.itemMode = groupTagsPickerState.tagData.type === GROUP_ITEM_TYPE_SENTENCE ? GROUP_ITEM_TYPE_SENTENCE : GROUP_ITEM_TYPE_TAG;
    updateEarButtons(groupTagsPickerState.itemMode);

    updateGroupTagsPickerStaticText();
    if (tagEl) rerenderPickerTagContent();
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
      await storageRepository.set({
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
    const normalizedInput = normalizeGroupTagsPickerData(tagData);
    const en = String(normalizedInput.en || '').trim();
    const zh = String(normalizedInput.zh || '').trim();
    const canonicalEn = en ? toCanonicalGroupTagKey(en) : '';
    const sentenceEnText = String(normalizedInput.sentenceEnText || '').trim();
    const sentenceZhText = String(normalizedInput.sentenceZhText || '').trim();
    if (!canonicalEn && !(sentenceEnText && sentenceZhText)) return;

    const effectiveData = await loadEffectiveGroupTagsData();
    const selection = await openGroupTagsPicker({
      type: GROUP_ITEM_TYPE_TAG,
      en: canonicalEn ? toDisplayGroupTagText(canonicalEn) : '',
      zh,
      sentenceEnText,
      sentenceZhText
    }, effectiveData);
    if (!selection) return;

    const latestData = await loadEffectiveGroupTagsData();
    const targetCategory = latestData.categories.find((category) => category.id === selection.categoryId);
    const targetGroup = targetCategory?.groups?.find((group) => group.id === selection.groupId);
    if (!targetGroup) {
      showToast('error', getLocalizedText('group_tags_picker_missing'));
      return;
    }

    if (!Array.isArray(targetGroup.tags)) targetGroup.tags = [];

    if (normalizePickerMode(selection.itemMode) === GROUP_ITEM_TYPE_SENTENCE) {
      const finalSentenceEnText = String(selection.editedSentenceEnText || sentenceEnText).trim();
      const finalSentenceZhText = String(selection.editedSentenceZhText || sentenceZhText).trim();
      if (!finalSentenceEnText || !finalSentenceZhText) return;

      targetGroup.tags.push({
        type: GROUP_ITEM_TYPE_SENTENCE,
        en: finalSentenceEnText,
        zh: finalSentenceZhText
      });
      await persistGroupTagsData(latestData);

      const locationName = `${targetCategory.name} > ${targetGroup.name}`;
      const displaySentence = finalSentenceEnText.length > 28 ? `${finalSentenceEnText.slice(0, 28)}...` : finalSentenceEnText;
      showToast('success', `${getLocalizedText('group_tags_picker_added_prefix')}: ${displaySentence} -> ${locationName}`);
      return;
    }

    const finalEn = toCanonicalGroupTagKey(String(selection.editedEn || en).trim());
    const finalZh = String(selection.editedZh || zh).trim();
    if (!finalEn) return;

    const latestExistingLocation = findExistingGroupTagLocation(latestData, finalEn);
    if (latestExistingLocation) {
      showToast('warning', `${getLocalizedText('group_tags_picker_duplicate')}: ${formatGroupTagLocation(latestExistingLocation)}`);
      return;
    }

    const dictResult = await upsertDictionaryEntry(finalEn, { zhCN: finalZh });
    const finalEntry = dictResult.entry || (await loadEffectiveDictionaryData()).entryMap.get(finalEn) || null;

    targetGroup.tags.push({
      type: GROUP_ITEM_TYPE_TAG,
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
      storageRepository.set({ groupColorMap: msg.colorMap })
        .catch(error => console.error('[Group Tags] 保存颜色映射失败:', error));
      currentGroupColorMap = msg.colorMap || {};
      applyEditorMapsToTargets(true);
      return true;
    }

    if (msg.type === 'SYNC_GROUP_TRANSLATIONS' && msg.translationMap) {
      storageRepository.set({ groupTranslationMap: msg.translationMap })
        .catch(error => console.error('[Group Tags] 保存翻译映射失败:', error));
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
      rerenderPickerTagContent();
    }
    if (tagData && groupTagsData) {
      renderGroupTagsPickerList(tagData, groupTagsData);
    }
  }

  async function init() {
    const data = await storageRepository.get(['groupColorMap', 'groupTranslationMap']);
    currentGroupColorMap = data.groupColorMap || {};
    currentGroupTranslationMap = data.groupTranslationMap || {};
    // 初始化完成后立即刷新所有编辑器，保证 popup 打开时就拿到正确映射。
    applyEditorMapsToTargets(true);

    if (!storageChangeListener) {
      storageChangeListener = (changes, area) => handleStorageChange(changes, area);
      removeStorageChangeListener = lifecycleScope.chromeEvent(chrome.storage.onChanged, storageChangeListener);
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
      removeStorageChangeListener();
      storageChangeListener = null;
    }
    if (pickerKeydownListener) {
      removePickerKeydownListener();
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
