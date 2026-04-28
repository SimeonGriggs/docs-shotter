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

      // Scale rect by device pixel ratio to match the screenshot resolution
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);

      // Clamp to image bounds
      const clampedSx = Math.max(0, sx);
      const clampedSy = Math.max(0, sy);
      const clampedSw = Math.min(sw, img.width - clampedSx);
      const clampedSh = Math.min(sh, img.height - clampedSy);

      if (clampedSw <= 0 || clampedSh <= 0) {
        reject(new Error("Element is not visible in the viewport"));
        return;
      }

      // Padding in actual image pixels (CSS pixels scaled by DPR)
      const pad = Math.round(paddingCss * dpr);

      if (pad <= 0) {
        // No padding — original behavior
        canvas.width = clampedSw;
        canvas.height = clampedSh;
        ctx.drawImage(
          img,
          clampedSx, clampedSy, clampedSw, clampedSh,
          0, 0, clampedSw, clampedSh
        );
        resolve(canvas.toDataURL("image/png"));
        return;
      }

      // ── Padding path ────────────────────────────────────────────────
      // First, crop the element onto a temporary canvas so we can sample
      // its corner pixels for the padding fill colors.
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = clampedSw;
      tmpCanvas.height = clampedSh;
      const tmpCtx = tmpCanvas.getContext("2d");
      tmpCtx.drawImage(
        img,
        clampedSx, clampedSy, clampedSw, clampedSh,
        0, 0, clampedSw, clampedSh
      );

      // Sample the four corner pixels
      const tl = pixelColor(tmpCtx, 0, 0);
      const tr = pixelColor(tmpCtx, clampedSw - 1, 0);
      const bl = pixelColor(tmpCtx, 0, clampedSh - 1);
      const br = pixelColor(tmpCtx, clampedSw - 1, clampedSh - 1);

      // Set up the final canvas with padding
      const finalW = clampedSw + pad * 2;
      const finalH = clampedSh + pad * 2;
      canvas.width = finalW;
      canvas.height = finalH;

      // Fill the four edge regions with the per-edge corner colors.
      // Layout:
      //   TL corner | Top edge (tl color)      | TR corner
      //   Left edge | [cropped image]           | Right edge
      //   BL corner | Bottom edge (bl color)    | BR corner
      //
      // Top edge + top-left corner: tl color
      // Top-right corner: tr color
      // Bottom edge + bottom-left corner: bl color
      // Bottom-right corner: br color
      // Left edge: tl color
      // Right edge: tr color

      // Top padding strip (full width)
      ctx.fillStyle = tl;
      ctx.fillRect(0, 0, finalW, pad);
      // Top-right corner patch
      ctx.fillStyle = tr;
      ctx.fillRect(pad + clampedSw, 0, pad, pad);

      // Bottom padding strip (full width)
      ctx.fillStyle = bl;
      ctx.fillRect(0, pad + clampedSh, finalW, pad);
      // Bottom-right corner patch
      ctx.fillStyle = br;
      ctx.fillRect(pad + clampedSw, pad + clampedSh, pad, pad);

      // Left padding strip (between top and bottom padding)
      ctx.fillStyle = tl;
      ctx.fillRect(0, pad, pad, clampedSh);

      // Right padding strip (between top and bottom padding)
      ctx.fillStyle = tr;
      ctx.fillRect(pad + clampedSw, pad, pad, clampedSh);

      // Draw the cropped image in the center
      ctx.drawImage(tmpCanvas, pad, pad);

      resolve(canvas.toDataURL("image/png"));
    };

    img.onerror = () => {
      reject(new Error("Failed to load screenshot for cropping"));
    };

    img.src = dataUrl;
  });
}

// Read a single pixel and return an rgba() CSS color string
function pixelColor(ctx, x, y) {
  const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
