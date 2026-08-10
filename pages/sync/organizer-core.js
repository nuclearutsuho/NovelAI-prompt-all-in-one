/**
 * Wildcard Organizer 纯算法核心。
 * 不访问 DOM、Chrome API 或存储，便于独立测试和复用。
 */
export default function createOrganizerCore(options = {}) {
    const {
        normalizeTagKey = value => String(value || '').trim().toLocaleLowerCase(),
        getDictionaryMeta = () => null,
        isTagItem = () => true,
        getPromptText = item => item?.en || '',
        getTranslationText = item => item?.zh || '',
        logger = console
    } = options;

    function normalizeLine(line = '') {
        return String(line || '')
            .trim()
            .replace(/\s*,\s*/g, ', ')
            .replace(/[ \t]{2,}/g, ' ');
    }

    function createPinnedItem(value = '', type = 'exact') {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue) return null;
        const normalizedType = type === 'prefix' ? 'prefix' : 'exact';
        return {
            type: normalizedType,
            value: normalizedValue,
            normalizedValue: normalizedType === 'exact'
                ? normalizeTagKey(normalizedValue)
                : normalizedValue.toLocaleLowerCase()
        };
    }

    function inferPinnedItemType(value = '') {
        const normalized = String(value || '').trim();
        if (!normalized) return null;
        return normalized.endsWith(':') || normalized.endsWith('_') ? 'prefix' : 'exact';
    }

    function serializePinnedItems(items = []) {
        return JSON.stringify((items || []).map(item => ({
            type: item.type === 'prefix' ? 'prefix' : 'exact',
            value: String(item.value || '').trim()
        })));
    }

    function parsePinnedItems(raw = '[]') {
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(item => createPinnedItem(item?.value, item?.type)).filter(Boolean);
        } catch (error) {
            logger.warn?.('[OrganizerCore] 置顶规则解析失败:', error);
            return [];
        }
    }

    function isWrappedToken(text = '', left = '(', right = ')') {
        if (!text.startsWith(left) || !text.endsWith(right)) return false;
        let depth = 0;
        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (character === left) depth += 1;
            if (character === right) {
                depth -= 1;
                if (depth === 0 && index < text.length - 1) return false;
            }
        }
        return depth === 0;
    }

    function splitTags(line = '') {
        const parts = [];
        let current = '';
        let roundDepth = 0;
        let squareDepth = 0;
        let braceDepth = 0;

        for (const character of String(line || '')) {
            if (character === ',' && roundDepth === 0 && squareDepth === 0 && braceDepth === 0) {
                if (current.trim()) parts.push(current.trim());
                current = '';
                continue;
            }

            current += character;
            if (character === '(') roundDepth += 1;
            else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
            else if (character === '[') squareDepth += 1;
            else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
            else if (character === '{') braceDepth += 1;
            else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
        }

        if (current.trim()) parts.push(current.trim());
        return parts;
    }

    function stripWeightWrapper(token = '') {
        let current = String(token || '').trim();
        let weight = 1;
        let hasExplicitWeight = false;
        let changed = true;

        while (changed) {
            changed = false;
            const match = current.match(/^([+-]?\d+(?:\.\d+)?)::([\s\S]*?)::$/);
            if (!match) continue;
            current = match[2].trim();
            if (!hasExplicitWeight) {
                weight = Number.parseFloat(match[1]);
                hasExplicitWeight = Number.isFinite(weight);
                if (!hasExplicitWeight) weight = 1;
            }
            changed = true;
        }

        return { text: current, weight, hasExplicitWeight };
    }

    function getWrapperWeight(wrapperType = '') {
        if (wrapperType === 'curly') return 1.1;
        if (wrapperType === 'paren') return 1.05;
        if (wrapperType === 'square') return 0.9;
        return 1;
    }

    function canonicalizeTag(tag = '') {
        const normalized = String(tag || '').trim().toLocaleLowerCase();
        if (!normalized) return '';
        const prefixedMatchers = [
            { pattern: /^artist:(.+)$/, colorCode: '1' },
            { pattern: /^character:(.+)$/, colorCode: '4' }
        ];

        for (const matcher of prefixedMatchers) {
            const match = normalized.match(matcher.pattern);
            if (!match) continue;
            const bareTag = match[1].trim();
            if (getDictionaryMeta(bareTag)?.colorCode === matcher.colorCode) return bareTag;
        }

        return normalizeTagKey(normalized) || normalized;
    }

    function getExplicitPrefixGroup(tag = '') {
        const normalized = String(tag || '').trim().toLocaleLowerCase();
        const match = normalized.match(/^([a-z0-9_]+:)[^:\s].*$/i);
        return match ? match[1] : '';
    }

    function parseToken(token = '') {
        let current = String(token || '').trim();
        if (!current) return null;
        let explicitWeight = 1;
        let wrapperWeight = 1;
        const wrappers = [];
        let changed = true;

        while (changed) {
            changed = false;
            const strippedWeight = stripWeightWrapper(current);
            current = strippedWeight.text;
            if (strippedWeight.hasExplicitWeight) explicitWeight = strippedWeight.weight;

            const wrapperTypes = [
                ['curly', '{', '}'],
                ['paren', '(', ')'],
                ['square', '[', ']']
            ];
            for (const [type, left, right] of wrapperTypes) {
                if (!isWrappedToken(current, left, right)) continue;
                current = current.slice(1, -1).trim();
                wrapperWeight *= getWrapperWeight(type);
                wrappers.push(type);
                changed = true;
                break;
            }
        }

        const finalWeight = stripWeightWrapper(current);
        current = finalWeight.text;
        if (finalWeight.hasExplicitWeight) explicitWeight = finalWeight.weight;

        const legacyWeight = current.match(/^(.*):([0-9]+(?:\.[0-9]+)?)$/);
        if (legacyWeight) {
            current = legacyWeight[1].trim();
            const parsedWeight = Number.parseFloat(legacyWeight[2]);
            if (Number.isFinite(parsedWeight)) explicitWeight = parsedWeight;
        }

        const rawCoreTag = current.toLocaleLowerCase();
        return {
            rawToken: String(token || '').trim(),
            rawCoreTag,
            canonicalTag: canonicalizeTag(rawCoreTag),
            explicitWeight,
            wrapperWeight,
            weight: explicitWeight * wrapperWeight,
            wrappers,
            explicitPrefixGroup: getExplicitPrefixGroup(rawCoreTag)
        };
    }

    function getParsedDictionaryMeta(parsedToken = null) {
        if (!parsedToken) return null;
        const candidateKeys = [];
        const pushKey = value => {
            const normalized = String(value || '').trim().toLocaleLowerCase();
            if (normalized && !candidateKeys.includes(normalized)) candidateKeys.push(normalized);
        };
        pushKey(parsedToken.canonicalTag);
        pushKey(parsedToken.rawCoreTag);

        const rawCoreTag = String(parsedToken.rawCoreTag || '').trim().toLocaleLowerCase();
        const artistMatch = rawCoreTag.match(/^artist:(.+)$/);
        if (artistMatch) pushKey(artistMatch[1].trim());
        const characterMatch = rawCoreTag.match(/^character:(.+)$/);
        if (characterMatch) pushKey(characterMatch[1].trim());

        for (const key of candidateKeys) {
            const meta = getDictionaryMeta(key);
            if (meta) return { key, ...meta };
        }
        return null;
    }

    function buildGroupTagsIndex(groupTagsData = null) {
        const tagSet = new Set();
        const membershipMap = new Map();
        const translationMap = new Map();
        const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];

        for (const category of categories) {
            const categoryId = String(category?.id || category?.name || '').trim();
            const categoryName = String(category?.name || category?.id || '未命名分类').trim() || '未命名分类';
            for (const group of (Array.isArray(category?.groups) ? category.groups : [])) {
                const groupId = String(group?.id || group?.name || '').trim();
                const groupName = String(group?.name || group?.id || '未命名分组').trim() || '未命名分组';
                const categoryKey = categoryId || categoryName;
                const groupKey = `${categoryKey}::${groupId || groupName}`;

                for (const item of (Array.isArray(group?.tags) ? group.tags : [])) {
                    if (!isTagItem(item)) continue;
                    const normalizedKey = normalizeTagKey(getPromptText(item));
                    if (!normalizedKey) continue;
                    tagSet.add(normalizedKey);
                    const translation = String(getTranslationText(item) || '').trim();
                    if (translation && !translationMap.has(normalizedKey)) {
                        translationMap.set(normalizedKey, translation);
                    }
                    if (!membershipMap.has(normalizedKey)) membershipMap.set(normalizedKey, []);
                    membershipMap.get(normalizedKey).push({
                        categoryKey,
                        categoryTitle: categoryName,
                        groupKey,
                        groupTitle: groupName
                    });
                }
            }
        }

        return { tagSet, membershipMap, translationMap };
    }

    function getPinnedMatchIndex(coreTag = '', pinnedItems = []) {
        const normalizedTag = String(coreTag || '').trim().toLocaleLowerCase();
        if (!normalizedTag || !pinnedItems.length) return Number.POSITIVE_INFINITY;
        for (let index = 0; index < pinnedItems.length; index += 1) {
            const item = pinnedItems[index];
            if (item.type === 'exact' && normalizedTag === item.normalizedValue) return index;
            if (item.type === 'prefix' && normalizedTag.startsWith(item.normalizedValue)) return index;
        }
        return Number.POSITIVE_INFINITY;
    }

    function getParsedPinnedMatchIndex(parsedToken, pinnedItems = []) {
        if (!parsedToken) return Number.POSITIVE_INFINITY;
        // 字典会把 artist:/character: 前缀规范化掉；匹配时同时保留原始核心值，
        // 否则用户添加的 artist: 前缀置顶规则永远无法命中。
        return Math.min(
            getPinnedMatchIndex(parsedToken.canonicalTag, pinnedItems),
            getPinnedMatchIndex(parsedToken.rawCoreTag, pinnedItems)
        );
    }

    function reorderLineTagsByPriority(line = '', pinnedItems = []) {
        const tokens = splitTags(line);
        if (tokens.length <= 1 || !pinnedItems.length) return normalizeLine(line);
        return tokens
            .map((token, index) => ({
                token: token.trim(),
                index,
                matchIndex: getParsedPinnedMatchIndex(parseToken(token), pinnedItems)
            }))
            .sort((left, right) => {
                const leftMatched = Number.isFinite(left.matchIndex);
                const rightMatched = Number.isFinite(right.matchIndex);
                if (leftMatched && rightMatched) return left.matchIndex - right.matchIndex || left.index - right.index;
                if (leftMatched) return -1;
                if (rightMatched) return 1;
                return left.index - right.index;
            })
            .map(item => item.token)
            .join(', ');
    }

    function buildLinePinnedPriorityMeta(line = '', pinnedItems = []) {
        const matchedIndices = [];
        const seen = new Set();
        const weightMap = new Map();

        for (const token of splitTags(line)) {
            const parsedToken = parseToken(token);
            const matchIndex = getParsedPinnedMatchIndex(parsedToken, pinnedItems);
            if (!Number.isFinite(matchIndex)) continue;
            if (!seen.has(matchIndex)) {
                seen.add(matchIndex);
                matchedIndices.push(matchIndex);
            }
            weightMap.set(matchIndex, Math.max(
                weightMap.get(matchIndex) || Number.NEGATIVE_INFINITY,
                parsedToken?.weight ?? 1
            ));
        }
        matchedIndices.sort((left, right) => left - right);
        return {
            matchedIndices,
            matchedWeights: matchedIndices.map(index => weightMap.get(index) ?? 1),
            firstMatchIndex: matchedIndices[0] ?? Number.POSITIVE_INFINITY,
            matchedCount: matchedIndices.length
        };
    }

    function comparePinnedPriorityMeta(left, right) {
        const leftMatched = Number.isFinite(left.firstMatchIndex);
        const rightMatched = Number.isFinite(right.firstMatchIndex);
        if (leftMatched && !rightMatched) return -1;
        if (!leftMatched && rightMatched) return 1;
        if (!leftMatched && !rightMatched) return 0;

        const maxLength = Math.max(left.matchedIndices.length, right.matchedIndices.length);
        for (let index = 0; index < maxLength; index += 1) {
            const leftValue = left.matchedIndices[index];
            const rightValue = right.matchedIndices[index];
            if (leftValue === undefined) return 1;
            if (rightValue === undefined) return -1;
            if (leftValue !== rightValue) return leftValue - rightValue;
            const leftWeight = left.matchedWeights[index] ?? 1;
            const rightWeight = right.matchedWeights[index] ?? 1;
            if (leftWeight !== rightWeight) return rightWeight - leftWeight;
        }
        return right.matchedCount - left.matchedCount;
    }

    function buildModel(text = '', lightweight = false) {
        const source = String(text || '').replace(/\r\n/g, '\n');
        const rawLines = source.split('\n');
        const entries = [];
        let blankLines = 0;

        rawLines.forEach((rawLine, index) => {
            const trimmed = rawLine.trim();
            if (!trimmed) {
                blankLines += 1;
                return;
            }
            const normalized = normalizeLine(trimmed);
            entries.push({
                lineNumber: index + 1,
                raw: rawLine,
                text: trimmed,
                normalized,
                tokenCount: lightweight ? 1 : splitTags(trimmed).length,
                charCount: normalized.length
            });
        });

        const duplicateMap = new Map();
        for (const entry of entries) {
            const key = entry.normalized.toLocaleLowerCase();
            duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
        }
        for (const entry of entries) {
            entry.duplicateCount = duplicateMap.get(entry.normalized.toLocaleLowerCase()) || 1;
        }

        return {
            entries,
            stats: {
                totalLines: rawLines.length,
                nonEmptyLines: entries.length,
                blankLines,
                uniqueLines: duplicateMap.size,
                duplicateLines: Math.max(0, entries.length - duplicateMap.size),
                duplicateGroups: Array.from(duplicateMap.values()).filter(count => count > 1).length
            }
        };
    }

    function getSortedEntries(entries = [], mode = 'original', pinnedItems = []) {
        const list = [...entries];
        const compareText = (left, right) => left.normalized.localeCompare(
            right.normalized,
            undefined,
            { numeric: true, sensitivity: 'base' }
        );
        const sorters = {
            alphaAsc: (left, right) => compareText(left, right) || left.lineNumber - right.lineNumber,
            alphaDesc: (left, right) => compareText(right, left) || left.lineNumber - right.lineNumber,
            tokenAsc: (left, right) => left.tokenCount - right.tokenCount || compareText(left, right) || left.lineNumber - right.lineNumber,
            tokenDesc: (left, right) => right.tokenCount - left.tokenCount || compareText(left, right) || left.lineNumber - right.lineNumber,
            lengthAsc: (left, right) => left.charCount - right.charCount || compareText(left, right) || left.lineNumber - right.lineNumber,
            lengthDesc: (left, right) => right.charCount - left.charCount || compareText(left, right) || left.lineNumber - right.lineNumber,
            duplicatesFirst: (left, right) => right.duplicateCount - left.duplicateCount || compareText(left, right) || left.lineNumber - right.lineNumber
        };

        if (mode === 'pinnedPriority') {
            const metaCache = new Map(list.map(entry => [
                entry.lineNumber,
                buildLinePinnedPriorityMeta(entry.text, pinnedItems)
            ]));
            list.sort((left, right) => (
                comparePinnedPriorityMeta(metaCache.get(left.lineNumber), metaCache.get(right.lineNumber))
                || left.lineNumber - right.lineNumber
            ));
        } else if (sorters[mode]) {
            list.sort(sorters[mode]);
        } else {
            list.sort((left, right) => left.lineNumber - right.lineNumber);
        }
        return list;
    }

    return Object.freeze({
        buildGroupTagsIndex,
        buildLinePinnedPriorityMeta,
        buildModel: text => buildModel(text, false),
        buildLightweightModel: text => buildModel(text, true),
        comparePinnedPriorityMeta,
        createPinnedItem,
        getParsedDictionaryMeta,
        getPinnedMatchIndex,
        getSortedEntries,
        inferPinnedItemType,
        normalizeLine,
        parsePinnedItems,
        parseToken,
        reorderLineTagsByPriority,
        serializePinnedItems,
        splitTags
    });
}
