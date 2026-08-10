// Group Tags 悬浮预览控制器：集中管理浮层、计时器与收藏动作。
(function initGroupTagsPreviewController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GroupTagsPreviewController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPreviewApi() {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampPosition(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeTypeClass(value) {
    const typeClass = String(value || '').trim();
    return /^[a-z0-9_-]+$/i.test(typeClass) ? typeClass : 'partial';
  }

  function dispatchHistoryAction(windowRef, runtime, message) {
    const parentWindow = windowRef?.parent;
    if (parentWindow && parentWindow !== windowRef && typeof parentWindow.postMessage === 'function') {
      // 内嵌 Group Tags 必须经过当前标签页的 Bridge，由 Bridge 附加 hostSessionId。
      parentWindow.postMessage(message, '*');
      return 'parent';
    }
    if (runtime?.sendMessage) {
      runtime.sendMessage(message.type === '__RESTORE_HISTORY__'
        ? { type: 'RESTORE_HISTORY_SNAPSHOT', snapshot: message.snapshot }
        : { type: 'APPEND_HISTORY_SNIPPET', snapshot: message.snapshot, target: message.target });
      return 'runtime';
    }
    return 'unavailable';
  }

  function buildFavoritePreviewHtml(item, formatTime = () => '') {
    const sections = Array.isArray(item?.preview?.sections) ? item.preview.sections : [];
    const sectionsHtml = sections.map(section => `
      <div class="favorites-preview-section">
        <div class="favorites-preview-label">${escapeHtml(section?.label)}</div>
        <div class="favorites-preview-text">${escapeHtml(section?.text)}</div>
      </div>
    `).join('');

    return `
      <div class="favorites-preview-title">
        <div>
          <div>${escapeHtml(item?.name)}</div>
          <div class="favorites-preview-meta">${escapeHtml(formatTime(item?.timestamp))}</div>
        </div>
        <span class="favorite-type-badge ${normalizeTypeClass(item?.typeClass)}">${escapeHtml(item?.typeLabel)}</span>
      </div>
      <div class="favorites-preview-body">
        ${sectionsHtml || '<div class="favorites-preview-section"><div class="favorites-preview-text">暂无内容</div></div>'}
      </div>
    `;
  }

  function buildSentencePreviewHtml(item, isEditMode) {
    const zh = escapeHtml(item?.zh);
    const en = escapeHtml(item?.en);
    if (isEditMode) {
      const editableStyles = 'outline:none;cursor:text;border-bottom:1px dashed rgba(255,255,255,0.2);transition:border-color 0.2s,background-color 0.2s;padding:2px 4px;margin:-2px -4px;border-radius:4px;';
      return `
        <div class="favorites-preview-title">
          <div>
            <div>句子预览 <span style="color:#818cf8;font-size:11px;margin-left:4px;font-weight:normal;">(点击文本直接修改)</span></div>
            <div class="favorites-preview-meta">Sentence</div>
          </div>
          <span class="favorite-type-badge sentence-preview-badge" style="background:#4f46e5;">Editing</span>
        </div>
        <div class="favorites-preview-body">
          <div class="favorites-preview-section">
            <div class="favorites-preview-label">中文</div>
            <div class="favorites-preview-text sentence-preview-edit-zh" contenteditable="true" style="${editableStyles}" spellcheck="false">${zh}</div>
          </div>
          <div class="favorites-preview-section">
            <div class="favorites-preview-label">English</div>
            <div class="favorites-preview-text sentence-preview-edit-en" contenteditable="true" style="${editableStyles}" spellcheck="false">${en}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="favorites-preview-title">
        <div>
          <div>句子预览</div>
          <div class="favorites-preview-meta">Sentence</div>
        </div>
        <span class="favorite-type-badge sentence-preview-badge">Sentence</span>
      </div>
      <div class="favorites-preview-body">
        <div class="favorites-preview-section">
          <div class="favorites-preview-label">中文</div>
          <div class="favorites-preview-text">${zh || '暂无内容'}</div>
        </div>
        <div class="favorites-preview-section">
          <div class="favorites-preview-label">English</div>
          <div class="favorites-preview-text">${en || 'No content'}</div>
        </div>
      </div>
    `;
  }

  function createController(options = {}) {
    const {
      scope,
      documentRef = globalThis.document,
      windowRef = globalThis.window,
      runtime = globalThis.chrome?.runtime,
      favoritesUtils = {},
      cloneData = value => JSON.parse(JSON.stringify(value)),
      showModal,
      hideModal,
      modalRoot,
      getIsEditMode = () => false
    } = options;

    if (!scope?.timeout || !documentRef?.body || !showModal || !hideModal || !modalRoot) {
      throw new Error('[GroupTagsPreview] 缺少生命周期、DOM 或弹窗依赖');
    }

    let popover = null;
    let hideTimer = null;

    function cancelPendingHide() {
      if (hideTimer === null) return;
      scope.cancelTimeout(hideTimer);
      hideTimer = null;
    }

    function ensurePopover() {
      if (popover) return popover;
      popover = documentRef.createElement('div');
      popover.className = 'favorites-preview-popover';
      scope.ownNode(popover);
      scope.on(popover, 'wheel', event => {
        const body = popover?.querySelector('.favorites-preview-body');
        if (!body || body.scrollHeight <= body.clientHeight) return;
        event.preventDefault();
        event.stopPropagation();
        body.scrollTop += event.deltaY;
      }, { passive: false });
      scope.on(popover, 'mouseenter', cancelPendingHide);
      scope.on(popover, 'mouseleave', hide);
      documentRef.body.appendChild(popover);
      return popover;
    }

    function hide() {
      cancelPendingHide();
      popover?.classList.remove('visible');
    }

    function scheduleHide() {
      cancelPendingHide();
      // 给鼠标从卡片移动到浮层预留一点时间。
      hideTimer = scope.timeout(() => {
        hideTimer = null;
        hide();
      }, 80);
    }

    function position(anchorRect) {
      if (!popover || !anchorRect) return;
      const offset = 2;
      popover.style.maxWidth = '';
      popover.style.maxHeight = '';
      const viewportWidth = windowRef.innerWidth;
      const viewportHeight = windowRef.innerHeight;
      const space = {
        right: Math.max(0, viewportWidth - anchorRect.right - offset - 12),
        left: Math.max(0, anchorRect.left - offset - 12),
        bottom: Math.max(0, viewportHeight - anchorRect.bottom - offset - 12),
        top: Math.max(0, anchorRect.top - offset - 12)
      };
      const preferredOrder = ['right', 'left', 'bottom', 'top'].sort((left, right) => space[right] - space[left]);
      let placement = preferredOrder[0];

      for (const direction of preferredOrder) {
        if ((direction === 'right' || direction === 'left') && space[direction] >= 220) {
          placement = direction;
          break;
        }
        if ((direction === 'bottom' || direction === 'top') && space[direction] >= 180) {
          placement = direction;
          break;
        }
      }

      if (placement === 'right' || placement === 'left') {
        popover.style.maxWidth = `${Math.max(220, space[placement])}px`;
        popover.style.maxHeight = `${Math.max(160, viewportHeight - 24)}px`;
      } else {
        popover.style.maxWidth = `${Math.max(220, viewportWidth - 24)}px`;
        popover.style.maxHeight = `${Math.max(160, space[placement])}px`;
      }

      const rect = popover.getBoundingClientRect();
      const maxLeft = Math.max(12, viewportWidth - rect.width - 12);
      const maxTop = Math.max(12, viewportHeight - rect.height - 12);
      let left = 12;
      let top = 12;

      if (placement === 'right') {
        left = clampPosition(anchorRect.right + offset, 12, maxLeft);
        top = clampPosition(anchorRect.top + ((anchorRect.height - rect.height) / 2), 12, maxTop);
      } else if (placement === 'left') {
        left = clampPosition(anchorRect.left - rect.width - offset, 12, maxLeft);
        top = clampPosition(anchorRect.top + ((anchorRect.height - rect.height) / 2), 12, maxTop);
      } else if (placement === 'bottom') {
        left = clampPosition(anchorRect.left + ((anchorRect.width - rect.width) / 2), 12, maxLeft);
        top = clampPosition(anchorRect.bottom + offset, 12, maxTop);
      } else {
        left = clampPosition(anchorRect.left + ((anchorRect.width - rect.width) / 2), 12, maxLeft);
        top = clampPosition(anchorRect.top - rect.height - offset, 12, maxTop);
      }

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function bindFavoritePreview(card, item) {
      const updatePosition = () => position(card.getBoundingClientRect());
      card.addEventListener('mouseenter', () => {
        cancelPendingHide();
        const element = ensurePopover();
        element.innerHTML = buildFavoritePreviewHtml(item, favoritesUtils.formatTime);
        element.classList.add('visible');
        updatePosition();
      });
      card.addEventListener('mousemove', updatePosition);
      card.addEventListener('mouseleave', scheduleHide);
    }

    function applyEditableFocusStyle(element) {
      element.addEventListener('focus', () => {
        element.style.borderBottom = '1px solid #818cf8';
        element.style.backgroundColor = 'rgba(129, 140, 248, 0.1)';
      });
      element.addEventListener('blur', () => {
        element.style.borderBottom = '1px dashed rgba(255,255,255,0.2)';
        element.style.backgroundColor = 'transparent';
      });
    }

    function bindSentencePreview(card, item, context = {}) {
      const updatePosition = () => position(card.getBoundingClientRect());
      card.addEventListener('mouseenter', () => {
        cancelPendingHide();
        const isEditMode = Boolean(getIsEditMode());
        const element = ensurePopover();
        element.innerHTML = buildSentencePreviewHtml(item, isEditMode);

        if (isEditMode) {
          const zhInput = element.querySelector('.sentence-preview-edit-zh');
          const enInput = element.querySelector('.sentence-preview-edit-en');
          const bindEditor = (input, field, mirror) => {
            if (!input) return;
            applyEditableFocusStyle(input);
            input.addEventListener('input', event => {
              const value = event.target.innerText;
              item[field] = value;
              if (mirror) mirror.textContent = value;
              if (context.currentCategory) context.currentCategory._modified = true;
              if (context.currentGroup) context.currentGroup._modified = true;
            });
            input.addEventListener('keydown', event => event.stopPropagation());
          };
          bindEditor(zhInput, 'zh', context.zhPart);
          bindEditor(enInput, 'en', context.enPart);
        }

        element.classList.add('visible');
        updatePosition();
      });
      card.addEventListener('mousemove', updatePosition);
      card.addEventListener('mouseleave', scheduleHide);
    }

    function requestRestore(snapshot) {
      dispatchHistoryAction(windowRef, runtime, { type: '__RESTORE_HISTORY__', snapshot });
    }

    function requestAppend(snapshot, target) {
      dispatchHistoryAction(windowRef, runtime, {
        type: '__APPEND_HISTORY_SNIPPET__',
        snapshot,
        target
      });
    }

    function bindModalButton(selector, handler) {
      const button = modalRoot.querySelector(selector);
      if (button) button.onclick = handler;
    }

    function openFavoriteActionModal(item) {
      hide();
      const snapshot = item?.snapshot ? cloneData(item.snapshot) : null;
      if (!snapshot) return;

      if (item.type === 'full') {
        showModal(`
          <h3>恢复整条收藏</h3>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">确认恢复 <strong>${escapeHtml(item.name)}</strong> 的完整提示词状态？</div>
          <div class="modal-buttons">
            <button class="modal-btn" data-favorite-action="cancel">取消</button>
            <button class="modal-btn primary" data-favorite-action="restore">确认恢复</button>
          </div>
        `);
        bindModalButton('[data-favorite-action="cancel"]', hideModal);
        bindModalButton('[data-favorite-action="restore"]', () => {
          hideModal();
          requestRestore(snapshot);
        });
        return;
      }

      if (item.type === 'positive' || item.type === 'negative') {
        const targetLabel = item.type === 'positive' ? '正面' : '负面';
        showModal(`
          <h3>${escapeHtml(item.name)}</h3>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">选择对 ${targetLabel} 提示词执行的动作。</div>
          <div class="modal-buttons">
            <button class="modal-btn" data-favorite-action="cancel">取消</button>
            <button class="modal-btn" data-favorite-action="append">追加到${targetLabel}</button>
            <button class="modal-btn primary" data-favorite-action="restore">局部恢复${targetLabel}</button>
          </div>
        `);
        bindModalButton('[data-favorite-action="cancel"]', hideModal);
        bindModalButton('[data-favorite-action="append"]', () => {
          hideModal();
          requestAppend(snapshot, item.type);
        });
        bindModalButton('[data-favorite-action="restore"]', () => {
          hideModal();
          requestRestore(snapshot);
        });
        return;
      }

      if (item.type === 'character') {
        showModal(`
          <h3>${escapeHtml(item.name)}</h3>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">角色片段仅支持局部恢复到对应角色块。</div>
          <div class="modal-buttons">
            <button class="modal-btn" data-favorite-action="cancel">取消</button>
            <button class="modal-btn primary" data-favorite-action="restore">局部恢复角色片段</button>
          </div>
        `);
        bindModalButton('[data-favorite-action="cancel"]', hideModal);
        bindModalButton('[data-favorite-action="restore"]', () => {
          hideModal();
          requestRestore(snapshot);
        });
      }
    }

    return Object.freeze({
      bindFavoritePreview,
      bindSentencePreview,
      hide,
      openFavoriteActionModal,
      position,
      scheduleHide
    });
  }

  return Object.freeze({
    buildFavoritePreviewHtml,
    buildSentencePreviewHtml,
    clampPosition,
    createController,
    dispatchHistoryAction,
    escapeHtml
  });
});
