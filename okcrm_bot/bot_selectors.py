"""
Большинство селекторов ниже подтверждены вручную через DevTools/codegen на
реальной CRM (помечены "ПОДТВЕРЖДЕНО"). Пагинация списка заказов не требуется:
бот вместо неё просто перечитывает первую страницу после каждой обработанной
пачки (обработанные заказы меняют статус и выпадают из фильтра "Заморожен").
"""

# ---------- Фильтры на странице списка заказов (ПОДТВЕРЖДЕНО через codegen) ----------
# Значения "7" и "1" - это value у соответствующих <option> в CRM, подтверждены
# по вашей записи codegen. Если в другом окружении CRM они окажутся другими -
# поменяйте здесь.
FILTER_PAYMENT_METHOD_VALUE = "7"    # "Расчетный счет"
FILTER_BANK_VALUE = "1"              # "Фирма рассрочка"
FILTER_STATUS_OPTION_TEXT = "Заморожен"

# label текстов селектов - используются как page.get_by_label(...)
LABEL_PAYMENT_METHOD = "Метод оплаты"
LABEL_BANK = "Банк"

# Поле статуса реализовано как searchbox с выпадающим списком опций;
# на странице несколько похожих searchbox с плейсхолдером "Выбрать" - нужный
# оказался третьим по счёту (индекс 2, считая с нуля) - см. codegen: .nth(2)
STATUS_SEARCHBOX_NAME = "Выбрать"
STATUS_SEARCHBOX_INDEX = 2

BTN_FILTER_APPLY_NAME = "фильтр"  # page.get_by_role("button", name="фильтр")

# ---------- Список заказов: строки и переход в карточку ----------
# Ссылка "Просмотр" в столбце "Действия" каждой строки ведёт на /order/view/{id}
VIEW_ORDER_LINK_NAME = "Просмотр"
# Пагинация намеренно не используется - см. docstring collect_order_ids в bot.py

# ---------- Карточка заказа: общие поля ----------
# ВАЖНО (найдено 13.07.2026): ID таблиц вида #w7/#w13 - это автонумерация
# виджетов Yii2 DetailView, которая назначается по порядку отрисовки виджетов
# на странице. Она НЕ постоянна - у разных заказов может отличаться (напр. у
# заказа 597202 та же таблица оказалась #w3, а не #w7), из-за чего бот падал
# в таймаут, не находя элемент с "ожидаемым" ID. Заменено на поиск по тексту
# заголовка строки (<th>) внутри таблицы с классом detail-view - текст
# заголовка не меняется от заказа к заказу, в отличие от автономера ID.
def _detail_field(label: str) -> str:
    return (
        "xpath=//table[contains(@class,'detail-view')]"
        f"//tr[th[normalize-space(text())='{label}']]/td"
    )


FIELD_PRICE = _detail_field("Цена")
FIELD_STATUS_VALUE = _detail_field("Статус")  # используется для проверки, что статус реально сохранился
FIELD_CLIENT_NAME = _detail_field("Имя клиента")
FIELD_ORDER_DATE = _detail_field("Дата оформления")
FIELD_NOTE = _detail_field("Пометка к заказу")

# ---------- Блок "Кредитное предложение" ----------
# Раньше ссылались на таблицу #w13 - подвержено той же проблеме плавающих ID,
# что и #w7 выше. Теперь тоже ищем по тексту заголовка строки.
CREDIT_BLOCK = "xpath=//table[contains(@class,'detail-view')][.//th[normalize-space(text())='Банк']]"
CREDIT_BANK = _detail_field("Банк")
CREDIT_TERM_MONTHS = _detail_field("Срок (мес.)")
CREDIT_DOWNPAYMENT_PERCENT = _detail_field("Первоначальный взнос")   # напр. "50%"
CREDIT_PASSPORT_NUMBER = _detail_field("Номер паспорта")
CREDIT_PASSPORT_ISSUE_DATE = _detail_field("Дата выдачи")
CREDIT_PASSPORT_ISSUED_BY = _detail_field("Кто выдал")
CREDIT_REGISTRATION_ADDRESS = _detail_field("Прописка")

CREDIT_AMOUNT_INPUT = "input[placeholder*='взнос']"   # ПОДТВЕРЖДЕНО: плейсхолдер "...ый взнос (руб.)"
BTN_GENERATE_PAYMENTS = "button:has-text('Генерировать платежи')"
CREDIT_GEAR_ICON = ".btn.btn-box-tool.dropdown-toggle"  # ПОДТВЕРЖДЕНО, но НЕУНИКАЛЬНО на странице -
                                                          # в bot.py используется в паре с CREDIT_PANEL_HEADING
CREDIT_PANEL_HEADING_TEXT = "Кредитное предложение"      # для поиска нужной панели среди нескольких
MENU_ITEM_GENERATE_DOCS_NAME = "Генерировать документы"  # ПОДТВЕРЖДЕНО: get_by_role("link", name=...)

# ---------- Редактирование заказа ----------
BTN_EDIT_ORDER_NAME = "Редактировать"  # используется как get_by_role("link"/"button", name=...)
STATUS_LABEL = "Статус"  # используется как page.get_by_label(sel.STATUS_LABEL)
STATUS_SELECT_CSS = "#order-status"  # ПОДТВЕРЖДЕНО через DevTools: <select id="order-status" name="Order[status]">

BTN_SAVE_ORDER_NAME = "Сохранить"  # ПОДТВЕРЖДЕНО: get_by_role("button", name="Сохранить")

# Поле "Пометка к заказу" в форме редактирования - ЕЩЁ НЕ ПОДТВЕРЖДЕНО явно,
# но по аналогии с подтверждённым "order-status"/"Order[status]" предполагаем
# похожий паттерн именования Yii2 ("Order[comment]"). В bot.py используется с
# запасным вариантом через label, если основной селектор не найдёт поле.
NOTE_TEXTAREA_CSS = "#order-comment"
NOTE_LABEL = "Пометка к заказу"

# ---------- Общее ----------
LOADING_SPINNER = ".loading, .spinner"        # если есть индикатор загрузки - ждать его исчезновения
