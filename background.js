// Auto HeyGen Downloader - background.js
let jobs = {}; // Store progress states mapped by Tab IDs

// Handle installation event
chrome.runtime.onInstalled.addListener(() => {
  console.log("HeyGen Flux Unlimited successfully installed.");
});

// Helper to safely send runtime messages to popup (ignores errors if popup is closed)
function safeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // Catch and ignore "Could not establish connection. Receiving end does not exist."
    });
  } catch (e) {}
}

// Listener for active messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
  
  if (!tabId) {
    sendResponse({ error: "Missing Target Tab ID" });
    return;
  }

  if (message.action === "getState") {
    sendResponse(jobs[tabId] || { status: "ready" });
    return;
  }

  if (message.action === "startAutomation") {
    // Initialize or reset job mapping
    jobs[tabId] = {
      status: "rendering",
      stage: "Connecting to HeyGen Content...",
      progress: 0
    };

    // Forward instruction to content script in active tab
    chrome.tabs.sendMessage(tabId, { action: "findAndClickRender" }, (response) => {
      if (chrome.runtime.lastError) {
        const errMsg = "HeyGen page is not fully loaded or content script is missing. Please refresh.";
        jobs[tabId] = { status: "error", error: errMsg };
        safeSendMessage({ tabId, status: "error", error: errMsg });
        return;
      }
      
      if (response && response.error) {
        jobs[tabId] = { status: "error", error: response.error };
        safeSendMessage({ tabId, status: "error", error: response.error });
      }
    });

    sendResponse({ success: true });
    return;
  }

  // Capture updates from content script
  if (message.action === "progressUpdate") {
    const previousJobState = jobs[tabId] || {};
    jobs[tabId] = {
      status: "rendering",
      stage: message.stage,
      progress: message.progress || 0
    };

    // Dispatch Chrome Desktop Notifications at thresholds
    const thresholds = [0, 25, 50, 75, 100];
    const oldPct = Math.round(previousJobState.progress || 0);
    const newPct = Math.round(message.progress || 0);

    const hitThreshold = thresholds.find(t => oldPct < t && newPct >= t);
    if (hitThreshold !== undefined) {
      triggerNotification(
        `render-progress-${tabId}-${hitThreshold}`,
        "Rendering Progress",
        `HeyGen project rendering is currently ${hitThreshold}% complete. (${message.stage})`
      );
    }

    // Broadcast update back to popup.js
    safeSendMessage({
      tabId,
      status: "rendering",
      stage: message.stage,
      progress: message.progress
    });
    
    sendResponse({ success: true });
    return;
  }

  if (message.action === "triggerDownload") {
    // Save the completed state immediately
    jobs[tabId] = {
      status: "completed",
      stage: "Completed & Saved!",
      progress: 100,
      downloadUrl: message.downloadUrl,
      filename: message.filename,
      downloaded: message.alreadyDownloaded === true
    };

    // Trigger completion notification first
    triggerNotification(`render-complete-${tabId}`, "Rendering Complete", "Your HeyGen video rendering has finished successfully.");

    // Retrieve Auto Download setting
    chrome.storage.local.get("autoDownload", (result) => {
      const isAuto = result.autoDownload === true;
      const shouldDownload = (isAuto || message.forceDownload === true) && message.downloadUrl;
      if (shouldDownload) {
        // Start downloading immediately via Chrome downloads API if not already downloaded
        jobs[tabId].status = "downloading";
        safeSendMessage({ tabId, status: "downloading" });
        triggerNotification(`download-start-${tabId}`, "Download Started", "Establishing secure connection to fetch your rendering.");

        chrome.downloads.download({
          url: message.downloadUrl,
          filename: message.filename || "heygen_render_video.mp4",
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message;
            jobs[tabId] = { status: "error", error: "Download failed: " + error };
            safeSendMessage({ tabId, status: "error", error });
          } else {
            jobs[tabId].status = "completed";
            jobs[tabId].downloaded = true;
            safeSendMessage({
              tabId,
              status: "completed",
              downloaded: true,
              downloadUrl: message.downloadUrl,
              filename: message.filename
            });
            triggerNotification(`download-complete-${tabId}`, "Download Completed", "Your high-quality video was successfully stored.");
          }
        });
      } else {
        // Broadcast completed wait-for-click state or completed state
        safeSendMessage({
          tabId,
          status: "completed",
          downloaded: message.alreadyDownloaded === true,
          downloadUrl: message.downloadUrl,
          filename: message.filename
        });
      }
    });

    sendResponse({ success: true });
    return;
  }

  if (message.action === "startManualDownload") {
    const downloadUrl = message.downloadUrl || (jobs[tabId] && jobs[tabId].downloadUrl);
    const filename = message.filename || (jobs[tabId] && jobs[tabId].filename) || "heygen_render_video.mp4";

    if (!downloadUrl) {
      sendResponse({ error: "Download URL not available. Please wait for render." });
      return;
    }

    jobs[tabId] = jobs[tabId] || {};
    jobs[tabId].status = "downloading";
    safeSendMessage({ tabId, status: "downloading" });
    triggerNotification(`download-start-${tabId}`, "Download Started", "Establishing secure connection to fetch your rendering.");

    chrome.downloads.download({
      url: downloadUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message;
        jobs[tabId] = { status: "error", error: "Download failed: " + error };
        safeSendMessage({ tabId, status: "error", error });
      } else {
        jobs[tabId].status = "completed";
        jobs[tabId].downloaded = true;
        safeSendMessage({
          tabId,
          status: "completed",
          downloaded: true,
          downloadUrl: downloadUrl,
          filename: filename
        });
        triggerNotification(`download-complete-${tabId}`, "Download Completed", "Your high-quality video was successfully stored.");
      }
    });

    sendResponse({ success: true });
    return;
  }

  if (message.action === "reportError") {
    jobs[tabId] = { status: "error", error: message.error };
    safeSendMessage({ tabId, status: "error", error: message.error });
    triggerNotification(`error-${tabId}`, "Process Interrupted", message.error);
    sendResponse({ success: true });
    return;
  }
});

// Utility helper to create Chrome notifications
function triggerNotification(notificationId, title, message) {
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message,
    priority: 2
  });
}
