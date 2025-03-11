const { app, BrowserWindow, ipcMain } = require('electron');
const { chromium } = require('playwright');
const islive = require('isyoutubelive');
const channels = require('./channelID.json');
const path = require('path');
const fs = require('fs-extra');

let mainWindow;
const activeStreams = {};
const viewerData = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');
  
  // Remove menu bar for cleaner look
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  // Set up Playwright browser path for packaged app
  if (app.isPackaged) {
    // Use a more flexible approach to find the browser
    const browsersPath = path.join(process.resourcesPath, 'playwright-browsers');
    
    // Log the path for debugging
    console.log('Looking for browsers in:', browsersPath);
    
    if (fs.existsSync(browsersPath)) {
      // Try to find chromium directory dynamically
      try {
        const chromiumDirs = fs.readdirSync(browsersPath)
          .filter(dir => dir.startsWith('chromium-'));
        
        if (chromiumDirs.length > 0) {
          // Use the first chromium directory found
          const chromiumPath = path.join(
            browsersPath,
            chromiumDirs[0],
            'chrome-win',
            'chrome.exe'
          );
          
          if (fs.existsSync(chromiumPath)) {
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromiumPath;
            console.log('Found Chromium at:', chromiumPath);
          } else {
            console.error('Chrome executable not found at:', chromiumPath);
          }
        } else {
          console.error('No chromium directories found in:', browsersPath);
        }
      } catch (error) {
        console.error('Error finding Chromium:', error);
      }
    } else {
      console.error('Playwright browsers directory not found at:', browsersPath);
    }
  }
  
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Create base folders for storing data
const rootFolderPath = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'View counts');
if (!fs.existsSync(rootFolderPath)) {
  try {
    fs.mkdirSync(rootFolderPath, { recursive: true });
  } catch (error) {
    console.error('Error creating root folder:', error);
  }
}

// Handle channel monitoring requests from the renderer
ipcMain.on('monitor-channel', async (event, channelName) => {
  if (activeStreams[channelName]) {
    console.log(`Already monitoring ${channelName}`);
    return;
  }
  
  const channelId = channels[channelName];
  if (!channelId) {
    event.reply('channel-error', { channelName, error: 'Channel ID not found' });
    return;
  }
  
  // Create folder for this channel
  const folderPath = path.join(rootFolderPath, channelName);
  if (!fs.existsSync(folderPath)) {
    try {
      fs.mkdirSync(folderPath, { recursive: true });
    } catch (error) {
      console.error(`Error creating folder for ${channelName}:`, error);
    }
  }
  
  // Initialize viewer data for this channel
  viewerData[channelName] = [];
  
  // Start monitoring
  monitorChannel(channelName, channelId, event);
});

// Stop monitoring a channel
ipcMain.on('stop-monitoring', (event, channelName) => {
  if (activeStreams[channelName]) {
    activeStreams[channelName].browser.close();
    delete activeStreams[channelName];
    event.reply('monitoring-stopped', channelName);
  }
});

// Get list of all available channels
ipcMain.handle('get-channels', () => {
  return Object.keys(channels);
});

async function monitorChannel(channelName, channelId, event) {
  try {
    // Check if channel is live
    event.reply('channel-status', { channelName, status: 'Checking if live...' });
    
    const liveStreamUrl = await checkLiveStream(channelId, channelName, event);
    if (!liveStreamUrl) {
      event.reply('channel-error', { 
        channelName, 
        error: 'Could not find live stream after multiple attempts' 
      });
      return;
    }
    
    // Launch browser and monitor
    const browser = await chromium.launch({ 
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    activeStreams[channelName] = { browser, page };
    
    // Intercept all network requests
    await page.route('**/*', (route, request) => {
      route.continue();
    });
    
    // Listen for responses
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('updated_metadata?prettyPrint=false')) {
        try {
          const json = await response.json();
          if (json && json.actions && json.actions[0].updateViewershipAction) {
            const viewCountData = json.actions[0].updateViewershipAction.viewCount;
            const originalViewCount = viewCountData.videoViewCountRenderer.originalViewCount;
            
            const timestamp = new Date().toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            });
            
            // Store data
            const dataPoint = { timestamp, originalViewCount };
            viewerData[channelName].push(dataPoint);
            
            // Limit stored data points to prevent memory issues
            if (viewerData[channelName].length > 100) {
              viewerData[channelName].shift();
            }
            
            // Send to renderer
            event.reply('viewer-update', { 
              channelName, 
              timestamp, 
              viewCount: originalViewCount,
              history: viewerData[channelName]
            });
          }
        } catch (error) {
          console.error(`Error processing JSON for ${channelName}:`, error);
        }
      }
    });
    
    // Navigate to the live stream
    event.reply('channel-status', { 
      channelName, 
      status: 'Live! Monitoring viewers...',
      url: liveStreamUrl
    });
    
    await page.goto(liveStreamUrl);
    
  } catch (error) {
    console.error(`Error monitoring ${channelName}:`, error);
    event.reply('channel-error', { channelName, error: error.message });
    
    // Clean up if there was an error
    if (activeStreams[channelName]) {
      try {
        await activeStreams[channelName].browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
      delete activeStreams[channelName];
    }
  }
}

async function checkLiveStream(channelId, channelName, event) {
  let attempts = 0;
  const maxAttempts = 12; // Try for 2 minutes (12 attempts * 10 seconds)
  
  while (attempts < maxAttempts) {
    try {
      const res = await islive(channelId);
      
      if (res.is_live && res.url) {
        return res.url;
      } else {
        attempts++;
        event.reply('channel-status', { 
          channelName, 
          status: `Not live. Attempt ${attempts}/${maxAttempts}...` 
        });
        
        // Wait 10 seconds before trying again
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch (error) {
      console.error(`Error checking if ${channelName} is live:`, error);
      attempts++;
      event.reply('channel-status', { 
        channelName, 
        status: `Error checking. Attempt ${attempts}/${maxAttempts}...` 
      });
      
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  return null; // Return null if not live after max attempts
}