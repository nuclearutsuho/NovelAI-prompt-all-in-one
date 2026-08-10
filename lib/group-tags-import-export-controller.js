// Group Tags 导入导出控制器：隔离文件读写、弹窗交互与数据合并流程。
(function initGroupTagsImportExportController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GroupTagsImportExportController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createImportExportApi() {
  'use strict';

  const DEFAULT_EXPORT_FORMAT = 'group-tags-export';
  const DEFAULT_SCHEMA_VERSION = 1;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extractImportData(payload, format = DEFAULT_EXPORT_FORMAT) {
    if (payload && Array.isArray(payload.categories)) return payload;
    if (payload?.format === format && payload.data && Array.isArray(payload.data.categories)) {
      return payload.data;
    }
    if (payload?.data && Array.isArray(payload.data.categories)) return payload.data;
    throw new Error('导入文件格式无效，未找到 categories 数组');
  }

  function getTimestampForFilename(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  function buildExportPayload(data, options = {}) {
    const now = typeof options.now === 'function' ? options.now() : new Date();
    return {
      format: options.format || DEFAULT_EXPORT_FORMAT,
      schemaVersion: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      data
    };
  }

  function buildImportSummaryMessage(mode, summary, normalizationSummary, defaultSummary, countSkipped) {
    const lines = [];

    if (mode === 'overwrite') {
      lines.push('已用导入文件覆盖当前数据。');
    } else {
      lines.push('已将导入文件合并到当前数据。');
      lines.push(`新增分类 ${summary.addedCategories} 个，分组 ${summary.addedGroups} 个，标签 ${summary.addedTags} 个。`);
    }

    if (defaultSummary.addedCategories || defaultSummary.addedGroups || defaultSummary.addedTags) {
      lines.push(`默认库补增：分类 ${defaultSummary.addedCategories} 个，分组 ${defaultSummary.addedGroups} 个，标签 ${defaultSummary.addedTags} 个。`);
    }

    lines.push(`跳过重复或无效项 ${countSkipped(summary) + countSkipped(normalizationSummary)} 个。`);
    return lines.join('\n');
  }

  function resolveImportedData(options = {}) {
    const {
      mode,
      rawData,
      currentData,
      defaultData,
      dataUtils
    } = options;

    if (!['merge', 'overwrite'].includes(mode)) {
      throw new Error(`不支持的导入方式: ${mode || 'unknown'}`);
    }

    const normalizedImport = dataUtils.normalizeGroupTagsData(rawData);
    let nextData;
    let importSummary = dataUtils.createMergeSummary();

    if (mode === 'overwrite') {
      nextData = dataUtils.cloneData(normalizedImport.data);
    } else {
      const mergedImport = dataUtils.mergeGroupTagsData(currentData, normalizedImport.data);
      nextData = mergedImport.data;
      importSummary = mergedImport.summary;
    }

    const mergedWithDefault = dataUtils.mergeGroupTagsData(nextData, defaultData);
    return {
      data: mergedWithDefault.data,
      importSummary,
      normalizationSummary: normalizedImport.summary,
      defaultSummary: mergedWithDefault.summary
    };
  }

  function createController(options = {}) {
    const {
      scope,
      dataUtils,
      documentRef = typeof document !== 'undefined' ? document : null,
      modalRoot,
      importFileInput,
      showModal,
      hideModal,
      getIsEditMode,
      getCurrentData,
      getDefaultData,
      saveData,
      syncTranslations,
      rebuildData,
      applyData,
      BlobCtor = typeof Blob !== 'undefined' ? Blob : null,
      urlApi = typeof URL !== 'undefined' ? URL : null,
      now = () => new Date(),
      logger = console
    } = options;

    const requiredDataMethods = [
      'cloneData',
      'createMergeSummary',
      'countSummarySkipped',
      'normalizeGroupTagsData',
      'mergeGroupTagsData'
    ];
    const missingDataMethods = requiredDataMethods.filter(name => typeof dataUtils?.[name] !== 'function');
    if (
      missingDataMethods.length > 0 ||
      !documentRef ||
      !modalRoot ||
      typeof showModal !== 'function' ||
      typeof hideModal !== 'function' ||
      typeof getCurrentData !== 'function' ||
      typeof getDefaultData !== 'function' ||
      typeof saveData !== 'function' ||
      typeof syncTranslations !== 'function' ||
      typeof rebuildData !== 'function' ||
      typeof applyData !== 'function'
    ) {
      throw new Error(`[GroupTagsImportExport] 缺少控制器依赖${missingDataMethods.length ? `: ${missingDataMethods.join(', ')}` : ''}`);
    }

    let pendingModeResolver = null;

    function resetFileInput() {
      if (importFileInput) importFileInput.value = '';
    }

    function bindModalAction(action, handler) {
      const target = modalRoot.querySelector(`[data-action="${action}"]`);
      if (target) target.onclick = handler;
    }

    function showInfo(title, message) {
      showModal(`
        <h3>${escapeHtml(title)}</h3>
        <div style="color:#d1d5db;font-size:12px;line-height:1.6;white-space:pre-line;">${escapeHtml(message)}</div>
        <div class="modal-buttons">
          <button class="modal-btn primary" data-action="info-confirm">确定</button>
        </div>
      `);
      bindModalAction('info-confirm', hideModal);
    }

    function settleImportMode(mode, options = {}) {
      const resolve = pendingModeResolver;
      pendingModeResolver = null;
      if (options.hide !== false) hideModal();
      resolve?.(mode);
    }

    function cancelPendingDialog(options = {}) {
      if (!pendingModeResolver) return false;
      settleImportMode(null, options);
      return true;
    }

    function promptImportMode() {
      cancelPendingDialog();
      return new Promise(resolve => {
        pendingModeResolver = resolve;
        showModal(`
          <h3>选择导入方式</h3>
          <div style="margin-bottom:12px;padding:10px 12px;border:1px solid rgba(245, 158, 11, 0.28);border-radius:8px;background:rgba(245, 158, 11, 0.08);color:#fcd34d;font-size:12px;line-height:1.7;">
            导入前建议先备份当前 Tags 组信息，尤其是在使用“覆盖”导入时，原有自定义内容可能被替换。
          </div>
          <div style="color:#d1d5db;font-size:12px;line-height:1.6;">
            覆盖：用文件内容替换当前数据，再补齐默认库新增项。<br>
            合并：保留当前数据，只补充文件中的缺失项。
          </div>
          <div class="modal-buttons">
            <button class="modal-btn" data-action="import-backup">下载当前备份</button>
            <button class="modal-btn" data-action="import-cancel">取消</button>
            <button class="modal-btn" data-action="import-merge">合并</button>
            <button class="modal-btn primary" data-action="import-overwrite">覆盖</button>
          </div>
        `);

        bindModalAction('import-backup', () => exportData());
        bindModalAction('import-cancel', () => settleImportMode(null));
        bindModalAction('import-merge', () => settleImportMode('merge'));
        bindModalAction('import-overwrite', () => settleImportMode('overwrite'));
      });
    }

    async function exportData() {
      const currentData = getCurrentData();
      if (!currentData?.categories) {
        showInfo('导出失败', '当前没有可导出的分组标签数据。');
        return false;
      }

      if (!BlobCtor || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
        showInfo('导出失败', '当前浏览器不支持文件下载。');
        return false;
      }

      const exportDate = now();
      const payload = buildExportPayload(currentData, { now: () => exportDate });
      const blob = new BlobCtor([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = urlApi.createObjectURL(blob);
      const link = documentRef.createElement('a');
      try {
        link.href = url;
        link.download = `group-tags-${getTimestampForFilename(exportDate)}.json`;
        documentRef.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        urlApi.revokeObjectURL(url);
      }
      return true;
    }

    async function importData(file) {
      if (!file) return false;

      if (getIsEditMode?.()) {
        showInfo('无法导入', '请先保存或取消当前编辑，再执行导入。');
        resetFileInput();
        return false;
      }

      try {
        const payload = JSON.parse(await file.text());
        const importMode = await promptImportMode();
        if (!importMode) return false;

        const resolved = resolveImportedData({
          mode: importMode,
          rawData: extractImportData(payload),
          currentData: getCurrentData(),
          defaultData: getDefaultData(),
          dataUtils
        });

        let nextData = await saveData(resolved.data);
        await syncTranslations(nextData);
        nextData = await rebuildData(nextData);
        applyData(nextData);

        showInfo(
          '导入完成',
          buildImportSummaryMessage(
            importMode,
            resolved.importSummary,
            resolved.normalizationSummary,
            resolved.defaultSummary,
            dataUtils.countSummarySkipped
          )
        );
        return true;
      } catch (error) {
        logger.error?.('[GroupTags] 导入数据失败:', error);
        showInfo('导入失败', error?.message || '无法解析导入文件，请确认 JSON 格式正确。');
        return false;
      } finally {
        resetFileInput();
      }
    }

    function dispose() {
      cancelPendingDialog({ hide: false });
      resetFileInput();
    }

    scope?.add?.(dispose);

    return {
      exportData,
      importData,
      showInfo,
      cancelPendingDialog,
      dispose
    };
  }

  return {
    DEFAULT_EXPORT_FORMAT,
    DEFAULT_SCHEMA_VERSION,
    extractImportData,
    getTimestampForFilename,
    buildExportPayload,
    buildImportSummaryMessage,
    resolveImportedData,
    createController
  };
});
