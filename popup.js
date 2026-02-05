// -----------------------
// State & helpers
// -----------------------

let currentChart = null;
let allData = {};

const LIMITS_STORAGE_KEY = 'siteLimits';
let limitsUnit = 'minutes'; // 'minutes' | 'hours'
let editingLimitId = null;

// Escape user-controlled data to prevent XSS
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function normalizeUrlPrefix(u) {
  // Normalize for matching: include origin, keep pathname (trim trailing slash),
  // drop hash, keep query (since user might want exact pages with query).
  const origin = u.origin;
  const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
  const query = u.search || '';
  return `${origin}${path}${query}`;
}

function getLimitTargetFromUserInput(input) {
  const raw = (input || '').trim();
  if (!raw) return null;

  // Allow entering just a domain like "example.com"
  const withScheme = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    const hostname = u.hostname.replace(/^www\./i, '');
    const hasMeaningfulPath = (u.pathname && u.pathname !== '/' && u.pathname !== '') || Boolean(u.search);
    if (hasMeaningfulPath) {
      // URL/path based (prefix match)
      const prefix = normalizeUrlPrefix(u);
      return { scope: 'urlPrefix', value: prefix, display: prefix, domain: hostname };
    }
    // Domain-based
    return { scope: 'domain', value: hostname, display: hostname, domain: hostname };
  } catch {
    return null;
  }
}

function minutesToSeconds(min) {
  return Math.max(0, Math.floor(min * 60));
}

function formatLimitSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  if (mins % 60 === 0 && mins >= 60) {
    const hrs = mins / 60;
    return `${hrs} hr${hrs === 1 ? '' : 's'}`;
  }
  return `${mins} min${mins === 1 ? '' : 's'}`;
}

// Format seconds to human-readable time
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

// -----------------------
// Data loading
// -----------------------

function loadData() {
  chrome.runtime.sendMessage({ action: 'getData' }, (response) => {
    if (chrome.runtime.lastError) {
      showError('Could not load data. Try reopening the popup.');
      return;
    }

    allData = (response && response.data) ? response.data : {};

    if (Object.keys(allData).length === 0) {
      showEmptyState();
    } else {
      updateTableView();
      updateChartView();
    }
  });
}

// -----------------------
// Limits: storage + rendering
// -----------------------

function getLimits(callback) {
  chrome.storage.local.get([LIMITS_STORAGE_KEY], (result) => {
    const limits = Array.isArray(result[LIMITS_STORAGE_KEY]) ? result[LIMITS_STORAGE_KEY] : [];
    callback(limits);
  });
}

function setLimits(limits, callback) {
  chrome.storage.local.set({ [LIMITS_STORAGE_KEY]: limits }, () => callback && callback());
}

function renderLimitsList(limits) {
  const root = document.getElementById('limitsList');
  root.innerHTML = '';

  if (!limits.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>No limits yet. Add one above to get started.</p>';
    root.appendChild(empty);
    return;
  }

  limits
    .slice()
    .sort((a, b) => String(a.display || a.domain || '').localeCompare(String(b.display || b.domain || '')))
    .forEach((limit) => {
      const item = document.createElement('div');
      item.className = 'limit-item';

      const top = document.createElement('div');
      top.className = 'limit-top';

      const left = document.createElement('div');
      const domain = document.createElement('div');
      domain.className = 'limit-domain';
      domain.textContent = limit.display || limit.domain || '(unknown)';
      const meta = document.createElement('div');
      meta.className = 'limit-meta';
      const scopeLabel = limit.scope === 'urlPrefix' ? 'URL' : 'Domain';
      meta.textContent = `${scopeLabel} · Limit: ${formatLimitSeconds(limit.limitSeconds || 0)}${limit.snoozeEnabled ? ` · Snooze: ${limit.snoozeMinutes}m` : ''}`;
      left.append(domain, meta);

      const actions = document.createElement('div');
      actions.className = 'limit-actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-small';
      btnEdit.textContent = 'Edit';
      btnEdit.addEventListener('click', () => startEditLimit(limit));

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn-small';
      btnDelete.textContent = 'Delete';
      btnDelete.addEventListener('click', () => deleteLimit(limit.id));

      actions.append(btnEdit, btnDelete);
      top.append(left, actions);

      item.appendChild(top);
      root.appendChild(item);
    });
}

function loadLimits() {
  getLimits(renderLimitsList);
}

function setFormHint(message) {
  const hint = document.getElementById('limitFormHint');
  if (hint) hint.textContent = message || '';
}

function resetLimitForm() {
  editingLimitId = null;
  document.getElementById('limitUrl').value = '';
  document.getElementById('limitTime').value = '';
  document.getElementById('snoozeEnabled').checked = false;
  document.getElementById('snoozeTime').value = '';
  document.getElementById('snoozeField').style.display = 'none';
  setUnit('minutes');
  document.getElementById('btnAddLimit').textContent = 'Add';
  setFormHint('');
}

function setUnit(unit) {
  limitsUnit = unit;
  const btnMin = document.getElementById('unitMinutes');
  const btnHrs = document.getElementById('unitHours');
  const isMin = unit === 'minutes';
  btnMin.classList.toggle('active', isMin);
  btnHrs.classList.toggle('active', !isMin);
  btnMin.setAttribute('aria-pressed', String(isMin));
  btnHrs.setAttribute('aria-pressed', String(!isMin));
}

function startEditLimit(limit) {
  editingLimitId = limit.id;
  document.getElementById('limitUrl').value = limit.display || limit.domain || '';
  const limitMinutes = Math.max(1, Math.floor((limit.limitSeconds || 0) / 60));
  // Heuristic: if divisible by 60, show hours, else minutes
  if (limitMinutes >= 60 && limitMinutes % 60 === 0) {
    setUnit('hours');
    document.getElementById('limitTime').value = String(limitMinutes / 60);
  } else {
    setUnit('minutes');
    document.getElementById('limitTime').value = String(limitMinutes);
  }
  document.getElementById('snoozeEnabled').checked = Boolean(limit.snoozeEnabled);
  document.getElementById('snoozeTime').value = limit.snoozeMinutes ? String(limit.snoozeMinutes) : '';
  document.getElementById('snoozeField').style.display = limit.snoozeEnabled ? 'flex' : 'none';
  document.getElementById('btnAddLimit').textContent = 'Save';
  setFormHint(`Editing limit for ${limit.display || limit.domain}`);
}

function upsertLimitFromForm() {
  const target = getLimitTargetFromUserInput(document.getElementById('limitUrl').value);
  if (!target) {
    setFormHint('Please enter a valid website URL or domain.');
    return;
  }

  const timeRaw = Number(document.getElementById('limitTime').value);
  if (!Number.isFinite(timeRaw) || timeRaw <= 0) {
    setFormHint('Please enter a valid time limit.');
    return;
  }

  const snoozeEnabled = Boolean(document.getElementById('snoozeEnabled').checked);
  const snoozeMinutes = snoozeEnabled ? Number(document.getElementById('snoozeTime').value) : 0;
  if (snoozeEnabled && (!Number.isFinite(snoozeMinutes) || snoozeMinutes <= 0)) {
    setFormHint('Please enter a valid snooze time (minutes).');
    return;
  }

  const limitMinutes = limitsUnit === 'hours' ? timeRaw * 60 : timeRaw;
  const limitSeconds = minutesToSeconds(limitMinutes);

  getLimits((limits) => {
    const now = Date.now();
    const id = editingLimitId || `${target.scope}:${target.value}`;
    // For industry-standard behavior: only one rule per exact target (domain OR urlPrefix)
    const next = limits.filter(l => l.id !== id && !(l.scope === target.scope && l.value === target.value));
    next.push({
      id,
      scope: target.scope, // 'domain' | 'urlPrefix'
      value: target.value, // domain or normalized url prefix
      domain: target.domain, // hostname for grouping
      display: target.display,
      limitSeconds,
      snoozeEnabled,
      snoozeMinutes: snoozeEnabled ? Math.floor(snoozeMinutes) : 0,
      updatedAt: now
    });

    setLimits(next, () => {
      chrome.runtime.sendMessage({ action: 'limitsUpdated' });
      loadLimits();
      resetLimitForm();
      setFormHint('Saved.');
      setTimeout(() => setFormHint(''), 1200);
    });
  });
}

function deleteLimit(id) {
  if (!confirm('Delete this limit?')) return;
  getLimits((limits) => {
    const next = limits.filter(l => l.id !== id);
    setLimits(next, () => {
      chrome.runtime.sendMessage({ action: 'limitsUpdated' });
      loadLimits();
      if (editingLimitId === id) resetLimitForm();
    });
  });
}

// -----------------------
// Tabs: Stats vs Limits
// -----------------------

function setActiveTab(tab) {
  const tabStats = document.getElementById('tabStats');
  const tabLimits = document.getElementById('tabLimits');
  const panelStats = document.getElementById('statsTab');
  const panelLimits = document.getElementById('limitsTab');
  const toggleButton = document.getElementById('btnToggle');

  const showStats = tab === 'stats';
  tabStats.classList.toggle('active', showStats);
  tabLimits.classList.toggle('active', !showStats);
  tabStats.setAttribute('aria-selected', String(showStats));
  tabLimits.setAttribute('aria-selected', String(!showStats));

  panelStats.classList.toggle('active', showStats);
  panelLimits.classList.toggle('active', !showStats);

  // Toggle button only makes sense in Stats tab
  if (toggleButton) toggleButton.style.display = showStats ? 'inline-block' : 'none';
}

// -----------------------
// View helpers
// -----------------------

function showEmptyState() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 4;
  td.innerHTML = '<div class="empty-state"><div class="empty-state-icon" aria-hidden="true">📭</div><p>No browsing data yet. Start browsing to track your screen time!</p></div>';
  tr.appendChild(td);
  tbody.appendChild(tr);
  document.getElementById('statsSummary').innerHTML = '';
  document.getElementById('statsChartSummary').innerHTML = '';
}

// Show error state (accessibility: screen readers get the message)
function showError(message) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 4;
  td.className = 'error-state';
  td.setAttribute('role', 'alert');
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
  document.getElementById('statsSummary').innerHTML = '';
  document.getElementById('statsChartSummary').innerHTML = '';
}

// -----------------------
// Domain logic
// -----------------------

// Sort data by time spent (descending)
function getSortedData() {
  return Object.entries(allData)
    .map(([domain, data]) => ({
      domain,
      ...data
    }))
    .sort((a, b) => b.time - a.time);
}

// -----------------------
// Rendering
// -----------------------

// Update table view (safe: no innerHTML with user data)
function updateTableView() {
  const sortedData = getSortedData();
  const tableBody = document.getElementById('tableBody');
  tableBody.innerHTML = '';

  sortedData.forEach((item) => {
    const tr = document.createElement('tr');
    const domainCell = document.createElement('td');
    domainCell.className = 'domain';
    domainCell.textContent = item.domain;
    const timeCell = document.createElement('td');
    timeCell.className = 'time';
    timeCell.textContent = formatTime(item.time);
    const visitsCell = document.createElement('td');
    visitsCell.textContent = String(item.visits || 1);
    const avgCell = document.createElement('td');
    avgCell.className = 'time';
    avgCell.textContent = formatTime(Math.floor(item.time / (item.visits || 1)));
    tr.append(domainCell, timeCell, visitsCell, avgCell);
    tableBody.appendChild(tr);
  });

  updateStatsSummary();
}

// Update stats summary (user-derived text escaped)
function updateStatsSummary() {
  const sortedData = getSortedData();
  const totalTime = sortedData.reduce((sum, item) => sum + item.time, 0);
  const topSite = sortedData[0];
  const topDomain = topSite ? escapeHtml(topSite.domain) : 'N/A';

  const statsHTML = `
    <div class="stat-card">
      <div class="stat-value">${escapeHtml(formatTime(totalTime))}</div>
      <div class="stat-label">Total Time</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${sortedData.length}</div>
      <div class="stat-label">Websites</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${topDomain}</div>
      <div class="stat-label">Most Visited</div>
    </div>
  `;

  document.getElementById('statsSummary').innerHTML = statsHTML;
  document.getElementById('statsChartSummary').innerHTML = statsHTML;
}

// Update chart view
function updateChartView() {
  const sortedData = getSortedData().slice(0, 10); // Top 10 sites
  const ctx = document.getElementById('timeChart').getContext('2d');

  if (currentChart) {
    currentChart.destroy();
  }

  const colors = [
    'rgba(255, 255, 255, 0.95)',
    'rgba(230, 230, 230, 0.9)',
    'rgba(200, 200, 200, 0.85)',
    'rgba(170, 170, 170, 0.8)',
    'rgba(140, 140, 140, 0.75)',
    'rgba(120, 120, 120, 0.7)',
    'rgba(100, 100, 100, 0.65)',
    'rgba(85, 85, 85, 0.6)',
    'rgba(70, 70, 70, 0.55)',
    'rgba(55, 55, 55, 0.5)'
  ];

  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedData.map(item => item.domain),
      datasets: [{
        label: 'Time Spent',
        data: sortedData.map(item => item.time),
        backgroundColor: colors.slice(0, sortedData.length),
        borderColor: colors.slice(0, sortedData.length).map(c => c.replace(/0\.\d+/, '1')),
        borderWidth: 1,
        borderRadius: 4,
        hoverBackgroundColor: colors.slice(0, sortedData.length).map(c => c.replace(/0\.\d+/, '1'))
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2f3136',
          titleColor: '#ffffff',
          bodyColor: '#9a9ca1',
          borderColor: '#3f4147',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return formatTime(context.parsed.x);
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#9a9ca1',
            font: { size: 10 },
            callback: function(value) {
              return formatTime(value);
            }
          }
        },
        y: {
          grid: { display: false },
          ticks: {
            color: '#9a9ca1',
            font: { size: 10 },
            maxRotation: 0
          }
        }
      }
    }
  });
}

// -----------------------
// UI actions
// -----------------------

// Toggle between table and chart view
function toggleView() {
  const tableView = document.getElementById('tableView');
  const chartView = document.getElementById('chartView');
  const isShowingTable = tableView.classList.contains('active');

  if (isShowingTable) {
    tableView.classList.remove('active');
    chartView.classList.add('active');
    if (Object.keys(allData).length > 0) {
      updateChartView();
    }
    setTimeout(function () {
      if (currentChart) {
        currentChart.resize();
      }
    }, 50);
  } else {
    chartView.classList.remove('active');
    tableView.classList.add('active');
  }
}

// Clear all data
function clearData() {
  if (confirm('Are you sure you want to clear all browsing data? This cannot be undone.')) {
    chrome.runtime.sendMessage({ action: 'clearData' }, (response) => {
      if (chrome.runtime.lastError) {
        showError('Could not clear data. Try reopening the popup.');
        return;
      }
      allData = {};
      showEmptyState();
    });
  }
}

// -----------------------
// Startup & wiring
// -----------------------

function initPopup() {
  // Top-level tabs
  const tabStats = document.getElementById('tabStats');
  const tabLimits = document.getElementById('tabLimits');
  if (tabStats) tabStats.addEventListener('click', () => setActiveTab('stats'));
  if (tabLimits) tabLimits.addEventListener('click', () => {
    setActiveTab('limits');
    loadLimits();
  });

  // Limits form wiring
  const unitMinutes = document.getElementById('unitMinutes');
  const unitHours = document.getElementById('unitHours');
  if (unitMinutes) unitMinutes.addEventListener('click', () => setUnit('minutes'));
  if (unitHours) unitHours.addEventListener('click', () => setUnit('hours'));

  const snoozeEnabled = document.getElementById('snoozeEnabled');
  if (snoozeEnabled) {
    snoozeEnabled.addEventListener('change', (e) => {
      const checked = Boolean(e.target.checked);
      document.getElementById('snoozeField').style.display = checked ? 'flex' : 'none';
      if (!checked) document.getElementById('snoozeTime').value = '';
    });
  }

  const addLimit = document.getElementById('btnAddLimit');
  const cancelLimit = document.getElementById('btnCancelLimit');
  if (addLimit) addLimit.addEventListener('click', upsertLimitFromForm);
  if (cancelLimit) cancelLimit.addEventListener('click', resetLimitForm);

  const toggleButton = document.getElementById('btnToggle');
  const clearButton = document.getElementById('btnClear');

  if (toggleButton) {
    toggleButton.addEventListener('click', toggleView);
  }
  if (clearButton) {
    clearButton.addEventListener('click', clearData);
  }

  // Initial load
  setActiveTab('stats');
  resetLimitForm();
  loadData();
  loadLimits();

  // Refresh data every 5 seconds
  setInterval(loadData, 5000);
}

document.addEventListener('DOMContentLoaded', initPopup);
