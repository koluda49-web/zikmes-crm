#!/bin/bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Playwright Chromium ==="
playwright install chromium chromium-headless-shell

echo "=== Build complete ==="
