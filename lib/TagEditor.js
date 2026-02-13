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
        this.tags.forEach((tag, index) => {
            const li = this.createTagElement(tag, index);
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
    }

    createTagElement(tag, index) {
        const li = document.createElement('li');
        li.className = 'tag-item';
        if (tag.disabled) li.classList.add('disabled');
        li.dataset.index = index;

        // Visual breakdown
        let text = tag.value;
        let weightVal = 0;

        let inc = 0;
        let dec = 0;
        let cleanText = text;

        if (text.startsWith('{') || text.startsWith('[')) {
            let str = text;
            while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
            if (inc === 0) {
                while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
            }
            if (inc > 0) weightVal = inc;
            else if (dec > 0) weightVal = -dec;
            cleanText = str;
        } else if (text.match(/:\s*(-?[\d\.]+)\s*[\]\)}]*$/)) {
            const m = text.match(/^[\(\[\{<]*(.+?)(?::\s*(-?[\d\.]+)\s*)?[\)\]\}>]*$/);
            if (m) {
                cleanText = m[1];
            }
        }

        const isNewline = cleanText === '\n';
        const displayTagName = isNewline ? '↵' : cleanText;
        if (isNewline) {
            li.classList.add('tag-newline');
        }

        // Pro Features: Lookup translation and color
        const info = this.autocomplete ? this.autocomplete.getTagInfo(cleanText) : null;
        if (info && info.color) {
            li.style.borderColor = info.color;
            li.style.borderWidth = '1.5px';
            // Subtle background tint
            li.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }

        const isFav = this.favorites.includes(cleanText);
        const helpTooltip = this.options.helpTooltip || "";

        li.innerHTML = `
            <div class="tag-capsule" style="border-color: ${info && info.color ? info.color : ''}; border-width: ${info && info.color ? '1.5px' : ''}; background: ${info && info.color ? `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)` : ''}">
                <div class="tag-primary">
                    <span class="tag-text">${displayTagName}</span>
                    ${(weightVal !== 0 && !isNewline) ? `<span class="tag-weight-badge ${weightVal > 0 ? 'pos' : 'neg'}">${weightVal > 0 ? '+' + weightVal : weightVal}</span>` : ''}
                </div>
                <div class="tag-controls">
                    <button type="button" class="tbtn tbtn-fav ${isFav ? 'active' : ''}" title="Favorite">⭐</button>
                    <button type="button" class="tbtn tbtn-copy" title="Copy Tag">📋</button>
                    <button type="button" class="tbtn tbtn-sub" title="Decrease Weight">-</button>
                    <button type="button" class="tbtn tbtn-add" title="Increase Weight">+</button>
                    <button type="button" class="tbtn tbtn-toggle" title="Enable/Disable">${tag.disabled ? '👁️' : '🚫'}</button>
                    <button type="button" class="tbtn tbtn-del" title="Delete">×</button>
                </div>
            </div>
            <div class="tag-zh-row">${(info && info.zh && !isNewline) ? info.zh : (isNewline ? '' : '&nbsp;')}</div>
        `;

        const capsule = li.querySelector('.tag-capsule');

        // Interaction refinements
        capsule.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (e.target.tagName === 'INPUT') return;
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        // Single click on text to edit (with delay to allow dblclick)
        const textSpan = li.querySelector('.tag-text');
        textSpan.addEventListener('click', (e) => {
            e.stopPropagation();

            // If already editing or dragging, ignore
            if (li.classList.contains('editing') || this.container.classList.contains('is-dragging')) return;

            // Clear any existing timer
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
            }

            this.clickTimer = setTimeout(() => {
                this.clickTimer = null;
                this.enterEditMode(li, index);
            }, 300);
        });

        // Toolbar Events
        const btnFav = li.querySelector('.tbtn-fav');
        btnFav.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleFavorite(cleanText, li); };

        const btnCopy = li.querySelector('.tbtn-copy');
        btnCopy.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.copyTag(index); };

        const btnSub = li.querySelector('.tbtn-sub');
        btnSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, -1, li); };

        const btnAdd = li.querySelector('.tbtn-add');
        btnAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, 1, li); };

        const btnToggle = li.querySelector('.tbtn-toggle');
        btnToggle.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleDisable(index, li); };


        const btnDel = li.querySelector('.tbtn-del');
        btnDel.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.removeTags([index]); };

        // Double click to toggle disabled (All-in-One style)
        capsule.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            // Cancel single click edit
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }
            this.toggleDisable(index, li);
        });

        // Boundary detection for side-floating toolbar
        li.addEventListener('mouseenter', () => {
            const controls = li.querySelector('.tag-controls');
            if (controls) {
                // Remove class first to measure default (right) position
                controls.classList.remove('pos-left');

                // Measure immediately. Note: if it's opacity:0, some browsers might return 0
                // but usually it works if it's just opacity.
                const rect = controls.getBoundingClientRect();
                const containerRect = this.container.getBoundingClientRect();

                // If the right edge of the controls exceeds the container's right edge
                // or is very close to it, flip to the left.
                // We use a bit more margin (e.g., 10px) to be safe.
                if (rect.right > containerRect.right - 10) {
                    controls.classList.add('pos-left');
                }
            }
        });

        return li;
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

        indices.forEach(i => {
            let text = this.tags[i].value;
            if (delta > 0) {
                if (text.startsWith('[') && text.endsWith(']')) {
                    text = text.substring(1, text.length - 1);
                } else {
                    text = '{' + text + '}';
                }
            } else {
                if (text.startsWith('{') && text.endsWith('}')) {
                    text = text.substring(1, text.length - 1);
                } else {
                    text = '[' + text + ']';
                }
            }
            this.tags[i].value = text;
        });

        // Use localized update if only one item is being changed and li is provided
        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index]);
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    // New helper for localized updates
    updateTagVisuals(li, tag) {
        const textSpan = li.querySelector('.tag-text');
        const primary = li.querySelector('.tag-primary');
        const capsule = li.querySelector('.tag-capsule');

        // Parse weight again
        // ... (weight parsing logic)
        let text = tag.value;
        let weightVal = 0;
        let inc = 0;
        let dec = 0;
        let str = text;

        if (text.startsWith('{') || text.startsWith('[')) {
            while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
            if (inc === 0) {
                while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
            }
            if (inc > 0) weightVal = inc;
            else if (dec > 0) weightVal = -dec;
        }

        const isNewline = str === '\n';
        if (textSpan) textSpan.textContent = isNewline ? '↵' : str;
        if (isNewline) li.classList.add('tag-newline');
        else li.classList.remove('tag-newline');

        // Update weight badge
        let badge = li.querySelector('.tag-weight-badge');
        if (weightVal !== 0 && !isNewline) {
            if (!badge) {
                badge = document.createElement('span');
                primary.appendChild(badge);
            }
            badge.className = `tag-weight-badge ${weightVal > 0 ? 'pos' : 'neg'}`;
            badge.textContent = weightVal > 0 ? '+' + weightVal : weightVal;
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
        try {
            await navigator.clipboard.writeText(tag.value);
            // Visual feedback - maybe highlight the tag briefly
            const el = this.listElement.querySelectorAll('.tag-item')[index];
            if (el) {
                el.classList.add('flash-success');
                setTimeout(() => el.classList.remove('flash-success'), 500);
            }
        } catch (err) {
            console.error('Failed to copy tag:', err);
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
