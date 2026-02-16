import Sortable from "./Sortable.js";
import common from "./common.js";

export default class TagEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.tags = [];
        this.selectedIndices = new Set();
        this.onChange = options.onChange || (() => { });
        this.favorites = [];
        this.sequentialCounters = {};

        this.render = this.render.bind(this);
        this.init();
        this.loadFavorites();
    }

    async loadFavorites() {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const data = await chrome.storage.local.get('favorites');
            this.favorites = data.favorites || [];
            this.render();
        }
    }

    setSequentialCounters(counters) {
        this.sequentialCounters = counters || {};
        this.render();
    }

    init() {
        this.container.innerHTML = ''; // Clear loading placeholder
        this.container.classList.add('tag-editor-container');
        this.listElement = document.createElement('ul');
        this.listElement.className = 'tag-list';
        this.container.appendChild(this.listElement);

        this.initSortable();

        // Global click to clear selection if clicked outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.clearSelection();
            }
        });
    }

    initSortable() {
        this.sortable = new Sortable(this.listElement, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.tag-item', // Only allow dragging actual tag items
            onStart: () => {
                this.container.classList.add('is-dragging');
            },
            onMove: (evt) => {
                const draggedEl = evt.dragged;
                const relatedEl = evt.related;

                // 1. Identify if dragged item is a "container" type (Header or Block)
                const idx = parseInt(draggedEl.dataset.index, 10);
                if (isNaN(idx)) return true; // Safety

                const tag = this.tags[idx];
                if (!tag) return true;

                // Check if it's a Header or a "Block" (Single Pill with :: inside)
                const val = tag.value;
                const isBlock = !!val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
                const isHeader = !!val.match(/^([-?\d\.]+)::$/);

                // If it's just a normal tag, let it go anywhere
                if (!isBlock && !isHeader) return true;

                // 2. If it IS a weighted tag/header, forbid dropping "inside" another NAI group
                // But ALLOW dropping inside Dynamic Groups

                // Case A: Dropping on a member
                if (relatedEl.classList.contains('tag-group-member')) {
                    // Only forbid if it's an NAI member (not dynamic)
                    if (!relatedEl.classList.contains('tag-dynamic')) {
                        return false;
                    }
                }

                // Case B: Header/Footer boundaries
                const isRelHeader = relatedEl.classList.contains('tag-group-header');
                const isRelFooter = relatedEl.classList.contains('tag-group-footer');
                const isRelDynamic = relatedEl.classList.contains('tag-dynamic');

                // If target is Header, inserting AFTER it puts us inside the group
                if (isRelHeader && evt.willInsertAfter) {
                    if (!isRelDynamic) return false;
                }

                // If target is Footer, inserting BEFORE it puts us inside the group
                if (isRelFooter && !evt.willInsertAfter) {
                    if (!isRelDynamic) return false;
                }

                return true;
            },
            onEnd: (evt) => {
                this.container.classList.remove('is-dragging');
                const { newDraggableIndex, oldDraggableIndex } = evt;
                if (newDraggableIndex === oldDraggableIndex || newDraggableIndex === undefined || oldDraggableIndex === undefined) return;

                // Move item in array using draggable indices
                const item = this.tags.splice(oldDraggableIndex, 1)[0];
                this.tags.splice(newDraggableIndex, 0, item);

                // Clean up trailing commas if tag was moved out of dynamic syntax
                this.cleanupExternalCommas();

                // Re-render to ensure indices are correct
                this.render();
                this.onChange(this.tags);
            }
        });
    }

    cleanupExternalCommas() {
        let inDynamic = false;
        this.tags.forEach(tag => {
            const val = tag.value;
            const isDynHeader = val.startsWith('||') && (val !== '||' || tag.isStart);
            const isDynFooter = val === '||' && !tag.isStart;

            if (isDynHeader) {
                inDynamic = true;
            } else if (isDynFooter) {
                inDynamic = false;
            } else if (!inDynamic) {
                // If tag is outside dynamic blocks and ends with a comma, strip it
                // We trim() to be safe, but typically tags are already trimmed
                const trimmed = val.trim();
                if (trimmed.endsWith(',') && !val.startsWith('||')) {
                    tag.value = trimmed.slice(0, -1).trim();
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
        const items = this.listElement.querySelectorAll('.tag-item');
        for (let i = 0; i < items.length; i++) {
            if (this.selectedIndices.has(i)) {
                items[i].classList.add('selected');
            } else {
                items[i].classList.remove('selected');
            }
        }
    }

    render() {
        this.listElement.innerHTML = '';
        this.currentSlotCounts = {}; // Track slots per render for sequential wildcards
        let inGroup = false;
        let inDynamic = false;

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
            this.listElement.appendChild(li);


            // If rendering newlines as physical breaks, add a separator element
            const text = tag.value;
            let str = text;
            if (text.startsWith('{') || text.startsWith('[')) {
                let inc = 0;
                while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
                if (inc === 0) {
                    while (str.startsWith('[') && str.endsWith(']')) { str = str.slice(1, -1); }
                }
            }
            if (str === '\n' && this.options.renderNewlines) {
                const separator = document.createElement('li');
                separator.className = 'tag-newline-separator';
                this.listElement.appendChild(separator);
            }
        });
        this.updateSelectionVisuals();
        requestAnimationFrame(() => this.adjustTranslationLayout());
    }

    createTagElement(tag, index, { isCompMember = false, isDynMember = false } = {}) {
        const li = document.createElement('li');
        li.className = 'tag-item';
        if (tag.disabled) li.classList.add('disabled');
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
        let displayTagName = isNewline ? '↵' : cleanText;
        if (isCompHeader || isCompFooter || isDynHeader || isDynFooter) displayTagName = ''; 

        // Dynamic Weight Badge
        let dynWeightBadge = '';
        if (isDynMember && tag.dynWeight && tag.dynWeight !== 1) {
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

        if (info && info.color) {
            li.style.borderColor = info.color;
            li.style.borderWidth = '1.5px';
            li.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }

        const isFav = this.favorites.includes(cleanText);
        
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
        const hasWeight = (blockMatch || headerMatch || (!isNewline && !isCompFooter && !isCompMember)) && !isDynHeader && !isDynFooter;

        li.innerHTML = `
            <div class="tag-capsule ${isCompHeader ? 'gh' : (isCompFooter ? 'gf' : (isDynHeader ? 'dh' : (isDynFooter ? 'df' : '')))}" style="border-color: ${info && info.color ? info.color : ''}; border-width: ${info && info.color ? '1.5px' : ''}; background: ${info && info.color ? `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)` : ''}">
                <div class="tag-primary">
                    ${isDynHeader ? pickBadge : (((Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter)) && !isNewline) ? `<span class="tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}">${weightVal.toFixed(1)}</span>` : '')}
                    <span class="tag-text">${displayTagName}</span>
                    ${dynWeightBadge}
                    ${this.renderCounterBadge(tag.value)}
                </div>
                <div class="tag-controls">
                    ${isDynHeader ? `
                    <div class="dyn-config-control">
                        <input type="text" class="dyn-config-input dyn-min" title="Min" placeholder="min">
                        <span>-</span>
                        <input type="text" class="dyn-config-input dyn-max" title="Max" placeholder="max">
                        <input type="text" class="dyn-config-input dyn-sep sep" title="Separator" placeholder="">
                    </div>
                    ` : ''}
                    ${!isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-fav ${isFav ? 'active' : ''}" title="Favorite">⭐</button>` : ''}
                    ${!isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-copy" title="Copy Tag">📋</button>` : ''}
                    ${hasWeight ? `
                    <div class="weight-control">
                        <button type="button" class="tbtn tbtn-sub" title="Decrease Weight">-</button>
                        <input type="text" class="weight-input" value="${weightVal.toFixed(1)}" title="Edit Weight">
                        <button type="button" class="tbtn tbtn-add" title="Increase Weight">+</button>
                    </div>
                    ` : ''}
                    ${isDynMember ? `
                    <div class="weight-control dyn-weight-control" title="Selection Probability Weight">
                        <button type="button" class="tbtn tbtn-dyn-sub" title="Decrease Selection Weight">-</button>
                        <input type="text" class="dyn-weight-input" value="${tag.dynWeight || 1}" title="Edit Selection Weight">
                        <button type="button" class="tbtn tbtn-dyn-add" title="Increase Selection Weight">+</button>
                    </div>
                    ` : ''}
                    ${(blockMatch || (!isCompHeader && !isCompFooter && !isCompMember && !isNewline && !isDynHeader && !isDynFooter)) ? `<button type="button" class="tbtn tbtn-split" title="Split to markers">✂️</button>` : ''}
                    ${isCompFooter ? `<button type="button" class="tbtn tbtn-merge" title="Merge group">🔗</button>` : ''}
                    ${!isDynHeader && !isDynFooter ? `<button type="button" class="tbtn tbtn-toggle" title="Enable/Disable">${tag.disabled ? '👁️' : '🚫'}</button>` : ''}
                    <button type="button" class="tbtn tbtn-del" title="Delete">×</button>
                </div>
            </div>
            <div class="tag-zh-row">${(info && info.zh && !isNewline) ? info.zh : (isNewline || isCompHeader || isCompFooter || isDynHeader || isDynFooter ? '' : '&nbsp;')}</div>
        `;

        const capsule = li.querySelector('.tag-capsule');
        if (tag.disabled) capsule.classList.add('disabled');

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
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        const textSpan = li.querySelector('.tag-text');
        if (!isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            textSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                if (li.classList.contains('editing') || this.container.classList.contains('is-dragging')) return;
                if (this.clickTimer) clearTimeout(this.clickTimer);
                this.clickTimer = setTimeout(() => {
                    this.clickTimer = null;
                    this.enterEditMode(li, index);
                }, 300);
            });
        }

        // Toolbar Events
        const btnFav = li.querySelector('.tbtn-fav');
        if (btnFav) {
            btnFav.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleFavorite(cleanText, li); };
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

        const canSplit = blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter);
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

    enterEditMode(li, index) {
        const tag = this.tags[index];
        const capsule = li.querySelector('.tag-capsule');

        // Measure current width before clearing
        const rect = capsule.getBoundingClientRect();
        const currentWidth = rect.width;

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

        // Use timeout to select all text after focus??
        // input.select();

        if (this.autocomplete) {
            this.autocomplete.attach(input, (val) => {
                input.value = val;
                save();
            });
        }

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
        const items = this.listElement.querySelectorAll('.tag-item');
        items.forEach(li => {
            const capsule = li.querySelector('.tag-capsule');
            const zhRow = li.querySelector('.tag-zh-row');

            if (capsule && zhRow && zhRow.textContent.trim()) {
                const capsuleWidth = capsule.offsetWidth;
                // Allow a tiny bit of overflow or exact match
                // Match width
                zhRow.style.maxWidth = `${Math.max(capsuleWidth, 40)}px`;

                // Reset font size for multi-line display
                zhRow.style.fontSize = '11px';

                // No scaling loop needed for multi-line
            }
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
        const showWeight = (Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter)) && !isNewline;
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
        if (tag.dynWeight && tag.dynWeight !== 1) {
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
            const canSplit = blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter);

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

    toggleFavorite(tagText, li = null) {
        const index = this.favorites.indexOf(tagText);
        let isFav = false;
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push(tagText);
            isFav = true;
        }
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ favorites: this.favorites });
        }

        if (li) {
            const btn = li.querySelector('.tbtn-fav');
            if (btn) btn.classList.toggle('active', isFav);
        } else {
            this.render();
        }
    }

    async copyTag(index) {
        const tag = this.tags[index];
        const text = tag.value;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                throw new Error('Clipboard API unavailable');
            }
            this.showCopyFeedback(index);
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
                this.showCopyFeedback(index);
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
        const el = this.listElement.querySelectorAll('.tag-item')[index];
        if (el) {
            el.classList.add('flash-success');
            setTimeout(() => el.classList.remove('flash-success'), 500);
        }
    }

    // cycleBrackets removed

    removeTags(indices) {
        const sorted = indices.sort((a, b) => b - a);
        sorted.forEach(i => {
            this.tags.splice(i, 1);
        });
        this.clearSelection();
        this.render();
        this.onChange(this.tags);
    }

    addTag(value) {
        if (!value) return;
        const val = value.trim();

        // Detect if this is a Dynamic Header
        const isDynHeader = val.startsWith('||');
        let shouldAutoClose = false;

        if (isDynHeader) {
            // Check if we are already in dynamic syntax
            let inDynamic = false;
            this.tags.forEach(t => {
                const tv = t.value;
                const isStart = tv.startsWith('||') && (tv !== '||' || t.isStart);
                const isEnd = tv === '||' && !t.isStart;
                if (isStart) inDynamic = true;
                else if (isEnd) inDynamic = false;
            });

            // If not in dynamic, we will auto-close
            if (!inDynamic) {
                shouldAutoClose = true;
            }
        }

        const newTag = { value: val, disabled: false };
        if (isDynHeader) newTag.isStart = true;
        this.tags.push(newTag);

        if (shouldAutoClose) {
            this.tags.push({ value: '||', disabled: false });
        }

        this.render();
        this.onChange(this.tags);
    }

}
