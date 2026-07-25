"""
Простое локальное хранилище: какие заказы уже обработаны (идемпотентность),
плюс CSV-очереди для заказов, требующих ручной проверки, и заказов, где бот
упал на ошибке.
"""

import csv
import os
import sqlite3
from contextlib import closing

import config


def init_db():
    with closing(sqlite3.connect(config.STATE_DB_PATH)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_orders (
                order_id TEXT PRIMARY KEY,
                processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                amount_used INTEGER,
                amount_source TEXT
            )
            """
        )
        conn.commit()


def is_processed(order_id: str) -> bool:
    with closing(sqlite3.connect(config.STATE_DB_PATH)) as conn:
        cur = conn.execute(
            "SELECT 1 FROM processed_orders WHERE order_id = ?", (order_id,)
        )
        return cur.fetchone() is not None


def mark_processed(order_id: str, amount_used: int, amount_source: str):
    with closing(sqlite3.connect(config.STATE_DB_PATH)) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO processed_orders (order_id, amount_used, amount_source) "
            "VALUES (?, ?, ?)",
            (order_id, amount_used, amount_source),
        )
        conn.commit()


def _append_csv(path: str, fieldnames: list, row: dict):
    file_exists = os.path.isfile(path)
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def log_manual_review(order_id: str, reason: str, note_amount, percent_amount, note_text: str):
    _append_csv(
        config.MANUAL_REVIEW_CSV,
        ["order_id", "reason", "note_amount", "percent_amount", "note_text"],
        {
            "order_id": order_id,
            "reason": reason,
            "note_amount": note_amount,
            "percent_amount": percent_amount,
            "note_text": note_text,
        },
    )


def log_error(order_id: str, step: str, error_message: str):
    _append_csv(
        config.ERRORS_CSV,
        ["order_id", "step", "error_message"],
        {"order_id": order_id, "step": step, "error_message": error_message},
    )


def log_skipped(order_id: str, reason: str):
    _append_csv(
        config.SKIPPED_CSV,
        ["order_id", "reason"],
        {"order_id": order_id, "reason": reason},
    )
