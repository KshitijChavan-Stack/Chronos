// -----------------------
// State & helpers
// -----------------------

let currentChart = null;
let allData = {};

// Escape user-controlled data to prevent XSS
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
  const toggleButton = document.getElementById('btnToggle');
  const clearButton = document.getElementById('btnClear');

  if (toggleButton) {
    toggleButton.addEventListener('click', toggleView);
  }
  if (clearButton) {
    clearButton.addEventListener('click', clearData);
  }

  // Initial load
  loadData();

  // Refresh data every 5 seconds
  setInterval(loadData, 5000);
}

document.addEventListener('DOMContentLoaded', initPopup);
