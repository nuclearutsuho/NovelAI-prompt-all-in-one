const AI_TRANSLATE_STORAGE_KEY = 'aiTranslateConfig';
const AI_TRANSLATE_REQUEST_TIMEOUT_MS = 60000;
const AI_PENDING_PLACEHOLDER_VALUE = '__AI_TRANSLATING__';
const DEFAULT_AI_SYSTEM_PROMPT = "You are a professional translator for image generation prompts. Translate the user's input into natural English. Output ONLY the translated English text. Strictly translate the exact meaning of the original text without adding any unmentioned elements, characters, or environment details. Do not add any formatting or explanation.";
const DEFAULT_AI_TAG_ANNOTATION_PROMPT = "You translate English NovelAI prompt tags or short prompt fragments into concise Simplified Chinese notes for human reading only. Keep the meaning accurate and natural. If the user sends plain text, reply with ONLY the Chinese translation text. If the user sends a JSON array of strings, reply with ONLY a JSON array of Chinese translations in the same order. Do not add markdown, numbering, explanations, or any extra text.";
const DEFAULT_AI_PROFILE_TEMPLATE = Object.freeze({
  providerPreset: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  tagAnnotationPrompt: DEFAULT_AI_TAG_ANNOTATION_PROMPT
});

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAiProfileId() {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultAiProfileName(index = 1) {
  return `OpenAI ${index}`;
}

function createDefaultAiProfile(index = 1) {
  return {
    id: createAiProfileId(),
    name: getDefaultAiProfileName(index),
    ...DEFAULT_AI_PROFILE_TEMPLATE
  };
}

function normalizeAiProfile(profile = {}, index = 1) {
  const fallback = createDefaultAiProfile(index);
  return {
    id: String(profile.id || fallback.id),
    name: String(profile.name || fallback.name).trim() || fallback.name,
    providerPreset: 'openai',
    apiUrl: String(profile.apiUrl || fallback.apiUrl).trim() || fallback.apiUrl,
    apiKey: String(profile.apiKey || '').trim(),
    model: String(profile.model || fallback.model).trim() || fallback.model,
    systemPrompt: typeof profile.systemPrompt === 'string' && profile.systemPrompt.trim()
      ? profile.systemPrompt
      : fallback.systemPrompt,
    tagAnnotationPrompt: typeof profile.tagAnnotationPrompt === 'string' && profile.tagAnnotationPrompt.trim()
      ? profile.tagAnnotationPrompt
      : fallback.tagAnnotationPrompt
  };
}

function normalizeAiTranslateConfig(rawConfig) {
  let profiles = [];

  // 兼容旧的单配置结构，自动迁移为多配置结构。
  if (rawConfig && Array.isArray(rawConfig.profiles)) {
    profiles = rawConfig.profiles.map((profile, index) => normalizeAiProfile(profile, index + 1));
  } else if (rawConfig && typeof rawConfig === 'object' && (rawConfig.apiUrl || rawConfig.apiKey || rawConfig.model || rawConfig.systemPrompt)) {
    profiles = [normalizeAiProfile(rawConfig, 1)];
  }

  if (profiles.length === 0) {
    profiles = [createDefaultAiProfile(1)];
  }

  const activeProfileId = profiles.some((profile) => profile.id === rawConfig?.activeProfileId)
    ? rawConfig.activeProfileId
    : profiles[0].id;

  return {
    activeProfileId,
    profiles
  };
}

function getOriginPatternFromApiUrl(apiUrl) {
  const parsed = new URL(apiUrl);
  return `${parsed.origin}/*`;
}

function containsOriginPermission(origins) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins }, (granted) => resolve(!!granted));
  });
}

function requestOriginPermission(origins) {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => resolve(!!granted));
  });
}

function extractTranslatedText(responseJson) {
  const messageContent = responseJson?.choices?.[0]?.message?.content;
  if (typeof messageContent === 'string') {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

export default function createAiTranslateController(deps = {}) {
  const {
    storageRepository,
    lifecycleScope,
    getLocalizedText = (key, fallback = '') => fallback || key,
    showToast = () => {},
    normalizeTargetContext = (targetContext) => targetContext,
    getTargetTagList = () => null,
    renderTargetIfVisible = () => {},
    syncTargetAfterResolve = () => {},
    refreshPendingVisuals = () => {},
    recordAnnotationChange = () => {}
  } = deps;

  if (!storageRepository?.get || !storageRepository?.set) {
    throw new TypeError('[AI Translate] 缺少扩展存储仓库');
  }
  if (!lifecycleScope?.timeout || !lifecycleScope?.interval) {
    throw new TypeError('[AI Translate] 缺少生命周期作用域');
  }

  let aiTranslateConfigState = null;
  let aiPendingVisualTimer = null;
  let settingsSaveTimer = null;
  const aiPendingRequestMap = new Map();

  function getActiveAiProfile(config = aiTranslateConfigState) {
    const normalizedConfig = normalizeAiTranslateConfig(config);
    return normalizedConfig.profiles.find((profile) => profile.id === normalizedConfig.activeProfileId) || normalizedConfig.profiles[0];
  }

  async function loadConfig() {
    const stored = (await storageRepository.get(AI_TRANSLATE_STORAGE_KEY))[AI_TRANSLATE_STORAGE_KEY];
    const normalized = normalizeAiTranslateConfig(stored);
    aiTranslateConfigState = normalized;

    if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await storageRepository.set({ [AI_TRANSLATE_STORAGE_KEY]: normalized });
    }

    return normalized;
  }

  async function saveConfig(config) {
    aiTranslateConfigState = normalizeAiTranslateConfig(config);
    await storageRepository.set({ [AI_TRANSLATE_STORAGE_KEY]: aiTranslateConfigState });
    return aiTranslateConfigState;
  }

  function setAiTranslateButtonLoading(button, isLoading) {
    if (!button) return;
    const currentCount = Number(button.dataset.loadingCount || 0);
    const nextCount = Math.max(0, currentCount + (isLoading ? 1 : -1));
    if (nextCount === 0) {
      delete button.dataset.loadingCount;
    } else {
      button.dataset.loadingCount = String(nextCount);
    }
    button.classList.toggle('is-loading', nextCount > 0);
  }

  function getAiPendingRequestId(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    return String(value?.aiPendingRequestId || '').trim();
  }

  function getAiZhPendingRequestId(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    return String(value?.aiZhPendingRequestId || '').trim();
  }

  function createAiPendingRequestId() {
    return `ai_pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function registerAiPendingRequest(requestId, meta = {}) {
    if (!requestId) return null;
    // 以 requestId 为唯一锚点，避免网页回读后 tag 数组重建导致回填目标丢失。
    const state = {
      requestId,
      controller: null,
      canceled: false,
      cancelReason: '',
      ...meta
    };
    aiPendingRequestMap.set(requestId, state);
    return state;
  }

  function getAiPendingRequestState(requestId) {
    if (!requestId) return null;
    return aiPendingRequestMap.get(requestId) || null;
  }

  function setAiPendingRequestController(requestId, controller) {
    const state = getAiPendingRequestState(requestId);
    if (!state) return;
    state.controller = controller || null;
    if (state.canceled && controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  function isAiPendingRequestCanceled(requestId) {
    return !!getAiPendingRequestState(requestId)?.canceled;
  }

  function cancelAiPendingRequest(requestId, reason = 'user') {
    const state = getAiPendingRequestState(requestId);
    if (!state) return false;
    state.canceled = true;
    state.cancelReason = reason;
    if (state.controller && !state.controller.signal.aborted) {
      state.controller.abort();
    }
    return true;
  }

  function cleanupAiPendingRequest(requestId) {
    if (!requestId) return;
    aiPendingRequestMap.delete(requestId);
  }

  function findPendingAiTagIndex(tagList = [], pendingTagOrRequestId) {
    const requestId = getAiPendingRequestId(pendingTagOrRequestId);
    if (requestId) {
      return tagList.findIndex((tag) => isPendingTag(tag) && getAiPendingRequestId(tag) === requestId);
    }
    if (!pendingTagOrRequestId) return -1;
    return tagList.indexOf(pendingTagOrRequestId);
  }

  function isPendingTag(tag = {}) {
    return !!tag?.aiPending;
  }

  function isAiZhPendingTag(tag = {}) {
    return !!tag?.aiZhPending;
  }

  function getSyncableTagList(tags = []) {
    return (tags || []).filter((tag) => !isPendingTag(tag));
  }

  function preservePendingTags(oldTags = [], newTags = []) {
    const merged = Array.isArray(newTags) ? newTags.slice() : [];
    const pendingEntries = (oldTags || [])
      .map((tag, index) => ({ tag, index, requestId: getAiPendingRequestId(tag) }))
      .filter(({ tag }) => isPendingTag(tag));

    if (!pendingEntries.length) return merged;

    // 网页回读会重建一份新 tag 列表，这里把本地仍在进行中的 pending tag 按原位置缝回去。
    pendingEntries.forEach(({ tag, index, requestId }) => {
      if (requestId && merged.some((item) => getAiPendingRequestId(item) === requestId)) {
        return;
      }
      const insertIndex = Math.max(0, Math.min(index, merged.length));
      merged.splice(insertIndex, 0, tag);
    });

    return merged;
  }

  function hasActivePendingRequests() {
    for (const state of aiPendingRequestMap.values()) {
      if (!state.canceled) return true;
    }
    return false;
  }

  function syncPendingVisualTimer() {
    if (!hasActivePendingRequests()) {
      if (aiPendingVisualTimer !== null) {
        lifecycleScope.cancelInterval(aiPendingVisualTimer);
        aiPendingVisualTimer = null;
      }
      return;
    }

    refreshPendingVisuals();

    if (aiPendingVisualTimer !== null) return;
    aiPendingVisualTimer = lifecycleScope.interval(() => {
      if (!hasActivePendingRequests()) {
        lifecycleScope.cancelInterval(aiPendingVisualTimer);
        aiPendingVisualTimer = null;
        return;
      }
      refreshPendingVisuals();
    }, 1000);
  }

  function handleRemovedTags(removedTags = [], reason = 'user') {
    let canceledAny = false;
    (removedTags || []).forEach((tag) => {
      const requestId = getAiPendingRequestId(tag);
      if (!requestId) return;
      canceledAny = cancelAiPendingRequest(requestId, reason) || canceledAny;
    });
    if (canceledAny) {
      syncPendingVisualTimer();
    }
  }

  function restartPendingAiTag(targetContext, pendingTagOrRequestId, requestId) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId || !requestId) return false;

    const pendingIndex = findPendingAiTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const pendingTag = tagList[pendingIndex];
    pendingTag.value = AI_PENDING_PLACEHOLDER_VALUE;
    pendingTag.aiPending = true;
    pendingTag.aiPendingStartedAt = Date.now();
    pendingTag.aiPendingRequestId = requestId;
    delete pendingTag.aiPendingFailed;
    delete pendingTag.aiPendingErrorMessage;

    renderTargetIfVisible(target);
    syncPendingVisualTimer();
    return true;
  }

  function startRetranslateAiTag(targetContext, existingTag, requestId) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !existingTag || !requestId) return false;

    const tagIndex = tagList.indexOf(existingTag);
    if (tagIndex === -1) return false;

    const targetTag = tagList[tagIndex];
    targetTag.aiPendingPreviousValue = String(targetTag.value || '').trim();
    targetTag.value = AI_PENDING_PLACEHOLDER_VALUE;
    targetTag.aiPending = true;
    targetTag.aiPendingStartedAt = Date.now();
    targetTag.aiPendingRequestId = requestId;
    delete targetTag.aiPendingFailed;
    delete targetTag.aiPendingErrorMessage;

    renderTargetIfVisible(target);
    syncPendingVisualTimer();
    return true;
  }

  function resolvePendingAiTag(targetContext, pendingTagOrRequestId, translatedText) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const resolvedTag = tagList[pendingIndex];
    resolvedTag.value = translatedText;
    delete resolvedTag.aiPending;
    delete resolvedTag.aiPendingFailed;
    delete resolvedTag.aiPendingErrorMessage;
    delete resolvedTag.aiPendingStartedAt;
    delete resolvedTag.aiPendingRequestId;
    delete resolvedTag.aiPendingPreviousValue;

    syncPendingVisualTimer();
    syncTargetAfterResolve(target, 'popup');
    return true;
  }

  function markPendingAiTagFailed(targetContext, pendingTagOrRequestId, errorMessage = '') {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const pendingTag = tagList[pendingIndex];
    pendingTag.value = AI_PENDING_PLACEHOLDER_VALUE;
    pendingTag.aiPending = true;
    pendingTag.aiPendingFailed = true;
    pendingTag.aiPendingErrorMessage = String(errorMessage || '').trim();
    delete pendingTag.aiPendingStartedAt;

    renderTargetIfVisible(target);
    syncPendingVisualTimer();
    return true;
  }

  function restoreRetranslateAiTag(targetContext, pendingTagOrRequestId) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const pendingTag = tagList[pendingIndex];
    const previousValue = String(pendingTag.aiPendingPreviousValue || '').trim();
    if (!previousValue) return false;

    pendingTag.value = previousValue;
    delete pendingTag.aiPending;
    delete pendingTag.aiPendingFailed;
    delete pendingTag.aiPendingErrorMessage;
    delete pendingTag.aiPendingStartedAt;
    delete pendingTag.aiPendingRequestId;
    delete pendingTag.aiPendingPreviousValue;

    renderTargetIfVisible(target);
    syncPendingVisualTimer();
    return true;
  }

  function findPendingAiZhTagIndex(tagList = [], pendingTagOrRequestId) {
    const requestId = getAiZhPendingRequestId(pendingTagOrRequestId);
    if (requestId) {
      return tagList.findIndex((tag) => isAiZhPendingTag(tag) && getAiZhPendingRequestId(tag) === requestId);
    }
    if (!pendingTagOrRequestId) return -1;
    return tagList.indexOf(pendingTagOrRequestId);
  }

  function markAiZhTagPending(targetContext, tagOrIndex, requestId) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !requestId) return false;

    const pendingIndex = typeof tagOrIndex === 'number'
      ? tagOrIndex
      : tagList.indexOf(tagOrIndex);
    if (pendingIndex < 0 || !tagList[pendingIndex]) return false;

    const targetTag = tagList[pendingIndex];
    targetTag.aiZhPending = true;
    targetTag.aiZhPendingStartedAt = Date.now();
    targetTag.aiZhPendingRequestId = requestId;
    delete targetTag.aiZhErrorMessage;
    renderTargetIfVisible(target);
    syncPendingVisualTimer();
    return true;
  }

  function resolveAiZhTag(targetContext, pendingTagOrRequestId, translatedText) {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiZhTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const targetTag = tagList[pendingIndex];
    targetTag.aiZhTranslation = String(translatedText || '').replace(/\s+/g, ' ').trim();
    delete targetTag.aiZhPending;
    delete targetTag.aiZhPendingStartedAt;
    delete targetTag.aiZhPendingRequestId;
    delete targetTag.aiZhErrorMessage;
    renderTargetIfVisible(target);
    return true;
  }

  function restoreAiZhTag(targetContext, pendingTagOrRequestId, previousTranslation = '') {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiZhTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const targetTag = tagList[pendingIndex];
    const normalizedPrevious = String(previousTranslation || '').trim();
    if (normalizedPrevious) {
      targetTag.aiZhTranslation = normalizedPrevious;
    } else {
      delete targetTag.aiZhTranslation;
    }
    delete targetTag.aiZhPending;
    delete targetTag.aiZhPendingStartedAt;
    delete targetTag.aiZhPendingRequestId;
    delete targetTag.aiZhErrorMessage;
    renderTargetIfVisible(target);
    return true;
  }

  function markAiZhTagFailed(targetContext, pendingTagOrRequestId, previousTranslation = '', errorMessage = '') {
    const target = normalizeTargetContext(targetContext);
    const tagList = getTargetTagList(target);
    if (!tagList || !pendingTagOrRequestId) return false;

    const pendingIndex = findPendingAiZhTagIndex(tagList, pendingTagOrRequestId);
    if (pendingIndex === -1) return false;

    const targetTag = tagList[pendingIndex];
    const normalizedPrevious = String(previousTranslation || '').trim();
    if (normalizedPrevious) {
      targetTag.aiZhTranslation = normalizedPrevious;
    } else {
      delete targetTag.aiZhTranslation;
    }
    delete targetTag.aiZhPending;
    delete targetTag.aiZhPendingStartedAt;
    delete targetTag.aiZhPendingRequestId;
    if (errorMessage) {
      targetTag.aiZhErrorMessage = String(errorMessage).trim();
    } else {
      delete targetTag.aiZhErrorMessage;
    }
    renderTargetIfVisible(target);
    return true;
  }

  async function ensureAiApiPermission(apiUrl) {
    const originPattern = getOriginPatternFromApiUrl(apiUrl);
    if (await containsOriginPermission([originPattern])) {
      return true;
    }
    return requestOriginPermission([originPattern]);
  }

  async function runAiCompletion(sourceText, profile, { controller = null, systemPrompt = DEFAULT_AI_SYSTEM_PROMPT } = {}) {
    const requestController = controller || new AbortController();
    const timer = lifecycleScope.timeout(() => requestController.abort(), AI_TRANSLATE_REQUEST_TIMEOUT_MS);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (profile.apiKey) {
        headers.Authorization = `Bearer ${profile.apiKey}`;
      }

      const response = await fetch(profile.apiUrl, {
        method: 'POST',
        headers,
        signal: requestController.signal,
        body: JSON.stringify({
          model: profile.model,
          messages: [
            { role: 'system', content: systemPrompt || DEFAULT_AI_SYSTEM_PROMPT },
            { role: 'user', content: sourceText }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const responseJson = await response.json();
      const completionText = extractTranslatedText(responseJson).trim();
      if (!completionText) {
        throw new Error('EMPTY_TRANSLATION');
      }

      return completionText;
    } finally {
      lifecycleScope.cancelTimeout(timer);
    }
  }

  async function aiTranslateText(sourceText, profile, { controller = null } = {}) {
    const translatedText = await runAiCompletion(sourceText, profile, {
      controller,
      systemPrompt: profile.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT
    });
    return translatedText.replace(/\s+/g, ' ').trim();
  }

  function extractJsonPayload(text) {
    const rawText = String(text || '').trim();
    if (!rawText) return '';

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
      return fencedMatch[1].trim();
    }

    return rawText;
  }

  function parseTagAnnotationBatchResponse(responseText, expectedCount) {
    let parsed;
    try {
      parsed = JSON.parse(extractJsonPayload(responseText));
    } catch (error) {
      throw new Error('INVALID_BATCH_TRANSLATION_JSON');
    }

    let items = [];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (Array.isArray(parsed?.translations)) {
      items = parsed.translations;
    }

    const normalized = items.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim());
    if (normalized.length !== expectedCount || normalized.some((item) => !item)) {
      throw new Error('BATCH_TRANSLATION_COUNT_MISMATCH');
    }

    return normalized;
  }

  function renderAiTranslateProfileOptions() {
    const profileSelect = document.getElementById('ai-profile-select');
    const deleteButton = document.getElementById('btn-ai-profile-delete');
    if (!profileSelect || !aiTranslateConfigState) return;

    profileSelect.innerHTML = '';
    aiTranslateConfigState.profiles.forEach((profile, index) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name || getDefaultAiProfileName(index + 1);
      profileSelect.appendChild(option);
    });
    profileSelect.value = aiTranslateConfigState.activeProfileId;

    if (deleteButton) {
      deleteButton.disabled = aiTranslateConfigState.profiles.length <= 1;
    }
  }

  function populateAiTranslateProfileForm() {
    const profile = getActiveAiProfile();
    if (!profile) return;

    const profileNameInput = document.getElementById('ai-profile-name');
    const apiUrlInput = document.getElementById('ai-api-url');
    const apiKeyInput = document.getElementById('ai-api-key');
    const modelInput = document.getElementById('ai-model');
    const systemPromptInput = document.getElementById('ai-system-prompt');
    const tagAnnotationPromptInput = document.getElementById('ai-tag-annotation-prompt');

    if (profileNameInput) profileNameInput.value = profile.name || '';
    if (apiUrlInput) apiUrlInput.value = profile.apiUrl || '';
    if (apiKeyInput) apiKeyInput.value = profile.apiKey || '';
    if (modelInput) modelInput.value = profile.model || '';
    if (systemPromptInput) systemPromptInput.value = profile.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
    if (tagAnnotationPromptInput) tagAnnotationPromptInput.value = profile.tagAnnotationPrompt || DEFAULT_AI_TAG_ANNOTATION_PROMPT;

    renderAiTranslateProfileOptions();
  }

  async function persistAiTranslateProfileForm() {
    if (!aiTranslateConfigState) {
      await loadConfig();
    }

    // 先把设置面板里当前编辑的值落盘，避免刚改完配置就发请求。
    const profile = getActiveAiProfile();
    if (!profile) return;

    const profileNameInput = document.getElementById('ai-profile-name');
    const apiUrlInput = document.getElementById('ai-api-url');
    const apiKeyInput = document.getElementById('ai-api-key');
    const modelInput = document.getElementById('ai-model');
    const systemPromptInput = document.getElementById('ai-system-prompt');
    const tagAnnotationPromptInput = document.getElementById('ai-tag-annotation-prompt');

    const nextConfig = cloneDeep(aiTranslateConfigState);
    const profileIndex = nextConfig.profiles.findIndex((item) => item.id === profile.id);
    if (profileIndex === -1) return;

    nextConfig.profiles[profileIndex] = normalizeAiProfile({
      ...nextConfig.profiles[profileIndex],
      name: profileNameInput?.value,
      apiUrl: apiUrlInput?.value,
      apiKey: apiKeyInput?.value,
      model: modelInput?.value,
      systemPrompt: systemPromptInput?.value,
      tagAnnotationPrompt: tagAnnotationPromptInput?.value
    }, profileIndex + 1);

    await saveConfig(nextConfig);
    renderAiTranslateProfileOptions();
  }

  function formatAiTranslateError(error) {
    if (error?.name === 'AbortError') {
      return getLocalizedText('toast_ai_translate_timeout', 'Translation request timed out.');
    }

    const message = String(error?.message || '').trim();
    if (message === 'EMPTY_TRANSLATION') {
      return getLocalizedText('toast_ai_translate_empty', 'The API returned an empty translation.');
    }

     if (message === 'INVALID_BATCH_TRANSLATION_JSON') {
      return getLocalizedText('toast_ai_tag_annotation_invalid_json', 'The AI response is not valid JSON.');
    }

    if (message === 'BATCH_TRANSLATION_COUNT_MISMATCH') {
      return getLocalizedText('toast_ai_tag_annotation_count_mismatch', 'The AI response count does not match the selected tags.');
    }

    if (!message) {
      return getLocalizedText('toast_ai_translate_failed', 'Translation failed.');
    }

    return `${getLocalizedText('toast_ai_translate_failed', 'Translation failed.')}: ${message}`;
  }

  function extractAnnotatableTagText(tag = {}) {
    const rawValue = String(tag?.value || '').trim();
    if (!rawValue) return '';

    const isDynHeader = rawValue.startsWith('||') && (rawValue !== '||' || tag?.isStart);
    const isDynFooter = rawValue === '||' && !tag?.isStart;
    const isCompFooter = rawValue === ' ::';
    const blockMatch = rawValue.match(/^([-?\d\.]+)::(.*?)\s*::$/);
    const headerMatch = rawValue.match(/^([-?\d\.]+)::$/);

    if (isDynHeader || isDynFooter || isCompFooter || headerMatch) {
      return '';
    }

    let cleanText = blockMatch ? blockMatch[2] : rawValue;

    if (!blockMatch && (cleanText.startsWith('{') || cleanText.startsWith('['))) {
      let inc = 0;
      while (cleanText.startsWith('{') && cleanText.endsWith('}')) {
        inc += 1;
        cleanText = cleanText.slice(1, -1);
      }
      if (inc === 0) {
        while (cleanText.startsWith('[') && cleanText.endsWith(']')) {
          cleanText = cleanText.slice(1, -1);
        }
      }
    }

    if (Number.isFinite(Number(tag?.dynWeight)) && Number(tag.dynWeight) !== 1) {
      cleanText = cleanText.replace(/^(.*?)(?::\s*-?\d+(?:\.\d+)?)$/, '$1').trim();
    }

    return cleanText.trim();
  }

  async function annotateTags({ buttonEl, targetContext, tags = [] } = {}) {
    const sourceTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (!sourceTags.length) {
      showToast('warning', getLocalizedText('toast_ai_tag_annotation_missing', 'Select at least one tag to translate.'));
      return;
    }

    if (!aiTranslateConfigState) {
      await loadConfig();
    }

    await persistAiTranslateProfileForm();

    const profile = getActiveAiProfile();
    if (!profile) {
      showToast('error', getLocalizedText('toast_ai_missing_profile', 'No AI profile is available.'));
      return;
    }

    if (!profile.apiUrl) {
      showToast('warning', getLocalizedText('toast_ai_missing_api_url', 'Please configure an API URL first.'));
      return;
    }

    if (!profile.model) {
      showToast('warning', getLocalizedText('toast_ai_missing_model', 'Please configure a model name first.'));
      return;
    }

    try {
      new URL(profile.apiUrl);
    } catch (error) {
      showToast('error', getLocalizedText('toast_ai_invalid_api_url', 'The API URL is invalid.'));
      return;
    }

    const target = normalizeTargetContext(targetContext);
    if (!target) return;

    const requestEntries = sourceTags
      .map((tag) => ({
        tag,
        sourceText: extractAnnotatableTagText(tag),
        previousTranslation: String(tag?.aiZhTranslation || '').trim(),
        requestId: createAiPendingRequestId()
      }))
      .filter((entry) => entry.sourceText);

    if (!requestEntries.length) {
      showToast('warning', getLocalizedText('toast_ai_tag_annotation_missing', 'Select at least one tag to translate.'));
      return;
    }

    setAiTranslateButtonLoading(buttonEl, true);
    requestEntries.forEach((entry) => {
      registerAiPendingRequest(entry.requestId, {
        targetType: target.type,
        targetMode: target.mode,
        charIndex: target.type === 'character' ? target.charIndex : -1,
        sourceText: entry.sourceText,
        kind: 'tag-annotation',
        previousTranslation: entry.previousTranslation
      });
      markAiZhTagPending(target, entry.tag, entry.requestId);
    });

    const granted = await ensureAiApiPermission(profile.apiUrl);
    if (!granted) {
      const message = getLocalizedText('toast_ai_permission_denied', 'The API origin permission was denied.');
      requestEntries.forEach((entry) => {
        markAiZhTagFailed(target, entry.requestId, entry.previousTranslation, message);
        cleanupAiPendingRequest(entry.requestId);
      });
      syncPendingVisualTimer();
      setAiTranslateButtonLoading(buttonEl, false);
      showToast('warning', message);
      return;
    }

    try {
      const controller = new AbortController();
      requestEntries.forEach((entry) => setAiPendingRequestController(entry.requestId, controller));

      let translatedItems = [];
      if (requestEntries.length === 1) {
        const translatedText = await runAiCompletion(requestEntries[0].sourceText, profile, {
          controller,
          systemPrompt: profile.tagAnnotationPrompt || DEFAULT_AI_TAG_ANNOTATION_PROMPT
        });
        translatedItems = [translatedText.replace(/\s+/g, ' ').trim()];
      } else {
        const payload = JSON.stringify(requestEntries.map((entry) => entry.sourceText));
        const completionText = await runAiCompletion(payload, profile, {
          controller,
          systemPrompt: profile.tagAnnotationPrompt || DEFAULT_AI_TAG_ANNOTATION_PROMPT
        });
        translatedItems = parseTagAnnotationBatchResponse(completionText, requestEntries.length);
      }

      requestEntries.forEach((entry, index) => {
        resolveAiZhTag(target, entry.requestId, translatedItems[index]);
        cleanupAiPendingRequest(entry.requestId);
      });
      syncTargetAfterResolve(target, 'popup');
      recordAnnotationChange(target);
    } catch (error) {
      const errorMessage = formatAiTranslateError(error);
      console.error('[AI Translate] 译注失败:', error);
      requestEntries.forEach((entry) => {
        markAiZhTagFailed(target, entry.requestId, entry.previousTranslation, errorMessage);
        cleanupAiPendingRequest(entry.requestId);
      });
      showToast('error', errorMessage);
    } finally {
      syncPendingVisualTimer();
      setAiTranslateButtonLoading(buttonEl, false);
    }
  }

  async function translateFromInput({ inputEl, buttonEl, tagEditor, scrollContainer, targetContext, pendingTag = null, existingTag = null }) {
    if (!tagEditor) return;

    const retrySourceText = String(pendingTag?.aiOriginal || '').trim();
    const retranslateSourceText = String(existingTag?.aiOriginal || '').trim();
    const sourceText = pendingTag
      ? retrySourceText
      : (existingTag ? retranslateSourceText : String(inputEl?.value || '').trim());
    if (!sourceText) {
      showToast(
        'warning',
        existingTag
          ? getLocalizedText('toast_ai_missing_original', 'No original text is available for retranslation.')
          : getLocalizedText('toast_ai_missing_input', 'Enter text before translating.')
      );
      return;
    }

    if (!aiTranslateConfigState) {
      await loadConfig();
    }

    await persistAiTranslateProfileForm();

    const profile = getActiveAiProfile();
    if (!profile) {
      showToast('error', getLocalizedText('toast_ai_missing_profile', 'No AI profile is available.'));
      return;
    }

    if (!profile.apiUrl) {
      showToast('warning', getLocalizedText('toast_ai_missing_api_url', 'Please configure an API URL first.'));
      return;
    }

    if (!profile.model) {
      showToast('warning', getLocalizedText('toast_ai_missing_model', 'Please configure a model name first.'));
      return;
    }

    try {
      new URL(profile.apiUrl);
    } catch (error) {
      showToast('error', getLocalizedText('toast_ai_invalid_api_url', 'The API URL is invalid.'));
      return;
    }

    const target = normalizeTargetContext(targetContext);
    if (!target) return;

    const requestId = createAiPendingRequestId();
    registerAiPendingRequest(requestId, {
      targetType: target.type,
      targetMode: target.mode,
      charIndex: target.type === 'character' ? target.charIndex : -1,
      sourceText
    });

    let activePendingTag = pendingTag;
    const isRetranslatingExistingTag = !!existingTag && !pendingTag;
    if (activePendingTag) {
      // 重试时复用原胶囊，只重置请求状态，不改变用户看到的位置。
      const restarted = restartPendingAiTag(target, activePendingTag, requestId);
      if (!restarted) {
        cleanupAiPendingRequest(requestId);
        return;
      }
    } else if (existingTag) {
      activePendingTag = existingTag;
      const restarted = startRetranslateAiTag(target, existingTag, requestId);
      if (!restarted) {
        cleanupAiPendingRequest(requestId);
        return;
      }
    } else {
      activePendingTag = tagEditor.addTag({
        value: AI_PENDING_PLACEHOLDER_VALUE,
        aiOriginal: sourceText,
        aiPending: true,
        aiPendingStartedAt: Date.now(),
        aiPendingRequestId: requestId
      });
      if (!activePendingTag) {
        cleanupAiPendingRequest(requestId);
        return;
      }

      if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
      }
    }

    syncPendingVisualTimer();

    const granted = await ensureAiApiPermission(profile.apiUrl);
    if (isAiPendingRequestCanceled(requestId)) {
      if (isRetranslatingExistingTag) {
        restoreRetranslateAiTag(target, requestId);
      }
      cleanupAiPendingRequest(requestId);
      syncPendingVisualTimer();
      return;
    }

    if (!granted) {
      const message = getLocalizedText('toast_ai_permission_denied', 'The API origin permission was denied.');
      if (isRetranslatingExistingTag) {
        restoreRetranslateAiTag(target, requestId);
      } else {
        markPendingAiTagFailed(target, requestId, message);
      }
      cleanupAiPendingRequest(requestId);
      showToast('warning', message);
      return;
    }

    setAiTranslateButtonLoading(buttonEl, true);
    try {
      const controller = new AbortController();
      setAiPendingRequestController(requestId, controller);
      const translatedText = await aiTranslateText(sourceText, profile, { controller });
      if (isAiPendingRequestCanceled(requestId)) {
        if (isRetranslatingExistingTag) {
          restoreRetranslateAiTag(target, requestId);
        }
        return;
      }

      const replaced = resolvePendingAiTag(target, requestId, translatedText);
      if (!replaced) return;

    } catch (error) {
      if (isAiPendingRequestCanceled(requestId)) {
        if (isRetranslatingExistingTag) {
          restoreRetranslateAiTag(target, requestId);
        }
        return;
      }

      const errorMessage = formatAiTranslateError(error);
      console.error('[AI Translate] 翻译失败:', error);
      if (isRetranslatingExistingTag) {
        restoreRetranslateAiTag(target, requestId);
      } else {
        markPendingAiTagFailed(target, requestId, errorMessage);
      }
      showToast('error', errorMessage);
    } finally {
      cleanupAiPendingRequest(requestId);
      setAiTranslateButtonLoading(buttonEl, false);
      syncPendingVisualTimer();
    }
  }

  function bindSettingsUI() {
    const settingsRoot = document.getElementById('ai-translate-settings');
    if (!settingsRoot || settingsRoot.dataset.bound === 'true') return;
    settingsRoot.dataset.bound = 'true';

    const profileSelect = document.getElementById('ai-profile-select');
    const newProfileButton = document.getElementById('btn-ai-profile-new');
    const deleteProfileButton = document.getElementById('btn-ai-profile-delete');
    const watchedInputs = [
      document.getElementById('ai-profile-name'),
      document.getElementById('ai-api-url'),
      document.getElementById('ai-api-key'),
      document.getElementById('ai-model'),
      document.getElementById('ai-system-prompt'),
      document.getElementById('ai-tag-annotation-prompt')
    ].filter(Boolean);

    const scheduleSave = () => {
      if (settingsSaveTimer !== null) lifecycleScope.cancelTimeout(settingsSaveTimer);
      settingsSaveTimer = lifecycleScope.timeout(() => {
        persistAiTranslateProfileForm().catch((error) => {
          console.error('[AI Translate] 保存配置失败:', error);
        });
      }, 250);
    };

    const flushPendingSave = async () => {
      if (settingsSaveTimer !== null) {
        lifecycleScope.cancelTimeout(settingsSaveTimer);
        settingsSaveTimer = null;
      }
      await persistAiTranslateProfileForm();
    };

    profileSelect?.addEventListener('change', async (event) => {
      const nextProfileId = String(event?.target?.value || profileSelect.value || '').trim();
      if (!nextProfileId) return;

      await flushPendingSave();
      const nextConfig = cloneDeep(aiTranslateConfigState || normalizeAiTranslateConfig());
      if (!nextConfig.profiles.some((profile) => profile.id === nextProfileId)) return;
      nextConfig.activeProfileId = nextProfileId;
      await saveConfig(nextConfig);
      populateAiTranslateProfileForm();
    });

    newProfileButton?.addEventListener('click', async () => {
      await flushPendingSave();
      const nextConfig = cloneDeep(aiTranslateConfigState || normalizeAiTranslateConfig());
      const newProfile = createDefaultAiProfile(nextConfig.profiles.length + 1);
      nextConfig.profiles.push(newProfile);
      nextConfig.activeProfileId = newProfile.id;
      await saveConfig(nextConfig);
      populateAiTranslateProfileForm();
      showToast('success', getLocalizedText('toast_ai_profile_created', 'AI profile created.'));
    });

    deleteProfileButton?.addEventListener('click', async () => {
      await flushPendingSave();
      if (!aiTranslateConfigState || aiTranslateConfigState.profiles.length <= 1) {
        showToast('warning', getLocalizedText('toast_ai_profile_delete_last', 'Keep at least one AI profile.'));
        return;
      }

      const nextConfig = cloneDeep(aiTranslateConfigState);
      const profileIndex = nextConfig.profiles.findIndex((profile) => profile.id === nextConfig.activeProfileId);
      if (profileIndex === -1) return;

      nextConfig.profiles.splice(profileIndex, 1);
      nextConfig.activeProfileId = nextConfig.profiles[Math.max(0, profileIndex - 1)].id;
      await saveConfig(nextConfig);
      populateAiTranslateProfileForm();
      showToast('success', getLocalizedText('toast_ai_profile_deleted', 'AI profile deleted.'));
    });

    watchedInputs.forEach((input) => {
      input.addEventListener('input', scheduleSave);
      input.addEventListener('change', scheduleSave);
    });

    loadConfig()
      .then(() => {
        populateAiTranslateProfileForm();
      })
      .catch((error) => {
        console.error('[AI Translate] 加载配置失败:', error);
      });
  }

  function destroy() {
    for (const [requestId, state] of aiPendingRequestMap.entries()) {
      if (state?.controller && !state.controller.signal.aborted) {
        state.controller.abort();
      }
      state.canceled = true;
      state.cancelReason = 'destroy';
      aiPendingRequestMap.delete(requestId);
    }
    if (aiPendingVisualTimer !== null) {
      lifecycleScope.cancelInterval(aiPendingVisualTimer);
      aiPendingVisualTimer = null;
    }
    if (settingsSaveTimer !== null) {
      lifecycleScope.cancelTimeout(settingsSaveTimer);
      settingsSaveTimer = null;
    }
  }

  return {
    loadConfig,
    bindSettingsUI,
    translateFromInput,
    annotateTags,
    handleRemovedTags,
    preservePendingTags,
    isPendingTag,
    getSyncableTagList,
    syncPendingVisualTimer,
    destroy
  };
}
