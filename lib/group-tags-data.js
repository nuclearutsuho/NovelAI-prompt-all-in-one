(function () {
  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function sanitizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sanitizeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#4a4a6a';
  }

  function normalizeTagKey(value) {
    return sanitizeText(value).toLowerCase();
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
            en = sanitizeText(rawTag);
          } else if (rawTag && typeof rawTag === 'object') {
            en = sanitizeText(rawTag.en);
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
          normalizedGroup.tags.push({ en, zh });
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
        const color = group.color || '#4a4a6a';
        (group.tags || []).forEach(tag => {
          if (tag.en) map[tag.en] = color;
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
          if (tag.en && tag.zh) map[tag.en] = tag.zh;
        });
      });
    });
    return map;
  }

  function resolveEffectiveGroupTagsData(defaultData, storedData) {
    const normalizedDefault = normalizeGroupTagsData(defaultData).data;
    if (!storedData?.categories) {
      return cloneData(normalizedDefault);
    }
    const normalizedStored = normalizeGroupTagsData(storedData).data;
    return mergeGroupTagsData(normalizedStored, normalizedDefault).data;
  }

  window.GroupTagsDataUtils = {
    cloneData,
    sanitizeText,
    sanitizeColor,
    normalizeTagKey,
    buildLegacyId,
    createEmptyGroupTagsData,
    createMergeSummary,
    countSummarySkipped,
    normalizeGroupTagsData,
    mergeGroupTagsData,
    buildColorMap,
    buildTranslationMap,
    resolveEffectiveGroupTagsData
  };
})();
