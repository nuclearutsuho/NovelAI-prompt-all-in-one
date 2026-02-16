// injector.js
(() => {
  const TARGET = 'https://image.novelai.net/ai/generate-image';

  const curlyPattern = /{(?:[^|{}]+\|)+[^|{}]+}/;
  const doublePipePattern = /\|\|(?:[^|]+\|)+[^|]+\|\|/;
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

      // 3) ||a|b|| deterministic pick
      result = result.replace(/\|\|((?:[^|]+\|)+[^|]+)\|\|/g, (m, group) => {
        const opts = group.split('|');
        return opts[Math.floor(rng() * opts.length)];
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

          /* ③ cosmetic: base_caption = input */
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

        /* ② cosmetic: base_caption = input */
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
  let isSyncingFromPopup = false;
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, map, v3: newV3, preservePrompt: newPreserve, alternativeDanbooruAutocomplete: newAlt, triggerTab: newTab, triggerSpace: newSpace, data } = e.data || {};

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
    scan();

    function scan() {
      document.querySelectorAll('div.ProseMirror[contenteditable="true"]')
        .forEach(el => { if (!seen.has(el)) hook(el); });
    }

    function hook(editor) {
      seen.add(editor);

      const list = document.createElement('ul');
      list.className = 'wildcard-suggest';
      list.style.display = 'none';
      document.body.appendChild(list);

      let selIdx = -1;

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

      function notifyPromptUpdate() {
        if (typeof window.__getCurrentPrompts_PM === 'function') {
          const { positive, negative } = window.__getCurrentPrompts_PM();
          window.postMessage({
            type: '__RETURN_PROMPT__',
            data: { positive, negative }
          }, '*');
        }
      }

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

  function getCurrentPrompts() {
    // 1. Target main container editors only
    const mainContainer = document.querySelector('.image-gen-prompt-main');
    const allMain = mainContainer ? Array.from(mainContainer.querySelectorAll('div.ProseMirror[contenteditable="true"]')) : [];

    // 2. Identify Base Positive and Base Negative by parent classes (Stable in V4/V4.5)
    let posEl = document.querySelector('.image-gen-prompt-main .prompt-input-box-base-prompt .ProseMirror') ||
      document.querySelector('.prompt-input-box-base-prompt .ProseMirror');
    let negEl = document.querySelector('.image-gen-prompt-main .prompt-input-box-undesired-content .ProseMirror') ||
      document.querySelector('.prompt-input-box-undesired-content .ProseMirror');

    // 3. Fallback logic—only within the main container
    if (!posEl) posEl = allMain[0];
    if (!negEl) negEl = allMain[1];

    const getVal = el => el ? (el.innerText || el.textContent || '').trim() : '';

    return {
      positive: getVal(posEl),
      negative: getVal(negEl)
    };
  }

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, data } = e.data || {};

    if (type === '__GET_PROMPT__') {
      console.log('[Injector] Received __GET_PROMPT__');
      const { positive, negative } = getCurrentPrompts();
      console.log('[Injector] Extracted prompts:', { positive, negative });
      window.postMessage({
        type: '__RETURN_PROMPT__',
        data: { positive, negative }
      }, '*');
    }

    if (type === '__SET_PROMPT__') {
      isSyncingFromPopup = true;
      try {
        const { positive, negative } = data || {};
        const mainContainer = document.querySelector('.image-gen-prompt-main');
        const allMain = mainContainer ? Array.from(mainContainer.querySelectorAll('div.ProseMirror[contenteditable="true"]')) : [];

        // Select best targets
        let posEl = document.querySelector('.image-gen-prompt-main .prompt-input-box-base-prompt .ProseMirror') || allMain[0];
        let negEl = document.querySelector('.image-gen-prompt-main .prompt-input-box-undesired-content .ProseMirror') || allMain[1];

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

        if (positive !== undefined) setEditorContent(posEl, positive);
        if (negative !== undefined) setEditorContent(negEl, negative);
      } finally {
        // Use timeout to ensure all immediate side effects (like 'input' events) are processed
        setTimeout(() => { isSyncingFromPopup = false; }, 100);
      }
    }
  });

  // Export for internal use in hook()
  window.__getCurrentPrompts_PM = getCurrentPrompts;

  console.log('[Wildcard] injector ready');
})();



