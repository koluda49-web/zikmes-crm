# -*- coding: utf-8 -*-
"""
bot.py — парсер просроченных платежей по рассрочке из a.ok-crm.com.

Логика:
  1. Открыть список заказов с фильтром
     Метод оплаты=Расчетный счет, Банк=Фирма рассрочка, Статус=Сдан
  2. Собрать ID заказов и телефоны прямо из списка (телефон уже виден
     в таблице заказов — не нужно открывать каждую карточку ради этого).
  3. Для каждого заказа открыть карточку и распарсить блок "Платежи".
  4. Платёж считается просроченным, если:
        (сегодня - Истекает).days > OVERDUE_DAYS
        и Статус not in PAID_STATUSES
  5. Уже уведомлённые (пока не оплачены) платежи пропускаются — state_db.py.
  6. Новые совпадения -> Google Таблица (лист "Уведомления") + Excel-файл
     для робота СМС.

ПЕРЕД ПЕРВЫМ ЗАПУСКОМ: свериться с реальным сайтом и поправить
selectors.py (там расставлены пометки [ПРОВЕРИТЬ]). См. README.md.
"""

import base64
import csv
import os
import platform
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

import crm_selectors as sel
from phone_utils import normalize_phone
from state_db import is_already_notified, mark_notified
from google_sheet import send_to_google_sheet
from sms_export import write_sms_phones_file

BASE_DIR = Path(__file__).parent
PROFILE_DIR = BASE_DIR / "chrome_profile"
CONFIG_FILE = BASE_DIR / "config.txt"

IS_CLOUD = 'RENDER' in os.environ or platform.system() != 'Windows'

# В облаке грузим сессию CRM из env var CRM_STORAGE_STATE (base64 JSON)
CLOUD_STATE_FILE = BASE_DIR / "cloud_crm_state.json"
if IS_CLOUD:
    _state_env = os.environ.get('CRM_STORAGE_STATE', '')
    if _state_env:
        try:
            CLOUD_STATE_FILE.write_text(
                base64.b64decode(_state_env).decode('utf-8'), encoding='utf-8'
            )
        except Exception as _e:
            print(f"⚠️  Не удалось загрузить CRM_STORAGE_STATE: {_e}")
ERROR_SCREENSHOTS_DIR = BASE_DIR / "error_screenshots"
ERRORS_CSV = BASE_DIR / "errors.csv"
OUTPUT_DIR = BASE_DIR / "output"

MAX_EMPTY_PAGES_IN_A_ROW = 2  # сколько подряд пустых страниц считать концом списка


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        sys.exit(
            f"Не найден {CONFIG_FILE}.\n"
            f"Скопируйте config.example.txt в config.txt и заполните значения."
        )
    config = {}
    for line in CONFIG_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        config[key.strip()] = value.strip()
    return config


def log_error(order_id: str, kind: str, exc: Exception) -> None:
    ERROR_SCREENSHOTS_DIR.mkdir(exist_ok=True)
    is_new = not ERRORS_CSV.exists()
    with open(ERRORS_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(["время", "order_id", "тип_ошибки", "сообщение"])
        writer.writerow([datetime.now().isoformat(timespec="seconds"), order_id, kind, str(exc)])


def save_error_screenshot(page, order_id: str, kind: str) -> None:
    ERROR_SCREENSHOTS_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = ERROR_SCREENSHOTS_DIR / f"{order_id}_{kind}_{ts}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
        print(f"    [скриншот ошибки] {path}")
    except Exception:
        pass


def safe_goto(page, url: str, wait_until: str = "commit") -> None:
    """
    page.goto с защитой от гонки навигации (когда сама страница успела
    начать свой редирект в тот же момент, что и наш переход).
    """
    try:
        page.goto(url, wait_until=wait_until)
    except Exception:
        pass


def check_crm_session(page, orders_url: str) -> bool:
    """Проверяет, что список заказов реально загрузился (а не экран логина)."""
    safe_goto(page, orders_url)
    try:
        page.wait_for_selector(sel.ORDERS_TABLE_LOADED_XPATH, timeout=15000)
        return True
    except PWTimeout:
        return False


def wait_for_manual_login(page, orders_url: str) -> None:
    if IS_CLOUD:
        sys.exit(
            "❌ Сессия CRM истекла.\n"
            "Запустите export_crm_session.py локально и обновите\n"
            "env var CRM_STORAGE_STATE в Render Dashboard."
        )
    print(
        "\nСессия CRM не активна или устарела.\n"
        "1. В открывшемся окне Chrome войдите в CRM через Google вручную.\n"
        "2. Дождитесь, чтобы открылся список заказов.\n"
        "3. Вернитесь в эту консоль и нажмите Enter."
    )
    input("Нажмите Enter после входа... ")
    if not check_crm_session(page, orders_url):
        sys.exit("Не удалось подтвердить сессию CRM. Запустите скрипт заново.")


MAX_PAGES = 300  # защита от бесконечного перебора, если определение "пустой страницы" не сработает
PROGRESS_EVERY_N_PAGES = 5


def collect_candidate_orders(page, base_url: str, route_date_range: str = None) -> list:
    """
    Возвращает список словарей {"order_id": ..., "phone": ...} из
    отфильтрованного списка заказов (Метод оплаты=Расчетный счет,
    Банк=Фирма рассрочка, Статус=Сдан), проходя все страницы.

    ВАЖНО: эта CRM (типично для Yii2-пагинации) при запросе страницы за
    пределами реального диапазона не отдаёт пустой список, а повторно
    показывает содержимое последней существующей страницы. Поэтому
    основной сигнал конца списка — не "пустая страница", а "страница
    повторяет ID заказов предыдущей" (previous_page_ids).
    """
    candidates = []
    page_num = 1
    empty_in_a_row = 0
    previous_page_ids = None

    try:
        while True:
            if page_num > MAX_PAGES:
                print(
                    f"  ВНИМАНИЕ: достигнут предел в {MAX_PAGES} страниц — "
                    f"останавливаю сбор списка (возможно, фильтр не сработал "
                    f"и перебираются все заказы, а не только отфильтрованные)."
                )
                break

            url = sel.build_orders_url(base_url, page=page_num, route_date_range=route_date_range)
            if page_num % PROGRESS_EVERY_N_PAGES == 0 or page_num == 1:
                print(f"  Список заказов, страница {page_num} (найдено пока: {len(candidates)}): {url}")
            safe_goto(page, url)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except PWTimeout:
                pass

            if page.locator(sel.NO_RESULTS_XPATH).count() > 0:
                print(f"  Страница {page_num}: «Ничего не найдено» — список отфильтрованных заказов закончился здесь.")
                break

            try:
                page.wait_for_selector(sel.ORDER_ROW_XPATH, timeout=15000)
            except PWTimeout:
                empty_in_a_row += 1
                if empty_in_a_row >= MAX_EMPTY_PAGES_IN_A_ROW:
                    break
                page_num += 1
                continue

            rows = page.locator(sel.ORDER_ROW_XPATH)
            count = rows.count()
            if count == 0:
                empty_in_a_row += 1
                if empty_in_a_row >= MAX_EMPTY_PAGES_IN_A_ROW:
                    break
                page_num += 1
                continue

            empty_in_a_row = 0
            current_page_rows = []
            for i in range(count):
                row = rows.nth(i)
                cells = row.locator("td")
                try:
                    order_id = cells.nth(sel.LIST_COL["id"]).inner_text().strip()
                    phone_raw = cells.nth(sel.LIST_COL["phone"]).inner_text().strip()
                except Exception:
                    continue
                if not order_id:
                    continue
                current_page_rows.append({"order_id": order_id, "phone": phone_raw})

            current_page_ids = [r["order_id"] for r in current_page_rows]

            if current_page_ids and current_page_ids == previous_page_ids:
                print(
                    f"  Страница {page_num} повторяет предыдущую — похоже, "
                    f"список реально закончился на предыдущей странице. Останавливаюсь."
                )
                break

            candidates.extend(current_page_rows)
            previous_page_ids = current_page_ids
            page_num += 1

    except KeyboardInterrupt:
        print(f"\n  Остановлено вручную на странице {page_num}. Продолжаю с уже собранными {len(candidates)} заказами.")

    print(f"  Найдено кандидатов (заказы на рассрочке, статус Сдан): {len(candidates)}")
    return candidates


def parse_overdue_payments_for_order(page, base_domain: str, order_id: str, overdue_days: int, paid_statuses: set) -> list:
    """
    Открывает карточку заказа, возвращает список просроченных
    неоплаченных платежей: [{"amount":..., "expires":..., "status":...}, ...]
    """
    url = sel.order_view_url(base_domain, order_id)
    safe_goto(page, url)
    try:
        page.wait_for_selector(sel.PAYMENT_ROW_XPATH, timeout=15000)
    except PWTimeout:
        print(
            f"    [заказ {order_id}] блок «Платежи» не найден за 15 сек — "
            f"либо у заказа его правда нет, либо не сработал селектор PAYMENTS_PANEL_XPATH."
        )
        return []

    rows = page.locator(sel.PAYMENT_ROW_XPATH)
    count = rows.count()

    if count > 30:
        print(
            f"    ВНИМАНИЕ: у заказа {order_id} найдено подозрительно много строк "
            f"платежей ({count}) — возможно, селектор снова зацепил лишние таблицы. "
            f"Проверьте PAYMENTS_PANEL_XPATH в selectors.py."
        )

    overdue = []
    today = datetime.now().date()

    for i in range(count):
        row = rows.nth(i)
        cells = row.locator("td")
        try:
            amount = cells.nth(sel.PAYMENT_COL["amount"]).inner_text().strip()
            expires_raw = cells.nth(sel.PAYMENT_COL["expires"]).inner_text().strip()
            status = cells.nth(sel.PAYMENT_COL["status"]).inner_text().strip()
        except Exception:
            continue

        if not expires_raw or expires_raw in ("(не задано)", "-"):
            continue

        try:
            expires_date = datetime.strptime(expires_raw, "%d.%m.%Y").date()
        except ValueError:
            continue

        days_overdue = (today - expires_date).days
        if days_overdue > overdue_days and status not in paid_statuses:
            overdue.append({"amount": amount, "expires": expires_raw, "status": status})

    return overdue


FLUSH_EVERY = 25  # сохранять пачками каждые N обработанных заказов


def flush_results(buffer: list, webhook_url: str, run_date: str, excel_path, accumulated_phones: list) -> None:
    """Отправляет накопленную пачку результатов в Таблицу, перезаписывает Excel полным списком найденного за прогон."""
    if not buffer:
        return

    try:
        response = send_to_google_sheet(webhook_url, buffer, run_date)
        print(f"    -> Отправлено в Google Таблицу: {response}")
    except Exception as exc:
        print(f"    -> Ошибка отправки в Google Таблицу: {exc}")
        print("    -> Эта пачка НЕ будет отмечена как уведомлённая, попадёт в следующий прогон.")
        return

    accumulated_phones.extend(r["phone"] for r in buffer)
    write_sms_phones_file(accumulated_phones, str(excel_path))
    print(f"    -> Excel перезаписан ({len(accumulated_phones)} телефонов всего за прогон): {excel_path}")

    for r in buffer:
        mark_notified(r["order_id"], r["phone"], r["amount"], r["expires"], run_date)

    buffer.clear()


def main():
    config = load_config()
    orders_url = config["CRM_ORDERS_URL"]
    webhook_url = config["GOOGLE_SHEET_WEBHOOK"]
    overdue_days = int(config.get("OVERDUE_DAYS", "7"))
    paid_statuses = set(s.strip() for s in config.get("PAID_STATUSES", "Погашен,Оплачен").split(","))

    route_date_range = None
    route_from = config.get("ROUTE_DATE_FROM", "").strip()
    route_to = config.get("ROUTE_DATE_TO", "").strip()
    if route_from and route_to:
        route_date_range = f"{route_from} - {route_to}"
        print(f"Фильтр по дате маршрута включён (явный диапазон): {route_date_range}")
    else:
        route_days_back = config.get("ROUTE_DATE_DAYS_BACK", "").strip()
        if route_days_back:
            days_back = int(route_days_back)
            date_to = datetime.now().date()
            date_from = date_to - timedelta(days=days_back)
            route_date_range = sel.build_route_date_value(date_from, date_to)
            print(f"Фильтр по дате маршрута включён (последние {days_back} дн.): {route_date_range}")

    base_domain = "/".join(orders_url.split("/")[:3])  # https://a.ok-crm.com

    run_date = datetime.now().strftime("%d.%m.%Y %H:%M")
    OUTPUT_DIR.mkdir(exist_ok=True)
    excel_path = OUTPUT_DIR / "sms_phones.xlsx"

    # Сбрасываем файл в начале каждого прогона — робот СМС всегда открывает
    # один и тот же файл, актуальный на момент последнего прогона (не старые
    # накопленные результаты из прошлых запусков).
    write_sms_phones_file([], str(excel_path))
    accumulated_phones = []

    with sync_playwright() as p:
        if IS_CLOUD:
            if not CLOUD_STATE_FILE.exists():
                sys.exit(
                    "❌ Файл сессии CRM не найден.\n"
                    "Установите env var CRM_STORAGE_STATE в Render Dashboard.\n"
                    "Запустите export_crm_session.py локально чтобы получить значение."
                )
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                ],
            )
            context = browser.new_context(
                storage_state=str(CLOUD_STATE_FILE),
                viewport={"width": 1600, "height": 1000},
            )
        else:
            context = p.chromium.launch_persistent_context(
                str(PROFILE_DIR),
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
        page = context.new_page()
        page.on("dialog", lambda d: d.accept())

        if not check_crm_session(page, orders_url):
            wait_for_manual_login(page, orders_url)

        candidates = collect_candidate_orders(page, orders_url, route_date_range)

        results_buffer = []
        processed = 0
        found_total = 0

        try:
            for idx, cand in enumerate(candidates, start=1):
                order_id = cand["order_id"]
                phone = normalize_phone(cand["phone"])
                print(f"  [{idx}/{len(candidates)}] Заказ {order_id}...")

                try:
                    overdue_payments = parse_overdue_payments_for_order(
                        page, base_domain, order_id, overdue_days, paid_statuses
                    )
                except Exception as exc:
                    print(f"    Ошибка на заказе {order_id}: {exc}")
                    save_error_screenshot(page, order_id, "parse_error")
                    log_error(order_id, "parse_error", exc)
                    continue

                processed += 1

                if not phone:
                    print(f"    Не удалось распознать телефон у заказа {order_id}, пропуск.")
                    continue

                for payment in overdue_payments:
                    if is_already_notified(order_id, payment["expires"], payment["amount"]):
                        continue
                    results_buffer.append(
                        {
                            "order_id": order_id,
                            "phone": phone,
                            "amount": payment["amount"],
                            "expires": payment["expires"],
                            "status": payment["status"],
                            "order_url": sel.order_view_url(base_domain, order_id),
                        }
                    )
                    found_total += 1

                if idx % FLUSH_EVERY == 0 and results_buffer:
                    print(f"    Сохраняю пачку из {len(results_buffer)} записей...")
                    flush_results(results_buffer, webhook_url, run_date, excel_path, accumulated_phones)

        except KeyboardInterrupt:
            print(f"\nОстановлено вручную на заказе {processed}/{len(candidates)}.")
            print("Сохраняю то, что уже успели найти...")

        finally:
            flush_results(results_buffer, webhook_url, run_date, excel_path, accumulated_phones)
            context.close()

    print(f"\nГотово. Обработано заказов: {processed}. Найдено просроченных платежей за этот прогон: {found_total}.")
    if found_total == 0:
        print("Новых просроченных платежей не найдено.")
    else:
        print(f"Результаты в Google Таблице (лист «Уведомления») и в {excel_path}")


if __name__ == "__main__":
    main()
