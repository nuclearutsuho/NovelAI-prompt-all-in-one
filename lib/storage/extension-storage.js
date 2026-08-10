// Chrome 扩展存储仓库：统一默认值、数据校验、版本迁移与损坏数据备份。
(function initExtensionStorage(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NaiAioStorage = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExtensionStorageApi() {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 1;
  const SCHEMA_VERSION_KEY = 'naiAioSchemaVersion';
  const MIGRATION_BACKUP_KEY = 'naiAioMigrationBackupV1';
  const repositoryCache = new WeakMap();

  const BRIDGE_SETTING_KEYS = Object.freeze([
    'wildcards',
    'wildcardFolders',
    'wildcardUsageStats',
    'v3mode',
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'triggerTab',
    'triggerSpace',
    'multiResConfig',
    'hideAutoClicker',
    'autoClickerI18n',
    'hotkeys',
    'sequentialStepSettings'
  ]);

  const HISTORY_KEYS = Object.freeze([
    'promptHistory',
    'historyLimit',
    'groupColorMap',
    'groupTranslationMap',
    'enableGrouping'
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeRecord(value) {
    return isRecord(value) ? value : {};
  }

  function normalizeOptionalRecord(value) {
    return isRecord(value) ? value : null;
  }

  function normalizeHistoryLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(10, Math.min(1000, parsed));
  }

  function normalizeBridgeSettings(raw = {}) {
    return {
      wildcards: normalizeRecord(raw.wildcards),
      wildcardFolders: Array.isArray(raw.wildcardFolders) ? raw.wildcardFolders : [],
      wildcardUsageStats: normalizeRecord(raw.wildcardUsageStats),
      v3mode: raw.v3mode === true,
      preservePrompt: raw.preservePrompt !== false,
      alternativeDanbooruAutocomplete: raw.alternativeDanbooruAutocomplete !== false,
      triggerTab: raw.triggerTab === true,
      triggerSpace: raw.triggerSpace !== false,
      multiResConfig: normalizeOptionalRecord(raw.multiResConfig),
      hideAutoClicker: raw.hideAutoClicker === true,
      autoClickerI18n: normalizeOptionalRecord(raw.autoClickerI18n),
      hotkeys: normalizeOptionalRecord(raw.hotkeys),
      sequentialStepSettings: normalizeRecord(raw.sequentialStepSettings)
    };
  }

  function normalizeHistoryState(raw = {}) {
    return {
      history: Array.isArray(raw.promptHistory) ? raw.promptHistory : [],
      limit: normalizeHistoryLimit(raw.historyLimit),
      groupColorMap: normalizeRecord(raw.groupColorMap),
      groupTranslationMap: normalizeRecord(raw.groupTranslationMap),
      enableGrouping: raw.enableGrouping !== false
    };
  }

  function buildMigrationPatch(raw = {}) {
    const patch = { [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION };
    const backup = {};

    const repair = (key, isValid, fallback) => {
      if (raw[key] === undefined || isValid(raw[key])) return;
      backup[key] = raw[key];
      patch[key] = fallback;
    };

    repair('wildcards', isRecord, {});
    repair('wildcardFolders', Array.isArray, []);
    repair('wildcardUsageStats', isRecord, {});
    repair('promptHistory', Array.isArray, []);
    repair('groupColorMap', isRecord, {});
    repair('groupTranslationMap', isRecord, {});

    if (raw.historyLimit !== undefined) {
      const normalizedLimit = normalizeHistoryLimit(raw.historyLimit);
      if (normalizedLimit !== raw.historyLimit) {
        backup.historyLimit = raw.historyLimit;
        patch.historyLimit = normalizedLimit;
      }
    }

    if (Object.keys(backup).length > 0) {
      patch[MIGRATION_BACKUP_KEY] = {
        createdAt: Date.now(),
        fromVersion: Number(raw[SCHEMA_VERSION_KEY]) || 0,
        data: backup
      };
    }
    return patch;
  }

  function createRepository(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) {
      throw new TypeError('[NAI Storage] 缺少有效的 chrome.storage 区域');
    }
    if (repositoryCache.has(storageArea)) return repositoryCache.get(storageArea);
    const logger = options.logger || console;
    let migrationPromise = null;

    async function get(keys) {
      try {
        return await storageArea.get(keys);
      } catch (error) {
        logger.error?.('[NAI Storage] 读取扩展存储失败:', error);
        throw error;
      }
    }

    async function set(values) {
      try {
        await storageArea.set(values);
      } catch (error) {
        logger.error?.('[NAI Storage] 写入扩展存储失败:', error);
        throw error;
      }
    }

    async function remove(keys) {
      if (typeof storageArea.remove !== 'function') {
        throw new TypeError('[NAI Storage] 当前存储区域不支持删除操作');
      }
      try {
        await storageArea.remove(keys);
      } catch (error) {
        logger.error?.('[NAI Storage] 删除扩展存储失败:', error);
        throw error;
      }
    }

    function ensureMigrated() {
      if (migrationPromise) return migrationPromise;
      migrationPromise = (async () => {
        const keys = [
          SCHEMA_VERSION_KEY,
          ...BRIDGE_SETTING_KEYS,
          ...HISTORY_KEYS
        ];
        const raw = await get(keys);
        const currentVersion = Number(raw[SCHEMA_VERSION_KEY]) || 0;
        if (currentVersion >= CURRENT_SCHEMA_VERSION) return currentVersion;

        const patch = buildMigrationPatch(raw);
        await set(patch);
        logger.info?.(`[NAI Storage] 数据结构已迁移到 v${CURRENT_SCHEMA_VERSION}`);
        return CURRENT_SCHEMA_VERSION;
      })().catch(error => {
        migrationPromise = null;
        throw error;
      });
      return migrationPromise;
    }

    async function readBridgeSettings() {
      await ensureMigrated();
      return normalizeBridgeSettings(await get(BRIDGE_SETTING_KEYS));
    }

    async function readHistoryState() {
      await ensureMigrated();
      return normalizeHistoryState(await get(HISTORY_KEYS));
    }

    function writeHistory(history) {
      if (!Array.isArray(history)) {
        return Promise.reject(new TypeError('[NAI Storage] 历史记录必须是数组'));
      }
      return set({ promptHistory: history });
    }

    function writeHistoryLimit(limit) {
      return set({ historyLimit: normalizeHistoryLimit(limit) });
    }

    const repository = Object.freeze({
      ensureMigrated,
      get,
      set,
      remove,
      readBridgeSettings,
      readHistoryState,
      writeHistory,
      writeHistoryLimit
    });
    repositoryCache.set(storageArea, repository);
    return repository;
  }

  return Object.freeze({
    CURRENT_SCHEMA_VERSION,
    SCHEMA_VERSION_KEY,
    MIGRATION_BACKUP_KEY,
    BRIDGE_SETTING_KEYS,
    HISTORY_KEYS,
    isRecord,
    normalizeHistoryLimit,
    normalizeBridgeSettings,
    normalizeHistoryState,
    buildMigrationPatch,
    createRepository
  });
});
