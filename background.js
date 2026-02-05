let tabTimeData = {};
let currentActiveTab = null;
let lastUpdateTime = Date.now();

const STORAGE_KEYS = {
  tabTimeData: 'tabTimeData',
  lastResetDay: 'lastResetDay',
  siteLimits: 'siteLimits'
};

function normalizeUrlPrefix(rawUrl) {
  // Mirror popup normalization: include origin + pathname (trim trailing slash) + query; drop hash.
  const u = new URL(rawUrl);
  const origin = u.origin;
  const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
  const query = u.search || '';
  return `${origin}${path}${query}`;
}

function getLimitMatchesForUrl(url, limits) {
  const u = new URL(url);
  const hostname = u.hostname.replace(/^www\./i, '');
  const normalizedPrefix = normalizeUrlPrefix(url);

  const matches = [];
  const exceededDomainMatches = [];
  for (const l of limits) {
    if (!l || !l.scope || !l.value) continue;
    if (l.scope === 'domain') {
      if (hostname === String(l.value)) matches.push({ limit: l, specificity: 1 });
      if (hostname === String(l.value) && l.exceededAt) exceededDomainMatches.push(l);
    } else if (l.scope === 'urlPrefix') {
      const v = String(l.value);
      if (normalizedPrefix.startsWith(v)) matches.push({ limit: l, specificity: 1000 + v.length });
      if (hostname === String(l.domain) && l.exceededAt) exceededDomainMatches.push(l);
    }
  }
  // If any exceeded limit exists for this domain, enforce it regardless of path (block whole site).
  if (exceededDomainMatches.length) {
    // prefer the most recently exceeded
    exceededDomainMatches.sort((a, b) => (b.exceededAt || 0) - (a.exceededAt || 0));
    return exceededDomainMatches[0];
  }
  // Most specific wins (URL prefix length > domain)
  matches.sort((a, b) => b.specificity - a.specificity);
  return matches.length ? matches[0].limit : null;
}

function shouldSuppressLimit(limit) {
  const until = typeof limit.snoozedUntil === 'number' ? limit.snoozedUntil : 0;
  return until && Date.now() < until;
}

function maybeNotifyLimitReached(limit, currentUrl, timeSeconds) {
  if (!limit) return;
  if (!Number.isFinite(limit.limitSeconds) || limit.limitSeconds <= 0) return;
  if (timeSeconds < limit.limitSeconds) return;
  if (shouldSuppressLimit(limit)) return;

  // Avoid spamming notifications every second.
  const now = Date.now();
  const lastNotifiedAt = typeof limit.lastNotifiedAt === 'number' ? limit.lastNotifiedAt : 0;
  const exceeded = Boolean(limit.exceededAt);
  if (!exceeded && now - lastNotifiedAt < 60 * 1000) return; // cooldown only before exceeded

  const title = 'Time limit reached';
  const message = `${limit.display || limit.domain || limit.value}\nLimit: ${Math.floor(limit.limitSeconds / 60)} min · Today: ${Math.floor(timeSeconds / 60)} min`;

  const buttons = [];
  if (limit.snoozeEnabled && limit.snoozeMinutes > 0) {
    buttons.push({ title: `Snooze ${limit.snoozeMinutes}m` });
  }
  buttons.push({ title: 'Dismiss' });

  const notificationId = `limit:${limit.id}`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'images/icon128.png',
    title,
    message,
    priority: 2,
    buttons
  });

  // Persist lastNotifiedAt so we don't re-notify immediately after service worker restarts.
  chrome.storage.local.get([STORAGE_KEYS.siteLimits], (result) => {
    const limits = Array.isArray(result.siteLimits) ? result.siteLimits : [];
    const next = limits.map((l) => {
      if (l && l.id === limit.id) return { ...l, lastNotifiedAt: now, exceededAt: l.exceededAt || now };
      return l;
    });
    chrome.storage.local.set({ [STORAGE_KEYS.siteLimits]: next });
  });
}

function maybeShowOverlay(limit, tabId, timeSeconds) {
  if (!limit) return;
  if (!Number.isFinite(limit.limitSeconds) || limit.limitSeconds <= 0) return;
  if (timeSeconds < limit.limitSeconds) return;
  if (shouldSuppressLimit(limit)) return;

  const now = Date.now();
  const lastNotifiedAt = typeof limit.lastNotifiedAt === 'number' ? limit.lastNotifiedAt : 0;
  const exceeded = Boolean(limit.exceededAt);
  if (!exceeded && now - lastNotifiedAt < 60 * 1000) return; // share cooldown before exceeded

  injectLimitOverlay(tabId, limit, timeSeconds);
}

function injectLimitOverlay(tabId, limit, timeSeconds) {
  const hasSnooze = Boolean(limit.snoozeEnabled && limit.snoozeMinutes > 0);
  chrome.scripting.executeScript({
    target: { tabId },
    func: (payload) => {
      const existing = document.getElementById('chronos-limit-overlay');
      if (existing) existing.remove();

      const style = document.createElement('style');
      style.textContent = `
        #chronos-limit-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2147483647;
        }
        #chronos-limit-card {
          background: #1f2023;
          color: #ffffff;
          border: 1px solid #3f4147;
          border-radius: 12px;
          padding: 18px;
          min-width: 320px;
          max-width: 420px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.25);
          font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        }
        #chronos-limit-title {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 6px;
        }
        #chronos-limit-body {
          font-size: 13px;
          line-height: 1.45;
          color: #cfcfd4;
          margin-bottom: 14px;
          white-space: pre-line;
        }
        #chronos-limit-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .chronos-btn {
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #4f5158;
          background: #2a2c30;
          color: #ffffff;
          cursor: pointer;
          font-weight: 600;
        }
        .chronos-btn-primary {
          background: #ffffff;
          color: #111216;
          border-color: #ffffff;
        }
      `;

      const overlay = document.createElement('div');
      overlay.id = 'chronos-limit-overlay';
      const card = document.createElement('div');
      card.id = 'chronos-limit-card';
      const title = document.createElement('div');
      title.id = 'chronos-limit-title';
      title.textContent = 'Time limit reached';
      const body = document.createElement('div');
      body.id = 'chronos-limit-body';
      const msg = `${payload.display || payload.domain || payload.value}\nLimit: ${payload.limitMinutes} min · Today: ${payload.todayMinutes} min`;
      body.textContent = msg;

      const actions = document.createElement('div');
      actions.id = 'chronos-limit-actions';

      if (payload.hasSnooze) {
        const snooze = document.createElement('button');
        snooze.className = 'chronos-btn chronos-btn-primary';
        snooze.textContent = `Snooze ${payload.snoozeMinutes}m`;
        snooze.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'limitSnooze', id: payload.id });
          overlay.remove();
        });
        actions.appendChild(snooze);
      }

      const exit = document.createElement('button');
      exit.className = 'chronos-btn';
      exit.textContent = payload.hasSnooze ? 'Exit site' : 'Exit website';
      exit.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'limitExit', id: payload.id });
        overlay.remove();
      });
      actions.appendChild(exit);

      card.append(title, body, actions);
      overlay.append(style, card);
      document.documentElement.appendChild(overlay);
    },
    args: [{
      id: limit.id,
      display: limit.display,
      domain: limit.domain,
      value: limit.value,
      limitMinutes: Math.floor(limit.limitSeconds / 60),
      todayMinutes: Math.floor(timeSeconds / 60),
      hasSnooze,
      snoozeMinutes: hasSnooze ? limit.snoozeMinutes : 0
    }]
  });
}

function getLocalDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // local calendar day
}

function clearAllTrackingData() {
  tabTimeData = {};
  currentActiveTab = null;
  lastUpdateTime = Date.now();
  chrome.storage.local.set({
    [STORAGE_KEYS.tabTimeData]: {},
    [STORAGE_KEYS.lastResetDay]: getLocalDayKey()
  });
}

function ensureMidnightReset() {
  const todayKey = getLocalDayKey();
  chrome.storage.local.get([STORAGE_KEYS.lastResetDay], (result) => {
    const lastResetDay =
      typeof result.lastResetDay === 'string' ? result.lastResetDay : '';
    if (!lastResetDay) {
      chrome.storage.local.set({ [STORAGE_KEYS.lastResetDay]: todayKey });
      return;
    }
    if (lastResetDay !== todayKey) {
      clearAllTrackingData();
    }
  });
}

function scheduleMidnightResetAlarm() {
  // Schedule a one-shot alarm for the next local midnight, then reschedule after it fires.
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0
  ); // +5s to avoid edge timing
  chrome.alarms.create('midnightReset', { when: nextMidnight.getTime() });
}

// Load data from storage on startup
chrome.storage.local.get([STORAGE_KEYS.tabTimeData, STORAGE_KEYS.lastResetDay], (result) => {
  if (result.tabTimeData) tabTimeData = result.tabTimeData;
  ensureMidnightReset();
  scheduleMidnightResetAlarm();
});

// Also run when Chrome starts / extension is installed or updated
chrome.runtime.onStartup?.addListener(() => {
  ensureMidnightReset();
  scheduleMidnightResetAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureMidnightReset();
  scheduleMidnightResetAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === 'midnightReset') {
    // Clear once we cross into the new calendar day, then schedule the next midnight.
    clearAllTrackingData();
    scheduleMidnightResetAlarm();
  }
});

// Track active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureMidnightReset();
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
  ensureMidnightReset();
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
        chrome.storage.local.set({ [STORAGE_KEYS.tabTimeData]: tabTimeData });
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
  ensureMidnightReset();
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
          chrome.storage.local.set({ [STORAGE_KEYS.tabTimeData]: tabTimeData });

          // Enforce limits (domain or URL-prefix). We use current URL and domain's accumulated time.
          chrome.storage.local.get([STORAGE_KEYS.siteLimits], (result) => {
            const limits = Array.isArray(result.siteLimits) ? result.siteLimits : [];
            const matched = getLimitMatchesForUrl(tab.url, limits);
            if (matched) {
              const timeSeconds = tabTimeData[domain]?.time || 0;
              maybeNotifyLimitReached(matched, tab.url, timeSeconds);
              maybeShowOverlay(matched, currentActiveTab, timeSeconds);
              // Mark exceeded so future visits are immediately blocked on this domain.
              if (timeSeconds >= matched.limitSeconds && !matched.exceededAt) {
                const now = Date.now();
                const next = limits.map((l) => (l && l.id === matched.id ? { ...l, exceededAt: now, lastNotifiedAt: now } : l));
                chrome.storage.local.set({ [STORAGE_KEYS.siteLimits]: next });
              }
            }
          });
        }
      }
      lastUpdateTime = Date.now();
    });
  }
}, 1000);

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (!notificationId || !notificationId.startsWith('limit:')) return;
  const id = notificationId.slice('limit:'.length);
  chrome.storage.local.get([STORAGE_KEYS.siteLimits], (result) => {
    const limits = Array.isArray(result.siteLimits) ? result.siteLimits : [];
    const limit = limits.find(l => l && l.id === id);
    if (!limit) return;

    // Button 0: snooze (if enabled). Last button: dismiss.
    const hasSnooze = Boolean(limit.snoozeEnabled && limit.snoozeMinutes > 0);
    if (hasSnooze && buttonIndex === 0) {
      const snoozedUntil = Date.now() + (Number(limit.snoozeMinutes) * 60 * 1000);
      const next = limits.map((l) => (l && l.id === id ? { ...l, snoozedUntil } : l));
      chrome.storage.local.set({ [STORAGE_KEYS.siteLimits]: next });
    }
    chrome.notifications.clear(notificationId);
  });
});

// Export function to get data (called by popup)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getData') {
    ensureMidnightReset();
    chrome.storage.local.get([STORAGE_KEYS.tabTimeData], (result) => {
      sendResponse({ data: result.tabTimeData || {} });
    });
    return true;
  } else if (request.action === 'clearData') {
    clearAllTrackingData();
    sendResponse({ success: true });
  } else if (request.action === 'limitsUpdated') {
    // No-op placeholder so popup can poke the worker awake if needed.
    sendResponse({ success: true });
  } else if (request.action === 'limitSnooze') {
    chrome.storage.local.get([STORAGE_KEYS.siteLimits], (result) => {
      const limits = Array.isArray(result.siteLimits) ? result.siteLimits : [];
      const next = limits.map((l) => {
        if (l && l.id === request.id && l.snoozeEnabled && l.snoozeMinutes > 0) {
          return { ...l, snoozedUntil: Date.now() + l.snoozeMinutes * 60 * 1000 };
        }
        return l;
      });
      chrome.storage.local.set({ [STORAGE_KEYS.siteLimits]: next }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  } else if (request.action === 'limitExit') {
    if (sender && sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
    sendResponse({ success: true });
  }
});
