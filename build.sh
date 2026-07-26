#!/bin/bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Playwright Chromium ==="
export PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/src/.pw-browsers
playwright install chromium chromium-headless-shell

echo "=== Build complete ==="
