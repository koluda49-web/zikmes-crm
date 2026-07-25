import sys
import os

# Добавляем установленные пакеты в путь
_dir = os.path.dirname(os.path.abspath(__file__))
_pkg = os.path.join(_dir, '_packages')
if os.path.exists(_pkg):
    sys.path.insert(0, _pkg)

# Добавляем директорию функции в путь (там лежит flask_app.py)
sys.path.insert(0, _dir)

from serverless_wsgi import handle_request
from flask_app import app  # flask_app.py копируется из root app.py при сборке

def handler(event, context):
    return handle_request(app, event, context)
