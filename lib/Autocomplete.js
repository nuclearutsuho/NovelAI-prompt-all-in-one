export default class Autocomplete {
    constructor(options = {}) {
        this.options = options;
        this.dict = [];
        this.loaded = false;
        this.loading = false;
    }

    async load() {
        if (this.loaded || this.loading) return;
        this.loading = true;

        try {
            const url = chrome.runtime.getURL('dictionary.csv');
            const response = await fetch(url);
            const text = await response.text();
            this.parse(text);
            this.loaded = true;
        } catch (e) {
            console.error('Failed to load dictionary:', e);
        } finally {
            this.loading = false;
        }
    }

    parse(csvText) {
        const lines = csvText.split('\n');
        this.dict = [];
        // Format: Tag, ColorCode, Popularity, Aliases, Translation

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parts = [];
            let current = '';
            let inQuote = false;

            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    parts.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current);

            if (parts.length < 1) continue;

            const tag = parts[0];
            const colorCode = parts[1] || '0';
            const popularity = parseInt(parts[2]) || 0;
            const aliases = parts[3] ? parts[3].split(',').map(a => a.trim()) : [];
            const translation = parts[4] || '';

            this.dict.push({
                text: tag,
                color: this.getColor(colorCode),
                pop: popularity,
                aliases: aliases,
                zh: translation,
                search: (tag + ' ' + aliases.join(' ') + ' ' + translation).toLowerCase()
            });
        }

        // Sort by popularity descending
        this.dict.sort((a, b) => b.pop - a.pop);
    }

    getColor(code) {
        const colorMap = {
            "0": "lightblue",
            "1": "indianred",
            "3": "violet",
            "4": "lightgreen",
            "5": "orange",
            "6": "red",
            "7": "lightblue",
            "8": "gold",
            "9": "gold",
            "10": "violet",
            "11": "lightgreen",
            "12": "tomato",
            "14": "whitesmoke",
            "15": "seagreen"
        };
        return colorMap[code] || 'lightblue';
    }

    search(query, limit = 50) {
        if (!query) return [];
        query = query.toLowerCase();

        const matches = [];
        let count = 0;

        for (let i = 0; i < this.dict.length; i++) {
            const item = this.dict[i];
            if (item.search.includes(query)) {
                matches.push(item);
                count++;
                if (count >= limit) break;
            }
        }

        return matches;
    }

    attach(inputElement, onSelect) {
        // Create dropdown if not exists
        if (!this.dropdown) {
            this.dropdown = document.createElement('ul');
            this.dropdown.className = 'autocomplete-dropdown';
            this.dropdown.style.display = 'none';
            document.body.appendChild(this.dropdown);
        }

        inputElement.addEventListener('input', () => {
            this.activeInput = inputElement;
            this.activeOnSelect = onSelect;

            const val = inputElement.value.trim();
            if (val.length < 1) {
                this.hide();
                return;
            }
            const matches = this.search(val);
            this.renderDropdown(matches);
        });

        inputElement.addEventListener('blur', () => {
            // Delay to allow click event
            setTimeout(() => this.hide(), 200);
        });

        inputElement.addEventListener('keydown', (e) => {
            if (this.dropdown && this.dropdown.style.display !== 'none' && this.activeInput === inputElement) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveSelection(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveSelection(-1);
                } else if (e.key === 'Enter') {
                    if (this.selectedIndex >= 0 && this.currentMatches[this.selectedIndex]) {
                        e.preventDefault();
                        this.select(this.currentMatches[this.selectedIndex]);
                    }
                } else if (e.key === 'Escape') {
                    this.hide();
                }
            }
        });
    }

    renderDropdown(matches) {
        this.currentMatches = matches;
        this.selectedIndex = -1;
        this.dropdown.innerHTML = '';

        if (matches.length === 0) {
            this.hide();
            return;
        }

        matches.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';

            const tagSpan = document.createElement('span');
            tagSpan.className = 'autocomplete-tag';
            tagSpan.textContent = item.text;
            tagSpan.style.color = item.color;

            const infoSpan = document.createElement('span');
            infoSpan.innerHTML = `<span class="autocomplete-trans">${item.zh}</span> <span class="autocomplete-count">(${this.formatCount(item.pop)})</span>`;

            li.appendChild(tagSpan);
            li.appendChild(infoSpan);

            li.addEventListener('click', () => {
                this.select(item);
            });

            li.addEventListener('mouseenter', () => {
                this.selectedIndex = index;
                this.updateSelection();
            });

            this.dropdown.appendChild(li);
        });

        if (this.activeInput) {
            const rect = this.activeInput.getBoundingClientRect();
            this.dropdown.style.left = rect.left + 'px';
            this.dropdown.style.top = (rect.bottom + window.scrollY) + 'px';
            this.dropdown.style.width = Math.max(rect.width, 300) + 'px';
            this.dropdown.style.display = 'block';
        }
    }

    moveSelection(delta) {
        if (!this.currentMatches) return;
        this.selectedIndex += delta;
        if (this.selectedIndex < 0) this.selectedIndex = this.currentMatches.length - 1;
        if (this.selectedIndex >= this.currentMatches.length) this.selectedIndex = 0;
        this.updateSelection();
    }

    updateSelection() {
        const items = this.dropdown.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
            if (index === this.selectedIndex) item.classList.add('selected');
            else item.classList.remove('selected');
        });
        if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
            items[this.selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    select(item) {
        if (this.activeOnSelect) {
            this.activeOnSelect(item.text);
        }
        this.hide();
    }

    hide() {
        if (this.dropdown) this.dropdown.style.display = 'none';
        this.selectedIndex = -1;
    }

    formatCount(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n + '';
    }
}
