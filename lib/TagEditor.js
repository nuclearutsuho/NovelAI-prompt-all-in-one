import Sortable from "./Sortable.js";
import common from "./common.js";

export default class TagEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.tags = [];
        this.selectedIndices = new Set();
        this.onChange = options.onChange || (() => { });

        this.render = this.render.bind(this);
        this.init();
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
            // multiDrag: true, 
            onEnd: (evt) => {
                const { newIndex, oldIndex } = evt;
                if (newIndex === oldIndex) return;

                // Move item in array
                const item = this.tags.splice(oldIndex, 1)[0];
                this.tags.splice(newIndex, 0, item);

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
        const items = this.listElement.children;
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

        li.innerHTML = `
            <div class="tag-main">
                <span class="tag-text" title="${tag.value}">${cleanText}</span>
                ${weightVal !== 0 ? `<span class="tag-weight-badge ${weightVal > 0 ? 'pos' : 'neg'}">${weightVal > 0 ? '+' + weightVal : weightVal}</span>` : ''}
            </div>
            <div class="tag-controls">
                <button class="tbtn tbtn-sub" title="Decrease Weight">-</button>
                <button class="tbtn tbtn-add" title="Increase Weight">+</button>
                <button class="tbtn tbtn-toggle" title="Enable/Disable">${tag.disabled ? '👁️' : '🚫'}</button>
                <button class="tbtn tbtn-del" title="Delete">×</button>
            </div>
        `;

        li.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (e.target.tagName === 'INPUT') return;
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        const btnSub = li.querySelector('.tbtn-sub');
        btnSub.onclick = (e) => { e.stopPropagation(); this.updateWeight(index, -1); };

        const btnAdd = li.querySelector('.tbtn-add');
        btnAdd.onclick = (e) => { e.stopPropagation(); this.updateWeight(index, 1); };

        const btnToggle = li.querySelector('.tbtn-toggle');
        btnToggle.onclick = (e) => { e.stopPropagation(); this.toggleDisable(index); };

        const btnDel = li.querySelector('.tbtn-del');
        btnDel.onclick = (e) => { e.stopPropagation(); this.removeTags([index]); };

        li.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.enterEditMode(li, index);
        });

        return li;
    }

    enterEditMode(li, index) {
        const tag = this.tags[index];
        li.classList.add('editing');
        li.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = tag.value;
        input.className = 'tag-inline-input';

        li.appendChild(input);
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

    updateWeight(index, delta) {
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

        this.render();
        this.onChange(this.tags);
    }

    toggleDisable(index) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        const targetState = !this.tags[index].disabled;

        indices.forEach(i => {
            this.tags[i].disabled = targetState;
        });

        this.render();
        this.onChange(this.tags);
    }

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
