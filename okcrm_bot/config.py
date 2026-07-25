"""
Все настраиваемые параметры бота.
В облачном режиме (Render) пути абсолютные, сессия грузится из env var.
"""
import os
import base64

_DIR = os.path.dirname(os.path.abspath(__file__))

IS_CLOUD = 'RENDER' in os.environ or os.name != 'nt'

BASE_URL = "https://a.ok-crm.com"

# Сохранённая Google-сессия (создаётся grab_session_from_cdp.py локально)
_STATE_FILE = os.path.join(_DIR, "storage_state.json")

if IS_CLOUD:
    _state_env = os.environ.get('OKCRM_STORAGE_STATE', '')
    if _state_env:
        _cloud_file = os.path.join(_DIR, 'cloud_storage_state.json')
        try:
            with open(_cloud_file, 'w', encoding='utf-8') as _f:
                _f.write(base64.b64decode(_state_env).decode('utf-8'))
            STORAGE_STATE_PATH = _cloud_file
        except Exception as _e:
            print(f"⚠️  Не удалось загрузить OKCRM_STORAGE_STATE: {_e}")
            STORAGE_STATE_PATH = _STATE_FILE
    else:
        STORAGE_STATE_PATH = _STATE_FILE
else:
    STORAGE_STATE_PATH = _STATE_FILE

GOOGLE_SERVICE_ACCOUNT_JSON = os.path.join(_DIR, "service_account.json")

PARENT_DRIVE_FOLDER_ID = "1ogcJIQiZJxK9yh3mjZ7mdwVDea9DKn49"

RUSSIAN_MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

STATE_DB_PATH      = os.path.join(_DIR, "state.sqlite")
MANUAL_REVIEW_CSV  = os.path.join(_DIR, "manual_review.csv")
ERRORS_CSV         = os.path.join(_DIR, "errors.csv")
SKIPPED_CSV        = os.path.join(_DIR, "skipped_orders.csv")
DOWNLOAD_DIR       = os.path.join(_DIR, "downloads")

STATUS_FROZEN = "Заморожен"
STATUS_NEW    = "Новый"

AMOUNT_MISMATCH_TOLERANCE = 5
ACTION_DELAY_SECONDS      = 1.5
