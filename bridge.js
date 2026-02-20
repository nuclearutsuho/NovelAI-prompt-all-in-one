// bridge.js
(async () => {
  // 1) get settings from storage  ← preservePrompt 포함 (包含 preservePrompt)
  let {
    wildcards = {},
    v3mode = false,
    preservePrompt = true,
    alternativeDanbooruAutocomplete = true,
    triggerTab = false,
    triggerSpace = true,
    sequentialCounters = {}
  } = await chrome.storage.local.get(['wildcards', 'v3mode', 'preservePrompt', 'alternativeDanbooruAutocomplete', 'triggerTab', 'triggerSpace', 'sequentialCounters']);

  // 2) inject script to page
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injector.js');
  s.onload = () => {
    window.postMessage({
      type: '__WILDCARD_INIT__',
      map: wildcards,
      v3: v3mode,
      preservePrompt,
      alternativeDanbooruAutocomplete,
      triggerTab,
      triggerSpace,
      sequentialCounters
    }, '*');
    s.remove();
  };
  (document.head || document.documentElement).appendChild(s);

  // 2.5) inject auto-clicker to page context
  const ac = document.createElement('script');
  ac.src = chrome.runtime.getURL('auto-clicker.js');
  ac.onload = () => ac.remove();
  (document.head || document.documentElement).appendChild(ac);

  // 3) inject manager panel (runs in Content Script context)
  function injectManagerPanel() {
    // 避免重复注入
    if (document.getElementById('wildcard-manager-container')) return;

    const STORAGE_KEY = 'wildcardPanelState';
    const popupUrl = chrome.runtime.getURL('popup.html');
    const cssUrl = chrome.runtime.getURL('manager-panel.css');

    // Inject CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);

    // 创建触发按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'wildcard-manager-toggle';
    toggleBtn.title = 'Wildcard Manager';
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
        <span class="title">🎴 Wildcard Manager</span>
        <div class="controls">
          <button class="min-btn" title="Minimize">_</button>
          <button class="close-btn" title="Close">×</button>
        </div>
      </div>
      <iframe id="wildcard-manager-iframe" src="${popupUrl}"></iframe>
    `;
    document.body.appendChild(container);

    const header = container.querySelector('#wildcard-manager-header');
    const closeBtn = container.querySelector('.close-btn');
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
    closeBtn.addEventListener('click', hidePanel);
    minBtn.addEventListener('click', toggleMinimize);

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
    chrome.storage.local.get(STORAGE_KEY, data => {
      const state = data[STORAGE_KEY];
      if (state) {
        // Apply dimensions and position while hidden
        if (state.width) container.style.width = state.width + 'px';
        if (state.height) container.style.height = state.height + 'px';

        if (typeof state.left === 'number') {
          // Robust boundary check
          const safeLeft = Math.max(0, Math.min(state.left, window.innerWidth - 50));
          container.style.left = safeLeft + 'px';
          container.style.right = 'auto';
        }
        if (typeof state.top === 'number') {
          const safeTop = Math.max(0, Math.min(state.top, window.innerHeight - 50));
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
        setTimeout(() => {
          isInitializing = false;
        }, 300);
      });
    });

    // 键盘快捷键 Ctrl+Shift+W 切换面板
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        togglePanel();
      }
    });

    console.log('[Wildcard] Manager panel injected');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectManagerPanel);
  } else {
    injectManagerPanel();
  }

  // 3) propagate later changes
  chrome.storage.onChanged.addListener(changes => {
    // wildcards, v3mode, preservePrompt, alternativeDanbooruAutocomplete 중 하나라도 바뀌면 반영 (wildcards, v3mode, preservePrompt, alternativeDanbooruAutocomplete 中任何一个改变都反映)
    if (changes.wildcards ||
      changes.v3mode ||
      changes.preservePrompt ||
      changes.alternativeDanbooruAutocomplete ||
      changes.triggerTab ||
      changes.triggerSpace) {

      wildcards = changes.wildcards
        ? changes.wildcards.newValue
        : wildcards;
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

      window.postMessage({
        type: '__WILDCARD_UPDATE__',
        map: wildcards,
        v3: v3mode,
        preservePrompt,
        alternativeDanbooruAutocomplete,
        triggerTab,
        triggerSpace,
        sequentialCounters,
      }, '*');
    }
  });

  // Handle sequential counter updates from injector
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    if (e.data?.type === '__UPDATE_SEQUENTIAL_COUNTER__') {
      const { name, value } = e.data;
      sequentialCounters[name] = value;
      // Debounce could be added if needed, but generation is relatively slow
      chrome.storage.local.set({ sequentialCounters });
    }
    if (e.data?.type === '__CLEAN_NUMERIC_PREFIXES__') {
      chrome.runtime.sendMessage({ type: '__CLEAN_NUMERIC_PREFIXES__' });
    }
  });

  const csvUrl = chrome.runtime.getURL('dictionary.csv');
  const res = await fetch(csvUrl);
  const text = await res.text();

  const autocompleteDict = text.split(/\r?\n/)
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

  if (alternativeDanbooruAutocomplete) {
    window.postMessage({
      type: '__AUTOCOMPLETE_DICT__',
      data: autocompleteDict
    }, '*');
  }

  window.addEventListener('message', e => {
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
        data: e.data.data
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
    // Return true if we want to sendResponse asynchronously, but here we use runtime.sendMessage for return.
  });
})();
