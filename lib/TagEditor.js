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
            onEnd: (evt) => {
                this.container.classList.remove('is-dragging');
                const { newDraggableIndex, oldDraggableIndex } = evt;
                if (newDraggableIndex === oldDraggableIndex || newDraggableIndex === undefined || oldDraggableIndex === undefined) return;

                // Move item in array using draggable indices
                const item = this.tags.splice(oldDraggableIndex, 1)[0];
                this.tags.splice(newDraggableIndex, 0, item);

                // Re-render to ensure indices are correct
                this.render();
                this.onChange(this.tags);
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
        let inGroup = false;

        // First pass: identify valid groups to avoid styling broken/open groups
        // But for simplicity, we just process strictly.
        // Actually, we need to know if a tag is a member in the render loop.

        this.tags.forEach((tag, index) => {
            const isHeader = !!tag.value.match(/^([-?\d\.]+)::$/);
            const isFooter = tag.value === ' ::';

            // Logic: 
            // 1. If we hit a Header, we are starting a group (if not already in one? nesting not supported well)
            // 2. If we hit a Footer, we are ending a group.

            // However, createTagElement logic needs to know if THIS tag is height "group member".
            // Header is Header. Footer is Footer.
            // Items in between are Members.

            // Refined Logic for this iteration:
            // - If currently inGroup, and current is Footer -> it's Footer, then inGroup=false.
            // - If currently inGroup, and current is Header -> treat as new Header (nestedish or broken), inGroup=true.
            // - If currently inGroup, and not Footer/Header -> Member.
            // - If not inGroup, and current is Header -> Header, inGroup=true.

            let isMember = false;

            if (isHeader) {
                inGroup = true;
            } else if (isFooter) {
                inGroup = false;
            } else if (inGroup) {
                isMember = true;
            }

            const li = this.createTagElement(tag, index, isMember);
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

    createTagElement(tag, index, isGroupMember = false) {
        const li = document.createElement('li');
        li.className = 'tag-item';
        if (tag.disabled) li.classList.add('disabled');
        if (isGroupMember) li.classList.add('tag-group-member');
        li.dataset.index = index;

        // Visual breakdown
        let text = tag.value;
        let weightVal = 1.0;
        let cleanText = text;
        let isGroupHeader = false;
        let isGroupFooter = text === ' ::';

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
            isGroupHeader = true;
        } else if (isGroupFooter) {
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
        if (isGroupHeader || isGroupFooter) displayTagName = ''; // Both markers stay empty



        if (isNewline) li.classList.add('tag-newline');
        if (isGroupHeader) li.classList.add('tag-group-header');
        if (isGroupFooter) li.classList.add('tag-group-footer');

        // Pro Features
        // Pro Features
        let info = null;
        if (this.autocomplete && !isGroupHeader && !isGroupFooter) {
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
        // Enable weight controls for all tags except newlines, footers, and group members
        // (Header already has weight controls via headerMatch)
        const hasWeight = blockMatch || headerMatch || (!isNewline && !isGroupFooter && !isGroupMember);

        li.innerHTML = `
            <div class="tag-capsule ${isGroupHeader ? 'gh' : (isGroupFooter ? 'gf' : '')}" style="border-color: ${info && info.color ? info.color : ''}; border-width: ${info && info.color ? '1.5px' : ''}; background: ${info && info.color ? `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)` : ''}">
                <div class="tag-primary">
                    ${((weightVal !== 1.0 || isGroupHeader || isGroupFooter) && !isNewline) ? `<span class="tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}">${weightVal.toFixed(1)}</span>` : ''}
                    <span class="tag-text">${displayTagName}</span>
                </div>
                <div class="tag-controls">
                    ${!isGroupHeader && !isGroupFooter ? `<button type="button" class="tbtn tbtn-fav ${isFav ? 'active' : ''}" title="Favorite">⭐</button>` : ''}
                    <button type="button" class="tbtn tbtn-copy" title="Copy Tag">📋</button>
                    ${hasWeight ? `
                    <div class="weight-control">
                        <button type="button" class="tbtn tbtn-sub" title="Decrease Weight">-</button>
                        <input type="text" class="weight-input" value="${weightVal.toFixed(1)}" title="Edit Weight">
                        <button type="button" class="tbtn tbtn-add" title="Increase Weight">+</button>
                    </div>
                    ` : ''}
                    ${blockMatch ? `<button type="button" class="tbtn tbtn-split" title="Split to markers">✂️</button>` : ''}
                    ${isGroupFooter ? `<button type="button" class="tbtn tbtn-merge" title="Merge group">🔗</button>` : ''}
                    <button type="button" class="tbtn tbtn-toggle" title="Enable/Disable">${tag.disabled ? '👁️' : '🚫'}</button>
                    <button type="button" class="tbtn tbtn-del" title="Delete">×</button>
                </div>
            </div>
            <div class="tag-zh-row">${(info && info.zh && !isNewline) ? info.zh : (isNewline || isGroupHeader || isGroupFooter ? '' : '&nbsp;')}</div>
        `;

        const capsule = li.querySelector('.tag-capsule');
        if (tag.disabled) capsule.classList.add('disabled');

        // Interaction refinements
        capsule.addEventListener('mousedown', (e) => {
            if (e.target.closest('.tag-controls')) return;
            if (e.target.tagName === 'INPUT') return;
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        // Single click on text to edit
        const textSpan = li.querySelector('.tag-text');
        if (!isGroupHeader && !isGroupFooter) {
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
        if (!isGroupHeader && !isGroupFooter) {
            const btnFav = li.querySelector('.tbtn-fav');
            btnFav.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleFavorite(cleanText, li); };
        }

        const btnCopy = li.querySelector('.tbtn-copy');
        btnCopy.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.copyTag(index); };

        if (hasWeight) {
            const btnSub = li.querySelector('.tbtn-sub');
            btnSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, -0.1, li); };

            const btnAdd = li.querySelector('.tbtn-add');
            btnAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, 0.1, li); };

            const weightInput = li.querySelector('.weight-input');
            weightInput.onmousedown = (e) => e.stopPropagation();
            weightInput.oninput = (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) this.updateWeightManual(index, val, li);
            };
        }

        if (blockMatch) {
            const btnSplit = li.querySelector('.tbtn-split');
            btnSplit.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.splitGroupTag(index); };
        }

        if (isGroupFooter) {
            const btnMerge = li.querySelector('.tbtn-merge');
            btnMerge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.mergeGroupTag(index); };
        }

        const btnToggle = li.querySelector('.tbtn-toggle');
        btnToggle.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleDisable(index, li); };


        const btnDel = li.querySelector('.tbtn-del');
        btnDel.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.removeTags([index]); };

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
        let isGroupHeader = false;
        let isGroupFooter = text === ' ::';

        if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            str = blockMatch[2];
        } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            str = '';
            isGroupHeader = true;
        } else if (isGroupFooter) {
            str = ')';
            isGroupHeader = false;
            // Backtrack
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

        const isNewline = str === '\n' && !isGroupHeader && !isGroupFooter;
        if (isGroupHeader) {
            li.classList.add('tag-group-header');
            str = '';
        } else if (isGroupFooter) {
            li.classList.add('tag-group-footer');
            str = ')';
        } else {
            li.classList.remove('tag-group-header', 'tag-group-footer');
        }

        if (textSpan) textSpan.textContent = (isGroupHeader || isGroupFooter) ? '' : (isNewline ? '↵' : str);
        if (isNewline) li.classList.add('tag-newline');
        else li.classList.remove('tag-newline');

        if (weightInput) weightInput.value = weightVal.toFixed(1);

        // Update weight badge
        let badge = li.querySelector('.tag-weight-badge');
        if (Math.abs(weightVal - 1.0) > 0.001 || isGroupHeader || isGroupFooter) {
            if (!badge) {
                badge = document.createElement('span');
                primary.prepend(badge);
            }
            badge.className = `tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}`;
            badge.textContent = weightVal.toFixed(1);
        } else if (badge) {
            badge.remove();
        }

        // Update disabled state
        if (tag.disabled) capsule.classList.add('disabled');
        else capsule.classList.remove('disabled');

        const btnToggle = li.querySelector('.tbtn-toggle');
        if (btnToggle) btnToggle.textContent = tag.disabled ? '👁️' : '🚫';
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
        if (!match) return;

        const weight = match[1];
        const content = match[2];
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
        const newTagValue = `${weight}::${contentStr} ::`;

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
        this.tags.push({ value: value.trim(), disabled: false });
        this.render();
        this.onChange(this.tags);
    }

}
