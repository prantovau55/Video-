// Auto HeyGen Downloader - popup.js
document.addEventListener("DOMContentLoaded", async () => {
  // Workspace controls
  const statusBadge = document.getElementById("status-badge");
  const btnStartAutomation = document.getElementById("btn-start-automation");
  const toggleAutoDownload = document.getElementById("toggle-auto-download");
  const btnManualDownload = document.getElementById("btn-manual-download");
  const logContainer = document.getElementById("log-container");

  let activeTabId = null;
  let isAutoDownloadEnabled = false;

  // Initialize and check state
  chrome.storage.local.get(["autoDownload", "logs"], (res) => {
    isAutoDownloadEnabled = res.autoDownload === true;
    toggleAutoDownload.checked = isAutoDownloadEnabled;

    if (res.logs && Array.isArray(res.logs)) {
      renderLogs(res.logs);
    } else {
      addLog("Extension initialized. Ready.");
    }
  });

  // Handle change in Auto Download setting
  toggleAutoDownload.addEventListener("change", (e) => {
    isAutoDownloadEnabled = e.target.checked;
    chrome.storage.local.set({ autoDownload: isAutoDownloadEnabled });
    addLog(`Auto Download set to ${isAutoDownloadEnabled ? "ON" : "OFF"}`);
  });

  // Check the active tab and establish state
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      const activeTab = tabs[0];
      activeTabId = activeTab.id;

      if (activeTab.url && activeTab.url.includes("heygen.com")) {
        if (statusBadge.textContent === "Waiting for Render" || statusBadge.textContent === "Error") {
          statusBadge.textContent = "Waiting for Render";
          statusBadge.className = "status-badge ready";
        }
      } else {
        statusBadge.textContent = "Error";
        statusBadge.className = "status-badge error";
        addLog("Warning: Open a HeyGen project editor tab to run automation.", "error");
      }
    }
  } catch (error) {
    console.error("Failed to query active tab:", error);
    statusBadge.textContent = "Error";
    statusBadge.className = "status-badge error";
  }

  // Request latest progress state on open
  if (activeTabId) {
    chrome.runtime.sendMessage({ action: "getState", tabId: activeTabId }, (response) => {
      if (response && response.status) {
        updateUI(response);
      }
    });
  }

  // Monitor messages from content script or background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.tabId === activeTabId || !message.tabId) {
      updateUI(message);
    }
  });

  // Start Automation Click Handler
  btnStartAutomation.addEventListener("click", () => {
    if (!activeTabId) {
      addLog("Error: No active HeyGen tab found.", "error");
      return;
    }

    addLog("Action: Trigger render scene on active HeyGen page...");
    btnStartAutomation.disabled = true;

    chrome.runtime.sendMessage({ action: "startAutomation", tabId: activeTabId }, (response) => {
      btnStartAutomation.disabled = false;
      if (chrome.runtime.lastError) {
        addLog("Failed to communicate with page. Please refresh the HeyGen tab.", "error");
        return;
      }
      if (response && response.error) {
        addLog(`Error: ${response.error}`, "error");
      } else {
        addLog("Success: Automated render sequence successfully started.");
      }
    });
  });

  // Manual Download click handler
  btnManualDownload.addEventListener("click", () => {
    if (!activeTabId) {
      addLog("Error: Active HeyGen tab not found.", "error");
      return;
    }

    addLog("Action: Scan request. Searching for completed HeyGen render...");
    
    // Request content script to locate and click/trigger download
    chrome.tabs.sendMessage(activeTabId, { action: "findAndTriggerManualDownload" }, (response) => {
      if (chrome.runtime.lastError) {
        addLog("No completed video available on page. Render must be complete.", "error");
        return;
      }

      if (response && response.error) {
        addLog(response.error, "error");
      } else if (response && response.success) {
        if (response.url) {
          addLog("Success: Download link detected! Initiating download stream...");
          
          chrome.runtime.sendMessage({
            action: "startManualDownload",
            tabId: activeTabId,
            downloadUrl: response.url,
            filename: response.filename || "heygen_render_video.mp4"
          }, (dlResponse) => {
            if (dlResponse && dlResponse.error) {
              addLog(`Download error: ${dlResponse.error}`, "error");
            } else {
              addLog("Success: Video download successfully started.");
            }
          });
        } else {
          addLog("Success: Download action triggered via native HeyGen click.");
        }
      } else {
        addLog("No completed video available.", "error");
      }
    });
  });

  // Helper to update the extension UI state
  function updateUI(data) {
    if (data.status === "ready") {
      statusBadge.textContent = "Waiting for Render";
      statusBadge.className = "status-badge ready";
    } else if (data.status === "rendering") {
      statusBadge.textContent = "Rendering...";
      statusBadge.className = "status-badge rendering";
      if (data.stage) {
        addLog(`Status: ${data.stage}`);
      }
    } else if (data.status === "downloading") {
      statusBadge.textContent = "Downloading...";
      statusBadge.className = "status-badge downloading";
      addLog("Starting file transfer...");
    } else if (data.status === "completed") {
      if (data.downloaded || isAutoDownloadEnabled) {
        statusBadge.textContent = "Download Complete";
        statusBadge.className = "status-badge ready";
        addLog("Success: Video successfully saved to your downloads.");
      } else {
        statusBadge.textContent = "Video Ready";
        statusBadge.className = "status-badge ready";
        addLog("Success: HeyGen render completed successfully.");
      }
    } else if (data.status === "error") {
      statusBadge.textContent = "Error";
      statusBadge.className = "status-badge error";
      addLog(`Error: ${data.error || "Process interrupted."}`, "error");
    }
  }

  // Logs Renderer
  function renderLogs(logs) {
    logContainer.innerHTML = "";
    logs.forEach(log => {
      const entry = document.createElement("div");
      entry.className = "log-entry";
      entry.innerHTML = `<span class="time">${log.time}</span>${log.text}`;
      logContainer.appendChild(entry);
    });
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Logger helper
  function addLog(text, type = "info") {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logItem = { time, text };
    
    chrome.storage.local.get("logs", (result) => {
      let logs = result.logs || [];
      logs.push(logItem);
      if (logs.length > 40) logs.shift();
      
      chrome.storage.local.set({ logs }, () => {
        renderLogs(logs);
      });
    });
  }
});
