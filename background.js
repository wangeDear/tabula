console.log('[BACKGROUND] Script loaded and running. This should be the very first log.');

// Tab Deck 后台服务脚本



// --- 调试：监控所有 sync 存储变化 ---
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    console.log('SYNC STORAGE CHANGED:');
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
      console.log(
        `  Key: "${key}" changed.`,
        `\n  Old value: `,
        oldValue,
        `\n  New value: `,
        newValue
      );
    }
  }
});

// --- Helper function to sanitize favicon URL ---
function sanitizeFavIconUrl(favIconUrl) {
    // 如果是 base64 编码的图标，使用默认图标
    if (favIconUrl && favIconUrl.startsWith('data:')) {
        console.log('[BACKGROUND] Replacing base64 favicon with default icon');
        return 'icons/icon16.png';
    }
    return favIconUrl || 'icons/icon16.png';
}

// --- Helper function to add a favorite to storage ---
async function addFavoriteToStorage(favorite) {
    console.log('[BACKGROUND] Received request to ADD favorite:', favorite);
    if (!favorite || !favorite.url || !favorite.title) {
        console.error('[BACKGROUND] Invalid favorite object received.', favorite);
        return;
    }
    
    // 处理 favIconUrl，将 base64 编码替换为默认图标
    const sanitizedFavIconUrl = sanitizeFavIconUrl(favorite.favIconUrl);
    console.log(`[BACKGROUND] Original favicon: ${favorite.favIconUrl ? (favorite.favIconUrl.startsWith('data:') ? 'base64 (' + favorite.favIconUrl.length + ' chars)' : favorite.favIconUrl) : 'none'}`);
    console.log(`[BACKGROUND] Sanitized favicon: ${sanitizedFavIconUrl}`);
    
    console.log('[BACKGROUND] Getting current favorites from sync storage...');
    const { favorites = [] } = await chrome.storage.sync.get('favorites');
    console.log('[BACKGROUND] Current favorites count:', favorites.length);

    if (!favorites.some(f => f.url === favorite.url)) {
      const newFavorite = { 
        title: favorite.title, 
        url: favorite.url, 
        favIconUrl: sanitizedFavIconUrl,
        addedAt: favorite.addedAt || new Date().toISOString()
      };
      
      const newFavorites = [newFavorite, ...favorites];
      console.log('[BACKGROUND] Preparing to SET new favorites list. New count:', newFavorites.length);
      await chrome.storage.sync.set({ favorites: newFavorites });
      console.log('[BACKGROUND] SET operation complete.');
      
      chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '已收藏',
          message: `已将 "${favorite.title}" 添加到收藏夹。`
      });
    } else {
        console.log('[BACKGROUND] Favorite already exists. No action taken.');
    }
}

// --- Helper function to remove a favorite from storage ---
async function removeFavoriteFromStorage(url) {
    console.log('[BACKGROUND] Received request to REMOVE favorite with URL:', url);
    if (!url) {
        console.error('[BACKGROUND] Invalid URL for removal received.');
        return;
    }

    console.log('[BACKGROUND] Getting current favorites from sync storage...');
    let { favorites = [] } = await chrome.storage.sync.get('favorites');
    console.log('[BACKGROUND] Current favorites count before removal:', favorites.length);

    const newFavorites = favorites.filter(f => f.url !== url);
    
    if (newFavorites.length < favorites.length) {
        console.log('[BACKGROUND] Preparing to SET new favorites list after removal. New count:', newFavorites.length);
        await chrome.storage.sync.set({ favorites: newFavorites });
        console.log('[BACKGROUND] SET operation complete after removal.');
    } else {
        console.log('[BACKGROUND] Favorite to remove not found. No action taken.');
    }
}

// --- Helper function to update favorite title in storage ---
async function updateFavoriteTitleInStorage(url, newTitle) {
    console.log('[BACKGROUND] Received request to UPDATE favorite title for URL:', url, 'New title:', newTitle);
    if (!url || !newTitle) {
        console.error('[BACKGROUND] Invalid URL or title for update received.');
        return;
    }

    console.log('[BACKGROUND] Getting current favorites from sync storage...');
    let { favorites = [] } = await chrome.storage.sync.get('favorites');
    console.log('[BACKGROUND] Current favorites count:', favorites.length);

    const favoriteIndex = favorites.findIndex(f => f.url === url);
    
    if (favoriteIndex !== -1) {
        console.log('[BACKGROUND] Found favorite to update at index:', favoriteIndex);
        favorites[favoriteIndex].title = newTitle;
        favorites[favoriteIndex].updatedAt = new Date().toISOString();
        
        await chrome.storage.sync.set({ favorites });
        console.log('[BACKGROUND] Favorite title updated successfully.');
        
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '标题已更新',
            message: `收藏项标题已更新为 "${newTitle}"`
        });
    } else {
        console.log('[BACKGROUND] Favorite to update not found. No action taken.');
    }
}

// --- 安装与初始化 ---
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Tab Deck 插件已安装');
  }
  // Create context menu item for adding to favorites
  chrome.contextMenus.create({
    id: "add-to-favorites",
    title: "收藏此页",
    contexts: ["page"]
  });
  // Create context menu item for editing favorite title
  chrome.contextMenus.create({
    id: "edit-favorite-title",
    title: "编辑收藏标题",
    contexts: ["page"],
    documentUrlPatterns: ["http://*/*", "https://*/*"]
  });
});

// --- Context Menu listener ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-to-favorites") {
    console.log('[BACKGROUND] Add to favorites triggered from context menu.');
    // 打开管理器并显示收藏弹窗
    await openManagerAndShowAddFavoriteModal(tab);
  } else if (info.menuItemId === "edit-favorite-title") {
    console.log('[BACKGROUND] Edit favorite title triggered from context menu for URL:', tab.url);
    // 使用chrome.storage.sync作为临时方案
    const { favorites = [] } = await chrome.storage.sync.get('favorites');
    const favorite = favorites.find(f => f.url === tab.url);

    if (favorite) {
      // Open manager.html and send message to trigger modal
      chrome.windows.create({
        url: chrome.runtime.getURL('manager.html'), // Open manager.html
        type: 'popup',
        height: 600,
        width: 800
      }, (win) => {
        // Wait for manager.html to load before sending message
        const listener = (tabId, changeInfo, tab) => {
          if (tabId === win.tabs[0].id && changeInfo.status === 'complete') {
            console.log('[BACKGROUND] Manager loaded. Sending edit message.');
            chrome.tabs.sendMessage(tabId, { action: 'showEditFavoriteModal', url: favorite.url });
            chrome.tabs.onUpdated.removeListener(listener);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    } else {
      console.log('[BACKGROUND] Current page is not a favorite. Cannot edit title.');
      chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '无法编辑',
          message: '当前页面未收藏，无法编辑标题。'
      });
    }
  }
});

// --- Message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[BACKGROUND] Received message:', request);
  (async () => {
    switch (request.action) {
      case 'openFavorite':
        const tabs = await chrome.tabs.query({ url: request.url });
        if (tabs.length > 0) {
          await chrome.tabs.update(tabs[0].id, { active: true });
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: request.url });
        }
        break;

      case 'addFavorite':
        await addFavoriteToStorage(request.favorite);
        break;

      case 'removeFavorite':
        await removeFavoriteFromStorage(request.url);
        break;

      case 'updateFavoriteTitle':
        await updateFavoriteTitleInStorage(request.url, request.title);
        break;
    }
  })();
  
  return true; // Keep message channel open for async operations
});


// --- 打开管理器并显示添加收藏弹窗 ---
async function openManagerAndShowAddFavoriteModal(tab) {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const tabs = await chrome.tabs.query({ url: managerUrl });

  if (tabs.length > 0) {
    // 管理器已打开，切换到该标签页并显示弹窗
    const managerTab = tabs[0];
    await chrome.tabs.update(managerTab.id, { active: true });
    await chrome.windows.update(managerTab.windowId, { focused: true });
    
    // 发送消息显示收藏弹窗
    chrome.tabs.sendMessage(managerTab.id, { 
      action: 'showAddFavoriteModal', 
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Could not send add favorite message, likely because the tab is still loading.');
      }
    });
  } else {
    // 管理器未打开，创建新标签页
    const managerTab = await chrome.tabs.create({
      url: managerUrl,
      active: true,
      pinned: true
    });
    await chrome.tabs.move(managerTab.id, { index: 0 });

    // 监听新创建的标签页，直到它完全加载后再发送消息
    const listener = (tabId, changeInfo, loadedTab) => {
      if (tabId === managerTab.id && changeInfo.status === 'complete') {
        console.log(`[BACKGROUND] Manager tab ${tabId} is complete. Sending add favorite message.`);
        chrome.tabs.sendMessage(tabId, { 
          action: 'showAddFavoriteModal', 
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        });
        // 清理监听器，避免内存泄漏
        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
}

// --- 核心功能：打开或切换到管理器 ---
async function openManager() {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const tabs = await chrome.tabs.query({ url: managerUrl });

  if (tabs.length > 0) {
    // 管理器已打开，切换到该标签页并聚焦
    const managerTab = tabs[0];
    await chrome.tabs.update(managerTab.id, { active: true });
    await chrome.windows.update(managerTab.windowId, { focused: true });
    // 即使标签页已存在，也最好等待它可能正在加载的内容完成
    chrome.tabs.sendMessage(managerTab.id, { action: 'focus-search' }, (response) => {
        if (chrome.runtime.lastError) {
            console.log('Could not send focus message, likely because the tab is still loading. This is acceptable.');
        }
    });
  } else {
    // 管理器未打开，创建新标签页
    const managerTab = await chrome.tabs.create({
      url: managerUrl,
      active: true,
      pinned: true
    });
    await chrome.tabs.move(managerTab.id, { index: 0 });

    // **FIX**: 监听新创建的标签页，直到它完全加载后再发送消息
    const listener = (tabId, changeInfo, tab) => {
      if (tabId === managerTab.id && changeInfo.status === 'complete') {
        console.log(`[BACKGROUND] Manager tab ${tabId} is complete. Sending focus message.`);
        chrome.tabs.sendMessage(tabId, { action: 'focus-search' });
        // 清理监听器，避免内存泄漏
        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
}

// --- 事件监听 ---

// 监听插件图标点击
chrome.action.onClicked.addListener(() => {
  openManager(); // Now opens manager.html
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-manager') {
    await openManager();
  }
  if (command === 'focus-search') {
    // 在当前标签页显示搜索覆盖层
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'show-search-overlay' });
      } catch (error) {
        console.error('[BACKGROUND] Failed to show search overlay:', error);
        // 如果内容脚本未注入，不做任何操作（不再回退到管理器页面）
        console.log('[BACKGROUND] Content script not available, search overlay not shown');
      }
    }
  }
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === 'get-all-tabs') {
        // 获取所有标签页
        const windows = await chrome.windows.getAll({ populate: true });
        const allTabs = windows.flatMap(win => 
          win.tabs.map(tab => ({ 
            ...tab, 
            windowId: win.id 
          }))
        );
        sendResponse(allTabs);
      } else if (request.action === 'get-favorites') {
        // 获取收藏夹
        console.log('[BACKGROUND] get-favorites request received');
        
        // 直接从chrome.storage.sync获取数据（简化版本）
        const result = await chrome.storage.sync.get(['favorites']);
        const favorites = result.favorites || [];
        console.log('[BACKGROUND] Returning sync storage favorites:', favorites.length, 'items');
        console.log('[BACKGROUND] Favorites data:', favorites);
        sendResponse(favorites);
      } else if (request.action === 'get-tab-metadata') {
        // 获取标签页元数据
        const result = await chrome.storage.local.get(['tabMetadata']);
        sendResponse(result.tabMetadata || {});
      } else if (request.action === 'switch-to-tab') {
        // 切换到指定标签页
        await chrome.tabs.update(request.tabId, { active: true });
        await chrome.windows.update(request.windowId, { focused: true });
        sendResponse({ success: true });
      } else if (request.action === 'open-favorite') {
        // 打开收藏夹项目
        // 首先检查是否有匹配的已打开标签页
        const windows = await chrome.windows.getAll({ populate: true });
        const allTabs = windows.flatMap(win => 
          win.tabs.map(tab => ({ 
            ...tab, 
            windowId: win.id 
          }))
        );
        
        const existingTab = allTabs.find(tab => tab.url === request.url);
        
        if (existingTab) {
          // 如果找到匹配的标签页，直接跳转
          await chrome.tabs.update(existingTab.id, { active: true });
          await chrome.windows.update(existingTab.windowId, { focused: true });
        } else {
          // 如果没有找到匹配的标签页，创建新标签页
          await chrome.tabs.create({ url: request.url });
        }
        
        sendResponse({ success: true });
      } else if (request.action === 'rename-tab') {
        // 重命名标签页
        const result = await chrome.storage.local.get(['tabMetadata']);
        const tabMetadata = result.tabMetadata || {};
        
        if (!tabMetadata[request.tabId]) {
          tabMetadata[request.tabId] = {};
        }
        tabMetadata[request.tabId].name = request.title;
        
        await chrome.storage.local.set({ tabMetadata });
        sendResponse({ success: true });
      } else if (request.action === 'add-favorite') {
        // 添加收藏 - 使用旧的chrome.storage.sync方法作为临时方案
        console.log('[BACKGROUND] add-favorite called - using chrome.storage.sync temporarily');
        const favorite = {
          title: request.title,
          url: request.url,
          favIconUrl: sanitizeFavIconUrl(request.favIconUrl),
          addedAt: new Date().toISOString()
        };
        
        await addFavoriteToStorage(favorite);
        sendResponse({ success: true });
      } else if (request.action === 'edit-favorite') {
        // 编辑收藏 - 使用旧方法作为临时方案
        console.log('[BACKGROUND] edit-favorite called - using chrome.storage.sync temporarily');
        await updateFavoriteTitleInStorage(request.url, request.title);
        sendResponse({ success: true });
      } else if (request.action === 'remove-favorite') {
        // 移除收藏 - 使用旧方法作为临时方案
        console.log('[BACKGROUND] remove-favorite called - using chrome.storage.sync temporarily');
        await removeFavoriteFromStorage(request.url);
        sendResponse({ success: true });
      } else if (request.action === 'close-tab') {
        // 关闭标签页
        await chrome.tabs.remove(request.tabId);
        sendResponse({ success: true });
      } else if (request.action === 'open-new-tab') {
        // 在新标签页打开
        await chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error('[BACKGROUND] Message handler error:', error);
      sendResponse({ error: error.message });
    }
  })();
  
  return true; // 保持消息通道开放以支持异步响应
});

// 监听标签页关闭事件，清理元数据（但保留收藏数据）
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get(['tabMetadata'], (result) => {
    const tabMetadata = result.tabMetadata || {};
    if (tabMetadata[tabId]) {
      // 只删除tabMetadata，收藏数据保存在独立的favorites数组中
      delete tabMetadata[tabId];
      chrome.storage.local.set({ tabMetadata });
    }
  });
});