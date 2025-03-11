const { ipcRenderer } = require('electron');

// DOM elements
const tabsContainer = document.getElementById('tabs');
const contentContainer = document.getElementById('content');
const startButton = document.getElementById('start-monitoring');
const stopButton = document.getElementById('stop-monitoring');

// Translations
const translations = {
  notMonitoring: 'No monitoreando',
  startingMonitoring: 'Iniciando monitoreo...',
  monitoringStopped: 'Monitoreo detenido',
  checkingIfLive: 'Verificando si está en vivo...',
  viewers: 'Espectadores',
  error: 'Error'
};

// State
let channels = [];
let activeChannel = null;
let monitoringChannels = new Set();
const charts = {};

// Initialize the application
async function init() {
  // Get channels from main process
  channels = await ipcRenderer.invoke('get-channels');
  
  // Create tabs and panels for each channel
  channels.forEach(channel => {
    createChannelTab(channel);
    createChannelPanel(channel);
  });
  
  // Set the first channel as active
  if (channels.length > 0) {
    setActiveChannel(channels[0]);
  }
  
  // Update button states
  updateButtonStates();
}

// Create a tab for a channel
function createChannelTab(channel) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.textContent = channel;
  tab.dataset.channel = channel;
  
  tab.addEventListener('click', () => {
    setActiveChannel(channel);
  });
  
  tabsContainer.appendChild(tab);
}

// Create a panel for a channel
function createChannelPanel(channel) {
  const panel = document.createElement('div');
  panel.className = 'channel-panel';
  panel.dataset.channel = channel;
  
  // Status container
  const statusContainer = document.createElement('div');
  statusContainer.className = 'status-container';
  statusContainer.id = `status-${channel}`;
  statusContainer.textContent = translations.notMonitoring;
  panel.appendChild(statusContainer);
  
  // Create viewer stats container
  const viewerStats = document.createElement('div');
  viewerStats.className = 'viewer-stats';
  
  // Viewer count display
  const viewerCount = document.createElement('div');
  viewerCount.className = 'viewer-count';
  viewerCount.id = `count-${channel}`;
  viewerCount.textContent = '0';
  viewerStats.appendChild(viewerCount);
  
  // Viewer count comparison
  const viewerComparison = document.createElement('div');
  viewerComparison.className = 'viewer-comparison';
  viewerComparison.id = `comparison-${channel}`;
  viewerStats.appendChild(viewerComparison);
  
  panel.appendChild(viewerStats);
  
  // Create a container for the chart and logs
  const dataContainer = document.createElement('div');
  dataContainer.className = 'data-container';
  
  // Chart container
  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-container';
  
  // Create canvas for chart
  const canvas = document.createElement('canvas');
  canvas.className = 'chart';
  canvas.id = `chart-${channel}`;
  chartContainer.appendChild(canvas);
  dataContainer.appendChild(chartContainer);
  
  // Logs container
  const logsContainer = document.createElement('div');
  logsContainer.className = 'logs-container';
  logsContainer.id = `logs-${channel}`;
  dataContainer.appendChild(logsContainer);
  
  panel.appendChild(dataContainer);
  contentContainer.appendChild(panel);
}

// Set the active channel
function setActiveChannel(channel) {
  // Update active state for tabs
  document.querySelectorAll('.tab').forEach(tab => {
    if (tab.dataset.channel === channel) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update active state for panels
  document.querySelectorAll('.channel-panel').forEach(panel => {
    if (panel.dataset.channel === channel) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
  
  activeChannel = channel;
  updateButtonStates();
}

// Update button states based on monitoring status
function updateButtonStates() {
  if (!activeChannel) {
    startButton.disabled = true;
    stopButton.disabled = true;
    return;
  }
  
  startButton.disabled = monitoringChannels.has(activeChannel);
  stopButton.disabled = !monitoringChannels.has(activeChannel);
}

// Start monitoring the active channel
startButton.addEventListener('click', () => {
  if (!activeChannel || monitoringChannels.has(activeChannel)) return;
  
  // Update UI
  const statusEl = document.getElementById(`status-${activeChannel}`);
  statusEl.textContent = translations.startingMonitoring;
  statusEl.className = 'status-container checking';
  
  // Add visual feedback to button
  startButton.classList.add('button-active');
  setTimeout(() => startButton.classList.remove('button-active'), 300);
  
  // Clear logs container
  const logsEl = document.getElementById(`logs-${activeChannel}`);
  if (logsEl) logsEl.innerHTML = '';
  
  // Send request to main process
  ipcRenderer.send('monitor-channel', activeChannel);
  monitoringChannels.add(activeChannel);
  updateButtonStates();
});

// Stop monitoring the active channel
stopButton.addEventListener('click', () => {
  if (!activeChannel || !monitoringChannels.has(activeChannel)) return;
  
  // Send request to main process
  ipcRenderer.send('stop-monitoring', activeChannel);
});

// Handle viewer count updates
ipcRenderer.on('viewer-update', (event, data) => {
  const { channelName, viewCount, timestamp, history } = data;
  
  // Update viewer count display
  const countEl = document.getElementById(`count-${channelName}`);
  const comparisonEl = document.getElementById(`comparison-${channelName}`);
  
  if (countEl && comparisonEl) {
    const previousCount = countEl.textContent === '0' ? viewCount : parseInt(countEl.textContent);
    const difference = viewCount - previousCount;
    
    // Add animation class for visual feedback
    countEl.classList.add('updating');
    setTimeout(() => countEl.classList.remove('updating'), 1000);
    
    countEl.textContent = viewCount;
    
    if (difference !== 0) {
      const arrow = difference > 0 ? '↑' : '↓';
      const color = difference > 0 ? '#34a853' : '#ea4335';
      comparisonEl.innerHTML = `<span style="color: ${color}">${arrow} ${Math.abs(difference)}</span>`;
      
      // Add pulse animation to comparison element
      comparisonEl.classList.add('pulse');
      setTimeout(() => comparisonEl.classList.remove('pulse'), 1000);
    } else {
      comparisonEl.innerHTML = '<span style="color: #5f6368">―</span>';
    }
  }
  
  // Update chart if it exists
  updateChart(channelName, history);
  
  // Add log entry
  const logsEl = document.getElementById(`logs-${channelName}`);
  if (logsEl) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    // Create timestamp element
    const timestampEl = document.createElement('span');
    timestampEl.className = 'log-timestamp';
    timestampEl.textContent = `[${timestamp}]`;
    
    // Create viewer count element
    const viewerEl = document.createElement('span');
    viewerEl.className = 'log-viewers';
    viewerEl.textContent = `Espectadores: ${viewCount}`;
    
    // Add elements to log entry
    logEntry.appendChild(timestampEl);
    logEntry.appendChild(viewerEl);
    
    // Add fade-in animation
    logEntry.style.opacity = '0';
    
    // Add to the top of the logs container
    logsEl.insertBefore(logEntry, logsEl.firstChild);
    
    // Trigger animation
    setTimeout(() => {
      logEntry.style.opacity = '1';
    }, 10);
    
    // Limit the number of log entries to prevent performance issues
    if (logsEl.children.length > 100) {
      logsEl.removeChild(logsEl.lastChild);
    }
  }
});

// Handle channel status updates
ipcRenderer.on('channel-status', (event, data) => {
  const { channelName, status } = data;
  
  const statusEl = document.getElementById(`status-${channelName}`);
  if (statusEl) {
    // Translate status messages
    let translatedStatus = status;
    if (status.includes('Live!')) {
      translatedStatus = status.replace('Live!', 'En vivo!').replace('Monitoring viewers...', 'Monitoreando espectadores...');
    } else if (status.includes('Checking if live')) {
      translatedStatus = translations.checkingIfLive;
    } else if (status.includes('Not live')) {
      translatedStatus = status.replace('Not live', 'No está en vivo').replace('Attempt', 'Intento');
    }
    
    statusEl.textContent = translatedStatus;
    
    // Update status styling
    statusEl.className = 'status-container';
    if (status.includes('Live!')) {
      statusEl.classList.add('live');
    } else if (status.includes('Checking')) {
      statusEl.classList.add('checking');
    }
  }
});

// Handle channel errors
ipcRenderer.on('channel-error', (event, data) => {
  const { channelName, error } = data;
  
  const statusEl = document.getElementById(`status-${channelName}`);
  if (statusEl) {
    statusEl.textContent = `${translations.error}: ${error}`;
    statusEl.className = 'status-container error';
  }
  
  monitoringChannels.delete(channelName);
  updateButtonStates();
});

// Handle monitoring stopped
ipcRenderer.on('monitoring-stopped', (event, channelName) => {
  const statusEl = document.getElementById(`status-${channelName}`);
  if (statusEl) {
    statusEl.textContent = translations.monitoringStopped;
    statusEl.className = 'status-container';
  }
  
  monitoringChannels.delete(channelName);
  updateButtonStates();
});

// Update chart with new data
function updateChart(channelName, data) {
  if (!charts[channelName]) {
    // Initialize chart if it doesn't exist
    const ctx = document.getElementById(`chart-${channelName}`).getContext('2d');
    charts[channelName] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: translations.viewers,
          data: [],
          borderColor: 'rgb(255, 0, 0)',
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: 'rgb(255, 0, 0)',
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: 'rgb(255, 0, 0)',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(200, 200, 200, 0.1)'
            },
            ticks: {
              font: {
                weight: 'bold'
              },
              padding: 10
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              maxRotation: 0,
              maxTicksLimit: 8
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              boxWidth: 15,
              padding: 15,
              font: {
                size: 12,
                weight: 'bold'
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: {
              size: 14,
              weight: 'bold'
            },
            bodyFont: {
              size: 13
            },
            padding: 12,
            cornerRadius: 6,
            displayColors: false
          }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        elements: {
          line: {
            borderJoinStyle: 'round'
          }
        }
      }
    });
  }
  
  // Update chart data
  const chart = charts[channelName];
  chart.data.labels = data.map(item => item.timestamp);
  chart.data.datasets[0].data = data.map(item => parseInt(item.originalViewCount.replace(/,/g, '')));
  chart.update('show'); // Use 'show' mode for smoother transitions
}

// Initialize the application when the DOM is loaded and Chart.js is ready
document.addEventListener('DOMContentLoaded', () => {
  // Check if Chart.js is loaded
  if (window.Chart) {
    init();
  } else {
    // If Chart.js is not loaded yet, wait for it
    console.log('Waiting for Chart.js to load...');
    const checkChartInterval = setInterval(() => {
      if (window.Chart) {
        clearInterval(checkChartInterval);
        init();
      }
    }, 100);
    
    // Fallback in case Chart.js fails to load
    setTimeout(() => {
      if (!window.Chart) {
        console.error('Chart.js failed to load');
        clearInterval(checkChartInterval);
        alert('Error: No se pudo cargar Chart.js. Por favor, recargue la página.');
      }
    }, 5000);
  }
});
