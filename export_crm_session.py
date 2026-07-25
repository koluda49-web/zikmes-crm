"""
Экспортирует сессию CRM-парсера (bot.py) из запущенного Chrome в base64-строку
для переменной окружения CRM_STORAGE_STATE на Render.

Запуск:
  1. Откройте Chrome с --remote-debugging-port=9222
  2. Войдите на a.ok-crm.com и в Google (drive.google.com)
  3. python export_crm_session.py
  4. Скопируйте выведенную строку в Render -> Environment -> CRM_STORAGE_STATE
"""

import sys
import json
import base64

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Ошибка: playwright не установлен. pip install playwright")


def main():
    print("Подключаюсь к Chrome на порту 9222...")
    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception as e:
            sys.exit(
                f"Не удалось подключиться: {e}\n"
                "Запустите Chrome с флагом --remote-debugging-port=9222"
            )

        contexts = browser.contexts
        if not contexts:
            sys.exit("Нет контекстов в браузере. Откройте нужные вкладки.")

        ctx = contexts[0]
        state = ctx.storage_state()
        browser.close()

    state_json = json.dumps(state, ensure_ascii=False)
    encoded = base64.b64encode(state_json.encode("utf-8")).decode("ascii")

    print()
    print("=" * 60)
    print("Скопируйте строку ниже в Render -> Environment -> CRM_STORAGE_STATE:")
    print("=" * 60)
    print(encoded)
    print("=" * 60)

    out_file = "crm_storage_state.b64"
    with open(out_file, "w", encoding="ascii") as f:
        f.write(encoded)
    print(f"\nТакже сохранено в файл: {out_file}")


if __name__ == "__main__":
    main()
