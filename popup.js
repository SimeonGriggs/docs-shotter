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

async function triggerCapture(message) {
  captureBtn.disabled = true;
  viewportBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Await the service worker handshake before closing. If the SW is asleep,
  // closing immediately tears down the message port and the first click is lost.
  const payload = { ...message, tabId: tab.id };
  try {
    await chrome.runtime.sendMessage(payload);
  } catch {
    try {
      await chrome.runtime.sendMessage(payload);
    } catch (err) {
      console.error("Docs Shotter: failed to reach service worker", err);
    }
  }

  window.close();
}

captureBtn.addEventListener("click", () =>
  triggerCapture({
    action: "startCapture",
    addPadding: checkbox.checked,
  })
);

viewportBtn.addEventListener("click", () =>
  triggerCapture({ action: "captureViewport" })
);
