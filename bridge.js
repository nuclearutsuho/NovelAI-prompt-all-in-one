// bridge.js
(async () => {
  const SESSION_COUNTERS_KEY = '__nai_aio_sequentialCounters__';
  const SESSION_STEP_PROGRESS_KEY = '__nai_aio_sequentialStepProgress__';
  const HOST_SESSION_KEY = '__nai_aio_host_session__';
  const messageProtocol = globalThis.NaiAioMessageProtocol;

  const promptStorageShimReady = new Promise((resolve) => {
    const shimScript = document.createElement('script');
    shimScript.src = chrome.runtime.getURL('lib/injected/prompt-storage-shim.js');
    shimScript.onload = () => { shimScript.remove(); resolve(true); };
    shimScript.onerror = () => {
      shimScript.remove();
      console.error('[NAI-Prompt-All-In-One] 提示词存储隔离脚本加载失败，扩展将继续初始化。');
      resolve(false);
    };
    (document.head || document.documentElement).appendChild(shimScript);
  });

  function loadScopedSequentialCounters() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_COUNTERS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.warn('[Bridge] Failed to load scoped sequential counters:', e);
      return {};
    }
  }

  function saveScopedSequentialCounters(nextCounters) {
    try {
      window.sessionStorage.setItem(SESSION_COUNTERS_KEY, JSON.stringify(nextCounters || {}));
    } catch (e) {
      console.warn('[Bridge] Failed to save scoped sequential counters:', e);
    }
  }

  function loadScopedSequentialStepProgress() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_STEP_PROGRESS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.warn('[Bridge] Failed to load scoped sequential step progress:', e);
      return {};
    }
  }

  function saveScopedSequentialStepProgress(nextProgress) {
    try {
      window.sessionStorage.setItem(SESSION_STEP_PROGRESS_KEY, JSON.stringify(nextProgress || {}));
    } catch (e) {
      console.warn('[Bridge] Failed to save scoped sequential step progress:', e);
    }
  }

  // ── 随机通配符锁定 sessionStorage 持久化 ──
  const SESSION_RANDOM_LOCKS_KEY = '__nai_aio_randomWildcardLocks__';

  function loadScopedRandomWildcardLocks() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_RANDOM_LOCKS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.warn('[Bridge] Failed to load scoped random wildcard locks:', e);
      return {};
    }
  }

  function saveScopedRandomWildcardLocks(locks) {
    try {
      window.sessionStorage.setItem(SESSION_RANDOM_LOCKS_KEY, JSON.stringify(locks || {}));
    } catch (e) {
      console.warn('[Bridge] Failed to save scoped random wildcard locks:', e);
    }
  }

  function notifyRuntimeStateUpdate() {
    chrome.runtime.sendMessage({
      type: 'RUNTIME_STATE_UPDATED',
      counters: sequentialCounters || {},
      stepProgress: sequentialStepProgress || {},
      randomLocks: randomWildcardLocks || {},
      hostSessionId
    }).catch(() => {});
  }

  function getHostSessionId() {
    try {
      let id = window.sessionStorage.getItem(HOST_SESSION_KEY);
      if (!id) {
        id = `host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        window.sessionStorage.setItem(HOST_SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return `host_fallback_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  const hostSessionId = getHostSessionId();

  function normalizeWildcardUsagePath(path) {
    return String(path || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function normalizeWildcardUsageStats(rawStats = {}) {
    const normalizedStats = {};
    Object.entries(rawStats || {}).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;

      const count = Number(value.count);
      const lastUsedAt = Number(value.lastUsedAt);
      normalizedStats[key] = {
        count: Number.isFinite(count) && count > 0 ? count : 0,
        lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : 0
      };
    });
    return normalizedStats;
  }

  function getWildcardUsageKey(kind, path) {
    const normalizedPath = normalizeWildcardUsagePath(path);
    return normalizedPath ? `${kind}:${normalizedPath}` : '';
  }

  function normalizeSequentialStepSettings(rawSettings = {}) {
    const normalizedSettings = {};
    Object.entries(rawSettings || {}).forEach(([key, value]) => {
      if (!key) return;
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 1) {
        normalizedSettings[key] = parsed;
      }
    });
    return normalizedSettings;
  }

  function applyWildcardUsageRecords(currentStats = {}, records = []) {
    const nextStats = {
      ...normalizeWildcardUsageStats(currentStats)
    };
    const now = Date.now();

    (Array.isArray(records) ? records : []).forEach((record) => {
      const kind = record?.kind === 'folder' ? 'folder' : 'file';
      const key = getWildcardUsageKey(kind, record?.path);
      if (!key) return;

      const previous = nextStats[key] || { count: 0, lastUsedAt: 0 };
      const delta = Number(record?.delta);
      nextStats[key] = {
        count: Math.max(0, (Number(previous.count) || 0) + (Number.isFinite(delta) ? delta : 1)),
        lastUsedAt: now
      };
    });

    return nextStats;
  }

  await promptStorageShimReady;
  // 1) get settings from storage  ← preservePrompt 포함 (包含 preservePrompt)
  let {
    wildcards = {},
    wildcardFolders = [],
    wildcardUsageStats = {},
    v3mode = false,
    preservePrompt = true,
    alternativeDanbooruAutocomplete = true,
    triggerTab = false,
    triggerSpace = true,
    multiResConfig = null,
    hideAutoClicker = false,
    autoClickerI18n = null,
    hotkeys = null,
    sequentialStepSettings = {}
  } = await chrome.storage.local.get(['wildcards', 'wildcardFolders', 'wildcardUsageStats', 'v3mode', 'preservePrompt', 'alternativeDanbooruAutocomplete', 'triggerTab', 'triggerSpace', 'multiResConfig', 'hideAutoClicker', 'autoClickerI18n', 'hotkeys', 'sequentialStepSettings']);
  wildcardUsageStats = normalizeWildcardUsageStats(wildcardUsageStats);
  sequentialStepSettings = normalizeSequentialStepSettings(sequentialStepSettings);
  let sequentialCounters = loadScopedSequentialCounters();
  let sequentialStepProgress = loadScopedSequentialStepProgress();
  let randomWildcardLocks = loadScopedRandomWildcardLocks();

  // 2) 按依赖顺序注入页面脚本，并显式报告加载失败。
  function injectPageScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to inject ${path}`));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  const p1 = injectPageScript('lib/injected/novelai-compat.js')
    .then(() => injectPageScript('injector.js'));
  const p2 = injectPageScript('modules/auto-clicker.js');

  Promise.all([p1, p2])
    .then(() => {
      window.postMessage({
        type: '__WILDCARD_INIT__',
        map: wildcards,
        folders: wildcardFolders,
        usageStats: wildcardUsageStats,
        v3: v3mode,
        preservePrompt,
        alternativeDanbooruAutocomplete,
        triggerTab,
        triggerSpace,
        sequentialCounters,
        sequentialStepSettings,
        sequentialStepProgress,
        randomWildcardLocks,
        multiResConfig,
        hideAutoClicker,
        autoClickerI18n
      }, '*');
    })
    .catch(error => {
      console.error('[NAI-Prompt-All-In-One] 页面脚本注入失败:', error);
    });

  // 3) inject manager panel (runs in Content Script context)
  // 创建一个全局 Promise，让 GroupTags 能等待主面板位置恢复完毕后再执行吸附
  let _resolveWMReady;
  window.__wmPositionReady = new Promise(resolve => { _resolveWMReady = resolve; });

  function injectManagerPanel() {
    // 避免重复注入
    if (document.getElementById('wildcard-manager-container')) return;

    const STORAGE_KEY = 'wildcardPanelState';
    const popupUrl = chrome.runtime.getURL(`pages/popup.html?hostSession=${encodeURIComponent(hostSessionId)}`);
    const cssUrl = chrome.runtime.getURL('styles/manager-panel.css');

    // Inject CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);

    // 创建触发按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'wildcard-manager-toggle';
    const LOG_PREFIX = '[NAI-Prompt-All-In-One]';
    toggleBtn.title = LOG_PREFIX;
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
      </svg>
    `;
    document.body.appendChild(toggleBtn);

    // 创建面板容器
    const container = document.createElement('div');
    container.id = 'wildcard-manager-container';
    container.innerHTML = `
      <div id="wildcard-manager-header">
        <span class="title">🎴 NovelAI-prompt-all-in-one</span>
        <div class="controls" style="align-items: center;">
          <div class="density-control" style="margin-right: 8px;" title="Adjust Label Density">
            <input type="range" id="te-density-slider" class="density-slider" min="0" max="100" value="50">
          </div>
          <button class="min-btn" title="Minimize">_</button>
        </div>
      </div>
      <iframe id="wildcard-manager-iframe" src="${popupUrl}"></iframe>
    `;
    document.body.appendChild(container);

    const header = container.querySelector('#wildcard-manager-header');
    const minBtn = container.querySelector('.min-btn');

    // 显示/隐藏面板
    function togglePanel() {
      container.classList.toggle('visible');
      saveState();
    }

    function hidePanel() {
      container.classList.remove('visible');
      saveState();
    }

    function toggleMinimize() {
      container.classList.toggle('minimized');
      saveState();
    }

    toggleBtn.addEventListener('click', togglePanel);
    minBtn.addEventListener('click', toggleMinimize);

    // 密度控制逻辑 (Density Slider)
    const densitySlider = container.querySelector('#te-density-slider');
    const iframe = container.querySelector('#wildcard-manager-iframe');

    const setResizing = (isResizing) => {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: '__UPDATE_TE_RESIZING__', isResizing }, '*');
      }
    };

    let densityRAF = null;
    densitySlider.addEventListener('input', (e) => {
      const val = e.target.value;
      if (densityRAF) cancelAnimationFrame(densityRAF);
      densityRAF = requestAnimationFrame(() => {
        // During drag, ONLY notify iframe directly
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: '__UPDATE_TE_DENSITY__', value: val }, '*');
        }
      });
    });

    densitySlider.addEventListener('change', (e) => {
      const val = e.target.value;
      chrome.storage.local.set({ tagEditorDensity: val });
    });

    densitySlider.addEventListener('mousedown', () => setResizing(true));
    densitySlider.addEventListener('mouseup', () => setResizing(false));
    densitySlider.addEventListener('mouseleave', () => setResizing(false));

    // 防止在滑块上按下由于 header 拖拽导致滑块无法正常滑动
    densitySlider.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    // 拖拽功能
    let isDragging = false;
    let isInitializing = true; // Flag to prevent saving state during load
    let dragStartX, dragStartY, initialLeft, initialTop;

    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      container.classList.add('dragging');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // 边界限制
      const maxLeft = window.innerWidth - container.offsetWidth;
      const maxTop = window.innerHeight - container.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      container.style.left = newLeft + 'px';
      container.style.top = newTop + 'px';
      container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        container.classList.remove('dragging');
        saveState();
      }
    });

    // 监听大小变化 (CSS resize)
    const resizeObserver = new ResizeObserver(() => {
      if (!isInitializing) saveState();
    });
    resizeObserver.observe(container);

    // 保存面板状态
    function saveState() {
      if (isInitializing) return; // Don't save if we are still setting up
      const rect = container.getBoundingClientRect();
      const state = {
        visible: container.classList.contains('visible'),
        minimized: container.classList.contains('minimized'),
        left: rect.left,
        top: rect.top,
        width: container.offsetWidth,
        height: container.offsetHeight
      };
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    }

    // 恢复面板状态
    chrome.storage.local.get([STORAGE_KEY, 'tagEditorDensity'], data => {
      const state = data[STORAGE_KEY];
      const density = data['tagEditorDensity'];

      if (density !== undefined) {
         const densitySlider = container.querySelector('#te-density-slider');
         if (densitySlider) densitySlider.value = density;
      }
      
      if (state) {
        // Apply dimensions and position while hidden
        if (state.width) container.style.width = state.width + 'px';
        if (state.height) container.style.height = state.height + 'px';

        if (typeof state.left === 'number') {
          // 移除过严的 -50 限制，避免主面板因为自身宽大而在边缘刷新后发生强制回缩断裂。
          // 只要还有一点点漏在屏幕里就可以（即使其大部分在屏幕外）
          const safeLeft = Math.max(-container.offsetWidth + 20, Math.min(state.left, window.innerWidth - 20));
          container.style.left = safeLeft + 'px';
          container.style.right = 'auto';
        }
        if (typeof state.top === 'number') {
          const safeTop = Math.max(-container.offsetHeight + 20, Math.min(state.top, window.innerHeight - 20));
          container.style.top = safeTop + 'px';
        }

        if (state.visible) {
          container.classList.add('visible');
        }
        if (state.minimized) {
          container.classList.add('minimized');
        }
      }

      // Allow saving state only after we are sure initialization is done
      // and initial layout shifts have settled.
      requestAnimationFrame(() => {
        // 此时浏览器已经计算了至少一次布局，主面板的 getBoundingClientRect() 现在能返回正确值
        if (_resolveWMReady) _resolveWMReady();
        setTimeout(() => {
          isInitializing = false;
        }, 300);
      });
    });

    // ── 快捷键系统 ──
    // 默认快捷键配置
    const DEFAULT_HOTKEYS = {
      toggleMinimize: { key: 'm', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
      triggerGenerate: { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
      focusBase: { key: 'q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }
    };
    // 当前快捷键配置（合并用户保存的配置和默认值）
    let currentHotkeys = { ...DEFAULT_HOTKEYS, ...(hotkeys || {}) };

    /**
     * 判断按键事件是否匹配快捷键配置
     */
    function matchHotkey(event, hotkeyConfig) {
      if (!hotkeyConfig || !hotkeyConfig.key) return false;
      // 对单字符按键（字母键）做大小写不敏感比较
      const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const configKey = hotkeyConfig.key.length === 1 ? hotkeyConfig.key.toLowerCase() : hotkeyConfig.key;
      return eventKey === configKey
        && !!event.ctrlKey === !!hotkeyConfig.ctrlKey
        && !!event.altKey === !!hotkeyConfig.altKey
        && !!event.shiftKey === !!hotkeyConfig.shiftKey
        && !!event.metaKey === !!hotkeyConfig.metaKey;
    }

    // 全局快捷键监听（宿主页面层级）
    document.addEventListener('keydown', e => {
      // 在输入框中时跳过某些快捷键（避免干扰正常输入）
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

      if (matchHotkey(e, currentHotkeys.toggleMinimize)) {
        e.preventDefault();
        toggleMinimize();
        return;
      }

      if (matchHotkey(e, currentHotkeys.focusBase)) {
        e.preventDefault();
        
        // 1. 如果面板隐藏，展示面板
        const container = document.getElementById('wildcard-manager-container');
        if (container && !container.classList.contains('visible')) {
          togglePanel(); // toggle → 从隐藏变为可见
        }
        
        // 2. 如果面板已最小化，取消最小化
        if (container && container.classList.contains('minimized')) {
          toggleMinimize(); // toggle → 从最小化变为展开
        }

        // 3. 等待面板展开/恢复的 CSS 渲染完成后再操作焦点
        requestAnimationFrame(() => {
          setTimeout(() => {
            // 实时查询 iframe 元素（避免变量作用域问题）
            const iframeEl = document.getElementById('wildcard-manager-iframe');
            if (!iframeEl) return;

            // 4. 浏览器安全策略限制：仅靠 iframe.focus() 无法将焦点转入跨源 iframe
            //    必须通过模拟用户点击事件来产生"用户手势"，才能让浏览器允许焦点转移
            iframeEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            iframeEl.focus();

            // 5. 通知 iframe 进行 Tab 切换和 Focus 操作
            if (iframeEl.contentWindow) {
              iframeEl.contentWindow.postMessage({ type: '__HOTKEY_ACTION__', action: 'focusBase' }, '*');
            }
          }, 120);
        });
        return;
      }

      if (matchHotkey(e, currentHotkeys.triggerGenerate)) {
        // 如果是纯 Enter（没有 Ctrl/Alt 修饰）在输入框中，不拦截
        if (isInput && !e.ctrlKey && !e.altKey && !e.metaKey) return;
        e.preventDefault();
        // 通过 postMessage 转发给注入层（auto-clicker.js）执行生成按钮点击
        window.postMessage({ type: '__TRIGGER_GENERATE__' }, '*');
        return;
      }

      // 保留原有的 Ctrl+Shift+W 切换面板快捷键（硬编码后备）
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        togglePanel();
      }
    });

    // 监听快捷键配置更新（来自 storage 变化 → 闭包内 currentHotkeys 同步）
    window.addEventListener('__hotkeys_updated__', (e) => {
      const DEFAULT_HOTKEYS_INNER = {
        toggleMinimize: { key: 'm', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
        triggerGenerate: { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
        focusBase: { key: 'q', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }
      };
      currentHotkeys = { ...DEFAULT_HOTKEYS_INNER, ...(e.detail || {}) };
    });

    // 监听来自 iframe 的快捷键动作请求
    window.addEventListener('message', (e) => {
      if (!messageProtocol?.isFromIframe(e, iframe, chrome.runtime)
        || !messageProtocol.isValidManagerPanelMessage(e.data)) return;

      if (e.data.type === '__HOTKEY_ACTION__') {
        if (e.data.action === 'toggleMinimize') {
          toggleMinimize();
        } else if (e.data.action === 'triggerGenerate') {
          // 转发给注入层（auto-clicker.js）执行生成按钮点击
          window.postMessage({ type: '__TRIGGER_GENERATE__' }, '*');
        }
      }
    });

    console.log('[Wildcard] Manager panel injected');
  }

  // 4) inject Group Tags panel (runs in Content Script context)
  // 采用与 injectManagerPanel 完全相同的架构：
  // 拖拽 header 在外层 DOM，鼠标事件在父页面处理，不依赖 iframe 通信
  function injectGroupTagsPanel() {
    if (document.getElementById('group-tags-manager-container')) return;

    const STORAGE_KEY = 'groupTagsPanelState';
    const panelUrl = chrome.runtime.getURL('pages/group-tags.html');

    // 创建面板容器（结构与 wildcard-manager 一致：外层 header + iframe）
    const container = document.createElement('div');
    container.id = 'group-tags-manager-container';
    const defaultLeft = Math.max(50, window.innerWidth - 880);
    const defaultTop = 150;
    container.style.cssText = `
      position: fixed;
      top: ${defaultTop}px;
      left: ${defaultLeft}px;
      width: 380px;
      height: 520px;
      min-width: 250px;
      min-height: 250px;
      max-width: 90vw;
      max-height: 90vh;
      background: #1e1e2e;
      border: 1px solid #4a4a6a;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      z-index: 2147483646;
      display: none;
      flex-direction: column;
      overflow: hidden;
      resize: both;
    `;
    container.innerHTML = `
      <div id="group-tags-header" style="
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px;
        background: linear-gradient(135deg, #1a3a2e, #1e1e2e);
        border-bottom: 1px solid #4a4a6a;
        cursor: move; user-select: none; flex-shrink: 0;
      ">
        <span style="color:#e0e0e0; font-size:11px; font-weight:600; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <span style="color:#10b981;">🏷️</span> Tags Matrix
        </span>
        <div style="display:flex; gap:4px; align-items:center;">
          <span class="gt-dock-indicator" title="磁吸未激活" style="
            display:flex; align-items:center; justify-content:center;
            width:20px; height:20px; border-radius:4px;
            color:#555; font-size:13px; transition:all 0.3s;
            cursor:default; user-select:none;
          ">🧲</span>
          <button class="gt-min-btn" title="Minimize" style="
            width:20px; height:20px; border:1px solid #4a4a6a; border-radius:4px;
            background:rgba(255,255,255,0.05); color:#aaa; cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            font-size:14px; transition:all 0.15s;
          ">_</button>
        </div>
      </div>
      <iframe id="group-tags-iframe" src="${panelUrl}" style="flex:1; width:100%; border:none; background:transparent;"></iframe>
    `;
    document.body.appendChild(container);

    const header = container.querySelector('#group-tags-header');
    const minBtn = container.querySelector('.gt-min-btn');

    // hover 效果
    minBtn.addEventListener('mouseenter', () => {
      minBtn.style.background = 'rgba(99, 102, 241, 0.2)';
      minBtn.style.borderColor = '#818cf8';
      minBtn.style.color = '#818cf8';
    });
    minBtn.addEventListener('mouseleave', () => {
      minBtn.style.background = 'rgba(255, 255, 255, 0.05)';
      minBtn.style.borderColor = '#4a4a6a';
      minBtn.style.color = '#aaa';
    });

    let isInitializing = true;

    // 显示/隐藏
    window.toggleGroupTagsPanel = function() {
      container.style.display = (container.style.display === 'none' || container.style.display === '') ? 'flex' : 'none';
      saveState();
    };
    window.hideGroupTagsPanel = function() {
      container.style.display = 'none';
      saveState();
    };

    // 最小化逻辑
    function toggleGTMinimize() {
      container.classList.toggle('minimized');
    }
    minBtn.addEventListener('click', toggleGTMinimize);

    // 最小化样式（动态注入与 wildcard-manager 一致的 CSS）
    const minStyle = document.createElement('style');
    minStyle.textContent = `
      #group-tags-manager-container.minimized {
        height: auto !important;
        min-height: 0 !important;
        resize: none !important;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
      }
      #group-tags-manager-container.minimized #group-tags-iframe {
        display: none;
      }
      #group-tags-manager-container.minimized #group-tags-header {
        border-bottom: none;
      }
      /* 磁吸吸附瞬间的平滑过渡动效 */
      #group-tags-manager-container.snap-transition {
        transition: left 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    top 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }
      /* 磁吸预告虚线框 */
      .gt-snap-ghost {
        position: fixed;
        border: 2px dashed rgba(129, 140, 248, 0.5);
        background: rgba(129, 140, 248, 0.06);
        border-radius: 8px;
        pointer-events: none;
        z-index: 2147483645;
        display: none;
        transition: left 0.1s, top 0.1s, width 0.1s, height 0.1s;
      }
      /* 磁铁指示器的吸附/脱离状态 —— 增强显眼度 */
      .gt-dock-indicator.docked {
        color: #a78bfa !important;
        text-shadow: 0 0 8px rgba(167, 139, 250, 0.8), 0 0 16px rgba(129, 140, 248, 0.4);
        background: rgba(129, 140, 248, 0.15);
        border-radius: 4px;
        animation: gt-dock-pulse 2s ease-in-out infinite;
      }
      @keyframes gt-dock-pulse {
        0%, 100% { text-shadow: 0 0 8px rgba(167, 139, 250, 0.8), 0 0 16px rgba(129, 140, 248, 0.4); }
        50% { text-shadow: 0 0 12px rgba(167, 139, 250, 1), 0 0 24px rgba(129, 140, 248, 0.6); }
      }
    `;
    document.head.appendChild(minStyle);

    // 创建磁吸预告虚线框元素
    const snapGhost = document.createElement('div');
    snapGhost.className = 'gt-snap-ghost';
    document.body.appendChild(snapGhost);

    // 磁铁指示器引用
    const dockIndicator = container.querySelector('.gt-dock-indicator');

    // 预告虚线框对应的待吸附方向（松手时自动完成吸附）
    let pendingSnapDir = null;

    // 联动 wildcard-manager 最小化：当它最小化时，group-tags 完全隐藏；恢复时显示回来
    let wasVisibleBeforeWMMinimize = false;
    let savedPosBeforeHide = null; // 隐藏前的位置快照
    const wmMinObserver = new MutationObserver(() => {
      const wm = getWMContainer();
      if (!wm) return;
      const wmMinimized = wm.classList.contains('minimized');
      if (wmMinimized) {
        // WM 最小化 → 记住当前位置和可见状态，然后隐藏
        wasVisibleBeforeWMMinimize = container.style.display === 'flex';
        if (wasVisibleBeforeWMMinimize) {
          const rect = container.getBoundingClientRect();
          savedPosBeforeHide = { left: rect.left, top: rect.top };
          container.style.display = 'none';
        }
      } else {
        // WM 恢复 → 先还原之前保存的位置，再显示
        if (wasVisibleBeforeWMMinimize) {
          if (savedPosBeforeHide) {
            container.style.left = savedPosBeforeHide.left + 'px';
            container.style.top = savedPosBeforeHide.top + 'px';
            savedPosBeforeHide = null;
          }
          container.style.display = 'flex';
          wasVisibleBeforeWMMinimize = false;
        }
      }
    });
    // 延迟绑定，等 wildcard-manager 注入完成
    setTimeout(() => {
      const wm = getWMContainer();
      if (wm) wmMinObserver.observe(wm, { attributes: true, attributeFilter: ['class'] });
    }, 500);

    // ─── 磁吸式吸附系统 ───
    const SNAP_THRESHOLD = 8;  // 吸附触发距离（px）
    const UNDOCK_THRESHOLD = 20; // 脱离距离（px）
    let dockState = null; // null | 'left' | 'right' | 'top' | 'bottom'
    let wmObserver = null; // MutationObserver for wildcard-manager
    let lastWMRect = null; // 用于记录上一帧主面板的位置，以计算位移差

    // 获取 wildcard-manager 容器的引用
    function getWMContainer() {
      return document.getElementById('wildcard-manager-container');
    }

    // 根据当前吸附方向，计算 group-tags 应处的位置
    // 左右吸附时：只锁定水平轴（left），top 保持当前值（用户可上下自由拖动） + 跟随主面板垂直位移 (dy)
    // 上下吸附时：只锁定垂直轴（top），left 保持当前值 + 跟随主面板水平位移 (dx)
    function calcDockedPosition(dockDir) {
      const wm = getWMContainer();
      if (!wm) return null;
      const wmRect = wm.getBoundingClientRect();
      const gtRect = container.getBoundingClientRect();
      const gtW = container.offsetWidth;
      const gtH = container.offsetHeight;
      
      let dx = 0;
      let dy = 0;
      if (lastWMRect) {
        dx = wmRect.left - lastWMRect.left;
        dy = wmRect.top - lastWMRect.top;
      }
      // 更新 lastWMRect
      lastWMRect = { left: wmRect.left, top: wmRect.top };

      let left, top;

      switch (dockDir) {
        case 'right': // 水平锁定：贴右边，垂直跟随
          left = wmRect.right;
          top = gtRect.top + dy;
          break;
        case 'left': // 水平锁定：贴左边，垂直跟随
          left = wmRect.left - gtW;
          top = gtRect.top + dy;
          break;
        case 'bottom': // 垂直锁定：贴下方，水平跟随
          left = gtRect.left + dx;
          top = wmRect.bottom;
          break;
        case 'top': // 垂直锁定：贴上方，水平跟随
          left = gtRect.left + dx;
          top = wmRect.top - gtH;
          break;
      }
      // 边界保护
      left = Math.max(0, Math.min(left, window.innerWidth - gtW));
      top = Math.max(0, Math.min(top, window.innerHeight - gtH));
      return { left, top };
    }

    // 应用吸附位置
    function applyDockedPosition() {
      if (!dockState) return;
      const pos = calcDockedPosition(dockState);
      if (pos) {
        container.style.left = pos.left + 'px';
        container.style.top = pos.top + 'px';
        container.style.right = 'auto';
      }
    }


    // 开始监听 wildcard-manager 的位置和大小变化
    function startWMTracking() {
      const wm = getWMContainer();
      if (!wm) return;

      lastWMRect = wm.getBoundingClientRect(); // 初始化

      // MutationObserver 监听 style 属性变化（拖拽改变 left/top）
      wmObserver = new MutationObserver(() => {
        applyDockedPosition();
      });
      wmObserver.observe(wm, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // 停止监听
    function stopWMTracking() {
      if (wmObserver) { wmObserver.disconnect(); wmObserver = null; }
      lastWMRect = null; // 清理
    }

    // 吸附入场
    function dock(direction) {
      const wasUndocked = !dockState;
      dockState = direction;
      // 首次吸附时触发平滑过渡动效
      if (wasUndocked) {
        container.classList.add('snap-transition');
        setTimeout(() => container.classList.remove('snap-transition'), 200);
      }
      applyDockedPosition();
      startWMTracking();
      saveDockState();
      updateDockIndicator();
    }

    // 脱离
    function undock() {
      dockState = null;
      stopWMTracking();
      saveDockState();
      updateDockIndicator();
    }

    // 更新磁铁指示器的视觉状态
    function updateDockIndicator() {
      if (!dockIndicator) return;
      if (dockState) {
        dockIndicator.classList.add('docked');
        dockIndicator.title = '磁吸已激活 — 面板将跟随主输入框移动';
      } else {
        dockIndicator.classList.remove('docked');
        dockIndicator.title = '磁吸未激活';
      }
    }

    // 显示/隐藏/更新磁吸预告虚线框
    function showSnapGhost(left, top, width, height) {
      snapGhost.style.left = left + 'px';
      snapGhost.style.top = top + 'px';
      snapGhost.style.width = width + 'px';
      snapGhost.style.height = height + 'px';
      snapGhost.style.display = 'block';
    }
    function hideSnapGhost() {
      snapGhost.style.display = 'none';
    }

    // 在拖拽 mousemove 中检测是否应吸附或脱离
    function checkSnap(gtLeft, gtTop) {
      const wm = getWMContainer();
      if (!wm || wm.style.display === 'none') return { snapped: false, left: gtLeft, top: gtTop };

      const wmRect = wm.getBoundingClientRect();
      const gtW = container.offsetWidth;
      const gtH = container.offsetHeight;
      const gtRight = gtLeft + gtW;
      const gtBottom = gtTop + gtH;

      // 如果已经吸附，检测是否应脱离
      // 只看被锁定轴的距离（左右吸附看水平偏移，上下吸附看垂直偏移）
      if (dockState) {
        const pos = calcDockedPosition(dockState);
        if (pos) {
          let axialDist;
          if (dockState === 'left' || dockState === 'right') {
            axialDist = Math.abs(gtLeft - pos.left); // 只看水平偏离
          } else {
            axialDist = Math.abs(gtTop - pos.top); // 只看垂直偏离
          }

          if (axialDist > UNDOCK_THRESHOLD) {
            undock();
            return { snapped: false, left: gtLeft, top: gtTop };
          } else {
            // 吸附中：锁定轴用计算值，自由轴用用户当前拖拽值
            if (dockState === 'left' || dockState === 'right') {
              return { snapped: true, left: pos.left, top: gtTop };
            } else {
              return { snapped: true, left: gtLeft, top: pos.top };
            }
          }
        }
      }

      // 检查四边吸附（未吸附状态）
      // 垂直方向须有重叠
      const vOverlap = gtBottom > wmRect.top && gtTop < wmRect.bottom;
      // 水平方向须有重叠
      const hOverlap = gtRight > wmRect.left && gtLeft < wmRect.right;

      const candidates = [];

      // 右侧吸附：group-tags 左边靠近 wildcard-manager 右边
      if (vOverlap && Math.abs(gtLeft - wmRect.right) < SNAP_THRESHOLD) {
        candidates.push({ dir: 'right', dist: Math.abs(gtLeft - wmRect.right) });
      }
      // 左侧吸附：group-tags 右边靠近 wildcard-manager 左边
      if (vOverlap && Math.abs(gtRight - wmRect.left) < SNAP_THRESHOLD) {
        candidates.push({ dir: 'left', dist: Math.abs(gtRight - wmRect.left) });
      }
      // 下方吸附：group-tags 顶边靠近 wildcard-manager 底边
      if (hOverlap && Math.abs(gtTop - wmRect.bottom) < SNAP_THRESHOLD) {
        candidates.push({ dir: 'bottom', dist: Math.abs(gtTop - wmRect.bottom) });
      }
      // 上方吸附：group-tags 底边靠近 wildcard-manager 顶边
      if (hOverlap && Math.abs(gtBottom - wmRect.top) < SNAP_THRESHOLD) {
        candidates.push({ dir: 'top', dist: Math.abs(gtBottom - wmRect.top) });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.dist - b.dist);
        const best = candidates[0];
        dock(best.dir);
        const pos = calcDockedPosition(best.dir);
        return { snapped: true, left: pos.left, top: pos.top };
      }

      return { snapped: false, left: gtLeft, top: gtTop };
    }

    // ─── 拖拽 ───
    let isDragging = false;
    let dragStartX, dragStartY, initialLeft, initialTop;

    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      container.classList.add('dragging');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      let newLeft = initialLeft + (e.clientX - dragStartX);
      let newTop = initialTop + (e.clientY - dragStartY);
      const maxLeft = window.innerWidth - container.offsetWidth;
      const maxTop = window.innerHeight - container.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      // 磁吸检测
      const snap = checkSnap(newLeft, newTop);
      container.style.left = snap.left + 'px';
      container.style.top = snap.top + 'px';
      container.style.right = 'auto';

      // 磁吸预告虚线框：已经吸附时不显示（避免多余视觉干扰）
      if (snap.snapped) {
        hideSnapGhost();
        pendingSnapDir = null; // 已经吸附了，不需要待吸附
      } else {
        // 如果未吸附，检查是否从外部接近主面板（只有外部接近才显示预告）
        const wm = getWMContainer();
        if (wm && wm.style.display !== 'none') {
          const wmRect = wm.getBoundingClientRect();
          const gtW = container.offsetWidth;
          const gtH = container.offsetHeight;
          const gtRight = newLeft + gtW;
          const gtBottom = newTop + gtH;
          const PREVIEW_RANGE = 60;
          let previewPos = null;
          let previewDir = null;

          // 右侧吸附预告：tags面板在主面板右边，从右向左靠近
          const vOverlap = gtBottom > wmRect.top && newTop < wmRect.bottom;
          const hOverlap = gtRight > wmRect.left && newLeft < wmRect.right;
          if (vOverlap && newLeft > wmRect.right && (newLeft - wmRect.right) < PREVIEW_RANGE) {
            previewPos = { left: wmRect.right, top: newTop };
            previewDir = 'right';
          }
          // 左侧吸附预告：tags面板在主面板左边，从左向右靠近
          else if (vOverlap && gtRight < wmRect.left && (wmRect.left - gtRight) < PREVIEW_RANGE) {
            previewPos = { left: wmRect.left - gtW, top: newTop };
            previewDir = 'left';
          }
          // 下方吸附预告：tags面板在主面板下方，从下向上靠近
          else if (hOverlap && newTop > wmRect.bottom && (newTop - wmRect.bottom) < PREVIEW_RANGE) {
            previewPos = { left: newLeft, top: wmRect.bottom };
            previewDir = 'bottom';
          }
          // 上方吸附预告：tags面板在主面板上方，从上向下靠近
          else if (hOverlap && gtBottom < wmRect.top && (wmRect.top - gtBottom) < PREVIEW_RANGE) {
            previewPos = { left: newLeft, top: wmRect.top - gtH };
            previewDir = 'top';
          }

          if (previewPos) {
            showSnapGhost(previewPos.left, previewPos.top, gtW, gtH);
            pendingSnapDir = previewDir;
          } else {
            hideSnapGhost();
            pendingSnapDir = null;
          }
        } else {
          hideSnapGhost();
          pendingSnapDir = null;
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        container.classList.remove('dragging');
        hideSnapGhost();
        // 如果松手时有待吸附的预告方向，自动完成吸附
        if (pendingSnapDir) {
          dock(pendingSnapDir);
          pendingSnapDir = null;
        }
        saveState();
      }
    });

    // 拖拽时禁用 iframe 交互
    const dragStyle = document.createElement('style');
    dragStyle.textContent = '#group-tags-manager-container.dragging #group-tags-iframe { pointer-events: none; }';
    document.head.appendChild(dragStyle);

    // ─── 保存/恢复面板状态（含吸附信息） ───
    function saveDockState() {
      // 单独保存吸附状态，避免与 saveState 冲突
      chrome.storage.local.set({ groupTagsDockState: dockState || '' });
    }

    function saveState() {
      if (isInitializing) return;
      const rect = container.getBoundingClientRect();
      chrome.storage.local.set({ [STORAGE_KEY]: {
        visible: container.style.display === 'flex',
        left: rect.left, top: rect.top,
        width: container.offsetWidth, height: container.offsetHeight,
        docked: dockState || ''
      }});
    }

    chrome.storage.local.get(STORAGE_KEY, data => {
      const state = data[STORAGE_KEY];
      if (state) {
        if (state.width) container.style.width = state.width + 'px';
        if (state.height) container.style.height = state.height + 'px';
        if (state.visible) container.style.display = 'flex';

        // 恢复吸附状态：必须等主面板位置完全恢复后再执行吸附，否则会读到错误的初始坐标
        if (state.docked && getWMContainer()) {
          // 先设置一个临时的 fallback 位置（使用 storage 中保存的原始坐标）
          if (typeof state.left === 'number') {
            container.style.left = state.left + 'px';
            container.style.right = 'auto';
          }
          if (typeof state.top === 'number') {
            container.style.top = state.top + 'px';
          }
          // 等待主面板就位后，再等一帧确保布局完成，然后精确吸附
          window.__wmPositionReady.then(() => {
            requestAnimationFrame(() => {
              dockState = state.docked;
              applyDockedPosition();
              startWMTracking();
              updateDockIndicator();
            });
          });
        } else {
          if (typeof state.left === 'number') {
            container.style.left = Math.max(0, Math.min(state.left, window.innerWidth - 50)) + 'px';
            container.style.right = 'auto';
          }
          if (typeof state.top === 'number') {
            container.style.top = Math.max(0, Math.min(state.top, window.innerHeight - 50)) + 'px';
          }
        }
      }
      requestAnimationFrame(() => { setTimeout(() => { isInitializing = false; }, 300); });
    });

    // 监听大小变化
    const resizeObserver = new ResizeObserver(() => { if (!isInitializing) saveState(); });
    resizeObserver.observe(container);

    console.log('[Wildcard] Group Tags panel injected');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectManagerPanel();
      injectGroupTagsPanel();
    });
  } else {
    injectManagerPanel();
    injectGroupTagsPanel();
  }

  // 3) propagate later changes
  chrome.storage.onChanged.addListener(changes => {
    if (changes.sequentialStepSettings) {
      sequentialStepSettings = normalizeSequentialStepSettings(changes.sequentialStepSettings.newValue);
      window.postMessage({
        type: '__SEQUENTIAL_STEP_SETTINGS_UPDATE__',
        sequentialStepSettings,
        sequentialStepProgress,
        randomWildcardLocks
      }, '*');
    }

    // wildcards, v3mode, preservePrompt, alternativeDanbooruAutocomplete 중 하나라도 바뀌면 반영 (wildcards, v3mode, preservePrompt, alternativeDanbooruAutocomplete 中任何一个改变都反映)
    if (changes.wildcards ||
      changes.wildcardFolders ||
      changes.wildcardUsageStats ||
      changes.v3mode ||
      changes.preservePrompt ||
      changes.alternativeDanbooruAutocomplete ||
      changes.triggerTab ||
      changes.triggerSpace ||
      changes.multiResConfig ||
      changes.hideAutoClicker ||
      changes.autoClickerI18n ||
      changes.hotkeys) {

      wildcards = changes.wildcards
        ? changes.wildcards.newValue
        : wildcards;
      wildcardFolders = changes.wildcardFolders
        ? changes.wildcardFolders.newValue
        : wildcardFolders;
      wildcardUsageStats = changes.wildcardUsageStats
        ? normalizeWildcardUsageStats(changes.wildcardUsageStats.newValue)
        : wildcardUsageStats;
      v3mode = changes.v3mode
        ? changes.v3mode.newValue
        : v3mode;
      preservePrompt = changes.preservePrompt
        ? changes.preservePrompt.newValue
        : preservePrompt;
      alternativeDanbooruAutocomplete = changes.alternativeDanbooruAutocomplete
        ? changes.alternativeDanbooruAutocomplete.newValue
        : alternativeDanbooruAutocomplete;
      triggerTab = changes.triggerTab
        ? changes.triggerTab.newValue
        : triggerTab;
      triggerSpace = changes.triggerSpace
        ? changes.triggerSpace.newValue
        : triggerSpace;
      multiResConfig = changes.multiResConfig
        ? changes.multiResConfig.newValue
        : multiResConfig;
      hideAutoClicker = changes.hideAutoClicker
        ? changes.hideAutoClicker.newValue
        : hideAutoClicker;
      autoClickerI18n = changes.autoClickerI18n
        ? changes.autoClickerI18n.newValue
        : autoClickerI18n;

      // 同步快捷键配置
      if (changes.hotkeys) {
        hotkeys = changes.hotkeys.newValue;
        // 如果 injectManagerPanel 中的 currentHotkeys 引用可达，直接更新
        // 此处通过自定义事件通知闭包内部更新
        window.dispatchEvent(new CustomEvent('__hotkeys_updated__', { detail: hotkeys }));
      }

      window.postMessage({
        type: '__WILDCARD_UPDATE__',
        map: wildcards,
        folders: wildcardFolders,
        usageStats: wildcardUsageStats,
        v3: v3mode,
        preservePrompt,
        alternativeDanbooruAutocomplete,
        triggerTab,
      triggerSpace,
      sequentialCounters,
      sequentialStepSettings,
      sequentialStepProgress,
      randomWildcardLocks,
      multiResConfig,
      hideAutoClicker,
      autoClickerI18n
    }, '*');
    }
  });

  // Handle sequential counter updates from injector
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const isRuntimeStateMessage = messageProtocol?.RUNTIME_STATE_MESSAGE_TYPES?.has(e.data?.type);
    if (!isRuntimeStateMessage || !messageProtocol.isValidRuntimeStateMessage(e.data)) return;

    if (e.data?.type === '__UPDATE_SEQUENTIAL_COUNTER__') {
      const { name, value } = e.data;
      sequentialCounters[name] = value;
      saveScopedSequentialCounters(sequentialCounters);
      notifyRuntimeStateUpdate();
    }
    if (e.data?.type === '__UPDATE_RANDOM_WILDCARD_LOCKS__') {
      randomWildcardLocks = e.data.locks && typeof e.data.locks === 'object'
        ? e.data.locks
        : {};
      saveScopedRandomWildcardLocks(randomWildcardLocks);
      notifyRuntimeStateUpdate();
    }
    if (e.data?.type === '__UPDATE_SEQUENTIAL_STEP_PROGRESS__') {
      sequentialStepProgress = e.data.progress && typeof e.data.progress === 'object'
        ? e.data.progress
        : {};
      saveScopedSequentialStepProgress(sequentialStepProgress);
      notifyRuntimeStateUpdate();
    }
    if (e.data?.type === '__RECORD_WILDCARD_USAGE__') {
      wildcardUsageStats = applyWildcardUsageRecords(wildcardUsageStats, e.data.records);
      chrome.storage.local.set({ wildcardUsageStats });
    }
    if (e.data?.type === '__CLEAN_NUMERIC_PREFIXES__') {
      chrome.runtime.sendMessage({ type: '__CLEAN_NUMERIC_PREFIXES__' });
    }
  });

  let autocompleteDict = [];
  try {
    const csvUrl = chrome.runtime.getURL('data/dictionary.csv');
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    autocompleteDict = text.split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
      // Manual CSV parsing to handle empty fields and quotes correctly
      const row = []; // row 변수 추가 (Add row variable)
      let currentField = '';
      let inQuote = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuote && line[i + 1] === '"') {
            currentField += '"';
            i++; // skip escaped quote
          } else {
            inQuote = !inQuote;
          }
        } else if (char === ',' && !inQuote) {
          row.push(currentField);
          currentField = '';
        } else {
          currentField += char;
        }
      }
      row.push(currentField);

      let [word, colorCode, popCount, aliases, zhCN] = row;

      // Handle aliases safely
      if (aliases) {
        // Remove surrounding quotes if they were added erroneously or exist
        // Note: Our manual parser already strips surrounding quotes if they were part of the CSV structure, 
        // but let's just split by comma.
        // Wait, the manual parser creates raw fields.
        // If the CSV was: "alias1, alias2", the field is `alias1, alias2`.
        // If it was empty: the field is ``.

        // Split aliases by comma
        aliases = aliases.split(',').map(a => a.trim()).filter(Boolean);
      } else {
        aliases = [];
      }

        return {
          word,
          colorCode: colorCode ? colorCode.trim() : '0',
          popCount: popCount ? parseInt(popCount) : 0,
          aliases,
          zhCN: zhCN ? zhCN.trim() : ''
        };
      });
  } catch (error) {
    // 字典不可用时只禁用自动补全，不能让整个 bridge 初始化链中断。
    console.error('[NAI-Prompt-All-In-One] 自动补全字典加载失败，已继续初始化其他功能:', error);
  }

  if (alternativeDanbooruAutocomplete) {
    window.postMessage({
      type: '__AUTOCOMPLETE_DICT__',
      data: autocompleteDict
    }, '*');
  }

  window.addEventListener('message', e => {
    // ── 来自 GroupTags iframe 的指令（e.source 是 iframe window，不等于当前 window）──
    const groupTagsIframe = document.getElementById('group-tags-iframe');
    const isGroupPanelMessage = messageProtocol?.GROUP_PANEL_MESSAGE_TYPES?.has(e.data?.type);
    if (isGroupPanelMessage
      && (!messageProtocol.isFromIframe(e, groupTagsIframe, chrome.runtime)
        || !messageProtocol.isValidGroupPanelMessage(e.data))) {
      return;
    }

    if (e.data?.type === '__APPEND_TAG_FROM_PANEL__') {
      console.log('[Bridge] Received __APPEND_TAG_FROM_PANEL__:', e.data.tag);
      chrome.runtime.sendMessage({ type: 'APPEND_TAG_FROM_PANEL', tag: e.data.tag, zh: e.data.zh, hostSessionId });
      return;
    }
    if (e.data?.type === '__REMOVE_TAG_FROM_PANEL__') {
      console.log('[Bridge] Received __REMOVE_TAG_FROM_PANEL__:', e.data.tag);
      chrome.runtime.sendMessage({ type: 'REMOVE_TAG_FROM_PANEL', tag: e.data.tag, hostSessionId });
      return;
    }
    if (e.data?.type === '__SYNC_GROUP_COLORS__') {
      console.log('[Bridge] Received __SYNC_GROUP_COLORS__');
      chrome.runtime.sendMessage({ type: 'SYNC_GROUP_COLORS', colorMap: e.data.colorMap });
      return;
    }
    if (e.data?.type === '__SYNC_GROUP_TRANSLATIONS__') {
      console.log('[Bridge] Received __SYNC_GROUP_TRANSLATIONS__');
      chrome.runtime.sendMessage({ type: 'SYNC_GROUP_TRANSLATIONS', translationMap: e.data.translationMap });
      return;
    }
    if (e.data?.type === '__CLOSE_GROUP_TAGS_PANEL__') {
      if (window.hideGroupTagsPanel) window.hideGroupTagsPanel();
      return;
    }

    // 只处理来自当前页面自身的消息（injector / popup 等同源通信）
    if (e.source !== window) return;

    if (e.data?.type === '__REQUEST_AUTOCOMPLETE_DICT__') {
      window.postMessage({
        type: '__AUTOCOMPLETE_DICT__',
        data: autocompleteDict
      }, '*');
    }

    if (e.data?.type === '__RETURN_PROMPT__') {
      console.log('[Bridge] Received __RETURN_PROMPT__ from injector, relaying to popup');
      // Relay back to popup
      chrome.runtime.sendMessage({
        type: 'RETURN_PROMPT',
        data: e.data.data,
        hostSessionId
      });
    }

    if (e.data?.type === '__RETURN_CHARACTER_PROMPTS__') {
      console.log('[Bridge] Received __RETURN_CHARACTER_PROMPTS__, relaying to popup');
      chrome.runtime.sendMessage({
        type: 'RETURN_CHARACTER_PROMPTS',
        data: e.data.data,
        hostSessionId
      });
    }
    
    if (e.data?.type === '__SYNC_TAB__') {
      chrome.runtime.sendMessage({
        type: 'SYNC_TAB',
        data: e.data.data,
        hostSessionId
      });
    }

    // 来自注入层 history modal 的恢复指令，中继给 popup
    if (e.data?.type === '__RESTORE_HISTORY__') {
      chrome.runtime.sendMessage({
        type: 'RESTORE_HISTORY_SNAPSHOT',
        snapshot: e.data.snapshot,
        hostSessionId
      });
    }

    if (e.data?.type === '__APPEND_HISTORY_SNIPPET__') {
      chrome.runtime.sendMessage({
        type: 'APPEND_HISTORY_SNIPPET',
        snapshot: e.data.snapshot,
        target: e.data.target,
        hostSessionId
      });
    }

  });

  // Relay from Popup to Injector
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // console.log('[Bridge] Received runtime message:', request);
    if (request.type === 'GET_PROMPT') {
      console.log('[Bridge] Broadcasting __GET_PROMPT__ to window');
      window.postMessage({ type: '__GET_PROMPT__' }, '*');
    }
    if (request.type === 'SET_PROMPT') {
      console.log('[Bridge] Broadcasting __SET_PROMPT__ to window');
      window.postMessage({
        type: '__SET_PROMPT__',
        data: request.data
      }, '*');
    }
    if (request.type === 'SET_CHARACTER_PROMPTS') {
      console.log('[Bridge] Broadcasting __SET_CHARACTER_PROMPTS__ to window');
      window.postMessage({
        type: '__SET_CHARACTER_PROMPTS__',
        data: request.data
      }, '*');
    }
    if (request.type === 'SWITCH_TAB') {
      window.postMessage({
        type: '__SWITCH_TAB__',
        data: request.data
      }, '*');
    }
    if (request.type === 'SET_RESOLUTION') {
      window.postMessage({
        type: '__SET_RESOLUTION__',
        data: request.data
      }, '*');
    }
    // 从 popup 打开历史与收藏面板
    if (request.type === 'OPEN_HISTORY_MODAL') {
      window.postMessage({ type: '__OPEN_HISTORY_MODAL__' }, '*');
    }
    
    // Toggle 分组标签面板
    if (request.type === 'TOGGLE_GROUP_TAGS_PANEL') {
      if (window.toggleGroupTagsPanel) window.toggleGroupTagsPanel();
    }
    
    // 转发主面板的标签状态给悬浮窗 iframe
    if (request.type === 'SYNC_ACTIVE_TAGS') {
      const iframe = document.getElementById('group-tags-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
          type: '__SYNC_ACTIVE_TAGS__', 
          activeTags: request.activeTags,
          inactiveTags: request.inactiveTags,
          targetLabel: request.targetLabel
        }, '*');
      }
    }
    if (request.type === 'GET_RUNTIME_STATE') {
      sendResponse({ 
        sequentialCounters,
        sequentialStepProgress,
        randomWildcardLocks
      });
    }
    if (request.type === 'SET_SEQUENTIAL_COUNTER') {
      const { name, value } = request;
      if (name) {
        sequentialCounters[name] = value;
        saveScopedSequentialCounters(sequentialCounters);
        // 通知 injector 更新内存中的计数器
        window.postMessage({
          type: '__SET_SEQUENTIAL_COUNTER__',
          name,
          value
        }, '*');
        notifyRuntimeStateUpdate();
      }
    }
    if (request.type === 'RESET_STEP_PROGRESS') {
      const { key, isSequential } = request;
      if (key) {
        if (isSequential) {
          // 顺序通配符：清除步长进度
          delete sequentialStepProgress[key];
          saveScopedSequentialStepProgress(sequentialStepProgress);
          window.postMessage({
            type: '__RESET_STEP_PROGRESS__',
            key,
            isSequential: true
          }, '*');
        } else {
          // 随机通配符：清除锁定状态
          delete randomWildcardLocks[key];
          saveScopedRandomWildcardLocks(randomWildcardLocks);
          window.postMessage({
            type: '__RESET_STEP_PROGRESS__',
            key,
            isSequential: false
          }, '*');
        }
        notifyRuntimeStateUpdate();
      }
    }
    
    // Return true if we want to sendResponse asynchronously, but here we use runtime.sendMessage for return.
  });
})();
