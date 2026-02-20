import TagEditor from './lib/TagEditor.js';
import common from './lib/common.js';
import Autocomplete from './lib/Autocomplete.js';

let editor;
let autocomplete;
let currentMode = 'positive'; // 'positive' | 'negative'
let rawPositive = '';
let rawNegative = '';
let positiveTags = [];
let negativeTags = [];

// Language Support
const translations = {
  en: {
    tab_positive: "Prompt",
    tab_negative: "Undesired Content",
    status_ready: "Ready",
    loading: "Connecting to NovelAI...",
    input_placeholder: "Enter tags here...",
    btn_add: "Add",
    settings_title: "Settings",
    setting_preserve: "Preserve Original img prompts on Enhance",
    setting_preserve_desc: "Uncheck this to randomize enhance prompts.",
    setting_alt_autocomplete: "Full Alternative Danbooru Autocomplete",
    setting_alt_autocomplete_desc: "a1111 WebUI style Danbooru Autocomplete.",
    setting_trigger_keys: "Trigger Keys:",
    setting_space: "Space",
    setting_tab: "Tab",
    status_linked: "Linked",
    btn_library: "Resource Center",
    btn_settings: "Settings",
    tag_help_tooltip: "Left-click: Edit | Double-click: Toggle | Drag: Sort",
    setting_render_newlines: "Render Real Newlines",
    setting_render_newlines_desc: "Force actual line breaks in the UI at newline tags.",
    btn_quick_wildcard: "Insert Wildcard",
    btn_quick_random: "Insert Random"
  },
  zh: {
    tab_positive: "正向提示词",
    tab_negative: "排除内容",
    status_ready: "就绪",
    loading: "正在连接 NovelAI...",
    input_placeholder: "输入标签...",
    btn_add: "添加",
    settings_title: "设置",
    setting_preserve: "增强时保留原始提示词",
    setting_preserve_desc: "取消勾选以随机化增强提示词。",
    setting_alt_autocomplete: "完整 Danbooru 自动补全",
    setting_alt_autocomplete_desc: "A1111 WebUI 风格的补全逻辑。",
    setting_trigger_keys: "触发按键:",
    setting_space: "空格",
    setting_tab: "Tab 键",
    status_linked: "连接正常",
    btn_library: "资源中心",
    btn_settings: "设置",
    tag_help_tooltip: "左键点击编辑 | 双击禁用/启用 | 拖动进行排序",
    setting_render_newlines: "渲染真实换行",
    setting_render_newlines_desc: "在界面中遇到换行标签时强制换行显示。",
    btn_quick_wildcard: "通配符",
    btn_quick_random: "随机选择"
  },
  jp: {
    tab_positive: "プロンプト",
    tab_negative: "除外したい内容",
    status_ready: "準備完了",
    loading: "NovelAIに接続中...",
    input_placeholder: "タグを入力...",
    btn_add: "追加",
    settings_title: "設定",
    setting_preserve: "強化時に元のプロンプトを保持",
    setting_preserve_desc: "無効にすると強化時のプロンプトがランダム化されます。",
    setting_alt_autocomplete: "Danbooru オートコンプリート",
    setting_alt_autocomplete_desc: "A1111 WebUI スタイルのオートコンプリート。",
    setting_trigger_keys: "トリガーキー:",
    setting_space: "スペース",
    setting_tab: "タブ",
    status_linked: "接続済み",
    btn_library: "リソースセンター",
    btn_settings: "設定",
    tag_help_tooltip: "左クリック：編集 | ダブルクリック：無効/有効 | ドラッグ：並べ替え",
    btn_quick_wildcard: "ワイルドカード",
    btn_quick_random: "ランダム選択"
  }
};

let currentLang = 'en';

document.addEventListener('DOMContentLoaded', async () => {
  initUI();
  await initData();
  initCommunication();
});

async function initData() {
  const data = await chrome.storage.local.get('sequentialCounters');
  if (editor && data.sequentialCounters) {
    editor.setSequentialCounters(data.sequentialCounters);
  }

  // Listen for storage changes to keep counters in sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sequentialCounters) {
      if (editor) {
        editor.setSequentialCounters(changes.sequentialCounters.newValue);
      }
    }
  });
}

function initUI() {
  // Autocomplete
  autocomplete = new Autocomplete();
  autocomplete.load();

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', () => switchTab('positive'));
  tabNegative.addEventListener('click', () => switchTab('negative'));

  // Editor
  const container = document.getElementById('editor-container');
  editor = new TagEditor(container, {
    onChange: (tags) => {
      updateTagsFromEditor(tags);
      syncToPage();
    }
  });

  // Bind Autocomplete to Editor (for inline edit)
  editor.bindAutocomplete(autocomplete);

  // Input Area
  const input = document.getElementById('quick-input');
  const btnAdd = document.getElementById('btn-add');
  const btnQuickWildcard = document.getElementById('btn-quick-wildcard');
  const btnQuickRandom = document.getElementById('btn-quick-random');

  if (btnQuickWildcard) {
    btnQuickWildcard.addEventListener('click', () => {
      input.value += '__';
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  if (btnQuickRandom) {
    btnQuickRandom.addEventListener('click', () => {
      if (editor) {
        editor.addTag('||');
        const container = document.getElementById('editor-container');
        if (container) container.scrollTop = container.scrollHeight;
        input.focus();
      } else {
        input.value += '||';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  // Attach Autocomplete to Input
  autocomplete.attach(input, (val) => {
    // When autocomplete selects, add tag
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    // Replace _ with space, UNLESS it's a wildcard format
    const cleanTags = newTags.map(t => {
      const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
      return isWildcard ? t : t.replace(/_/g, ' ');
    });
    cleanTags.forEach(t => editor.addTag(t));
    input.value = '';
    input.focus();
  });

  const addTag = () => {
    const val = input.value.trim();
    if (val) {
      // Split by comma if user pasted multiple
      const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
      // Replace _ with space, UNLESS it's a wildcard format
      const cleanTags = newTags.map(t => {
        const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
        return isWildcard ? t : t.replace(/_/g, ' ');
      });
      cleanTags.forEach(t => editor.addTag(t));
      input.value = '';
      // scroll to bottom
      container.scrollTop = container.scrollHeight;
    }
    // Always hide autocomplete when adding tag via Enter or button
    if (autocomplete) autocomplete.hide();
  };

  btnAdd.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Small timeout to allow autocomplete to process first if it's active
      setTimeout(() => {
        if (input.value.trim()) addTag();
      }, 100);
    }
  });

  // Library & Settings
  document.getElementById('btn-library').addEventListener('click', () => {
    chrome.tabs.create({ url: 'sync.html' });
  });

  // Language Support translations now at top level

  const applyTranslations = (lang) => {
    currentLang = lang;
    const dict = translations[lang] || translations.en;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        // If element has children (like Settings title with close button), preserve them
        if (el.children.length === 0) {
          el.textContent = dict[key];
        } else {
          // Find text node and replace it
          for (let node of el.childNodes) {
            if (node.nodeType === 3) {
              node.textContent = dict[key] + ' ';
              break;
            }
          }
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key]) el.placeholder = dict[key];
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (dict[key]) el.title = dict[key];
    });

    if (editor && dict.tag_help_tooltip) {
      editor.options.helpTooltip = dict.tag_help_tooltip;
      editor.render();
    }

    // Handle button active state
    ['btn-en', 'btn-jp', 'btn-zh'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-${lang}`);
    });
  };

  const setLanguage = (lang) => {
    applyTranslations(lang);
    chrome.storage.local.set({ language: lang });
  };

  // Language Toggle
  const langBtns = {
    'btn-en': 'en',
    'btn-jp': 'jp',
    'btn-zh': 'zh'
  };
  Object.keys(langBtns).forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      setLanguage(langBtns[id]);
    });
  });

  // Load language preference
  chrome.storage.local.get('language', (data) => {
    if (data.language) applyTranslations(data.language);
  });

  // Settings Persistence
  const settings = [
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'triggerSpace',
    'triggerTab',
    'renderNewlines'
  ];

  // Load Settings
  chrome.storage.local.get(settings, (data) => {
    settings.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        el.checked = !!data[key];

        // Initial state for editor
        if (key === 'renderNewlines') {
          editor.options.renderNewlines = el.checked;
        }

        el.addEventListener('change', () => {
          chrome.storage.local.set({ [key]: el.checked });
          if (key === 'renderNewlines') {
            editor.options.renderNewlines = el.checked;
            editor.render();
          }
        });
      }
    });
  });

  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');

  btnSettings.addEventListener('click', () => { modal.style.display = 'flex'; });
  closeSettings.addEventListener('click', () => { modal.style.display = 'none'; });
}

function switchTab(mode) {
  currentMode = mode;

  document.getElementById('tab-positive').classList.toggle('active', mode === 'positive');
  document.getElementById('tab-negative').classList.toggle('active', mode === 'negative');

  if (mode === 'positive') {
    editor.setTags(positiveTags);
  } else {
    editor.setTags(negativeTags);
  }
}

function updateTagsFromEditor(updatedTags) {
  if (currentMode === 'positive') {
    positiveTags = updatedTags;
  } else {
    negativeTags = updatedTags;
  }
}

function tagsToString(tags) {
  let result = '';
  const activeTags = tags.filter(t => !t.disabled);
  let inDynamic = false;

  activeTags.forEach((t, i) => {
    const val = t.value;
    const isDynStart = val.startsWith('||') && (val !== '||' || t.isStart);
    const isDynEnd = val === '||' && !t.isStart;
    const isHeader = val.match(/^([-?\d\.]+)::$/);
    const isFooter = val === ' ::';

    if (val === '\n') {
      result += '\n';
    } else {
      if (isDynStart) inDynamic = true;
      
      // Handle native value
      let outputVal = val;
      if (inDynamic && !isDynStart && !isDynEnd && t.dynWeight && t.dynWeight !== 1) {
          // Correct Fix: Always append to the very end of the value string.
          // If val is "2::tag ::", output should be "2::tag :: :5"
          // If val is "tag", output should be "tag:5"
          outputVal = val + `:${t.dynWeight}`;
      }

      result += outputVal;
      if (isDynEnd) inDynamic = false;

      if (i < activeTags.length - 1) {
        const next = activeTags[i + 1];
        const nextVal = next.value;
        const nextIsNL = nextVal === '\n';
        const nextIsFooter = nextVal === ' ::';
        const nextIsDynEnd = nextVal === '||';
        const nextIsDynStart = nextVal.startsWith('||') && nextVal !== '||';

        if (inDynamic) {
          // Inside dynamic: use | between members
          if (!isDynStart && !nextIsDynEnd && !nextIsNL) {
            result += '|';
          }
        } else {
          // Outside dynamic: use ,
          // Optimized: Allow comma before newline, but avoid double commas
          if (!isHeader && !nextIsFooter) {
            if (!outputVal.trim().endsWith(',')) {
              result += ', ';
            } else if (!outputVal.endsWith(' ')) {
              result += ' '; // Add space if user provided comma but no space
            }
          }
        }
      }
    }
  });
  return result;
}

function parsePromptToTags(promptText) {
  if (!promptText) return [];
  // Use common.splitTags logic
  const parts = common.splitTags(promptText);
  const result = [];

  let inDynamic = false;
  parts.forEach(p => {
    // Check if part is a dynamic block: ||...||
    if (p.startsWith('||') && p.endsWith('||') && p.length >= 4) {
      const content = p.slice(2, -2);
      let options = content;
      let config = '';

      if (content.includes('$$')) {
        const dParts = content.split('$$');
        options = dParts.pop();
        config = dParts.join('$$');
      }

      // Push start marker
      result.push({ value: `||${config}${config ? '$$' : ''}`, isStart: true, disabled: false });

      // Push members
      options.split('|').forEach(opt => {
        let val = opt.trim();
        if (!val) return;

        let dynWeight = 1;
        // Match :weight at the end, support decimals
        const dMatch = val.match(/^(.*?)\s*:\s*(\d+(\.\d+)?)\s*$/);
        if (dMatch && dMatch[2]) {
            val = dMatch[1];
            dynWeight = parseFloat(dMatch[2]);
        }

        result.push({ value: val, dynWeight: dynWeight, disabled: false });
      });

      // Push end marker
      result.push({ value: '||', disabled: false });
    } else if (p === '||') {
      if (!inDynamic) {
        result.push({ value: '||', isStart: true, disabled: false });
        inDynamic = true;
      } else {
        result.push({ value: '||', disabled: false });
        inDynamic = false;
      }
    } else if (p.startsWith('||') && !p.endsWith('||')) {
      // Half-finished block like ||tag1|tag2
      const content = p.slice(2);
      let options = content;
      let config = '';
      if (content.includes('$$')) {
        const dParts = content.split('$$');
        options = dParts.pop();
        config = dParts.join('$$');
      }
      result.push({ value: `||${config}${config ? '$$' : ''}`, isStart: true, disabled: false });
      inDynamic = true;
      options.split('|').forEach(opt => {
        let val = opt.trim();
        if (!val) return;
        result.push({ value: val, disabled: false });
      });
    } else {
      const isNL = p === '\n';
      const isFooter = p === ' ::';
      // Preserve ' ::' exactly, otherwise trim
      result.push({ value: (isNL || isFooter) ? p : p.trim(), disabled: false });
    }
  });

  return result.filter(t => t.value !== '');
}

// Track last sent prompt to avoid echo loops destroying focus
let lastSentPositive = null;
let lastSentNegative = null;

/* Communication */

function normalizePrompt(str) {
  // Remove all whitespace and newlines for comparison
  // Also remove commas to handle "a, b" vs "a,b"
  if (!str) return '';
  return str.replace(/[\s\r\n,]/g, '');
}

function initCommunication() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RETURN_PROMPT') {
      const { positive, negative } = msg.data;

      // Skip echo: if this matches what we just sent, ignore
      // Use normalized comparison to avoid loops on minor formatting diffs
      if (normalizePrompt(positive) === normalizePrompt(lastSentPositive) &&
        normalizePrompt(negative) === normalizePrompt(lastSentNegative)) {
        return;
      }

      // Skip if identical to current popup state (normalized)
      const currentPosStr = tagsToString(positiveTags);
      const currentNegStr = tagsToString(negativeTags);

      if (normalizePrompt(positive) === normalizePrompt(currentPosStr) &&
        normalizePrompt(negative) === normalizePrompt(currentNegStr)) {
        // Just update raw strings, no need to re-parse / re-render
        rawPositive = positive;
        rawNegative = negative;
        return;
      }

      // Apply external change
      // logic: If we are receiving a TRUE update from the page, we want to
      // PRESERVE the currently disabled tags in the popup.
      // Because the page doesn't know about disabled tags (it only sees active ones).

      const disabledPos = positiveTags.filter(t => t.disabled);
      const disabledNeg = negativeTags.filter(t => t.disabled);

      rawPositive = positive || '';
      rawNegative = negative || '';

      // Parse new tags
      const newPosTags = parsePromptToTags(rawPositive);
      const newNegTags = parsePromptToTags(rawNegative);

      // Append saved disabled tags
      // (We append them because we don't know where they belong in the new text structure)
      disabledPos.forEach(d => {
        newPosTags.push(d);
      });

      disabledNeg.forEach(d => {
        newNegTags.push(d);
      });

      positiveTags = newPosTags;
      negativeTags = newNegTags;

      hasReceivedInitialData = true;

      editor.setTags(currentMode === 'positive' ? positiveTags : negativeTags);

      lastSentPositive = tagsToString(positiveTags);
      lastSentNegative = tagsToString(negativeTags);

      // Update visual status
      const statusEl = document.getElementById('sync-status');
      if (statusEl) {
        const dict = translations[currentLang] || translations.en;
        statusEl.textContent = dict.status_linked || 'Linked';
        statusEl.style.color = '#4caf50';
      }
    }

    if (msg.type === '__CLEAN_NUMERIC_PREFIXES__') {
      console.log('[Popup] Received cleanup request for numeric prefixes');
      let changed = false;
      const clean = (tag) => {
        const old = tag.value;
        const fixed = old.replace(/^(([sS])(\d+)__.*?__)$/, (match, full, prefix, num) => {
          if (num) {
            const parts = match.split('__');
            return (prefix || 's') + '__' + parts[1] + '__'; // Simple split index logic
          }
          return match;
        });
        if (fixed !== old) {
          changed = true;
          tag.value = fixed;
        }
      };

      positiveTags.forEach(clean);
      negativeTags.forEach(clean);

      if (changed) {
        editor.setTags(currentMode === 'positive' ? positiveTags : negativeTags);
        syncToPage();
      }
    }
  });

  // Initial Request — retry a few times to handle timing issues
  // (injector.js might not have registered its listeners yet)
  requestPromptWithRetry(5, 800);
}

let hasReceivedInitialData = false;

function requestPromptWithRetry(retries, delayMs) {
  requestPrompt();
  if (retries > 0) {
    setTimeout(() => {
      if (!hasReceivedInitialData) {
        requestPromptWithRetry(retries - 1, delayMs);
      }
    }, delayMs);
  }
}

function requestPrompt() {
  console.log('[Popup] Sending GET_PROMPT to active tab');

  // Method 1: Target active tab (Standard Popup)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      console.log('[Popup] Target tab ID:', tabs[0].id);
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PROMPT' });
    } else {
      console.warn('[Popup] No active tab found');
    }
  });

  // Method 2: Broadcast to Runtime (Manager Panel / Iframe / DevTools)
  // If Popup is in an iframe, tabs.query might fail or return the wrong thing.
  // Bridge.js listens to runtime.onMessage too.
  chrome.runtime.sendMessage({ type: 'GET_PROMPT' }, (response) => {
    if (chrome.runtime.lastError) {
      // Ignore "Could not establish connection" if no background listener
      // console.log('Runtime broadcast error (expected if no BG listener):', chrome.runtime.lastError);
    }
  });
}

function syncToPage() {
  const posStr = tagsToString(positiveTags);
  const negStr = tagsToString(negativeTags);

  // Update local echo logic
  lastSentPositive = posStr;
  lastSentNegative = negStr;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SET_PROMPT',
        data: {
          positive: posStr,
          negative: negStr
        }
      });
    }
  });
}
