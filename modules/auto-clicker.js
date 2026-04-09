// auto-clicker.js
// NovelAI 自定义连点器 — 插件版（独立浮窗）
// 原作: Takoro (v2.8)，移植改编为 Chrome 插件模块
(() => {
  console.log('[AutoClicker] 模块加载中...');

  // ─── XPath / 选择器定义 ────────────────────────────────────────
  // 生成按钮（页面中有两个，一个可见一个隐藏，必须取可见那个）
  const XPATH_GENERATE = "//button[descendant::span[contains(text(),'Generate') and contains(text(),'Image')]]";

  // Seed 重置按钮（绝对路径保留作兜底）
  const XPATH_SEED_FALLBACK =
    "/html/body/div[2]/div[2]/div[3]/div[3]/div[1]/div[1]/div[5]/div/div/div/div[3]/button/span";



  // 图生图清除按钮（多路径兼容）
  const XPATH_I2I_LIST = [
    "/html/body/div[2]/div[2]/div[3]/div[3]/div/div[1]/div[3]/div[2]/div/div[2]/div/div/div[1]/div[2]/div/button[2]",
    "/html/body/div[2]/div[2]/div[3]/div[3]/div/div[1]/div[3]/div[2]/div/div[2]/div/div/div[2]/div/button[2]",
    "/html/body/div[2]/div[2]/div[3]/div[3]/div/div[1]/div[3]/div[2]/div/div[2]/div/div[1]/div[2]/div/button[2]",
    "/html/body/div[2]/div[2]/div[3]/div[3]/div/div[1]/div[3]/div[2]/div/div[2]/div/div/div[2]/div/button[2]",
  ];

  // ─── 状态变量 ─────────────────────────────────────────────────
  let loopTime     = 6000;  // 点击间隔（ms）
  let randomTime   = 1000;  // 随机偏移范围（ms）
  let interval     = null;  // 计时器 ID
  let maxLoops     = 0;     // 最大循环次数，0 表示无限
  let currentLoop  = 0;     // 当前已执行次数
  let loopCounterEl = null; // 进度显示元素的引用（由 createComponent 赋值）
  let imageCount   = 0;     // MutationObserver 监听到的实际新增图片数
  let imgCounterEl = null;  // 实际图片计数显示元素
  let clickMode = 'fixed';
  let runToken = 0;
  const ON_IMAGE_TIMEOUT_MS = 25000;

  let startBtnEl = null;
  let modeBtnEl = null;
  let intervalInputEl = null;
  let randomInputEl = null;
  let timeStrEl = null; // 生成耗时显示元素
  let lastGenerateTime = 0; // 记录上次点击生成的时间戳
  let spanTimingTextEl = null; // 折叠态耗时文本

  let autoClickerI18n = {
    fixedShort: 'Fixed',
    onImageShort: 'On Img',
    fixedTitle: 'Fixed Interval',
    onImageTitle: 'On Image'
  };

  const imageWaiters = new Set();

  /**
   * 判断 img 是否为 NAI 实际生成的图片（排除小图标、SVG、预览图等）
   * NAI 生成图为 blob URL 或特定 CDN，尺寸较大
   */
  function isNaiGeneratedImg(img) {
    const src = img.src || '';
    if (!src || src.includes('.svg') || src.startsWith('data:image/svg')) return false;
    if (img.naturalWidth < 100 || img.naturalHeight < 100) return false;
    // blob URL 是 NAI 生成图的典型特征
    if (src.startsWith('blob:')) return true;
    // 兜底：包含 novelai CDN 域名的图片
    if (src.includes('novelai') && !src.includes('static.novelai')) return true;
    return false;
  }

  /**
   * 启动全局图库 MutationObserver，监听新增的生成图片
   * 每发现一张新图就更新 imgCounterEl 显示
   */
  function startImageObserver() {
    // 用 Set 记录已统计的 blob URL，防止同一张图被重复计入
    const seenUrls = new Set();
    
    // 初始化：立即将当前页面已存在的生成的图片（尤其是刷新后加载的首屏历史图片）加入黑名单，防止误算
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || '';
      if (src && isNaiGeneratedImg(img)) {
        seenUrls.add(src);
      }
    });

    // --- 历史记录交互屏蔽机制 ---
    // 为了防止当图库数量超过30张时引发的“虚拟列表动态渲染导致旧图被当作全新图片”的 bug，
    // 我们设定：在用户主动触发历史区滚轮或点击等操作后的 1000ms 内，所有新出现的图均当作历史图。
    let historyMaskTimeout = null;
    function maskHistory() {
      clearTimeout(historyMaskTimeout);
      historyMaskTimeout = setTimeout(() => { historyMaskTimeout = null; }, 200);
    }

    // 监听历史记录操作：点击右侧、在右侧滚动、或键盘方向键切换
    document.addEventListener('mousedown', (e) => {
      // 目标是具体的历史缩略图，或者发生在屏幕右侧 25% 区域内的点击
      if (e.target.closest('[aria-label="choose image"]') || e.clientX > window.innerWidth * 0.75) {
        maskHistory();
      }
    }, { capture: true }); // 用 capture 提前捕获

    document.addEventListener('wheel', (e) => {
      if (e.clientX > window.innerWidth * 0.75) {
        maskHistory();
      }
    }, { passive: true, capture: true });

    document.addEventListener('keydown', (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (!isInput && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        maskHistory();
      }
    }, { capture: true });

    function checkImg(img) {
      const src = img.src || '';
      if (!src || seenUrls.has(src)) return;
      if (isNaiGeneratedImg(img)) {
        seenUrls.add(src); // 无论如何先加入拉黑名单
        
        if (historyMaskTimeout !== null) {
          // 处在历史操作屏蔽期内，仅拉黑而不计入真实生成数
          console.log('[AutoClicker] （历史屏蔽期）加载旧图，不计数:', src.substring(0, 50));
          return;
        }

        imageCount++;
        if (imgCounterEl) imgCounterEl.textContent = `📷 ${imageCount}`;
        window.postMessage({
          type: '__NAI_IMAGE_GENERATED__',
          imageCount,
          src
        }, '*');
        
        // 统一处理耗时显示：不论是连点器自动触发还是手动触发
        if (lastGenerateTime > 0) {
          const waitTimeSec = ((performance.now() - lastGenerateTime) / 1000).toFixed(1);
          if (timeStrEl) timeStrEl.textContent = `⏱ ${waitTimeSec}s`;
          lastGenerateTime = 0; // 结算完毕，清空防重
        }

        notifyImageWaiters();
        console.log('[AutoClicker] 检测到新生成图片:', src.substring(0, 60));
      }
    }

    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          // 新元素被插入 DOM
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IMG') {
              if (node.complete) checkImg(node);
              else node.addEventListener('load', () => checkImg(node), { once: true });
            }
            if (node.querySelectorAll) {
              for (const img of node.querySelectorAll('img')) {
                if (img.complete) checkImg(img);
                else img.addEventListener('load', () => checkImg(img), { once: true });
              }
            }
          }
        } else if (m.type === 'attributes' && m.target.tagName === 'IMG') {
          // 已有 img 元素的 src 属性被更新（NovelAI 复用 img 元素的典型方式）
          const img = m.target;
          if (img.complete) checkImg(img);
          else img.addEventListener('load', () => checkImg(img), { once: true });
        }
      }
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],  // 只监听 src 属性变化，减少无关触发
    });
    console.log('[AutoClicker] 图库监听已启动（childList + src 属性变化）');
  }

  /** 更新进度显示文字（模块级，供 runAutoClicker 和 createComponent 共同使用） */
  function updateLoopCounter() {
    if (!loopCounterEl) return;
    if (maxLoops > 0) {
      loopCounterEl.textContent = `${currentLoop}/${maxLoops}`;
    } else {
      // 无限模式：对于极简面板，可以显示更好看的样式
      loopCounterEl.textContent = `${currentLoop}/∞`;
    }
  }

  function updateTimingText() {
    if (!spanTimingTextEl) return;
    const baseS = loopTime / 1000;
    const randS = randomTime / 1000;
    if (clickMode === 'fixed') {
      spanTimingTextEl.textContent = `${baseS}s ±${randS}s`;
    } else {
      spanTimingTextEl.textContent = `+${randS}s`;
    }
  }

  function applyModeI18n() {
    if (!modeBtnEl) return;
    modeBtnEl.dataset.mode = clickMode; // 记录状态供 hover 反馈使用
    if (clickMode === 'fixed') {
      modeBtnEl.textContent = autoClickerI18n.fixedShort || 'Fixed';
      modeBtnEl.title = autoClickerI18n.fixedTitle || 'Fixed Interval';
      modeBtnEl.style.color = 'rgb(120, 160, 255)'; // 亮蓝文字
      modeBtnEl.style.borderColor = 'rgb(100, 150, 255)'; // 亮蓝边框
      modeBtnEl.style.backgroundColor = 'transparent'; // 无底色 (幽灵按钮)
      modeBtnEl.style.boxShadow = '0 0 5px rgba(100, 150, 255, 0.25)'; // 微蓝发光
    } else {
      modeBtnEl.textContent = autoClickerI18n.onImageShort || 'On Img';
      modeBtnEl.title = autoClickerI18n.onImageTitle || 'On Image';
      modeBtnEl.style.color = 'rgb(255, 100, 150)'; // 亮粉文字
      modeBtnEl.style.borderColor = 'rgb(255, 100, 150)'; // 亮粉边框
      modeBtnEl.style.backgroundColor = 'transparent'; // 无底色 (幽灵按钮)
      modeBtnEl.style.boxShadow = '0 0 5px rgba(255, 100, 150, 0.25)'; // 微红发光
    }
  }

  function updateModeUI() {
    applyModeI18n();
    updateTimingText();
    if (intervalInputEl) {
      intervalInputEl.style.display = (clickMode === 'fixed') ? 'block' : 'none';
    }
    if (randomInputEl) {
      const randS = randomTime / 1000;
      randomInputEl.placeholder = (clickMode === 'fixed') ? `± ${randS}s` : `+ ${randS}s`;
    }
    if (startBtnEl) {
      startBtnEl.dataset.mode = clickMode;
    }
  }

  function setClickMode(mode) {
    clickMode = (mode === 'on-image') ? 'on-image' : 'fixed';
    updateModeUI();
  }

  function cancelPendingWaits() {
    if (imageWaiters.size === 0) return;
    for (const waiter of imageWaiters) {
      if (waiter.done) continue;
      waiter.done = true;
      clearTimeout(waiter.timeoutId);
      waiter.resolve(false);
    }
    imageWaiters.clear();
  }

  function notifyImageWaiters() {
    if (imageWaiters.size === 0) return;
    for (const waiter of imageWaiters) {
      if (waiter.done) continue;
      if (waiter.token !== runToken) {
        waiter.done = true;
        clearTimeout(waiter.timeoutId);
        waiter.resolve(false);
        imageWaiters.delete(waiter);
        continue;
      }
      if (imageCount > waiter.prevCount) {
        waiter.done = true;
        clearTimeout(waiter.timeoutId);
        waiter.resolve(true);
        imageWaiters.delete(waiter);
      }
    }
  }

  function waitForNewImage(prevCount, timeoutMs, token) {
    return new Promise(resolve => {
      const waiter = { prevCount, token, resolve, timeoutId: null, done: false };
      waiter.timeoutId = setTimeout(() => {
        if (waiter.done) return;
        waiter.done = true;
        imageWaiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
      imageWaiters.add(waiter);

      if (imageCount > prevCount) {
        clearTimeout(waiter.timeoutId);
        imageWaiters.delete(waiter);
        resolve(true);
      }
    });
  }

  function scheduleNext(delayMs, token) {
    if (interval) clearTimeout(interval);
    interval = setTimeout(() => {
      if (isRunning && token === runToken) runAutoClicker();
    }, delayMs);
  }

  function stopAutoClicker(reason) {
    if (!isRunning) return;
    isRunning = false;
    runToken += 1;
    ignoreAnlasWarning = false;
    if (interval) clearTimeout(interval);
    interval = null;
    cancelPendingWaits();
    if (startBtnEl) startBtnEl.textContent = '▶';
    if (reason) console.log('[AutoClicker] stopped:', reason);
  }

  // ─── 工具函数 ─────────────────────────────────────────────────

  /** 判断元素是否可见（有实际尺寸） */
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 通过 XPath 查找所有匹配节点，返回第一个可见的。
   * 解决 NovelAI 页面中同一按钮存在可见/隐藏两个副本的问题。
   */
  function xpathVisibleNode(xpath) {
    try {
      const result = document.evaluate(
        xpath, document, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (isVisible(node)) return node;
      }
    } catch(e) {
      console.warn('[AutoClicker] XPath 错误:', xpath, e);
    }
    return null;
  }

  /** 通过 XPath 获取单个节点（不过滤可见性，用于非关键元素） */
  function xpathNode(xpath) {
    try {
      return document.evaluate(
        xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue;
    } catch(e) {
      return null;
    }
  }

  /**
   * 查找生成按钮（只返回可见的那个）。
   * NovelAI 页面中生成按钮有两个副本，必须取可见的。
   */
  function findGenerateButton() {
    return xpathVisibleNode(XPATH_GENERATE);
  }

  /**
   * 查找 Seed 随机化按钮。
   * 优先用稳健的相对查找，绝对路径兜底。
   */
  function findSeedButton() {
    // 方法1: 最可靠 —— Seed span 的直接兄弟 button
    // 浏览器检查确认: <span>Seed</span><button>N/A</button> 同在一个容器内
    const bySpan = xpathNode("//span[normalize-space(text())='Seed']/following-sibling::button");
    if (bySpan) return bySpan;

    // 方法2: div 标签（兼容旧页面）
    const byDiv = xpathNode("//div[normalize-space(text())='Seed' or normalize-space(text())='种子']/following-sibling::button");
    if (byDiv) return byDiv;

    // 方法3: aria-label / title 属性匹配
    const attrBtn =
      document.querySelector('button[aria-label*="andom"], button[title*="andom"]') ||
      document.querySelector('button[aria-label*="seed" i], button[title*="seed" i]');
    if (attrBtn) return attrBtn;

    // 方法4: 绝对路径屏底，原路径局向 span，取其父 button
    const fallback = xpathNode(XPATH_SEED_FALLBACK);
    return fallback instanceof HTMLButtonElement ? fallback : fallback?.closest('button') || null;
  }


  /** 触发元素点击 */
  function triggerClick(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  /** 重置 Seed */
  function resetSeed() {
    const btn = findSeedButton();
    if (btn) {
      console.log('[AutoClicker] 找到 Seed 按钮:', btn.outerHTML.substring(0, 80));
      triggerClick(btn);
      console.log('[AutoClicker] Seed 已重置');
    } else {
      console.warn('[AutoClicker] 未找到 Seed 随机化按钮，已尝试全部查找方式');
    }
  }

  /**
   * 从生成按钮内部相对查找 Anlas 消耗数值。
   * Anlas 数字 <span> 就在按钮内部，用相对查找比绝对 XPath 稳定得多。
   * @returns {number} 消耗的 Anlas 数量，0 = 免费
   */
  function getAnlasCost() {
    // 必须用 findGenerateButton() 确保拿到可见按钮
    const btn = findGenerateButton();
    if (!btn) return 0;

    // 在可见按钮内所有 <span> 里找第一个纯数字内容（即 Anlas 消耗）
    const spans = btn.querySelectorAll('span');
    for (const s of spans) {
      const txt = (s.innerText || s.textContent || '').trim();
      if (/^\d+$/.test(txt)) {
        const cost = parseInt(txt, 10);
        console.log('[AutoClicker] 检测到 Anlas 消耗:', cost);
        return cost;
      }
    }
    return 0;
  }

  // 我们使用一个布尔标志来控制连点器状态，替代原来的 interval ID
  let isRunning = false;
  // 控制在一次 Start 周期内，确认过 Anlas 消耗后不再重复弹窗
  let ignoreAnlasWarning = false;

  /**
   * 自定义页面内 Anlas 确认对话框（替代会被 Chrome 静默拦截的 confirm()）
   * @param {number} cost - Anlas 消耗数量
   * @returns {Promise<boolean>}
   */
  function showAnlasDialog(cost) {
    return new Promise(resolve => {
      // 防止重复创建
      if (document.getElementById('nai-anlas-dialog')) {
        document.getElementById('nai-anlas-dialog').remove();
      }

      const BG    = 'rgb(34, 37, 63)';
      const FG    = 'rgb(245, 243, 194)';
      const BORDER = `0.5px solid ${FG}`;

      // 遮罩层
      const overlay = document.createElement('div');
      overlay.id = 'nai-anlas-dialog';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0',
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: '99999',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });

      // 对话框主体
      const box = document.createElement('div');
      Object.assign(box.style, {
        backgroundColor: BG,
        border: BORDER,
        borderRadius: '6px',
        padding: '20px 28px',
        color: FG,
        fontFamily: 'Source Sans Pro, sans-serif',
        fontSize: '14px',
        maxWidth: '320px',
        textAlign: 'center',
        lineHeight: '1.6',
      });

      box.innerHTML = `
        <div style="font-size:22px;margin-bottom:10px">⚠️</div>
        <div>此次生成将消耗 <strong style="color:#f5c842;font-size:16px">${cost}</strong> Anlas</div>
        <div style="margin-top:4px;opacity:0.7;font-size:12px">启动自动连点器会持续消耗点数</div>
      `;

      // 按钮容器
      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, {
        display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px',
      });

      const btnOk = document.createElement('button');
      btnOk.textContent = '确认继续';
      Object.assign(btnOk.style, {
        padding: '6px 18px', backgroundColor: 'rgb(80,100,170)',
        color: FG, border: BORDER, borderRadius: '4px',
        cursor: 'pointer', fontSize: '13px',
      });

      const btnCancel = document.createElement('button');
      btnCancel.textContent = '取消';
      Object.assign(btnCancel.style, {
        padding: '6px 18px', backgroundColor: BG,
        color: FG, border: BORDER, borderRadius: '4px',
        cursor: 'pointer', fontSize: '13px',
      });

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      btnOk.addEventListener('click',     () => close(true));
      btnCancel.addEventListener('click', () => close(false));
      // 点击遮罩层关闭 = 取消
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });

      btnRow.appendChild(btnOk);
      btnRow.appendChild(btnCancel);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  /**
   * 检查是否需要消耗 Anlas。异步函数，使用自定义对话框而非 confirm()。
   * @returns {Promise<boolean>}
   */
  async function checkAnlas() {
    if (ignoreAnlasWarning) return true;
    // 注意: 不在这里检查 isRunning，因为 ↺ 按钮是手动按钮，需要在连点器未启动时也能正常工作

    const cost = getAnlasCost();
    if (cost > 0) {
      console.log('[AutoClicker] Anlas 防呉：弹出自定义对话框');
      const ok = await showAnlasDialog(cost);

      // 如果用户点了 Pause（Pause 处理器会触发弹窗的 Cancel 按钮），ok 此时已经是 false
      // 不再需要额外的 isRunning 检查，直接根据 ok 值决定
      if (ok) {
        ignoreAnlasWarning = true; // 用户同意后，本次连点周期不再提示
      }
      return ok;
    }
    return true;
  }

  /** 返回 [min, max] 范围内的随机整数 */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ─── 核心点击逻辑 ─────────────────────────────────────────────

  async function runAutoClicker() {
    if (!isRunning) return;
    const token = runToken;

    if (maxLoops > 0 && currentLoop >= maxLoops) {
      console.log(`[AutoClicker] Completed ${maxLoops} loops, stopping`);
      stopAutoClicker('completed');
      updateLoopCounter();
      return;
    }

    const ok = await checkAnlas();
    if (!ok || token !== runToken) {
      if (!ok) console.log('[AutoClicker] Anlas cancelled, stop');
      stopAutoClicker('anlas-cancel');
      return;
    }

    const target = findGenerateButton();
    if (target) {
      lastGenerateTime = performance.now(); // 记录起步时间
      triggerClick(target);
    } else {
      console.error('[AutoClicker] Visible Generate button not found');
    }

    currentLoop++;
    updateLoopCounter();
    console.log(`[AutoClicker] Ran ${currentLoop}/${maxLoops > 0 ? maxLoops : 'inf'}`);

    setTimeout(resetSeed, 500);

    if (!isRunning || token !== runToken) return;

    if (clickMode === 'fixed') {
      const offset  = randInt(0, randomTime);
      const tmpTime = Math.random() < 0.5 ? loopTime + offset : loopTime - offset;
      console.log('[AutoClicker] Next fixed interval (s):', tmpTime / 1000);
      scheduleNext(tmpTime, token);
      return;
    }

    const prevCount = imageCount;
    let gotImage = await waitForNewImage(prevCount, ON_IMAGE_TIMEOUT_MS, token);
    if (!isRunning || token !== runToken) return;
    if (!gotImage) {
      console.warn('[AutoClicker] On-image timeout, retrying once');
      gotImage = await waitForNewImage(prevCount, ON_IMAGE_TIMEOUT_MS, token);
      if (!isRunning || token !== runToken) return;
      if (!gotImage) {
        console.warn('[AutoClicker] On-image timeout twice, stopping');
        stopAutoClicker('image-timeout');
        return;
      }
    }
    
    // （耗时计算已移至 startImageObserver 的 checkImg 函数中进行全局处理）

    const baseDelay = Math.abs(randomTime);
    const jitter = randInt(0, baseDelay);
    const delay = baseDelay + jitter;
    console.log('[AutoClicker] Image detected, next delay (s):', delay / 1000);
    scheduleNext(delay, token);
  }

  // ─── UI 创建 ──────────────────────────────────────────────────

  function createComponent() {
    if (document.getElementById('nai-auto-clicker')) return;

    const BG    = 'rgb(34, 37, 63)';
    const FG    = 'rgb(245, 243, 194)';
    const BORDER = `0.1px solid ${FG}`;

    // ── 注入全局 CSS（用于展开/收起过渡） ──
    const styleId = 'nai-auto-clicker-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #nai-auto-clicker {
          transition: background-color 0.3s, border-color 0.3s;
          padding: 0 6px !important;
          border-radius: 4px !important; /* 原生面板的小圆角 */
          border: 1px solid rgba(245, 243, 194, 0.2) !important;
          background-color: rgba(34, 37, 63, 0.75) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          backdrop-filter: blur(4px);
          cursor: grab;
          height: 38px !important;
          display: flex;
          align-items: center;
        }
        #nai-auto-clicker:active {
          cursor: grabbing;
        }
        #nai-auto-clicker button[data-mode="fixed"] {
          border-color: rgba(100, 150, 255, 0.6) !important;
          box-shadow: 0 0 6px rgba(100, 150, 255, 0.3) !important;
        }
        #nai-auto-clicker button[data-mode="on-image"] {
          border-color: rgba(255, 100, 150, 0.6) !important;
          box-shadow: 0 0 6px rgba(255, 100, 150, 0.3) !important;
        }
        #nai-auto-clicker.expanded {
          background-color: rgba(34, 37, 63, 0.95) !important;
          border-color: rgba(245, 243, 194, 0.6) !important;
        }
        #nai-auto-clicker input, #nai-auto-clicker button {
          cursor: pointer;
        }
        
        .nai-ac-expanded { 
          opacity: 1; 
          max-width: 80px; 
          margin-left: 6px;
          transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
          overflow: hidden;
          white-space: nowrap;
        }
        #nai-auto-clicker:not(.expanded) .nai-ac-expanded { 
          opacity: 0; 
          max-width: 0 !important; 
          margin-left: 0 !important; 
          padding-left: 0 !important; 
          padding-right: 0 !important; 
          border-width: 0 !important; 
          pointer-events: none !important; 
        }
        .nai-ac-collapsed {
          transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
          white-space: nowrap;
          overflow: hidden;
          max-width: 120px;
        }
        #nai-auto-clicker.expanded .nai-ac-collapsed {
          opacity: 0;
          max-width: 0 !important;
          margin-left: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          border-width: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }

    function styleBtn(el, extraStyles = {}) {
      Object.assign(el.style, {
        height: '32px', backgroundColor: BG, color: FG, border: BORDER, borderRadius: '3px',
        fontFamily: 'Source Sans Pro', fontSize: '15px', userSelect: 'none', ...extraStyles
      });
    }
    function styleInput(el, extraStyles = {}) {
      Object.assign(el.style, {
        height: '32px', backgroundColor: BG, color: FG, border: BORDER, borderRadius: '3px',
        fontSize: '13px', userSelect: 'none', ...extraStyles
      });
    }

    const container = document.createElement('div');
    container.id = 'nai-auto-clicker';
    Object.assign(container.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      userSelect: 'none', zIndex: '9999'
    });
    document.body.appendChild(container);

    // 1. 启停按钮 (Always，从 Hover 区域剥离)
    const btnStart = document.createElement('button');
    btnStart.textContent = isRunning ? '⏸' : '▶';
    btnStart.title = 'Start / Pause Auto Clicker';
    styleBtn(btnStart, { padding: '0', width: '32px', transition: 'all 0.3s ease' }); 
    container.appendChild(btnStart);
    startBtnEl = btnStart;

    // ── 创建中部动态区域容器 (限制 Hover 触发范围) ──
    const middleWrapper = document.createElement('div');
    Object.assign(middleWrapper.style, {
      display: 'flex', alignItems: 'center'
    });
    container.appendChild(middleWrapper);

    // ── 仅中部悬停展开逻辑 ──
    let collapseTimeout;
    middleWrapper.addEventListener('mouseenter', () => {
      clearTimeout(collapseTimeout);
      container.classList.add('expanded');
    });
    middleWrapper.addEventListener('mouseleave', () => {
      clearTimeout(collapseTimeout);
      collapseTimeout = setTimeout(() => {
        const active = document.activeElement;
        // 如果输入框还在焦点状态，不收起
        if (active && active.tagName === 'INPUT' && middleWrapper.contains(active)) return;
        container.classList.remove('expanded');
      }, 600);
    });
    
    // 模糊焦点时需基于 middleWrapper 状态判断
    function bindCollapseCheck(inp) {
      inp.addEventListener('blur', () => {
        clearTimeout(collapseTimeout);
        collapseTimeout = setTimeout(() => {
          if (!middleWrapper.matches(':hover')) container.classList.remove('expanded');
        }, 600);
      });
    }

    // ── 中部子元素按顺序添加 ──

    // 2. 模式切换 (Expanded)
    const btnMode = document.createElement('button');
    btnMode.className = 'nai-ac-expanded';
    btnMode.title = '切换 固定时间/看图生成 模式';
    styleBtn(btnMode, { paddingLeft: '8px', paddingRight: '8px', borderRadius: '4px', fontWeight: 'bold' });
    btnMode.addEventListener('mouseenter', () => {
      btnMode.style.backgroundColor = btnMode.dataset.mode === 'fixed' ? 'rgba(100, 150, 255, 0.15)' : 'rgba(255, 100, 150, 0.15)';
    });
    btnMode.addEventListener('mouseleave', () => { btnMode.style.backgroundColor = BG; });
    middleWrapper.appendChild(btnMode);
    modeBtnEl = btnMode;

    // 3. 进度文本 (Always)
    const spanLoopCounter = document.createElement('span');
    Object.assign(spanLoopCounter.style, {
      color: FG, fontSize: '12px', fontFamily: 'Source Sans Pro, monospace',
      minWidth: '32px', height: '32px', lineHeight: '32px', textAlign: 'center', marginLeft: '6px',
      padding: '0 5px', border: BORDER, borderRadius: '3px', backgroundColor: BG, boxSizing: 'border-box'
    });
    spanLoopCounter.textContent = '0/∞';
    middleWrapper.appendChild(spanLoopCounter);
    loopCounterEl = spanLoopCounter;

    // 4. 输入框：Max Loops (Expanded)
    const inputLoops = document.createElement('input');
    inputLoops.type = 'number';
    inputLoops.min  = '1';
    inputLoops.placeholder = '循环';
    inputLoops.title = '需要连点的总次数，清空为无限';
    inputLoops.className = 'nai-ac-expanded';
    styleInput(inputLoops, { width: '48px', padding: '0 4px', textAlign: 'center' });
    bindCollapseCheck(inputLoops);
    middleWrapper.appendChild(inputLoops);

    // 5. 刷新重绘 (Expanded)
    const btnCustom = document.createElement('button');
    btnCustom.textContent = '↺';
    btnCustom.title = '清除图生图/重绘后生成一次，同时重置 Seed';
    btnCustom.className = 'nai-ac-expanded';
    styleBtn(btnCustom, { width: '32px', padding: '0' });
    middleWrapper.appendChild(btnCustom);

    // 6. 耗时参数折叠展示文本 (Collapsed)
    const spanTimingText = document.createElement('span');
    spanTimingText.className = 'nai-ac-collapsed';
    Object.assign(spanTimingText.style, {
      color: FG, fontSize: '12px', fontFamily: 'Source Sans Pro, monospace', textAlign: 'center',
      marginLeft: '6px', height: '32px', lineHeight: '32px', padding: '0 5px', 
      border: BORDER, borderRadius: '3px', backgroundColor: BG, boxSizing: 'border-box'
    });
    spanTimingText.textContent = '6s ±1s';
    middleWrapper.appendChild(spanTimingText);
    spanTimingTextEl = spanTimingText;

    // 7. 输入框：Interval (Expanded)
    const inputInterval = document.createElement('input');
    inputInterval.type = 'number';
    inputInterval.min  = '1';
    inputInterval.placeholder = `间隔: ${loopTime / 1000}s`;
    inputInterval.className = 'nai-ac-expanded';
    styleInput(inputInterval, { width: '60px', padding: '0 4px' });
    bindCollapseCheck(inputInterval);
    middleWrapper.appendChild(inputInterval);
    intervalInputEl = inputInterval;

    // 8. 输入框：Random (Expanded)
    const inputRandom = document.createElement('input');
    inputRandom.type = 'number';
    inputRandom.min  = '0';
    inputRandom.className = 'nai-ac-expanded';
    styleInput(inputRandom, { width: '44px', padding: '0 4px' });
    bindCollapseCheck(inputRandom);
    middleWrapper.appendChild(inputRandom);
    randomInputEl = inputRandom;

    // 9. 右侧动态双层：图像计数与测速悬浮 (Always)
    const counterWrapper = document.createElement('div');
    Object.assign(counterWrapper.style, {
      position: 'relative', display: 'flex', alignItems: 'center', height: '34px', marginLeft: '6px'
    });
    container.appendChild(counterWrapper);

    const spanImgCounter = document.createElement('span');
    Object.assign(spanImgCounter.style, {
      color: FG, fontSize: '12px', fontFamily: 'Source Sans Pro, monospace',
      minWidth: '50px', height: '32px', lineHeight: '32px', textAlign: 'center',
      padding: '0 5px', border: BORDER, borderRadius: '3px', backgroundColor: BG, boxSizing: 'border-box'
    });
    spanImgCounter.textContent = '📷 0';
    spanImgCounter.title = '实际生成图片数';
    counterWrapper.appendChild(spanImgCounter);
    imgCounterEl = spanImgCounter;

    const spanTimeCounter = document.createElement('span');
    Object.assign(spanTimeCounter.style, {
      position: 'absolute', bottom: '34px', left: '50%', transform: 'translateX(-50%)',
      color: FG, fontSize: '11px', fontFamily: 'Source Sans Pro, monospace',
      minWidth: '40px', height: '18px', lineHeight: '18px', textAlign: 'center',
      padding: '0 4px', border: BORDER, borderRadius: '3px', backgroundColor: BG,
      boxSizing: 'border-box', whiteSpace: 'nowrap', opacity: '0.85', pointerEvents: 'none',
    });
    spanTimeCounter.textContent = '⏱ --s';
    counterWrapper.appendChild(spanTimeCounter);
    timeStrEl = spanTimeCounter;

    // ─── 事件绑定 ───────────────────────────────────
    btnMode.addEventListener('click', () => setClickMode(clickMode === 'fixed' ? 'on-image' : 'fixed'));

    btnStart.addEventListener('click', async () => {
      if (isRunning) {
        stopAutoClicker('pause');
        const dialog = document.getElementById('nai-anlas-dialog');
        if (dialog) {
          const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.includes('取消'));
          if (cancelBtn) cancelBtn.click(); else dialog.remove();
        }
      } else {
        runToken += 1;
        if (interval) clearTimeout(interval);
        interval = null;
        cancelPendingWaits();
        currentLoop = 0; imageCount = 0; lastGenerateTime = 0;
        if (imgCounterEl) imgCounterEl.textContent = '📷 0';
        if (timeStrEl) timeStrEl.textContent = '⏱ --s';
        const v = parseInt(inputLoops.value, 10);
        maxLoops = (!isNaN(v) && v > 0) ? v : 0;
        updateLoopCounter();

        console.log(`[AutoClicker] Starting, target loops: ${maxLoops > 0 ? maxLoops : 'inf'}`);
        isRunning = true; ignoreAnlasWarning = false;
        btnStart.textContent = '⏸';
        runAutoClicker();
      }
    });

    inputLoops.addEventListener('change', () => {
      const v = parseInt(inputLoops.value, 10);
      maxLoops = (!isNaN(v) && v > 0) ? v : 0;
      updateLoopCounter();
    });

    btnCustom.addEventListener('click', async () => {
      if (!(await checkAnlas())) return;
      XPATH_I2I_LIST.forEach(xpath => { const el = xpathNode(xpath); if (el) triggerClick(el); });
      setTimeout(() => triggerClick(findGenerateButton()), 600);
      setTimeout(() => resetSeed(), 1000);
    });

    inputInterval.addEventListener('change', () => {
      const v = parseFloat(inputInterval.value);
      if (!isNaN(v) && v > 0) {
        loopTime = Math.round(v * 1000);
        inputInterval.placeholder = `间隔: ${v}s`;
        updateTimingText();
      }
      inputInterval.value = '';
    });

    inputRandom.addEventListener('change', () => {
      const v = parseFloat(inputRandom.value);
      if (!isNaN(v) && v >= 0) {
        randomTime = Math.round(v * 1000);
        updateModeUI();
      }
      inputRandom.value = '';
    });

    // 根据输入内容动态调整宽度
    inputLoops.addEventListener('input', () => {
      const len = inputLoops.value.length;
      inputLoops.style.width = len > 0 ? `${len * 9 + 10}px` : '48px';
    });

    // ─── 全局拖拽逻辑（直接做在 container 上） ─────────────────
    let isDragging = false, initX, initY, startLeft, startTop;
    container.addEventListener('mousedown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      isDragging = true;
      if (container.style.transform) {
        const rect = container.getBoundingClientRect();
        container.style.left      = rect.left + 'px';
        container.style.top       = rect.top  + 'px';
        container.style.bottom    = 'auto';
        container.style.transform = '';
      }
      initX = e.clientX; initY = e.clientY;
      startLeft = parseInt(container.style.left, 10) || 0;
      startTop  = parseInt(container.style.top,  10) || 0;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - initX, dy = e.clientY - initY;
      const maxLeft = window.innerWidth  - container.offsetWidth;
      const maxTop  = window.innerHeight - container.offsetHeight;
      container.style.left = Math.max(0, Math.min(startLeft + dx, maxLeft)) + 'px';
      container.style.top  = Math.max(0, Math.min(startTop  + dy, maxTop )) + 'px';
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    /** 确保浮窗在窗口边界内 */
    function ensureInBounds() {
      if (container.style.transform) return;
      const maxLeft = window.innerWidth  - container.offsetWidth;
      const maxTop  = window.innerHeight - container.offsetHeight;
      const left    = parseInt(container.style.left, 10) || 0;
      const top     = parseInt(container.style.top,  10) || 0;
      container.style.left = Math.max(0, Math.min(left, maxLeft)) + 'px';
      container.style.top  = Math.max(0, Math.min(top,  maxTop )) + 'px';
    }
    window.addEventListener('resize', ensureInBounds);

    startImageObserver();
    console.log('[AutoClicker] 浮窗已完善为悬停胶囊设计');
    
    // 初始化同步状态
    updateModeUI();
    updateLoopCounter();
  }

  // ─── 等待生成按钮出现后初始化 ────────────────────────────────

  /** 控制工具栏显示/隐藏 */
  function updateVisibility(hidden) {
    const container = document.getElementById('nai-auto-clicker');
    if (container) {
      container.style.display = hidden ? 'none' : 'flex';
      console.log(`[AutoClicker] 工具栏已${hidden ? '隐藏' : '显示'}`);
    }
  }

  let latestHideAutoClicker = false;

  // 监听来自 bridge.js 的配置信息
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const { type, hideAutoClicker, autoClickerI18n: i18n } = e.data || {};
    if (type === '__WILDCARD_INIT__' || type === '__WILDCARD_UPDATE__') {
      if (typeof hideAutoClicker !== 'undefined') {
        latestHideAutoClicker = hideAutoClicker;
        updateVisibility(hideAutoClicker);
      }
      if (i18n && typeof i18n === 'object') {
        autoClickerI18n = { ...autoClickerI18n, ...i18n };
        applyModeI18n();
      }
    }

    // 快捷键触发生成图像（来自 bridge.js 的转发）
    if (type === '__TRIGGER_GENERATE__') {
      const btn = findGenerateButton();
      if (btn) {
        lastGenerateTime = performance.now(); // 记录快捷键触发耗时起点
        triggerClick(btn);
        console.log('[AutoClicker] 快捷键触发生成图像');
      } else {
        console.warn('[AutoClicker] 快捷键触发失败：未找到可见的 Generate 按钮');
      }
    }
  });

  // ─── 全局监听器：捕获手动生成，以便记录耗时 ────────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (btn) {
      const txt = btn.textContent || '';
      if (txt.includes('Generate') && txt.includes('Image')) {
        lastGenerateTime = performance.now();
      }
    }
  }, { capture: true }); // 使用 capture 保证在被其它逻辑阻止冒泡前拿到记录

  document.addEventListener('keydown', e => {
    // 捕捉 NAI 原生的 Ctrl+Enter 或 Meta+Enter 快捷键
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      lastGenerateTime = performance.now();
    }
  }, { capture: true });

  const initTimer = setInterval(() => {
    const btn = xpathNode(XPATH_GENERATE);
    if (btn) {
      clearInterval(initTimer);
      console.log('[AutoClicker] 检测到生成按钮，初始化浮窗');
      createComponent();
      
      // 关键修复：组件创建后立即同步一次最新状态
      // 避免 __WILDCARD_INIT__ 消息在组件创建前到达导致失效
      updateVisibility(latestHideAutoClicker);
    } else {
      console.log('[AutoClicker] 等待生成按钮...');
    }
  }, 3000);

})();
