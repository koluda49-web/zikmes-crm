"""
Подключается к уже запущенному Chrome (тому, что вы открыли командой с
--remote-debugging-port=9222) и сохраняет его текущую сессию - cookies И
localStorage - в storage_state.json.

Это надёжнее, чем читать cookies напрямую из профиля: вход был выполнен как
настоящий, ручной вход в живом браузере, никакой автоматизации на этапе
логина не было, поэтому Google его не блокирует. Здесь мы просто "подсматриваем"
результат этого входа.

ПЕРЕД ЗАПУСКОМ:
1. В отдельном окне cmd должен быть запущен Chrome:
   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-remote-profile"
2. В этом окне Chrome вы должны быть залогинены на a.ok-crm.com (видите список заказов).
3. Не закрывайте это окно Chrome, пока этот скрипт не отработает.
"""

import os
import subprocess
import time
import urllib.request

import config
from playwright.sync_api import sync_playwright

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CDP_PROFILE = r"C:\chrome-remote-profile"
CDP_URL = "http://localhost:9222"


def _cdp_alive() -> bool:
    try:
        urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=3)
        return True
    except Exception:
        return False


def _launch_chrome_cdp() -> bool:
    """Запускает Chrome с отладочным портом и выделенным профилем.
    Профиль хранит логины CRM и Google — повторная авторизация не нужна."""
    if not os.path.exists(CHROME_EXE):
        print(f"Chrome не найден: {CHROME_EXE}")
        return False
    print("Chrome с портом 9222 не запущен — запускаю сам...")
    subprocess.Popen([
        CHROME_EXE,
        "--remote-debugging-port=9222",
        f"--user-data-dir={CDP_PROFILE}",
        "https://a.ok-crm.com",
        "https://drive.google.com",
    ])
    for _ in range(20):
        time.sleep(1)
        if _cdp_alive():
            print("Chrome запущен, порт 9222 доступен.")
            time.sleep(3)  # даём вкладкам загрузиться
            return True
    print("Chrome запустился, но порт 9222 так и не открылся.")
    return False


def main():
    if not _cdp_alive():
        if not _launch_chrome_cdp():
            return

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            print("Не удалось подключиться к Chrome на порту 9222.")
            print(f"Техническая ошибка: {e}")
            return

        # Ищем среди открытых окон/вкладок то, где открыт a.ok-crm.com
        target_context = None
        for context in browser.contexts:
            for page in context.pages:
                if "ok-crm.com" in page.url:
                    target_context = context
                    break
            if target_context:
                break

        if target_context is None:
            print("Не нашёл открытую вкладку с a.ok-crm.com в этом Chrome.")
            print("Откройте a.ok-crm.com в окне Chrome с отладочным портом и запустите захват ещё раз.")
            print("Если сессия в этом окне протухла — залогиньтесь там заново.")
            return

        target_context.storage_state(path=config.STORAGE_STATE_PATH)
        print(f"Успех: сессия (cookies + localStorage) сохранена в {config.STORAGE_STATE_PATH}")
        print("Теперь можно закрыть то окно Chrome с отладочным портом и переходить к bot.py --dry-run")


if __name__ == "__main__":
    main()
