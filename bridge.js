// bridge.js
(async () => {
  // 1) get settings from storage  ← preservePrompt 포함 (包含 preservePrompt)
  let {
    wildcards = {},
    v3mode = false,
    preservePrompt = true,
    alternativeDanbooruAutocomplete = true,
    triggerTab = false,
    triggerSpace = true
  } = await chrome.storage.local.get(['wildcards', 'v3mode', 'preservePrompt', 'alternativeDanbooruAutocomplete', 'triggerTab', 'triggerSpace']);

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
      triggerSpace
    }, '*');
    s.remove();
  };
  (document.head || document.documentElement).appendChild(s);

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
          <button class="close-btn" title="Close">×</button>
        </div>
      </div>
      <iframe id="wildcard-manager-iframe" src="${popupUrl}"></iframe>
    `;
    document.body.appendChild(container);

    const header = container.querySelector('#wildcard-manager-header');
    const closeBtn = container.querySelector('.close-btn');

    // 显示/隐藏面板
    function togglePanel() {
      container.classList.toggle('visible');
      saveState();
    }

    function hidePanel() {
      container.classList.remove('visible');
      saveState();
    }

    toggleBtn.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', hidePanel);

    // 拖拽功能
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
      saveState();
    });
    resizeObserver.observe(container);

    // 保存面板状态
    function saveState() {
      const rect = container.getBoundingClientRect();
      const state = {
        visible: container.classList.contains('visible'),
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
      if (!state) return;

      if (state.width) container.style.width = state.width + 'px';
      if (state.height) container.style.height = state.height + 'px';
      if (typeof state.left === 'number') {
        container.style.left = Math.min(state.left, window.innerWidth - 100) + 'px';
        container.style.right = 'auto';
      }
      if (typeof state.top === 'number') {
        container.style.top = Math.min(state.top, window.innerHeight - 100) + 'px';
      }
      if (state.visible) {
        container.classList.add('visible');
      }
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
      }, '*');
    }
  });

  const csvUrl = chrome.runtime.getURL('dictionary.csv');
  const res = await fetch(csvUrl);
  const text = await res.text();

  const autocompleteDict = text.split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const regex = /"([^"]*(?:""[^"]*)*)"|([^,]+)/g;
      const row = [];
      let match;

      // 정규표현식을 순회하며 매치된 그룹을 배열에 저장 (遍历正则表达式并将匹配的组保存到数组)
      while ((match = regex.exec(line))) {
        if (match[1] !== undefined) {
          // 큰따옴표 내부 내용: 내부의 이스케이프된 큰따옴표 처리 (예: "" -> ") (双引号内部内容：处理内部转义的双引号 (例如: "" -> "))
          row.push(match[1].replace(/""/g, '"'));
        } else if (match[2] !== undefined) {
          // 큰따옴표에 묶이지 않은 필드 (未被双引号包裹的字段)
          row.push(match[2]);
        }
      }

      let [word, colorCode, popCount, aliases, zhCN] = row;
      if (aliases) aliases = `"${aliases}"`;
      else aliases = '""';
      return {
        word,
        colorCode: colorCode.trim(),
        popCount: parseInt(popCount),
        aliases: aliases.replace(/"/g, '').split(',').map(a => a.trim()),
        zhCN: zhCN ? zhCN.trim() : ''  // 中文翻译 (Chinese translation)
      };
    });

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.type !== '__REQUEST_AUTOCOMPLETE_DICT__') return;
    window.postMessage({
      type: '__AUTOCOMPLETE_DICT__',
      data: autocompleteDict
    }, '*');
  });
})();
