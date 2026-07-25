"""
Работа с Google Drive: создание вложенных папок (дата -> "id фамилия") и
заливка сгенерированных документов. Использует сервисный аккаунт, которому
нужно заранее выдать доступ на редактирование к родительской папке
(config.PARENT_DRIVE_FOLDER_ID) через обычный "Поделиться" в интерфейсе Диска.
"""

from typing import Optional
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

import config

SCOPES = ["https://www.googleapis.com/auth/drive"]


def get_drive_service():
    creds = service_account.Credentials.from_service_account_file(
        config.GOOGLE_SERVICE_ACCOUNT_JSON, scopes=SCOPES
    )
    return build("drive", "v3", credentials=creds)


def find_or_create_folder(service, name: str, parent_id: str) -> str:
    """Ищет папку с точным именем внутри parent_id, создаёт если не найдена."""
    safe_name = name.replace("'", "\\'")
    query = (
        f"name = '{safe_name}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def get_or_create_order_folder(service, order_date: str, order_id: str, surname: str) -> str:
    """
    Возвращает id папки вида:
      <PARENT_DRIVE_FOLDER_ID>/<order_date>/<order_id> <surname>
    создавая недостающие уровни.
    """
    date_folder_id = find_or_create_folder(
        service, order_date, config.PARENT_DRIVE_FOLDER_ID
    )
    order_folder_name = f"{order_id} {surname}".strip()
    order_folder_id = find_or_create_folder(service, order_folder_name, date_folder_id)
    return order_folder_id


def upload_file(service, local_path: str, parent_folder_id: str, mime_type: Optional[str] = None) -> str:
    file_name = os.path.basename(local_path)
    metadata = {"name": file_name, "parents": [parent_folder_id]}
    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=True)
    uploaded = service.files().create(body=metadata, media_body=media, fields="id").execute()
    return uploaded["id"]
