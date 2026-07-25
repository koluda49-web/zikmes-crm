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

import config
from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception as e:
            print("Не удалось подключиться к Chrome на порту 9222.")
            print("Проверьте, что Chrome запущен именно с флагом --remote-debugging-port=9222")
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
            print("Убедитесь, что в окне, запущенном с --remote-debugging-port, открыт a.ok-crm.com и вы залогинены.")
            return

        target_context.storage_state(path=config.STORAGE_STATE_PATH)
        print(f"Успех: сессия (cookies + localStorage) сохранена в {config.STORAGE_STATE_PATH}")
        print("Теперь можно закрыть то окно Chrome с отладочным портом и переходить к bot.py --dry-run")


if __name__ == "__main__":
    main()
