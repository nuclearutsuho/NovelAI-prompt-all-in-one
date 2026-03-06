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
  let sequentialCounters = {};
  let v3 = false;
  let preservePrompt = true;
  let alternativeDanbooruAutocomplete = true;
  let triggerTab = false;
  let triggerSpace = true;

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
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, map, v3: newV3, preservePrompt: newPreserve, alternativeDanbooruAutocomplete: newAlt, triggerTab: newTab, triggerSpace: newSpace, data } = e.data || {};

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
      max-height:240px; overflow-y:auto; box-shadow:0 2px 8px #000a;
    }
    .wildcard-suggest li{padding:3px 8px; cursor:pointer; white-space:nowrap;}
    .wildcard-suggest li.active{background:#444;}
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
      // Autocomplete update
      editor.addEventListener('input', update);
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
          const namePart = m[3].toLowerCase();
          const allKeys = Object.keys(dict)

          const folderKeys = allKeys.filter(k => k.toLowerCase().startsWith(namePart + '/'));
          if (folderKeys.length && !namePart.includes('/')) {
            render(folderKeys.map(k => ({ type: 'token', text: `${prefix}${num}__${k}__` })));
            return;
          }

          const keys = allKeys.filter(k => k.toLowerCase().includes(namePart))
            .sort();
          if (keys.length) {
            render(keys.map(k => ({ type: 'token', text: `${prefix}${num}__${k}__` })));
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
        items.forEach(({ type, text, color, popCount, aliasUsed, original, zhCN }, index) => {
          const li = document.createElement('li');
          li.dataset.type = type;
          li.dataset.index = index;

          if (type === 'dict') {
            li.style.color = color || 'red';
            const displayText = zhCN ? `${text} (${zhCN})` : text;
            if (aliasUsed) {
              li.innerHTML = `<span style="color:${color};">${original} → ${displayText}</span> <span style="opacity:0.6;font-size:0.8em;">(${popCount})</span>`;
            } else {
              li.innerHTML = `<span style="color:${color};">${displayText}</span> <span style="opacity:0.6;font-size:0.8em;">(${popCount})</span>`;
            }
          } else {
            li.textContent = text;
          }

          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(e.currentTarget);
          });

          li.addEventListener('mouseenter', () => {
            selIdx = index;
            highlight();
          });

          list.appendChild(li);
        });

        selIdx = 0;
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

        const items = list.querySelectorAll('li');
        if (!items.length) return;

        if (triggerTab && e.key === 'Tab') {
          e.preventDefault(); choose(items[selIdx]);
        } else if (triggerSpace && e.key === ' ') {
          e.preventDefault(); choose(items[selIdx]);
        } else if (e.key === 'Escape') {
          hide();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); selIdx = (selIdx + 1) % items.length; highlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); selIdx = (selIdx - 1 + items.length) % items.length; highlight();
        }
      }

      function choose(li) {
        const type = li.dataset.type;
        let text = li.textContent;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) { hide(); return; }

        const rng = sel.getRangeAt(0);

        const before = rng.cloneRange();
        before.setStart(editor, 0);
        const full = before.toString();

        let len = 0;
        if (type === 'token') {
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

        const needsComma = !text.startsWith('__');
        document.execCommand(
          'insertText',
          false,
          needsComma ? `${text}, ` : text
        );
        hide();

        if (type === 'token') {
          setTimeout(update, 0);
        }
      }

      function highlight() {
        list.querySelectorAll('li').forEach((li, i) =>
          li.classList.toggle('active', i === selIdx)
        );
        const activeLi = list.querySelector('li.active');
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

  // 查找基础编辑器（允许隐藏元素，用于读取不可见标签页的内容）
  const findBaseEditorAny = (selectors, excludeSelector) => {
    const els = document.querySelectorAll(selectors);
    for (let el of els) {
      if (excludeSelector && el.closest(excludeSelector)) continue;
      return el; // 不检查可见性，直接返回第一个匹配
    }
    return null;
  };

  // 从元素中读取文本（优先用 textContent，因为 innerText 对隐藏元素返回空串）
  const getTextFromEl = el => {
    if (!el) return undefined;
    // textContent 不受 CSS visibility 影响，对隐藏元素也能正确读取
    const text = (el.textContent || '').trim();
    return text || undefined; // 空字符串返回 undefined，以便区分"没有"和"为空"
  };

  // 缓存最后已知的 negative 值
  let _cachedNegative = undefined;
  let _cachedCharPrompts = {};

  function getCurrentPrompts() {
    let posEl = findBaseEditor('.prompt-input-box-base-prompt .ProseMirror, .image-gen-prompt-main .prompt-input-box-prompt .ProseMirror, .prompt-input-box-prompt .ProseMirror', '.character-prompt-input');
    
    // 先找可见的 negative 编辑器，再找隐藏的
    let negEl = findBaseEditor('.prompt-input-box-undesired-content .ProseMirror', '.character-prompt-input');
    if (!negEl) {
      negEl = findBaseEditorAny('.prompt-input-box-undesired-content .ProseMirror', '.character-prompt-input');
    }

    const getVal = el => el ? (el.innerText || el.textContent || '').trim() : undefined;

    // 对 negative 使用 textContent 优先（隐藏元素友好）
    const negValue = negEl ? getTextFromEl(negEl) : undefined;
    // 更新缓存：仅当成功读取到非空内容时更新
    if (negValue !== undefined) {
      _cachedNegative = negValue;
    }

    const result = {
      positive: getVal(posEl),
      negative: negValue !== undefined ? negValue : (_cachedNegative !== undefined ? _cachedNegative : undefined)
    };

    // Extract Character Prompts
    const charPrompts = [];
    const settingsPanel = document.querySelector('.settings-panel') || document.querySelector('.mobile-tray-contents') || document;
    const charContainers = Array.from(settingsPanel.querySelectorAll('.character-prompt-input'));
    
    charContainers.forEach((charContainer, idx) => {
      const rect = charContainer.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const pm = charContainer.querySelector('.ProseMirror');
      const btns = Array.from(charContainer.querySelectorAll('button'));
      const activeBtn = btns.find(btn => 
        (btn.textContent.includes('Prompt') || btn.textContent.includes('Base Prompt') || btn.textContent.includes('Undesired')) 
        && btn.parentElement 
        && parseFloat(window.getComputedStyle(btn.parentElement).opacity) > 0.9
      );
      const isUndesired = activeBtn && activeBtn.textContent.includes('Undesired');

      const currentVal = getVal(pm);

      if (!_cachedCharPrompts[idx]) _cachedCharPrompts[idx] = {};
      if (isUndesired) {
        _cachedCharPrompts[idx].negative = currentVal;
      } else {
        _cachedCharPrompts[idx].positive = currentVal;
      }

      charPrompts.push({
        positive: isUndesired ? _cachedCharPrompts[idx].positive : currentVal,
        negative: isUndesired ? currentVal : _cachedCharPrompts[idx].negative,
        gender: 'other',
        activeTab: isUndesired ? 'negative' : 'positive'
      });
    });
    result.characters = charPrompts;

    return result;
  }

  /**
   * 启动预热：复用 __SWITCH_TAB__ 的按钮查找逻辑，
   * 快速切到 Undesired Content 读取内容后切回。
   * 在页面加载后延迟执行，确保 DOM 已就绪。
   */
  let _warmupDone = false;

  async function warmupNegativePrompt() {
    if (_warmupDone) return;
    _warmupDone = true;

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // === 主提示词区域 ===
    const baseContainer = document.querySelector('.image-gen-prompt-main') || document;
    const baseBtns = Array.from(baseContainer.querySelectorAll('button'));

    const undesiredBtn = baseBtns.find(el => el.textContent.trim() === 'Undesired Content');
    const promptBtn = baseBtns.find(el => {
      const t = el.textContent.trim();
      return t === 'Base Prompt' || t === 'Prompt';
    });

    if (undesiredBtn && promptBtn) {
      console.log('[Wildcard] Warmup: switching to Undesired Content...');
      undesiredBtn.click();
      await wait(200);

      // 读取 negative 编辑器内容
      const negEl = findBaseEditor('.prompt-input-box-undesired-content .ProseMirror', '.character-prompt-input')
                 || findBaseEditorAny('.prompt-input-box-undesired-content .ProseMirror', '.character-prompt-input');
      if (negEl) {
        const text = (negEl.innerText || negEl.textContent || '').trim();
        _cachedNegative = text;
        console.log('[Wildcard] Warmup: negative prompt cached (' + text.length + ' chars)');
      }

      // 切回 positive
      promptBtn.click();
      await wait(50);
      console.log('[Wildcard] Warmup: switched back to Prompt');
    } else {
      console.log('[Wildcard] Warmup: buttons not found. undesired:', !!undesiredBtn, 'prompt:', !!promptBtn);
    }

    // === 角色提示词区域 ===
    const charContainers = Array.from(document.querySelectorAll('.character-prompt-input'));
    for (let idx = 0; idx < charContainers.length; idx++) {
      const container = charContainers[idx];
      const btns = Array.from(container.querySelectorAll('button'));
      const charUndesiredBtn = btns.find(el => el.textContent.trim() === 'Undesired Content');
      const charPromptBtn = btns.find(el => {
        const t = el.textContent.trim();
        return t === 'Base Prompt' || t === 'Prompt';
      });

      if (charUndesiredBtn && charPromptBtn) {
        charUndesiredBtn.click();
        await wait(200);
        const pm = container.querySelector('.ProseMirror');
        if (pm) {
          if (!_cachedCharPrompts[idx]) _cachedCharPrompts[idx] = {};
          _cachedCharPrompts[idx].negative = (pm.innerText || pm.textContent || '').trim();
        }
        charPromptBtn.click();
        await wait(50);
      }
    }
  }

  // 智能预热启动器：等待 DOM 就绪且用户未在输入时启动预热
  function initWarmup() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (_warmupDone || attempts > 120) { // 60 秒后放弃尝试
        clearInterval(interval);
        return;
      }

      // 等待主生成区域加载
      const baseContainer = document.querySelector('.image-gen-prompt-main');
      if (!baseContainer) return;

      // 确保相关标签切换按钮已渲染
      const btns = Array.from(baseContainer.querySelectorAll('button'));
      const undesiredBtn = btns.find(el => el.textContent.trim() === 'Undesired Content');
      if (!undesiredBtn) return;

      // 检查用户是否正在与界面交互，如果是则推迟预热，防止打断输入
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable || 
        activeEl.closest('.ProseMirror')
      )) {
        return;
      }

      // 条件满足，开始预热
      clearInterval(interval);
      warmupNegativePrompt();
    }, 500);
  }

  // 启动智能预热监听
  initWarmup();

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, data } = e.data || {};

    if (type === '__GET_PROMPT__') {
      const { positive, negative, characters } = getCurrentPrompts();
      window.postMessage({
        type: '__RETURN_PROMPT__',
        data: { positive, negative }
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
        
        let posEl = findBaseEditor('.prompt-input-box-base-prompt .ProseMirror, .image-gen-prompt-main .prompt-input-box-prompt .ProseMirror, .prompt-input-box-prompt .ProseMirror', '.character-prompt-input');
        
        let negEl = findBaseEditor('.prompt-input-box-undesired-content .ProseMirror', '.character-prompt-input');

        if (positive !== undefined && posEl) setEditorContent(posEl, positive);
        if (negative !== undefined && negEl) setEditorContent(negEl, negative);
      } finally {
        // Use timeout to ensure all immediate side effects (like 'input' events) are processed
        setTimeout(() => { isSyncingFromPopup = false; }, 100);
      }
    }

    // --- STAGE 6: GLOBAL SYNC TRACKER ---
    // Stores the last known state of each character to avoid redundant clicks/focus-stealing
    if (typeof window.lastSyncCharactersState === 'undefined') {
        window.lastSyncCharactersState = [];
    }

    if (type === '__SET_CHARACTER_PROMPTS__') {
      isSyncingFromPopup = true;
      try {
        const charDataList = data || [];
        const syncCharactersDOM = async (charList) => {
          if (!Array.isArray(charList)) return;
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          const settingsPanel = document.querySelector('.settings-panel') || document.querySelector('.mobile-tray-contents') || document;
          
          let getCharContainers = () => Array.from(settingsPanel.querySelectorAll('.character-prompt-input')).filter(el => el.className.match(/character-prompt-input-\d+/));
          let charContainers = getCharContainers();
          // 1. Add missing characters
          while (charContainers.length < charList.length) {
              const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Character') || b.textContent.includes('添加角色') || b.textContent.includes('キャラの追加'));
              if (addBtn) {
                  addBtn.click();
                  await wait(100); 
                  
                  // Auto-click "Other" if gender popup appears
                  const otherBtn = Array.from(document.querySelectorAll('button, div')).find(el => el.textContent === 'Other' && window.getComputedStyle(el).cursor === 'pointer');
                  if(otherBtn) {
                      otherBtn.click();
                      await wait(100);
                  }
                  charContainers = getCharContainers();
              } else {
                  console.warn('[Phase 4] React "Add Character" btn not found');
                  break;
              }
          }
          
          // 2. Remove excess characters
          while (charContainers.length > charList.length) {
              const lastChar = charContainers[charContainers.length - 1];
              
              // Searching for X button.
              // NovelAI uses CSS mask-image for icons, not direct SVGs!
              const delBtn = Array.from(lastChar.querySelectorAll('button')).find(btn => {
                  const iconDiv = btn.querySelector('div');
                  if (!iconDiv) return false;
                  const style = window.getComputedStyle(iconDiv);
                  const mask = style.maskImage || style.webkitMaskImage || style.getPropertyValue('-webkit-mask-image') || '';
                  return mask.includes('trash');
              }) || lastChar.querySelector('button.dcscxb'); // Fallback
                   
              if (delBtn) {
                  delBtn.click();
                  await wait(100);
                  charContainers = getCharContainers();
              } else {
                  console.warn('[Phase 4] React Delete character btn not found');
                  break; 
              }
          }
          
          // 3. Inject text data into active ProseMirror for each character
           for (let i = 0; i < charList.length; i++) {
               if (i >= charContainers.length) break;
               const container = charContainers[i];
               const charData = charList[i];
               
               // --- STAGE 6: DIFF CHECK ---
               const lastState = window.lastSyncCharactersState[i] || {};
               const isSame = lastState.positive === charData.positive &&
                              lastState.negative === charData.negative &&
                              lastState.activeTab === charData.activeTab;

               if (isSame) continue; // Skip identical to save focus

               // Helper: Find or Wake up ProseMirror (Localized inside loop for context)
               const getOrWakeEditor = async () => {
                   let pm = container.querySelector('.ProseMirror');
                   if (pm && pm.getBoundingClientRect().height > 0) return pm;
                   const inputBox = container.querySelector('[class*="prompt-input-box-character-prompts-"]') ||
                                    container.querySelector('div[role="textbox"]') || 
                                    (pm ? pm.parentElement : container); 
                   if (inputBox) inputBox.click();
                   for(let waitIdx=0; waitIdx<6; waitIdx++) {
                       await wait(50);
                       pm = container.querySelector('.ProseMirror');
                       if (pm && pm.getBoundingClientRect().height > 0) return pm;
                   }
                   return null;
               };

               const pm = await getOrWakeEditor();
               if (!pm) continue;

               const targetTab = charData.activeTab; 
               const btns = Array.from(container.querySelectorAll('button'));
               const activeBtn = btns.find(btn => 
                 (btn.textContent.includes('Prompt') || btn.textContent.includes('Base Prompt') || btn.textContent.includes('Undesired')) 
                 && btn.parentElement 
                 && parseFloat(window.getComputedStyle(btn.parentElement).opacity) > 0.9
               );
               const currentWebTab = activeBtn && activeBtn.textContent.includes('Undesired') ? 'negative' : 'positive';

               if (targetTab && currentWebTab !== targetTab) {
                   const targetTexts = targetTab === 'negative' ? ['Undesired Content'] : ['Prompt', 'Base Prompt'];
                   const switchBtn = btns.find(btn => targetTexts.includes(btn.textContent.trim()));
                   if (switchBtn) {
                       switchBtn.click();
                       await wait(150);
                   }
               }

               const currentPm = container.querySelector('.ProseMirror');
               const currentText = currentPm ? (currentPm.innerText || currentPm.textContent || '').trim() : '';
               const targetText = targetTab === 'negative' ? charData.negative : charData.positive;
               const targetStr = (targetText || '').trim();

               if (currentText !== targetStr && targetText !== undefined && currentPm) {
                   setEditorContent(currentPm, targetText);
               }

               // Update the Ledger
               window.lastSyncCharactersState[i] = {
                   positive: charData.positive,
                   negative: charData.negative,
                   activeTab: charData.activeTab
               };
           }
        };

        syncCharactersDOM(charDataList).finally(() => {
            setTimeout(() => { isSyncingFromPopup = false; }, 100);
        });
      } catch (err) {
        console.error('[Phase 4] Sync char err:', err);
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

  // ═══════════════════════════════════════════════════════════════
  //  历史与收藏面板 (Injected History & Favorites Modal)
  // ═══════════════════════════════════════════════════════════════

  (function initHistoryModal() {
    const MODAL_ID = 'nai-history-modal';

    // ───── CSS 样式 ─────────────────────────────────────────────
    const STYLE = `
      #nai-history-backdrop {
        display: none;
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        z-index: 2147483650; /* 必须大于 manager-panel 的 2147483645 */
        align-items: center;
        justify-content: center;
      }
      #nai-history-backdrop.visible { display: flex; }

      #${MODAL_ID} {
        width: 85vw; max-width: 1100px;
        height: 82vh;
        background: #1a1a2e;
        border: 1px solid #3a3a5c;
        border-radius: 14px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.85);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #e0e0f0;
      }

      .nhm-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 18px;
        background: #22223a;
        border-bottom: 1px solid #3a3a5c;
        flex-shrink: 0;
      }
      .nhm-title { font-size: 16px; font-weight: 600; color: #c5c5ef; letter-spacing: 0.5px; }
      .nhm-close-btn {
        background: transparent; border: none; color: #888; font-size: 20px;
        cursor: pointer; padding: 2px 8px; border-radius: 4px; line-height: 1;
      }
      .nhm-close-btn:hover { background: #3a3a5c; color: #fff; }

      .nhm-body {
        display: flex; flex: 1; overflow: hidden;
      }

      /* ── 左侧边栏 ── */
      .nhm-sidebar {
        width: 300px; min-width: 240px; max-width: 340px;
        background: #16162a;
        border-right: 1px solid #2e2e50;
        display: flex; flex-direction: column;
        flex-shrink: 0;
      }

      .nhm-tabs {
        display: flex;
        border-bottom: 1px solid #2e2e50;
        flex-shrink: 0;
      }
      .nhm-tab {
        flex: 1; padding: 9px 4px; text-align: center;
        font-size: 12px; color: #888; cursor: pointer;
        border: none; background: transparent; border-bottom: 2px solid transparent;
        transition: all 0.15s;
      }
      .nhm-tab.active { color: #818cf8; border-bottom-color: #818cf8; }
      .nhm-tab:hover:not(.active) { color: #ccc; }

      .nhm-list {
        flex: 1; overflow-y: auto; padding: 4px 0;
      }
      .nhm-list::-webkit-scrollbar { width: 4px; }
      .nhm-list::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 2px; }

      .nhm-item {
        display: flex; align-items: flex-start;
        padding: 8px 12px; gap: 8px;
        cursor: pointer; border-left: 3px solid transparent;
        transition: background 0.1s;
      }
      .nhm-item:hover { background: #22223a; }
      .nhm-item.selected { background: #22223a; border-left-color: #818cf8; }

      .nhm-item-main { flex: 1; min-width: 0; }
      .nhm-item-time { font-size: 11px; color: #818cf8; margin-bottom: 3px; }
      .nhm-item-preview { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      
      /* Diff 摘要容器与微型胶囊样式 */
      .nhm-item-diff-container {
        display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
      }
      .nhm-diff-tag {
        display: inline-flex; align-items: center; font-size: 10px; padding: 1px 4px; border-radius: 3px;
        white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis;
      }
      .nhm-diff-tag .diff-op { font-weight: bold; margin-right: 3px; font-size: 11px; }
      .nhm-diff-tag.diff-add { background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.3); color: #4ade80; }
      .nhm-diff-tag.diff-remove { background: rgba(231, 76, 60, 0.15); border: 1px solid rgba(231, 76, 60, 0.3); color: #f87171; text-decoration: line-through; }
      .nhm-diff-tag.diff-change { background: rgba(167, 139, 250, 0.15); border: 1px solid rgba(167, 139, 250, 0.3); color: #c084fc; }
      .nhm-diff-tag.diff-enable { background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; }
      .nhm-diff-tag.diff-disable { background: rgba(107, 114, 128, 0.15); border: 1px solid rgba(107, 114, 128, 0.3); color: #9ca3af; }
      .nhm-diff-tag.diff-ghost { background: rgba(75, 85, 99, 0.1); border: 1px dashed rgba(107, 114, 128, 0.3); color: #6b7280; text-decoration: line-through; }
      .nhm-diff-expand-capsule {
        background: transparent; border: 1px dashed #666; color: #888; 
        font-style: italic; letter-spacing: 1px; cursor: pointer; transition: color 0.15s, border-color 0.15s;
      }
      .nhm-diff-expand-capsule:hover { color: #fff; border-color: #888; }

      .nhm-item-name {
        font-size: 12px; color: #c5c5ef; font-weight: 500; margin-bottom: 2px;
        cursor: pointer; padding: 1px 3px; border-radius: 3px;
      }
      .nhm-item-name:hover { background: #3a3a5c; }

      .nhm-star-btn {
        background: transparent; border: none; cursor: pointer;
        font-size: 16px; line-height: 1; color: #555; flex-shrink: 0;
        padding: 0 2px; transition: color 0.15s; align-self: center;
      }
      .nhm-star-btn.starred { color: #f59e0b; }
      .nhm-star-btn:hover { color: #f59e0b; }

      .nhm-delete-btn {
        background: transparent; border: none; cursor: pointer;
        font-size: 13px; color: #555; flex-shrink: 0; padding: 0 2px;
        align-self: center; transition: color 0.15s;
      }
      .nhm-delete-btn:hover { color: #ef4444; }

      .nhm-footer {
        padding: 10px 12px;
        border-top: 1px solid #2e2e50;
        flex-shrink: 0;
        font-size: 11px; color: #666;
      }
      .nhm-footer-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
      .nhm-limit-input {
        width: 52px; background: #2a2a40; border: 1px solid #3a3a5c;
        color: #ccc; border-radius: 4px; padding: 2px 4px; font-size: 12px;
        text-align: center;
      }
      .nhm-clear-btn {
        margin-left: auto; background: transparent; border: 1px solid #3a3a5c;
        color: #888; padding: 3px 8px; border-radius: 4px; font-size: 11px;
        cursor: pointer;
      }
      .nhm-clear-btn:hover { background: #3a3a5c; color: #fff; }

      /* ── 右侧详情 ── */
      .nhm-detail {
        flex: 1; display: flex; flex-direction: column; overflow: hidden;
      }

      .nhm-detail-placeholder {
        flex: 1; display: flex; align-items: center; justify-content: center;
        color: #444; font-size: 14px;
      }

      .nhm-detail-content {
        flex: 1; overflow-y: auto;
        padding: 16px 20px;
      }
      
      /* 美化的空状态面板 */
      @keyframes nhmFadeInUp {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .nhm-empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        margin: 20px 12px; padding: 40px 20px;
        background: rgba(42, 42, 64, 0.4); border: 1px dashed rgba(255, 255, 255, 0.08);
        border-radius: 8px; text-align: center;
        animation: nhmFadeInUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .nhm-empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.8; }
      .nhm-empty-title { color: #e2e8f0; font-size: 14px; font-weight: 600; margin-bottom: 6px; letter-spacing: 0.5px; }
      .nhm-empty-desc { color: #94a3b8; font-size: 12px; line-height: 1.5; }

      /* Diff 详情查阅弹窗 */
      .nhm-diff-modal {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 15, 26, 0.85); backdrop-filter: blur(8px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 999999; opacity: 0; pointer-events: none; transition: opacity 0.2s;
      }
      .nhm-diff-modal.visible { opacity: 1; pointer-events: auto; }
      .nhm-diff-modal-content {
        background: #1e1e2d; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
        width: 80%; max-width: 800px; max-height: 80%; display: flex; flex-direction: column;
        box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      }
      .nhm-diff-modal-header {
        padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        display: flex; justify-content: space-between; align-items: center;
      }
      .nhm-diff-modal-title { font-size: 14px; color: #fff; font-weight: bold; }
      .nhm-diff-modal-close { background: transparent; border: none; font-size: 20px; color: #888; cursor: pointer; }
      .nhm-diff-modal-close:hover { color: #fff; }
      .nhm-diff-modal-body {
        padding: 16px; overflow-y: auto; flex: 1;
      }
      .nhm-diff-modal-body .nhm-item-diff-container { display: flex; flex-wrap: wrap; gap: 6px; }
      .nhm-diff-modal-body .nhm-diff-tag { font-size: 11px; padding: 3px 6px; max-width: none; }

      .nhm-detail-content::-webkit-scrollbar { width: 5px; }
      .nhm-detail-content::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 3px; }

      .nhm-section { margin-bottom: 18px; }
      .nhm-section-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
        color: #555; padding-bottom: 6px; margin-bottom: 8px;
        border-bottom: 1px solid #2e2e50;
      }
      .nhm-section-title.pos { color: #4ade80; border-bottom-color: #4ade8040; }
      .nhm-section-title.neg { color: #f87171; border-bottom-color: #f8717140; }
      .nhm-section-title.char { color: #60a5fa; border-bottom-color: #60a5fa40; }

      .nhm-tag-cloud { display: flex; flex-wrap: wrap; gap: 5px; }
      .nhm-tag.pos { background: #14321a; border-color: #4ade8050; color: #86efac; }
      .nhm-tag.neg { background: #32141a; border-color: #f8717150; color: #fca5a5; }
      .nhm-tag.char { background: #14243c; border-color: #60a5fa50; color: #93c5fd; }

      .nhm-detail-actions {
        padding: 12px 18px;
        border-top: 1px solid #2e2e50;
        display: flex; align-items: center; justify-content: flex-end; gap: 10px;
        flex-shrink: 0;
        background: #16162a;
      }
      .nhm-detail-meta { font-size: 11px; color: #555; flex: 1; }

      .nhm-restore-btn {
        padding: 8px 22px;
        background: linear-gradient(135deg, #6366f1, #818cf8);
        border: none; border-radius: 8px;
        color: #fff; font-size: 14px; font-weight: 600;
        cursor: pointer; transition: opacity 0.2s, transform 0.1s;
        box-shadow: 0 4px 12px rgba(99,102,241,0.4);
      }
      /* ==========================================================
         完全参照 TagEditor 的样式体系
         ========================================================== */
      .nhm-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-content: flex-start;
      }
      .nhm-tag-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        box-sizing: border-box;
      }
      .nhm-tag-capsule {
        display: flex;
        align-items: center;
        background: #3b3b4f;
        border: 1px solid #4a4a6a;
        border-radius: 6px;
        padding: 2px 8px;
        color: #eee;
        font-size: 13px;
        min-height: 28px;
        box-sizing: border-box;
        transition: all 0.2s;
      }
      .nhm-tag-zh-row {
        font-size: 11px;
        color: #888;
        line-height: 1.2;
        text-align: center;
        white-space: normal;
        word-break: break-all;
        overflow-wrap: break-word;
        min-height: 1.2em;
      }
      .nhm-tag-primary {
        display: flex;
        align-items: center;
      }
      .nhm-tag-weight-badge {
        font-size: 0.85em;
        padding: 0 4px;
        border-radius: 4px;
        line-height: 1.2;
        font-weight: bold;
        margin-right: 4px;
      }
      .nhm-tag-weight-badge.w-pos {
        background: rgba(46, 204, 113, 0.2);
        color: #2ecc71;
      }
      .nhm-tag-weight-badge.w-neg {
        background: rgba(231, 76, 60, 0.2);
        color: #e74c3c;
      }
      /* 分组/特殊样式补充 */
      .nhm-tag-capsule.gh {
        background: rgba(129, 140, 248, 0.15);
        border: 1px solid rgba(129, 140, 248, 0.3);
        border-radius: 12px 2px 2px 12px;
        border-right: none;
        padding-left: 6px;
        border-left-width: 3px;
        border-left-color: #818cf8;
        min-width: 24px;
        margin-right: -4px;
      }
      .nhm-tag-capsule.gf {
        background: rgba(129, 140, 248, 0.15);
        border: 1px solid rgba(129, 140, 248, 0.3);
        border-radius: 2px 12px 12px 2px;
        border-left: none;
        padding-right: 6px;
        border-right-width: 3px;
        border-right-color: #818cf8;
        min-width: 14px;
        justify-content: center;
      }
      .nhm-tag-capsule.dh {
        background: rgba(167, 139, 250, 0.15);
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 12px 2px 2px 12px;
        border-right: none;
        padding-left: 8px;
        border-left-width: 3px;
        border-left-color: #a78bfa;
        min-width: 24px;
        margin-right: -4px;
      }
      .nhm-tag-capsule.dh::before { content: "||"; font-weight: bold; color: #a78bfa; margin: 0 2px; }
      .nhm-tag-capsule.df {
        background: rgba(167, 139, 250, 0.15);
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 2px 12px 12px 2px;
        border-left: none;
        padding-right: 8px;
        border-right-width: 3px;
        border-right-color: #a78bfa;
        min-width: 14px;
        justify-content: center;
      }
      .nhm-tag-capsule.df::after { content: "||"; font-weight: bold; color: #a78bfa; margin: 0 2px; }
      .nhm-tag-capsule.dyn-member { background: rgba(167, 139, 250, 0.05); border-color: rgba(167, 139, 250, 0.2); }
      .nhm-tag-dyn-badge { background: #a78bfa; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: bold; margin-right: 4px; }
      .nhm-tag-dyn-weight { background: #a78bfa; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: bold; margin-left: 4px; }

      /* 禁用状态 (与 TagEditor 的 .tag-capsule.disabled 一致) */
      .nhm-tag-capsule.disabled {
        background: #2a2a2e;
        border-color: #333;
      }
      .nhm-tag-capsule.disabled .nhm-tag-primary {
        opacity: 0.5;
      }
      .nhm-tag-capsule.disabled .nhm-tag-text {
        text-decoration: line-through;
      }

      /* 换行标签 (作为普通胶囊显示，与 Popup 中未开启"渲染换行符"的样式一致) */
      .nhm-tag-newline .nhm-tag-capsule {
        background: rgba(255, 255, 255, 0.05) !important;
        border-style: dashed;
        border-color: rgba(255, 255, 255, 0.2) !important;
        min-width: 32px;
        justify-content: center;
      }
      .nhm-tag-newline .nhm-tag-text {
        font-size: 14px;
        color: #888;
      }
      
      /* 换行标签分隔符（强制后面元素换行） */
      .nhm-tag-newline-separator {
        flex-basis: 100%;
        height: 0;
        margin: 0;
        padding: 0;
      }
    `;

    function injectStyle() {
      if (document.getElementById('nai-history-modal-style')) return;
      const el = document.createElement('style');
      el.id = 'nai-history-modal-style';
      el.textContent = STYLE;
      document.head.appendChild(el);
    }

    // ───── 工具函数 ─────────────────────────────────────────────
    function formatTime(ts) {
      const d = new Date(ts);
      const date = `${d.getMonth()+1}/${d.getDate()}`;
      const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      return `${date} ${time}`;
    }

    function tagsPreview(str) {
      if (!str) return '(空)';
      const tags = str.split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) return '(空)';
      const preview = tags.slice(0, 5).join(', ');
      return tags.length > 5 ? preview + ` ...+${tags.length - 5}` : preview;
    }

    /**
     * 计算两个提示词快照数组之间的按词差异（忽略顺序，支持 disabled 状态追踪）
     * @param {Array|string} current 现在的状态 (优先取 tag 对象数组)
     * @param {Array|string} previous 过去的状态
     * @returns {Object} 包含了 6 种动作状态的分类词典
     */
    function computePromptDiff(current, previous) {
      const parseToMap = (input) => {
        const map = new Map();
        if (!input) return map;
        
        // 兼容处理：统一转为规范的高维 tag object 数组
        let tagsArray = [];
        if (typeof input === 'string') {
          tagsArray = input.split(',').map(t => ({ value: t.trim(), disabled: false })).filter(t => t.value);
        } else if (Array.isArray(input)) {
          tagsArray = input;
        }

        tagsArray.forEach(tag => {
          const text = tag.value;
          if (!text || text === '\\n' || text === '||' || text.startsWith('||') || text === '\n') return;
          
          let weightVal = tag.dynWeight || 1.0;
          let cleanText = text;

          // 仿照 renderTagCloud 内部的经典正则提取纯文本与强制指定权重
          const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
          const headerMatch = text.match(/^([-?\d\.]+)::$/);
          
          if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            cleanText = blockMatch[2];
          } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            cleanText = headerMatch[1] + '::';
          } else if (text === ' ::') {
             cleanText = ')';  // 特殊组尾处理
          } else {
            let inc = 0, dec = 0, str = text;
            if (str.startsWith('{') || str.startsWith('[')) {
              while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
              if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
              if (inc > 0) weightVal = 1 + (inc * 0.1);
              else if (dec > 0) weightVal = 1 - (dec * 0.1);
              cleanText = str;
            }
          }

          if (cleanText) {
             const lowerKey = cleanText.toLowerCase();
             // 如果输入框写了多个相同的词，只比对第一个（通常不推荐写重复tag）
             if (!map.has(lowerKey)) {
                map.set(lowerKey, { 
                  original: text, 
                  cleanText, 
                  weightVal, 
                  disabled: !!tag.disabled 
                });
             }
          }
        });
        return map;
      };

      const currMap = parseToMap(current);
      const prevMap = parseToMap(previous);

      const diff = { added: [], removed: [], changed: [], disabled: [], enabled: [], ghost_deleted: [] };

      // 阶段 1：找出现存的（新增、变动、禁用、启用）
      for (const [key, currData] of currMap.entries()) {
        if (!prevMap.has(key)) {
          if (currData.disabled) {
             diff.disabled.push(currData); // 刚加进来就被禁用了（不常见，但逻辑上完备）
          } else {
             diff.added.push(currData);
          }
        } else {
          const prevData = prevMap.get(key);
          
          if (!prevData.disabled && currData.disabled) {
             diff.disabled.push(currData);
          } else if (prevData.disabled && !currData.disabled) {
             diff.enabled.push(currData);
          } else if (prevData.disabled === currData.disabled) {
             // 只有生存状态没变的情况下，才去计算权重或拼写的变动
             if (Math.abs(currData.weightVal - prevData.weightVal) > 0.01) {
               diff.changed.push({
                 cleanText: currData.cleanText,
                 oldWeight: prevData.weightVal,
                 newWeight: currData.weightVal,
                 disabled: currData.disabled // 记录它是不是在禁用的状态下被悄悄改了权重
               });
             }
          }
        }
      }

      // 阶段 2：找出消失的（被删的活跃词、被清扫的幽灵废弃词）
      for (const [key, prevData] of prevMap.entries()) {
        if (!currMap.has(key)) {
          if (prevData.disabled) {
             diff.ghost_deleted.push(prevData);
          } else {
             diff.removed.push(prevData);
          }
        }
      }

      return diff;
    }

    /**
     * 渲染 6-State Diff 内容为 HTML，生成微型变动胶囊
     */
    function generateDiffHTML(currSnapshot, prevSnapshot) {
      if (!prevSnapshot) {
         const previewTags = currSnapshot.positiveTags ? currSnapshot.positiveTags.map(t=>t.value).join(', ') : currSnapshot.positive;
         return `<div class="nhm-item-preview">${tagsPreview(previewTags)}</div>`;
      }

      // 优先提取精确的 tags 数组（如果版本太旧就退化到处理普通字符串）
      const currTarget = currSnapshot.positiveTags || currSnapshot.positive;
      const prevTarget = prevSnapshot.positiveTags || prevSnapshot.positive;

      const diff = computePromptDiff(currTarget, prevTarget);
      
      const allDiffs = [
        ...diff.added.map(item => `<span class="nhm-diff-tag diff-add"><span class="diff-op">+</span> ${item.cleanText}</span>`),
        ...diff.removed.map(item => `<span class="nhm-diff-tag diff-remove"><span class="diff-op">-</span> ${item.cleanText}</span>`),
        ...diff.changed.map(item => `<span class="nhm-diff-tag diff-change" ${item.disabled ? 'style="opacity:0.6"' : ''}><span class="diff-op">~</span> ${item.cleanText}: ${item.oldWeight.toFixed(2)} → ${item.newWeight.toFixed(2)}</span>`),
        ...diff.enabled.map(item => `<span class="nhm-diff-tag diff-enable"><span class="diff-op">👁️</span> ${item.cleanText}</span>`),
        ...diff.disabled.map(item => `<span class="nhm-diff-tag diff-disable"><span class="diff-op">🚫</span> ${item.cleanText}</span>`),
        ...diff.ghost_deleted.map(item => `<span class="nhm-diff-tag diff-ghost"><span class="diff-op">×</span> ${item.cleanText}</span>`)
      ];

      if (allDiffs.length === 0) {
        return `<div class="nhm-item-preview" style="color:#666; font-style:italic;">仅顺序或位置变动</div>`;
      }

      const MAX_PREVIEW_TAGS = 25; 
      let html = '';
      
      if (allDiffs.length > MAX_PREVIEW_TAGS) {
        const fullHTML = allDiffs.join('').replace(/"/g, '&quot;');
        html = allDiffs.slice(0, MAX_PREVIEW_TAGS).join('') + 
               `<span class="nhm-diff-tag nhm-diff-expand-capsule" title="点击查看所有变动" data-fulldiff="${fullHTML}">... +${allDiffs.length - MAX_PREVIEW_TAGS}</span>`;
      } else {
        html = allDiffs.join('');
      }

      return `<div class="nhm-item-diff-container">${html}</div>`;
    }

    /**
     * 解析单个 tag 的权重信息，返回 { weightVal, cleanText }
     * 支持 NAI 格式：weight::tag :: 和 {{{brackets}}} 样式
     */
    function parseTagWeight(text) {
      let weightVal = 1.0;
      let cleanText = text;

      // NAI 式“weight::tag ::”单片语法
      const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
      // NAI 式“weight::”组头
      const headerMatch = text.match(/^([-?\d\.]+)::$/);

      if (blockMatch) {
        weightVal = parseFloat(blockMatch[1]);
        cleanText = blockMatch[2];
      } else if (headerMatch) {
        weightVal = parseFloat(headerMatch[1]);
        cleanText = headerMatch[1] + '::';
      } else {
        // 旧式括号语法
        let inc = 0, dec = 0, str = text;
        if (text.startsWith('{') || text.startsWith('[')) {
          while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
          if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
          if (inc > 0) weightVal = 1 + (inc * 0.1);
          else if (dec > 0) weightVal = 1 - (dec * 0.1);
          cleanText = str;
        }
      }
      return { weightVal, cleanText };
    }

    /**
     * 移植自 Autocomplete.getTagInfo 的完整 tag 信息查询
     * 支持前缀剥离（artist:, character: 等）和类型颜色映射
     * 使用 Map 索引实现 O(1) 查询
     */
    function getTagInfo(text) {
      if (!text) return null;
      let query = text.trim().toLowerCase();

      // 0. 去除权重后缀 (e.g., tag:20)
      const weightSuffixMatch = query.match(/^(.*?)\s*:\s*\d+(\.\d+)?\s*$/);
      if (weightSuffixMatch) query = weightSuffixMatch[1].trim();

      // 0.1 去除尾部逗号
      if (query.endsWith(',')) query = query.slice(0, -1).trim();

      // 1. 检查类别前缀(artist:, character:, copyright:, meta:, general:)
      const prefixMatch = query.match(/^(artist|character|copyright|meta|general):(.*)$/);
      let prefix = null;
      let baseTag = query;
      if (prefixMatch) {
        prefix = prefixMatch[1];
        baseTag = prefixMatch[2].trim();
      }

      // 2. 从 Map 中查找 (尝试多种格式匹配)
      let match = null;
      if (autocompleteMap) {
        match = autocompleteMap.get(baseTag);
        // 尝试下划线替换为空格
        if (!match) match = autocompleteMap.get(baseTag.replace(/_/g, ' '));
        // 尝试空格替换为下划线
        if (!match) match = autocompleteMap.get(baseTag.replace(/ /g, '_'));
      }

      const prefixColorMap = {
        artist: 'indianred',
        character: 'lightgreen',
        copyright: 'violet',
        meta: 'orange',
        general: 'lightblue'
      };

      if (match) {
        if (prefix) return { ...match, color: prefixColorMap[prefix] || match.color };
        return match;
      }
      if (prefix) return { text: baseTag, zhCN: '', pop: 0, color: prefixColorMap[prefix] };
      return null;
    }

    /**
     * 渲染 tag 云 — 完全复刻 TagEditor 的视觉效果
     * @param {HTMLElement} container - 容器元素
     * @param {Array|string} tagsOrStr - tag 对象数组（v2 快照）或逗号分隔字符串（v1 快照兼容）
     */
    function renderTagCloud(container, tagsOrStr) {
      container.className = 'nhm-tag-list';
      container.innerHTML = '';

      // 兼容旧快照：如果传入的是字符串，用简易解析构造 tag 对象
      let tags;
      if (typeof tagsOrStr === 'string') {
        if (!tagsOrStr || !tagsOrStr.trim()) {
          container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
          return;
        }
        tags = tagsOrStr.split(',').map(t => ({ value: t.trim(), disabled: false })).filter(t => t.value);
      } else if (Array.isArray(tagsOrStr)) {
        tags = tagsOrStr;
      } else {
        container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
        return;
      }

      if (tags.length === 0) {
        container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
        return;
      }

      let inDynGroup = false;

      tags.forEach((tag, index) => {
        const text = tag.value;
        if (!text && text !== '\n') return;

        let weightVal = 1.0;
        let cleanText = text;
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        let isCompHeader = false;
        let isCompFooter = text === ' ::';
        const isNewline = text === '\n';
        const isDynMember = inDynGroup && !isDynHeader && !isDynFooter;

        if (isDynHeader) inDynGroup = true;

        // 解析权重
        const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        const headerMatch = text.match(/^([-?\d\.]+)::$/);

        if (blockMatch) {
          weightVal = parseFloat(blockMatch[1]);
          cleanText = blockMatch[2];
        } else if (headerMatch) {
          weightVal = parseFloat(headerMatch[1]);
          cleanText = headerMatch[1] + '::';
          isCompHeader = true;
        } else if (isCompFooter) {
          cleanText = ')';
          // 回溯查找组头的权重
          for (let j = index - 1; j >= 0; j--) {
            const m = tags[j].value.match(/^([-?\d\.]+)::$/);
            if (m) { weightVal = parseFloat(m[1]); break; }
          }
        } else if (!isNewline && !isDynHeader && !isDynFooter) {
          // 旧式括号语法
          let inc = 0, dec = 0, str = text;
          if (text.startsWith('{') || text.startsWith('[')) {
            while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
            if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
            if (inc > 0) weightVal = 1 + (inc * 0.1);
            else if (dec > 0) weightVal = 1 - (dec * 0.1);
            cleanText = str;
          }
        }

        // 动态选择徽章
        let pickBadge = '';
        if (isDynHeader) {
          let config = text.slice(2);
          if (config.endsWith('$$')) config = config.slice(0, -2);
          if (config) {
            let displayCount = config.replace('-', '~');
            pickBadge = `<span class="nhm-tag-dyn-badge">x${displayCount}</span>`;
          }
        }

        // 动态选择权重徽章
        let dynWeightBadge = '';
        if (isDynMember && tag.dynWeight && tag.dynWeight !== 1) {
          const formatted = (tag.dynWeight % 1 === 0) ? tag.dynWeight : tag.dynWeight.toFixed(1);
          dynWeightBadge = `<span class="nhm-tag-dyn-weight">${formatted}</span>`;
        }

        // 显示文本
        let displayTagName = isNewline ? '↵' : cleanText;
        if (isCompHeader || isCompFooter || isDynHeader || isDynFooter) displayTagName = '';

        // 查找标签信息（翻译+颜色）
        let info = null;
        if (!isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter && !isNewline) {
          if (blockMatch) {
            // 复合 tag：分割子标签并聚合翻译
            const parts = cleanText.split(',').map(s => s.trim()).filter(Boolean);
            const translationParts = [];
            let firstColor = null;
            parts.forEach(part => {
              const partInfo = getTagInfo(part);
              if (partInfo) {
                if (partInfo.zhCN) translationParts.push(partInfo.zhCN);
                if (!firstColor && partInfo.color) firstColor = partInfo.color;
              }
            });
            if (translationParts.length > 0 || firstColor) {
              info = { zhCN: translationParts.join(', '), color: firstColor };
            }
          } else {
            info = getTagInfo(cleanText);
          }
        }

        // === 构建 DOM ===
        const itemNode = document.createElement('div');
        itemNode.className = 'nhm-tag-item';
        if (isNewline) itemNode.classList.add('nhm-tag-newline');

        const capClasses = ['nhm-tag-capsule'];
        if (isCompHeader) capClasses.push('gh');
        if (isCompFooter) capClasses.push('gf');
        if (isDynHeader) capClasses.push('dh');
        if (isDynFooter) capClasses.push('df');
        if (isDynMember) capClasses.push('dyn-member');
        if (tag.disabled) capClasses.push('disabled');

        const capsule = document.createElement('div');
        capsule.className = capClasses.join(' ');

        // 应用字典颜色
        if (info && info.color) {
          capsule.style.borderColor = info.color;
          capsule.style.borderWidth = '1.5px';
          capsule.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }

        const primary = document.createElement('div');
        primary.className = 'nhm-tag-primary';

        // 权重/选择徽章
        if (isDynHeader) {
          primary.innerHTML = pickBadge;
        } else if ((Math.abs(weightVal - 1.0) > 0.001 || isCompHeader || isCompFooter) && !isNewline) {
          const badge = document.createElement('span');
          badge.className = `nhm-tag-weight-badge ${weightVal > 1.0 ? 'w-pos' : (weightVal < 1.0 ? 'w-neg' : '')}`;
          badge.textContent = weightVal.toFixed(1);
          primary.appendChild(badge);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'nhm-tag-text';
        textSpan.textContent = displayTagName;
        primary.appendChild(textSpan);

        if (dynWeightBadge) {
          primary.innerHTML += dynWeightBadge;
        }

        capsule.appendChild(primary);
        itemNode.appendChild(capsule);

        // 翻译行
        if (!isNewline) {
          const zhRow = document.createElement('div');
          zhRow.className = 'nhm-tag-zh-row';
          zhRow.textContent = (info && info.zhCN) || '\u00A0';
          itemNode.appendChild(zhRow);
        }

        container.appendChild(itemNode);

        // 如果是换行标签，向其后追加一个不可见的换行分隔元素强制换行
        if (isNewline) {
          const separatorDiv = document.createElement('div');
          separatorDiv.className = 'nhm-tag-newline-separator';
          container.appendChild(separatorDiv);
        }

        if (isDynFooter) inDynGroup = false;
      });
    }

    // ───── 从 chrome.storage 读写 ────────────────────────────────
    // injector 运行在页面脚本上下文，不能直接访问 chrome.storage
    // 需要通过 postMessage → bridge 中转来读写数据
    // 因此我们在此使用一个简单的消息协议
    let pendingStorageReads = {};

    window.addEventListener('message', e => {
      if (e.source !== window) return;
      if (e.data?.type === '__HISTORY_DATA__') {
        const { reqId, data } = e.data;
        if (pendingStorageReads[reqId]) {
          pendingStorageReads[reqId](data);
          delete pendingStorageReads[reqId];
        }
      }
    });

    function getHistoryData() {
      return new Promise(resolve => {
        const reqId = Date.now() + Math.random();
        pendingStorageReads[reqId] = resolve;
        window.postMessage({ type: '__REQUEST_HISTORY_DATA__', reqId }, '*');
      });
    }

    function saveHistoryData(history) {
      window.postMessage({ type: '__SAVE_HISTORY_DATA__', history }, '*');
    }

    function saveLimitData(limit) {
      window.postMessage({ type: '__SAVE_HISTORY_LIMIT__', limit }, '*');
    }

    // ───── Modal 主体 ──────────────────────────────────────────
    let currentTab = 'history'; // 'history' | 'favorites'
    let selectedSnapshot = null;
    let historyData = [];
    let historyLimit = 100;

    function createModal() {
      if (document.getElementById('nai-history-backdrop')) return;

      const backdrop = document.createElement('div');
      backdrop.id = 'nai-history-backdrop';

      const container = document.createElement('div');
      container.id = MODAL_ID;
      
      // === 构建核心骨架 ===
      container.innerHTML = `
        <div class="nhm-header">
          <div class="nhm-title-area">
            <span class="nhm-title">📚 提示词记录</span>
            <span class="nhm-subtitle" id="nhm-stats"></span>
          </div>
          <button class="nhm-close-btn" id="nhm-close" title="关闭 (Esc)">×</button>
        </div>
        
        <div class="nhm-body">
          <div class="nhm-sidebar">
            <div class="nhm-tabs">
              <button class="nhm-tab active" data-tab="history">🕒 历史记录</button>
              <button class="nhm-tab" data-tab="favorites">⭐️ 我的收藏</button>
            </div>
            <div class="nhm-list" id="nhm-list"></div>
            <div class="nhm-footer">
              <div class="nhm-footer-row">
                <span>历史上限:</span>
                <input class="nhm-limit-input" id="nhm-limit-input" type="number" min="10" max="1000" value="100">
                <button class="nhm-clear-btn" id="nhm-clear-btn">清除历史</button>
              </div>
            </div>
          </div>
          
          <div class="nhm-detail">
            <div class="nhm-detail-placeholder" id="nhm-placeholder">← 从左侧选择一条记录进行预览</div>
            <div class="nhm-detail-content" id="nhm-detail-content" style="display:none;"></div>
            <div class="nhm-detail-actions" id="nhm-actions" style="display:none;">
              <div class="nhm-detail-meta" id="nhm-detail-meta"></div>
              <button class="nhm-restore-btn" id="nhm-restore-btn">⏮️ 恢复至此状态</button>
            </div>
          </div>
        </div>

        <!-- 差异详情独立弹窗 -->
        <div class="nhm-diff-modal" id="nhm-diff-modal">
          <div class="nhm-diff-modal-content">
            <div class="nhm-diff-modal-header">
              <span class="nhm-diff-modal-title">完整变动详情 (Diff)</span>
              <button class="nhm-diff-modal-close" id="nhm-diff-modal-close">×</button>
            </div>
            <div class="nhm-diff-modal-body" id="nhm-diff-modal-body"></div>
          </div>
        </div>
      `;

      document.body.appendChild(container);

      // Diff Modal 事件绑定
      const diffModal = document.getElementById('nhm-diff-modal');
      document.getElementById('nhm-diff-modal-close').addEventListener('click', () => {
        diffModal.classList.remove('visible');
      });
      diffModal.addEventListener('click', (e) => {
        if (e.target === diffModal) diffModal.classList.remove('visible');
      });

      backdrop.appendChild(container);
      document.body.appendChild(backdrop);

      // 关闭
      backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
      document.getElementById('nhm-close').addEventListener('click', closeModal);

      // Tab 切换
      container.querySelectorAll('.nhm-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.nhm-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentTab = tab.dataset.tab;
          renderList();
        });
      });

      // 历史上限输入
      document.getElementById('nhm-limit-input').addEventListener('change', (e) => {
        const val = Math.max(10, Math.min(1000, parseInt(e.target.value) || 100));
        e.target.value = val;
        historyLimit = val;
        saveLimitData(val);
      });

      // 清除历史 (使用内联二次确认，避免原生 confirm 被浏览器屏蔽)
      let clearConfirmTimeout;
      const clearBtn = document.getElementById('nhm-clear-btn');
      clearBtn.addEventListener('click', () => {
        if (clearBtn.dataset.confirming !== 'true') {
          // 第一次点击：进入确认状态
          clearBtn.dataset.confirming = 'true';
          const originalText = clearBtn.textContent;
          clearBtn.textContent = '确定清除?';
          clearBtn.style.backgroundColor = '#e74c3c';
          clearBtn.style.color = '#fff';
          
          clearConfirmTimeout = setTimeout(() => {
            clearBtn.dataset.confirming = 'false';
            clearBtn.textContent = originalText;
            clearBtn.style.backgroundColor = '';
            clearBtn.style.color = '';
          }, 3000);
          return;
        }

        // 第二次点击：执行清除
        clearTimeout(clearConfirmTimeout);
        clearBtn.dataset.confirming = 'false';
        clearBtn.textContent = '清除历史';
        clearBtn.style.backgroundColor = '';
        clearBtn.style.color = '';

        const favOnly = historyData.filter(s => s.isFavorite);
        historyData = favOnly;
        saveHistoryData(historyData); // 统一使用这个接口，无需专门的 __CLEAR_HISTORY__
        
        if (selectedSnapshot && !selectedSnapshot.isFavorite) {
          selectedSnapshot = null;
          showPlaceholder();
        }
        renderList();
      });

      // ESC 关闭
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('nai-history-backdrop')?.classList.contains('visible')) {
          closeModal();
        }
      });
    }

    function closeModal() {
      const backdrop = document.getElementById('nai-history-backdrop');
      if (backdrop) backdrop.classList.remove('visible');
    }

    function showPlaceholder() {
      document.getElementById('nhm-placeholder').style.display = 'flex';
      document.getElementById('nhm-detail-content').style.display = 'none';
      document.getElementById('nhm-actions').style.display = 'none';
    }

    function renderList() {
      const list = document.getElementById('nhm-list');
      if (!list) return;

      const filtered = currentTab === 'favorites'
        ? historyData.filter(s => s.isFavorite)
        : historyData.filter(s => !s.isFavorite);

      // 统计信息
      const normalCount = historyData.filter(s => !s.isFavorite).length;
      const favCount = historyData.filter(s => s.isFavorite).length;
      const stats = document.getElementById('nhm-stats');
      if (stats) stats.textContent = `普通: ${normalCount} 条 · 收藏: ${favCount} 项`;

      if (filtered.length === 0) {
        list.innerHTML = `
          <div class="nhm-empty-state">
            <div class="nhm-empty-icon">${currentTab === 'favorites' ? '⭐' : '🕰️'}</div>
            <div class="nhm-empty-title">${currentTab === 'favorites' ? '暂无收藏' : '暂无历史记录'}</div>
            <div class="nhm-empty-desc">${currentTab === 'favorites' ? '点击列表中的 ☆ 图标即可收藏您喜欢的提示词状态' : '生成图片时，您的提示词记录会自动保存在这里'}</div>
          </div>
        `;
        return;
      }

      list.innerHTML = '';
      filtered.forEach((snapshot, ObjectIndex) => {
        const item = document.createElement('div');
        item.className = 'nhm-item' + (selectedSnapshot?.id === snapshot.id ? ' selected' : '');
        item.dataset.id = snapshot.id;

        const nameOrTime = snapshot.isFavorite && snapshot.name
          ? `<div class="nhm-item-name" title="双击重命名">${snapshot.name}</div>`
          : '';
          
        let previewHTML = '';
        if (currentTab === 'history') {
          previewHTML = generateDiffHTML(snapshot, filtered[ObjectIndex + 1]);
        } else {
          previewHTML = `<div class="nhm-item-preview">${tagsPreview(snapshot.positive)}</div>`;
        }

        item.innerHTML = `
          <div class="nhm-item-main">
            ${nameOrTime}
            <div class="nhm-item-time">${formatTime(snapshot.timestamp)}</div>
            ${previewHTML}
          </div>
          <button class="nhm-star-btn ${snapshot.isFavorite ? 'starred' : ''}" title="${snapshot.isFavorite ? '取消收藏' : '收藏'}">
            ${snapshot.isFavorite ? '★' : '☆'}
          </button>
          <button class="nhm-delete-btn" title="删除此条">🗑</button>
        `;

        // 点击选中
        item.addEventListener('click', (e) => {
          if (e.target.closest('.nhm-star-btn') || e.target.closest('.nhm-delete-btn')) return;
          selectedSnapshot = snapshot;
          list.querySelectorAll('.nhm-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          renderDetail(snapshot);
        });

        // 点击名称双击重命名
        const nameEl = item.querySelector('.nhm-item-name');
        if (nameEl) {
          nameEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.value = snapshot.name || '';
            input.style.cssText = 'background:#2a2a40;border:1px solid #3a3a5c;color:#ccc;border-radius:3px;padding:1px 4px;font-size:12px;width:90%;';
            nameEl.replaceWith(input);
            input.focus();
            const save = () => {
              snapshot.name = input.value.trim() || formatTime(snapshot.timestamp);
              const idx = historyData.findIndex(s => s.id === snapshot.id);
              if (idx !== -1) historyData[idx] = snapshot;
              saveHistoryData(historyData);
              renderList();
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); e.preventDefault(); } });
          });
        }

        // 收藏切换
        item.querySelector('.nhm-star-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          snapshot.isFavorite = !snapshot.isFavorite;
          const idx = historyData.findIndex(s => s.id === snapshot.id);
          if (idx !== -1) historyData[idx] = snapshot;
          saveHistoryData(historyData);
          renderList();
          if (selectedSnapshot?.id === snapshot.id) renderDetail(snapshot);
        });

        // 删除
        item.querySelector('.nhm-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          historyData = historyData.filter(s => s.id !== snapshot.id);
          saveHistoryData(historyData);
          if (selectedSnapshot?.id === snapshot.id) {
            selectedSnapshot = null;
            showPlaceholder();
          }
          renderList();
        });

        // 弹窗展开胶囊点击事件
    const expandCapsule = item.querySelector('.nhm-diff-expand-capsule');
    if (expandCapsule) {
      expandCapsule.addEventListener('click', (e) => {
        e.stopPropagation();
        const diffModal = document.getElementById('nhm-diff-modal');
        const diffBody = document.getElementById('nhm-diff-modal-body');
        if (diffModal && diffBody) {
          diffBody.innerHTML = `<div class="nhm-item-diff-container">${expandCapsule.dataset.fulldiff}</div>`;
          diffModal.classList.add('visible');
        }
      });
    }

    list.appendChild(item);
      });
    }

    function renderDetail(snapshot) {
      const content = document.getElementById('nhm-detail-content');
      const meta = document.getElementById('nhm-detail-meta');
      if (!content || !meta) return;

      content.style.display = 'block';
      document.getElementById('nhm-placeholder').style.display = 'none';
      document.getElementById('nhm-actions').style.display = 'flex';

      content.innerHTML = '';

      const charCount = (snapshot.characters || []).filter(c => c.posPrompt || c.negPrompt).length;
      meta.textContent = `记录于 ${formatTime(snapshot.timestamp)} · ${charCount} 个角色`;

      // 正向
      const posSection = document.createElement('div');
      posSection.className = 'nhm-section';
      posSection.innerHTML = `<div class="nhm-section-title pos">✅ 正向提示词 (Positive)</div>`;
      const posCloud = document.createElement('div');
      posCloud.className = 'nhm-tag-cloud';
      renderTagCloud(posCloud, snapshot.positiveTags || snapshot.positive);
      posSection.appendChild(posCloud);
      content.appendChild(posSection);

      // 负向
      const negSection = document.createElement('div');
      negSection.className = 'nhm-section';
      negSection.innerHTML = `<div class="nhm-section-title neg">🚫 负向提示词 (Negative)</div>`;
      const negCloud = document.createElement('div');
      negCloud.className = 'nhm-tag-cloud';
      renderTagCloud(negCloud, snapshot.negativeTags || snapshot.negative);
      negSection.appendChild(negCloud);
      content.appendChild(negSection);

      // 角色
      if (snapshot.characters && snapshot.characters.length > 0) {
        snapshot.characters.forEach((char, idx) => {
          if (!char.posPrompt && !char.negPrompt) return;
          const charSection = document.createElement('div');
          charSection.className = 'nhm-section';
          charSection.innerHTML = `<div class="nhm-section-title char">👤 角色 #${idx + 1}</div>`;
          if (char.posPrompt) {
            const p = document.createElement('div');
            p.style.marginBottom = '6px';
            p.innerHTML = '<span style="font-size:10px;color:#555;">正向:</span>';
            const cloud = document.createElement('div');
            cloud.className = 'nhm-tag-cloud';
            cloud.style.marginTop = '4px';
            renderTagCloud(cloud, char.posTags || char.posPrompt);
            charSection.appendChild(p);
            charSection.appendChild(cloud);
          }
          if (char.negPrompt) {
            const p = document.createElement('div');
            p.style.marginTop = '8px';
            p.innerHTML = '<span style="font-size:10px;color:#555;">负向:</span>';
            const cloud = document.createElement('div');
            cloud.className = 'nhm-tag-cloud';
            cloud.style.marginTop = '4px';
            renderTagCloud(cloud, char.negTags || char.negPrompt);
            charSection.appendChild(p);
            charSection.appendChild(cloud);
          }
          content.appendChild(charSection);
        });
      }

      // 恢复按钮
      const restoreBtn = document.getElementById('nhm-restore-btn');
      restoreBtn.onclick = () => {
        if (!selectedSnapshot) return;
        window.postMessage({ type: '__RESTORE_HISTORY__', snapshot: selectedSnapshot }, '*');
        closeModal();
      };
    }

    async function openModal() {
      injectStyle();
      if (!document.getElementById('nai-history-backdrop')) createModal();

      // 从 storage 读取新数据
      const data = await getHistoryData();
      historyData = (data.history || []).sort((a, b) => b.timestamp - a.timestamp);
      historyLimit = data.limit || 100;
      const limitInput = document.getElementById('nhm-limit-input');
      if (limitInput) limitInput.value = historyLimit;

      selectedSnapshot = null;
      renderList();
      document.getElementById('nai-history-backdrop').classList.add('visible');

      // 自动选中第一条历史记录
      if (historyData.length > 0) {
        const firstItem = document.querySelector('#nhm-list .nhm-item');
        if (firstItem) firstItem.click();
      }
    }

    // ───── 监听打开指令 ─────────────────────────────────────────
    window.addEventListener('message', e => {
      if (e.source !== window) return;
      if (e.data?.type === '__OPEN_HISTORY_MODAL__') {
        openModal();
      }
    });

    console.log('[Wildcard] History Modal module initialized');
  })();

})();
