// Docs Shotter - Offscreen Document (offscreen.js)
// Handles image cropping using a canvas element.
// Service workers can't use canvas/Image, so this runs in an offscreen doc.

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "cropImage") {
    cropImage(message)
      .then((dataUrl) => {
        chrome.runtime.sendMessage({
          action: "cropResult",
          messageId: message.messageId,
          dataUrl,
        });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          action: "cropResult",
          messageId: message.messageId,
          error: err.message,
        });
      });
  }
});

async function cropImage({ dataUrl, rect, dpr, paddingCss = 0 }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      // Expand the crop by paddingCss on each side so the screenshot
      // includes surrounding page pixels, then scale by DPR.
      const sx = Math.round((rect.x - paddingCss) * dpr);
      const sy = Math.round((rect.y - paddingCss) * dpr);
      const sw = Math.round((rect.width + paddingCss * 2) * dpr);
      const sh = Math.round((rect.height + paddingCss * 2) * dpr);

      // Clamp to the visible screenshot (viewport edges)
      const clampedSx = Math.max(0, sx);
      const clampedSy = Math.max(0, sy);
      const clampedSw = Math.min(sx + sw, img.width) - clampedSx;
      const clampedSh = Math.min(sy + sh, img.height) - clampedSy;

      if (clampedSw <= 0 || clampedSh <= 0) {
        reject(new Error("Element is not visible in the viewport"));
        return;
      }

      canvas.width = clampedSw;
      canvas.height = clampedSh;
      ctx.drawImage(
        img,
        clampedSx, clampedSy, clampedSw, clampedSh,
        0, 0, clampedSw, clampedSh
      );
      resolve(canvas.toDataURL("image/png"));
    };

    img.onerror = () => {
      reject(new Error("Failed to load screenshot for cropping"));
    };

    img.src = dataUrl;
  });
}
