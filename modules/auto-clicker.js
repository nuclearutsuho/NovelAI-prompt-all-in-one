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
      // 无限模式：直接显示已执行次数
      loopCounterEl.textContent = String(currentLoop);
    }
  }

  function applyModeI18n() {
    if (!modeBtnEl) return;
    if (clickMode === 'fixed') {
      modeBtnEl.textContent = autoClickerI18n.fixedShort || 'Fixed';
      modeBtnEl.title = autoClickerI18n.fixedTitle || 'Fixed Interval';
    } else {
      modeBtnEl.textContent = autoClickerI18n.onImageShort || 'On Img';
      modeBtnEl.title = autoClickerI18n.onImageTitle || 'On Image';
    }
  }

  function updateModeUI() {
    applyModeI18n();
    if (intervalInputEl) {
      intervalInputEl.style.display = (clickMode === 'fixed') ? 'block' : 'none';
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
    if (startBtnEl) startBtnEl.textContent = 'Start';
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

    const baseDelay = Math.abs(randomTime);
    const jitter = randInt(0, baseDelay);
    const delay = baseDelay + jitter;
    console.log('[AutoClicker] Image detected, next delay (s):', delay / 1000);
    scheduleNext(delay, token);
  }

  // ─── UI 创建 ──────────────────────────────────────────────────

  function createComponent() {
    // 防止重复创建
    if (document.getElementById('nai-auto-clicker')) return;

    // 颜色主题（与 NovelAI 深色界面一致）
    const BG    = 'rgb(34, 37, 63)';
    const FG    = 'rgb(245, 243, 194)';
    const BORDER = `0.1px solid ${FG}`;

    /** 通用按钮样式 */
    function styleBtn(el, extraStyles = {}) {
      Object.assign(el.style, {
        height: '34px',
        backgroundColor: BG,
        color: FG,
        border: BORDER,
        borderRadius: '3px',
        fontFamily: 'Source Sans Pro',
        fontSize: '15px',
        userSelect: 'none',
        cursor: 'pointer',
        ...extraStyles
      });
    }

    /** 通用输入框样式 */
    function styleInput(el, extraStyles = {}) {
      Object.assign(el.style, {
        height: '34px',
        backgroundColor: BG,
        color: FG,
        border: BORDER,
        borderRadius: '3px',
        fontSize: '13px',
        userSelect: 'none',
        ...extraStyles
      });
    }

    // ── 容器 ──
    const container = document.createElement('div');
    container.id = 'nai-auto-clicker';
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '90px',
      left: '50%',
      transform: 'translateX(-50%)',
      height: '34px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      userSelect: 'none',
      zIndex: '9999',
    });
    document.body.appendChild(container);

    // Mode toggle (leftmost)
    const btnMode = document.createElement('button');
    btnMode.textContent = autoClickerI18n.fixedShort || 'Fixed';
    btnMode.title = autoClickerI18n.fixedTitle || 'Fixed Interval';
    styleBtn(btnMode, { paddingLeft: '8px', paddingRight: '8px', minWidth: '52px' });
    container.appendChild(btnMode);
    modeBtnEl = btnMode;

    // ── 实际图片计数显示框（Start 按钮左边）──
    const spanImgCounter = document.createElement('span');
    Object.assign(spanImgCounter.style, {
      color: FG,
      fontSize: '12px',
      fontFamily: 'Source Sans Pro, monospace',
      minWidth: '52px',
      height: '34px',
      lineHeight: '34px',
      textAlign: 'center',
      padding: '0 5px',
      border: BORDER,
      borderRadius: '3px',
      backgroundColor: BG,
      boxSizing: 'border-box',
    });
    spanImgCounter.textContent = '📷 0';
    spanImgCounter.title = '实际生成图片数（MutationObserver 监听，页面加载前的旧图不计入）';
    container.appendChild(spanImgCounter);
    imgCounterEl = spanImgCounter;

    // ── Start / Pause 按钮 ──
    const btnStart = document.createElement('button');
    btnStart.textContent = 'Start';
    styleBtn(btnStart, { paddingLeft: '10px', paddingRight: '10px' });
    container.appendChild(btnStart);
    startBtnEl = btnStart;

    // ── 循环次数输入框 ──
    const inputLoops = document.createElement('input');
    inputLoops.type = 'number';
    inputLoops.min  = '1';
    inputLoops.placeholder = '循环次数';
    inputLoops.title = '输入需要连点的总次数，不填或清空为无限';
    styleInput(inputLoops, { width: '64px', padding: '0 5px', textAlign: 'center' });
    container.appendChild(inputLoops);

    // ── 进度显示 (当前/总次数) ──
    const spanLoopCounter = document.createElement('span');
    Object.assign(spanLoopCounter.style, {
      color: FG,
      fontSize: '12px',
      fontFamily: 'Source Sans Pro, monospace',
      minWidth: '26px',
      height: '34px',
      lineHeight: '34px',
      textAlign: 'center',
      padding: '0 5px',
      border: BORDER,
      borderRadius: '3px',
      backgroundColor: BG,
      boxSizing: 'border-box',
    });
    spanLoopCounter.textContent = '0';
    container.appendChild(spanLoopCounter);
    loopCounterEl = spanLoopCounter; // 将引用存入模块作用域变量，供 runAutoClicker 访问

    // ── 自定义生成键 ↺ ──
    const btnCustom = document.createElement('button');
    btnCustom.textContent = '↺';
    btnCustom.title = '清除图生图/重绘后生成一次，同时重置 Seed';
    styleBtn(btnCustom, { width: '34px', padding: '0' });
    container.appendChild(btnCustom);

    // ── 间隔输入框 ──
    const inputInterval = document.createElement('input');
    inputInterval.type = 'number';
    inputInterval.min  = '1';
    inputInterval.placeholder = `间隔: ${loopTime / 1000}s`;
    styleInput(inputInterval, { width: '64px', padding: '0 5px' });
    container.appendChild(inputInterval);
    intervalInputEl = inputInterval;

    // ── 随机偏移输入框 ──
    const inputRandom = document.createElement('input');
    inputRandom.type = 'number';
    inputRandom.min  = '0';
    inputRandom.placeholder = `± ${randomTime / 1000}s`;
    styleInput(inputRandom, { width: '38px', padding: '0 4px' });
    container.appendChild(inputRandom);

    updateModeUI();


    // ── 拖拽手柄 ↔ ──
    const btnMover = document.createElement('button');
    btnMover.textContent = '↔';
    btnMover.title = '长按拖动浮窗';
    styleBtn(btnMover, { paddingLeft: '7px', paddingRight: '7px', fontSize: '20px' });
    container.appendChild(btnMover);

    // ─── 事件：Start / Pause ───────────────────────────────────
    btnMode.addEventListener('click', () => {
      setClickMode(clickMode === 'fixed' ? 'on-image' : 'fixed');
    });

    btnStart.addEventListener('click', async () => {
      if (isRunning) {
        stopAutoClicker('pause');

        const dialog = document.getElementById('nai-anlas-dialog');
        if (dialog) {
          const cancelBtn = Array.from(dialog.querySelectorAll('button'))
            .find(b => b.textContent.includes('取消'));
          if (cancelBtn) cancelBtn.click();
          else dialog.remove();
        }
      } else {
        runToken += 1;
        if (interval) clearTimeout(interval);
        interval = null;
        cancelPendingWaits();

        currentLoop = 0;
        imageCount = 0;
        if (imgCounterEl) imgCounterEl.textContent = '📷 0';
        const v = parseInt(inputLoops.value, 10);
        maxLoops = (!isNaN(v) && v > 0) ? v : 0;
        updateLoopCounter();

        console.log(`[AutoClicker] Starting, target loops: ${maxLoops > 0 ? maxLoops : 'inf'}`);
        isRunning = true;
        ignoreAnlasWarning = false;
        btnStart.textContent = 'Pause';
        runAutoClicker();
      }
    });

    // ─── 事件：循环次数输入 ───────────────────────────────────
    inputLoops.addEventListener('change', () => {
      const v = parseInt(inputLoops.value, 10);
      maxLoops = (!isNaN(v) && v > 0) ? v : 0;
      // 保留输入的数字，不清空不改占位符，方便用户直接删除切换回无限循环
      updateLoopCounter();
    });

    // 根据输入内容动态调整宽度：空时用占位符宽度，有内容时按字符数缩窄
    inputLoops.addEventListener('input', () => {
      const len = inputLoops.value.length;
      inputLoops.style.width = len > 0 ? `${len * 9 + 10}px` : '64px';
    });

    // ─── 事件：自定义生成键 ↺ ──────────────────────────────────
    btnCustom.addEventListener('click', async () => {
      if (!(await checkAnlas())) return;
      // 清除所有图生图 / 重绘输入
      XPATH_I2I_LIST.forEach(xpath => {
        const el = xpathNode(xpath);
        if (el) triggerClick(el);
      });
      // 延迟后生成并重置 Seed
      setTimeout(() => triggerClick(findGenerateButton()), 600);
      setTimeout(() => resetSeed(), 1000);
    });

    // ─── 事件：间隔输入 ────────────────────────────────────────
    inputInterval.addEventListener('change', () => {
      const v = parseFloat(inputInterval.value);
      if (!isNaN(v) && v > 0) {
        loopTime = Math.round(v * 1000);
        inputInterval.placeholder = `间隔: ${v}s`;
      }
      inputInterval.value = '';
    });

    // ─── 事件：随机偏移 ────────────────────────────────────────
    inputRandom.addEventListener('change', () => {
      const v = parseFloat(inputRandom.value);
      if (!isNaN(v) && v >= 0) {
        randomTime = Math.round(v * 1000);
        inputRandom.placeholder = `± ${v}s`;
      }
      inputRandom.value = '';
    });



    // ─── 拖拽逻辑 ──────────────────────────────────────────────
    let initX, initY, startLeft, startTop;

    btnMover.addEventListener('mousedown', e => {
      e.preventDefault();
      // 拖拽时取消 transform 居中，改用绝对坐标
      if (container.style.transform) {
        const rect = container.getBoundingClientRect();
        container.style.left      = rect.left + 'px';
        container.style.top       = rect.top  + 'px';
        container.style.bottom    = 'auto';
        container.style.transform = '';
      }
      initX     = e.clientX;
      initY     = e.clientY;
      startLeft = parseInt(container.style.left, 10) || 0;
      startTop  = parseInt(container.style.top,  10) || 0;

      document.addEventListener('mousemove', onMouseMove);
    });

    function onMouseMove(e) {
      const dx = e.clientX - initX;
      const dy = e.clientY - initY;
      // 边界限制
      const maxLeft = window.innerWidth  - container.offsetWidth;
      const maxTop  = window.innerHeight - container.offsetHeight;
      container.style.left = Math.max(0, Math.min(startLeft + dx, maxLeft)) + 'px';
      container.style.top  = Math.max(0, Math.min(startTop  + dy, maxTop )) + 'px';
    }

    document.addEventListener('mouseup', () => {
      document.removeEventListener('mousemove', onMouseMove);
    });

    startImageObserver();
    console.log('[AutoClicker] 浮窗已创建');
    
    // 强制基于当前字典进行一次文本刷新，双重保险
    applyModeI18n();
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
        triggerClick(btn);
        console.log('[AutoClicker] 快捷键触发生成图像');
      } else {
        console.warn('[AutoClicker] 快捷键触发失败：未找到可见的 Generate 按钮');
      }
    }
  });

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
