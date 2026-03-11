// ========== 密度控制逻辑 ==========
const densitySlider = document.getElementById('density-slider');
const root = document.documentElement;
const STORAGE_KEY_DENSITY = 'groupTagsDensity';

// 基于 0-100 滑块值，映射到具体的 CSS 变量（0=最稀疏/大，100=最密集/紧凑）
function applyDensity(value) {
  // ratio: 0 (稀疏) -> 1 (密集)
  const r = value / 100;
  
  // Interpolate values
  // Gap: 6px -> 1px
  const gap = 6 - (5 * r);
  // PadV (Tabs): 10px -> 4px
  const padV = 10 - (6 * r);
  // PadH (Tabs): 14px -> 6px
  const padH = 14 - (8 * r);
  // Tab Font: 14px -> 10px
  const fontTab = 14 - (4 * r);
  // Card PadV: 5px -> 1px
  const cardPadV = 5 - (4 * r);
  // Card PadH: 8px -> 3px
  const cardPadH = 8 - (5 * r);
  // Card Font ZH: 13px -> 9px
  const fontZh = 13 - (4 * r);
  // Card Font EN: 14px -> 10px
  const fontEn = 14 - (4 * r);
  // Grid Padding: 16px -> 4px
  const gridPad = 16 - (12 * r);

  root.style.setProperty('--density-gap', `${gap}px`);
  root.style.setProperty('--density-pad-v', `${padV}px`);
  root.style.setProperty('--density-pad-h', `${padH}px`);
  root.style.setProperty('--density-font-tab', `${fontTab}px`);
  
  root.style.setProperty('--density-card-pad-v', `${cardPadV}px`);
  root.style.setProperty('--density-card-pad-h', `${cardPadH}px`);
  root.style.setProperty('--density-font-zh', `${fontZh}px`);
  root.style.setProperty('--density-font-en', `${fontEn}px`);
  
  root.style.setProperty('--density-grid-pad', `${gridPad}px`);
}

// 初始化读取存储
chrome.storage.local.get(STORAGE_KEY_DENSITY, (data) => {
  // 默认设置为目前的高密度状态 (大致相当于 value=80)
  const val = data[STORAGE_KEY_DENSITY] !== undefined ? data[STORAGE_KEY_DENSITY] : 80;
  densitySlider.value = val;
  applyDensity(val);
});

// 监听拖动并实时应用并保存
densitySlider.addEventListener('input', (e) => {
  const val = e.target.value;
  applyDensity(val);
  chrome.storage.local.set({ [STORAGE_KEY_DENSITY]: val });
});

// ========== 监听来自父窗口的消息（标签同步等） ==========
window.addEventListener('message', (e) => {
  if (e.data?.type === '__SYNC_ACTIVE_TAGS__') {
    // TODO: 后续将处理此消息
    console.log('[GroupTags] Received active tags:', e.data.tags);
  }
});

console.log('[GroupTags] Panel script initialized');
