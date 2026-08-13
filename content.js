// Auto HeyGen Downloader - content.js
console.log("[Auto HeyGen Downloader] content.js loaded and listening in the editor context.");

let progressObserver = null;
let lastState = "idle"; // "idle", "rendering", "completed"
let hasDownloadedThisCompletedSession = false;
let chatActionButton = null;
let chatActionObserver = null;

function hasExtensionContext() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeSendMessage(message, callback) {
  if (!hasExtensionContext()) return false;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      try {
        if (chrome.runtime.lastError) {
          return;
        }
      } catch (e) {}
      if (typeof callback === "function") callback(response);
    });
    return true;
  } catch (e) {
    return false;
  }
}

function safeStorageGet(key, callback) {
  if (!hasExtensionContext()) return false;
  try {
    chrome.storage.local.get(key, (result) => {
      try {
        if (chrome.runtime.lastError) {
          return;
        }
      } catch (e) {}
      if (typeof callback === "function") callback(result);
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Initialize continuous monitoring immediately on load!
initContinuousMonitoring();
initChatActionButton();

// Listen to commands from background or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "findAndClickRender") {
    const success = handleRenderTrigger();
    if (success) {
      sendResponse({ status: "initiated" });
    } else {
      sendResponse({ error: "Failed to locate Render/Submit button in the current HeyGen editor. Please ensure your project is open and loaded." });
    }
    return true;
  }

  if (message.action === "findAndTriggerManualDownload") {
    console.log("[Auto HeyGen Downloader] Manual download request received.");
    const tabId = sender.tab && sender.tab.id;
    const triggerDownloadFlow = (candidate) => {
      if (!candidate) {
        sendResponse({ error: "No completed video URL was exposed on the page yet." });
        return;
      }

      const filename = createDownloadFilename(candidate.filename || candidate.url);
      safeSendMessage({
        action: "triggerDownload",
        tabId,
        downloadUrl: candidate.url,
        filename,
        forceDownload: true,
        alreadyDownloaded: false
      });

      sendResponse({ success: true, url: candidate.url, filename });
    };

    const directCandidate = findBestDownloadCandidate();
    if (directCandidate) {
      triggerDownloadFlow(directCandidate);
      return true;
    }

    const dlElement = findDownloadElement();
    if (dlElement) {
      console.log("[Auto HeyGen Downloader] Found download element manually. Clicking element:", dlElement);
      dlElement.click();

      setTimeout(() => {
        const resolvedCandidate = findBestDownloadCandidate();
        if (resolvedCandidate) {
          triggerDownloadFlow(resolvedCandidate);
        } else {
          sendResponse({ error: "No completed video URL was exposed on the page yet." });
        }
      }, 2200);
    } else {
      console.log("[Auto HeyGen Downloader] Manual download element NOT found on page.");
      sendResponse({ error: "No completed video available." });
    }
    return true;
  }
});

// Helper to find a selector inside shadow roots recursively
function findElementInShadow(root, selector) {
  if (!root) return null;
  const el = root.querySelector(selector);
  if (el) return el;
  const children = root.querySelectorAll('*');
  for (const child of children) {
    if (child.shadowRoot) {
      const found = findElementInShadow(child.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

// Helper to collect all matching elements from shadow roots recursively
function findAllElementsInShadow(root, selector, list = []) {
  if (!root) return list;
  const elements = root.querySelectorAll(selector);
  elements.forEach(el => list.push(el));
  const children = root.querySelectorAll('*');
  for (const child of children) {
    if (child.shadowRoot) {
      findAllElementsInShadow(child.shadowRoot, selector, list);
    }
  }
  return list;
}

function createDownloadFilename(urlOrName) {
  let baseName = (urlOrName || "heygen_render_video.mp4").toString();
  const cleanMatch = baseName.match(/[^/\\]+$/);
  if (cleanMatch && cleanMatch[0]) {
    baseName = cleanMatch[0];
  }
  baseName = baseName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!/\.(mp4|mov|webm|mkv)$/i.test(baseName)) {
    baseName = `${baseName || "heygen_render_video"}.mp4`;
  }
  return baseName;
}

function isMediaUrl(url) {
  if (!url || typeof url !== "string") return false;
  const normalized = url.trim();
  if (!normalized) return false;
  return /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(normalized) || normalized.startsWith("blob:") || normalized.startsWith("http") || normalized.startsWith("https");
}

function buildCandidateVariants(url) {
  const variants = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        variants.push(trimmed);
      }
    }
  };

  push(url);

  try {
    const parsed = new URL(url);
    const paramsToSet = [
      ["watermark", "0"],
      ["watermark", "false"],
      ["watermark", "none"],
      ["no_watermark", "true"],
      ["without_watermark", "true"],
      ["watermark_free", "true"],
      ["quality", "original"],
      ["quality", "best"],
      ["quality", "source"],
      ["download", "1"],
      ["download", "true"]
    ];

    paramsToSet.forEach(([key, value]) => {
      const next = new URL(parsed.toString());
      next.searchParams.set(key, value);
      push(next.toString());
    });

    ["watermark", "watermark_type", "watermark_mode", "preview", "thumbnail", "thumb", "token"].forEach((key) => {
      const next = new URL(parsed.toString());
      next.searchParams.delete(key);
      push(next.toString());
    });
  } catch (e) {}

  return variants;
}

function extractCandidateUrlFromElement(element) {
  if (!element) return null;

  const candidates = [];
  const addCandidate = (value, reason) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && isMediaUrl(trimmed)) {
        candidates.push({ url: trimmed, reason });
      }
    }
  };

  if (element.tagName === "VIDEO") {
    addCandidate(element.currentSrc || element.src, "video-current-src");
  }

  addCandidate(element.getAttribute("data-download-url"), "data-download-url");
  addCandidate(element.getAttribute("data-url"), "data-url");
  addCandidate(element.getAttribute("data-src"), "data-src");
  addCandidate(element.getAttribute("data-video-url"), "data-video-url");
  addCandidate(element.getAttribute("data-media-url"), "data-media-url");
  addCandidate(element.getAttribute("data-href"), "data-href");
  addCandidate(element.getAttribute("href"), "href");
  addCandidate(element.getAttribute("src"), "src");
  addCandidate(element.getAttribute("value"), "value");

  if (element.tagName === "SOURCE") {
    addCandidate(element.getAttribute("src"), "source-src");
  }

  if (element.tagName === "A" && element.href) {
    addCandidate(element.href, "anchor-href");
  }

  return candidates[0] || null;
}

function scoreDownloadCandidate(candidate, element) {
  if (!candidate || !candidate.url) return -Infinity;
  let score = 0;
  const url = candidate.url.toLowerCase();
  const text = (element && element.textContent ? element.textContent : "").toLowerCase();

  if (url.includes(".mp4")) score += 8;
  if (url.includes(".mov")) score += 6;
  if (url.includes(".webm")) score += 6;
  if (url.includes("1080") || url.includes("1920") || url.includes("2160")) score += 5;
  if (url.includes("720") || url.includes("hd")) score += 4;
  if (url.includes("best") || url.includes("original") || url.includes("master") || url.includes("full")) score += 4;
  if (url.includes("quality=original") || url.includes("quality=source") || url.includes("quality=best")) score += 5;
  if (url.includes("no-watermark") || url.includes("without-watermark") || url.includes("no_watermark") || url.includes("without_watermark") || url.includes("watermark-free") || url.includes("watermark=false") || url.includes("watermark=0") || url.includes("watermark=no") || url.includes("watermark=none") || url.includes("no_watermark=true")) score += 10;
  if (url.includes("download=1") || url.includes("download=true") || url.includes("download=on")) score += 3;
  if (text.includes("no watermark") || text.includes("without watermark") || text.includes("best quality") || text.includes("high quality") || text.includes("original quality") || text.includes("download original")) score += 6;
  if (url.includes("watermark=true") || url.includes("watermark=1") || url.includes("watermark=2") || url.includes("watermark=on")) score -= 10;
  if (url.includes("preview") || url.includes("thumb") || url.includes("thumbnail")) score -= 10;
  if (url.startsWith("blob:")) score += 2;
  return score;
}

function collectUrlCandidatesFromPageText() {
  const pageText = `${document.documentElement.innerHTML || ""} ${document.body ? document.body.innerText : ""}`;
  const matches = pageText.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const unique = [];
  const seen = new Set();

  matches.forEach((match) => {
    const cleaned = match.replace(/[),.;]+$/, "");
    const lower = cleaned.toLowerCase();
    if (!seen.has(cleaned) && (lower.includes(".mp4") || lower.includes(".mov") || lower.includes(".webm") || lower.includes(".mkv") || lower.includes("video") || lower.includes("download") || lower.includes("render") || lower.includes("stream"))) {
      seen.add(cleaned);
      unique.push({ url: cleaned, reason: "page-text" });
    }
  });

  return unique;
}

function findNoWatermarkActionElement() {
  const candidates = [
    ...Array.from(document.querySelectorAll("button, a, [role='button'], [data-testid], [class*='download' i], [class*='watermark' i]")),
    ...findAllElementsInShadow(document, "button, a, [role='button'], [data-testid], [class*='download' i], [class*='watermark' i]")
  ];

  for (const element of candidates) {
    const label = `${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.toLowerCase();
    if (label.includes("no watermark") || label.includes("without watermark") || label.includes("original quality") || label.includes("best quality") || label.includes("download original") || label.includes("remove watermark")) {
      return element;
    }
  }

  return null;
}

function findBestDownloadCandidate() {
  const candidates = [];

  const addCandidatesFrom = (element) => {
    const candidate = extractCandidateUrlFromElement(element);
    if (candidate) {
      const score = scoreDownloadCandidate(candidate, element);
      candidates.push({ ...candidate, score, element });
    }
  };

  const noWatermarkElement = findNoWatermarkActionElement();
  if (noWatermarkElement) {
    try {
      noWatermarkElement.click();
    } catch (e) {}
  }

  document.querySelectorAll("video, source, a, button, [role='button'], [data-download-url], [data-url], [href], [src]").forEach(addCandidatesFrom);
  findAllElementsInShadow(document, "video, source, a, button, [role='button'], [data-download-url], [data-url], [href], [src]").forEach(addCandidatesFrom);

  collectUrlCandidatesFromPageText().forEach((candidate) => {
    const score = scoreDownloadCandidate(candidate, null);
    candidates.push({ ...candidate, score, element: null });
  });

  const bestCandidate = candidates.sort((a, b) => b.score - a.score)[0];
  if (bestCandidate && bestCandidate.score > -Infinity) {
    const variants = buildCandidateVariants(bestCandidate.url);
    const rankedCandidates = variants.map((url) => ({
      url,
      score: scoreDownloadCandidate({ url }, bestCandidate.element),
      element: bestCandidate.element
    })).sort((a, b) => b.score - a.score);

    const winningUrl = rankedCandidates[0] && rankedCandidates[0].url ? rankedCandidates[0].url : bestCandidate.url;
    return {
      url: winningUrl,
      filename: createDownloadFilename(winningUrl)
    };
  }

  return null;
}

// Find Download Button or Video element using wide-range selectors and Shadow roots
function findDownloadElement() {
  const selectors = [
    '[data-testid="download-btn"]',
    '[data-testid*="download"]',
    'button[class*="download" i]',
    'a[class*="download" i]',
    '[aria-label*="download" i]',
    '[title*="download" i]',
    '[aria-label*="no watermark" i]',
    '[title*="no watermark" i]',
    '[data-testid*="watermark"]'
  ];

  // 1. Try standard selectors in main document
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // 2. Try selectors in shadow roots
  for (const selector of selectors) {
    const el = findElementInShadow(document, selector);
    if (el) return el;
  }

  // 3. Search all buttons, anchors and custom elements by text content (case-insensitive)
  const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, [class*="btn"]'));
  for (const item of clickables) {
    const text = item.textContent.trim().toLowerCase();
    if (text === 'download' || text.includes('download video') || text.includes('download mp4') || text.includes('no watermark') || text.includes('without watermark') || (text.includes('download') && text.length < 30)) {
      return item;
    }
  }

  // 4. Try searching shadow roots clickables by text
  const shadowClickables = findAllElementsInShadow(document, 'button, a, [role="button"]');
  for (const item of shadowClickables) {
    const text = item.textContent.trim().toLowerCase();
    if (text === 'download' || text.includes('download video') || text.includes('download mp4') || text.includes('no watermark') || text.includes('without watermark') || (text.includes('download') && text.length < 30)) {
      return item;
    }
  }

  // 5. Check for any video element
  const video = document.querySelector('video') || findElementInShadow(document, 'video');
  if (video && video.src && (video.src.startsWith('http') || video.src.startsWith('blob'))) {
    return video;
  }

  return null;
}

// Trigger Render Automation
function handleRenderTrigger() {
  console.log("[Auto HeyGen Downloader] Scanning viewport for the active editor 'Render Scene' or Submit button...");

  const selectors = [
    'button[data-testid="submit-btn"]',
    'button[data-testid="generate-btn"]',
    'button[data-testid="render-btn"]',
    'button[data-testid="export-btn"]',
    'button[data-testid="render-scene-btn"]',
    'button[data-testid="create-video-btn"]',
    'button.heygen-submit-button',
    'button.generate-btn',
    'button.submit-btn',
    'button.render-btn',
    'button.editor-submit-button',
    '.editor-header-right button',
    '[class*="SubmitButton"]',
    '[class*="GenerateButton"]',
    '[class*="RenderButton"]',
    '[class*="ExportButton"]',
    '[class*="render"] button',
    '[class*="generate"] button',
    '[class*="submit"] button',
    'header button',
    'main button'
  ];

  let renderButton = null;

  for (const selector of selectors) {
    const el = document.querySelector(selector) || findElementInShadow(document, selector);
    if (el) {
      const txt = el.textContent.trim().toLowerCase();
      if (txt.includes("render scene") || txt.includes("submit") || txt.includes("generate") || txt.includes("render") || txt.includes("export")) {
        renderButton = el;
        console.log(`[Auto HeyGen Downloader] Found button matching selector: "${selector}" with text: "${txt}"`);
        break;
      }
    }
  }

  if (!renderButton) {
    const allButtons = [
      ...Array.from(document.querySelectorAll('button')),
      ...findAllElementsInShadow(document, 'button')
    ];
    
    renderButton = allButtons.find(btn => {
      const text = btn.textContent.trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const title = (btn.getAttribute("title") || "").toLowerCase();
      return text.includes("render scene") || aria.includes("render") || title.includes("render") || text.includes("create video") || text.includes("export video");
    });

    if (!renderButton) {
      renderButton = allButtons.find(btn => {
        const text = btn.textContent.trim().toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        const title = (btn.getAttribute("title") || "").toLowerCase();
        return text.includes("submit") || text.includes("generate") || text.includes("render") || text.includes("export") || aria.includes("submit") || title.includes("submit");
      });
    }
  }

  if (renderButton) {
    console.log("[Auto HeyGen Downloader] Success! Triggering programmatic click on:", renderButton);
    renderButton.click();
    
    // Auto-confirm nested modals if they appear immediately
    handlePotentialModals();
    return true;
  }

  console.error("[Auto HeyGen Downloader] Could not find any suitable 'Render Scene', 'Render', 'Submit', or 'Generate' button.");
  return false;
}

// Watch for confirmation dialogs that ask "Are you sure you want to generate?"
function handlePotentialModals() {
  let modalCheckCount = 0;
  const modalInterval = setInterval(() => {
    modalCheckCount++;
    
    const selectors = 'dialog button, .modal button, [class*="modal"] button, [class*="dialog"] button, [class*="overlay"] button, [class*="popup"] button';
    const modalButtons = [
      ...Array.from(document.querySelectorAll(selectors)),
      ...findAllElementsInShadow(document, selectors)
    ];

    if (modalButtons.length > 0) {
      const confirmButton = modalButtons.find(btn => {
        const text = btn.textContent.trim().toLowerCase();
        return text === "submit" || text === "generate" || text.includes("confirm") || text === "yes" || text === "ok" || text.includes("continue");
      });

      if (confirmButton) {
        console.log("[Auto HeyGen Downloader] Detected secondary confirmation modal button! Auto-clicking:", confirmButton);
        confirmButton.click();
        clearInterval(modalInterval);
        safeSendMessage({ action: "progressUpdate", stage: "Render Confirmed & Started!" });
      }
    }

    if (modalCheckCount > 12) {
      clearInterval(modalInterval);
    }
  }, 500);
}

function initChatActionButton() {
  if (chatActionObserver) return;

  const createButton = () => {
    if (chatActionButton || !document.body) return;

    const button = document.createElement("button");
    button.id = "heygen-flux-chat-action";
    button.type = "button";
    button.textContent = "Render & Auto Download";
    button.title = "Start render and auto-download from the chat view";
    button.style.cssText = [
      "position: fixed",
      "top: 16px",
      "right: 16px",
      "z-index: 2147483647",
      "padding: 8px 12px",
      "border: 1px solid #ffffff",
      "border-radius: 999px",
      "background: #ffffff",
      "color: #000000",
      "font-size: 12px",
      "font-weight: 700",
      "cursor: pointer",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2)"
    ].join(";");

    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Starting...";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Render & Auto Download";
      }, 1800);

      const success = handleRenderTrigger();
      if (success) {
        safeSendMessage({ action: "progressUpdate", stage: "Render started from chat view" });
      } else {
        safeSendMessage({ action: "progressUpdate", stage: "Render button not found in the current chat/editor view" });
      }
    });

    const host = findChatActionHost();
    if (host) {
      host.appendChild(button);
    } else {
      document.body.appendChild(button);
    }

    chatActionButton = button;
  };

  const findChatActionHost = () => {
    const candidates = Array.from(document.querySelectorAll("form, [role='textbox'], textarea, [contenteditable='true'], [class*='chat' i], [class*='conversation' i], [class*='message' i]"));
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && candidate.textContent.trim()) {
        if (candidate.tagName === "FORM" || candidate.getAttribute("role") === "textbox" || candidate.tagName === "TEXTAREA" || candidate.isContentEditable) {
          return candidate;
        }
      }
    }

    return null;
  };

  createButton();

  chatActionObserver = new MutationObserver(() => {
    if (!chatActionButton) {
      createButton();
    }
  });

  chatActionObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.addEventListener("load", () => createButton());
}

// Start continuous monitoring of the DOM
function initContinuousMonitoring() {
  console.log("[Auto HeyGen Downloader] Monitoring page continuously for rendering and download elements...");

  if (progressObserver) {
    progressObserver.disconnect();
  }

  progressObserver = new MutationObserver((mutations) => {
    const bodyText = document.body.innerText;
    
    // Detect if rendering, generating or exporting is happening
    const isPreparing = bodyText.includes("Preparing") || bodyText.includes("Processing");
    const isRendering = bodyText.includes("Rendering") || bodyText.includes("Generating") || bodyText.includes("Exporting");
    
    if (isPreparing || isRendering) {
      if (lastState !== "rendering") {
        lastState = "rendering";
        hasDownloadedThisCompletedSession = false; // Reset downloaded state for this new rendering cycle!
        console.log("[Auto HeyGen Downloader] Active render phase started. Resetting downloaded block.");
      }

      let currentStage = isPreparing ? "Preparing Project..." : "Rendering frames...";
      safeSendMessage({
        action: "progressUpdate",
        stage: currentStage
      });
    } else {
      // Rendering not actively running. Check if we have a download element available.
      const dlElement = findDownloadElement();
      if (dlElement) {
        if (lastState !== "completed") {
          lastState = "completed";
          console.log("[Auto HeyGen Downloader] Download element detected on page.");
          
          safeSendMessage({
            action: "progressUpdate",
            stage: "Completed",
            progress: 100
          });
        }

        // Check Auto Download setting
        safeStorageGet("autoDownload", (result) => {
          const isAuto = result.autoDownload === true;
          if (isAuto && !hasDownloadedThisCompletedSession) {
            hasDownloadedThisCompletedSession = true; // Block duplicate triggers instantly
            console.log("[Auto HeyGen Downloader] Auto Download is ON. Triggering automated click on:", dlElement);
            
            // Extract info if available
            let downloadUrl = null;
            let filename = "heygen_render_" + Date.now() + ".mp4";

            if (dlElement.tagName === "A" && dlElement.href) {
              downloadUrl = dlElement.href;
              if (dlElement.download) filename = dlElement.download;
            } else if (dlElement.tagName === "VIDEO" && dlElement.src) {
              downloadUrl = dlElement.src;
            }

            dlElement.click();

            // Send trigger download status
            safeSendMessage({
              action: "triggerDownload",
              downloadUrl: downloadUrl,
              filename: filename,
              alreadyDownloaded: true
            });
          }
        });
      } else {
        // If no download button and we were completed/rendering, change back to idle
        if (lastState === "rendering" || lastState === "completed") {
          // Keep a small buffer before resetting to idle in case of transient DOM renders
          setTimeout(() => {
            if (!findDownloadElement() && !document.body.innerText.includes("Rendering") && !document.body.innerText.includes("Preparing")) {
              lastState = "idle";
              safeSendMessage({
                action: "progressUpdate",
                stage: "Waiting for Render",
                progress: 0
              });
            }
          }, 1500);
        }
      }
    }
  });

  progressObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}
