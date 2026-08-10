/**
 * CodeMirror 字典搜索控制器：管理 Worker、请求超时和页面释放。
 */
export default function createEditorSearchController(options = {}) {
    const {
        scope,
        workerUrl,
        WorkerCtor = globalThis.Worker,
        log,
        t,
        tf,
        timeoutMs = 1000
    } = options;

    if (!scope?.add || !scope?.timeout || !workerUrl || typeof WorkerCtor !== 'function') {
        throw new Error('[EditorSearchController] 缺少生命周期、Worker 地址或 Worker 构造器');
    }

    let worker = null;
    let requestSequence = 0;
    const pendingSearches = new Map();

    function settleSearch(id, results) {
        const pending = pendingSearches.get(id);
        if (!pending) return;
        pendingSearches.delete(id);
        scope.cancelTimeout(pending.timeoutId);
        pending.resolve(results);
    }

    function settleAll(results = null) {
        for (const id of Array.from(pendingSearches.keys())) {
            settleSearch(id, results);
        }
    }

    function init() {
        if (worker) return worker;
        try {
            worker = new WorkerCtor(workerUrl);
            worker.onmessage = event => {
                const { type, id, results, count } = event.data || {};
                if (type === 'ready') {
                    log(tf('log_search_ready', { count }), 'success');
                } else if (type === 'searchResults') {
                    settleSearch(id, Array.isArray(results) ? results : []);
                }
            };
            worker.onerror = error => {
                console.error('[EditorSearchController] Worker Error:', error);
                log(t('log_search_error'), 'error');
                settleAll(null);
            };
            scope.add(() => {
                settleAll(null);
                worker?.terminate();
                worker = null;
            });
            return worker;
        } catch (error) {
            worker = null;
            log(tf('log_search_start_failed', { message: error.message }), 'error');
            return null;
        }
    }

    function initializeDictionary(entries = []) {
        const currentWorker = init();
        if (!currentWorker) return false;
        currentWorker.postMessage({ type: 'init', payload: entries });
        return true;
    }

    function search(query, limit = 50) {
        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery || !worker) return Promise.resolve(null);

        return new Promise(resolve => {
            const id = ++requestSequence;
            const timeoutId = scope.timeout(() => {
                pendingSearches.delete(id);
                resolve(null);
            }, timeoutMs);
            pendingSearches.set(id, { resolve, timeoutId });
            try {
                worker.postMessage({ type: 'search', payload: { id, query: normalizedQuery, limit } });
            } catch (error) {
                settleSearch(id, null);
                log(tf('log_search_start_failed', { message: error.message }), 'error');
            }
        });
    }

    function createCompletionSource(limit = 50) {
        return async context => {
            const line = context.state.doc.lineAt(context.pos);
            const textBefore = line.text.slice(0, context.pos - line.from);
            const lastSeparator = Math.max(textBefore.lastIndexOf(','), textBefore.lastIndexOf('\n'));
            const wordStart = lastSeparator + 1;
            const rawWord = textBefore.slice(wordStart);
            const word = rawWord.trim().toLowerCase();
            if (!word) return null;

            const from = line.from + wordStart + (rawWord.length - rawWord.trimStart().length);
            const results = await search(word, limit);
            if (!results?.length) return null;

            return {
                from,
                options: results.map(entry => ({
                    label: entry.tag,
                    detail: entry.zhCN || '',
                    apply: entry.tag,
                    boost: entry.popCount || 0
                })),
                filter: false
            };
        };
    }

    return Object.freeze({
        createCompletionSource,
        init,
        initializeDictionary,
        search
    });
}
