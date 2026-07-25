import sys
import os

# Добавляем директорию функции в путь (flask_app.py и templates/ копируются при сборке)
_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _dir)

from serverless_wsgi import handle_request
from flask_app import app  # копируется из корневого app.py командой сборки

def handler(event, context):
    return handle_request(app, event, context)
