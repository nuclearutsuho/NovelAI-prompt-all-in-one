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
// State now stores an object per character with both positive and negative prompts
let characterPromptsData = []; // [{ posPrompt: "", posTags: [], negPrompt: "", negTags: [], gender: "other" }]
let charEditors = []; // Array of { editor: TagEditor, activeTab: 'pos' | 'neg' }
let maxCharacters = 6;

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
    btn_quick_random: "Insert Random",
    btn_add_char: "+ Add Character",
    char_title: "Character Prompts"
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
    btn_quick_random: "随机选择",
    btn_add_char: "+ 增加角色",
    char_title: "角色提示词"
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
    btn_quick_random: "ランダム選択",
    btn_add_char: "+ キャラクター追加",
    char_title: "キャラクタープロンプト"
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

// === Character Prompts Logic ===
function updateCharAddButton() {
  const btnAddChar = document.getElementById('btn-add-char');
  if (btnAddChar) {
    btnAddChar.style.display = characterPromptsData.length < maxCharacters ? 'block' : 'none';
  }
}

function syncCharactersToPage() {
  if (chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Prepare the payload 
        // Our characterPromptsData contains { posPrompt, posTags, negPrompt, negTags, gender }
        // We only need to send prompts to the page injection layer
        const payload = characterPromptsData.map(char => ({
            positive: char.posPrompt,
            negative: char.negPrompt,
            gender: char.gender,
            activeTab: char.activeTab
        }));

        lastSentCharacterPrompts = payload; // save for echo debounce
        console.log('[Phase 2] Syncing Characters to Page =>', payload);
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_CHARACTER_PROMPTS',
          data: payload
        });
      }
    });
  } else {
    console.log('[Phase 1 fallback] Local sync triggered. Current Data:\n', JSON.parse(JSON.stringify(characterPromptsData)));
  }
}

function createCharacterEditor(index, initialPos = '', initialNeg = '', initialTab = 'pos') {
  const template = document.getElementById('char-prompt-template');
  const container = document.getElementById('char-list-container');
  
  if (!template || !container) return;
  
  const clone = template.content.cloneNode(true);
  const block = clone.querySelector('.char-prompt-block');
  const inputArea = clone.querySelector('.char-input-area');

  // Insert Character Index Label at the start
  const indexLabel = document.createElement('span');
  indexLabel.className = 'char-index-label';
  indexLabel.textContent = '#' + (index + 1);
  inputArea.insertBefore(indexLabel, inputArea.firstChild);

  const editorContainer = clone.querySelector('.char-editor-container');
  const input = clone.querySelector('.char-quick-input');
  const btnAdd = clone.querySelector('.primary-add-btn');
  const btnWildcard = clone.querySelector('.char-btn-wildcard');
  const btnSeqWildcard = clone.querySelector('.char-btn-seq-wildcard');
  const btnRandom = clone.querySelector('.char-btn-random');
  const deleteBtn = clone.querySelector('.char-delete');

  // Apply translations directly to the new clone components
  const dict = translations[currentLang] || translations.en;
  if(btnAdd && dict.btn_add) btnAdd.textContent = dict.btn_add;
  if(input && dict.input_placeholder) input.placeholder = dict.input_placeholder;
  if(btnWildcard && dict.btn_quick_wildcard) {
      btnWildcard.title = dict.btn_quick_wildcard;
      btnWildcard.textContent = dict.btn_quick_wildcard;
  }
  if(btnSeqWildcard && dict.btn_quick_seq_wildcard) {
      btnSeqWildcard.title = dict.btn_quick_seq_wildcard;
      btnSeqWildcard.textContent = dict.btn_quick_seq_wildcard;
  }
  if(btnRandom && dict.btn_quick_random) {
      btnRandom.title = dict.btn_quick_random;
      btnRandom.textContent = dict.btn_quick_random;
  }

  // Initialize data if not fully set
  if (!characterPromptsData[index]) {
    characterPromptsData[index] = { 
        posPrompt: initialPos, 
        posTags: parsePromptToTags(initialPos), 
        negPrompt: initialNeg,
        negTags: parsePromptToTags(initialNeg),
        gender: "other",
        activeTab: initialTab === 'neg' ? 'negative' : 'positive'
    };
  } else {
    // Sync the internal state tracking and force 'other' explicitly
    characterPromptsData[index].gender = 'other';
    characterPromptsData[index].activeTab = initialTab === 'neg' ? 'negative' : 'positive';
  }

  // Set up Delete
  deleteBtn.addEventListener('click', () => {
    characterPromptsData.splice(index, 1);
    const editorObj = charEditors[index];
    if (editorObj && editorObj.editor && typeof editorObj.editor.destroy === 'function') {
        try { editorObj.editor.destroy(); } catch(e){}
    }
    charEditors.splice(index, 1);
    rebuildCharacterPromptsUI();
    syncCharactersToPage();
  });

  // Set up Editor
  const charEditor = new TagEditor(editorContainer, {
    onChange: (tags) => {
      const active = charEditors[index]?.activeTab || 'pos';
      if (active === 'pos') {
          characterPromptsData[index].posTags = tags;
          characterPromptsData[index].posPrompt = tagsToString(tags);
      } else {
          characterPromptsData[index].negTags = tags;
          characterPromptsData[index].negPrompt = tagsToString(tags);
      }
      syncCharactersToPage();
    }
  });


  // Set up Pos/Neg Toggles
  const btnPos = clone.querySelector('.char-tab-pos');
  const btnNeg = clone.querySelector('.char-tab-neg');

  const switchTab = (tab, fromUserClick = true) => {
    charEditors[index].activeTab = tab;
    // Sync to data model so syncCharactersToPage() sends the correct Tab state
    characterPromptsData[index].activeTab = tab === 'neg' ? 'negative' : 'positive';
    
    // Update active UI classes
    if (tab === 'pos') {
        btnPos.classList.add('active');
        btnNeg.classList.remove('active');
        editorContainer.classList.remove('negative-mode');
        // Load pos tags
        charEditor.setTags(characterPromptsData[index].posTags || []);
    } else {
        btnNeg.classList.add('active');
        btnPos.classList.remove('active');
        editorContainer.classList.add('negative-mode');
        // Load neg tags
        charEditor.setTags(characterPromptsData[index].negTags || []);
    }
    
    // Sync the tab switch to the injecting page so it switches the active view there
    if (fromUserClick && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SWITCH_TAB',
            data: {
                tab: tab === 'pos' ? 'positive' : 'negative',
                index: index
            }
          });
        }
      });
    }
  };
  
  // Track the state wrapper and expose switchTab
  charEditors[index] = { editor: charEditor, activeTab: 'pos', switchTab };

  btnPos.addEventListener('click', () => switchTab('pos'));
  btnNeg.addEventListener('click', () => switchTab('neg'));

  // Attach autocomplete logic so TagEditor can render translations and weights
  if (autocomplete) {
    charEditor.bindAutocomplete(autocomplete);
  }

  // Initial load, explicitly do NOT broadcast to page
  switchTab(initialTab, false);

  // Bind autocomplete to this new input
  autocomplete.attach(input, (val) => {
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    const cleanTags = newTags.map(t => {
      const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
      return isWildcard ? t : t.replace(/_/g, ' ');
    });
    // Use local closure reference 'charEditor' not the mutable charEditors[]
    cleanTags.forEach(t => charEditor.addTag(t));
    input.value = '';
    input.focus();
  });

  // Attach buttons
  const addTag = () => {
    const val = input.value.trim();
    if (val) {
      const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
      const cleanTags = newTags.map(t => {
        const isWildcard = /^(s|S)?(\d+)?__.*__$/.test(t);
        return isWildcard ? t : t.replace(/_/g, ' ');
      });
      // Use local closure reference 'charEditor'
      cleanTags.forEach(t => charEditor.addTag(t));
      input.value = '';
    }
    if (autocomplete) autocomplete.hide();
  };

  btnAdd.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setTimeout(() => { if (input.value.trim()) addTag(); }, 100);
    }
  });

  btnWildcard.addEventListener('mousedown', (e) => e.preventDefault());
  btnWildcard.addEventListener('click', () => {
    input.value += '__';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  btnSeqWildcard.addEventListener('mousedown', (e) => e.preventDefault());
  btnSeqWildcard.addEventListener('click', () => {
    input.value += 's__';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  btnRandom.addEventListener('click', () => {
    // Use local closure reference 'charEditor'
    charEditor.addTag('||');
    input.focus();
  });

  container.appendChild(block);
}

function rebuildCharacterPromptsUI() {
  const container = document.getElementById('char-list-container');
  if (!container) return;
  
  // Clear existing
  container.innerHTML = '';
  charEditors = [];

  // Re-render
  characterPromptsData.forEach((charData, index) => {
    createCharacterEditor(index, charData.posPrompt, charData.negPrompt, charData.activeTab === 'negative' ? 'neg' : 'pos');
  });
  
  updateCharAddButton();
}

function initUI() {
  // Autocomplete
  autocomplete = new Autocomplete();
  autocomplete.load();

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', (e) => switchTab('positive', e.isTrusted));
  tabNegative.addEventListener('click', (e) => switchTab('negative', e.isTrusted));

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

  // Character Prompt Add Button
  const btnAddChar = document.getElementById('btn-add-char');
  if (btnAddChar) {
    btnAddChar.addEventListener('click', () => {
      if (characterPromptsData.length < maxCharacters) {
        characterPromptsData.push({ 
            posPrompt: '', posTags: [], 
            negPrompt: '', negTags: [], 
            gender: 'other' 
        });
        rebuildCharacterPromptsUI();
        syncCharactersToPage();
      }
    });
  }

  // Resizer Logic
  const resizer = document.getElementById('resizer');
  const charSection = document.getElementById('character-prompts-section');
  if (resizer && charSection) {
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
      // Calculate delta relative to movement UPWARD
      const dy = startY - e.clientY;
      const newHeight = Math.max(80, startHeight + dy);
      charSection.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      resizer.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Save user preference
      chrome.storage.local.set({ charSectionHeight: charSection.style.height });
    };

    resizer.addEventListener('mousedown', (e) => {
      startY = e.clientY;
      startHeight = charSection.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      resizer.classList.add('active');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    // Initialize saved height
    chrome.storage.local.get(['charSectionHeight'], (data) => {
        if(data.charSectionHeight) {
            charSection.style.height = data.charSectionHeight;
        }
    });
  }

  // Input Area
  const input = document.getElementById('quick-input');
  const btnAdd = document.getElementById('btn-add');
  const btnQuickWildcard = document.getElementById('btn-quick-wildcard');
  const btnQuickSeqWildcard = document.getElementById('btn-quick-seq-wildcard');
  const btnQuickRandom = document.getElementById('btn-quick-random');

  if (btnQuickWildcard) {
    btnQuickWildcard.addEventListener('mousedown', (e) => e.preventDefault());
    btnQuickWildcard.addEventListener('click', () => {
      input.value += '__';
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  if (btnQuickSeqWildcard) {
    btnQuickSeqWildcard.addEventListener('mousedown', (e) => e.preventDefault());
    btnQuickSeqWildcard.addEventListener('click', () => {
      input.value += 's__';
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

function switchTab(mode, fromUserClick = false) {
  currentMode = mode;

  document.getElementById('tab-positive').classList.toggle('active', mode === 'positive');
  document.getElementById('tab-negative').classList.toggle('active', mode === 'negative');

  if (mode === 'positive') {
    editor.setTags(positiveTags);
  } else {
    editor.setTags(negativeTags);
  }

  // Notify webpage about the tab switch
  if (fromUserClick) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SWITCH_TAB',
          data: {
              tab: mode,
              index: -1 // -1 indicates Base Prompt
          }
        });
      }
    });
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
let lastSentCharacterPrompts = [];

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
      hasReceivedInitialData = true;
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

      // Only update if the incoming data is genuinely different from our current state
      // AND it's not undefined (meaning it wasn't hidden on the page)
      let shouldUpdatePos = positive !== undefined && normalizePrompt(positive) !== normalizePrompt(currentPosStr);
      let shouldUpdateNeg = negative !== undefined && normalizePrompt(negative) !== normalizePrompt(currentNegStr);

      if (!shouldUpdatePos && !shouldUpdateNeg) {
         // Nothing new to apply or everything is hidden
         return;
      }

      // Apply external change
      // logic: If we are receiving a TRUE update from the page, we want to
      // PRESERVE the currently disabled tags in the popup.
      // Because the page doesn't know about disabled tags (it only sees active ones).
      const disabledPos = positiveTags.filter(t => t.disabled);
      const disabledNeg = negativeTags.filter(t => t.disabled);

      if (shouldUpdatePos) {
          rawPositive = positive || '';
          const newPosTags = parsePromptToTags(rawPositive);
          disabledPos.forEach(d => newPosTags.push(d));
          positiveTags = newPosTags;
      }

      if (shouldUpdateNeg) {
          rawNegative = negative || '';
          const newNegTags = parsePromptToTags(rawNegative);
          disabledNeg.forEach(d => newNegTags.push(d));
          negativeTags = newNegTags;
      }

      // Update UI if we are on the relevant tab
      if (currentMode === 'positive' && shouldUpdatePos) editor.setTags(positiveTags);
      if (currentMode === 'negative' && shouldUpdateNeg) editor.setTags(negativeTags);
      
    } else if (msg.type === 'RETURN_CHARACTER_PROMPTS') {
      const charPrompts = msg.data || [];
      
      let uiNeedsRebuild = false;
      if (characterPromptsData.length !== charPrompts.length) {
          uiNeedsRebuild = true;
          // Trim removed characters from memory instantly
          if (characterPromptsData.length > charPrompts.length) {
              characterPromptsData.length = charPrompts.length;
              charEditors.length = charPrompts.length;
          }
      }

      let changesApplied = false;

      charPrompts.forEach((c, i) => {
          const charObj = characterPromptsData[i] || { posTags: [], negTags: [], posPrompt: '', negPrompt: '', gender: 'other' };
          
          const currentPosStr = normalizePrompt(charObj.posPrompt || '');
          const currentNegStr = normalizePrompt(charObj.negPrompt || '');
          // If the webpage gives us undefined, it means that tab wasn't active. Ignore those in comparison.
          const incomingPosStr = c.positive !== undefined ? normalizePrompt(c.positive) : currentPosStr;
          const incomingNegStr = c.negative !== undefined ? normalizePrompt(c.negative) : currentNegStr;

          let shouldUpdatePos = c.positive !== undefined && incomingPosStr !== currentPosStr;
          let shouldUpdateNeg = c.negative !== undefined && incomingNegStr !== currentNegStr;

          if (!shouldUpdatePos && !shouldUpdateNeg && i < characterPromptsData.length) {
              return; // Skip if identical (Debounce echo naturally)
          }

          changesApplied = true;

          const disabledPos = (charObj.posTags || []).filter(t => t.disabled);
          const disabledNeg = (charObj.negTags || []).filter(t => t.disabled);

          let newPosTags = charObj.posTags || [];
          let newNegTags = charObj.negTags || [];
          
          if (shouldUpdatePos || charObj.posPrompt === undefined) {
              newPosTags = parsePromptToTags(c.positive || '');
              disabledPos.forEach(d => newPosTags.push(d));
              charObj.posPrompt = c.positive || '';
              charObj.posTags = newPosTags;
          }

          if (shouldUpdateNeg || charObj.negPrompt === undefined) {
              newNegTags = parsePromptToTags(c.negative || '');
              disabledNeg.forEach(d => newNegTags.push(d));
              charObj.negPrompt = c.negative || '';
              charObj.negTags = newNegTags;
          }

          charObj.gender = c.gender !== undefined ? c.gender : (charObj.gender || 'other');
          charObj.activeTab = c.activeTab !== undefined ? c.activeTab : (charObj.activeTab || 'pos');
          
          // Apply changes to array
          characterPromptsData[i] = charObj;

          // Inline update of TagEditor if UI doesn't need full rebuild to protect current input focus
          if (!uiNeedsRebuild && charEditors[i] && charEditors[i].editor) {
              const activeTab = charEditors[i].activeTab;
              if (activeTab === 'pos' && shouldUpdatePos) {
                  charEditors[i].editor.setTags(newPosTags);
              } else if (activeTab === 'neg' && shouldUpdateNeg) {
                  charEditors[i].editor.setTags(newNegTags);
              }
          }
      });

      if (uiNeedsRebuild || (changesApplied && characterPromptsData.length === 0)) {
          console.log('[Phase 2] Found structural changes, rebuilding UI...');
          rebuildCharacterPromptsUI();
      }
    } // End of RETURN_CHARACTER_PROMPTS

    // The following block runs for RETURN_PROMPT
    if (msg.type === 'RETURN_PROMPT') {
      // Update visual status
      const statusEl = document.getElementById('sync-status');
      if (statusEl) {
        const dict = translations[currentLang] || translations.en;
        statusEl.textContent = dict.status_linked || 'Linked';
        statusEl.style.color = '#4caf50';
      }

      lastSentPositive = tagsToString(positiveTags);
      lastSentNegative = tagsToString(negativeTags);
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

    if (msg.type === 'SYNC_TAB') {
      const payload = msg.data;
      if (typeof payload === 'string') {
        // Backwards compatibility or direct base tab switch
        if (currentMode !== payload) {
          switchTab(payload, false);
        }
      } else if (payload && payload.tab) {
        const { tab, index } = payload;
        if (index === -1) {
          if (currentMode !== tab) {
            switchTab(tab, false);
          }
        } else if (index >= 0 && index < charEditors.length) {
          const charEd = charEditors[index];
          const innerTab = tab === 'positive' ? 'pos' : 'neg';
          if (charEd && charEd.activeTab !== innerTab && charEd.switchTab) {
            charEd.switchTab(innerTab, false);
          }
        }
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
