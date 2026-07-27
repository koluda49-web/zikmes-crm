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


def _click_first_matching_role(page, role: str, names, *, last=False, timeout=15000):
    """Кликает первый найденный элемент по role из списка имён (RU/EN)."""
    for name in names:
        loc = page.get_by_role(role, name=name)
        try:
            loc.first.wait_for(state="visible", timeout=3000)
            if last:
                page.get_by_role(role, name=name).last.click(timeout=timeout)
            else:
                loc.first.click(timeout=timeout)
            return
        except Exception:
            continue
    raise RuntimeError(f"Не найден элемент role={role!r} с именем из {names}")


def create_folder(page, name: str) -> None:
    """Создаёт новую папку с именем name в текущей открытой папке."""
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    _click_first_matching_role(page, "button", _BTN_CREATE_NAMES, timeout=20000)
    _click_first_matching_role(page, "menuitem", _MENU_FOLDER_PATTERNS)
    # Текстовое поле для имени папки
    textbox = None
    for tb_name in _FOLDER_TEXTBOX_NAMES:
        loc = page.get_by_role("textbox", name=tb_name)
        try:
            loc.wait_for(state="visible", timeout=3000)
            textbox = loc
            break
        except Exception:
            continue
    if textbox is None:
        raise RuntimeError("Не найдено текстовое поле для имени папки")
    textbox.fill(name)
    _click_first_matching_role(page, "button", _BTN_CREATE_NAMES, last=True, timeout=10000)
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
    _click_first_matching_role(page, "button", _BTN_CREATE_NAMES, timeout=15000)
    with page.expect_file_chooser() as fc_info:
        _click_first_matching_role(page, "menuitem", _UPLOAD_FILE_PATTERNS)
    file_chooser = fc_info.value
    file_chooser.set_files(local_path)
    page.wait_for_timeout(3000)
