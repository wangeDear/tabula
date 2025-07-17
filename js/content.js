/**
 * Tabula Content Script
 * 在当前页面显示搜索界面，支持快速跳转标签页
 */

class TabulaSearchOverlay {
  constructor() {
    this.isVisible = false;
    this.selectedIndex = 0;
    this.searchResults = [];
    this.overlay = null;
    this.searchInput = null;
    this.resultsList = null;
    this.i18n = null;
    this.iconCache = new Map(); // 图标缓存
    this.contextMenu = null; // 右键菜单
    this.currentContextItem = null; // 当前右键菜单项
    
    this.init();
  }

  async init() {
    // 初始化国际化
    await this.initI18n();
    // 加载CSS样式
    await this.loadCss();
    
    // 监听来自背景脚本的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'show-search-overlay') {
        this.show();
        sendResponse({ success: true });
      }
    });
  }

  async initI18n() {
    // 获取当前语言设置和主题设置
    const result = await chrome.storage.sync.get(['language']);
    const themeResult = await chrome.storage.local.get(['isLightMode']);
    
    const currentLanguage = result.language || 'zh-CN';
    this.isLightMode = themeResult.isLightMode || false;
    
    // 应用主题到文档
    this.applyTheme();
    
    // 加载语言资源
    try {
      const response = await fetch(chrome.runtime.getURL(`locales/${currentLanguage}.json`));
      this.i18n = await response.json();
    } catch (error) {
      console.error('[CONTENT] Failed to load language resources:', error);
      // 使用默认中文
      this.i18n = {
        'search.placeholder': '搜索并跳转到标签页...',
        'search.no_results': '没有找到匹配的标签页',
        'search.no_tabs_default': '没有可显示的标签页',
        'search.current_tab': '当前',
        'search.favorite': '收藏',
        'search.press_enter': '按回车键跳转',
        'search.press_esc': '按ESC键关闭',
        'search.rename_title': '重命名标题',
        'search.add_favorite': '添加到收藏夹',
        'search.remove_favorite': '取消收藏',
        'search.edit_favorite': '编辑收藏',
        'search.open_new_tab': '新标签页打开',
        'search.close_tab': '关闭标签页',
        'hint.navigate': '导航',
        'hint.open': '打开',
        'hint.close': '关闭',
        'hint.right_click': '右键',
        'hint.menu': '菜单'
      };
    }
  }

  t(key, params = {}) {
    let text = this.i18n[key] || key;
    
    // 简单的参数替换
    Object.keys(params).forEach(param => {
      text = text.replace(new RegExp(`{{${param}}}`, 'g'), params[param]);
    });
    
    return text;
  }

  createOverlay() {
    if (this.overlay) return;

    // 创建遮罩层
    this.overlay = document.createElement('div');
    this.overlay.id = 'tabula-search-overlay';
    this.overlay.className = 'tabula-search-overlay';
    
    // 确保弹窗不被页面样式干扰
    this.overlay.style.cssText = `
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      background: rgba(0, 0, 0, 0.7) !important;
      backdrop-filter: blur(8px) !important;
      display: flex !important;
      align-items: flex-start !important;
      justify-content: center !important;
      padding-top: 15vh !important;
      animation: fadeIn 0.3s ease-out !important;
      box-sizing: border-box !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;

    // 创建搜索容器
    const searchContainer = document.createElement('div');
    searchContainer.classList.add('tabula-search-container');
    searchContainer.style.cssText = `
      all: initial !important;
      background: #2D3748 !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 8px 32px rgba(0, 0, 0, 0.6) !important;
      width: 90% !important;
      max-width: 600px !important;
      height: 80vh !important;
      max-height: 80vh !important;
      overflow: hidden !important;
      position: relative !important;
      animation: slideInScale 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
      border: 1px solid #4A5568 !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;

    // 创建搜索输入框
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = this.t('search.placeholder');
    this.searchInput.classList.add('tabula-search-input');
    this.searchInput.style.cssText = `
      all: initial !important;
      width: 100% !important;
      padding: 20px 24px !important;
      font-size: 18px !important;
      border: none !important;
      outline: none !important;
      background: transparent !important;
      color: #E2E8F0 !important;
      border-bottom: 2px solid #4A5568 !important;
      transition: all 0.3s ease !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      box-sizing: border-box !important;
    `;

    // 创建结果列表
    this.resultsList = document.createElement('div');
    this.resultsList.classList.add('tabula-results-list');
    this.resultsList.style.cssText = `
      all: initial !important;
      flex: 1 !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      background: #2D3748 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      box-sizing: border-box !important;
    `;

    // 创建底部提示
    const hint = document.createElement('div');
    hint.classList.add('tabula-hint-bar');

    const leftHint = document.createElement('span');
    leftHint.innerHTML = `
      <kbd>↑↓</kbd> 导航
      <kbd>Enter</kbd> 打开
      <kbd>Esc</kbd> 关闭
      <kbd>右键</kbd> 菜单
    `;

    const rightHint = document.createElement('span');
    rightHint.classList.add('tabula-hint-bar-right');
    rightHint.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      Tabula Search
    `;

    hint.appendChild(leftHint);
    hint.appendChild(rightHint);

    searchContainer.appendChild(this.searchInput);
    searchContainer.appendChild(this.resultsList);
    searchContainer.appendChild(hint);
    this.overlay.appendChild(searchContainer);

    // 事件监听
    this.setupEventListeners();

    document.body.appendChild(this.overlay);
  }

  applyTheme() {
    // 添加或移除light-mode类
    if (this.isLightMode) {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
  }

  async loadCss() {
    if (document.getElementById('tabula-content-styles')) return;
    
    try {
      // 获取CSS文件内容
      const response = await fetch(chrome.runtime.getURL('styles/manager.css'));
      let cssText = await response.text();
      
      // 增加CSS选择器权重，确保样式不被页面覆盖
      cssText = cssText.replace(/\.tabula-search-overlay\s*{/g, '#tabula-search-overlay.tabula-search-overlay {');
      cssText = cssText.replace(/\.tabula-search-container\s*{/g, '.tabula-search-overlay .tabula-search-container {');
      cssText = cssText.replace(/\.tabula-search-input\s*{/g, '.tabula-search-overlay .tabula-search-input {');
      cssText = cssText.replace(/\.tabula-results-list\s*{/g, '.tabula-search-overlay .tabula-results-list {');
      cssText = cssText.replace(/\.tabula-result-item\s*{/g, '.tabula-search-overlay .tabula-result-item {');
      cssText = cssText.replace(/\.tabula-hint-bar\s*{/g, '.tabula-search-overlay .tabula-hint-bar {');
      
      // 移除选择动画
      cssText = cssText.replace(/animation: selectedPulse[^;]*;/g, '/* animation removed */');
      cssText = cssText.replace(/\.tabula-result-item\.selected\s*{[^}]*animation:[^}]*}/g, 
        '.tabula-search-overlay .tabula-result-item.selected { /* no animation */ }');
      
             // 添加!important规则确保关键样式生效
       cssText += `
         /* 动画关键帧 */
         @keyframes fadeIn {
           from { opacity: 0; }
           to { opacity: 1; }
         }
         
         @keyframes fadeOut {
           from { opacity: 1; }
           to { opacity: 0; }
         }
         
         @keyframes slideInScale {
           from {
             opacity: 0;
             transform: translateY(-40px) scale(0.9);
           }
           to {
             opacity: 1;
             transform: translateY(0) scale(1);
           }
         }
         
         @keyframes slideInItem {
           from {
             opacity: 0;
             transform: translateX(-20px);
           }
           to {
             opacity: 1;
             transform: translateX(0);
           }
         }
         
         /* 强制样式覆盖 */
         #tabula-search-overlay.tabula-search-overlay {
           position: fixed !important;
           top: 0 !important;
           left: 0 !important;
           width: 100vw !important;
           height: 100vh !important;
           z-index: 2147483647 !important; /* 最大z-index值 */
           background: rgba(0, 0, 0, 0.7) !important;
           backdrop-filter: blur(8px) !important;
           display: flex !important;
           align-items: flex-start !important;
           justify-content: center !important;
           padding-top: 15vh !important;
           animation: fadeIn 0.3s ease-out !important;
           box-sizing: border-box !important;
         }
         
         .tabula-search-overlay .tabula-search-container {
           background: #2D3748 !important;
           border-radius: 16px !important;
           box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 8px 32px rgba(0, 0, 0, 0.6) !important;
           width: 90% !important;
           max-width: 600px !important;
           height: 80vh !important;
           max-height: 80vh !important;
           overflow: hidden !important;
           position: relative !important;
           animation: slideInScale 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
           border: 1px solid #4A5568 !important;
           display: flex !important;
           flex-direction: column !important;
           box-sizing: border-box !important;
         }
         
         /* 移除水平滚动条 */
         .tabula-search-overlay .tabula-results-list {
           overflow-x: hidden !important;
           overflow-y: auto !important;
         }
         
         .tabula-search-overlay .tabula-results-list::-webkit-scrollbar-horizontal {
           display: none !important;
         }
         
         /* 强制隐藏所有元素的水平滚动条 */
         .tabula-search-overlay .tabula-result-item {
           animation: none !important;
           overflow-x: hidden !important;
           white-space: nowrap !important;
         }
         
         .tabula-search-overlay .item-details {
           overflow-x: hidden !important;
         }
         
         .tabula-search-overlay .item-title,
         .tabula-search-overlay .item-url {
           overflow: hidden !important;
           text-overflow: ellipsis !important;
           white-space: nowrap !important;
         }
         
         /* 右键菜单z-index修复 */
         .tabula-context-menu {
           z-index: 2147483648 !important;
           position: fixed !important;
         }
         
         /* 模态框z-index修复 */
         .modal-overlay {
           z-index: 2147483649 !important;
           position: fixed !important;
           top: 0 !important;
           left: 0 !important;
           width: 100vw !important;
           height: 100vh !important;
         }
         
         .modal-overlay .modal {
           position: absolute !important;
           top: 50% !important;
           left: 50% !important;
           transform: translate(-50%, -50%) !important;
           max-width: 360px !important;
           max-height: 280px !important;
           width: 90% !important;
         }
       `;
      
      // 创建style元素并注入CSS
      const style = document.createElement('style');
      style.id = 'tabula-content-styles';
      style.textContent = cssText;
      document.head.appendChild(style);
      
      console.log('[CONTENT] CSS loaded successfully');
    } catch (error) {
      console.error('[CONTENT] Failed to load CSS:', error);
    }
  }

  setupEventListeners() {
    // 搜索输入事件
    this.searchInput.addEventListener('input', (e) => {
      this.search(e.target.value);
    });

    // 键盘事件
    this.searchInput.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    // 点击遮罩关闭
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // 阻止页面滚动
    document.addEventListener('keydown', this.preventScroll);
    
    // 点击其他地方关闭右键菜单
    document.addEventListener('click', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
  }

  preventScroll = (e) => {
    if (this.isVisible && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
    }
  }

  async search(query, isInitial = false) {
    // 防抖处理避免频繁搜索
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    
    const performSearch = async () => {
      try {
        // 获取所有标签页和收藏夹
        const [tabs, favorites, tabMetadata] = await Promise.all([
          chrome.runtime.sendMessage({ action: 'get-all-tabs' }),
          chrome.runtime.sendMessage({ action: 'get-favorites' }),
          chrome.runtime.sendMessage({ action: 'get-tab-metadata' })
        ]);
      
        // 缓存数据供渲染时使用
        this.cachedFavorites = favorites;
        this.cachedTabMetadata = tabMetadata;
      
      if (!query.trim()) {
        // 没有搜索查询时，显示默认的10条记录
        // 获取最近的标签页（当前窗口优先，然后按最近访问时间排序）
        const currentWindowTabs = tabs.filter(tab => tab.windowId === tabs.find(t => t.active)?.windowId || 0);
        const otherWindowTabs = tabs.filter(tab => tab.windowId !== tabs.find(t => t.active)?.windowId || 0);
        
        // 优先显示当前窗口的标签页，然后是其他窗口的标签页
        const sortedTabs = [...currentWindowTabs, ...otherWindowTabs];
        
                 const tabResults = sortedTabs.map(tab => ({
           ...tab,
           type: 'tab',
           searchType: 'current'
         }));
         
         // 添加所有收藏夹项目（排除已经在当前会话中的）
         const openUrls = new Set(tabs.map(tab => tab.url));
         const favoriteResults = favorites.filter(favorite => !openUrls.has(favorite.url))
           .map(favorite => ({
             ...favorite,
             type: 'favorite',
             searchType: 'favorite'
           }));
         
         this.searchResults = [...tabResults, ...favoriteResults];
      } else {
        // 有搜索查询时，进行搜索过滤
        const searchTerm = query.toLowerCase();
        
        // 搜索当前会话标签页
        const tabResults = tabs.filter(tab => {
          const originalTitle = (tab.title || '').toLowerCase();
          const url = (tab.url || '').toLowerCase();
          
          // 获取自定义标题（优先级：收藏标题 > 用户自定义名称 > 浏览器原始标题）
          const favoriteItem = favorites.find(f => f.url === tab.url);
          const meta = tabMetadata[tab.id] || {};
          const displayTitle = (favoriteItem?.title || meta.name || tab.title || '').toLowerCase();
          
          return displayTitle.includes(searchTerm) || 
                 originalTitle.includes(searchTerm) || 
                 url.includes(searchTerm);
        }).map(tab => ({
          ...tab,
          type: 'tab',
          searchType: 'current'
        }));
        
        // 搜索收藏夹（排除已经在当前会话中的）
        const openUrls = new Set(tabs.map(tab => tab.url));
        const favoriteResults = favorites.filter(favorite => {
          const title = (favorite.title || '').toLowerCase();
          const url = (favorite.url || '').toLowerCase();
          
          return (title.includes(searchTerm) || url.includes(searchTerm)) && 
                 !openUrls.has(favorite.url);
        }).map(favorite => ({
          ...favorite,
          type: 'favorite',
          searchType: 'favorite'
        }));
        
        // 合并结果，当前会话优先，不限制数量
        this.searchResults = [...tabResults, ...favoriteResults];
      }
      
      // 确保选中第一条记录
      this.selectedIndex = 0;
      this.renderResults();
      // 在渲染完成后更新选择状态
      if (this.searchResults.length > 0) {
        this.updateSelection();
      }
      } catch (error) {
        console.error('[CONTENT] Search failed:', error);
        this.searchResults = [];
        this.renderResults();
      }
    };
    
    // 使用防抖，初始搜索立即执行，后续搜索延迟执行
    if (isInitial || !query.trim()) {
      await performSearch();
    } else {
      this.searchTimeout = setTimeout(performSearch, 300);
    }
  }

  renderResults() {
    if (!this.resultsList) return;

    // 清空结果列表，但保留样式
    this.resultsList.innerHTML = '';

    if (this.searchResults.length === 0) {
      const isEmpty = this.searchInput && this.searchInput.value.trim() === '';
      this.resultsList.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">${isEmpty ? '📋' : '🔍'}</div>
          ${isEmpty ? (this.t('search.no_tabs') || this.t('search.no_tabs_default')) : this.t('search.no_results')}
        </div>
      `;
      return;
    }

    // 使用 DocumentFragment 批量添加元素
    const fragment = document.createDocumentFragment();
    
    this.searchResults.forEach((item, index) => {
      const resultItem = this.createResultItem(item, index);
      fragment.appendChild(resultItem);
    });
    
    this.resultsList.appendChild(fragment);
  }

  updateSelection(direction = null) {
    const items = this.resultsList.children;
    
    // 确保索引在有效范围内
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.searchResults.length - 1));
    
    // 移除所有选中状态
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('selected');
    }
    
    // 应用新的选择状态
    if (this.selectedIndex >= 0 && this.selectedIndex < items.length) {
      const selectedItem = items[this.selectedIndex];
      selectedItem.classList.add('selected');
      
      // 简单的滚动到可见区域（无动画）
      if (direction) {
        selectedItem.scrollIntoView({ 
          block: 'nearest', 
          behavior: 'instant' // 移除动画
        });
      }
    }
  }

  handleKeydown(e) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        if (this.searchResults.length > 0) {
          if (this.selectedIndex < this.searchResults.length - 1) {
            this.selectedIndex++;
          } else {
            this.selectedIndex = 0; // 到达最后一个时回到第一个
          }
          this.updateSelection('down');
        }
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        if (this.searchResults.length > 0) {
          if (this.selectedIndex > 0) {
            this.selectedIndex--;
          } else {
            this.selectedIndex = this.searchResults.length - 1; // 在第一个时跳到最后一个
          }
          this.updateSelection('up');
        }
        break;
      
      case 'Enter':
        e.preventDefault();
        if (this.searchResults.length > 0 && this.selectedIndex >= 0) {
          this.selectItem(this.searchResults[this.selectedIndex]);
        }
        break;
    }
  }

  async selectItem(item) {
    try {
      if (item.type === 'tab') {
        // 切换到选中的标签页
        await chrome.runtime.sendMessage({
          action: 'switch-to-tab',
          tabId: item.id,
          windowId: item.windowId
        });
      } else if (item.type === 'favorite') {
        // 打开收藏夹项目
        await chrome.runtime.sendMessage({
          action: 'open-favorite',
          url: item.url
        });
      }
      
      this.hide();
    } catch (error) {
      console.error('[CONTENT] Failed to select item:', error);
    }
  }

  sanitizeFavIconUrl(favIconUrl) {
    if (favIconUrl && favIconUrl.startsWith('data:')) {
      return chrome.runtime.getURL('icons/icon16.png');
    }
    return favIconUrl || chrome.runtime.getURL('icons/icon16.png');
  }

  getTabDisplayTitle(tab) {
    // 这里需要从背景脚本获取的数据中计算显示标题
    // 由于我们已经在search方法中获取了必要的数据，这里只是一个辅助方法
    return tab.title || 'Untitled';
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return this.t('date.today') || '今天';
    if (diffDays === 1) return this.t('date.yesterday') || '昨天';
    if (diffDays < 7) return `${diffDays}${this.t('date.days_ago') || '天前'}`;
    return date.toLocaleDateString();
  }

  createResultItem(item, index) {
    const resultItem = document.createElement('div');
    resultItem.className = 'tabula-result-item';
    resultItem.dataset.index = index;
    
    // 添加选中状态类 - 默认选中第一条记录(index === 0)
    if (index === 0) {
      resultItem.classList.add('selected');
      this.selectedIndex = 0; // 确保selectedIndex正确
    }

    // 类型标识
    const typeIndicator = document.createElement('div');
    typeIndicator.className = 'type-indicator';
    if (item.type === 'tab') {
      typeIndicator.classList.add(this.isLightMode ? 'tab-type-light' : 'tab-type-dark');
      typeIndicator.textContent = this.t('search.current_tab') || '当前';
    } else {
      typeIndicator.classList.add(this.isLightMode ? 'favorite-type-light' : 'favorite-type-dark');
      typeIndicator.textContent = this.t('search.favorite') || '收藏';
    }

    // 图标
    const favicon = document.createElement('img');
    favicon.className = 'item-favicon';
    const faviconUrl = this.sanitizeFavIconUrl(item.favIconUrl);
    
    // 设置默认图标，避免闪烁
    const defaultIcon = chrome.runtime.getURL('icons/icon16.png');
    favicon.src = defaultIcon;
    
    // 如果有自定义图标，则异步加载
    if (faviconUrl !== defaultIcon) {
      // 检查缓存
      if (this.iconCache.has(faviconUrl)) {
        const cachedResult = this.iconCache.get(faviconUrl);
        if (cachedResult.success) {
          favicon.src = faviconUrl;
        }
      } else {
        // 设置loading状态
        favicon.setAttribute('loading', 'true');
        
        // 异步加载并缓存结果
        const img = new Image();
        img.onload = () => {
          this.iconCache.set(faviconUrl, { success: true });
          favicon.removeAttribute('loading');
          // 使用requestAnimationFrame确保流畅的更新
          requestAnimationFrame(() => {
            favicon.src = faviconUrl;
          });
        };
        img.onerror = () => {
          this.iconCache.set(faviconUrl, { success: false });
          favicon.removeAttribute('loading');
          // 保持默认图标
        };
        
        // 设置超时防止长时间加载
        setTimeout(() => {
          if (favicon.getAttribute('loading')) {
            img.src = ''; // 取消加载
            favicon.removeAttribute('loading');
            this.iconCache.set(faviconUrl, { success: false });
          }
        }, 3000);
        
        img.src = faviconUrl;
      }
    }

    // 标题和URL容器
    const details = document.createElement('div');
    details.className = 'item-details';

    // 获取显示标题
    let displayTitle;
    if (item.type === 'tab') {
      const favoriteItem = this.cachedFavorites?.find(f => f.url === item.url);
      const meta = this.cachedTabMetadata?.[item.id] || {};
      displayTitle = favoriteItem?.title || meta.name || item.title;
    } else {
      displayTitle = item.title;
    }

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = displayTitle || 'Untitled';

    const url = document.createElement('div');
    url.className = 'item-url';
    url.textContent = item.url;

    // 如果是收藏夹项目，添加收藏时间
    if (item.type === 'favorite' && item.addedAt) {
      const favoriteDate = document.createElement('div');
      favoriteDate.className = 'favorite-date';
      favoriteDate.textContent = this.formatDate(item.addedAt);
      details.appendChild(favoriteDate);
    }

    details.appendChild(title);
    details.appendChild(url);

    resultItem.appendChild(favicon);
    resultItem.appendChild(details);
    resultItem.appendChild(typeIndicator);

    // 悬停更新选择状态
    resultItem.addEventListener('mouseenter', () => {
      // 移除当前选中状态
      const currentSelected = this.resultsList.querySelector('.selected');
      if (currentSelected) {
        currentSelected.classList.remove('selected');
      }
      
      // 设置新的选中状态
      this.selectedIndex = index;
      resultItem.classList.add('selected');
    });

    // 点击事件
    resultItem.addEventListener('click', (e) => {
      this.selectItem(item);
    });

    // 右键菜单
    resultItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, item);
    });

    return resultItem;
  }



  showContextMenu(e, item) {
    this.hideContextMenu();
    
    this.currentContextItem = item;
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'tabula-context-menu';
    
    // 设置比遮罩层更高的z-index
    this.contextMenu.style.zIndex = '2147483648'; // 比遮罩层高1
    
    const menuItems = [];
    
    if (item.type === 'tab') {
      menuItems.push(
        { text: this.t('search.rename_title'), icon: '✏️', action: () => this.showRenameModal(item) },
        { separator: true },
        { text: this.cachedFavorites?.find(f => f.url === item.url) ? this.t('search.remove_favorite') : this.t('search.add_favorite'), 
          icon: this.cachedFavorites?.find(f => f.url === item.url) ? '★' : '☆', 
          action: () => {
            const favoriteItem = this.cachedFavorites?.find(f => f.url === item.url);
            if (favoriteItem) {
              this.removeFavorite(item);
            } else {
              this.showAddFavoriteModal(item);
            }
          }
        },
        { text: this.t('search.open_new_tab'), icon: '↗', action: () => this.openInNewTab(item) },
        { separator: true },
        { text: this.t('search.close_tab'), icon: '×', action: () => this.closeTab(item) }
      );
    } else {
      menuItems.push(
        { text: this.t('search.edit_favorite'), icon: '✏️', action: () => this.showEditFavoriteModal(item) },
        { separator: true },
        { text: this.t('search.open_new_tab'), icon: '↗', action: () => this.openInNewTab(item) },
        { text: this.t('search.remove_favorite'), icon: '🗑️', action: () => this.removeFavorite(item) }
      );
    }
    
    menuItems.forEach(menuItem => {
      if (menuItem.separator) {
        const separator = document.createElement('div');
        separator.className = 'tabula-context-menu-separator';
        separator.style.cssText = `
          height: 1px !important;
          background: #4A5568 !important;
          margin: 4px 0 !important;
        `;
        this.contextMenu.appendChild(separator);
      } else {
        const item = document.createElement('div');
        item.className = 'tabula-context-menu-item';
        item.style.cssText = `
          padding: 10px 16px !important;
          cursor: pointer !important;
          color: #E2E8F0 !important;
          font-size: 14px !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          transition: all 0.2s ease !important;
          background: transparent !important;
        `;
        item.innerHTML = `<span>${menuItem.icon}</span><span>${menuItem.text}</span>`;
        // 悬停效果
        item.addEventListener('mouseenter', () => {
          item.style.setProperty('background', '#1A202C', 'important');
          item.style.setProperty('color', '#2B6CB0', 'important');
        });
        
        item.addEventListener('mouseleave', () => {
          item.style.setProperty('background', 'transparent', 'important');
          item.style.setProperty('color', '#E2E8F0', 'important');
        });
        
        item.addEventListener('click', () => {
          menuItem.action();
          this.hideContextMenu();
        });
        this.contextMenu.appendChild(item);
      }
    });
    
    // 定位菜单并确保样式
    this.contextMenu.style.cssText = `
      position: fixed !important;
      left: ${e.pageX}px !important;
      top: ${e.pageY}px !important;
      z-index: 2147483648 !important;
      background: #2D3748 !important;
      border: 1px solid #4A5568 !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6) !important;
      min-width: 180px !important;
      padding: 8px 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;
    
    document.body.appendChild(this.contextMenu);
    
    // 确保菜单在屏幕内
    const rect = this.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.contextMenu.style.setProperty('left', `${e.pageX - rect.width}px`, 'important');
    }
    if (rect.bottom > window.innerHeight) {
      this.contextMenu.style.setProperty('top', `${e.pageY - rect.height}px`, 'important');
    }
  }

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  showModal(title, placeholder, value, onConfirm) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay active';
    
    // 设置完整的模态框样式 - 使用绝对定位居中
    modalOverlay.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.8) !important;
      z-index: 2147483649 !important;
      backdrop-filter: blur(4px) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    `;
    
    modalOverlay.innerHTML = `
             <div class="modal" style="
         background: #2D3748 !important;
         border-radius: 12px !important;
         padding: 0 !important;
         width: 90% !important;
         max-width: 360px !important;
         max-height: 280px !important;
         box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3) !important;
         animation: slideInScale 0.3s ease-out !important;
         overflow: hidden !important;
         border: 1px solid #4A5568 !important;
         position: absolute !important;
         top: 50% !important;
         left: 50% !important;
         transform: translate(-50%, -50%) !important;
       ">
                 <div class="modal-header" style="
           padding: 16px 20px !important;
           border-bottom: 1px solid #4A5568 !important;
           display: flex !important;
           justify-content: space-between !important;
           align-items: center !important;
           background: #2D3748 !important;
         ">
                     <h3 class="modal-title" style="
             margin: 0 !important;
             font-size: 16px !important;
             font-weight: 600 !important;
             color: #E2E8F0 !important;
           ">${title}</h3>
          <button class="btn-close" style="
            background: none !important;
            border: none !important;
            font-size: 24px !important;
            cursor: pointer !important;
            color: #A0AEC0 !important;
            padding: 0 !important;
            width: 24px !important;
            height: 24px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          ">×</button>
        </div>
                 <div class="modal-body" style="
           padding: 20px !important;
           background: #2D3748 !important;
         ">
          <div class="form-group">
                         <label class="form-label" style="
               display: block !important;
               margin-bottom: 6px !important;
               font-size: 13px !important;
               color: #E2E8F0 !important;
               font-weight: 500 !important;
             ">${placeholder}</label>
                         <input type="text" class="form-input" value="${value}" style="
               width: 100% !important;
               padding: 10px 12px !important;
               border: 2px solid #4A5568 !important;
               border-radius: 6px !important;
               font-size: 14px !important;
               background: #1A202C !important;
               color: #E2E8F0 !important;
               outline: none !important;
               transition: border-color 0.2s ease !important;
               box-sizing: border-box !important;
             ">
          </div>
        </div>
                 <div class="modal-footer" style="
           padding: 14px 20px !important;
           background: #1A202C !important;
           display: flex !important;
           gap: 10px !important;
           justify-content: flex-end !important;
         ">
          <button class="btn btn-secondary" style="
            padding: 8px 16px !important;
            border: 1px solid #4A5568 !important;
            border-radius: 6px !important;
            background: #2D3748 !important;
            color: #E2E8F0 !important;
            cursor: pointer !important;
            font-size: 14px !important;
            transition: all 0.2s ease !important;
          ">取消</button>
          <button class="btn btn-primary" style="
            padding: 8px 16px !important;
            border: none !important;
            border-radius: 6px !important;
            background: #2B6CB0 !important;
            color: white !important;
            cursor: pointer !important;
            font-size: 14px !important;
            transition: all 0.2s ease !important;
          ">确定</button>
        </div>
      </div>
    `;
    
    const input = modalOverlay.querySelector('.form-input');
    const cancelBtn = modalOverlay.querySelector('.btn-secondary');
    const confirmBtn = modalOverlay.querySelector('.btn-primary');
    const closeBtn = modalOverlay.querySelector('.btn-close');
    
    // 添加按钮悬停效果
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#4A5568 !important';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = '#2D3748 !important';
    });
    
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = '#3182CE !important';
    });
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = '#2B6CB0 !important';
    });
    
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#E2E8F0 !important';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = '#A0AEC0 !important';
    });
    
    // 输入框聚焦效果
    input.addEventListener('focus', () => {
      input.style.borderColor = '#2B6CB0 !important';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = '#4A5568 !important';
    });
    
    const closeModal = () => {
      modalOverlay.style.animation = 'fadeOut 0.2s ease-out forwards';
      setTimeout(() => {
        if (modalOverlay && modalOverlay.parentNode) {
          modalOverlay.remove();
        }
      }, 200);
    };
    
    const handleConfirm = () => {
      const newValue = input.value.trim();
      if (newValue) {
        onConfirm(newValue);
        closeModal();
      }
    };
    
    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', handleConfirm);
    closeBtn.addEventListener('click', closeModal);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    });
    
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeModal();
      }
    });
    
    document.body.appendChild(modalOverlay);
    input.focus();
    input.select();
  }

  showRenameModal(item) {
    const meta = this.cachedTabMetadata?.[item.id] || {};
    const favoriteItem = this.cachedFavorites?.find(f => f.url === item.url);
    const currentTitle = favoriteItem?.title || meta.name || item.title;
    
    this.showModal(
      this.t('search.rename_title'),
      '输入新标题...',
      currentTitle,
      (newTitle) => {
        this.renameTab(item, newTitle);
      }
    );
  }

  showAddFavoriteModal(item) {
    this.showModal(
      this.t('search.add_favorite'),
      '输入收藏标题...',
      item.title,
      (title) => {
        this.addFavorite(item, title);
      }
    );
  }

  showEditFavoriteModal(item) {
    this.showModal(
      this.t('search.edit_favorite'),
      '输入新标题...',
      item.title,
      (newTitle) => {
        this.editFavorite(item, newTitle);
      }
    );
  }

  async renameTab(item, newTitle) {
    try {
      await chrome.runtime.sendMessage({
        action: 'rename-tab',
        tabId: item.id,
        title: newTitle
      });
      
      // 更新缓存
      if (this.cachedTabMetadata) {
        if (!this.cachedTabMetadata[item.id]) {
          this.cachedTabMetadata[item.id] = {};
        }
        this.cachedTabMetadata[item.id].name = newTitle;
      }
      
      // 重新搜索以更新结果
      this.search(this.searchInput.value);
    } catch (error) {
      console.error('[CONTENT] Failed to rename tab:', error);
    }
  }

  async addFavorite(item, title) {
    try {
      await chrome.runtime.sendMessage({
        action: 'add-favorite',
        title: title,
        url: item.url,
        favIconUrl: item.favIconUrl
      });
      
      // 重新搜索以更新结果
      this.search(this.searchInput.value);
    } catch (error) {
      console.error('[CONTENT] Failed to add favorite:', error);
    }
  }

  async editFavorite(item, newTitle) {
    try {
      await chrome.runtime.sendMessage({
        action: 'edit-favorite',
        url: item.url,
        title: newTitle
      });
      
      // 重新搜索以更新结果
      this.search(this.searchInput.value);
    } catch (error) {
      console.error('[CONTENT] Failed to edit favorite:', error);
    }
  }

  async removeFavorite(item) {
    try {
      await chrome.runtime.sendMessage({
        action: 'remove-favorite',
        url: item.url
      });
      
      // 重新搜索以更新结果
      this.search(this.searchInput.value);
    } catch (error) {
      console.error('[CONTENT] Failed to remove favorite:', error);
    }
  }

  async closeTab(item) {
    try {
      await chrome.runtime.sendMessage({
        action: 'close-tab',
        tabId: item.id
      });
      
      // 重新搜索以更新结果
      this.search(this.searchInput.value);
    } catch (error) {
      console.error('[CONTENT] Failed to close tab:', error);
    }
  }

  async openInNewTab(item) {
    try {
      await chrome.runtime.sendMessage({
        action: 'open-new-tab',
        url: item.url
      });
      
      this.hide();
    } catch (error) {
      console.error('[CONTENT] Failed to open in new tab:', error);
    }
  }

  show() {
    if (this.isVisible) return;

    this.createOverlay();
    this.isVisible = true;
    
    // 重置选择状态
    this.selectedIndex = 0;
    
    this.searchInput.focus();
    this.search('', true); // 初始化搜索
  }

  hide() {
    if (!this.isVisible) return;

    this.hideContextMenu();
    this.isVisible = false;
    this.selectedIndex = 0;
    this.searchResults = [];
    
    // 清理资源
    
    if (this.overlay) {
      document.removeEventListener('keydown', this.preventScroll);
      
      // 添加退出动画
      this.overlay.style.animation = 'fadeOut 0.2s ease-out forwards';
      
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.remove();
          this.overlay = null;
          this.searchInput = null;
          this.resultsList = null;
        }
      }, 200);
    }
  }
}

// 初始化搜索覆盖层
const tabulaSearchOverlay = new TabulaSearchOverlay(); 