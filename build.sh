#!/bin/bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Playwright Chromium ==="
export PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/src/.pw-browsers
# --with-deps использует 'su' (нет пароля на Render) → ошибка аутентификации.
# Используем 'sudo playwright install-deps' отдельно от установки браузера.
sudo playwright install-deps chromium 2>/dev/null || true
playwright install chromium

echo "=== Build complete ==="
