"""
Загружает сессии и сервисный аккаунт на Render после каждого деплоя.

Запуск:
    python upload_to_render.py

Что делает:
    1. Логинится на zikmes-crm.onrender.com (пароль из RENDER_PASSWORD или 'profi')
    2. Загружает okcrm_bot/storage_state.json      → /api/upload-session (okcrm)
    3. Загружает cloud_crm_state.json               → /api/upload-session (crm)
    4. Загружает service_account.json из Downloads  → /api/upload-service-account
"""

import json, os, pathlib, urllib.request, urllib.parse, urllib.error, http.cookiejar, sys

BASE = os.environ.get('RENDER_URL', 'https://zikmes-crm.onrender.com')
PASSWORD = os.environ.get('RENDER_PASSWORD', 'profi')

HERE = pathlib.Path(__file__).parent  # C:\Uvedomleniya_Rassrochka

# --- пути к файлам ---
OKCRM_STATE  = HERE / 'okcrm_bot' / 'storage_state.json'
CRM_STATE    = HERE / 'cloud_crm_state.json'
SA_JSON      = HERE / 'service_account.json'                     # можно положить сюда
SA_DOWNLOADS = pathlib.Path.home() / 'Downloads' / 'debtor-checker-575d29b3ead2.json'

# ---------------------------------------------------------------

def make_opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def login(opener):
    data = urllib.parse.urlencode({'password': PASSWORD}).encode()
    req  = urllib.request.Request(BASE + '/login', data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    try:
        resp = opener.open(req, timeout=30)
        if '/login' in resp.geturl():
            print('❌ LOGIN FAILED — неверный пароль')
            sys.exit(1)
        print(f'✅ Логин выполнен → {resp.geturl()}')
    except urllib.error.HTTPError as e:
        print(f'❌ Login HTTP {e.code}: {e.read().decode()[:200]}')
        sys.exit(1)

def post_json(opener, url, payload: dict, label: str):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req  = urllib.request.Request(BASE + url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        resp   = opener.open(req, timeout=30)
        result = json.loads(resp.read().decode('utf-8'))
        if result.get('ok'):
            print(f'✅ {label}: {result.get("message", "OK")}')
        else:
            print(f'❌ {label}: {result}')
    except urllib.error.HTTPError as e:
        print(f'❌ {label} HTTP {e.code}: {e.read().decode()[:300]}')

def upload_okcrm(opener):
    if not OKCRM_STATE.exists():
        print(f'⚠️  OKCRM session не найдена: {OKCRM_STATE}')
        return
    state = json.loads(OKCRM_STATE.read_text(encoding='utf-8'))
    post_json(opener, '/api/upload-session',
              {'storage_state': state, 'session_type': 'okcrm'},
              'OKCRM session')

def upload_crm(opener):
    if CRM_STATE.exists():
        state = json.loads(CRM_STATE.read_text(encoding='utf-8'))
    else:
        # fallback: base64-версия (если json ещё не создан)
        b64_file = HERE / 'crm_storage_state.b64'
        if not b64_file.exists():
            print(f'⚠️  CRM session не найдена: {CRM_STATE}')
            return
        import base64
        b64   = b64_file.read_text().strip()
        state = json.loads(base64.b64decode(b64 + '=' * (-len(b64) % 4)).decode('utf-8'))
    post_json(opener, '/api/upload-session',
              {'storage_state': state, 'session_type': 'crm'},
              'CRM session')

def upload_service_account(opener):
    # Сначала ищем рядом со скриптом, потом в Downloads
    sa_path = SA_JSON if SA_JSON.exists() else SA_DOWNLOADS
    if not sa_path.exists():
        print(f'⚠️  service_account.json не найден: проверьте {SA_JSON} или {SA_DOWNLOADS}')
        return
    sa = json.loads(sa_path.read_text(encoding='utf-8'))
    post_json(opener, '/api/upload-service-account',
              {'service_account': sa},
              'Service account')

if __name__ == '__main__':
    print(f'=== Загрузка на {BASE} ===')
    opener = make_opener()
    login(opener)
    upload_okcrm(opener)
    upload_crm(opener)
    upload_service_account(opener)
    print('=== Готово ===')
