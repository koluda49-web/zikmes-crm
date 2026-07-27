"""
Основной скрипт-бот. Проходит по списку замороженных заказов, для каждого:
  1. читает Цену, % первоначального взноса, Пометку к заказу, Дату оформления,
     Фамилию клиента;
  2. определяет сумму первого взноса (parse_notes.resolve_downpayment_amount);
  3. вписывает сумму, жмёт "Генерировать платежи";
  4. жмёт шестерёнку -> "Генерировать документы", скачивает и распаковывает
     .docx из полученного .zip;
  5. кладёт .docx в Google Drive в папку <дата>/<id фамилия>;
  6. меняет статус заказа на "Новый" и сохраняет.
"""

import argparse
import os
import re
import shutil
import time
import zipfile

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

import config
import bot_selectors as sel
import state_store
from parse_notes import resolve_downpayment_amount
import drive_utils

# Hybrid: service account creates folders (no quota), browser uploads files (uses user quota)
_sa_for_folders = os.path.exists(config.GOOGLE_SERVICE_ACCOUNT_JSON)
import drive_browser


class OrderSkippedError(Exception):
    pass


def _save_error_screenshot(page, order_id: str, error_kind: str) -> str:
    try:
        screenshots_dir = os.path.join(config.DOWNLOAD_DIR, "error_screenshots")
        os.makedirs(screenshots_dir, exist_ok=True)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(screenshots_dir, f"{order_id}_{error_kind}_{timestamp}.png")
        page.screenshot(path=path, full_page=True, timeout=10000)
        return path
    except Exception:
        return ""


def parse_price(raw_text: str) -> float:
    cleaned = re.sub(r"[^\d.,]", "", raw_text or "").replace(" ", "")
    cleaned = cleaned.replace(",", ".")
    return float(cleaned) if cleaned else 0.0


def parse_percent(raw_text: str) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)", raw_text or "")
    return float(match.group(1)) if match else 0.0


def extract_surname(full_name: str) -> str:
    parts = (full_name or "").strip().split()
    return parts[0] if parts else "unknown"


def apply_frozen_filter(page) -> None:
    page.goto(config.BASE_URL + "/order", wait_until="commit")
    page.get_by_label(sel.LABEL_PAYMENT_METHOD).select_option(sel.FILTER_PAYMENT_METHOD_VALUE)
    page.get_by_label(sel.LABEL_BANK).select_option(sel.FILTER_BANK_VALUE)
    page.get_by_role("searchbox", name=sel.STATUS_SEARCHBOX_NAME).nth(sel.STATUS_SEARCHBOX_INDEX).click()
    page.get_by_role("option", name=sel.FILTER_STATUS_OPTION_TEXT).click()
    page.get_by_role("button", name=sel.BTN_FILTER_APPLY_NAME).click()
    page.wait_for_timeout(int(config.ACTION_DELAY_SECONDS * 1000))


def collect_order_ids(page) -> list:
    apply_frozen_filter(page)
    try:
        page.wait_for_selector(f"role=link[name='{sel.VIEW_ORDER_LINK_NAME}']", timeout=8000)
    except PlaywrightTimeoutError:
        return []

    links = page.get_by_role("link", name=sel.VIEW_ORDER_LINK_NAME).all()
    order_ids = []
    for link in links:
        href = link.get_attribute("href") or ""
        match = re.search(r"/order/view/(\d+)", href)
        if match:
            order_ids.append(match.group(1))

    seen = set()
    unique_ids = []
    for oid in order_ids:
        if oid not in seen:
            seen.add(oid)
            unique_ids.append(oid)
    return unique_ids


def process_order(page, order_id: str, dry_run: bool, drive_service=None) -> None:
    page.goto(f"{config.BASE_URL}/order/view/{order_id}", wait_until="commit")
    page.wait_for_selector(sel.FIELD_PRICE, timeout=15000)

    price_text = page.inner_text(sel.FIELD_PRICE)
    client_name = page.inner_text(sel.FIELD_CLIENT_NAME)
    order_date = page.inner_text(sel.FIELD_ORDER_DATE).strip()
    note_text = page.inner_text(sel.FIELD_NOTE)
    percent_text = page.inner_text(sel.CREDIT_DOWNPAYMENT_PERCENT)

    price = parse_price(price_text)
    percent = parse_percent(percent_text)
    surname = extract_surname(client_name)

    resolved = resolve_downpayment_amount(note_text, price, percent)

    if resolved.amount is None or resolved.source in ("unparsed",):
        state_store.log_manual_review(
            order_id, resolved.source, resolved.note_amount, resolved.percent_amount, note_text
        )
        print(f"[{order_id}] -> ручная проверка ({resolved.source}), пропускаю")
        return

    if resolved.source == "mismatch":
        state_store.log_manual_review(
            order_id, "mismatch_but_processed", resolved.note_amount, resolved.percent_amount, note_text
        )

    amount = resolved.amount
    print(f"[{order_id}] сумма взноса = {amount} (источник: {resolved.source})")

    if dry_run:
        print(f"[{order_id}] DRY RUN: остановился бы здесь, дальше не выполняю реальных действий")
        return

    generate_btn = page.locator(sel.BTN_GENERATE_PAYMENTS)
    generate_btn.wait_for(state="visible", timeout=10000)

    if generate_btn.is_disabled():
        print(f"[{order_id}] платежи уже сгенерированы ранее (кнопка неактивна) - пропускаю этот шаг")
    else:
        amount_input = page.locator(sel.CREDIT_AMOUNT_INPUT)
        amount_input.fill(str(amount))
        amount_input.press("Tab")
        page.wait_for_timeout(500)

        try:
            deadline_ms = 5000
            step_ms = 250
            waited_ms = 0
            while generate_btn.is_disabled() and waited_ms < deadline_ms:
                page.wait_for_timeout(step_ms)
                waited_ms += step_ms
            if generate_btn.is_disabled():
                raise RuntimeError("кнопка так и не стала активной")
        except Exception:
            raise RuntimeError(
                f"Кнопка 'Генерировать платежи' осталась неактивна для суммы {amount} - "
                f"проверьте заказ {order_id} вручную."
            )
        generate_btn.click()
        page.wait_for_timeout(int(config.ACTION_DELAY_SECONDS * 1000))

    os.makedirs(config.DOWNLOAD_DIR, exist_ok=True)
    try:
        with page.expect_download(timeout=10000) as download_info:
            credit_panel = page.locator(".box, .card").filter(has_text=sel.CREDIT_PANEL_HEADING_TEXT).first
            credit_panel.locator(sel.CREDIT_GEAR_ICON).click()
            page.get_by_role("link", name=sel.MENU_ITEM_GENERATE_DOCS_NAME).click()
        download = download_info.value
    except PlaywrightTimeoutError:
        error_banner = page.locator(".alert-danger")
        if error_banner.count() > 0:
            banner_text = error_banner.first.inner_text().strip()
            raise OrderSkippedError(f"Не удалось сгенерировать документы: {banner_text}")
        raise

    zip_path = os.path.join(config.DOWNLOAD_DIR, f"{order_id}_{download.suggested_filename}")
    download.save_as(zip_path)
    page.wait_for_timeout(int(config.ACTION_DELAY_SECONDS * 1000))

    extract_dir = os.path.join(config.DOWNLOAD_DIR, f"{order_id}_extracted")
    os.makedirs(extract_dir, exist_ok=True)
    local_files = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_dir)
        for name in zf.namelist():
            if name.lower().endswith(".docx"):
                local_files.append(os.path.join(extract_dir, name))

    if not local_files:
        raise RuntimeError(f"В скачанном архиве {zip_path} не найден файл .docx.")

    print(f"[{order_id}] загружаю в Google Drive, дата='{order_date}'...")
    apps_script_url = os.environ.get('GOOGLE_APPS_SCRIPT_URL', '')
    apps_script_key = os.environ.get('GOOGLE_APPS_SCRIPT_KEY', '')

    if drive_service is not None:
        # SA создаёт папки через API (без квоты)
        folder_id = drive_utils.get_or_create_order_folder(drive_service, order_date, order_id, surname)
        folder_url = f"https://drive.google.com/drive/folders/{folder_id}"
        print(f"[{order_id}] папка создана/найдена: {folder_url}")

        if apps_script_url:
            # Apps Script: надёжно, использует квоту пользователя, без браузерной автоматизации
            for local_path in local_files:
                print(f"[{order_id}] загружаю файл {local_path}...")
                drive_browser.upload_file_via_apps_script(apps_script_url, folder_id, local_path, apps_script_key)
        else:
            # Browser fallback: навигируем через Drive UI (может не работать в headless)
            date_only = drive_browser.extract_date_only(order_date)
            month = drive_browser.month_name_ru(date_only)
            order_folder_name = f"{order_id} {surname}".strip()
            page.goto(f"https://drive.google.com/drive/folders/{config.PARENT_DRIVE_FOLDER_ID}")
            try:
                page.wait_for_load_state("networkidle", timeout=12000)
            except Exception:
                pass
            page.wait_for_timeout(2000)
            print(f"[{order_id}] навигирую в Drive: {month} → {date_only} → {order_folder_name}")
            drive_browser.open_folder_by_name(page, month)
            drive_browser.open_folder_by_name(page, date_only)
            drive_browser.open_folder_by_name(page, order_folder_name)
            print(f"[{order_id}] Drive URL: {page.url}")
            for local_path in local_files:
                print(f"[{order_id}] загружаю файл {local_path}...")
                drive_browser.upload_file(page, local_path)
    else:
        folder_url = drive_browser.navigate_to_order_folder(page, order_date, order_id, surname)
        print(f"[{order_id}] Drive URL: {folder_url}")
        for local_path in local_files:
            print(f"[{order_id}] загружаю файл {local_path}...")
            drive_browser.upload_file(page, local_path)

    print(f"[{order_id}] загрузка на Drive завершена")

    try:
        os.remove(zip_path)
        shutil.rmtree(extract_dir, ignore_errors=True)
        print(f"[{order_id}] локальные временные файлы удалены")
    except Exception as e:
        print(f"[{order_id}] не удалось удалить временные файлы (не критично): {e}")

    print(f"[{order_id}] возвращаюсь на страницу заказа...")
    page.goto(f"{config.BASE_URL}/order/view/{order_id}", wait_until="commit")
    page.wait_for_selector(sel.FIELD_PRICE, timeout=15000)

    print(f"[{order_id}] открываю редактирование...")
    page.get_by_text(sel.BTN_EDIT_ORDER_NAME, exact=True).click()
    print(f"[{order_id}] жду форму редактирования...")
    page.wait_for_selector(f"text={sel.STATUS_LABEL}", timeout=15000)
    print(f"[{order_id}] форма открыта, обновляю пометку...")

    note_field = page.locator(sel.NOTE_TEXTAREA_CSS)
    if note_field.count() == 0:
        note_field = page.get_by_label(sel.NOTE_LABEL)
    current_note = note_field.input_value()
    updated_note = f"{current_note}\n{folder_url}\nСделано!!"
    note_field.fill(updated_note)

    print(f"[{order_id}] меняю статус на 'Новый'...")
    page.get_by_label(sel.STATUS_LABEL).select_option(label=config.STATUS_NEW)
    save_button = page.get_by_role("button", name=sel.BTN_SAVE_ORDER_NAME)
    save_button.wait_for(state="visible", timeout=10000)
    save_button.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    print(f"[{order_id}] сохраняю...")
    save_button.click(force=True)
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(1500)

    edit_error_banner = page.locator(".alert-danger")
    if edit_error_banner.count() > 0:
        banner_text = edit_error_banner.first.inner_text().strip()
        print(f"[{order_id}] ВНИМАНИЕ: после клика 'Сохранить' на форме виден баннер ошибки: {banner_text}")

    print(f"[{order_id}] проверяю статус...")
    page.goto(f"{config.BASE_URL}/order/view/{order_id}", wait_until="commit")
    page.wait_for_selector(sel.FIELD_PRICE, timeout=15000)
    status_value = page.locator(sel.FIELD_STATUS_VALUE).inner_text().strip()

    if status_value != config.STATUS_NEW:
        raise RuntimeError(
            f"После сохранения статус заказа так и остался '{status_value}' "
            f"(ожидался '{config.STATUS_NEW}') - сохранение не применилось."
        )
    print(f"[{order_id}] сохранение подтверждено - статус: '{status_value}'")

    state_store.mark_processed(order_id, amount, resolved.source)
    print(f"[{order_id}] готово")


def check_drive_session(page) -> bool:
    page.goto(f"https://drive.google.com/drive/folders/{config.PARENT_DRIVE_FOLDER_ID}")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PlaywrightTimeoutError:
        pass
    # Если редиректнуло на страницу логина — сессия истекла
    if "accounts.google.com" in page.url:
        return False
    # Проверяем наличие индикатора входа: русский или английский интерфейс
    for text in ["Мой диск", "My Drive"]:
        try:
            page.get_by_text(text, exact=False).wait_for(state="visible", timeout=3000)
            return True
        except PlaywrightTimeoutError:
            continue
    # Если всё ещё на drive.google.com — считаем что залогинены
    return "drive.google.com" in page.url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--order-id", type=str, default=None)
    parser.add_argument("--headed", action="store_true", help="Показать браузер (только локально)")
    parser.add_argument("--pause", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    state_store.init_db()

    # В облаке --headed игнорируется
    show_browser = (args.dry_run or args.headed) and not config.IS_CLOUD

    _cloud_args = (
        [
            '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',  # скрываем признаки автоматизации
        ]
        if config.IS_CLOUD else ['--disable-blink-features=AutomationControlled']
    )

    if not os.path.exists(config.STORAGE_STATE_PATH):
        print("=" * 60)
        print("ОШИБКА: файл сессии не найден:")
        print(f"  {config.STORAGE_STATE_PATH}")
        print()
        if config.IS_CLOUD:
            print("Обновите env var OKCRM_STORAGE_STATE в Render.")
            print("Запустите grab_session_from_cdp.py локально и скопируйте base64.")
        else:
            print("Нужно захватить сессию CRM и Google Drive:")
            print("  1. Откройте Chrome с флагом --remote-debugging-port=9222")
            print("     (или нажмите 'Захватить сессию' в дашборде)")
            print("  2. Войдите на a.ok-crm.com и drive.google.com")
            print("  3. Запустите: python grab_session_from_cdp.py")
        print("=" * 60)
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not show_browser,
            slow_mo=300 if show_browser else 0,
            args=_cloud_args,
        )
        context = browser.new_context(
            storage_state=config.STORAGE_STATE_PATH,
            viewport={"width": 1600, "height": 1000},
            # Реальный user-agent Chrome — снижает вероятность детекции headless
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())

        drive_service = None
        if _sa_for_folders:
            # Сервисный аккаунт создаёт папки (без квоты)
            drive_service = drive_utils.get_drive_service()
            if args.dry_run:
                print("Dry-run режим: Drive API для папок готов, загрузка файлов пропускается.")
            else:
                _using_apps_script = bool(os.environ.get('GOOGLE_APPS_SCRIPT_URL', ''))
                if _using_apps_script:
                    print("Drive: сервисный аккаунт для папок + Google Apps Script для загрузки файлов.")
                else:
                    print("Drive: сервисный аккаунт для папок + браузерная сессия для загрузки файлов.")
                    if not check_drive_session(page):
                        print("=" * 60)
                        print("ОШИБКА: сессия Google Drive не залогинена (нужна для загрузки файлов).")
                        if config.IS_CLOUD:
                            print("Обновите env var OKCRM_STORAGE_STATE в Render.")
                        else:
                            print("Войдите на drive.google.com и перезапустите grab_session_from_cdp.py")
                        print("=" * 60)
                        browser.close()
                        return
                    print("Сессия Google Drive в порядке, продолжаю.")
        elif args.dry_run:
            print("Dry-run режим: проверка сессии Google Drive пропускается.")
        else:
            print("Загрузка в Drive через браузерную сессию — проверяю сессию Google Drive...")
            if not check_drive_session(page):
                print("=" * 60)
                print("ОШИБКА: сессия Google Drive не залогинена.")
                if config.IS_CLOUD:
                    print("Обновите env var OKCRM_STORAGE_STATE в Render.")
                    print("Запустите grab_session_from_cdp.py локально и скопируйте base64.")
                else:
                    print("1. Запустите Chrome с --remote-debugging-port=9222")
                    print("2. Войдите на a.ok-crm.com и drive.google.com")
                    print("3. Запустите: python grab_session_from_cdp.py")
                print("=" * 60)
                browser.close()
                return
            print("Сессия Google Drive в порядке, продолжаю.")

        processed_count = 0
        if args.order_id:
            batch = [args.order_id]
        else:
            batch = collect_order_ids(page)
            print(f"Найдено заказов на текущей странице фильтра: {len(batch)}")

        if args.force and not args.order_id:
            print("ВНИМАНИЕ: --force без --order-id игнорируется.")

        force_this_order = bool(args.force and args.order_id)
        if force_this_order:
            print(f"[{args.order_id}] --force: обрабатываю заново")

        remaining = [
            oid for oid in batch
            if force_this_order or not state_store.is_processed(oid)
        ]
        already_done = [
            oid for oid in batch
            if not force_this_order and state_store.is_processed(oid)
        ]
        for oid in already_done:
            print(f"[{oid}] уже обработан ранее (state.sqlite) - пропускаю")

        for order_id in remaining:
            if args.limit and processed_count >= args.limit:
                break

            try:
                process_order(page, order_id, dry_run=args.dry_run, drive_service=drive_service)
                processed_count += 1
                if args.pause and not config.IS_CLOUD:
                    print(f"[{order_id}] пауза - посмотрите на страницу браузера сейчас")
                    input("Нажмите Enter здесь, когда посмотрели...")
            except OrderSkippedError as e:
                state_store.log_skipped(order_id, str(e))
                print(f"[{order_id}] пропущен: {e}")
            except PlaywrightTimeoutError as e:
                screenshot_path = _save_error_screenshot(page, order_id, "timeout")
                state_store.log_error(order_id, "timeout", f"{e} | скриншот: {screenshot_path}")
                print(f"[{order_id}] ОШИБКА (таймаут): {e}")
            except Exception as e:
                screenshot_path = _save_error_screenshot(page, order_id, "unexpected")
                state_store.log_error(order_id, "unexpected", f"{e} | скриншот: {screenshot_path}")
                print(f"[{order_id}] ОШИБКА: {e}")
            time.sleep(config.ACTION_DELAY_SECONDS)

        browser.close()
        print(f"Готово. Обработано за этот прогон: {processed_count}.")


if __name__ == "__main__":
    main()
