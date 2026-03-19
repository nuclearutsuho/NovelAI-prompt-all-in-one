export default function createHistoryController(deps = {}) {
  const {
    getBaseState = () => ({}),
    setBaseState = () => {},
    getCharacterState = () => ({}),
    setCharacterState = () => {},
    getCurrentMode = () => 'positive',
    getEditor = () => null,
    getActiveEditorTarget = () => ({ type: 'base', mode: 'positive' }),
    rebuildCharacterUI = () => {},
    parsePromptToTags = () => [],
    tagsToString = () => '',
    normalizePrompt = (value) => String(value || ''),
    serializeTagList = (tags) => Array.isArray(tags) ? tags : [],
    syncAll = async () => {}
  } = deps;

  let historyScopeId = '';
  let lastRecordedFingerprint = null;
  let popupDebounceTimer = null;
  let webpageDebounceTimer = null;

  const POPUP_DEBOUNCE_MS = 1500;
  const WEBPAGE_DEBOUNCE_MS = 2000;

  function cloneDeep(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clearDebounceTimers() {
    window.clearTimeout(popupDebounceTimer);
    window.clearTimeout(webpageDebounceTimer);
    popupDebounceTimer = null;
    webpageDebounceTimer = null;
  }

  function hasMeaningfulCharacterHistoryContent(character) {
    if (!character) return false;
    const posPrompt = normalizePrompt(character.posPrompt || tagsToString(character.posTags || []));
    const negPrompt = normalizePrompt(character.negPrompt || tagsToString(character.negTags || []));
    return !!posPrompt || !!negPrompt;
  }

  function getMeaningfulCharacterHistoryData(characters) {
    return (characters || []).filter((character) => hasMeaningfulCharacterHistoryContent(character));
  }

  function computeStateFingerprint(posTags, negTags, characters) {
    const posFingerprint = JSON.stringify(
      serializeTagList(posTags || []).map((tag) => [
        tag.value,
        !!tag.disabled,
        !!tag.isStart,
        tag.dynWeight || 1,
        tag.aiOriginal || '',
        tag.aiZhTranslation || ''
      ])
    );
    const negFingerprint = JSON.stringify(
      serializeTagList(negTags || []).map((tag) => [
        tag.value,
        !!tag.disabled,
        !!tag.isStart,
        tag.dynWeight || 1,
        tag.aiOriginal || '',
        tag.aiZhTranslation || ''
      ])
    );
    const charactersFingerprint = JSON.stringify(
      getMeaningfulCharacterHistoryData(characters).map((character) => ({
        p: character.posPrompt || '',
        n: character.negPrompt || '',
        pd: serializeTagList(character.posTags || []).map((tag) => [
          tag.value,
          !!tag.disabled,
          !!tag.isStart,
          tag.dynWeight || 1,
          tag.aiOriginal || '',
          tag.aiZhTranslation || ''
        ]),
        nd: serializeTagList(character.negTags || []).map((tag) => [
          tag.value,
          !!tag.disabled,
          !!tag.isStart,
          tag.dynWeight || 1,
          tag.aiOriginal || '',
          tag.aiZhTranslation || ''
        ])
      }))
    );
    return posFingerprint + negFingerprint + charactersFingerprint;
  }

  function findLatestHistorySnapshotForScope(history) {
    const ordinaryHistory = (history || []).filter((item) => item && !item.isFavorite && !item.isFolder);
    if (!ordinaryHistory.length) return null;

    if (historyScopeId) {
      const scopedSnapshot = ordinaryHistory.find((item) => item.historyScopeId === historyScopeId);
      if (scopedSnapshot) return scopedSnapshot;
    }

    return ordinaryHistory[0];
  }

  function buildHistoryStateSignature({ positive = '', negative = '', characters = [] }) {
    const charSignature = getMeaningfulCharacterHistoryData(characters).map((character) => ([
      normalizePrompt(character.posPrompt || tagsToString(character.posTags || [])),
      normalizePrompt(character.negPrompt || tagsToString(character.negTags || []))
    ]));

    return JSON.stringify({
      p: normalizePrompt(positive || ''),
      n: normalizePrompt(negative || ''),
      c: charSignature
    });
  }

  function findComparableHistorySnapshot(history, currentState) {
    const ordinaryHistory = (history || []).filter((item) => item && !item.isFavorite && !item.isFolder);
    if (!ordinaryHistory.length) return null;

    if (historyScopeId) {
      const scopedSnapshot = ordinaryHistory.find((item) => item.historyScopeId === historyScopeId);
      if (scopedSnapshot) return scopedSnapshot;
    }

    const currentSignature = buildHistoryStateSignature(currentState);
    return ordinaryHistory.find((item) => buildHistoryStateSignature({
      positive: item.positive || tagsToString(item.positiveTags || []),
      negative: item.negative || tagsToString(item.negativeTags || []),
      characters: item.characters || []
    }) === currentSignature) || ordinaryHistory[0];
  }

  function cloneSnapshotTags(tags, promptText = '') {
    if (Array.isArray(tags) && tags.length) {
      return cloneDeep(tags);
    }
    return parsePromptToTags(promptText || '');
  }

  function cloneCharacterSnapshot(character = {}) {
    return {
      posPrompt: character.posPrompt || tagsToString(character.posTags || []),
      posTags: cloneSnapshotTags(character.posTags, character.posPrompt || ''),
      negPrompt: character.negPrompt || tagsToString(character.negTags || []),
      negTags: cloneSnapshotTags(character.negTags, character.negPrompt || ''),
      gender: character.gender || 'other',
      activeTab: character.activeTab || 'positive'
    };
  }

  function setScopeId(nextScopeId = '') {
    historyScopeId = String(nextScopeId || '');
  }

  function primeFromStoredHistory(history = [], { restoreBase = true, restoreCharacters = true } = {}) {
    const snapshot = findLatestHistorySnapshotForScope(history) || history[0] || null;
    if (!snapshot) return null;

    lastRecordedFingerprint = computeStateFingerprint(
      snapshot.positiveTags || [],
      snapshot.negativeTags || [],
      snapshot.characters || []
    );

    if (restoreBase) {
      const rawPositive = snapshot.positive || '';
      const rawNegative = snapshot.negative || '';
      setBaseState({
        rawPositive,
        rawNegative,
        positiveTags: cloneSnapshotTags(snapshot.positiveTags, rawPositive),
        negativeTags: cloneSnapshotTags(snapshot.negativeTags, rawNegative)
      });
    }

    if (restoreCharacters && Array.isArray(snapshot.characters) && snapshot.characters.length > 0) {
      setCharacterState({
        characterPromptsData: snapshot.characters.map((character) => cloneCharacterSnapshot(character))
      });
    }

    return snapshot;
  }

  async function commitSnapshot() {
    popupDebounceTimer = null;
    webpageDebounceTimer = null;

    const data = await chrome.storage.local.get(['promptHistory', 'historyLimit']);
    let history = data.promptHistory || [];

    const baseState = getBaseState() || {};
    const { characterPromptsData = [] } = getCharacterState() || {};
    const positiveTags = baseState.positiveTags || [];
    const negativeTags = baseState.negativeTags || [];

    const posStr = tagsToString(positiveTags);
    const negStr = tagsToString(negativeTags);
    const meaningfulCharacters = getMeaningfulCharacterHistoryData(characterPromptsData);
    const hasMeaningfulState = positiveTags.length > 0 || negativeTags.length > 0 || meaningfulCharacters.length > 0;
    const comparableSnapshot = findComparableHistorySnapshot(history, {
      positive: posStr,
      negative: negStr,
      characters: characterPromptsData
    });

    const fingerprint = computeStateFingerprint(positiveTags, negativeTags, characterPromptsData);
    if (!hasMeaningfulState) {
      lastRecordedFingerprint = fingerprint;
      return;
    }

    if (comparableSnapshot) {
      const comparableFingerprint = computeStateFingerprint(
        comparableSnapshot.positiveTags || [],
        comparableSnapshot.negativeTags || [],
        comparableSnapshot.characters || []
      );
      if (fingerprint === comparableFingerprint) {
        lastRecordedFingerprint = comparableFingerprint;
        return;
      }
    }

    if (fingerprint === lastRecordedFingerprint) return;
    lastRecordedFingerprint = fingerprint;

    const snapshot = {
      id: Date.now(),
      timestamp: Date.now(),
      isFavorite: false,
      name: '',
      positive: posStr,
      negative: negStr,
      positiveTags: serializeTagList(positiveTags),
      negativeTags: serializeTagList(negativeTags),
      ...(historyScopeId ? { historyScopeId } : {}),
      characters: meaningfulCharacters.map((character) => ({
        posPrompt: character.posPrompt || '',
        negPrompt: character.negPrompt || '',
        posTags: serializeTagList(character.posTags || []),
        negTags: serializeTagList(character.negTags || []),
        gender: character.gender || 'other',
        activeTab: character.activeTab || 'positive'
      }))
    };
    const limit = data.historyLimit || 100;

    history.unshift(snapshot);

    const favorites = history.filter((item) => item.isFavorite);
    let ordinaryHistory = history.filter((item) => !item.isFavorite);
    if (ordinaryHistory.length > limit) {
      ordinaryHistory = ordinaryHistory.slice(0, limit);
    }
    history = [...ordinaryHistory, ...favorites].sort((a, b) => b.timestamp - a.timestamp);

    await chrome.storage.local.set({ promptHistory: history });
  }

  function recordHistory(source = 'popup') {
    if (source === 'immediate' || source === 'restore') {
      clearDebounceTimers();
      return commitSnapshot();
    }

    if (source === 'popup') {
      window.clearTimeout(webpageDebounceTimer);
      window.clearTimeout(popupDebounceTimer);
      popupDebounceTimer = window.setTimeout(() => {
        commitSnapshot();
      }, POPUP_DEBOUNCE_MS);
      return Promise.resolve();
    }

    if (popupDebounceTimer) return Promise.resolve();
    window.clearTimeout(webpageDebounceTimer);
    webpageDebounceTimer = window.setTimeout(() => {
      commitSnapshot();
    }, WEBPAGE_DEBOUNCE_MS);
    return Promise.resolve();
  }

  function renderCurrentBaseEditor() {
    const currentMode = getCurrentMode();
    const editor = getEditor();
    const baseState = getBaseState() || {};
    if (!editor) return;
    if (currentMode === 'positive') {
      editor.setTags(baseState.positiveTags || []);
    } else {
      editor.setTags(baseState.negativeTags || []);
    }
  }

  async function restoreFromSnapshot(snapshot) {
    if (!snapshot) return;

    if (snapshot.isPartial && snapshot.partialType) {
      const partialType = snapshot.partialType;
      const baseState = getBaseState() || {};
      const characterState = getCharacterState() || {};
      const nextBaseState = {};

      if (partialType === 'positive') {
        const rawPositive = snapshot.positive || '';
        nextBaseState.rawPositive = rawPositive;
        nextBaseState.positiveTags = cloneSnapshotTags(snapshot.positiveTags, rawPositive);
        setBaseState(nextBaseState);
        if (getCurrentMode() === 'positive') {
          renderCurrentBaseEditor();
        }
      } else if (partialType === 'negative') {
        const rawNegative = snapshot.negative || '';
        nextBaseState.rawNegative = rawNegative;
        nextBaseState.negativeTags = cloneSnapshotTags(snapshot.negativeTags, rawNegative);
        setBaseState(nextBaseState);
        if (getCurrentMode() === 'negative') {
          renderCurrentBaseEditor();
        }
      } else if (partialType === 'character' || partialType.startsWith('character-')) {
        const sourceCharacter = (snapshot.characters || [])[0];
        if (sourceCharacter) {
          const nextCharacters = [...(characterState.characterPromptsData || []), cloneCharacterSnapshot(sourceCharacter)];
          setCharacterState({ characterPromptsData: nextCharacters });
          rebuildCharacterUI();
        }
      }

      await syncAll('restore');
      return;
    }

    const rawPositive = snapshot.positive || '';
    const rawNegative = snapshot.negative || '';
    setBaseState({
      rawPositive,
      rawNegative,
      positiveTags: cloneSnapshotTags(snapshot.positiveTags, rawPositive),
      negativeTags: cloneSnapshotTags(snapshot.negativeTags, rawNegative)
    });

    setCharacterState({
      characterPromptsData: (snapshot.characters || []).map((character) => cloneCharacterSnapshot(character))
    });

    renderCurrentBaseEditor();
    rebuildCharacterUI();

    await syncAll('restore');
  }

  async function appendHistorySnippet(snapshot, target) {
    if (!snapshot || (target !== 'positive' && target !== 'negative')) return;

    const sourceTags = target === 'positive'
      ? cloneSnapshotTags(snapshot.positiveTags, snapshot.positive)
      : cloneSnapshotTags(snapshot.negativeTags, snapshot.negative);
    if (!sourceTags.length) return;

    const activeEditorTarget = getActiveEditorTarget() || { type: 'base', mode: 'positive' };
    if (activeEditorTarget.type === 'character') {
      const index = activeEditorTarget.charIndex;
      const characterState = getCharacterState() || {};
      const nextCharacters = [...(characterState.characterPromptsData || [])];
      const charData = nextCharacters[index];
      const charEditorObj = (characterState.charEditors || [])[index];
      if (!charData) return;

      if (target === 'positive') {
        charData.posTags = [...(charData.posTags || []), ...sourceTags];
        charData.posPrompt = tagsToString(charData.posTags);
        if (charEditorObj?.activeTab === 'pos') {
          charEditorObj.editor.setTags(charData.posTags);
        }
      } else {
        charData.negTags = [...(charData.negTags || []), ...sourceTags];
        charData.negPrompt = tagsToString(charData.negTags);
        if (charEditorObj?.activeTab === 'neg') {
          charEditorObj.editor.setTags(charData.negTags);
        }
      }

      setCharacterState({ characterPromptsData: nextCharacters });
    } else {
      const baseState = getBaseState() || {};
      if (target === 'positive') {
        const nextPositiveTags = [...(baseState.positiveTags || []), ...sourceTags];
        setBaseState({
          rawPositive: tagsToString(nextPositiveTags),
          positiveTags: nextPositiveTags
        });
        if (getCurrentMode() === 'positive') {
          renderCurrentBaseEditor();
        }
      } else {
        const nextNegativeTags = [...(baseState.negativeTags || []), ...sourceTags];
        setBaseState({
          rawNegative: tagsToString(nextNegativeTags),
          negativeTags: nextNegativeTags
        });
        if (getCurrentMode() === 'negative') {
          renderCurrentBaseEditor();
        }
      }
    }

    await syncAll('restore');
  }

  function destroy() {
    clearDebounceTimers();
    lastRecordedFingerprint = null;
  }

  return {
    setScopeId,
    primeFromStoredHistory,
    recordHistory,
    restoreFromSnapshot,
    appendHistorySnippet,
    destroy
  };
}
