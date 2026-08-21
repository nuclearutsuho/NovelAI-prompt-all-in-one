// NovelAI 提示词同步控制器：隔离存储、Jotai 能力探测和 DOM 同步细节。
(function initPromptSyncController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NaiAioPromptSync = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptSyncApi() {
  'use strict';

  const BASE_STORAGE_KEYS = Object.freeze({
    positive: 'imagegen-prompt',
    negative: 'imagegen-negativeprompt'
  });
  const CHARACTER_STORAGE_KEY = 'imagegen-character-prompts';

  function valuesEqual(left, right) {
    if (left === right) return true;
    if (typeof left !== typeof right || !left || typeof left !== 'object') return false;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch (_) {
      return false;
    }
  }

  function createController(options = {}) {
    const {
      runtime,
      parentScope = null,
      compat,
      domAdapter,
      windowRef = typeof window !== 'undefined' ? window : null,
      logger = console,
      attachPromptMeta = value => value,
      updateBasePromptMeta = () => {},
      updateCharacterPromptMeta = () => {},
      onSyncStateChange = () => {}
    } = options;

    if (!runtime?.acquire) throw new TypeError('[Prompt Sync] 缺少运行时生命周期内核');
    if (!compat?.normalizeCharacterStorage) throw new TypeError('[Prompt Sync] 缺少 NovelAI 兼容层');
    if (!domAdapter) throw new TypeError('[Prompt Sync] 缺少 DOM 提示词适配器');
    if (!windowRef) throw new TypeError('[Prompt Sync] 缺少 window 对象');

    const scope = runtime.acquire('page:prompt-sync');
    if (parentScope?.add) parentScope.add(() => scope.dispose('parent-disposed'));

    const atomCache = new Map();
    const missingAtomMountedCounts = new Map();
    let syncQueue = Promise.resolve();
    let syncing = false;
    let activeSyncOperations = 0;
    let syncReleaseTimer = null;
    let syncReleaseGeneration = 0;
    let lastActiveTabs = { base: null, chars: [] };
    let pendingPromptRead = null;

    function setSyncing(value) {
      const nextValue = Boolean(value);
      if (syncing === nextValue) return;
      syncing = nextValue;
      onSyncStateChange(syncing);
    }

    function cancelSyncRelease() {
      syncReleaseGeneration += 1;
      if (syncReleaseTimer === null) return;
      scope.cancelTimeout(syncReleaseTimer);
      syncReleaseTimer = null;
    }

    function beginSyncOperation() {
      activeSyncOperations += 1;
      cancelSyncRelease();
      setSyncing(true);
    }

    function finishSyncOperation() {
      activeSyncOperations = Math.max(0, activeSyncOperations - 1);
      if (activeSyncOperations > 0) return;

      // 保留短暂静默期，用于吸收官网控件在写入后的尾部 DOM 变更；
      // 新任务开始时会取消旧计时器，避免前一个任务提前解除后一个任务的同步锁。
      const releaseGeneration = ++syncReleaseGeneration;
      syncReleaseTimer = scope.timeout(() => {
        syncReleaseTimer = null;
        if (activeSyncOperations === 0 && releaseGeneration === syncReleaseGeneration) {
          setSyncing(false);
        }
      }, 100);
    }

    function readStorage(storageKey) {
      try {
        const rawValue = windowRef.localStorage.getItem(storageKey);
        if (rawValue === null) return undefined;
        try {
          return JSON.parse(rawValue);
        } catch (_) {
          return rawValue;
        }
      } catch (error) {
        logger.warn?.(`[Prompt Sync] 无法读取 ${storageKey}:`, error);
        return undefined;
      }
    }

    function persistStorage(storageKey, value) {
      try {
        const serialized = JSON.stringify(value);
        windowRef.localStorage.setItem(storageKey, serialized);
        windowRef.dispatchEvent(new StorageEvent('storage', {
          key: storageKey,
          newValue: serialized,
          storageArea: windowRef.localStorage
        }));
        return true;
      } catch (error) {
        logger.error?.(`[Prompt Sync] 无法写入 ${storageKey}:`, error);
        return false;
      }
    }

    function getJotaiStore() {
      return windowRef.__JOTAI_DEFAULT_STORE__ || null;
    }

    // Jotai 是可选能力。只做无副作用匹配，匹配失败时保持静默并使用 DOM 基线。
    function findAtom(storageKey) {
      const store = getJotaiStore();
      if (!store?.dev4_get_mounted_atoms) return null;

      const cached = atomCache.get(storageKey);
      if (cached) {
        try {
          store.get(cached);
          return cached;
        } catch (_) {
          atomCache.delete(storageKey);
        }
      }

      const mounted = Array.from(store.dev4_get_mounted_atoms());
      if (missingAtomMountedCounts.get(storageKey) === mounted.length) return null;

      let atom = mounted.find(candidate => {
        try {
          return String(candidate).includes(storageKey)
            || candidate.debugLabel?.includes(storageKey)
            || candidate.key === storageKey
            || Object.keys(candidate).some(key => candidate[key] === storageKey);
        } catch (_) {
          return false;
        }
      });

      if (!atom) {
        const targetValue = readStorage(storageKey);
        const candidates = mounted.filter(candidate => {
          if (!candidate.write) return false;
          try {
            return valuesEqual(store.get(candidate), targetValue);
          } catch (_) {
            return false;
          }
        });
        if (candidates.length === 1) atom = candidates[0];
      }

      if (atom) {
        atomCache.set(storageKey, atom);
        missingAtomMountedCounts.delete(storageKey);
      } else {
        missingAtomMountedCounts.set(storageKey, mounted.length);
        logger.debug?.(`[Prompt Sync] ${storageKey} 未暴露可识别的 Jotai atom，使用 DOM 适配层。`);
      }
      return atom || null;
    }

    function trySetThroughJotai(storageKey, value) {
      const store = getJotaiStore();
      const atom = findAtom(storageKey);
      if (!store || !atom) return false;
      try {
        store.set(atom, value);
        return true;
      } catch (error) {
        atomCache.delete(storageKey);
        logger.warn?.(`[Prompt Sync] Jotai 写入 ${storageKey} 失败，切换到 DOM:`, error);
        return false;
      }
    }

    function readCurrentDomPrompts() {
      const domPositive = domAdapter.readBasePrompt('positive');
      const domNegative = domAdapter.readBasePrompt('negative');
      const visibleCharacters = domAdapter.readVisibleCharacterPrompts();
      const characterUiAvailable = domAdapter.hasCharacterUi?.() ?? visibleCharacters.length > 0;

      return {
        ready:
          domPositive !== undefined &&
          domNegative !== undefined &&
          characterUiAvailable,
        state: {
          positive: domPositive,
          negative: domNegative,
          // V5 不再可靠维护旧 localStorage 键；DOM 未就绪时宁可等待，也不能返回旧值。
          characters: characterUiAvailable ? visibleCharacters : []
        }
      };
    }

    function getCurrentPrompts() {
      return attachPromptMeta(readCurrentDomPrompts().state);
    }

    async function getAccurateCurrentPrompts() {
      const initialSnapshot = readCurrentDomPrompts();
      if (!initialSnapshot.ready) {
        return { ok: false, reason: 'dom-not-ready' };
      }

      beginSyncOperation();
      try {
        // 进入静默临界区后重新读取，避免检查与扫描之间发生页面重绘。
        const currentSnapshot = readCurrentDomPrompts();
        if (!currentSnapshot.ready) {
          return { ok: false, reason: 'dom-became-unavailable' };
        }

        if (typeof domAdapter.readAllCharacterPromptsDOM !== 'function') {
          return { ok: false, reason: 'character-reader-unavailable' };
        }

        const characterRead = await domAdapter.readAllCharacterPromptsDOM();
        if (!characterRead?.ok || !Array.isArray(characterRead.characters)) {
          return {
            ok: false,
            reason: 'character-read-incomplete',
            failures: characterRead?.failures || []
          };
        }

        currentSnapshot.state.characters = characterRead.characters;
        return {
          ok: true,
          state: attachPromptMeta(currentSnapshot.state),
          restorationFailures: characterRead.restorationFailures || []
        };
      } finally {
        finishSyncOperation();
      }
    }

    function enqueue(task) {
      const run = syncQueue.then(task, task);
      const handled = run.catch(error => logger.error?.('[Prompt Sync] 同步任务失败:', error));
      syncQueue = handled;
      return handled;
    }

    function requestAccuratePromptSnapshot() {
      // Popup 初始化会同时走 tab 消息和 runtime 广播；共享同一个读取任务，避免重复切换所有角色页签。
      if (pendingPromptRead) return pendingPromptRead;

      const task = enqueue(async () => {
        const result = await getAccurateCurrentPrompts();
        if (!result.ok) {
          if (result.reason === 'dom-not-ready' || result.reason === 'dom-became-unavailable') {
            logger.debug?.('[Prompt Sync] NovelAI 提示词 DOM 尚未就绪，等待弹窗重试。');
          } else {
            logger.warn?.('[Prompt Sync] 放弃发布不完整的提示词快照:', result);
          }
          return;
        }

        if (result.restorationFailures.length > 0) {
          logger.warn?.('[Prompt Sync] 角色读取完成，但页面状态恢复不完整:', result.restorationFailures);
        }

        const { positive, negative, positiveTags, negativeTags, characters } = result.state;
        windowRef.postMessage({
          type: '__RETURN_PROMPT__',
          data: {
            positive,
            negative,
            ...(Array.isArray(positiveTags) ? { positiveTags } : {}),
            ...(Array.isArray(negativeTags) ? { negativeTags } : {})
          }
        }, '*');
        windowRef.postMessage({ type: '__RETURN_CHARACTER_PROMPTS__', data: characters }, '*');
      });

      pendingPromptRead = task;
      task.finally(() => {
        if (pendingPromptRead === task) pendingPromptRead = null;
      });
      return task;
    }

    async function syncBasePrompts(data) {
      beginSyncOperation();
      try {
        const domPayload = {};
        for (const [mode, storageKey] of Object.entries(BASE_STORAGE_KEYS)) {
          const value = data?.[mode];
          if (value === undefined) continue;
          if (!trySetThroughJotai(storageKey, value)) {
            persistStorage(storageKey, value);
            domPayload[mode] = value;
          }
        }

        const result = await domAdapter.syncBasePromptsDOM(domPayload);
        if (!result.ok) logger.error?.('[Prompt Sync] 基础提示词同步不完整:', result.failures);
        updateBasePromptMeta(data || {});
      } finally {
        finishSyncOperation();
      }
    }

    async function syncCharacterPrompts(data) {
      beginSyncOperation();
      try {
        const characters = Array.isArray(data) ? data : [];
        const existing = readStorage(CHARACTER_STORAGE_KEY);
        const nextCharacters = compat.normalizeCharacterStorage(existing, characters);
        if (!trySetThroughJotai(CHARACTER_STORAGE_KEY, nextCharacters)) {
          persistStorage(CHARACTER_STORAGE_KEY, nextCharacters);
          const result = await domAdapter.syncCharacterPromptsDOM(characters);
          if (!result.ok) logger.error?.('[Prompt Sync] 角色提示词同步不完整:', result.failures);
        }
        updateCharacterPromptMeta(characters);
      } finally {
        finishSyncOperation();
      }
    }

    function handleMessage(event) {
      if (event.source !== windowRef) return;
      const { type, data } = event.data || {};

      if (type === '__GET_PROMPT__') {
        requestAccuratePromptSnapshot();
        return;
      }

      if (type === '__SET_PROMPT__') {
        enqueue(() => syncBasePrompts(data));
        return;
      }
      if (type === '__SET_CHARACTER_PROMPTS__') {
        enqueue(() => syncCharacterPrompts(data));
        return;
      }
      if (type === '__SWITCH_TAB__') {
        enqueue(async () => {
          const { tab, index } = data || {};
          const switched = index !== undefined && index >= 0
            ? await domAdapter.switchCharacterTabAt(index, tab)
            : await domAdapter.switchBaseTab(tab);
          if (!switched) logger.warn?.('[Prompt Sync] 无法切换提示词页签:', { tab, index });
        });
      }
    }

    function pollActiveTabs() {
      // 写入和完整回读都会暂时切换官网页签，不能把这些内部状态广播给弹窗。
      if (syncing) return;

      const currentBaseTab = domAdapter.getBaseTab();
      if (currentBaseTab && currentBaseTab !== lastActiveTabs.base) {
        lastActiveTabs.base = currentBaseTab;
        windowRef.postMessage({ type: '__SYNC_TAB__', data: { tab: currentBaseTab, index: -1 } }, '*');
      }

      const currentCharacterTabs = domAdapter.getCharacterTabStates();
      currentCharacterTabs.forEach((currentTab, index) => {
        if (currentTab && currentTab !== lastActiveTabs.chars[index]) {
          lastActiveTabs.chars[index] = currentTab;
          windowRef.postMessage({ type: '__SYNC_TAB__', data: { tab: currentTab, index } }, '*');
        }
      });
      if (lastActiveTabs.chars.length > currentCharacterTabs.length) {
        lastActiveTabs.chars.length = currentCharacterTabs.length;
      }
    }

    scope.on(windowRef, 'message', handleMessage);
    scope.interval(pollActiveTabs, 500);
    scope.add(() => {
      cancelSyncRelease();
      activeSyncOperations = 0;
      setSyncing(false);
    });

    return Object.freeze({
      getCurrentPrompts,
      isSyncing: () => syncing,
      readStorage,
      dispose: () => scope.dispose('controller-disposed')
    });
  }

  return Object.freeze({
    BASE_STORAGE_KEYS,
    CHARACTER_STORAGE_KEY,
    createController
  });
});
