// ========== 核心数据与状态 (Phase 1) ==========
let customGroupsData = null; // Memory Tree: Categories -> Groups -> Tags
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let activeTagsContext = []; // 当前聚焦输入框的 tags
let inactiveTagsContext = []; // 另一个输入框的 tags

// Mock 预设字典（以后可抽离为 default_tags.json）
const mockDefaultData = {
  categories: [
    {
      id: "env",
      name: "环境",
      groups: [
        {
          id: "weather",
          name: "天气",
          color: "#10b981",
          tags: [
            { en: "sunny", zh: "晴朗" },
            { en: "rain", zh: "雨" },
            { en: "snowing", zh: "下雪" },
            { en: "cloudy", zh: "多云的" },
            { en: "lightning and thunderstorm", zh: "闪电与雷暴" },
            { en: "foggy", zh: "起雾" },
            { en: "windy", zh: "刮风" },
            { en: "night", zh: "夜晚" }
          ]
        },
        {
          id: "indoor",
          name: "室内",
          color: "#f59e0b",
          tags: [
            { en: "indoors", zh: "室内" },
            { en: "bedroom", zh: "卧室" },
            { en: "classroom", zh: "教室" }
          ]
        }
      ]
    },
    {
      id: "character",
      name: "角色",
      groups: [
        {
          id: "hair",
          name: "头发",
          color: "#ec4899",
          tags: [
            { en: "white hair", zh: "白发" },
            { en: "long hair", zh: "长发" },
            { en: "twintails", zh: "双马尾" }
          ]
        }
      ]
    }
  ]
};

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

// ========== 颜色自定义与同步 ==========

// 构建全局 tag→color 的扁平映射表
function buildColorMap() {
  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    cat.groups.forEach(group => {
      const color = group.color || '#4a4a6a';
      group.tags.forEach(t => {
        map[t.en] = color;
      });
    });
  });
  return map;
}

// 将颜色映射发送给父窗口
function syncColorsToParent() {
  const colorMap = buildColorMap();
  window.parent.postMessage({ type: '__SYNC_GROUP_COLORS__', colorMap }, '*');
}
// ========== 渲染逻辑 (Phase 2 & 3) ==========
const dom = {
  primaryTabs: document.getElementById('primary-tabs-container'),
  secondaryTabs: document.getElementById('secondary-tabs-container'),
  tagsGrid: document.getElementById('tags-grid'),
  colorPicker: document.getElementById('group-color')
};

function renderPrimaryTabs() {
  if (!customGroupsData || !customGroupsData.categories) return;
  
  // 保留 [+] 按钮，清除其它
  const addBtn = dom.primaryTabs.querySelector('#btn-add-category');
  dom.primaryTabs.innerHTML = '';
  
  customGroupsData.categories.forEach((cat, index) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeCategoryIndex ? 'active' : ''}`;
    btn.textContent = cat.name;
    btn.onclick = () => {
      activeCategoryIndex = index;
      activeGroupIndex = 0; // 切分类时，重置分组索引到首位
      renderPrimaryTabs();
      renderSecondaryTabs();
    };
    dom.primaryTabs.appendChild(btn);
  });
  if (addBtn) dom.primaryTabs.appendChild(addBtn);
}

function renderSecondaryTabs() {
  if (!customGroupsData || !customGroupsData.categories.length) return;
  
  const addBtn = dom.secondaryTabs.querySelector('#btn-add-group');
  dom.secondaryTabs.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory || !currentCategory.groups) return;
  
  currentCategory.groups.forEach((grp, index) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeGroupIndex ? 'active' : ''}`;
    btn.textContent = grp.name;
    btn.onclick = () => {
      activeGroupIndex = index;
      renderSecondaryTabs();
    };
    dom.secondaryTabs.appendChild(btn);
  });
  if (addBtn) dom.secondaryTabs.appendChild(addBtn);
  
  // 更新完毕 Tab 后，立刻更新主体网格
  renderTagsGrid();
}

function renderTagsGrid() {
  if (!customGroupsData || !customGroupsData.categories.length) return;
  dom.tagsGrid.innerHTML = '';
  
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory || !currentCategory.groups.length) return;
  
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;

  // 更新底部的颜色选择器
  if (dom.colorPicker) {
    dom.colorPicker.value = currentGroup.color || '#4a4a6a';
  }

  currentGroup.tags.forEach(t => {
    // 检查是否已被使用
    const isUsedHere = activeTagsContext.includes(t.en);
    const isUsedOther = inactiveTagsContext.includes(t.en);

    const card = document.createElement('div');
    // 如果已经在另一边被使用了，我们给一个 "used-other" 的类（视觉上可能变半透明或打底纹，这里先用样式类标记）
    card.className = `tag-card ${isUsedHere ? 'used' : ''} ${isUsedOther && !isUsedHere ? 'used-other' : ''}`;
    card.title = `${t.zh}\n${t.en}`;
    
    // 注册点击事件 (Phase 4)
    card.onclick = () => {
      if (isUsedHere) {
        // 如果在当前框，点击就是反向移除
        window.parent.postMessage({ type: '__REMOVE_TAG_FROM_PANEL__', tag: t.en }, '*');
      } else if (isUsedOther) {
        // 如果在另一个框已经被使用了，拒绝并在界面晃动或无视（符合 NAI 一个 Tag 只在一边出现的逻辑）
        card.style.transform = 'translateX(5px)';
        setTimeout(() => card.style.transform = 'translateX(-5px)', 50);
        setTimeout(() => card.style.transform = 'translateX(5px)', 100);
        setTimeout(() => card.style.transform = 'translateX(0)', 150);
      } else {
        // 哪边都没用，正常追加到当前框
        window.parent.postMessage({ type: '__APPEND_TAG_FROM_PANEL__', tag: t.en, zh: t.zh }, '*');
      }
    };

    const zhPart = document.createElement('div');
    zhPart.className = 'tag-zh-part';
    zhPart.style.backgroundColor = currentGroup.color || '#4a4a6a';
    zhPart.textContent = t.zh;

    const enPart = document.createElement('div');
    enPart.className = 'tag-en-part';
    enPart.textContent = t.en;

    card.appendChild(zhPart);
    card.appendChild(enPart);
    dom.tagsGrid.appendChild(card);
  });
}

// ========== 监听来自父窗口的消息（标签同步等） ==========
window.addEventListener('message', (e) => {
  if (e.data?.type === '__SYNC_ACTIVE_TAGS__') {
    const parseTags = (tagsArray) => {
      if (!Array.isArray(tagsArray)) return [];
      return tagsArray.map(t => {
        let v = (t.value || '').trim();
        while (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
        while (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
        const blockMatch = v.match(/^[-?\d\.]+::(.*?)\s*::$/);
        if (blockMatch) v = blockMatch[1];
        return v;
      }).filter(Boolean);
    };

    activeTagsContext = parseTags(e.data.activeTags);
    inactiveTagsContext = parseTags(e.data.inactiveTags);
    
    // 更新底部目标指示器
    if (e.data.targetLabel) {
      const labelEl = document.getElementById('target-label');
      if (labelEl) labelEl.textContent = e.data.targetLabel;
    }

    console.log('[GroupTags] Sync active:', activeTagsContext, 'inactive:', inactiveTagsContext, 'target:', e.data.targetLabel);
    renderTagsGrid(); // 重新渲染刷新灰阶状态
  }
});

// ========== 初始化 ==========
function init() {
  // 模拟从读取或合并 `userCustomGroups`
  customGroupsData = mockDefaultData; 
  
  renderPrimaryTabs();
  renderSecondaryTabs();
  
  // 初始化完成后，将全量颜色映射推送给主面板
  syncColorsToParent();
}

init();
console.log('[GroupTags] Panel script initialized');

// 绑定颜色选择器事件
dom.colorPicker.addEventListener('input', (e) => {
  const newColor = e.target.value;
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;
  
  // 更新当前分组的颜色
  currentGroup.color = newColor;
  
  // 重新渲染卡片（显示新颜色）
  renderTagsGrid();
  
  // 同步更新后的全量颜色映射给 TagEditor
  syncColorsToParent();
  
  // TODO: 持久化到 chrome.storage.local
});
