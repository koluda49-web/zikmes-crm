# -*- coding: utf-8 -*-
"""Нормализация телефонных номеров к формату 375XXXXXXXXX."""

import re


def normalize_phone(raw: str) -> str:
    """
    Приводит номер к виду 375XXXXXXXXX (12 цифр, без плюса/пробелов/скобок).
    Возвращает пустую строку, если номер не удалось распознать.

    Если в ячейке несколько телефонов через запятую (частый случай в этой
    CRM — "+375 44 561-90-64, +375 33 699-01-75") — берётся первый.

    Примеры:
        +375 29 111-11-11   -> 375291111111
        80291111111         -> 375291111111
        375291111111        -> 375291111111
    """
    if not raw:
        return ""

    raw = str(raw).strip()

    # Несколько телефонов через запятую — берём первый
    if "," in raw:
        raw = raw.split(",", 1)[0].strip()

    # На случай если номер попал из Excel как float ("375291111111.0")
    raw = re.sub(r"\.0+$", "", raw)

    digits = re.sub(r"\D", "", raw)

    if not digits:
        return ""

    # 80XXXXXXXXX (11 цифр, начинается с 80) -> 375XXXXXXXXX
    if len(digits) == 11 and digits.startswith("80"):
        digits = "375" + digits[2:]

    # 375XXXXXXXXX (12 цифр) -> как есть
    if len(digits) == 12 and digits.startswith("375"):
        return digits

    # 9 цифр без кода страны (напр. 291111111) -> добавить 375
    if len(digits) == 9:
        digits = "375" + digits

    if len(digits) == 12 and digits.startswith("375"):
        return digits

    return ""


if __name__ == "__main__":
    tests = [
        "+375 29 111-11-11",
        "80291111111",
        "375291111111",
        "375291111111.0",
        "291111111",
        "не телефон",
    ]
    for t in tests:
        print(f"{t!r:30} -> {normalize_phone(t)!r}")
