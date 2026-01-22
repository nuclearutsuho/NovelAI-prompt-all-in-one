// manager-panel.js - 悬浮通配符管理面板
(() => {
    // 避免重复注入
    if (document.getElementById('wildcard-manager-container')) return;

    const STORAGE_KEY = 'wildcardPanelState';

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
        <button class="minimize-btn" title="Minimize">−</button>
        <button class="close-btn" title="Close">×</button>
      </div>
    </div>
    <iframe id="wildcard-manager-iframe" src="${chrome.runtime.getURL('popup.html')}"></iframe>
  `;
    document.body.appendChild(container);

    const header = container.querySelector('#wildcard-manager-header');
    const iframe = container.querySelector('#wildcard-manager-iframe');
    const closeBtn = container.querySelector('.close-btn');
    const minimizeBtn = container.querySelector('.minimize-btn');

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
    minimizeBtn.addEventListener('click', hidePanel);

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
    function restoreState() {
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
    }

    restoreState();

    // 键盘快捷键 Ctrl+Shift+W 切换面板
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key === 'W') {
            e.preventDefault();
            togglePanel();
        }
    });

    console.log('[Wildcard] Manager panel injected');
})();
