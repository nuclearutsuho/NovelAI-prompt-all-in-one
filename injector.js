// injector.js
(() => {
  const TARGET = 'https://image.novelai.net/ai/generate-image';

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
  let v3 = false;
  let preservePrompt = true;
  let alternativeDanbooruAutocomplete = true;
  let triggerTab = false;
  let triggerSpace = true;

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

    function swap(txt, slotCounters) {
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
          const slotIdx = slotCounters[effectiveKey] || 0;
          slotCounters[effectiveKey] = slotIdx + 1;
          // Aligned key logic: Slot 0 uses 'name', others use 'name:idx'
          const storageKey = slotIdx === 0 ? effectiveKey : `${effectiveKey}:${slotIdx}`;

          // Numeric jump logic
          if (startNum) {
            const jumpTarget = parseInt(startNum, 10) - 1;
            sequentialCounters[storageKey] = jumpTarget % lines.length; // Apply modulo to jump target
            window.postMessage({
              type: '__UPDATE_SEQUENTIAL_COUNTER__',
              name: storageKey,
              value: sequentialCounters[storageKey]
            }, '*');
            pendingUIResync = true;
          }

          const idx = sequentialCounters[storageKey] || 0;
          const picked = lines[idx % lines.length];

          // Increment with wrap-around
          const nextVal = (idx + 1) % lines.length;
          sequentialCounters[storageKey] = nextVal;
          window.postMessage({
            type: '__UPDATE_SEQUENTIAL_COUNTER__',
            name: storageKey,
            value: nextVal
          }, '*');

          return picked;
        }

        if (effectiveV3) {
          // deterministic pick
          return lines[Math.floor(rng() * lines.length)];
        } else {
          // keep as NovelAI dynamic syntax
          return `||${lines.join('|')}||`;
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
      // Per-request slot counters must be consistent for input vs base_caption
      // But we use memoization to ensure same input string gets processed once.
      const slotCounters = {};

      while (containsWildcardSyntax(current) && iteration < 100) {
        const next = swap(current, slotCounters);
        if (next === current) break;
        current = next;
        iteration++;
      }
      return current;
    }

    const memo = new Map();
    const deepSwap = o => {
      if (typeof o === 'string') {
        if (memo.has(o)) return memo.get(o);
        const processed = recursiveSwap(o);
        memo.set(o, processed);
        return processed;
      }
      if (Array.isArray(o)) return o.map(deepSwap);
      if (o && typeof o === 'object') {
        for (const k in o) {
          o[k] = deepSwap(o[k]);
          if (k === 'char_captions' && Array.isArray(o[k]) && o[k].length > 6) {
            o[k] = o[k].slice(0, 6);
          }
        }
        return o;
      }
      return o;
    };

    return { deepSwap, getPendingUIResync: () => pendingUIResync };
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

  /* 2‑A. fetch 패치 (fetch 补丁) */
  const $fetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input.url;
      const m = (init.method || input.method || 'GET').toUpperCase();
      if (m === 'POST' && url.startsWith(TARGET)) {
        let body = init.body || (input instanceof Request ? input.body : null);
        if (body) {
          const txt = typeof body === 'string' ? body
            : await new Response(body).text();
          let json = JSON.parse(txt);

          const seed32 = getSeed32(json);
          const rng = (seed32 != null) ? mulberry32(seed32) : Math.random;
          const swapper = makeDeepSwap(rng);

          /* ① wildcard 치환 (Wildcard 替换) */
          json = swapper.deepSwap(json);

          if (swapper.getPendingUIResync()) {
            setTimeout(cleanNumericPrefixesFromUI, 100);
          }

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

          const newBody = JSON.stringify(json);
          if (typeof input === 'string') {
            init = { ...init, body: newBody };
          } else {
            input = new Request(input, { body: newBody });
          }
        }
      }
    } catch (e) { console.error('[Wildcard] fetch patch error:', e); }
    return $fetch(input, init);
  };

  /* 2‑B. XHR 패치 (XHR 补丁) */
  const $open = XMLHttpRequest.prototype.open;
  const $send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (m, url, ...rest) {
    this.__wild_m = m; this.__wild_u = url;
    return $open.call(this, m, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__wild_m?.toUpperCase() === 'POST' &&
        this.__wild_u?.startsWith(TARGET) &&
        typeof body === 'string') {

        let json = JSON.parse(body);

        /* ① seed 기반 RNG 생성 및 wildcard 치환 (基于 seed 创建 RNG 并替换 wildcard) */
        const seed32 = getSeed32(json);
        const rng = (seed32 != null) ? mulberry32(seed32) : Math.random;
        const swapper = makeDeepSwap(rng);
        json = swapper.deepSwap(json);

        if (swapper.getPendingUIResync()) {
          setTimeout(cleanNumericPrefixesFromUI, 100);
        }

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
    } catch (e) { console.error('[Wildcard] XHR patch error:', e); }
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

    // 옵션 초기화 및 업데이트 처리 (选项初始化及更新处理)
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

          text = text.replace(/\s\([0-9.]+[MK]?\)$/, '');
          if (text.includes('→')) {
            text = text.split('→')[1].trim();
          }
          text = text.replace(/\s*\([^\)]*[\u4e00-\u9fff][^\)]*\)$/, '');
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

  // Helper functions for DOM manipulation
  const findBaseEditor = (selectors, excludeSelector) => {
    const els = document.querySelectorAll(selectors);
    for (let el of els) {
      if (excludeSelector && el.closest(excludeSelector)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el; // Must be visible
    }
    return null;
  };

  const setEditorContent = (editor, text) => {
    if (!editor || typeof text !== 'string') return;

    // Visibility check: Avoid hidden editors (inactive tabs)
    const rect = editor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.addRange(range);

    if (text) {
      document.execCommand('insertText', false, text);
    } else {
      document.execCommand('delete');
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* -------------------------------------------------
   * 4a. Jotai Store 适配层
   * 直接读写 NovelAI 的 React 内部状态，绕过 DOM 可见性限制
   * 当 Jotai Store 不可用时（如 NovelAI 更新后），自动 fallback 到 DOM 操作
   * ------------------------------------------------- */

  // 获取 Jotai Store 引用（NovelAI 在全局暴露了这个对象）
  const getJotaiStore = () => globalThis.__JOTAI_DEFAULT_STORE__;

  // Atom 引用缓存：避免每次都遍历所有已挂载的 atom
  const _atomCache = {};

  /**
   * 通过 localStorage 键名反查对应的 Jotai Atom 引用
   *
   * 原理说明（给初学者）：
   * NovelAI 的代码是混淆过的，atom 对象上没有可读的键名标识。
   * 所以我们需要通过"设置验证法"来精确识别：
   * 1. 先找出所有"值匹配"的候选 atom（可能有多个）
   * 2. 然后逐个测试：临时删除 localStorage 条目 → set 候选 atom →
   *    检查 localStorage 是否被恢复 → 有则找到正确 atom
   *
   * 为什么不用简单的"值匹配"？
   * 因为多个 atom 可能持有相同的值（比如空字符串 ""），
   * 值匹配会找到错误的 atom（如触发 random prompt 的控制 atom）。
   *
   * 找到正确 atom 后会永久缓存，后续调用直接使用缓存，不再遍历。
   */
  function findAtomByKey(storageKey) {
    // 先检查缓存：atom 引用在值变化后仍然有效，缓存可以长期使用
    if (_atomCache[storageKey]) {
      try {
        var store = getJotaiStore();
        if (store) { store.get(_atomCache[storageKey]); return _atomCache[storageKey]; }
      } catch (e) { _atomCache[storageKey] = null; }
    }

    var store = getJotaiStore();
    if (!store || !store.dev4_get_mounted_atoms) return null;

    var mounted = Array.from(store.dev4_get_mounted_atoms());

    // ===  方法1：通过 atom 属性精确匹配（如 toString、debugLabel、key 等） ===
    var atom = mounted.find(function(a) {
      try {
        if (String(a).indexOf(storageKey) !== -1) return true;
        if (a.debugLabel && a.debugLabel.indexOf(storageKey) !== -1) return true;
        if (a.key === storageKey) return true;
        // 检查所有可枚举属性值
        var keys = Object.keys(a);
        for (var i = 0; i < keys.length; i++) {
          if (typeof a[keys[i]] === 'string' && a[keys[i]] === storageKey) return true;
        }
        return false;
      } catch (e) { return false; }
    });

    // === 方法2（核心）：设置验证法 ===
    // 在所有值匹配的候选 atom 中，通过实际 set 操作验证哪个绑定了正确的 localStorage key
    if (!atom) {
      var rawVal = localStorage.getItem(storageKey);
      if (rawVal !== null) {
        var targetVal;
        try { targetVal = JSON.parse(rawVal); } catch (e) { targetVal = rawVal; }

        // 找到所有值匹配的可写候选 atom
        var candidates = mounted.filter(function(a) {
          if (!a.write) return false; // 排除只读 atom，atomWithStorage 一定是可写的
          try {
            var v = store.get(a);
            if (typeof targetVal === 'string' && typeof v === 'string') return v === targetVal;
            if (typeof targetVal === 'object' && typeof v === 'object') {
              return JSON.stringify(v) === JSON.stringify(targetVal);
            }
            return false;
          } catch (e) { return false; }
        });

        console.log('[Jotai] "' + storageKey + '" 候选 atom 数:', candidates.length,
          '(已排除只读 atom)');

        if (candidates.length === 1) {
          // 只有一个候选，大概率就是它
          atom = candidates[0];
        } else if (candidates.length > 1) {
          // 多个候选：逐个验证哪个 atom 的 set 操作会更新这个 localStorage key
          // 原理：atomWithStorage 的 write 函数内部会调用 localStorage.setItem(key, ...)
          // 只有绑定了正确 key 的 atom 才会更新对应的 localStorage 条目
          var savedLs = localStorage.getItem(storageKey);
          for (var i = 0; i < candidates.length; i++) {
            try {
              // 临时删除 localStorage 条目
              localStorage.removeItem(storageKey);
              // 对候选 atom 执行 set（设置相同的值，不影响 UI）
              store.set(candidates[i], targetVal);
              // 检查 localStorage 是否被恢复（说明此 atom 绑定了这个 key）
              var restoredLs = localStorage.getItem(storageKey);
              if (restoredLs !== null) {
                atom = candidates[i];
                console.log('[Jotai] ✓ Atom for "' + storageKey +
                  '" verified via set-probe (candidate ' + (i + 1) + '/' + candidates.length + ')');
                break;
              }
            } catch (e) { /* continue to next candidate */ }
          }
          // 确保 localStorage 恢复
          if (!atom && localStorage.getItem(storageKey) === null) {
            localStorage.setItem(storageKey, savedLs);
          }
        }
      }
    }

    if (atom) {
      _atomCache[storageKey] = atom;
      console.log('[Jotai] ✓ Cached atom for "' + storageKey + '"');
    } else {
      console.warn('[Jotai] ✗ No atom found for "' + storageKey + '"');
    }
    return atom;
  }

  /**
   * 从 Jotai Store 读取指定 atom 的值
   * 直接从 localStorage 读取 — 最可靠，不需要查找 atom
   * （atomWithStorage 会自动同步 atom 值到 localStorage）
   */
  function jotaiGet(storageKey) {
    var rawVal = localStorage.getItem(storageKey);
    if (rawVal !== null) {
      try { return JSON.parse(rawVal); } catch (e) { return rawVal; }
    }
    return undefined;
  }

  /**
   * 通过 Jotai Store 修改指定 atom 的值
   * 修改后 React 组件（包括 ProseMirror 编辑器）会通过 useEffect 自动同步更新
   *
   * 写入策略（按优先级）：
   * 1. 找到正确的 atom → store.set() 直接更新 React 状态
   * 2. atom 找不到 → 写 localStorage + 触发 StorageEvent 让 Jotai 感知
   */
  function jotaiSet(storageKey, value) {
    // 策略1：直接通过 Jotai atom 写入（最佳，能立即触发 React 渲染）
    var store = getJotaiStore();
    var atom = findAtomByKey(storageKey);
    if (store && atom) {
      try {
        store.set(atom, value);
        return true;
      } catch (e) {
        console.warn('[Jotai] store.set failed for "' + storageKey + '":', e);
      }
    }

    // 策略2：写 localStorage + StorageEvent（让 Jotai 的 subscribe 回调感知变化）
    // 原理：atomWithStorage 内部通过 window.addEventListener('storage', ...) 监听
    // 虽然原生 storage 事件只在跨 tab 时触发，但手动 dispatch 可以在当前 tab 触发
    try {
      var serialized = JSON.stringify(value);
      localStorage.setItem(storageKey, serialized);
      window.dispatchEvent(new StorageEvent('storage', {
        key: storageKey,
        newValue: serialized,
        storageArea: localStorage
      }));
      console.log('[Jotai] Wrote to localStorage + dispatched StorageEvent for "' + storageKey + '"');
      return true;
    } catch (e) {
      console.error('[Jotai] All write methods failed for "' + storageKey + '":', e);
      return false;
    }
  }

  /**
   * 读取当前页面上的所有提示词数据
   * 优先从 Jotai Store 读取（不受 tab 可见性限制），fallback 到 DOM
   */

  function getCurrentPrompts() {
    // === 主提示词：优先从 Jotai 读取 ===
    let positive = jotaiGet('imagegen-prompt');
    let negative = jotaiGet('imagegen-negativeprompt');

    // Fallback：Jotai 不可用时从 DOM 读取（仅能读到当前可见 tab 的内容）
    if (positive === undefined) {
      const posEl = findBaseEditor(
        '.prompt-input-box-base-prompt .ProseMirror, .image-gen-prompt-main .prompt-input-box-prompt .ProseMirror, .prompt-input-box-prompt .ProseMirror',
        '.character-prompt-input'
      );
      positive = posEl ? (posEl.innerText || posEl.textContent || '').trim() : undefined;
    }
    if (negative === undefined) {
      const negEl = findBaseEditor(
        '.prompt-input-box-undesired-content .ProseMirror',
        '.character-prompt-input'
      );
      negative = negEl ? (negEl.innerText || negEl.textContent || '').trim() : undefined;
    }

    const result = { positive, negative };

    // === 角色提示词：优先从 Jotai 读取 ===
    const charAtomData = jotaiGet('imagegen-character-prompts');
    if (Array.isArray(charAtomData) && charAtomData.length > 0) {
      // 从 Jotai atom 直接读取，结构：{ prompt, uc, center, enabled }
      // Jotai 读取不依赖 tab 可见状态，能同时获得 positive 和 negative
      result.characters = charAtomData.map(function(c) {
        return {
          positive: c.prompt || '',
          negative: c.uc || '',
          gender: 'other',
          activeTab: 'positive'
        };
      });
    } else {
      // Fallback：从 DOM 读取角色提示词（受 tab 可见性限制）
      const charPrompts = [];
      const settingsPanel = document.querySelector('.settings-panel') || document.querySelector('.mobile-tray-contents') || document;
      const charContainers = Array.from(settingsPanel.querySelectorAll('.character-prompt-input'));

      charContainers.forEach(function(charContainer) {
        const rect = charContainer.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const pm = charContainer.querySelector('.ProseMirror');
        const getVal = function(el) { return el ? (el.innerText || el.textContent || '').trim() : undefined; };
        const btns = Array.from(charContainer.querySelectorAll('button'));
        const activeBtn = btns.find(function(btn) {
          return (btn.textContent.includes('Prompt') || btn.textContent.includes('Base Prompt') || btn.textContent.includes('Undesired'))
            && btn.parentElement
            && parseFloat(window.getComputedStyle(btn.parentElement).opacity) > 0.9;
        });
        const isUndesired = activeBtn && activeBtn.textContent.includes('Undesired');

        charPrompts.push({
          positive: isUndesired ? undefined : getVal(pm),
          negative: isUndesired ? getVal(pm) : undefined,
          gender: 'other',
          activeTab: isUndesired ? 'negative' : 'positive'
        });
      });
      result.characters = charPrompts;
    }

    return attachPromptMetaToResult(result);
  }

  window.addEventListener('message', e => {
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
      isSyncingFromPopup = true;
      try {
        const { positive, negative } = data || {};

        // 优先使用 Jotai 直接写入（不受 tab 可见性限制）
        // Jotai 写入后，ProseMirror 编辑器会通过 React 的 useEffect 自动同步
        let posOk = positive !== undefined && jotaiSet('imagegen-prompt', positive);
        let negOk = negative !== undefined && jotaiSet('imagegen-negativeprompt', negative);

        // Fallback：Jotai 不可用时退回 DOM 操作（仅适用于当前可见的 tab）
        if (!posOk && positive !== undefined) {
          const posEl = findBaseEditor(
            '.prompt-input-box-base-prompt .ProseMirror, .image-gen-prompt-main .prompt-input-box-prompt .ProseMirror, .prompt-input-box-prompt .ProseMirror',
            '.character-prompt-input'
          );
          if (posEl) setEditorContent(posEl, positive);
        }
        if (!negOk && negative !== undefined) {
          const negEl = findBaseEditor(
            '.prompt-input-box-undesired-content .ProseMirror',
            '.character-prompt-input'
          );
          if (negEl) setEditorContent(negEl, negative);
        }

        // 保存结构化标签元数据，供 popup 回读时恢复 AI 胶囊。
        updateBasePromptMetaCache(data || {});
      } finally {
        setTimeout(() => { isSyncingFromPopup = false; }, 100);
      }
    }

    if (type === '__SET_CHARACTER_PROMPTS__') {
      isSyncingFromPopup = true;
      try {
        const charDataList = data || [];

        // === 优先使用 Jotai 直接写入角色提示词 ===
        const charAtomData = jotaiGet('imagegen-character-prompts');
        if (Array.isArray(charAtomData)) {
          // 创建副本（React 要求新引用才能检测到变化）
          const newChars = [...charAtomData];

          // 调整角色数量：增加缺少的角色
          while (newChars.length < charDataList.length) {
            newChars.push({ prompt: '', uc: '', center: { x: 0.5, y: 0.5 }, enabled: true });
          }
          // 删除多余的角色
          while (newChars.length > charDataList.length) {
            newChars.pop();
          }

          // 更新每个角色的提示词文本
          for (let i = 0; i < charDataList.length; i++) {
            const src = charDataList[i];
            newChars[i] = {
              ...newChars[i],
              prompt: src.positive !== undefined ? src.positive : newChars[i].prompt,
              uc: src.negative !== undefined ? src.negative : newChars[i].uc
            };
          }

          const ok = jotaiSet('imagegen-character-prompts', newChars);
          if (ok) {
            updateCharacterPromptMetaCache(charDataList);
            console.log('[Jotai] 角色提示词已通过 Jotai 写入，共', newChars.length, '个角色');
            setTimeout(() => { isSyncingFromPopup = false; }, 100);
            return; // Jotai 写入成功，无需 DOM 操作
          }
        }

        // === Fallback：Jotai 不可用时使用原有的 DOM 操作 ===
        const syncCharactersDOM = async (charList) => {
          if (!Array.isArray(charList)) return;
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          const settingsPanel = document.querySelector('.settings-panel') || document.querySelector('.mobile-tray-contents') || document;

          let getCharContainers = () => Array.from(settingsPanel.querySelectorAll('.character-prompt-input')).filter(el => el.className.match(/character-prompt-input-\d+/));
          let charContainers = getCharContainers();

          // 1. 添加缺少的角色（模拟点击 Add Character 按钮）
          while (charContainers.length < charList.length) {
            const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Character') || b.textContent.includes('添加角色') || b.textContent.includes('キャラの追加'));
            if (addBtn) {
              addBtn.click();
              await wait(100);
              const otherBtn = Array.from(document.querySelectorAll('button, div')).find(el => el.textContent === 'Other' && window.getComputedStyle(el).cursor === 'pointer');
              if (otherBtn) { otherBtn.click(); await wait(100); }
              charContainers = getCharContainers();
            } else { break; }
          }

          // 2. 删除多余的角色（模拟点击删除按钮）
          while (charContainers.length > charList.length) {
            const lastChar = charContainers[charContainers.length - 1];
            const delBtn = Array.from(lastChar.querySelectorAll('button')).find(btn => {
              const iconDiv = btn.querySelector('div');
              if (!iconDiv) return false;
              const style = window.getComputedStyle(iconDiv);
              const mask = style.maskImage || style.webkitMaskImage || style.getPropertyValue('-webkit-mask-image') || '';
              return mask.includes('trash');
            }) || lastChar.querySelector('button.dcscxb');
            if (delBtn) { delBtn.click(); await wait(100); charContainers = getCharContainers(); }
            else { break; }
          }

          // 3. 写入每个角色当前可见 tab 的提示词
          for (let i = 0; i < charList.length; i++) {
            if (i >= charContainers.length) break;
            const container = charContainers[i];
            const charData = charList[i];
            const pm = container.querySelector('.ProseMirror');
            if (!pm) continue;

            const targetText = charData.activeTab === 'negative' ? charData.negative : charData.positive;
            if (targetText !== undefined) setEditorContent(pm, targetText);
          }
        };

        updateCharacterPromptMetaCache(charDataList);

        syncCharactersDOM(charDataList).finally(() => {
          setTimeout(() => { isSyncingFromPopup = false; }, 100);
        });
      } catch (err) {
        console.error('[Jotai/DOM] Sync char err:', err);
        isSyncingFromPopup = false;
      }
    }

    if (type === '__SWITCH_TAB__') {
      const { tab, index } = data;
      const isNegative = tab === 'negative';
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      
      const processSwitch = async () => {
        let containerContext = document;
        let targetTexts = isNegative ? ['Undesired Content'] : ['Prompt'];

        if (index !== undefined && index >= 0) {
            // NovelAI character containers are sometimes non-sequential in class names, 
            // but we now use a more robust way to find the nth visible .character-prompt-input
            const allChars = Array.from(document.querySelectorAll('.character-prompt-input'));
            const container = allChars[index];
            if (!container) return;
            
            containerContext = container;

            // --- THE "WAKE UP" LOGIC ---
            // If the character is collapsed, the buttons/ProseMirror might be height 0 or non-existent
            let pm = container.querySelector('.ProseMirror');
            if (!pm || pm.getBoundingClientRect().height === 0) {
                const trigger = container.querySelector('[class*="prompt-input-box-character-prompts-"]') ||
                                container.querySelector('div[role="textbox"]') || 
                                (pm ? pm.parentElement : container);
                if (trigger) trigger.click();
                
                // Wait for it to expand
                for(let w=0; w<6; w++) {
                    await wait(50);
                    pm = container.querySelector('.ProseMirror');
                    if (pm && pm.getBoundingClientRect().height > 0) break;
                }
            }
        } else {
            const baseContainer = document.querySelector('.image-gen-prompt-main');
            if (baseContainer) containerContext = baseContainer;
            if (!isNegative) targetTexts = ['Base Prompt', 'Prompt'];
        }

        const btn = Array.from(containerContext.querySelectorAll('button'))
          .find(el => {
              const text = el.textContent.trim();
              return targetTexts.includes(text);
          });
          
        if (btn) btn.click();
      };
      
      processSwitch();
    }
  });

  // Poll for active tab changes of Base and Character Prompts to sync back to popup
  let lastActiveTabs = { base: null, chars: [] };
  setInterval(() => {
    // 1. Process Base Prompt
    const baseContainer = document.querySelector('.image-gen-prompt-main') || document;

    const isBasePromptActive = (() => {
      const btn = Array.from(baseContainer.querySelectorAll('button'))
        .find(el => {
            const t = el.textContent.trim();
            return t === 'Prompt' || t === 'Base Prompt';
        });
      return !!(btn && parseFloat(window.getComputedStyle(btn.parentElement).opacity) > 0.9);
    })();

    const isBaseUndesiredActive = (() => {
      const btn = Array.from(baseContainer.querySelectorAll('button'))
        .find(el => el.textContent.trim() === 'Undesired Content');
      return !!(btn && parseFloat(window.getComputedStyle(btn.parentElement).opacity) > 0.9);
    })();

    let currentBaseTab = null;
    if (isBasePromptActive) currentBaseTab = 'positive';
    else if (isBaseUndesiredActive) currentBaseTab = 'negative';

    if (currentBaseTab && currentBaseTab !== lastActiveTabs.base) {
      lastActiveTabs.base = currentBaseTab;
      window.postMessage({ type: '__SYNC_TAB__', data: { tab: currentBaseTab, index: -1 } }, '*');
    }
    
    // 2. Process Character Prompts
    const currentCharTabs = [];
    const charContainers = Array.from(document.querySelectorAll('.character-prompt-input'));
    
    charContainers.forEach((container, idx) => {
       const isPos = Array.from(container.querySelectorAll('button')).find(el => (el.textContent.includes('Prompt') || el.textContent.includes('Base Prompt')) && !el.textContent.includes('Undesired') && el.parentElement && parseFloat(window.getComputedStyle(el.parentElement).opacity) > 0.9);
       const isNeg = Array.from(container.querySelectorAll('button')).find(el => el.textContent.includes('Undesired') && el.parentElement && parseFloat(window.getComputedStyle(el.parentElement).opacity) > 0.9);
       
       const tabStatus = isPos ? 'positive' : (isNeg ? 'negative' : null);
       if (tabStatus) {
           currentCharTabs[idx] = tabStatus;
       }
    });

    for (let i = 0; i < currentCharTabs.length; i++) {
       const currentTab = currentCharTabs[i];
       if (currentTab && currentTab !== lastActiveTabs.chars[i]) {
          lastActiveTabs.chars[i] = currentTab;
          // Send 0-indexed back to popup
          window.postMessage({ type: '__SYNC_TAB__', data: { tab: currentTab, index: i } }, '*');
       }
    }
    
    // Cleanup removed characters from memory
    if (lastActiveTabs.chars.length > currentCharTabs.length) {
        lastActiveTabs.chars.length = currentCharTabs.length;
    }
  }, 500);

  // Export for internal use in hook()
  window.__getCurrentPrompts_PM = getCurrentPrompts;

  console.log('[Wildcard] injector ready');
  console.log('[Wildcard] History Modal module loaded');


})();
