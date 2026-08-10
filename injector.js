// injector.js
(() => {
  const novelAICompat = globalThis.__NAI_AIO_NOVELAI_COMPAT__;
  if (!novelAICompat) {
    console.error('[NAI-Prompt-All-In-One] NovelAI 兼容层未加载，停止初始化页面注入逻辑。');
    return;
  }
  const domPromptAdapter = novelAICompat.createDomPromptAdapter({
    documentRef: document,
    windowRef: window,
    logger: console
  });

  const curlyPattern = /{(?:[^|{}]+\|)+[^|{}]+}/;
  const doublePipePattern = /\|\|(?:[^|]+\|)+[^|]+\|\|/;
  const LOG_PREFIX = '[NAI-Prompt-All-In-One]';
  const simpleWildcardPattern = /([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__/;

  function containsWildcardSyntax(text) {
    return simpleWildcardPattern.test(text) ||
      curlyPattern.test(text) ||
      doublePipePattern.test(text);
  }

  let dict = {};
  let wildcardFolders = [];
  let wildcardFolderList = [];
  let wildcardUsageStats = {};
  let sequentialCounters = {};
  let sequentialStepSettings = {};
  let sequentialStepProgress = {};
  let randomWildcardLocks = {};    // { [key]: { picked: string, progress: number } }
  const PENDING_SEQUENTIAL_TTL_MS = 120000;
  let sequentialRequestSeq = 0;
  let unclaimedSequentialImageEvents = 0;
  const pendingSequentialTransactions = [];
  let v3 = false;
  let preservePrompt = true;
  let alternativeDanbooruAutocomplete = true;
  let triggerTab = false;
  let triggerSpace = true;

  function normalizeSequentialStepValue(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
  }

  function normalizeSequentialStepSettings(rawSettings = {}) {
    const normalized = {};
    Object.entries(rawSettings || {}).forEach(([key, value]) => {
      if (!key) return;
      const step = normalizeSequentialStepValue(value);
      if (step > 1) normalized[key] = step;
    });
    return normalized;
  }

  function normalizeSequentialStepProgressValue(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function postSequentialStepProgressUpdate() {
    window.postMessage({
      type: '__UPDATE_SEQUENTIAL_STEP_PROGRESS__',
      progress: sequentialStepProgress
    }, '*');
  }

  function reconcileSequentialStepProgress() {
    let changed = false;
    const nextProgress = {};

    Object.entries(sequentialStepProgress || {}).forEach(([key, value]) => {
      if (!key) return;
      const step = normalizeSequentialStepValue(sequentialStepSettings[key]);
      if (step <= 1) {
        changed = true;
        return;
      }

      const normalizedValue = Math.min(normalizeSequentialStepProgressValue(value), step - 1);
      if (normalizedValue > 0) {
        nextProgress[key] = normalizedValue;
        if (sequentialStepProgress[key] !== normalizedValue) changed = true;
      } else if (sequentialStepProgress[key] !== undefined) {
        changed = true;
      }
    });

    if (changed || Object.keys(nextProgress).length !== Object.keys(sequentialStepProgress || {}).length) {
      sequentialStepProgress = nextProgress;
      postSequentialStepProgressUpdate();
    }
  }

  // ── 随机通配符锁定辅助函数 ──

  function postRandomWildcardLocksUpdate() {
    window.postMessage({
      type: '__UPDATE_RANDOM_WILDCARD_LOCKS__',
      locks: randomWildcardLocks
    }, '*');
  }

  // 步长设置变化时清理无效锁定（step 降至 1 的键需释放）
  function reconcileRandomWildcardLocks() {
    let changed = false;
    const next = {};
    Object.entries(randomWildcardLocks || {}).forEach(([key, lock]) => {
      const step = normalizeSequentialStepValue(sequentialStepSettings[key]);
      if (step > 1 && lock && lock.picked) {
        const progress = Math.min(
          normalizeSequentialStepProgressValue(lock.progress),
          step - 1
        );
        next[key] = { picked: lock.picked, progress };
        if (lock.progress !== progress) changed = true;
      } else {
        if (randomWildcardLocks[key]) changed = true;
      }
    });
    if (changed || Object.keys(next).length !== Object.keys(randomWildcardLocks || {}).length) {
      randomWildcardLocks = next;
      postRandomWildcardLocksUpdate();
    }
  }

  function getWildcardParentPath(path) {
    const normalized = String(path || '').trim().replace(/^\/+|\/+$/g, '');
    if (!normalized) return '';
    const idx = normalized.lastIndexOf('/');
    return idx === -1 ? '' : normalized.slice(0, idx);
  }

  function getWildcardBaseName(path) {
    const normalized = String(path || '').trim().replace(/^\/+|\/+$/g, '');
    if (!normalized) return '';
    const idx = normalized.lastIndexOf('/');
    return idx === -1 ? normalized : normalized.slice(idx + 1);
  }

  function rebuildWildcardFolderList(rawFolders = [], wildcardMap = {}) {
    const folderSet = new Set();

    (Array.isArray(rawFolders) ? rawFolders : []).forEach(folder => {
      const normalized = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
      if (!normalized) return;
      const parts = normalized.split('/').filter(Boolean);
      let current = '';
      parts.forEach(part => {
        current = current ? `${current}/${part}` : part;
        folderSet.add(current);
      });
    });

    Object.keys(wildcardMap || {}).forEach(key => {
      const normalizedKey = String(key || '').trim().replace(/^\/+|\/+$/g, '');
      if (!normalizedKey || !normalizedKey.includes('/')) return;
      const parts = normalizedKey.split('/').filter(Boolean);
      parts.pop();
      let current = '';
      parts.forEach(part => {
        current = current ? `${current}/${part}` : part;
        folderSet.add(current);
      });
    });

    wildcardFolders = Array.from(folderSet);
    wildcardFolderList = wildcardFolders.sort((a, b) => a.localeCompare(b));
  }

  function normalizeWildcardUsagePath(path) {
    return String(path || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function normalizeWildcardUsageStats(rawStats = {}) {
    const normalizedStats = {};
    Object.entries(rawStats || {}).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;

      const count = Number(value.count);
      const lastUsedAt = Number(value.lastUsedAt);
      normalizedStats[key] = {
        count: Number.isFinite(count) && count > 0 ? count : 0,
        lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : 0
      };
    });
    return normalizedStats;
  }

  function getWildcardUsageKey(kind, path) {
    const normalizedPath = normalizeWildcardUsagePath(path);
    return normalizedPath ? `${kind}:${normalizedPath}` : '';
  }

  function getWildcardUsageEntry(kind, path) {
    const key = getWildcardUsageKey(kind, path);
    if (!key) return null;
    return wildcardUsageStats[key] || null;
  }

  function getWildcardUsageBoost(kind, path, query = '') {
    const entry = getWildcardUsageEntry(kind, path);
    if (!entry) return 0;

    const count = Math.max(0, Number(entry.count) || 0);
    const lastUsedAt = Math.max(0, Number(entry.lastUsedAt) || 0);
    const ageDays = lastUsedAt
      ? Math.max(0, (Date.now() - lastUsedAt) / 86400000)
      : Number.POSITIVE_INFINITY;
    const queryWeight = query ? 1 : 1.85;
    const countBoost = Math.log2(count + 1) * 70 * queryWeight;
    const recencyBoost = Math.max(0, 1 - ageDays / 14) * 65 * queryWeight;

    return countBoost + recencyBoost;
  }

  function rankItemsByUsage(paths, kind, limit = 50) {
    return (paths || [])
      .slice()
      .sort((a, b) => {
        const scoreDiff = getWildcardUsageBoost(kind, b, '') - getWildcardUsageBoost(kind, a, '');
        if (scoreDiff !== 0) return scoreDiff;
        return a.localeCompare(b);
      })
      .slice(0, limit);
  }

  function recordWildcardUsageRecords(records = []) {
    const nextStats = { ...wildcardUsageStats };
    const normalizedRecords = [];
    const now = Date.now();

    (Array.isArray(records) ? records : []).forEach((record) => {
      const kind = record?.kind === 'folder' ? 'folder' : 'file';
      const path = normalizeWildcardUsagePath(record?.path);
      if (!path) return;

      const key = getWildcardUsageKey(kind, path);
      const previous = nextStats[key] || { count: 0, lastUsedAt: 0 };
      const delta = Number(record?.delta);
      nextStats[key] = {
        count: Math.max(0, (Number(previous.count) || 0) + (Number.isFinite(delta) ? delta : 1)),
        lastUsedAt: now
      };
      normalizedRecords.push({ kind, path, delta: Number.isFinite(delta) ? delta : 1 });
    });

    wildcardUsageStats = nextStats;

    if (normalizedRecords.length) {
      window.postMessage({
        type: '__RECORD_WILDCARD_USAGE__',
        records: normalizedRecords
      }, '*');
    }
  }

  function waitForElement(selector) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  /* -------------------------------------------------
   * 0. PNG 메타데이터 유틸 ────────────────────── */   // <<< NEW (PNG 元数据工具)
  function extractPngMetadata(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < sig.length; i++) {
      if (dv.getUint8(i) !== sig[i]) throw new Error("Invalid PNG file.");
    }
    let off = 8;
    const meta = {};
    while (off < dv.byteLength) {
      if (off + 8 > dv.byteLength) break;
      const len = dv.getUint32(off); off += 4;
      let type = "";
      for (let i = 0; i < 4; i++) type += String.fromCharCode(dv.getUint8(off + i));
      off += 4;
      const chunk = new Uint8Array(arrayBuffer, off, len);
      off += len + 4;
      if (type === "tEXt") {
        const nul = chunk.indexOf(0);
        if (nul === -1) continue;
        const key = new TextDecoder("ascii").decode(chunk.slice(0, nul));
        const val = new TextDecoder("latin1").decode(chunk.slice(nul + 1));
        meta[key] = val;
      } else if (type === "iTXt") {
        let p = 0;
        const keyEnd = chunk.indexOf(0, p);
        if (keyEnd === -1) continue;
        const key = new TextDecoder("utf-8").decode(chunk.slice(p, keyEnd));
        p = keyEnd + 3;
        const langEnd = chunk.indexOf(0, p);
        if (langEnd === -1) continue;
        p = langEnd + 1;
        const transEnd = chunk.indexOf(0, p);
        if (transEnd === -1) continue;
        p = transEnd + 1;
        const val = new TextDecoder("utf-8").decode(chunk.slice(p));
        meta[key] = val;
      }
    }
    return meta;
  }                                                   // <<< NEW

  async function applyImg2ImgMetadata(json) {               // <<< NEW
    try {
      if (json?.action !== 'img2img' ||
        !json?.parameters?.image) return;

      const grid = await waitForElement(".display-grid-images");

      let img = null;
      grid.childNodes.forEach(c => {
        if (c.querySelector("img")) {
          img = c.querySelector("img");
        }
      });
      if (!img || !img.src) return alert("No image!");
      const ab = await (await fetch(img.src)).arrayBuffer();

      const raw = extractPngMetadata(ab);
      const commentChunk = raw.Comment;
      if (!commentChunk) return;

      const pngMeta = JSON.parse(commentChunk);

      /* 1) prompt / uc 반영 (应用 Prompt / UC) */
      if (pngMeta.prompt) json.input = pngMeta.prompt;

      /* 2) charPrompt 빌드 (构建 charPrompt) */
      const characterPrompts = [];
      const v4Prompt = pngMeta.v4_prompt;
      const v4NegativePrompt = pngMeta.v4_negative_prompt;

      if (v4Prompt?.caption?.char_captions?.length) {
        const pCaps = v4Prompt.caption.char_captions;
        const nCaps = (v4NegativePrompt?.caption?.char_captions) || [];
        const cnt = Math.min(pCaps.length, nCaps.length, 6);
        for (let i = 0; i < cnt; i++) {
          characterPrompts.push({
            prompt: pCaps[i].char_caption,
            uc: nCaps[i].char_caption,
            center: (pCaps[i].centers?.[0]) || { x: 0.5, y: 0.5 },
            enabled: true
          });
        }
      }

      /* 3) v4‑prompt 계열 세팅 (v4‑prompt 系列设置) */
      if (json.model.startsWith('nai-diffusion-4')) {
        json.parameters.v4_prompt = {
          caption: v4Prompt?.caption
            ?? { base_caption: pngMeta.prompt, char_captions: [] },
          use_coords: false,
          use_order: true
        };
        json.parameters.v4_negative_prompt = {
          caption: v4NegativePrompt?.caption
            ?? { base_caption: pngMeta.uc, char_captions: [] },
          legacy_uc: false
        };
        json.parameters.characterPrompts = characterPrompts;
      }

    } catch (err) {
      console.error('[Wildcard] img2img metadata 처리 오류 (处理错误):', err);
    }
  }


  // === Seeded RNG helpers ===

  // Simple, fast, seedable PRNG: mulberry32
  // Ref: https://stackoverflow.com/a/47593316 , https://github.com/cprosche/mulberry32
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Extract a 32-bit seed from request JSON, or return null if unavailable.
  function getSeed32(json) {
    const s = json?.parameters?.seed;
    if (typeof s === 'number' && isFinite(s)) return (s >>> 0);
    if (typeof s === 'string' && s.trim() !== '') {
      const n = Number.parseInt(s, 10);
      if (Number.isFinite(n)) return (n >>> 0);
    }
    return null; // fall back to Math.random
  }



  /******** 1. swap logic (now rng based on NAI seed) ********/
  function makeDeepSwap(rng) {
    // 使用外层定义的正则表达式和 containsWildcardSyntax 函数 (Use outer-scope patterns and function)
    let pendingUIResync = false;
    const pendingSequentialUpdates = new Map();
    const pendingRandomLockUpdates = new Map();

    const globalSlotCounters = { seq: {}, rnd: {} };

    function normalizeSequentialIndex(value, length) {
      if (!length) return 0;
      return ((value % length) + length) % length;
    }

    function swap(txt) {
      // 1) [sS]?(\d+)?__token__ lines → pick one line OR sequentially
      let result = txt.replace(/([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__/g, (match, prefix, startNum, name) => {
        let effectiveKey = name;
        let raw = dict[name];
        if (!raw && !name.includes('/')) {
          const fallbackKey = Object.keys(dict).find(k => k.split('/').pop() === name);
          if (fallbackKey) {
            raw = dict[fallbackKey];
            effectiveKey = fallbackKey;
          }
        }
        if (!raw) return match;

        raw = raw.replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        if (!lines.length) return match;

        const forceV3 = lines.some(line => containsWildcardSyntax(line));
        const effectiveV3 = forceV3 || v3;

        // --- Sequential Logic ---
        if (prefix) {
          // Slot identification
          const slotIdx = globalSlotCounters.seq[effectiveKey] || 0;
          globalSlotCounters.seq[effectiveKey] = slotIdx + 1;
          // Aligned key logic: Slot 0 uses 'name', others use 'name:idx'
          const storageKey = slotIdx === 0 ? effectiveKey : `${effectiveKey}:${slotIdx}`;

          const persistedIdx = sequentialCounters[storageKey] || 0;
          const idx = startNum
            ? normalizeSequentialIndex(parseInt(startNum, 10) - 1, lines.length)
            : normalizeSequentialIndex(persistedIdx, lines.length);
          const picked = lines[idx % lines.length];

          const nextVal = (idx + 1) % lines.length;
          pendingSequentialUpdates.set(storageKey, {
            name: storageKey,
            value: nextVal
          });
          if (startNum) pendingUIResync = true;

          return picked;
        }

        // --- 随机通配符分支（步长锁定逻辑） ---
        const rndSlotIdx = globalSlotCounters.rnd[effectiveKey] || 0;
        globalSlotCounters.rnd[effectiveKey] = rndSlotIdx + 1;
        const rndKey = rndSlotIdx === 0
          ? `r:${effectiveKey}`
          : `r:${effectiveKey}:${rndSlotIdx}`;

        const step = normalizeSequentialStepValue(sequentialStepSettings[rndKey]);

        // step <= 1：纯 seed 随机，完全不变
        if (step <= 1) {
          if (effectiveV3) {
            return lines[Math.floor(rng() * lines.length)];
          } else {
            return `||${lines.join('|')}||`;
          }
        }

        // step > 1：锁定模式
        const existingLock = randomWildcardLocks[rndKey];
        if (existingLock && existingLock.picked) {
          pendingRandomLockUpdates.set(rndKey, {
            key: rndKey,
            action: 'reuse'
          });
          return existingLock.picked;
        } else {
          const picked = lines[Math.floor(rng() * lines.length)];
          pendingRandomLockUpdates.set(rndKey, {
            key: rndKey,
            action: 'create',
            picked
          });
          return picked;
        }
      });

      // 2) {a|b|c} deterministic pick
      result = result.replace(/{([^|{}]+(?:\|[^|{}]+)+)}/g, (m, group) => {
        const opts = group.split('|');
        return opts[Math.floor(rng() * opts.length)];
      });

      // 3) ||a|b|| deterministic pick (Enhanced with Pick-N, Weights, Joiners)
      result = result.replace(/\|\|(.*?)\|\|/g, (m, content) => {
        let configPart = '';
        let optionsPart = content;

        if (content.includes('$$')) {
          const parts = content.split('$$');
          optionsPart = parts.pop();
          configPart = parts.join('$$'); // Handle multiple $$ if any
        }

        // Parse Config: [count[$$joiner]]
        let countRange = '1';
        let joiner = ', ';
        if (configPart) {
          const cfg = configPart.split('$$');
          countRange = cfg[0].trim() || '1';
          if (cfg.length > 1 && cfg[1]) joiner = cfg[1];
        }

        // Parse Count Range
        let pickCount = 1;
        if (countRange.includes('-')) {
          const [min, max] = countRange.split('-').map(Number);
          if (!isNaN(min) && !isNaN(max)) {
            pickCount = Math.floor(rng() * (max - min + 1)) + min;
          }
        } else {
          pickCount = parseInt(countRange, 10) || 1;
        }

        // Parse Options and Weights
        const rawOpts = optionsPart.split('|');
        const options = rawOpts.map(o => {
          const trimmed = o.trim();
          const weightMatch = trimmed.match(/^(.*?)\s*:\s*(\d+(\.\d+)?)\s*$/);
          if (weightMatch) {
            return { text: weightMatch[1].trim(), weight: parseFloat(weightMatch[2]) };
          }
          return { text: trimmed, weight: 1.0 };
        });

        if (options.length === 0) return '';
        if (pickCount <= 0) return '';

        // Selection Logic (Weighted Random Choice without replacement as much as possible)
        const picked = [];
        const availableOptions = [...options];

        for (let i = 0; i < pickCount && availableOptions.length > 0; i++) {
          const totalWeight = availableOptions.reduce((sum, opt) => sum + opt.weight, 0);
          let r = rng() * totalWeight;
          
          for (let j = 0; j < availableOptions.length; j++) {
            r -= availableOptions[j].weight;
            if (r <= 0) {
              picked.push(availableOptions[j].text);
              availableOptions.splice(j, 1); // Remove to avoid duplicates
              break;
            }
          }
        }

        if (picked.length === 0) return '';
        if (picked.length === 1) return picked[0];

        // Smart Join Logic
        // If joiner is default ", ", check for existing commas to avoid double separators
        if (joiner === ', ') {
          let res = picked[0];
          for (let k = 1; k < picked.length; k++) {
            const prev = res.trim();
            const curr = picked[k].trim();
            const hasSep = prev.endsWith(',') || curr.startsWith(',');
            res += (hasSep ? ' ' : ', ') + picked[k];
          }
          return res;
        }

        return picked.join(joiner);
      });

      return result;
    }

    function recursiveSwap(txt) {
      let current = txt;
      let iteration = 0;

      while (containsWildcardSyntax(current) && iteration < 100) {
        const next = swap(current);
        if (next === current) break;
        current = next;
        iteration++;
      }
      return current;
    }

    const memo = new Map();
    const deepSwap = (o, path = '') => {
      if (typeof o === 'string') {
        const isChar = path.includes('characterPrompts') || path.includes('char_captions');
        if (!isChar && memo.has(o)) return memo.get(o);
        const processed = recursiveSwap(o);
        if (!isChar) memo.set(o, processed);
        return processed;
      }
      if (Array.isArray(o)) return o.map((item, idx) => deepSwap(item, `${path}[${idx}]`));
      if (o && typeof o === 'object') {
        for (const k in o) {
          if (k === 'char_captions' && Array.isArray(o[k]) && o[k].length > 6) {
            o[k] = o[k].slice(0, 6);
          }
          o[k] = deepSwap(o[k], path ? `${path}.${k}` : k);
        }
        return o;
      }
      return o;
    };

    return {
      deepSwap,
      getPendingUIResync: () => pendingUIResync,
      getSequentialUpdates: () => Array.from(pendingSequentialUpdates.values()),
      getRandomLockUpdates: () => Array.from(pendingRandomLockUpdates.values())
    };
  }

  function resetSequentialImageCreditsIfIdle() {
    if (pendingSequentialTransactions.length === 0) {
      unclaimedSequentialImageEvents = 0;
    }
  }

  function pruneExpiredSequentialTransactions() {
    const now = Date.now();
    for (let i = pendingSequentialTransactions.length - 1; i >= 0; i--) {
      const tx = pendingSequentialTransactions[i];
      if ((now - tx.createdAt) > PENDING_SEQUENTIAL_TTL_MS) {
        pendingSequentialTransactions.splice(i, 1);
      }
    }
    resetSequentialImageCreditsIfIdle();
  }

  function queueSequentialTransaction(updates = [], options = {}) {
    pruneExpiredSequentialTransactions();
    if ((!Array.isArray(updates) || updates.length === 0) &&
        (!Array.isArray(options.randomLockUpdates) || options.randomLockUpdates.length === 0)) return null;

    const id = `seq_${Date.now().toString(36)}_${(sequentialRequestSeq++).toString(36)}`;
    pendingSequentialTransactions.push({
      id,
      createdAt: Date.now(),
      status: 'awaiting-response',
      updates,
      randomLockUpdates: options.randomLockUpdates || [],
      needsUIResync: !!options.needsUIResync
    });
    return id;
  }

  function dropSequentialTransaction(id) {
    if (!id) return;
    const idx = pendingSequentialTransactions.findIndex(tx => tx.id === id);
    if (idx !== -1) {
      pendingSequentialTransactions.splice(idx, 1);
      resetSequentialImageCreditsIfIdle();
    }
  }

  function applySequentialCounterUpdate(update) {
    if (!update?.name) return;
    sequentialCounters[update.name] = update.value;
    window.postMessage({
      type: '__UPDATE_SEQUENTIAL_COUNTER__',
      name: update.name,
      value: update.value
    }, '*');
  }

  function notifyGenerationResponse() {
    window.postMessage({
      type: '__NAI_GENERATION_RESPONSE__'
    }, '*');
  }

  function notifyGenerationError(status) {
    window.postMessage({
      type: '__NAI_GENERATION_ERROR__',
      status: status || 0
    }, '*');
  }

  function notifyGenerationRequest() {
    window.postMessage({
      type: '__NAI_GENERATION_REQUEST__'
    }, '*');
  }

  function applySequentialSuccessProgress(update) {
    if (!update?.name) return false;

    const step = normalizeSequentialStepValue(sequentialStepSettings[update.name]);
    const currentProgress = normalizeSequentialStepProgressValue(sequentialStepProgress[update.name]);
    let progressChanged = false;

    if (step <= 1) {
      if (sequentialStepProgress[update.name] !== undefined) {
        delete sequentialStepProgress[update.name];
        progressChanged = true;
      }
      applySequentialCounterUpdate(update);
      return progressChanged;
    }

    const nextProgress = (currentProgress % step) + 1;
    if (nextProgress >= step) {
      if (sequentialStepProgress[update.name] !== undefined) {
        delete sequentialStepProgress[update.name];
        progressChanged = true;
      }
      applySequentialCounterUpdate(update);
      return progressChanged;
    }

    if (sequentialStepProgress[update.name] !== nextProgress) {
      sequentialStepProgress[update.name] = nextProgress;
      progressChanged = true;
    }

    return progressChanged;
  }

  // 随机通配符锁定 progress 推进
  function applyRandomLockSuccessProgress(update) {
    if (!update?.key) return false;
    const step = normalizeSequentialStepValue(sequentialStepSettings[update.key]);
    let changed = false;

    if (step <= 1) {
      // step 已变回 1，释放锁定
      if (randomWildcardLocks[update.key]) {
        delete randomWildcardLocks[update.key];
        changed = true;
      }
      return changed;
    }

    if (update.action === 'create') {
      // 新建锁定，progress=1（本次已使用一次）
      randomWildcardLocks[update.key] = { picked: update.picked, progress: 1 };
      return true;
    }

    if (update.action === 'reuse') {
      const lock = randomWildcardLocks[update.key];
      if (!lock) return false;
      const nextProgress = (lock.progress || 0) + 1;
      if (nextProgress >= step) {
        // 达到步长，释放锁定
        delete randomWildcardLocks[update.key];
        return true;
      }
      lock.progress = nextProgress;
      return true;
    }
    return false;
  }

  function flushReadySequentialTransactions() {
    pruneExpiredSequentialTransactions();
    let progressChanged = false;
    let lockChanged = false;
    while (unclaimedSequentialImageEvents > 0) {
      const idx = pendingSequentialTransactions.findIndex(tx => tx.status === 'ready');
      if (idx === -1) break;
      const [tx] = pendingSequentialTransactions.splice(idx, 1);
      tx.updates.forEach((update) => {
        if (applySequentialSuccessProgress(update)) progressChanged = true;
      });
      (tx.randomLockUpdates || []).forEach((update) => {
        if (applyRandomLockSuccessProgress(update)) lockChanged = true;
      });
      if (tx.needsUIResync) {
        setTimeout(cleanNumericPrefixesFromUI, 100);
      }
      unclaimedSequentialImageEvents--;
    }
    if (progressChanged) postSequentialStepProgressUpdate();
    if (lockChanged) postRandomWildcardLocksUpdate();
    resetSequentialImageCreditsIfIdle();
  }

  function markSequentialTransactionReady(id) {
    if (!id) return;
    pruneExpiredSequentialTransactions();
    const tx = pendingSequentialTransactions.find(item => item.id === id);
    if (!tx) return;
    tx.status = 'ready';
    tx.readyAt = Date.now();
    flushReadySequentialTransactions();
  }

  function noteSequentialImageGenerated() {
    pruneExpiredSequentialTransactions();
    if (pendingSequentialTransactions.length === 0) return;
    unclaimedSequentialImageEvents++;
    flushReadySequentialTransactions();
  }

  function cleanNumericPrefixesFromUI() {
    const editors = document.querySelectorAll('div.ProseMirror[contenteditable="true"]');
    editors.forEach(editor => {
      const walk = (node) => {
        if (node.nodeType === 3) { // Text node
          const old = node.nodeValue;
          // s10__ -> s__ (case insensitive for S)
          const fixed = old.replace(/([sS])\d+__/g, '$1__');
          if (fixed !== old) node.nodeValue = fixed;
        } else {
          node.childNodes.forEach(walk);
        }
      };
      // We don't want to use insertText here because it might trigger more swaps or be messy.
      // Direct text node manipulation is safer for ProseMirror if we don't break the structure.
      // Actually ProseMirror might complain. Let's try execCommand on selection if we find it.
      
      const content = editor.innerText;
      if (/([sS])\d+__/.test(content)) {
        // Save selection
        const sel = window.getSelection();
        const ranges = [];
        for(let i=0; i<sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));

        editor.innerHTML = editor.innerHTML.replace(/([sS])\d+__/g, (match, prefix) => prefix + '__');
        
        // Restore selection (best effort)
        sel.removeAllRanges();
        ranges.forEach(r => {
          try { sel.addRange(r); } catch(e) {}
        });

        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Notify bridge to notify popup/others
    window.postMessage({ type: '__CLEAN_NUMERIC_PREFIXES__' }, '*');
  }

  function parseGenerateRequestJsonText(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  }

  async function extractGenerateRequestBody(body, request = null) {
    if (!body && request instanceof Request) {
      const clone = request.clone();
      const contentType = clone.headers.get('content-type') || '';
      body = contentType.includes('multipart/form-data')
        ? await clone.formData()
        : await clone.text();
    }

    if (!body) return null;

    if (typeof body === 'string') {
      const json = parseGenerateRequestJsonText(body);
      if (!json) return null;
      return {
        json,
        rebuild(nextJson) {
          return JSON.stringify(nextJson);
        }
      };
    }

    if (body instanceof FormData) {
      const requestPart = body.get('request');
      if (requestPart == null) return null;

      const requestText = typeof requestPart === 'string'
        ? requestPart
        : await requestPart.text();
      const json = parseGenerateRequestJsonText(requestText);
      if (!json) return null;

      return {
        json,
        rebuild(nextJson) {
          const nextBody = new FormData();
          for (const [key, value] of body.entries()) {
            if (key === 'request') continue;
            nextBody.append(key, value);
          }

          const nextJsonText = JSON.stringify(nextJson);
          if (requestPart instanceof Blob) {
            const fileName = (typeof File !== 'undefined' && requestPart instanceof File && requestPart.name)
              ? requestPart.name
              : 'blob';
            nextBody.append(
              'request',
              new Blob([nextJsonText], { type: requestPart.type || 'application/json' }),
              fileName
            );
          } else {
            nextBody.append('request', nextJsonText);
          }

          return nextBody;
        }
      };
    }

    if (body instanceof Blob) {
      const json = parseGenerateRequestJsonText(await body.text());
      if (!json) return null;
      return {
        json,
        rebuild(nextJson) {
          return new Blob([JSON.stringify(nextJson)], {
            type: body.type || 'application/json'
          });
        }
      };
    }

    return null;
  }

  /* 2‑A. fetch 패치 (fetch 补丁) */
  const $fetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    let sequentialTransactionId = null;
    let isGenerateRequest = false;
    try {
      const url = typeof input === 'string' ? input : input.url;
      const m = (init.method || input.method || 'GET').toUpperCase();
      if (m === 'POST' && novelAICompat.isGenerateImageRequestUrl(url)) {
        isGenerateRequest = true;
        notifyGenerationRequest();
        const patchedBody = await extractGenerateRequestBody(
          init.body,
          input instanceof Request ? input : null
        );
        if (patchedBody?.json) {
          let json = patchedBody.json;

          const seed32 = getSeed32(json);
          const rng = (seed32 != null) ? mulberry32(seed32) : Math.random;
          const swapper = makeDeepSwap(rng);

          /* ① wildcard 치환 (Wildcard 替换) */
          json = swapper.deepSwap(json);
          sequentialTransactionId = queueSequentialTransaction(
            swapper.getSequentialUpdates(),
            { needsUIResync: swapper.getPendingUIResync(), randomLockUpdates: swapper.getRandomLockUpdates() }
          );

          /* ② img2img 메타데이터 반영 (应用 img2img 元数据) */      // <<< NEW
          if (preservePrompt) await applyImg2ImgMetadata(json);            // <<< NEW

          /* ③ Multi-Resolution 动态替换 (多选分辨率注入) */
          if (window.__multiResConfig && window.__multiResConfig.active && window.__multiResConfig.active.length > 1) {
            const multiResActive = window.__multiResConfig.active;
            const multiResMode = window.__multiResConfig.mode || 'seq';
            window.__multiResIndex = window.__multiResIndex || 0;
            
            let res;
            if (multiResMode === 'seq') {
              res = multiResActive[window.__multiResIndex % multiResActive.length];
              window.__multiResIndex++;
            } else {
              res = multiResActive[Math.floor(rng() * multiResActive.length)];
            }
            if (res && res.includes('x') && json.parameters) {
              const [w, h] = res.split('x').map(Number);
              if (!isNaN(w) && !isNaN(h)) {
                json.parameters.width = w;
                json.parameters.height = h;
                console.log(`[Wildcard] Dynamic Resolution Applied: ${w}x${h} (Mode: ${multiResMode})`);
              }
            }
          }

          /* ④ cosmetic: base_caption = input */
          if (json?.parameters?.v4_prompt?.caption &&
            typeof json.parameters.v4_prompt.caption.base_caption !== 'undefined' &&
            typeof json.input === 'string') {
            json.parameters.v4_prompt.caption.base_caption = json.input;
          }

          const newBody = patchedBody.rebuild(json);
          if (typeof input === 'string') {
            init = { ...init, body: newBody };
            if (newBody instanceof FormData) {
              const headers = new Headers(init.headers || {});
              headers.delete('content-type');
              init.headers = headers;
            }
          } else {
            const nextInit = { ...init, body: newBody };
            if (newBody instanceof FormData) {
              const headers = new Headers(init.headers || input.headers);
              headers.delete('content-type');
              nextInit.headers = headers;
            }
            input = new Request(input, nextInit);
          }
        }
      }
    } catch (e) {
      if (sequentialTransactionId) dropSequentialTransaction(sequentialTransactionId);
      console.error('[Wildcard] fetch patch error:', e);
    }

    return $fetch(input, init)
      .then((response) => {
        if (response?.ok) {
          if (sequentialTransactionId) {
            markSequentialTransactionReady(sequentialTransactionId);
          }
          if (isGenerateRequest) {
            notifyGenerationResponse();
          }
        } else {
          if (sequentialTransactionId) {
            dropSequentialTransaction(sequentialTransactionId);
          }
          if (isGenerateRequest) {
            notifyGenerationError(response?.status);
          }
        }
        return response;
      })
      .catch((error) => {
        if (sequentialTransactionId) dropSequentialTransaction(sequentialTransactionId);
        if (isGenerateRequest) notifyGenerationError(0);
        throw error;
      });
  };

  /* 2‑B. XHR 패치 (XHR 补丁) */
  const $open = XMLHttpRequest.prototype.open;
  const $send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (m, url, ...rest) {
    this.__wild_m = m; this.__wild_u = url;
    return $open.call(this, m, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    let sequentialTransactionId = null;
    const isGenerateRequest = this.__wild_m?.toUpperCase() === 'POST' &&
      novelAICompat.isGenerateImageRequestUrl(this.__wild_u);
    if (isGenerateRequest) {
      notifyGenerationRequest();
      this.addEventListener('loadend', () => {
        if (this.status >= 200 && this.status < 300) {
          if (sequentialTransactionId) {
            markSequentialTransactionReady(sequentialTransactionId);
          }
          notifyGenerationResponse();
        } else {
          if (sequentialTransactionId) {
            dropSequentialTransaction(sequentialTransactionId);
          }
          notifyGenerationError(this.status);
        }
      }, { once: true });
    }
    try {
      if (isGenerateRequest &&
        typeof body === 'string') {

        let json = JSON.parse(body);

        /* ① seed 기반 RNG 생성 및 wildcard 치환 (基于 seed 创建 RNG 并替换 wildcard) */
        const seed32 = getSeed32(json);
        const rng = (seed32 != null) ? mulberry32(seed32) : Math.random;
        const swapper = makeDeepSwap(rng);
        json = swapper.deepSwap(json);
        sequentialTransactionId = queueSequentialTransaction(
          swapper.getSequentialUpdates(),
          { needsUIResync: swapper.getPendingUIResync(), randomLockUpdates: swapper.getRandomLockUpdates() }
        );

        /* ② Multi-Resolution 动态替换 (多选分辨率注入) */
        if (window.__multiResConfig && window.__multiResConfig.active && window.__multiResConfig.active.length > 1) {
          const multiResActive = window.__multiResConfig.active;
          const multiResMode = window.__multiResConfig.mode || 'seq';
          window.__multiResIndex = window.__multiResIndex || 0;
          
          let res;
          if (multiResMode === 'seq') {
            res = multiResActive[window.__multiResIndex % multiResActive.length];
            window.__multiResIndex++;
          } else {
            res = multiResActive[Math.floor(rng() * multiResActive.length)];
          }
          if (res && res.includes('x') && json.parameters) {
            const [w, h] = res.split('x').map(Number);
            if (!isNaN(w) && !isNaN(h)) {
              json.parameters.width = w;
              json.parameters.height = h;
              console.log(`[Wildcard] Dynamic Resolution Applied: ${w}x${h} (Mode: ${multiResMode})`);
            }
          }
        }

        /* ③ cosmetic: base_caption = input */
        if (json?.parameters?.v4_prompt?.caption &&
          typeof json.parameters.v4_prompt.caption.base_caption !== 'undefined' &&
          typeof json.input === 'string') {
          json.parameters.v4_prompt.caption.base_caption = json.input;
        }

        const newBody = JSON.stringify(json);
        return $send.call(this, newBody);
      }
    } catch (e) {
      if (sequentialTransactionId) dropSequentialTransaction(sequentialTransactionId);
      console.error('[Wildcard] XHR patch error:', e);
    }
    return $send.call(this, body);
  };

  let autocompleteDict = [];
  let autocompleteMap = null;
  let isSyncingFromPopup = false;

  const PROMPT_META_SESSION_KEY = '__nai_aio_prompt_tag_meta__';

  // 用页面级 sessionStorage 缓存结构化 tag 元数据，保证同一标签页内可以无损回读。
  function clonePromptMeta(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createEmptyPromptMetaCache() {
    return {
      base: {},
      characters: []
    };
  }

  function readPromptMetaCache() {
    try {
      const raw = window.sessionStorage.getItem(PROMPT_META_SESSION_KEY);
      if (!raw) return createEmptyPromptMetaCache();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return createEmptyPromptMetaCache();
      if (!parsed.base || typeof parsed.base !== 'object') parsed.base = {};
      if (!Array.isArray(parsed.characters)) parsed.characters = [];
      return parsed;
    } catch (e) {
      console.warn('[AI Translate] 读取 prompt 元数据缓存失败:', e);
      return createEmptyPromptMetaCache();
    }
  }

  function writePromptMetaCache(cache) {
    try {
      window.sessionStorage.setItem(PROMPT_META_SESSION_KEY, JSON.stringify(cache || createEmptyPromptMetaCache()));
    } catch (e) {
      console.warn('[AI Translate] 写入 prompt 元数据缓存失败:', e);
    }
  }

  function buildPromptMetaEntry(promptText, tags) {
    if (typeof promptText !== 'string' || !Array.isArray(tags) || tags.length === 0) return null;
    return {
      prompt: promptText,
      tags: clonePromptMeta(tags)
    };
  }

  function updateBasePromptMetaCache(payload = {}) {
    const cache = readPromptMetaCache();

    if (payload.positive !== undefined) {
      const entry = buildPromptMetaEntry(payload.positive || '', payload.positiveTags);
      if (entry) cache.base.positive = entry;
      else delete cache.base.positive;
    }

    if (payload.negative !== undefined) {
      const entry = buildPromptMetaEntry(payload.negative || '', payload.negativeTags);
      if (entry) cache.base.negative = entry;
      else delete cache.base.negative;
    }

    writePromptMetaCache(cache);
  }

  function updateCharacterPromptMetaCache(charDataList = []) {
    const cache = readPromptMetaCache();
    cache.characters = (charDataList || []).map((item) => {
      const charMeta = {};
      const positiveEntry = buildPromptMetaEntry(item?.positive || '', item?.positiveTags);
      const negativeEntry = buildPromptMetaEntry(item?.negative || '', item?.negativeTags);
      if (positiveEntry) charMeta.positive = positiveEntry;
      if (negativeEntry) charMeta.negative = negativeEntry;
      return charMeta;
    });
    writePromptMetaCache(cache);
  }

  function attachPromptMetaToResult(result) {
    const cache = readPromptMetaCache();
    let shouldPersist = false;

    const tryAttachBase = (side, promptText) => {
      const entry = cache.base?.[side];
      if (!entry) return;
      if (entry.prompt === promptText && Array.isArray(entry.tags) && entry.tags.length > 0) {
        result[side + 'Tags'] = clonePromptMeta(entry.tags);
        return;
      }
      delete cache.base[side];
      shouldPersist = true;
    };

    if (typeof result.positive === 'string') tryAttachBase('positive', result.positive);
    if (typeof result.negative === 'string') tryAttachBase('negative', result.negative);

    if (Array.isArray(result.characters)) {
      if (cache.characters.length > result.characters.length) {
        cache.characters = cache.characters.slice(0, result.characters.length);
        shouldPersist = true;
      }

      result.characters.forEach((item, index) => {
        const charCache = cache.characters[index];
        if (!charCache) return;

        if (typeof item.positive === 'string') {
          if (charCache.positive?.prompt === item.positive && Array.isArray(charCache.positive.tags) && charCache.positive.tags.length > 0) {
            item.positiveTags = clonePromptMeta(charCache.positive.tags);
          } else if (charCache.positive) {
            delete charCache.positive;
            shouldPersist = true;
          }
        }

        if (typeof item.negative === 'string') {
          if (charCache.negative?.prompt === item.negative && Array.isArray(charCache.negative.tags) && charCache.negative.tags.length > 0) {
            item.negativeTags = clonePromptMeta(charCache.negative.tags);
          } else if (charCache.negative) {
            delete charCache.negative;
            shouldPersist = true;
          }
        }
      });
    }

    if (shouldPersist) {
      writePromptMetaCache(cache);
    }

    return result;
  }

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, map, folders, usageStats, v3: newV3, preservePrompt: newPreserve, alternativeDanbooruAutocomplete: newAlt, triggerTab: newTab, triggerSpace: newSpace, data } = e.data || {};

  function setWebpageResolution(width, height) {
    const resInputs = Array.from(document.querySelectorAll('input[type="number"][step="64"][min="64"]'));
    if (resInputs.length >= 2) {
      const wInput = resInputs[0];
      const hInput = resInputs[1];
      
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      let changed = false;
      
      if (wInput.value != width) {
        nativeInputValueSetter.call(wInput, width);
        wInput.dispatchEvent(new Event('input', { bubbles: true }));
        wInput.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
      
      if (hInput.value != height) {
        nativeInputValueSetter.call(hInput, height);
        hInput.dispatchEvent(new Event('input', { bubbles: true }));
        hInput.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
      
      if (changed) console.log(`[Wildcard] Successfully set webpage resolution to ${width}x${height}`);
    } else {
      console.log('[Wildcard] Could not find resolution inputs on the page.');
    }
  }

    if (type === '__SET_RESOLUTION__') {
      setWebpageResolution(data.width, data.height);
      return;
    }

    if (type === '__NAI_IMAGE_GENERATED__') {
      noteSequentialImageGenerated();
      return;
    }

    // 옵션 초기화 및 업데이트 처리 (选项初始化及更新处理)
    if (type === '__SEQUENTIAL_STEP_SETTINGS_UPDATE__') {
      sequentialStepSettings = normalizeSequentialStepSettings(e.data.sequentialStepSettings || {});
      sequentialStepProgress = e.data.sequentialStepProgress && typeof e.data.sequentialStepProgress === 'object'
        ? e.data.sequentialStepProgress
        : sequentialStepProgress;
      reconcileSequentialStepProgress();
      reconcileRandomWildcardLocks();  // 步长变化时清理无效锁定
      return;
    }

    // 从 popup 端手动设置顺序通配符计数器
    if (type === '__SET_SEQUENTIAL_COUNTER__') {
      const { name, value } = e.data;
      if (name) {
        sequentialCounters[name] = value;
      }
      return;
    }

    // 从 popup 端重置步长进度
    if (type === '__RESET_STEP_PROGRESS__') {
      const { key, isSequential } = e.data;
      if (key) {
        if (isSequential) {
          delete sequentialStepProgress[key];
        } else {
          delete randomWildcardLocks[key];
        }
      }
      return;
    }

    if (type === '__WILDCARD_INIT__' || type === '__WILDCARD_UPDATE__') {
      dict = map || {};
      rebuildWildcardFolderList(typeof folders !== 'undefined' ? folders : wildcardFolders, dict);
      wildcardUsageStats = normalizeWildcardUsageStats(
        typeof usageStats !== 'undefined' ? usageStats : wildcardUsageStats
      );
      v3 = !!newV3;
      preservePrompt = !!newPreserve;
      triggerTab = !!newTab;
      triggerSpace = !!newSpace;
      if (e.data.sequentialCounters) {
        sequentialCounters = e.data.sequentialCounters;
      }
      sequentialStepSettings = normalizeSequentialStepSettings(e.data.sequentialStepSettings || {});
      sequentialStepProgress = e.data.sequentialStepProgress && typeof e.data.sequentialStepProgress === 'object'
        ? e.data.sequentialStepProgress
        : {};
      reconcileSequentialStepProgress();
      if (e.data.randomWildcardLocks && typeof e.data.randomWildcardLocks === 'object') {
        randomWildcardLocks = e.data.randomWildcardLocks;
      }
      reconcileRandomWildcardLocks();

      if (e.data.multiResConfig !== undefined) {
        window.__multiResConfig = e.data.multiResConfig;
      }

      // alternativeDanbooruAutocomplete 토글 즉시 반영 (立即反映 alternativeDanbooruAutocomplete 切换)
      if (typeof newAlt !== 'undefined') {
        alternativeDanbooruAutocomplete = !!newAlt;
        if (alternativeDanbooruAutocomplete) {
          // 켜졌을 때 사전 재요청 (开启时重新请求词典)
          window.postMessage({ type: '__REQUEST_AUTOCOMPLETE_DICT__' }, '*');
        } else {
          // 꺼졌을 때 기존 사전 초기화 (关闭时初始化现有词典)
          autocompleteDict = [];
        }
      }
    }
    // 실제 사전 데이터 수신 (接收实际词典数据)
    else if (type === '__AUTOCOMPLETE_DICT__') {
      if (alternativeDanbooruAutocomplete) {
        autocompleteDict = data || [];
        // [性能优化] 构建 Map 索引实现 O(1) 查询
        // colorCode → CSS 颜色名映射（与 Autocomplete.getColor 完全一致）
        const colorCodeMap = { '0':'lightblue','1':'indianred','3':'violet','4':'lightgreen','5':'orange','6':'red','7':'lightblue','8':'gold','9':'gold','10':'violet','11':'lightgreen','12':'tomato','14':'whitesmoke','15':'seagreen' };
        autocompleteMap = new Map();
        autocompleteDict.forEach(entry => {
          if (entry && entry.word) {
            // 转换为与 Autocomplete.js 一致的标准化格式
            const normalized = {
              text: entry.word,
              color: colorCodeMap[entry.colorCode] || 'lightblue',
              pop: entry.popCount || 0,
              zh: entry.zhCN || '',
              zhCN: entry.zhCN || '',
              aliases: entry.aliases || []
            };
            // 存入多种格式的键，增加匹配容错
            const lowerTag = entry.word.toLowerCase();
            if (!autocompleteMap.has(lowerTag)) autocompleteMap.set(lowerTag, normalized);
            const clean = entry.word.replace(/_/g, ' ').trim().toLowerCase();
            if (!autocompleteMap.has(clean)) autocompleteMap.set(clean, normalized);
          }
        });
        // 同步给 window 供其他组件使用
        window.__autocompleteDict__ = data;
        window.__autocompleteMap__ = autocompleteMap;
      }
    }
  });



  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Autocomplete Init
    initWildcardAutocomplete_PM();
    // 修正历史预览卡片的 aspect-ratio，避免全部被强制为当前设置分辨率的比例
    initHistoryAspectRatioFixer();
  }

  /**
   * 使用周期扫描策略修正历史预览卡片的比例。
   * 复现 NovelAI 的 fit-to-box 算法：
   *   scale = min(availW / imageW, availH / imageH)
   * availW/availH 来自祖先容器 `.display-grid-images` 的实时 clientRect，
   * 确保每张图片在可用空间内以正确比例完整显示。
   */
  function initHistoryAspectRatioFixer() {
    console.log('[Wildcard] History aspect-ratio fixer v4 starting...');

    /**
     * 向上查找包含 .display-grid-images class 的祖先容器。
     * 该容器是 NovelAI 用于计算图片卡片尺寸的边界盒。
     * 如果找不到则退而求其次使用较近的有尺寸的祖先。
     */
    function getAvailableBox(el) {
      let cur = el.parentElement;
      while (cur && cur !== document.body) {
        if (cur.classList && cur.classList.contains('display-grid-images')) {
          return { w: cur.clientWidth, h: cur.clientHeight, el: cur };
        }
        cur = cur.parentElement;
      }
      // 未找到 .display-grid-images，退而使用图片容器父元素的父元素
      const grandparent = el.parentElement?.parentElement;
      if (grandparent) {
        const rect = grandparent.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 10) {
          return { w: rect.width, h: rect.height, el: grandparent };
        }
      }
      return null;
    }

    function fixContainer(container, trueW, trueH) {
      const box = getAvailableBox(container);
      if (!box || !box.w || !box.h) return;

      // NovelAI 的 fit-to-box 算法：等比缩放图片使其完整适配可用区域
      const scale = Math.min(box.w / trueW, box.h / trueH);
      const newW = trueW * scale;
      const newH = trueH * scale;

      const cw = parseFloat(container.style.width)  || 0;
      const ch = parseFloat(container.style.height) || 0;

      // 误差小于 0.5px 则视为正确，跳过避免抖动
      if (Math.abs(cw - newW) < 0.5 && Math.abs(ch - newH) < 0.5) return;

      container.style.width  = `${newW}px`;
      container.style.height = `${newH}px`;
      console.log(`[Wildcard] Card fixed: ${newW.toFixed(0)}×${newH.toFixed(0)} (image=${trueW}x${trueH}, box=${box.w.toFixed(0)}x${box.h.toFixed(0)})`);
    }

    function scanAll() {
      const imgs = document.querySelectorAll('img.image-grid-image');
      imgs.forEach(img => {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        if (!iw || !ih) return; // 图片未加载完成，跳过

        // 向上 8 层找到有内联 width+height px 的容器（React 写入的尺寸容器）
        let el = img.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          const sw = parseFloat(el.style.width);
          const sh = parseFloat(el.style.height);
          if (sw > 0 && sh > 0) {
            fixContainer(el, iw, ih);
            break;
          }
          el = el.parentElement;
        }
      });
    }

    // 事件驱动触发机制
    // 1. 监听图片的加载完成（处理新生成的图片或首次加载）
    document.addEventListener('load', (e) => {
      if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('image-grid-image')) {
        scanAll();
      }
    }, true); // 捕获阶段

    // 2. 监听 DOM 变化（捕获新图片节点被插入到页面）
    const domObserver = new MutationObserver(mutations => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        // 使用 setTimeout debounce，避免 React 批量插入引发频繁计算
        clearTimeout(window.__arFixerTimer);
        window.__arFixerTimer = setTimeout(scanAll, 100);
      }
    });

    // 寻找 .display-grid-images 容器挂载观察器
    function attachObservers() {
      const displayGrid = document.querySelector('.display-grid-images');
      if (displayGrid) {
        // 监听子节点变动（新图插入）
        domObserver.observe(displayGrid, { childList: true, subtree: true });

        // 3. 监听容器尺寸调整（处理浏览器窗口变化、侧边栏展开折叠等）
        const resizeObserver = new ResizeObserver(() => {
          clearTimeout(window.__arFixerTimer);
          window.__arFixerTimer = setTimeout(scanAll, 50);
        });
        resizeObserver.observe(displayGrid);

        console.log('[NAI-Prompt-All-In-One] History aspect-ratio fixer v5 started (Event-driven).');
      } else {
        // 容器还没渲染出来，稍候重试
        setTimeout(attachObservers, 1000);
      }
    }

    // 初始启动
    setTimeout(() => {
      scanAll();
      attachObservers();
    }, 800);
  }

  /******* 3. Autocomplete ********/
  function initWildcardAutocomplete_PM() {
    if (!document.body) return;

    const STYLE = `
    .wildcard-suggest{
      position:absolute; z-index:2147483647; background:#222; color:#fff;
      border:1px solid #555; border-radius:4px; font-size:12px;
      min-width:260px; max-width:min(720px, calc(100vw - 24px));
      max-height:240px; overflow-y:auto; box-shadow:0 2px 8px #000a;
    }
    .wildcard-suggest li{
      padding:6px 8px; cursor:pointer; display:flex; justify-content:space-between;
      align-items:flex-start; gap:10px; white-space:normal; overflow-wrap:anywhere;
    }
    .wildcard-suggest li.active{background:#444;}
    .wildcard-suggest li.wildcard-suggest-section{
      cursor:default;
      display:block;
      padding:5px 8px 3px;
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:0.08em;
      color:#a5b4fc;
      opacity:0.85;
      border-top:1px solid rgba(255,255,255,0.08);
      background:rgba(255,255,255,0.03);
    }
    .wildcard-suggest li.wildcard-suggest-section:first-child{border-top:none;}
    .wildcard-suggest li.wildcard-back{color:#c4b5fd;}
    .wildcard-suggest li.wildcard-folder{color:#c4b5fd;}
    .wildcard-suggest li.wildcard-file{color:#e5e7eb;}
    .wildcard-suggest li .wildcard-item-label{
      flex:1 1 auto; min-width:0; white-space:normal; overflow-wrap:anywhere;
    }
    .wildcard-suggest li .wildcard-item-meta{
      flex:0 0 auto; display:inline-flex; align-items:center; gap:8px;
      margin-left:auto; opacity:0.65; font-size:0.82em; text-align:right;
    }
    .wildcard-suggest li .wildcard-file-count{opacity:0.9; cursor:pointer;}
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    const seen = new WeakSet();
    const mo = new MutationObserver(scan);
    mo.observe(document, { childList: true, subtree: true });
    
    let lastCharCount = -1;

    function scan() {
      // 1. Hook any new ProseMirror editors
      document.querySelectorAll('div.ProseMirror[contenteditable="true"]')
        .forEach(el => { if (!seen.has(el)) hook(el); });

      // 2. Diff the character count to notify structural changes
      const settingsPanel = document.querySelector('.settings-panel') || document.querySelector('.mobile-tray-contents') || document;
      const currentCharCount = Array.from(settingsPanel.querySelectorAll('.character-prompt-input')).filter(el => el.className.match(/character-prompt-input-\d+/)).length;
      
      if (lastCharCount !== -1 && currentCharCount !== lastCharCount) {
         notifyPromptUpdate();
      }
      lastCharCount = currentCharCount;
    }

    // Globalized to allow both editor structural changes and text updates to trigger a sync
    function notifyPromptUpdate() {
      if (isSyncingFromPopup) return; // Prevent infinite loop when Popup is sending to Page

      const { positive, negative, characters } = getCurrentPrompts();
      window.postMessage({
        type: '__RETURN_PROMPT__',
        data: { positive, negative }
      }, '*');
      
      // Broadcast the characters array as well
      window.postMessage({
        type: '__RETURN_CHARACTER_PROMPTS__',
        data: characters
      }, '*');
    }

    scan();

    function hook(editor) {
      seen.add(editor);

      const list = document.createElement('ul');
      list.className = 'wildcard-suggest';
      list.style.display = 'none';
      document.body.appendChild(list);
      let wildcardPreviewState = null;
      // Autocomplete update
      editor.addEventListener('input', () => {
        wildcardPreviewState = null;
        update();
      });
      // Real-time sync: Page -> Popup
      // Use MutationObserver for robust detection of ALL changes (selection delete, undo/redo, etc.)
      const observer = new MutationObserver(() => notifyPromptUpdate());
      observer.observe(editor, { childList: true, characterData: true, subtree: true });

      // Keep input for immediate feedback
      editor.addEventListener('input', notifyPromptUpdate);



      editor.addEventListener('keydown', nav);
      editor.addEventListener('blur', hide, true);
      editor.addEventListener('blur', hide, true);

      function textBeforeCaret() {
        const sel = window.getSelection();
        if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return '';
        const rng = sel.getRangeAt(0).cloneRange();
        rng.collapse(true);
        rng.setStart(editor, 0);
        return rng.toString();
      }

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

      function formatCount(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n + '';
      }

      function getSelectableItems() {
        return Array.from(list.querySelectorAll('li[data-selectable="true"]'));
      }

      function isWildcardAutocompleteActive() {
        return getSelectableItems().some(item =>
          ['folder', 'file', 'value', 'back'].includes(item.dataset.type)
        );
      }

      function scoreWildcardPathMatch(path, query, leafQuery = query) {
        const normalizedPath = String(path || '').toLowerCase();
        const baseName = getWildcardBaseName(normalizedPath);
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

      function rankWildcardPaths(paths, query, { leafQuery = query, limit = 50, kind = 'file' } = {}) {
        return (paths || [])
          .map(path => ({
            path,
            score: scoreWildcardPathMatch(path, query, leafQuery) + getWildcardUsageBoost(kind, path, query)
          }))
          .filter(item => !query || item.score > 0)
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
          .slice(0, limit)
          .map(item => item.path);
      }

      function buildWildcardSection(title, entries) {
        const normalizedEntries = (entries || []).filter(Boolean);
        if (!normalizedEntries.length) return [];
        return [{ type: 'header', text: title }].concat(normalizedEntries);
      }

      function buildFolderItem(folderPath, prefix, num, displayText) {
        const normalizedFolder = String(folderPath || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedFolder) return null;
        return {
          type: 'folder',
          text: displayText || `${normalizedFolder}/`,
          path: normalizedFolder,
          insertText: `${prefix}${num}__${normalizedFolder}/`
        };
      }

      function buildFileItem(filePath, prefix, num, displayText) {
        const normalizedFile = String(filePath || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedFile) return null;
        const wildcardEntryCount = String(dict?.[normalizedFile] || '')
          .split(/\r?\n/)
          .filter(line => String(line).trim())
          .length;
        return {
          type: 'file',
          text: displayText || normalizedFile,
          path: normalizedFile,
          insertText: `${prefix}${num}__${normalizedFile}__`,
          wildcardEntryCount
        };
      }

      function buildPreviewBackItem(filePath) {
        return {
          type: 'back',
          text: '\u2190 Back',
          path: filePath || ''
        };
      }

      function buildWildcardValuePreviewItems(filePath, limit = 100) {
        const normalizedFile = String(filePath || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedFile) return [];

        const lines = String(dict?.[normalizedFile] || '')
          .split(/\r?\n/)
          .map(line => String(line).trim())
          .filter(Boolean)
          .slice(0, limit)
          .map(line => ({
            type: 'value',
            text: line
          }));

        return [buildPreviewBackItem(normalizedFile)]
          .concat(buildWildcardSection(`Preview: ${normalizedFile}`, lines));
      }

      function openWildcardPreview(filePath) {
        const normalizedFile = String(filePath || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedFile) return;
        wildcardPreviewState = { filePath: normalizedFile };
        render(buildWildcardValuePreviewItems(normalizedFile));
      }

      function closeWildcardPreview() {
        if (!wildcardPreviewState) return false;
        wildcardPreviewState = null;
        update();
        return true;
      }

      function navigateWildcardParent() {
        const txt = textBeforeCaret();
        const m = txt.match(/(?:^|[^A-Za-z0-9])([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]*)$/);
        if (!m) return false;

        const prefix = m[1] || '';
        const num = m[2] || '';
        const normalizedPath = String(m[3] || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedPath) return false;

        const parentPath = getWildcardParentPath(normalizedPath);
        const replacement = `${prefix}${num}__${parentPath ? `${parentPath}/` : ''}`;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;

        const rng = sel.getRangeAt(0);
        let replaceLen = m[0].length;
        if ((m[0].startsWith(' ') || m[0].match(/^[^sS\d_]/))) {
          replaceLen--;
        }
        sel.collapse(rng.endContainer, rng.endOffset);
        for (let i = 0; i < replaceLen; i++) {
          sel.modify('extend', 'backward', 'character');
        }

        wildcardPreviewState = null;
        document.execCommand('insertText', false, replacement);
        setTimeout(update, 0);
        return true;
      }

      function buildWildcardTokenSuggestions(prefix, num, rawQuery) {
        const normalizedQuery = String(rawQuery || '').trim().toLowerCase();
        const fileKeys = Object.keys(dict || {});
        const folderPaths = wildcardFolderList || [];
        const MAX_FOLDER_RESULTS = 20;
        const MAX_FILE_RESULTS = 30;

        if (!normalizedQuery) {
          const topFolders = rankItemsByUsage(
            folderPaths.filter(path => !path.includes('/')),
            'folder',
            MAX_FOLDER_RESULTS
          )
            .map(path => buildFolderItem(path, prefix, num, `${getWildcardBaseName(path)}/`));
          const rootFiles = rankItemsByUsage(
            fileKeys.filter(path => !path.includes('/')),
            'file',
            MAX_FILE_RESULTS
          )
            .map(path => buildFileItem(path, prefix, num, getWildcardBaseName(path)));

          return buildWildcardSection('Folders', topFolders)
            .concat(buildWildcardSection('Files', rootFiles));
        }

        if (!normalizedQuery.includes('/')) {
          const matchedFolders = rankWildcardPaths(folderPaths, normalizedQuery, {
            leafQuery: normalizedQuery,
            kind: 'folder',
            limit: MAX_FOLDER_RESULTS
          }).map(path => buildFolderItem(path, prefix, num, `${path}/`));
          const matchedFiles = rankWildcardPaths(fileKeys, normalizedQuery, {
            leafQuery: normalizedQuery,
            kind: 'file',
            limit: MAX_FILE_RESULTS
          }).map(path => buildFileItem(path, prefix, num, path));

          return buildWildcardSection('Folders', matchedFolders)
            .concat(buildWildcardSection('Files', matchedFiles));
        }

        const lastSlashIdx = normalizedQuery.lastIndexOf('/');
        const currentFolder = normalizedQuery.slice(0, lastSlashIdx).replace(/^\/+|\/+$/g, '');
        const leafQuery = normalizedQuery.slice(lastSlashIdx + 1);
        const folderPrefix = currentFolder ? `${currentFolder}/` : '';

        const directFolders = folderPaths.filter(path => getWildcardParentPath(path).toLowerCase() === currentFolder);
        const directFiles = fileKeys.filter(path => getWildcardParentPath(path).toLowerCase() === currentFolder);

        let folderResults = rankWildcardPaths(directFolders, leafQuery, {
          leafQuery,
          kind: 'folder',
          limit: MAX_FOLDER_RESULTS
        }).map(path => buildFolderItem(path, prefix, num, `${getWildcardBaseName(path)}/`));

        let fileResults = rankWildcardPaths(directFiles, leafQuery, {
          leafQuery,
          kind: 'file',
          limit: MAX_FILE_RESULTS
        }).map(path => buildFileItem(path, prefix, num, getWildcardBaseName(path)));

        if (!folderResults.length && !fileResults.length) {
          const subtreeFolders = folderPaths
            .filter(path => path.toLowerCase().startsWith(folderPrefix))
            .filter(path => path.toLowerCase() !== currentFolder);
          const subtreeFiles = fileKeys
            .filter(path => path.toLowerCase().startsWith(folderPrefix));

          folderResults = rankWildcardPaths(subtreeFolders, normalizedQuery, {
            leafQuery,
            kind: 'folder',
            limit: MAX_FOLDER_RESULTS
          }).map(path => buildFolderItem(path, prefix, num, `${path.slice(folderPrefix.length)}/`));

          fileResults = rankWildcardPaths(subtreeFiles, normalizedQuery, {
            leafQuery,
            kind: 'file',
            limit: MAX_FILE_RESULTS
          }).map(path => buildFileItem(path, prefix, num, path.slice(folderPrefix.length)));
        }

        return buildWildcardSection('Folders', folderResults)
          .concat(buildWildcardSection('Files', fileResults));
      }

      function update() {
        if (isSyncingFromPopup) {
          hide();
          return;
        }
        const txt = textBeforeCaret();

        let m = txt.match(/(?:^|[^A-Za-z0-9])([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__(?:([A-Za-z0-9 \-_\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]*))$/);
        if (m && dict[m[3]]) {
          const prefix = m[1] || '';
          const num = m[2] || '';
          const fileKey = m[3];
          const part = (m[4] || '').toLowerCase();

          const lines = dict[fileKey]
            .replace(/\\\(/g, '(').replace(/\\\)/g, ')')
            .split(/\r?\n/)
            .filter(Boolean)
            .filter(l => l.toLowerCase().includes(part))
            .slice(0, 100);

          if (lines.length) {
            render(lines.map(l => ({ type: 'value', text: l, key: fileKey, prefix: prefix + num })));
            return;
          }
        }

        m = txt.match(/(?:^|[^A-Za-z0-9])([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]*)$/);
        if (m) {
          const prefix = m[1] || '';
          const num = m[2] || '';
          const namePart = m[3] || '';
          const entries = buildWildcardTokenSuggestions(prefix, num, namePart);
          if (entries.length) {
            render(entries);
            return;
          }
        }

        m = txt.match(/([A-Za-z0-9_\-\u4e00-\u9fff]{1,})$/);
        if (m && autocompleteDict.length) {
          const prefix = m[1].toLowerCase();

          const origMatches = autocompleteDict
            .filter(d => d.word.toLowerCase().includes(prefix))
            .map(d => ({
              type: 'dict',
              original: d.word,
              text: d.word,
              zhCN: d.zhCN || '',
              color: colorMap[d.colorCode] || 'red',
              rawCount: d.popCount,
              aliasUsed: false
            }));

          const aliasMatches = autocompleteDict
            .filter(d =>
              !d.word.toLowerCase().includes(prefix) &&
              d.aliases.some(a => a.toLowerCase().includes(prefix))
            )
            .map(d => ({
              type: 'dict',
              original: d.aliases.find(a => a.toLowerCase().includes(prefix)),
              text: d.word,
              zhCN: d.zhCN || '',
              color: colorMap[d.colorCode] || 'red',
              rawCount: d.popCount,
              aliasUsed: true
            }));

          const zhMatches = autocompleteDict
            .filter(d =>
              d.zhCN &&
              d.zhCN.includes(prefix) &&
              !d.word.toLowerCase().includes(prefix) &&
              !d.aliases.some(a => a.toLowerCase().includes(prefix))
            )
            .map(d => ({
              type: 'dict',
              original: d.zhCN,
              text: d.word,
              zhCN: d.zhCN,
              color: colorMap[d.colorCode] || 'red',
              rawCount: d.popCount,
              aliasUsed: true
            }));

          let entries = origMatches.concat(aliasMatches).concat(zhMatches);
          entries.sort((a, b) => b.rawCount - a.rawCount);

          entries = entries
            .slice(0, 50)
            .map(e => ({
              type: e.type,
              original: e.original,
              text: e.text,
              zhCN: e.zhCN,
              color: e.color,
              popCount: formatCount(e.rawCount),
              aliasUsed: e.aliasUsed
            }));

          if (entries.length) {
            render(entries);
            return;
          }
        }

        hide();
      }

      function render(items) {
        list.innerHTML = '';
        items.forEach(({ type, text, color, popCount, aliasUsed, original, zhCN, insertText, path, wildcardEntryCount }, index) => {
          const li = document.createElement('li');
          li.dataset.type = type;
          li.dataset.index = index;
          li.dataset.selectable = type === 'header' ? 'false' : 'true';
          if (insertText) li.dataset.insertText = insertText;
          if (path) li.dataset.path = path;

          if (type === 'header') {
            li.className = 'wildcard-suggest-section';
            li.textContent = text;
          } else if (type === 'dict') {
            li.dataset.insertText = text;
            const displayText = zhCN ? `${text} (${zhCN})` : text;
            const labelSpan = document.createElement('span');
            labelSpan.className = 'wildcard-item-label';
            labelSpan.style.color = color || 'red';
            labelSpan.textContent = aliasUsed ? `${original} -> ${displayText}` : displayText;
            li.appendChild(labelSpan);

            const metaSpan = document.createElement('span');
            metaSpan.className = 'wildcard-item-meta';
            metaSpan.textContent = `(${popCount})`;
            li.appendChild(metaSpan);
          } else {
            if (type === 'back') li.classList.add('wildcard-back');
            if (type === 'folder') li.classList.add('wildcard-folder');
            if (type === 'file') li.classList.add('wildcard-file');
            const labelSpan = document.createElement('span');
            labelSpan.className = 'wildcard-item-label';
            labelSpan.textContent = text;
            li.appendChild(labelSpan);

            if (type === 'file' && typeof wildcardEntryCount === 'number') {
              const metaSpan = document.createElement('span');
              metaSpan.className = 'wildcard-item-meta';
              const countSpan = document.createElement('span');
              countSpan.className = 'wildcard-file-count';
              countSpan.textContent = `${formatCount(wildcardEntryCount)} items`;
              countSpan.title = 'Preview wildcard entries';
              countSpan.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openWildcardPreview(path);
              });
              metaSpan.appendChild(countSpan);
              li.appendChild(metaSpan);
            }
          }

          if (li.dataset.selectable === 'true') {
            li.addEventListener('mousedown', (e) => {
              e.preventDefault();
              choose(e.currentTarget);
            });

            li.addEventListener('mouseenter', () => {
              const selectableItems = getSelectableItems();
              selIdx = selectableItems.indexOf(li);
              highlight();
            });
          }

          list.appendChild(li);
        });

        const selectableItems = getSelectableItems();
        selIdx = selectableItems.length ? 0 : -1;
        highlight();

        const sel = window.getSelection();
        const rng = sel.getRangeAt(0).cloneRange();
        const rect = rng.getBoundingClientRect();
        list.style.left = (rect.left + window.scrollX) + 'px';
        list.style.top = (rect.bottom + window.scrollY + 2) + 'px';
        list.style.display = 'block';
      }

      function nav(e) {
        if (list.style.display === 'none') return;

        const items = getSelectableItems();
        if (!items.length) return;

        if (triggerTab && e.key === 'Tab') {
          e.preventDefault(); choose(items[selIdx]);
        } else if (triggerSpace && e.key === ' ') {
          e.preventDefault(); choose(items[selIdx]);
        } else if (e.key === 'ArrowRight') {
          if (isWildcardAutocompleteActive()) {
            e.preventDefault();
            const activeItem = items[selIdx];
            if (!activeItem) return;
            if (activeItem.dataset.type === 'folder') {
              choose(activeItem);
            } else if (activeItem.dataset.type === 'file') {
              openWildcardPreview(activeItem.dataset.path || '');
            }
          }
        } else if (e.key === 'ArrowLeft') {
          if (isWildcardAutocompleteActive()) {
            e.preventDefault();
            if (wildcardPreviewState) {
              closeWildcardPreview();
            } else {
              navigateWildcardParent();
            }
          }
        } else if (e.key === 'Escape') {
          if (wildcardPreviewState) {
            closeWildcardPreview();
          } else {
            hide();
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); selIdx = (selIdx + 1) % items.length; highlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); selIdx = (selIdx - 1 + items.length) % items.length; highlight();
        }
      }

      function choose(li) {
        if (!li || li.dataset.selectable !== 'true') { hide(); return; }
        const type = li.dataset.type;
        if (type === 'back') {
          closeWildcardPreview();
          return;
        }
        let text = li.dataset.insertText || li.textContent;
        const path = li.dataset.path || '';
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) { hide(); return; }

        const rng = sel.getRangeAt(0);

        const before = rng.cloneRange();
        before.setStart(editor, 0);
        const full = before.toString();

        let len = 0;
        if (type === 'token' || type === 'file' || type === 'folder') {
          const m = full.match(/(?:^|[^A-Za-z0-9])([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]*)$/);
          len = m ? m[0].length : 0;
          if (m && m[0].startsWith(' ') || m && m[0].match(/^[^sS\d_]/)) len--;
        } else if (type === 'value') {
          const m = full.match(/(?:^|[^A-Za-z0-9])([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__(?:[A-Za-z0-9 \-_\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]*)$/);
          len = m ? m[0].length : 0;
          if (m && m[0].startsWith(' ') || m && m[0].match(/^[^sS\d_]/)) len--;
        } else if (type === 'dict') {
          const m = full.match(/[A-Za-z0-9_\-\u4e00-\u9fff]{1,}$/);
          len = m ? m[0].length : 0;

          const rawDictText = li.dataset.insertText || text;
          text = rawDictText;

          // Fallback for older DOM nodes or unexpected markup: strip UI-only metadata.
          if (!li.dataset.insertText) {
            text = text.replace(/\s\([0-9.]+[MK]?\)$/, '');
            if (/(?:->|→)/.test(text)) {
              const parts = text.split(/\s*(?:->|→)\s*/);
              text = parts[parts.length - 1].trim();
            }
            text = text.replace(/\s*\([^\)]*[\u4e00-\u9fff][^\)]*\)$/, '');
          }
          text = text.replace(/_/g, ' ');
        }

        if (len) {
          sel.collapse(rng.endContainer, rng.endOffset);
          for (let i = 0; i < len; i++) {
            sel.modify('extend', 'backward', 'character');
          }
        }

        const needsComma = !['token', 'file', 'folder'].includes(type) && !text.startsWith('__');
        if (type === 'folder' && path) {
          recordWildcardUsageRecords([{ kind: 'folder', path, delta: 1 }]);
        } else if (type === 'file' && path) {
          const records = [{ kind: 'file', path, delta: 1 }];
          let parentPath = getWildcardParentPath(path);
          let folderBoost = 0.6;
          while (parentPath) {
            records.push({ kind: 'folder', path: parentPath, delta: folderBoost });
            parentPath = getWildcardParentPath(parentPath);
            folderBoost = Math.max(0.2, folderBoost - 0.15);
          }
          recordWildcardUsageRecords(records);
        }
        document.execCommand(
          'insertText',
          false,
          needsComma ? `${text}, ` : text
        );
        hide();

        if (type === 'token' || type === 'folder') {
          setTimeout(update, 0);
        }
      }

      function highlight() {
        list.querySelectorAll('li').forEach(li =>
          li.classList.remove('active')
        );
        const items = getSelectableItems();
        if (!items.length || selIdx < 0) return;
        const activeLi = items[selIdx];
        if (activeLi) activeLi.classList.add('active');
        if (activeLi) {
          activeLi.scrollIntoView({ block: 'nearest' });
        }
      }

      function hide() {
        list.style.display = 'none'; selIdx = -1;
      }
    }
  }




  /* -------------------------------------------------
   * 4. Bridge Communication for Popup Editor
   * ------------------------------------------------- */

  /* -------------------------------------------------
   * 4a. Jotai Store 适配层
   * Jotai 只是可选快速路径；DOM 适配层才是当前官网的兼容基线。
   * ------------------------------------------------- */

  const getJotaiStore = () => globalThis.__JOTAI_DEFAULT_STORE__;
  const _atomCache = {};
  const _reportedMissingAtoms = new Set();

  function readPromptStorage(storageKey) {
    const rawValue = localStorage.getItem(storageKey);
    if (rawValue === null) return undefined;
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return rawValue;
    }
  }

  function valuesEqual(left, right) {
    if (left === right) return true;
    if (typeof left !== typeof right) return false;
    if (!left || typeof left !== 'object') return false;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch (error) {
      return false;
    }
  }

  // 只做无副作用识别；候选不唯一时宁可走 DOM，也不再用 set-probe 修改未知 atom。
  function findAtomByKey(storageKey) {
    if (_atomCache[storageKey]) {
      try {
        const cachedStore = getJotaiStore();
        if (cachedStore) {
          cachedStore.get(_atomCache[storageKey]);
          return _atomCache[storageKey];
        }
      } catch (error) {
        delete _atomCache[storageKey];
      }
    }

    const store = getJotaiStore();
    if (!store || !store.dev4_get_mounted_atoms) return null;

    const mounted = Array.from(store.dev4_get_mounted_atoms());
    let atom = mounted.find(function(candidate) {
      try {
        if (String(candidate).includes(storageKey)) return true;
        if (candidate.debugLabel?.includes(storageKey)) return true;
        if (candidate.key === storageKey) return true;
        return Object.keys(candidate).some(key => candidate[key] === storageKey);
      } catch (error) {
        return false;
      }
    });

    if (!atom) {
      const targetValue = readPromptStorage(storageKey);
      const candidates = mounted.filter(function(candidate) {
        if (!candidate.write) return false;
        try {
          return valuesEqual(store.get(candidate), targetValue);
        } catch (error) {
          return false;
        }
      });
      if (candidates.length === 1) atom = candidates[0];
    }

    if (atom) {
      _atomCache[storageKey] = atom;
      _reportedMissingAtoms.delete(storageKey);
    } else if (!_reportedMissingAtoms.has(storageKey)) {
      console.warn('[Jotai] ✗ No atom found for "' + storageKey + '"');
      _reportedMissingAtoms.add(storageKey);
    }
    return atom;
  }

  function trySetPromptThroughJotai(storageKey, value) {
    const store = getJotaiStore();
    const atom = findAtomByKey(storageKey);
    if (store && atom) {
      try {
        store.set(atom, value);
        return true;
      } catch (error) {
        console.warn('[Jotai] store.set failed for "' + storageKey + '":', error);
      }
    }
    return false;
  }

  function persistPromptStorage(storageKey, value) {
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(storageKey, serialized);
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageKey,
        newValue: serialized,
        storageArea: localStorage
      }));
      return true;
    } catch (error) {
      console.error('[Prompt Sync] Failed to persist "' + storageKey + '":', error);
      return false;
    }
  }

  /**
   * 读取当前页面上的所有提示词数据
   * 优先从 Jotai Store 读取（不受 tab 可见性限制），fallback 到 DOM
   */

  function getCurrentPrompts() {
    // 主提示词优先读取官网持久化状态，缺失时再读取当前可见编辑器。
    let positive = readPromptStorage('imagegen-prompt');
    let negative = readPromptStorage('imagegen-negativeprompt');

    if (positive === undefined) {
      positive = domPromptAdapter.readBasePrompt('positive');
    }
    if (negative === undefined) {
      negative = domPromptAdapter.readBasePrompt('negative');
    }

    const result = { positive, negative };

    // 角色结构优先从存储读取，可同时获得正负两侧与位置数据。
    const charAtomData = readPromptStorage('imagegen-character-prompts');
    if (Array.isArray(charAtomData) && charAtomData.length > 0) {
      result.characters = charAtomData.map(function(c) {
        return {
          positive: c.prompt || '',
          negative: c.uc || '',
          gender: 'other',
          activeTab: 'positive'
        };
      });
    } else {
      result.characters = domPromptAdapter.readVisibleCharacterPrompts();
    }

    return attachPromptMetaToResult(result);
  }

  let promptSyncQueue = Promise.resolve();

  // 串行执行基础与角色同步，避免两个消息同时争抢焦点和 ProseMirror Selection。
  function enqueuePromptSync(task) {
    const run = promptSyncQueue.then(task, task);
    const handledRun = run.catch(error => {
      console.error('[Prompt Sync] 同步任务失败:', error);
    });
    promptSyncQueue = handledRun;
    return handledRun;
  }

  window.addEventListener('message', async e => {
    if (e.source !== window) return;
    const { type, data } = e.data || {};

    if (type === '__GET_PROMPT__') {
      const promptState = getCurrentPrompts();
      const { positive, negative, positiveTags, negativeTags, characters } = promptState;
      window.postMessage({
        type: '__RETURN_PROMPT__',
        data: {
          positive,
          negative,
          ...(Array.isArray(positiveTags) ? { positiveTags } : {}),
          ...(Array.isArray(negativeTags) ? { negativeTags } : {})
        }
      }, '*');
      window.postMessage({
        type: '__RETURN_CHARACTER_PROMPTS__',
        data: characters
      }, '*');
    }

    if (type === '__SET_PROMPT__') {
      await enqueuePromptSync(async () => {
        isSyncingFromPopup = true;
        try {
          const { positive, negative } = data || {};
          const domPayload = {};

          for (const [mode, storageKey] of [
            ['positive', 'imagegen-prompt'],
            ['negative', 'imagegen-negativeprompt']
          ]) {
            const value = mode === 'positive' ? positive : negative;
            if (value === undefined) continue;
            const updatedThroughJotai = trySetPromptThroughJotai(storageKey, value);
            if (!updatedThroughJotai) {
              persistPromptStorage(storageKey, value);
              domPayload[mode] = value;
            }
          }

          const domResult = await domPromptAdapter.syncBasePromptsDOM(domPayload);
          if (!domResult.ok) {
            console.error('[Prompt Sync] 基础提示词同步不完整:', domResult.failures);
          }

          // 保存结构化标签元数据，供 popup 回读时恢复 AI 胶囊。
          updateBasePromptMetaCache(data || {});
        } finally {
          setTimeout(() => { isSyncingFromPopup = false; }, 100);
        }
      });
    }

    if (type === '__SET_CHARACTER_PROMPTS__') {
      await enqueuePromptSync(async () => {
        isSyncingFromPopup = true;
        try {
          const charDataList = Array.isArray(data) ? data : [];
          const existingCharacters = readPromptStorage('imagegen-character-prompts');
          const nextCharacters = novelAICompat.normalizeCharacterStorage(
            existingCharacters,
            charDataList
          );
          const updatedThroughJotai = trySetPromptThroughJotai(
            'imagegen-character-prompts',
            nextCharacters
          );

          if (!updatedThroughJotai) {
            persistPromptStorage('imagegen-character-prompts', nextCharacters);
            const domResult = await domPromptAdapter.syncCharacterPromptsDOM(charDataList);
            if (!domResult.ok) {
              console.error('[Prompt Sync] 角色提示词同步不完整:', domResult.failures);
            }
          }

          updateCharacterPromptMetaCache(charDataList);
        } finally {
          setTimeout(() => { isSyncingFromPopup = false; }, 100);
        }
      });
    }

    if (type === '__SWITCH_TAB__') {
      const { tab, index } = data;
      await enqueuePromptSync(async () => {
        const switched = index !== undefined && index >= 0
          ? await domPromptAdapter.switchCharacterTabAt(index, tab)
          : await domPromptAdapter.switchBaseTab(tab);
        if (!switched) {
          console.warn('[Prompt Sync] 无法切换提示词页签:', { tab, index });
        }
      });
    }
  });

  // Poll for active tab changes of Base and Character Prompts to sync back to popup
  let lastActiveTabs = { base: null, chars: [] };
  setInterval(() => {
    const currentBaseTab = domPromptAdapter.getBaseTab();

    if (currentBaseTab && currentBaseTab !== lastActiveTabs.base) {
      lastActiveTabs.base = currentBaseTab;
      window.postMessage({ type: '__SYNC_TAB__', data: { tab: currentBaseTab, index: -1 } }, '*');
    }

    // 仅处理当前响应式布局中可见的角色容器，避免桌面/移动端副本重复计数。
    const currentCharTabs = domPromptAdapter.getCharacterTabStates();

    for (let i = 0; i < currentCharTabs.length; i++) {
      const currentTab = currentCharTabs[i];
      if (currentTab && currentTab !== lastActiveTabs.chars[i]) {
          lastActiveTabs.chars[i] = currentTab;
          window.postMessage({ type: '__SYNC_TAB__', data: { tab: currentTab, index: i } }, '*');
      }
    }

    if (lastActiveTabs.chars.length > currentCharTabs.length) {
      lastActiveTabs.chars.length = currentCharTabs.length;
    }
  }, 500);

  // Export for internal use in hook()
  window.__getCurrentPrompts_PM = getCurrentPrompts;

  console.log('[Wildcard] injector ready');
  console.log('[Wildcard] History Modal module loaded');


})();
