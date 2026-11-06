# Docs Shotter

A Chrome extension that captures any DOM element or the full viewport as PNG screenshots in both light and dark mode. Useful for documentation, blog posts, and design reviews where you need assets in both color schemes.

## Features

- **Element capture** -- click any element on the page to screenshot just that element
- **Viewport capture** -- capture the entire visible viewport
- **Automatic light/dark** -- every capture produces two PNGs, one per color scheme
- **Optional context** -- include 20px of surrounding page around element captures

## How it works

1. Click the Docs Shotter icon in the toolbar
2. Choose **Capture Element** or **Capture Viewport**
3. For element capture, hover over the page and click the element you want
4. Two PNG files download automatically: one in the current color scheme, one in the opposite

Press **Esc** to cancel element selection.

## Installation

### From source

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this directory

### From the Chrome Web Store

_Coming soon._

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab to capture screenshots and inject the element picker |
| `scripting` | Inject the element picker content script into the active tab |
| `debugger` | Emulate `prefers-color-scheme` via Chrome DevTools Protocol (no other API exposes this) |
| `downloads` | Save captured PNGs to the downloads folder |
| `offscreen` | Crop screenshots using Canvas in an offscreen document (service workers can't use Canvas) |
| `storage` | Persist the padding checkbox preference |

## Privacy

Docs Shotter does not collect, transmit, or store any user data. All screenshots are saved locally to the user's downloads folder. The debugger permission is used solely to emulate light/dark color schemes for screenshot capture. No data leaves the browser.

## Building

To create a zip for Chrome Web Store upload:

```sh
./build-zip.sh
```

This produces `docs-shotter.zip` with the manifest at the root.

## License

MIT
