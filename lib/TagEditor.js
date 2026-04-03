import Sortable from "./Sortable.js";
import common from "./common.js";

const groupTagsDataUtils = typeof window !== 'undefined' ? (window.GroupTagsDataUtils || {}) : {};

export const BUTTON_DEFS = {
    fav: {
        id: 'fav',
        className: 'tbtn-fav',
        titleKey: 'btn_add_to_group_tags',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>',
        showFor: (tag, ctx) => !ctx.isAiPending && !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isDynHeader && !ctx.isDynFooter && !ctx.isNewline && !ctx.isDynSeparator
    },
    copy: {
        id: 'copy',
        isBatch: true,
        className: 'tbtn-copy',
        titleKey: 'btn_copy',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
        showFor: (tag, ctx) => !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isDynHeader && !ctx.isDynFooter && !ctx.isNewline && !ctx.isDynSeparator
    },
    annotate: {
        id: 'annotate',
        isBatch: true,
        className: 'tbtn-ai-annotate',
        titleKey: 'btn_ai_annotate',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg>',
        showFor: (tag, ctx) => {
            if (ctx.isDynSeparator) return false;
            if (ctx.isMultiSelect && ctx.isSelectionMember) {
                return !ctx.isAiPending && !ctx.isNewline && !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isDynHeader && !ctx.isDynFooter;
            }
            return ctx.canAnnotate;
        }
    },
    weight: {
        id: 'weight',
        isComplex: true,
        className: 'tbtn-weight',
        titleKey: 'btn_edit_weight',
        svg: '<svg width="60" height="24" viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="60" height="20" rx="6" opacity="0.15"/><path d="M8 12h8"/><text x="32" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" stroke="none" style="font-family:sans-serif;">1.0</text><path d="M48 12h8 M52 8v8"/></svg>',
        showFor: (tag, ctx) => ctx.hasWeight,
        render: (tag, ctx) => `
            <div class="weight-control">
                <button type="button" class="tbtn tbtn-sub" title="${ctx.titles.decWeightTitle}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                <input type="text" class="weight-input ${ctx.weightVal > 1.05 ? 'pos' : (ctx.weightVal < 0.95 ? 'neg' : '')}" value="${ctx.weightVal.toFixed(1)}" title="${ctx.titles.editWeightTitle}">
                <button type="button" class="tbtn tbtn-add" title="${ctx.titles.incWeightTitle}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            </div>`
    },
    dynWeight: {
        id: 'dynWeight',
        isComplex: true,
        className: 'tbtn-dyn-weight',
        titleKey: 'btn_edit_dyn_weight',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><circle cx="15.5" cy="15.5" r="1.5"></circle><circle cx="15.5" cy="8.5" r="1.5"></circle><circle cx="8.5" cy="15.5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>',
        showFor: (tag, ctx) => !ctx.isAiPending && ctx.isDynMember && !ctx.isDynSeparator && ctx.isOptionLeader,
        render: (tag, ctx) => `
            <div class="weight-control dyn-weight-control">
                <button type="button" class="tbtn tbtn-dyn-sub" title="${ctx.titles.decDynWeightTitle}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                <input type="text" class="dyn-weight-input ${(tag.dynWeight || 1) > 1 ? 'pos' : ((tag.dynWeight || 1) < 1 ? 'neg' : '')}" value="${tag.dynWeight || 1}" title="${ctx.titles.editDynWeightTitle}">
                <button type="button" class="tbtn tbtn-dyn-add" title="${ctx.titles.incDynWeightTitle}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            </div>`
    },
    smartGroup: {
        id: 'smartGroup',
        isBatch: true,
        className: 'tbtn-smart-group',
        titleKey: 'btn_smart_group',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><polyline points="8.12 8.12 12 12"></polyline></svg>',
        render: (tag, ctx) => {
            const isMergeMode = (ctx.isMultiSelect && ctx.isSelectionMember) || ctx.isCompHeader || ctx.isCompFooter;
            const title = (isMergeMode ? ctx.titles.mergeTitle : ctx.titles.splitTitle) || (isMergeMode ? 'Merge' : 'Split');
            const icon = isMergeMode 
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><polyline points="8.12 8.12 12 12"></polyline></svg>';
            
            return `<button type="button" class="tbtn tbtn-smart-group is-batch ${isMergeMode ? 'is-merge' : 'is-split'}" title="${title}">${icon}</button>`;
        },
        showFor: (tag, ctx) => !ctx.isDynSeparator && (ctx.canSplit || (ctx.isMultiSelect && ctx.isSelectionMember) || ctx.isCompHeader || ctx.isCompFooter)
    },

    retranslate: {
        id: 'retranslate',
        className: 'tbtn-retranslate',
        titleKey: 'btn_retranslate',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><path d="M21 2v6h-6"></path><path d="M3 22v-6h6"></path><path d="M20.49 9A9 9 0 0 0 5 5.64L3 8"></path><path d="M3.51 15A9 9 0 0 0 19 18.36L21 16"></path></svg>',
        showFor: (tag, ctx) => !ctx.isDynSeparator && (ctx.isAiPendingFailed || (tag.aiOriginal && !ctx.isAiPending)) && !ctx.isNewline && !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isDynHeader && !ctx.isDynFooter
    },
    toggle: {
        id: 'toggle',
        isBatch: true,
        className: 'tbtn-toggle',
        titleKey: 'btn_toggle',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
        render: (tag, ctx) => `
            <button type="button" class="tbtn tbtn-toggle is-batch" title="${ctx.titles.toggleTitle}">
                ${tag.disabled 
                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>` 
                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="2" y1="2" x2="22" y2="22"></line><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path></svg>`}
            </button>`,
        showFor: (tag, ctx) => !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isNewline && !ctx.isDynSeparator
    },
    link: {
        id: 'link',
        className: 'tbtn-link',
        titleKey: 'btn_link',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        showFor: (tag, ctx) => !ctx.isNewline && !ctx.isCompHeader && !ctx.isCompFooter && !ctx.isDynHeader && !ctx.isDynFooter && !ctx.isDynSeparator
    },
    insertDynSeparator: {
        id: 'insertDynSeparator',
        className: 'tbtn-insert-sep',
        titleKey: 'btn_insert_separator',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="20"></line><line x1="8" y1="12" x2="16" y2="12" opacity="0.3"></line></svg>',
        showFor: (tag, ctx) => (ctx.isDynHeader || ctx.isDynMember) && !ctx.isDynFooter
    },
    newline: {
        id: 'newline',
        className: 'tbtn-newline',
        titleKey: 'btn_insert_newline',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>',
        showFor: (tag, ctx) => !ctx.isCompHeader && !ctx.isDynSeparator
    },
    del: {
        id: 'del',
        isBatch: true,
        className: 'tbtn-del',
        titleKey: 'btn_del',
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>',
        showFor: (tag, ctx) => true
    }
};

export default class TagEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.tags = [];
        this.selectedIndices = new Set();
        this.activeToolbarIndex = null;
        this.onChange = options.onChange || (() => { });
        this.onRemoveTags = options.onRemoveTags || (() => { });
        this.onRetryPendingTag = options.onRetryPendingTag || (() => { });
        this.onRetranslateAiTag = options.onRetranslateAiTag || (() => { });
        this.onAnnotateTag = options.onAnnotateTag || (() => { });
        this.onAnnotateSelectedTags = options.onAnnotateSelectedTags || (() => { });
        this.onAddToGroupTags = options.onAddToGroupTags || (() => { });
        this.sequentialCounters = {};
        this.render = this.render.bind(this);
        this.insertDynSeparator = this.insertDynSeparator.bind(this);
        
        // Multi-select & Marquee state
        this.isSelecting = false;
        this.startPos = { x: 0, y: 0 };
        this.selectionBox = null;

        this.init();
    }

    getToolbarTriggerMode() {
        return this.options.toolbarTriggerMode === 'click' ? 'click' : 'hover';
    }

    isClickToolbarMode() {
        return this.getToolbarTriggerMode() === 'click';
    }

    applyToolbarTriggerMode() {
        const isClick = this.isClickToolbarMode();
        this.container.classList.toggle('toolbar-trigger-click', isClick);
        if (!isClick) {
            this.hideActiveToolbar();
        }
    }

    showToolbarForIndex(index, { refresh = false } = {}) {
        if (!this.isClickToolbarMode()) return;

        if (this.activeToolbarIndex !== null && this.activeToolbarIndex !== index) {
            const prevLi = this.listElement?.querySelector(`.tag-item[data-index="${this.activeToolbarIndex}"]`);
            prevLi?.classList.remove('toolbar-visible');
        }

        this.activeToolbarIndex = index;
        const li = this.listElement?.querySelector(`.tag-item[data-index="${index}"]`);
        if (!li) return;

        li.classList.add('toolbar-visible');
        this.repositionToolbar(li, refresh);
    }

    hideActiveToolbar() {
        if (this.activeToolbarIndex !== null) {
            const prevLi = this.listElement?.querySelector(`.tag-item[data-index="${this.activeToolbarIndex}"]`);
            prevLi?.classList.remove('toolbar-visible');
        }
        this.activeToolbarIndex = null;
    }

    setSequentialCounters(counters) {
        this.sequentialCounters = counters || {};
        this.render();
    }

    toCanonicalTagKey(value) {
        if (groupTagsDataUtils.toCanonicalTagKey) {
            return groupTagsDataUtils.toCanonicalTagKey(value);
        }
        return String(value || '').trim().toLowerCase();
    }

    // 统一规范外部传入的 tag，兼容旧的字符串调用和新的对象调用。
    normalizeTagInput(input) {
        if (typeof input === 'string') {
            const value = input === '\n' ? '\n' : input.trim();
            return value !== '' ? { value, disabled: false } : null;
        }

        if (!input || typeof input !== 'object') return null;

        // 关键保护：换行符不可被 trim() 消灭
        const raw = String(input.value || '');
        const value = raw === '\n' ? '\n' : raw.trim();
        if (!value) return null;

        const normalized = {
            value,
            disabled: !!input.disabled
        };

        // 透传分组命名（仅存在于换行符对象上）
        if (typeof input.dividerName === 'string' && input.dividerName) {
            normalized.dividerName = input.dividerName;
        }
        // 透传分组颜色（仅存在于换行符对象上）
        if (typeof input.groupColor === 'string' && input.groupColor) {
            normalized.groupColor = input.groupColor;
        }

        if (input.isStart) normalized.isStart = true;
        if (typeof input.dynWeight === 'number' && !Number.isNaN(input.dynWeight)) {
            normalized.dynWeight = input.dynWeight;
        }
        if (typeof input.aiOriginal === 'string' && input.aiOriginal.trim()) {
            normalized.aiOriginal = input.aiOriginal.trim();
        }
        if (typeof input.aiZhTranslation === 'string' && input.aiZhTranslation.trim()) {
            normalized.aiZhTranslation = input.aiZhTranslation.trim();
        }
        if (input.aiZhPending) {
            normalized.aiZhPending = true;
        }
        const aiZhPendingStartedAt = Number(input.aiZhPendingStartedAt);
        if (Number.isFinite(aiZhPendingStartedAt) && aiZhPendingStartedAt > 0) {
            normalized.aiZhPendingStartedAt = aiZhPendingStartedAt;
        }
        if (typeof input.aiZhPendingRequestId === 'string' && input.aiZhPendingRequestId.trim()) {
            normalized.aiZhPendingRequestId = input.aiZhPendingRequestId.trim();
        }
        if (typeof input.aiZhErrorMessage === 'string' && input.aiZhErrorMessage.trim()) {
            normalized.aiZhErrorMessage = input.aiZhErrorMessage.trim();
        }
        // AI 翻译中的占位 tag 只在 popup 本地展示，不参与真正 prompt 同步。
        if (input.aiPending) {
            normalized.aiPending = true;
        }
        if (typeof input.aiPendingRequestId === 'string' && input.aiPendingRequestId.trim()) {
            normalized.aiPendingRequestId = input.aiPendingRequestId.trim();
        }
        if (input.aiPendingFailed) {
            normalized.aiPendingFailed = true;
        }
        if (typeof input.aiPendingErrorMessage === 'string' && input.aiPendingErrorMessage.trim()) {
            normalized.aiPendingErrorMessage = input.aiPendingErrorMessage.trim();
        }
        const aiPendingStartedAt = Number(input.aiPendingStartedAt);
        if (Number.isFinite(aiPendingStartedAt) && aiPendingStartedAt > 0) {
            normalized.aiPendingStartedAt = aiPendingStartedAt;
        }

        return normalized;
    }

    isPendingAiTag(tag) {
        return !!(tag && tag.aiPending);
    }

    isPendingAiZhTag(tag) {
        return !!(tag && tag.aiZhPending);
    }

    isFailedPendingAiTag(tag) {
        return this.isPendingAiTag(tag) && !!tag?.aiPendingFailed;
    }

    isActivePendingAiTag(tag) {
        return this.isPendingAiTag(tag) && !this.isFailedPendingAiTag(tag);
    }

    getPendingAiDisplayText(tag) {
        const dict = this.options.dict || {};
        if (this.isFailedPendingAiTag(tag)) {
            return dict.tag_ai_pending_failed || 'Translation failed';
        }
        return dict.tag_ai_pending || 'Translating';
    }

    formatPendingAiElapsed(tag) {
        const startedAt = Number(tag?.aiPendingStartedAt);
        if (!Number.isFinite(startedAt) || startedAt <= 0) return '0s';

        const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    syncPendingAiState(li, tag) {
        const primary = li?.querySelector('.tag-primary');
        const capsule = li?.querySelector('.tag-capsule');
        const textSpan = li?.querySelector('.tag-text');
        if (!primary || !capsule || !textSpan) return;

        const isPending = this.isPendingAiTag(tag);
        const isFailed = this.isFailedPendingAiTag(tag);
        const isActive = this.isActivePendingAiTag(tag);
        li.classList.toggle('tag-ai-pending', isPending);
        capsule.classList.toggle('tag-ai-pending', isPending);
        li.classList.toggle('tag-ai-pending-failed', isFailed);
        capsule.classList.toggle('tag-ai-pending-failed', isFailed);
        capsule.title = isFailed ? String(tag.aiPendingErrorMessage || '').trim() : '';

        let spinner = primary.querySelector('.tag-ai-spinner');
        let timer = primary.querySelector('.tag-ai-timer');

        if (isPending) {
            textSpan.textContent = this.getPendingAiDisplayText(tag);

            if (isActive) {
                if (!spinner) {
                    spinner = document.createElement('span');
                    spinner.className = 'tag-ai-spinner';
                    spinner.setAttribute('aria-hidden', 'true');
                    textSpan.after(spinner);
                }

                if (!timer) {
                    timer = document.createElement('span');
                    timer.className = 'tag-ai-timer';
                    spinner.after(timer);
                }

                timer.textContent = this.formatPendingAiElapsed(tag);
            } else {
                spinner?.remove();
                timer?.remove();
            }
        } else {
            spinner?.remove();
            timer?.remove();
            capsule.title = '';
        }
    }

    syncPendingAiZhState(li, tag) {
        const zhRow = li?.querySelector('.tag-zh-row');
        if (!zhRow) return;

        const isPending = this.isPendingAiZhTag(tag);
        zhRow.classList.toggle('tag-ai-pending', isPending);

        let label = zhRow.querySelector('.tag-ai-pending-label');
        let spinner = zhRow.querySelector('.tag-ai-spinner');
        let timer = zhRow.querySelector('.tag-ai-timer');

        if (isPending) {
            const dict = this.options.dict || {};
            zhRow.classList.remove('tag-ai-original');
            zhRow.title = dict.tag_ai_pending || 'Translating';

            if (!label) {
                label = document.createElement('span');
                label.className = 'tag-ai-pending-label';
                label.textContent = 'AI';
                zhRow.textContent = '';
                zhRow.appendChild(label);
            }

            if (!spinner) {
                spinner = document.createElement('span');
                spinner.className = 'tag-ai-spinner';
                spinner.setAttribute('aria-hidden', 'true');
                zhRow.appendChild(spinner);
            }

            if (!timer) {
                timer = document.createElement('span');
                timer.className = 'tag-ai-timer';
                zhRow.appendChild(timer);
            }

            timer.textContent = this.formatPendingAiElapsed({ aiPendingStartedAt: tag?.aiZhPendingStartedAt });
            return;
        }

        zhRow.title = '';
        label?.remove();
        spinner?.remove();
        timer?.remove();
    }

    init() {
        this.container.innerHTML = ''; // Clear loading placeholder
        this.container.classList.add('tag-editor-container');
        this.applyToolbarTriggerMode();
        this.listElement = document.createElement('ul');
        this.listElement.className = 'tag-list';
        this.container.appendChild(this.listElement);

        // Selection Box for Marquee
        this.selectionBoxEl = document.createElement('div');
        this.selectionBoxEl.className = 'selection-box';
        document.body.appendChild(this.selectionBoxEl);

        this.initSortable();

        // Marquee selection events on container
        this.container.addEventListener('mousedown', this.handleMarqueeStart.bind(this));
        window.addEventListener('mousemove', this.handleMarqueeMove.bind(this));
        window.addEventListener('mouseup', this.handleMarqueeEnd.bind(this));

        // 按下 Ctrl / Shift 时将容器标记为多选模式，通过 CSS 隐藏工具栏，避免多选时的干扰
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control' || e.key === 'Shift') {
                this.container.classList.add('is-key-selecting');
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control' || e.key === 'Shift') {
                this.container.classList.remove('is-key-selecting');
            }
        });

        // ---- ResizeObserver：当容器尺寸因缩放/密度/窗口变化而改变时，重绘分组框 ----
        this._renderGroupBoxesPending = false;
        this._groupBoxObserver = new ResizeObserver(() => {
            if (this._renderGroupBoxesPending) return;
            this._renderGroupBoxesPending = true;
            requestAnimationFrame(() => {
                this.renderGroupBoxes();
                this._renderGroupBoxesPending = false;
            });
        });
        this._groupBoxObserver.observe(this.listElement);

        document.addEventListener('mousedown', (e) => {
            if (!this.isClickToolbarMode()) return;
            if (this.activeToolbarIndex === null) return;

            const activeLi = this.listElement?.querySelector(`.tag-item[data-index="${this.activeToolbarIndex}"]`);
            if (activeLi?.contains(e.target)) return;

            this.hideActiveToolbar();
        });

        // 监听密度变化的跨 iframe 消息
        window.addEventListener('message', (e) => {
            if (e.data?.type === '__UPDATE_TE_DENSITY__') {
                // 密度变化后，ResizeObserver 会捕捉到容器尺寸变化并自动触发 renderGroupBoxes
                // 此处不再需要手写 setTimeout，避免重复计算
            }
            if (e.data?.type === '__UPDATE_TE_RESIZING__') {
                if (e.data.isResizing) {
                    this.listElement.classList.add('is-resizing');
                } else {
                    this.listElement.classList.remove('is-resizing');
                    // 结束后强制重绘一次以显示最新位置和徽章
                    this.renderGroupBoxes();
                }
            }
        });
    }

    initSortable() {
        this.sortable = new Sortable(this.listElement, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            scroll: true,
            forceAutoScrollFallback: true,
            scrollSensitivity: 56,
            scrollSpeed: 8,
            bubbleScroll: false,
            scrollFn: (offsetX, offsetY, originalEvent, touchEvent, hoverTargetEl) => {
                if (!hoverTargetEl) return 'continue';
                if (offsetY) {
                    hoverTargetEl.scrollTop += offsetY;
                }
            },
            draggable: '.tag-item:not(.editing)', // 分界符的拖拽由 onStart 逻辑控制
            filter: 'input, button, .tag-controls, .tag-newline-separator', // Filter out specific elements
            preventOnFilter: false, // Allow default behavior (selection) for filtered elements
            // **REMOVED:** multiDrag: true, // We are doing data-driven multi-drag now
            selectedClass: 'selected',
            avoidImplicitDeselect: true, // Let our own logic handle deselection
            onStart: (evt) => {
                this.container.classList.add('is-dragging');
                
                // A legitimate drag started, cancel any pending single-click selection
                this._pendingClickReset = null; 

                // Data-Driven MultiDrag logic
                // If dragging an unselected item, it drags alone.
                // If dragging a selected item, it drags the whole selection.
                const draggedIdx = parseInt(evt.item.dataset.index, 10);
                this._dragGroup = []; // Indices of items being dragged

                // 阻止分界符的独立拖拽（但允许它作为整组拖拽的一部分）
                const draggedTag = this.tags[draggedIdx];
                if (draggedTag && draggedTag.value === '|') {
                    this._dragCancelled = true;
                    return;
                }

                // 动态组整体拖拽：header/footer 总是拖拽整组（优先于选中逻辑）
                const isDynH = draggedTag && draggedTag.value.startsWith('||') && (draggedTag.value !== '||' || draggedTag.isStart);
                const isDynF = draggedTag && draggedTag.value === '||' && !draggedTag.isStart;
                if (isDynH || isDynF) {
                    const range = this.getDynGroupRange(draggedIdx);
                    if (range) {
                        this._dragGroup = [];
                        for (let i = range.start; i <= range.end; i++) this._dragGroup.push(i);
                    } else {
                        this._dragGroup = [draggedIdx];
                    }
                } else if (this.selectedIndices.has(draggedIdx)) {
                    // 普通多选拖拽
                    this._dragGroup = Array.from(this.selectedIndices).sort((a, b) => a - b);
                } else {
                    // 单个 tag 拖拽
                    this._dragGroup = [draggedIdx];
                }

                // If multiple items, calculate UI badge and hide companions
                if (this._dragGroup.length > 1) {
                    const dragCountBadge = document.createElement('div');
                    dragCountBadge.className = 'custom-multidrag-badge';
                    dragCountBadge.textContent = this._dragGroup.length;
                    evt.item.appendChild(dragCountBadge);

                    // Add a class so CSS can hide exactly the companions in the original list 
                // and handle the Sortable Ghost/Clone rendering correctly.
                // MUST use data-index attribute to locate companion elements,
                // because newline-separator elements shift DOM positions.
                this._dragGroup.forEach(i => {
                    if (i !== draggedIdx) {
                        const el = this.listElement.querySelector(`.tag-item[data-index="${i}"]`);
                        if (el) el.classList.add('hide-companion-drag');
                    }
                });
                }
            },
            onMove: (evt) => {
                const draggedEl = evt.dragged;
                const relatedEl = evt.related;

                // Safely get index 
                let idxStr = draggedEl.dataset.index;
                // If it's a ghost or clone, fall back to the main item
                if (!idxStr && evt.item && evt.item.dataset) {
                     idxStr = evt.item.dataset.index;
                }
                const baseIdx = parseInt(idxStr, 10);
                if (isNaN(baseIdx)) return true; // Safety

                // Check all tags currently being dragged
                const indicesToCheck = this._dragGroup && this._dragGroup.length > 0 ? this._dragGroup : [baseIdx];

                // If any dragged tag violates the rule, block the whole move
                for (let idx of indicesToCheck) {
                    const tag = this.tags[idx];
                    if (!tag) continue;

                    // Check if it's a Header or a "Block" (Single Pill with :: inside)
                    const val = tag.value;
                    const isBlock = !!val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
                    const isHeader = !!val.match(/^([-?\d\.]+)::$/);

                    // If it's just a normal tag, let it go anywhere
                    if (!isBlock && !isHeader) continue;

                    // 2. If it IS a weighted tag/header, forbid dropping "inside" another NAI group
                    // But ALLOW dropping inside Dynamic Groups

                    // Case A: Dropping on a member
                    if (relatedEl.classList.contains('tag-group-member') || relatedEl.classList.contains('tag-comp-member')) {
                        // Only forbid if it's an NAI member (not dynamic)
                        if (!relatedEl.classList.contains('tag-dynamic')) {
                            return false;
                        }
                    }

                    // Case B: Header/Footer boundaries
                    const isRelHeader = relatedEl.classList.contains('tag-group-header') || relatedEl.classList.contains('tag-comp-header');
                    const isRelFooter = relatedEl.classList.contains('tag-group-footer') || relatedEl.classList.contains('tag-comp-footer');
                    const isRelDynamic = relatedEl.classList.contains('tag-dynamic');

                    // If target is Header, inserting AFTER it puts us inside the group
                    if (isRelHeader && evt.willInsertAfter) {
                        if (!isRelDynamic) return false;
                    }

                    // If target is Footer, inserting BEFORE it puts us inside the group
                    if (isRelFooter && !evt.willInsertAfter) {
                        if (!isRelDynamic) return false;
                    }
                }

                return true;
            },
            onEnd: (evt) => {
                this.container.classList.remove('is-dragging');

                // 处理被取消的拖拽（如分界符独立拖拽）
                if (this._dragCancelled) {
                    this._dragCancelled = false;
                    this._dragGroup = null;
                    this.render(); // 恢复 DOM
                    return;
                }

                try {
                    const evtItem = evt.item;
                    const draggedIdx = parseInt(evtItem.dataset.index, 10);
                    
                    // Cleanup companion hiding classes and badge
                    const allElements = this.listElement.querySelectorAll('.tag-item');
                    allElements.forEach(el => el.classList.remove('hide-companion-drag'));
                    const badge = evtItem.querySelector('.custom-multidrag-badge');
                    if (badge) badge.remove();

                    // Calculate where it actually dropped
                    const oldIndexSortable = evt.oldIndex;
                    const newIndexSortable = evt.newIndex;
                    
                    if (newIndexSortable === undefined || oldIndexSortable === undefined) {
                        return; // finally 中会 render
                    }

                    if (this._dragGroup && this._dragGroup.length > 0) {
                        // Extract all dragged tags from the data array
                        const tagsToMove = this._dragGroup.map(i => this.tags[i]);
                        
                        // Filter out the dragged tags from the original array
                        const dragGroupSet = new Set(this._dragGroup);
                        let remainingTags = this.tags.filter((_, i) => !dragGroupSet.has(i));
                        
                        // 在 DOM 中找到被拖拽元素后面第一个不属于拖拽组的 tag-item
                        let nextElementInDOM = evtItem.nextElementSibling;
                        while (nextElementInDOM && (
                            nextElementInDOM.classList.contains('sortable-ghost') || 
                            nextElementInDOM.classList.contains('sortable-clone') || 
                            !nextElementInDOM.classList.contains('tag-item') ||
                            dragGroupSet.has(parseInt(nextElementInDOM.dataset.index, 10))
                        )) {
                             nextElementInDOM = nextElementInDOM.nextElementSibling;
                        }
                        
                        let insertIndexInRemaining = remainingTags.length; // Default to end
                        if (nextElementInDOM) {
                            const nextOriginalIndex = parseInt(nextElementInDOM.dataset.index, 10);
                            // Find this original tag in our remainingTags array
                            const targetTag = this.tags[nextOriginalIndex];
                            const tempIndex = remainingTags.indexOf(targetTag);
                            if (tempIndex !== -1) {
                                insertIndexInRemaining = tempIndex;
                            }
                        }
                        
                        // Insert all dragged tags at the computed position
                        remainingTags.splice(insertIndexInRemaining, 0, ...tagsToMove);
                        this.tags = remainingTags;

                        // Rebuild selected indices mapping so they stay visually selected
                        this.selectedIndices.clear();
                        for (let n = 0; n < tagsToMove.length; n++) {
                            this.selectedIndices.add(insertIndexInRemaining + n);
                        }
                    }
                } catch (err) {
                    console.error('[TagEditor] onEnd error:', err);
                } finally {
                    this._dragGroup = null;

                    // Fine-grained cleanup: skip tags followed by a newline
                    this.cleanupExternalCommas();

                    // Re-render to ensure indices in DOM are refreshed
                    this.render();
                    
                    // Ensure Sortable is completely wiped clean of its selection memory 
                    // AFTER the render has rebuilt the DOM.
                    try {
                        const allItems = this.listElement.querySelectorAll('.tag-item');
                        allItems.forEach(el => Sortable.utils.deselect(el));
                    } catch (e) { /* Sortable.utils.deselect may fail silently */ }

                    this.onChange(this.tags);
                }
            }
        });
    }


    cleanupExternalCommas() {
        let inDynamic = false;
        this.tags.forEach((tag, i) => {
            const val = tag.value;
            const isDynHeader = val.startsWith('||') && (val !== '||' || tag.isStart);
            const isDynFooter = val === '||' && !tag.isStart;

            if (isDynHeader) {
                inDynamic = true;
            } else if (isDynFooter) {
                inDynamic = false;
            } else if (!inDynamic) {
                // If tag is outside dynamic blocks and ends with a comma
                const trimmed = val.trim();
                if (trimmed.endsWith(',') && !val.startsWith('||')) {
                    // EXCEPTION: If the next tag is a newline, DO NOT strip the comma
                    const nextTag = this.tags[i + 1];
                    const nextIsNL = nextTag && nextTag.value === '\n';
                    
                    if (!nextIsNL) {
                        tag.value = trimmed.slice(0, -1).trim();
                    }
                }
            }
        });
    }

    setTags(tags, { skipInherit = false } = {}) {
        const oldTags = this.tags || [];
        const newTags = tags || [];
        
        // 防抖继承：当标签群因文本重新解析而重建时，
        // 从旧内存中按顺位将换行符的分组命名和颜色移植到新的换行符对象上
        if (!skipInherit) {
            const oldNewlines = oldTags.filter(t => t.value === '\n');
            if (oldNewlines.length > 0) {
                let idx = 0;
                newTags.forEach(t => {
                    if (t.value === '\n') {
                        if (idx < oldNewlines.length) {
                            if (oldNewlines[idx].dividerName) t.dividerName = oldNewlines[idx].dividerName;
                            if (oldNewlines[idx].groupColor) t.groupColor = oldNewlines[idx].groupColor;
                        }
                        idx++;
                    }
                });
            }
        }
        
        this.tags = newTags;
        this.clearSelection();
        this.render();
    }

    getTags() {
        return this.tags;
    }

    refreshPendingAiVisuals() {
        this.tags.forEach((tag, index) => {
            if (!this.isPendingAiTag(tag) && !this.isPendingAiZhTag(tag)) return;
            const li = this.listElement.querySelector(`.tag-item[data-index="${index}"]`);
            if (!li) return;
            if (this.isPendingAiTag(tag)) {
                this.syncPendingAiState(li, tag);
            }
            if (this.isPendingAiZhTag(tag)) {
                this.syncPendingAiZhState(li, tag);
            }
        });
    }

    renderCounterBadge(value) {
        const match = value.match(/^(([sS])?(\d+)?__([A-Za-z0-9_\/\.\-\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)__)$/);
        if (!match) return '';

        const isSequential = !!match[2];
        if (!isSequential) return '';

        const name = match[4];
        const slot = this.currentSlotCounts[name] || 0;
        this.currentSlotCounts[name] = slot + 1;

        const key = slot === 0 ? name : `${name}:${slot}`;
        const count = this.sequentialCounters[key] !== undefined ? this.sequentialCounters[key] : 0;

        return `<span class="tag-counter-badge" title="Current slot: ${slot}">[${count + 1}]</span>`;
    }

    bindAutocomplete(autocomplete) {
        this.autocomplete = autocomplete;
    }

    clearSelection() {
        this.selectedIndices.clear();
        this.updateSelectionVisuals();
    }

    toggleSelection(index, multi = false, range = false) {
        if (range && this.lastSelectedIndex !== null) {
            // Shift click
            const start = Math.min(this.lastSelectedIndex, index);
            const end = Math.max(this.lastSelectedIndex, index);
            this.selectedIndices.clear();
            for (let i = start; i <= end; i++) {
                this.selectedIndices.add(i);
            }
        } else if (multi) {
            // Ctrl click
            if (this.selectedIndices.has(index)) {
                this.selectedIndices.delete(index);
            } else {
                this.selectedIndices.add(index);
            }
            this.lastSelectedIndex = index;
        } else {
            // Single click
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
            this.lastSelectedIndex = index;
        }
        this.updateSelectionVisuals();
    }

    updateSelectionVisuals() {
        const items = Array.from(this.listElement.querySelectorAll('.tag-item'));
        const newIsMultiSelect = this.selectedIndices.size > 1;
        const wasMultiSelect = this.container.classList.contains('has-multi-selection');
        
        items.forEach((el) => {
            const tagIndex = parseInt(el.dataset.index, 10);
            const isSelected = this.selectedIndices.has(tagIndex);
            
            // Toggle selection class
            if (isSelected) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }

            // If we transitioned into/out of multi-select, or this item is part of a selection
            // we must ensure the toolbar (smartGroup button) is updated.
            if (newIsMultiSelect !== wasMultiSelect || isSelected) {
                const tag = this.tags[tagIndex];
                if (tag) {
                    this.updateTagVisuals(el, tag, tagIndex);
                }
            }
        });

        // Toggle multi-selection state class
        if (newIsMultiSelect) {
            this.container.classList.add('has-multi-selection');
        } else {
            this.container.classList.remove('has-multi-selection');
        }
    }

    getSelectedIndicesSorted() {
        return Array.from(this.selectedIndices).sort((a, b) => a - b);
    }

    getSelectedTags() {
        return this.getSelectedIndicesSorted()
            .map((index) => this.tags[index])
            .filter(Boolean);
    }

    render() {
        this.lastRenderTime = Date.now();
        this.applyToolbarTriggerMode();
        this.listElement.innerHTML = '';
        this.currentSlotCounts = {}; // Track slots per render for sequential wildcards
        
        // Calculate tag frequencies for duplicate indicators
        const tagFreq = {};
        this.tags.forEach(t => {
            const val = t.value;
            if (val === '\n' || val === ' ::' || val === '::' || val === '||' || val.match(/^([-?\d\.]+)::$/)) return;
            
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
            const key = this.toCanonicalTagKey(clean);
            // Skip wildcards and sequential wildcards from duplicate detection
            if (key && !groupTagsDataUtils.isWildcardTag(clean)) {
                tagFreq[key] = (tagFreq[key] || 0) + 1;
            }
        });

        let inGroup = false;
        let inDynamic = false;
        let compDepth = 0;
        let isFirstInOption = true;

        const fragment = document.createDocumentFragment();

        this.tags.forEach((tag, index) => {
            const val = tag.value;
            const isCompHeader = !!val.match(/^([-?\d\.]+)::$/);
            const isCompFooter = val === ' ::' || val === '::';
            const isDynHeader = val.startsWith('||') && (val !== '||' || tag.isStart);
            const isDynFooter = val === '||' && !tag.isStart;
            const isDynSep = val === '|' && inDynamic;

            let isCompMember = false;
            let isDynMember = false;

            let isTrulyFooter = false;

            if (isCompHeader) {
                inGroup = true;
                compDepth++;
            } else if (isCompFooter) {
                if (compDepth > 0) {
                    isTrulyFooter = true;
                    compDepth--;
                    if (compDepth === 0) inGroup = false;
                }
            } else if (inGroup) {
                isCompMember = true;
            }

            if (isDynHeader) { inDynamic = true; isFirstInOption = true; }
            else if (isDynFooter) { inDynamic = false; isFirstInOption = true; }
            else if (isDynSep) { isDynMember = true; isFirstInOption = true; }
            else if (inDynamic) { isDynMember = true; }

            // 计算首领状态：在||头部或|分隔符之后的第一个非特殊且启用的 tag 即为首领
            let isOptionLeader = false;
            if (isDynMember && !isDynSep && val !== '\n' && !tag.disabled) {
                isOptionLeader = isFirstInOption;
                isFirstInOption = false; // 后续同组 tag 不再是首领
            }

            // Extract clean text again for frequency check
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
            const key = this.toCanonicalTagKey(clean);
            const freq = (key && tagFreq[key]) || 0;

            const li = this.createTagElement(tag, index, { isCompMember, isDynMember, freq, tagKey: key, isTrulyFooter, isOptionLeader });
            fragment.appendChild(li);

            if (val === '\n') {
                const separatorDiv = document.createElement('div');
                separatorDiv.className = 'tag-newline-separator';
                fragment.appendChild(separatorDiv);
            }
        });
        
        this.listElement.appendChild(fragment);
        
        this.updateSelectionVisuals();
        requestAnimationFrame(() => {
            if (this.isClickToolbarMode()) {
                if (this.activeToolbarIndex !== null && !this.tags[this.activeToolbarIndex]) {
                    this.activeToolbarIndex = null;
                } else if (this.activeToolbarIndex !== null) {
                    this.showToolbarForIndex(this.activeToolbarIndex, { refresh: true });
                }
            }
            this.adjustTranslationLayout();
            this.renderGroupBoxes();
        });
    }

    // 工具方法：将 #rrggbb 转换为 rgba(r,g,b,alpha)，用于方框背景色
    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * 渲染分组框：扫描标签数组，按换行符分组，用绝对定位的装饰性 overlay 画出方框。
     * overlay 设置 pointer-events: none，对 Sortable.js 完全透明。
     * 通过 ResizeObserver 监听容器尺寸变化，在缩放/密度调整时自动重新计算。
     */
    renderGroupBoxes() {
        if (this.options.enableGrouping === false) {
            this.listElement.querySelectorAll('.tag-group-box-overlay').forEach(el => el.remove());
            return;
        }

        // 1. 收集所有标签 <li> 元素，按换行符分组
        const allItems = this.listElement.querySelectorAll('.tag-item');
        if (allItems.length === 0) {
            this.listElement.querySelectorAll('.tag-group-box-overlay').forEach(el => el.remove());
            return;
        }

        const groups = [];
        let currentGroup = { items: [], dividerName: '', groupColor: '' };

        allItems.forEach((li) => {
            if (li.classList.contains('tag-newline') || li.classList.contains('tag-divider-line')) {
                const idx = parseInt(li.dataset.index, 10);
                const tag = this.tags[idx];
                currentGroup.items.push(li);
                if (currentGroup.items.length > 0) {
                    currentGroup.dividerName = (tag && tag.dividerName) || '';
                    currentGroup.groupColor = (tag && tag.groupColor) || '';
                    groups.push(currentGroup);
                }
                currentGroup = { items: [], dividerName: '', groupColor: '' };
            } else {
                currentGroup.items.push(li);
            }
        });

        // 2. 准备绘制：复用 DOM 元素
        this.listElement.style.position = 'relative';
        const listWidth = this.listElement.clientWidth;
        const listStyle = getComputedStyle(this.listElement);
        const padLeft = parseFloat(listStyle.paddingLeft) || 0;
        const padRight = parseFloat(listStyle.paddingRight) || 0;
        const fullWidth = Math.max(0, listWidth - padLeft - padRight);

        // 获取当前已有的所有 overlay 元素以便复用
        const existingOverlays = Array.from(this.listElement.querySelectorAll('.tag-group-box-overlay'));
        let lastBoxBottom = -Infinity;

        groups.forEach((group, i) => {
            const items = group.items;
            if (items.length === 0) return;

            const firstItem = items[0];
            const lastItem = items[items.length - 1];

            const minY = firstItem.offsetTop;
            const maxY = lastItem.offsetTop + lastItem.offsetHeight;

            const vPad = 6; 
            let top = minY - vPad;
            let height = (maxY - minY) + vPad * 2;

            if (top < lastBoxBottom + 4) {
                const diff = (lastBoxBottom + 4) - top;
                top += diff;
                height -= diff;
            }
            // 如果计算出来的区域太小（比如当前组只有一个换行符标签），则不显示方框
            if (height < 10) return;
            lastBoxBottom = top + height;

            // --- 复用或创建 Overlay ---
            let overlay = existingOverlays[i];
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'tag-group-box-overlay';
                // 启用硬件加速建议
                overlay.style.willChange = 'top, height';
                this.listElement.appendChild(overlay);
            }
            overlay.style.display = 'block';
            overlay.style.top = `${top}px`;
            overlay.style.left = `${padLeft - 4}px`;
            overlay.style.width = `${fullWidth + 8}px`;
            overlay.style.height = `${height}px`;

            if (group.groupColor) {
                overlay.style.borderColor = group.groupColor;
                overlay.style.background = this._hexToRgba(group.groupColor, 0.05);
            } else {
                overlay.style.borderColor = '';
                overlay.style.background = '';
            }

            // --- 复用或创建 Badge ---
            let badge = overlay.querySelector('.tag-group-box-badge');
            if (group.dividerName) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'tag-group-box-badge';
                    overlay.appendChild(badge);
                }
                badge.style.display = 'block';
                if (badge.textContent !== group.dividerName) {
                    badge.textContent = group.dividerName;
                }
                if (group.groupColor) {
                    badge.style.borderLeftColor = group.groupColor;
                } else {
                    badge.style.borderLeftColor = '';
                }
            } else if (badge) {
                badge.style.display = 'none';
            }
        });

        // 隐藏多余的旧元素
        for (let j = groups.length; j < existingOverlays.length; j++) {
            existingOverlays[j].style.display = 'none';
        }
    }

    createTagElement(tag, index, { isCompMember = false, isDynMember = false, freq = 0, tagKey = '', isTrulyFooter = null, isOptionLeader = false } = {}) {
        const li = document.createElement('li');
        li.className = 'tag-item';
        if (tag.disabled) li.classList.add('disabled');
        if (this.isPendingAiTag(tag)) li.classList.add('tag-ai-pending');
        if (isCompMember) li.classList.add('tag-comp-member');
        if (isDynMember) li.classList.add('tag-dyn-member');
        if (this.isClickToolbarMode() && this.activeToolbarIndex === index) li.classList.add('toolbar-visible');
        li.dataset.index = index;

        // Visual breakdown
        let text = tag.value;
        let weightVal = 1.0;
        let cleanText = text;
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        const isDynSeparator = text === '|' && isDynMember;
        let isCompHeader = false;
        let isCompFooter = isTrulyFooter !== null ? isTrulyFooter : (text === ' ::' || text === '::');

        // Try to match "weight::tag ::" (Single Pill)
        let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        // Try to match "weight::" (Group Header)
        let headerMatch = text.match(/^([-?\d\.]+)::$/);

        if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            cleanText = blockMatch[2];
        } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            cleanText = headerMatch[1] + '::';
            isCompHeader = true;
        } else if (isCompFooter) {
            cleanText = ')';
            // Backtrack to find weight from closest header
            for (let j = index - 1; j >= 0; j--) {
                let m = this.tags[j].value.match(/^([-?\d\.]+)::$/);
                if (m) {
                    weightVal = parseFloat(m[1]);
                    break;
                }
            }
        } else {
            // Fallback for old bracket styles
            let inc = 0, dec = 0, str = text;
            if (text.startsWith('{') || text.startsWith('[')) {
                while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
                if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
                if (inc > 0) weightVal = 1 + (inc * 0.1);
                else if (dec > 0) weightVal = 1 - (dec * 0.1);
                cleanText = str;
            }
        }

        const isNewline = cleanText === '\n';
        const isAiPending = this.isPendingAiTag(tag);
        const isAiPendingFailed = this.isFailedPendingAiTag(tag);
        let displayTagName = isNewline ? '↵' : cleanText;
        if (isCompHeader || isCompFooter || isDynHeader || isDynFooter) displayTagName = '';

        // Calculate offset from raw value to display text
        let displayOffset = 0;
        if (!isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            if (blockMatch) {
                displayOffset = blockMatch[1].length + 2; // weight + "::"
            } else if (text.startsWith('{') || text.startsWith('[')) {
                let str = text;
                while (str.startsWith('{') && str.endsWith('}')) { displayOffset++; str = str.slice(1, -1); }
                if (displayOffset === 0) {
                    while (str.startsWith('[') && str.endsWith(']')) { displayOffset++; str = str.slice(1, -1); }
                }
            }
        }

        // Dynamic Weight Badge - 从整个选项段扫描 dynWeight，而不是只看当前 tag
        let dynWeightBadge = '';
        if (!isAiPending && isDynMember) {
            const sectionDW = this.getOptionDynWeight(index);
            if (sectionDW !== 1) {
                const formattedDyn = (sectionDW % 1 === 0) ? sectionDW : sectionDW.toFixed(1);
                dynWeightBadge = `<span class="tag-dyn-weight-mini-badge" title="Selection Weight">${formattedDyn}</span>`;
            }
        }

        if (isNewline) li.classList.add('tag-newline');
        if (isCompHeader) li.classList.add('tag-comp-header');
        if (isCompFooter) li.classList.add('tag-comp-footer');
        if (isDynHeader) li.classList.add('tag-dyn-header');
        if (isDynFooter) li.classList.add('tag-dyn-footer');
        if (isDynSeparator) li.classList.add('tag-dyn-separator');
        if (isDynHeader || isDynFooter || isDynMember) li.classList.add('tag-dynamic');
        if (isDynHeader) li.setAttribute('data-dyn-config', text.slice(2));

        const lookupTagKey = this.toCanonicalTagKey(cleanText);
        let info = null;
        if (this.autocomplete && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
            if (blockMatch) {
                // Composite tag logic: split and aggregate translations
                const parts = cleanText.split(',').map(s => s.trim()).filter(Boolean);
                const translationParts = [];
                let firstColor = null;

                parts.forEach(part => {
                    const partInfo = this.autocomplete.getTagInfo(part);
                    if (partInfo) {
                        if (partInfo.zh) translationParts.push(partInfo.zh);
                        if (!firstColor && partInfo.color) firstColor = partInfo.color;
                    }
                });

                if (translationParts.length > 0 || firstColor) {
                    info = {
                        zh: translationParts.join(', '),
                        color: firstColor
                    };
                }
            } else {
                // Standard single tag logic
                info = this.autocomplete.getTagInfo(cleanText);
            }
        }

        // GroupTags 翻译优先：如果 groupTranslationMap 中有该标签的翻译，覆盖字典翻译
        if (this.groupTranslationMap && this.groupTranslationMap[lookupTagKey]) {
            if (!info) info = {};
            info.zh = this.groupTranslationMap[lookupTagKey];
        }

        if (info && info.color) {
            li.style.borderColor = info.color;
            li.style.borderWidth = '1.5px';
            li.style.background = `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)`;
        }

        // 分组颜色映射 - 在 capsule 创建后应用（见下方行 648 后）
        // groupColorMap 的颜色将覆盖 autocomplete 字典颜色

        let pickBadge = '';
        if (isDynHeader) {
            let config = text.slice(2);
            if (config.endsWith('$$')) config = config.slice(0, -2);
            if (config) {
                let displayCount = config.replace('-', '~');
                pickBadge = `<span class="tag-dyn-pick-badge">x${displayCount}</span>`;
            }
        }

        const hasWeight = !isAiPending && (blockMatch || headerMatch || (!isNewline && !isCompFooter && !isCompMember)) && 
                          !isDynHeader && !isDynFooter && !isDynSeparator;

        // Leader Logic: Only show dynamic weight badge for leaders
        const showDynWeightBadge = !isAiPending && isDynMember && isOptionLeader && dynWeightBadge !== '';
        // 统一复用同一份拆分按钮判断，避免模板渲染和事件绑定规则漂移。
        const canSplit = !isAiPending && !tag.aiOriginal && (!!blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter && cleanText.includes(',') && common.splitTags(cleanText).length > 1));
        const canAnnotate = !isAiPending && !tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter;

        const dict = this.options.dict || {};
        
        // Toolbar Events
        const minConfigTitle = dict.dyn_min || "Min";
        const maxConfigTitle = dict.dyn_max || "Max";
        const sepConfigTitle = dict.dyn_sep || "Separator";
        // 原收藏按钮改为“加入 Group Tags”，文案优先复用 popup 当前语言包
        const favTitle = dict.btn_add_to_group_tags || `${dict.btn_add || 'Add'} ${dict.btn_group_tags || 'Group Tags'}`.trim();
        const copyTitle = dict.btn_copy || "Copy Tag";
        const decWeightTitle = dict.btn_dec_weight || "Decrease Weight";
        const editWeightTitle = dict.btn_edit_weight || "Edit Weight";
        const incWeightTitle = dict.btn_inc_weight || "Increase Weight";
        const decDynWeightTitle = dict.btn_dec_dyn_weight || "Decrease Selection Weight";
        const editDynWeightTitle = dict.btn_edit_dyn_weight || "Edit Selection Weight";
        const incDynWeightTitle = dict.btn_inc_dyn_weight || "Increase Selection Weight";
        const splitTitle = dict.btn_split || "Split to markers";
        const mergeTitle = dict.btn_merge || "Merge group";
        const toggleTitle = dict.btn_toggle || "Enable/Disable";
        const annotateTitle = dict.btn_ai_annotate || "AI Annotate";
        const delTitle = dict.btn_del || "Delete";
        const newlineTitle = dict.btn_insert_newline || "Add Newline";

        const secondaryText = (tag.aiZhPending && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter)
            ? '&nbsp;'
            : (tag.aiZhTranslation && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter)
            ? common.escapeHtml(tag.aiZhTranslation)
            : (tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter)
            ? common.escapeHtml(tag.aiOriginal)
            : ((info && info.zh && !isNewline) ? info.zh : (isNewline || isCompHeader || isCompFooter || isDynHeader || isDynFooter ? '' : '&nbsp;'));
        const secondaryClass = tag.aiZhPending
            ? 'tag-zh-row tag-ai-pending'
            : (tag.aiOriginal ? 'tag-zh-row tag-ai-original' : 'tag-zh-row');

        const dupTooltip = (dict.tag_duplicate_tooltip || "Duplicate tag: {n} instances").replace('{n}', freq);

        const duplicateBadge = (!isAiPending && freq > 1 && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter && !isDynSeparator)
            ? `<span class="tag-duplicate-badge" title="${common.escapeHtml(dupTooltip)}" data-tag-key="${common.escapeHtml(tagKey)}">x${freq}</span>`
            : '';

        const isSelectionMember = this.selectedIndices.has(index);
        const isMultiSelect = this.selectedIndices.size > 1;

        const context = {
            isAiPending, isAiPendingFailed, isNewline, isCompHeader, isCompFooter, isDynHeader, isDynFooter, isDynMember, isDynSeparator,
            canAnnotate, canSplit, hasWeight, weightVal,
            isMultiSelect, isSelectionMember, isOptionLeader,
            titles: {
                decWeightTitle, editWeightTitle, incWeightTitle, decDynWeightTitle, editDynWeightTitle, incDynWeightTitle, toggleTitle,
                splitTitle, mergeTitle
            }
        };

        const toolbarConfig = this.options.toolbarConfig || {
            order: ['fav', 'copy', 'annotate', 'weight', 'dynWeight', 'insertDynSeparator', 'smartGroup', 'retranslate', 'toggle', 'link', 'newline', 'del'],
            stickyIds: ['del']
        };

        // 按类型分支处理工具栏 (Branch by Type)
        let toolbarHtml = '';
        if (isDynHeader) {
            toolbarHtml += `
                <div class="dyn-config-control">
                    <input type="text" class="dyn-config-input dyn-min" title="${minConfigTitle}" placeholder="min">
                    <span>-</span>
                    <input type="text" class="dyn-config-input dyn-max" title="${maxConfigTitle}" placeholder="max">
                    <input type="text" class="dyn-config-input dyn-sep sep" title="${sepConfigTitle}" placeholder="">
                </div>`;
        } else if (isNewline) {
            toolbarHtml += `
                <input type="text" class="divider-name-input" value="${common.escapeHtml(tag.dividerName || '')}" placeholder="分组名称" title="为此分组命名">
                <input type="color" class="divider-color-input" value="${tag.groupColor || '#818cf8'}" title="选择分组颜色">`;
        }

        const toolbarButtonsHtml = toolbarConfig.order.map(btnId => {
            const btnDef = BUTTON_DEFS[btnId];
            
            // 分场景识别显隐逻辑
            const currentScene = tag.aiOriginal ? 'ai' : 'standard';
            const sceneHiddenIds = toolbarConfig.sceneHiddenIds || {};
            const isHidden = (sceneHiddenIds[currentScene] || toolbarConfig.hiddenIds || []).includes(btnId);

            if (!btnDef || isHidden || !btnDef.showFor(tag, context)) return '';
            
            const title = btnDef.title || (btnDef.titleKey ? (dict[btnDef.titleKey] || btnId) : btnId);
            if (btnDef.render) return btnDef.render(tag, context);
            
            // 简单的 SVG 按钮
            const batchClass = btnDef.isBatch ? ' is-batch' : '';
            return `<button type="button" class="tbtn ${btnDef.className}${batchClass}" title="${title}">${btnDef.svg}</button>`;
        }).join('');

        li.innerHTML = `
            ${duplicateBadge}
            <div class="tag-capsule ${isCompHeader ? 'gh' : (isCompFooter ? 'gf' : (isDynHeader ? 'dh' : (isDynFooter ? 'df' : (isDynSeparator ? 'ds' : ''))))}" style="border-color: ${info && info.color ? info.color : ''}; border-width: ${info && info.color ? '1.5px' : ''}; background: ${info && info.color ? `linear-gradient(135deg, #3b3b4f 0%, ${info.color}15 100%)` : ''}">
                <div class="tag-primary">
                    ${isDynHeader ? pickBadge : (((!isAiPending && (Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter))) && !isNewline) ? `<span class="tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}">${weightVal.toFixed(1)}</span>` : '')}
                    <span class="tag-text">${isDynSeparator ? '|' : displayTagName}</span>
                    ${showDynWeightBadge ? dynWeightBadge : ''}
                    ${this.renderCounterBadge(cleanText)}
                </div>
                <div class="tag-controls">
                    ${toolbarHtml}
                    ${toolbarButtonsHtml}
                </div>
            </div>
            <div class="${secondaryClass}">${secondaryText}</div>
        `;

        const capsule = li.querySelector('.tag-capsule');
        if (tag.disabled) capsule.classList.add('disabled');

        // 分组颜色映射：只修改胶囊背景色，保留 Danbooru 字典的边框色（如 artist 红色边框）
        if (this.groupColorMap && this.groupColorMap[lookupTagKey]) {
            const gc = this.groupColorMap[lookupTagKey];
            capsule.style.background = gc;
        }
        this.syncPendingAiState(li, tag);

        const textSpan = li.querySelector('.tag-text');
        if (textSpan) {
            textSpan.dataset.offset = displayOffset;
        }

        // toolbar events
        // ---- 换行符命名输入框事件绑定 ----
        if (isNewline) {
            const nameInput = li.querySelector('.divider-name-input');
            const controls = li.querySelector('.tag-controls');
            if (nameInput) {
                // 使用国际化文本设置 placeholder
                const dividerPlaceholder = dict.divider_name_placeholder || '分组名称';
                nameInput.placeholder = dividerPlaceholder;
                nameInput.title = dict.divider_name_title || '为此分组命名';

                // 阻止所有鼠标/指针事件冒泡，防止触发外层 toggleSelection/editMode
                const stopAll = (e) => e.stopPropagation();
                nameInput.addEventListener('mousedown', stopAll);
                nameInput.addEventListener('mousedown', stopAll);
                nameInput.addEventListener('pointerdown', stopAll);
                nameInput.addEventListener('mouseup', stopAll);
                nameInput.addEventListener('click', stopAll);
                nameInput.addEventListener('dblclick', stopAll);
                nameInput.addEventListener('focus', stopAll);
                nameInput.addEventListener('blur', stopAll);

                // 键盘处理：Enter 确认，Escape 取消
                nameInput.addEventListener('keydown', (e) => {
                    e.stopPropagation(); // 防止触发全局快捷键
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        nameInput.blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        nameInput.value = tag.dividerName || '';
                        nameInput.blur();
                    }
                });

                // 实时同步名称到内存中的 tag 对象
                nameInput.addEventListener('input', (e) => {
                    tag.dividerName = e.target.value;
                    this.renderGroupBoxes();
                    this.onChange(this.tags);
                });
            }
            // ---- 分组颜色选择器事件绑定 ----
            const colorInput = li.querySelector('.divider-color-input');
            if (colorInput) {
                // 阻止所有鼠标/指针事件冒泡
                const stopAll = (e) => e.stopPropagation();
                colorInput.addEventListener('mousedown', stopAll);
                colorInput.addEventListener('pointerdown', stopAll);
                colorInput.addEventListener('mouseup', stopAll);
                colorInput.addEventListener('click', stopAll);
                colorInput.addEventListener('dblclick', stopAll);
                colorInput.addEventListener('focus', stopAll);
                colorInput.addEventListener('blur', stopAll);
                // 实时同步颜色到内存中的 tag 对象并重绘方框
                colorInput.addEventListener('input', (e) => {
                    tag.groupColor = e.target.value;
                    this.renderGroupBoxes();
                    this.onChange(this.tags);
                });
            }
        }

        if (isDynHeader) {
            const minInput = li.querySelector('.dyn-min');
            const maxInput = li.querySelector('.dyn-max');
            const sepInput = li.querySelector('.dyn-sep');

            // Initial Parse from tag.value (e.g., ||2$$ or ||1-3$$and$$)
            let fullConfig = text.slice(2);
            let rangeStr = '';
            let joinerStr = '';

            if (fullConfig.includes('$$')) {
                const parts = fullConfig.split('$$').filter(p => p !== '');
                rangeStr = parts[0] || '';
                joinerStr = parts[1] || '';
            } else {
                rangeStr = fullConfig;
            }

            let minValue = rangeStr, maxValue = '';
            if (rangeStr.includes('-')) {
                const parts = rangeStr.split('-');
                minValue = parts[0];
                maxValue = parts[1];
            } else if (rangeStr) {
                // If it's a single value, we treat it as Min if Max is empty, 
                // but user wants: if Min is empty, use Max for single value. 
                // For restoration, let's put single values in Max if Min is empty? 
                // Or just keep it simple: if no '-', and it's there, put it in Min or Max?
                // Actually, let's follow user's "single value = Max if Min empty" logic for display,
                // but for parsing, a single '2' could be either. Let's put it in Min by default or Max?
                // User said: "如果第一个框为空就显示最大选取数" -> suggests 2 belongs in second box if single.
                minValue = '';
                maxValue = rangeStr;
            }

            minInput.value = minValue;
            maxInput.value = maxValue;
            sepInput.value = joinerStr;

            const updateConfig = () => {
                const mi = minInput.value.trim();
                const ma = maxInput.value.trim();
                const joiner = sepInput.value; // Allow whitespace

                let range = '';
                if (!mi && ma) range = ma;
                else if (mi && !ma) range = mi;
                else if (mi && ma) range = `${mi}-${ma}`;

                let newValue = `||${range}`;
                if (range || joiner) {
                    newValue += '$$';
                    if (joiner) newValue += joiner + '$$';
                }

                tag.value = newValue;
                this.onChange(this.tags);
                this.updateTagVisuals(li, tag, index);
            };

            minInput.oninput = updateConfig;
            maxInput.oninput = updateConfig;
            sepInput.oninput = updateConfig;
            minInput.onmousedown = (e) => e.stopPropagation();
            maxInput.onmousedown = (e) => e.stopPropagation();
            sepInput.onmousedown = (e) => e.stopPropagation();
        }

        // Duplicate badge events
        const dupBadge = li.querySelector('.tag-duplicate-badge');
        if (dupBadge) {
            dupBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tags.splice(index, 1);
                this.render();
                this.onChange(this.tags);
            });
            dupBadge.addEventListener('mouseenter', () => {
                const key = dupBadge.dataset.tagKey;
                if (!key) return;
                this.listElement.querySelectorAll(`.tag-duplicate-badge[data-tag-key="${key}"]`).forEach(b => {
                    const item = b.closest('.tag-item');
                    if (item) item.classList.add('duplicate-highlight');
                });
            });
            dupBadge.addEventListener('mouseleave', () => {
                const key = dupBadge.dataset.tagKey;
                if (!key) return;
                this.listElement.querySelectorAll(`.tag-item.duplicate-highlight`).forEach(item => {
                    item.classList.remove('duplicate-highlight');
                });
            });
        }

        // Interaction refinements
        capsule.addEventListener('mousedown', (e) => {
            if (e.target.closest('.tag-controls')) return;
            if (e.target.tagName === 'INPUT') return;
            
            // If already selecting without modifiers, wait for mouseup to single select
            // This allows Sortable to start dragging the entire multi-selection block
            if (!e.ctrlKey && !e.shiftKey && this.selectedIndices.has(index)) {
                this._pendingClickReset = index;
                
                // Listen globally for mouseup to ensure we don't trap the state
                // if the user drags out of the capsule and releases
                const handleGlobalMouseUp = (mouseUpEvent) => {
                    window.removeEventListener('mouseup', handleGlobalMouseUp);
                    if (this._pendingClickReset === index) {
                        this._pendingClickReset = null;
                        // If a drag operation didn't start, perform the single selection now
                        if (!this.container.classList.contains('is-dragging')) {
                            // Only trigger if they actually clicked (released near where they pressed)
                            // or released without dragging
                            this.toggleSelection(index, false, false);
                        }
                    }
                };
                window.addEventListener('mouseup', handleGlobalMouseUp);
                return;
            }
            this._pendingClickReset = null;
            this.toggleSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
        });

        const tagPrimary = li.querySelector('.tag-primary');
        if (!isAiPending && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter && !isNewline && !isDynSeparator) {
            tagPrimary.addEventListener('click', (e) => {
            // Prevent entering edit mode if we are trying to multi-select with modifiers
            if (e.ctrlKey || e.shiftKey || e.metaKey) return;
            
            if (this.isClickToolbarMode() && !li.classList.contains('toolbar-visible')) {
                e.preventDefault();
                e.stopPropagation();
                this.showToolbarForIndex(index);
                return;
            }

            e.stopPropagation();
                if (li.classList.contains('editing') || this.container.classList.contains('is-dragging')) return;
                if (this.clickTimer) clearTimeout(this.clickTimer);
                this.clickTimer = setTimeout(() => {
                    this.clickTimer = null;
                    this.enterEditMode(li, index, e);
                }, 300);
            });
        }

        // Toolbar Events
        const btnFav = li.querySelector('.tbtn-fav');
        if (btnFav) {
            btnFav.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // TagEditor 只负责把标准化后的 tag 数据抛给外层，不直接理解 Group Tags 结构
                const bestZh = tag.aiZhTranslation || ((info && info.zh) ? info.zh : '') || tag.aiOriginal || '';
                const payload = {
                    en: cleanText,
                    zh: bestZh
                };
                if (cleanText && bestZh) {
                    payload.sentenceCandidate = {
                        en: cleanText,
                        zh: bestZh
                    };
                }
                try {
                    await this.onAddToGroupTags(payload);
                } catch (err) {
                    console.error('[TagEditor] Failed to add tag into Group Tags:', err);
                }
            };
        }

        const btnCopy = li.querySelector('.tbtn-copy');
        if (btnCopy) {
            btnCopy.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.copyTag(index); };
        }

        const btnAnnotate = li.querySelector('.tbtn-ai-annotate');
        if (btnAnnotate) {
            btnAnnotate.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (this.selectedIndices.size > 1 && this.selectedIndices.has(index)) {
                        const selectedTags = Array.from(this.selectedIndices).sort((a, b) => a - b).map(idx => this.tags[idx]);
                        await this.onAnnotateSelectedTags(selectedTags, btnAnnotate);
                    } else {
                        await this.onAnnotateTag(tag, btnAnnotate);
                    }
                } catch (error) {
                    console.error('[TagEditor] Failed to annotate:', error);
                }
            };
        }

        if (hasWeight) {
            const btnSub = li.querySelector('.tbtn-sub');
            if (btnSub) btnSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, -0.1, li); };

            const btnAdd = li.querySelector('.tbtn-add');
            if (btnAdd) btnAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateWeight(index, 0.1, li); };

            const weightInput = li.querySelector('.weight-input');
            if (weightInput) {
                weightInput.onmousedown = (e) => e.stopPropagation();
                weightInput.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) this.updateWeightManual(index, val, li);
                };
            }

            const wc = li.querySelector('.weight-control:not(.dyn-weight-control)');
            if (wc) {
                wc.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    this.updateWeight(index, e.deltaY < 0 ? 0.1 : -0.1, li);
                }, { passive: false });
            }
        }

        if (isDynMember) {
            const btnDynSub = li.querySelector('.tbtn-dyn-sub');
            if (btnDynSub) btnDynSub.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateDynWeight(index, -1, li); };

            const btnDynAdd = li.querySelector('.tbtn-dyn-add');
            if (btnDynAdd) btnDynAdd.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.updateDynWeight(index, 1, li); };

            const dynWeightInput = li.querySelector('.dyn-weight-input');
            if (dynWeightInput) {
                dynWeightInput.onmousedown = (e) => e.stopPropagation();
                dynWeightInput.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) this.updateDynWeightManual(index, val, li);
                };
            }

            const dwc = li.querySelector('.dyn-weight-control');
            if (dwc) {
                dwc.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    this.updateDynWeight(index, e.deltaY < 0 ? 1 : -1, li);
                }, { passive: false });
            }
        }

        const btnSmartGroup = li.querySelector('.tbtn-smart-group');
        if (btnSmartGroup) {
            btnSmartGroup.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.handleGroupToggle(index); };
        }

        const btnRetranslate = li.querySelector('.tbtn-retranslate');
        if (btnRetranslate) {
            btnRetranslate.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (isAiPendingFailed) {
                        await this.onRetryPendingTag(tag);
                    } else {
                        await this.onRetranslateAiTag(tag);
                    }
                } catch (error) {
                    console.error('[TagEditor] Failed to re-run AI task:', error);
                }
            };
        }

        const btnToggle = li.querySelector('.tbtn-toggle');
        if (btnToggle) btnToggle.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            // 动态组头尾：切换整个组的禁用状态
            if (isDynHeader || isDynFooter) {
                this.toggleDynGroupDisable(index);
            } else {
                this.toggleDisable(index, li);
            }
        };

        const btnNewline = li.querySelector('.tbtn-newline');
        if (btnNewline) btnNewline.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.insertTag('\n', index + 1); };

        const btnLink = li.querySelector('.tbtn-link');
        if (btnLink) btnLink.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._showExternalLinkMenu(e, tag.value); };

        const btnInsertSep = li.querySelector('.tbtn-insert-sep');
        if (btnInsertSep) btnInsertSep.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.insertDynSeparator(index); };

        const btnDel = li.querySelector('.tbtn-del');
        if (btnDel) {
            btnDel.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                // 动态组头尾删除 = 解散整个组
                if (isDynHeader || isDynFooter) {
                    this.dissolveDynGroup(index);
                } else {
                    this.removeTags([index]);
                }
            };
        }

        // Double click to toggle disabled (All-in-One style)
        capsule.addEventListener('dblclick', (e) => {
            if (e.target.closest('.tag-controls')) return;
            if (e.ctrlKey || e.shiftKey || e.metaKey) return;
            if (this.isPendingAiTag(tag)) return;
            if (isCompHeader || isCompFooter || isDynSeparator) return;
            e.stopPropagation();
            e.preventDefault(); // Prevent text selection
            // Cancel single click edit
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }
            // 动态组头/尾：双击切换整个组的禁用状态
            if (isDynHeader || isDynFooter) {
                this.toggleDynGroupDisable(index);
            } else {
                this.toggleDisable(index, li);
            }
        });

        capsule.addEventListener('click', (e) => {
            if (!this.isClickToolbarMode()) return;
            if (e.target.closest('.tag-controls')) return;
            if (e.target.tagName === 'INPUT') return;
            if (e.target.closest('.tag-primary')) return;
            this.showToolbarForIndex(index);
        });

        // Boundary detection for side-floating toolbar
        li.addEventListener('mouseenter', () => {
            if (this.isClickToolbarMode()) return;
            // Prevent flash animation if the DOM was just rebuilt under the mouse
            const timeSinceRender = Date.now() - (this.lastRenderTime || 0);
            const isRefresh = timeSinceRender < 100;
            this.repositionToolbar(li, isRefresh);
        });

        this.syncPendingAiState(li, tag);
        this.syncPendingAiZhState(li, tag);
        return li;
    }

    repositionToolbar(li, isRefresh = false) {
        const controls = li.querySelector('.tag-controls');
        if (!controls) return;

        // --- 静态保持逻辑 ---
        // 如果是刷新触发（如修改权重后 updateTagVisuals 调用），
        // 且工具栏已经有像素锁定的位置，检查它是否依然在安全区域内
        if (isRefresh && (controls.style.left || controls.style.right)) {
            const currentRect = controls.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const rightEdge = Math.min(viewportWidth, containerRect.right);
            const leftEdge = Math.max(0, containerRect.left);

            // 同时检查水平和垂直方向的安全性（覆盖 pos-top / pos-bottom 的情况）
            const isHorizontalSafe = currentRect.right < rightEdge - 2 && currentRect.left > leftEdge + 2;
            const isVerticalSafe = currentRect.top > 2 && currentRect.bottom < viewportHeight - 2;

            if (isHorizontalSafe && isVerticalSafe) {
                return; // 位置安全，保持不动
            }
            // 否则，清除旧位置，让下方的逻辑重新寻找最佳落点
        }

        // Disable transition during measurement to get accurate positions
        controls.style.transition = 'none';

        // Reset all overrides
        controls.classList.remove('pos-left', 'pos-top', 'pos-bottom');
        controls.style.left = '';
        controls.style.right = '';
        controls.style.maxWidth = '';
        controls.style.whiteSpace = '';

        // Force reflow so the browser calculates the true final position
        controls.offsetWidth;

        let posClass = ''; // default: right side
        
        // --- 恢复丢失的测量逻辑 ---
        const rect = controls.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const rightEdge = Math.min(viewportWidth, containerRect.right);

        if (rect.right > rightEdge - 5) {
            // Try Left
            controls.classList.add('pos-left');
            controls.offsetWidth; // Force reflow
            const newRect = controls.getBoundingClientRect();
            const leftEdge = Math.max(0, containerRect.left);

            if (newRect.left < leftEdge + 5) {
                // Both sides overflow → switch to top/bottom
                controls.classList.remove('pos-left');

                const capsule = li.querySelector('.tag-capsule');
                const capsuleRect = capsule ? capsule.getBoundingClientRect() : li.getBoundingClientRect();
                const spaceAbove = capsuleRect.top;
                const spaceBelow = window.innerHeight - capsuleRect.bottom;

                if (spaceAbove >= spaceBelow) {
                    posClass = 'pos-top';
                    controls.classList.add('pos-top');
                } else {
                    posClass = 'pos-bottom';
                    controls.classList.add('pos-bottom');
                }

                const maxW = Math.min(containerRect.width, viewportWidth) - 20;
                controls.style.maxWidth = `${Math.max(maxW, 100)}px`;
            } else {
                posClass = 'pos-left';
            }
        }

        if (!isRefresh) {
            // Hidden-state transforms for each position (must match CSS)
            const hiddenTransforms = {
                '': 'translateY(-50%) translateX(5px) scale(0.95)',
                'pos-left': 'translateY(-50%) translateX(-5px) scale(0.95)',
                'pos-top': 'translateX(-50%) translateY(8px) scale(0.9)',
                'pos-bottom': 'translateX(-50%) translateY(-8px) scale(0.9)',
            };

            // Force element into hidden state (overrides CSS :hover if already active)
            controls.style.opacity = '0';
            controls.style.transform = hiddenTransforms[posClass];
            controls.offsetWidth; // Commit
        }

        // 获取当前标签容器的几何数据
        const capsule = li.querySelector('.tag-capsule');
        const capsuleRect = capsule.getBoundingClientRect();
        
        // --- 核心优化：边缘锚定 (Edge-Anchoring) ---
        // 为了实现“静止不动”且“向外扩张”，我们将位置锁定在相对于标签边缘的像素值上。
        // 关键点：
        // 1. 在右侧（默认）时，固定 style.left。工具栏向右生长。
        // 2. 在左侧（pos-left）时，固定 style.right。工具栏向左生长，绝不遮挡标签！
        if (posClass === 'pos-left') {
            // 左侧：固定右边距。计算公式：right = (li宽 - 4px重叠)
            // 这样工具栏内部即使因为 Focus 变宽，增长的方向也会朝向左侧空白处。
            controls.style.left = 'auto';
            controls.style.right = `${capsuleRect.width - 4}px`;
        } else if (posClass === 'pos-top' || posClass === 'pos-bottom') {
            // 上下位置：锁定在首次悬停时的 capsule 中心点像素值
            controls.style.left = `${capsuleRect.width / 2}px`;
        } else {
            // 默认在右侧：锁定左边距。固定在胶囊右边缘 - 4px 的重叠位置
            controls.style.left = `${capsuleRect.width - 4}px`;
            controls.style.right = 'auto';
        }

        // --- 动态置顶逻辑 (Generalized Sticky Logic) ---
        const toolbarConfig = this.options.toolbarConfig || {
            order: ['fav', 'copy', 'annotate', 'weight', 'dynWeight', 'split', 'retranslate', 'toggle', 'link', 'newline', 'del'],
            stickyIds: ['del']
        };
        const stickyIds = toolbarConfig.stickyIds || [];
        
        // 重置所有按键顺序
        const allControls = controls.querySelectorAll('.tbtn, .weight-control, .dyn-config-control, .divider-name-input');
        allControls.forEach(ctrl => ctrl.style.order = '');

        if (stickyIds.length > 0) {
            const isReverse = (posClass === 'pos-left' || posClass === 'pos-top');
            stickyIds.forEach((id, idx) => {
                const btnDef = BUTTON_DEFS[id];
                if (!btnDef) return;
                const selector = btnDef.isComplex 
                    ? (id === 'dynWeight' ? '.dyn-weight-control' : `.${id}-control`) 
                    : `.${btnDef.className}`;
                const btnEl = controls.querySelector(selector);
                if (btnEl) {
                    btnEl.style.order = isReverse ? (900 - idx) : (-900 + idx);
                }
            });

            // 特殊处理：非按键型控件（如 Divider Name Input）在反转模式下也应靠右（置底）
            if (isReverse) {
                const dividerInput = controls.querySelector('.divider-name-input');
                if (dividerInput) dividerInput.style.order = '950';
                const dynConfig = controls.querySelector('.dyn-config-control');
                if (dynConfig) dynConfig.style.order = '950';
            }
        }

        if (isRefresh) {
            // 刷新模式：跳过消失动画，直接就地更新位置，恢复过渡能力即可
            // 这避免了修改权重后工具栏闪烁消失的问题
            requestAnimationFrame(() => {
                controls.style.transition = '';
            });
        } else {
            // 首次进入模式：执行完整的"隐藏→淡入"进场动画
            requestAnimationFrame(() => {
                controls.style.transition = '';
                requestAnimationFrame(() => {
                    // Remove inline overrides → CSS :hover takes over → smooth animation
                    controls.style.opacity = '';
                    controls.style.transform = '';
                });
            });
        }
    }

    enterEditMode(li, index, clickEvent = null) {
        const tag = this.tags[index];
        const capsule = li.querySelector('.tag-capsule');
        const textSpan = li.querySelector('.tag-text');

        // Measure current width before clearing
        const rect = capsule.getBoundingClientRect();
        const currentWidth = rect.width;

        let cursorPosition = tag.value.length;
        if (clickEvent && textSpan) {
            const offset = parseInt(textSpan.dataset.offset || '0', 10);
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
                if (range && range.startContainer === textSpan.firstChild) {
                    cursorPosition = offset + range.startOffset;
                }
            }
        }

        li.classList.add('editing');
        capsule.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = tag.value;
        input.className = 'tag-inline-input';

        // Set width to match the tag's original width
        // Subtract a bit for padding/border if necessary, or just use content-box
        input.style.width = (currentWidth - 10) + 'px'; // approx padding adjustment

        capsule.appendChild(input);
        input.focus();
        
        // Set cursor position
        input.setSelectionRange(cursorPosition, cursorPosition);

        // Explicitly sync visual selection state
        li.classList.add('selected');
        this.selectedIndices.add(index);

        const save = () => {
            if (input.dataset.saved) return;
            input.dataset.saved = 'true';

            const val = input.value.trim();
            if (val && val !== tag.value) {
                this.tags[index].value = val;
                this.onChange(this.tags);
            } else if (!val) {
                this.removeTags([index]);
                return;
            }
            this.render();
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    }

    updateWeight(index, delta, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        let isAnyHeaderUpdated = false;

        indices.forEach(i => {
            const tagVal = this.tags[i].value;
            // 略过分界符
            if (tagVal === '|' && (i > 0 && i < this.tags.length - 1)) {
                return; 
            }
            let text = tagVal;
            let weight = 1.0;
            let tagText = text;

            let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            let headerMatch = text.match(/^([-?\d\.]+)::$/);

            if (blockMatch) {
                weight = parseFloat(blockMatch[1]);
                tagText = blockMatch[2];
            } else if (headerMatch) {
                weight = parseFloat(headerMatch[1]);
                tagText = ''; // Marker
            } else {
                // ... fallback ...
            }

            weight = Math.max(-99, Math.min(99, weight + delta));
            const formatted = (weight % 1 === 0) ? weight.toString() : weight.toFixed(1);

            if (headerMatch) {
                this.tags[i].value = `${formatted}::`;
                isAnyHeaderUpdated = true;
            } else if (Math.abs(weight - 1.0) < 0.001) {
                this.tags[i].value = tagText;
            } else {
                this.tags[i].value = `${formatted}::${tagText} ::`;
            }
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);

            if (isAnyHeaderUpdated) {
                // Find and update the corresponding footer
                // Simple heuristic: Next ' ::' tag.
                // Nesting is not supported by this regex logic effectively anyway.
                for (let j = index + 1; j < this.tags.length; j++) {
                    // If we hit another header before a footer, something is weird or nested
                    // But let's just look for the first footer.
                    if (this.tags[j].value === ' ::' || this.tags[j].value === '::') {
                        const footerEl = this.listElement.querySelectorAll('.tag-item')[j];
                        if (footerEl) {
                            this.updateTagVisuals(footerEl, this.tags[j], j);
                        }
                        break;
                    }
                }
            }
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    updateWeightManual(index, val, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        let isAnyHeaderUpdated = false;

        indices.forEach(i => {
            const tagVal = this.tags[i].value;
            // 略过分界符
            if (tagVal === '|' && (i > 0 && i < this.tags.length - 1)) {
                return;
            }
            let text = tagVal;
            let tagText = text;

            let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            let headerMatch = text.match(/^([-?\d\.]+)::$/);

            if (blockMatch) {
                tagText = blockMatch[2];
            } else if (headerMatch) {
                tagText = '';
            }

            const formatted = (val % 1 === 0) ? val.toString() : val.toFixed(1);

            if (headerMatch) {
                this.tags[i].value = `${formatted}::`;
                isAnyHeaderUpdated = true;
            } else if (Math.abs(val - 1.0) < 0.001) {
                this.tags[i].value = tagText;
            } else {
                this.tags[i].value = `${formatted}::${tagText} ::`;
            }
        });

        if (indices.length === 1 && li) {
            this.updateTagVisuals(li, this.tags[index], index);

            if (isAnyHeaderUpdated) {
                for (let j = index + 1; j < this.tags.length; j++) {
                    if (this.tags[j].value === ' ::' || this.tags[j].value === '::') {
                        const footerEl = this.listElement.querySelectorAll('.tag-item')[j];
                        if (footerEl) {
                            this.updateTagVisuals(footerEl, this.tags[j], j);
                        }
                        break;
                    }
                }
            }
            this.onChange(this.tags);
        } else {
            this.render();
            this.onChange(this.tags);
        }
    }

    updateDynWeight(index, delta, li = null) {
        // 计算新权重值
        const tag = this.tags[index];
        const currentDW = this.getOptionDynWeight(index);
        const newDW = Math.max(0, currentDW + delta);

        // 将新权重应用到整个选项段内所有 tag
        this._setOptionSectionDynWeight(index, newDW);

        if (li) {
            this.updateTagVisuals(li, this.tags[index], index);
        }
        this.onChange(this.tags);
    }

    updateDynWeightManual(index, val, li = null) {
        const newDW = Math.max(0, val);

        // 将新权重应用到整个选项段内所有 tag
        this._setOptionSectionDynWeight(index, newDW);

        if (li) {
            this.updateTagVisuals(li, this.tags[index], index);
        }
        this.onChange(this.tags);
    }

    /**
     * 设置指定索引所在选项段内所有成员 tag 的 dynWeight。
     * 确保 getOptionDynWeight() 无论从哪个 tag 扫描都能拿到一致的值。
     */
    _setOptionSectionDynWeight(index, weight) {
        // 向前找到段起始
        let start = 0;
        for (let j = index; j >= 0; j--) {
            const t = this.tags[j];
            const v = t.value;
            const isH = v.startsWith('||') && (v !== '||' || t.isStart);
            const isS = v === '|';
            if (isH || isS) { start = j + 1; break; }
        }

        // 扫描段内所有成员，统一设置 dynWeight
        for (let k = start; k < this.tags.length; k++) {
            const t = this.tags[k];
            const v = t.value;
            if ((v === '||' && !t.isStart) || v === '|') break; // footer 或分界符
            if (v === '\n') continue; // 跳过换行
            t.dynWeight = weight;
        }
    }

    // Adjust translation layout to match capsule width and scale font
    adjustTranslationLayout() {
        // Fix Layout Thrashing: Separate DOM Reads and Writes
        const items = this.listElement.querySelectorAll('.tag-item');
        const updates = [];

        // Phase 1: Reads (Measure all widths without triggering reflows)
        items.forEach(li => {
            const capsule = li.querySelector('.tag-capsule');
            const zhRow = li.querySelector('.tag-zh-row');

            if (capsule && zhRow && zhRow.textContent.trim()) {
                updates.push({
                    zhRow: zhRow,
                    width: capsule.offsetWidth
                });
            }
        });

        // Phase 2: Writes (Apply all styles at once)
        updates.forEach(({ zhRow, width }) => {
            zhRow.style.maxWidth = `${Math.max(width, 40)}px`;
            zhRow.style.fontSize = '11px';
        });
    }

    // New helper for localized updates
    updateTagVisuals(li, tag, index) {
        const textSpan = li.querySelector('.tag-text');
        const primary = li.querySelector('.tag-primary');
        const capsule = li.querySelector('.tag-capsule');
        const weightInput = li.querySelector('.weight-input');

        let text = tag.value;
        let weightVal = 1.0;
        let str = text;

        let blockMatch = text.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        let headerMatch = text.match(/^([-?\d\.]+)::$/);
        const isDynHeader = text.startsWith('||') && (text !== '||' || tag.isStart);
        const isDynFooter = text === '||' && !tag.isStart;
        let isCompHeader = false;
        let isCompFooter = text === ' ::' || text === '::';

        // Backtrack to find if we are in a group or dynamic block
        let inGroup = false;
        let inDynamic = false;
        let compDepth = 0;
        for (let j = 0; j < index; j++) {
            const val = this.tags[j].value;
            if (val.match(/^([-?\d\.]+)::$/)) {
                inGroup = true;
                compDepth++;
            } else if (val === ' ::' || val === '::') {
                if (compDepth > 0) {
                    compDepth--;
                    if (compDepth === 0) inGroup = false;
                }
            }
            
            if (val.startsWith('||') && (val !== '||' || this.tags[j].isStart)) inDynamic = true;
            else if (val === '||' && !this.tags[j].isStart) inDynamic = false;
        }
        
        isCompFooter = isCompFooter && compDepth > 0;
        const isCompMember = inGroup && !(!!headerMatch) && !isCompFooter;
        const isDynMember = inDynamic;
        const isDynSeparator = text === '|' && isDynMember;
        
        // Find if leader for localized update (using tags array instead of DOM for stability)
        // 首领 = 每个选项段中第一个启用的非特殊 tag
        let isOptionLeader = false;
        if (isDynMember && !isDynHeader && !isDynFooter && !isDynSeparator && text !== '\n' && !tag.disabled) {
            isOptionLeader = true; // Assume leader until proven otherwise
            for (let j = index - 1; j >= 0; j--) {
                const prevTag = this.tags[j];
                const prevVal = prevTag.value;
                if (prevVal.startsWith('||') || prevVal === '|') {
                    isOptionLeader = true;
                    break;
                }
                if (prevVal === '\n' || prevVal === '||' || prevVal === '::') {
                    isOptionLeader = true; 
                    break;
                }
                // 跳过禁用的 tag，不算作前面的 "另一个 tag"
                if (prevTag.disabled) continue;
                if (prevVal.trim() !== '' && prevVal !== '|') {
                    // Found another enabled tag before a separator -> not a leader
                    isOptionLeader = false;
                    break;
                }
            }
        }

        if (blockMatch) {
            weightVal = parseFloat(blockMatch[1]);
            str = blockMatch[2];
        } else if (headerMatch) {
            weightVal = parseFloat(headerMatch[1]);
            str = '';
            isCompHeader = true;
        } else if (isCompFooter) {
            str = ')';
            // Backtrack to find weight from closest header
            for (let j = index - 1; j >= 0; j--) {
                let m = this.tags[j].value.match(/^([-?\d\.]+)::$/);
                if (m) {
                    weightVal = parseFloat(m[1]);
                    break;
                }
            }
        } else {
            let inc = 0, dec = 0;
            if (text.startsWith('{') || text.startsWith('[')) {
                let s = text;
                while (s.startsWith('{') && s.endsWith('}')) { inc++; s = s.slice(1, -1); }
                if (inc === 0) while (s.startsWith('[') && s.endsWith(']')) { dec++; s = s.slice(1, -1); }
                if (inc > 0) weightVal = 1 + (inc * 0.1);
                else if (dec > 0) weightVal = 1 - (dec * 0.1);
                str = s;
            }
        }

        const isNewline = str === '\n' && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter;
        const isAiPending = this.isPendingAiTag(tag);
        const isAiPendingFailed = !!tag.aiPendingFailed;

        const cleanText = text.replace(/[\{\}\[\]]/g, '').trim();
        const canSplit = !isAiPending && !tag.aiOriginal && (!!blockMatch || (!isCompHeader && !isCompFooter && !(isCompMember || isDynMember) && !isNewline && !isDynHeader && !isDynFooter && cleanText.includes(',') && common.splitTags(cleanText).length > 1));
        const canAnnotate = !isAiPending && !tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter;
        const hasWeight = !isAiPending && (blockMatch || headerMatch || (!isNewline && !isCompFooter && !isCompMember)) && !isDynHeader && !isDynFooter;

        const dict = this.options.dict || {};
        const decWeightTitle = dict.btn_dec_weight || "Decrease Weight";
        const editWeightTitle = dict.btn_edit_weight || "Edit Weight";
        const incWeightTitle = dict.btn_inc_weight || "Increase Weight";
        const decDynWeightTitle = dict.btn_dec_dyn_weight || "Decrease Selection Weight";
        const editDynWeightTitle = dict.btn_edit_dyn_weight || "Edit Selection Weight";
        const incDynWeightTitle = dict.btn_inc_dyn_weight || "Increase Selection Weight";
        const splitTitle = dict.btn_split || "Split to markers";
        const mergeTitle = dict.btn_merge || "Merge group";
        const toggleTitle = dict.btn_toggle || "Enable/Disable";

        const isSelectionMember = this.selectedIndices.has(index);
        const isMultiSelect = this.selectedIndices.size > 1;

        const context = {
            isAiPending, isAiPendingFailed, isNewline, isCompHeader, isCompFooter, isDynHeader, isDynFooter, isDynMember, isDynSeparator,
            canAnnotate, canSplit, hasWeight, weightVal,
            isMultiSelect, isSelectionMember, isOptionLeader,
            titles: {
                decWeightTitle, editWeightTitle, incWeightTitle, decDynWeightTitle, editDynWeightTitle, incDynWeightTitle, toggleTitle,
                splitTitle, mergeTitle
            }
        };
        
        li.classList.remove('tag-comp-header', 'tag-comp-footer', 'tag-dyn-header', 'tag-dyn-footer', 'tag-dynamic', 'tag-comp-member', 'tag-dyn-member', 'tag-dyn-separator');
        if (isCompHeader) li.classList.add('tag-comp-header');
        if (isCompFooter) li.classList.add('tag-comp-footer');
        if (isDynHeader) li.classList.add('tag-dyn-header');
        if (isDynFooter) li.classList.add('tag-dyn-footer');
        if (isCompMember) li.classList.add('tag-comp-member');
        if (isDynMember) li.classList.add('tag-dyn-member');
        if (isDynHeader || isDynFooter || isDynMember) li.classList.add('tag-dynamic');
        if (isDynSeparator) li.classList.add('tag-dyn-separator');

        if (capsule) {
            capsule.className = 'tag-capsule';
            if (isCompHeader) capsule.classList.add('gh');
            if (isCompFooter) capsule.classList.add('gf');
            if (isDynHeader) capsule.classList.add('dh');
            if (isDynFooter) capsule.classList.add('df');
            if (isDynSeparator) capsule.classList.add('ds');
        }

        if (textSpan) textSpan.textContent = (isCompHeader || isCompFooter || isDynHeader || isDynFooter) ? '' : (isDynSeparator ? '|' : (isNewline ? '↵' : str));
        if (isNewline) li.classList.add('tag-newline');
        else li.classList.remove('tag-newline');

        if (weightInput && document.activeElement !== weightInput) {
            weightInput.value = weightVal.toFixed(1);
            weightInput.classList.remove('pos', 'neg');
            if (weightVal > 1.05) weightInput.classList.add('pos');
            else if (weightVal < 0.95) weightInput.classList.add('neg');
        }

        // Update weight badge
        let badge = li.querySelector('.tag-weight-badge');
        const showWeight = !isAiPending && (Math.abs(weightVal - 1.0) > 0.001 || (isCompHeader && !isDynHeader) || (isCompFooter && !isDynFooter)) && !isNewline;
        if (showWeight) {
            if (!badge) {
                badge = document.createElement('span');
                primary.prepend(badge);
            }
            badge.className = `tag-weight-badge ${weightVal > 1.0 ? 'pos' : (weightVal < 1.0 ? 'neg' : '')}`;
            badge.textContent = weightVal.toFixed(1);
        } else if (badge) {
            badge.remove();
        }

        // Update DynWeight badge - 从选项段扫描 dynWeight
        let dynBadge = li.querySelector('.tag-dyn-weight-mini-badge');
        const sectionDW = isOptionLeader ? this.getOptionDynWeight(index) : 1;
        if (!isAiPending && isOptionLeader && sectionDW !== 1) {
            if (!dynBadge) {
                dynBadge = document.createElement('span');
                dynBadge.className = 'tag-dyn-weight-mini-badge';
                dynBadge.title = 'Selection Weight';
                if (textSpan) textSpan.after(dynBadge);
                else primary.appendChild(dynBadge);
            }
            const formattedDyn = (sectionDW % 1 === 0) ? sectionDW : sectionDW.toFixed(1);
            dynBadge.textContent = formattedDyn;
        } else if (dynBadge) {
            dynBadge.remove();
        }

        const dynWeightInput = li.querySelector('.dyn-weight-input');
        if (dynWeightInput && document.activeElement !== dynWeightInput) {
            const dw = isOptionLeader ? sectionDW : (tag.dynWeight ?? 1);
            dynWeightInput.value = (dw % 1 === 0) ? dw : dw.toFixed(1);
            dynWeightInput.classList.remove('pos', 'neg');
            if (dw > 1.0) dynWeightInput.classList.add('pos');
            else if (dw < 1.0) dynWeightInput.classList.add('neg');
        }

        // Update disabled state
        if (tag.disabled) capsule.classList.add('disabled');
        else capsule.classList.remove('disabled');

        const btnToggle = li.querySelector('.tbtn-toggle');
        if (btnToggle) btnToggle.innerHTML = tag.disabled ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="2" y1="2" x2="22" y2="22"></line><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path></svg>`;

        const zhRow = li.querySelector('.tag-zh-row');
        this.syncPendingAiState(li, tag);
        if (zhRow) {
            if (tag.aiZhTranslation && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
                zhRow.textContent = tag.aiZhTranslation;
                zhRow.classList.remove('tag-ai-original');
            } else if (tag.aiOriginal && !isNewline && !isCompHeader && !isCompFooter && !isDynHeader && !isDynFooter) {
                zhRow.textContent = tag.aiOriginal;
                zhRow.classList.add('tag-ai-original');
            } else {
                zhRow.classList.remove('tag-ai-original');
            }
        }
        this.syncPendingAiZhState(li, tag);

        // 每一次视觉更新后，如果鼠标正悬停在上面，则需要重新评估位置
        if (li.matches(':hover') || (this.isClickToolbarMode() && li.classList.contains('toolbar-visible'))) {
            this.repositionToolbar(li, true); // 传入 isRefresh=true，尽量保持静止
        }

        // Update DynConfig inputs and Pick Badge
        const dynConfigControl = li.querySelector('.dyn-config-control');
        if (isDynHeader && dynConfigControl) {
            const minInput = dynConfigControl.querySelector('.dyn-min');
            const maxInput = dynConfigControl.querySelector('.dyn-max');
            const sepInput = dynConfigControl.querySelector('.dyn-sep');

            if (document.activeElement !== minInput && document.activeElement !== maxInput && document.activeElement !== sepInput) {
                // Parse from tag.value (e.g., ||2$$ or ||1-3$$and$$)
                let fullConfig = text.slice(2);
                let rangeStr = '';
                let joinerStr = '';

                if (fullConfig.includes('$$')) {
                    const parts = fullConfig.split('$$').filter(p => p !== '');
                    rangeStr = parts[0] || '';
                    joinerStr = parts[1] || '';
                } else {
                    rangeStr = fullConfig;
                }

                let minValue = rangeStr, maxValue = '';
                if (rangeStr.includes('-')) {
                    const parts = rangeStr.split('-');
                    minValue = parts[0];
                    maxValue = parts[1];
                } else if (rangeStr) {
                    minValue = '';
                    maxValue = rangeStr;
                }
                minInput.value = minValue;
                maxInput.value = maxValue;
                sepInput.value = joinerStr;

                // Visual Highlight for custom separator
                if (joinerStr) {
                    sepInput.classList.add('has-custom-sep');
                    li.classList.add('has-custom-joiner');
                } else {
                    sepInput.classList.remove('has-custom-sep');
                    li.classList.remove('has-custom-joiner');
                }
            }

            // Update Pick Badge
            let pickBadge = primary.querySelector('.tag-dyn-pick-badge');
            let fullConfigForBadge = text.slice(2);
            let rangeStrForBadge = '';
            if (fullConfigForBadge.includes('$$')) {
                rangeStrForBadge = fullConfigForBadge.split('$$')[0];
            } else {
                rangeStrForBadge = fullConfigForBadge;
            }

            if (rangeStrForBadge) {
                if (!pickBadge) {
                    pickBadge = document.createElement('span');
                    pickBadge.className = 'tag-dyn-pick-badge';
                    primary.prepend(pickBadge);
                }
                let displayCount = rangeStrForBadge.replace('-', '~');
                let fullConfigText = text.slice(2);
                let sepPart = '';
                if (fullConfigText.includes('$$')) {
                    const parts = fullConfigText.split('$$');
                    if (parts.length > 2 && parts[1]) {
                        sepPart = ` [${parts[1]}]`;
                    }
                }
                pickBadge.textContent = 'x' + displayCount + sepPart;
            } else if (pickBadge) {
                pickBadge.remove();
            }
        }

        // Update SmartGroup Button
        const controls = li.querySelector('.tag-controls');
        if (controls) {
            const btnDef = BUTTON_DEFS.smartGroup;
            const existingBtn = controls.querySelector('.tbtn-smart-group');
            const shouldShow = btnDef.showFor(tag, context);

            if (shouldShow && !existingBtn) {
                const btnHtml = btnDef.render(tag, context);
                const temp = document.createElement('div');
                temp.innerHTML = btnHtml;
                const actualBtn = temp.firstElementChild;
                actualBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.handleGroupToggle(index); };
                
                // Insert before Toggle (Standard order placement)
                const ref = controls.querySelector('.tbtn-toggle');
                if (ref) {
                    controls.insertBefore(actualBtn, ref);
                } else {
                    controls.appendChild(actualBtn);
                }
            } else if (shouldShow && existingBtn) {
                const newHtml = btnDef.render(tag, context);
                const temp = document.createElement('div');
                temp.innerHTML = newHtml;
                const newBtn = temp.firstElementChild;
                existingBtn.className = newBtn.className;
                existingBtn.innerHTML = newBtn.innerHTML;
                existingBtn.title = newBtn.title;
            } else if (!shouldShow && existingBtn) {
                existingBtn.remove();
            }

            // Handle insertDynSeparator
            const sepDef = BUTTON_DEFS.insertDynSeparator;
            const existingSep = controls.querySelector('.tbtn-insert-sep');
            const showSep = sepDef.showFor(tag, context);
            if (showSep && !existingSep) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tbtn tbtn-insert-sep';
                btn.title = dict[sepDef.titleKey] || sepDef.title || 'Insert Separator';
                btn.innerHTML = sepDef.svg;
                btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.insertDynSeparator(index); };
                controls.appendChild(btn);
            } else if (!showSep && existingSep) {
                existingSep.remove();
            }
        }
    }

    /**
     * 根据给定索引，找到该索引所属的动态抽取组的完整范围。
     * 适用于索引本身是 header/footer/member/separator 的任何情况。
     * @param {number} index - tags 数组中的任意索引
     * @returns {{ start: number, end: number } | null} - 组的起止索引(含)，或 null 表示不在动态组内
     */
    getDynGroupRange(index) {
        const tag = this.tags[index];
        if (!tag) return null;

        const isHeader = (t) => t.value.startsWith('||') && (t.value !== '||' || t.isStart);
        const isFooter = (t) => t.value === '||' && !t.isStart;

        // 如果自身就是 header，向后找 footer
        if (isHeader(tag)) {
            for (let i = index + 1; i < this.tags.length; i++) {
                if (isFooter(this.tags[i])) return { start: index, end: i };
            }
            return null; // 没找到配对的 footer
        }

        // 如果自身就是 footer，向前找 header
        if (isFooter(tag)) {
            for (let i = index - 1; i >= 0; i--) {
                if (isHeader(this.tags[i])) return { start: i, end: index };
            }
            return null;
        }

        // 其他情况（member 或 separator），双向扩搜
        let start = null, end = null;
        for (let i = index - 1; i >= 0; i--) {
            if (isHeader(this.tags[i])) { start = i; break; }
            if (isFooter(this.tags[i])) break; // 碰到另一个组的边界，说明 index 不在动态组内
        }
        if (start === null) return null;
        for (let i = index + 1; i < this.tags.length; i++) {
            if (isFooter(this.tags[i])) { end = i; break; }
            if (isHeader(this.tags[i])) break;
        }
        if (end === null) return null;
        return { start, end };
    }

    /**
     * 获取指定索引所在选项段的 dynWeight 值。
     * 选项段 = 从前一个 || header 或 | 分界符之后，到下一个 | 分界符或 || footer 之前。
     * 扫描该段内所有 tag，返回第一个 dynWeight !== 1 的值，找不到则返回 1。
     * @param {number} index - 选项段内任意索引
     * @returns {number} 选项段的动态权重值
     */
    getOptionDynWeight(index) {
        // 向前找到段的起始位置
        let start = 0;
        for (let j = index; j >= 0; j--) {
            const t = this.tags[j];
            const v = t.value;
            const isH = v.startsWith('||') && (v !== '||' || t.isStart);
            const isS = v === '|';
            if (isH || isS) {
                start = j + 1;
                break;
            }
        }

        // 从段起始扫描到段结束，找 dynWeight
        for (let k = start; k < this.tags.length; k++) {
            const t = this.tags[k];
            const v = t.value;
            const isF = v === '||' && !t.isStart;
            const isS = v === '|';
            if (isF || isS) break;
            if (t.dynWeight && t.dynWeight !== 1) return t.dynWeight;
        }
        return 1;
    }

    /**
     * 解散动态抽取组：移除 header、footer、| 分界符，清除所有组内 tag 的 dynWeight，
     * 保留普通内容标签。
     * @param {number} index - 组内任意一个索引（通常是 header 或 footer）
     */
    dissolveDynGroup(index) {
        const range = this.getDynGroupRange(index);
        if (!range) {
            // fallback: 如果找不到组范围，就只删除当前 tag
            this.removeTags([index]);
            return;
        }

        const { start, end } = range;
        const toRemove = new Set();
        toRemove.add(start); // header
        toRemove.add(end);   // footer

        // 遍历组内所有 tag
        for (let i = start + 1; i < end; i++) {
            const t = this.tags[i];
            if (t.value === '|') {
                toRemove.add(i); // 移除 | 分界符
            } else {
                // 保留普通 tag，但清除 dynWeight
                delete t.dynWeight;
            }
        }

        // 按索引倒序删除，避免索引偏移
        const sortedRemove = Array.from(toRemove).sort((a, b) => b - a);
        const removedTags = [];
        sortedRemove.forEach(idx => {
            if (this.tags[idx]) {
                removedTags.push(this.tags[idx]);
                this.tags.splice(idx, 1);
            }
        });

        if (removedTags.length > 0) {
            try { this.onRemoveTags(removedTags); } catch (e) { /* ignore */ }
        }

        this.clearSelection();
        this.render();
        this.onChange(this.tags);
    }

    /**
     * 切换整个动态抽取组的禁用状态（包括 header、footer、member、separator）。
     * 以 header 的当前状态取反作为目标状态。
     * @param {number} index - 组内任意一个索引
     */
    toggleDynGroupDisable(index) {
        const range = this.getDynGroupRange(index);
        if (!range) {
            this.toggleDisable(index);
            return;
        }

        // 以 header 的禁用状态取反
        const targetState = !this.tags[range.start].disabled;

        for (let i = range.start; i <= range.end; i++) {
            this.tags[i].disabled = targetState;
        }

        this.render();
        this.onChange(this.tags);
    }

    toggleDisable(index, li = null) {
        let indices = [index];
        if (this.selectedIndices.has(index)) {
            indices = Array.from(this.selectedIndices);
        }

        const targetState = !this.tags[index].disabled;

        indices.forEach(i => {
            const t = this.tags[i];
            const isStructural = !!t.value.match(/^([-?\d\.]+)::$/) || (t.value === ' ::' || t.value === '::');
            if (!isStructural) {
                t.disabled = targetState;
            }
        });

        // 判断是否在动态组内——leader 状态会受影响，需要全量刷新
        const needsFullRender = indices.length > 1 || !li || this._isInDynamicGroup(index);
        if (needsFullRender) {
            this.render();
        } else {
            this.updateTagVisuals(li, this.tags[index], index);
        }
        this.onChange(this.tags);
    }

    /**
     * 判断指定索引的 tag 是否在动态组内（|| ... || 之间）
     */
    _isInDynamicGroup(index) {
        for (let j = index; j >= 0; j--) {
            const t = this.tags[j];
            const v = t.value;
            if (v.startsWith('||') && (v !== '||' || t.isStart)) return true;  // 找到 header
            if (v === '||' && !t.isStart) return false; // 找到另一个组的 footer
        }
        return false;
    }

    async copyTag(index) {
        let toCopy = [this.tags[index]];
        if (this.selectedIndices.has(index)) {
            toCopy = Array.from(this.selectedIndices).sort((a, b) => a - b).map(i => this.tags[i]);
        }
        const text = toCopy.map(t => t.value).join(', ');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                throw new Error('Clipboard API unavailable');
            }
            // Flash feedback for all copied tags
            const items = this.listElement.querySelectorAll('.tag-item');
            (this.selectedIndices.has(index) ? Array.from(this.selectedIndices) : [index]).forEach(idx => {
                const li = items[idx];
                if (li) {
                    li.classList.add('flash-success');
                    setTimeout(() => li.classList.remove('flash-success'), 500);
                }
            });
        } catch (err) {
            // Fallback to execCommand
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                textArea.remove();
                // Flash feedback for all copied tags
                const items = this.listElement.querySelectorAll('.tag-item');
                (this.selectedIndices.has(index) ? Array.from(this.selectedIndices) : [index]).forEach(idx => {
                    const li = items[idx];
                    if (li) {
                        li.classList.add('flash-success');
                        setTimeout(() => li.classList.remove('flash-success'), 500);
                    }
                });
            } catch (err2) {
                console.error('Failed to copy tag:', err2);
            }
        }
    }

    handleGroupToggle(index) {
        const tag = this.tags[index];
        const isSelectionMember = this.selectedIndices.has(index);
        const isMultiSelect = this.selectedIndices.size > 1;
        const isCompHeader = !!tag.value.match(/^([-?\d\.]+)::$/);
        const isCompFooter = tag.value === ' ::' || tag.value === '::';

        if ((isMultiSelect && isSelectionMember) || isCompHeader || isCompFooter) {
            // MERGE MODE
            let headerIndex = -1;
            let footerIndex = -1;
            let tagsToMerge = [];
            let weight = "1.0";

            // Structural filter helper
            const isStructural = (t) => t.value === '\n' || t.value === ' ::' || t.value === '::' || !!t.value.match(/^([-?\d\.]+)::$/) || (t.value.startsWith('||') && (t.value !== '||' || t.isStart)) || (t.value === '||' && !t.isStart);

            if (isMultiSelect && isSelectionMember) {
                const sortedIndices = Array.from(this.selectedIndices).sort((a, b) => a - b);
                
                // --- 权重提取逻辑：优先找专门的头卡片 ---
                const selectedHeaderTag = sortedIndices.map(i => this.tags[i]).find(t => !!t.value.match(/^([-?\d\.]+)::$/));
                if (selectedHeaderTag) {
                    weight = selectedHeaderTag.value.match(/^([-?\d\.]+)::$/)[1];
                }

                // Filter out non-content tags from being merged INTO the text content
                const contentIndices = sortedIndices.filter(i => !isStructural(this.tags[i]));
                if (contentIndices.length === 0) {
                    this.clearSelection();
                    return;
                }

                headerIndex = sortedIndices[0]; // Merged item will be placed here
                footerIndex = sortedIndices[sortedIndices.length - 1];
                tagsToMerge = contentIndices.map(i => this.tags[i]);

                // 如果没找到头卡片，则从第一个内容标签继承权重
                if (!selectedHeaderTag) {
                    let firstVal = tagsToMerge[0].value;
                    let m = firstVal.match(/^([-?\d\.]+)::(.*?)\s*::$/);
                    if (m) {
                        weight = parseFloat(m[1]).toFixed(1);
                        tagsToMerge[0] = { ...tagsToMerge[0], value: m[2] };
                    } else if (firstVal.startsWith('{') || firstVal.startsWith('[')) {
                        let str = firstVal;
                        let inc = 0, dec = 0;
                        while (str.startsWith('{') && str.endsWith('}')) { inc++; str = str.slice(1, -1); }
                        if (inc === 0) while (str.startsWith('[') && str.endsWith(']')) { dec++; str = str.slice(1, -1); }
                        
                        if (inc > 0 || dec > 0) {
                            weight = (inc > 0 ? 1 + (inc * 0.1) : 1 - (dec * 0.1)).toFixed(1);
                            tagsToMerge[0] = { ...tagsToMerge[0], value: str };
                        }
                    }
                }
            } else {
                // Group Header/Footer merge
                if (isCompHeader) {
                    weight = tag.value.match(/^([-?\d\.]+)::$/)[1];
                    let depth = 1;
                    headerIndex = index;
                    for (let i = index + 1; i < this.tags.length; i++) {
                        if (!!this.tags[i].value.match(/^([-?\d\.]+)::$/)) depth++;
                        else if (this.tags[i].value === ' ::' || this.tags[i].value === '::') depth--;
                        
                        if (depth === 0) {
                            footerIndex = i;
                            break;
                        }
                    }
                } else {
                    let depth = 1;
                    footerIndex = index;
                    for (let i = index - 1; i >= 0; i--) {
                        if (this.tags[i].value === ' ::' || this.tags[i].value === '::') depth++;
                        else if (!!this.tags[i].value.match(/^([-?\d\.]+)::$/)) depth--;
                        
                        if (depth === 0) {
                            headerIndex = i;
                            weight = this.tags[i].value.match(/^([-?\d\.]+)::$/)[1];
                            break;
                        }
                    }
                }

                if (headerIndex !== -1 && footerIndex !== -1) {
                    let contentIdxs = [];
                    for(let i = headerIndex + 1; i < footerIndex; i++) contentIdxs.push(i);
                    // Filter structural out just in case
                    contentIdxs = contentIdxs.filter(i => !isStructural(this.tags[i]));
                    tagsToMerge = contentIdxs.map(i => this.tags[i]);
                }
            }

            if (headerIndex === -1 || footerIndex === -1 || tagsToMerge.length === 0) {
                this.clearSelection();
                return;
            }

            const contentStr = tagsToMerge.map(t => {
                let val = t.value;
                let m = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
                if (m) return m[2]; // Unwrap block members if merging nested? (Basic support)
                return val;
            }).join(', ');

            let newTagValue;
            if (tagsToMerge.length === 1 && (parseFloat(weight) === 1.0)) {
                newTagValue = contentStr;
            } else {
                newTagValue = `${weight}::${contentStr} ::`;
            }

            if (isMultiSelect) {
                // Delete ALL selected tags (including structural ones like old header/footer)
                let newTags = [...this.tags];
                const indicesToDelete = Array.from(this.selectedIndices).sort((a, b) => b - a); // Back to front
                
                const firstIdx = Array.from(this.selectedIndices).sort((a, b) => a - b)[0];
                indicesToDelete.forEach(idx => {
                    newTags.splice(idx, 1);
                });
                
                newTags.splice(firstIdx, 0, { value: newTagValue, disabled: tagsToMerge[0].disabled });
                this.tags = newTags;
            } else {
                this.tags.splice(headerIndex, footerIndex - headerIndex + 1, {
                    value: newTagValue,
                    disabled: this.tags[headerIndex].disabled
                });
            }

            this.clearSelection();
            this.render();
            this.onChange(this.tags);

        } else {
            // SPLIT MODE
            const blockMatch = tag.value.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            let weight, content, isWeightedBlock = !!blockMatch;

            if (blockMatch) {
                weight = blockMatch[1];
                content = blockMatch[2];
            } else {
                weight = "1.0";
                content = tag.value;
            }

            // Using common.splitTags for robust bracket-aware splitting
            const parts = common.splitTags(content);
            if (parts.length <= 1 && !isWeightedBlock) return; // Nothing to split

            let newTags;
            if (isWeightedBlock) {
                newTags = [
                    { value: `${weight}::`, disabled: tag.disabled },
                    ...parts.map(p => ({ value: p, disabled: tag.disabled })),
                    { value: ' ::', disabled: tag.disabled }
                ];
            } else {
                newTags = parts.map(p => ({ value: p, disabled: tag.disabled }));
            }

            this.tags.splice(index, 1, ...newTags);
            this.render();
            this.onChange(this.tags);
        }
    }

    // Keep legacy for safety if referenced elsewhere, but handleGroupToggle is primary now
    splitGroupTag(index) { this.handleGroupToggle(index); }
    mergeGroupTag(index) { this.handleGroupToggle(index); }

    showCopyFeedback(index) {
        // Use data-index attribute to find the element, not DOM position
        const el = this.listElement.querySelector(`.tag-item[data-index="${index}"]`);
        if (el) {
            el.classList.add('flash-success');
            setTimeout(() => el.classList.remove('flash-success'), 500);
        }
    }

    // cycleBrackets removed

    removeTags(indices) {
        // If the target is part of a selection, remove all selected
        let toRemove = indices;
        if (indices.length === 1 && this.selectedIndices.has(indices[0])) {
            toRemove = Array.from(this.selectedIndices);
        }

        const toRemoveSet = new Set(toRemove);

        // Smart Pairing: Find pairs for any comp header or footer matching to avoid orphans
        toRemove.forEach(idx => {
            const tag = this.tags[idx];
            if (!tag) return;
            const isCompHeader = !!tag.value.match(/^([-?\d\.]+)::$/);
            const isCompFooter = tag.value === ' ::' || tag.value === '::';
            
            if (isCompHeader) {
                let depth = 1;
                for (let i = idx + 1; i < this.tags.length; i++) {
                    const t = this.tags[i];
                    if (!!t.value.match(/^([-?\d\.]+)::$/)) depth++;
                    else if (t.value === ' ::' || t.value === '::') depth--;
                    
                    if (depth === 0) {
                        toRemoveSet.add(i);
                        break;
                    }
                }
            } else if (isCompFooter) {
                let depth = 1;
                for (let i = idx - 1; i >= 0; i--) {
                    const t = this.tags[i];
                    if (t.value === ' ::' || t.value === '::') depth++;
                    else if (!!t.value.match(/^([-?\d\.]+)::$/)) depth--;
                    
                    if (depth === 0) {
                        toRemoveSet.add(i);
                        break;
                    }
                }
            }
        });

        toRemove = Array.from(toRemoveSet);

        const removedTags = [];
        
        // Sort descending to avoid index shifting during splice
        toRemove.sort((a, b) => b - a);
        toRemove.forEach(idx => {
            if (this.tags[idx]) {
                removedTags.push(this.tags[idx]);
                this.tags.splice(idx, 1);
            }
        });

        if (removedTags.length > 0) {
            try {
                this.onRemoveTags(removedTags);
            } catch (error) {
                console.error('[TagEditor] Failed to handle removed tags:', error);
            }
        }

        this.clearSelection();
        this.render();
        this.onChange(this.tags);
    }

    handleMarqueeStart(e) {
        // Only trigger if click is on the container background or the list, not on a tag or controls
        if (e.target.closest('.tag-item') || e.target.closest('.tag-controls')) return;
        
        this.isSelecting = true;
        this.container.classList.add('is-selecting');
        this.startPos = { x: e.clientX, y: e.clientY };
        
        // Clear selection unless Ctrl/Shift is held
        if (!e.ctrlKey && !e.shiftKey) {
            this.clearSelection();
        }

        this.selectionBoxEl.style.display = 'block';
        this.selectionBoxEl.style.left = `${e.clientX}px`;
        this.selectionBoxEl.style.top = `${e.clientY}px`;
        this.selectionBoxEl.style.width = '0px';
        this.selectionBoxEl.style.height = '0px';
    }

    handleMarqueeMove(e) {
        if (!this.isSelecting) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const left = Math.min(this.startPos.x, currentX);
        const top = Math.min(this.startPos.y, currentY);
        const width = Math.abs(this.startPos.x - currentX);
        const height = Math.abs(this.startPos.y - currentY);

        this.selectionBoxEl.style.left = `${left}px`;
        this.selectionBoxEl.style.top = `${top}px`;
        this.selectionBoxEl.style.width = `${width}px`;
        this.selectionBoxEl.style.height = `${height}px`;

        // Collision detection
        const marqueeRect = this.selectionBoxEl.getBoundingClientRect();
        const tagElements = this.listElement.querySelectorAll('.tag-item');

        tagElements.forEach((el) => {
            // Use data-index (tag array index), NOT DOM position
            // When newline separators exist, DOM position !== tag array index
            const tagIndex = parseInt(el.dataset.index, 10);
            if (isNaN(tagIndex)) return;
            
            // For newline tags, only use the compact capsule rect for collision, not the full 100% width li
            const isNewline = el.classList.contains('tag-newline');
            const targetEl = isNewline ? el.querySelector('.tag-capsule') : el;
            if (!targetEl) return;

            const tagRect = targetEl.getBoundingClientRect();
            const isOverlapping = !(marqueeRect.right < tagRect.left || 
                                    marqueeRect.left > tagRect.right || 
                                    marqueeRect.bottom < tagRect.top || 
                                    marqueeRect.top > tagRect.bottom);

            if (isOverlapping) {
                this.selectedIndices.add(tagIndex);
            } else if (!e.ctrlKey && !e.shiftKey) {
                this.selectedIndices.delete(tagIndex);
            }
        });

        this.updateSelectionVisuals();
    }

    handleMarqueeEnd() {
        if (!this.isSelecting) return;
        this.isSelecting = false;
        this.container.classList.remove('is-selecting');
        this.selectionBoxEl.style.display = 'none';
        this.lastSelectedIndex = null; // Reset shift-selection anchor
    }

    insertDynSeparator(index) {
        this.tags.splice(index + 1, 0, { value: '|', disabled: false });
        this.render();
        this.onChange(this.tags);
    }

    addTag(value) {
        // 智能插入位置：
        // 如果当前有选中项，则将新标签插入到最大选中索引的后面；
        // 否则默认追加到末尾。
        let insertIndex = this.tags.length;
        if (this.selectedIndices.size > 0) {
            insertIndex = Math.max(...Array.from(this.selectedIndices)) + 1;
        }

        const newTag = this.insertTag(value, insertIndex, true);
        return newTag;
    }

    insertTag(value, index, shouldUpdateSelection = false) {
        const newTag = this.normalizeTagInput(value);
        if (!newTag) return null;
        const val = newTag.value;

        // 检测是否为动态语法头部（||）
        const isDynHeader = val.startsWith('||');
        let shouldAutoClose = false;

        if (isDynHeader) {
            // 检查当前是否已在动态块内
            let inDynamic = false;
            this.tags.forEach(t => {
                const tv = t.value;
                const isStart = tv.startsWith('||') && (tv !== '||' || t.isStart);
                const isEnd = tv === '||' && !t.isStart;
                if (isStart) inDynamic = true;
                else if (isEnd) inDynamic = false;
            });

            // 不在动态块内时，自动添加关闭标记
            if (!inDynamic) {
                shouldAutoClose = true;
            }
        }

        if (isDynHeader) newTag.isStart = true;

        this.tags.splice(index, 0, newTag);

        if (shouldAutoClose) {
            this.tags.splice(index + 1, 0, { value: '||', disabled: false });
        }

        // 更新选中状态到插入点，使连续插入的下一个标签能追随上一个
        if (shouldUpdateSelection) {
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
            this.lastSelectedIndex = index;
        }

        this.render();
        this.onChange(this.tags);
        return newTag;
    }

    _showExternalLinkMenu(e, tagText) {
        // 如果当前屏幕上已经有打开的菜单了，先移除它
        const existingMenu = document.getElementById("autocomplete-link-menu");
        if (existingMenu) existingMenu.remove();

        // 核心修正：移除权重与各种包裹符号，仅保留 Tag 本体进行查询
        let cleanText = tagText;
        const blockMatch = tagText.match(/^([-?\d\.]+)::(.*?)\s*::$/);
        if (blockMatch) {
            cleanText = blockMatch[2];
        } else {
            // 兼容旧的大括号/中括号权重样式
            let str = tagText;
            while ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
                str = str.slice(1, -1);
            }
            cleanText = str;
        }

        const menu = document.createElement("div");
        menu.id = "autocomplete-link-menu";
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY + 15}px`;

        const addOption = (text, formatter, hoverColor) => {
            const opt = document.createElement("div");
            opt.className = "link-option";
            opt.textContent = text;
            opt.onmouseenter = () => { opt.style.color = hoverColor; };
            opt.onmouseleave = () => { opt.style.color = ''; };
            opt.onmousedown = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                window.open(formatter(encodeURIComponent(cleanText.trim())), "_blank");
                menu.remove();
            };
            menu.appendChild(opt);
        };

        addOption("📖 Danbooru Wiki", (tag) => `https://danbooru.donmai.us/wiki_pages/${tag}`, "#a78bfa");
        addOption("🎨 Danbooru 图库", (tag) => `https://danbooru.donmai.us/posts?tags=${tag}`, "#4ADE80");
        addOption("🎨 Gelbooru 图库", (tag) => `https://gelbooru.com/index.php?page=post&s=list&tags=${tag}`, "#38bdf8");

        document.body.appendChild(menu);

        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener("mousedown", closeMenu);
            }
        };
        setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
    }

    removeTagByText(textToRemove) {
        if (!textToRemove) return;
        const textToMatch = textToRemove.trim();
        let changed = false;
        
        // Reverse iterate to safely remove multiple instances if necessary 
        // (though usually we remove one by one or all matching tags)
        for (let i = this.tags.length - 1; i >= 0; i--) {
            // Clean dynamic/weight markers for match comparison if needed
            // Currently, panel sends exact raw text (e.g. "1girl"), so simple match should work for basic tags.
            // But if it has weight, we might need a regex. For simple grouping tags:
            const val = this.tags[i].value;
            let currentText = val;
            
            // Extract core text if it's a weighted/composite tag
            let blockMatch = val.match(/^([-?\d\.]+)::(.*?)\s*::$/);
            if (blockMatch) currentText = blockMatch[2];
            else {
                let inc = 0, dec = 0;
                let s = val;
                if (s.startsWith('{') || s.startsWith('[')) {
                    while (s.startsWith('{') && s.endsWith('}')) { inc++; s = s.slice(1, -1); }
                    if (inc === 0) while (s.startsWith('[') && s.endsWith(']')) { dec++; s = s.slice(1, -1); }
                    currentText = s;
                }
            }
            
            if (currentText === textToMatch) {
                this.tags.splice(i, 1);
                changed = true;
                break; // Just remove the first matching one (from end, or we can break immediately after finding first)
            }
        }

        if (changed) {
            this.clearSelection();
            this.render();
            this.onChange(this.tags);
        }
    }

}
