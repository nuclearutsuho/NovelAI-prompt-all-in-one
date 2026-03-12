// ========== 核心数据与状态 (Phase 1) ==========
let customGroupsData = null; // Memory Tree: Categories -> Groups -> Tags
let activeCategoryIndex = 0;
let activeGroupIndex = 0;
let activeTagsContext = []; // 当前聚焦输入框的 tags
let inactiveTagsContext = []; // 另一个输入框的 tags

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

// 构建全局 tag→zh 的翻译映射表
function buildTranslationMap() {
  const map = {};
  if (!customGroupsData || !customGroupsData.categories) return map;
  customGroupsData.categories.forEach(cat => {
    cat.groups.forEach(group => {
      group.tags.forEach(t => {
        if (t.en && t.zh) map[t.en] = t.zh;
      });
    });
  });
  return map;
}

// 将翻译映射直接写入 chrome.storage.local（无需经过 bridge 中继）
function syncTranslationsToParent() {
  const translationMap = buildTranslationMap();
  chrome.storage.local.set({ groupTranslationMap: translationMap });
}
// ========== 渲染逻辑 ==========
let isEditMode = false;
let dataSnapshot = null; // 编辑模式开始时的数据快照，用于取消时恢复

const dom = {
  app: document.getElementById('app'),
  primaryTabs: document.getElementById('primary-tabs-container'),
  secondaryTabs: document.getElementById('secondary-tabs-container'),
  tagsGrid: document.getElementById('tags-grid'),
  colorPicker: document.getElementById('group-color'),
  modalOverlay: document.getElementById('modal-overlay'),
  modalDialog: document.getElementById('modal-dialog'),
  btnEdit: document.getElementById('btn-edit-group'),
  btnSave: document.getElementById('btn-save'),
  btnCancel: document.getElementById('btn-cancel'),
  btnAddCategory: document.getElementById('btn-add-category'),
  btnAddGroup: document.getElementById('btn-add-group')
};

// ========== 弹窗工具 ==========
function showModal(html) {
  dom.modalDialog.innerHTML = html;
  dom.modalOverlay.classList.add('active');
  // 自动聚焦第一个输入框
  const firstInput = dom.modalDialog.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function hideModal() {
  dom.modalOverlay.classList.remove('active');
  dom.modalDialog.innerHTML = '';
}

// 点击 overlay 背景关闭弹窗
dom.modalOverlay.addEventListener('click', (e) => {
  if (e.target === dom.modalOverlay) hideModal();
});

// ========== 编辑模式切换 ==========
function enterEditMode() {
  isEditMode = true;
  // 保存当前数据快照（深拷贝），取消时可恢复
  dataSnapshot = JSON.parse(JSON.stringify(customGroupsData));
  dom.app.classList.add('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
}

function exitEditMode(save) {
  if (save) {
    // 保存到 chrome.storage.local
    chrome.storage.local.set({ groupTagsUserData: customGroupsData }, () => {
      console.log('[GroupTags] Data saved to storage');
    });
    // 同步颜色映射和翻译映射到 TagEditor
    syncColorsToParent();
    syncTranslationsToParent();
  } else {
    // 取消：恢复快照
    if (dataSnapshot) {
      customGroupsData = dataSnapshot;
    }
  }
  dataSnapshot = null;
  isEditMode = false;
  dom.app.classList.remove('edit-mode');
  renderPrimaryTabs();
  renderSecondaryTabs();
}

// ========== ID 生成 ==========
function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ========== 分类操作 ==========
function addCategory() {
  showModal(`
    <h3>新建分类</h3>
    <input class="modal-input" id="modal-cat-name" placeholder="分类名称" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-cat-cancel">取消</button>
      <button class="modal-btn primary" id="modal-cat-confirm">确认</button>
    </div>
  `);
  document.getElementById('modal-cat-cancel').onclick = () => hideModal();
  document.getElementById('modal-cat-confirm').onclick = () => {
    const name = document.getElementById('modal-cat-name').value.trim();
    if (!name) return;
    customGroupsData.categories.push({
      id: generateId('cat'),
      name,
      _modified: true,
      groups: []
    });
    hideModal();
    activeCategoryIndex = customGroupsData.categories.length - 1;
    activeGroupIndex = 0;
    renderPrimaryTabs();
    renderSecondaryTabs();
  };
  // 回车确认
  document.getElementById('modal-cat-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-cat-confirm').click();
  });
}

function deleteCategory(index) {
  const cat = customGroupsData.categories[index];
  if (!cat) return;
  showModal(`
    <h3>确认删除分类</h3>
    <p style="color:#ccc;font-size:13px;">确定要删除分类 "<strong>${cat.name}</strong>" 及其所有分组和标签吗？</p>
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-del-cancel">取消</button>
      <button class="modal-btn danger" id="modal-del-confirm">删除</button>
    </div>
  `);
  document.getElementById('modal-del-cancel').onclick = () => hideModal();
  document.getElementById('modal-del-confirm').onclick = () => {
    customGroupsData.categories.splice(index, 1);
    if (activeCategoryIndex >= customGroupsData.categories.length) {
      activeCategoryIndex = Math.max(0, customGroupsData.categories.length - 1);
    }
    activeGroupIndex = 0;
    hideModal();
    renderPrimaryTabs();
    renderSecondaryTabs();
  };
}

// ========== 分组操作 ==========
function addGroup() {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  showModal(`
    <h3>新建分组</h3>
    <input class="modal-input" id="modal-grp-name" placeholder="分组名称" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-grp-cancel">取消</button>
      <button class="modal-btn primary" id="modal-grp-confirm">确认</button>
    </div>
  `);
  document.getElementById('modal-grp-cancel').onclick = () => hideModal();
  document.getElementById('modal-grp-confirm').onclick = () => {
    const name = document.getElementById('modal-grp-name').value.trim();
    if (!name) return;
    currentCategory.groups.push({
      id: generateId('grp'),
      name,
      color: '#4a4a6a',
      _modified: true,
      tags: []
    });
    currentCategory._modified = true;
    hideModal();
    activeGroupIndex = currentCategory.groups.length - 1;
    renderSecondaryTabs();
  };
  document.getElementById('modal-grp-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-grp-confirm').click();
  });
}

function deleteGroup(index) {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const grp = currentCategory.groups[index];
  if (!grp) return;
  showModal(`
    <h3>确认删除分组</h3>
    <p style="color:#ccc;font-size:13px;">确定要删除分组 "<strong>${grp.name}</strong>" 及其所有标签吗？</p>
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-del-grp-cancel">取消</button>
      <button class="modal-btn danger" id="modal-del-grp-confirm">删除</button>
    </div>
  `);
  document.getElementById('modal-del-grp-cancel').onclick = () => hideModal();
  document.getElementById('modal-del-grp-confirm').onclick = () => {
    currentCategory.groups.splice(index, 1);
    currentCategory._modified = true;
    if (activeGroupIndex >= currentCategory.groups.length) {
      activeGroupIndex = Math.max(0, currentCategory.groups.length - 1);
    }
    hideModal();
    renderSecondaryTabs();
  };
}

// ========== 标签操作 ==========
function addTag() {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;

  showModal(`
    <h3>添加标签</h3>
    <input class="modal-input" id="modal-tag-en" placeholder="英文标签 (如 sunny)" />
    <input class="modal-input" id="modal-tag-zh" placeholder="中文翻译 (可选，自动查字典)" />
    <div class="modal-buttons">
      <button class="modal-btn" id="modal-tag-cancel">取消</button>
      <button class="modal-btn primary" id="modal-tag-confirm">添加</button>
    </div>
  `);
  document.getElementById('modal-tag-cancel').onclick = () => hideModal();
  const enInput = document.getElementById('modal-tag-en');
  const zhInput = document.getElementById('modal-tag-zh');

  // 英文输入变化时自动查字典翻译
  enInput.addEventListener('blur', () => {
    if (zhInput.value.trim()) return; // 用户已手动输入，不覆盖
    const en = enInput.value.trim();
    if (!en) return;
    // 通过 postMessage 请求字典查询（异步，结果可能不即时）
    // 这里用本地简单匹配：检查 customGroupsData 中是否已有该 tag 的翻译
    // 更完整的方案可以接入 autocomplete 字典，目前先让用户手动填写
  });

  document.getElementById('modal-tag-confirm').onclick = () => {
    const en = enInput.value.trim();
    if (!en) return;
    const zh = zhInput.value.trim() || en; // 没输翻译就用英文
    // 检查重复
    if (currentGroup.tags.some(t => t.en === en)) {
      enInput.style.borderColor = '#e74c3c';
      enInput.placeholder = '该标签已存在！';
      return;
    }
    currentGroup.tags.push({ en, zh });
    currentGroup._modified = true;
    currentCategory._modified = true;
    hideModal();
    renderTagsGrid();
  };

  enInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!zhInput.value.trim()) zhInput.focus();
      else document.getElementById('modal-tag-confirm').click();
    }
  });
  zhInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-tag-confirm').click();
  });
}

function deleteTag(tagIndex) {
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;
  currentGroup.tags.splice(tagIndex, 1);
  currentGroup._modified = true;
  currentCategory._modified = true;
  renderTagsGrid();
}

// ========== 渲染函数 ==========
function renderPrimaryTabs() {
  if (!customGroupsData || !customGroupsData.categories) return;
  
  const addBtn = dom.primaryTabs.querySelector('#btn-add-category');
  dom.primaryTabs.innerHTML = '';
  
  customGroupsData.categories.forEach((cat, index) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${index === activeCategoryIndex ? 'active' : ''}`;
    btn.textContent = cat.name;
    btn.onclick = () => {
      if (index === activeCategoryIndex) return; // 已激活则跳过，避免打断双击
      activeCategoryIndex = index;
      activeGroupIndex = 0;
      renderPrimaryTabs();
      renderSecondaryTabs();
    };

    // 编辑模式：双击重命名 + 悬浮提示
    if (isEditMode) {
      btn.title = '双击重命名';
      btn.style.cursor = 'text';
      btn.ondblclick = (e) => {
        e.stopPropagation();
        
        // 锁定当前宽度，避免被输入框撑开
        const origWidth = btn.getBoundingClientRect().width;
        btn.style.width = origWidth + 'px';
        btn.style.paddingLeft = '0';
        btn.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = cat.name;
        btn.textContent = '';
        btn.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== cat.name) {
            cat.name = newName;
            cat._modified = true;
          }
          renderPrimaryTabs();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderPrimaryTabs();
        });
      };
      // 内嵌删除图标（仅在活跃 Tab 上显示）
      if (index === activeCategoryIndex) {
        const del = document.createElement('span');
        del.className = 'tab-inline-delete';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); deleteCategory(index); };
        btn.appendChild(del);
      }
    }

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
      if (index === activeGroupIndex) return; // 已激活则跳过，避免打断双击
      activeGroupIndex = index;
      renderSecondaryTabs();
    };

    // 编辑模式：双击重命名 + 悬浮提示
    if (isEditMode) {
      btn.title = '双击重命名';
      btn.style.cursor = 'text';
      btn.ondblclick = (e) => {
        e.stopPropagation();
        
        const origWidth = btn.getBoundingClientRect().width;
        btn.style.width = origWidth + 'px';
        btn.style.paddingLeft = '0';
        btn.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = grp.name;
        btn.textContent = '';
        btn.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== grp.name) {
            grp.name = newName;
            grp._modified = true;
            currentCategory._modified = true;
          }
          renderSecondaryTabs();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderSecondaryTabs();
        });
      };
      // 内嵌删除图标（仅在活跃 Tab 上显示）
      if (index === activeGroupIndex) {
        const del = document.createElement('span');
        del.className = 'tab-inline-delete';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); deleteGroup(index); };
        btn.appendChild(del);
      }
    }

    dom.secondaryTabs.appendChild(btn);
  });
  if (addBtn) dom.secondaryTabs.appendChild(addBtn);
  
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
    const color = currentGroup.color || '#4a4a6a';
    dom.colorPicker.value = color;
    const btn = document.getElementById('color-picker-btn');
    if (btn) btn.style.backgroundColor = color;
  }

  currentGroup.tags.forEach((t, tagIndex) => {
    const isUsedHere = activeTagsContext.includes(t.en);
    const isUsedOther = inactiveTagsContext.includes(t.en);

    const card = document.createElement('div');
    card.className = `tag-card ${isUsedHere ? 'used' : ''} ${isUsedOther && !isUsedHere ? 'used-other' : ''}`;
    card.title = `${t.zh}\n${t.en}`;
    
    // 点击事件：编辑模式下禁用追加/移除
    if (!isEditMode) {
      card.onclick = () => {
        if (isUsedHere) {
          window.parent.postMessage({ type: '__REMOVE_TAG_FROM_PANEL__', tag: t.en }, '*');
        } else if (isUsedOther) {
          card.style.transform = 'translateX(5px)';
          setTimeout(() => card.style.transform = 'translateX(-5px)', 50);
          setTimeout(() => card.style.transform = 'translateX(5px)', 100);
          setTimeout(() => card.style.transform = 'translateX(0)', 150);
        } else {
          window.parent.postMessage({ type: '__APPEND_TAG_FROM_PANEL__', tag: t.en, zh: t.zh }, '*');
        }
      };
    }

    const zhPart = document.createElement('div');
    zhPart.className = 'tag-zh-part';
    zhPart.style.backgroundColor = currentGroup.color || '#4a4a6a';
    zhPart.textContent = t.zh;

    // 编辑模式：双击编辑翻译 + 悬浮提示
    if (isEditMode) {
      zhPart.title = '双击编辑翻译';
      zhPart.style.cursor = 'text';
      zhPart.ondblclick = (e) => {
        e.stopPropagation();
        
        const origWidth = zhPart.getBoundingClientRect().width;
        zhPart.style.width = origWidth + 'px';
        zhPart.style.boxSizing = 'border-box';
        zhPart.style.paddingLeft = '0';
        zhPart.style.paddingRight = '0';

        const input = document.createElement('input');
        input.className = 'inline-rename-input';
        input.value = t.zh;
        zhPart.textContent = '';
        zhPart.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const newZh = input.value.trim();
          if (newZh) {
            t.zh = newZh;
            currentGroup._modified = true;
            currentCategory._modified = true;
          }
          renderTagsGrid();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') renderTagsGrid();
        });
      };
    }

    const enPart = document.createElement('div');
    enPart.className = 'tag-en-part';
    enPart.textContent = t.en;

    card.appendChild(zhPart);
    card.appendChild(enPart);

    // 编辑模式：× 删除角标
    if (isEditMode) {
      const badge = document.createElement('span');
      badge.className = 'card-delete-badge';
      badge.textContent = '×';
      badge.onclick = (e) => { e.stopPropagation(); deleteTag(tagIndex); };
      card.appendChild(badge);
    }

    dom.tagsGrid.appendChild(card);
  });

  // 编辑模式：末尾添加 "+" 占位卡
  if (isEditMode) {
    const addCard = document.createElement('div');
    addCard.className = 'tag-card tag-card-add';
    addCard.title = '添加标签';
    addCard.onclick = () => addTag();

    // 结构与正常卡片完全一致的隐形骨架（确保无论是否换行，高度严格一致）
    const dummyZh = document.createElement('div');
    dummyZh.className = 'tag-zh-part';
    dummyZh.style.visibility = 'hidden';
    dummyZh.textContent = '增';
    
    const dummyEn = document.createElement('div');
    dummyEn.className = 'tag-en-part';
    dummyEn.style.visibility = 'hidden';
    dummyEn.textContent = 'Add';
    
    addCard.appendChild(dummyZh);
    addCard.appendChild(dummyEn);

    // 绝对居中的加号图标
    const iconOverlay = document.createElement('div');
    iconOverlay.className = 'add-icon-overlay';
    iconOverlay.textContent = '+';
    addCard.appendChild(iconOverlay);

    dom.tagsGrid.appendChild(addCard);
  }
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
    
    if (e.data.targetLabel) {
      const labelEl = document.getElementById('target-label');
      if (labelEl) labelEl.textContent = e.data.targetLabel;
    }

    renderTagsGrid();
  }
});

// ========== 初始化 ==========
async function init() {
  try {
    // 1. 加载预设标签数据
    const jsonUrl = chrome.runtime.getURL('data/default_group_tags.json');
    const res = await fetch(jsonUrl);
    const defaultData = await res.json();
    
    // 2. 从 chrome.storage.local 加载用户自定义数据
    const stored = await new Promise(resolve => {
      chrome.storage.local.get('groupTagsUserData', (data) => resolve(data.groupTagsUserData));
    });
    
    if (stored && stored.categories) {
      // 合并预设与用户数据：用户数据优先，预设仅补增
      const userIds = new Set(stored.categories.map(c => c.id));
      defaultData.categories.forEach(defaultCat => {
        if (!userIds.has(defaultCat.id)) {
          // 预设中新增的分类，追加到末尾
          stored.categories.push(defaultCat);
        }
        // 已存在的分类：如果用户修改过（_modified），以用户版本为准
        // 否则可以选择更新，但目前简单处理：以用户数据为准
      });
      customGroupsData = stored;
    } else {
      customGroupsData = defaultData;
    }
    
    // 3. 渲染 UI
    renderPrimaryTabs();
    renderSecondaryTabs();
    
    // 4. 推送颜色映射和翻译映射
    syncColorsToParent();
    syncTranslationsToParent();
    
    console.log('[GroupTags] Initialized, categories:', customGroupsData.categories.length);
  } catch (err) {
    console.error('[GroupTags] Failed to init:', err);
    customGroupsData = { categories: [] };
    renderPrimaryTabs();
    renderSecondaryTabs();
  }
}

init();

// ========== 按钮事件绑定 ==========

// 颜色选择器
dom.colorPicker.addEventListener('input', (e) => {
  const newColor = e.target.value;
  const currentCategory = customGroupsData.categories[activeCategoryIndex];
  if (!currentCategory) return;
  const currentGroup = currentCategory.groups[activeGroupIndex];
  if (!currentGroup) return;
  
  currentGroup.color = newColor;
  currentGroup._modified = true;
  currentCategory._modified = true;
  
  const btn = document.getElementById('color-picker-btn');
  if (btn) btn.style.backgroundColor = newColor;
  
  renderTagsGrid();
  syncColorsToParent();
});

// Edit / Save / Cancel
dom.btnEdit.addEventListener('click', () => enterEditMode());
dom.btnSave.addEventListener('click', () => exitEditMode(true));
dom.btnCancel.addEventListener('click', () => exitEditMode(false));

// + 按钮（编辑模式下才可用）
dom.btnAddCategory.addEventListener('click', () => {
  if (isEditMode) addCategory();
});
dom.btnAddGroup.addEventListener('click', () => {
  if (isEditMode) addGroup();
});
