import Sortable from "./Sortable.js";
import common from "./common.js";

const groupTagsDataUtils = typeof window !== 'undefined' ? (window.GroupTagsDataUtils || {}) : {};

export default class TagEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.tags = [];
        this.selectedIndices = new Set();
        this.onChange = options.onChange || (() => { });
        this.onAddToGroupTags = options.onAddToGroupTags || (() => { });
        this.sequentialCounters = {};
        this.render = this.render.bind(this);
        
        // Multi-select & Marquee state
        this.isSelecting = false;
        this.startPos = { x: 0, y: 0 };
        this.selectionBox = null;

        this.init();
    }

    setSequentialCounters(counters) {
        this.sequentialCounters = counters || {};
        this.render();
    }

    toCanonicalTagKey(value) {
        if (groupTagsDataUtils.toCanonicalTagKey) {
            return groupTagsDataUtils.toCanonicalTagKey(value);
        }
        return String(value || '').trim().toLowerCase();
    }

    // 统一规范外部传入的 tag，兼容旧的字符串调用和新的对象调用。
    normalizeTagInput(input) {
        if (typeof input === 'string') {
            const value = input.trim();
            return value ? { value, disabled: false } : null;
        }

        if (!input || typeof input !== 'object') return null;

        const value = String(input.value || '').trim();
        if (!value) return null;

        const normalized = {
            value,
            disabled: !!input.disabled
        };

        if (input.isStart) normalized.isStart = true;
        if (typeof input.dynWeight === 'number' && !Number.isNaN(input.dynWeight)) {
            normalized.dynWeight = input.dynWeight;
        }
        if (typeof input.aiOriginal === 'string' && input.aiOriginal.trim()) {
            normalized.aiOriginal = input.aiOriginal.trim();
        }
        // AI 翻译中的占位 tag 只在 popup 本地展示，不参与真正 prompt 同步。
        if (input.aiPending) {
            normalized.aiPending = true;
        }
        const aiPendingStartedAt = Number(input.aiPendingStartedAt);
        if (Number.isFinite(aiPendingStartedAt) && aiPendingStartedAt > 0) {
            normalized.aiPendingStartedAt = aiPendingStartedAt;
        }

        return normalized;
    }

    isPendingAiTag(tag) {
        return !!(tag && tag.aiPending);
    }

    getPendingAiDisplayText() {
        const dict = this.options.dict || {};
        return dict.tag_ai_pending || 'Translating';
    }

    formatPendingAiElapsed(tag) {
        const startedAt = Number(tag?.aiPendingStartedAt);
        if (!Number.isFinite(startedAt) || startedAt <= 0) return '0s';

        const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    syncPendingAiState(li, tag) {
        const primary = li?.querySelector('.tag-primary');
        const capsule = li?.querySelector('.tag-capsule');
        const textSpan = li?.querySelector('.tag-text');
        if (!primary || !capsule || !textSpan) return;

        const isPending = this.isPendingAiTag(tag);
        li.classList.toggle('tag-ai-pending', isPending);
        capsule.classList.toggle('tag-ai-pending', isPending);

        let spinner = primary.querySelector('.tag-ai-spinner');
        let timer = primary.querySelector('.tag-ai-timer');

        if (isPending) {
            textSpan.textContent = this.getPendingAiDisplayText();

            if (!spinner) {
                spinner = document.createElement('span');
                spinner.className = 'tag-ai-spinner';
                spinner.setAttribute('aria-hidden', 'true');
                textSpan.after(spinner);
            }

            if (!timer) {
                timer = document.createElement('span');
                timer.className = 'tag-ai-timer';
                spinner.after(timer);
            }

            timer.textContent = this.formatPendingAiElapsed(tag);
        } else {
            spinner?.remove();
            timer?.remove();
        }
    }

    init() {
        this.container.innerHTML = ''; // Clear loading placeholder
        this.container.classList.add('tag-editor-container');
        this.listElement = document.createElement('ul');
        this.listElement.className = 'tag-list';
        this.container.appendChild(this.listElement);

        // Selection Box for Marquee
        this.selectionBoxEl = document.createElement('div');
        this.selectionBoxEl.className = 'selection-box';
        document.body.appendChild(this.selectionBoxEl);

        this.initSortable();

        // Marquee selection events on container
        this.container.addEventListener('mousedown', this.handleMarqueeStart.bind(this));
        window.addEventListener('mousemove', this.handleMarqueeMove.bind(this));
        window.addEventListener('mouseup', this.handleMarqueeEnd.bind(this));

        // 按下 Ctrl / Shift 时将容器标记为多选模式，通过 CSS 隐藏工具栏，避免多选时的干扰
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control' || e.key === 'Shift') {
                this.container.classList.add('is-key-selecting');
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control' || e.key === 'Shift') {
                this.container.classList.remove('is-key-selecting');
            }
        });

    }

    initSortable() {
        this.sortable = new Sortable(this.listElement, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.tag-item:not(.editing)', // Prevent dragging while editing
            filter: 'input, button, .tag-controls, .tag-newline-separator', // Filter out specific elements
            preventOnFilter: false, // Allow default behavior (selection) for filtered elements
            // **REMOVED:** multiDrag: true, // We are doing data-driven multi-drag now
            selectedClass: 'selected',
            avoidImplicitDeselect: true, // Let our own logic handle deselection
            onStart: (evt) => {
                this.container.classList.add('is-dragging');
                
                // A legitimate drag started, cancel any pending single-click selection
                this._pendingClickReset = null; 

                // Data-Driven MultiDrag logic
                // If dragging an unselected item, it drags alone.
                // If dragging a selected item, it drags the whole selection.
                const draggedIdx = parseInt(evt.item.dataset.index, 10);
                this._dragGroup = []; // Indices of items being dragged

                if (this.selectedIndices.has(draggedIdx)) {
                    // Dragging a selection block
                    this._dragGroup = Array.from(this.selectedIndices).sort((a, b) => a - b);
                } else {
                    // Single item drag (not part of selection)
                    // Optionally clear selection, or just drag it alone
                    this._dragGroup = [draggedIdx];
                }

                // If multiple items, calculate UI badge and hide companions
                if (this._dragGroup.length > 1) {
                    const dragCountBadge = document.createElement('div');
                    dragCountBadge.className = 'custom-multidrag-badge';
                    dragCountBadge.textContent = this._dragGroup.length;
                    evt.item.appendChild(dragCountBadge);

                    // Add a class so CSS can hide exactly the companions in the original list 
                // and handle the Sortable Ghost/Clone rendering correctly.
                // MUST use data-index attribute to locate companion elements,
                // because newline-separator elements shift DOM positions.
                this._dragGroup.forEach(i => {
                    if (i !== draggedIdx) {
                        const el = this.listElement.querySelector(`.tag-item[data-index="${i}"]`);
                        if (el) el.classList.add('hide-companion-drag');
                    }
                });
                }
            },
            onMove: (evt) => {
                const draggedEl = evt.dragged;
                const relatedEl = evt.related;

                // Safely get index 
                let idxStr = draggedEl.dataset.index;
                // If it's a ghost or clone, fall back to the main item
                if (!idxStr && evt.item && evt.item.dataset) {
                     idxStr = evt.item.dataset.index;
                }
                const baseIdx = parseInt(idxStr, 10);
                if (isNaN(baseIdx)) return true; // Safety

                // Check all tags currently being dragged
                const indicesToCheck = this._dragGroup && this._dragGroup.length > 0 ? this._dragGroup : [baseIdx];

                // If any dragged tag violates the rule, block the whole move
                for (let idx of indicesToCheck) {
                    const tag = this.tags[idx];
                    if (!tag) continue;

                    // Check if it's a Header or a "Block" (Single Pill with :: inside)
                    const val = tag.value;
                    const isBlock = !!val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
                    const isHeader = !!val.match(/^([-?\d\.]+)::$/);

                    // If it's just a normal tag, let it go anywhere
                    if (!isBlock && !isHeader) continue;

                    // 2. If it IS a weighted tag/header, forbid dropping "inside" another NAI group
                    // But ALLOW dropping inside Dynamic Groups

                    // Case A: Dropping on a member
                    if (relatedEl.classList.contains('tag-group-member') || relatedEl.classList.contains('tag-comp-member')) {
                        // Only forbid if it's an NAI member (not dynamic)
                        if (!relatedEl.classList.contains('tag-dynamic')) {
                            return false;
                        }
                    }

                    // Case B: Header/Footer boundaries
                    const isRelHeader = relatedEl.classList.contains('tag-group-header') || relatedEl.classList.contains('tag-comp-header');
                    const isRelFooter = relatedEl.classList.contains('tag-group-footer') || relatedEl.classList.contains('tag-comp-footer');
                    const isRelDynamic = relatedEl.classList.contains('tag-dynamic');

                    // If target is Header, inserting AFTER it puts us inside the group
                    if (isRelHeader && evt.willInsertAfter) {
                        if (!isRelDynamic) return false;
                    }

                    // If target is Footer, inserting BEFORE it puts us inside the group
                    if (isRelFooter && !evt.willInsertAfter) {
                        if (!isRelDynamic) return false;
                    }
                }

                return true;
            },
            onEnd: (evt) => {
                this.container.classList.remove('is-dragging');
                
                const evtItem = evt.item;
                const draggedIdx = parseInt(evtItem.dataset.index, 10);
                
                // Cleanup companion hiding classes and badge
                const allElements = this.listElement.querySelectorAll('.tag-item');
                allElements.forEach(el => el.classList.remove('hide-companion-drag'));
                const badge = evtItem.querySelector('.custom-multidrag-badge');
                if (badge) badge.remove();

                // Calculate where it actually dropped
                const oldIndexSortable = evt.oldIndex;
                const newIndexSortable = evt.newIndex;
                
                if (newIndexSortable === undefined || oldIndexSortable === undefined) {
                    this.render();
                    return;
                }

                if (this._dragGroup && this._dragGroup.length > 0) {
                    // Extract all dragged tags from the data array
                    const tagsToMove = this._dragGroup.map(i => this.tags[i]);
                    
                    // Filter out the dragged tags from the original array
                    let remainingTags = this.tags.filter((_, i) => !this._dragGroup.includes(i));
                    
                    // The 'newIndexSortable' provided by Sortable is based on the visible DOM.
                    // Because we visually hid the companion tags (using CSS display: none), 
                    // Sortable's DOM indices are technically correct relative to the visible elements.
                    // But we are operating on the RAW array, so we need to map the DOM insertion point 
                    // back to our remainingTags array index.
                    
                    // Sortable tells us it dropped at `newIndexSortable`. This means it dropped BEFORE 
                    // the element currently sitting at that index in the DOM (ignoring ghosts/clones and hidden companions).
                    // We need to carefully identify the real target element it dropped in front of (or after).
                    
                    // Let's find the logical index in remainingTags to insert at.
                    // A simple and robust way: 
                    // The element at newIndexSortable in the current DOM (excluding the dragged item itself)
                    // is our anchor.
                    let targetDOMIndex = newIndexSortable;
                    if (newIndexSortable > oldIndexSortable) {
                        // It moved down. In the DOM, it was inserted AFTER the element that originally
                        // was at newIndexSortable.
                        targetDOMIndex = newIndexSortable; 
                    }
                    
                    // Wait, a much safer purely data-driven way when drag group exists:
                    // 1. We know which elements stayed (remainingTags).
                    // 2. We can build a list of DOM elements that are currently visible (not hidden companions).
                    // 3. We find the element immediately following our inserted item in the DOM.
                    let nextElementInDOM = evtItem.nextElementSibling;
                    // Skip ghosts, clones, and hidden companions
                    while (nextElementInDOM && (nextElementInDOM.classList.contains('sortable-ghost') || 
                                                nextElementInDOM.classList.contains('sortable-clone') || 
                                                nextElementInDOM.classList.contains('hide-companion-drag') ||
                                                !nextElementInDOM.classList.contains('tag-item'))) {
                         nextElementInDOM = nextElementInDOM.nextElementSibling;
                    }
                    
                    let insertIndexInRemaining = remainingTags.length; // Default to end
                    if (nextElementInDOM) {
                        const nextOriginalIndex = parseInt(nextElementInDOM.dataset.index, 10);
                        // Find this original tag in our remainingTags array
                        const targetTag = this.tags[nextOriginalIndex];
                        const tempIndex = remainingTags.indexOf(targetTag);
                        if (tempIndex !== -1) {
                            insertIndexInRemaining = tempIndex;
                        }
                    }
                    
                    // Insert all dragged tags at the computed position
                    remainingTags.splice(insertIndexInRemaining, 0, ...tagsToMove);
                    this.tags = remainingTags;

                    // Rebuild selected indices mapping so they stay visually selected
                    this.selectedIndices.clear();
                    for (let n = 0; n < tagsToMove.length; n++) {
                        this.selectedIndices.add(insertIndexInRemaining + n);
                    }
                }

                this._dragGroup = null;

                // Fine-grained cleanup: skip tags followed by a newline
                this.cleanupExternalCommas();

                // Re-render to ensure indices in DOM are refreshed
                this.render();
                
                // Ensure Sortable is completely wiped clean of its selection memory 
                // AFTER the render has rebuilt the DOM.
                const allItems = this.listElement.querySelectorAll('.tag-item');
                allItems.forEach(el => Sortable.utils.deselect(el));

                this.onChange(this.tags);
            }
        });
    }


    cleanupExternalCommas() {
        let inDynamic = false;
        this.tags.forEach((tag, i) => {
            const val = tag.value;
            const isDynHeader = val.startsWith('||') && (val !== '||' || tag.isStart);
            const isDynFooter = val === '||' && !tag.isStart;

            if (isDynHeader) {
                inDynamic = true;
            } else if (isDynFooter) {
                inDynamic = false;
            } else if (!inDynamic) {
                // If tag is outside dynamic blocks and ends with a comma
                const trimmed = val.trim();
                if (trimmed.endsWith(',') && !val.startsWith('||')) {
                    // EXCEPTION: If the next tag is a newline, DO NOT strip the comma
                    const nextTag = this.tags[i + 1];
                    const nextIsNL = nextTag && nextTag.value === '\n';
                    
                    if (!nextIsNL) {
                        tag.value = trimmed.slice(0, -1).trim();
                    }
                }
            }
        });
    }

    setTags(tags) {
        this.tags = tags || [];
        this.clearSelection();
        this.render();
    }

    getTags() {
        return this.tags;
    }

    refreshPendingAiVisuals() {
        this.tags.forEach((tag, index) => {
            if (!this.isPendingAiTag(tag)) return;
            const li = this.listElement.querySelector(`.tag-item[data-index="${index}"]`);
            if (!li) return;
            this.syncPendingAiState(li, tag);
        });
    }

    renderCounterBadge(value) {
        const match = value.match(/^(([sS])?(\d+)?__([A-Z-a-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__)$/);
        if (!match) return '';

        const isSequential = !!match[2];
        if (!isSequential) return '';

        const name = match[4];
        const slot = this.currentSlotCounts[name] || 0;
        this.currentSlotCounts[name] = slot + 1;

        const key = slot === 0 ? name : `${name}:${slot}`;
        const count = this.sequentialCounters[key] !== undefined ? this.sequentialCounters[key] : 0;

        return `<span class="tag-counter-badge" title="Current slot: ${slot}">[${count + 1}]</span>`;
    }

    bindAutocomplete(autocomplete) {
        this.autocomplete = autocomplete;
    }

    clearSelection() {
        this.selectedIndices.clear();
        this.updateSelectionVisuals();
    }

    toggleSelection(index, multi = false, range = false) {
        if (range && this.lastSelectedIndex !== null) {
            // Shift click
            const start = Math.min(this.lastSelectedIndex, index);
            const end = Math.max(this.lastSelectedIndex, index);
            this.selectedIndices.clear();
            for (let i = start; i <= end; i++) {
                this.selectedIndices.add(i);
            }
        } else if (multi) {
            // Ctrl click
            if (this.selectedIndices.has(index)) {
                this.selectedIndices.delete(index);
            } else {
                this.selectedIndices.add(index);
            }
            this.lastSelectedIndex = index;
        } else {
            // Single click
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
            this.lastSelectedIndex = index;
        }
        this.updateSelectionVisuals();
    }

    updateSelectionVisuals() {
        const items = Array.from(this.listElement.querySelectorAll('.tag-item'));
        
        items.forEach((el) => {
            // Use data-index (tag array index), NOT DOM position for consistency
            const tagIndex = parseInt(el.dataset.index, 10);
            if (this.selectedIndices.has(tagIndex)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });

        // Toggle multi-selection state class
        if (this.selectedIndices.size > 1) {
            this.container.classList.add('has-multi-selection');
        } else {
            this.container.classList.remove('has-multi-selection');
        }
    }

    render() {
        this.listElement.innerHTML = '';
        this.currentSlotCounts = {}; // Track slots per render for sequential wildcards
        let inGroup = false;
        let inDynamic = false;

        const fragment = document.createDocumentFragment();

        this.tags.forEach((tag, index) => {
            const val = tag.value;
            const isCompHeader = !!val.match(/^([-?\d\.]+)::$/);
            const isCompFooter = val === ' ::';
            const isDynHeader = val.startsWith('||') && (val !== '||' || tag.isStart);
            const isDynFooter = val === '||' && !tag.isStart;

            let isCompMember = false;
            let isDynMember = false;

            if (isCompHeader) inGroup = true;
            else if (isCompFooter) inGroup = false;
            else if (inGroup) isCompMember = true;

            if (isDynHeader) inDynamic = true;
            else if (isDynFooter) inDynamic = false;
            else if (inDynamic) isDynMember = true;

            const li = this.createTagElement(tag, index, { isCompMember, isDynMember });
            fragment.appendChild(li);

            // 如果当前渲染的是换行符标签，向其后追加一个不可见的换行分隔元素。
            // 这样可以在不勾选分割线选项时，也能让后续标签另起一行。
            if (val === '\n') {
                const separatorDiv = document.createElement('div');
                separatorDiv.className = 'tag-newline-separator';
                fragment.appendChild(separatorDiv);
            }
        });
        
        this.listElement.appendChild(fragment);
        
        // Toggle CSS class for newline rendering - no extra DOM nodes needed
        // CSS handles visual line break via flex-basis on .render-newlines .tag-item.tag-newline
        this.listElement.classList.toggle('render-newlines', !!this.options.renderNewlines);
        
        this.updateSelectionVisuals();
        requestAnimationFrame(() => this.adjustTranslationLayout());
    }

    createTagElement(tag, index, { isCompMember = false, isDynMember = false } = {}) {
        const li = document.createElement('li');
        li.className = 'tag-item';
        if (tag.disabled) li.classList.add('disabled');
        if (this.isPendingAiTag(tag)) li.classList.add('tag-ai-pending');
        if (isCompMember) li.classList.add('tag-comp-member');
        if (isDynMember) li.classList.add('tag-dyn-member');
        li.dataset.index = index;

        // Visual breakdown
        let text = tag.value;
        let weightVal = 1.0;
        let cleanText = text;
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        let isCompHeader = false;
        let isCompFooter = text === ' ::';

        // Try to match "weight::tag ::" (Single Pill)
        let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        // Try to match "weight::" (Group Header)
        let headerMatch = text.match(/^([-?\d\.]+)::$/);

        if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            cleanText = blockMatch[2];
        } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            cleanText = headerMatch[1] + '::';
            isCompHeader = true;
        } else if (isCompFooter) {
            cleanText = ')';
            // Backtrack to find weight from closest header
            for (let j = index - 1; j >= 0; j--) {
                let m = this.tags[j].value.match(/^([-?\d\.]+)::$/);
                if (m) {
                    weightVal = parseFloat(m[1]);
                    break;
                }
            }
        } else {
            // Fallback for old bracket styles
            let inc = 0, dec = 0, str = text;
            if (text.startsWith('{') || text.startsWith('[')) {
                while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
                if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
                if (inc > 0) weightVal = 1 + (inc * 0.1);
                else if (dec > 0) weightVal = 1 - (dec * 0.1);
                cleanText = str;
            }
        }

        const isNewline = cleanText === '\n';
        const isAiPending = this.isPendingAiTag(tag);
        let displayTagName = isNewline ? '↵' : cleanText;
        if (isCompHeader || isCompFooter || isDynHeader || isDynFooter) displayTagName = '';

        // Calculate offset from raw value to display text
        let displayOffset = 0;
        if (!isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            if (blockMatch) {
                displayOffset = blockMatch[1].length + 2; // weight + "::"
            } else if (text.startsWith('{') || text.startsWith('[')) {
                let str = text;
                while (str.startsWith('{') && str.endsWith('}')) { displayOffset++; str = str.slice(1, -1); }
                if (displayOffset === 0) {
                    while (str.startsWith('[') && str.endsWith(']')) { displayOffset++; str = str.slice(1, -1); }
                }
            }
        }

        // Dynamic Weight Badge
        let dynWeightBadge = '';
        if (!isAiPending && isDynMember && tag.dynWeight && tag.dynWeight !== 1) {
            const formattedDyn = (tag.dynWeight % 1 === 0) ? tag.dynWeight : tag.dynWeight.toFixed(1);
            dynWeightBadge = `<span class="tag-dyn-weight-mini-badge" title="Selection Weight">${formattedDyn}</span>`;
        }

        if (isNewline) li.classList.add('tag-newline');
        if (isCompHeader) li.classList.add('tag-comp-header');
        if (isCompFooter) li.classList.add('tag-comp-footer');
        if (isDynHeader) li.classList.add('tag-dyn-header');
        if (isDynFooter) li.classList.add('tag-dyn-footer');
        if (isDynHeader || isDynFooter || isDynMember) li.classList.add('tag-dynamic');
        if (isDynHeader) li.setAttribute('data-dyn-config', text.slice(2));

        const lookupTagKey = this.toCanonicalTagKey(cleanText);
        let info = null;
        if (this.autocomplete && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            if (blockMatch) {
                // Composite tag logic: split and aggregate translations
                const parts = cleanText.split(',').map(s => s.trim()).filter(Boolean);
                const translationParts = [];
                let firstColor = null;

                parts.forEach(part => {
                    const partInfo = this.autocomplete.getTagInfo(part);
                    if (partInfo) {
                        if (partInfo.zh) translationParts.push(partInfo.zh);
                        if (!firstColor && partInfo.color) firstColor = partInfo.color;
                    }
                });

                if (translationParts.length > 0 || firstColor) {
                    info = {
                        zh: translationParts.join(', '),
                        color: firstColor
                    };
                }
            } else {
                // Standard single tag logic
                info = this.autocomplete.getTagInfo(cleanText);
            }
        }

        // GroupTags 翻译优先：如果 groupTranslationMap 中有该标签的翻译，覆盖字典翻译
        if (this.groupTranslationMap && this.groupTranslationMap[lookupTagKey]) {
            if (!info) info = {};
            info.zh = this.groupTranslationMap[lookupTagKey];
        }

        if (info && info.color) {
            li.style.borderColor = info.color;
            li.style.borderWidth = '1.5px';
            li.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }

        // 分组颜色映射 - 在 capsule 创建后应用（见下方行 648 后）
        // groupColorMap 的颜色将覆盖 autocomplete 字典颜色

        let pickBadge = '';
        if (isDynHeader) {
            let config = text.slice(2);
            if (config.endsWith('$$')) config = config.slice(0, -2);
            if (config) {
                let displayCount = config.replace('-', '~');
                pickBadge = `<span class="tag-dyn-pick-badge">x${displayCount}</span>`;
            }
        }

        // Enable weight controls for all tags except newlines, footers, group members, and dynamic markers
        const hasWeight = !isAiPending && (blockMatch || headerMatch || (!isNewline && !isCompFooter && !isCompMember)) && !isDynHeader && !isDynFooter;
        // 统一复用同一份拆分按钮判断，避免模板渲染和事件绑定规则漂移。
        const canSplit = !isAiPending && (blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter));

        const dict = this.options.dict || {};
        
        // Toolbar Events
        const minConfigTitle = dict.dyn_min || "Min";
        const maxConfigTitle = dict.dyn_max || "Max";
        const sepConfigTitle = dict.dyn_sep || "Separator";
        // 原收藏按钮改为“加入 Group Tags”，文案优先复用 popup 当前语言包
        const favTitle = dict.btn_add_to_group_tags || `${dict.btn_add || 'Add'} ${dict.btn_group_tags || 'Group Tags'}`.trim();
        const copyTitle = dict.btn_copy || "Copy Tag";
        const decWeightTitle = dict.btn_dec_weight || "Decrease Weight";
        const editWeightTitle = dict.btn_edit_weight || "Edit Weight";
        const incWeightTitle = dict.btn_inc_weight || "Increase Weight";
        const decDynWeightTitle = dict.btn_dec_dyn_weight || "Decrease Selection Weight";
        const editDynWeightTitle = dict.btn_edit_dyn_weight || "Edit Selection Weight";
        const incDynWeightTitle = dict.btn_inc_dyn_weight || "Increase Selection Weight";
        const splitTitle = dict.btn_split || "Split to markers";
        const mergeTitle = dict.btn_merge || "Merge group";
        const toggleTitle = dict.btn_toggle || "Enable/Disable";
        const delTitle = dict.btn_del || "Delete";

        const secondaryText = (tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter)
            ? common.escapeHtml(tag.aiOriginal)
            : ((info && info.zh && !isNewline) ? info.zh : (isNewline || isCompHeader || isCompFooter || isDynHeader || isDynFooter ? '' : '&nbsp;'));
        const secondaryClass = tag.aiOriginal ? 'tag-zh-row tag-ai-original' : 'tag-zh-row';

        li.innerHTML = `
            <div class="tag-capsule ${isCompHeader ? 'gh' : (isCompFooter ? 'gf' : (isDynHeader ? 'dh' : (isDynFooter ? 'df' : '')))}" style="border-color: ${info && info.color ? info.color : ''}; border-width: ${info && info.color ? '1.5px' : ''}; background: ${info && info.color ? `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)` : ''}">
                <div class="tag-primary">
                    ${isDynHeader ? pickBadge : (((!isAiPending && (Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter))) && !isNewline) ? `<span class="tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}">${weightVal.toFixed(1)}</span>` : '')}
                    <span class="tag-text">${displayTagName}</span>
                    ${dynWeightBadge}
                    ${this.renderCounterBadge(tag.value)}
                </div>
                <div class="tag-controls">
                    ${isDynHeader ? `
                    <div class="dyn-config-control">
                        <input type="text" class="dyn-config-input dyn-min" title="${minConfigTitle}" placeholder="min">
                        <span>-</span>
                        <input type="text" class="dyn-config-input dyn-max" title="${maxConfigTitle}" placeholder="max">
                        <input type="text" class="dyn-config-input dyn-sep sep" title="${sepConfigTitle}" placeholder="">
                    </div>
                    ` : ''}
                    ${!isAiPending && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-fav" title="${favTitle}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;margin-top:-1px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg></button>` : ''}
                    ${!isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-copy" title="${copyTitle}">📋</button>` : ''}
                    ${hasWeight ? `
                    <div class="weight-control">
                        <button type="button" class="tbtn tbtn-sub" title="${decWeightTitle}">-</button>
                        <input type="text" class="weight-input" value="${weightVal.toFixed(1)}" title="${editWeightTitle}">
                        <button type="button" class="tbtn tbtn-add" title="${incWeightTitle}">+</button>
                    </div>
                    ` : ''}
                    ${!isAiPending && isDynMember ? `
                    <div class="weight-control dyn-weight-control" title="...">
                        <button type="button" class="tbtn tbtn-dyn-sub" title="${decDynWeightTitle}">-</button>
                        <input type="text" class="dyn-weight-input" value="${tag.dynWeight || 1}" title="${editDynWeightTitle}">
                        <button type="button" class="tbtn tbtn-dyn-add" title="${incDynWeightTitle}">+</button>
                    </div>
                    ` : ''}
                    ${canSplit ? `<button type="button" class="tbtn tbtn-split" title="${splitTitle}">✂️</button>` : ''}
                    ${isCompFooter ? `<button type="button" class="tbtn tbtn-merge" title="${mergeTitle}">🔗</button>` : ''}
                    ${!isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-toggle" title="${toggleTitle}">${tag.disabled ? '👁️' : '🚫'}</button>` : ''}
                    <button type="button" class="tbtn tbtn-del" title="${delTitle}">×</button>
                </div>
            </div>
            <div class="${secondaryClass}">${secondaryText}</div>
        `;

        const capsule = li.querySelector('.tag-capsule');
        if (tag.disabled) capsule.classList.add('disabled');

        // 分组颜色映射：只修改胶囊背景色，保留 Danbooru 字典的边框色（如 artist 红色边框）
        if (this.groupColorMap && this.groupColorMap[lookupTagKey]) {
            const gc = this.groupColorMap[lookupTagKey];
            capsule.style.background = gc;
        }
        this.syncPendingAiState(li, tag);

        const textSpan = li.querySelector('.tag-text');
        if (textSpan) {
            textSpan.dataset.offset = displayOffset;
        }

        // toolbar events
        if (isDynHeader) {
            const minInput = li.querySelector('.dyn-min');
            const maxInput = li.querySelector('.dyn-max');
            const sepInput = li.querySelector('.dyn-sep');

            // Initial Parse from tag.value (e.g., ||2$$ or ||1-3$$and$$)
            let fullConfig = text.slice(2);
            let rangeStr = '';
            let joinerStr = '';

            if (fullConfig.includes('$$')) {
                const parts = fullConfig.split('$$').filter(p => p !== '');
                rangeStr = parts[0] || '';
                joinerStr = parts[1] || '';
            } else {
                rangeStr = fullConfig;
            }

            let minValue = rangeStr, maxValue = '';
            if (rangeStr.includes('-')) {
                const parts = rangeStr.split('-');
                minValue = parts[0];
                maxValue = parts[1];
            } else if (rangeStr) {
                // If it's a single value, we treat it as Min if Max is empty, 
                // but user wants: if Min is empty, use Max for single value. 
                // For restoration, let's put single values in Max if Min is empty? 
                // Or just keep it simple: if no '-', and it's there, put it in Min or Max?
                // Actually, let's follow user's "single value = Max if Min empty" logic for display,
                // but for parsing, a single '2' could be either. Let's put it in Min by default or Max?
                // User said: "如果第一个框为空就显示最大选取数" -> suggests 2 belongs in second box if single.
                minValue = '';
                maxValue = rangeStr;
            }

            minInput.value = minValue;
            maxInput.value = maxValue;
            sepInput.value = joinerStr;

            const updateConfig = () => {
                const mi = minInput.value.trim();
                const ma = maxInput.value.trim();
                const joiner = sepInput.value; // Allow whitespace

                let range = '';
                if (!mi && ma) range = ma;
                else if (mi && !ma) range = mi;
                else if (mi && ma) range = `${mi}-${ma}`;

                let newValue = `||${range}`;
                if (range || joiner) {
                    newValue += '$$';
                    if (joiner) newValue += joiner + '$$';
                }

                tag.value = newValue;
                this.onChange(this.tags);
                this.updateTagVisuals(li, tag, index);
            };

            minInput.oninput = updateConfig;
            maxInput.oninput = updateConfig;
            sepInput.oninput = updateConfig;
            minInput.onmousedown = (e) => e.stopPropagation();
            maxInput.onmousedown = (e) => e.stopPropagation();
            sepInput.onmousedown = (e) => e.stopPropagation();
        }

        // Interaction refinements
        capsule.addEventListener('mousedown', (e) => {
            if (e.target.closest('.tag-controls')) return;
            if (e.target.tagName === 'INPUT') return;
            
            // If already selecting without modifiers, wait for mouseup to single select
            // This allows Sortable to start dragging the entire multi-selection block
            if (!e.ctrlKey && !e.shiftKey && this.selectedIndices.has(index)) {
                this._pendingClickReset = index;
                
                // Listen globally for mouseup to ensure we don't trap the state
                // if the user drags out of the capsule and releases
                const handleGlobalMouseUp = (mouseUpEvent) => {
                    window.removeEventListener('mouseup', handleGlobalMouseUp);
                    if (this._pendingClickReset === index) {
                        this._pendingClickReset = null;
                        // If a drag operation didn't start, perform the single selection now
                        if (!this.container.classList.contains('is-dragging')) {
                            // Only trigger if they actually clicked (released near where they pressed)
                            // or released without dragging
                            this.toggleSelection(index, false, false);
                        }
                    }
                };
                window.addEventListener('mouseup', handleGlobalMouseUp);
                return;
            }
            this._pendingClickReset = null;
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        const tagPrimary = li.querySelector('.tag-primary');
        if (!isAiPending && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            tagPrimary.addEventListener('click', (e) => {
            // Prevent entering edit mode if we are trying to multi-select with modifiers
            if (e.ctrlKey || e.shiftKey || e.metaKey) return;
            
            e.stopPropagation();
                if (li.classList.contains('editing') || this.container.classList.contains('is-dragging')) return;
                if (this.clickTimer) clearTimeout(this.clickTimer);
                this.clickTimer = setTimeout(() => {
                    this.clickTimer = null;
                    this.enterEditMode(li, index, e);
                }, 300);
            });
        }

        // Toolbar Events
        const btnFav = li.querySelector('.tbtn-fav');
        if (btnFav) {
            btnFav.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // TagEditor 只负责把标准化后的 tag 数据抛给外层，不直接理解 Group Tags 结构
                const bestZh = (info && info.zh) ? info.zh : '';
                try {
                    await this.onAddToGroupTags({ en: cleanText, zh: bestZh });
                } catch (err) {
                    console.error('[TagEditor] Failed to add tag into Group Tags:', err);
                }
            };
        }

        const btnCopy = li.querySelector('.tbtn-copy');
        if (btnCopy) {
            btnCopy.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.copyTag(index); };
        }

        if (hasWeight) {
            const btnSub = li.querySelector('.tbtn-sub');
            if (btnSub) btnSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, -0.1, li); };

            const btnAdd = li.querySelector('.tbtn-add');
            if (btnAdd) btnAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, 0.1, li); };

            const weightInput = li.querySelector('.weight-input');
            if (weightInput) {
                weightInput.onmousedown = (e) => e.stopPropagation();
                weightInput.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) this.updateWeightManual(index, val, li);
                };
            }
        }

        if (isDynMember) {
            const btnDynSub = li.querySelector('.tbtn-dyn-sub');
            btnDynSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateDynWeight(index, -1, li); };

            const btnDynAdd = li.querySelector('.tbtn-dyn-add');
            btnDynAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateDynWeight(index, 1, li); };

            const dynWeightInput = li.querySelector('.dyn-weight-input');
            if (dynWeightInput) {
                dynWeightInput.onmousedown = (e) => e.stopPropagation();
                dynWeightInput.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) this.updateDynWeightManual(index, val, li);
                };
            }
        }

        if (canSplit) {
            const btnSplit = li.querySelector('.tbtn-split');
            if (btnSplit) {
                btnSplit.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.splitGroupTag(index); };
            }
        }

        if (isCompFooter) {
            const btnMerge = li.querySelector('.tbtn-merge');
            if (btnMerge) btnMerge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.mergeGroupTag(index); };
        }

        const btnToggle = li.querySelector('.tbtn-toggle');
        if (btnToggle) btnToggle.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleDisable(index, li); };

        const btnDel = li.querySelector('.tbtn-del');
        if (btnDel) btnDel.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.removeTags([index]); };

        // Double click to toggle disabled (All-in-One style)
        capsule.addEventListener('dblclick', (e) => {
            if (e.target.closest('.tag-controls')) return;
            if (e.ctrlKey || e.shiftKey || e.metaKey) return;
            if (this.isPendingAiTag(tag)) return;
            e.stopPropagation();
            e.preventDefault(); // Prevent text selection
            // Cancel single click edit
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }
            this.toggleDisable(index, li);
        });

        // Boundary detection for side-floating toolbar
        li.addEventListener('mouseenter', () => {
            this.repositionToolbar(li);
        });

        return li;
    }

    repositionToolbar(li) {
        const controls = li.querySelector('.tag-controls');
        if (!controls) return;

        // Disable transition during measurement to get accurate positions
        controls.style.transition = 'none';

        // Reset all overrides
        controls.classList.remove('pos-left', 'pos-top', 'pos-bottom');
        controls.style.left = '';
        controls.style.right = '';
        controls.style.maxWidth = '';
        controls.style.whiteSpace = '';

        // Force reflow so the browser calculates the true final position
        controls.offsetWidth;

        // Measure default (right side)
        const rect = controls.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const rightEdge = Math.min(viewportWidth, containerRect.right);

        let posClass = ''; // default: right side

        if (rect.right > rightEdge - 5) {
            // Try Left
            controls.classList.add('pos-left');
            controls.offsetWidth; // Force reflow
            const newRect = controls.getBoundingClientRect();
            const leftEdge = Math.max(0, containerRect.left);

            if (newRect.left < leftEdge + 5) {
                // Both sides overflow → switch to top/bottom
                controls.classList.remove('pos-left');

                const capsule = li.querySelector('.tag-capsule');
                const capsuleRect = capsule ? capsule.getBoundingClientRect() : li.getBoundingClientRect();
                const spaceAbove = capsuleRect.top;
                const spaceBelow = window.innerHeight - capsuleRect.bottom;

                if (spaceAbove >= spaceBelow) {
                    posClass = 'pos-top';
                    controls.classList.add('pos-top');
                } else {
                    posClass = 'pos-bottom';
                    controls.classList.add('pos-bottom');
                }

                const maxW = Math.min(containerRect.width, viewportWidth) - 20;
                controls.style.maxWidth = `${Math.max(maxW, 100)}px`;
            } else {
                posClass = 'pos-left';
            }
        }

        // Hidden-state transforms for each position (must match CSS)
        const hiddenTransforms = {
            '': 'translateY(-50%) translateX(5px) scale(0.95)',
            'pos-left': 'translateY(-50%) translateX(-5px) scale(0.95)',
            'pos-top': 'translateX(-50%) translateY(8px) scale(0.9)',
            'pos-bottom': 'translateX(-50%) translateY(-8px) scale(0.9)',
        };

        // Force element into hidden state (overrides CSS :hover if already active)
        controls.style.opacity = '0';
        controls.style.transform = hiddenTransforms[posClass];
        controls.offsetWidth; // Commit

        // Double-rAF: Frame 1 restores transition, Frame 2 releases overrides
        // This ensures the browser commits the hidden state before animating
        requestAnimationFrame(() => {
            controls.style.transition = '';
            requestAnimationFrame(() => {
                // Remove inline overrides → CSS :hover takes over → smooth animation
                controls.style.opacity = '';
                controls.style.transform = '';
            });
        });
    }

    enterEditMode(li, index, clickEvent = null) {
        const tag = this.tags[index];
        const capsule = li.querySelector('.tag-capsule');
        const textSpan = li.querySelector('.tag-text');

        // Measure current width before clearing
        const rect = capsule.getBoundingClientRect();
        const currentWidth = rect.width;

        let cursorPosition = tag.value.length;
        if (clickEvent && textSpan) {
            const offset = parseInt(textSpan.dataset.offset || '0', 10);
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
                if (range && range.startContainer === textSpan.firstChild) {
                    cursorPosition = offset + range.startOffset;
                }
            }
        }

        li.classList.add('editing');
        capsule.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = tag.value;
        input.className = 'tag-inline-input';

        // Set width to match the tag's original width
        // Subtract a bit for padding/border if necessary, or just use content-box
        input.style.width = (currentWidth - 10) + 'px'; // approx padding adjustment

        capsule.appendChild(input);
        input.focus();
        
        // Set cursor position
        input.setSelectionRange(cursorPosition, cursorPosition);

        // Explicitly sync visual selection state
        li.classList.add('selected');
        this.selectedIndices.add(index);

        const save = () => {
            if (input.dataset.saved) return;
            input.dataset.saved = 'true';

            const val = input.value.trim();
            if (val && val !== tag.value) {
                this.tags[index].value = val;
                this.onChange(this.tags);
            } else if (!val) {
                this.removeTags([index]);
                return;
            }
            this.render();
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    }

    updateWeight(index, delta, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        let isAnyHeaderUpdated = false;

        indices.forEach(i => {
            let text = this.tags[i].value;
            let weight = 1.0;
            let tagText = text;

            let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            let headerMatch = text.match(/^([-?\d\.]+)::$/);

            if (blockMatch) {
                weight = parseFloat(blockMatch[1]);
                tagText = blockMatch[2];
            } else if (headerMatch) {
                weight = parseFloat(headerMatch[1]);
                tagText = ''; // Marker
            } else {
                // ... fallback ...
            }

            weight = Math.max(-99, Math.min(99, weight + delta));
            const formatted = (weight % 1 === 0) ? weight.toString() : weight.toFixed(1);

            if (headerMatch) {
                this.tags[i].value = `${formatted}::`;
                isAnyHeaderUpdated = true;
            } else if (Math.abs(weight - 1.0) < 0.001) {
                this.tags[i].value = tagText;
            } else {
                this.tags[i].value = `${formatted}::${tagText} ::`;
            }
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);

            if (isAnyHeaderUpdated) {
                // Find and update the corresponding footer
                // Simple heuristic: Next ' ::' tag.
                // Nesting is not supported by this regex logic effectively anyway.
                for (let j = index + 1; j < this.tags.length; j++) {
                    // If we hit another header before a footer, something is weird or nested
                    // But let's just look for the first footer.
                    if (this.tags[j].value === ' ::') {
                        const footerEl = this.listElement.querySelectorAll('.tag-item')[j];
                        if (footerEl) {
                            this.updateTagVisuals(footerEl, this.tags[j], j);
                        }
                        break;
                    }
                }
            }
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    updateWeightManual(index, val, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        let isAnyHeaderUpdated = false;

        indices.forEach(i => {
            let text = this.tags[i].value;
            let tagText = text;

            let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            let headerMatch = text.match(/^([-?\d\.]+)::$/);

            if (blockMatch) {
                tagText = blockMatch[2];
            } else if (headerMatch) {
                tagText = '';
            }

            const formatted = (val % 1 === 0) ? val.toString() : val.toFixed(1);

            if (headerMatch) {
                this.tags[i].value = `${formatted}::`;
                isAnyHeaderUpdated = true;
            } else if (Math.abs(val - 1.0) < 0.001) {
                this.tags[i].value = tagText;
            } else {
                this.tags[i].value = `${formatted}::${tagText} ::`;
            }
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);

            if (isAnyHeaderUpdated) {
                for (let j = index + 1; j < this.tags.length; j++) {
                    if (this.tags[j].value === ' ::') {
                        const footerEl = this.listElement.querySelectorAll('.tag-item')[j];
                        if (footerEl) {
                            this.updateTagVisuals(footerEl, this.tags[j], j);
                        }
                        break;
                    }
                }
            }
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    updateDynWeight(index, delta, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        indices.forEach(i => {
            const tag = this.tags[i];
            if (!tag.dynWeight) tag.dynWeight = 1;
            tag.dynWeight = Math.max(1, tag.dynWeight + delta);
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    updateDynWeightManual(index, val, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        indices.forEach(i => {
            const tag = this.tags[i];
            tag.dynWeight = Math.max(0, val);
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    // Adjust translation layout to match capsule width and scale font
    adjustTranslationLayout() {
        // Fix Layout Thrashing: Separate DOM Reads and Writes
        const items = this.listElement.querySelectorAll('.tag-item');
        const updates = [];

        // Phase 1: Reads (Measure all widths without triggering reflows)
        items.forEach(li => {
            const capsule = li.querySelector('.tag-capsule');
            const zhRow = li.querySelector('.tag-zh-row');

            if (capsule && zhRow && zhRow.textContent.trim()) {
                updates.push({
                    zhRow: zhRow,
                    width: capsule.offsetWidth
                });
            }
        });

        // Phase 2: Writes (Apply all styles at once)
        updates.forEach(({ zhRow, width }) => {
            zhRow.style.maxWidth = `${Math.max(width, 40)}px`;
            zhRow.style.fontSize = '11px';
        });
    }

    // New helper for localized updates
    updateTagVisuals(li, tag, index) {
        const textSpan = li.querySelector('.tag-text');
        const primary = li.querySelector('.tag-primary');
        const capsule = li.querySelector('.tag-capsule');
        const weightInput = li.querySelector('.weight-input');

        let text = tag.value;
        let weightVal = 1.0;
        let str = text;

        let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        let headerMatch = text.match(/^([-?\d\.]+)::$/);
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        let isCompHeader = false;
        let isCompFooter = text === ' ::';

        // Backtrack to find if we are in a group or dynamic block
        let inGroup = false;
        let inDynamic = false;
        for (let j = 0; j < index; j++) {
            const val = this.tags[j].value;
            if (val.match(/^([-?\d\.]+)::$/)) inGroup = true;
            else if (val === ' ::') inGroup = false;
            
            if (val.startsWith('||') && (val !== '||' || this.tags[j].isStart)) inDynamic = true;
            else if (val === '||' && !this.tags[j].isStart) inDynamic = false;
        }
        const isCompMember = inGroup;
        const isDynMember = inDynamic;

        if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            str = blockMatch[2];
        } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            str = '';
            isCompHeader = true;
        } else if (isCompFooter) {
            str = ')';
            // Backtrack to find weight from closest header
            for (let j = index - 1; j >= 0; j--) {
                let m = this.tags[j].value.match(/^([-?\d\.]+)::$/);
                if (m) {
                    weightVal = parseFloat(m[1]);
                    break;
                }
            }
        } else {
            let inc = 0, dec = 0;
            if (text.startsWith('{') || text.startsWith('[')) {
                let s = text;
                while (s.startsWith('{') && s.endsWith('}')) { inc++; s = s.slice(1, -1); }
                if (inc === 0) while (s.startsWith('[') && s.endsWith(']')) { dec++; s = s.slice(1, -1); }
                if (inc > 0) weightVal = 1 + (inc * 0.1);
                else if (dec > 0) weightVal = 1 - (dec * 0.1);
                str = s;
            }
        }

        const isNewline = str === '\n' && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter;
        const isAiPending = this.isPendingAiTag(tag);
        
        li.classList.remove('tag-comp-header', 'tag-comp-footer', 'tag-dyn-header', 'tag-dyn-footer', 'tag-dynamic', 'tag-comp-member', 'tag-dyn-member');
        if (isCompHeader) li.classList.add('tag-comp-header');
        if (isCompFooter) li.classList.add('tag-comp-footer');
        if (isDynHeader) li.classList.add('tag-dyn-header');
        if (isDynFooter) li.classList.add('tag-dyn-footer');
        if (isCompMember) li.classList.add('tag-comp-member');
        if (isDynMember) li.classList.add('tag-dyn-member');
        if (isDynHeader || isDynFooter || isDynMember) li.classList.add('tag-dynamic');

        if (capsule) {
            capsule.className = 'tag-capsule';
            if (isCompHeader) capsule.classList.add('gh');
            if (isCompFooter) capsule.classList.add('gf');
            if (isDynHeader) capsule.classList.add('dh');
            if (isDynFooter) capsule.classList.add('df');
        }

        if (textSpan) textSpan.textContent = (isCompHeader || isCompFooter || isDynHeader || isDynFooter) ? '' : (isNewline ? '↵' : str);
        if (isNewline) li.classList.add('tag-newline');
        else li.classList.remove('tag-newline');

        if (weightInput && document.activeElement !== weightInput) {
            weightInput.value = weightVal.toFixed(1);
        }

        // Update weight badge
        let badge = li.querySelector('.tag-weight-badge');
        const showWeight = !isAiPending && (Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter)) && !isNewline;
        if (showWeight) {
            if (!badge) {
                badge = document.createElement('span');
                primary.prepend(badge);
            }
            badge.className = `tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}`;
            badge.textContent = weightVal.toFixed(1);
        } else if (badge) {
            badge.remove();
        }

        // Update DynWeight badge
        let dynBadge = li.querySelector('.tag-dyn-weight-mini-badge');
        if (!isAiPending && tag.dynWeight && tag.dynWeight !== 1) {
            if (!dynBadge) {
                dynBadge = document.createElement('span');
                dynBadge.className = 'tag-dyn-weight-mini-badge';
                dynBadge.title = 'Selection Weight';
                // Insert after tag-text
                if (textSpan) textSpan.after(dynBadge);
                else primary.appendChild(dynBadge);
            }
            const formattedDyn = (tag.dynWeight % 1 === 0) ? tag.dynWeight : tag.dynWeight.toFixed(1);
            dynBadge.textContent = formattedDyn;
        } else if (dynBadge) {
            dynBadge.remove();
        }

        const dynWeightInput = li.querySelector('.dyn-weight-input');
        if (dynWeightInput && document.activeElement !== dynWeightInput) {
            dynWeightInput.value = tag.dynWeight || 1;
        }

        // Update disabled state
        if (tag.disabled) capsule.classList.add('disabled');
        else capsule.classList.remove('disabled');

        const btnToggle = li.querySelector('.tbtn-toggle');
        if (btnToggle) btnToggle.textContent = tag.disabled ? '👁️' : '🚫';

        const zhRow = li.querySelector('.tag-zh-row');
        this.syncPendingAiState(li, tag);
        if (zhRow) {
            if (tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
                zhRow.textContent = tag.aiOriginal;
                zhRow.classList.add('tag-ai-original');
            } else {
                zhRow.classList.remove('tag-ai-original');
            }
        }

        // Update DynConfig inputs and Pick Badge
        const dynConfigControl = li.querySelector('.dyn-config-control');
        if (isDynHeader && dynConfigControl) {
            const minInput = dynConfigControl.querySelector('.dyn-min');
            const maxInput = dynConfigControl.querySelector('.dyn-max');
            const sepInput = dynConfigControl.querySelector('.dyn-sep');

            if (document.activeElement !== minInput && document.activeElement !== maxInput && document.activeElement !== sepInput) {
                // Parse from tag.value (e.g., ||2$$ or ||1-3$$and$$)
                let fullConfig = text.slice(2);
                let rangeStr = '';
                let joinerStr = '';

                if (fullConfig.includes('$$')) {
                    const parts = fullConfig.split('$$').filter(p => p !== '');
                    rangeStr = parts[0] || '';
                    joinerStr = parts[1] || '';
                } else {
                    rangeStr = fullConfig;
                }

                let minValue = rangeStr, maxValue = '';
                if (rangeStr.includes('-')) {
                    const parts = rangeStr.split('-');
                    minValue = parts[0];
                    maxValue = parts[1];
                } else if (rangeStr) {
                    minValue = '';
                    maxValue = rangeStr;
                }
                minInput.value = minValue;
                maxInput.value = maxValue;
                sepInput.value = joinerStr;

                // Visual Highlight for custom separator
                if (joinerStr) {
                    sepInput.classList.add('has-custom-sep');
                    li.classList.add('has-custom-joiner');
                } else {
                    sepInput.classList.remove('has-custom-sep');
                    li.classList.remove('has-custom-joiner');
                }
            }

            // Update Pick Badge
            let pickBadge = primary.querySelector('.tag-dyn-pick-badge');
            let fullConfigForBadge = text.slice(2);
            let rangeStrForBadge = '';
            if (fullConfigForBadge.includes('$$')) {
                rangeStrForBadge = fullConfigForBadge.split('$$')[0];
            } else {
                rangeStrForBadge = fullConfigForBadge;
            }

            if (rangeStrForBadge) {
                if (!pickBadge) {
                    pickBadge = document.createElement('span');
                    pickBadge.className = 'tag-dyn-pick-badge';
                    primary.prepend(pickBadge);
                }
                let displayCount = rangeStrForBadge.replace('-', '~');
                let fullConfigText = text.slice(2);
                let sepPart = '';
                if (fullConfigText.includes('$$')) {
                    const parts = fullConfigText.split('$$');
                    if (parts.length > 2 && parts[1]) {
                        sepPart = ` [${parts[1]}]`;
                    }
                }
                pickBadge.textContent = 'x' + displayCount + sepPart;
            } else if (pickBadge) {
                pickBadge.remove();
            }
        }

        // Update Split Button (for weighted tags or normal tags that can be converted)
        const controls = li.querySelector('.tag-controls');
        if (controls) {
            const existingSplit = controls.querySelector('.tbtn-split');
            const canSplit = !isAiPending && (blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter));

            if (canSplit && !existingSplit) {
                const btnSplit = document.createElement('button');
                btnSplit.type = 'button';
                btnSplit.className = 'tbtn tbtn-split';
                btnSplit.title = 'Split to markers';
                btnSplit.textContent = '✂️';
                btnSplit.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.splitGroupTag(index); };

                // Insert before Merge or Toggle
                const ref = controls.querySelector('.tbtn-merge') || controls.querySelector('.tbtn-toggle');
                if (ref) {
                    controls.insertBefore(btnSplit, ref);
                } else {
                    controls.appendChild(btnSplit);
                }
            } else if (!canSplit && existingSplit) {
                existingSplit.remove();
            }
        }
    }

    toggleDisable(index, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        const targetState = !this.tags[index].disabled;

        indices.forEach(i => {
            this.tags[i].disabled = targetState;
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index]);
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    async copyTag(index) {
        let toCopy = [this.tags[index]];
        if (this.selectedIndices.has(index)) {
            toCopy = Array.from(this.selectedIndices).sort((a, b) => a - b).map(i => this.tags[i]);
        }
        const text = toCopy.map(t => t.value).join(', ');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                throw new Error('Clipboard API unavailable');
            }
            // Flash feedback for all copied tags
            const items = this.listElement.querySelectorAll('.tag-item');
            (this.selectedIndices.has(index) ? Array.from(this.selectedIndices) : [index]).forEach(idx => {
                const li = items[idx];
                if (li) {
                    li.classList.add('flash-success');
                    setTimeout(() => li.classList.remove('flash-success'), 500);
                }
            });
        } catch (err) {
            // Fallback to execCommand
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                textArea.remove();
                // Flash feedback for all copied tags
                const items = this.listElement.querySelectorAll('.tag-item');
                (this.selectedIndices.has(index) ? Array.from(this.selectedIndices) : [index]).forEach(idx => {
                    const li = items[idx];
                    if (li) {
                        li.classList.add('flash-success');
                        setTimeout(() => li.classList.remove('flash-success'), 500);
                    }
                });
            } catch (err2) {
                console.error('Failed to copy tag:', err2);
            }
        }
    }

    splitGroupTag(index) {
        const tag = this.tags[index];
        const match = tag.value.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        
        let weight, content;
        if (match) {
            weight = match[1];
            content = match[2];
        } else {
            // Support splitting normal tags into 1.0::tag ::
            weight = "1.0";
            content = tag.value;
        }

        const parts = content.split(',').map(p => p.trim()).filter(Boolean);

        const newTags = [
            { value: `${weight}::`, disabled: tag.disabled },
            ...parts.map(p => ({ value: p, disabled: tag.disabled })),
            { value: ' ::', disabled: tag.disabled }
        ];

        this.tags.splice(index, 1, ...newTags);
        this.render();
        this.onChange(this.tags);
    }

    mergeGroupTag(footerIndex) {
        // Find corresponding header
        let headerIndex = -1;
        let weight = "1.0";

        for (let i = footerIndex - 1; i >= 0; i--) {
            if (this.tags[i].value === ' ::') {
                // Nested footer found? Not supported, abort search for simplicity
                // Or we could skip it, but assuming flat structure for now.
                break;
            }
            let m = this.tags[i].value.match(/^([-?\d\.]+)::$/);
            if (m) {
                headerIndex = i;
                weight = m[1];
                break;
            }
        }

        if (headerIndex === -1) return;

        // Collect content
        const contentTags = this.tags.slice(headerIndex + 1, footerIndex);
        const contentStr = contentTags.map(t => t.value).join(', ');

        // Reconstruct single pill
        let newTagValue;
        if (contentTags.length === 1 && (parseFloat(weight) === 1.0)) {
            // Restore to basic tag if only one member and weight is 1.0
            newTagValue = contentTags[0].value;
        } else {
            newTagValue = `${weight}::${contentStr} ::`;
        }

        // Replace group with single tag
        this.tags.splice(headerIndex, footerIndex - headerIndex + 1, {
            value: newTagValue,
            disabled: this.tags[headerIndex].disabled
        });

        this.clearSelection();
        this.render();
        this.onChange(this.tags);
    }

    showCopyFeedback(index) {
        // Use data-index attribute to find the element, not DOM position
        const el = this.listElement.querySelector(`.tag-item[data-index="${index}"]`);
        if (el) {
            el.classList.add('flash-success');
            setTimeout(() => el.classList.remove('flash-success'), 500);
        }
    }

    // cycleBrackets removed

    removeTags(indices) {
        // If the target is part of a selection, remove all selected
        let toRemove = indices;
        if (indices.length === 1 && this.selectedIndices.has(indices[0])) {
            toRemove = Array.from(this.selectedIndices);
        }
        
        // Sort descending to avoid index shifting during splice
        toRemove.sort((a, b) => b - a);
        toRemove.forEach(idx => {
            if (this.tags[idx]) {
                this.tags.splice(idx, 1);
            }
        });

        this.clearSelection();
        this.render();
        this.onChange(this.tags);
    }

    handleMarqueeStart(e) {
        // Only trigger if click is on the container background or the list, not on a tag or controls
        if (e.target.closest('.tag-item') || e.target.closest('.tag-controls')) return;
        
        this.isSelecting = true;
        this.container.classList.add('is-selecting');
        this.startPos = { x: e.clientX, y: e.clientY };
        
        // Clear selection unless Ctrl/Shift is held
        if (!e.ctrlKey && !e.shiftKey) {
            this.clearSelection();
        }

        this.selectionBoxEl.style.display = 'block';
        this.selectionBoxEl.style.left = `${e.clientX}px`;
        this.selectionBoxEl.style.top = `${e.clientY}px`;
        this.selectionBoxEl.style.width = '0px';
        this.selectionBoxEl.style.height = '0px';
    }

    handleMarqueeMove(e) {
        if (!this.isSelecting) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const left = Math.min(this.startPos.x, currentX);
        const top = Math.min(this.startPos.y, currentY);
        const width = Math.abs(this.startPos.x - currentX);
        const height = Math.abs(this.startPos.y - currentY);

        this.selectionBoxEl.style.left = `${left}px`;
        this.selectionBoxEl.style.top = `${top}px`;
        this.selectionBoxEl.style.width = `${width}px`;
        this.selectionBoxEl.style.height = `${height}px`;

        // Collision detection
        const marqueeRect = this.selectionBoxEl.getBoundingClientRect();
        const tagElements = this.listElement.querySelectorAll('.tag-item');

        tagElements.forEach((el) => {
            // Use data-index (tag array index), NOT DOM position
            // When newline separators exist, DOM position !== tag array index
            const tagIndex = parseInt(el.dataset.index, 10);
            if (isNaN(tagIndex)) return;
            
            // For newline tags, only use the compact capsule rect for collision, not the full 100% width li
            const isNewline = el.classList.contains('tag-newline');
            const targetEl = isNewline ? el.querySelector('.tag-capsule') : el;
            if (!targetEl) return;

            const tagRect = targetEl.getBoundingClientRect();
            const isOverlapping = !(marqueeRect.right < tagRect.left || 
                                    marqueeRect.left > tagRect.right || 
                                    marqueeRect.bottom < tagRect.top || 
                                    marqueeRect.top > tagRect.bottom);

            if (isOverlapping) {
                this.selectedIndices.add(tagIndex);
            } else if (!e.ctrlKey && !e.shiftKey) {
                this.selectedIndices.delete(tagIndex);
            }
        });

        this.updateSelectionVisuals();
    }

    handleMarqueeEnd() {
        if (!this.isSelecting) return;
        this.isSelecting = false;
        this.container.classList.remove('is-selecting');
        this.selectionBoxEl.style.display = 'none';
        this.lastSelectedIndex = null; // Reset shift-selection anchor
    }

    addTag(value) {
        const newTag = this.normalizeTagInput(value);
        if (!newTag) return null;
        const val = newTag.value;

        // 检测是否为动态语法头部（||）
        const isDynHeader = val.startsWith('||');
        let shouldAutoClose = false;

        if (isDynHeader) {
            // 检查当前是否已在动态块内
            let inDynamic = false;
            this.tags.forEach(t => {
                const tv = t.value;
                const isStart = tv.startsWith('||') && (tv !== '||' || t.isStart);
                const isEnd = tv === '||' && !t.isStart;
                if (isStart) inDynamic = true;
                else if (isEnd) inDynamic = false;
            });

            // 不在动态块内时，自动添加关闭标记
            if (!inDynamic) {
                shouldAutoClose = true;
            }
        }

        if (isDynHeader) newTag.isStart = true;

        // 智能插入位置：
        // 如果当前有选中项，则将新标签插入到最大选中索引的后面；
        // 否则默认追加到末尾。
        let insertIndex = this.tags.length;
        if (this.selectedIndices.size > 0) {
            insertIndex = Math.max(...Array.from(this.selectedIndices)) + 1;
        }

        this.tags.splice(insertIndex, 0, newTag);

        if (shouldAutoClose) {
            this.tags.splice(insertIndex + 1, 0, { value: '||', disabled: false });
        }

        // 更新选中状态到插入点，使连续插入的下一个标签能追随上一个
        if (this.selectedIndices.size > 0) {
            this.selectedIndices.clear();
            this.selectedIndices.add(insertIndex);
            this.lastSelectedIndex = insertIndex;
        }

        this.render();
        this.onChange(this.tags);
        return newTag;
    }

    removeTagByText(textToRemove) {
        if (!textToRemove) return;
        const textToMatch = textToRemove.trim();
        let changed = false;
        
        // Reverse iterate to safely remove multiple instances if necessary 
        // (though usually we remove one by one or all matching tags)
        for (let i = this.tags.length - 1; i >= 0; i--) {
            // Clean dynamic/weight markers for match comparison if needed
            // Currently, panel sends exact raw text (e.g. "1girl"), so simple match should work for basic tags.
            // But if it has weight, we might need a regex. For simple grouping tags:
            const val = this.tags[i].value;
            let currentText = val;
            
            // Extract core text if it's a weighted/composite tag
            let blockMatch = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            if (blockMatch) currentText = blockMatch[2];
            else {
                let inc = 0, dec = 0;
                let s = val;
                if (s.startsWith('{') || s.startsWith('[')) {
                    while (s.startsWith('{') && s.endsWith('}')) { inc++; s = s.slice(1, -1); }
                    if (inc === 0) while (s.startsWith('[') && s.endsWith(']')) { dec++; s = s.slice(1, -1); }
                    currentText = s;
                }
            }
            
            if (currentText === textToMatch) {
                this.tags.splice(i, 1);
                changed = true;
                break; // Just remove the first matching one (from end, or we can break immediately after finding first)
            }
        }

        if (changed) {
            this.clearSelection();
            this.render();
            this.onChange(this.tags);
        }
    }

}
