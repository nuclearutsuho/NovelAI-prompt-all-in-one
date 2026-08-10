// Group Tags 底部新增控制器：集中管理自动补全、拖拽调高与标签写入。
(function initGroupTagsInlineAddController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GroupTagsInlineAddController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createInlineAddApi() {
  'use strict';

  const DEFAULT_HEIGHT = 160;
  const MIN_HEIGHT = 100;
  const MAX_HEIGHT = 600;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeStoredHeight(value) {
    const parsed = Number.parseFloat(String(value || ''));
    if (!Number.isFinite(parsed)) return '';
    return `${clamp(parsed, MIN_HEIGHT, MAX_HEIGHT)}px`;
  }

  function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
    if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
    return String(count);
  }

  function filterAutocompleteEntries(entries, query, limit = 50) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return [];
    const spacedQuery = normalizedQuery.replace(/_/g, ' ');
    return (Array.isArray(entries) ? entries : []).filter(item => {
      const search = String(item?.search || '').toLowerCase();
      const word = String(item?.word || '').toLowerCase();
      return search.includes(spacedQuery) || word.includes(normalizedQuery);
    }).slice(0, limit);
  }

  function createController(options = {}) {
    const {
      scope,
      storage,
      elements,
      documentRef = typeof document !== 'undefined' ? document : null,
      getDictionary,
      getState,
      isSpecialCategoryActive,
      toCanonicalTagKey,
      toDisplayTagText,
      findGlobalTagLocation,
      formatTagLocation,
      loadEffectiveDictionaryData,
      queueDictionaryTagMeta,
      renderTagsGrid,
      onSubmitError,
      logger = console,
      heightStorageKey = 'groupTagsAutocompleteHeight'
    } = options;

    const requiredElements = ['enInput', 'zhInput', 'wrapper', 'dropdown', 'resizer', 'submitButton'];
    const missingElements = requiredElements.filter(name => !elements?.[name]);
    if (
      !scope?.on ||
      !scope?.timeout ||
      !scope?.cancelTimeout ||
      !storage?.get ||
      !storage?.set ||
      !documentRef ||
      missingElements.length > 0 ||
      typeof getDictionary !== 'function' ||
      typeof getState !== 'function' ||
      typeof toCanonicalTagKey !== 'function' ||
      typeof toDisplayTagText !== 'function' ||
      typeof findGlobalTagLocation !== 'function' ||
      typeof loadEffectiveDictionaryData !== 'function' ||
      typeof queueDictionaryTagMeta !== 'function' ||
      typeof renderTagsGrid !== 'function'
    ) {
      throw new Error(`[GroupTagsInlineAdd] 缺少控制器依赖${missingElements.length ? `: ${missingElements.join(', ')}` : ''}`);
    }

    const {
      enInput,
      zhInput,
      wrapper,
      dropdown,
      resizer,
      submitButton,
      gridContainer
    } = elements;
    const unregisterCallbacks = [];
    const timeoutIds = new Set();
    let removeMouseMove = null;
    let removeMouseUp = null;
    let selectedIndex = -1;
    let currentMatches = [];
    let startY = 0;
    let startHeight = DEFAULT_HEIGHT;
    let isSubmitting = false;
    let started = false;
    let disposed = false;

    function on(target, type, listener, listenerOptions) {
      const unregister = scope.on(target, type, listener, listenerOptions);
      unregisterCallbacks.push(unregister);
      return unregister;
    }

    function schedule(callback, delay) {
      let id = null;
      id = scope.timeout(() => {
        timeoutIds.delete(id);
        callback();
      }, delay);
      timeoutIds.add(id);
      return id;
    }

    function appendHighlightedText(container, value, searchText) {
      const sourceText = String(value || '');
      const normalizedSearch = String(searchText || '').toLowerCase();
      if (!normalizedSearch) {
        container.textContent = sourceText;
        return;
      }

      const normalizedSource = sourceText.toLowerCase();
      let cursor = 0;
      let matchIndex = normalizedSource.indexOf(normalizedSearch, cursor);
      while (matchIndex >= 0) {
        container.appendChild(documentRef.createTextNode(sourceText.slice(cursor, matchIndex)));
        const strong = documentRef.createElement('strong');
        strong.textContent = sourceText.slice(matchIndex, matchIndex + normalizedSearch.length);
        container.appendChild(strong);
        cursor = matchIndex + normalizedSearch.length;
        matchIndex = normalizedSource.indexOf(normalizedSearch, cursor);
      }
      container.appendChild(documentRef.createTextNode(sourceText.slice(cursor)));
    }

    function closeDropdown() {
      wrapper.style.display = 'none';
      selectedIndex = -1;
      currentMatches = [];
    }

    function selectMatch(match) {
      if (!match) return;
      enInput.value = String(match.word || '').replace(/_/g, ' ');
      if (match.zhCN) zhInput.value = match.zhCN;
      closeDropdown();
      zhInput.focus();
    }

    function renderDropdown(matches, query) {
      if (!matches.length) {
        closeDropdown();
        return;
      }

      dropdown.innerHTML = '';
      currentMatches = matches;
      matches.forEach((match, index) => {
        const item = documentRef.createElement('div');
        item.className = 'autocomplete-item';
        if (index === selectedIndex) item.classList.add('selected');

        const enPart = documentRef.createElement('span');
        enPart.className = 'ac-en';
        enPart.style.color = match.color;
        appendHighlightedText(enPart, match.displayWord || toDisplayTagText(match.word), query);

        const zhPart = documentRef.createElement('span');
        zhPart.className = 'ac-zh';
        const translation = documentRef.createElement('span');
        translation.className = 'autocomplete-trans';
        appendHighlightedText(translation, match.zhCN || '', query);
        const count = documentRef.createElement('span');
        count.className = 'autocomplete-count';
        count.textContent = ` (${formatCount(match.pop)})`;
        zhPart.append(translation, count);
        item.append(enPart, zhPart);
        item.addEventListener('click', () => selectMatch(match), { once: true });
        dropdown.appendChild(item);
      });
      wrapper.style.display = 'flex';
    }

    function refreshMatches() {
      const query = enInput.value.trim().toLowerCase();
      if (!query) {
        closeDropdown();
        return;
      }
      selectedIndex = -1;
      renderDropdown(filterAutocompleteEntries(getDictionary(), query), query);
    }

    async function submitTag() {
      if (isSubmitting || disposed) return false;
      const displayEn = enInput.value.trim();
      if (!displayEn || isSpecialCategoryActive?.()) return false;
      const canonicalEn = toCanonicalTagKey(displayEn);
      if (!canonicalEn) return false;

      const state = getState();
      const currentCategory = state.data?.categories?.[state.activeCategoryIndex];
      const currentGroup = currentCategory?.groups?.[state.activeGroupIndex];
      if (!currentGroup) return false;

      const existingLocation = findGlobalTagLocation(canonicalEn);
      if (existingLocation) {
        enInput.style.borderColor = '#e74c3c';
        enInput.value = '';
        enInput.placeholder = `已存在于 ${formatTagLocation?.(existingLocation) || ''}`;
        schedule(() => {
          enInput.style.borderColor = '';
          enInput.placeholder = 'Input English Tag (e.g. sunny)';
        }, 2000);
        return false;
      }

      isSubmitting = true;
      submitButton.disabled = true;
      try {
        const dictionaryData = await loadEffectiveDictionaryData();
        const zh = zhInput.value.trim();
        const existingEntry = dictionaryData.entryMap?.get(canonicalEn) || null;
        const nextZh = zh || existingEntry?.zhCN || '';
        queueDictionaryTagMeta(canonicalEn, nextZh);
        currentGroup.tags.push({ en: canonicalEn, zh: nextZh });
        currentGroup._modified = true;
        currentCategory._modified = true;

        enInput.value = '';
        zhInput.value = '';
        closeDropdown();
        enInput.focus();
        renderTagsGrid();
        schedule(() => {
          if (gridContainer) gridContainer.scrollTop = gridContainer.scrollHeight;
        }, 50);
        return true;
      } catch (error) {
        logger.error?.('[GroupTags] 新增标签失败:', error);
        onSubmitError?.(error);
        return false;
      } finally {
        isSubmitting = false;
        submitButton.disabled = false;
      }
    }

    function stopResize() {
      documentRef.body.style.cursor = '';
      resizer.classList.remove('active');
      removeMouseMove?.();
      removeMouseUp?.();
      removeMouseMove = null;
      removeMouseUp = null;
    }

    function start() {
      if (started || disposed) return;
      started = true;

      storage.get(heightStorageKey).then(data => {
        if (disposed) return;
        const height = normalizeStoredHeight(data?.[heightStorageKey]);
        if (height) wrapper.style.height = height;
      }).catch(() => {});

      on(resizer, 'mousedown', event => {
        event.preventDefault();
        startY = event.clientY;
        startHeight = wrapper.getBoundingClientRect().height || DEFAULT_HEIGHT;
        documentRef.body.style.cursor = 'row-resize';
        resizer.classList.add('active');
        removeMouseMove?.();
        removeMouseUp?.();
        removeMouseMove = scope.on(documentRef, 'mousemove', moveEvent => {
          const nextHeight = clamp(startHeight + (startY - moveEvent.clientY), MIN_HEIGHT, MAX_HEIGHT);
          wrapper.style.height = `${nextHeight}px`;
        });
        removeMouseUp = scope.on(documentRef, 'mouseup', () => {
          const height = normalizeStoredHeight(wrapper.style.height);
          stopResize();
          if (height) storage.set({ [heightStorageKey]: height }).catch(() => {});
        });
      });

      on(enInput, 'input', refreshMatches);
      on(enInput, 'keydown', event => {
        if (wrapper.style.display === 'flex') {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            selectedIndex = (selectedIndex + offset + currentMatches.length) % currentMatches.length;
            renderDropdown(currentMatches, enInput.value.trim());
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (selectedIndex >= 0) selectMatch(currentMatches[selectedIndex]);
            else {
              closeDropdown();
              if (!zhInput.value.trim()) zhInput.focus();
              else void submitTag();
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeDropdown();
          }
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (!zhInput.value.trim() && enInput.value.trim()) zhInput.focus();
          else void submitTag();
        }

        schedule(() => dropdown.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }), 10);
      });

      on(zhInput, 'keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submitTag();
      });
      on(submitButton, 'click', () => void submitTag());
      on(documentRef, 'mousedown', event => {
        if (!wrapper.contains(event.target) && event.target !== enInput) closeDropdown();
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      stopResize();
      closeDropdown();
      timeoutIds.forEach(id => scope.cancelTimeout(id));
      timeoutIds.clear();
      while (unregisterCallbacks.length) unregisterCallbacks.pop()?.();
    }

    scope.add?.(dispose);

    return {
      start,
      submitTag,
      closeDropdown,
      dispose
    };
  }

  return {
    DEFAULT_HEIGHT,
    MIN_HEIGHT,
    MAX_HEIGHT,
    normalizeStoredHeight,
    formatCount,
    filterAutocompleteEntries,
    createController
  };
});
