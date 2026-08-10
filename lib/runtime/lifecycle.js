// 扩展运行时生命周期内核：统一管理监听器、观察器、计时器、DOM 节点和补丁恢复。
(function initNaiAioRuntime(root, factory) {
  // 重复注入时复用同一个注册表，确保新模块可以释放旧模块留下的资源。
  if (root?.NaiAioRuntime?.VERSION === 1) {
    if (typeof module === 'object' && module.exports) {
      module.exports = root.NaiAioRuntime;
    }
    return;
  }
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NaiAioRuntime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNaiAioRuntime() {
  'use strict';

  const VERSION = 1;
  const scopes = new Map();
  let scopeSequence = 0;

  function reportDisposeError(scopeName, error) {
    try {
      console.error(`[NAI Runtime] 释放作用域失败 (${scopeName}):`, error);
    } catch (_) {
      // 控制台不可用时不应阻断后续清理。
    }
  }

  function normalizeCapture(options) {
    return typeof options === 'boolean' ? options : Boolean(options?.capture);
  }

  class RuntimeScope {
    constructor(name) {
      this.name = name;
      this.id = `${name}:${Date.now().toString(36)}:${(++scopeSequence).toString(36)}`;
      this.disposed = false;
      this.disposeReason = '';
      this.disposers = [];
      this.trackedObservers = new WeakSet();
      this.timeoutDisposers = new Map();
      this.intervalDisposers = new Map();
      this.frameDisposers = new Map();
    }

    add(disposer) {
      if (typeof disposer !== 'function') return function noop() {};
      if (this.disposed) {
        try {
          disposer();
        } catch (error) {
          reportDisposeError(this.name, error);
        }
        return function noop() {};
      }

      const entry = { active: true, disposer };
      this.disposers.push(entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        const index = this.disposers.indexOf(entry);
        if (index >= 0) this.disposers.splice(index, 1);
        try {
          entry.disposer();
        } catch (error) {
          reportDisposeError(this.name, error);
        }
      };
    }

    on(target, type, listener, options) {
      if (!target?.addEventListener || typeof listener !== 'function') {
        throw new TypeError(`[NAI Runtime] ${this.name} 无法注册事件 ${String(type)}`);
      }
      const capture = normalizeCapture(options);
      let unregister = function noop() {};
      const effectiveListener = options?.once
        ? function runOnceListener(...args) {
            unregister();
            return listener.apply(this, args);
          }
        : listener;
      target.addEventListener(type, effectiveListener, options);
      unregister = this.add(() => target.removeEventListener(type, effectiveListener, capture));
      return unregister;
    }

    chromeEvent(event, listener) {
      if (!event?.addListener || !event?.removeListener || typeof listener !== 'function') {
        throw new TypeError(`[NAI Runtime] ${this.name} 收到无效的 Chrome 事件对象`);
      }
      event.addListener(listener);
      return this.add(() => event.removeListener(listener));
    }

    trackObserver(observer) {
      if (!observer?.disconnect || this.trackedObservers.has(observer)) return observer;
      this.trackedObservers.add(observer);
      this.add(() => observer.disconnect());
      return observer;
    }

    observe(observer, target, options) {
      if (!observer?.observe || !target) {
        throw new TypeError(`[NAI Runtime] ${this.name} 无法启动观察器`);
      }
      this.trackObserver(observer);
      observer.observe(target, options);
      return observer;
    }

    timeout(callback, delay, ...args) {
      let unregister = function noop() {};
      const id = setTimeout(() => {
        unregister();
        if (!this.disposed) callback(...args);
      }, delay);
      unregister = this.add(() => {
        clearTimeout(id);
        this.timeoutDisposers.delete(id);
      });
      // 作用域可能在异步任务收尾时已经释放；此时 add() 会立即清理计时器，
      // 不应再把无效记录写回已清空的映射。
      if (!this.disposed) this.timeoutDisposers.set(id, unregister);
      return id;
    }

    cancelTimeout(id) {
      const unregister = this.timeoutDisposers.get(id);
      if (!unregister) return false;
      unregister();
      return true;
    }

    interval(callback, delay, ...args) {
      const id = setInterval(() => {
        if (!this.disposed) callback(...args);
      }, delay);
      const unregister = this.add(() => {
        clearInterval(id);
        this.intervalDisposers.delete(id);
      });
      if (!this.disposed) this.intervalDisposers.set(id, unregister);
      return id;
    }

    cancelInterval(id) {
      const unregister = this.intervalDisposers.get(id);
      if (!unregister) return false;
      unregister();
      return true;
    }

    frame(callback) {
      if (typeof requestAnimationFrame !== 'function') {
        return this.timeout(callback, 0);
      }
      let unregister = function noop() {};
      const id = requestAnimationFrame((timestamp) => {
        unregister();
        if (!this.disposed) callback(timestamp);
      });
      unregister = this.add(() => {
        cancelAnimationFrame(id);
        this.frameDisposers.delete(id);
      });
      if (!this.disposed) this.frameDisposers.set(id, unregister);
      return id;
    }

    cancelFrame(id) {
      // 不支持 requestAnimationFrame 的环境中，frame() 会回退为 timeout()。
      const unregister = this.frameDisposers.get(id) || this.timeoutDisposers.get(id);
      if (!unregister) return false;
      unregister();
      return true;
    }

    ownNode(node) {
      if (!node?.remove) return node;
      this.add(() => node.remove());
      return node;
    }

    patch(target, key, replacement) {
      if (!target) throw new TypeError(`[NAI Runtime] ${this.name} 无法修补空目标`);
      const original = target[key];
      target[key] = replacement;
      this.add(() => {
        // 只恢复本作用域安装的补丁，避免覆盖更新版本或其他扩展的后续补丁。
        if (target[key] === replacement) target[key] = original;
      });
      return original;
    }

    dispose(reason = 'manual') {
      if (this.disposed) return;
      this.disposed = true;
      this.disposeReason = reason;

      // 先把待清理项与作用域分离。清理函数可以安全调用其他 unregister，
      // 不会再改变当前正在倒序遍历的数组或造成越界。
      const pendingDisposers = this.disposers.splice(0);
      try {
        for (let index = pendingDisposers.length - 1; index >= 0; index -= 1) {
          const entry = pendingDisposers[index];
          if (!entry?.active) continue;
          entry.active = false;
          try {
            entry.disposer();
          } catch (error) {
            reportDisposeError(this.name, error);
          }
        }
      } finally {
        // 即使某个外部清理函数行为异常，内部登记和全局注册表也必须归零。
        this.disposers.length = 0;
        this.timeoutDisposers.clear();
        this.intervalDisposers.clear();
        this.frameDisposers.clear();

        if (scopes.get(this.name) === this) scopes.delete(this.name);
      }
    }
  }

  function acquire(name, options = {}) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) throw new TypeError('[NAI Runtime] 作用域名称不能为空');

    const existing = scopes.get(normalizedName);
    if (existing && options.replace === false && !existing.disposed) return existing;
    if (existing) existing.dispose('replaced');

    const scope = new RuntimeScope(normalizedName);
    scopes.set(normalizedName, scope);
    return scope;
  }

  function get(name) {
    return scopes.get(String(name || '').trim()) || null;
  }

  function dispose(name, reason = 'manual') {
    const scope = get(name);
    if (!scope) return false;
    scope.dispose(reason);
    return true;
  }

  function disposeAll(reason = 'manual') {
    Array.from(scopes.values()).forEach(scope => scope.dispose(reason));
  }

  return Object.freeze({
    VERSION,
    RuntimeScope,
    acquire,
    get,
    dispose,
    disposeAll
  });
});
