#!/bin/bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Playwright Chromium with system deps ==="
playwright install --with-deps chromium

echo "=== Build complete ==="
