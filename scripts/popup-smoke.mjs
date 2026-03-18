import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function createStyleDeclaration() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(String(name), String(value));
    },
    getPropertyValue(name) {
      return values.get(String(name)) || '';
    },
    removeProperty(name) {
      values.delete(String(name));
    }
  };
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
    this.detail = init.detail;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {}
  stopImmediatePropagation() {}
}

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!listener) return;
    const key = String(type);
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(listener);
  }

  removeEventListener(type, listener) {
    this._listeners.get(String(type))?.delete(listener);
  }

  async dispatchEvent(event) {
    if (!event || !event.type) return true;
    event.target = event.target || this;
    event.currentTarget = this;
    const listeners = Array.from(this._listeners.get(String(event.type)) || []);
    for (const listener of listeners) {
      const result = listener.call(this, event);
      if (result && typeof result.then === 'function') {
        await result;
      }
    }
    return !event.defaultPrevented;
  }

  getEventListeners(type) {
    return Array.from(this._listeners.get(String(type)) || []);
  }
}

let fakeDocument = null;

class FakeNode extends FakeEventTarget {
  constructor(nodeType, nodeName) {
    super();
    this.nodeType = nodeType;
    this.nodeName = String(nodeName || '').toUpperCase();
    this.ownerDocument = null;
    this.parentNode = null;
    this.childNodes = [];
  }

  appendChild(child) {
    if (!child) return child;
    if (child.nodeType === 11) {
      const nodes = [...child.childNodes];
      nodes.forEach((node) => this.appendChild(node));
      child.childNodes = [];
      return child;
    }
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, referenceNode) {
    if (!referenceNode) return this.appendChild(child);
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    const index = this.childNodes.indexOf(referenceNode);
    child.parentNode = this;
    if (index === -1) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(index, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChildren(...children) {
    this.childNodes.slice().forEach((child) => this.removeChild(child));
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
}

class FakeDocumentFragment extends FakeNode {
  constructor(ownerDocument) {
    super(11, '#document-fragment');
    this.ownerDocument = ownerDocument;
  }

  cloneNode() {
    return new FakeDocumentFragment(this.ownerDocument);
  }

  querySelector(selector) {
    return this.ownerDocument?._ensureQueryElement(selector) || null;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeHTMLElement extends FakeNode {
  constructor(tagName = 'div', ownerDocument = null) {
    super(1, tagName);
    this.tagName = this.nodeName;
    this.ownerDocument = ownerDocument;
    this.id = '';
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 240;
    this.scrollWidth = 320;
    this.clientHeight = 240;
    this.clientWidth = 320;
    this.offsetHeight = 32;
    this.offsetWidth = 160;
    this.dataset = {};
    this.style = createStyleDeclaration();
    this.attributes = new Map();
    this.className = '';
    this.title = '';
    this.placeholder = '';
    this.type = '';
    this.classList = {
      add: (...names) => this._mutateClassList(names, true),
      remove: (...names) => this._mutateClassList(names, false),
      toggle: (name, force) => this._toggleClass(String(name), force),
      contains: (name) => this._getClassSet().has(String(name))
    };
    // 为 template 保留 content，其他元素也提供同名属性，方便宽松访问。
    this.content = new FakeDocumentFragment(ownerDocument);
  }

  _getClassSet() {
    return new Set(String(this.className || '').split(/\s+/).filter(Boolean));
  }

  _writeClassSet(classSet) {
    this.className = Array.from(classSet).join(' ');
  }

  _mutateClassList(names, shouldAdd) {
    const classSet = this._getClassSet();
    names.forEach((name) => {
      const value = String(name || '').trim();
      if (!value) return;
      if (shouldAdd) classSet.add(value);
      else classSet.delete(value);
    });
    this._writeClassSet(classSet);
  }

  _toggleClass(name, force) {
    const classSet = this._getClassSet();
    const hasClass = classSet.has(name);
    const shouldAdd = force === undefined ? !hasClass : !!force;
    if (shouldAdd) classSet.add(name);
    else classSet.delete(name);
    this._writeClassSet(classSet);
    return shouldAdd;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    const elements = this.children;
    return elements[elements.length - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children || [];
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children || [];
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] || null : null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.replaceChildren();
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  setAttribute(name, value) {
    const key = String(name);
    const normalizedValue = String(value);
    this.attributes.set(key, normalizedValue);
    if (key === 'id') this.id = normalizedValue;
    if (key === 'class') this.className = normalizedValue;
    if (key.startsWith('data-')) {
      const dataKey = key
        .slice(5)
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      this.dataset[dataKey] = normalizedValue;
    }
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  toggleAttribute(name, force) {
    if (force === false) {
      this.removeAttribute(name);
      return false;
    }
    this.setAttribute(name, '');
    return true;
  }

  focus() {}
  blur() {}
  click() {}
  select() {}

  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    return this.childNodes.some((child) => typeof child.contains === 'function' && child.contains(node));
  }

  matches() {
    return false;
  }

  closest() {
    return null;
  }

  querySelector(selector) {
    return this.ownerDocument?._ensureQueryElement(`${this.id || this.tagName}:${selector}`) || null;
  }

  querySelectorAll() {
    return [];
  }

  getElementsByTagName() {
    return [];
  }

  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight
    };
  }

  cloneNode() {
    const clone = new FakeHTMLElement(this.tagName, this.ownerDocument);
    clone.className = this.className;
    clone.value = this.value;
    clone.textContent = this.textContent;
    clone.placeholder = this.placeholder;
    clone.title = this.title;
    clone.disabled = this.disabled;
    clone.content = this.content.cloneNode(true);
    return clone;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this._elementsById = new Map();
    this._queryElements = new Map();
    this.documentElement = new FakeHTMLElement('html', this);
    this.body = new FakeHTMLElement('body', this);
    this.documentElement.appendChild(this.body);
    this.defaultView = null;
    this.scrollingElement = this.documentElement;
  }

  _ensureElement(id, tagName = 'div') {
    const key = String(id);
    if (!this._elementsById.has(key)) {
      const element = new FakeHTMLElement(tagName, this);
      element.id = key;
      this._elementsById.set(key, element);
    }
    return this._elementsById.get(key);
  }

  _ensureQueryElement(selector) {
    const key = String(selector);
    if (!this._queryElements.has(key)) {
      this._queryElements.set(key, new FakeHTMLElement('div', this));
    }
    return this._queryElements.get(key);
  }

  createElement(tagName) {
    const element = new FakeHTMLElement(tagName, this);
    if (String(tagName).toLowerCase() === 'template') {
      element.content = new FakeDocumentFragment(this);
    }
    return element;
  }

  createDocumentFragment() {
    return new FakeDocumentFragment(this);
  }

  createEvent() {
    return {
      initEvent(type, bubbles = false, cancelable = false) {
        this.type = type;
        this.bubbles = bubbles;
        this.cancelable = cancelable;
      }
    };
  }

  getElementById(id) {
    return this._ensureElement(id);
  }

  querySelector(selector) {
    return this._ensureQueryElement(selector);
  }

  querySelectorAll() {
    return [];
  }

  elementFromPoint() {
    return this.body;
  }
}

const storageState = {
  promptHistory: [],
  wildcards: {},
  groupColorMap: {},
  groupTranslationMap: {}
};

const storageListeners = new Set();
const runtimeMessageListeners = new Set();
const windowEventTarget = new FakeEventTarget();

function pickStorage(keys) {
  if (keys == null) {
    return { ...storageState };
  }
  if (typeof keys === 'string') {
    return { [keys]: storageState[keys] };
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storageState[key]]));
  }
  if (typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [key, key in storageState ? storageState[key] : fallback])
    );
  }
  return {};
}

function emitStorageChanges(nextValues) {
  const changes = {};
  for (const [key, newValue] of Object.entries(nextValues || {})) {
    changes[key] = {
      oldValue: storageState[key],
      newValue
    };
  }
  Object.assign(storageState, nextValues || {});
  storageListeners.forEach((listener) => listener(changes, 'local'));
}

function installGlobalStubs() {
  fakeDocument = new FakeDocument();
  fakeDocument.defaultView = globalThis;

  Object.defineProperty(globalThis, 'self', {
    value: globalThis,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'document', {
    value: fakeDocument,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'Node', {
    value: FakeNode,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: FakeHTMLElement,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'HTMLInputElement', {
    value: FakeHTMLElement,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    value: FakeHTMLElement,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'DocumentFragment', {
    value: FakeDocumentFragment,
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      language: 'en-US',
      userAgent: 'popup-smoke'
    },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'location', {
    value: {
      search: '',
      href: 'https://example.invalid/popup.html'
    },
    configurable: true,
    writable: true
  });

  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = (...args) => windowEventTarget.addEventListener(...args);
  globalThis.removeEventListener = (...args) => windowEventTarget.removeEventListener(...args);
  globalThis.dispatchEvent = (...args) => windowEventTarget.dispatchEvent(...args);
  globalThis.getEventListeners = (...args) => windowEventTarget.getEventListeners(...args);
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.getComputedStyle = () => ({
    getPropertyValue() {
      return '';
    },
    overflowX: 'visible',
    overflowY: 'visible',
    display: 'block',
    position: 'static',
    transition: '',
    transform: 'none'
  });
  globalThis.postMessage = () => {};
  globalThis.CustomEvent = class CustomEvent extends FakeEvent {};
  globalThis.Event = FakeEvent;
  globalThis.MutationObserver = class MutationObserver {
    observe() {}
    disconnect() {}
  };
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    disconnect() {}
  };
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  };

  globalThis.GroupTagsDataUtils = {
    cloneData(data) {
      return JSON.parse(JSON.stringify(data || { categories: [] }));
    },
    async loadEffectiveDictionaryData() {
      return {
        entries: [],
        entryMap: new Map()
      };
    },
    toCanonicalTagKey(value) {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    },
    canonicalToDisplayTag(value) {
      return String(value || '').replace(/_/g, ' ');
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const result = pickStorage(keys);
          if (typeof callback === 'function') {
            callback(result);
            return;
          }
          return Promise.resolve(result);
        },
        set(values, callback) {
          emitStorageChanges(values);
          if (typeof callback === 'function') {
            callback();
            return;
          }
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.add(listener);
        },
        removeListener(listener) {
          storageListeners.delete(listener);
        }
      }
    },
    permissions: {
      contains(_details, callback) {
        callback(false);
      },
      request(_details, callback) {
        callback(false);
      }
    },
    tabs: {
      query(_details, callback) {
        callback([{ id: 1, active: true, windowId: 1 }]);
      },
      sendMessage(_tabId, message, callback) {
        if (typeof callback === 'function') {
          if (message?.type === 'GET_SEQUENTIAL_COUNTERS') {
            callback({ sequentialCounters: {} });
          } else {
            callback();
          }
        }
      }
    },
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        if (typeof callback === 'function') {
          callback();
        }
      },
      getURL(relativePath) {
        return pathToFileURL(path.resolve(repoRoot, relativePath)).href;
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageListeners.add(listener);
        },
        removeListener(listener) {
          runtimeMessageListeners.delete(listener);
        }
      }
    }
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: 'ok' } }] };
    },
    async text() {
      return '';
    }
  });
}

async function runPopupSmoke() {
  installGlobalStubs();

  process.on('uncaughtException', (error) => {
    console.error('[popup-smoke] uncaught exception');
    console.error(error?.stack || error);
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    console.error('[popup-smoke] unhandled rejection');
    console.error(error?.stack || error);
    process.exit(1);
  });

  const popupModuleUrl = pathToFileURL(path.resolve(repoRoot, 'pages/popup.js')).href;
  await import(popupModuleUrl);

  const domReadyListeners = fakeDocument.getEventListeners('DOMContentLoaded');
  if (domReadyListeners.length === 0) {
    throw new Error('popup-smoke: DOMContentLoaded listener was not registered');
  }

  // 真实驱动 popup 入口链路，捕获 initUI / initData / initCommunication 阶段的运行时断点。
  for (const listener of domReadyListeners) {
    const result = listener(new FakeEvent('DOMContentLoaded', { target: fakeDocument }));
    if (result && typeof result.then === 'function') {
      await result;
    }
  }

  // 给异步初始化和微任务一个短窗口，足够暴露大多数启动级错误。
  await new Promise((resolve) => setTimeout(resolve, 50));

  const pagehideListeners = globalThis.getEventListeners ? globalThis.getEventListeners('pagehide') : [];
  for (const listener of pagehideListeners) {
    const result = listener(new FakeEvent('pagehide', { target: globalThis }));
    if (result && typeof result.then === 'function') {
      await result;
    }
  }

  console.log('POPUP_SMOKE_OK');
}

await runPopupSmoke();
