# Chronos - Chrome Extension

A lightweight Chrome extension that tracks your browsing time across different websites and displays it in an intuitive dashboard with tables and charts.

## Features

✅ **Real-time Tracking** - Automatically tracks time spent on each website
✅ **Table View** - See all websites with detailed time and visit statistics
✅ **Bar Chart** - Visualize your browsing habits with an interactive bar chart
✅ **Statistics** - View total time, number of websites, and most visited site
✅ **Data Persistence** - Your data is saved locally and persists across sessions
✅ **Easy Controls** - Toggle between views and clear data with one click

## Installation

### Step 1: Prepare the Files
1. Create a new folder called `Chronos` on your computer
2. Add the following files to this folder:
   - `manifest.json`
   - `background.js`
   - `popup.html`
   - `popup.js`

### Step 2: Create Icon Files (Optional)
Create a simple `images` folder in your extension directory and add icon files:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

Or you can modify the manifest.json to remove the icons section if you don't want to add them.

### Step 3: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right corner)
3. Click **Load unpacked**
4. Select the `Chronos` folder
5. Done! The extension should now appear in your Chrome toolbar

## Usage

1. **View Your Data** - Click the extension icon in the toolbar to open the dashboard
2. **Table View** - See all websites sorted by time spent, with visit counts and averages
3. **Chart View** - Click "Toggle View" to see a bar chart of your top 10 sites
4. **Clear Data** - Click "Clear Data" button to reset all statistics (confirmation required)

## How It Works

- **Background Service Worker** (`background.js`): Runs in the background and tracks which tab is active
- **Time Calculation**: Records the time you spend on each tab and aggregates it by domain
- **Local Storage**: All data is stored locally in your browser (Chrome Storage API)
- **Live Updates**: Data refreshes every 5 seconds in the popup

## Data Privacy

✅ All your data is stored **locally on your computer**
✅ Nothing is sent to external servers
✅ No tracking by us or any third party
✅ You have full control to clear data anytime

## Limitations

- Only tracks active tabs (paused when Chrome is closed)
- Time starts fresh when you clear data
- Internal Chrome pages (like settings) are not tracked
- The tracker updates every second while a tab is active

## Troubleshooting

**Extension not appearing?**
- Make sure Developer mode is enabled on `chrome://extensions/`
- Try clicking "Load unpacked" again and selecting the folder

**Data not updating?**
- Refresh the popup after switching tabs
- Make sure you're on actual websites (http/https)

**Chart not displaying?**
- Ensure you have data from at least 2-3 websites
- Try toggling the view off and back on

## Future Enhancements

Consider adding:
- Daily/weekly/monthly statistics
- Export data as CSV
- Category-based filtering
- Set time limits for specific sites
- Sync data across devices (requires server backend)

## Making it free for everyone

You can distribute Chronos for free in two ways:

**Option A: Chrome Web Store** (best for reach)
- One-time **$5** developer account at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
- Zip the extension folder, upload as a new item, fill in the listing (description, screenshots), and submit for review.
- Once approved, anyone can install it in one click. No server or hosting needed.

**Option B: GitHub** (free for you)
- Push this repo to GitHub and add a short **Install** section in the README: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`.
- Optionally create a **Release** and attach a zip of the extension so users can download and load it without cloning.

---

Enjoy tracking your browsing habits! 📊⏱️
