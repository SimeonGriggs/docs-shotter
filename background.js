// Docs Shotter - Service Worker (background.js)
// Orchestrates: debugger attachment, element selection, screenshot capture,
// color scheme toggling, image cropping, and file downloads.

const CAPTURE_DELAY_MS = 600; // wait for CSS transitions after theme toggle

// Track state per tab
const tabState = new Map();

// ── Start capture (triggered from popup) ────────────────────────────────────
async function startCapture(tabId, addPadding) {
  const tab = await chrome.tabs.get(tabId);

  // Don't run on chrome:// or extension pages
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return;
  }

  const existing = tabState.get(tab.id);
  if (existing?.active) {
    // Already active — cancel
    await cancelSession(tab.id);
    return;
  }

  try {
    // 1. Attach debugger first (before element selection starts)
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");

    tabState.set(tab.id, { active: true, tabId: tab.id, addPadding });

    // 2. Detect current color scheme preference
    const currentScheme = await detectCurrentScheme(tab.id);
    tabState.get(tab.id).originalScheme = currentScheme;

    // 3. Inject and activate the content script for element picking
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    // 4. Tell content script to start picking
    await chrome.tabs.sendMessage(tab.id, { action: "startPicking" });
  } catch (err) {
    console.error("Failed to start Docs Shotter:", err);
    await cancelSession(tab.id);
  }
}

// ── Viewport capture (triggered from popup) ─────────────────────────────────
async function captureViewport(tabId) {
  const tab = await chrome.tabs.get(tabId);

  // Don't run on chrome:// or extension pages
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return;
  }

  try {
    // 1. Attach debugger for color scheme emulation
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");

    // 2. Detect current color scheme
    const originalScheme = await detectCurrentScheme(tab.id);
    const oppositeScheme = originalScheme === "dark" ? "light" : "dark";

    // 3. Small delay to let the popup fully close before capturing
    await sleep(150);

    // 4. Capture the viewport in the current color scheme
    const screenshot1 = await chrome.tabs.captureVisibleTab(null, { format: "png" });

    // 5. Toggle to opposite scheme
    await setEmulatedColorScheme(tab.id, oppositeScheme);

    // 6. Wait for CSS transitions / repaints
    await sleep(CAPTURE_DELAY_MS);

    // 7. Capture the viewport in the opposite color scheme
    const screenshot2 = await chrome.tabs.captureVisibleTab(null, { format: "png" });

    // 8. Restore original scheme and clear emulation
    await setEmulatedColorScheme(tab.id, originalScheme);
    await clearEmulatedColorScheme(tab.id);

    // 9. Detach debugger
    try {
      await chrome.debugger.detach({ tabId: tab.id });
    } catch {
      // ignore
    }

    // 10. Generate filenames and download
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename1 = `docs-shotter-${originalScheme}-${timestamp}.png`;
    const filename2 = `docs-shotter-${oppositeScheme}-${timestamp}.png`;

    await downloadDataUrl(screenshot1, filename1);
    await downloadDataUrl(screenshot2, filename2);

    // 11. Show toast via content script (if available)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, {
        action: "captureComplete",
        filenames: [filename1, filename2],
      });
    } catch {
      // Content script may not be available, that's ok
    }
  } catch (err) {
    console.error("Viewport capture failed:", err?.message, err?.stack);
    try {
      await chrome.debugger.detach({ tabId: tab.id });
    } catch {
      // ignore
    }
  }
}

// ── Messages from popup and content script ──────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCapture") {
    // From popup — element capture mode
    startCapture(message.tabId, message.addPadding);
    sendResponse({ ok: true });
  } else if (message.action === "captureViewport") {
    // From popup — viewport capture mode
    captureViewport(message.tabId);
    sendResponse({ ok: true });
  } else if (message.action === "elementSelected" && sender.tab) {
    handleElementSelected(sender.tab.id, message.rect, message.devicePixelRatio);
    sendResponse({ ok: true });
  } else if (message.action === "selectionCancelled" && sender.tab) {
    cancelSession(sender.tab.id);
    sendResponse({ ok: true });
  }
  // cropImage and cropResult messages are handled by their own listeners
  return false;
});

// ── Handle debugger detach ──────────────────────────────────────────────────
chrome.debugger.onDetach.addListener((source) => {
  const state = tabState.get(source.tabId);
  if (state) {
    state.active = false;
    tabState.delete(source.tabId);
  }
});

// ── Core capture flow ───────────────────────────────────────────────────────
async function handleElementSelected(tabId, rect, devicePixelRatio) {
  const state = tabState.get(tabId);
  if (!state) return;

  try {
    const dpr = devicePixelRatio || 1;
    const originalScheme = state.originalScheme || "light";
    const oppositeScheme = originalScheme === "dark" ? "light" : "dark";

    const paddingCss = state.addPadding ? 20 : 0;

    // Ensure all extension UI is removed from the page before capturing.
    // The content script already does this, but we double-check and wait
    // for a full repaint cycle so nothing appears in the screenshot.
    await removeAllUI(tabId);

    // Capture 1: current color scheme
    const screenshot1 = await captureAndCrop(tabId, rect, dpr, paddingCss);

    // Toggle to opposite scheme
    await setEmulatedColorScheme(tabId, oppositeScheme);

    // Wait for CSS transitions/repaints
    await sleep(CAPTURE_DELAY_MS);

    // Re-measure element position (layout may have shifted)
    const newRect = await remeasureElement(tabId);
    const captureRect = newRect || rect;

    // Capture 2: opposite color scheme
    const screenshot2 = await captureAndCrop(tabId, captureRect, dpr, paddingCss);

    // Restore original scheme
    await setEmulatedColorScheme(tabId, originalScheme);
    // Clear the emulation override entirely
    await clearEmulatedColorScheme(tabId);

    // Generate filenames
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename1 = `docs-shotter-${originalScheme}-${timestamp}.png`;
    const filename2 = `docs-shotter-${oppositeScheme}-${timestamp}.png`;

    // Download both images
    await downloadDataUrl(screenshot1, filename1);
    await downloadDataUrl(screenshot2, filename2);

    // Notify user via content script
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: "captureComplete",
        filenames: [filename1, filename2],
      });
    } catch {
      // Content script may have been removed, that's ok
    }
  } catch (err) {
    console.error("Capture failed:", err);
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: "captureError",
        error: err.message,
      });
    } catch {
      // ignore
    }
  } finally {
    await cancelSession(tabId);
  }
}

// ── Screenshot + crop ───────────────────────────────────────────────────────
async function captureAndCrop(tabId, rect, dpr, paddingCss = 0) {
  // Capture the full visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: "png",
  });

  // Crop using offscreen document
  const cropped = await cropWithOffscreen(dataUrl, rect, dpr, paddingCss);
  return cropped;
}

// ── Offscreen document for canvas cropping ──────────────────────────────────
let offscreenCreated = false;

async function ensureOffscreenDocument() {
  if (offscreenCreated) return;

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Crop screenshot images using canvas and Blob URLs",
    });
    offscreenCreated = true;
  } catch (err) {
    // Document may already exist
    if (!err.message?.includes("Only a single offscreen")) {
      throw err;
    }
    offscreenCreated = true;
  }
}

async function cropWithOffscreen(dataUrl, rect, dpr, paddingCss = 0) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const messageId = `crop-${Date.now()}-${Math.random()}`;

    const listener = (message) => {
      if (message.action === "cropResult" && message.messageId === messageId) {
        chrome.runtime.onMessage.removeListener(listener);
        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.dataUrl);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime.sendMessage({
      action: "cropImage",
      messageId,
      dataUrl,
      rect,
      dpr,
      paddingCss,
    });
  });
}

// ── Debugger / Emulation helpers ────────────────────────────────────────────
async function detectCurrentScheme(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression:
          "window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'",
        returnByValue: true,
      }
    );
    return result.result.value;
  } catch {
    return "light";
  }
}

async function setEmulatedColorScheme(tabId, scheme) {
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
}

async function clearEmulatedColorScheme(tabId) {
  await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
    features: [],
  });
}

async function remeasureElement(tabId) {
  try {
    // Use scripting.executeScript which runs in the content script's isolated
    // world where __docsShotter_selectedElement was stored.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const el = window.__docsShotter_selectedElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
    });
    if (results?.[0]?.result) {
      return results[0].result;
    }
  } catch {
    // ignore
  }
  return null;
}

// Remove all extension UI elements and wait for a repaint so they don't
// appear in the screenshot. Returns only after a rAF+rAF
// (double requestAnimationFrame guarantees the browser has
// actually composited the frame without our elements).
async function removeAllUI(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve) => {
          // Remove any lingering extension elements
          const ids = ["ds-highlight-overlay", "ds-highlight-label", "ds-toast"];
          for (const id of ids) {
            const el = document.getElementById(id);
            if (el) el.remove();
          }
          // Double-rAF: first rAF schedules work before next paint,
          // second rAF ensures that paint has been
          // flushed before we signal readiness.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
      },
    });
  } catch {
    // Fallback: just wait a bit
    await sleep(100);
  }
}

// ── Download helper ─────────────────────────────────────────────────────────
async function downloadDataUrl(dataUrl, filename) {
  return chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
  });
}

// ── Session cleanup ─────────────────────────────────────────────────────────
async function cancelSession(tabId) {
  const state = tabState.get(tabId);
  tabState.delete(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, { action: "stopPicking" });
  } catch {
    // ignore
  }

  if (state?.active) {
    try {
      await clearEmulatedColorScheme(tabId);
    } catch {
      // ignore
    }
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // ignore
    }
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
