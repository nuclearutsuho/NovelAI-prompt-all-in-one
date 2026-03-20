export default class Autocomplete {
  constructor(options = {}) {
    this.options = options;
    this.dict = [];
    this.wildcards = {};
    this.wildcardFolders = [];
    this.wildcardFolderList = [];
    this.wildcardUsageStats = {};
    this.wildcardPreviewState = null;
    this.favorites = [];
    this.exactDictMap = new Map();
    this.loaded = false;
    this.loading = false;
    this.wildcardUsageSaveTimer = null;
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
      const data = await chrome.storage.local.get([
        "wildcards",
        "wildcardFolders",
        "wildcardUsageStats",
      ]);
      this.wildcards = data.wildcards || {};
      this.wildcardFolders = Array.isArray(data.wildcardFolders)
        ? data.wildcardFolders
        : [];
      this.wildcardUsageStats = this.normalizeWildcardUsageStats(
        data.wildcardUsageStats,
      );
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

  normalizeWildcardUsagePath(path) {
    return String(path || "").trim().replace(/^\/+|\/+$/g, "");
  }

  normalizeWildcardUsageStats(rawStats = {}) {
    const normalizedStats = {};

    Object.entries(rawStats || {}).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;

      const count = Number(value.count);
      const lastUsedAt = Number(value.lastUsedAt);
      normalizedStats[key] = {
        count: Number.isFinite(count) && count > 0 ? count : 0,
        lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : 0,
      };
    });

    return normalizedStats;
  }

  getWildcardUsageKey(kind, path) {
    const normalizedPath = this.normalizeWildcardUsagePath(path);
    return normalizedPath ? `${kind}:${normalizedPath}` : "";
  }

  getWildcardUsageEntry(kind, path) {
    const key = this.getWildcardUsageKey(kind, path);
    if (!key) return null;
    return this.wildcardUsageStats[key] || null;
  }

  getWildcardUsageBoost(kind, path, query = "") {
    const entry = this.getWildcardUsageEntry(kind, path);
    if (!entry) return 0;

    const count = Math.max(0, Number(entry.count) || 0);
    const lastUsedAt = Math.max(0, Number(entry.lastUsedAt) || 0);
    const now = Date.now();
    const ageDays = lastUsedAt
      ? Math.max(0, (now - lastUsedAt) / 86400000)
      : Number.POSITIVE_INFINITY;
    const queryWeight = query ? 1 : 1.85;
    const countBoost = Math.log2(count + 1) * 70 * queryWeight;
    const recencyBoost = Math.max(0, 1 - ageDays / 14) * 65 * queryWeight;

    return countBoost + recencyBoost;
  }

  rankItemsByUsage(paths, kind, limit = 50) {
    return (paths || [])
      .slice()
      .sort((a, b) => {
        const scoreDiff =
          this.getWildcardUsageBoost(kind, b, "") -
          this.getWildcardUsageBoost(kind, a, "");
        if (scoreDiff !== 0) return scoreDiff;
        return a.localeCompare(b);
      })
      .slice(0, limit);
  }

  scheduleWildcardUsageStatsSave() {
    if (this.wildcardUsageSaveTimer) {
      clearTimeout(this.wildcardUsageSaveTimer);
    }

    this.wildcardUsageSaveTimer = setTimeout(() => {
      this.wildcardUsageSaveTimer = null;
      chrome.storage.local.set({
        wildcardUsageStats: this.wildcardUsageStats,
      });
    }, 120);
  }

  recordWildcardUsage(kind, path, delta = 1) {
    const normalizedPath = this.normalizeWildcardUsagePath(path);
    if (!normalizedPath) return;

    const key = this.getWildcardUsageKey(kind, normalizedPath);
    const previous = this.wildcardUsageStats[key] || { count: 0, lastUsedAt: 0 };
    this.wildcardUsageStats = {
      ...this.wildcardUsageStats,
      [key]: {
        count: Math.max(0, (Number(previous.count) || 0) + delta),
        lastUsedAt: Date.now(),
      },
    };
  }

  recordWildcardSelection(item) {
    if (!item) return;

    if (item.type === "folder") {
      this.recordWildcardUsage("folder", item.path, 1);
      this.scheduleWildcardUsageStatsSave();
      return;
    }

    if (item.type === "file") {
      this.recordWildcardUsage("file", item.path, 1);

      let parentPath = this.getWildcardParentPath(item.path);
      let folderBoost = 0.6;
      while (parentPath) {
        this.recordWildcardUsage("folder", parentPath, folderBoost);
        parentPath = this.getWildcardParentPath(parentPath);
        folderBoost = Math.max(0.2, folderBoost - 0.15);
      }

      this.scheduleWildcardUsageStatsSave();
    }
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

  rankWildcardPaths(
    paths,
    query,
    { leafQuery = query, limit = 50, kind = "file" } = {},
  ) {
    return (paths || [])
      .map((path) => ({
        path,
        score:
          this.scoreWildcardPathMatch(path, query, leafQuery) +
          this.getWildcardUsageBoost(kind, path, query),
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

  buildWildcardPreviewBackItem(filePath = "") {
    return {
      type: "back",
      text: "\u2190 Back",
      zh: filePath || "Return",
      color: "#c4b5fd",
      filePath,
    };
  }

  getWildcardFileEntryCount(filePath) {
    const normalizedFile = String(filePath || "").replace(/^\/+|\/+$/g, "");
    const content = this.wildcards?.[normalizedFile];
    if (!content) return 0;

    return String(content)
      .split(/\r?\n/)
      .filter((line) => String(line).trim())
      .length;
  }

  buildWildcardFileItem(filePath, prefix, num, displayText) {
    const normalizedFile = String(filePath || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedFile) return null;
    const wildcardEntryCount = this.getWildcardFileEntryCount(normalizedFile);

    return {
      type: "file",
      text: displayText || normalizedFile,
      zh: "Wildcard",
      pop: 0,
      color: prefix ? "#818cf8" : "#4caf50",
      path: normalizedFile,
      insertText: `${prefix}${num}__${normalizedFile}__`,
      wildcardEntryCount,
      isWildcard: true,
      rawKey: normalizedFile,
    };
  }

  buildWildcardValuePreviewItems(filePath, limit = 100) {
    const normalizedFile = String(filePath || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedFile) return [];

    const lines = String(this.wildcards?.[normalizedFile] || "")
      .split(/\r?\n/)
      .map((line) => String(line).trim())
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => ({
        type: "value",
        text: line,
        displayText: line,
        color: "#e5e7eb",
      }));

    return [this.buildWildcardPreviewBackItem(normalizedFile)]
      .concat(this.buildWildcardSection(`Preview: ${normalizedFile}`, lines));
  }

  buildWildcardTokenSuggestions(prefix, num, rawQuery, limit = 50) {
    const normalizedQuery = String(rawQuery || "").trim().toLowerCase();
    const fileKeys = Object.keys(this.wildcards || {});
    const folderPaths = this.wildcardFolderList || [];
    const maxFolderResults = Math.min(20, limit);
    const maxFileResults = Math.max(10, limit - maxFolderResults);

    if (!normalizedQuery) {
      const topFolders = this.rankItemsByUsage(
        folderPaths.filter((path) => !path.includes("/")),
        "folder",
        maxFolderResults,
      )
        .map((path) =>
          this.buildWildcardFolderItem(
            path,
            prefix,
            num,
            `${this.getWildcardBaseName(path)}/`,
          ),
        );
      const rootFiles = this.rankItemsByUsage(
        fileKeys.filter((path) => !path.includes("/")),
        "file",
        maxFileResults,
      )
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
        kind: "folder",
        limit: maxFolderResults,
      }).map((path) =>
        this.buildWildcardFolderItem(path, prefix, num, `${path}/`),
      );
      const matchedFiles = this.rankWildcardPaths(fileKeys, normalizedQuery, {
        leafQuery: normalizedQuery,
        kind: "file",
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
      kind: "folder",
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
      kind: "file",
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
        kind: "folder",
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
        kind: "file",
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

  getSelectedMatch() {
    if (
      this.selectedIndex >= 0 &&
      this.currentMatches &&
      this.currentMatches[this.selectedIndex]
    ) {
      return this.currentMatches[this.selectedIndex];
    }

    const firstSelectableIndex = this.findNextSelectableIndex(-1, 1);
    return firstSelectableIndex >= 0 && this.currentMatches
      ? this.currentMatches[firstSelectableIndex]
      : null;
  }

  isWildcardAutocompleteActive() {
    return Array.isArray(this.currentMatches)
      && this.currentMatches.some((item) =>
        ["folder", "file", "value", "back"].includes(item?.type),
      );
  }

  clearHideTimer() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  scheduleHide(delay = 200) {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, delay);
  }

  openWildcardPreview(item) {
    if (!item || item.type !== "file" || !item.path) return;
    this.wildcardPreviewState = { filePath: item.path };
    this.renderDropdown(this.buildWildcardValuePreviewItems(item.path));
  }

  closeWildcardPreview() {
    if (!this.wildcardPreviewState) return false;
    this.wildcardPreviewState = null;
    if (this.activeInput) {
      const matches = this.search(this.activeInput.value.trim());
      this.renderDropdown(matches);
    } else {
      this.hide();
    }
    return true;
  }

  navigateWildcardParent() {
    if (!this.activeInput) return false;
    const wildcardMatch = this.activeInput.value
      .trim()
      .match(/^(s|S)?(\d+)?__(.*)$/);
    if (!wildcardMatch) return false;

    const prefix = (wildcardMatch[1] || "").toLowerCase();
    const num = wildcardMatch[2] || "";
    const normalizedPath = String(wildcardMatch[3] || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) return false;

    const parentPath = this.getWildcardParentPath(normalizedPath);
    this.wildcardPreviewState = null;
    this.activeInput.value = `${prefix}${num}__${parentPath ? `${parentPath}/` : ""}`;
    this.activeInput.focus();
    this.activeInput.setSelectionRange(
      this.activeInput.value.length,
      this.activeInput.value.length,
    );
    this.activeInput.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
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

      this.dropdown.addEventListener("mousedown", () => {
        this.clearHideTimer();
      });

      this.initResizer();
    }

    inputElement.addEventListener("input", () => {
      this.clearHideTimer();
      this.wildcardPreviewState = null;
      this.activeInput = inputElement;
      this.activeOnSelect = onSelect;

      const val = inputElement.value.trim();
      const matches = this.search(val);
      this.renderDropdown(matches);
    });

    inputElement.addEventListener("focus", () => {
      this.clearHideTimer();
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
      this.scheduleHide(200);
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
        } else if (e.key === "ArrowRight") {
          if (this.isWildcardAutocompleteActive()) {
            e.preventDefault();
            const item = this.getSelectedMatch();
            if (item?.type === "folder") {
              this.select(item);
            } else if (item?.type === "file") {
              this.openWildcardPreview(item);
            }
          }
        } else if (e.key === "ArrowLeft") {
          if (this.isWildcardAutocompleteActive()) {
            e.preventDefault();
            if (this.wildcardPreviewState) {
              this.closeWildcardPreview();
            } else {
              this.navigateWildcardParent();
            }
          }
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
        } else if (e.key === "Escape") {
          if (this.wildcardPreviewState) {
            this.closeWildcardPreview();
          } else {
            this.hide();
          }
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
    this.clearHideTimer();
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

      if (item.type === "back") li.classList.add("autocomplete-back");
      if (item.type === "folder") li.classList.add("autocomplete-folder");
      if (item.type === "file") li.classList.add("autocomplete-file");
      if (item.isParentFolder) li.classList.add("autocomplete-parent-folder");

      const tagSpan = document.createElement("span");
      tagSpan.className = "autocomplete-tag";
      const displayText = item.displayText || item.text;
      tagSpan.innerHTML = `${item.isFav ? '<span class="fav-star">⭐</span> ' : ""}${displayText}`;
      tagSpan.style.color = item.color;

      // 【新增功能】：创建统一的全局外部链接入口，点击后弹出菜单
      if (!item.type && !item.isWildcard) {
        const linkBtn = document.createElement("span");
        // 改为使用行内 SVG 绘制精美的线性信息圆圈图标（Info Circle）
        // SVG 可以完美兼容所有浏览器，且不会有 emoji 在不同设备上发色和渲染不同的问题
        linkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
        linkBtn.title = "在外部图库或 Wiki 中查看此标签";
        linkBtn.style.cursor = "pointer";
        linkBtn.style.marginRight = "6px";
        linkBtn.style.opacity = "0.4";     // 进一步降低平时透明度
        linkBtn.style.color = "#a5b4fc";   // 设置浅紫色调以匹配深色主题和星标
        linkBtn.style.transition = "all 0.2s"; // 改为 all，以支持接下来的缩放动画
        linkBtn.style.userSelect = "none";
        linkBtn.style.display = "inline-flex"; 
        linkBtn.style.alignItems = "center";
        
        // 增加 Hover 时放大的动态精致感
        linkBtn.addEventListener("mouseenter", () => {
            linkBtn.style.opacity = "1";
            linkBtn.style.transform = "scale(1.15)";
        });
        linkBtn.addEventListener("mouseleave", () => {
            linkBtn.style.opacity = "0.4";
            linkBtn.style.transform = "scale(1)";
        });
        
        linkBtn.addEventListener("mousedown", (e) => {
          e.preventDefault(); 
          e.stopPropagation(); // 阻止整个补全框消失或选中 tag
          
          // 如果当前屏幕上已经有打开的菜单了，先移除它
          const existingMenu = document.getElementById("autocomplete-link-menu");
          if (existingMenu) existingMenu.remove();

          // 动态创建一个菜单容器（Context Menu）
          const menu = document.createElement("div");
          menu.id = "autocomplete-link-menu";
          menu.style.position = "fixed"; // 使用 fixed 脱离整个滚动区域，防止被裁切
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY + 15}px`; // 稍微靠下一点显示，不挡住鼠标
          menu.style.background = "#2a2a3e";
          menu.style.border = "1px solid #4a4a6a";
          menu.style.borderRadius = "6px";
          menu.style.padding = "4px";
          menu.style.zIndex = "100000"; // 确保覆盖在所有元素甚至补全列表之上
          menu.style.display = "flex";
          menu.style.flexDirection = "column";
          menu.style.gap = "2px";
          menu.style.boxShadow = "0 8px 16px rgba(0,0,0,0.6)";

          // 菜单选项工厂函数
          const addOption = (text, formatter, hoverColor) => {
             const opt = document.createElement("div");
             opt.textContent = text;
             opt.style.padding = "6px 12px";
             opt.style.cursor = "pointer";
             opt.style.color = "#eee";
             opt.style.fontSize = "12px";
             opt.style.fontWeight = "bold";
             opt.style.borderRadius = "4px";
             opt.style.transition = "background 0.2s, color 0.2s";
             opt.style.userSelect = "none";
             
             opt.addEventListener("mouseenter", () => {
                 opt.style.background = "rgba(255, 255, 255, 0.1)";
                 opt.style.color = hoverColor;
             });
             opt.addEventListener("mouseleave", () => {
                 opt.style.background = "transparent";
                 opt.style.color = "#eee";
             });
             
             opt.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                window.open(formatter(encodeURIComponent(item.text)), "_blank");
                menu.remove();
             });
             menu.appendChild(opt);
          };

          // 添加具体选项，带有平台对应的色彩反馈
          addOption("📖 Danbooru Wiki", (tag) => `https://danbooru.donmai.us/wiki_pages/${tag}`, "#a78bfa");
          addOption("🎨 Danbooru 图库", (tag) => `https://danbooru.donmai.us/posts?tags=${tag}`, "#4ADE80");
          addOption("🎨 Gelbooru 图库", (tag) => `https://gelbooru.com/index.php?page=post&s=list&tags=${tag}`, "#38bdf8");

          document.body.appendChild(menu);

          // 监听全局鼠标悬停与点击事件，当光标移走或点击外侧时自动销毁菜单
          const closeMenu = (ev) => {
             if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener("mousedown", closeMenu);
             }
          };
          // 延迟挂载全局监听，防止被本次菜单刚弹出的 mousedown 立刻清除
          setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
        });

        tagSpan.prepend(linkBtn);
      }

      const infoSpan = document.createElement("span");
      if (typeof item.wildcardEntryCount === "number") {
        const countSpan = document.createElement("span");
        countSpan.className = "autocomplete-count autocomplete-count-button";
        countSpan.textContent = `${this.formatCount(item.wildcardEntryCount)} items`;
        countSpan.title = "Preview wildcard entries";
        if (item.type === "file") {
          countSpan.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openWildcardPreview(item);
          });
        }
        infoSpan.appendChild(countSpan);
      } else if (typeof item.pop === "number" && item.pop > 0) {
        const countSpan = document.createElement("span");
        countSpan.className = "autocomplete-count";
        countSpan.textContent = `(${this.formatCount(item.pop)})`;
        infoSpan.appendChild(countSpan);
      }
      if (item.zh) {
        const transSpan = document.createElement("span");
        transSpan.className = "autocomplete-trans";
        transSpan.textContent = item.zh;
        infoSpan.appendChild(transSpan);
      }

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
    this.clearHideTimer();
    if (!item || !this.activeInput) {
      this.hide();
      return;
    }

    if (item.type === "back") {
      this.closeWildcardPreview();
      return;
    }

    if (item.type === "folder" || item.type === "file") {
      this.recordWildcardSelection(item);
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
    this.clearHideTimer();
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
