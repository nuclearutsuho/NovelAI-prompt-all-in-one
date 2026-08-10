(function initNaiAioMessageProtocol(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  // 内容脚本之间通过只读全局对象共享校验逻辑，避免各处重复维护消息白名单。
  root.NaiAioMessageProtocol = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMessageProtocol() {
  const GROUP_PANEL_MESSAGE_TYPES = new Set([
    '__APPEND_TAG_FROM_PANEL__',
    '__REMOVE_TAG_FROM_PANEL__',
    '__SYNC_GROUP_COLORS__',
    '__SYNC_GROUP_TRANSLATIONS__',
    '__CLOSE_GROUP_TAGS_PANEL__'
  ]);

  const MANAGER_PANEL_MESSAGE_TYPES = new Set([
    '__HOTKEY_ACTION__'
  ]);

  const RUNTIME_STATE_MESSAGE_TYPES = new Set([
    '__UPDATE_SEQUENTIAL_COUNTER__',
    '__UPDATE_RANDOM_WILDCARD_LOCKS__',
    '__UPDATE_SEQUENTIAL_STEP_PROGRESS__',
    '__RECORD_WILDCARD_USAGE__',
    '__CLEAN_NUMERIC_PREFIXES__'
  ]);

  const HOTKEY_ACTIONS = new Set([
    'focusBase',
    'toggleMinimize',
    'triggerGenerate'
  ]);

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isBoundedString(value, maxLength = 10000, allowEmpty = false) {
    return typeof value === 'string'
      && value.length <= maxLength
      && (allowEmpty || value.trim().length > 0);
  }

  function isStringMap(value, maxEntries = 10000, maxValueLength = 10000) {
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= maxEntries
      && entries.every(([key, item]) => (
        isBoundedString(key, 1000)
        && isBoundedString(item, maxValueLength, true)
      ));
  }

  function isColorMap(value) {
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 10000
      && entries.every(([key, color]) => (
        isBoundedString(key, 1000)
        && typeof color === 'string'
        && /^#[0-9a-fA-F]{6}$/.test(color)
      ));
  }

  function isFiniteNumberMap(value, maxEntries = 5000) {
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= maxEntries
      && entries.every(([key, item]) => isBoundedString(key, 1000) && Number.isFinite(Number(item)));
  }

  function isKnownMessage(data, knownTypes) {
    return isPlainObject(data)
      && typeof data.type === 'string'
      && knownTypes.has(data.type);
  }

  function getExtensionOrigin(runtime) {
    if (!runtime || typeof runtime.getURL !== 'function') return '';
    try {
      // chrome-extension: 不是标准网络协议，部分 JS 运行时的 URL.origin 会返回 "null"。
      return String(runtime.getURL('/')).replace(/\/+$/, '');
    } catch (_error) {
      return '';
    }
  }

  function isFromIframe(event, iframe, runtime) {
    if (!event || !iframe?.contentWindow || event.source !== iframe.contentWindow) return false;
    const extensionOrigin = getExtensionOrigin(runtime);
    return Boolean(extensionOrigin) && event.origin === extensionOrigin;
  }

  function isValidGroupPanelMessage(data) {
    if (!isKnownMessage(data, GROUP_PANEL_MESSAGE_TYPES)) return false;

    switch (data.type) {
      case '__APPEND_TAG_FROM_PANEL__':
        return isBoundedString(data.tag)
          && (data.zh === undefined || isBoundedString(data.zh, 10000, true));
      case '__REMOVE_TAG_FROM_PANEL__':
        return isBoundedString(data.tag);
      case '__SYNC_GROUP_COLORS__':
        return isColorMap(data.colorMap);
      case '__SYNC_GROUP_TRANSLATIONS__':
        return isStringMap(data.translationMap);
      case '__CLOSE_GROUP_TAGS_PANEL__':
        return true;
      default:
        return false;
    }
  }

  function isValidManagerPanelMessage(data) {
    return isKnownMessage(data, MANAGER_PANEL_MESSAGE_TYPES)
      && HOTKEY_ACTIONS.has(data.action);
  }

  function isValidRuntimeStateMessage(data) {
    if (!isKnownMessage(data, RUNTIME_STATE_MESSAGE_TYPES)) return false;

    switch (data.type) {
      case '__UPDATE_SEQUENTIAL_COUNTER__':
        return isBoundedString(data.name, 1000) && Number.isFinite(Number(data.value));
      case '__UPDATE_SEQUENTIAL_STEP_PROGRESS__':
        return isFiniteNumberMap(data.progress);
      case '__UPDATE_RANDOM_WILDCARD_LOCKS__': {
        if (!isPlainObject(data.locks) || Object.keys(data.locks).length > 5000) return false;
        return Object.entries(data.locks).every(([key, lock]) => (
          isBoundedString(key, 1000)
          && isPlainObject(lock)
          && isBoundedString(lock.picked, 10000)
          && Number.isFinite(Number(lock.progress))
        ));
      }
      case '__RECORD_WILDCARD_USAGE__':
        return Array.isArray(data.records)
          && data.records.length <= 1000
          && data.records.every(record => (
            isPlainObject(record)
            && (record.kind === 'file' || record.kind === 'folder')
            && isBoundedString(record.path, 10000)
            && (record.delta === undefined || Number.isFinite(Number(record.delta)))
          ));
      case '__CLEAN_NUMERIC_PREFIXES__':
        return true;
      default:
        return false;
    }
  }

  return {
    GROUP_PANEL_MESSAGE_TYPES,
    MANAGER_PANEL_MESSAGE_TYPES,
    RUNTIME_STATE_MESSAGE_TYPES,
    isPlainObject,
    isColorMap,
    isFromIframe,
    isValidGroupPanelMessage,
    isValidManagerPanelMessage,
    isValidRuntimeStateMessage
  };
});
