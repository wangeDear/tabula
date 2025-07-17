/**
 * 国际化管理器
 * 处理多语言支持和语言切换
 */
class I18nManager {
  constructor() {
    this.currentLanguage = 'zh-CN';
    this.supportedLanguages = ['zh-CN', 'en-US'];
    this.translations = {};
    this.initialized = false;
    
    // 绑定方法到实例
    this.t = this.t.bind(this);
    this.translate = this.translate.bind(this);
  }

  /**
   * 初始化国际化系统
   */
  async init() {
    try {
      // 从存储中获取用户的语言偏好
      const result = await chrome.storage.local.get(['language']);
      if (result.language && this.supportedLanguages.includes(result.language)) {
        this.currentLanguage = result.language;
      } else {
        // 检测浏览器语言
        const browserLang = this.detectBrowserLanguage();
        this.currentLanguage = browserLang;
      }

      // 加载语言文件
      await this.loadLanguageFiles();
      
      this.initialized = true;
      console.log('[I18N] Initialized with language:', this.currentLanguage);
      
      // 触发语言变更事件
      this.dispatchLanguageChangeEvent();
      
    } catch (error) {
      console.error('[I18N] Initialization failed:', error);
      // 回退到默认语言
      this.currentLanguage = 'zh-CN';
      await this.loadLanguageFiles();
      this.initialized = true;
    }
  }

  /**
   * 检测浏览器语言
   */
  detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage;
    
    // 精确匹配
    if (this.supportedLanguages.includes(browserLang)) {
      return browserLang;
    }
    
    // 模糊匹配（例如 en-GB -> en-US）
    const langCode = browserLang.split('-')[0];
    const matchedLang = this.supportedLanguages.find(lang => lang.startsWith(langCode));
    
    return matchedLang || 'zh-CN'; // 默认中文
  }

  /**
   * 加载语言文件
   */
  async loadLanguageFiles() {
    try {
      // 加载所有支持的语言
      for (const lang of this.supportedLanguages) {
        const response = await fetch(`locales/${lang}.json`);
        if (response.ok) {
          this.translations[lang] = await response.json();
        } else {
          console.warn(`[I18N] Failed to load language file: ${lang}`);
        }
      }
    } catch (error) {
      console.error('[I18N] Error loading language files:', error);
      // 使用内置的翻译作为后备
      this.loadFallbackTranslations();
    }
  }

  /**
   * 加载后备翻译（内置）
   */
  loadFallbackTranslations() {
    this.translations = {
      'zh-CN': {
        // 基础界面
        'app.title': 'Tabula',
        'app.description': '简洁高效的标签页管理器',
        
        // 导航
        'nav.current_session': '当前会话',
        'nav.favorites': '收藏夹',
        
        // 搜索
        'search.placeholder': '搜索标签页...',
        'search.favorites_placeholder': '搜索收藏夹...',
        
        // 标签页操作
        'tab.close': '关闭标签页',
        'tab.favorite': '收藏',
        'tab.unfavorite': '取消收藏',
        'tab.edit_title': '编辑标题',
        'tab.rename': '重命名',
        'tab.edit_tags': '编辑标签',
        
        // 收藏夹
        'favorites.add': '添加到收藏夹',
        'favorites.edit_title': '编辑收藏标题',
        'favorites.remove': '取消收藏',
        'favorites.open': '打开',
        'favorites.open_new_tab': '新标签页打开',
        'favorites.added_at': '收藏于',
        
        // 模态框
        'modal.confirm': '确认',
        'modal.cancel': '取消',
        'modal.save': '保存',
        'modal.close': '关闭',
        
        // 表单
        'form.title': '标题',
        'form.url': '网址',
        'form.new_title': '新标题',
        'form.favorite_title': '收藏标题',
        'form.tags': '标签',
        'form.tags_placeholder': '用逗号分隔标签',
        
        // 状态
        'status.loading': '加载中...',
        'status.saving': '保存中...',
        'status.syncing': '同步中...',
        'status.connecting': '连接中...',
        'status.connected': '已连接',
        'status.disconnected': '已断开',
        'status.offline': '网络离线',
        'status.server_unreachable': '服务器不可达',
        'status.checking': '检查中...',
        
        // 通知
        'notification.favorite_added': '已收藏',
        'notification.favorite_removed': '已取消收藏',
        'notification.title_updated': '标题更新成功',
        'notification.sync_success': '同步成功',
        'notification.sync_failed': '同步失败',
        'notification.connection_success': '连接测试成功',
        'notification.connection_failed': '连接测试失败',
        'notification.jumped_to_tab': '已跳转到已打开的标签页',
        'notification.opened_new_tab': '已在新标签页中打开',
        
        // 空状态
        'empty.no_windows': '没有打开的窗口',
        'empty.no_favorites': '没有收藏的标签页',
        'empty.loading_tabs': '正在加载标签页数据...',
        'empty.no_displayable_windows': '没有找到可显示的窗口',
        'empty.render_error': '渲染窗口时出错，请刷新页面重试',
        'empty.init_failed': '初始化失败',
        'empty.reload': '重新加载',
        'empty.cannot_get_tabs': '无法获取标签页数据',
        
        // 同步状态
        'sync.title': '同步状态',
        'sync.connection_status': '连接状态',
        'sync.user_id': '用户ID',
        'sync.pending_operations': '待同步操作',
        'sync.local_favorites': '本地收藏数',
        'sync.last_sync': '最后同步时间',
        'sync.never_synced': '未同步',
        'sync.force_sync': '强制同步',
        'sync.test_connection': '测试连接',
        'sync.user_id_hint': '用户ID用于同步数据，支持字母、数字、下划线和连字符，长度3-32字符',
        'sync.edit_user_id': '编辑用户ID',
        'sync.generate_user_id': '生成新用户ID',
        'sync.save_user_id': '保存用户ID',
        'sync.cancel_edit': '取消编辑',
        
        // 用户ID相关
        'user_id.empty_error': '用户ID不能为空',
        'user_id.format_error': '用户ID格式不正确。只能包含字母、数字、下划线和连字符，长度3-32字符。',
        'user_id.updated': '用户ID已更新，正在重新同步数据...',
        'user_id.unchanged': '用户ID未更改',
        'user_id.save_failed': '保存失败',
        'user_id.sync_completed': '数据同步完成',
        'user_id.sync_failed': '重新同步失败',
        
        // 窗口和计数
        'window.title': '窗口',
        'window.tabs_count': '个标签页',
        'count.tabs': '个标签页',
        'count.favorites': '个收藏',
        
        // 设置
        'settings.theme': '主题',
        'settings.language': '语言',
        'settings.sync_status': '同步状态',
        
        // 语言选项
        'language.zh-CN': '中文',
        'language.en-US': 'English',
        
        // 错误消息
        'error.init_failed': '初始化失败',
        'error.permission_failed': '权限检查失败',
        'error.tabs_permission': '缺少标签页访问权限',
        'error.windows_permission': '缺少窗口访问权限',
        'error.page_structure': '页面结构不完整，缺少元素',
        'error.get_tabs_failed': '获取标签页数据失败',
        'error.add_favorite_failed': '添加收藏失败',
        'error.remove_favorite_failed': '删除收藏失败',
        'error.update_title_failed': '更新标题失败',
        
        // 加载状态
        'loading.starting': '正在启动',
        'loading.local_data': '正在加载本地数据',
        'loading.syncing_favorites': '正在同步收藏夹',
        'loading.getting_tabs': '正在获取标签页信息',
        'loading.processing': '处理中...',
        'loading.saving_user_id': '正在保存用户ID...',
        'loading.adding_favorite': '正在添加收藏...',
        'loading.removing_favorite': '正在删除收藏...',
        'loading.updating_title': '正在更新标题...'
      },
      
      'en-US': {
        // 基础界面
        'app.title': 'Tabula',
        'app.description': 'Efficient Tab Manager',
        
        // 导航
        'nav.current_session': 'Current Session',
        'nav.favorites': 'Favorites',
        
        // 搜索
        'search.placeholder': 'Search tabs...',
        'search.favorites_placeholder': 'Search favorites...',
        
        // 标签页操作
        'tab.close': 'Close Tab',
        'tab.favorite': 'Favorite',
        'tab.unfavorite': 'Unfavorite',
        'tab.edit_title': 'Edit Title',
        'tab.rename': 'Rename',
        'tab.edit_tags': 'Edit Tags',
        
        // 收藏夹
        'favorites.add': 'Add to Favorites',
        'favorites.edit_title': 'Edit Favorite Title',
        'favorites.remove': 'Remove Favorite',
        'favorites.open': 'Open',
        'favorites.open_new_tab': 'Open in New Tab',
        'favorites.added_at': 'Added on',
        
        // 模态框
        'modal.confirm': 'Confirm',
        'modal.cancel': 'Cancel',
        'modal.save': 'Save',
        'modal.close': 'Close',
        
        // 表单
        'form.title': 'Title',
        'form.url': 'URL',
        'form.new_title': 'New Title',
        'form.favorite_title': 'Favorite Title',
        'form.tags': 'Tags',
        'form.tags_placeholder': 'Separate tags with commas',
        
        // 状态
        'status.loading': 'Loading...',
        'status.saving': 'Saving...',
        'status.syncing': 'Syncing...',
        'status.connecting': 'Connecting...',
        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.offline': 'Network Offline',
        'status.server_unreachable': 'Server Unreachable',
        'status.checking': 'Checking...',
        
        // 通知
        'notification.favorite_added': 'Favorited',
        'notification.favorite_removed': 'Unfavorited',
        'notification.title_updated': 'Title Updated Successfully',
        'notification.sync_success': 'Sync Successful',
        'notification.sync_failed': 'Sync Failed',
        'notification.connection_success': 'Connection Test Successful',
        'notification.connection_failed': 'Connection Test Failed',
        'notification.jumped_to_tab': 'Jumped to Existing Tab',
        'notification.opened_new_tab': 'Opened in New Tab',
        
        // 空状态
        'empty.no_windows': 'No Open Windows',
        'empty.no_favorites': 'No Favorite Tabs',
        'empty.loading_tabs': 'Loading Tab Data...',
        'empty.no_displayable_windows': 'No Displayable Windows Found',
        'empty.render_error': 'Render Error, Please Refresh',
        'empty.init_failed': 'Initialization Failed',
        'empty.reload': 'Reload',
        'empty.cannot_get_tabs': 'Cannot Get Tab Data',
        
        // 同步状态
        'sync.title': 'Sync Status',
        'sync.connection_status': 'Connection Status',
        'sync.user_id': 'User ID',
        'sync.pending_operations': 'Pending Operations',
        'sync.local_favorites': 'Local Favorites',
        'sync.last_sync': 'Last Sync Time',
        'sync.never_synced': 'Never Synced',
        'sync.force_sync': 'Force Sync',
        'sync.test_connection': 'Test Connection',
        'sync.user_id_hint': 'User ID is used for data sync. Supports letters, numbers, underscores and hyphens, 3-32 characters long',
        'sync.edit_user_id': 'Edit User ID',
        'sync.generate_user_id': 'Generate New User ID',
        'sync.save_user_id': 'Save User ID',
        'sync.cancel_edit': 'Cancel Edit',
        
        // 用户ID相关
        'user_id.empty_error': 'User ID cannot be empty',
        'user_id.format_error': 'Invalid User ID format. Only letters, numbers, underscores and hyphens allowed, 3-32 characters long.',
        'user_id.updated': 'User ID updated, re-syncing data...',
        'user_id.unchanged': 'User ID unchanged',
        'user_id.save_failed': 'Save failed',
        'user_id.sync_completed': 'Data sync completed',
        'user_id.sync_failed': 'Re-sync failed',
        
        // 窗口和计数
        'window.title': 'Window',
        'window.tabs_count': 'tabs',
        'count.tabs': 'tabs',
        'count.favorites': 'favorites',
        
        // 设置
        'settings.theme': 'Theme',
        'settings.language': 'Language',
        'settings.sync_status': 'Sync Status',
        
        // 语言选项
        'language.zh-CN': '中文',
        'language.en-US': 'English',
        
        // 错误消息
        'error.init_failed': 'Initialization failed',
        'error.permission_failed': 'Permission check failed',
        'error.tabs_permission': 'Missing tab access permission',
        'error.windows_permission': 'Missing window access permission',
        'error.page_structure': 'Incomplete page structure, missing elements',
        'error.get_tabs_failed': 'Failed to get tab data',
        'error.add_favorite_failed': 'Failed to add favorite',
        'error.remove_favorite_failed': 'Failed to remove favorite',
        'error.update_title_failed': 'Failed to update title',
        
        // 加载状态
        'loading.starting': 'Starting...',
        'loading.local_data': 'Loading Local Data...',
        'loading.syncing_favorites': 'Syncing Favorites...',
        'loading.getting_tabs': 'Getting Tab Information...',
        'loading.processing': 'Processing...',
        'loading.saving_user_id': 'Saving User ID...',
        'loading.adding_favorite': 'Adding Favorite...',
        'loading.removing_favorite': 'Removing Favorite...',
        'loading.updating_title': 'Updating Title...'
      }
    };
  }

  /**
   * 翻译文本
   */
  t(key, params = {}) {
    return this.translate(key, params);
  }

  /**
   * 翻译文本（完整方法）
   */
  translate(key, params = {}) {
    if (!this.initialized) {
      console.warn('[I18N] Not initialized yet, returning key:', key);
      return key;
    }

    const translation = this.translations[this.currentLanguage]?.[key] || 
                       this.translations['zh-CN']?.[key] || 
                       key;

    // 处理参数替换
    return this.interpolate(translation, params);
  }

  /**
   * 参数插值
   */
  interpolate(text, params) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, param) => {
      return params[param] !== undefined ? params[param] : match;
    });
  }

  /**
   * 切换语言
   */
  async switchLanguage(language) {
    if (!this.supportedLanguages.includes(language)) {
      console.warn('[I18N] Unsupported language:', language);
      return false;
    }

    if (this.currentLanguage === language) {
      return false; // 没有变化
    }

    const oldLanguage = this.currentLanguage;
    this.currentLanguage = language;

    try {
      // 保存到存储
      await chrome.storage.local.set({ language });
      
      console.log('[I18N] Language switched from', oldLanguage, 'to', language);
      
      // 触发语言变更事件
      this.dispatchLanguageChangeEvent();
      
      return true;
    } catch (error) {
      console.error('[I18N] Failed to save language preference:', error);
      // 回滚
      this.currentLanguage = oldLanguage;
      return false;
    }
  }

  /**
   * 获取当前语言
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages() {
    return this.supportedLanguages;
  }

  /**
   * 触发语言变更事件
   */
  dispatchLanguageChangeEvent() {
    const event = new CustomEvent('languageChanged', {
      detail: {
        language: this.currentLanguage,
        translations: this.translations[this.currentLanguage]
      }
    });
    document.dispatchEvent(event);
  }

  /**
   * 翻译DOM元素
   */
  translateElement(element) {
    // 翻译文本内容
    const textKey = element.getAttribute('data-i18n');
    if (textKey) {
      element.textContent = this.t(textKey);
    }

    // 翻译属性
    const attrKeys = element.getAttribute('data-i18n-attr');
    if (attrKeys) {
      const attrs = attrKeys.split(',');
      attrs.forEach(attr => {
        const [attrName, key] = attr.split(':');
        if (key) {
          element.setAttribute(attrName, this.t(key));
        }
      });
    }

    // 翻译占位符
    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    if (placeholderKey) {
      element.placeholder = this.t(placeholderKey);
    }
  }

  /**
   * 翻译整个页面
   */
  translatePage() {
    // 翻译所有带有 data-i18n 属性的元素
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => this.translateElement(element));

    // 翻译所有带有 data-i18n-placeholder 属性的元素
    const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderElements.forEach(element => this.translateElement(element));

    // 翻译所有带有 data-i18n-attr 属性的元素
    const attrElements = document.querySelectorAll('[data-i18n-attr]');
    attrElements.forEach(element => this.translateElement(element));
  }
}

// 创建全局实例
const i18nManager = new I18nManager();

// 全局翻译函数
window.t = i18nManager.t;
window.i18n = i18nManager;

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = i18nManager;
} 