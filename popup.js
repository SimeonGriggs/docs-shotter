// Docs Shotter - Popup Script (popup.js)
// Manages the padding checkbox state and triggers capture via the service worker.

const checkbox = document.getElementById("padding-checkbox");
const captureBtn = document.getElementById("capture-btn");
const viewportBtn = document.getElementById("viewport-btn");

// Load saved preference (default: true)
chrome.storage.local.get({ addPadding: true }, (result) => {
  checkbox.checked = result.addPadding;
});

// Persist on change
checkbox.addEventListener("change", () => {
  chrome.storage.local.set({ addPadding: checkbox.checked });
});

// Start element capture
captureBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.runtime.sendMessage({
    action: "startCapture",
    tabId: tab.id,
    addPadding: checkbox.checked,
  });

  // Close the popup so it doesn't appear in the screenshot
  window.close();
});

// Start viewport capture
viewportBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.runtime.sendMessage({
    action: "captureViewport",
    tabId: tab.id,
  });

  // Close the popup so it doesn't appear in the screenshot
  window.close();
});
