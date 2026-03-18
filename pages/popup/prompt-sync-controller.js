export default function createPromptSyncController(deps = {}) {
  const {
    isEmbeddedPopup = false,
    popupHostSessionId = '',
    getActiveTab = async () => null,
    shouldIgnoreRuntimeMessage = () => false,
    getBaseState = () => ({}),
    setBaseState = () => {},
    getCharacterState = () => ({}),
    setCharacterState = () => {},
    renderBaseEditor = () => {},
    updateCharacterEditor = () => {},
    rebuildCharacterUI = () => {},
    syncActiveTagsToPanel = () => {},
    handleRemovedPendingTags = () => {},
    syncPendingVisualTimer = () => {},
    tagsToString = () => '',
    parsePromptToTags = () => [],
    normalizePrompt = (value) => String(value || ''),
    mergeTagsPreservingDisabled = (_oldTags, newTags) => newTags,
    preservePendingAiTags = (_oldTags, newTags) => newTags,
    serializeTagList = (tags) => Array.isArray(tags) ? tags : [],
    shouldApplyIncomingPromptState = () => true,
    onLocalSync = () => {},
    onRemoteStateApplied = () => {}
  } = deps;

  let hasReceivedInitialData = false;
  let hasReceivedInitialChars = false;
  let pendingInitialPromptRetries = 0;
  let lastSentPositive = null;
  let lastSentNegative = null;
  let lastSentCharacterPrompts = [];
  let promptRetryTimer = null;
  let runtimeListener = null;

  function buildPromptSyncPayload() {
    const baseState = getBaseState() || {};
    const positiveTags = baseState.positiveTags || [];
    const negativeTags = baseState.negativeTags || [];
    return {
      positive: tagsToString(positiveTags),
      negative: tagsToString(negativeTags),
      positiveTags: serializeTagList(positiveTags),
      negativeTags: serializeTagList(negativeTags)
    };
  }

  function buildCharacterPromptPayload() {
    const { characterPromptsData = [] } = getCharacterState() || {};
    return (characterPromptsData || []).map((char) => ({
      positive: char.posPrompt || tagsToString(char.posTags || []),
      negative: char.negPrompt || tagsToString(char.negTags || []),
      positiveTags: serializeTagList(char.posTags || []),
      negativeTags: serializeTagList(char.negTags || []),
      gender: char.gender || 'other',
      activeTab: char.activeTab || 'positive'
    }));
  }

  function getIncomingTagList(incomingTags, promptText = '') {
    if (Array.isArray(incomingTags)) {
      return serializeTagList(incomingTags);
    }
    return parsePromptToTags(promptText || '');
  }

  function clearPromptRetryTimer() {
    if (promptRetryTimer !== null) {
      window.clearTimeout(promptRetryTimer);
      promptRetryTimer = null;
    }
  }

  function shouldDeferInitialEmptyPromptSync({ positive, negative, positiveTags, negativeTags, currentPositive, currentNegative, currentPositiveTags, currentNegativeTags }) {
    if (hasReceivedInitialData) return false;
    if (pendingInitialPromptRetries <= 0) return false;

    const hasIncomingStructuredTags =
      (Array.isArray(positiveTags) && positiveTags.length > 0) ||
      (Array.isArray(negativeTags) && negativeTags.length > 0);
    if (hasIncomingStructuredTags) return false;

    const hasLocalState =
      normalizePrompt(currentPositive || '') !== '' || serializeTagList(currentPositiveTags || []).length > 0 ||
      normalizePrompt(currentNegative || '') !== '' || serializeTagList(currentNegativeTags || []).length > 0;
    if (!hasLocalState) return false;

    return normalizePrompt(positive || '') === '' && normalizePrompt(negative || '') === '';
  }

  function notifyLocalSync(source, kind) {
    onLocalSync({ source, kind });
  }

  function notifyRemoteStateApplied(kind) {
    onRemoteStateApplied({ source: 'webpage', kind });
  }

  function sendMessageToActiveTab(message) {
    getActiveTab().then((activeTab) => {
      if (!activeTab?.id) return;
      chrome.tabs.sendMessage(activeTab.id, message);
    });
  }

  function requestPrompt() {
    console.log('[Popup] Sending GET_PROMPT to active tab');

    getActiveTab().then((activeTab) => {
      if (activeTab?.id) {
        console.log('[Popup] Target tab ID:', activeTab.id);
        chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PROMPT' });
      } else {
        console.warn('[Popup] No active tab found');
      }
    });

    // 保持现有广播兜底逻辑，兼容 iframe / Manager Panel 路径。
    chrome.runtime.sendMessage({
      type: 'GET_PROMPT',
      hostSessionId: isEmbeddedPopup ? popupHostSessionId : undefined
    }, () => {
      if (chrome.runtime.lastError) {
        // 无需处理无监听器错误，保持与现有行为一致。
      }
    });
  }

  function requestPromptWithRetry(retries, delayMs) {
    pendingInitialPromptRetries = retries;
    requestPrompt();
    clearPromptRetryTimer();
    if (retries > 0) {
      promptRetryTimer = window.setTimeout(() => {
        promptRetryTimer = null;
        if (!hasReceivedInitialData) {
          requestPromptWithRetry(retries - 1, delayMs);
        } else {
          pendingInitialPromptRetries = 0;
        }
      }, delayMs);
    }
  }

  function syncPrompt(source = 'popup') {
    const promptPayload = buildPromptSyncPayload();
    lastSentPositive = promptPayload.positive;
    lastSentNegative = promptPayload.negative;

    sendMessageToActiveTab({
      type: 'SET_PROMPT',
      data: promptPayload
    });

    notifyLocalSync(source, 'prompt');
  }

  function syncCharacters(source = 'immediate') {
    const payload = buildCharacterPromptPayload();
    lastSentCharacterPrompts = payload;

    sendMessageToActiveTab({
      type: 'SET_CHARACTER_PROMPTS',
      data: payload
    });

    notifyLocalSync(source, 'characters');
  }

  function syncAll(source = 'restore') {
    const promptPayload = buildPromptSyncPayload();
    const characterPayload = buildCharacterPromptPayload();
    lastSentPositive = promptPayload.positive;
    lastSentNegative = promptPayload.negative;
    lastSentCharacterPrompts = characterPayload;

    getActiveTab().then((activeTab) => {
      if (!activeTab?.id) return;
      chrome.tabs.sendMessage(activeTab.id, {
        type: 'SET_PROMPT',
        data: promptPayload
      });
      chrome.tabs.sendMessage(activeTab.id, {
        type: 'SET_CHARACTER_PROMPTS',
        data: characterPayload
      });
    });

    notifyLocalSync(source, 'all');
  }

  function handleReturnPrompt(data = {}) {
    const { positive, negative, positiveTags: incomingPositiveTags, negativeTags: incomingNegativeTags } = data;
    const baseState = getBaseState() || {};
    const currentPositiveTags = baseState.positiveTags || [];
    const currentNegativeTags = baseState.negativeTags || [];
    const currentPosStr = tagsToString(currentPositiveTags);
    const currentNegStr = tagsToString(currentNegativeTags);

    if (positive === undefined && negative === undefined && !hasReceivedInitialData) {
      return;
    }

    if (shouldDeferInitialEmptyPromptSync({
      positive,
      negative,
      positiveTags: incomingPositiveTags,
      negativeTags: incomingNegativeTags,
      currentPositive: currentPosStr,
      currentNegative: currentNegStr,
      currentPositiveTags,
      currentNegativeTags
    })) {
      return;
    }

    const isFirstTime = !hasReceivedInitialData;
    hasReceivedInitialData = true;
    pendingInitialPromptRetries = 0;
    clearPromptRetryTimer();

    if (
      !isFirstTime &&
      normalizePrompt(positive) === normalizePrompt(lastSentPositive) &&
      normalizePrompt(negative) === normalizePrompt(lastSentNegative)
    ) {
      return;
    }

    const shouldUpdatePos = shouldApplyIncomingPromptState({
      isFirstTime,
      incomingPrompt: positive,
      incomingTags: incomingPositiveTags,
      currentPrompt: currentPosStr,
      currentTags: currentPositiveTags,
      pendingInitialPromptRetries
    });
    const shouldUpdateNeg = shouldApplyIncomingPromptState({
      isFirstTime,
      incomingPrompt: negative,
      incomingTags: incomingNegativeTags,
      currentPrompt: currentNegStr,
      currentTags: currentNegativeTags,
      pendingInitialPromptRetries
    });

    if (!shouldUpdatePos && !shouldUpdateNeg) {
      lastSentPositive = currentPosStr;
      lastSentNegative = currentNegStr;
      syncActiveTagsToPanel();
      return;
    }

    const nextBaseState = {};
    let nextPositiveTags = currentPositiveTags;
    let nextNegativeTags = currentNegativeTags;

    if (shouldUpdatePos) {
      nextBaseState.rawPositive = positive || '';
      const parsedPosTags = getIncomingTagList(incomingPositiveTags, nextBaseState.rawPositive);
      nextPositiveTags = Array.isArray(incomingPositiveTags)
        ? preservePendingAiTags(currentPositiveTags, parsedPosTags)
        : preservePendingAiTags(currentPositiveTags, mergeTagsPreservingDisabled(currentPositiveTags, parsedPosTags));
      nextBaseState.positiveTags = nextPositiveTags;
    }

    if (shouldUpdateNeg) {
      nextBaseState.rawNegative = negative || '';
      const parsedNegTags = getIncomingTagList(incomingNegativeTags, nextBaseState.rawNegative);
      nextNegativeTags = Array.isArray(incomingNegativeTags)
        ? preservePendingAiTags(currentNegativeTags, parsedNegTags)
        : preservePendingAiTags(currentNegativeTags, mergeTagsPreservingDisabled(currentNegativeTags, parsedNegTags));
      nextBaseState.negativeTags = nextNegativeTags;
    }

    setBaseState(nextBaseState);
    renderBaseEditor({
      shouldUpdatePos,
      shouldUpdateNeg,
      positiveTags: nextPositiveTags,
      negativeTags: nextNegativeTags
    });

    syncActiveTagsToPanel();
    lastSentPositive = tagsToString(nextPositiveTags);
    lastSentNegative = tagsToString(nextNegativeTags);
    notifyRemoteStateApplied('prompt');
  }

  function handleReturnCharacterPrompts(charPrompts = []) {
    const currentState = getCharacterState() || {};
    let nextCharacterPromptsData = Array.isArray(currentState.characterPromptsData)
      ? currentState.characterPromptsData.slice()
      : [];
    let nextCharEditors = Array.isArray(currentState.charEditors)
      ? currentState.charEditors.slice()
      : [];

    const isFirstTime = !hasReceivedInitialChars;
    hasReceivedInitialChars = true;

    let uiNeedsRebuild = false;
    if (nextCharacterPromptsData.length !== charPrompts.length && !isFirstTime) {
      uiNeedsRebuild = true;
      if (nextCharacterPromptsData.length > charPrompts.length) {
        nextCharacterPromptsData.slice(charPrompts.length).forEach((character) => {
          handleRemovedPendingTags([
            ...(character?.posTags || []),
            ...(character?.negTags || [])
          ], 'target-removed');
        });
        syncPendingVisualTimer();
        nextCharacterPromptsData = nextCharacterPromptsData.slice(0, charPrompts.length);
        nextCharEditors = nextCharEditors.slice(0, charPrompts.length);
      }
    } else if (isFirstTime) {
      uiNeedsRebuild = true;
      if (charPrompts.length === 0 && nextCharacterPromptsData.length === 0) {
        nextCharacterPromptsData = [];
        nextCharEditors = [];
      }
    }

    let changesApplied = false;

    charPrompts.forEach((charPrompt, index) => {
      const charObj = nextCharacterPromptsData[index] || {
        posTags: [],
        negTags: [],
        posPrompt: '',
        negPrompt: '',
        gender: 'other'
      };

      const currentPosPrompt = charObj.posPrompt || tagsToString(charObj.posTags || []);
      const currentNegPrompt = charObj.negPrompt || tagsToString(charObj.negTags || []);

      const shouldUpdatePos = shouldApplyIncomingPromptState({
        isFirstTime,
        incomingPrompt: charPrompt.positive,
        incomingTags: charPrompt.positiveTags,
        currentPrompt: currentPosPrompt,
        currentTags: charObj.posTags || [],
        pendingInitialPromptRetries: 0
      });
      const shouldUpdateNeg = shouldApplyIncomingPromptState({
        isFirstTime,
        incomingPrompt: charPrompt.negative,
        incomingTags: charPrompt.negativeTags,
        currentPrompt: currentNegPrompt,
        currentTags: charObj.negTags || [],
        pendingInitialPromptRetries: 0
      });
      const nextGender = charPrompt.gender !== undefined ? charPrompt.gender : (charObj.gender || 'other');
      const nextActiveTab = charPrompt.activeTab !== undefined ? charPrompt.activeTab : (charObj.activeTab || 'positive');
      const shouldUpdateMeta =
        nextGender !== (charObj.gender || 'other') ||
        nextActiveTab !== (charObj.activeTab || 'positive');
      const hasExistingCharacter = index < nextCharacterPromptsData.length;

      if (!shouldUpdatePos && !shouldUpdateNeg && !shouldUpdateMeta && hasExistingCharacter) {
        return;
      }

      changesApplied = true;

      let newPosTags = charObj.posTags || [];
      let newNegTags = charObj.negTags || [];

      if (shouldUpdatePos || charObj.posPrompt === undefined) {
        const parsedPosTags = getIncomingTagList(charPrompt.positiveTags, charPrompt.positive || '');
        newPosTags = Array.isArray(charPrompt.positiveTags)
          ? preservePendingAiTags(charObj.posTags || [], parsedPosTags)
          : preservePendingAiTags(charObj.posTags || [], mergeTagsPreservingDisabled(charObj.posTags || [], parsedPosTags));
        charObj.posPrompt = charPrompt.positive || '';
        charObj.posTags = newPosTags;
      }

      if (shouldUpdateNeg || charObj.negPrompt === undefined) {
        const parsedNegTags = getIncomingTagList(charPrompt.negativeTags, charPrompt.negative || '');
        newNegTags = Array.isArray(charPrompt.negativeTags)
          ? preservePendingAiTags(charObj.negTags || [], parsedNegTags)
          : preservePendingAiTags(charObj.negTags || [], mergeTagsPreservingDisabled(charObj.negTags || [], parsedNegTags));
        charObj.negPrompt = charPrompt.negative || '';
        charObj.negTags = newNegTags;
      }

      charObj.gender = nextGender;
      charObj.activeTab = nextActiveTab;
      nextCharacterPromptsData[index] = charObj;

      if (!uiNeedsRebuild) {
        updateCharacterEditor({
          index,
          shouldUpdatePos,
          shouldUpdateNeg,
          posTags: newPosTags,
          negTags: newNegTags
        });
      }
    });

    setCharacterState({
      characterPromptsData: nextCharacterPromptsData,
      charEditors: nextCharEditors
    });

    if (uiNeedsRebuild || (changesApplied && nextCharacterPromptsData.length === 0)) {
      console.log('[Phase 2] Found structural changes, rebuilding UI...');
      rebuildCharacterUI();
    }

    if (changesApplied) {
      syncActiveTagsToPanel();
      notifyRemoteStateApplied('characters');
    }
  }

  function handleRuntimeMessage(msg, sender) {
    if (shouldIgnoreRuntimeMessage(msg)) return;
    if (msg?.type === 'RETURN_PROMPT') {
      handleReturnPrompt(msg.data || {});
    } else if (msg?.type === 'RETURN_CHARACTER_PROMPTS') {
      handleReturnCharacterPrompts(msg.data || []);
    }
  }

  function init() {
    if (runtimeListener) return;
    runtimeListener = (msg, sender) => handleRuntimeMessage(msg, sender);
    chrome.runtime.onMessage.addListener(runtimeListener);
  }

  function destroy() {
    clearPromptRetryTimer();
    if (runtimeListener) {
      chrome.runtime.onMessage.removeListener(runtimeListener);
      runtimeListener = null;
    }
    hasReceivedInitialData = false;
    hasReceivedInitialChars = false;
    pendingInitialPromptRetries = 0;
    lastSentPositive = null;
    lastSentNegative = null;
    lastSentCharacterPrompts = [];
  }

  return {
    init,
    destroy,
    requestPrompt,
    requestPromptWithRetry,
    syncPrompt,
    syncCharacters,
    syncAll
  };
}
