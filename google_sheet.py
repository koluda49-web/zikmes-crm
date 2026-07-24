# -*- coding: utf-8 -*-
"""Отправка строк с просроченными платежами в Google Таблицу (лист "Уведомления")."""

import requests


def send_to_google_sheet(webhook_url: str, rows: list, run_date: str) -> dict:
    """
    rows: список словарей вида
        {
            "order_id": "521685",
            "phone": "375291111111",
            "amount": "246.66",
            "expires": "16.03.2026",
            "status": "Просрочен",
            "order_url": "https://a.ok-crm.com/order/view/521685",
        }
    """
    payload = {
        "action": "upload_notifications",
        "run_date": run_date,
        "rows": rows,
    }
    resp = requests.post(webhook_url, json=payload, timeout=30)
    resp.raise_for_status()
    try:
        return resp.json()
    except ValueError:
        return {"raw_response": resp.text}
