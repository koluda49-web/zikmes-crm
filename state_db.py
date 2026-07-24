# -*- coding: utf-8 -*-
"""
Локальное хранилище состояния — какие просроченные платежи уже были
отправлены в Таблицу/СМС-робот. Пока платёж не оплачен — уведомляем один раз
и больше не повторяем. Если статус платежа сменится на "Погашен"/"Оплачен",
запись просто перестаёт попадать в выборку кандидатов (условие в bot.py не
сработает) — чистить вручную не нужно.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "state.sqlite"


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notified_payments (
            payment_key   TEXT PRIMARY KEY,
            order_id      TEXT NOT NULL,
            phone         TEXT,
            amount        TEXT,
            expires       TEXT,
            notified_at   TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def make_key(order_id: str, expires: str, amount: str) -> str:
    """
    Ключ платежа. За неимением отдельного ID платежа в интерфейсе CRM
    (нужно свериться — возможно, он есть в ссылке кнопки редактирования
    платежа в колонке "Действия", тогда лучше использовать его вместо
    этой комбинации) собираем составной ключ.
    """
    return f"{order_id}|{expires}|{amount}"


def is_already_notified(order_id: str, expires: str, amount: str) -> bool:
    conn = _connect()
    try:
        key = make_key(order_id, expires, amount)
        row = conn.execute(
            "SELECT 1 FROM notified_payments WHERE payment_key = ?", (key,)
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def mark_notified(order_id: str, phone: str, amount: str, expires: str, run_date: str) -> None:
    conn = _connect()
    try:
        key = make_key(order_id, expires, amount)
        conn.execute(
            """
            INSERT OR IGNORE INTO notified_payments
                (payment_key, order_id, phone, amount, expires, notified_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (key, order_id, phone, amount, expires, run_date),
        )
        conn.commit()
    finally:
        conn.close()
