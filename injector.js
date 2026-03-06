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


})();
