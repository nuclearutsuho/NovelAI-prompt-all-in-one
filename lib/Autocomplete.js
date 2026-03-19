export default class Autocomplete {
  constructor(options = {}) {
    this.options = options;
    this.dict = [];
    this.wildcards = {};
    this.wildcardFolders = [];
    this.wildcardFolderList = [];
    this.favorites = [];
    this.exactDictMap = new Map();
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
      const data = await chrome.storage.local.get(["wildcards", "wildcardFolders"]);
      this.wildcards = data.wildcards || {};
      this.wildcardFolders = Array.isArray(data.wildcardFolders)
        ? data.wildcardFolders
        : [];
      this.rebuildWildcardFolderList(this.wildcardFolders, this.wildcards);
      const groupTagsDataUtils =
        typeof window !== "undefined" ? window.GroupTagsDataUtils || {} : {};

      if (groupTagsDataUtils.loadEffectiveDictionaryData) {
        const dictionaryData = await groupTagsDataUtils.loadEffectiveDictionaryData();
        this.dict = [];
        this.exactDictMap = new Map();

        for (const entry of dictionaryData.entries || []) {
          const canonicalText = groupTagsDataUtils.toCanonicalTagKey
            ? groupTagsDataUtils.toCanonicalTagKey(entry.tag)
            : String(entry.tag || "").trim().toLowerCase();
          if (!canonicalText) continue;

          const displayText = groupTagsDataUtils.canonicalToDisplayTag
            ? groupTagsDataUtils.canonicalToDisplayTag(canonicalText)
            : canonicalText.replace(/_/g, " ");
          const aliases = entry.aliases
            ? String(entry.aliases).split(",").map((a) => a.trim()).filter(Boolean)
            : [];
          const parsedItem = {
            text: canonicalText,
            displayText,
            color: this.getColor(String(entry.color || 0)),
            pop: entry.count || 0,
            aliases,
            zh: entry.zhCN || "",
            search: (
              canonicalText +
              " " +
              displayText +
              " " +
              aliases.join(" ") +
              " " +
              (entry.zhCN || "")
            ).toLowerCase(),
          };
          this.dict.push(parsedItem);
          if (!this.exactDictMap.has(canonicalText)) {
            this.exactDictMap.set(canonicalText, parsedItem);
          }
        }

        this.dict.sort((a, b) => b.pop - a.pop);
      } else {
        const url = chrome.runtime.getURL("data/dictionary.csv");
        const response = await fetch(url);
        const text = await response.text();
        this.parse(text);
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
        displayText: tag.replace(/_/g, " "),
        color: this.getColor(colorCode),
        pop: popularity,
        aliases: aliases,
        zh: translation,
        search: (
          tag +
          " " +
          tag.replace(/_/g, " ") +
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

  getWildcardParentPath(path) {
    const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    return lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : "";
  }

  getWildcardBaseName(path) {
    const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    return lastSlashIndex >= 0
      ? normalizedPath.slice(lastSlashIndex + 1)
      : normalizedPath;
  }

  rebuildWildcardFolderList(rawFolders = [], wildcardMap = {}) {
    const folderSet = new Set();

    (rawFolders || []).forEach((folder) => {
      const normalizedFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
      if (!normalizedFolder) return;
      folderSet.add(normalizedFolder);
    });

    Object.keys(wildcardMap || {}).forEach((key) => {
      const normalizedKey = String(key || "").replace(/^\/+|\/+$/g, "");
      if (!normalizedKey || !normalizedKey.includes("/")) return;

      const parts = normalizedKey.split("/");
      parts.pop();
      let currentPath = "";
      parts.forEach((part) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (currentPath) folderSet.add(currentPath);
      });
    });

    this.wildcardFolderList = Array.from(folderSet).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  scoreWildcardPathMatch(path, query, leafQuery = query) {
    const normalizedPath = String(path || "").toLowerCase();
    const baseName = this.getWildcardBaseName(normalizedPath);
    if (!query) return 1;

    let score = 0;
    if (baseName === leafQuery) score += 1200;
    else if (baseName.startsWith(leafQuery)) score += 900;
    else if (baseName.includes(leafQuery)) score += 650;

    if (normalizedPath === query) score += 500;
    else if (normalizedPath.startsWith(query)) score += 350;
    else if (normalizedPath.includes(query)) score += 220;

    score -= normalizedPath.length * 0.5;
    return score;
  }

  rankWildcardPaths(paths, query, { leafQuery = query, limit = 50 } = {}) {
    return (paths || [])
      .map((path) => ({
        path,
        score: this.scoreWildcardPathMatch(path, query, leafQuery),
      }))
      .filter((item) => !query || item.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, limit)
      .map((item) => item.path);
  }

  buildWildcardSection(title, entries) {
    const normalizedEntries = (entries || []).filter(Boolean);
    if (!normalizedEntries.length) return [];
    return [{ type: "header", text: title }].concat(normalizedEntries);
  }

  buildWildcardFolderItem(folderPath, prefix, num, displayText) {
    const normalizedFolder = String(folderPath || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedFolder) return null;

    return {
      type: "folder",
      text: displayText || `${normalizedFolder}/`,
      zh: "Folder",
      pop: 0,
      color: "#8ab4f8",
      path: normalizedFolder,
      insertText: `${prefix}${num}__${normalizedFolder}/`,
      isWildcard: true,
      isNavigational: true,
    };
  }

  buildWildcardParentFolderItem(currentFolder, prefix, num) {
    const normalizedCurrentFolder = String(currentFolder || "").replace(
      /^\/+|\/+$/g,
      "",
    );
    if (!normalizedCurrentFolder) return null;

    const parentFolder = this.getWildcardParentPath(normalizedCurrentFolder);
    const parentLabel = parentFolder
      ? `../ (${this.getWildcardBaseName(parentFolder)}/)`
      : "../ (root)";

    return {
      type: "folder",
      text: parentLabel,
      zh: "Up",
      pop: 0,
      color: "#c4b5fd",
      path: parentFolder,
      insertText: `${prefix}${num}__${parentFolder ? `${parentFolder}/` : ""}`,
      isWildcard: true,
      isNavigational: true,
      isParentFolder: true,
    };
  }

  buildWildcardFileItem(filePath, prefix, num, displayText) {
    const normalizedFile = String(filePath || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedFile) return null;

    return {
      type: "file",
      text: displayText || normalizedFile,
      zh: "Wildcard",
      pop: 0,
      color: prefix ? "#818cf8" : "#4caf50",
      path: normalizedFile,
      insertText: `${prefix}${num}__${normalizedFile}__`,
      isWildcard: true,
      rawKey: normalizedFile,
    };
  }

  buildWildcardTokenSuggestions(prefix, num, rawQuery, limit = 50) {
    const normalizedQuery = String(rawQuery || "").trim().toLowerCase();
    const fileKeys = Object.keys(this.wildcards || {});
    const folderPaths = this.wildcardFolderList || [];
    const maxFolderResults = Math.min(20, limit);
    const maxFileResults = Math.max(10, limit - maxFolderResults);

    if (!normalizedQuery) {
      const topFolders = folderPaths
        .filter((path) => !path.includes("/"))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, maxFolderResults)
        .map((path) =>
          this.buildWildcardFolderItem(
            path,
            prefix,
            num,
            `${this.getWildcardBaseName(path)}/`,
          ),
        );
      const rootFiles = fileKeys
        .filter((path) => !path.includes("/"))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, maxFileResults)
        .map((path) =>
          this.buildWildcardFileItem(
            path,
            prefix,
            num,
            this.getWildcardBaseName(path),
          ),
        );

      return this.buildWildcardSection("Folders", topFolders).concat(
        this.buildWildcardSection("Files", rootFiles),
      );
    }

    if (!normalizedQuery.includes("/")) {
      const matchedFolders = this.rankWildcardPaths(folderPaths, normalizedQuery, {
        leafQuery: normalizedQuery,
        limit: maxFolderResults,
      }).map((path) =>
        this.buildWildcardFolderItem(path, prefix, num, `${path}/`),
      );
      const matchedFiles = this.rankWildcardPaths(fileKeys, normalizedQuery, {
        leafQuery: normalizedQuery,
        limit: maxFileResults,
      }).map((path) => this.buildWildcardFileItem(path, prefix, num, path));

      return this.buildWildcardSection("Folders", matchedFolders).concat(
        this.buildWildcardSection("Files", matchedFiles),
      );
    }

    const lastSlashIndex = normalizedQuery.lastIndexOf("/");
    const currentFolder = normalizedQuery
      .slice(0, lastSlashIndex)
      .replace(/^\/+|\/+$/g, "");
    const leafQuery = normalizedQuery.slice(lastSlashIndex + 1);
    const folderPrefix = currentFolder ? `${currentFolder}/` : "";
    const parentFolderItem = this.buildWildcardParentFolderItem(
      currentFolder,
      prefix,
      num,
    );

    const directFolders = folderPaths.filter(
      (path) => this.getWildcardParentPath(path).toLowerCase() === currentFolder,
    );
    const directFiles = fileKeys.filter(
      (path) => this.getWildcardParentPath(path).toLowerCase() === currentFolder,
    );

    let folderResults = this.rankWildcardPaths(directFolders, leafQuery, {
      leafQuery,
      limit: maxFolderResults,
    }).map((path) =>
      this.buildWildcardFolderItem(
        path,
        prefix,
        num,
        `${this.getWildcardBaseName(path)}/`,
      ),
    );

    let fileResults = this.rankWildcardPaths(directFiles, leafQuery, {
      leafQuery,
      limit: maxFileResults,
    }).map((path) =>
      this.buildWildcardFileItem(
        path,
        prefix,
        num,
        this.getWildcardBaseName(path),
      ),
    );

    if (!folderResults.length && !fileResults.length) {
      const subtreeFolders = folderPaths
        .filter((path) => path.toLowerCase().startsWith(folderPrefix))
        .filter((path) => path.toLowerCase() !== currentFolder);
      const subtreeFiles = fileKeys.filter((path) =>
        path.toLowerCase().startsWith(folderPrefix),
      );

      folderResults = this.rankWildcardPaths(subtreeFolders, normalizedQuery, {
        leafQuery,
        limit: maxFolderResults,
      }).map((path) =>
        this.buildWildcardFolderItem(
          path,
          prefix,
          num,
          `${path.slice(folderPrefix.length)}/`,
        ),
      );

      fileResults = this.rankWildcardPaths(subtreeFiles, normalizedQuery, {
        leafQuery,
        limit: maxFileResults,
      }).map((path) =>
        this.buildWildcardFileItem(
          path,
          prefix,
          num,
          path.slice(folderPrefix.length),
        ),
      );
    }

    if (parentFolderItem) {
      folderResults = [parentFolderItem].concat(folderResults);
    }

    return this.buildWildcardSection("Folders", folderResults).concat(
      this.buildWildcardSection("Files", fileResults),
    );
  }

  isSelectableMatch(item) {
    return item && item.type !== "header";
  }

  findNextSelectableIndex(startIndex, delta) {
    if (!this.currentMatches || !this.currentMatches.length) return -1;
    let index = startIndex;

    for (let step = 0; step < this.currentMatches.length; step++) {
      index =
        (index + delta + this.currentMatches.length) % this.currentMatches.length;
      if (this.isSelectableMatch(this.currentMatches[index])) {
        return index;
      }
    }

    return -1;
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

      return this.buildWildcardTokenSuggestions(prefix, num, searchPart, limit);
    }

    const matches = [];
    const favMatches = [];
    let count = 0;

    for (let i = 0; i < this.dict.length; i++) {
      const item = this.dict[i];
      if (item.search.includes(queryLower)) {
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
        } else if (e.key === "Tab") {
          if (
            this.selectedIndex >= 0 &&
            this.currentMatches[this.selectedIndex]
          ) {
            e.preventDefault();
            this.select(this.currentMatches[this.selectedIndex]);
          }
        } else if (
          e.key === " " &&
          this.selectedIndex >= 0 &&
          this.currentMatches[this.selectedIndex]?.isWildcard
        ) {
          e.preventDefault();
          this.select(this.currentMatches[this.selectedIndex]);
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
    this.selectedIndex = this.findNextSelectableIndex(-1, 1);
    this.listEl.innerHTML = "";

    if (matches.length === 0) {
      this.hide();
      return;
    }

    matches.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";
      li.dataset.index = String(index);
      li.dataset.selectable = this.isSelectableMatch(item) ? "true" : "false";

      if (item.type === "header") {
        li.classList.add("autocomplete-section");
        li.textContent = item.text;
        this.listEl.appendChild(li);
        return;
      }

      if (item.type === "folder") li.classList.add("autocomplete-folder");
      if (item.type === "file") li.classList.add("autocomplete-file");
      if (item.isParentFolder) li.classList.add("autocomplete-parent-folder");

      const tagSpan = document.createElement("span");
      tagSpan.className = "autocomplete-tag";
      const displayText = item.displayText || item.text;
      tagSpan.innerHTML = `${item.isFav ? '<span class="fav-star">⭐</span> ' : ""}${displayText}`;
      tagSpan.style.color = item.color;

      const infoSpan = document.createElement("span");
      const infoParts = [];
      if (item.zh) {
        infoParts.push(`<span class="autocomplete-trans">${item.zh}</span>`);
      }
      if (typeof item.pop === "number" && item.pop > 0) {
        infoParts.push(
          `<span class="autocomplete-count">(${this.formatCount(item.pop)})</span>`,
        );
      }
      infoSpan.innerHTML = infoParts.join(" ");

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
    if (this.selectedIndex < 0) {
      this.selectedIndex = this.findNextSelectableIndex(-1, 1);
    } else {
      this.selectedIndex = this.findNextSelectableIndex(this.selectedIndex, delta);
    }
    this.updateSelection();
  }

  updateSelection() {
    const items = this.listEl.querySelectorAll(".autocomplete-item");
    items.forEach((item, index) => {
      if (
        item.dataset.selectable === "true" &&
        index === this.selectedIndex
      ) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
    if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({ block: "nearest" });
    }
  }

  select(item) {
    if (!item || !this.activeInput) {
      this.hide();
      return;
    }

    if (item.type === "folder" && item.insertText) {
      this.activeInput.value = item.insertText;
      this.activeInput.focus();
      this.activeInput.setSelectionRange(
        this.activeInput.value.length,
        this.activeInput.value.length,
      );
      this.activeInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    if (this.activeOnSelect) {
      // 自动补全插入时保持空格形式，内部命中仍然用 canonical key。
      this.activeOnSelect(item.insertText || item.displayText || item.text);
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
    const groupTagsDataUtils =
      typeof window !== "undefined" ? window.GroupTagsDataUtils || {} : {};

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
    const normalizedBaseTag = groupTagsDataUtils.toCanonicalTagKey
      ? groupTagsDataUtils.toCanonicalTagKey(baseTag)
      : baseTag.replace(/[\s_]+/g, "_");
    let match = this.exactDictMap.get(normalizedBaseTag);

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
      return {
        text: normalizedBaseTag,
        displayText: groupTagsDataUtils.canonicalToDisplayTag
          ? groupTagsDataUtils.canonicalToDisplayTag(normalizedBaseTag)
          : baseTag,
        zh: "",
        pop: 0,
        color: prefixColorMap[prefix]
      };
    }

    return null;
  }
}
