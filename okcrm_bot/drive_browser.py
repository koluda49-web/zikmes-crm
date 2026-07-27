"""
Управление Google Drive через обычный веб-интерфейс (drive.google.com) в том
же браузере/сессии, что и CRM - без Google Cloud Console, без сервисного
аккаунта, без API. Просто кликаем по интерфейсу так же, как кликали бы вы сами.

Все селекторы ниже подтверждены через playwright codegen на реальном Диске
(создание папки, открытие папки двойным кликом по имени, загрузка файла).
"""

import re

import config

# Русский и английский интерфейс Drive (сервер в US показывает EN)
_BTN_CREATE_NAMES = ["Создать", "New"]
_MENU_FOLDER_PATTERNS = [re.compile("Новая папка"), re.compile("New folder")]
_FOLDER_TEXTBOX_NAMES = ["Новая папка", "New folder"]
_UPLOAD_FILE_PATTERNS = [re.compile("Загрузить файл"), re.compile("File upload"), re.compile("Upload files")]


def month_name_ru(date_ddmmyyyy: str) -> str:
    """'26.06.2026' -> 'Июнь'"""
    match = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", date_ddmmyyyy.strip())
    if not match:
        raise ValueError(f"Не удалось разобрать дату: {date_ddmmyyyy!r}")
    month_index = int(match.group(2)) - 1
    return config.RUSSIAN_MONTHS[month_index]


def extract_date_only(order_date_text: str) -> str:
    """'26.06.2026 11:39' -> '26.06.2026' (отбрасываем время)"""
    match = re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", order_date_text)
    if not match:
        raise ValueError(f"Не удалось найти дату в тексте: {order_date_text!r}")
    return match.group(0)


def open_folder_by_name(page, name: str) -> bool:
    """Двойной клик по папке с точным названием name на текущей странице списка.
    Возвращает True если папка найдена и открыта, False если не найдена."""
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass  # не критично, продолжаем всё равно

    by_title = page.locator(f'[title="{name}"]').first
    if by_title.count() > 0:
        print(f"     (найдена через атрибут title)")
        by_title.dblclick()
        page.wait_for_timeout(1500)
        return True

    # Запасной вариант - поиск по тексту div с точным совпадением
    pattern = re.compile(rf"^{re.escape(name)}$")
    folder = page.locator("div").filter(has_text=pattern).first
    if folder.count() == 0:
        return False
    print(f"     (найдена через запасной способ - поиск по тексту div)")
    folder.dblclick()
    page.wait_for_timeout(1500)
    return True


def _wait_for_create_button(page, timeout_ms=20000):
    """Ждёт появления кнопки Создать/New и возвращает её имя."""
    step = 500
    elapsed = 0
    while elapsed < timeout_ms:
        for name in _BTN_CREATE_NAMES:
            loc = page.get_by_role("button", name=name)
            if loc.count() > 0:
                try:
                    loc.first.wait_for(state="visible", timeout=1000)
                    return name
                except Exception:
                    pass
        page.wait_for_timeout(step)
        elapsed += step
    raise RuntimeError(f"Кнопка 'Создать'/'New' не появилась за {timeout_ms}мс")


def create_folder(page, name: str) -> None:
    """Создаёт новую папку с именем name в текущей открытой папке."""
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    btn_name = _wait_for_create_button(page, timeout_ms=20000)
    page.get_by_role("button", name=btn_name).first.click(timeout=15000)

    # Меню "Новая папка" / "New folder"
    for pattern in _MENU_FOLDER_PATTERNS:
        try:
            page.get_by_role("menuitem", name=pattern).wait_for(state="visible", timeout=3000)
            page.get_by_role("menuitem", name=pattern).click()
            break
        except Exception:
            continue

    # Текстовое поле для имени
    for tb_name in _FOLDER_TEXTBOX_NAMES:
        try:
            loc = page.get_by_role("textbox", name=tb_name)
            loc.wait_for(state="visible", timeout=5000)
            loc.fill(name)
            break
        except Exception:
            continue

    # Кнопка подтверждения (последняя "Создать"/"New" в диалоге)
    btn_name2 = _wait_for_create_button(page, timeout_ms=8000)
    page.get_by_role("button", name=btn_name2).last.click(timeout=10000)
    page.wait_for_timeout(1500)


def get_or_create_folder(page, name: str) -> None:
    """Открывает папку с именем name, создавая её, если она ещё не существует."""
    print(f"  -> ищу папку '{name}'...")
    if open_folder_by_name(page, name):
        print(f"     найдена и открыта, URL: {page.url}")
    else:
        print(f"     не найдена, создаю новую...")
        create_folder(page, name)
        if open_folder_by_name(page, name):
            print(f"     создана и открыта, URL: {page.url}")
        else:
            print(f"     ВНИМАНИЕ: создали, но не смогли открыть - проверьте вручную")


def navigate_to_order_folder(page, order_date_text: str, order_id: str, surname: str) -> str:
    """
    Открывает (создавая при необходимости) цепочку папок:
    "2026 Рассрочки" -> <месяц> -> <дата> -> "<id> <фамилия>"
    и оставляет page открытой именно в конечной папке, готовой для загрузки файла.
    Возвращает ссылку (URL) на конечную папку.
    """
    date_only = extract_date_only(order_date_text)
    month = month_name_ru(date_only)

    page.goto(f"https://drive.google.com/drive/folders/{config.PARENT_DRIVE_FOLDER_ID}")
    page.wait_for_timeout(2000)

    get_or_create_folder(page, month)
    get_or_create_folder(page, date_only)
    get_or_create_folder(page, f"{order_id} {surname}".strip())

    return page.url


def upload_file(page, local_path: str) -> None:
    """Загружает файл local_path в текущую открытую папку через диалог выбора файла."""
    btn_name = _wait_for_create_button(page, timeout_ms=15000)
    page.get_by_role("button", name=btn_name).first.click(timeout=15000)
    with page.expect_file_chooser() as fc_info:
        for pattern in _UPLOAD_FILE_PATTERNS:
            try:
                page.get_by_role("menuitem", name=pattern).wait_for(state="visible", timeout=3000)
                page.get_by_role("menuitem", name=pattern).click()
                break
            except Exception:
                continue
    file_chooser = fc_info.value
    file_chooser.set_files(local_path)
    page.wait_for_timeout(3000)


def upload_file_via_token(page, folder_id: str, local_path: str) -> None:
    """
    Загружает файл в папку Drive через скрытый input[type=file] в Drive SPA.
    Playwright умеет устанавливать файлы напрямую на скрытые инпуты —
    кнопка «Создать»/«New» не нужна.
    """
    page.goto(f"https://drive.google.com/drive/folders/{folder_id}")
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(3000)

    if "drive.google.com" not in page.url:
        raise RuntimeError(
            f"Drive не загрузился — текущий URL: {page.url}. "
            "Обновите storage_state.json через кнопку «Загрузить сессию»."
        )

    file_inputs = page.locator('input[type="file"]')
    n = file_inputs.count()
    print(f"  Drive UI: найдено {n} input[type=file] элемент(ов)")

    if n == 0:
        raise RuntimeError(
            "Drive UI не показал input[type=file]. "
            "Возможно Drive загрузился не полностью — попробуйте ещё раз."
        )

    file_name = os.path.basename(local_path)
    print(f"  Загружаю {file_name} через file input...")
    file_inputs.first.set_input_files(local_path)
    # Ждём прогресс-бар загрузки и завершения
    page.wait_for_timeout(10000)
