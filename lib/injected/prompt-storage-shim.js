(function() {
  if (window.__NAI_AIO_PROMPT_STORAGE_SHIM__) return;
  window.__NAI_AIO_PROMPT_STORAGE_SHIM__ = true;

  const TARGET_KEYS = new Set([
    'imagegen-prompt',
    'imagegen-negativeprompt',
    'imagegen-character-prompts'
  ]);
  const SESSION_PREFIX = '__nai_aio_prompt_scope__:';
  const INIT_PREFIX = '__nai_aio_prompt_scope_init__:';
  const TEMPLATE_PREFIX = '__nai_aio_prompt_template__:';
  const storageProto = Storage.prototype;
  const originalGetItem = storageProto.getItem;
  const originalSetItem = storageProto.setItem;
  const originalRemoveItem = storageProto.removeItem;
  const localStore = window.localStorage;
  const sessionStore = window.sessionStorage;

  function isTargetKey(key) {
    return TARGET_KEYS.has(String(key || ''));
  }

  function isScopedLocalStorage(target, key) {
    return target === localStore && isTargetKey(key);
  }

  function scopedSessionKey(key) {
    return SESSION_PREFIX + key;
  }

  function initSessionKey(key) {
    return INIT_PREFIX + key;
  }

  function templateStorageKey(key) {
    return TEMPLATE_PREFIX + key;
  }

  function ensureScopedValue(key) {
    const scopeInitKey = initSessionKey(key);
    if (sessionStore.getItem(scopeInitKey) !== null) return;

    const templateValue = originalGetItem.call(localStore, templateStorageKey(key));
    const fallbackValue = originalGetItem.call(localStore, key);
    const seedValue = templateValue !== null ? templateValue : fallbackValue;

    if (seedValue !== null && sessionStore.getItem(scopedSessionKey(key)) === null) {
      sessionStore.setItem(scopedSessionKey(key), seedValue);
    }
    sessionStore.setItem(scopeInitKey, '1');
  }

  storageProto.getItem = function(key) {
    if (isScopedLocalStorage(this, key)) {
      const normalizedKey = String(key);
      ensureScopedValue(normalizedKey);
      return sessionStore.getItem(scopedSessionKey(normalizedKey));
    }
    return originalGetItem.call(this, key);
  };

  storageProto.setItem = function(key, value) {
    if (isScopedLocalStorage(this, key)) {
      const normalizedKey = String(key);
      ensureScopedValue(normalizedKey);
      const serializedValue = String(value);
      sessionStore.setItem(scopedSessionKey(normalizedKey), serializedValue);
      originalSetItem.call(localStore, templateStorageKey(normalizedKey), serializedValue);
      return;
    }
    return originalSetItem.call(this, key, value);
  };

  storageProto.removeItem = function(key) {
    if (isScopedLocalStorage(this, key)) {
      const normalizedKey = String(key);
      ensureScopedValue(normalizedKey);
      sessionStore.removeItem(scopedSessionKey(normalizedKey));
      originalRemoveItem.call(localStore, templateStorageKey(normalizedKey));
      return;
    }
    return originalRemoveItem.call(this, key);
  };

  TARGET_KEYS.forEach(ensureScopedValue);
})();
