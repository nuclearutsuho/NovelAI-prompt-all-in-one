// Popup 同步状态控制器：负责资源徽章、相对时间、挂起状态和缩放持久化。
export default function createSyncStatusController(options = {}) {
  const {
    documentRef = document,
    runtime = globalThis.NaiAioRuntime,
    storageRepository,
    storageChangedEvent = chrome.storage.onChanged
  } = options;

  if (!runtime?.acquire) throw new TypeError('[Sync Status] 缺少运行时生命周期内核');
  if (!storageRepository?.get || !storageRepository?.set) {
    throw new TypeError('[Sync Status] 缺少扩展存储仓库');
  }

  const scope = runtime.acquire('extension:popup-sync-status');
  let saveTimer = null;

  const controller = {
    container: null,
    badges: {},
    libraryBtn: null,
    currentScale: 1,
    cachedStats: {},

    async init() {
      this.container = documentRef.getElementById('sync-status-container');
      this.badges = {
        wildcards: documentRef.getElementById('popover-badge-wildcards'),
        favorites: documentRef.getElementById('popover-badge-favorites'),
        grouptags: documentRef.getElementById('popover-badge-grouptags'),
        userdict: documentRef.getElementById('popover-badge-userdict')
      };
      this.libraryBtn = documentRef.getElementById('btn-library');

      const data = await storageRepository.get([
        'sync_stats_cache',
        'syncPageActive',
        'sync_popover_scale'
      ]);
      if (scope.disposed) return;

      this.cachedStats = data.sync_stats_cache || {};
      this.updateUI(this.cachedStats);
      this.updateReadyState(Boolean(data.syncPageActive));
      if (Number.isFinite(Number(data.sync_popover_scale))) {
        this.currentScale = Math.min(Math.max(0.5, Number(data.sync_popover_scale)), 3);
        this.applyScale();
      }

      if (this.libraryBtn) {
        scope.on(this.libraryBtn, 'wheel', event => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.05 : 0.05;
          const nextScale = Math.min(Math.max(0.5, this.currentScale + delta), 3);
          if (nextScale === this.currentScale) return;
          this.currentScale = nextScale;
          this.applyScale();
          this.saveScale();
        }, { passive: false });
      }

      scope.chromeEvent(storageChangedEvent, (changes, area) => {
        if (area !== 'local') return;
        if (changes.sync_stats_cache) {
          this.cachedStats = changes.sync_stats_cache.newValue || {};
          this.updateUI(this.cachedStats);
        }
        if (changes.syncPageActive) this.updateReadyState(Boolean(changes.syncPageActive.newValue));
        if (changes.sync_pending_favorites?.newValue) this.setPending('favorites');
        if (changes.sync_pending_grouptags?.newValue) this.setPending('grouptags');
        if (changes.sync_pending_userdict?.newValue) this.setPending('userdict');
        if (changes.last_sync_event?.newValue?.id) this.triggerPing(changes.last_sync_event.newValue.id);
      });

      scope.interval(() => this.updateUI(this.cachedStats), 60000);
    },

    applyScale() {
      this.container?.style.setProperty('--sync-popover-scale', this.currentScale.toFixed(2));
    },

    saveScale() {
      if (saveTimer !== null) scope.cancelTimeout(saveTimer);
      saveTimer = scope.timeout(() => {
        saveTimer = null;
        storageRepository.set({ sync_popover_scale: this.currentScale }).catch(() => {});
      }, 500);
    },

    formatTime(timestamp) {
      if (!timestamp) return '--';
      const diff = Math.floor((Date.now() - timestamp) / 1000);
      if (diff < 30) return '刚刚';
      if (diff < 60) return '1m';
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    },

    updateUI(stats) {
      if (!stats) return;
      this.cachedStats = stats;
      const isEmpty = Object.keys(stats).length === 0;
      this.container?.classList.toggle('is-empty', isEmpty);
      if (isEmpty) return;

      for (const [id, data] of Object.entries(stats)) {
        const badge = this.badges[id];
        if (!badge) continue;
        const status = badge.querySelector('.popover-badge-status');
        if (status) {
          const unit = id === 'wildcards' ? ' 个' : (id === 'favorites' ? ' 条' : ' 词');
          const count = typeof data === 'object' ? data.count : (data || 0);
          const lastSync = typeof data === 'object' ? data.lastModified : null;
          status.textContent = `${count}${unit} | ${this.formatTime(lastSync)}`;
        }
        badge.classList.remove('pending');
      }
      this.libraryBtn?.classList.remove('sync-pending');
    },

    updateReadyState(isReady) {
      Object.values(this.badges).forEach(badge => badge?.classList.toggle('ready', isReady));
    },

    setPending(id) {
      this.badges[id]?.classList.add('pending');
      this.libraryBtn?.classList.add('sync-pending');
    },

    triggerPing(id) {
      const badge = this.badges[id];
      if (!badge) return;
      badge.classList.remove('pending', 'pinging');
      void badge.offsetWidth;
      badge.classList.add('pinging');
    },

    dispose() {
      scope.dispose('controller-disposed');
    }
  };

  return controller;
}
