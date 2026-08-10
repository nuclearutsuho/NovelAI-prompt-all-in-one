(function initNovelAICompat(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.__NAI_AIO_NOVELAI_COMPAT__ = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNovelAICompat(root) {
  'use strict';

  const GENERATE_IMAGE_PATHS = new Set([
    '/ai/generate-image',
    '/ai/generate-image-stream'
  ]);

  const BASE_EDITOR_SELECTORS = Object.freeze({
    positive: [
      '.prompt-input-box-base-prompt .ProseMirror',
      '.image-gen-prompt-main .prompt-input-box-prompt .ProseMirror',
      '.prompt-input-box-prompt .ProseMirror'
    ].join(', '),
    negative: '.prompt-input-box-undesired-content .ProseMirror'
  });

  const CHARACTER_TAB_LABELS = Object.freeze({
    positive: ['Prompt', 'Base Prompt', '提示词', 'プロンプト'],
    negative: ['Undesired Content', '不期望的内容', '负面提示词', '除外したい要素']
  });

  const ADD_CHARACTER_LABELS = ['Add Character', '添加角色', 'キャラの追加'];
  const OTHER_CHARACTER_LABELS = ['Other', '其他', 'その他'];

  function isGenerateImageRequestUrl(url, baseUrl) {
    try {
      const fallbackBase = baseUrl || root?.location?.href || 'https://novelai.net/image';
      const parsed = new URL(String(url || ''), fallbackBase);
      const isImageHost = parsed.hostname === 'image.novelai.net' ||
        /^image-[a-z0-9-]+\.novelai\.net$/i.test(parsed.hostname);
      const pathname = parsed.pathname.replace(/\/+$/, '');
      return isImageHost && GENERATE_IMAGE_PATHS.has(pathname);
    } catch (error) {
      return false;
    }
  }

  function normalizePromptText(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u200b/g, '')
      .trim();
  }

  function normalizePromptForComparison(value) {
    return normalizePromptText(value).replace(/\s+/g, ' ');
  }

  function arePromptTextsEquivalent(left, right) {
    return normalizePromptForComparison(left) === normalizePromptForComparison(right);
  }

  function normalizeCharacterStorage(existingCharacters, incomingCharacters) {
    const existing = Array.isArray(existingCharacters) ? existingCharacters : [];
    const incoming = Array.isArray(incomingCharacters) ? incomingCharacters : [];

    return incoming.map((character, index) => {
      const previous = existing[index] && typeof existing[index] === 'object'
        ? existing[index]
        : {};
      const next = character && typeof character === 'object' ? character : {};

      return {
        center: { x: 0.5, y: 0.5 },
        enabled: true,
        ...previous,
        prompt: next.positive !== undefined ? String(next.positive) : String(previous.prompt || ''),
        uc: next.negative !== undefined ? String(next.negative) : String(previous.uc || '')
      };
    });
  }

  function createDomPromptAdapter(options = {}) {
    const documentRef = options.documentRef || root?.document;
    const windowRef = options.windowRef || root;
    const logger = options.logger || root?.console || console;
    const operationTimeoutMs = Number(options.operationTimeoutMs) || 2500;

    if (!documentRef || !windowRef) {
      throw new Error('NovelAI DOM adapter requires document and window');
    }

    const wait = (ms) => new Promise(resolve => windowRef.setTimeout(resolve, ms));

    async function waitForCondition(check, timeoutMs = operationTimeoutMs, intervalMs = 40) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        try {
          if (check()) return true;
        } catch (error) {
          // DOM 正在重绘时短暂读取失败是正常现象，等待下一轮。
        }
        await wait(intervalMs);
      }
      return false;
    }

    function isVisible(element) {
      if (!element || typeof element.getBoundingClientRect !== 'function') return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = windowRef.getComputedStyle ? windowRef.getComputedStyle(element) : null;
      return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    }

    function findFirstVisible(elements) {
      return Array.from(elements || []).find(isVisible) || null;
    }

    function findBaseEditor(mode) {
      const selector = BASE_EDITOR_SELECTORS[mode];
      if (!selector) return null;
      return Array.from(documentRef.querySelectorAll(selector)).find(element => {
        return !element.closest('.character-prompt-input') && isVisible(element);
      }) || null;
    }

    function getBasePromptContainer() {
      return findFirstVisible(documentRef.querySelectorAll('.image-gen-prompt-main')) || documentRef;
    }

    function findBaseTabButton(mode) {
      const labels = CHARACTER_TAB_LABELS[normalizeTabMode(mode)];
      return Array.from(getBasePromptContainer().querySelectorAll('button')).find(button => {
        const text = normalizePromptText(button.textContent);
        return isVisible(button) && labels.some(label => text === label || text.includes(label));
      }) || null;
    }

    function detectBaseTab() {
      for (const mode of ['positive', 'negative']) {
        const button = findBaseTabButton(mode);
        if (!button) continue;
        const parent = button.parentElement || button;
        const opacity = Number.parseFloat(windowRef.getComputedStyle(parent).opacity || '1');
        if (button.getAttribute('aria-selected') === 'true' ||
          button.getAttribute('aria-pressed') === 'true' ||
          button.getAttribute('data-state') === 'active' ||
          button.classList.contains('active') || opacity > 0.75) {
          return mode;
        }
      }
      return null;
    }

    async function switchBaseTab(mode) {
      const normalizedMode = normalizeTabMode(mode);
      if (detectBaseTab() === normalizedMode) return true;
      const button = findBaseTabButton(normalizedMode);
      if (!button) return false;
      button.click();
      return waitForCondition(() => detectBaseTab() === normalizedMode, operationTimeoutMs);
    }

    function readEditorText(editor) {
      return normalizePromptText(editor?.innerText || editor?.textContent || '');
    }

    function dispatchEditorInput(editor, text) {
      try {
        if (typeof windowRef.InputEvent === 'function') {
          editor.dispatchEvent(new windowRef.InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
          }));
          return;
        }
      } catch (error) {
        // 某些 Chromium 版本不允许构造带 data 的 InputEvent，退回普通 Event。
      }
      editor.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    }

    function setEditorContent(editor, text) {
      if (!editor || typeof text !== 'string' || !isVisible(editor)) {
        return { ok: false, changed: false, reason: 'editor-unavailable' };
      }

      if (arePromptTextsEquivalent(readEditorText(editor), text)) {
        return { ok: true, changed: false, reason: 'already-current' };
      }

      editor.focus();
      const selection = windowRef.getSelection();
      const range = documentRef.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);

      let commandSucceeded = false;
      try {
        commandSucceeded = text
          ? documentRef.execCommand('insertText', false, text)
          : documentRef.execCommand('delete');
      } catch (error) {
        commandSucceeded = false;
      }

      if (!commandSucceeded && !arePromptTextsEquivalent(readEditorText(editor), text)) {
        // execCommand 虽已废弃，但仍是 ProseMirror 最稳定的输入入口；失败时才直接修改 DOM。
        editor.textContent = text;
      }

      dispatchEditorInput(editor, text);
      return { ok: true, changed: true, reason: commandSucceeded ? 'exec-command' : 'dom-input' };
    }

    async function writeEditorAndVerify(editor, text) {
      let result = setEditorContent(editor, String(text));
      if (!result.ok) return result;

      let verified = await waitForCondition(
        () => arePromptTextsEquivalent(readEditorText(editor), text),
        Math.min(operationTimeoutMs, 1200)
      );

      if (!verified) {
        result = setEditorContent(editor, String(text));
        verified = result.ok && await waitForCondition(
          () => arePromptTextsEquivalent(readEditorText(editor), text),
          Math.min(operationTimeoutMs, 1200)
        );
      }

      return {
        ...result,
        ok: Boolean(verified),
        reason: verified ? result.reason : 'verification-failed'
      };
    }

    function readBasePrompt(mode) {
      const editor = findBaseEditor(mode);
      return editor ? readEditorText(editor) : undefined;
    }

    async function syncBasePromptsDOM(data = {}) {
      const result = { ok: true, fields: {}, failures: [] };

      for (const mode of ['positive', 'negative']) {
        if (data[mode] === undefined) continue;
        const editor = findBaseEditor(mode);
        const fieldResult = await writeEditorAndVerify(editor, String(data[mode]));
        result.fields[mode] = fieldResult;
        if (!fieldResult.ok) {
          result.ok = false;
          result.failures.push({ field: mode, reason: fieldResult.reason });
        }
      }

      return result;
    }

    function getSettingsRoot() {
      return findFirstVisible(documentRef.querySelectorAll('.settings-panel, .mobile-tray-contents')) || documentRef;
    }

    function getCharacterIndex(container, fallbackIndex) {
      const match = String(container?.className || '').match(/character-prompt-input-(\d+)/);
      return match ? Number.parseInt(match[1], 10) : fallbackIndex;
    }

    function getCharacterContainers() {
      const rootElement = getSettingsRoot();
      return Array.from(rootElement.querySelectorAll('.character-prompt-input'))
        .filter(isVisible)
        .sort((left, right) => getCharacterIndex(left, 0) - getCharacterIndex(right, 0));
    }

    function normalizeTabMode(mode) {
      return mode === 'negative' || mode === 'neg' ? 'negative' : 'positive';
    }

    function findCharacterTabButton(container, mode) {
      const labels = CHARACTER_TAB_LABELS[normalizeTabMode(mode)];
      return Array.from(container?.querySelectorAll('button') || []).find(button => {
        const text = normalizePromptText(button.textContent);
        return isVisible(button) && labels.some(label => text === label || text.includes(label));
      }) || null;
    }

    function detectCharacterTab(container) {
      for (const mode of ['positive', 'negative']) {
        const button = findCharacterTabButton(container, mode);
        if (!button) continue;
        const parent = button.parentElement || button;
        const opacity = Number.parseFloat(windowRef.getComputedStyle(parent).opacity || '1');
        const isSelected = button.getAttribute('aria-selected') === 'true' ||
          button.getAttribute('aria-pressed') === 'true' ||
          button.getAttribute('data-state') === 'active' ||
          button.classList.contains('active') ||
          opacity > 0.75;
        if (isSelected) return mode;
      }
      return null;
    }

    async function switchCharacterTab(container, mode) {
      const normalizedMode = normalizeTabMode(mode);
      if (detectCharacterTab(container) === normalizedMode) return true;

      const button = findCharacterTabButton(container, normalizedMode);
      if (!button) return false;
      button.click();

      return waitForCondition(
        () => detectCharacterTab(container) === normalizedMode &&
          Boolean(findFirstVisible(container.querySelectorAll('.ProseMirror'))),
        operationTimeoutMs
      );
    }

    async function switchCharacterTabAt(index, mode) {
      const container = getCharacterContainers()[index];
      if (!container) return false;
      const editorReady = await ensureCharacterEditorVisible(container);
      return editorReady ? switchCharacterTab(container, mode) : false;
    }

    async function ensureCharacterEditorVisible(container) {
      if (!container) return false;

      const hasVisibleEditor = () => Boolean(
        findCharacterTabButton(container, 'positive') &&
        findFirstVisible(container.querySelectorAll('.ProseMirror'))
      );
      if (hasVisibleEditor()) return true;

      // NovelAI 当前版本新增角色后会默认折叠角色卡片；先展开卡片，才能访问正负提示词标签。
      const toggle = Array.from(container.querySelectorAll('[role="button"]')).find(element => {
        return isVisible(element) && element.closest('.character-prompt-input') === container;
      });
      if (!toggle || typeof toggle.click !== 'function') return false;

      toggle.click();
      return waitForCondition(hasVisibleEditor, operationTimeoutMs);
    }

    function getCharacterTabStates() {
      return getCharacterContainers().map(container => detectCharacterTab(container));
    }

    function findVisibleButtonByLabels(labels, scope = documentRef) {
      return Array.from(scope.querySelectorAll('button, [role="button"]')).find(element => {
        const text = normalizePromptText(element.textContent);
        return isVisible(element) && labels.some(label => text === label || text.includes(label));
      }) || null;
    }

    function findCharacterDeleteButton(container) {
      return Array.from(container?.querySelectorAll('button') || []).find(button => {
        if (!isVisible(button)) return false;
        return Array.from(button.querySelectorAll('*')).some(child => {
          const style = windowRef.getComputedStyle(child);
          const mask = style.maskImage || style.webkitMaskImage ||
            style.getPropertyValue('-webkit-mask-image') || '';
          return mask.includes('trash');
        });
      }) || null;
    }

    async function chooseOtherCharacterType() {
      const dialog = findFirstVisible(documentRef.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
      const button = findVisibleButtonByLabels(OTHER_CHARACTER_LABELS, dialog || documentRef);
      if (!button) return false;
      button.click();
      return true;
    }

    async function reconcileCharacterCount(targetCount) {
      const failures = [];
      let containers = getCharacterContainers();

      while (containers.length < targetCount) {
        const beforeCount = containers.length;
        const addButton = findVisibleButtonByLabels(ADD_CHARACTER_LABELS);
        if (!addButton) {
          failures.push({ operation: 'add', reason: 'add-button-not-found' });
          break;
        }

        addButton.click();
        await wait(100);
        await chooseOtherCharacterType();
        const added = await waitForCondition(
          () => getCharacterContainers().length > beforeCount,
          operationTimeoutMs
        );
        containers = getCharacterContainers();
        if (!added) {
          failures.push({ operation: 'add', reason: 'character-not-created' });
          break;
        }

        // 新站点会把刚创建的角色卡片保持折叠，提前展开可避免后续找不到 Prompt 标签。
        await ensureCharacterEditorVisible(containers[containers.length - 1]);
      }

      while (containers.length > targetCount) {
        const beforeCount = containers.length;
        const lastContainer = containers[containers.length - 1];
        const deleteButton = findCharacterDeleteButton(lastContainer);
        if (!deleteButton) {
          failures.push({ operation: 'delete', reason: 'delete-button-not-found' });
          break;
        }

        deleteButton.click();
        const deleted = await waitForCondition(
          () => getCharacterContainers().length < beforeCount,
          operationTimeoutMs
        );
        containers = getCharacterContainers();
        if (!deleted) {
          failures.push({ operation: 'delete', reason: 'character-not-deleted' });
          break;
        }
      }

      return {
        ok: failures.length === 0 && containers.length === targetCount,
        actualCount: containers.length,
        failures
      };
    }

    async function syncCharacterPromptsDOM(characterList) {
      const characters = Array.isArray(characterList) ? characterList : [];
      const countResult = await reconcileCharacterCount(characters.length);
      const containers = getCharacterContainers();
      const result = {
        ok: countResult.ok,
        count: countResult,
        characters: [],
        failures: [...countResult.failures]
      };

      for (let index = 0; index < characters.length; index += 1) {
        const container = containers[index];
        const character = characters[index] || {};
        const finalMode = normalizeTabMode(character.activeTab);
        const requestedModes = ['positive', 'negative'].filter(mode => character[mode] !== undefined);
        const orderedModes = [
          ...requestedModes.filter(mode => mode !== finalMode),
          ...requestedModes.filter(mode => mode === finalMode)
        ];
        const characterResult = { index, ok: true, fields: {}, finalMode };

        if (!container) {
          characterResult.ok = false;
          characterResult.reason = 'character-container-not-found';
          result.characters.push(characterResult);
          result.failures.push({ index, reason: characterResult.reason });
          result.ok = false;
          continue;
        }

        const editorReady = await ensureCharacterEditorVisible(container);
        if (!editorReady) {
          characterResult.ok = false;
          characterResult.reason = 'character-editor-unavailable';
          result.characters.push(characterResult);
          result.failures.push({ index, reason: characterResult.reason });
          result.ok = false;
          continue;
        }

        for (const mode of orderedModes) {
          const switched = await switchCharacterTab(container, mode);
          if (!switched) {
            characterResult.ok = false;
            characterResult.fields[mode] = { ok: false, reason: 'tab-switch-failed' };
            continue;
          }

          const editor = findFirstVisible(container.querySelectorAll('.ProseMirror'));
          const fieldResult = await writeEditorAndVerify(editor, String(character[mode]));
          characterResult.fields[mode] = fieldResult;
          if (!fieldResult.ok) characterResult.ok = false;
        }

        if (detectCharacterTab(container) !== finalMode) {
          const restored = await switchCharacterTab(container, finalMode);
          if (!restored) {
            characterResult.ok = false;
            characterResult.finalTabRestored = false;
          }
        }

        if (!characterResult.ok) {
          result.failures.push({ index, reason: 'character-sync-incomplete', fields: characterResult.fields });
          result.ok = false;
        }
        result.characters.push(characterResult);
      }

      if (!result.ok) {
        logger.warn('[NovelAI Compat] 角色提示词 DOM 同步未完全成功', result.failures);
      }
      return result;
    }

    function readVisibleCharacterPrompts() {
      return getCharacterContainers().map(container => {
        const mode = detectCharacterTab(container) || 'positive';
        const editor = findFirstVisible(container.querySelectorAll('.ProseMirror'));
        const value = editor ? readEditorText(editor) : undefined;
        return {
          positive: mode === 'positive' ? value : undefined,
          negative: mode === 'negative' ? value : undefined,
          gender: 'other',
          activeTab: mode
        };
      });
    }

    return Object.freeze({
      getBaseTab: detectBaseTab,
      readBasePrompt,
      readVisibleCharacterPrompts,
      syncBasePromptsDOM,
      syncCharacterPromptsDOM,
      getCharacterCount: () => getCharacterContainers().length,
      getCharacterTabStates,
      switchBaseTab,
      switchCharacterTabAt
    });
  }

  return Object.freeze({
    GENERATE_IMAGE_PATHS,
    arePromptTextsEquivalent,
    createDomPromptAdapter,
    isGenerateImageRequestUrl,
    normalizeCharacterStorage,
    normalizePromptText
  });
});
