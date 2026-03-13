(function () {
  const DEFAULT_GROUP_COLOR = '#4a4a6a';
  const DICTIONARY_STORAGE_KEY = 'dictOverlay';
  const GROUP_TAGS_STORAGE_KEY = 'groupTagsUserData';
  let baseDictionaryPromise = null;

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function sanitizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sanitizeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : DEFAULT_GROUP_COLOR;
  }

  function sanitizeAliases(value) {
    if (Array.isArray(value)) {
      return value.map(item => sanitizeText(item)).filter(Boolean).join(', ');
    }
    return sanitizeText(value);
  }

  function isWildcardTag(value) {
    const text = sanitizeText(value);
    return /^(?:[sS]\d*__.*__|__.*__)$/.test(text);
  }

  function isStructuredTag(value) {
    const text = sanitizeText(value);
    if (!text) return false;
    return text === '\n' || text === '||' || text.startsWith('||') || /::/.test(text);
  }

  function isCanonicalizableTag(value) {
    const text = sanitizeText(value);
    if (!text) return false;
    return !isWildcardTag(text) && !isStructuredTag(text);
  }

  function toCanonicalTagKey(value) {
    const text = sanitizeText(value).toLowerCase();
    if (!text) return '';
    if (!isCanonicalizableTag(text)) {
      return text;
    }
    return text.replace(/[\s_]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function canonicalToDisplayTag(value) {
    const text = sanitizeText(value);
    if (!text) return '';
    if (!isCanonicalizableTag(text)) {
      return text;
    }
    return text.replace(/_/g, ' ');
  }

  function normalizeTagKey(value) {
    return toCanonicalTagKey(value);
  }

  function buildLegacyId(prefix, parts) {
    const slug = parts
      .map(part => sanitizeText(String(part || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_'))
      .map(part => part.replace(/^_+|_+$/g, ''))
      .filter(Boolean)
      .join('_');
    return `${prefix}_${slug || 'item'}`;
  }

  function createEmptyGroupTagsData() {
    return { categories: [] };
  }

  function createMergeSummary() {
    return {
      addedCategories: 0,
      addedGroups: 0,
      addedTags: 0,
      skippedCategories: 0,
      skippedGroups: 0,
      skippedTags: 0,
      skippedInvalid: 0
    };
  }

  function countSummarySkipped(summary) {
    return summary.skippedCategories + summary.skippedGroups + summary.skippedTags + summary.skippedInvalid;
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inQuotes) {
        if (char === '"') {
          if (line[index + 1] === '"') {
            current += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  function normalizeDictionaryEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    const tag = toCanonicalTagKey(rawEntry.tag);
    if (!tag) return null;
    return {
      tag,
      color: Number.isFinite(Number(rawEntry.color)) ? Number(rawEntry.color) : 0,
      count: Number.isFinite(Number(rawEntry.count)) ? Number(rawEntry.count) : 0,
      aliases: sanitizeAliases(rawEntry.aliases),
      zhCN: sanitizeText(rawEntry.zhCN)
    };
  }

  function parseDictionaryCsv(csvText) {
    return String(csvText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseCSVLine)
      .map(parts => ({
        tag: parts[0] || '',
        color: parseInt(parts[1], 10) || 0,
        count: parseInt(parts[2], 10) || 0,
        aliases: parts[3] || '',
        zhCN: parts[4] || ''
      }))
      .map(normalizeDictionaryEntry)
      .filter(Boolean);
  }

  async function loadBaseDictionaryEntries() {
    if (!baseDictionaryPromise) {
      baseDictionaryPromise = fetch(chrome.runtime.getURL('data/dictionary.csv'))
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load dictionary.csv: ${response.status}`);
          }
          return response.text();
        })
        .then(parseDictionaryCsv)
        .catch(err => {
          console.error('[GroupTagsDataUtils] Failed to load dictionary.csv:', err);
          return [];
        });
    }

    return cloneData(await baseDictionaryPromise);
  }

  function normalizeOverlayPayload(rawPayload) {
    const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const normalizedOverlay = {};
    const overlaySource = payload.overlay && typeof payload.overlay === 'object' ? payload.overlay : {};

    Object.entries(overlaySource).forEach(([rawKey, rawValue]) => {
      const key = toCanonicalTagKey(rawKey);
      if (!key || !rawValue || typeof rawValue !== 'object') return;

      const nextValue = {};
      if (rawValue._deleted) nextValue._deleted = true;
      if (rawValue._lastModified) nextValue._lastModified = rawValue._lastModified;
      if (rawValue.color !== undefined) nextValue.color = Number(rawValue.color) || 0;
      if (rawValue.count !== undefined) nextValue.count = Number(rawValue.count) || 0;
      if (rawValue.aliases !== undefined) nextValue.aliases = sanitizeAliases(rawValue.aliases);
      if (rawValue.zhCN !== undefined) nextValue.zhCN = sanitizeText(rawValue.zhCN);
      if (rawValue.tag !== undefined) nextValue.tag = toCanonicalTagKey(rawValue.tag) || key;
      normalizedOverlay[key] = nextValue;
    });

    const normalizedNewEntries = [];
    const seenNewEntryKeys = new Set();
    const rawEntries = Array.isArray(payload.newEntries) ? payload.newEntries : [];
    rawEntries.forEach(rawEntry => {
      const entry = normalizeDictionaryEntry(rawEntry);
      if (!entry) return;
      if (seenNewEntryKeys.has(entry.tag)) return;
      seenNewEntryKeys.add(entry.tag);
      normalizedNewEntries.push({
        ...entry,
        _new: true,
        _lastModified: rawEntry && rawEntry._lastModified ? rawEntry._lastModified : undefined
      });
    });

    return {
      overlay: normalizedOverlay,
      newEntries: normalizedNewEntries
    };
  }

  async function loadStoredDictionaryOverlay() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return { overlay: {}, newEntries: [] };
    }

    const stored = await chrome.storage.local.get(DICTIONARY_STORAGE_KEY);
    if (!stored[DICTIONARY_STORAGE_KEY]) {
      return { overlay: {}, newEntries: [] };
    }

    try {
      const parsed = JSON.parse(stored[DICTIONARY_STORAGE_KEY]);
      return normalizeOverlayPayload(parsed);
    } catch (err) {
      console.error('[GroupTagsDataUtils] Failed to parse dictOverlay:', err);
      return { overlay: {}, newEntries: [] };
    }
  }

  function buildEffectiveDictionaryData(baseEntries, overlayData) {
    const overlay = overlayData?.overlay || {};
    const newEntries = overlayData?.newEntries || [];
    const baseMap = new Map();
    const entryMap = new Map();
    const entries = [];

    baseEntries.forEach(rawEntry => {
      const entry = normalizeDictionaryEntry(rawEntry);
      if (!entry) return;
      baseMap.set(entry.tag, cloneData(entry));

      const override = overlay[entry.tag];
      if (override?._deleted) return;

      const merged = {
        ...entry,
        ...(override || {})
      };
      delete merged._deleted;
      entryMap.set(merged.tag, merged);
      entries.push(merged);
    });

    newEntries.forEach(rawEntry => {
      const entry = normalizeDictionaryEntry(rawEntry);
      if (!entry || entryMap.has(entry.tag)) return;
      entryMap.set(entry.tag, entry);
      entries.push(entry);
    });

    return {
      baseEntries: cloneData(baseEntries),
      baseMap,
      overlay: cloneData(overlay),
      newEntries: cloneData(newEntries),
      entries,
      entryMap
    };
  }

  async function loadEffectiveDictionaryData() {
    const [baseEntries, overlayData] = await Promise.all([
      loadBaseDictionaryEntries(),
      loadStoredDictionaryOverlay()
    ]);
    return buildEffectiveDictionaryData(baseEntries, overlayData);
  }

  async function saveDictionaryOverlayData(overlay, newEntries) {
    const normalized = normalizeOverlayPayload({ overlay, newEntries });
    await chrome.storage.local.set({
      [DICTIONARY_STORAGE_KEY]: JSON.stringify(normalized)
    });
    return normalized;
  }

  async function upsertDictionaryEntry(tagKey, patch = {}) {
    const canonicalTag = toCanonicalTagKey(tagKey);
    if (!canonicalTag) {
      return { tagKey: '', entry: null, data: await loadEffectiveDictionaryData() };
    }

    const [baseEntries, storedOverlay] = await Promise.all([
      loadBaseDictionaryEntries(),
      loadStoredDictionaryOverlay()
    ]);
    const baseMap = new Map(baseEntries.map(entry => [entry.tag, entry]));
    const overlay = cloneData(storedOverlay.overlay);
    const newEntries = cloneData(storedOverlay.newEntries);
    const nextPatch = {
      zhCN: patch.zhCN !== undefined ? sanitizeText(patch.zhCN) : undefined,
      color: patch.color !== undefined ? Number(patch.color) || 0 : undefined,
      count: patch.count !== undefined ? Number(patch.count) || 0 : undefined,
      aliases: patch.aliases !== undefined ? sanitizeAliases(patch.aliases) : undefined
    };
    const now = Date.now();

    if (baseMap.has(canonicalTag)) {
      const nextOverlay = {
        ...(overlay[canonicalTag] || {})
      };
      if (nextPatch.zhCN !== undefined) nextOverlay.zhCN = nextPatch.zhCN;
      if (nextPatch.color !== undefined) nextOverlay.color = nextPatch.color;
      if (nextPatch.count !== undefined) nextOverlay.count = nextPatch.count;
      if (nextPatch.aliases !== undefined) nextOverlay.aliases = nextPatch.aliases;
      delete nextOverlay._deleted;
      nextOverlay._lastModified = now;
      overlay[canonicalTag] = nextOverlay;
    } else {
      const existingIndex = newEntries.findIndex(entry => toCanonicalTagKey(entry.tag) === canonicalTag);
      const baseEntry = existingIndex >= 0 ? newEntries[existingIndex] : null;
      const nextEntry = {
        tag: canonicalTag,
        color: baseEntry ? Number(baseEntry.color) || 0 : 0,
        count: baseEntry ? Number(baseEntry.count) || 0 : 0,
        aliases: baseEntry ? sanitizeAliases(baseEntry.aliases) : '',
        zhCN: baseEntry ? sanitizeText(baseEntry.zhCN) : '',
        _new: true,
        _lastModified: now
      };
      if (nextPatch.zhCN !== undefined) nextEntry.zhCN = nextPatch.zhCN;
      if (nextPatch.color !== undefined) nextEntry.color = nextPatch.color;
      if (nextPatch.count !== undefined) nextEntry.count = nextPatch.count;
      if (nextPatch.aliases !== undefined) nextEntry.aliases = nextPatch.aliases;

      if (existingIndex >= 0) {
        newEntries[existingIndex] = nextEntry;
      } else {
        newEntries.push(nextEntry);
      }
    }

    await saveDictionaryOverlayData(overlay, newEntries);
    const data = buildEffectiveDictionaryData(baseEntries, { overlay, newEntries });
    return {
      tagKey: canonicalTag,
      entry: data.entryMap.get(canonicalTag) || null,
      data
    };
  }

  function normalizeGroupTagsData(rawData) {
    const result = createEmptyGroupTagsData();
    const summary = createMergeSummary();
    const categories = Array.isArray(rawData?.categories) ? rawData.categories : [];
    const seenCategoryIds = new Set();

    categories.forEach((rawCategory, categoryIndex) => {
      if (!rawCategory || typeof rawCategory !== 'object') {
        summary.skippedInvalid += 1;
        return;
      }

      const categoryName = sanitizeText(rawCategory.name) || `Category ${categoryIndex + 1}`;
      let categoryId = sanitizeText(rawCategory.id) || buildLegacyId('cat', [categoryIndex + 1, categoryName]);
      if (seenCategoryIds.has(categoryId)) {
        summary.skippedCategories += 1;
        categoryId = `${categoryId}_${categoryIndex + 1}`;
      }
      seenCategoryIds.add(categoryId);

      const normalizedCategory = {
        id: categoryId,
        name: categoryName,
        groups: []
      };

      const groups = Array.isArray(rawCategory.groups) ? rawCategory.groups : [];
      const seenGroupIds = new Set();
      groups.forEach((rawGroup, groupIndex) => {
        if (!rawGroup || typeof rawGroup !== 'object') {
          summary.skippedInvalid += 1;
          return;
        }

        const groupName = sanitizeText(rawGroup.name) || `Group ${groupIndex + 1}`;
        let groupId = sanitizeText(rawGroup.id) || buildLegacyId('grp', [categoryId, groupIndex + 1, groupName]);
        if (seenGroupIds.has(groupId)) {
          summary.skippedGroups += 1;
          groupId = `${groupId}_${groupIndex + 1}`;
        }
        seenGroupIds.add(groupId);

        const normalizedGroup = {
          id: groupId,
          name: groupName,
          color: sanitizeColor(rawGroup.color),
          tags: []
        };

        const tags = Array.isArray(rawGroup.tags) ? rawGroup.tags : [];
        const seenTagKeys = new Set();
        tags.forEach(rawTag => {
          let en = '';
          let zh = '';

          if (typeof rawTag === 'string') {
            en = toCanonicalTagKey(rawTag);
          } else if (rawTag && typeof rawTag === 'object') {
            en = toCanonicalTagKey(rawTag.en);
            zh = sanitizeText(rawTag.zh);
          } else {
            summary.skippedInvalid += 1;
            return;
          }

          const tagKey = normalizeTagKey(en);
          if (!tagKey) {
            summary.skippedInvalid += 1;
            return;
          }

          if (seenTagKeys.has(tagKey)) {
            summary.skippedTags += 1;
            return;
          }

          seenTagKeys.add(tagKey);
          normalizedGroup.tags.push({ en: tagKey, zh });
        });

        normalizedCategory.groups.push(normalizedGroup);
      });

      result.categories.push(normalizedCategory);
    });

    return { data: result, summary };
  }

  function mergeGroupTagsData(baseData, sourceData) {
    const target = cloneData(baseData);
    const summary = createMergeSummary();

    sourceData.categories.forEach(sourceCategory => {
      const targetCategory = target.categories.find(category => category.id === sourceCategory.id);
      if (!targetCategory) {
        target.categories.push(cloneData(sourceCategory));
        summary.addedCategories += 1;
        summary.addedGroups += sourceCategory.groups.length;
        summary.addedTags += sourceCategory.groups.reduce((count, group) => count + group.tags.length, 0);
        return;
      }

      summary.skippedCategories += 1;

      sourceCategory.groups.forEach(sourceGroup => {
        const targetGroup = targetCategory.groups.find(group => group.id === sourceGroup.id);
        if (!targetGroup) {
          targetCategory.groups.push(cloneData(sourceGroup));
          summary.addedGroups += 1;
          summary.addedTags += sourceGroup.tags.length;
          return;
        }

        summary.skippedGroups += 1;
        const existingTagKeys = new Set(targetGroup.tags.map(tag => normalizeTagKey(tag.en)));
        sourceGroup.tags.forEach(sourceTag => {
          const tagKey = normalizeTagKey(sourceTag.en);
          if (!tagKey || existingTagKeys.has(tagKey)) {
            summary.skippedTags += 1;
            return;
          }
          existingTagKeys.add(tagKey);
          targetGroup.tags.push(cloneData(sourceTag));
          summary.addedTags += 1;
        });
      });
    });

    return { data: target, summary };
  }

  function buildColorMap(groupTagsData) {
    const map = {};
    if (!groupTagsData?.categories) return map;
    groupTagsData.categories.forEach(category => {
      (category.groups || []).forEach(group => {
        const color = group.color || DEFAULT_GROUP_COLOR;
        (group.tags || []).forEach(tag => {
          const key = normalizeTagKey(tag.en);
          if (key) map[key] = color;
        });
      });
    });
    return map;
  }

  function buildTranslationMap(groupTagsData) {
    const map = {};
    if (!groupTagsData?.categories) return map;
    groupTagsData.categories.forEach(category => {
      (category.groups || []).forEach(group => {
        (group.tags || []).forEach(tag => {
          const key = normalizeTagKey(tag.en);
          if (key && tag.zh) map[key] = tag.zh;
        });
      });
    });
    return map;
  }

  function backfillGroupTagsTranslations(groupTagsData, dictionaryEntriesMap) {
    if (!groupTagsData?.categories) {
      return { data: createEmptyGroupTagsData(), changed: false, removedDuplicates: 0 };
    }

    const target = cloneData(groupTagsData);
    const seenTagKeys = new Set();
    let changed = false;
    let removedDuplicates = 0;

    target.categories.forEach(category => {
      (category.groups || []).forEach(group => {
        const nextTags = [];
        (group.tags || []).forEach(tag => {
          const key = toCanonicalTagKey(tag.en);
          if (!key) {
            changed = true;
            return;
          }
          if (seenTagKeys.has(key)) {
            removedDuplicates += 1;
            changed = true;
            return;
          }

          seenTagKeys.add(key);
          const nextTag = {
            ...tag,
            en: key
          };
          const dictEntry = dictionaryEntriesMap?.get(key);
          if (dictEntry && nextTag.zh !== dictEntry.zhCN) {
            nextTag.zh = dictEntry.zhCN || '';
            changed = true;
          }
          if (nextTag.en !== tag.en) {
            changed = true;
          }
          nextTags.push(nextTag);
        });
        group.tags = nextTags;
      });
    });

    return { data: target, changed, removedDuplicates };
  }

  function migrateGroupTagsData(rawData, options = {}) {
    const normalized = normalizeGroupTagsData(rawData).data;
    const backfilled = backfillGroupTagsTranslations(normalized, options.dictionaryEntriesMap);
    const migratedData = backfilled.data;
    const changed = JSON.stringify(rawData || createEmptyGroupTagsData()) !== JSON.stringify(migratedData);
    return {
      data: migratedData,
      changed,
      removedDuplicates: backfilled.removedDuplicates
    };
  }

  function resolveEffectiveGroupTagsData(defaultData, storedData) {
    const normalizedDefault = normalizeGroupTagsData(defaultData).data;
    if (!storedData?.categories) {
      return cloneData(normalizedDefault);
    }
    const normalizedStored = normalizeGroupTagsData(storedData).data;
    return mergeGroupTagsData(normalizedStored, normalizedDefault).data;
  }

  async function saveGroupTagsStorage(groupTagsData) {
    const normalized = normalizeGroupTagsData(groupTagsData).data;
    await chrome.storage.local.set({
      [GROUP_TAGS_STORAGE_KEY]: normalized,
      groupColorMap: buildColorMap(normalized),
      groupTranslationMap: buildTranslationMap(normalized)
    });
    return normalized;
  }

  async function migrateStoredGroupTagsData() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return { data: null, changed: false, removedDuplicates: 0 };
    }

    const stored = await chrome.storage.local.get(GROUP_TAGS_STORAGE_KEY);
    const currentData = stored[GROUP_TAGS_STORAGE_KEY];
    if (!currentData?.categories) {
      return { data: currentData || null, changed: false, removedDuplicates: 0 };
    }

    const dictionaryData = await loadEffectiveDictionaryData();
    const migrated = migrateGroupTagsData(currentData, {
      dictionaryEntriesMap: dictionaryData.entryMap
    });

    if (migrated.changed) {
      await saveGroupTagsStorage(migrated.data);
    }

    return migrated;
  }

  async function syncStoredGroupTagsTranslationsFromDictionary() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return { data: null, changed: false, removedDuplicates: 0 };
    }

    const stored = await chrome.storage.local.get(GROUP_TAGS_STORAGE_KEY);
    const currentData = stored[GROUP_TAGS_STORAGE_KEY];
    if (!currentData?.categories) {
      return { data: currentData || null, changed: false, removedDuplicates: 0 };
    }

    const dictionaryData = await loadEffectiveDictionaryData();
    const migrated = migrateGroupTagsData(currentData, {
      dictionaryEntriesMap: dictionaryData.entryMap
    });

    if (migrated.changed) {
      await saveGroupTagsStorage(migrated.data);
    } else {
      await chrome.storage.local.set({
        groupTranslationMap: buildTranslationMap(migrated.data),
        groupColorMap: buildColorMap(migrated.data)
      });
    }

    return migrated;
  }

  window.GroupTagsDataUtils = {
    cloneData,
    sanitizeText,
    sanitizeColor,
    sanitizeAliases,
    parseCSVLine,
    parseDictionaryCsv,
    isWildcardTag,
    isStructuredTag,
    isCanonicalizableTag,
    toCanonicalTagKey,
    canonicalToDisplayTag,
    normalizeTagKey,
    buildLegacyId,
    createEmptyGroupTagsData,
    createMergeSummary,
    countSummarySkipped,
    normalizeGroupTagsData,
    mergeGroupTagsData,
    buildColorMap,
    buildTranslationMap,
    loadBaseDictionaryEntries,
    loadStoredDictionaryOverlay,
    loadEffectiveDictionaryData,
    saveDictionaryOverlayData,
    upsertDictionaryEntry,
    backfillGroupTagsTranslations,
    migrateGroupTagsData,
    migrateStoredGroupTagsData,
    resolveEffectiveGroupTagsData,
    saveGroupTagsStorage,
    syncStoredGroupTagsTranslationsFromDictionary
  };
})();
