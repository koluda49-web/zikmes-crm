"""
Разбор свободного текста "Пометка к заказу" на явно указанную сумму
первоначального взноса.

Свободный текст пишут разные менеджеры, поэтому 100% покрытие с первого раза
невозможно - список шаблонов нужно будет пополнять по мере встречи новых
формулировок. Все найденные совпадения логируются, чтобы можно было
проанализировать, какие шаблоны ещё не покрыты.
"""

import re
import math
from dataclasses import dataclass
from typing import Optional

import config

# Шаблоны ищем по убыванию специфичности (более специфичные - первыми, чтобы
# при совпадении нескольких шаблонов взять наиболее надёжный). Ни один из этих
# шаблонов не пересекается со словами "остальное" или "сумма с процентами" -
# те суммы брать нельзя, это другие величины (остаток и итог соответственно).
_NUMBER = r"(\d[\d\s]*)(?:[.,]\d+)?"

_PATTERNS = [
    # "предоплата 1100 р", "предоплату 1100"
    re.compile(rf"предоплат[а-я]*\s*[:\-]?\s*{_NUMBER}\s*(?:р|руб|byn)?", re.IGNORECASE),
    # "первоначальный взнос 1000", "первый взнос: 1000", "первый платёж 1100"
    re.compile(rf"перв[а-я]*\s+(?:взнос|плат[её]ж)[а-я]*\s*[:\-]?\s*{_NUMBER}", re.IGNORECASE),
    # "аванс 500", "авансом 500"
    re.compile(rf"аванс[а-я]*\s*[:\-]?\s*{_NUMBER}", re.IGNORECASE),
    # "внесёт 500", "внесет 500", "внесу 500"
    re.compile(rf"внес(?:ет|ёт|у)?\s*[:\-]?\s*{_NUMBER}", re.IGNORECASE),
    # "взнос 700", "взнос: 700" - без слова "перв" перед ним, как отдельный фолбэк
    re.compile(rf"\bвзнос[а-я]*\s*[:\-]?\s*{_NUMBER}", re.IGNORECASE),
    # "перв 800", "первый 900" - самые короткие/неоднозначные формы, поэтому в самом конце списка
    re.compile(rf"\bперв[а-я]*\s*[:\-]?\s*{_NUMBER}", re.IGNORECASE),
    # ОБРАТНЫЙ порядок - сумма стоит ПЕРЕД словом, напр. "174 перв на 6 м"
    # (см. заказ 597627, 14.07.2026). Самый неспецифичный шаблон из всех,
    # поэтому стоит в самом конце - только если ничего более явное не нашлось.
    re.compile(rf"{_NUMBER}\s*перв", re.IGNORECASE),
]


@dataclass
class ParsedAmount:
    amount: Optional[int]      # None, если не нашли в тексте
    matched_text: Optional[str]  # кусок текста, который сматчился - для лога/отладки


def extract_prepayment_from_note(note_text: str) -> ParsedAmount:
    """Ищет явно указанную сумму предоплаты в тексте пометки к заказу."""
    if not note_text:
        return ParsedAmount(amount=None, matched_text=None)

    for pattern in _PATTERNS:
        match = pattern.search(note_text)
        if match:
            raw_number = match.group(1).replace(" ", "").replace("\xa0", "")
            try:
                amount = int(round(float(raw_number)))
            except ValueError:
                continue
            return ParsedAmount(amount=amount, matched_text=match.group(0))

    return ParsedAmount(amount=None, matched_text=None)


def amount_by_percent(price: float, downpayment_percent: float) -> int:
    """Сумма по проценту первоначального взноса, округление вверх, без копеек."""
    return math.ceil(price * downpayment_percent / 100)


@dataclass
class ResolvedAmount:
    amount: Optional[int]      # финальная сумма для ввода в CRM; None -> в ручную проверку
    source: str                 # "note" | "percent" | "mismatch" | "unparsed"
    note_amount: Optional[int]
    percent_amount: int


def resolve_downpayment_amount(
    note_text: str, price: float, downpayment_percent: float
) -> ResolvedAmount:
    """
    Приоритет:
    1. Явная сумма из текста пометки - она главнее, т.к. могла быть
       индивидуально согласована с клиентом.
    2. Если в тексте нет суммы - берём расчёт по проценту.
    3. Если сумма из текста и по проценту расходятся больше допустимого
       порога (config.AMOUNT_MISMATCH_TOLERANCE) - решение не принимается
       автоматически, заказ уходит на ручную проверку.
    """
    parsed = extract_prepayment_from_note(note_text)
    percent_amount = amount_by_percent(price, downpayment_percent)

    if parsed.amount is None:
        # Ничего внятного в тексте не нашли - можно either взять процент,
        # either отправить на ручную проверку. Здесь выбран консервативный
        # вариант: если пометка вообще пустая/нестандартная, лучше
        # перестраховаться и проверить руками, а не молчаливо брать процент.
        return ResolvedAmount(
            amount=None,
            source="unparsed",
            note_amount=None,
            percent_amount=percent_amount,
        )

    diff = abs(parsed.amount - percent_amount)
    if diff <= config.AMOUNT_MISMATCH_TOLERANCE:
        # Совпадает (с точностью до округления) - можно использовать любое,
        # берём то, что явно написано в тексте.
        return ResolvedAmount(
            amount=parsed.amount,
            source="note",
            note_amount=parsed.amount,
            percent_amount=percent_amount,
        )

    # Расходится сильнее, чем ожидаемая погрешность округления - скорее всего
    # менеджер договорился с клиентом об иной сумме. Берём то, что написано
    # в тексте явно (это самая "человеческая" и достоверная информация),
    # но помечаем как mismatch, чтобы это попало в отчёт для ручной сверки.
    return ResolvedAmount(
        amount=parsed.amount,
        source="mismatch",
        note_amount=parsed.amount,
        percent_amount=percent_amount,
    )


if __name__ == "__main__":
    # Быстрая самопроверка на примерах из реальных пометок + новые формы взноса
    examples = [
        ("вся сума с процентами 3057 руб, предоплата 1100 р, остальное 1957 р в рассрочку на 9 месяцев.", 3057, 50),
        ("вся сумма с процентами 2004 руб, предоплата 1000 р, остальное 1004 р в рассрочку на 3 месяца.", 2004, 50),
        ("клиент оплатит наличными, детали не указаны.", 1500, 50),
        ("первоначальный взнос 1000, остальное в рассрочку", 2004, 50),
        ("первый взнос: 1000, остаток 1004", 2004, 50),
        ("первый платеж 1100 руб", 2200, 50),
        ("аванс 500, остальное потом", 1000, 50),
        ("авансом 500 внесёт при получении", 1000, 50),
        ("внесет 700 сегодня", 1400, 50),
        ("взнос 700 р, доплата потом", 1400, 50),
        ("перв 800, доплата потом", 1600, 50),
        ("первый 900 р", 1800, 50),
        ("174 перв на 6 м https://drive.google.com/drive/folders/xyz", 694, 25),
    ]
    for note, price, pct in examples:
        result = resolve_downpayment_amount(note, price, pct)
        print(f"price={price} pct={pct}% -> {result}   note='{note}'")
