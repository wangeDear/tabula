class ManagerApp {
  constructor() {
    this.tabMetadata = {};
    this.favorites = [];
    this.currentTabId = null;
    this.currentView = 'current'; // 'current' for current session, 'favorites' for favorites list
    this.allTabs = [];
    this.paletteSelectedIndex = -1;
    this.isLightMode = false;
    this.searchQuery = ''; // For filtering lists
    this.refreshTimeout = null; // For debouncing refresh calls
    this.couchDB = couchDBManager; // CouchDB管理器实例
    this.i18n = window.i18n; // 国际化管理器实例

    this.init();
  }

  async init() {
    // 记录加载开始时间
    const loadingStartTime = performance.now();

    // 添加初始化状态class
    document.body.classList.add('initializing');

    // 初始化国际化系统
    await this.i18n.init();

    // 显示初始化loading
    this.showLoading(this.i18n.t('loading.starting'));

    try {
      console.log('[MANAGER] Starting initialization...');
      await this.loadData();
      console.log('[MANAGER] Data loaded successfully');

      this.setupEventListeners();
      console.log('[MANAGER] Event listeners setup');

      this.setupMessageListener();
      console.log('[MANAGER] Message listener setup');

      this.setupI18nEventListeners();
      console.log('[MANAGER] I18n event listeners setup');

      this.applyTheme(this.isLightMode);
      console.log('[MANAGER] Theme applied');

      this.render();
      console.log('[MANAGER] Initial render completed');

      // 初始化同步状态指示器
      this.updateSyncStatusInfo();
      console.log('[MANAGER] Sync status updated');

      // 翻译页面
      this.i18n.translatePage();
      console.log('[MANAGER] Page translated');

      console.log('[MANAGER] Initialization completed successfully');
    } catch (error) {
      console.error('[MANAGER] Initialization failed:', error);

      // 显示错误状态给用户
      const windowList = document.getElementById('window-list');
      if (windowList) {
        windowList.innerHTML = `
          <div class="empty-state">
            <p>${this.i18n.t('empty.init_failed')}</p>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
              ${error.message}
            </p>
            <button onclick="location.reload()" style="margin-top: 12px; padding: 8px 16px; background: var(--brand-color); color: white; border: none; border-radius: 4px; cursor: pointer;">
              ${this.i18n.t('empty.reload')}
            </button>
          </div>
        `;
      }

      this.showSyncNotification('error', this.i18n.t('error.init_failed') + ': ' + error.message);
    } finally {
      // 确保loading至少显示500ms，让用户感知到加载过程
      const minLoadingTime = 500;
      const loadingDuration = performance.now() - loadingStartTime;
      const remainingTime = Math.max(0, minLoadingTime - loadingDuration);

      setTimeout(() => {
        // 移除初始化状态
        document.body.classList.remove('initializing');

        // 确保loading被隐藏
        this.hideLoading();

        console.log('[MANAGER] Initialization process completed');
      }, remainingTime);
    }
  }

  async loadData() {
    // 更新loading文案
    this.updateLoadingText(this.i18n.t('loading.local_data'));

    // 检查权限
    await this.checkPermissions();

    // Load from local storage (for tabMetadata and theme - local only)
    const localResult = await chrome.storage.local.get(['tabMetadata', 'isLightMode']);
    this.tabMetadata = localResult.tabMetadata || {};
    this.isLightMode = localResult.isLightMode || false;

    // 更新loading文案
    this.updateLoadingText(this.i18n.t('loading.syncing_data'));

    // 从CouchDB加载用户设置和收藏夹数据
    try {
      console.log('[MANAGER] Loading data from CouchDB...');
      this.setFooterButtonLoading('sync-status-btn', true);



      // 获取用户设置
      const userSettings = await this.couchDB.getUserSettings();
      this.currentView = userSettings?.lastActiveSection || 'current';

      // 获取收藏夹数据（直接从CouchDB，不再需要本地同步）
      this.favorites = await this.couchDB.getFavorites();
      console.log('[MANAGER] Loaded favorites from CouchDB:', this.favorites.length, 'items');
      console.log('[MANAGER] Favorites data:', this.favorites);

      // 更新同步时间
      this.couchDB.lastSyncTime = new Date().toISOString();
      console.log('[MANAGER] Initial load completed, lastSyncTime:', this.couchDB.lastSyncTime);

      console.log('[MANAGER] Data loaded from CouchDB successfully');
      this.showSyncNotification('success', this.i18n.t('notification.sync_success'));

      // 自动同步收藏数据到chrome.storage.sync，供Alt+M搜索使用
      try {
        await chrome.storage.sync.set({ favorites: this.favorites });
        console.log('[MANAGER] Auto-synced', this.favorites.length, 'favorites to chrome.storage.sync for search');
      } catch (error) {
        console.log('[MANAGER] Failed to auto-sync favorites to storage:', error);
      }

    } catch (error) {
      console.error('[MANAGER] Failed to load data from CouchDB:', error);

      // 回退到默认设置
      this.currentView = 'current';
      this.favorites = [];

      // 显示同步失败通知
      this.showSyncNotification('error', this.i18n.t('notification.sync_failed'));
    } finally {
      this.setFooterButtonLoading('sync-status-btn', false);
    }

    // 更新loading文案
    this.updateLoadingText(this.i18n.t('loading.getting_tabs'));

    // Get all open windows and tabs (real-time data)
    await this.loadTabsWithRetry();
  }

  // --- Event Listeners (Centralized) ---
  setupEventListeners() {
    // Setup Chrome tab event listeners for real-time updates
    this.setupTabEventListeners();

    document.body.addEventListener('click', (e) => {
      const target = e.target;
      const closest = (selector) => target.closest(selector);

      // Navigation
      const navItem = closest('.nav-item');
      if (navItem) {
        e.preventDefault(); // Prevent default link behavior
        this.switchView(navItem.dataset.view);
        return;
      }

      // Tab Actions (from window list or favorites list)
      const tabListItem = closest('.tab-list-item');
      if (tabListItem) {
        // Toggle Favorite button
        const toggleFavBtn = closest('.toggle-favorite-btn');
        if (toggleFavBtn) {
          e.stopPropagation(); // Prevent opening tab
          this.toggleFavorite(tabListItem.dataset.title, tabListItem.dataset.url, tabListItem.dataset.favicon);
          return;
        }

        // Edit Favorite button
        const editFavBtn = closest('.edit-favorite-btn');
        if (editFavBtn) {
          e.stopPropagation(); // Prevent opening tab
          this.showEditFavoriteTitleModal(tabListItem.dataset.url);
          return;
        }

        // Remove Favorite button
        const removeFavBtn = closest('.remove-favorite-btn');
        if (removeFavBtn) {
          e.stopPropagation(); // Prevent opening tab
          this.toggleFavorite(null, tabListItem.dataset.url, null); // Toggle off
          return;
        }

        // Close Tab button (from window list)
        const closeTabBtn = closest('.close-tab-btn');
        if (closeTabBtn) {
          e.stopPropagation(); // Prevent opening tab
          this.closeTab(parseInt(tabListItem.dataset.tabId));
          return;
        }

        // Open Tab (default click on item)
        if (tabListItem.dataset.tabId) {
          this.navigateToTab(parseInt(tabListItem.dataset.tabId));
        } else if (tabListItem.dataset.url) {
          this.openFavorite(tabListItem.dataset.url);
        }
        return;
      }

      // Modal Buttons (for generic modal)
      const modalConfirmBtn = closest('#modal-confirm-btn');
      if (modalConfirmBtn) {
        // Logic handled by specific modal functions (e.g., showEditFavoriteTitleModal)
        return;
      }
      const modalCancelBtn = closest('#modal-cancel-btn');
      if (modalCancelBtn) {
        this.hideModal();
        return;
      }
      const modalCloseBtn = closest('#modal-close-btn');
      if (modalCloseBtn) {
        this.hideModal();
        return;
      }

      // Other specific buttons
      const themeToggleBtn = closest('#theme-toggle-btn');
      if (themeToggleBtn) {
        console.log('[MANAGER] Theme toggle button clicked');
        this.toggleTheme();
        return;
      }

      const syncStatusBtn = closest('#sync-status-btn');
      if (syncStatusBtn) {
        console.log('[MANAGER] Sync status button clicked');
        this.showSyncStatusModal();
        return;
      }

      const syncModalCloseBtn = closest('#sync-modal-close-btn');
      if (syncModalCloseBtn) {
        this.hideSyncStatusModal();
        return;
      }

      const forceSyncBtn = closest('#force-sync-btn');
      if (forceSyncBtn) {
        this.forceSyncFavorites();
        return;
      }

      const testConnectionBtn = closest('#test-connection-btn');
      if (testConnectionBtn) {
        this.testCouchDBConnection();
        return;
      }



      // 用户ID编辑相关按钮
      const editUserIdBtn = closest('#edit-user-id-btn');
      if (editUserIdBtn) {
        this.startEditUserId();
        return;
      }

      const saveUserIdBtn = closest('#save-user-id-btn');
      if (saveUserIdBtn) {
        this.saveUserId();
        return;
      }

      const cancelEditUserIdBtn = closest('#cancel-edit-user-id-btn');
      if (cancelEditUserIdBtn) {
        this.cancelEditUserId();
        return;
      }

      const generateUserIdBtn = closest('#generate-user-id-btn');
      if (generateUserIdBtn) {
        this.generateNewUserId();
        return;
      }

      // 语言切换按钮
      const languageToggleBtn = closest('#language-toggle-btn');
      if (languageToggleBtn) {
        this.toggleLanguageSelector();
        return;
      }

      // Close context menus if clicked outside
      const contextMenu = document.getElementById('context-menu');
      const favoriteContextMenu = document.getElementById('favorite-context-menu');
      if (contextMenu && contextMenu.style.display === 'block' && !contextMenu.contains(target)) {
        contextMenu.style.display = 'none';
      }
      if (favoriteContextMenu && favoriteContextMenu.style.display === 'block' && !favoriteContextMenu.contains(target)) {
        favoriteContextMenu.remove();
      }
    });

    // Input/Change events (cannot be delegated in the same way)
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.render(); // Re-render based on current view and search query
    });

    // Context menu for tabs (original manager.js logic)
    document.getElementById('window-list').addEventListener('contextmenu', (e) => {
      const tabListItem = e.target.closest('.tab-list-item');
      if (tabListItem) {
        e.preventDefault();
        this.showContextMenu(e, parseInt(tabListItem.dataset.tabId), this.allTabs.find(t => t.id === parseInt(tabListItem.dataset.tabId)));
      }
    });

    // Context menu for favorites (new logic)
    document.getElementById('favorites-list').addEventListener('contextmenu', (e) => {
      const favoriteItem = e.target.closest('.tab-list-item'); // Re-using tab-list-item class for favorites
      if (favoriteItem) {
        e.preventDefault();
        const favorite = this.favorites.find(f => f.url === favoriteItem.dataset.url);
        if (favorite) {
          this.showFavoriteContextMenu(e, favorite);
        }
      }
    });

    // Search palette hotkey
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.openSearchPalette();
      }
      if (e.key === 'Escape') {
        this.closeSearchPalette();
        this.hideModal();
      }
    });

    // Palette search input events
    document.getElementById('palette-search-input')?.addEventListener('input', (e) => this.renderPaletteResults(e.target.value.toLowerCase()));
    document.getElementById('palette-search-input')?.addEventListener('keydown', (e) => this.handlePaletteKeydown(e));
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
      if (request.action === 'showEditFavoriteModal') {
        this.switchView('favorites'); // Switch to favorites section
        // Ensure render completes before showing modal
        setTimeout(() => this.showEditFavoriteTitleModal(request.url), 100);
      } else if (request.action === 'showAddFavoriteModal') {
        // 显示添加收藏弹窗
        setTimeout(() => this.showAddFavoriteModal(request.title, request.url, request.favIconUrl), 100);
      } else if (request.action === 'get-couchdb-favorites') {
        // 响应来自background.js的收藏数据请求
        try {
          // 检查CouchDB是否已初始化
          if (!this.couchDB) {
            console.log('[MANAGER] CouchDB not initialized yet, returning empty array');
            sendResponse({ success: true, favorites: [] });
            return true;
          }

          const favorites = await this.couchDB.getFavorites();
          console.log('[MANAGER] Providing CouchDB favorites to background.js:', favorites.length, 'items');
          sendResponse({ success: true, favorites: favorites });
        } catch (error) {
          console.error('[MANAGER] Failed to get CouchDB favorites for background.js:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true; // 保持消息通道开放以支持异步响应
      } else if (request.action === 'sync-favorites-to-storage') {
        // 将CouchDB收藏同步到chrome.storage.sync（用于Alt+M搜索）
        try {
          if (!this.couchDB) {
            console.log('[MANAGER] CouchDB not initialized, cannot sync');
            sendResponse({ success: false, error: 'CouchDB not initialized' });
            return true;
          }

          const favorites = await this.couchDB.getFavorites();
          await chrome.storage.sync.set({ favorites: favorites });
          console.log('[MANAGER] Synced', favorites.length, 'favorites to chrome.storage.sync');
          sendResponse({ success: true, count: favorites.length });
        } catch (error) {
          console.error('[MANAGER] Failed to sync favorites to storage:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }
    });
  }

  setupTabEventListeners() {
    // 监听标签页创建
    chrome.tabs.onCreated.addListener((tab) => {
      console.log('[MANAGER] Tab created:', tab.id, tab.url);
      this.refreshTabData();
    });

    // 监听标签页更新（URL变化、标题变化等）
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      console.log('[MANAGER] Tab updated:', tabId, changeInfo);
      // 只在重要变化时刷新（URL或标题变化）
      if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
        this.refreshTabData();
      }
    });

    // 监听标签页移除
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      console.log('[MANAGER] Tab removed:', tabId);
      this.refreshTabData();
    });

    // 监听标签页移动
    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
      console.log('[MANAGER] Tab moved:', tabId, moveInfo);
      this.refreshTabData();
    });

    // 监听标签页附加到窗口
    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
      console.log('[MANAGER] Tab attached:', tabId, attachInfo);
      this.refreshTabData();
    });

    // 监听标签页从窗口分离
    chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
      console.log('[MANAGER] Tab detached:', tabId, detachInfo);
      this.refreshTabData();
    });

    // 监听标签页激活状态变化
    chrome.tabs.onActivated.addListener((activeInfo) => {
      console.log('[MANAGER] Tab activated:', activeInfo.tabId);
      // 激活状态变化不需要刷新整个列表，只需要更新视觉状态
      this.updateActiveTabIndicator(activeInfo.tabId);
    });

    // 监听窗口创建
    chrome.windows.onCreated.addListener((window) => {
      console.log('[MANAGER] Window created:', window.id);
      this.refreshTabData();
    });

    // 监听窗口移除
    chrome.windows.onRemoved.addListener((windowId) => {
      console.log('[MANAGER] Window removed:', windowId);
      this.refreshTabData();
    });
  }

  // --- Tab Data Management ---
  refreshTabData() {
    // 防抖：延迟执行，避免过于频繁的刷新
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(async () => {
      try {
        console.log('[MANAGER] Refreshing tab data...');

        // 使用重试逻辑重新获取数据
        await this.loadTabsWithRetry(2, 500); // 减少重试次数和延迟，因为这是刷新操作

        console.log('[MANAGER] Tab data refreshed. Total tabs:', this.allTabs.length);

        // 如果当前在查看当前会话，则重新渲染
        if (this.currentView === 'current') {
          this.renderWindows();
        }

        // 更新计数
        this.updateCounts();

        // 更新搜索面板结果（如果正在使用）
        const paletteOverlay = document.getElementById('search-palette-overlay');
        if (paletteOverlay && paletteOverlay.style.display === 'flex') {
          const paletteInput = document.getElementById('palette-search-input');
          if (paletteInput) {
            this.renderPaletteResults(paletteInput.value.toLowerCase());
          }
        }
      } catch (error) {
        console.error('[MANAGER] Error refreshing tab data:', error);

        // 刷新失败时，显示错误状态
        if (this.currentView === 'current') {
          const windowList = document.getElementById('window-list');
          if (windowList && this.allTabs.length === 0) {
            windowList.innerHTML = `
              <div class="empty-state">
                <p>无法获取标签页数据</p>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
                  ${error.message}
                </p>
                <button onclick="location.reload()" style="margin-top: 12px; padding: 8px 16px; background: var(--brand-color); color: white; border: none; border-radius: 4px; cursor: pointer;">
                  重新加载
                </button>
              </div>
            `;
          }
        }
      }
    }, 100); // 100ms 延迟
  }

  updateActiveTabIndicator(activeTabId) {
    // 更新激活标签页的视觉指示器
    const allTabItems = document.querySelectorAll('.tab-list-item');
    allTabItems.forEach(item => {
      const tabId = parseInt(item.dataset.tabId);
      if (tabId === activeTabId) {
        item.classList.add('active-tab');
      } else {
        item.classList.remove('active-tab');
      }
    });
  }

  setInitialActiveTab() {
    // 设置初始激活标签页的视觉指示器
    const activeTab = this.allTabs.find(tab => tab.active);
    if (activeTab) {
      this.updateActiveTabIndicator(activeTab.id);
    }
  }

  // --- View Management ---
  switchView(view) {
    this.currentView = view;
    this.searchQuery = ''; // Reset search when switching views

    // Clear search input field
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = '';
    }

    // 保存用户设置到CouchDB
    this.saveUserSettingsToCouchDB({ lastActiveSection: view });

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    document.getElementById('current-session').style.display = view === 'current' ? 'block' : 'none';
    document.getElementById('favorites-list').style.display = view === 'favorites' ? 'block' : 'none';

    this.render();
  }

  // --- Rendering ---
  render() {
    if (this.currentView === 'current') {
      this.renderWindows();
    } else if (this.currentView === 'favorites') {
      this.renderFavorites();
    }
    // Update counts for both views
    this.updateCounts();
  }

  renderWindows() {
    console.log('[MANAGER] renderWindows called, allTabs.length:', this.allTabs.length);

    const windowList = document.getElementById('window-list');
    if (!windowList) {
      console.error('[MANAGER] Window list element not found!');
      return;
    }

    // Clear previous content
    windowList.innerHTML = '';

    // 如果没有标签页数据，显示适当的消息
    if (!this.allTabs || this.allTabs.length === 0) {
      console.warn('[MANAGER] No tabs available for rendering');
      windowList.innerHTML = '<div class="empty-state">正在加载标签页数据...</div>';

      // 尝试重新获取数据
      setTimeout(() => {
        console.log('[MANAGER] Attempting to refresh tab data due to empty state');
        this.refreshTabData();
      }, 1000);
      return;
    }

    const windows = this.allTabs.reduce((acc, tab) => {
      if (!tab || !tab.windowId) {
        console.warn('[MANAGER] Invalid tab object:', tab);
        return acc;
      }

      if (!acc[tab.windowId]) {
        acc[tab.windowId] = { id: tab.windowId, tabs: [] };
      }
      acc[tab.windowId].tabs.push(tab);
      return acc;
    }, {});

    console.log('[MANAGER] Grouped tabs into', Object.keys(windows).length, 'windows');

    if (Object.keys(windows).length === 0) {
      windowList.innerHTML = '<div class="empty-state">没有找到可显示的窗口</div>';
      return;
    }

    try {
      Object.values(windows).forEach((win, index) => {
        const group = document.createElement('div');
        group.className = 'window-group';
        group.innerHTML = `<h2 class="window-header">${this.i18n.t('window.header', { index: index + 1, count: win.tabs.length })}</h2>`;

        win.tabs.forEach(tab => {
          try {
            const item = this.createTabListItem(tab);
            group.appendChild(item);
          } catch (error) {
            console.error('[MANAGER] Error creating tab list item for tab:', tab, error);
          }
        });
        windowList.appendChild(group);
      });

      console.log('[MANAGER] Successfully rendered', Object.keys(windows).length, 'windows');

      // Apply search filter after rendering
      this.filterListItems(windowList, this.searchQuery, 'current');

      // 设置激活标签页的视觉指示器
      this.setInitialActiveTab();
    } catch (error) {
      console.error('[MANAGER] Error during window rendering:', error);
      windowList.innerHTML = '<div class="empty-state">渲染窗口时出错，请刷新页面重试</div>';
    }
  }

  renderFavorites() {
    const favoritesListContainer = document.getElementById('favorite-list');
    if (!favoritesListContainer) return;

    favoritesListContainer.innerHTML = ''; // Clear previous content

    if (this.favorites.length === 0) {
      favoritesListContainer.innerHTML = '<div class="empty-state">没有收藏的标签页</div>';
      return;
    }

    this.favorites.forEach(favorite => {
      const item = this.createFavoriteListItem(favorite);
      favoritesListContainer.appendChild(item);
    });

    // Apply search filter after rendering
    this.filterListItems(favoritesListContainer, this.searchQuery, 'favorites');
  }

  createTabListItem(tab) {
    const meta = this.getTabMeta(tab.id);
    const favoriteItem = this.favorites.find(f => f.url === tab.url);
    const isTabFavorite = !!favoriteItem;
    const displayTitle = this.getTabDisplayTitle(tab);
    const sanitizedFavIconUrl = this.sanitizeFavIconUrl(tab.favIconUrl);
    const item = document.createElement('div');
    item.className = 'tab-list-item';
    item.dataset.tabId = tab.id;
    item.dataset.url = tab.url;
    item.dataset.title = this.escapeHtml(tab.title);
    item.dataset.favicon = sanitizedFavIconUrl;
    item.innerHTML = `
      ${isTabFavorite ? '<i class="material-icons-outlined favorite-icon toggle-favorite-btn">star</i>' : '<i class="material-icons-outlined favorite-icon toggle-favorite-btn">star_border</i></i>'}
      <img src="${sanitizedFavIconUrl}" class="tab-favicon">
      <div class="tab-details">
        <div class="tab-title">${this.escapeHtml(displayTitle)}</div>
        <div class="tab-url">${tab.url}</div>
        <div class="tags-container"></div>
      </div>
      <div class="tab-actions">
        <button class="btn-icon close-tab-btn" title="关闭标签页">×</button>
      </div>
    `;
    this.updateTagsDisplay(item, meta.tags);
    return item;
  }

  createFavoriteListItem(favorite) {
    const sanitizedFavIconUrl = this.sanitizeFavIconUrl(favorite.favIconUrl);
    const item = document.createElement('div');
    item.className = 'tab-list-item';
    item.dataset.url = favorite.url;
    item.dataset.title = this.escapeHtml(favorite.title);
    item.dataset.favicon = sanitizedFavIconUrl;
    item.innerHTML = `
      <i class="material-icons-outlined favorite-icon toggle-favorite-btn">star</i>
      <img src="${sanitizedFavIconUrl}" class="tab-favicon">
      <div class="tab-details">
        <div class="tab-title">${this.escapeHtml(favorite.title)}</div>
        <div class="tab-url">${this.escapeHtml(favorite.url)}</div>
        <div class="favorite-date">收藏于 ${favorite.addedAt ? this.formatDate(favorite.addedAt) : '未知时间'}</div>
      </div>
      <div class="tab-actions">
        <button class="btn-icon edit-favorite-btn" title="编辑标题">✏️</button>
        <button class="btn-icon remove-favorite-btn" title="取消收藏">🗑️</button>
      </div>
    `;
    return item;
  }

  updateTagsDisplay(item, tags) {
    const container = item.querySelector('.tags-container');
    if (container) {
      container.innerHTML = '';
      if (tags) tags.forEach(tag => container.innerHTML += `<span class="tag">${tag}</span>`);
    }
  }

  filterListItems(container, term, viewType) {
    container.querySelectorAll('.tab-list-item').forEach(item => {
      const title = item.querySelector('.tab-title')?.textContent.toLowerCase() || '';
      const url = item.querySelector('.tab-url')?.textContent.toLowerCase() || '';
      let matches = false;

      if (viewType === 'current') {
        const tabId = parseInt(item.dataset.tabId);
        const meta = this.getTabMeta(tabId);
        const tags = (meta.tags || []).map(tag => tag.toLowerCase());
        matches = title.includes(term) || url.includes(term) || tags.some(tag => tag.includes(term));
      } else if (viewType === 'favorites') {
        matches = title.includes(term) || url.includes(term);
      }
      item.style.display = matches ? 'flex' : 'none';
    });
  }

  updateCounts() {
    // Update counts for elements that exist in manager.html
    const currentSessionCountEl = document.getElementById('current-session-count');
    const favoritesCountEl = document.getElementById('favorites-count');

    if (currentSessionCountEl) {
      currentSessionCountEl.textContent = this.allTabs.length;
    }
    if (favoritesCountEl) {
      favoritesCountEl.textContent = this.favorites.length;
    }
  }

  // --- Helper Methods ---
  // 检查并处理 favIconUrl，将 base64 编码的图标替换为默认图标
  sanitizeFavIconUrl(favIconUrl) {
    // 如果是 base64 编码的图标，使用默认图标
    if (favIconUrl && favIconUrl.startsWith('data:')) {
      console.log('[MANAGER] Replacing base64 favicon with default icon');
      return 'icons/icon16.png';
    }
    return favIconUrl || 'icons/icon16.png';
  }

  /**
   * 重新加载收藏夹数据
   */
  async reloadFavorites() {
    try {
      console.log('[MANAGER] Reloading favorites from CouchDB...');
      this.favorites = await this.couchDB.getFavorites();
      console.log('[MANAGER] Reloaded', this.favorites.length, 'favorites');

      // 更新同步时间
      this.couchDB.lastSyncTime = new Date().toISOString();
      console.log('[MANAGER] Updated lastSyncTime:', this.couchDB.lastSyncTime);

      // 自动同步收藏数据到chrome.storage.sync,供Alt+M搜索使用
      try {
        await chrome.storage.sync.set({ favorites: this.favorites });
        console.log('[MANAGER] Auto-synced favorites to chrome.storage.sync');
      } catch (error) {
        console.log('[MANAGER] Failed to auto-sync favorites to storage:', error);
      }

      // 如果当前在收藏夹视图,重新渲染
      if (this.currentView === 'favorites') {
        this.renderFavorites();
      }

      // 更新计数
      this.updateCounts();

      // 如果在当前会话视图,也需要重新渲染以更新收藏图标
      if (this.currentView === 'current') {
        this.renderWindows();
      }
    } catch (error) {
      console.error('[MANAGER] Failed to reload favorites:', error);
      throw error;
    }
  }

  // --- Favorites Management ---
  async toggleFavorite(title, url, favIconUrl) {
    const existingFavorite = this.favorites.find(f => f.url === url);

    if (existingFavorite) {
      this.showLoading('正在删除收藏...');

      try {
        // 从CouchDB删除收藏
        const remoteFavorite = await this.couchDB.findFavoriteByUrl(url);
        if (remoteFavorite) {
          await this.couchDB.deleteFavorite(remoteFavorite.id);
        }

        // 重新加载收藏夹数据
        await this.reloadFavorites();

        chrome.runtime.sendMessage({ action: 'removeFavorite', url });
        this.showSyncNotification('success', this.i18n.t('notification.favorite_removed'));
      } catch (error) {
        console.error('[MANAGER] Error removing favorite:', error);
        this.showSyncNotification('error', '删除收藏失败');
      } finally {
        this.hideLoading();
      }
    } else {
      // 显示收藏弹窗让用户确认和修改标题
      this.showAddFavoriteModal(title, url, favIconUrl);
    }
  }

  /**
   * 显示添加收藏弹窗
   */
  showAddFavoriteModal(title, url, favIconUrl) {
    if (!title || !url) return;

    const modal = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    if (!modal || !modalTitle || !modalBody || !confirmBtn) {
      console.error('Modal elements not found!');
      return;
    }

    modalTitle.textContent = '添加到收藏夹';
    modalBody.innerHTML = `
      <div class="form-group">
        <label for="add-favorite-title" class="form-label">收藏标题</label>
        <input type="text" id="add-favorite-title" class="form-input" value="${this.escapeHtml(title)}">
      </div>
      <div class="form-group">
        <label for="add-favorite-url" class="form-label">网址</label>
        <input type="text" id="add-favorite-url" class="form-input" value="${this.escapeHtml(url)}" readonly>
      </div>
    `;

    // 定义确认添加的函数
    const confirmAdd = async () => {
      const newTitle = document.getElementById('add-favorite-title').value.trim();
      if (newTitle) {
        await this.addFavoriteWithTitle(newTitle, url, favIconUrl);
      }
      this.hideModal();
    };

    // 点击确认按钮
    confirmBtn.onclick = confirmAdd;

    // 为输入框添加键盘事件监听器
    const titleInput = document.getElementById('add-favorite-title');
    if (titleInput) {
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmAdd();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.hideModal();
        }
      });
    }

    modal.classList.add('active');
    titleInput?.focus();
    // 选中所有文本，方便用户直接输入新标题
    titleInput?.select();
  }

  /**
   * 添加收藏夹（内部方法）
   */
  async addFavoriteWithTitle(title, url, favIconUrl) {
    this.showLoading('正在添加收藏...');

    try {
      // 处理 favIconUrl，将 base64 编码替换为默认图标
      const sanitizedFavIconUrl = this.sanitizeFavIconUrl(favIconUrl);

      const favorite = {
        title,
        url,
        favIconUrl: sanitizedFavIconUrl,
        addedAt: new Date().toISOString()
      };

      // 添加到CouchDB
      await this.couchDB.addFavorite(favorite);

      // 重新加载收藏夹数据
      await this.reloadFavorites();

      chrome.runtime.sendMessage({ action: 'addFavorite', favorite });

      // 显示成功通知
      this.showSyncNotification('success', this.i18n.t('notification.favorite_added', { title }));
    } catch (error) {
      console.error('[MANAGER] Error adding favorite:', error);
      this.showSyncNotification('error', '添加收藏失败');
    } finally {
      this.hideLoading();
    }
  }

  async openFavorite(url) {
    // 首先检查是否有匹配的已打开标签页
    const existingTab = this.allTabs.find(tab => tab.url === url);

    if (existingTab) {
      // 如果找到匹配的标签页，直接跳转到该标签页
      console.log('[MANAGER] Found existing tab for URL:', url, 'Tab ID:', existingTab.id);
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(existingTab.windowId, { focused: true });

      // 显示通知
      this.showSyncNotification('success', '已跳转到已打开的标签页');
    } else {
      // 如果没有找到匹配的标签页，创建新标签页
      console.log('[MANAGER] No existing tab found for URL:', url, 'Creating new tab');
      await chrome.tabs.create({ url: url });

      // 显示通知
      this.showSyncNotification('info', '已在新标签页中打开');
    }
  }

  showEditFavoriteTitleModal(url) {
    const favorite = this.favorites.find(f => f.url === url);
    if (!favorite) return;

    const modal = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    if (!modal || !modalTitle || !modalBody || !confirmBtn) {
      console.error('Modal elements not found!');
      return;
    }

    modalTitle.textContent = '编辑收藏标题';
    modalBody.innerHTML = `
      <div class="form-group">
        <label for="edit-favorite-title" class="form-label">新标题</label>
        <input type="text" id="edit-favorite-title" class="form-input" value="${this.escapeHtml(favorite.title)}">
      </div>
    `;

    // 定义确认保存的函数
    const confirmSave = () => {
      const newTitle = document.getElementById('edit-favorite-title').value.trim();
      if (newTitle && newTitle !== favorite.title) {
        this.updateFavoriteTitle(url, newTitle);
      }
      this.hideModal();
    };

    // 点击确认按钮
    confirmBtn.onclick = confirmSave;

    // 为输入框添加键盘事件监听器
    const titleInput = document.getElementById('edit-favorite-title');
    if (titleInput) {
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.hideModal();
        }
      });
    }

    modal.classList.add('active');
    titleInput?.focus();
    // 选中所有文本，方便用户直接输入新标题
    titleInput?.select();
  }

  async updateFavoriteTitle(url, newTitle) {
    const favorite = this.favorites.find(f => f.url === url);
    if (!favorite) return;

    this.showLoading('正在更新标题...');

    try {
      // 查找远程收藏夹并更新
      const remoteFavorite = await this.couchDB.findFavoriteByUrl(url);
      if (remoteFavorite) {
        await this.couchDB.updateFavorite(remoteFavorite.id, { title: newTitle });
      }

      // 重新加载收藏夹数据
      await this.reloadFavorites();

      // Update the title in allTabs if it's an open tab
      const openTab = this.allTabs.find(t => t.url === url);
      if (openTab) {
        const meta = this.getTabMeta(openTab.id);
        if (meta) {
          meta.name = newTitle;
          this.tabMetadata[openTab.id] = meta;
          chrome.storage.local.set({ tabMetadata: this.tabMetadata });
        }
      }

      chrome.runtime.sendMessage({ action: 'updateFavoriteTitle', url, title: newTitle });
      this.showSyncNotification('success', this.i18n.t('notification.title_updated'));
    } catch (error) {
      console.error('[MANAGER] Error updating favorite title:', error);
      this.showSyncNotification('error', '更新标题失败');
    } finally {
      this.hideLoading();
    }
  }

  // --- Tab/Window Actions ---
  navigateToTab(tabId) {
    const tab = this.allTabs.find(t => t.id === tabId);
    if (tab) {
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
      console.log('[MANAGER] Navigated to tab:', tabId);
      // Note: Active state will be automatically updated via onActivated event listener
    }
  }

  closeTab(tabId) {
    chrome.tabs.remove(tabId).then(() => {
      console.log('[MANAGER] Tab closed successfully:', tabId);
      // Note: Tab data will be automatically refreshed via onRemoved event listener
    }).catch(e => console.error('Error closing tab:', e));
  }

  // --- Context Menu (Original manager.js logic, adapted) ---
  showContextMenu(e, tabId, tab) {
    this.currentTabId = tabId;
    const contextMenu = document.getElementById('context-menu');
    const favoriteAction = contextMenu.querySelector('[data-action="favorite"]');
    if (favoriteAction) favoriteAction.textContent = this.favorites.some(f => f.url === tab.url) ? '取消收藏' : '收藏';
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.display = 'block';

    // Handle context menu clicks
    contextMenu.onclick = (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      const meta = this.getTabMeta(this.currentTabId);

      switch (action) {
        case 'rename':
          const newName = prompt('输入新的名称:', meta.name || '');
          if (newName !== null) {
            meta.name = newName;
            this.tabMetadata[this.currentTabId] = meta;
            chrome.storage.local.set({ tabMetadata: this.tabMetadata });
            this.render();
          }
          break;
        case 'favorite':
          // 检查是否已收藏
          const isAlreadyFavorited = this.favorites.some(f => f.url === tab.url);
          if (isAlreadyFavorited) {
            // 如果已收藏，直接取消收藏
            this.toggleFavorite(tab.title, tab.url, tab.favIconUrl);
          } else {
            // 如果未收藏，显示收藏弹窗
            this.showAddFavoriteModal(tab.title, tab.url, tab.favIconUrl);
          }
          break;
        case 'edit-tags':
          this.openTagModal(this.currentTabId);
          break;
        case 'close':
          this.closeTab(parseInt(this.currentTabId));
          break;
      }
      contextMenu.style.display = 'none';
    };
  }

  showFavoriteContextMenu(e, favorite) {
    const existingMenu = document.getElementById('favorite-context-menu');
    if (existingMenu) existingMenu.remove();

    const favoriteContextMenu = document.createElement('div');
    favoriteContextMenu.id = 'favorite-context-menu';
    favoriteContextMenu.className = 'context-menu';
    favoriteContextMenu.innerHTML = `
      <div class="context-menu-item" data-action="open-favorite">打开</div>
      <div class="context-menu-item" data-action="open-new-tab">新标签页打开</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="edit-title">编辑标题</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="remove-favorite">取消收藏</div>
    `;

    favoriteContextMenu.style.top = `${e.clientY}px`;
    favoriteContextMenu.style.left = `${e.clientX}px`;
    favoriteContextMenu.style.display = 'block';
    document.body.appendChild(favoriteContextMenu);

    favoriteContextMenu.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      if (!action) return;

      switch (action) {
        case 'open-favorite':
          this.openFavorite(favorite.url);
          break;
        case 'open-new-tab':
          // 强制在新标签页打开，不检查已存在的标签页
          chrome.tabs.create({ url: favorite.url });
          this.showSyncNotification('info', '已在新标签页中打开');
          break;
        case 'edit-title':
          this.showEditFavoriteTitleModal(favorite.url);
          break;
        case 'remove-favorite':
          this.toggleFavorite(null, favorite.url, null); // Toggle off
          break;
      }
      favoriteContextMenu.remove();
    });
  }

  // --- Tag Modal (Original manager.js logic) ---
  openTagModal(tabId) {
    this.currentTabId = tabId;
    const meta = this.getTabMeta(tabId);
    const tagInputContainer = document.getElementById('tag-input-container');
    const tagModal = document.getElementById('tag-modal');
    const saveTagsBtn = document.getElementById('save-tags-btn');
    const cancelTagsBtn = document.getElementById('cancel-tags-btn');

    if (!tagInputContainer || !tagModal || !saveTagsBtn || !cancelTagsBtn) return;

    tagInputContainer.innerHTML = `<input type="text" id="tags-input" value="${(meta.tags || []).join(', ')}" placeholder="用逗号分隔标签">`;
    tagModal.style.display = 'flex';

    saveTagsBtn.onclick = () => {
      const input = document.getElementById('tags-input');
      const tags = input.value.split(',').map(t => t.trim()).filter(Boolean);
      const currentMeta = this.getTabMeta(this.currentTabId);
      currentMeta.tags = tags;
      this.tabMetadata[this.currentTabId] = currentMeta;
      chrome.storage.local.set({ tabMetadata: this.tabMetadata });
      this.render();
      this.closeTagModal();
    };

    cancelTagsBtn.onclick = () => this.closeTagModal();
  }

  closeTagModal() {
    document.getElementById('tag-modal').style.display = 'none';
  }

  // --- Generic Modal (for edit favorite title) ---
  hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }



  // --- Search Palette (Original manager.js logic) ---
  openSearchPalette() {
    const paletteOverlay = document.getElementById('search-palette-overlay');
    const paletteInput = document.getElementById('palette-search-input');

    if (!paletteOverlay || !paletteInput) return;

    paletteOverlay.style.display = 'flex';
    paletteInput.value = '';

    // 根据当前视图设置占位符文本
    if (this.currentView === 'favorites') {
      paletteInput.placeholder = this.i18n.t('search.palette_favorites_placeholder');
    } else {
      paletteInput.placeholder = this.i18n.t('search.palette_placeholder');
    }

    paletteInput.focus();
    this.renderPaletteResults();
  }

  closeSearchPalette() {
    document.getElementById('search-palette-overlay').style.display = 'none';
  }

  renderPaletteResults(filter = '') {
    const paletteResults = document.getElementById('palette-results-list');
    if (!paletteResults) return;

    paletteResults.innerHTML = '';

    if (this.currentView === 'favorites') {
      // 在收藏列表中，搜索收藏夹数据
      const filteredFavorites = this.favorites.filter(fav => {
        return (
          (fav.title || '').toLowerCase().includes(filter) ||
          (fav.url || '').toLowerCase().includes(filter)
        );
      });

      filteredFavorites.forEach(favorite => {
        const sanitizedFavIconUrl = this.sanitizeFavIconUrl(favorite.favIconUrl);
        const li = document.createElement('li');
        li.className = 'palette-result-item';
        li.dataset.url = favorite.url;
        li.innerHTML = `<img src="${sanitizedFavIconUrl}" class="tab-favicon"><div class="tab-details"><div class="tab-title">${this.escapeHtml(favorite.title)}</div><div class="tab-url">${this.escapeHtml(favorite.url)}</div></div>`;
        li.addEventListener('click', () => {
          this.openFavorite(favorite.url);
          this.closeSearchPalette();
        });
        paletteResults.appendChild(li);
      });

      this.paletteSelectedIndex = -1;
      if (filteredFavorites.length > 0) {
        this.paletteSelectedIndex = 0;
        paletteResults.children[0].classList.add('selected');
      }
    } else {
      // 在当前会话中，搜索打开的标签页
      const filteredTabs = this.allTabs.filter(t => {
        const displayTitle = this.getTabDisplayTitle(t);
        return (
          (displayTitle || '').toLowerCase().includes(filter) ||
          (t.url || '').toLowerCase().includes(filter)
        );
      });

      filteredTabs.forEach(tab => {
        const displayTitle = this.getTabDisplayTitle(tab);

        const sanitizedFavIconUrl = this.sanitizeFavIconUrl(tab.favIconUrl);
        const li = document.createElement('li');
        li.className = 'palette-result-item';
        li.dataset.tabId = tab.id;
        li.innerHTML = `<img src="${sanitizedFavIconUrl}" class="tab-favicon"><div class="tab-details"><div class="tab-title">${this.escapeHtml(displayTitle)}</div><div class="tab-url">${this.escapeHtml(tab.url)}</div></div>`;
        li.addEventListener('click', () => {
          this.navigateToTab(tab.id);
          this.closeSearchPalette();
        });
        paletteResults.appendChild(li);
      });

      this.paletteSelectedIndex = -1;
      if (filteredTabs.length > 0) {
        this.paletteSelectedIndex = 0;
        paletteResults.children[0].classList.add('selected');
      }
    }
  }

  handlePaletteKeydown(e) {
    const items = document.getElementById('palette-results-list').children;
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.paletteSelectedIndex > -1) items[this.paletteSelectedIndex].classList.remove('selected');
      this.paletteSelectedIndex = (this.paletteSelectedIndex + 1) % items.length;
      items[this.paletteSelectedIndex].classList.add('selected');
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.paletteSelectedIndex > -1) items[this.paletteSelectedIndex].classList.remove('selected');
      this.paletteSelectedIndex = (this.paletteSelectedIndex - 1 + items.length) % items.length;
      items[this.paletteSelectedIndex].classList.add('selected');
    }
    else if (e.key === 'Enter') {
      const selectedItem = items[this.paletteSelectedIndex];
      if (this.currentView === 'favorites') {
        // 在收藏列表中，打开收藏的URL
        const url = selectedItem.dataset.url;
        this.openFavorite(url);
      } else {
        // 在当前会话中，跳转到标签页
        const selectedTabId = parseInt(selectedItem.dataset.tabId);
        this.navigateToTab(selectedTabId);
      }
      this.closeSearchPalette();
    }
  }



  // --- Theme Toggling (Original manager.js logic) ---
  applyTheme(isLight) {
    const themeToggleIcon = document.getElementById('theme-toggle-btn')?.querySelector('i');
    if (isLight) {
      document.body.classList.add('light-mode');
      if (themeToggleIcon) themeToggleIcon.textContent = 'dark_mode';
    } else {
      document.body.classList.remove('light-mode');
      if (themeToggleIcon) themeToggleIcon.textContent = 'light_mode';
    }
    this.isLightMode = isLight;
  }

  async toggleTheme() {
    this.isLightMode = !this.isLightMode;
    this.applyTheme(this.isLightMode);
    await chrome.storage.local.set({ isLightMode: this.isLightMode });
  }

  // --- Tab Data Loading ---
  async loadTabsWithRetry(maxRetries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[MANAGER] Attempting to load tabs (attempt ${attempt}/${maxRetries})...`);

        const windows = await chrome.windows.getAll({ populate: true });
        console.log('[MANAGER] Got windows:', windows.length, 'windows');

        this.allTabs = windows.flatMap(win => win.tabs.map(tab => ({ ...tab, windowId: win.id })));
        console.log('[MANAGER] Processed tabs:', this.allTabs.length, 'total tabs');

        if (this.allTabs.length === 0) {
          console.warn('[MANAGER] Warning: No tabs found in any window');
          if (attempt < maxRetries) {
            console.log(`[MANAGER] Retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
        }

        // 成功获取数据，跳出重试循环
        console.log('[MANAGER] Successfully loaded tab data');
        return;

      } catch (error) {
        console.error(`[MANAGER] Failed to get windows/tabs (attempt ${attempt}/${maxRetries}):`, error);

        if (attempt === maxRetries) {
          // 最后一次尝试失败，设置空数组并抛出错误
          this.allTabs = [];
          throw new Error(`获取标签页数据失败 (${maxRetries}次尝试后): ${error.message}`);
        }

        // 等待后重试
        console.log(`[MANAGER] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // --- I18n Event Listeners ---
  setupI18nEventListeners() {
    // 监听语言变更事件
    document.addEventListener('languageChanged', (event) => {
      console.log('[MANAGER] Language changed to:', event.detail.language);
      this.onLanguageChanged(event.detail.language);
    });

    // 点击其他地方时关闭语言选择器
    document.addEventListener('click', (e) => {
      const languageSelector = document.getElementById('language-selector');
      const languageToggleBtn = document.getElementById('language-toggle-btn');

      if (languageSelector &&
        languageSelector.classList.contains('active') &&
        !languageSelector.contains(e.target) &&
        !languageToggleBtn.contains(e.target)) {
        this.hideLanguageSelector();
      }
    });
  }

  /**
   * 语言变更时的处理
   */
  onLanguageChanged(language) {
    // 重新翻译页面
    this.i18n.translatePage();

    // 重新渲染动态内容
    this.render();

    // 更新同步状态信息
    this.updateSyncStatusInfo();

    // 更新搜索框占位符
    this.updateSearchPlaceholder();
  }

  /**
   * 切换语言选择器显示/隐藏
   */
  toggleLanguageSelector() {
    const languageSelector = document.getElementById('language-selector');

    if (!languageSelector) {
      this.createLanguageSelector();
    } else {
      if (languageSelector.classList.contains('active')) {
        this.hideLanguageSelector();
      } else {
        this.showLanguageSelector();
      }
    }
  }

  /**
   * 创建语言选择器
   */
  createLanguageSelector() {
    const languageSelector = document.createElement('div');
    languageSelector.id = 'language-selector';
    languageSelector.className = 'language-selector';

    const supportedLanguages = this.i18n.getSupportedLanguages();
    const currentLanguage = this.i18n.getCurrentLanguage();

    supportedLanguages.forEach(lang => {
      const option = document.createElement('button');
      option.className = 'language-option';
      option.dataset.language = lang;

      if (lang === currentLanguage) {
        option.classList.add('active');
      }

      const flag = lang === 'zh-CN' ? '🇨🇳' : '🇺🇸';
      const name = this.i18n.t(`language.${lang}`);

      option.innerHTML = `
        <span class="language-flag">${flag}</span>
        <span class="language-name">${name}</span>
      `;

      option.addEventListener('click', () => {
        this.switchLanguage(lang);
      });

      languageSelector.appendChild(option);
    });

    document.body.appendChild(languageSelector);

    // 显示选择器
    setTimeout(() => {
      languageSelector.classList.add('active');
    }, 10);
  }

  /**
   * 显示语言选择器
   */
  showLanguageSelector() {
    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
      languageSelector.classList.add('active');
    }
  }

  /**
   * 隐藏语言选择器
   */
  hideLanguageSelector() {
    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
      languageSelector.classList.remove('active');
    }
  }

  /**
   * 切换语言
   */
  async switchLanguage(language) {
    try {
      const changed = await this.i18n.switchLanguage(language);

      if (changed) {
        console.log('[MANAGER] Language switched to:', language);

        // 更新语言选择器中的激活状态
        const languageSelector = document.getElementById('language-selector');
        if (languageSelector) {
          const options = languageSelector.querySelectorAll('.language-option');
          options.forEach(option => {
            option.classList.toggle('active', option.dataset.language === language);
          });
        }

        // 隐藏选择器
        this.hideLanguageSelector();

        // 显示切换成功通知
        this.showSyncNotification('success', this.i18n.t(`language.${language}`) + ' ✓');
      }
    } catch (error) {
      console.error('[MANAGER] Failed to switch language:', error);
      this.showSyncNotification('error', 'Language switch failed');
    }
  }

  /**
   * 更新搜索框占位符
   */
  updateSearchPlaceholder() {
    const searchInput = document.getElementById('search-input');
    const paletteInput = document.getElementById('palette-search-input');

    if (searchInput) {
      if (this.currentView === 'favorites') {
        searchInput.placeholder = this.i18n.t('search.favorites_placeholder');
      } else {
        searchInput.placeholder = this.i18n.t('search.filter_placeholder');
      }
    }

    if (paletteInput) {
      if (this.currentView === 'favorites') {
        paletteInput.placeholder = this.i18n.t('search.palette_favorites_placeholder');
      } else {
        paletteInput.placeholder = this.i18n.t('search.palette_placeholder');
      }
    }
  }



  // --- CouchDB Helper Functions ---
  /**
   * 保存用户设置到CouchDB
   */
  async saveUserSettingsToCouchDB(settings) {
    try {
      // 获取当前语言设置
      const currentLanguage = this.i18n?.getCurrentLanguage() || 'zh-CN';

      const userSettings = {
        lastActiveSection: settings.lastActiveSection || this.currentView,
        language: settings.language || currentLanguage
      };

      await this.couchDB.saveUserSettings(userSettings);
      console.log('[MANAGER] User settings saved to CouchDB');
    } catch (error) {
      console.error('[MANAGER] Failed to save user settings to CouchDB:', error);
      // 不阻塞用户操作，只记录错误
    }
  }

  /**
   * 重新加载收藏夹数据
   */
  async reloadFavorites() {
    try {
      this.favorites = await this.couchDB.getFavorites();
      console.log('[MANAGER] Reloaded favorites:', this.favorites.length, 'items');

      // 同步到chrome.storage.sync供Alt+M搜索使用
      try {
        await chrome.storage.sync.set({ favorites: this.favorites });
        console.log('[MANAGER] Synced reloaded favorites to chrome.storage.sync');
      } catch (syncError) {
        console.log('[MANAGER] Failed to sync reloaded favorites to storage:', syncError);
      }

      this.render(); // 重新渲染界面
    } catch (error) {
      console.error('[MANAGER] Failed to reload favorites:', error);
      this.showSyncNotification('error', '重新加载收藏夹失败');
    }
  }

  // --- Helper Functions ---
  async checkPermissions() {
    try {
      console.log('[MANAGER] Checking permissions...');

      // 检查tabs权限
      if (!chrome.tabs) {
        throw new Error('缺少标签页访问权限');
      }

      // 检查windows权限
      if (!chrome.windows) {
        throw new Error('缺少窗口访问权限');
      }

      // 尝试获取当前活动标签页来验证权限
      const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[MANAGER] Permissions check passed. Current tab:', currentTab.length > 0 ? currentTab[0].id : 'none');

      return true;
    } catch (error) {
      console.error('[MANAGER] Permission check failed:', error);
      throw new Error(`权限检查失败: ${error.message}`);
    }
  }

  getTabMeta(tabId) {
    return this.tabMetadata[tabId] || {};
  }

  /**
   * 获取标签页的显示标题（优先级：收藏标题 > 用户自定义名称 > 浏览器原始标题）
   */
  getTabDisplayTitle(tab) {
    const meta = this.getTabMeta(tab.id);
    const favoriteItem = this.favorites.find(f => f.url === tab.url);
    return favoriteItem?.title || meta.name || tab.title;
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  /**
   * 显示全局loading
   */
  showLoading(message = '处理中...') {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (loadingOverlay && loadingText) {
      loadingText.textContent = message;
      loadingOverlay.classList.add('active');
    }
  }

  /**
   * 隐藏全局loading
   */
  hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.remove('active');
    }
  }

  /**
   * 更新loading文案（仅在loading显示时有效）
   */
  updateLoadingText(message) {
    const loadingText = document.getElementById('loading-text');
    const loadingOverlay = document.getElementById('loading-overlay');

    // 只有在loading显示时才更新文案
    if (loadingText && loadingOverlay && loadingOverlay.classList.contains('active')) {
      loadingText.textContent = message;
    }
  }

  /**
   * 设置按钮loading状态
   */
  setButtonLoading(buttonId, loading, originalText = '') {
    const button = document.getElementById(buttonId);
    if (!button) return;

    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
      button.setAttribute('data-original-text', button.textContent);
    } else {
      button.classList.remove('loading');
      button.disabled = false;
      const original = button.getAttribute('data-original-text') || originalText;
      if (original) {
        button.textContent = original;
      }
    }
  }

  /**
   * 设置Footer按钮loading状态
   */
  setFooterButtonLoading(buttonId, loading) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    if (loading) {
      button.classList.add('loading');
    } else {
      button.classList.remove('loading');
    }
  }

  /**
   * 显示同步状态通知
   */
  showSyncNotification(type, message) {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `sync-notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <i class="material-icons-outlined notification-icon">
          ${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}
        </i>
        <span class="notification-message">${message}</span>
      </div>
    `;

    // 添加样式
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? 'var(--success-color)' : type === 'error' ? 'var(--error-color)' : 'var(--brand-color)'};
      color: var(--text-primary);
      padding: 12px 16px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 1000003;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      max-width: 300px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
    `;

    document.body.appendChild(notification);

    // 显示动画
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);

    // 自动隐藏
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  /**
   * 获取CouchDB连接状态
   */
  getCouchDBStatus() {
    return this.couchDB.getStatus();
  }

  /**
   * 显示同步状态模态框
   */
  async showSyncStatusModal() {
    const modal = document.getElementById('sync-status-modal');
    if (!modal) return;

    // 更新状态信息
    await this.updateSyncStatusInfo();

    modal.style.display = 'flex';
  }

  /**
   * 隐藏同步状态模态框
   */
  hideSyncStatusModal() {
    const modal = document.getElementById('sync-status-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * 获取CouchDB状态
   */
  getCouchDBStatus() {
    return {
      isConnected: this.couchDB.isConnected,
      isOnline: this.couchDB.isOnline,
      config: this.couchDB.config,
      pendingOperations: this.couchDB.pendingOperations.length,
      lastSyncTime: this.couchDB.lastSyncTime
    };
  }

  /**
   * 更新同步状态信息
   */
  async updateSyncStatusInfo() {
    try {
      // 获取CouchDB状态
      const status = this.getCouchDBStatus();

      // 更新侧边栏同步状态按钮的状态指示器
      const syncStatusBtn = document.getElementById('sync-status-btn');
      if (syncStatusBtn) {
        syncStatusBtn.classList.remove('connected', 'disconnected');
        if (status.isConnected) {
          syncStatusBtn.classList.add('connected');
        } else {
          syncStatusBtn.classList.add('disconnected');
        }
      }

      // 更新连接状态
      const connectionStatus = document.getElementById('connection-status');
      if (connectionStatus) {
        if (status.isConnected) {
          connectionStatus.textContent = '已连接';
          connectionStatus.className = 'status-indicator online';
        } else if (status.isOnline) {
          connectionStatus.textContent = '服务器不可达';
          connectionStatus.className = 'status-indicator offline';
        } else {
          connectionStatus.textContent = '网络离线';
          connectionStatus.className = 'status-indicator offline';
        }
      }

      // 更新数据库地址
      const databaseUrl = document.getElementById('database-url');
      if (databaseUrl) {
        databaseUrl.textContent = status.config.url;
      }

      // 获取并更新用户ID
      const userId = await this.couchDB.getUserId();
      const userIdInput = document.getElementById('user-id-input');
      if (userIdInput) {
        userIdInput.value = userId;
        userIdInput.placeholder = userId;
      }

      // 更新待同步操作数
      const pendingOperations = document.getElementById('pending-operations');
      if (pendingOperations) {
        pendingOperations.textContent = status.pendingOperations;
      }

      // 更新本地收藏数
      const localFavoritesCount = document.getElementById('local-favorites-count');
      if (localFavoritesCount) {
        localFavoritesCount.textContent = this.favorites.length;
      }

      // 更新最后同步时间
      const lastSyncTime = document.getElementById('last-sync-time');
      if (lastSyncTime) {
        if (status.lastSyncTime) {
          const syncDate = new Date(status.lastSyncTime);
          lastSyncTime.textContent = syncDate.toLocaleString('zh-CN');
        } else {
          lastSyncTime.textContent = '未同步';
        }
      }

    } catch (error) {
      console.error('[MANAGER] Failed to update sync status info:', error);
    }
  }

  /**
   * 强制刷新数据
   */
  async forceSyncFavorites() {
    try {
      this.setButtonLoading('force-sync-btn', true);

      // 重新加载收藏夹数据
      console.log('[MANAGER] Force refreshing data from CouchDB...');
      await this.reloadFavorites();

      // 重新加载用户设置
      const userSettings = await this.couchDB.getUserSettings();
      if (userSettings) {
        this.currentView = userSettings.lastActiveSection || 'current';

        // 切换到正确的视图
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
          item.classList.toggle('active', item.dataset.view === this.currentView);
        });

        document.getElementById('current-session').style.display = this.currentView === 'current' ? 'block' : 'none';
        document.getElementById('favorites-list').style.display = this.currentView === 'favorites' ? 'block' : 'none';
      }

      console.log('[MANAGER] Force refresh completed');

      // 更新状态信息
      await this.updateSyncStatusInfo();

      this.showSyncNotification('success', '数据刷新成功');

    } catch (error) {
      console.error('[MANAGER] Force refresh failed:', error);
      this.showSyncNotification('error', '刷新失败: ' + error.message);
    } finally {
      this.setButtonLoading('force-sync-btn', false);
    }
  }

  /**
   * 开始编辑用户ID
   */
  startEditUserId() {
    const userIdInput = document.getElementById('user-id-input');
    const editBtn = document.getElementById('edit-user-id-btn');
    const generateBtn = document.getElementById('generate-user-id-btn');
    const saveBtn = document.getElementById('save-user-id-btn');
    const cancelBtn = document.getElementById('cancel-edit-user-id-btn');
    const hint = document.querySelector('.user-id-hint');

    if (!userIdInput || !editBtn || !saveBtn || !cancelBtn) return;

    // 保存原始值
    this.originalUserId = userIdInput.value;

    // 切换到编辑模式
    userIdInput.removeAttribute('readonly');
    userIdInput.focus();
    userIdInput.select();

    editBtn.style.display = 'none';
    if (generateBtn) generateBtn.style.display = 'inline-block';
    saveBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'inline-block';
    if (hint) hint.style.display = 'block';

    // 添加键盘事件监听
    userIdInput.addEventListener('keydown', this.handleUserIdKeydown.bind(this));
  }

  /**
   * 处理用户ID输入框的键盘事件
   */
  handleUserIdKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.saveUserId();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelEditUserId();
    }
  }

  /**
   * 保存用户ID
   */
  async saveUserId() {
    const userIdInput = document.getElementById('user-id-input');
    if (!userIdInput) return;

    const newUserId = userIdInput.value.trim();

    if (!newUserId) {
      this.showSyncNotification('error', '用户ID不能为空');
      return;
    }

    try {
      this.showLoading('正在保存用户ID...');

      // 验证并设置新的用户ID
      const changed = await this.couchDB.setUserId(newUserId);

      if (changed) {
        // 用户ID已更改，需要重新同步数据
        this.showSyncNotification('success', '用户ID已更新，正在重新同步数据...');

        // 重新加载数据
        try {
          await this.reloadFavorites();
          this.showSyncNotification('success', '数据同步完成');
        } catch (error) {
          console.error('[MANAGER] Failed to sync after user ID change:', error);
          this.showSyncNotification('error', '重新同步失败: ' + error.message);
        }
      } else {
        this.showSyncNotification('info', '用户ID未更改');
      }

      // 退出编辑模式
      this.exitEditUserId();

      // 更新同步状态信息
      await this.updateSyncStatusInfo();

    } catch (error) {
      console.error('[MANAGER] Failed to save user ID:', error);
      this.showSyncNotification('error', '保存失败: ' + error.message);

      // 恢复原始值
      userIdInput.value = this.originalUserId;
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 取消编辑用户ID
   */
  cancelEditUserId() {
    const userIdInput = document.getElementById('user-id-input');
    if (!userIdInput) return;

    // 恢复原始值
    userIdInput.value = this.originalUserId;

    // 退出编辑模式
    this.exitEditUserId();
  }

  /**
   * 退出编辑用户ID模式
   */
  /**
   * 生成新的用户ID
   */
  generateNewUserId() {
    const userIdInput = document.getElementById('user-id-input');
    if (!userIdInput) return;

    // 生成新的用户ID
    const newUserId = this.couchDB.generateUserId();
    userIdInput.value = newUserId;
    userIdInput.focus();
    userIdInput.select();
  }

  exitEditUserId() {
    const userIdInput = document.getElementById('user-id-input');
    const editBtn = document.getElementById('edit-user-id-btn');
    const generateBtn = document.getElementById('generate-user-id-btn');
    const saveBtn = document.getElementById('save-user-id-btn');
    const cancelBtn = document.getElementById('cancel-edit-user-id-btn');
    const hint = document.querySelector('.user-id-hint');

    if (!userIdInput || !editBtn || !saveBtn || !cancelBtn) return;

    // 切换回只读模式
    userIdInput.setAttribute('readonly', 'readonly');

    editBtn.style.display = 'inline-block';
    if (generateBtn) generateBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    if (hint) hint.style.display = 'none';

    // 移除键盘事件监听
    userIdInput.removeEventListener('keydown', this.handleUserIdKeydown.bind(this));
  }

  /**
   * 测试CouchDB连接
   */
  async testCouchDBConnection() {
    try {
      this.setButtonLoading('test-connection-btn', true);

      // 显示检查中状态
      const connectionStatus = document.getElementById('connection-status');
      if (connectionStatus) {
        connectionStatus.textContent = '检查中...';
        connectionStatus.className = 'status-indicator checking';
      }

      // 测试连接
      console.log('[MANAGER] Starting connection test...');
      const connected = await this.couchDB.checkConnection();

      if (connected) {
        console.log('[MANAGER] Connection test successful');
        this.showSyncNotification('success', '连接测试成功');
      } else {
        console.log('[MANAGER] Connection test failed');
        this.showSyncNotification('error', '连接测试失败');
      }

      // 更新状态信息
      await this.updateSyncStatusInfo();

    } catch (error) {
      console.error('[MANAGER] Connection test failed:', error);
      this.showSyncNotification('error', '连接测试失败: ' + error.message);
      // 更新状态信息
      await this.updateSyncStatusInfo();
    } finally {
      this.setButtonLoading('test-connection-btn', false);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[MANAGER] DOM loaded, initializing ManagerApp...');

    // 检查必要的元素是否存在
    const requiredElements = ['window-list', 'favorite-list', 'current-session', 'favorites-list'];
    const missingElements = requiredElements.filter(id => !document.getElementById(id));

    if (missingElements.length > 0) {
      console.error('[MANAGER] Missing required DOM elements:', missingElements);
      throw new Error(`页面结构不完整，缺少元素: ${missingElements.join(', ')}`);
    }

    const app = new ManagerApp();
    // 不需要等待init，因为它已经在构造函数中被调用

    // 将app实例挂载到window对象，方便调试
    window.tabulaApp = app;

  } catch (error) {
    console.error('[MANAGER] Failed to initialize application:', error);

    // 显示错误页面
    document.body.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        padding: 20px;
        text-align: center;
        font-family: system-ui, -apple-system, sans-serif;
      ">
        <h2 style="color: var(--error-color); margin-bottom: 16px;">Tabula 初始化失败</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px;">${error.message}</p>
        <button onclick="location.reload()" style="
          padding: 12px 24px;
          background: var(--brand-color);
          color: var(--text-primary);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        ">重新加载</button>
      </div>
    `;
  }
});