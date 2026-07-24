# -*- coding: utf-8 -*-
"""
Селекторы для a.ok-crm.com.

ВАЖНО: значения ниже основаны на скриншотах списка заказов и карточки
заказа, но НЕ проверены вживую (нет доступа к сайту при разработке).
Помечены [ПРОВЕРИТЬ] места, которые нужно свериться через DevTools (F12 →
вкладка Elements, навести на нужный элемент) при первом запуске.
Урок из okcrm_bot: НЕ полагаться на авто-ID виджетов (#w7, #w13 и т.п.) —
они не постоянны между заказами. Искать по тексту заголовка/label.
"""

from urllib.parse import quote

# ---------------------------------------------------------------------------
# Список заказов (/order/index)
# ---------------------------------------------------------------------------

# [ПРОВЕРИТЬ] Имена GET-параметров формы фильтра. Чтобы узнать точно:
# 1. Открыть /order/index в CRM.
# 2. Вручную выставить фильтр: Метод оплаты=Расчетный счет,
#    Банк=Фирма рассрочка, Статус=Сдан.
# 3. Нажать "Фильтр" и посмотреть, что появилось в адресной строке —
#    это и есть точные ключи ниже (сейчас — правдоподобные догадки по
#    аналогии с "OrderSearch[id]=&OrderSearch[prod..." из скриншота).
# Реальные параметры подтверждены через DevTools → Network (запрос при
# ручном применении фильтра в CRM). Важно: поля — это <select>, на сервер
# уходит числовой код, а не видимый текст, и статус передаётся как массив
# (даже при одном выбранном значении).
FILTER_PARAMS = {
    "payment_method": "OrderSearch[info_payment_method]",
    "bank": "OrderSearch[bank]",
    "status": "OrderSearch[status][]",
}

FILTER_VALUES = {
    "payment_method": "7",  # Расчетный счет
    "bank": "1",            # Фирма рассрочка
    "status": "9",          # Сдан
}

# Опциональный фильтр по "Дата маршрута" — одна строка вида
# "01.07.2026 - 19.07.2026" (подтверждено через реальный URL CRM).
# Используется только если явно передан route_date_range в build_orders_url.
ROUTE_DATE_PARAM = "OrderSearch[routeDate]"


def build_route_date_value(date_from, date_to) -> str:
    """date_from/date_to — объекты datetime.date."""
    return f"{date_from.strftime('%d.%m.%Y')} - {date_to.strftime('%d.%m.%Y')}"

# [ПРОВЕРИТЬ] Параметр пагинации (часто "page", иногда "OrderSearch[page]")
PAGE_PARAM = "page"

# Строка заказа в таблице списка
ORDER_ROW_XPATH = "//table//tbody/tr[td]"

# [ПРОВЕРИТЬ] Порядковый номер колонки ID и телефона в строке списка
# (0-based). По скриншоту похоже: 0=№, 1=ID, ... телефон где-то рядом с
# "Товары" — уточнить точный индекс.
LIST_COL = {
    "id": 1,
    "phone": 3,
}

# Признак того, что таблица списка заказов действительно загрузилась
# (а не показан экран логина Google) — используется в check_crm_session()
ORDERS_TABLE_LOADED_XPATH = "//table//tbody/tr"

# Текст-заглушка CRM, когда результатов нет. ВАЖНО: рендерится как строка
# <tr><td>Ничего не найдено.</td></tr> внутри той же таблицы, поэтому
# попадает под общий ORDER_ROW_XPATH — нужна отдельная явная проверка на
# этот текст, иначе такая "строка" ошибочно не считается пустой страницей.
NO_RESULTS_XPATH = "//td[contains(normalize-space(.), 'Ничего не найдено')]"

# Признак экрана логина CRM/Google — если это видно, сессия не годится
GOOGLE_LOGIN_MARKER_TEXT = "Войти через Google"  # [ПРОВЕРИТЬ] точный текст кнопки


def build_orders_url(base_url: str, page: int = 1, route_date_range: str = None) -> str:
    """Собирает URL списка заказов с нужными фильтрами и номером страницы.

    Значения кодируются через quote() так же, как это делает браузер при
    отправке формы фильтра (кириллица -> %D0.., пробел -> %20). Без этого
    CRM не распознаёт параметры и отдаёт список без фильтрации.

    route_date_range: опционально, строка вида "01.07.2026 - 19.07.2026"
    (см. build_route_date_value) — сужает список по дате маршрута.
    Если не передано — фильтр по дате не применяется (весь период).
    """
    parts = []
    for key, param_name in FILTER_PARAMS.items():
        value = FILTER_VALUES[key]
        encoded_value = quote(value, safe="")
        parts.append(f"{param_name}={encoded_value}")

    if route_date_range:
        parts.append(f"{ROUTE_DATE_PARAM}={quote(route_date_range, safe='')}")

    parts.append(f"{PAGE_PARAM}={page}")
    query = "&".join(parts)
    return f"{base_url}?{query}"


def order_view_url(base_domain: str, order_id: str) -> str:
    return f"{base_domain}/order/view/{order_id}"


# ---------------------------------------------------------------------------
# Карточка заказа (/order/view/{id})
# ---------------------------------------------------------------------------

# Устойчивый способ (как в okcrm_bot): искать по тексту заголовка строки,
# а не по авто-ID. Это XPath к значению телефона на карточке заказа.
CLIENT_PHONE_XPATH = "//th[contains(normalize-space(.), 'Телефоны клиента')]/following-sibling::td"

# Блок "Платежи" — подтверждено через DevTools на заказе 584648:
# <h3 class="box-title">Платежи</h3> внутри <div class="box-header">,
# таблица — в соседнем <div class="box-body"> следом за заголовком.
# Используем именно класс box-title (не просто текст "Платежи"), чтобы не
# случайно зацепить одноимённый пункт «Платежи» в левом меню CRM.
PAYMENTS_PANEL_XPATH = "//h3[contains(concat(' ', normalize-space(@class), ' '), ' box-title ')][normalize-space(.)='Платежи']"
PAYMENTS_TABLE_XPATH = PAYMENTS_PANEL_XPATH + "/following::table[1]"
PAYMENT_ROW_XPATH = PAYMENTS_TABLE_XPATH + "//tbody/tr"

# Индексы колонок в строке платежа (0-based), подтверждено на реальном
# заказе 584648: # | Сумма | Валюта | Метод оплаты | Дата платежа | Статус |
# Истекает | Действия — ВАЖНО: есть ведущая колонка "#" (номер строки),
# из-за которой все остальные индексы сдвинуты на +1.
PAYMENT_COL = {
    "amount": 1,
    "currency": 2,
    "method": 3,
    "payment_date": 4,
    "status": 5,
    "expires": 6,
}

# Статус заказа не Сдан/что-то ещё — не используется сейчас, задел на будущее
ORDER_STATUS_XPATH = "//th[contains(normalize-space(.), 'Статус')]/following-sibling::td"
