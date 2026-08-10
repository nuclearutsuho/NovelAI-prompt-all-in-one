// history-favorites-panel.js
console.log('[Wildcard] History Modal module loaded');

  // ═══════════════════════════════════════════════════════════════
  //  历史与收藏面板 (Injected History & Favorites Modal)
  // ═══════════════════════════════════════════════════════════════

(function initHistoryModal() {
    const MODAL_ID = 'nai-history-modal';
    
    function getGroupTagsDataUtils() {
      return typeof window !== 'undefined' ? (window.GroupTagsDataUtils || {}) : {};
    }

    // ───── CSS 样式 ─────────────────────────────────────────────
    const STYLE = `
      #nai-history-backdrop {
        display: none;
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        z-index: 2147483650; /* 必须大于 manager-panel 的 2147483645 */
        align-items: center;
        justify-content: center;
      }
      #nai-history-backdrop.visible { display: flex; }

      #${MODAL_ID} {
        width: 85vw; max-width: 1100px;
        height: 82vh;
        background: #1a1a2e;
        border: 1px solid #3a3a5c;
        border-radius: 14px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.85);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #e0e0f0;
      }

      .nhm-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 18px;
        background: #22223a;
        border-bottom: 1px solid #3a3a5c;
        flex-shrink: 0;
      }
      .nhm-title { font-size: 16px; font-weight: 600; color: #c5c5ef; letter-spacing: 0.5px; }
      .nhm-close-btn {
        background: transparent; border: none; color: #888; font-size: 20px;
        cursor: pointer; padding: 2px 8px; border-radius: 4px; line-height: 1;
      }
      .nhm-close-btn:hover { background: #3a3a5c; color: #fff; }

      .nhm-body {
        display: flex; flex: 1; overflow: hidden;
      }

      /* ── 左侧边栏 ── */
      .nhm-sidebar {
        width: 300px; min-width: 240px; max-width: 340px;
        background: #16162a;
        border-right: 1px solid #2e2e50;
        display: flex; flex-direction: column;
        flex-shrink: 0;
      }

      .nhm-tabs {
        display: flex;
        border-bottom: 1px solid #2e2e50;
        flex-shrink: 0;
      }
      .nhm-tab {
        flex: 1; padding: 9px 4px; text-align: center;
        font-size: 12px; color: #888; cursor: pointer;
        border: none; background: transparent; border-bottom: 2px solid transparent;
        transition: all 0.15s;
      }
      .nhm-tab.active { color: #818cf8; border-bottom-color: #818cf8; }
      .nhm-tab:hover:not(.active) { color: #ccc; }

      .nhm-list {
        flex: 1; overflow-y: auto; padding: 4px 0;
      }
      .nhm-list::-webkit-scrollbar { width: 4px; }
      .nhm-list::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 2px; }

      .nhm-item {
        display: flex; align-items: flex-start;
        padding: 6px 12px; gap: 8px;
        cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.03); border-left: 3px solid transparent;
        transition: all 0.2s;
      }
      .nhm-item:hover { background: rgba(255,255,255, 0.04); }
      .nhm-item.selected { background: rgba(129, 140, 248, 0.15); border-left-color: #818cf8; }

      .nhm-item-main { flex: 1; min-width: 0; }
      .nhm-item-time { font-size: 11px; color: #818cf8; margin-bottom: 3px; }
      .nhm-item-preview { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      
      /* Diff 摘要容器与微型胶囊样式 */
      .nhm-item-diff-container {
        display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
      }
      .nhm-diff-tag {
        display: inline-flex; align-items: center; font-size: 10px; padding: 1px 4px; border-radius: 3px;
        white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis;
      }
      .nhm-diff-tag .diff-op { font-weight: bold; margin-right: 3px; font-size: 11px; }
      .nhm-diff-tag.diff-add { background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.3); color: #4ade80; }
      .nhm-diff-tag.diff-remove { background: rgba(231, 76, 60, 0.15); border: 1px solid rgba(231, 76, 60, 0.3); color: #f87171; text-decoration: line-through; }
      .nhm-diff-tag.diff-change { background: rgba(167, 139, 250, 0.15); border: 1px solid rgba(167, 139, 250, 0.3); color: #c084fc; }
      .nhm-diff-tag.diff-enable { background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; }
      .nhm-diff-tag.diff-disable { background: rgba(107, 114, 128, 0.15); border: 1px solid rgba(107, 114, 128, 0.3); color: #9ca3af; }
      .nhm-diff-tag.diff-ghost { background: rgba(75, 85, 99, 0.1); border: 1px dashed rgba(107, 114, 128, 0.3); color: #6b7280; text-decoration: line-through; }
      .nhm-diff-expand-capsule {
        background: transparent; border: 1px dashed #666; color: #888; 
        font-style: italic; letter-spacing: 1px; cursor: pointer; transition: color 0.15s, border-color 0.15s;
      }
      .nhm-diff-expand-capsule:hover { color: #fff; border-color: #888; }

      .nhm-item-name {
        font-size: 12px; color: #c5c5ef; font-weight: 500; margin-bottom: 2px;
        cursor: pointer; padding: 1px 3px; border-radius: 3px;
      }
      .nhm-item-name:hover { background: #3a3a5c; }

      .nhm-star-btn {
        background: transparent; border: none; cursor: pointer;
        font-size: 16px; line-height: 1; color: #555; flex-shrink: 0;
        padding: 0 2px; transition: color 0.15s; align-self: center;
      }
      .nhm-star-btn.starred { color: #f59e0b; }
      .nhm-star-btn:hover { color: #f59e0b; }

      .nhm-delete-btn {
        background: transparent; border: none; cursor: pointer;
        font-size: 13px; color: #555; flex-shrink: 0; padding: 0 2px;
        align-self: center; transition: all 0.15s; opacity: 0;
      }
      .nhm-item:hover .nhm-delete-btn { opacity: 1; }
      .nhm-delete-btn:hover { color: #ef4444; text-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }

      .nhm-footer {
        padding: 10px 12px;
        border-top: 1px solid #2e2e50;
        flex-shrink: 0;
        font-size: 11px; color: #666;
      }
      .nhm-footer-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
      .nhm-limit-input {
        width: 52px; background: #2a2a40; border: 1px solid #3a3a5c;
        color: #ccc; border-radius: 4px; padding: 2px 4px; font-size: 12px;
        text-align: center;
      }
      .nhm-clear-btn {
        margin-left: auto; background: transparent; border: 1px solid #3a3a5c;
        color: #888; padding: 3px 8px; border-radius: 4px; font-size: 11px;
        cursor: pointer;
      }
      .nhm-clear-btn:hover { background: #3a3a5c; color: #fff; }

      /* Duplicate Tag Badge in History Modal */
      .nhm-tag-item { position: relative; }
      .nhm-tag-duplicate-badge {
        position: absolute;
        top: -0.6em; right: -0.6em;
        background: #f59e0b; color: #fff;
        font-size: 0.72em; font-weight: 800;
        width: 1.55em; height: 1.55em;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        z-index: 10;
        border: 1px solid #1a1a2e;
        pointer-events: none;
      }

      /* ── 右侧详情 ── */
      .nhm-detail {
        flex: 1; display: flex; flex-direction: column; overflow: hidden;
      }

      .nhm-detail-placeholder {
        flex: 1; display: flex; align-items: center; justify-content: center;
        color: #444; font-size: 14px;
      }

      .nhm-detail-content {
        flex: 1; overflow-y: auto;
        padding: 16px 20px;
      }
      
      /* 美化的空状态面板 */
      @keyframes nhmFadeInUp {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .nhm-empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        margin: 20px 12px; padding: 40px 20px;
        background: rgba(42, 42, 64, 0.4); border: 1px dashed rgba(255, 255, 255, 0.08);
        border-radius: 8px; text-align: center;
        animation: nhmFadeInUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .nhm-empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.8; }
      .nhm-empty-title { color: #e2e8f0; font-size: 14px; font-weight: 600; margin-bottom: 6px; letter-spacing: 0.5px; }
      .nhm-empty-desc { color: #94a3b8; font-size: 12px; line-height: 1.5; }

      /* Diff 详情查阅弹窗 */
      .nhm-diff-modal {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 15, 26, 0.85); backdrop-filter: blur(8px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 999999; opacity: 0; pointer-events: none; transition: opacity 0.2s;
      }
      .nhm-diff-modal.visible { opacity: 1; pointer-events: auto; }
      .nhm-diff-modal-content {
        background: #1e1e2d; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
        width: 80%; max-width: 800px; max-height: 80%; display: flex; flex-direction: column;
        box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      }
      .nhm-diff-modal-header {
        padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        display: flex; justify-content: space-between; align-items: center;
      }
      .nhm-diff-modal-title { font-size: 14px; color: #fff; font-weight: bold; }
      .nhm-diff-modal-close { background: transparent; border: none; font-size: 20px; color: #888; cursor: pointer; }
      .nhm-diff-modal-close:hover { color: #fff; }
      .nhm-diff-modal-body {
        padding: 16px; overflow-y: auto; flex: 1;
      }
      .nhm-diff-modal-body .nhm-item-diff-container { display: flex; flex-wrap: wrap; gap: 6px; }
      .nhm-diff-modal-body .nhm-diff-tag { font-size: 11px; padding: 3px 6px; max-width: none; }

      .nhm-detail-content::-webkit-scrollbar { width: 5px; }
      .nhm-detail-content::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 3px; }

      .nhm-section { margin-bottom: 18px; }
      .nhm-section-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
        color: #555; padding-bottom: 6px; margin-bottom: 8px;
        border-bottom: 1px solid #2e2e50;
      }
      .nhm-section-title.pos { color: #4ade80; border-bottom-color: #4ade8040; }
      .nhm-section-title.neg { color: #f87171; border-bottom-color: #f8717140; }
      .nhm-section-title.char { color: #60a5fa; border-bottom-color: #60a5fa40; }

      .nhm-tag-cloud { display: flex; flex-wrap: wrap; gap: 5px; }
      .nhm-tag.pos { background: #14321a; border-color: #4ade8050; color: #86efac; }
      .nhm-tag.neg { background: #32141a; border-color: #f8717150; color: #fca5a5; }
      .nhm-tag.char { background: #14243c; border-color: #60a5fa50; color: #93c5fd; }

      .nhm-detail-actions {
        padding: 12px 18px;
        border-top: 1px solid #2e2e50;
        display: flex; align-items: center; justify-content: flex-end; gap: 10px;
        flex-shrink: 0;
        background: #16162a;
      }
      .nhm-detail-meta { font-size: 11px; color: #555; flex: 1; }

      .nhm-restore-btn {
        padding: 8px 22px;
        background: linear-gradient(135deg, #6366f1, #818cf8);
        border: none; border-radius: 8px;
        color: #fff; font-size: 14px; font-weight: 600;
        cursor: pointer; transition: opacity 0.2s, transform 0.1s;
        box-shadow: 0 4px 12px rgba(99,102,241,0.4);
      }
      /* ==========================================================
         完全参照 TagEditor 的样式体系
         ========================================================== */
      .nhm-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-content: flex-start;
      }
      .nhm-tag-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        box-sizing: border-box;
      }
      .nhm-tag-capsule {
        display: flex;
        align-items: center;
        background: #3b3b4f;
        border: 1px solid #4a4a6a;
        border-radius: 6px;
        padding: 2px 8px;
        color: #eee;
        font-size: 13px;
        min-height: 28px;
        box-sizing: border-box;
        transition: all 0.2s;
      }
      .nhm-tag-zh-row {
        font-size: 11px;
        color: #888;
        line-height: 1.2;
        text-align: center;
        white-space: normal;
        word-break: break-all;
        overflow-wrap: break-word;
        min-height: 1.2em;
      }
      .nhm-tag-primary {
        display: flex;
        align-items: center;
      }
      .nhm-tag-weight-badge {
        font-size: 0.85em;
        padding: 0 4px;
        border-radius: 4px;
        line-height: 1.2;
        font-weight: bold;
        margin-right: 4px;
      }
      .nhm-tag-weight-badge.w-pos {
        background: rgba(46, 204, 113, 0.2);
        color: #2ecc71;
      }
      .nhm-tag-weight-badge.w-neg {
        background: rgba(231, 76, 60, 0.2);
        color: #e74c3c;
      }
      /* 分组/特殊样式补充 */
      .nhm-tag-capsule.gh {
        background: rgba(129, 140, 248, 0.15);
        border: 1px solid rgba(129, 140, 248, 0.3);
        border-radius: 12px 2px 2px 12px;
        border-right: none;
        padding-left: 6px;
        border-left-width: 3px;
        border-left-color: #818cf8;
        min-width: 24px;
        margin-right: -4px;
      }
      .nhm-tag-capsule.gf {
        background: rgba(129, 140, 248, 0.15);
        border: 1px solid rgba(129, 140, 248, 0.3);
        border-radius: 2px 12px 12px 2px;
        border-left: none;
        padding-right: 6px;
        border-right-width: 3px;
        border-right-color: #818cf8;
        min-width: 14px;
        justify-content: center;
      }
      .nhm-tag-capsule.dh {
        background: rgba(167, 139, 250, 0.15);
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 12px 2px 2px 12px;
        border-right: none;
        padding-left: 8px;
        border-left-width: 3px;
        border-left-color: #a78bfa;
        min-width: 24px;
        margin-right: -4px;
      }
      .nhm-tag-capsule.dh::before { content: "||"; font-weight: bold; color: #a78bfa; margin: 0 2px; }
      .nhm-tag-capsule.df {
        background: rgba(167, 139, 250, 0.15);
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 2px 12px 12px 2px;
        border-left: none;
        padding-right: 8px;
        border-right-width: 3px;
        border-right-color: #a78bfa;
        min-width: 14px;
        justify-content: center;
      }
      .nhm-tag-capsule.df::after { content: "||"; font-weight: bold; color: #a78bfa; margin: 0 2px; }
      .nhm-tag-capsule.dyn-member { background: rgba(167, 139, 250, 0.05); border-color: rgba(167, 139, 250, 0.2); }
      .nhm-tag-dyn-badge { background: #a78bfa; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: bold; margin-right: 4px; }
      .nhm-tag-dyn-weight { background: #a78bfa; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: bold; margin-left: 4px; }

      /* 禁用状态 (与 TagEditor 的 .tag-capsule.disabled 一致) */
      .nhm-tag-capsule.disabled {
        background: #2a2a2e;
        border-color: #333;
      }
      .nhm-tag-capsule.disabled .nhm-tag-primary {
        opacity: 0.5;
      }
      .nhm-tag-capsule.disabled .nhm-tag-text {
        text-decoration: line-through;
      }

      /* 换行标签 (作为普通胶囊显示，与 Popup 中未开启"渲染换行符"的样式一致) */
      .nhm-tag-newline .nhm-tag-capsule {
        background: rgba(255, 255, 255, 0.05) !important;
        border-style: dashed;
        border-color: rgba(255, 255, 255, 0.2) !important;
        min-width: 32px;
        justify-content: center;
      }
      .nhm-tag-newline .nhm-tag-text {
        font-size: 14px;
        color: #888;
      }
      
      /* 换行标签分隔符（强制后面元素换行） */
      .nhm-tag-newline-separator {
        flex-basis: 100%;
        height: 0;
        margin: 0;
        padding: 0;
      }

      /* ── 区块标题 + 操作按钮行 ── */
      .nhm-section-header {
        display: flex; align-items: center; justify-content: space-between;
        padding-bottom: 6px; margin-bottom: 8px;
        border-bottom: 1px solid #2e2e50;
      }
      .nhm-section-header.pos { border-bottom-color: #a855f740; }
      .nhm-section-header.neg { border-bottom-color: #f59e0b40; }
      .nhm-section-header.char { border-bottom-color: #14b8a640; }
      .nhm-section-header-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #555;
      }
      .nhm-section-header-title.pos { color: #a855f7; }
      .nhm-section-header-title.neg { color: #f59e0b; }
      .nhm-section-header-title.char { color: #14b8a6; }
      .nhm-section-actions {
        display: flex; gap: 4px; flex-shrink: 0;
      }
      .nhm-action-btn {
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px; padding: 2px 8px; font-size: 11px; color: #aaa;
        cursor: pointer; transition: all 0.15s; white-space: nowrap;
      }
      .nhm-action-btn:hover { background: rgba(255,255,255,0.12); color: #fff; border-color: rgba(255,255,255,0.2); }
      .nhm-action-btn.fav:hover { color: #f59e0b; border-color: #f59e0b80; }
      .nhm-action-btn.restore:hover { color: #818cf8; border-color: #818cf880; }

      /* ── 局部标记胶囊 ── */
      .nhm-partial-badge {
        display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px;
        margin-left: 6px; font-weight: 600; letter-spacing: 0.5px;
      }
      .nhm-partial-badge.pos { background: rgba(168, 85, 247, 0.15); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.3); }
      .nhm-partial-badge.neg { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
      .nhm-partial-badge.char { background: rgba(20, 184, 166, 0.15); color: #14b8a6; border: 1px solid rgba(20, 184, 166, 0.3); }

      /* ── 差异标记分类徽章 ── */
      .nhm-diff-section-badge {
        font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid transparent;
        margin-right: 6px; margin-left: 2px; display: inline-flex; align-items: center;
        font-weight: 600; font-family: 'Inter', sans-serif;
        vertical-align: middle; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      }
      .nhm-diff-section-badge.pos { background: rgba(168, 85, 247, 0.12); color: #a855f7; border-color: rgba(168, 85, 247, 0.25); }
      .nhm-diff-section-badge.neg { background: rgba(245, 158, 11, 0.12); color: #f59e0b; border-color: rgba(245, 158, 11, 0.25); }
      .nhm-diff-section-badge.char { background: rgba(20, 184, 166, 0.12); color: #14b8a6; border-color: rgba(20, 184, 166, 0.25); }

      /* ── 收藏夹工具栏 ── */
      .nhm-fav-toolbar {
        display: flex; align-items: center; gap: 4px;
        padding: 6px 8px; border-bottom: 1px solid #2e2e50; flex-shrink: 0;
        flex-wrap: wrap; /* 允许必要时换行但不打断单个按钮 */
      }
      .nhm-toolbar-btn {
        background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.15);
        border-radius: 5px; padding: 4px 6px; font-size: 11px; color: #999;
        cursor: pointer; transition: all 0.15s; white-space: nowrap;
      }
      .nhm-toolbar-btn:hover { background: rgba(255,255,255,0.12); color: #fff; border-style: solid; }

      /* ── 文件夹容器 ── */
      .nhm-folder-item {
        border: 1px solid rgba(129, 140, 248, 0.25); border-radius: 6px;
        margin: 6px; overflow: hidden;
        background: rgba(30, 30, 50, 0.6);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .nhm-folder-header {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 10px; cursor: pointer;
        background: rgba(50, 50, 75, 0.5); transition: background 0.15s;
        border-bottom: 1px solid transparent;
      }
      .nhm-folder-header:hover { background: rgba(60, 60, 90, 0.7); }
      .nhm-folder-header.open { border-bottom-color: rgba(129, 140, 248, 0.2); }
      .nhm-folder-arrow {
        font-size: 10px; color: #888; transition: transform 0.2s; flex-shrink: 0;
      }
      .nhm-folder-arrow.open { transform: rotate(90deg); }
      .nhm-folder-name {
        flex: 1; font-size: 12px; color: #c5c5ef; font-weight: 500;
        cursor: pointer; padding: 1px 3px; border-radius: 3px; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .nhm-folder-name:hover { background: #3a3a5c; }
      .nhm-folder-count {
        font-size: 10px; color: #666; flex-shrink: 0;
      }
      .nhm-folder-delete {
        background: transparent; border: none; cursor: pointer; font-size: 12px;
        color: #555; flex-shrink: 0; padding: 0 2px; transition: color 0.15s;
      }
      .nhm-folder-delete:hover { color: #ef4444; }
      .nhm-folder-content {
        padding: 2px 0 2px 8px; min-height: 12px;
      }
      .nhm-folder-content.collapsed { display: none; }

      /* Sortable.js 拖拽样式 */
      .nhm-item-icon { cursor: grab; }
      .nhm-item-icon:active { cursor: grabbing; }
      .nhm-sortable-ghost {
        opacity: 0.3; background: rgba(129, 140, 248, 0.15);
        border: 1px dashed rgba(129, 140, 248, 0.4); border-radius: 4px;
      }
      .nhm-sortable-chosen { background: rgba(129, 140, 248, 0.08); }
      .nhm-sortable-drag { opacity: 0.9; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
      .nhm-folder-header.drag-over { background: rgba(129, 140, 248, 0.2); border-bottom-color: #818cf840; }

      /* ── 批量管理样式 ── */
      .nhm-fav-toolbar {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);
        background: rgba(26, 26, 46, 0.4);
      }
      .nhm-batch-toolbar {
        display: flex; align-items: center; gap: 6px; width: 100%;
      }
      .nhm-batch-btn {
        background: rgba(129, 140, 248, 0.1); border: 1px solid rgba(129, 140, 248, 0.2);
        color: #818cf8; border-radius: 4px; padding: 3px 6px; font-size: 11px;
        cursor: pointer; transition: all 0.15s;
      }
      .nhm-batch-btn:hover { background: rgba(129, 140, 248, 0.2); color: #fff; }
      .nhm-batch-btn.danger {
        color: #f87171; border-color: rgba(248, 113, 113, 0.2);
      }
      .nhm-batch-btn.danger:hover { background: rgba(248, 113, 113, 0.2); }
      
      .nhm-item-checkbox-wrap {
        margin-right: 8px; display: flex; align-items: center; flex-shrink: 0;
      }
      .nhm-batch-checkbox {
        width: 14px; height: 14px; border: 1.5px solid #555; border-radius: 3px;
        cursor: pointer; position: relative; transition: all 0.15s; background: transparent;
      }
      .nhm-batch-checkbox.checked {
        background: #818cf8; border-color: #818cf8;
      }
      .nhm-batch-checkbox.checked::after {
        content: '✔'; position: absolute; top: -1px; left: 1px;
        color: #fff; font-size: 10px; font-weight: bold;
      }
      .nhm-item.batch-selected { background: rgba(129, 140, 248, 0.1); }
      
      .nhm-batch-move-wrap { position: relative; display: inline-block; }
      .nhm-batch-dropdown {
        position: absolute; top: 100%; left: 0; z-index: 1000;
        background: #2a2a40; border: 1px solid #3a3a5c; border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5); min-width: 140px; margin-top: 4px;
        display: none; flex-direction: column; padding: 4px 0;
      }
      .nhm-batch-dropdown.visible { display: flex; }
      .nhm-batch-dropdown-item {
        padding: 6px 12px; font-size: 11px; color: #ccc; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .nhm-batch-dropdown-item:hover { background: #3a3a5c; color: #fff; }

      /* ── 分组框（按换行符分组）── */
      .nhm-tag-list { position: relative; }
      .nhm-group-box {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        align-content: flex-start;
        position: relative;
        border: 1.5px dashed rgba(129, 140, 248, 0.4);
        border-radius: 8px;
        padding: 8px 10px 10px 10px;
        margin-bottom: 8px;
        background: rgba(99, 102, 241, 0.03);
        width: 100%;
        box-sizing: border-box;
      }
      /* 分组名称徽章：右下角矩形卡片 + 左侧色条 */
      .nhm-group-badge {
        position: absolute;
        bottom: -1px;
        right: 8px;
        transform: translateY(50%);
        background: #1e1e2e;
        color: #e0e7ff;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        padding: 0px 2px 1px 4px;
        border-radius: 0;
        border-top: 2px solid rgba(255, 255, 255, 0.1);
        border-right: 2px solid rgba(255, 255, 255, 0.1);
        border-bottom: 2px solid rgba(255, 255, 255, 0.1);
        border-left: 3px solid #818cf8;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
        white-space: nowrap;
        z-index: 3;
        pointer-events: none;
      }
    `;

    function injectStyle() {
      if (document.getElementById('nai-history-modal-style')) return;
      const el = document.createElement('style');
      el.id = 'nai-history-modal-style';
      el.textContent = STYLE;
      document.head.appendChild(el);
    }

    // ───── 工具函数 ─────────────────────────────────────────────
    function formatTime(ts) {
      const d = new Date(ts);
      const date = `${d.getMonth()+1}/${d.getDate()}`;
      const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      return `${date} ${time}`;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]);
    }

    function tagsPreview(str) {
      if (!str) return '(空)';
      const tags = str.split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) return '(空)';
      const preview = tags.slice(0, 5).join(', ');
      return tags.length > 5 ? preview + ` ...+${tags.length - 5}` : preview;
    }

    /**
     * 计算两个提示词快照数组之间的按词差异（忽略顺序，支持 disabled 状态追踪）
     * @param {Array|string} current 现在的状态 (优先取 tag 对象数组)
     * @param {Array|string} previous 过去的状态
     * @returns {Object} 包含了 6 种动作状态的分类词典
     */
    function computePromptDiff(current, previous) {
      const parseToMap = (input) => {
        const map = new Map();
        if (!input) return map;
        
        // 兼容处理：统一转为规范的高维 tag object 数组
        let tagsArray = [];
        if (typeof input === 'string') {
          tagsArray = input.split(',').map(t => ({ value: t.trim(), disabled: false })).filter(t => t.value);
        } else if (Array.isArray(input)) {
          tagsArray = input;
        }

        tagsArray.forEach(tag => {
          const text = tag.value;
          if (!text || text === '\\n' || text === '||' || text.startsWith('||') || text === '\n') return;
          
          let weightVal = tag.dynWeight || 1.0;
          let cleanText = text;

          // 仿照 renderTagCloud 内部的经典正则提取纯文本与强制指定权重
          const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
          const headerMatch = text.match(/^([-?\d\.]+)::$/);
          
          if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            cleanText = blockMatch[2];
          } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            cleanText = headerMatch[1] + '::';
          } else if (text === ' ::') {
             cleanText = ')';  // 特殊组尾处理
          } else {
            let inc = 0, dec = 0, str = text;
            if (str.startsWith('{') || str.startsWith('[')) {
              while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
              if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
              if (inc > 0) weightVal = 1 + (inc * 0.1);
              else if (dec > 0) weightVal = 1 - (dec * 0.1);
              cleanText = str;
            }
          }

          if (cleanText) {
             const lowerKey = cleanText.toLowerCase();
             // 如果输入框写了多个相同的词，只比对第一个（通常不推荐写重复tag）
             if (!map.has(lowerKey)) {
                map.set(lowerKey, { 
                  original: text, 
                  cleanText, 
                  weightVal, 
                  disabled: !!tag.disabled 
                });
             }
          }
        });
        return map;
      };

      const currMap = parseToMap(current);
      const prevMap = parseToMap(previous);

      const diff = { added: [], removed: [], changed: [], disabled: [], enabled: [], ghost_deleted: [] };

      // 阶段 1：找出现存的（新增、变动、禁用、启用）
      for (const [key, currData] of currMap.entries()) {
        if (!prevMap.has(key)) {
          if (currData.disabled) {
             diff.disabled.push(currData); // 刚加进来就被禁用了（不常见，但逻辑上完备）
          } else {
             diff.added.push(currData);
          }
        } else {
          const prevData = prevMap.get(key);
          
          if (!prevData.disabled && currData.disabled) {
             diff.disabled.push(currData);
          } else if (prevData.disabled && !currData.disabled) {
             diff.enabled.push(currData);
          } else if (prevData.disabled === currData.disabled) {
             // 只有生存状态没变的情况下，才去计算权重或拼写的变动
             if (Math.abs(currData.weightVal - prevData.weightVal) > 0.01) {
               diff.changed.push({
                 cleanText: currData.cleanText,
                 oldWeight: prevData.weightVal,
                 newWeight: currData.weightVal,
                 disabled: currData.disabled // 记录它是不是在禁用的状态下被悄悄改了权重
               });
             }
          }
        }
      }

      // 阶段 2：找出消失的（被删的活跃词、被清扫的幽灵废弃词）
      for (const [key, prevData] of prevMap.entries()) {
        if (!currMap.has(key)) {
          if (prevData.disabled) {
             diff.ghost_deleted.push(prevData);
          } else {
             diff.removed.push(prevData);
          }
        }
      }

      return diff;
    }

    /**
     * 渲染 6-State Diff 内容为 HTML，支持正/负/角色级别的多维度 Diff 展示
     */
    function generateDiffHTML(currSnapshot, prevSnapshot) {
      if (!prevSnapshot) {
         const previewTags = currSnapshot.positiveTags ? currSnapshot.positiveTags.map(t => t.value).join(', ') : currSnapshot.positive;
         return `<div class="nhm-item-preview">${escapeHtml(tagsPreview(previewTags))}</div>`;
      }

      const allDiffsHTML = [];
      let totalDiffCount = 0;

      // 内部工具函数：根据目标 target 和 prevTarget 计算 Diff 并生成 HTML 数组
      const renderDiffs = (currTargetJSON, prevTargetJSON, badgeHTML) => {
        const diff = computePromptDiff(currTargetJSON, prevTargetJSON);
        const tagsHTML = [
          ...diff.added.map(item => `<span class="nhm-diff-tag diff-add"><span class="diff-op">+</span> ${escapeHtml(item.cleanText)}</span>`),
          ...diff.removed.map(item => `<span class="nhm-diff-tag diff-remove"><span class="diff-op">-</span> ${escapeHtml(item.cleanText)}</span>`),
          ...diff.changed.map(item => `<span class="nhm-diff-tag diff-change" ${item.disabled ? 'style="opacity:0.6"' : ''}><span class="diff-op">~</span> ${escapeHtml(item.cleanText)}: ${item.oldWeight.toFixed(2)} → ${item.newWeight.toFixed(2)}</span>`),
          ...diff.enabled.map(item => `<span class="nhm-diff-tag diff-enable"><span class="diff-op">👁️</span> ${escapeHtml(item.cleanText)}</span>`),
          ...diff.disabled.map(item => `<span class="nhm-diff-tag diff-disable"><span class="diff-op">🚫</span> ${escapeHtml(item.cleanText)}</span>`),
          ...diff.ghost_deleted.map(item => `<span class="nhm-diff-tag diff-ghost"><span class="diff-op">×</span> ${escapeHtml(item.cleanText)}</span>`)
        ];

        if (tagsHTML.length > 0) {
          totalDiffCount += tagsHTML.length;
          // 在这组差异的最前面插入分类徽章
          allDiffsHTML.push(badgeHTML, ...tagsHTML);
        }
      };

      // 1. 基础正面提示词 (Base Positive)
      renderDiffs(
        currSnapshot.positiveTags || currSnapshot.positive, 
        prevSnapshot.positiveTags || prevSnapshot.positive, 
        `<span class="nhm-diff-section-badge pos" title="Base Prompt"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Base</span>`
      );

      // 2. 基础负面提示词 (Base Negative)
      renderDiffs(
        currSnapshot.negativeTags || currSnapshot.negative, 
        prevSnapshot.negativeTags || prevSnapshot.negative, 
        `<span class="nhm-diff-section-badge neg" title="Undesired Content"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>UC</span>`
      );

      // 3. 角色提示词 (Character Prompts)
      const currChars = currSnapshot.characters || [];
      const prevChars = prevSnapshot.characters || [];
      const len = Math.max(currChars.length, prevChars.length);

      for (let i = 0; i < len; i++) {
        const cCurr = currChars[i] || {};
        const cPrev = prevChars[i] || {};

        // 角色正面
        renderDiffs(
          cCurr.posTags || cCurr.posPrompt,
          cPrev.posTags || cPrev.posPrompt,
          `<span class="nhm-diff-section-badge char" title="Character ${i + 1} Prompt"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Char ${i + 1}</span>`
        );

        // 角色负面
        renderDiffs(
          cCurr.negTags || cCurr.negPrompt,
          cPrev.negTags || cPrev.negPrompt,
          `<span class="nhm-diff-section-badge char" title="Character ${i + 1} Undesired Content" style="color:#f59e0b; background:rgba(245, 158, 11, 0.15); border-color:rgba(245, 158, 11, 0.3)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>C${i + 1} UC</span>`
        );
      }

      if (allDiffsHTML.length === 0) {
        return `<div class="nhm-item-preview" style="color:#666; font-style:italic;">仅顺序或位置变动 / 零变动</div>`;
      }

      const MAX_PREVIEW_TAGS = 25; 
      let html = '';
      
      if (totalDiffCount > MAX_PREVIEW_TAGS) {
        // 由于 allDiffsHTML 中混杂了 badge 和 tags，我们做粗略截断
        // 为了确保不会阶段坏结构，简单截断前 N 个元素（保守计算标签数量）
        let outputElements = [];
        let count = 0;
        for (const elementHTML of allDiffsHTML) {
          outputElements.push(elementHTML);
          if (!elementHTML.includes('nhm-diff-section-badge')) {
            count++;
          }
          if (count >= MAX_PREVIEW_TAGS) break;
        }

        const fullHTML = allDiffsHTML.join('').replace(/"/g, '&quot;');
        html = outputElements.join('') + 
               `<span class="nhm-diff-tag nhm-diff-expand-capsule" title="点击查看所有变动" data-fulldiff="${fullHTML}">... +${totalDiffCount - MAX_PREVIEW_TAGS}</span>`;
      } else {
        html = allDiffsHTML.join('');
      }

      return `<div class="nhm-item-diff-container">${html}</div>`;
    }

    /**
     * 解析单个 tag 的权重信息，返回 { weightVal, cleanText }
     * 支持 NAI 格式：weight::tag :: 和 {{{brackets}}} 样式
     */
    function parseTagWeight(text) {
      let weightVal = 1.0;
      let cleanText = text;

      // NAI 式“weight::tag ::”单片语法
      const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
      // NAI 式“weight::”组头
      const headerMatch = text.match(/^([-?\d\.]+)::$/);

      if (blockMatch) {
        weightVal = parseFloat(blockMatch[1]);
        cleanText = blockMatch[2];
      } else if (headerMatch) {
        weightVal = parseFloat(headerMatch[1]);
        cleanText = headerMatch[1] + '::';
      } else {
        // 旧式括号语法
        let inc = 0, dec = 0, str = text;
        if (text.startsWith('{') || text.startsWith('[')) {
          while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
          if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
          if (inc > 0) weightVal = 1 + (inc * 0.1);
          else if (dec > 0) weightVal = 1 - (dec * 0.1);
          cleanText = str;
        }
      }
      return { weightVal, cleanText };
    }

    /**
     * 移植自 Autocomplete.getTagInfo 的完整 tag 信息查询
     * 支持前缀剥离（artist:, character: 等）和类型颜色映射
     * 使用 Map 索引实现 O(1) 查询
     */
    function getTagInfo(text) {
      if (!text) return null;
      let query = text.trim().toLowerCase();

      // 0. 去除权重后缀 (e.g., tag:20)
      const weightSuffixMatch = query.match(/^(.*?)\s*:\s*\d+(\.\d+)?\s*$/);
      if (weightSuffixMatch) query = weightSuffixMatch[1].trim();

      // 0.1 去除尾部逗号
      if (query.endsWith(',')) query = query.slice(0, -1).trim();

      // 1. 检查类别前缀(artist:, character:, copyright:, meta:, general:)
      const prefixMatch = query.match(/^(artist|character|copyright|meta|general):(.*)$/);
      let prefix = null;
      let baseTag = query;
      if (prefixMatch) {
        prefix = prefixMatch[1];
        baseTag = prefixMatch[2].trim();
      }

      // 2. 从 Map 中查找 (尝试多种格式匹配)
      let match = null;
      const mapObj = currentDictionaryTagMap || window.__autocompleteMap__;
      if (mapObj) {
        match = mapObj.get(baseTag);
        // 尝试下划线替换为空格
        if (!match) match = mapObj.get(baseTag.replace(/_/g, ' '));
        // 尝试空格替换为下划线
        if (!match) match = mapObj.get(baseTag.replace(/ /g, '_'));
      }

      const prefixColorMap = {
        artist: 'indianred',
        character: 'lightgreen',
        copyright: 'violet',
        meta: 'orange',
        general: 'lightblue'
      };

      if (match) {
        if (prefix) return { ...match, color: prefixColorMap[prefix] || match.color };
        return match;
      }
      if (prefix) return { text: baseTag, zhCN: '', pop: 0, color: prefixColorMap[prefix] };
      return null;
    }

    /**
     * 渲染 tag 云 — 完全复刻 TagEditor 的视觉效果
     * @param {HTMLElement} container - 容器元素
     * @param {Array|string} tagsOrStr - tag 对象数组（v2 快照）或逗号分隔字符串（v1 快照兼容）
     */
    function renderTagCloud(container, tagsOrStr) {
      container.className = 'nhm-tag-list';
      container.innerHTML = '';

      // 兼容旧快照：如果传入的是字符串，用简易解析构造 tag 对象
      let tags;
      if (typeof tagsOrStr === 'string') {
        if (!tagsOrStr || !tagsOrStr.trim()) {
          container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
          return;
        }
        tags = tagsOrStr.split(',').map(t => ({ value: t.trim(), disabled: false })).filter(t => t.value);
      } else if (Array.isArray(tagsOrStr)) {
        tags = tagsOrStr;
      } else {
        container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
        return;
      }

      if (tags.length === 0) {
        container.innerHTML = '<span style="color:#444; font-size:13px;">（无内容）</span>';
        return;
      }

      // Calculate frequencies
      const tagFreq = {};
      tags.forEach(t => {
        const val = t.value;
        if (val === '\n' || val === ' ::' || val === '||' || val.match(/^([-?\d\.]+)::$/)) return;
        let clean = val;
        let m = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        if (m) clean = m[2];
        else if (val.startsWith('{') || val.startsWith('[')) {
          let str = val;
          while ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
            str = str.slice(1, -1);
          }
          clean = str;
        }
        const key = (typeof toCanonicalHistoryTagKey === 'function') ? toCanonicalHistoryTagKey(clean) : clean.trim().toLowerCase();
        if (key) tagFreq[key] = (tagFreq[key] || 0) + 1;
      });

      // 内部渲染单个 tag DOM 节点的工厂函数（不含外层容器）
      function renderOneTag(tag, index, allTags, inDynGroupRef, freq = 0) {
        const text = tag.value;
        if (!text && text !== '\n') return null;

        let weightVal = 1.0;
        let cleanText = text;
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        let isCompHeader = false;
        let isCompFooter = text === ' ::';
        const isNewline = text === '\n';
        const isDynMember = inDynGroupRef.val && !isDynHeader && !isDynFooter;

        if (isDynHeader) inDynGroupRef.val = true;

        const blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        const headerMatch = text.match(/^([-?\d\.]+)::$/);

        if (blockMatch) {
          weightVal = parseFloat(blockMatch[1]);
          cleanText = blockMatch[2];
        } else if (headerMatch) {
          weightVal = parseFloat(headerMatch[1]);
          cleanText = headerMatch[1] + '::';
          isCompHeader = true;
        } else if (isCompFooter) {
          cleanText = ')';
          for (let j = index - 1; j >= 0; j--) {
            const m = allTags[j].value.match(/^([-?\d\.]+)::$/);
            if (m) { weightVal = parseFloat(m[1]); break; }
          }
        } else if (!isNewline && !isDynHeader && !isDynFooter) {
          let inc = 0, dec = 0, str = text;
          if (text.startsWith('{') || text.startsWith('[')) {
            while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
            if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
            if (inc > 0) weightVal = 1 + (inc * 0.1);
            else if (dec > 0) weightVal = 1 - (dec * 0.1);
            cleanText = str;
          }
        }

        let pickBadgeText = '';
        if (isDynHeader) {
          let config = text.slice(2);
          if (config.endsWith('$$')) config = config.slice(0, -2);
          if (config) pickBadgeText = `x${config.replace('-', '~')}`;
        }
        let dynWeightBadgeText = '';
        if (isDynMember && tag.dynWeight && tag.dynWeight !== 1) {
          const f = (tag.dynWeight % 1 === 0) ? tag.dynWeight : tag.dynWeight.toFixed(1);
          dynWeightBadgeText = String(f);
        }

        let displayTagName = isNewline ? '↵' : cleanText;
        if (isCompHeader || isCompFooter || isDynHeader || isDynFooter) displayTagName = '';

        const lookupTagKey = toCanonicalHistoryTagKey(cleanText);
        let info = null;
        if (!isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter && !isNewline) {
          if (blockMatch) {
            const parts = cleanText.split(',').map(s => s.trim()).filter(Boolean);
            const tParts = []; let firstColor = null;
            parts.forEach(part => {
              const pi = getTagInfo(part);
              if (pi) { if (pi.zhCN) tParts.push(pi.zhCN); if (!firstColor && pi.color) firstColor = pi.color; }
            });
            if (tParts.length > 0 || firstColor) info = { zhCN: tParts.join(', '), color: firstColor };
          } else {
            info = getTagInfo(cleanText);
          }
        }
        if (currentGroupTranslationMap && currentGroupTranslationMap[lookupTagKey]) {
          if (!info) info = {};
          info.zhCN = currentGroupTranslationMap[lookupTagKey];
        }

        const itemNode = document.createElement('div');
        itemNode.className = 'nhm-tag-item';
        if (isNewline) itemNode.classList.add('nhm-tag-newline');

        const capClasses = ['nhm-tag-capsule'];
        if (isCompHeader) capClasses.push('gh');
        if (isCompFooter) capClasses.push('gf');
        if (isDynHeader) capClasses.push('dh');
        if (isDynFooter) capClasses.push('df');
        if (isDynMember) capClasses.push('dyn-member');
        if (tag.disabled) capClasses.push('disabled');

        const capsule = document.createElement('div');
        capsule.className = capClasses.join(' ');

        if (info && info.color) {
          capsule.style.borderColor = info.color;
          capsule.style.borderWidth = '1.5px';
          capsule.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }
        const groupColor = currentGroupColorMap && currentGroupColorMap[lookupTagKey];
        if (/^#[0-9a-fA-F]{6}$/.test(groupColor || '')) {
          capsule.style.background = groupColor;
        }

        const primary = document.createElement('div');
        primary.className = 'nhm-tag-primary';
        if (isDynHeader) {
          const pickBadge = document.createElement('span');
          pickBadge.className = 'nhm-tag-dyn-badge';
          pickBadge.textContent = pickBadgeText;
          primary.appendChild(pickBadge);
        } else if ((Math.abs(weightVal - 1.0) > 0.001 || isCompHeader || isCompFooter) && !isNewline) {
          const badge = document.createElement('span');
          badge.className = `nhm-tag-weight-badge ${weightVal > 1.0 ? 'w-pos' : (weightVal < 1.0 ? 'w-neg' : '')}`;
          badge.textContent = weightVal.toFixed(1);
          primary.appendChild(badge);
        }
        const textSpan = document.createElement('span');
        textSpan.className = 'nhm-tag-text';
        textSpan.textContent = displayTagName;
        primary.appendChild(textSpan);
        if (dynWeightBadgeText) {
          const dynWeightBadge = document.createElement('span');
          dynWeightBadge.className = 'nhm-tag-dyn-weight';
          dynWeightBadge.textContent = dynWeightBadgeText;
          primary.appendChild(dynWeightBadge);
        }

        capsule.appendChild(primary);

        if (freq > 1 && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
          const dup = document.createElement('span');
          dup.className = 'nhm-tag-duplicate-badge';
          dup.textContent = `x${freq}`;
          itemNode.appendChild(dup);
        }

        itemNode.appendChild(capsule);

        if (!isNewline) {
          const zhRow = document.createElement('div');
          zhRow.className = 'nhm-tag-zh-row';
          const secondaryText = (typeof tag.aiZhTranslation === 'string' && tag.aiZhTranslation.trim())
            ? tag.aiZhTranslation.trim()
            : (typeof tag.aiOriginal === 'string' && tag.aiOriginal.trim())
            ? tag.aiOriginal.trim()
            : ((info && info.zhCN) || '');
          zhRow.textContent = secondaryText || '\u00A0';
          itemNode.appendChild(zhRow);
        }

        if (isDynFooter) inDynGroupRef.val = false;
        return itemNode;
      }

      // ── 统一的分段逻辑 ─────────────────────────────────────
      const segments = [];
      let currentSeg = { tags: [], dividerName: '', groupColor: '', isGroup: false };

      tags.forEach(t => {
        currentSeg.tags.push(t);
        if (t.value === '\n') {
          currentSeg.dividerName = t.dividerName || '';
          currentSeg.groupColor = t.groupColor || '';
          currentSeg.isGroup = true;
          segments.push(currentSeg);
          currentSeg = { tags: [], dividerName: '', groupColor: '', isGroup: false };
        }
      });
      // 末尾散拍段
      if (currentSeg.tags.length > 0) {
        segments.push(currentSeg);
      }

      const inDynGroupRef = { val: false };
      let currentOffset = 0;
      segments.forEach(seg => {
        if (seg.isGroup && globalEnableGrouping) {
          // 渲染为分组框
          const displayTags = seg.tags.filter(t => t.value !== '\n');
          // 只要是闭合的分组，即使没有标签（空分组），也渲染方框（此时 box 只有 padding 高度）
          const box = document.createElement('div');
          box.className = 'nhm-group-box';
          const color = seg.groupColor;
          if (color) {
            box.style.borderColor = color;
            const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
            box.style.background = `rgba(${r},${g},${b},0.05)`;
          }

          seg.tags.forEach(t => {
            if (t.value === '\n') {
                currentOffset++;
                return;
            }
            const val = t.value;
            let clean = val;
            let m = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            if (m) clean = m[2];
            else if (val.startsWith('{') || val.startsWith('[')) {
              let str = val;
              while ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
                str = str.slice(1, -1);
              }
              clean = str;
            }
            const key = (typeof toCanonicalHistoryTagKey === 'function') ? toCanonicalHistoryTagKey(clean) : clean.trim().toLowerCase();
            const freq = (key && tagFreq[key]) || 0;
            const node = renderOneTag(t, currentOffset++, tags, inDynGroupRef, freq);
            if (node) box.appendChild(node);
          });

          if (seg.dividerName) {
            const badge = document.createElement('span');
            badge.className = 'nhm-group-badge';
            badge.textContent = seg.dividerName;
            if (color) badge.style.borderLeftColor = color;
            box.appendChild(badge);
          }
          container.appendChild(box);
        } else {
          // 渲染为散拍标签
          seg.tags.forEach(t => {
            const val = t.value;
            let clean = val;
            let m = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            if (m) clean = m[2];
            else if (val.startsWith('{') || val.startsWith('[')) {
              let str = val;
              while ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
                str = str.slice(1, -1);
              }
              clean = str;
            }
            const key = (typeof toCanonicalHistoryTagKey === 'function') ? toCanonicalHistoryTagKey(clean) : clean.trim().toLowerCase();
            const freq = (key && tagFreq[key]) || 0;
            const node = renderOneTag(t, currentOffset++, tags, inDynGroupRef, freq);
            if (node) container.appendChild(node);
          });
        }
      });
    }



    // ───── 从 chrome.storage 读写 ────────────────────────────────
    // 本模块运行在扩展隔离环境，历史数据不再通过官网页面的 postMessage 暴露。
    async function getHistoryData() {
      const data = await chrome.storage.local.get([
        'promptHistory',
        'historyLimit',
        'groupColorMap',
        'groupTranslationMap',
        'enableGrouping'
      ]);

      globalEnableGrouping = data.enableGrouping !== undefined ? data.enableGrouping : true;
      return {
        history: Array.isArray(data.promptHistory) ? data.promptHistory : [],
        limit: Number.isFinite(Number(data.historyLimit)) ? Number(data.historyLimit) : 100,
        groupColorMap: data.groupColorMap && typeof data.groupColorMap === 'object' ? data.groupColorMap : {},
        groupTranslationMap: data.groupTranslationMap && typeof data.groupTranslationMap === 'object' ? data.groupTranslationMap : {},
        enableGrouping: globalEnableGrouping
      };
    }

    function saveHistoryData(history) {
      if (!Array.isArray(history)) return;
      chrome.storage.local.set({ promptHistory: history });
    }

    function saveLimitData(limit) {
      const normalizedLimit = Math.max(10, Math.min(1000, Number.parseInt(limit, 10) || 100));
      chrome.storage.local.set({ historyLimit: normalizedLimit });
    }

    // ───── Modal 主体 ──────────────────────────────────────────
    let currentTab = 'history'; // 'history' | 'favorites'
    let selectedSnapshot = null;
    let historyData = [];
    let historyLimit = 100;
    let currentGroupColorMap = {};
    let currentGroupTranslationMap = {};
    let globalEnableGrouping = true;
    let currentDictionaryTagMap = null;
    let currentDictionaryLoadPromise = null;

    const HISTORY_DICT_COLOR_MAP = {
      '0': 'lightblue',
      '1': 'indianred',
      '3': 'violet',
      '4': 'lightgreen',
      '5': 'orange',
      '6': 'red',
      '7': 'lightblue',
      '8': 'gold',
      '9': 'gold',
      '10': 'violet',
      '11': 'lightgreen',
      '12': 'tomato',
      '14': 'whitesmoke',
      '15': 'seagreen'
    };

    function toCanonicalHistoryTagKey(value) {
      const groupTagsDataUtils = getGroupTagsDataUtils();
      if (groupTagsDataUtils.toCanonicalTagKey) {
        return groupTagsDataUtils.toCanonicalTagKey(value);
      }
      return String(value || '').trim().toLowerCase();
    }

    function buildHistoryDictionaryMap(entries) {
      const groupTagsDataUtils = getGroupTagsDataUtils();
      const map = new Map();

      (entries || []).forEach(entry => {
        const rawTag = String(entry?.tag || '').trim();
        if (!rawTag) return;

        const canonicalText = groupTagsDataUtils.toCanonicalTagKey
          ? groupTagsDataUtils.toCanonicalTagKey(rawTag)
          : rawTag.toLowerCase();
        if (!canonicalText) return;

        const displayText = groupTagsDataUtils.canonicalToDisplayTag
          ? groupTagsDataUtils.canonicalToDisplayTag(canonicalText)
          : canonicalText.replace(/_/g, ' ');
        const normalized = {
          text: canonicalText,
          color: HISTORY_DICT_COLOR_MAP[String(entry.color ?? 0)] || 'lightblue',
          pop: Number(entry.count) || 0,
          zhCN: entry.zhCN || '',
          aliases: entry.aliases || ''
        };

        const candidateKeys = [
          canonicalText,
          displayText.toLowerCase(),
          canonicalText.replace(/_/g, ' '),
          canonicalText.replace(/ /g, '_')
        ];

        candidateKeys.forEach(key => {
          const normalizedKey = String(key || '').trim().toLowerCase();
          if (normalizedKey && !map.has(normalizedKey)) {
            map.set(normalizedKey, normalized);
          }
        });
      });

      return map;
    }

    async function ensureHistoryDictionaryMapLoaded(forceReload = false) {
      if (!forceReload && currentDictionaryTagMap) return currentDictionaryTagMap;
      if (!forceReload && currentDictionaryLoadPromise) return currentDictionaryLoadPromise;

      currentDictionaryLoadPromise = (async () => {
        const groupTagsDataUtils = getGroupTagsDataUtils();

        if (groupTagsDataUtils.loadEffectiveDictionaryData) {
          const dictionaryData = await groupTagsDataUtils.loadEffectiveDictionaryData();
          currentDictionaryTagMap = buildHistoryDictionaryMap(dictionaryData.entries || []);
          return currentDictionaryTagMap;
        }

        currentDictionaryTagMap = window.__autocompleteMap__ || null;
        return currentDictionaryTagMap;
      })()
        .catch(err => {
          console.error('[Wildcard] Failed to load history dictionary map:', err);
          currentDictionaryTagMap = window.__autocompleteMap__ || null;
          return currentDictionaryTagMap;
        })
        .finally(() => {
          currentDictionaryLoadPromise = null;
        });

      return currentDictionaryLoadPromise;
    }

    function createModal() {
      if (document.getElementById('nai-history-backdrop')) return;

      const backdrop = document.createElement('div');
      backdrop.id = 'nai-history-backdrop';

      const container = document.createElement('div');
      container.id = MODAL_ID;
      
      // === 构建核心骨架 ===
      container.innerHTML = `
        <div class="nhm-header">
          <div class="nhm-title-area">
            <span class="nhm-title">📚 提示词记录</span>
            <span class="nhm-subtitle" id="nhm-stats"></span>
          </div>
          <button class="nhm-close-btn" id="nhm-close" title="关闭 (Esc)">×</button>
        </div>
        
        <div class="nhm-body">
          <div class="nhm-sidebar">
            <div class="nhm-tabs">
              <button class="nhm-tab active" data-tab="history">🕒 历史记录</button>
              <button class="nhm-tab" data-tab="favorites">⭐️ 我的收藏</button>
            </div>
            <div class="nhm-list" id="nhm-list"></div>
            <div class="nhm-footer">
              <div class="nhm-footer-row">
                <span>历史上限:</span>
                <input class="nhm-limit-input" id="nhm-limit-input" type="number" min="10" max="1000" value="100">
                <button class="nhm-clear-btn" id="nhm-clear-btn">清除历史</button>
              </div>
            </div>
          </div>
          
          <div class="nhm-detail">
            <div class="nhm-detail-placeholder" id="nhm-placeholder">← 从左侧选择一条记录进行预览</div>
            <div class="nhm-detail-content" id="nhm-detail-content" style="display:none;"></div>
            <div class="nhm-detail-actions" id="nhm-actions" style="display:none;">
              <div class="nhm-detail-meta" id="nhm-detail-meta"></div>
              <button class="nhm-restore-btn" id="nhm-restore-btn">⏮️ 恢复至此状态</button>
            </div>
          </div>
        </div>

        <!-- 差异详情独立弹窗 -->
        <div class="nhm-diff-modal" id="nhm-diff-modal">
          <div class="nhm-diff-modal-content">
            <div class="nhm-diff-modal-header">
              <span class="nhm-diff-modal-title">完整变动详情 (Diff)</span>
              <button class="nhm-diff-modal-close" id="nhm-diff-modal-close">×</button>
            </div>
            <div class="nhm-diff-modal-body" id="nhm-diff-modal-body"></div>
          </div>
        </div>
      `;

      document.body.appendChild(container);

      // Diff Modal 事件绑定
      const diffModal = document.getElementById('nhm-diff-modal');
      document.getElementById('nhm-diff-modal-close').addEventListener('click', () => {
        diffModal.classList.remove('visible');
      });
      diffModal.addEventListener('click', (e) => {
        if (e.target === diffModal) diffModal.classList.remove('visible');
      });

      backdrop.appendChild(container);
      document.body.appendChild(backdrop);

      // 关闭
      backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
      document.getElementById('nhm-close').addEventListener('click', closeModal);

      // Tab 切换
      container.querySelectorAll('.nhm-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.nhm-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentTab = tab.dataset.tab;
          
          // 切换 Tab 时重置批量管理状态
          batchMode = false;
          batchSelected.clear();
          lastCheckedIndex = -1;
          
          renderList();
        });
      });

      // 历史上限输入
      document.getElementById('nhm-limit-input').addEventListener('change', (e) => {
        const val = Math.max(10, Math.min(1000, parseInt(e.target.value) || 100));
        e.target.value = val;
        historyLimit = val;
        saveLimitData(val);
      });

      // 清除历史 (使用内联二次确认，避免原生 confirm 被浏览器屏蔽)
      let clearConfirmTimeout;
      const clearBtn = document.getElementById('nhm-clear-btn');
      clearBtn.addEventListener('click', () => {
        if (clearBtn.dataset.confirming !== 'true') {
          // 第一次点击：进入确认状态
          clearBtn.dataset.confirming = 'true';
          const originalText = clearBtn.textContent;
          clearBtn.textContent = '确定清除?';
          clearBtn.style.backgroundColor = '#e74c3c';
          clearBtn.style.color = '#fff';
          
          clearConfirmTimeout = setTimeout(() => {
            clearBtn.dataset.confirming = 'false';
            clearBtn.textContent = originalText;
            clearBtn.style.backgroundColor = '';
            clearBtn.style.color = '';
          }, 3000);
          return;
        }

        // 第二次点击：执行清除
        clearTimeout(clearConfirmTimeout);
        clearBtn.dataset.confirming = 'false';
        clearBtn.textContent = '清除历史';
        clearBtn.style.backgroundColor = '';
        clearBtn.style.color = '';

        const favOnly = historyData.filter(s => s.isFavorite);
        historyData = favOnly;
        saveHistoryData(historyData); // 统一使用这个接口，无需专门的 __CLEAR_HISTORY__
        
        if (selectedSnapshot && !selectedSnapshot.isFavorite) {
          selectedSnapshot = null;
          showPlaceholder();
        }
        renderList();
      });

      // ESC 关闭
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('nai-history-backdrop')?.classList.contains('visible')) {
          closeModal();
        }
      });
    }

    function closeModal() {
      const backdrop = document.getElementById('nai-history-backdrop');
      if (backdrop) backdrop.classList.remove('visible');
    }

    function showPlaceholder() {
      document.getElementById('nhm-placeholder').style.display = 'flex';
      document.getElementById('nhm-detail-content').style.display = 'none';
      document.getElementById('nhm-actions').style.display = 'none';
    }

    // ── 跟踪文件夹展开状态 ──
    let folderOpenState = {}; // { folderId: true/false }

    function renderList() {
      const list = document.getElementById('nhm-list');
      if (!list) return;

      // 移除之前可能残留的工具栏
      const oldToolbar = list.parentElement.querySelector('.nhm-fav-toolbar');
      if (oldToolbar) oldToolbar.remove();

      const filtered = currentTab === 'favorites'
        ? historyData.filter(s => s.isFavorite || s.isFolder)
        : historyData.filter(s => !s.isFavorite && !s.isFolder);

      // 统计信息
      const normalCount = historyData.filter(s => !s.isFavorite && !s.isFolder).length;
      const favCount = historyData.filter(s => s.isFavorite).length;
      const stats = document.getElementById('nhm-stats');
      if (stats) stats.textContent = `普通: ${normalCount} 条 · 收藏: ${favCount} 项`;

      // 收藏页工具栏（新建文件夹按钮）
      if (currentTab === 'favorites') {
        const toolbar = document.createElement('div');
        toolbar.className = 'nhm-fav-toolbar';
        
        if (!batchMode) {
          // 普通模式工具栏
          const newFolderBtn = document.createElement('button');
          newFolderBtn.className = 'nhm-toolbar-btn';
          newFolderBtn.textContent = '📁 新建文件夹';
          newFolderBtn.addEventListener('click', () => {
            const folder = {
              id: 'folder-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
              isFolder: true,
              isFavorite: true,
              name: '新建文件夹',
              timestamp: Date.now()
            };
            historyData.unshift(folder);
            folderOpenState[folder.id] = true;
            saveHistoryData(historyData);
            renderList();
          });
          toolbar.appendChild(newFolderBtn);

          // 导出收藏夹按钮
          const exportBtn = document.createElement('button');
          exportBtn.className = 'nhm-toolbar-btn';
          exportBtn.textContent = '📤 导出';
          exportBtn.addEventListener('click', () => {
            // 从 historyData 中过滤出所有收藏项和文件夹
            const favData = historyData.filter(s => s.isFavorite || s.isFolder);
            const json = JSON.stringify(favData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().slice(0, 10);
            a.download = `favorites-export-${date}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            // 可视反馈
            exportBtn.textContent = '✅ 已导出';
            setTimeout(() => { exportBtn.textContent = '📤 导出'; }, 1500);
          });
          toolbar.appendChild(exportBtn);

          // 导入收藏夹按钮
          const importBtn = document.createElement('label');
          importBtn.className = 'nhm-toolbar-btn';
          importBtn.textContent = '📥 导入';
          importBtn.style.cursor = 'pointer';
          const importInput = document.createElement('input');
          importInput.type = 'file';
          importInput.accept = '.json';
          importInput.style.display = 'none';

          importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const originalText = importBtn.childNodes[0].nodeValue; // 取出文本节点
            const reader = new FileReader();
            reader.onload = (event) => {
              try {
                const importedData = JSON.parse(event.target.result);
                if (!Array.isArray(importedData)) throw new Error('Invalid format');
                
                const existingIds = new Set(historyData.map(item => item.id));
                let addedCount = 0;
                
                // 将导入的项目强制设为收藏属性，合并进现存列表
                importedData.forEach(item => {
                  if (item && item.id && !existingIds.has(item.id)) {
                    item.isFavorite = true;
                    historyData.unshift(item);
                    existingIds.add(item.id);
                    addedCount++;
                  }
                });
                
                if (addedCount > 0) {
                  saveHistoryData(historyData);
                  renderList();
                }
                
                importBtn.childNodes[0].nodeValue = `✅ 导入了 ${addedCount} 项`;
                setTimeout(() => { importBtn.childNodes[0].nodeValue = originalText; }, 2000);
              } catch (err) {
                console.error('[Favorites Import Error]', err);
                importBtn.childNodes[0].nodeValue = '❌ 解析失败';
                setTimeout(() => { importBtn.childNodes[0].nodeValue = originalText; }, 2000);
              }
              e.target.value = '';
            };
            reader.readAsText(file);
          });

          importBtn.appendChild(importInput);
          toolbar.appendChild(importBtn);

          const manageBtn = document.createElement('button');
          manageBtn.className = 'nhm-toolbar-btn';
          manageBtn.style.marginLeft = 'auto';
          manageBtn.textContent = '✅ 管理';
          manageBtn.addEventListener('click', () => {
            batchMode = true;
            batchSelected.clear();
            lastCheckedIndex = -1;
            renderList();
          });
          toolbar.appendChild(manageBtn);
        } else {
          // 批量管理模式工具栏
          const batchToolbar = document.createElement('div');
          batchToolbar.className = 'nhm-batch-toolbar';
          
          const selAllBtn = document.createElement('button');
          selAllBtn.className = 'nhm-batch-btn';
          selAllBtn.textContent = '全选';
          selAllBtn.onclick = () => {
            filtered.filter(s => !s.isFolder).forEach(s => batchSelected.add(s.id));
            renderList();
          };
          
          const selNoneBtn = document.createElement('button');
          selNoneBtn.className = 'nhm-batch-btn';
          selNoneBtn.textContent = '取消';
          selNoneBtn.onclick = () => {
            batchSelected.clear();
            renderList();
          };

          // 移入文件夹按钮
          const moveWrap = document.createElement('div');
          moveWrap.className = 'nhm-batch-move-wrap';
          const moveBtn = document.createElement('button');
          moveBtn.className = 'nhm-batch-btn';
          moveBtn.textContent = `移至...`;
          
          const dropdown = document.createElement('div');
          dropdown.className = 'nhm-batch-dropdown';
          
          // 渲染文件夹选项
          const folders = historyData.filter(s => s.isFolder);
          const rootOpt = document.createElement('div');
          rootOpt.className = 'nhm-batch-dropdown-item';
          rootOpt.textContent = '根目录';
          rootOpt.onclick = () => {
             batchSelected.forEach(id => {
               const item = historyData.find(s => s.id === id);
               if (item) delete item.folderId;
             });
             saveHistoryData(historyData);
             renderList();
          };
          dropdown.appendChild(rootOpt);

          folders.forEach(f => {
            const opt = document.createElement('div');
            opt.className = 'nhm-batch-dropdown-item';
            opt.textContent = `📁 ${f.name || '未命名'}`;
            opt.onclick = () => {
              batchSelected.forEach(id => {
                const item = historyData.find(s => s.id === id);
                if (item) item.folderId = f.id;
              });
              saveHistoryData(historyData);
              renderList();
            };
            dropdown.appendChild(opt);
          });

          moveBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('visible');
          };
          document.addEventListener('click', () => dropdown.classList.remove('visible'), { once: true });

          moveWrap.appendChild(moveBtn);
          moveWrap.appendChild(dropdown);

          const delBtn = document.createElement('button');
          delBtn.className = 'nhm-batch-btn danger';
          const selCount = batchSelected.size;
          delBtn.textContent = delBtn.dataset.confirm === 'true' ? '确定删除?' : `删除(${selCount})`;
          delBtn.onclick = (e) => {
            e.stopPropagation();
            if (selCount === 0) return;
            if (delBtn.dataset.confirm !== 'true') {
              delBtn.dataset.confirm = 'true';
              delBtn.textContent = '确定删除?';
              setTimeout(() => {
                delBtn.dataset.confirm = 'false';
                delBtn.textContent = `删除(${selCount})`;
              }, 3000);
              return;
            }
            // 执行批量删除
            historyData = historyData.filter(s => !batchSelected.has(s.id));
            batchSelected.clear();
            saveHistoryData(historyData);
            renderList();
          };

          const exitBtn = document.createElement('button');
          exitBtn.className = 'nhm-batch-btn';
          exitBtn.style.marginLeft = 'auto';
          exitBtn.textContent = '✖ 退出';
          exitBtn.onclick = () => {
            batchMode = false;
            batchSelected.clear();
            renderList();
          };

          batchToolbar.appendChild(selAllBtn);
          batchToolbar.appendChild(selNoneBtn);
          batchToolbar.appendChild(moveWrap);
          batchToolbar.appendChild(delBtn);
          batchToolbar.appendChild(exitBtn);
          toolbar.appendChild(batchToolbar);
        }

        list.parentElement.insertBefore(toolbar, list);
      }

      if (filtered.length === 0) {
        list.innerHTML = `
          <div class="nhm-empty-state">
            <div class="nhm-empty-icon">${currentTab === 'favorites' ? '⭐' : '🕰️'}</div>
            <div class="nhm-empty-title">${currentTab === 'favorites' ? '暂无收藏' : '暂无历史记录'}</div>
            <div class="nhm-empty-desc">${currentTab === 'favorites' ? '点击列表中的 ☆ 图标即可收藏您喜欢的提示词状态' : '生成图片时，您的提示词记录会自动保存在这里'}</div>
          </div>
        `;
        return;
      }

      list.innerHTML = '';

      if (currentTab === 'favorites') {
        // ── 收藏页：分文件夹渲染 ──
        // 按 sortOrder 排序（无 sortOrder 则按时间戳降序排列）
        const sortFn = (a, b) => {
          if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder;
          if (a.sortOrder !== undefined) return -1;
          if (b.sortOrder !== undefined) return 1;
          return (b.timestamp || 0) - (a.timestamp || 0);
        };
        const folders = filtered.filter(s => s.isFolder).sort(sortFn);
        const items = filtered.filter(s => !s.isFolder).sort(sortFn);
        const itemsInFolders = new Set();

        // 先渲染文件夹
        folders.forEach(folder => {
          const children = items.filter(s => s.folderId === folder.id).sort(sortFn);
          children.forEach(c => itemsInFolders.add(c.id));

          const folderEl = document.createElement('div');
          folderEl.className = 'nhm-folder-item';
          folderEl.dataset.folderId = folder.id;

          const isOpen = folderOpenState[folder.id] !== false; // 默认展开

          // 文件夹头
          const headerEl = document.createElement('div');
          headerEl.className = 'nhm-folder-header' + (isOpen ? ' open' : '');

          headerEl.innerHTML = `
            <div class="nhm-item-icon" title="拖拽排序">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>
              </svg>
            </div>
            <span class="nhm-folder-arrow ${isOpen ? 'open' : ''}">▶</span>
            <span class="nhm-folder-name" title="双击重命名">${escapeHtml(folder.name || '未命名文件夹')}</span>
            <span class="nhm-folder-count">${children.length} 项</span>
            <button class="nhm-folder-delete" title="删除文件夹">🗑</button>
          `;

          // 展开/收起
          headerEl.addEventListener('click', (e) => {
            if (e.target.closest('.nhm-folder-delete') || e.target.closest('.nhm-folder-name') || e.target.tagName === 'INPUT') return;
            folderOpenState[folder.id] = !isOpen;
            renderList();
          });

          // 文件夹名双击重命名
          const nameSpan = headerEl.querySelector('.nhm-folder-name');
          nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.value = folder.name || '';
            input.style.cssText = 'background:#2a2a40;border:1px solid #3a3a5c;color:#ccc;border-radius:3px;padding:1px 4px;font-size:12px;width:80%;';
            nameSpan.replaceWith(input);
            input.focus();
            const save = () => {
              folder.name = input.value.trim() || '未命名文件夹';
              const idx = historyData.findIndex(s => s.id === folder.id);
              if (idx !== -1) historyData[idx] = folder;
              saveHistoryData(historyData);
              renderList();
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { save(); ev.preventDefault(); } });
            // 防止点击和拖拽选择文字时触发父级的 renderList 或 Sortable 逻辑
            input.addEventListener('mousedown', e => e.stopPropagation());
            input.addEventListener('click', e => e.stopPropagation());
          });

          // 删除文件夹（双击/二段点击保护，子项释放回根目录）
          const folderDelBtn = headerEl.querySelector('.nhm-folder-delete');
          let isDeletingFolder = false;
          let deleteTimeoutFolder;

          folderDelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isDeletingFolder) {
              isDeletingFolder = true;
              folderDelBtn.innerHTML = '✔';
              folderDelBtn.style.color = '#ef4444';
              folderDelBtn.title = "再次点击确认删除 (3s后还原)";
              deleteTimeoutFolder = setTimeout(() => {
                if (isDeletingFolder) {
                  isDeletingFolder = false;
                  folderDelBtn.innerHTML = '🗑';
                  folderDelBtn.style.color = '';
                  folderDelBtn.title = "删除文件夹";
                }
              }, 3000);
              return;
            }
            clearTimeout(deleteTimeoutFolder);
            // 释放子项
            children.forEach(child => { delete child.folderId; });
            historyData = historyData.filter(s => s.id !== folder.id);
            delete folderOpenState[folder.id];
            saveHistoryData(historyData);
            renderList();
          });

          // 文件夹拖放目标事件（已迁移至 Sortable.js）

          folderEl.appendChild(headerEl);

          // 文件夹的子内容区
          const contentEl = document.createElement('div');
          contentEl.className = 'nhm-folder-content' + (isOpen ? '' : ' collapsed');

          children.forEach(snapshot => {
            contentEl.appendChild(buildFavItem(snapshot));
          });

          folderEl.appendChild(contentEl);
          list.appendChild(folderEl);
        });

        // 渲染未归档的"根目录"收藏项
        const rootItems = items.filter(s => !itemsInFolders.has(s.id));
        rootItems.forEach(snapshot => {
          list.appendChild(buildFavItem(snapshot));
        });

        // ── Sortable.js 实例化：拖拽排序与跨组穿梭 ──
        if (!batchMode) {
          initSortableForFavorites(list);
        } else {
          // 管理模式下保证销毁所有拖拽实例
          sortableInstances.forEach(inst => {
            try { inst.destroy(); } catch(e) {}
          });
          sortableInstances = [];
        }

      } else {
        // ── 历史页：与之前逻辑相同 ──
        filtered.forEach((snapshot, ObjectIndex) => {
          const item = buildHistoryItem(snapshot, filtered, ObjectIndex);
          list.appendChild(item);
        });
      }
    }

    // ── 构建历史列表项 ──
    function buildHistoryItem(snapshot, filtered, ObjectIndex) {
      const item = document.createElement('div');
      item.className = 'nhm-item' + (selectedSnapshot?.id === snapshot.id ? ' selected' : '');
      item.dataset.id = snapshot.id;

      const previewHTML = generateDiffHTML(snapshot, filtered[ObjectIndex + 1]);

      // 检查是否已被收藏全文（排除仅仅由于局部片段被收藏的情况）
      const favoriteClone = historyData.find(s => s.isFavorite && s.originId === snapshot.id && !s.isPartial);
      const isActuallyStarred = !!favoriteClone;

      item.innerHTML = `
        <div class="nhm-item-main">
          <div class="nhm-item-time">${formatTime(snapshot.timestamp)}</div>
          ${previewHTML}
        </div>
        <button class="nhm-star-btn ${isActuallyStarred ? 'starred' : ''}" title="${isActuallyStarred ? '取消收藏' : '收藏全文'}">
          ${isActuallyStarred ? '★' : '☆'}
        </button>
        <button class="nhm-delete-btn" title="删除此条">🗑</button>
      `;

      // 点击选中
      item.addEventListener('click', (e) => {
        if (e.target.closest('.nhm-star-btn') || e.target.closest('.nhm-delete-btn')) return;
        selectedSnapshot = snapshot;
        document.getElementById('nhm-list').querySelectorAll('.nhm-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        renderDetail(snapshot);
      });

      // 收藏切换
      const starBtn = item.querySelector('.nhm-star-btn');
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 同样在点击交互时，只对“全文收藏”进行 toggle
        const favClone = historyData.find(s => s.isFavorite && s.originId === snapshot.id && !s.isPartial);
        if (favClone) {
          historyData = historyData.filter(s => s.id !== favClone.id);
        } else {
          const clone = JSON.parse(JSON.stringify(snapshot));
          clone.id = 'fav-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
          clone.isFavorite = true;
          clone.originId = snapshot.id;
          historyData.unshift(clone);
        }
        saveHistoryData(historyData);
        renderList();
      });

      // 删除 (双击/二段点击保护)
      const delBtn = item.querySelector('.nhm-delete-btn');
      let isDeleting = false;
      let deleteTimeout;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isDeleting) {
          isDeleting = true;
          delBtn.innerHTML = '✔';
          delBtn.style.color = '#ef4444';
          delBtn.title = "再次点击确认删除 (3s后还原)";
          deleteTimeout = setTimeout(() => {
            if (isDeleting) {
              isDeleting = false;
              delBtn.innerHTML = '🗑';
              delBtn.style.color = '';
              delBtn.title = "删除此条";
            }
          }, 3000);
          return;
        }
        clearTimeout(deleteTimeout);
        historyData = historyData.filter(s => s.id !== snapshot.id);
        saveHistoryData(historyData);
        if (selectedSnapshot?.id === snapshot.id) { selectedSnapshot = null; showPlaceholder(); }
        renderList();
      });

      // Diff 弹窗展开胶囊
      const expandCapsule = item.querySelector('.nhm-diff-expand-capsule');
      if (expandCapsule) {
        expandCapsule.addEventListener('click', (e) => {
          e.stopPropagation();
          const diffModal = document.getElementById('nhm-diff-modal');
          const diffBody = document.getElementById('nhm-diff-modal-body');
          if (diffModal && diffBody) {
            diffBody.innerHTML = `<div class="nhm-item-diff-container">${expandCapsule.dataset.fulldiff}</div>`;
            diffModal.classList.add('visible');
          }
        });
      }
      return item;
    }

    // ── Sortable.js 实例化核心 ──
    // 修正#1: 维护实例数组，防止 renderList 反复创建导致内存泄漏
    let sortableInstances = [];

    // ── 批量管理状态 ──
    let batchMode = false;
    let batchSelected = new Set();
    let lastCheckedIndex = -1; // 用于 Shift 连选

    function initSortableForFavorites(listEl) {
      // 销毁上一轮遗留的所有 Sortable 实例
      sortableInstances.forEach(inst => {
        try { inst.destroy(); } catch(e) { /* 已被 DOM 移除则忽略 */ }
      });
      sortableInstances = [];

      if (typeof Sortable === 'undefined') {
        console.warn('[NHM] Sortable.js 未加载，跳过排序初始化');
        return;
      }

      const groupConfig = { name: 'favorites', pull: true, put: true };

      // 辅助：从当前 DOM 顺序反推并精准更新 historyData 的排序
      function syncOrderFromDOM(listContainer) {
        // 收集所有"根级"元素的 ID 顺序（包括文件夹和根级卡片）
        const rootEls = listContainer.children;
        let sortIndex = 0;

        for (const el of rootEls) {
          // 文件夹元素
          if (el.classList.contains('nhm-folder-item')) {
            const folderId = el.dataset.folderId;
            const folderData = historyData.find(s => s.id === folderId);
            if (folderData) folderData.sortOrder = sortIndex++;

            // 文件夹内部的子元素
            const contentEl = el.querySelector('.nhm-folder-content');
            if (contentEl) {
              let childOrder = 0;
              for (const childEl of contentEl.children) {
                const childId = childEl.dataset?.id;
                if (!childId) continue;
                const childData = historyData.find(s => s.id === childId);
                if (childData) {
                  childData.folderId = folderId; // 确保归属正确
                  childData.sortOrder = childOrder++;
                }
              }
            }
          }
          // 根级卡片
          else if (el.dataset?.id) {
            const itemData = historyData.find(s => s.id === el.dataset.id);
            if (itemData) {
              delete itemData.folderId; // 在根级意味着不属于任何文件夹
              itemData.sortOrder = sortIndex++;
            }
          }
        }

        saveHistoryData(historyData);

        // 局部刷新文件夹头部的计数显示
        listContainer.querySelectorAll('.nhm-folder-item').forEach(folderEl => {
          const fId = folderEl.dataset.folderId;
          const contentEl = folderEl.querySelector('.nhm-folder-content');
          const countEl = folderEl.querySelector('.nhm-folder-count');
          if (contentEl && countEl) {
            countEl.textContent = `${contentEl.children.length} 项`;
          }
        });
      }

      // 修正#2: 使用 handle 模式，仅图标可拖拽，不阻断双击/按钮
      const commonOptions = {
        group: groupConfig,
        animation: 150,
        handle: '.nhm-item-icon',
        ghostClass: 'nhm-sortable-ghost',
        chosenClass: 'nhm-sortable-chosen',
        dragClass: 'nhm-sortable-drag',
        // 修正#5: 阻止文件夹被拖进另一个文件夹
        onMove: function(evt) {
          const draggedEl = evt.dragged;
          // 如果被拖拽的是文件夹，不允许放入文件夹子容器
          if (draggedEl.classList.contains('nhm-folder-item') &&
              evt.to.classList.contains('nhm-folder-content')) {
            return false;
          }
          return true;
        },
        // 修正#3: onEnd 只更新数据层，不调用 renderList 避免闪烁
        onEnd: function(evt) {
          syncOrderFromDOM(listEl);
        }
      };

      // 为根列表容器实例化 Sortable
      const rootSortable = new Sortable(listEl, {
        ...commonOptions,
        // 根容器内文件夹本身也可以被排序（但 onMove 阻止嵌套）
      });
      sortableInstances.push(rootSortable);

      // 为每个文件夹内部子容器实例化独立的 Sortable（无论是否折叠，Sortable 能自动忽略 display:none）
      listEl.querySelectorAll('.nhm-folder-content').forEach(contentEl => {
        const folderSortable = new Sortable(contentEl, {
          ...commonOptions,
        });
        sortableInstances.push(folderSortable);
      });
    }

    // ── 构建收藏列表项（含拖拽和局部标记） ──
    function buildFavItem(snapshot) {
      const item = document.createElement('div');
      item.className = 'nhm-item' + 
        (selectedSnapshot?.id === snapshot.id ? ' selected' : '') +
        (batchSelected.has(snapshot.id) ? ' batch-selected' : '');
      item.dataset.id = snapshot.id;

      // 1. 左侧图标或 Checkbox
      let leftIcon;
      if (batchMode) {
        const isChecked = batchSelected.has(snapshot.id);
        leftIcon = `
          <div class="nhm-item-checkbox-wrap">
            <div class="nhm-batch-checkbox ${isChecked ? 'checked' : ''}"></div>
          </div>
        `;
      } else {
        // 原有的图标逻辑
        let iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nhm-item-icon" style="color: #666; margin-right: 8px; flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
        if (snapshot.isPartial) {
          if (snapshot.partialType === 'positive') {
            iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nhm-item-icon pos" style="color: #a855f7; margin-right: 8px; flex-shrink: 0;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
          } else if (snapshot.partialType === 'negative') {
            iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nhm-item-icon neg" style="color: #f59e0b; margin-right: 8px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
          } else if (snapshot.partialType === 'character' || (snapshot.partialType && snapshot.partialType.startsWith('character-'))) {
            iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nhm-item-icon char" style="color: #14b8a6; margin-right: 8px; flex-shrink: 0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
          }
        }
        leftIcon = iconSvg;
      }

      const displayName = escapeHtml(snapshot.name || formatTime(snapshot.timestamp));
      
      item.innerHTML = `
        <div class="nhm-item-main" style="display: flex; align-items: center; justify-content: space-between; flex-direction: row; width: 100%;">
          <div class="nhm-item-name-wrap" title="${batchMode ? '点击选中' : '双击重命名'}" style="flex-grow: 1; display:flex; align-items:center;">
            ${leftIcon}
            <span class="nhm-item-name" style="color: #e0e0e0; font-size: 13px; font-weight: 500; min-width: 50px;">${displayName}</span>
          </div>
        </div>
        ${!batchMode ? '<button class="nhm-delete-btn" title="删除此条">🗑</button>' : ''}
      `;

      // 点击识别逻辑
      item.addEventListener('click', (e) => {
        if (e.target.closest('.nhm-delete-btn') || e.target.tagName === 'INPUT') return;
        
        if (batchMode) {
          // 查找当前项在 filtered (且非文件夹) 列表中的索引，用于 Shift 连选
          const selectableItems = Array.from(document.querySelectorAll('#nhm-list .nhm-item'));
          const currentIndex = selectableItems.indexOf(item);
          
          const toggleId = snapshot.id;
          if (e.shiftKey && lastCheckedIndex !== -1) {
            // Shift 连选逻辑
            const start = Math.min(lastCheckedIndex, currentIndex);
            const end = Math.max(lastCheckedIndex, currentIndex);
            const shouldAdd = !batchSelected.has(toggleId); // 根据当前点击项决定是连选还是连取消
            
            for (let i = start; i <= end; i++) {
              const sid = selectableItems[i].dataset.id;
              if (sid) {
                if (shouldAdd) batchSelected.add(sid);
                else batchSelected.delete(sid);
              }
            }
          } else {
            // 普通单选
            if (batchSelected.has(toggleId)) batchSelected.delete(toggleId);
            else batchSelected.add(toggleId);
          }
          lastCheckedIndex = currentIndex;
          renderList();
        } else {
          // 普通模式：选中详情
          selectedSnapshot = snapshot;
          document.getElementById('nhm-list').querySelectorAll('.nhm-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          renderDetail(snapshot);
        }
      });

      // 双击重命名
      const nameWrapperEl = item.querySelector('.nhm-item-name-wrap');
      const nameEl = item.querySelector('.nhm-item-name');
      if (nameWrapperEl && nameEl) {
        nameWrapperEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          // 只把原始名称填入。如果是默认时间戳则留空，让其作为 placeholder
          input.value = snapshot.name || '';
          input.placeholder = formatTime(snapshot.timestamp);
          input.style.cssText = 'background:transparent; border:none; outline:none; color:#fff; font-size:13px; font-weight:500; font-family:inherit; width:100%; padding:0; margin:0; box-shadow:0 1px 0 #818cf8; border-radius:0;';
          nameEl.replaceWith(input);
          input.focus();
          const save = () => {
            snapshot.name = input.value.trim() || ""; // 空则表示不特别命名，渲染时再调用 formatTime
            const idx = historyData.findIndex(s => s.id === snapshot.id);
            if (idx !== -1) historyData[idx] = snapshot;
            saveHistoryData(historyData);
            renderList();
          };
          input.addEventListener('blur', save);
          input.addEventListener('keydown', ev => { 
            if (ev.key === 'Enter') { save(); ev.preventDefault(); } 
            else if (ev.key === 'Escape') { input.value = snapshot.name || ''; save(); }
          });
          // 防止点击和拖拽选择文字时触发父级的渲染或选中逻辑
          input.addEventListener('mousedown', e => e.stopPropagation());
          input.addEventListener('click', e => e.stopPropagation());
        });
      }

      // 删除 (双击/二段点击保护)
      const delBtn = item.querySelector('.nhm-delete-btn');
      if (delBtn) {
        let isDeletingFav = false;
        let deleteTimeoutFav;
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!isDeletingFav) {
            isDeletingFav = true;
            delBtn.innerHTML = '✔';
            delBtn.style.color = '#ef4444';
            delBtn.title = "再次点击确认删除 (3s后还原)";
            deleteTimeoutFav = setTimeout(() => {
              if (isDeletingFav) {
                isDeletingFav = false;
                delBtn.innerHTML = '🗑';
                delBtn.style.color = '';
                delBtn.title = "删除此条";
              }
            }, 3000);
            return;
          }
          clearTimeout(deleteTimeoutFav);
          historyData = historyData.filter(s => s.id !== snapshot.id);
          saveHistoryData(historyData);
          if (selectedSnapshot?.id === snapshot.id) { selectedSnapshot = null; showPlaceholder(); }
          renderList();
        });
      }

      return item;
    }

    // ── 局部收藏辅助：创建精简版收藏快照 ──
    function createPartialFavorite(snapshot, partialType) {
      const clone = JSON.parse(JSON.stringify(snapshot));
      clone.id = 'fav-part-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      clone.isFavorite = true;
      clone.isPartial = true;
      clone.partialType = partialType && partialType.startsWith('character-') ? 'character' : partialType; // 'positive' | 'negative' | 'character'
      clone.originId = snapshot.id;

      // 根据 partialType 清除无关数据
      if (partialType === 'positive') {
        clone.negative = ''; clone.negativeTags = [];
        clone.characters = [];
        clone.name = clone.name || '正面提示词片段';
      } else if (partialType === 'negative') {
        clone.positive = ''; clone.positiveTags = [];
        clone.characters = [];
        clone.name = clone.name || '负面提示词片段';
      } else if (partialType.startsWith('character-')) {
        const charIdx = parseInt(partialType.split('-')[1]);
        const targetChar = (snapshot.characters || [])[charIdx];
        clone.positive = ''; clone.positiveTags = [];
        clone.negative = ''; clone.negativeTags = [];
        clone.characters = targetChar ? [JSON.parse(JSON.stringify(targetChar))] : [];
        clone.name = clone.name || '角色片段';
      }

      clone.timestamp = Date.now();
      return clone;
    }

    // ── 局部恢复辅助：发送带 isPartial 标记的恢复指令 ──
    function restorePartial(snapshot, partialType) {
      const partial = JSON.parse(JSON.stringify(snapshot));
      partial.isPartial = true;
      partial.partialType = partialType && partialType.startsWith('character-') ? 'character' : partialType;
      window.postMessage({ type: '__RESTORE_HISTORY__', snapshot: partial }, '*');
      closeModal();
    }

    // ── 构建区块标题行（含操作按钮）──
    function buildSectionHeader(titleText, cssClass, snapshot, partialType) {
      const header = document.createElement('div');
      header.className = `nhm-section-header ${cssClass}`;

      const title = document.createElement('span');
      title.className = `nhm-section-header-title ${cssClass}`;
      title.textContent = titleText;
      header.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'nhm-section-actions';

      // 收藏片段按钮
      const favBtn = document.createElement('button');
      favBtn.className = 'nhm-action-btn fav';
      favBtn.textContent = '⭐ 收藏片段';
      favBtn.title = '将此区块单独收藏';
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const partial = createPartialFavorite(snapshot, partialType);
        historyData.unshift(partial);
        saveHistoryData(historyData);
        // 如果当前在收藏页面，立即刷新列表以显示新收藏的片段
        if (currentTab === 'favorites') {
          renderList();
        }
        // 可视反馈
        favBtn.textContent = '✅ 已收藏';
        favBtn.style.color = '#4ade80';
        setTimeout(() => { favBtn.textContent = '⭐ 收藏片段'; favBtn.style.color = ''; }, 1500);
      });
      actions.appendChild(favBtn);

      // 仅恢复此段按钮
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'nhm-action-btn restore';
      restoreBtn.textContent = '⏮️ 仅恢复此段';
      restoreBtn.title = '仅将此区块的内容应用到当前编辑器，不影响其他区块';
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restorePartial(snapshot, partialType);
      });
      actions.appendChild(restoreBtn);

      header.appendChild(actions);
      return header;
    }

    function renderDetail(snapshot) {
      const content = document.getElementById('nhm-detail-content');
      const meta = document.getElementById('nhm-detail-meta');
      if (!content || !meta) return;

      content.style.display = 'block';
      document.getElementById('nhm-placeholder').style.display = 'none';
      document.getElementById('nhm-actions').style.display = 'flex';

      content.innerHTML = '';

      const charCount = (snapshot.characters || []).filter(c => c.posPrompt || c.negPrompt).length;
      // 如果是局部快照，在 meta 中追加标记
      let metaText = `记录于 ${formatTime(snapshot.timestamp)} · ${charCount} 个角色`;
      if (snapshot.isPartial) {
        const typeLabels = { positive: '正面', negative: '负面', character: '角色' };
        const label = typeLabels[snapshot.partialType] || snapshot.partialType;
        metaText += ` · 📌 局部片段 (${label})`;
      }
      meta.textContent = metaText;

      // 判断是否需要渲染各区块（局部快照仅渲染对应区块）
      const isCharacterPartial = snapshot.isPartial && (snapshot.partialType === 'character' || (snapshot.partialType && snapshot.partialType.startsWith('character-')));
      const showPositive = !snapshot.isPartial || snapshot.partialType === 'positive';
      const showNegative = !snapshot.isPartial || snapshot.partialType === 'negative';
      const showCharacters = !snapshot.isPartial || isCharacterPartial;

      // 正向
      if (showPositive) {
        const posSection = document.createElement('div');
        posSection.className = 'nhm-section';
        posSection.appendChild(buildSectionHeader('✅ 正向提示词 (Positive)', 'pos', snapshot, 'positive'));
        const posCloud = document.createElement('div');
        posCloud.className = 'nhm-tag-cloud';
        renderTagCloud(posCloud, snapshot.positiveTags || snapshot.positive);
        posSection.appendChild(posCloud);
        content.appendChild(posSection);
      }

      // 负向
      if (showNegative) {
        const negSection = document.createElement('div');
        negSection.className = 'nhm-section';
        negSection.appendChild(buildSectionHeader('🚫 负向提示词 (Negative)', 'neg', snapshot, 'negative'));
        const negCloud = document.createElement('div');
        negCloud.className = 'nhm-tag-cloud';
        renderTagCloud(negCloud, snapshot.negativeTags || snapshot.negative);
        negSection.appendChild(negCloud);
        content.appendChild(negSection);
      }

      // 角色
      if (showCharacters && snapshot.characters && snapshot.characters.length > 0) {
        snapshot.characters.forEach((char, idx) => {
          if (!char.posPrompt && !char.negPrompt) return;
          // 角色片段收藏只保留一个角色，详情里始终渲染第一个角色即可。
          if (isCharacterPartial && idx > 0) return;

          const charSection = document.createElement('div');
          charSection.className = 'nhm-section';
          charSection.appendChild(buildSectionHeader(`👤 角色 #${idx + 1}`, 'char', snapshot, 'character'));
          if (char.posPrompt) {
            const p = document.createElement('div');
            p.style.marginBottom = '6px';
            p.innerHTML = '<span style="font-size:10px;color:#555;">正向:</span>';
            const cloud = document.createElement('div');
            cloud.className = 'nhm-tag-cloud';
            cloud.style.marginTop = '4px';
            renderTagCloud(cloud, char.posTags || char.posPrompt);
            charSection.appendChild(p);
            charSection.appendChild(cloud);
          }
          if (char.negPrompt) {
            const p = document.createElement('div');
            p.style.marginTop = '8px';
            p.innerHTML = '<span style="font-size:10px;color:#555;">负向:</span>';
            const cloud = document.createElement('div');
            cloud.className = 'nhm-tag-cloud';
            cloud.style.marginTop = '4px';
            renderTagCloud(cloud, char.negTags || char.negPrompt);
            charSection.appendChild(p);
            charSection.appendChild(cloud);
          }
          content.appendChild(charSection);
        });
      }

      // 恢复按钮（底部全局恢复按钮）
      const restoreBtn = document.getElementById('nhm-restore-btn');
      if (snapshot.isPartial) {
        // 局部快照：底部按钮文字变更
        restoreBtn.textContent = '⏮️ 恢复此片段';
      } else {
        restoreBtn.textContent = '⏮️ 恢复至此状态';
      }
      restoreBtn.onclick = () => {
        if (!selectedSnapshot) return;
        window.postMessage({ type: '__RESTORE_HISTORY__', snapshot: selectedSnapshot }, '*');
        closeModal();
      };
    }

    async function openModal() {
      injectStyle();
      if (!document.getElementById('nai-history-backdrop')) createModal();

      // 从 storage 读取新数据
      const [data] = await Promise.all([
        getHistoryData(),
        ensureHistoryDictionaryMapLoaded(true)
      ]);
      historyData = (data.history || []).sort((a, b) => b.timestamp - a.timestamp);
      historyLimit = data.limit || 100;
      currentGroupColorMap = data.groupColorMap || {};
      currentGroupTranslationMap = data.groupTranslationMap || {};
      const limitInput = document.getElementById('nhm-limit-input');
      if (limitInput) limitInput.value = historyLimit;

      selectedSnapshot = null;
      renderList();
      document.getElementById('nai-history-backdrop').classList.add('visible');

      // 自动选中第一条历史记录
      if (historyData.length > 0) {
        const firstItem = document.querySelector('#nhm-list .nhm-item');
        if (firstItem) firstItem.click();
      }
    }

    // ───── 监听打开指令 ─────────────────────────────────────────
    window.addEventListener('message', e => {
      if (e.source !== window) return;
      if (e.data?.type === '__OPEN_HISTORY_MODAL__') {
        openModal();
      }
    });

    console.log('[Wildcard] History Modal module initialized');
})();
