export default class Autocomplete {
  constructor(options = {}) {
    this.options = options;
    this.dict = [];
    this.wildcards = {};
    this.favorites = [];
    this.loaded = false;
    this.loading = false;
    this.loadFavorites();
  }

  async loadFavorites() {
    if (typeof chrome !== "undefined" && chrome.storage) {
      const data = await chrome.storage.local.get("favorites");
      this.favorites = data.favorites || [];
    }
  }

  async load() {
    if (this.loaded || this.loading) return;
    this.loading = true;

    try {
      const url = chrome.runtime.getURL("data/dictionary.csv");
      const response = await fetch(url);
      const text = await response.text();
      this.parse(text);

      // Load wildcards and dictOverlay from storage
      const data = await chrome.storage.local.get(["wildcards", "dictOverlay"]);
      this.wildcards = data.wildcards || {};

      // Apply dictionary modifications
      if (data.dictOverlay) {
        try {
          const parsed = JSON.parse(data.dictOverlay);
          const overlay = parsed.overlay || {};
          const newEntries = parsed.newEntries || [];

          // Apply overlays to existing dictionary
          if (Object.keys(overlay).length > 0) {
            for (let item of this.dict) {
              const mod = overlay[item.text];
              if (mod) {
                if (mod.zhCN !== undefined) item.zh = mod.zhCN;
                if (mod.color !== undefined)
                  item.color = this.getColor(mod.color.toString());
                if (mod.aliases !== undefined)
                  item.aliases = mod.aliases.split(",").map((a) => a.trim());
                // Update search term to match new translation/aliases
                item.search = (
                  item.text +
                  " " +
                  item.aliases.join(" ") +
                  " " +
                  item.zh
                ).toLowerCase();
              }
            }
          }

          // Add new user entries
          for (let entry of newEntries) {
            const parsedItem = {
              text: entry.tag,
              color: this.getColor((entry.color || 0).toString()),
              pop: entry.count || 0,
              aliases: entry.aliases
                ? entry.aliases.split(",").map((a) => a.trim())
                : [],
              zh: entry.zhCN || "",
              isCustom: true,
            };
            parsedItem.search = (
              parsedItem.text +
              " " +
              parsedItem.aliases.join(" ") +
              " " +
              parsedItem.zh
            ).toLowerCase();

            this.dict.push(parsedItem);
            const lowerTag = parsedItem.text.toLowerCase();
            if (!this.exactDictMap.has(lowerTag)) {
              this.exactDictMap.set(lowerTag, parsedItem);
            }
          }

          // Re-sort after adding new entries
          if (newEntries.length > 0) {
            this.dict.sort((a, b) => b.pop - a.pop);
          }
        } catch (e) {
          console.error("Failed to parse dictOverlay:", e);
        }
      }

      this.loaded = true;
    } catch (e) {
      console.error("Failed to load dictionary:", e);
    } finally {
      this.loading = false;
    }
  }

  parse(csvText) {
    const lines = csvText.split("\n");
    this.dict = [];
    this.exactDictMap = new Map(); // O(1) fast lookup map
    // Format: Tag, ColorCode, Popularity, Aliases, Translation

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = [];
      let current = "";
      let inQuote = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuote = !inQuote;
        } else if (char === "," && !inQuote) {
          parts.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      parts.push(current);

      if (parts.length < 1) continue;

      const tag = parts[0];
      const colorCode = parts[1] || "0";
      const popularity = parseInt(parts[2]) || 0;
      const aliases = parts[3] ? parts[3].split(",").map((a) => a.trim()) : [];
      const translation = parts[4] || "";

      const parsedItem = {
        text: tag,
        color: this.getColor(colorCode),
        pop: popularity,
        aliases: aliases,
        zh: translation,
        search: (
          tag +
          " " +
          aliases.join(" ") +
          " " +
          translation
        ).toLowerCase(),
      };
      this.dict.push(parsedItem);

      // Populate Fast Lookup Map (key is lowercase for case-insensitive lookup)
      const lowerTag = tag.toLowerCase();
      if (!this.exactDictMap.has(lowerTag)) {
        this.exactDictMap.set(lowerTag, parsedItem);
      }
    }

    // Sort by popularity descending
    this.dict.sort((a, b) => b.pop - a.pop);
  }

  getColor(code) {
    const colorMap = {
      0: "lightblue",
      1: "indianred",
      3: "violet",
      4: "lightgreen",
      5: "orange",
      6: "red",
      7: "lightblue",
      8: "gold",
      9: "gold",
      10: "violet",
      11: "lightgreen",
      12: "tomato",
      14: "whitesmoke",
      15: "seagreen",
    };
    return colorMap[code] || "lightblue";
  }

  search(query, limit = 50) {
    // If empty query, return favorites
    if (!query) {
      return this.favorites
        .map((fav) => {
          const info = this.getTagInfo(fav);
          return (
            info || {
              text: fav,
              zh: "",
              pop: 0,
              color: "lightblue",
              isFav: true,
            }
          );
        })
        .map((item) => ({ ...item, isFav: true }));
    }

    const queryLower = query.toLowerCase();

    // 1. Wildcard detection
    // Patterns: "__", "s__", "s10__"
    const wildcardMatch = queryLower.match(/^(s|S)?(\d+)?__(.*)$/);
    if (wildcardMatch) {
      const prefix = (wildcardMatch[1] || "").toLowerCase();
      const num = wildcardMatch[2] || "";
      const searchPart = wildcardMatch[3];
      const isSequential = !!prefix;

      const matches = [];
      const keys = Object.keys(this.wildcards);
      for (const key of keys) {
        if (key.toLowerCase().includes(searchPart)) {
          matches.push({
            text: `${isSequential ? prefix : ""}${num}__${key}__`,
            zh: "Wildcard", // Simple label
            pop: 0,
            color: isSequential ? "#818cf8" : "#4caf50", // Different colors for sequential (purple) vs random (green)
            isWildcard: true,
            rawKey: key,
          });
        }
      }
      return matches
        .sort((a, b) => a.text.length - b.text.length)
        .slice(0, limit);
    }

    const matches = [];
    const favMatches = [];
    let count = 0;

    for (let i = 0; i < this.dict.length; i++) {
      const item = this.dict[i];
      if (item.search.includes(query)) {
        const isFav = this.favorites.includes(item.text);
        if (isFav) {
          favMatches.push({ ...item, isFav: true });
        } else {
          matches.push({ ...item, isFav: false });
        }
        count++;
        if (count >= limit) break;
      }
    }

    return [...favMatches, ...matches];
  }

  attach(inputElement, onSelect) {
    // Create dropdown if not exists
    if (!this.dropdown) {
      this.dropdown = document.createElement("div");
      this.dropdown.className = "autocomplete-wrapper";
      this.dropdown.style.display = "none";
      // We'll add the list and a resizer inside
      this.listEl = document.createElement("ul");
      this.listEl.className = "autocomplete-dropdown";

      this.resizerEl = document.createElement("div");
      this.resizerEl.className = "autocomplete-resizer";
      this.resizerEl.title = "Drag to resize";

      this.dropdown.appendChild(this.listEl);
      this.dropdown.appendChild(this.resizerEl);
      document.body.appendChild(this.dropdown);

      this.initResizer();
    }

    inputElement.addEventListener("input", () => {
      this.activeInput = inputElement;
      this.activeOnSelect = onSelect;

      const val = inputElement.value.trim();
      const matches = this.search(val);
      this.renderDropdown(matches);
    });

    inputElement.addEventListener("focus", () => {
      this.activeInput = inputElement;
      this.activeOnSelect = onSelect;
      this.loadFavorites(); // Refresh favorites on focus

      const val = inputElement.value.trim();
      if (!val) {
        const matches = this.search("");
        if (matches.length > 0) {
          this.renderDropdown(matches);
        }
      }
    });

    inputElement.addEventListener("blur", () => {
      // Delay to allow click event
      setTimeout(() => this.hide(), 200);
    });

    inputElement.addEventListener("keydown", (e) => {
      if (
        this.dropdown &&
        this.dropdown.style.display !== "none" &&
        this.activeInput === inputElement
      ) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.moveSelection(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.moveSelection(-1);
        } else if (e.key === "Enter") {
          if (
            this.selectedIndex >= 0 &&
            this.currentMatches[this.selectedIndex]
          ) {
            e.preventDefault();
            this.select(this.currentMatches[this.selectedIndex]);
          }
        } else if (e.key === "Escape") {
          this.hide();
        }
      }
    });
  }

  initResizer() {
    let startY = 0;
    let startHeight = 0;

    // Load saved height
    chrome.storage.local.get(["autocompleteHeight"], (data) => {
      if (data.autocompleteHeight) {
        this.listEl.style.maxHeight = data.autocompleteHeight;
      }
    });

    const onMouseMove = (e) => {
      // Depending on if dropdown is above or below, dy calculation might be inverted
      // However, dragging downward conceptually increases the box.
      // We just use dy as movement of mouse relative to start
      const dy = e.clientY - startY;
      // Allow minimum 100px so it's usable
      let newHeight;
      if (this.isFlipped) {
        // Dragging Down shrinks it if flipped
        newHeight = Math.max(100, startHeight - dy);
      } else {
        newHeight = Math.max(100, startHeight + dy);
      }
      this.listEl.style.maxHeight = `${newHeight}px`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      chrome.storage.local.set({
        autocompleteHeight: this.listEl.style.maxHeight,
      });
    };

    this.resizerEl.addEventListener("mousedown", (e) => {
      e.preventDefault(); // Prevent blur on input
      startY = e.clientY;
      startHeight = this.listEl.getBoundingClientRect().height;
      document.body.style.cursor = "row-resize";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  renderDropdown(matches) {
    this.currentMatches = matches;
    this.selectedIndex = -1;
    this.listEl.innerHTML = "";

    if (matches.length === 0) {
      this.hide();
      return;
    }

    matches.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";

      const tagSpan = document.createElement("span");
      tagSpan.className = "autocomplete-tag";
      tagSpan.innerHTML = `${item.isFav ? '<span class="fav-star">⭐</span> ' : ""}${item.text}`;
      tagSpan.style.color = item.color;

      const infoSpan = document.createElement("span");
      infoSpan.innerHTML = `<span class="autocomplete-trans">${item.zh}</span> <span class="autocomplete-count">(${this.formatCount(item.pop)})</span>`;

      li.appendChild(tagSpan);
      li.appendChild(infoSpan);

      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // crucial to prevent input blur before registering selection
        this.select(item);
      });

      li.addEventListener("mouseenter", () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      this.listEl.appendChild(li);
    });

    if (this.activeInput) {
      this.dropdown.style.display = "flex"; // Use flex for layout
      const rect = this.activeInput.getBoundingClientRect();

      // Calculate available space
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      const dropdownHeight =
        this.dropdown.offsetHeight || Math.min(300, matches.length * 28 + 14); // estimation

      // Default position: below
      this.isFlipped = false;

      // If there's not enough space below, but enough above, flip it
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        this.isFlipped = true;
      }

      // 无论依附哪个输入框，都使宽度几乎铺满屏幕宽度，体验更佳
      this.dropdown.style.left = "8px";
      this.dropdown.style.width = "calc(100vw - 16px)";

      if (this.isFlipped) {
        // Place it ABOVE input. Let resizer be at the top or bottom?
        // We'll keep standard order: Resizer visually goes at bottom of dropdown?
        // Wait, if it's flipped, we want the dropdown to sit upwards.
        // It's usually better to use flex-direction: column-reverse so the resizer is at the top edge.
        this.dropdown.style.flexDirection = "column-reverse";
        this.dropdown.style.bottom = window.innerHeight - rect.top + "px";
        this.dropdown.style.top = "auto";
      } else {
        // Place it BELOW input.
        this.dropdown.style.flexDirection = "column";
        this.dropdown.style.top = rect.bottom + "px";
        this.dropdown.style.bottom = "auto";
      }
    }
  }

  moveSelection(delta) {
    if (!this.currentMatches) return;
    this.selectedIndex += delta;
    if (this.selectedIndex < 0)
      this.selectedIndex = this.currentMatches.length - 1;
    if (this.selectedIndex >= this.currentMatches.length)
      this.selectedIndex = 0;
    this.updateSelection();
  }

  updateSelection() {
    const items = this.listEl.querySelectorAll(".autocomplete-item");
    items.forEach((item, index) => {
      if (index === this.selectedIndex) item.classList.add("selected");
      else item.classList.remove("selected");
    });
    if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({ block: "nearest" });
    }
  }

  select(item) {
    if (this.activeOnSelect) {
      this.activeOnSelect(item.text);
    }
    this.hide();
  }

  hide() {
    if (this.dropdown) this.dropdown.style.display = "none";
    this.selectedIndex = -1;
  }

  formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n + "";
  }

  getTagInfo(text) {
    if (!this.loaded || !text) return null;
    let query = text.trim().toLowerCase();

    // 0. Strip weight suffix (e.g., tag:20)
    const weightSuffixMatch = query.match(/^(.*?)\s*:\s*\d+(\.\d+)?\s*$/);
    if (weightSuffixMatch) {
      query = weightSuffixMatch[1].trim();
    }

    // 0.1 Strip trailing comma (e.g., tag,) - common in dynamic syntax members
    if (query.endsWith(",")) {
      query = query.slice(0, -1).trim();
    }

    // 1. Check for category prefix (artist:, character:, copyright:, meta:, general:)
    const prefixMatch = query.match(
      /^(artist|character|copyright|meta|general):(.*)$/,
    );
    let prefix = null;
    let baseTag = query;

    if (prefixMatch) {
      prefix = prefixMatch[1];
      baseTag = prefixMatch[2].trim();
    }

    // Try exact match first (with potential prefix or without) using fast O(1) map
    let match = this.exactDictMap.get(baseTag);

    // If not found and baseTag has spaces, try replacing with underscores
    if (!match && baseTag.includes(" ")) {
      const queryUnder = baseTag.replace(/ /g, "_");
      match = this.exactDictMap.get(queryUnder);
    }

    if (match) {
      // Found info! Now, if we had a prefix, we should consider overriding the color
      // dictionary colors: 0-tag, 1-artist, 3-copyright, 4-character, 5-meta
      if (prefix) {
        const prefixColorMap = {
          artist: "indianred",
          character: "lightgreen",
          copyright: "violet",
          meta: "orange",
          general: "lightblue",
        };
        return { ...match, color: prefixColorMap[prefix] || match.color };
      }
      return match;
    }

    // If still not found but we have a prefix, return at least the color info
    if (prefix) {
      const prefixColorMap = {
        artist: "indianred",
        character: "lightgreen",
        copyright: "violet",
        meta: "orange",
        general: "lightblue",
      };
      return { text: baseTag, zh: "", pop: 0, color: prefixColorMap[prefix] };
    }

    return null;
  }
}
