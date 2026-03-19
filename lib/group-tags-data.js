(function () {
  const DEFAULT_GROUP_COLOR = '#4a4a6a';
  const DICTIONARY_STORAGE_KEY = 'dictOverlay';
  const GROUP_TAGS_STORAGE_KEY = 'groupTagsUserData';
  const DELETED_DEFAULT_CATEGORY_IDS_KEY = '_deletedDefaultCategoryIds';
  const DELETED_DEFAULT_GROUP_KEYS_KEY = '_deletedDefaultGroupKeys';
  const GROUP_ITEM_TYPE_TAG = 'tag';
  const GROUP_ITEM_TYPE_SENTENCE = 'sentence';
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

  function normalizeGroupItemType(value) {
    return value === GROUP_ITEM_TYPE_SENTENCE ? GROUP_ITEM_TYPE_SENTENCE : GROUP_ITEM_TYPE_TAG;
  }

  function isSentenceGroupItem(value) {
    return normalizeGroupItemType(value?.type) === GROUP_ITEM_TYPE_SENTENCE;
  }

  function isTagGroupItem(value) {
    return !isSentenceGroupItem(value);
  }

  function buildSentenceItemKey(value) {
    const en = sanitizeText(value?.en);
    const zh = sanitizeText(value?.zh);
    if (!en || !zh) return '';
    return `${en}\u0000${zh}`;
  }

  function getGroupItemPromptText(value) {
    if (isSentenceGroupItem(value)) {
      return sanitizeText(value?.en);
    }
    return sanitizeText(value?.en);
  }

  function getGroupItemTranslationText(value) {
    if (isSentenceGroupItem(value)) {
      return sanitizeText(value?.zh);
    }
    return sanitizeText(value?.zh);
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
    return {
      categories: [],
      [DELETED_DEFAULT_CATEGORY_IDS_KEY]: [],
      [DELETED_DEFAULT_GROUP_KEYS_KEY]: []
    };
  }

  function sanitizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(item => sanitizeText(item)).filter(Boolean)));
  }

  function buildDefaultGroupKey(categoryId, groupId) {
    const normalizedCategoryId = sanitizeText(categoryId);
    const normalizedGroupId = sanitizeText(groupId);
    if (!normalizedCategoryId || !normalizedGroupId) return '';
    return `${normalizedCategoryId}::${normalizedGroupId}`;
  }

  function getDeletedDefaultCategoryIds(groupTagsData) {
    return sanitizeStringList(groupTagsData?.[DELETED_DEFAULT_CATEGORY_IDS_KEY]);
  }

  function getDeletedDefaultGroupKeys(groupTagsData) {
    return sanitizeStringList(groupTagsData?.[DELETED_DEFAULT_GROUP_KEYS_KEY]);
  }

  function markDefaultCategoryDeleted(groupTagsData, categoryId) {
    const normalizedCategoryId = sanitizeText(categoryId);
    const nextData = cloneData(groupTagsData || createEmptyGroupTagsData());
    if (!normalizedCategoryId) return nextData;

    const deletedCategoryIds = new Set(getDeletedDefaultCategoryIds(nextData));
    deletedCategoryIds.add(normalizedCategoryId);
    nextData[DELETED_DEFAULT_CATEGORY_IDS_KEY] = Array.from(deletedCategoryIds);

    const deletedGroupKeys = new Set(getDeletedDefaultGroupKeys(nextData));
    const categories = Array.isArray(nextData.categories) ? nextData.categories : [];
    const targetCategory = categories.find(category => sanitizeText(category?.id) === normalizedCategoryId);
    if (targetCategory?.groups?.length) {
      targetCategory.groups.forEach(group => {
        const groupKey = buildDefaultGroupKey(normalizedCategoryId, group?.id);
        if (groupKey) deletedGroupKeys.add(groupKey);
      });
    }
    nextData[DELETED_DEFAULT_GROUP_KEYS_KEY] = Array.from(deletedGroupKeys);
    return nextData;
  }

  function markDefaultGroupDeleted(groupTagsData, categoryId, groupId) {
    const groupKey = buildDefaultGroupKey(categoryId, groupId);
    const nextData = cloneData(groupTagsData || createEmptyGroupTagsData());
    if (!groupKey) return nextData;

    const deletedGroupKeys = new Set(getDeletedDefaultGroupKeys(nextData));
    deletedGroupKeys.add(groupKey);
    nextData[DELETED_DEFAULT_GROUP_KEYS_KEY] = Array.from(deletedGroupKeys);
    return nextData;
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

    return await baseDictionaryPromise;
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

    baseEntries.forEach(entry => {
      // 基础字典在 parseDictionaryCsv 时已经 normalize 过，无需重复调用（避免被执行15万次正则消耗CPU）
      if (!entry || !entry.tag) return;
      baseMap.set(entry.tag, entry); // 直接存复用的引用，不再 deep copy

      const override = overlay[entry.tag];
      if (override?._deleted) return;

      if (!override) {
        // 无自定义覆盖，完全复用原始字典内存以极速装载
        entryMap.set(entry.tag, entry);
        entries.push(entry);
      } else {
        // 当发生自定义编辑时（由于这里通过对象展开实现了浅拷贝重分配结构，这保证了最底层的入口数据永不被污染）
        const merged = {
          ...entry,
          ...override
        };
        delete merged._deleted;
        entryMap.set(merged.tag, merged);
        entries.push(merged);
      }
    });

    newEntries.forEach(rawEntry => {
      const entry = normalizeDictionaryEntry(rawEntry);
      if (!entry || entryMap.has(entry.tag)) return;
      entryMap.set(entry.tag, entry);
      entries.push(entry);
    });

    return {
      baseEntries: baseEntries, // 重大优化：直接使用引用
      baseMap,
      overlay: overlay,
      newEntries: newEntries,
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

    let hasChanges = false;
    
    // 基础字典比对辅助函数
    const checkFieldChange = (oldVal, newVal, defaultValue = '') => {
      const o = oldVal !== undefined ? oldVal : defaultValue;
      const n = newVal !== undefined ? newVal : defaultValue;
      return o !== n;
    };

    if (baseMap.has(canonicalTag)) {
      const baseEntry = baseMap.get(canonicalTag);
      const existingOverlay = overlay[canonicalTag] || {};
      
      const nextOverlay = { ...existingOverlay };
      
      if (nextPatch.zhCN !== undefined && checkFieldChange(baseEntry.zhCN, nextPatch.zhCN)) {
        nextOverlay.zhCN = nextPatch.zhCN;
        hasChanges = true;
      }
      if (nextPatch.color !== undefined && checkFieldChange(baseEntry.color, nextPatch.color, 0)) {
        nextOverlay.color = nextPatch.color;
        hasChanges = true;
      }
      if (nextPatch.count !== undefined && checkFieldChange(baseEntry.count, nextPatch.count, 0)) {
        nextOverlay.count = nextPatch.count;
        hasChanges = true;
      }
      if (nextPatch.aliases !== undefined && checkFieldChange(baseEntry.aliases, nextPatch.aliases)) {
        nextOverlay.aliases = nextPatch.aliases;
        hasChanges = true;
      }

      // 如果没有任何字段真的变了，而且以前 overlay 里的东西并没有被删除，就跳过写入
      if (hasChanges || nextOverlay._deleted) {
        delete nextOverlay._deleted;
        nextOverlay._lastModified = now;
        overlay[canonicalTag] = nextOverlay;
      }
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
        _lastModified: baseEntry?._lastModified || now
      };

      if (nextPatch.zhCN !== undefined && checkFieldChange(baseEntry?.zhCN, nextPatch.zhCN)) {
        nextEntry.zhCN = nextPatch.zhCN;
        hasChanges = true;
      }
      if (nextPatch.color !== undefined && checkFieldChange(baseEntry?.color, nextPatch.color, 0)) {
        nextEntry.color = nextPatch.color;
        hasChanges = true;
      }
      if (nextPatch.count !== undefined && checkFieldChange(baseEntry?.count, nextPatch.count, 0)) {
        nextEntry.count = nextPatch.count;
        hasChanges = true;
      }
      if (nextPatch.aliases !== undefined && checkFieldChange(baseEntry?.aliases, nextPatch.aliases)) {
        nextEntry.aliases = nextPatch.aliases;
        hasChanges = true;
      }

      if (hasChanges || !baseEntry) {
         nextEntry._lastModified = now;
         if (existingIndex >= 0) {
           newEntries[existingIndex] = nextEntry;
         } else {
           newEntries.push(nextEntry);
         }
      }
    }

    if (hasChanges || !baseMap.has(canonicalTag)) {
       await saveDictionaryOverlayData(overlay, newEntries);
    }

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

    result[DELETED_DEFAULT_CATEGORY_IDS_KEY] = getDeletedDefaultCategoryIds(rawData);
    result[DELETED_DEFAULT_GROUP_KEYS_KEY] = getDeletedDefaultGroupKeys(rawData);

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
        const seenSentenceKeys = new Set();
        tags.forEach(rawTag => {
          if (typeof rawTag === 'string') {
            const en = toCanonicalTagKey(rawTag);
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
            normalizedGroup.tags.push({ type: GROUP_ITEM_TYPE_TAG, en: tagKey, zh: '' });
            return;
          }

          if (!rawTag || typeof rawTag !== 'object') {
            summary.skippedInvalid += 1;
            return;
          }

          if (isSentenceGroupItem(rawTag) || rawTag.sourceText !== undefined || rawTag.resultText !== undefined) {
            const en = sanitizeText(rawTag.en) || sanitizeText(rawTag.sourceText);
            const zh = sanitizeText(rawTag.zh) || sanitizeText(rawTag.resultText);
            const sentenceKey = buildSentenceItemKey({ en, zh });
            if (!sentenceKey) {
              summary.skippedInvalid += 1;
              return;
            }
            if (seenSentenceKeys.has(sentenceKey)) {
              summary.skippedTags += 1;
              return;
            }
            seenSentenceKeys.add(sentenceKey);
            normalizedGroup.tags.push({
              type: GROUP_ITEM_TYPE_SENTENCE,
              en,
              zh
            });
            return;
          }

          const en = toCanonicalTagKey(rawTag.en);
          const zh = sanitizeText(rawTag.zh);
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
          normalizedGroup.tags.push({ type: GROUP_ITEM_TYPE_TAG, en: tagKey, zh });
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
    const deletedCategoryIds = new Set([
      ...getDeletedDefaultCategoryIds(baseData),
      ...getDeletedDefaultCategoryIds(sourceData)
    ]);
    const deletedGroupKeys = new Set([
      ...getDeletedDefaultGroupKeys(baseData),
      ...getDeletedDefaultGroupKeys(sourceData)
    ]);

    target[DELETED_DEFAULT_CATEGORY_IDS_KEY] = Array.from(deletedCategoryIds);
    target[DELETED_DEFAULT_GROUP_KEYS_KEY] = Array.from(deletedGroupKeys);

    sourceData.categories.forEach(sourceCategory => {
      if (deletedCategoryIds.has(sourceCategory.id)) {
        summary.skippedCategories += 1;
        return;
      }
      const targetCategory = target.categories.find(category => category.id === sourceCategory.id);
      if (!targetCategory) {
        const nextCategory = cloneData(sourceCategory);
        nextCategory.groups = nextCategory.groups.filter(group => !deletedGroupKeys.has(buildDefaultGroupKey(sourceCategory.id, group.id)));
        target.categories.push(nextCategory);
        summary.addedCategories += 1;
        summary.addedGroups += nextCategory.groups.length;
        summary.addedTags += nextCategory.groups.reduce((count, group) => count + group.tags.length, 0);
        summary.skippedGroups += sourceCategory.groups.length - nextCategory.groups.length;
        return;
      }

      summary.skippedCategories += 1;

      sourceCategory.groups.forEach(sourceGroup => {
        if (deletedGroupKeys.has(buildDefaultGroupKey(sourceCategory.id, sourceGroup.id))) {
          summary.skippedGroups += 1;
          return;
        }
        const targetGroup = targetCategory.groups.find(group => group.id === sourceGroup.id);
        if (!targetGroup) {
          targetCategory.groups.push(cloneData(sourceGroup));
          summary.addedGroups += 1;
          summary.addedTags += sourceGroup.tags.length;
          return;
        }

        summary.skippedGroups += 1;
        const existingTagKeys = new Set(
          targetGroup.tags
            .filter(isTagGroupItem)
            .map(tag => normalizeTagKey(tag.en))
            .filter(Boolean)
        );
        const existingSentenceKeys = new Set(
          targetGroup.tags
            .filter(isSentenceGroupItem)
            .map(buildSentenceItemKey)
            .filter(Boolean)
        );
        sourceGroup.tags.forEach(sourceTag => {
          if (isSentenceGroupItem(sourceTag)) {
            const sentenceKey = buildSentenceItemKey(sourceTag);
            if (!sentenceKey || existingSentenceKeys.has(sentenceKey)) {
              summary.skippedTags += 1;
              return;
            }
            existingSentenceKeys.add(sentenceKey);
            targetGroup.tags.push(cloneData(sourceTag));
            summary.addedTags += 1;
            return;
          }

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
          const key = normalizeTagKey(getGroupItemPromptText(tag));
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
          const key = normalizeTagKey(getGroupItemPromptText(tag));
          const translationText = getGroupItemTranslationText(tag);
          if (key && translationText) map[key] = translationText;
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
          if (isSentenceGroupItem(tag)) {
            const sentenceKey = buildSentenceItemKey(tag);
            if (!sentenceKey) {
              changed = true;
              return;
            }
            nextTags.push({
              type: GROUP_ITEM_TYPE_SENTENCE,
              en: sanitizeText(tag.en) || sanitizeText(tag.sourceText),
              zh: sanitizeText(tag.zh) || sanitizeText(tag.resultText)
            });
            return;
          }

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
            type: GROUP_ITEM_TYPE_TAG,
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
    isTagGroupItem,
    isSentenceGroupItem,
    normalizeGroupItemType,
    buildSentenceItemKey,
    getGroupItemPromptText,
    getGroupItemTranslationText,
    buildLegacyId,
    createEmptyGroupTagsData,
    buildDefaultGroupKey,
    getDeletedDefaultCategoryIds,
    getDeletedDefaultGroupKeys,
    markDefaultCategoryDeleted,
    markDefaultGroupDeleted,
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
