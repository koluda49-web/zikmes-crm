import json

# Минимальный тест: нет внешних зависимостей
def handler(event, context):
    path = event.get('path', '/')
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "text/html; charset=utf-8"},
        "body": "<h1>Python function works!</h1><p>Path: " + path + "</p>",
    }
