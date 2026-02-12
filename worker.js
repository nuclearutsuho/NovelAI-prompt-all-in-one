
// worker.js - Background thread for dictionary search
let dictionary = [];

self.onmessage = function (e) {
    const { type, payload } = e.data;

    if (type === 'init') {
        dictionary = payload;
        // Optional: Pre-process or index if needed. 
        // For 150k items, linear scan in worker is usually fast enough (50ms) 
        // and doesn't block UI.
        self.postMessage({ type: 'ready', count: dictionary.length });
    }
    else if (type === 'search') {
        const { id, query, limit = 50 } = payload;
        try {
            const results = performSearch(query, limit);
            self.postMessage({ type: 'searchResults', id, results });
        } catch (err) {
            console.error('Worker search error:', err);
            self.postMessage({ type: 'searchResults', id, results: [] });
        }
    }
};

function performSearch(query, limit) {
    if (!query || !dictionary.length) return [];

    // Normalize query
    const q = query.toLowerCase();

    // Results container
    const exactMatches = [];
    const startMatches = [];
    const includeMatches = [];
    const fuzzyMatches = []; // Aliases, translations

    let count = 0;

    // Linear scan with lazy prioritization
    // We want to fill 'limit' items, prioritizing best matches.
    // Full scan is needed to find best matches unless we break early.
    // If we break early, we might miss an "Exact Match" at the end.
    // For 150k items, full scan is safer for quality.

    for (let i = 0; i < dictionary.length; i++) {
        const item = dictionary[i];
        const tag = item.tag.toLowerCase();

        let score = 0; // 0 = no match

        // 1. Tag Matches
        if (tag === q) score = 100;
        else if (tag.startsWith(q)) score = 80;
        else if (tag.includes(q)) score = 50;

        // 2. Translation Matches (High priority for Chinese users)
        else if (item.zhCN && item.zhCN.includes(q)) score = 70;

        // 3. Alias Matches
        else {
            if (item.aliases) {
                // aliases is array of strings
                for (let j = 0; j < item.aliases.length; j++) {
                    const a = item.aliases[j].toLowerCase();
                    if (a.startsWith(q)) { score = 60; break; }
                    if (a.includes(q)) { score = 30; break; }
                }
            }
        }

        if (score > 0) {
            // Add to results
            // Should we collect ALL and sort? Or just top N?
            // Collecting all 150k matches for "a" is heavy.
            // But usually "a" matches 10k items.
            // Sending 10k items back is slow.
            // We MUST limit results here.

            // Optimization: Reservoir sampling or just bucketing?
            // Simple bucketing:
            const resultItem = { item, score };

            if (score === 100) exactMatches.push(resultItem);
            else if (score >= 80) startMatches.push(resultItem);
            else if (score >= 70) includeMatches.push(resultItem);
            else if (score >= 40) fuzzyMatches.push(resultItem);
            else fuzzyMatches.push(resultItem); // Low score alias matches

            // Optimization: If we have enough high-quality matches, maybe stop?
            // But we might miss "Apple" (score 80) if we stop at "Abacus" (score 80).
            // So we scan all.
        }
    }

    // Merge and Sort
    // Priority: Exact > StartsWith > Contains > Alias
    // Within same category, sort by popCount (popularity)

    const sortFn = (a, b) => b.item.popCount - a.item.popCount;

    exactMatches.sort(sortFn);
    startMatches.sort(sortFn);
    includeMatches.sort(sortFn);
    fuzzyMatches.sort(sortFn);

    const combined = [...exactMatches, ...startMatches, ...includeMatches, ...fuzzyMatches];

    // Return top N items
    return combined.slice(0, limit).map(r => r.item);
}
