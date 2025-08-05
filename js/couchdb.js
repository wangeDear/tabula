/**
 * CouchDB集成模块
 * 处理收藏夹数据的远程同步
 */

class CouchDBManager {
  constructor() {
    this.config = {
      url: 'http://172.245.53.104:5984/tabula',
      auth: 'Basic dGFidWxhOnRhYnVsYTEyMzQ1Ng==', // tabula:tabula123456
      headers: {
        'Authorization': 'Basic dGFidWxhOnRhYnVsYTEyMzQ1Ng==',
        'Content-Type': 'application/json'
      }
    };
    this.isOnline = true; // 默认认为在线，通过实际请求来检测
    this.isConnected = false; // 实际连接状态
    this.pendingOperations = [];
    this.initialized = false;
    this.lastSyncTime = null;
    
    // 监听网络状态变化（仅作为提示，不完全依赖）
    window.addEventListener('online', () => {
      console.log('[COUCHDB] Browser reports online, checking connection...');
      this.checkConnection();
      this.processPendingOperations();
    });
    
    window.addEventListener('offline', () => {
      console.log('[COUCHDB] Browser reports offline');
      // 不立即设置 isConnected = false，因为 navigator.onLine 不准确
      // 让实际的连接检测来决定状态
    });
    
    // 初始化数据库
    this.initializeDatabase();
    
    // 定期检查连接状态
    setInterval(() => {
      this.checkConnection();
    }, 30000); // 每30秒检查一次
  }

  /**
   * 检查CouchDB连接状态
   */
  async checkConnection() {
    try {
      console.log('[COUCHDB] Testing connection to:', this.config.url);
      
      // 使用AbortController实现超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 增加到8秒超时
      
      // 使用简单的GET请求检查连接
      const response = await fetch(this.config.url, {
        method: 'GET',
        headers: this.config.headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      this.isConnected = response.ok;
      this.isOnline = true; // 如果能发起请求说明网络是通的
      
      console.log('[COUCHDB] Connection test result:', this.isConnected, 'Status:', response.status);
      return this.isConnected;
    } catch (error) {
      console.log('[COUCHDB] Connection check failed:', error.message);
      
      // 判断是网络问题还是服务器问题
      if (error.name === 'AbortError') {
        console.log('[COUCHDB] Request timed out');
        this.isOnline = false;
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        console.log('[COUCHDB] Network error detected');
        this.isOnline = false;
      } else {
        console.log('[COUCHDB] Server error, but network seems ok');
        this.isOnline = true;
      }
      
      this.isConnected = false;
      return false;
    }
  }

  /**
   * 初始化数据库和视图
   */
  async initializeDatabase() {
    console.log('[COUCHDB] Initializing database...');
    
    // 直接检查连接，不依赖 isOnline
    const connected = await this.checkConnection();
    if (!connected) {
      console.log('[COUCHDB] Cannot connect to database, skipping initialization');
      return;
    }
    
    try {
      // 检查并创建设计文档
      const designDoc = {
        _id: '_design/favorites',
        views: {
          by_user: {
            map: `function(doc) {
              if (doc.type === 'favorite') {
                emit(doc.owner, {
                  title: doc.title,
                  url: doc.url,
                  favIconUrl: doc.favIconUrl,
                  owner: doc.owner,
                  addedAt: doc.addedAt,
                  updatedAt: doc.updatedAt
                });
              }
            }`
          },
          by_url: {
            map: `function(doc) {
              if (doc.type === 'favorite') {
                emit(doc.url, {
                  title: doc.title,
                  url: doc.url,
                  favIconUrl: doc.favIconUrl,
                  owner: doc.owner,
                  addedAt: doc.addedAt,
                  updatedAt: doc.updatedAt
                });
              }
            }`
          }
        }
      };
      
      try {
        // 尝试获取现有设计文档
        const existingDesign = await this.request('GET', '_design/favorites');
        
        // 更新设计文档
        const updatedDesign = {
          ...designDoc,
          _rev: existingDesign._rev
        };
        
        await this.request('PUT', '_design/favorites', updatedDesign);
        console.log('[COUCHDB] Design document updated successfully');
      } catch (error) {
        if (error.message.includes('404')) {
          // 设计文档不存在，创建新的
          await this.request('PUT', '_design/favorites', designDoc);
          console.log('[COUCHDB] Design document created successfully');
        } else {
          throw error;
        }
      }
      
      this.initialized = true;
      console.log('[COUCHDB] Database initialized successfully');
    } catch (error) {
      console.error('[COUCHDB] Database initialization failed:', error);
      this.isConnected = false;
    }
  }

  /**
   * 获取用户标识符
   */
  async getUserId() {
    // 使用Chrome的同步存储来获取用户标识
    const result = await chrome.storage.sync.get(['userId']);
    if (result.userId && this.validateUserId(result.userId)) {
      return result.userId;
    }
    
    // 如果没有用户ID或ID格式无效，生成一个新的友好ID
    console.log('[COUCHDB] Generating new user ID...');
    const userId = this.generateUserId();
    await chrome.storage.sync.set({ userId });
    console.log('[COUCHDB] Generated user ID:', userId);
    return userId;
  }

  /**
   * 生成友好的用户ID
   */
  generateUserId() {
    // 生成更可读的用户ID格式：用户名风格 + 时间戳后缀
    const adjectives = ['Quick', 'Smart', 'Bright', 'Cool', 'Fast', 'Nice', 'Super', 'Great', 'Happy', 'Lucky'];
    const nouns = ['User', 'Tab', 'Browser', 'Star', 'Wave', 'Code', 'Link', 'Page', 'Book', 'Tree'];
    
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const timestamp = Date.now().toString().slice(-6); // 取时间戳后6位
    
    return `${adjective}${noun}${timestamp}`;
  }

  /**
   * 设置用户ID
   */
  async setUserId(newUserId) {
    // 验证用户ID格式
    if (!this.validateUserId(newUserId)) {
      throw new Error('用户ID格式不正确。只能包含字母、数字、下划线和连字符，长度3-32字符。');
    }
    
    // 检查是否与当前用户ID相同
    const currentUserId = await this.getUserId();
    if (currentUserId === newUserId) {
      return false; // 没有变化
    }
    
    // 保存新的用户ID
    await chrome.storage.sync.set({ userId: newUserId });
    
    console.log('[COUCHDB] User ID changed from', currentUserId, 'to', newUserId);
    return true; // 有变化
  }

  /**
   * 验证用户ID格式
   */
  validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
      return false;
    }
    
    // 用户ID规则：3-32字符，只能包含字母、数字、下划线和连字符
    const regex = /^[a-zA-Z0-9_-]{3,32}$/;
    return regex.test(userId);
  }

  /**
   * 发送HTTP请求到CouchDB
   */
  async request(method, endpoint = '', data = null) {
    const url = endpoint ? `${this.config.url}/${endpoint}` : this.config.url;
    console.log('[COUCHDB] Making request:', method, url);
    
    const options = {
      method,
      headers: {
        ...this.config.headers,
        'Content-Type': 'application/json; charset=utf-8'
      }
    };
    
    if (data) {
      // 确保JSON序列化时使用UTF-8编码
      try {
        options.body = JSON.stringify(data, null, 0);
      } catch (jsonError) {
        console.error('[COUCHDB] JSON serialization failed:', jsonError);
        throw new Error(`JSON序列化失败: ${jsonError.message}`);
      }
    }
    
    try {
      const response = await fetch(url, options);
      console.log('[COUCHDB] Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[COUCHDB] Request failed with response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('[COUCHDB] Response data:', result);
      return result;
    } catch (error) {
      console.error('[COUCHDB] Request failed:', error);
      throw error;
    }
  }

  /**
   * 获取用户的所有收藏夹
   */
  async getFavorites(userId) {
    // 不检查 isOnline，直接尝试请求
    
    try {
      // 使用CouchDB的视图查询特定用户的收藏夹，正确编码用户ID
      const encodedUserId = encodeURIComponent(JSON.stringify(userId));
      const endpoint = `_design/favorites/_view/by_user?key=${encodedUserId}`;
      console.log('[COUCHDB] Requesting favorites from endpoint:', endpoint);
      
      const response = await this.request('GET', endpoint);
      console.log('[COUCHDB] Raw response:', response);
      
      const favorites = response.rows.map(row => ({
        id: row.id,
        ...row.value
      }));
      
      console.log('[COUCHDB] Parsed favorites:', favorites);
      return favorites;
    } catch (error) {
      console.error('[COUCHDB] Failed to get favorites:', error);
      return [];
    }
  }

  /**
   * 添加收藏夹
   */
  async addFavorite(favorite) {
    const userId = await this.getUserId();
    
    // 清理和验证数据
    const sanitizedTitle = String(favorite.title || '').trim();
    const sanitizedUrl = String(favorite.url || '').trim();
    
    if (!sanitizedTitle || !sanitizedUrl) {
      throw new Error('标题和URL不能为空');
    }
    
    const doc = {
      type: 'favorite',
      title: sanitizedTitle,
      url: sanitizedUrl,
      favIconUrl: favorite.favIconUrl || 'icons/icon16.png',
      owner: userId,
      addedAt: favorite.addedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 不依赖 isOnline 判断，直接尝试请求
    
    try {
      const response = await this.request('POST', '', doc);
      return { success: true, id: response.id, rev: response.rev };
    } catch (error) {
      console.error('[COUCHDB] Failed to add favorite:', error);
      // 添加到待处理队列
      this.pendingOperations.push({
        type: 'add',
        data: doc
      });
      throw error;
    }
  }

  /**
   * 更新收藏夹
   * @param {string} id - 文档ID
   * @param {Object} updates - 更新的字段
   * @param {string} [cachedRev] - 缓存的revision，如果提供则跳过GET请求
   * @param {Object} [cachedDoc] - 缓存的完整文档，如果提供则跳过GET请求
   */
  async updateFavorite(id, updates, cachedRev = null, cachedDoc = null) {
    // 清理更新数据
    const sanitizedUpdates = {};
    if (updates.title !== undefined) {
      sanitizedUpdates.title = String(updates.title).trim();
      if (!sanitizedUpdates.title) {
        throw new Error('标题不能为空');
      }
    }
    if (updates.url !== undefined) {
      sanitizedUpdates.url = String(updates.url).trim();
      if (!sanitizedUpdates.url) {
        throw new Error('URL不能为空');
      }
    }
    if (updates.favIconUrl !== undefined) {
      sanitizedUpdates.favIconUrl = updates.favIconUrl;
    }
    
    // 不依赖 isOnline 判断，直接尝试请求
    
    try {
      let existingDoc;
      
      if (cachedDoc && cachedDoc._rev) {
        // 使用缓存的完整文档，先尝试直接更新
        try {
          const updatedDoc = {
            ...cachedDoc,
            ...sanitizedUpdates,
            updatedAt: new Date().toISOString()
          };
          
          const response = await this.request('PUT', id, updatedDoc);
          return { success: true, id: response.id, rev: response.rev };
        } catch (error) {
          if (error.message && error.message.includes('409')) {
            // 文档冲突，缓存的文档过期，回退到GET请求
            console.log('[COUCHDB] Cached document outdated, falling back to GET request');
          } else {
            throw error;
          }
        }
      } else if (cachedRev) {
        // 只有缓存的revision，需要先获取文档验证
        try {
          const currentDoc = await this.request('GET', id);
          
          if (currentDoc._rev === cachedRev) {
            // revision匹配，可以直接更新
            const updatedDoc = {
              ...currentDoc,
              ...sanitizedUpdates,
              updatedAt: new Date().toISOString()
            };
            
            const response = await this.request('PUT', id, updatedDoc);
            return { success: true, id: response.id, rev: response.rev };
          } else {
            // revision不匹配，使用最新的文档
            console.log('[COUCHDB] Cached revision outdated, using latest document');
            existingDoc = currentDoc;
          }
        } catch (error) {
          console.error('[COUCHDB] Error using cached revision:', error);
          // 继续执行下面的常规GET请求
        }
      }
      
      // 获取现有文档（如果没有缓存或缓存过期）
      if (!existingDoc) {
        existingDoc = await this.request('GET', id);
      }
      
      const updatedDoc = {
        ...existingDoc,
        ...sanitizedUpdates,
        updatedAt: new Date().toISOString()
      };
      
      const response = await this.request('PUT', id, updatedDoc);
      return { success: true, id: response.id, rev: response.rev };
    } catch (error) {
      console.error('[COUCHDB] Failed to update favorite:', error);
      this.pendingOperations.push({
        type: 'update',
        id: id,
        data: sanitizedUpdates
      });
      throw error;
    }
  }

  /**
   * 删除收藏夹
   */
  async deleteFavorite(id) {
    // 不依赖 isOnline 判断，直接尝试请求
    
    try {
      // 先获取文档以获得rev
      const doc = await this.request('GET', id);
      const response = await this.request('DELETE', `${id}?rev=${doc._rev}`);
      return { success: true, id: response.id, rev: response.rev };
    } catch (error) {
      console.error('[COUCHDB] Failed to delete favorite:', error);
      this.pendingOperations.push({
        type: 'delete',
        id: id
      });
      throw error;
    }
  }

  /**
   * 根据URL查找收藏夹
   */
  async findFavoriteByUrl(url) {
    const userId = await this.getUserId();
    
    // 不依赖 isOnline 判断，直接尝试请求
    
    try {
      // 使用CouchDB的视图查询，正确编码URL
      const encodedUrl = encodeURIComponent(JSON.stringify(url));
      const response = await this.request('GET', `_design/favorites/_view/by_url?key=${encodedUrl}`);
      
      const userFavorites = response.rows.filter(row => row.value.owner === userId);
      return userFavorites.length > 0 ? { id: userFavorites[0].id, ...userFavorites[0].value } : null;
    } catch (error) {
      console.error('[COUCHDB] Failed to find favorite by URL:', error);
      return null;
    }
  }

  /**
   * 处理待处理的操作（当重新上线时）
   */
  async processPendingOperations() {
    if (this.pendingOperations.length === 0) {
      return;
    }
    
    // 先检查连接状态
    const connected = await this.checkConnection();
    if (!connected) {
      console.log('[COUCHDB] Not connected, cannot process pending operations');
      return;
    }
    
    console.log('[COUCHDB] Processing pending operations:', this.pendingOperations.length);
    
    const operations = [...this.pendingOperations];
    this.pendingOperations = [];
    
    for (const operation of operations) {
      try {
        switch (operation.type) {
          case 'add':
            await this.request('POST', '', operation.data);
            break;
          case 'update':
            const existingDoc = await this.request('GET', operation.id);
            const updatedDoc = {
              ...existingDoc,
              ...operation.data,
              updatedAt: new Date().toISOString()
            };
            await this.request('PUT', operation.id, updatedDoc);
            break;
          case 'delete':
            const doc = await this.request('GET', operation.id);
            await this.request('DELETE', `${operation.id}?rev=${doc._rev}`);
            break;
        }
      } catch (error) {
        console.error('[COUCHDB] Failed to process pending operation:', error);
        // 重新添加到待处理队列
        this.pendingOperations.push(operation);
      }
    }
  }

  /**
   * 同步本地收藏夹到CouchDB
   */
  async syncFavorites(localFavorites) {
    console.log('[COUCHDB] Starting sync with', localFavorites.length, 'local favorites');
    
    // 先检查连接状态
    const connected = await this.checkConnection();
    if (!connected) {
      console.log('[COUCHDB] Not connected, skipping sync');
      throw new Error('无法连接到CouchDB服务器');
    }
    
    try {
      const userId = await this.getUserId();
      console.log('[COUCHDB] Getting remote favorites for user:', userId);
      const remoteFavorites = await this.getFavorites(userId);
      console.log('[COUCHDB] Found', remoteFavorites.length, 'remote favorites');
      
      // 创建URL到远程收藏夹的映射
      const remoteMap = new Map();
      remoteFavorites.forEach(fav => {
        remoteMap.set(fav.url, fav);
      });
      
      // 同步本地收藏夹到远程
      console.log('[COUCHDB] Syncing local favorites to remote...');
      for (const localFav of localFavorites) {
        const remoteFav = remoteMap.get(localFav.url);
        
        if (!remoteFav) {
          // 本地有但远程没有，添加到远程
          console.log('[COUCHDB] Adding new favorite to remote:', localFav.title);
          await this.addFavorite(localFav);
        } else {
          // 检查是否需要更新
          const localUpdated = new Date(localFav.updatedAt || localFav.addedAt);
          const remoteUpdated = new Date(remoteFav.updatedAt || remoteFav.addedAt);
          
          if (localUpdated > remoteUpdated) {
            // 本地更新，更新远程
            console.log('[COUCHDB] Updating remote favorite:', localFav.title);
            await this.updateFavorite(remoteFav.id, {
              title: localFav.title,
              favIconUrl: localFav.favIconUrl
            });
          }
        }
      }
      
      // 获取最新的远程数据
      console.log('[COUCHDB] Getting final synced favorites...');
      const syncedFavorites = await this.getFavorites(userId);
      console.log('[COUCHDB] Final sync result:', syncedFavorites.length, 'favorites');
      
      // 记录同步时间
      this.lastSyncTime = new Date().toISOString();
      console.log('[COUCHDB] Sync completed at:', this.lastSyncTime);
      
      // 转换为本地格式，包含CouchDB的文档信息
      return syncedFavorites.map(fav => ({
        title: fav.title,
        url: fav.url,
        favIconUrl: fav.favIconUrl,
        addedAt: fav.addedAt,
        updatedAt: fav.updatedAt,
        _couchdb_id: fav.id, // 缓存CouchDB文档ID
        _couchdb_rev: fav.rev, // 缓存revision，用于更新
        _couchdb_doc: { // 缓存完整的CouchDB文档，用于快速更新
          _id: fav.id,
          _rev: fav.rev,
          type: fav.type,
          title: fav.title,
          url: fav.url,
          favIconUrl: fav.favIconUrl,
          owner: fav.owner,
          addedAt: fav.addedAt,
          updatedAt: fav.updatedAt
        }
      }));
      
    } catch (error) {
      console.error('[COUCHDB] Sync failed:', error);
      return localFavorites; // 返回本地数据
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      isOnline: this.isOnline, // 网络连通性（基于实际请求结果）
      isConnected: this.isConnected, // CouchDB服务器连接状态
      pendingOperations: this.pendingOperations.length,
      lastSyncTime: this.lastSyncTime,
      config: {
        url: this.config.url
      },
      // 添加更详细的状态说明
      statusText: this.isConnected ? '已连接' : (this.isOnline ? '服务器不可达' : '网络离线')
    };
  }
}

// 导出单例实例
const couchDBManager = new CouchDBManager(); 