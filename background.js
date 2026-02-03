let tabTimeData = {};
let currentActiveTab = null;
let lastUpdateTime = Date.now();

// Load data from storage on startup
chrome.storage.local.get(['tabTimeData'], (result) => {
  if (result.tabTimeData) {
    tabTimeData = result.tabTimeData;
  }
});

// Track active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  
  // Update time for previously active tab
  if (currentActiveTab !== null && currentActiveTab !== tabId) {
    updateTabTime(currentActiveTab);
  }
  
  currentActiveTab = tabId;
  lastUpdateTime = Date.now();
  
  // Get URL of newly active tab
  chrome.tabs.get(tabId, (tab) => {
    if (tab.url && isValidUrl(tab.url)) {
      const domain = new URL(tab.url).hostname;
      initializeTabData(domain);
    }
  });
});

// Track when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentActiveTab === tabId) {
    updateTabTime(tabId);
    currentActiveTab = null;
  }
});

// Update time for a tab before switching
function updateTabTime(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url && isValidUrl(tab.url)) {
      const domain = new URL(tab.url).hostname;
      const timeSpent = Math.floor((Date.now() - lastUpdateTime) / 1000); // in seconds
      
      if (domain) {
        if (!tabTimeData[domain]) {
          tabTimeData[domain] = { time: 0, url: tab.url, visits: 0 };
        }
        tabTimeData[domain].time += timeSpent;
        tabTimeData[domain].url = tab.url;
        
        // Save to storage
        chrome.storage.local.set({ tabTimeData });
      }
    }
  });
}

// Initialize data for a domain
function initializeTabData(domain) {
  if (!tabTimeData[domain]) {
    tabTimeData[domain] = { time: 0, url: '', visits: 1 };
  } else {
    tabTimeData[domain].visits = (tabTimeData[domain].visits || 0) + 1;
  }
}

// Check if URL is valid
function isValidUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

// Update active tab time every second
setInterval(() => {
  if (currentActiveTab !== null) {
    chrome.tabs.get(currentActiveTab, (tab) => {
      if (tab && tab.url && isValidUrl(tab.url)) {
        const domain = new URL(tab.url).hostname;
        const timeSpent = Math.floor((Date.now() - lastUpdateTime) / 1000);
        
        if (timeSpent > 0 && domain) {
          if (!tabTimeData[domain]) {
            tabTimeData[domain] = { time: 0, url: tab.url, visits: 0 };
          }
          tabTimeData[domain].time += timeSpent;
          
          // Save to storage
          chrome.storage.local.set({ tabTimeData });
        }
      }
      lastUpdateTime = Date.now();
    });
  }
}, 1000);

// Export function to get data (called by popup)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getData') {
    chrome.storage.local.get(['tabTimeData'], (result) => {
      sendResponse({ data: result.tabTimeData || {} });
    });
    return true;
  } else if (request.action === 'clearData') {
    tabTimeData = {};
    chrome.storage.local.set({ tabTimeData: {} });
    sendResponse({ success: true });
  }
});
