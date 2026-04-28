#!/bin/bash
# Build a Chrome Web Store-ready zip file for Docs Shotter
set -e

ZIP_NAME="docs-shotter.zip"

# Remove old zip if it exists
rm -f "$ZIP_NAME"

# Create zip with only the extension files (manifest must be at root)
zip -r "$ZIP_NAME" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.js \
  offscreen.html \
  offscreen.js \
  icons/

echo "Created $ZIP_NAME"
