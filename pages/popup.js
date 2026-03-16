import TagEditor from '../lib/TagEditor.js';
import common from '../lib/common.js';
import Autocomplete from '../lib/Autocomplete.js';

let editor;
let autocomplete;
let currentMode = 'positive'; // 'positive' | 'negative'
let rawPositive = '';
let rawNegative = '';
let positiveTags = [];
let negativeTags = [];
const isEmbeddedPopup = window !== window.top;
const popupHostSessionId = new URLSearchParams(window.location.search).get('hostSession') || '';
// State now stores an object per character with both positive and negative prompts
let characterPromptsData = []; // [{ posPrompt: "", posTags: [], negPrompt: "", negTags: [], gender: "other" }]
let charEditors = []; // Array of { editor: TagEditor, activeTab: 'pos' | 'neg' }
let maxCharacters = 6;
let isShortMode = false;
let currentGroupColorMap = {};
let currentGroupTranslationMap = {};
let currentSequentialCounters = {};

const groupTagsDataUtils = window.GroupTagsDataUtils || {};
const EMPTY_GROUP_TAGS_DATA = { categories: [] };
let defaultGroupTagsPromise = null;
let popupToastTimer = null;
let popupToastFrame = null;
const groupTagsPickerState = {
  resolve: null,
  activeCategoryId: null,
  tagData: null,
  groupTagsData: null
};

// 焦点追踪：当前 GroupTags 面板将追加标签的目标编辑器
// type: 'base' | 'character', charIndex: number, mode: 'positive'|'negative'|'pos'|'neg'
let activeEditorTarget = { type: 'base', mode: 'positive' };

// Language Support
const translations = {
  en: {
    tab_positive: "Positive Prompts",
    tab_positive_short: "Pos",
    tab_negative: "Negative Prompts",
    tab_negative_short: "Neg",
    status_ready: "Ready",
    loading: "Connecting to NovelAI...",
    input_placeholder: "Enter tag...",
    btn_add: "Add",
    settings_title: "Settings",
    setting_preserve: "Keep Prompts Same on Enhance (img2img)",
    setting_preserve_desc: "When checked, Enhance (img2img) temporarily disables wildcards, keeping prompts identical to the input image.",
    setting_alt_autocomplete: "Enable Plugin Danbooru Autocomplete",
    setting_alt_autocomplete_desc: "Use A1111 WebUI style autocomplete UI and logic.",
    setting_trigger_keys: "Webpage Native Input Autocomplete Trigger Keys:",
    setting_space: "Space",
    setting_tab: "Tab",
    status_linked: "Connection Normal",
    btn_library: "Resource Center",
    btn_settings: "Settings",
    tag_help_tooltip: "Left-Click: Edit | Double-Click: Disable/Enable | Drag: Reorder",
    setting_render_newlines: "Render Newline Separators",
    setting_render_newlines_desc: "Show a dividing line when newline tags are encountered in the UI.",
    btn_quick_wildcard: "Random Draw",
    btn_quick_wildcard_short: "Rnd",
    btn_quick_seq_wildcard: "Sequential Draw",
    btn_quick_seq_wildcard_short: "Seq",
    btn_quick_random: "Dynamic Draw",
    btn_quick_random_short: "Dyn",
    btn_add_char: "+ Add Character",
    btn_add_char_short: "+ Char",
    char_title: "Character Prompts",
    char_title_short: "Characters",
    btn_remove_char: "Remove Character",
    dyn_min: "Min Picks",
    dyn_max: "Max Picks",
    dyn_sep: "Custom Separator",
    btn_fav: "Favorite",
    btn_copy: "Copy This Tag",
    btn_dec_weight: "Decrease Weight",
    btn_edit_weight: "Edit Weight",
    btn_inc_weight: "Increase Weight",
    btn_dec_dyn_weight: "Decrease Draw Probability",
    btn_edit_dyn_weight: "Edit Draw Probability",
    btn_inc_dyn_weight: "Increase Draw Probability",
    btn_split: "Split into Independent Tags",
    btn_merge: "Merge into Group",
    btn_toggle: "Enable/Disable",
    btn_del: "Delete",
    res_sp: "Small Portrait",
    res_sl: "Small Landscape",
    res_ss: "Small Square",
    res_np: "Normal Portrait",
    res_nl: "Normal Landscape",
    res_ns: "Normal Square",
    res_lp: "Large Portrait",
    res_ll: "Large Landscape",
    res_ls: "Large Square",
    res_custom: "Custom",
    res_presets: "Presets",
    res_seq: "Sequential",
    res_rnd: "Random",
    res_add_preset: "Add Preset",
    res_selected_none: "None",
    res_selected_none_short: "0",
    res_selected_count: "[{n} Selected]",
    res_selected_count_short: "[ {n} ]",
    res_multi_trigger: "Multi-Resolution Settings",
    btn_swap_res: "Swap Width/Height",
    res_w: "W",
    res_h: "H",
    setting_hide_autoclicker: "Hide Count Bar",
    setting_hide_autoclicker_desc: "Hide the auto-clicker status bar at the bottom.",
    btn_history: "History & Favorites",
    ac_mode_fixed_short: "Fixed",
    ac_mode_on_image_short: "On Img",
    ac_mode_fixed_title: "Fixed Interval",
    ac_mode_on_image_title: "On Image",
    btn_group_tags: "Group Tags",
    btn_group_tags_short: "Groups",
    btn_group_tags_title: "Open Group Tags Panel",
    btn_add_to_group_tags: "Add to Group Tags",
    group_tags_picker_title: "Add to Group Tags",
    group_tags_picker_empty: "No Group Tags groups available. Create one first.",
    group_tags_picker_expand: "Expand category",
    group_tags_picker_collapse: "Collapse category",
    group_tags_picker_duplicate: "Already exists in",
    group_tags_picker_missing: "The selected Group Tags group no longer exists.",
    group_tags_picker_added_prefix: "Added to",
    toast_success: "Success",
    toast_warning: "Notice",
    toast_error: "Error",
    toast_close: "Close notification",
    group_tags_picker_close: "Close panel",
    group_tags_picker_trans_placeholder: "Enter translation",
    setting_storage_usage: "Storage Usage",
    btn_toggle_char_prompts: "Toggle Character Prompts"
  },
  zh: {
    tab_positive: "正向提示词",
    tab_positive_short: "正",
    tab_negative: "负向提示词",
    tab_negative_short: "负",
    status_ready: "就绪",
    loading: "正在连接 NovelAI...",
    input_placeholder: "输入tag...",
    btn_add: "添加",
    settings_title: "设置",
    setting_preserve: "图生图(Enhance)时使用相同提示词",
    setting_preserve_desc: "勾选此选项时,图生图(Enhance)时暂时禁用通配符功能,通配符固定使用与输入图像相同的提示词。",
    setting_alt_autocomplete: "开启插件 Danbooru 自动补全",
    setting_alt_autocomplete_desc: "使用A1111 WebUI 风格的补全UI与逻辑。",
    setting_trigger_keys: "网页原生输入框自动补全触发按键:",
    setting_space: "空格",
    setting_tab: "Tab 键",
    status_linked: "连接正常",
    btn_library: "资源中心",
    btn_settings: "设置",
    tag_help_tooltip: "左键点击编辑 | 双击禁用/启用 | 拖动进行排序",
    setting_render_newlines: "换行符渲染分隔线",
    setting_render_newlines_desc: "在界面中遇到换行标签时显示分隔线。",
    btn_quick_wildcard: "随机抽取",
    btn_quick_wildcard_short: "随机",
    btn_quick_seq_wildcard: "顺序抽取",
    btn_quick_seq_wildcard_short: "顺序",
    btn_quick_random: "动态抽取",
    btn_quick_random_short: "动态",
    btn_add_char: "+ 增加角色",
    btn_add_char_short: "+ 角色",
    char_title: "角色提示词",
    char_title_short: "角色",
    btn_remove_char: "删除角色",
    dyn_min: "最小选取数",
    dyn_max: "最大选取数",
    dyn_sep: "自定义分隔符",
    btn_fav: "收藏",
    btn_copy: "复制此 Tag",
    btn_dec_weight: "降低权重",
    btn_edit_weight: "编辑权重",
    btn_inc_weight: "增加权重",
    btn_dec_dyn_weight: "降低被抽中概率",
    btn_edit_dyn_weight: "编辑被抽中概率",
    btn_inc_dyn_weight: "增加被抽中概率",
    btn_split: "拆分为独立 Tag",
    btn_merge: "合并为组合",
    btn_toggle: "启用/禁用",
    btn_del: "删除",
    res_sp: "小型尺寸 (竖)",
    res_sl: "小型尺寸 (横)",
    res_ss: "小型尺寸 (方)",
    res_np: "标准尺寸 (竖)",
    res_nl: "标准尺寸 (横)",
    res_ns: "标准尺寸 (方)",
    res_lp: "大型尺寸 (竖)",
    res_ll: "大型尺寸 (横)",
    res_ls: "大型尺寸 (方)",
    res_custom: "自定义",
    res_presets: "预设分辨率",
    res_seq: "顺序切换",
    res_rnd: "随机切换",
    res_add_preset: "添加预设",
    res_selected_none: "未选择",
    res_selected_none_short: "0",
    res_selected_count: "[已选 {n} 项]",
    res_selected_count_short: "[ {n} ]",
    res_multi_trigger: "多选分辨率设置",
    btn_swap_res: "交换宽高",
    res_w: "宽",
    res_h: "高",
    setting_hide_autoclicker: "隐藏整个计数条",
    setting_hide_autoclicker_desc: "隐藏页面底部的连点器状态条。",
    btn_history: "历史与收藏",
    ac_mode_fixed_short: "定时",
    ac_mode_on_image_short: "看图",
    ac_mode_fixed_title: "定时模式",
    ac_mode_on_image_title: "出图后再点",
    btn_group_tags: "分组标签",
    btn_group_tags_short: "分组",
    btn_group_tags_title: "打开分组标签面板",
    btn_add_to_group_tags: "加入分组标签",
    group_tags_picker_title: "加入分组标签",
    group_tags_picker_empty: "当前没有可用的分组，请先在 Group Tags 中创建。",
    group_tags_picker_expand: "展开分类",
    group_tags_picker_collapse: "收起分类",
    group_tags_picker_duplicate: "已存在于",
    group_tags_picker_missing: "所选分组已不存在。",
    group_tags_picker_added_prefix: "已加入",
    toast_success: "成功",
    toast_warning: "提示",
    toast_error: "错误",
    toast_close: "关闭通知",
    group_tags_picker_close: "关闭面板",
    group_tags_picker_trans_placeholder: "输入翻译",
    setting_storage_usage: "存储空间占用",
    btn_toggle_char_prompts: "切换角色提示词显示"
  },
  jp: {
    tab_positive: "ポジティブプロンプト",
    tab_positive_short: "ポジ",
    tab_negative: "ネガティブプロンプト",
    tab_negative_short: "ネガ",
    status_ready: "準備完了",
    loading: "NovelAIに接続中...",
    input_placeholder: "タグを入力...",
    btn_add: "追加",
    settings_title: "設定",
    setting_preserve: "Enhance(img2img)時に同じプロンプトを使用",
    setting_preserve_desc: "有効にすると、Enhance(img2img)時にワイルドカードを一時無効にし、入力画像と全く同じプロンプトを使用します。",
    setting_alt_autocomplete: "プラグインのDanbooru自動補完を有効化",
    setting_alt_autocomplete_desc: "A1111 WebUIスタイルの自動補完UIとロジックを使用します。",
    setting_trigger_keys: "Webページネイティブ入力の自動補完トリガーキー:",
    setting_space: "スペース",
    setting_tab: "Tabキー",
    status_linked: "接続正常",
    btn_library: "リソースセンター",
    btn_settings: "設定",
    tag_help_tooltip: "左クリック：編集 | ダブルクリック：無効/有効 | ドラッグ：並べ替え",
    setting_render_newlines: "改行セパレーターを表示",
    setting_render_newlines_desc: "UIで改行タグが検出された際に区切り線を表示します。",
    btn_quick_wildcard: "ランダム抽出",
    btn_quick_wildcard_short: "乱",
    btn_quick_seq_wildcard: "順次抽出",
    btn_quick_seq_wildcard_short: "順",
    btn_quick_random: "ダイナミック抽出",
    btn_quick_random_short: "動",
    btn_add_char: "+ キャラクター追加",
    btn_add_char_short: "+ キャラ",
    char_title: "キャラクタープロンプト",
    char_title_short: "キャラ",
    btn_remove_char: "キャラクターを削除",
    dyn_min: "最小抽出数",
    dyn_max: "最大抽出数",
    dyn_sep: "カスタム区切り文字",
    btn_fav: "お気に入り",
    btn_copy: "このタグをコピー",
    btn_dec_weight: "重みを下げる",
    btn_edit_weight: "重みを編集",
    btn_inc_weight: "重みを上げる",
    btn_dec_dyn_weight: "抽選確率を下げる",
    btn_edit_dyn_weight: "抽選確率を編集",
    btn_inc_dyn_weight: "抽選確率を上げる",
    btn_split: "独立したタグに分割",
    btn_merge: "グループとして結合",
    btn_toggle: "有効化/無効化",
    btn_del: "削除",
    res_sp: "スモール (縦)",
    res_sl: "スモール (横)",
    res_ss: "スモール (正方形)",
    res_np: "ノーマル (縦)",
    res_nl: "ノーマル (横)",
    res_ns: "ノーマル (正方形)",
    res_lp: "ラージ (縦)",
    res_ll: "ラージ (横)",
    res_ls: "ラージ (正方形)",
    res_custom: "カスタム",
    res_presets: "プリセット",
    res_seq: "順次",
    res_rnd: "ランダム",
    res_add_preset: "プリセットを追加",
    res_selected_none: "未選択",
    res_selected_none_short: "0",
    res_selected_count: "[{n}件 選択中]",
    res_selected_count_short: "[ {n} ]",
    res_multi_trigger: "多解像度設定",
    btn_swap_res: "幅と高さを入れ替え",
    res_w: "幅",
    res_h: "高",
    setting_hide_autoclicker: "カウントバーを隠す",
    setting_hide_autoclicker_desc: "ページ下部のオートクリッカーバーを非表示にします。",
    btn_history: "履歴とお気に入り",
    ac_mode_fixed_short: "固定",
    ac_mode_on_image_short: "画像後",
    ac_mode_fixed_title: "固定間隔",
    ac_mode_on_image_title: "画像生成後",
    btn_group_tags: "グループタグ",
    btn_group_tags_short: "グループ",
    btn_group_tags_title: "グループタグパネルを開く",
    btn_add_to_group_tags: "グループタグに追加",
    group_tags_picker_title: "グループタグに追加",
    group_tags_picker_empty: "利用可能なグループがありません。先に Group Tags で作成してください。",
    group_tags_picker_expand: "カテゴリを展開",
    group_tags_picker_collapse: "カテゴリを折りたたむ",
    group_tags_picker_duplicate: "既に存在",
    group_tags_picker_missing: "選択したグループは既に存在しません。",
    group_tags_picker_added_prefix: "追加先",
    toast_success: "成功",
    toast_warning: "案内",
    toast_error: "エラー",
    toast_close: "通知を閉じる",
    group_tags_picker_close: "パネルを閉じる",
    setting_storage_usage: "ストレージ使用量",
    btn_toggle_char_prompts: "キャラクタープロンプトの表示切替"
  }
};

let currentLang = 'en';

let hasReceivedInitialChars = false;

function computeStateFingerprint(posT, negT, charD) {
  const posF = JSON.stringify((posT || []).map(t => [t.value, !!t.disabled]));
  const negF = JSON.stringify((negT || []).map(t => [t.value, !!t.disabled]));
  const charsStr = JSON.stringify(getMeaningfulCharacterHistoryData(charD).map(c => ({
    p: c.posPrompt || '', n: c.negPrompt || '',
    pd: (c.posTags || []).map(t => [t.value, !!t.disabled]),
    nd: (c.negTags || []).map(t => [t.value, !!t.disabled])
  })));
  return posF + negF + charsStr;
}

function hasMeaningfulCharacterHistoryContent(character) {
  if (!character) return false;
  const posPrompt = normalizePrompt(character.posPrompt || tagsToString(character.posTags || []));
  const negPrompt = normalizePrompt(character.negPrompt || tagsToString(character.negTags || []));
  return !!posPrompt || !!negPrompt;
}

function getMeaningfulCharacterHistoryData(characters) {
  return (characters || []).filter(character => hasMeaningfulCharacterHistoryContent(character));
}

function cloneGroupTagsData(data) {
  // 统一走深拷贝，避免 popup 直接修改到缓存中的默认数据对象
  if (groupTagsDataUtils.cloneData) {
    return groupTagsDataUtils.cloneData(data || EMPTY_GROUP_TAGS_DATA);
  }
  return JSON.parse(JSON.stringify(data || EMPTY_GROUP_TAGS_DATA));
}

function getPopupDict() {
  return translations[currentLang] || translations.en;
}

function getLocalizedText(key, fallback = '') {
  const dict = getPopupDict();
  const fallbackDict = translations.en || {};
  return dict[key] || fallbackDict[key] || fallback;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAddToGroupTagsText() {
  const dict = getPopupDict();
  return dict.btn_add_to_group_tags || `${dict.btn_add || 'Add'} ${dict.btn_group_tags || 'Group Tags'}`.trim();
}

function getToastMeta(type) {
  const dict = getPopupDict();
  if (type === 'success') {
    return {
      title: dict.toast_success || 'Success',
      icon: '✓',
      duration: 1800
    };
  }
  if (type === 'warning') {
    return {
      title: dict.toast_warning || 'Notice',
      icon: '!',
      duration: 2800
    };
  }
  return {
    title: dict.toast_error || 'Error',
    icon: '×',
    duration: 4200
  };
}

function getSafeToastMeta(type) {
  const meta = getToastMeta(type) || {};
  if (type === 'success') {
    return { ...meta, icon: '✓' };
  }
  if (type === 'error') {
    return { ...meta, icon: '×' };
  }
  return { ...meta, icon: '!' };
}

function dismissPopupToast(immediate = false) {
  const root = document.getElementById('popup-toast-root');
  const toastEl = root?.querySelector('.popup-toast');
  clearTimeout(popupToastTimer);
  popupToastTimer = null;

  if (!toastEl) return;
  const removeToast = () => {
    if (popupToastFrame !== null) {
      cancelAnimationFrame(popupToastFrame);
      popupToastFrame = null;
    }
    toastEl.remove();
  };

  if (immediate) {
    removeToast();
    return;
  }

  toastEl.classList.remove('visible');
  window.setTimeout(removeToast, 180);
}

function showPopupToast(type, message) {
  const root = document.getElementById('popup-toast-root');
  if (!root) return;

  dismissPopupToast(true);
  const meta = getSafeToastMeta(type);
  const toastEl = document.createElement('div');
  toastEl.className = `popup-toast ${type}`;

  const closeBtnHtml = type === 'error'
    ? `<button type="button" class="popup-toast-close" aria-label="${getLocalizedText('toast_close', 'Close notification')}">×</button>`
    : '';

  toastEl.innerHTML = `
    <span class="popup-toast-icon" aria-hidden="true">${meta.icon}</span>
    <div class="popup-toast-body">
      <div class="popup-toast-title">${escapeHtml(meta.title)}</div>
      <div class="popup-toast-message">${escapeHtml(message)}</div>
    </div>
    ${closeBtnHtml}
  `;

  const iconEl = toastEl.querySelector('.popup-toast-icon');
  if (iconEl) iconEl.textContent = meta.icon;
  const closeBtn = toastEl.querySelector('.popup-toast-close');
  if (closeBtn) closeBtn.textContent = '×';

  if (type === 'error') {
    closeBtn?.addEventListener('click', () => dismissPopupToast());
  }

  root.appendChild(toastEl);
  popupToastFrame = requestAnimationFrame(() => {
    popupToastFrame = null;
    toastEl.classList.add('visible');
  });

  popupToastTimer = window.setTimeout(() => {
    popupToastTimer = null;
    dismissPopupToast();
  }, meta.duration);
}

function applyGroupMapsToEditors(colorMap = {}, translationMap = {}, shouldRender = true) {
  // popup 与所有角色编辑器共用同一份分组颜色/翻译映射
  currentGroupColorMap = colorMap || {};
  currentGroupTranslationMap = translationMap || {};

  if (editor) {
    editor.groupColorMap = currentGroupColorMap;
    editor.groupTranslationMap = currentGroupTranslationMap;
    if (shouldRender) editor.render();
  }

  charEditors.forEach(charEditorObj => {
    if (!charEditorObj?.editor) return;
    charEditorObj.editor.groupColorMap = currentGroupColorMap;
    charEditorObj.editor.groupTranslationMap = currentGroupTranslationMap;
    if (shouldRender) charEditorObj.editor.render();
  });
}

async function loadDefaultGroupTagsData() {
  if (!defaultGroupTagsPromise) {
    // 默认库只加载一次，后续复用 Promise，避免每次点 +G 都重新 fetch
    defaultGroupTagsPromise = fetch(chrome.runtime.getURL('data/default_group_tags.json'))
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to load default Group Tags: ${response.status}`);
        }
        return response.json();
      })
      .catch(err => {
        console.error('[Popup] Failed to load default Group Tags:', err);
        return cloneGroupTagsData(EMPTY_GROUP_TAGS_DATA);
      });
  }

  return cloneGroupTagsData(await defaultGroupTagsPromise);
}

async function loadEffectiveGroupTagsData() {
  let storedGroupTagsData = (await chrome.storage.local.get('groupTagsUserData')).groupTagsUserData;
  if (storedGroupTagsData?.categories && groupTagsDataUtils.migrateStoredGroupTagsData) {
    const migrated = await groupTagsDataUtils.migrateStoredGroupTagsData();
    storedGroupTagsData = migrated.data || storedGroupTagsData;
  }
  const defaultData = await loadDefaultGroupTagsData();
  // popup 看到的数据必须和 Group Tags 面板一致：用户数据优先，默认库只补新增
  if (groupTagsDataUtils.resolveEffectiveGroupTagsData) {
    return groupTagsDataUtils.resolveEffectiveGroupTagsData(defaultData, storedGroupTagsData);
  }
  return storedGroupTagsData?.categories ? cloneGroupTagsData(storedGroupTagsData) : cloneGroupTagsData(defaultData);
}

function buildGroupTagsColorMap(data) {
  if (groupTagsDataUtils.buildColorMap) {
    return groupTagsDataUtils.buildColorMap(data);
  }
  return {};
}

function buildGroupTagsTranslationMap(data) {
  if (groupTagsDataUtils.buildTranslationMap) {
    return groupTagsDataUtils.buildTranslationMap(data);
  }
  return {};
}

function normalizeGroupTagKey(value) {
  if (groupTagsDataUtils.normalizeTagKey) {
    return groupTagsDataUtils.normalizeTagKey(value);
  }
  return String(value || '').trim().toLowerCase();
}

function toCanonicalGroupTagKey(value) {
  if (groupTagsDataUtils.toCanonicalTagKey) {
    return groupTagsDataUtils.toCanonicalTagKey(value);
  }
  return normalizeGroupTagKey(value);
}

function toDisplayGroupTagText(value) {
  if (groupTagsDataUtils.canonicalToDisplayTag) {
    return groupTagsDataUtils.canonicalToDisplayTag(value);
  }
  return String(value || '').trim().replace(/_/g, ' ');
}

async function loadEffectiveDictionaryData() {
  if (groupTagsDataUtils.loadEffectiveDictionaryData) {
    return groupTagsDataUtils.loadEffectiveDictionaryData();
  }
  return { entryMap: new Map() };
}

async function upsertDictionaryEntry(tagKey, patch = {}) {
  if (groupTagsDataUtils.upsertDictionaryEntry) {
    return groupTagsDataUtils.upsertDictionaryEntry(tagKey, patch);
  }
  return {
    tagKey: toCanonicalGroupTagKey(tagKey),
    entry: null
  };
}

function findExistingGroupTagLocation(groupTagsData, tagText) {
  const targetKey = normalizeGroupTagKey(tagText);
  if (!targetKey || !Array.isArray(groupTagsData?.categories)) return null;

  // 颜色和翻译映射是全局 tag -> 单值表，所以这里直接按整个 Group Tags 全局查重
  for (const category of groupTagsData.categories) {
    const groups = Array.isArray(category.groups) ? category.groups : [];
    for (const group of groups) {
      const tags = Array.isArray(group.tags) ? group.tags : [];
      const existingTag = tags.find(tag => normalizeGroupTagKey(tag.en) === targetKey);
      if (existingTag) {
        return {
          categoryId: category.id,
          categoryName: category.name,
          groupId: group.id,
          groupName: group.name
        };
      }
    }
  }

  return null;
}

function formatGroupTagLocation(location) {
  if (!location) return '';
  return `${location.categoryName} > ${location.groupName}`;
}

function updateGroupTagsPickerStaticText() {
  const titleEl = document.getElementById('group-tags-picker-title');
  const closeBtn = document.getElementById('group-tags-picker-close');
  if (titleEl) titleEl.textContent = getLocalizedText('group_tags_picker_title', getAddToGroupTagsText());
  if (closeBtn) closeBtn.setAttribute('aria-label', getLocalizedText('group_tags_picker_close', 'Close panel'));
}

function closeGroupTagsPicker(selection = null) {
  const modal = document.getElementById('group-tags-picker-modal');
  if (modal) {
    modal.classList.remove('visible');
  }

  groupTagsPickerState.tagData = null;
  groupTagsPickerState.groupTagsData = null;

  if (groupTagsPickerState.resolve) {
    // 用 Promise 包装弹窗结果，避免把选择逻辑散落到多个回调里
    const resolve = groupTagsPickerState.resolve;
    groupTagsPickerState.resolve = null;
    resolve(selection);
  }
}

function initGroupTagsPickerModal() {
  const modal = document.getElementById('group-tags-picker-modal');
  const closeBtn = document.getElementById('group-tags-picker-close');

  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';

  closeBtn?.addEventListener('click', () => closeGroupTagsPicker(null));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeGroupTagsPicker(null);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('visible')) {
      closeGroupTagsPicker(null);
    }
  });

  updateGroupTagsPickerStaticText();
}

function renderPickerTagContent(tagData) {
  const en = toDisplayGroupTagText(String(tagData?.en || '').trim());
  const zh = String(tagData?.zh || '').trim();

  const container = document.createElement('div');
  container.className = 'group-tags-picker-tag-inner';

  // 辅助函数：创建无缝内联编辑元素
  const createEditableText = (initialText, className, fieldName) => {
    const textEl = document.createElement('span');
    textEl.className = className;
    textEl.textContent = initialText;

    textEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = `${className} editing`;
      inputEl.value = groupTagsPickerState.tagData[fieldName] || '';

      const finishEditing = () => {
        const newVal = inputEl.value.trim();
        groupTagsPickerState.tagData[fieldName] = newVal; // 更新内存状态
        
        let displayVal = fieldName === 'en' ? toDisplayGroupTagText(newVal) : newVal;
        if (!displayVal) {
          displayVal = fieldName === 'en' ? '...' : getLocalizedText('group_tags_picker_trans_placeholder', '输入翻译');
        }
        textEl.textContent = displayVal;
        
        if (inputEl.parentNode) {
          inputEl.parentNode.replaceChild(textEl, inputEl);
        }
      };

      inputEl.addEventListener('blur', finishEditing);
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inputEl.blur();
        } else if (e.key === 'Escape') {
          // ESC 放弃修改
          e.preventDefault();
          e.stopPropagation(); // 防止冒泡关闭整个模态框
          inputEl.value = groupTagsPickerState.tagData[fieldName] || '';
          inputEl.blur();
        }
      });

      textEl.parentNode.replaceChild(inputEl, textEl);
      inputEl.focus();
      // 让光标出现在文字末尾
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    });

    return textEl;
  };

  // 左半边：英文原名 (可击穿编辑)
  const enSpan = createEditableText(en || '...', 'group-tags-picker-tag-en', 'en');
  container.appendChild(enSpan);

  // 中间分割线
  const divider = document.createElement('span');
  divider.className = 'group-tags-picker-tag-divider';
  container.appendChild(divider);

  // 右侧：中文翻译 (可击穿编辑)
  // 如果当前没翻译，也填充给个底子使得它能被点到
  const zhSpan = createEditableText(zh || getLocalizedText('group_tags_picker_trans_placeholder', '输入翻译'), 'group-tags-picker-tag-zh', 'zh');
  container.appendChild(zhSpan);

  // 极简关闭按钮插在最右端
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'group-tags-picker-tag-close';
  closeBtn.setAttribute('aria-label', getLocalizedText('group_tags_picker_close', 'Close'));
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeGroupTagsPicker(null);
  });
  
  container.appendChild(closeBtn);
  return container;
}

function formatPickerTagText(tagData) {
  const en = toDisplayGroupTagText(String(tagData?.en || '').trim());
  const zh = String(tagData?.zh || '').trim();
  return zh ? `${en}  ${zh}` : en;
}

function setPickerCategory(categoryId) {
  groupTagsPickerState.activeCategoryId = categoryId;
}

function renderGroupTagsPickerList(tagData, groupTagsData) {
  const listEl = document.getElementById('group-tags-picker-list');
  const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];
  const hasGroups = categories.some(category => Array.isArray(category.groups) && category.groups.length > 0);

  if (!listEl) return;
  listEl.innerHTML = '';

  if (!hasGroups) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'group-tags-picker-empty';
    emptyEl.textContent = getLocalizedText('group_tags_picker_empty', 'No Group Tags groups available. Create one first.');
    listEl.appendChild(emptyEl);
    return;
  }

  // Row 1: Primary Tabs (Categories)
  const primaryTabsEl = document.createElement('div');
  primaryTabsEl.className = 'group-tags-picker-primary-tabs';

  categories.forEach(category => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `group-tags-picker-tab-btn ${groupTagsPickerState.activeCategoryId === category.id ? 'active' : ''}`;
    btn.textContent = category.name || category.id || 'Category';
    btn.addEventListener('click', () => {
      setPickerCategory(category.id);
      renderGroupTagsPickerList(tagData, groupTagsData);
    });
    primaryTabsEl.appendChild(btn);
  });

  // Row 2: Secondary Tabs (Groups)
  const secondaryTabsEl = document.createElement('div');
  secondaryTabsEl.className = 'group-tags-picker-secondary-tabs';

  const activeCategory = categories.find(c => c.id === groupTagsPickerState.activeCategoryId) || categories[0];
  if (activeCategory) {
    groupTagsPickerState.activeCategoryId = activeCategory.id;
    const groups = Array.isArray(activeCategory.groups) ? activeCategory.groups : [];
    
    groups.forEach(group => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'group-tags-picker-group-btn';
      button.textContent = group.name || group.id || 'Group';
      button.addEventListener('click', () => {
        // 在正式加入前，确保所有的 input focus 已经被保存同步到了 tagData
        // 因为 activeElement blur 存在时间差，这里直接读取最新的 state 作为最终值返回
        closeGroupTagsPicker({
          categoryId: activeCategory.id,
          groupId: group.id,
          // 附带返回被编辑过的最新 Tag 内容给外部处理函数
          editedEn: groupTagsPickerState.tagData?.en,
          editedZh: groupTagsPickerState.tagData?.zh
        });
      });
      secondaryTabsEl.appendChild(button);
    });
  }

  listEl.appendChild(primaryTabsEl);
  listEl.appendChild(secondaryTabsEl);
}

function openGroupTagsPicker(tagData, groupTagsData) {
  initGroupTagsPickerModal();
  if (groupTagsPickerState.resolve) {
    // 理论上同一时间只允许一个选择弹窗处于待决状态
    closeGroupTagsPicker(null);
  }

  const modal = document.getElementById('group-tags-picker-modal');
  const tagEl = document.getElementById('group-tags-picker-tag');
  const categories = Array.isArray(groupTagsData?.categories) ? groupTagsData.categories : [];
  groupTagsPickerState.tagData = tagData;
  groupTagsPickerState.groupTagsData = groupTagsData;
  groupTagsPickerState.activeCategoryId = categories[0]?.id || null;

  updateGroupTagsPickerStaticText();
  if (tagEl) {
    tagEl.innerHTML = '';
    tagEl.appendChild(renderPickerTagContent(tagData));
  }
  renderGroupTagsPickerList(tagData, groupTagsData);

  modal?.classList.add('visible');
  return new Promise(resolve => {
    groupTagsPickerState.resolve = resolve;
  });
}

async function persistGroupTagsData(groupTagsData) {
  if (groupTagsDataUtils.saveGroupTagsStorage) {
    groupTagsData = await groupTagsDataUtils.saveGroupTagsStorage(groupTagsData);
  } else {
    const colorMap = buildGroupTagsColorMap(groupTagsData);
    const translationMap = buildGroupTagsTranslationMap(groupTagsData);
    await chrome.storage.local.set({
      groupTagsUserData: groupTagsData,
      groupColorMap: colorMap,
      groupTranslationMap: translationMap
    });
  }
  const colorMap = buildGroupTagsColorMap(groupTagsData);
  const translationMap = buildGroupTagsTranslationMap(groupTagsData);
  // 写回 storage 后立刻刷新 popup 内存态，让当前编辑器马上吃到颜色和翻译
  applyGroupMapsToEditors(colorMap, translationMap);
}

async function addTagToGroupTags(tagData) {
  const en = String(tagData?.en || '').trim();
  const zh = String(tagData?.zh || '').trim();
  if (!en) return;
  const canonicalEn = toCanonicalGroupTagKey(en);
  if (!canonicalEn) return;

  const effectiveData = await loadEffectiveGroupTagsData();
  const existingLocation = findExistingGroupTagLocation(effectiveData, canonicalEn);
  if (existingLocation) {
    // 全局唯一：同一个 tag 不允许再加入别的分组，否则颜色/翻译会变成顺序相关
    showPopupToast('warning', `${getLocalizedText('group_tags_picker_duplicate', 'Already exists in')}: ${formatGroupTagLocation(existingLocation)}`);
    return;
  }

  // 因为在弹窗期间 tag 原本的值可能会被用户单击处于 input 状态修改，拿到最热数据
  const selection = await openGroupTagsPicker({ en: toDisplayGroupTagText(canonicalEn), zh }, effectiveData);
  if (!selection) return;

  // 用户确认后重新读取最新有效数据，避免把弹窗打开期间的外部修改覆盖掉
  const latestData = await loadEffectiveGroupTagsData();
  
  // 取出经过弹窗内可能已被用户编辑过的新名字 (如果没编辑回退到原来传参的字)
  const finalEn = toCanonicalGroupTagKey(String(selection.editedEn || en).trim());
  const finalZh = String(selection.editedZh || zh).trim();

  // 如果原本没改但原来存在，或者改了以后撞车，都要拦截
  if (!finalEn) return; 
  const latestExistingLocation = findExistingGroupTagLocation(latestData, finalEn);
  if (latestExistingLocation) {
    showPopupToast('warning', `${getLocalizedText('group_tags_picker_duplicate', 'Already exists in')}: ${formatGroupTagLocation(latestExistingLocation)}`);
    return;
  }

  const targetCategory = latestData.categories.find(category => category.id === selection.categoryId);
  const targetGroup = targetCategory?.groups?.find(group => group.id === selection.groupId);
  if (!targetGroup) {
    // 用户打开弹窗后，目标分组可能已被别的入口删除
    showPopupToast('error', getLocalizedText('group_tags_picker_missing', 'The selected Group Tags group no longer exists.'));
    return;
  }

  const dictResult = await upsertDictionaryEntry(finalEn, { zhCN: finalZh });
  const finalEntry = dictResult.entry || (await loadEffectiveDictionaryData()).entryMap.get(finalEn) || null;

  targetGroup.tags.push({
    en: finalEn,
    zh: finalEntry ? (finalEntry.zhCN || '') : finalZh
  });
  await persistGroupTagsData(latestData);
  
  const locationName = `${targetCategory.name} > ${targetGroup.name}`;
  const displayTag = toDisplayGroupTagText(finalEn);
  showPopupToast('success', `${getLocalizedText('group_tags_picker_added_prefix', 'Added')}: ${displayTag} -> ${locationName}`);
}

document.addEventListener('DOMContentLoaded', async () => {
  initUI();
  await initData();
  initCommunication();
});

function applySequentialCountersToEditors(counters) {
  currentSequentialCounters = counters || {};
  if (editor) {
    editor.setSequentialCounters(currentSequentialCounters);
  }
  charEditors.forEach((charEditorObj) => {
    if (charEditorObj?.editor) {
      charEditorObj.editor.setSequentialCounters(currentSequentialCounters);
    }
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    if (!chrome.tabs) {
      resolve(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function getSequentialCountersFromTab(tabId) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !tabId) {
      resolve({});
      return;
    }
    chrome.tabs.sendMessage(tabId, { type: 'GET_SEQUENTIAL_COUNTERS' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(response?.sequentialCounters || {});
    });
  });
}

async function refreshSequentialCountersFromActiveTab() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    applySequentialCountersToEditors({});
    return;
  }
  applySequentialCountersToEditors(await getSequentialCountersFromTab(activeTab.id));
}

function shouldIgnoreRuntimeMessage(msg) {
  if (!isEmbeddedPopup) return false;
  if (!msg?.hostSessionId) return false;
  return msg.hostSessionId !== popupHostSessionId;
}

async function initData() {
  const data = await chrome.storage.local.get(['promptHistory']);
  if (!isEmbeddedPopup && data.promptHistory && data.promptHistory.length > 0) {
    // 应该找最近的一条非收藏、非文件夹的普通真实历史记录，作为最后状态
    const s = data.promptHistory.find(item => !item.isFavorite && !item.isFolder) || data.promptHistory[0];
    
    // 初始化防抖指纹，避免由于空初始导致的 F5 刷新重复记录历史
    _lastRecordedFingerprint = computeStateFingerprint(s.positiveTags, s.negativeTags, s.characters);

    // 将最近一次历史中的 Tag（即包含被禁用属性的数组）在启动时优先缝合进入常驻内存
    if (!hasReceivedInitialData) {
      positiveTags = s.positiveTags ? JSON.parse(JSON.stringify(s.positiveTags)) : [];
      negativeTags = s.negativeTags ? JSON.parse(JSON.stringify(s.negativeTags)) : [];
      rawPositive = tagsToString(positiveTags);
      rawNegative = tagsToString(negativeTags);
    }
    
    if (!hasReceivedInitialChars && s.characters && s.characters.length > 0) {
      characterPromptsData = s.characters.map(c => ({
        posPrompt: tagsToString(c.posTags || []),
        posTags: c.posTags ? JSON.parse(JSON.stringify(c.posTags)) : [],
        negPrompt: tagsToString(c.negTags || []),
        negTags: c.negTags ? JSON.parse(JSON.stringify(c.negTags)) : [],
        gender: c.gender || 'other',
        activeTab: c.activeTab || 'positive'
      }));
    }
  }

  await refreshSequentialCountersFromActiveTab();

  // Listen for storage changes to keep counters in sync and hot-reload dictionary
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if ((changes.dictOverlay || changes.wildcards) && autocomplete) {
        // Hot-reload dictionary and wildcards
        autocomplete.loaded = false;
        autocomplete.load().then(() => {
          if (editor) editor.render();
          charEditors.forEach(c => {
            if (c.editor) c.editor.render();
          });
        });
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

function syncCharactersToPage(source) {
  if (chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const payload = characterPromptsData.map(char => ({
            positive: char.posPrompt,
            negative: char.negPrompt,
            gender: char.gender,
            activeTab: char.activeTab
        }));

        lastSentCharacterPrompts = payload;
        console.log('[NAI-Prompt-All-In-One] Syncing Characters to Page =>', payload);
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_CHARACTER_PROMPTS',
          data: payload
        });
      }
    });
  } else {
    console.log('[Phase 1 fallback] Local sync triggered. Current Data:\n', JSON.parse(JSON.stringify(characterPromptsData)));
  }

  // 角色编辑器变更后，记录历史快照
  recordHistory(source || 'immediate');
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
  const getKey = (base) => (isShortMode && dict[base + '_short']) ? base + '_short' : base;

  if(btnAdd && dict[getKey('btn_add')]) btnAdd.textContent = dict[getKey('btn_add')];
  if(input && dict.input_placeholder) input.placeholder = dict.input_placeholder;
  if(btnWildcard && dict[getKey('btn_quick_wildcard')]) {
      btnWildcard.title = dict.btn_quick_wildcard; // Tooltip aalways uses long text
      btnWildcard.textContent = dict[getKey('btn_quick_wildcard')];
  }
  if(btnSeqWildcard && dict[getKey('btn_quick_seq_wildcard')]) {
      btnSeqWildcard.title = dict.btn_quick_seq_wildcard;
      btnSeqWildcard.textContent = dict[getKey('btn_quick_seq_wildcard')];
  }
  if(btnRandom && dict[getKey('btn_quick_random')]) {
      btnRandom.title = dict.btn_quick_random;
      btnRandom.textContent = dict[getKey('btn_quick_random')];
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
    dict: dict, // Pass localization dict down to TagEditor
    onAddToGroupTags: (tagData) => addTagToGroupTags(tagData),
    onChange: (tags) => {
      const active = charEditors[index]?.activeTab || 'pos';
      // 检测是否为结构性变更（tag 数量变化）
      const prevCharTags = active === 'pos' ? characterPromptsData[index].posTags : characterPromptsData[index].negTags;
      const isStructural = tags.length !== (prevCharTags || []).length;
      if (active === 'pos') {
          characterPromptsData[index].posTags = tags;
          characterPromptsData[index].posPrompt = tagsToString(tags);
      } else {
          characterPromptsData[index].negTags = tags;
          characterPromptsData[index].negPrompt = tagsToString(tags);
      }
      syncCharactersToPage(isStructural ? 'immediate' : 'popup');
      
      // 同步当前角色编辑器的 tags 到 GroupTags 面板
      if (activeEditorTarget.type === 'character' && activeEditorTarget.charIndex === index) {
        syncActiveTagsToPanel();
      }
    }
  });
  charEditor.groupColorMap = currentGroupColorMap;
  charEditor.groupTranslationMap = currentGroupTranslationMap;
  charEditor.setSequentialCounters(currentSequentialCounters);

  // ── 焦点追踪：点击角色编辑器容器时设为活动目标 ──
  editorContainer.addEventListener('mousedown', () => {
    activeEditorTarget = { type: 'character', charIndex: index };
    syncActiveTagsToPanel();
  });


  // Set up Pos/Neg Toggles
  const btnPos = clone.querySelector('.char-tab-pos');
  const btnNeg = clone.querySelector('.char-tab-neg');

  if(btnPos && dict.tab_positive) btnPos.title = dict.tab_positive;
  if(btnNeg && dict.tab_negative) btnNeg.title = dict.tab_negative;
  if(deleteBtn && dict.btn_remove_char) deleteBtn.title = dict.btn_remove_char;

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

    // 如果当前焦点正好在这个角色编辑器上，更新面板状态
    if (activeEditorTarget.type === 'character' && activeEditorTarget.charIndex === index) {
      syncActiveTagsToPanel();
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
  initGroupTagsPickerModal();

  // Resolution controls
  const resWidth = document.getElementById('res-width');
  const resHeight = document.getElementById('res-height');
  const resSwapBtn = document.getElementById('res-swap-btn');
  
  // Custom Dropdown UI
  const resTrigger = document.getElementById('res-multi-trigger');
  const resPanel = document.getElementById('res-dropdown-panel');
  const resModeSeq = document.getElementById('res-mode-seq');
  const resModeRnd = document.getElementById('res-mode-rnd');
  const resListContainer = document.getElementById('res-list-container');
  const resBtnAdd = document.getElementById('res-btn-add');
  const resAddW = document.getElementById('res-add-w');
  const resAddH = document.getElementById('res-add-h');

  let defaultPresets = [
    '512x768', '768x512', '640x640', '832x1216', '1216x832', 
    '1024x1024', '1024x1536', '1536x1024', '1472x1472'
  ];
  let multiResAll = [...defaultPresets];
  let multiResActive = ['832x1216'];
  let multiResMode = 'seq';

  function sendResolutionUpdate(w, h) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_RESOLUTION',
          data: { width: w, height: h }
        });
      }
    });
    chrome.storage.local.set({ lastResolution: { width: w, height: h } });
  }

  function syncMultiResStorage() {
    const config = { all: multiResAll, active: multiResActive, mode: multiResMode };
    // 只保存配置，供 injector.js 在生成请求拦截时使用
    // 注意：此处不发 SET_RESOLUTION 消息，不修改网页 UI 输入框。
    // 原因：NovelAI 网页将输入框的值通过 CSS aspect-ratio 全局绑定到所有预览卡片。
    // 若修改网页输入框，所有已生成的预览图都会被强制拉伸到新比例，导致视觉错乱。
    // 多选模式下通过 fetch/XHR 拦截层静默改写请求参数，与网页 UI 完全解耦。
    chrome.storage.local.set({ multiResConfig: config });
    
    // 更新触发按钮的文本
    const dict = translations[currentLang] || translations.en;
    const getKey = (base) => (isShortMode && dict[base + '_short']) ? base + '_short' : base;

    if (multiResActive.length === 0) {
      resTrigger.textContent = (dict[getKey('res_selected_none')] || 'None') + ' ⏷';
    } else if (multiResActive.length === 1) {
      resTrigger.textContent = multiResActive[0].replace('x', ' × ') + ' ⏷';
      // 单选时：同步网页 UI（用户预期看到该比例）
      const [w, h] = multiResActive[0].split('x');
      resWidth.value = w; resHeight.value = h;
      sendResolutionUpdate(parseInt(w), parseInt(h));
    } else {
      // 多选时：仅更新按钮文字，不触碰网页 UI
      const t = dict[getKey('res_selected_count')] || '[{n} Selected]';
      resTrigger.textContent = t.replace('{n}', multiResActive.length) + ' ⏷';
    }
  }

  function renderResList() {
    resListContainer.innerHTML = '';
    multiResAll.forEach(res => {
      const item = document.createElement('div');
      item.className = 'res-list-item';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = multiResActive.includes(res);
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!multiResActive.includes(res)) multiResActive.push(res);
        } else {
          multiResActive = multiResActive.filter(r => r !== res);
        }
        syncMultiResStorage();
      });

      const text = document.createElement('div');
      text.className = 'res-list-text';
      text.textContent = res.replace('x', ' × ');
      // click text toggles checkbox
      text.addEventListener('click', () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });

      item.appendChild(cb);
      item.appendChild(text);

      if (!defaultPresets.includes(res)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'res-list-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          multiResAll = multiResAll.filter(r => r !== res);
          multiResActive = multiResActive.filter(r => r !== res);
          renderResList();
          syncMultiResStorage();
        });
        item.appendChild(delBtn);
      }
      resListContainer.appendChild(item);
    });
  }

  resTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    resPanel.style.display = resPanel.style.display === 'none' ? 'flex' : 'none';
  });

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.res-multi-select-container')) {
      resPanel.style.display = 'none';
    }
  });

  resPanel.addEventListener('click', (e) => e.stopPropagation());

  const setResMode = (mode) => {
    multiResMode = mode;
    if (mode === 'seq') {
      resModeSeq.classList.add('active');
      resModeRnd.classList.remove('active');
    } else {
      resModeRnd.classList.add('active');
      resModeSeq.classList.remove('active');
    }
    syncMultiResStorage();
  };

  resModeSeq.addEventListener('click', () => setResMode('seq'));
  resModeRnd.addEventListener('click', () => setResMode('rnd'));

  resBtnAdd.addEventListener('click', () => {
    let w = parseInt(resAddW.value, 10);
    let h = parseInt(resAddH.value, 10);
    if (!w || !h) return;
    w = Math.max(64, Math.round(w / 64) * 64);
    h = Math.max(64, Math.round(h / 64) * 64);
    const newRes = `${w}x${h}`;
    if (!multiResAll.includes(newRes)) {
      multiResAll.push(newRes);
    }
    if (!multiResActive.includes(newRes)) {
      multiResActive.push(newRes);
    }
    resAddW.value = '';
    resAddH.value = '';
    renderResList();
    syncMultiResStorage();
  });

  const onDimensionChange = () => {
    let w = parseInt(resWidth.value, 10) || 832;
    let h = parseInt(resHeight.value, 10) || 1216;
    w = Math.max(64, Math.round(w / 64) * 64);
    h = Math.max(64, Math.round(h / 64) * 64);
    resWidth.value = w;
    resHeight.value = h;
    sendResolutionUpdate(w, h);
  };

  resWidth.addEventListener('change', onDimensionChange);
  resHeight.addEventListener('change', onDimensionChange);

  resSwapBtn.addEventListener('click', () => {
    const temp = resWidth.value;
    resWidth.value = resHeight.value;
    resHeight.value = temp;
    sendResolutionUpdate(parseInt(resWidth.value, 10), parseInt(resHeight.value, 10));
  });

  chrome.storage.local.get(['lastResolution', 'multiResConfig'], (data) => {
    if (data.multiResConfig) {
      multiResAll = data.multiResConfig.all || multiResAll;
      multiResActive = data.multiResConfig.active || [];
      setResMode(data.multiResConfig.mode || 'seq');
    } else {
      syncMultiResStorage();
    }
    renderResList();

    if (data.lastResolution) {
      resWidth.value = data.lastResolution.width;
      resHeight.value = data.lastResolution.height;
    } else if (multiResActive.length === 1) {
      const [w, h] = multiResActive[0].split('x');
      resWidth.value = w; resHeight.value = h;
    }
    
    // Ensure properly synced state for trigger visual
    if (multiResActive.length === 0) resTrigger.textContent = 'None ⏷';
    else if (multiResActive.length === 1) resTrigger.textContent = multiResActive[0].replace('x', ' × ') + ' ⏷';
    else resTrigger.textContent = `[${multiResActive.length} Selected] ⏷`;
  });

  // Tabs
  const tabPositive = document.getElementById('tab-positive');
  const tabNegative = document.getElementById('tab-negative');

  tabPositive.addEventListener('click', (e) => switchTab('positive', e.isTrusted));
  tabNegative.addEventListener('click', (e) => switchTab('negative', e.isTrusted));

  // Editor
  const container = document.getElementById('editor-container');
  const dict = translations[currentLang] || translations.en;
  editor = new TagEditor(container, {
    dict: dict,
    onAddToGroupTags: (tagData) => addTagToGroupTags(tagData),
    onChange: (tags) => {
      // 检测是否为结构性变更（tag 数量变化 = 增删操作）
      const prevTags = currentMode === 'positive' ? positiveTags : negativeTags;
      const isStructural = tags.length !== prevTags.length;
      updateTagsFromEditor(tags);
      syncToPage(isStructural ? 'immediate' : 'popup');
      
      // 同步最新 tags 到 Group Tags Panel
      syncActiveTagsToPanel();
    }
  });
  editor.groupColorMap = currentGroupColorMap;
  editor.groupTranslationMap = currentGroupTranslationMap;

  // Bind Autocomplete to Editor (for inline edit)
  editor.bindAutocomplete(autocomplete);

  // ── 焦点追踪：点击 base editor 容器时设为活动目标 ──
  container.addEventListener('mousedown', () => {
    activeEditorTarget = { type: 'base', mode: currentMode };
    syncActiveTagsToPanel();
  });

  chrome.storage.local.get(['groupColorMap', 'groupTranslationMap'], (data) => {
    applyGroupMapsToEditors(data.groupColorMap || {}, data.groupTranslationMap || {}, false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.groupColorMap && !changes.groupTranslationMap) return;
    // popup 只关心映射结果，不重复推导来源，保证来自 popup / GroupTags 面板的更新都能收敛到一处
    const nextColorMap = changes.groupColorMap ? (changes.groupColorMap.newValue || {}) : currentGroupColorMap;
    const nextTranslationMap = changes.groupTranslationMap ? (changes.groupTranslationMap.newValue || {}) : currentGroupTranslationMap;
    applyGroupMapsToEditors(nextColorMap, nextTranslationMap);
  });

  // Character Prompt Add Button
  const btnAddChar = document.getElementById('btn-add-char');
  if (btnAddChar) {
    btnAddChar.addEventListener('mousedown', (e) => e.stopPropagation());
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
  const btnMinChar = document.getElementById('btn-min-char');

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
      charSection.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Save user preference
      chrome.storage.local.set({ charSectionHeight: charSection.style.height });
    };

    resizer.addEventListener('mousedown', (e) => {
      if (charSection.classList.contains('minimized')) return;
      startY = e.clientY;
      startHeight = charSection.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      resizer.classList.add('active');
      charSection.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    if (btnMinChar) {
      btnMinChar.addEventListener('mousedown', (e) => e.stopPropagation());
      btnMinChar.addEventListener('click', () => {
        const isMinimized = charSection.classList.toggle('minimized');
        btnMinChar.textContent = isMinimized ? '+' : '_';
        resizer.classList.toggle('disabled', isMinimized);
        chrome.storage.local.set({ charSectionMinimized: isMinimized });
      });
    }
    
    // Initialize saved state
    chrome.storage.local.get(['charSectionHeight', 'charSectionMinimized'], (data) => {
        if (data.charSectionHeight) {
            charSection.style.height = data.charSectionHeight;
        }
        if (data.charSectionMinimized) {
            charSection.classList.add('minimized');
            if (btnMinChar) btnMinChar.textContent = '+';
            resizer.classList.add('disabled');
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

  // 分组标签入口按钮：发送消息到 bridge.js 切换面板显示
  const btnGroupTags = document.getElementById('btn-group-tags');
  if (btnGroupTags) {
    btnGroupTags.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_GROUP_TAGS_PANEL' });
        }
      });
    });
  }

  // Library & Settings
  document.getElementById('btn-library').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/sync.html') });
  });

  // Language Support translations now at top level

  const applyTranslations = (lang) => {
    currentLang = lang;
    const dict = translations[lang] || translations.en;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const baseKey = el.getAttribute('data-i18n');
      const key = (isShortMode && dict[baseKey + '_short']) ? baseKey + '_short' : baseKey;
      
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

    if (editor) {
      if (dict.tag_help_tooltip) {
        editor.options.helpTooltip = dict.tag_help_tooltip;
      }
      editor.options.dict = dict;
      editor.render();
    }
    
    // Also update all character editors
    charEditors.forEach(charEditorObj => {
        if (charEditorObj.editor) {
            charEditorObj.editor.options.dict = dict;
            charEditorObj.editor.render();
        }
    });

    // Handle button active state
    ['btn-en', 'btn-jp', 'btn-zh'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-${lang}`);
    });

    const fallback = translations.en || {};
    const acI18n = {
      fixedShort: dict.ac_mode_fixed_short || fallback.ac_mode_fixed_short || 'Fixed',
      onImageShort: dict.ac_mode_on_image_short || fallback.ac_mode_on_image_short || 'On Img',
      fixedTitle: dict.ac_mode_fixed_title || fallback.ac_mode_fixed_title || 'Fixed Interval',
      onImageTitle: dict.ac_mode_on_image_title || fallback.ac_mode_on_image_title || 'On Image'
    };
    chrome.storage.local.set({ autoClickerI18n: acI18n });

    // 刷新多选分辨率按钮文字
    if (typeof syncMultiResStorage === 'function') syncMultiResStorage();
    updateGroupTagsPickerStaticText();
    if (document.getElementById('group-tags-picker-modal')?.classList.contains('visible')) {
      const { tagData, groupTagsData } = groupTagsPickerState;
      if (tagData) {
        const tagEl = document.getElementById('group-tags-picker-tag');
        if (tagEl) {
          tagEl.innerHTML = '';
          tagEl.appendChild(renderPickerTagContent(tagData));
        }
      }
      if (tagData && groupTagsData) {
        renderGroupTagsPickerList(tagData, groupTagsData);
      }
    }
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
    if (data.language) {
      applyTranslations(data.language);
    } else {
      // 首次加载，获取浏览器语言
      const browserLang = navigator.language || navigator.userLanguage || 'en';
      let defaultLang = 'en';
      if (browserLang.toLowerCase().startsWith('zh')) {
        defaultLang = 'zh';
      } else if (browserLang.toLowerCase().startsWith('ja')) {
        defaultLang = 'jp';
      }
      setLanguage(defaultLang);
    }
  });

  // Observe width for responsive short-text mode
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const isNarrow = entry.contentRect.width < 540;
      if (isShortMode !== isNarrow) {
        isShortMode = isNarrow;
        applyTranslations(currentLang);
      }
    }
  });
  resizeObserver.observe(document.body);

  // Settings Persistence
  const settings = [
    'preservePrompt',
    'alternativeDanbooruAutocomplete',
    'triggerSpace',
    'triggerTab',
    'renderNewlines',
    'hideAutoClicker',
    'tagEditorDensity'
  ];

  // Load Settings
  chrome.storage.local.get(settings, (data) => {
    settings.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        let val = data[key];
        if (val === undefined) {
          // 默认开启的选项
          if (key === 'alternativeDanbooruAutocomplete') {
            val = true;
          } else {
            val = false;
          }
          // 在首次初始化时立刻存储默认值，确保整个应用能够同步
          chrome.storage.local.set({ [key]: val });
        }
        el.checked = !!val;

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

    if (data.tagEditorDensity !== undefined) {
      applyTagEditorDensity(data.tagEditorDensity);
    } else {
      applyTagEditorDensity(50);
    }
  });

  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');

  btnSettings.addEventListener('click', () => {
    modal.style.display = 'flex';
    updateStorageMonitor();
  });
  
  closeSettings.addEventListener('click', () => { modal.style.display = 'none'; });

  // Update Chrome Storage Monitor
  function updateStorageMonitor() {
    const barFill = document.getElementById('storage-bar-fill');
    const textDesc = document.getElementById('storage-usage-text');
    if (!barFill || !textDesc) return;

    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      chrome.runtime.lastError; // Ignore errors silently
      const usageMb = bytesInUse / (1024 * 1024);
      
      // 动态推导软上限档位，因为插件声明了 unlimitedStorage 权限
      let limitMb = 10;
      if (usageMb > 500) limitMb = 1024;
      else if (usageMb > 100) limitMb = 500;
      else if (usageMb > 50) limitMb = 100;
      else if (usageMb > 10) limitMb = 50;

      const maxBytes = limitMb * 1024 * 1024;
      let percentage = (bytesInUse / maxBytes) * 100;
      
      // Cap at 100% just in case 
      percentage = Math.min(percentage, 100);

      textDesc.textContent = `${usageMb.toFixed(2)} / ${limitMb} MB (${percentage.toFixed(1)}%)`;
      barFill.style.width = `${percentage}%`;

      // Visual warnings
      barFill.classList.remove('warning', 'critical');
      if (percentage >= 90) {
        barFill.classList.add('critical');
      } else if (percentage >= 70) {
        barFill.classList.add('warning');
      }
    });
  }

  // History & Favorites Modal trigger
  const btnHistory = document.getElementById('btn-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', async () => {
      // 在打开历史窗口前，强行将当前所有挂起的防抖修改立即转正记录，并等待其写入完成
      await recordHistory('immediate');
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_HISTORY_MODAL' });
        }
      });
    });
  }
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

  // 切换后立即同步正确的 tags 状态给面板，刷新灰阶
  syncActiveTagsToPanel();
}

function syncActiveTagsToPanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
    if (tabsList[0]) {
      let activeTags, inactiveTags, targetLabel;

      if (activeEditorTarget.type === 'base') {
        // 当前焦点在 Base 编辑器
        activeEditorTarget.mode = currentMode; // 保持同步
        activeTags = currentMode === 'positive' ? positiveTags : negativeTags;
        inactiveTags = currentMode === 'positive' ? negativeTags : positiveTags;
        targetLabel = currentMode === 'positive' ? 'Base (+)' : 'Base (-)';
      } else if (activeEditorTarget.type === 'character') {
        const idx = activeEditorTarget.charIndex;
        const charData = characterPromptsData[idx];
        const charEdObj = charEditors[idx];
        if (charData && charEdObj) {
          const tab = charEdObj.activeTab; // 'pos' | 'neg'
          activeTags = tab === 'pos' ? (charData.posTags || []) : (charData.negTags || []);
          inactiveTags = tab === 'pos' ? (charData.negTags || []) : (charData.posTags || []);
          targetLabel = `Char ${idx + 1} (${tab === 'pos' ? '+' : '-'})`;
        } else {
          // 角色已被删除，回退到 base
          activeEditorTarget = { type: 'base', mode: currentMode };
          activeTags = currentMode === 'positive' ? positiveTags : negativeTags;
          inactiveTags = currentMode === 'positive' ? negativeTags : positiveTags;
          targetLabel = currentMode === 'positive' ? 'Base (+)' : 'Base (-)';
        }
      }

      chrome.tabs.sendMessage(tabsList[0].id, { 
        type: 'SYNC_ACTIVE_TAGS', 
        activeTags,
        inactiveTags,
        targetLabel
      });
    }
  });
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

function mergeTagsPreservingDisabled(oldTags, newTags) {
  const merged = [];
  let newIdx = 0;
  for (let i = 0; i < oldTags.length; i++) {
    const old = oldTags[i];
    if (old.disabled) {
      merged.push(old);
    } else {
      let foundIdx = -1;
      for (let k = newIdx; k < newTags.length; k++) {
        if (newTags[k].value === old.value) {
          foundIdx = k;
          break;
        }
      }
      if (foundIdx !== -1) {
        // Output any new active tags that were inserted *before* this match
        while (newIdx <= foundIdx) {
          merged.push(newTags[newIdx]);
          newIdx++;
        }
      }
    }
  }
  // Flush remaining new active tags
  while (newIdx < newTags.length) {
    merged.push(newTags[newIdx]);
    newIdx++;
  }
  return merged;
}

function initCommunication() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (shouldIgnoreRuntimeMessage(msg)) return;
    if (msg.type === 'SEQUENTIAL_COUNTERS_UPDATED') {
      const senderTabId = sender?.tab?.id;
      if (senderTabId) {
        getActiveTab().then((activeTab) => {
          if (activeTab?.id === senderTabId) {
            applySequentialCountersToEditors(msg.counters || {});
          }
        });
      }
      return;
    }

    if (msg.type === 'RETURN_PROMPT') {
      const { positive, negative } = msg.data;

      // 如果尚未接到网页真正的框内文本数据（只传回undefined），不做任何处理直接等下一发
      if (positive === undefined && negative === undefined && !hasReceivedInitialData) {
          return;
      }

      const isFirstTime = !hasReceivedInitialData;
      hasReceivedInitialData = true;

      // Skip echo: if this matches what we just sent, ignore
      if (!isFirstTime && normalizePrompt(positive) === normalizePrompt(lastSentPositive) &&
        normalizePrompt(negative) === normalizePrompt(lastSentNegative)) {
        return;
      }

      const currentPosStr = tagsToString(positiveTags);
      const currentNegStr = tagsToString(negativeTags);

      let shouldUpdatePos = positive !== undefined && (isFirstTime || normalizePrompt(positive) !== normalizePrompt(currentPosStr));
      let shouldUpdateNeg = negative !== undefined && (isFirstTime || normalizePrompt(negative) !== normalizePrompt(currentNegStr));

      if (!shouldUpdatePos && !shouldUpdateNeg && !isFirstTime) {
         return;
      }

      if (shouldUpdatePos) {
          rawPositive = positive || '';
          const parsedPosTags = parsePromptToTags(rawPositive);
          // 这里通过 mergeTagsPreservingDisabled() 能巧妙地将新入的数据与我们在启动期缝合的“完整带disabled态字典”比对！从而将 disabled 的 Tag 存留！
          positiveTags = mergeTagsPreservingDisabled(positiveTags, parsedPosTags);
      }

      if (shouldUpdateNeg) {
          rawNegative = negative || '';
          const parsedNegTags = parsePromptToTags(rawNegative);
          negativeTags = mergeTagsPreservingDisabled(negativeTags, parsedNegTags);
      }

      if (currentMode === 'positive' && shouldUpdatePos) editor.setTags(positiveTags);
      if (currentMode === 'negative' && shouldUpdateNeg) editor.setTags(negativeTags);
      
      // 不论是初始加载还是后续同步，更新 tags 后推送给 GroupTags
      syncActiveTagsToPanel();
      
    } else if (msg.type === 'RETURN_CHARACTER_PROMPTS') {
      const charPrompts = msg.data || [];
      
      const isFirstTime = !hasReceivedInitialChars;
      hasReceivedInitialChars = true;
      
      let uiNeedsRebuild = false;
      if (characterPromptsData.length !== charPrompts.length && !isFirstTime) {
          uiNeedsRebuild = true;
          // Trim removed characters from memory instantly
          if (characterPromptsData.length > charPrompts.length) {
              characterPromptsData.length = charPrompts.length;
              charEditors.length = charPrompts.length;
          }
      } else if (isFirstTime) {
          uiNeedsRebuild = true;
          if (charPrompts.length === 0) {
              characterPromptsData = [];
              charEditors = [];
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

          let shouldUpdatePos = c.positive !== undefined && (isFirstTime || incomingPosStr !== currentPosStr);
          let shouldUpdateNeg = c.negative !== undefined && (isFirstTime || incomingNegStr !== currentNegStr);

          if (!shouldUpdatePos && !shouldUpdateNeg && i < characterPromptsData.length && !isFirstTime) {
              return; // Skip if identical (Debounce echo naturally)
          }

          changesApplied = true;

          let newPosTags = charObj.posTags || [];
          let newNegTags = charObj.negTags || [];
          
          if (shouldUpdatePos || charObj.posPrompt === undefined) {
              const parsedPosTags = parsePromptToTags(c.positive || '');
              newPosTags = mergeTagsPreservingDisabled(charObj.posTags || [], parsedPosTags);
              charObj.posPrompt = c.positive || '';
              charObj.posTags = newPosTags;
          }

          if (shouldUpdateNeg || charObj.negPrompt === undefined) {
              const parsedNegTags = parsePromptToTags(c.negative || '');
              newNegTags = mergeTagsPreservingDisabled(charObj.negTags || [], parsedNegTags);
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

      // 网页端角色提示词有实质变更，记录历史快照
      if (changesApplied) recordHistory('webpage');
    } // End of RETURN_CHARACTER_PROMPTS

    // The following block runs for RETURN_PROMPT
    if (msg.type === 'RETURN_PROMPT') {
      lastSentPositive = tagsToString(positiveTags);
      lastSentNegative = tagsToString(negativeTags);

      // 网页端主提示词有实质变更，记录历史快照
      recordHistory('webpage');
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

function syncToPage(source) {
  if (source) _syncSource = source;
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

  // 每次同步到页面时记录一次历史快照
  recordHistory(_syncSource || 'popup');
  _syncSource = null;
}

let _syncSource = null;

// ═══════════════════════════════════════════════════════
// 历史记录 & 收藏夹 核心逻辑
// ═══════════════════════════════════════════════════════

/** 记录当前完整状态的快照（带来源区分的防抖机制） */
let _lastRecordedFingerprint = null;
let _popupDebounceTimer = null;   // Popup 操作（编辑器 onChange）的防抖计时器
let _webpageDebounceTimer = null; // 网页端同步回传的防抖计时器

const POPUP_DEBOUNCE_MS = 1500;   // Popup 权重修改防抖：1.5 秒
const WEBPAGE_DEBOUNCE_MS = 2000; // 网页端打字防抖：2 秒

/**
 * 请求记录一次历史快照。
 * @param {'immediate' | 'popup' | 'webpage'} source - 变更来源
 *   - 'immediate'：来自 Popup 结构性操作（添加、删除、拖拽排序等），立即记录。
 *   - 'popup'    ：来自 Popup 权重修改等连续微调操作，使用 1.5 秒防抖。
 *   - 'webpage'  ：来自网页端输入框的实时同步回传，使用 2 秒防抖。
 */
function recordHistory(source = 'popup') {
  if (source === 'immediate' || source === 'restore') {
    // 结构性操作：立刻取消所有挂起计时并写入快照
    clearTimeout(_popupDebounceTimer);
    clearTimeout(_webpageDebounceTimer);
    _popupDebounceTimer = null;
    _webpageDebounceTimer = null;
    return _commitSnapshot();
  } else if (source === 'popup') {
    // 权重修改等微调操作：取消网页端挂起计时，使用短防抖
    clearTimeout(_webpageDebounceTimer);
    clearTimeout(_popupDebounceTimer);
    _popupDebounceTimer = setTimeout(() => _commitSnapshot(), POPUP_DEBOUNCE_MS);
    return Promise.resolve();
  } else {
    // 网页端同步：如果 popup 计时器正在等待，不干扰它
    if (_popupDebounceTimer) return Promise.resolve();
    clearTimeout(_webpageDebounceTimer);
    _webpageDebounceTimer = setTimeout(() => _commitSnapshot(), WEBPAGE_DEBOUNCE_MS);
    return Promise.resolve();
  }
}

/** 实际执行快照写入的内部方法 */
async function _commitSnapshot() {
  _popupDebounceTimer = null;
  _webpageDebounceTimer = null;

  const posStr = tagsToString(positiveTags);
  const negStr = tagsToString(negativeTags);
  const meaningfulCharacters = getMeaningfulCharacterHistoryData(characterPromptsData);
  const hasMeaningfulState = positiveTags.length > 0 || negativeTags.length > 0 || meaningfulCharacters.length > 0;

  // 去重：使用提取好的统合指纹函数，与上次实际写入的记录完全相同时跳过
  const fingerprint = computeStateFingerprint(positiveTags, negativeTags, characterPromptsData);
  if (!hasMeaningfulState) {
    _lastRecordedFingerprint = fingerprint;
    return;
  }
  if (fingerprint === _lastRecordedFingerprint) return;
  _lastRecordedFingerprint = fingerprint;

  const snapshot = {
    id: Date.now(),
    timestamp: Date.now(),
    isFavorite: false,
    name: '',
    positive: posStr,
    negative: negStr,
    // [v2] 保存原始 tag 对象数组，用于完整还原禁用状态、换行、复合组等
    positiveTags: positiveTags.map(t => ({ value: t.value, disabled: !!t.disabled, isStart: !!t.isStart, dynWeight: t.dynWeight || 1 })),
    negativeTags: negativeTags.map(t => ({ value: t.value, disabled: !!t.disabled, isStart: !!t.isStart, dynWeight: t.dynWeight || 1 })),
    characters: meaningfulCharacters.map(c => ({
      posPrompt: c.posPrompt || '',
      negPrompt: c.negPrompt || '',
      posTags: (c.posTags || []).map(t => ({ value: t.value, disabled: !!t.disabled, isStart: !!t.isStart, dynWeight: t.dynWeight || 1 })),
      negTags: (c.negTags || []).map(t => ({ value: t.value, disabled: !!t.disabled, isStart: !!t.isStart, dynWeight: t.dynWeight || 1 })),
      gender: c.gender || 'other',
      activeTab: c.activeTab || 'positive'
    }))
  };

  const data = await chrome.storage.local.get(['promptHistory', 'historyLimit']);
  let history = data.promptHistory || [];
  const limit = data.historyLimit || 100;

  // 插入新快照到数组头部
  history.unshift(snapshot);

  // 安全裁剪：只删除非收藏的普通记录
  const favorites = history.filter(s => s.isFavorite);
  let normals = history.filter(s => !s.isFavorite);
  if (normals.length > limit) {
    normals = normals.slice(0, limit);
  }
  // 按时间戳倒序重新合并
  history = [...normals, ...favorites].sort((a, b) => b.timestamp - a.timestamp);

  await chrome.storage.local.set({ promptHistory: history });
}

/** 将某个历史快照恢复为当前状态（支持局部恢复） */
async function restoreFromSnapshot(snapshot) {
  if (!snapshot) return;

  // ── 局部恢复分支：仅更新 partialType 对应的区块 ──
  if (snapshot.isPartial && snapshot.partialType) {
    const pt = snapshot.partialType;
    if (pt === 'positive') {
      rawPositive = snapshot.positive || '';
      positiveTags = snapshot.positiveTags ? JSON.parse(JSON.stringify(snapshot.positiveTags)) : parsePromptToTags(rawPositive);
      if (currentMode === 'positive') editor.setTags(positiveTags);
    } else if (pt === 'negative') {
      rawNegative = snapshot.negative || '';
      negativeTags = snapshot.negativeTags ? JSON.parse(JSON.stringify(snapshot.negativeTags)) : parsePromptToTags(rawNegative);
      if (currentMode === 'negative') editor.setTags(negativeTags);
    } else if (pt === 'character' || pt.startsWith('character-')) {
      const srcChar = (snapshot.characters || [])[0];
      if (srcChar) {
        // 角色片段恢复时统一追加到末尾，让用户后续手动调整顺序。
        characterPromptsData.push({
          posPrompt: srcChar.posPrompt || '',
          posTags: srcChar.posTags ? JSON.parse(JSON.stringify(srcChar.posTags)) : parsePromptToTags(srcChar.posPrompt || ''),
          negPrompt: srcChar.negPrompt || '',
          negTags: srcChar.negTags ? JSON.parse(JSON.stringify(srcChar.negTags)) : parsePromptToTags(srcChar.negPrompt || ''),
          gender: srcChar.gender || 'other',
          activeTab: srcChar.activeTab || 'positive'
        });
        rebuildCharacterPromptsUI();
      }
    }
    const posStr = tagsToString(positiveTags);
    const negStr = tagsToString(negativeTags);
    lastSentPositive = posStr;
    lastSentNegative = negStr;
    clearTimeout(_popupDebounceTimer);
    clearTimeout(_webpageDebounceTimer);
    _popupDebounceTimer = null;
    _webpageDebounceTimer = null;
    await recordHistory('restore');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_PROMPT', data: { positive: posStr, negative: negStr } });
        const payload = characterPromptsData.map(c => ({ positive: c.posPrompt, negative: c.negPrompt, gender: c.gender, activeTab: c.activeTab }));
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_CHARACTER_PROMPTS', data: payload });
      }
    });
    return;
  }

  // ── 全量恢复（原有逻辑不变） ──
  rawPositive = snapshot.positive || '';
  rawNegative = snapshot.negative || '';
  positiveTags = snapshot.positiveTags ? JSON.parse(JSON.stringify(snapshot.positiveTags)) : parsePromptToTags(rawPositive);
  negativeTags = snapshot.negativeTags ? JSON.parse(JSON.stringify(snapshot.negativeTags)) : parsePromptToTags(rawNegative);

  // 恢复角色数据
  characterPromptsData = (snapshot.characters || []).map(c => ({
    posPrompt: c.posPrompt || '',
    posTags: c.posTags ? JSON.parse(JSON.stringify(c.posTags)) : parsePromptToTags(c.posPrompt || ''),
    negPrompt: c.negPrompt || '',
    negTags: c.negTags ? JSON.parse(JSON.stringify(c.negTags)) : parsePromptToTags(c.negPrompt || ''),
    gender: c.gender || 'other',
    activeTab: c.activeTab || 'positive'
  }));

  // 刷新 UI
  if (currentMode === 'positive') {
    editor.setTags(positiveTags);
  } else {
    editor.setTags(negativeTags);
  }

  rebuildCharacterPromptsUI();

  // 同步到页面
  const posStr = tagsToString(positiveTags);
  const negStr = tagsToString(negativeTags);
  lastSentPositive = posStr;
  lastSentNegative = negStr;

  // 清除挂起的防抖计时器
  clearTimeout(_popupDebounceTimer);
  clearTimeout(_webpageDebounceTimer);
  _popupDebounceTimer = null;
  _webpageDebounceTimer = null;

  // 显式记录这次“恢复”动作为一次新的历史快照（如果确实有变化）
  await recordHistory('restore');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SET_PROMPT',
        data: { positive: posStr, negative: negStr }
      });
      // 同时恢复角色
      const payload = characterPromptsData.map(c => ({
        positive: c.posPrompt,
        negative: c.negPrompt,
        gender: c.gender,
        activeTab: c.activeTab
      }));
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SET_CHARACTER_PROMPTS',
        data: payload
      });
    }
  });
}

// 监听跨组件通讯指令（通过 bridge 中转）
function cloneSnippetTags(tags, promptText) {
  if (Array.isArray(tags) && tags.length) {
    return JSON.parse(JSON.stringify(tags));
  }
  return parsePromptToTags(promptText || '');
}

async function broadcastPromptStateAndRecord(source = 'restore') {
  const posStr = tagsToString(positiveTags);
  const negStr = tagsToString(negativeTags);
  lastSentPositive = posStr;
  lastSentNegative = negStr;

  clearTimeout(_popupDebounceTimer);
  clearTimeout(_webpageDebounceTimer);
  _popupDebounceTimer = null;
  _webpageDebounceTimer = null;

  await recordHistory(source);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;

    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'SET_PROMPT',
      data: { positive: posStr, negative: negStr }
    });

    const payload = characterPromptsData.map(c => ({
      positive: c.posPrompt,
      negative: c.negPrompt,
      gender: c.gender,
      activeTab: c.activeTab
    }));

    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'SET_CHARACTER_PROMPTS',
      data: payload
    });
  });
}

async function appendHistorySnippet(snapshot, target) {
  if (!snapshot || (target !== 'positive' && target !== 'negative')) return;

  // 片段追加只改目标侧，避免误覆盖另一侧内容。
  const sourceTags = target === 'positive'
    ? cloneSnippetTags(snapshot.positiveTags, snapshot.positive)
    : cloneSnippetTags(snapshot.negativeTags, snapshot.negative);

  if (!sourceTags.length) return;

  if (activeEditorTarget.type === 'character') {
    const index = activeEditorTarget.charIndex;
    const charData = characterPromptsData[index];
    const charEditorObj = charEditors[index];
    if (!charData) return;

    if (target === 'positive') {
      charData.posTags = [...(charData.posTags || []), ...sourceTags];
      charData.posPrompt = tagsToString(charData.posTags);
      if (charEditorObj?.activeTab === 'pos') {
        charEditorObj.editor.setTags(charData.posTags);
      }
    } else {
      charData.negTags = [...(charData.negTags || []), ...sourceTags];
      charData.negPrompt = tagsToString(charData.negTags);
      if (charEditorObj?.activeTab === 'neg') {
        charEditorObj.editor.setTags(charData.negTags);
      }
    }
  } else if (target === 'positive') {
    positiveTags = [...positiveTags, ...sourceTags];
    rawPositive = tagsToString(positiveTags);
    if (currentMode === 'positive' && editor) {
      editor.setTags(positiveTags);
    }
  } else {
    negativeTags = [...negativeTags, ...sourceTags];
    rawNegative = tagsToString(negativeTags);
    if (currentMode === 'negative' && editor) {
      editor.setTags(negativeTags);
    }
  }

  await broadcastPromptStateAndRecord('restore');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (shouldIgnoreRuntimeMessage(msg)) return;
  if (msg.type === 'RESTORE_HISTORY_SNAPSHOT' && msg.snapshot) {
    restoreFromSnapshot(msg.snapshot);
  }

  if (msg.type === 'APPEND_HISTORY_SNIPPET' && msg.snapshot && msg.target) {
    appendHistorySnippet(msg.snapshot, msg.target);
  }
  
  if (msg.type === 'APPEND_TAG_FROM_PANEL' && msg.tag) {
    // 根据当前焦点追踪目标，将标签追加到正确的编辑器
    if (activeEditorTarget.type === 'base') {
      if (editor) {
        editor.addTag(msg.tag);
      }
    } else if (activeEditorTarget.type === 'character') {
      const idx = activeEditorTarget.charIndex;
      const charEdObj = charEditors[idx];
      if (charEdObj && charEdObj.editor) {
        charEdObj.editor.addTag(msg.tag);
      }
    }
  }

  if (msg.type === 'REMOVE_TAG_FROM_PANEL' && msg.tag) {
    if (activeEditorTarget.type === 'base') {
      if (editor) {
        editor.removeTagByText(msg.tag);
      }
    } else if (activeEditorTarget.type === 'character') {
      const idx = activeEditorTarget.charIndex;
      const charEdObj = charEditors[idx];
      if (charEdObj && charEdObj.editor) {
        charEdObj.editor.removeTagByText(msg.tag);
      }
    }
  }

  // 接收来自 GroupTags 面板的分组颜色映射，应用到所有 TagEditor 实例
  if (msg.type === 'SYNC_GROUP_COLORS' && msg.colorMap) {
    // 持久化保存到 storage
    chrome.storage.local.set({ groupColorMap: msg.colorMap });
    applyGroupMapsToEditors(msg.colorMap, currentGroupTranslationMap);
  }

  // 接收来自 GroupTags 面板的分组翻译映射，应用到所有 TagEditor 实例
  if (msg.type === 'SYNC_GROUP_TRANSLATIONS' && msg.translationMap) {
    // 持久化保存到 storage
    chrome.storage.local.set({ groupTranslationMap: msg.translationMap });
    applyGroupMapsToEditors(currentGroupColorMap, msg.translationMap);
  }
});

function applyTagEditorDensity(value) {
    // value ranges from 0 to 100
    // Density calculation logic based on linear interpolation
    const ratio = value / 100;
    
    // min constraints at 0, max at 100
    const gap = 2 + (8 * ratio);          // 2px -> 10px
    const padV = 0 + (4 * ratio);         // 0px -> 4px
    const padH = 4 + (8 * ratio);         // 4px -> 12px
    const minHeight = 20 + (12 * ratio);  // 20px -> 32px
    const fontEn = 11 + (4 * ratio);      // 11px -> 15px
    const fontZh = 10 + (3 * ratio);      // 10px -> 13px
    const btnSize = 18 + (10 * ratio);    // 18px -> 28px
    
    document.documentElement.style.setProperty('--te-density-gap', `${gap}px`);
    document.documentElement.style.setProperty('--te-density-pad-v', `${padV}px`);
    document.documentElement.style.setProperty('--te-density-pad-h', `${padH}px`);
    document.documentElement.style.setProperty('--te-density-min-height', `${minHeight}px`);
    document.documentElement.style.setProperty('--te-density-font-en', `${fontEn}px`);
    document.documentElement.style.setProperty('--te-density-font-zh', `${fontZh}px`);
    document.documentElement.style.setProperty('--te-density-btn-size', `${btnSize}px`);
}

// 监听跨 iframe 传来的 Density Slider 信号
window.addEventListener('message', (e) => {
    if (e.data?.type === '__UPDATE_TE_DENSITY__') {
        applyTagEditorDensity(e.data.value);
    }
});

init();

