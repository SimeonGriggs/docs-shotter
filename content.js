// Docs Shotter - Content Script (content.js)
// Handles element picking: hover highlight, tooltip, click to select.
// Communicates selected element rect back to the service worker.

(function () {
  // Guard against double-injection
  if (window.__docsShotter_injected) return;
  window.__docsShotter_injected = true;

  // ── State ───────────────────────────────────────────────────────────────
  let active = false;
  let hoveredElement = null;
  let overlay = null;
  let label = null;
  let toast = null;

  // ── Create overlay elements ─────────────────────────────────────────────
  function createOverlay() {
    overlay = document.createElement("div");
    overlay.id = "ds-highlight-overlay";
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(59, 130, 246, 0.12);
      border: 2px solid rgba(59, 130, 246, 0.8);
      border-radius: 2px;
      transition: top 0.06s ease-out, left 0.06s ease-out,
                  width 0.06s ease-out, height 0.06s ease-out;
      box-sizing: border-box;
      display: none;
    `;
    document.documentElement.appendChild(overlay);

    label = document.createElement("div");
    label.id = "ds-highlight-label";
    label.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.82);
      color: #fff;
      font: 11px/1.4 SFMono-Regular, Menlo, Consolas, monospace;
      padding: 2px 7px;
      border-radius: 3px;
      white-space: nowrap;
      display: none;
    `;
    document.documentElement.appendChild(label);
  }

  function removeOverlay() {
    overlay?.remove();
    label?.remove();
    overlay = null;
    label = null;
  }

  // ── Update overlay position ─────────────────────────────────────────────
  function updateOverlay(el) {
    if (!el || !overlay) return;

    const rect = el.getBoundingClientRect();

    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.display = "block";

    // Label text: <tagname.class> WxH
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    const dims = `${Math.round(rect.width)}\u00d7${Math.round(rect.height)}`;
    label.textContent = `<${tag}${classes}> ${dims}`;

    // Position label: prefer above the element, flip below if no room
    const labelHeight = 20;
    const gap = 4;
    let labelTop = rect.top - labelHeight - gap;
    if (labelTop < 2) {
      labelTop = rect.bottom + gap;
    }
    let labelLeft = rect.left;
    if (labelLeft < 2) labelLeft = 2;

    label.style.top = labelTop + "px";
    label.style.left = labelLeft + "px";
    label.style.display = "block";
  }

  // ── Toast notification ──────────────────────────────────────────────────
  function showToast(message, isError = false, durationMs = 3000) {
    removeToast();
    toast = document.createElement("div");
    toast.id = "ds-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: ${isError ? "rgba(220, 38, 38, 0.92)" : "rgba(0, 0, 0, 0.85)"};
      color: #fff;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 8px 16px;
      border-radius: 8px;
      pointer-events: none;
      max-width: 400px;
      text-align: center;
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      if (toast) {
        toast.style.opacity = "0";
        setTimeout(removeToast, 300);
      }
    }, durationMs);
  }

  function removeToast() {
    toast?.remove();
    toast = null;
  }

  // ── Event handlers ──────────────────────────────────────────────────────
  function pageElementFromPoint(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find((el) => !el.id?.startsWith("ds-")) || null;
  }

  function onMouseMove(e) {
    if (!active) return;

    const el = pageElementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    hoveredElement = el;
    updateOverlay(el);
  }

  function onMouseDown(e) {
    if (!active) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!active) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!hoveredElement) {
      hoveredElement = pageElementFromPoint(e.clientX, e.clientY);
    }
    if (!hoveredElement) return;

    // Lock the selected element immediately so subsequent mousemove
    // events can't change it during the scroll/measure delay.
    const selectedElement = hoveredElement;
    active = false; // stop processing mousemove immediately

    // Store reference for re-measurement after theme toggle
    window.__docsShotter_selectedElement = selectedElement;

    // Scroll element into view if needed
    selectedElement.scrollIntoView({ block: "nearest", inline: "nearest" });

    // Small delay for scroll to settle, then measure
    setTimeout(() => {
      const rect = selectedElement.getBoundingClientRect();
      const data = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };

      // Remove ALL extension UI from the page before capture
      stopPicking();
      removeToast();
      removeAllExtensionUI();

      // Send rect to service worker (no toast -- it would appear in screenshot)
      chrome.runtime.sendMessage({
        action: "elementSelected",
        rect: data,
        devicePixelRatio: window.devicePixelRatio,
      });
    }, 150);
  }

  function onKeyDown(e) {
    if (!active) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopPicking();
      chrome.runtime.sendMessage({ action: "selectionCancelled" });
    }
  }

  function ensureHoverShield() {
    let block = document.getElementById("ds-hover-block");
    if (!block) {
      block = document.createElement("div");
      block.id = "ds-hover-block";
      block.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: transparent;
      `;
      document.documentElement.appendChild(block);
    }
    block.style.cursor = "crosshair";
  }

  // ── Start / stop picking ────────────────────────────────────────────────
  function startPicking() {
    if (active) return;
    active = true;
    hoveredElement = null;

    // Steal hit-testing so page :hover never activates while picking.
    ensureHoverShield();
    createOverlay();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    document.documentElement.style.cursor = "crosshair";

    showToast("Click an element to capture. Press Esc to cancel.");
  }

  function stopPicking() {
    active = false;
    hoveredElement = null;

    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("keydown", onKeyDown, true);

    document.documentElement.style.cursor = "";
    removeOverlay();
  }

  // ── Listen for messages from service worker ─────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startPicking") {
      startPicking();
      sendResponse({ ok: true });
    } else if (message.action === "stopPicking") {
      stopPicking();
      if (message.removeToast) removeToast();
      sendResponse({ ok: true });
    } else if (message.action === "captureComplete") {
      showToast(`Saved: ${message.filenames.join(", ")}`, false, 1500);
      cleanup();
      sendResponse({ ok: true });
    } else if (message.action === "captureError") {
      showToast(`Error: ${message.error}`, true);
      cleanup();
      sendResponse({ ok: true });
    }
    return false;
  });

  // Remove picker chrome before capture. Leave ds-hover-block so the page
  // stays in its rest state while the screenshot is taken.
  function removeAllExtensionUI() {
    const ids = ["ds-highlight-overlay", "ds-highlight-label", "ds-toast"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    overlay = null;
    label = null;
    toast = null;
  }

  function cleanup() {
    window.__docsShotter_selectedElement = null;
    window.__docsShotter_injected = false;
  }
})();
