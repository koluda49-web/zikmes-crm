import sys
import os

# Добавляем корень проекта в путь поиска модулей
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from serverless_wsgi import handle_request
from app import app as flask_app

def handler(event, context):
    return handle_request(flask_app, event, context)
