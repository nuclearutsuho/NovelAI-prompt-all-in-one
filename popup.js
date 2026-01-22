// NovelAI Wildcards – popup.js
let currentFolder = null;

// Custom confirm dialog (for iframe compatibility where native confirm() is blocked)
function customConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-confirm-modal');
    const msgEl = document.getElementById('custom-confirm-message');
    const yesBtn = document.getElementById('custom-confirm-yes');
    const noBtn = document.getElementById('custom-confirm-no');

    msgEl.textContent = message;
    modal.style.display = 'flex';

    const cleanup = () => {
      modal.style.display = 'none';
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };

    yesBtn.onclick = () => { cleanup(); resolve(true); };
    noBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

const list = document.getElementById('list');
const folderInput = document.getElementById('newFolderName');
const createFolderBtn = document.getElementById('createFolderBtn');
const backBtn = document.getElementById('backBtn');
const viewTitle = document.getElementById('viewTitle');
const fileRoot = document.getElementById('fileRoot');
const fileInFolder = document.getElementById('fileInFolder');
const rootContent = document.getElementById('rootContent');
const langToggle = document.getElementById('langToggle');
const fileCreateInFolder = document.getElementById('fileCreateInFolder');

let isDragging = false;
let lastSelectedIndex = null;

// 편집 모드 관련 변수 (编辑模式相关变量)
let currentEditingFile = null;
const editorMode = document.getElementById('editor-mode');
const editorBackBtn = document.getElementById('editor-back-btn');
const fileNameEditor = document.getElementById('file-name-editor');
const fileContentEditor = document.getElementById('file-content-editor');
const saveFileBtn = document.getElementById('save-file-btn');

const SETTINGS_VISIBLE_KEY = 'settingsVisible';

const LANG_KEY = 'lang';
let lang = 'en'; // 기본 언어 설정 (영어) (默认语言设置 (英语))

const translations = {
  en: {
    settings: "Settings",
    preserveLabel: "Preserve Original img prompts on Enhance",
    preserveDesc: "・Uncheck this to randomize enhance prompts.",
    alternativeLabel: "Full Alternative Danbooru Autocomplete",
    alternativeDesc: "・a1111 WebUI style Danbooru Autocomplete.",
    triggerTitle: "Autocomplete Trigger Keys",
    space: "Space",
    spaceDesc: "Works fine along with NAI default.",
    tab: "Tab",
    tabDesc: "Use with \"Disable Tag Suggestions\" ON.",
    wildcards: "Wildcards"
  },
  jp: {
    settings: "設定",
    preserveLabel: "品質向上時、画像の元々のプロンプトを使う",
    preserveDesc: "・品質向上時もランダマイズしたい場合は解除",
    alternativeLabel: "カスタム入力候補予測（軽量）を使う",
    alternativeDesc: "・WebUiスタイルのDanbooruタグ予測変換",
    triggerTitle: "予測変換のトリガーキー",
    space: "Space",
    spaceDesc: "NAIの基本動作と衝突せず動作します。",
    tab: "Tab",
    tabDesc: "「入力候補予測をやめる」ON推奨",
    wildcards: "ワイルドカード"
  },
  zh: {
    settings: "设置",
    preserveLabel: "增强时保留原图提示词",
    preserveDesc: "・取消勾选以随机化增强提示词",
    alternativeLabel: "启用 Danbooru 自动补全",
    alternativeDesc: "・类似 A1111 WebUI 风格的标签补全",
    triggerTitle: "补全触发键",
    space: "空格",
    spaceDesc: "与 NAI 默认设置兼容",
    tab: "Tab",
    tabDesc: "需开启「禁用标签建议」选项",
    wildcards: "通配符"
  }
};

function setLang(lang) {
  const keys = translations[lang] || {};
  Object.keys(keys).forEach(key => {
    const el = document.querySelector('[data-i18n-key="' + key + '"]');
    if (el) el.textContent = keys[key];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setLang('en'); // 초기 언어 설정 (初始语言设置)
  document.getElementById('btn-en').addEventListener('click', () => setLang('en'));
  document.getElementById('btn-jp').addEventListener('click', () => setLang('jp'));
  document.getElementById('btn-zh').addEventListener('click', () => setLang('zh'));
});

// Create new folder
document.getElementById('createFolderBtn').addEventListener('click', () => {
  let raw = folderInput.value.trim();
  let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');
  if (!name) return alert('Input folder name.');
  chrome.storage.local.get(['wildcards', 'wildcardFolders'], d => {
    const map = d.wildcards || {};
    const folders = d.wildcardFolders || [];
    if (folders.includes(name) || map[name]) {
      return alert('Folder already exists: ' + name);
    }
    folders.push(name);
    chrome.storage.local.set({ wildcardFolders: folders }, refresh);
    folderInput.value = '';
  });
});

// Create new file 
const createFileBtn = document.getElementById('createFileBtn');
createFileBtn.addEventListener('click', () => {
  let raw = folderInput.value.trim();
  let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');

  if (!name) return alert('Input file name.');

  chrome.storage.local.get('wildcards', data => {
    const map = data.wildcards || {};

    // 파일 키 생성 (현재 폴더에 있으면 폴더명/파일명, 아니면 파일명) (生成文件 Key (如果在当前文件夹则为 文件夹名/文件名，否则为 文件名))
    const key = currentFolder ? `${currentFolder}/${name}` : name;

    // 이미 존재하는 파일인지 확인 (检查文件是否已存在)
    if (map[key]) {
      return alert(`File already exists: ${key}`);
    }

    // 새 파일 생성 (내용은 빈 문자열로 시작) (创建新文件 (内容以空字符串开始))
    map[key] = '';

    // 저장 후 화면 갱신 (保存后刷新画面)
    chrome.storage.local.set({ wildcards: map }, () => {
      folderInput.value = '';

      // 추가: 파일 생성 후 바로 에디터 모드로 전환 (追加：创建文件后立即切换到编辑器模式)
      enterEditMode(key, '');
    });
  });
});

const createFileBtnInFolder = document.getElementById('createFileBtnInFolder');
createFileBtnInFolder.addEventListener('click', () => {
  const input = document.getElementById('newFileNameInFolder')
  let raw = input.value.trim();
  let name = raw.replace(/\s+/g, '_').replace(/_+/g, '_');

  if (!name) return alert('Input file name.');

  chrome.storage.local.get('wildcards', data => {
    const map = data.wildcards || {};

    // 파일 키 생성 (현재 폴더에 있으면 폴더명/파일명, 아니면 파일명) (生成文件 Key (如果在当前文件夹则为 文件夹名/文件名，否则为 文件名))
    const key = currentFolder ? `${currentFolder}/${name}` : name;

    // 이미 존재하는 파일인지 확인 (检查文件是否已存在)
    if (map[key]) {
      return alert(`File already exists: ${key}`);
    }

    // 새 파일 생성 (내용은 빈 문자열로 시작) (创建新文件 (内容以空字符串开始))
    map[key] = '';

    // 저장 후 화면 갱신 (保存后刷新画面)
    chrome.storage.local.set({ wildcards: map }, () => {
      input.value = '';

      // 추가: 파일 생성 후 바로 에디터 모드로 전환 (追加：创建文件后立即切换到编辑器模式)
      enterEditMode(key, '');
    });
  });
});


// Back to root view
backBtn.addEventListener('click', () => {
  currentFolder = null;
  refresh();
});
backBtn.addEventListener('dragenter', e => {
  if (!currentFolder) return;
  e.preventDefault();
  backBtn.classList.add('drop-target');
});
backBtn.addEventListener('dragleave', e => {
  backBtn.classList.remove('drop-target');
});
backBtn.addEventListener('drop', e => {
  e.preventDefault();
  backBtn.classList.remove('drop-target');
  const keys = JSON.parse(e.dataTransfer.getData('application/json'));
  chrome.storage.local.get('wildcards', data => {
    const map = data.wildcards || {};
    keys.forEach(oldKey => {
      const prefix = currentFolder + '/';
      if (oldKey.startsWith(prefix)) {
        const base = oldKey.slice(prefix.length);
        if (!map[base]) {
          map[base] = map[oldKey];
          delete map[oldKey];
        }
      }
    });
    chrome.storage.local.set({ wildcards: map }, () => {
      currentFolder = null;
      refresh();
    });
  });
});
backBtn.addEventListener('dragover', e => {
  if (currentFolder) e.preventDefault();
});

// Root upload handler
fileRoot.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  chrome.storage.local.get(['wildcards', 'wildcardFolders'], d => {
    const map = d.wildcards || {};
    let remaining = files.length;
    files.forEach(f => {
      const rel = f.webkitRelativePath || f.name;
      const rawKey = rel.replace(/\.txt$/i, '');
      const key = rawKey.replace(/\s+/g, '_').replace(/_+/g, '_');
      if (map[key]) {
        alert(`File already exists: ${key}`);
        if (--remaining === 0) chrome.storage.local.set({ wildcards: map }, refresh);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        map[key] = reader.result;
        if (--remaining === 0) chrome.storage.local.set({ wildcards: map }, refresh);
      };
      reader.readAsText(f);
    });
  });
  fileRoot.value = '';
});

// Folder upload handler
fileInFolder.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (!currentFolder || !files.length) return;
  chrome.storage.local.get('wildcards', d => {
    const map = d.wildcards || {};
    let remaining = files.length;
    files.forEach(f => {
      const rawBase = f.name.replace(/\.txt$/i, '');
      const sanBase = rawBase.replace(/\s+/g, '_').replace(/_+/g, '_');
      const key = `${currentFolder}/${sanBase}`;
      if (map[key]) {
        alert(`File already exists: ${key}`);
        if (--remaining === 0) chrome.storage.local.set({ wildcards: map }, refresh);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        map[key] = reader.result;
        if (--remaining === 0) chrome.storage.local.set({ wildcards: map }, refresh);
      };
      reader.readAsText(f);
    });
  });
  fileInFolder.value = '';
});

// Render list function
function refresh() {
  chrome.storage.local.get(['wildcards', 'wildcardFolders', SETTINGS_VISIBLE_KEY], d => {
    const map = d.wildcards || {};
    const folders = d.wildcardFolders || [];
    const isSettingsVisible = d[SETTINGS_VISIBLE_KEY] !== undefined ?
      d[SETTINGS_VISIBLE_KEY] : true;
    const settings = document.getElementById('settings');
    list.innerHTML = '';

    console.log(translations[lang].settings)

    // Toggle root vs folder view
    if (currentFolder) {
      backBtn.style.display = 'inline-block';
      viewTitle.textContent = `Folder: ${currentFolder}`;
      rootContent.style.display = 'none';
      settings.style.display = 'none';
      fileRoot.style.display = 'none';
      fileInFolder.style.display = 'inline-block';
      langToggle.style.display = 'none';
      fileCreateInFolder.style.display = 'block'; // Show file creation button in folder view
      viewTitle.classList.add('inFolder');
    } else {
      backBtn.style.display = 'none';
      viewTitle.textContent = translations[lang].settings;
      rootContent.style.display = 'block';
      settings.style.display = isSettingsVisible ? 'block' : 'none'; // 설정 표시 상태 적용
      fileRoot.style.display = 'inline-block';
      fileInFolder.style.display = 'none';
      langToggle.style.display = 'block';
      fileCreateInFolder.style.display = 'none'; // Hide file creation button in root view
      viewTitle.classList.remove('inFolder');
    }
    viewTitle.classList.toggle('collapsed', isSettingsVisible);



    if (currentFolder) {
      const renameBtn = document.getElementById('renameFolderBtn');
      renameBtn.onclick = () => {
        const raw = document.getElementById('newFileNameInFolder').value.trim();
        if (!raw) return alert('Input folder name.');
        // 공백→_ 치환, 중복 _ 제거 (空格→_ 替换，去重 _)
        const sanitized = raw.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
        if (!sanitized || sanitized === currentFolder) {
          return alert('Invalid folder name.');
        }
        chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
          const map = data.wildcards || {};
          const folders = data.wildcardFolders || [];
          // 새 이름이 이미 존재하는지 검사 (检查新名称是否已存在)
          if (folders.includes(sanitized) || Object.keys(map).some(k => k === sanitized || k.startsWith(sanitized + '/'))) {
            return alert('Folder already exists: ' + sanitized);
          }
          // 1) folders 배열 업데이트 (1) folders 数组更新)
          const newFolders = folders.map(f => f === currentFolder ? sanitized : f);
          // 2) wildcards map 키들 재명명 (2) wildcards map key 重命名)
          const newMap = {};
          Object.keys(map).forEach(key => {
            if (key.startsWith(currentFolder + '/')) {
              const rest = key.slice(currentFolder.length + 1);
              newMap[sanitized + '/' + rest] = map[key];
            } else {
              newMap[key] = map[key];
            }
          });
          // 저장 후, currentFolder 갱신 및 화면 새로고침 (保存后，更新 currentFolder 并刷新画面)
          chrome.storage.local.set({
            wildcards: newMap,
            wildcardFolders: newFolders
          }, () => {
            currentFolder = sanitized;
            refresh();
          });
        });
      };
    }

    if (!currentFolder) {
      // Root view: list folders and root files
      folders.sort().forEach(folder => {
        const li = document.createElement('li');
        const hdr = document.createElement('div');
        hdr.className = 'folder-header';
        hdr.textContent = folder;
        hdr.onclick = () => { currentFolder = folder; refresh(); };
        hdr.addEventListener('dragover', e => e.preventDefault());
        // drop 시 파일들 해당 폴더로 이동 (drop 时将文件移动到该文件夹)
        hdr.addEventListener('drop', e => {
          e.preventDefault();
          const keys = JSON.parse(e.dataTransfer.getData('application/json'));
          chrome.storage.local.get(['wildcards', 'wildcardFolders'], data => {
            const map = data.wildcards || {};
            keys.forEach(oldKey => {
              const base = oldKey.includes('/') ? oldKey.split('/').pop() : oldKey;
              const newKey = `${folder}/${base}`;
              // 덮어쓰기 방지 (防止覆盖)
              if (!map[newKey]) {
                map[newKey] = map[oldKey];
                delete map[oldKey];
              }
            });
            chrome.storage.local.set({ wildcards: map }, refresh);
          });
        });

        hdr.addEventListener('dragenter', e => {
          e.preventDefault();
          hdr.classList.add('drop-target');
        });
        // 다른 곳으로 빠져나갈 때 원래대로 (移出到其他地方时恢复原状)
        hdr.addEventListener('dragleave', e => {
          hdr.classList.remove('drop-target');
        });
        const delBtn = document.createElement('button');
        delBtn.textContent = 'delete folder';
        delBtn.style.cssText = 'float:right; margin-top:-18px; padding: 0 5px; position:relative; z-index:10;';
        delBtn.onclick = async e => {
          e.stopPropagation();
          if (!await customConfirm(`Delete '${folder}' folder and all files inside?`)) return;
          const newMap = { ...map };
          Object.keys(newMap).forEach(k => { if (k.startsWith(folder + '/')) delete newMap[k]; });
          const newFolders = folders.filter(f => f !== folder);
          chrome.storage.local.set({ wildcards: newMap, wildcardFolders: newFolders }, () => {
            if (currentFolder === folder) currentFolder = null;
            refresh();
          });
        };
        li.append(hdr, delBtn);
        list.appendChild(li);
      });
      Object.keys(map).filter(k => !k.includes('/')).sort().forEach(name => {
        const li = document.createElement('li');
        li.className = 'file-item';
        // 파일 경로(key)를 data-key 에 저장 (将文件路径(key)保存到 data-key)
        const key = currentFolder ? `${currentFolder}/${name}` : name;
        li.dataset.key = key;
        // 드래그 가능하게 (使其可拖拽)
        li.setAttribute('draggable', 'true');

        li.addEventListener('dblclick', e => {
          e.stopPropagation(); // 이벤트 버블링 방지 (防止事件冒泡)
          enterEditMode(name, map[name]);
        });

        // 클릭으로 선택 토글 (Ctrl/Cmd + 클릭으로 멀티셀렉트) (点击切换选择 (Ctrl/Cmd + 点击进行多选))
        li.addEventListener('click', e => {
          // 현재 리스트의 모든 파일 아이템 (当前列表的所有文件项)
          const items = Array.from(document.querySelectorAll('li.file-item'));
          const thisIndex = items.indexOf(li);

          if (e.shiftKey && lastSelectedIndex !== null) {
            // Shift+Click: 마지막 선택 지점↔현재 지점 사이 모두 선택 (Shift+Click: 选择最后选择点↔当前点之间的所有项)
            const [start, end] = [lastSelectedIndex, thisIndex].sort((a, b) => a - b);
            items.slice(start, end + 1).forEach(el => el.classList.add('selected'));
          }
          else if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+Click: 토글 (Ctrl/Cmd+Click: 切换)
            li.classList.toggle('selected');
          }
          else {
            // 일반 클릭: 다른 건 해제 후 현재만 선택 (普通点击：取消其他选择后只选择当前项)
            items.forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
          }

          // 클릭 후에는 인덱스 기억 (点击后记住索引)
          lastSelectedIndex = thisIndex;
        });

        // dragstart 시 선택된 항목들의 key 리스트 전송 (dragstart 时发送选中项目的 key 列表)
        li.addEventListener('dragstart', e => {
          const selItems = document.querySelectorAll('.file-item.selected');
          const keys = selItems.length
            ? Array.from(selItems).map(el => el.dataset.key)
            : [key];
          e.dataTransfer.setData('application/json', JSON.stringify(keys));
        });
        li.textContent = name;
        const del = document.createElement('button');
        del.textContent = 'delete';
        del.onclick = () => { delete map[name]; chrome.storage.local.set({ wildcards: map }, refresh); };
        li.append(del);
        list.appendChild(li);
      });

    } else {
      // Folder view: show only files in currentFolder
      Object.keys(map).filter(k => k.startsWith(currentFolder + '/')).sort().forEach(fullKey => {
        const fileName = fullKey.slice(currentFolder.length + 1);
        const li = document.createElement('li');
        li.className = 'file-item';
        // 파일 경로(key)를 data-key 에 저장 (将文件路径(key)保存到 data-key)
        const key = currentFolder ? `${currentFolder}/${fileName}` : fileName;
        li.dataset.key = key;
        // 드래그 가능하게 (使其可拖拽)
        li.setAttribute('draggable', 'true');

        li.addEventListener('dblclick', e => {
          e.stopPropagation(); // 이벤트 버블링 방지 (防止事件冒泡)
          enterEditMode(fullKey, map[fullKey]);
        });

        // 클릭으로 선택 토글 (Ctrl/Cmd + 클릭으로 멀티셀렉트) (点击切换选择 (Ctrl/Cmd + 点击进行多选))
        li.addEventListener('click', e => {
          // 현재 리스트의 모든 파일 아이템 (当前列表的所有文件项)
          const items = Array.from(document.querySelectorAll('li.file-item'));
          const thisIndex = items.indexOf(li);

          if (e.shiftKey && lastSelectedIndex !== null) {
            // Shift+Click: 마지막 선택 지점↔현재 지점 사이 모두 선택 (Shift+Click: 选择最后选择点↔当前点之间的所有项)
            const [start, end] = [lastSelectedIndex, thisIndex].sort((a, b) => a - b);
            items.slice(start, end + 1).forEach(el => el.classList.add('selected'));
          }
          else if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+Click: 토글 (Ctrl/Cmd+Click: 切换)
            li.classList.toggle('selected');
          }
          else {
            // 일반 클릭: 다른 건 해제 후 현재만 선택 (普通点击：取消其他选择后只选择当前项)
            items.forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
          }

          // 클릭 후에는 인덱스 기억 (点击后记住索引)
          lastSelectedIndex = thisIndex;
        });

        // dragstart 시 선택된 항목들의 key 리스트 전송 (dragstart 时发送选中项目的 key 列表)
        li.addEventListener('dragstart', e => {
          const selItems = document.querySelectorAll('.file-item.selected');
          const keys = selItems.length
            ? Array.from(selItems).map(el => el.dataset.key)
            : [key];
          e.dataTransfer.setData('application/json', JSON.stringify(keys));
        });
        li.textContent = fileName;
        const del = document.createElement('button');
        del.textContent = 'delete';
        del.onclick = () => { delete map[fullKey]; chrome.storage.local.set({ wildcards: map }, refresh); };
        li.append(del);
        list.appendChild(li);
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', refresh);

// 监听 storage 变化，实现多窗口实时同步 (Listen for storage changes for real-time sync across windows)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.wildcards || changes.wildcardFolders)) {
    // 如果不在编辑模式，则刷新列表 (If not in edit mode, refresh the list)
    if (!currentEditingFile) {
      refresh();
    }
  }
});

// Drag event handlers - consolidated (拖拽事件处理 - 合并版)
document.addEventListener('dragstart', e => {
  if (e.target.closest('.file-item')) {
    isDragging = true;
    backBtn.classList.add('active');
    document.querySelectorAll('.folder-header')
      .forEach(el => el.classList.add('active'));
  }
});

document.addEventListener('dragend', () => {
  isDragging = false;
  backBtn.classList.remove('active');
  document.querySelectorAll('.folder-header')
    .forEach(el => el.classList.remove('active'));
});

document.addEventListener('drop', () => {
  isDragging = false;
  backBtn.classList.remove('active');
  document.querySelectorAll('.folder-header')
    .forEach(el => el.classList.remove('active'));
});

// backBtn drop handler for active class (安全移除 active 类)
backBtn.addEventListener('drop', e => {
  backBtn.classList.remove('active');
});

document.addEventListener('DOMContentLoaded', () => {
  // 자동 상하 스크롤 (自动上下滚动)
  document.addEventListener('dragover', e => {
    if (!isDragging) return;
    const TOP_ZONE = 40;                   // 상단에서 40px 이내 (顶部 40px 以内)
    const BOTTOM_ZONE = window.innerHeight - 40; // 하단에서 40px 이내 (底部 40px 以内)

    if (e.clientY < TOP_ZONE) {
      // 위로 (向上)
      window.scrollBy(0, -20);
    } else if (e.clientY > BOTTOM_ZONE) {
      // 아래로 (필요시) (向下 (如果需要))
      window.scrollBy(0, 20);
    }
  });
});

// 편집 모드로 전환하는 함수 (切换到编辑模式的函数)
function enterEditMode(key, content) {
  // 현재 편집 중인 파일 정보 저장 (保存当前正在编辑的文件信息)
  currentEditingFile = { key: key };

  // 파일명과 내용 설정 (设置文件名和内容)
  const fileName = key.includes('/') ? key.split('/').pop() : key;
  fileNameEditor.value = fileName;
  fileContentEditor.value = content;

  // 기존 UI 숨기기 (隐藏现有 UI)
  backBtn.style.display = 'none';
  viewTitle.style.display = 'none';
  rootContent.style.display = 'none';
  list.style.display = 'none';
  langToggle.style.display = 'none';
  fileInFolder.style.display = 'none';
  fileCreateInFolder.style.display = 'none';

  // 헤더 숨기기 (隐藏 Header)
  document.querySelector('header').style.display = 'none';

  // 편집 UI 표시 (显示编辑 UI)
  editorMode.style.display = 'flex';
}


// 일반 모드로 돌아가는 함수 (返回普通模式的函数)
function exitEditMode() {
  // 편집 UI 숨기기 (隐藏编辑 UI)
  editorMode.style.display = 'none';

  // 기존 UI 복원 (恢复现有 UI)
  if (currentFolder) {
    backBtn.style.display = 'inline-block';
    viewTitle.style.display = 'block';
    rootContent.style.display = 'none';
    langToggle.style.display = 'none';
    fileInFolder.style.display = 'inline-block';
  } else {
    backBtn.style.display = 'none';
    viewTitle.style.display = 'block';
    rootContent.style.display = 'block';
    langToggle.style.display = 'block';
    fileInFolder.style.display = 'none';
    fileCreateInFolder.style.display = 'block';
  }
  list.style.display = 'block';

  // 헤더 보이기 (显示 Header)
  document.querySelector('header').style.display = 'flex';

  // 현재 편집 파일 정보 초기화 (初始化当前编辑文件信息)
  currentEditingFile = null;

  // 화면 갱신 (刷新画面)
  refresh();
}


// 파일 내용 저장 함수 (保存文件内容函数)
function saveFile() {
  if (!currentEditingFile) return;

  chrome.storage.local.get('wildcards', data => {
    const map = data.wildcards || {};

    // 파일명이 변경됐는지 확인 (确认文件名是否已更改)
    const newFileName = fileNameEditor.value.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
    if (!newFileName) return alert('Input File Name.');

    let newKey;
    if (currentFolder) {
      newKey = `${currentFolder}/${newFileName}`;
    } else {
      newKey = newFileName;
    }

    // 파일명이 변경됐고, 새 파일명이 이미 존재하는 경우 (文件名已更改且新文件名已存在的情况)
    if (newKey !== currentEditingFile.key && map[newKey]) {
      return alert(`File Already Exists: ${newKey}`);
    }

    // 이전 파일 삭제 (파일명이 변경된 경우) (删除旧文件 (文件名已更改的情况))
    if (newKey !== currentEditingFile.key) {
      delete map[currentEditingFile.key];
    }

    // 새 내용 저장 (保存新内容)
    map[newKey] = fileContentEditor.value;

    // 저장 후 일반 모드로 돌아가기 (保存后返回普通模式)
    chrome.storage.local.set({ wildcards: map }, exitEditMode);
  });
}


document.addEventListener('DOMContentLoaded', () => {
  // 1) 저장된 언어 불러오기(없으면 en) (1) 加载已保存语言 (如果没有则 en))
  chrome.storage.local.get(LANG_KEY, data => {
    lang = data[LANG_KEY] || 'en';
    setLang(lang);
  });

  // 2) 버튼 클릭 시 저장 + 반영 (2) 点击按钮时保存 + 反映)
  document.getElementById('btn-en').addEventListener('click', () => {
    chrome.storage.local.set({ [LANG_KEY]: 'en' }, () => setLang('en'));
    lang = 'en'; // 언어 변수 업데이트
  });
  document.getElementById('btn-jp').addEventListener('click', () => {
    chrome.storage.local.set({ [LANG_KEY]: 'jp' }, () => setLang('jp'));
    lang = 'jp'; // 언어 변수 업데이트
  });
  document.getElementById('btn-zh').addEventListener('click', () => {
    chrome.storage.local.set({ [LANG_KEY]: 'zh' }, () => setLang('zh'));
    lang = 'zh'; // 语言变量更新
  });
});

// 편집 모드 이벤트 리스너 (编辑模式事件监听器)
editorBackBtn.addEventListener('click', exitEditMode);
saveFileBtn.addEventListener('click', saveFile);

// 키보드 단축키 지원 (Ctrl+S로 저장) (键盘快捷键支持 (Ctrl+S 保存))
fileContentEditor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});


// Settings checkbox handlers
const preserveChk = document.getElementById('preservePrompt');
chrome.storage.local.get('preservePrompt', d => { preserveChk.checked = !!d.preservePrompt; });
preserveChk.addEventListener('change', () => { chrome.storage.local.set({ preservePrompt: preserveChk.checked }); });
const autoCompleteChk = document.getElementById('alternativeDanbooruAutocomplete');
chrome.storage.local.get('alternativeDanbooruAutocomplete', d => { autoCompleteChk.checked = !!d.alternativeDanbooruAutocomplete; });
autoCompleteChk.addEventListener('change', () => { chrome.storage.local.set({ alternativeDanbooruAutocomplete: autoCompleteChk.checked }); });
const tabChk = document.getElementById('triggerTab');
chrome.storage.local.get('triggerTab', d => { tabChk.checked = !!d.triggerTab; });
tabChk.addEventListener('change', () => { chrome.storage.local.set({ triggerTab: tabChk.checked }); });
const spaceChk = document.getElementById('triggerSpace');
chrome.storage.local.get('triggerSpace', d => { spaceChk.checked = !!d.triggerSpace; });
spaceChk.addEventListener('change', () => { chrome.storage.local.set({ triggerSpace: spaceChk.checked }); });
viewTitle.addEventListener('click', () => {
  if (!currentFolder) {
    const isVisible = settings.style.display !== 'none';
    settings.style.display = isVisible ? 'none' : 'block';
    chrome.storage.local.set({ [SETTINGS_VISIBLE_KEY]: !isVisible });

    // 화살표 방향 변경을 위한 클래스 토글 (为改变箭头方向切换类)
    // viewTitle.classList.toggle('collapsed', isVisible);
  }
  refresh();
});
