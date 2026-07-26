import sys
import os
import platform
import subprocess
import threading
import queue
from functools import wraps
from pathlib import Path
from flask import Flask, render_template, Response, jsonify, request, stream_with_context, session, redirect, url_for

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / 'config.txt'

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.secret_key = os.environ.get('SECRET_KEY', 'zikmes-crm-2026-key')

APP_PASSWORD = os.environ.get('APP_PASSWORD', 'shtenli')


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('authenticated'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

_process = None
_process_lock = threading.Lock()

BOT_DIR    = str(BASE_DIR / 'okcrm_bot')
BOT_PYTHON = sys.executable

# Облачный режим: нет локальных скриптов (Render, Railway и т.д.)
IS_CLOUD = 'RENDER' in os.environ or platform.system() != 'Windows'

# Автовосстановление учётных данных из переменных окружения Render.
# Позволяет не загружать файлы вручную после каждого деплоя.
def _restore_from_env():
    import json as _json, base64 as _b64

    # 1) service_account.json из GOOGLE_SA_JSON (JSON-строка)
    _sa_env = os.environ.get('GOOGLE_SA_JSON', '').strip()
    _sa_target = BASE_DIR / 'okcrm_bot' / 'service_account.json'
    if _sa_env and not _sa_target.exists():
        try:
            _sa_obj = _json.loads(_sa_env)
            _sa_target.write_text(_json.dumps(_sa_obj, ensure_ascii=False, indent=2), encoding='utf-8')
            print(f'[startup] service_account.json ← GOOGLE_SA_JSON ({_sa_obj.get("client_email","?")})', flush=True)
        except Exception as _e:
            print(f'[startup] WARN GOOGLE_SA_JSON: {_e}', flush=True)

    # 2) okcrm_bot/storage_state.json из OKCRM_SESSION_B64
    _okcrm_b64 = os.environ.get('OKCRM_SESSION_B64', '').strip()
    _okcrm_target = BASE_DIR / 'okcrm_bot' / 'storage_state.json'
    if _okcrm_b64 and not _okcrm_target.exists():
        try:
            _data = _b64.b64decode(_okcrm_b64 + '==').decode('utf-8')
            _okcrm_target.write_text(_data, encoding='utf-8')
            _n = len(_json.loads(_data).get('cookies', []))
            print(f'[startup] okcrm storage_state.json ← OKCRM_SESSION_B64 ({_n} cookies)', flush=True)
        except Exception as _e:
            print(f'[startup] WARN OKCRM_SESSION_B64: {_e}', flush=True)

    # 3) cloud_crm_state.json из CRM_SESSION_B64
    _crm_b64 = os.environ.get('CRM_SESSION_B64', '').strip()
    _crm_target = BASE_DIR / 'cloud_crm_state.json'
    if _crm_b64 and not _crm_target.exists():
        try:
            _data = _b64.b64decode(_crm_b64 + '==').decode('utf-8')
            _crm_target.write_text(_data, encoding='utf-8')
            _n = len(_json.loads(_data).get('cookies', []))
            print(f'[startup] cloud_crm_state.json ← CRM_SESSION_B64 ({_n} cookies)', flush=True)
        except Exception as _e:
            print(f'[startup] WARN CRM_SESSION_B64: {_e}', flush=True)

_restore_from_env()

# Runtime-фикс: на Python 3.14 файл okcrm_bot/selectors.py затеняет stdlib selectors.
# Если старый деплой — переименовываем файл и патчим импорт в bot.py прямо при старте.
_sel_old = BASE_DIR / 'okcrm_bot' / 'selectors.py'
_sel_new = BASE_DIR / 'okcrm_bot' / 'bot_selectors.py'
if _sel_old.exists() and not _sel_new.exists():
    _sel_old.rename(_sel_new)
    _bot_py = BASE_DIR / 'okcrm_bot' / 'bot.py'
    _txt = _bot_py.read_text('utf-8')
    _bot_py.write_text(_txt.replace('import selectors as sel', 'import bot_selectors as sel'), 'utf-8')
    print('[startup-fix] selectors.py → bot_selectors.py, bot.py пропатчен', flush=True)


def is_running():
    return _process is not None and _process.poll() is None


def load_config():
    config = {}
    if CONFIG_FILE.exists():
        for line in CONFIG_FILE.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            config[k.strip()] = v.strip()
    # Переменные окружения (Render dashboard) перекрывают config.txt
    for key in [
        'CRM_ORDERS_URL', 'GOOGLE_SHEET_WEBHOOK', 'OVERDUE_DAYS',
        'PAID_STATUSES', 'ROUTE_DATE_FROM', 'ROUTE_DATE_TO',
        'ROUTE_DATE_DAYS_BACK', 'MTS_LOGIN', 'MTS_PASSWORD',
        'DEBTOR_REGISTRY_WEBHOOK', 'DEBTOR_REGISTRY_SECRET',
        'SALARY_REPORT_SCRIPT_URL',
    ]:
        env_val = os.environ.get(key)
        if env_val:
            config[key] = env_val
    return config


def save_config_keys(updates: dict):
    safe = {'ROUTE_DATE_FROM', 'ROUTE_DATE_TO', 'ROUTE_DATE_DAYS_BACK', 'OVERDUE_DAYS'}
    lines = CONFIG_FILE.read_text(encoding='utf-8').splitlines() if CONFIG_FILE.exists() else []
    result = []
    for line in lines:
        s = line.strip()
        if s and not s.startswith('#') and '=' in s:
            k = s.split('=', 1)[0].strip()
            if k in safe and k in updates:
                result.append(f'{k}={updates[k]}')
                continue
        result.append(line)
    CONFIG_FILE.write_text('\n'.join(result), encoding='utf-8')


def _run_proc(cmd, cwd=None, extra_env=None):
    global _process
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1'}
    if extra_env:
        env.update(extra_env)
    with _process_lock:
        if is_running():
            return None
        _process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            cwd=cwd or str(BASE_DIR),
            env=env,
        )
        return _process


def sse_stream(cmd, label, cwd=None, extra_env=None):
    @stream_with_context
    def generate():
        proc = _run_proc(cmd, cwd=cwd, extra_env=extra_env)
        if proc is None:
            yield 'data: [ЗАНЯТО] Дождитесь завершения текущего процесса\n\n'
            return
        yield f'data: ▶ {label}\n\n'

        q = queue.Queue()

        def _reader():
            for line in iter(proc.stdout.readline, ''):
                q.put(line)
            q.put(None)

        threading.Thread(target=_reader, daemon=True).start()

        try:
            while True:
                try:
                    line = q.get(timeout=20)
                    if line is None:
                        break
                    yield f'data: {line.rstrip()}\n\n'
                except queue.Empty:
                    yield ': keepalive\n\n'
            proc.wait()
            code = proc.returncode
            if code == 0:
                yield 'data: ✓ Завершено успешно\n\n'
            else:
                yield f'data: ✗ Завершено с ошибкой (код {code})\n\n'
        except Exception as e:
            yield f'data: ✗ Ошибка: {e}\n\n'
        finally:
            if proc.poll() is None:
                proc.terminate()
            yield 'data: [END]\n\n'

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


def sse_cloud_error(label):
    """Заглушка для subprocess-маршрутов в облачном режиме."""
    @stream_with_context
    def generate():
        yield f'data: ⚠ {label}\n\n'
        yield 'data: Этот процесс запускает скрипты на локальном ПК и недоступен в облачном режиме.\n\n'
        yield 'data: Запустите дашборд локально (start_dashboard.bat) для полного функционала.\n\n'
        yield 'data: [END]\n\n'
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == APP_PASSWORD:
            session['authenticated'] = True
            return redirect(url_for('index'))
        error = 'Неверный пароль'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@requires_auth
def index():
    cfg = load_config()
    cfg['IS_CLOUD'] = IS_CLOUD
    return render_template('dashboard.html', cfg=cfg)


@app.route('/api/status')
@requires_auth
def api_status():
    return jsonify({'running': is_running(), 'cloud': IS_CLOUD})


@app.route('/api/stop', methods=['POST'])
@requires_auth
def api_stop():
    if _process and _process.poll() is None:
        _process.terminate()
        return jsonify({'ok': True})
    return jsonify({'ok': False})


@app.route('/api/config', methods=['POST'])
@requires_auth
def api_config():
    if IS_CLOUD:
        return jsonify({'ok': False, 'error': 'config readonly in cloud mode'})
    save_config_keys(request.json or {})
    return jsonify({'ok': True})


MTS_LABELS = {
    'debtors_export':       'Экспорт номеров из реестра',
    'call_debtors':         'Запуск задания обзвона в МТС',
    'fetch_debtors_report': 'Скачивание отчёта МТС и отправка в реестр',
    'debtors_full_cycle':   'Полный цикл: экспорт → обзвон → отчёт',
    'debtors_merge':        'Отправка отчёта в реестр',
}


@app.route('/api/salary-report')
@requires_auth
def salary_report():
    cfg = load_config()
    script_url = cfg.get('SALARY_REPORT_SCRIPT_URL', '')

    @stream_with_context
    def generate():
        import urllib.request, json as _json
        if not script_url or 'ЗАМЕНИ' in script_url:
            yield 'data: ✗ SALARY_REPORT_SCRIPT_URL не настроен\n\n'
            yield 'data: [END]\n\n'
            return
        yield 'data: ▶ Генерация отчёта по ЗП...\n\n'
        yield 'data: 📊 Запрос к Google Apps Script — ждите 30-60 сек...\n\n'
        try:
            with urllib.request.urlopen(script_url, timeout=180) as resp:
                data = _json.loads(resp.read().decode('utf-8'))
            if data.get('ok') and data.get('url'):
                n = data.get('rows', '?')
                yield f'data: ✓ Экспортировано строк: {n}\n\n'
                yield f'data: 📎 LINK:{data["url"]}\n\n'
            else:
                yield f'data: ✗ Ошибка: {data.get("error", "неизвестная ошибка")}\n\n'
        except Exception as e:
            yield f'data: ✗ Ошибка: {e}\n\n'
        yield 'data: [END]\n\n'
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/stream/scan')
@requires_auth
def stream_scan():
    extra = {}
    d_from = request.args.get('date_from', '').strip()
    d_to   = request.args.get('date_to', '').strip()
    if d_from:
        extra['ROUTE_DATE_FROM'] = d_from
    if d_to:
        extra['ROUTE_DATE_TO'] = d_to
    return sse_stream([sys.executable, 'bot.py'], 'Парсер просрочки CRM', extra_env=extra or None)


@app.route('/stream/mts/<action>')
@requires_auth
def stream_mts(action):
    if action not in MTS_LABELS:
        return jsonify({'error': 'unknown action'}), 400
    cmd = [sys.executable, 'scrape_crm.py', action]
    label = MTS_LABELS[action]
    if action == 'debtors_merge':
        f = request.args.get('file', 'report.csv')
        cmd.append(f)
        label = f'Отправка отчёта: {f}'
    return sse_stream(cmd, label)


@app.route('/stream/bot/run')
@requires_auth
def stream_bot_run():
    return sse_stream([BOT_PYTHON, 'bot.py'], 'Оформление рассрочек (полный прогон)', cwd=BOT_DIR)


@app.route('/stream/bot/dry_run')
@requires_auth
def stream_bot_dry_run():
    return sse_stream([BOT_PYTHON, 'bot.py', '--dry-run'], 'Пробный прогон (dry-run, без изменений)', cwd=BOT_DIR)


@app.route('/stream/bot/order')
@requires_auth
def stream_bot_order():
    order_id = request.args.get('id', '').strip()
    force = request.args.get('force', '0') == '1'
    if not order_id:
        return jsonify({'error': 'order_id required'}), 400
    cmd = [BOT_PYTHON, 'bot.py', '--order-id', order_id]
    if force:
        cmd.append('--force')
    label = f'Заказ {order_id}' + (' (force)' if force else '')
    return sse_stream(cmd, label, cwd=BOT_DIR)


@app.route('/stream/bot/session')
@requires_auth
def stream_bot_session():
    if IS_CLOUD:
        return sse_cloud_error('Захват сессии — нужен локальный Chrome с CDP')
    return sse_stream([BOT_PYTHON, 'grab_session_from_cdp.py'], 'Захват сессии Google (CDP)', cwd=BOT_DIR)


@app.route('/api/upload-session', methods=['POST'])
@requires_auth
def api_upload_session():
    """Облачная замена grab_session_from_cdp.py: принять storage_state.json через браузер.

    Принимает {"storage_state": {...}} (JSON-объект), строку с JSON-текстом
    или base64-строку. Пишет в okcrm_bot/storage_state.json атомарно.

    ВАЖНО: если в Render задана переменная OKCRM_STORAGE_STATE, config.py при
    импорте переключит STORAGE_STATE_PATH на cloud_storage_state.json и загруженный
    файл будет проигнорирован. Поэтому переменную снимаем из окружения процесса
    (работает при gunicorn --workers 1, что и задано в render.yaml).

    Файл живёт до следующего деплоя/перезапуска (ФС на Render эфемерная).
    """
    import json as _json
    import base64 as _base64

    if not IS_CLOUD:
        return jsonify({'ok': False, 'error': 'только для облачного режима'}), 403

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'ok': False, 'error': 'ожидался JSON-объект в теле запроса'}), 400

    raw = payload.get('storage_state')
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return jsonify({'ok': False, 'error': 'пустое поле storage_state'}), 400

    if isinstance(raw, dict):
        state = raw
    elif isinstance(raw, str):
        text = raw.strip()
        state = None
        problems = []
        # 1) обычный JSON-текст — самый частый случай (копипаста файла)
        try:
            state = _json.loads(text)
        except Exception as e:
            problems.append(f'как JSON: {e}')
        # 2) иначе base64 → JSON (передача через буфер обмена / env var)
        if not isinstance(state, dict):
            compact = ''.join(text.split())         # убираем переносы строк и пробелы
            compact += '=' * (-len(compact) % 4)    # чиним padding
            try:
                state = _json.loads(_base64.b64decode(compact, validate=True).decode('utf-8'))
            except Exception as e:
                problems.append(f'как base64: {e}')
                state = None
        if not isinstance(state, dict):
            return jsonify({
                'ok': False,
                'error': 'строку не удалось разобрать (' + '; '.join(problems) + ')',
            }), 400
    else:
        return jsonify({
            'ok': False,
            'error': 'storage_state должен быть JSON-объектом или строкой (JSON/base64)',
        }), 400

    cookies = state.get('cookies')
    if not isinstance(cookies, list):
        return jsonify({
            'ok': False,
            'error': 'в storage_state нет списка "cookies" — это не файл сессии Playwright',
        }), 400
    if not cookies:
        return jsonify({
            'ok': False,
            'error': 'список "cookies" пуст — сессия не была захвачена',
        }), 400

    # session_type='crm'  → cloud_crm_state.json (для root bot.py / дебиторов)
    # session_type='okcrm' или отсутствует → okcrm_bot/storage_state.json
    session_type = payload.get('session_type', 'okcrm')

    if session_type == 'crm':
        target = BASE_DIR / 'cloud_crm_state.json'
        os.environ.pop('CRM_STORAGE_STATE', None)
        label = 'cloud_crm_state.json'
    else:
        # Снимаем env var до записи: иначе config.py бота при следующем запуске
        # подсунет ему cloud_storage_state.json со старой сессией из Render env.
        os.environ.pop('OKCRM_STORAGE_STATE', None)
        target = Path(BOT_DIR) / 'storage_state.json'
        label = 'okcrm_bot/storage_state.json'

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + '.tmp')
        tmp.write_text(
            _json.dumps(state, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        os.replace(str(tmp), str(target))  # атомарно — бот не прочитает недописанный файл
    except Exception as e:
        return jsonify({'ok': False, 'error': f'не удалось записать файл: {e}'}), 500

    n = len(cookies)
    origins = state.get('origins')
    return jsonify({
        'ok': True,
        'cookies': n,
        'origins': len(origins) if isinstance(origins, list) else 0,
        'message': (
            f'Сессия сохранена: {n} cookies → {label}. '
            'Активна до следующего передеплоя.'
        ),
    })


@app.route('/api/upload-service-account', methods=['POST'])
@requires_auth
def api_upload_service_account():
    """Принимает содержимое service_account.json и сохраняет в okcrm_bot/.
    Тело запроса: {"service_account": {...}} — JSON-объект сервисного аккаунта Google.
    """
    import json as _json
    if not IS_CLOUD:
        return jsonify({'ok': False, 'error': 'только для облачного режима'}), 403
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'ok': False, 'error': 'ожидался JSON-объект'}), 400
    sa = payload.get('service_account')
    if not isinstance(sa, dict) or 'type' not in sa:
        return jsonify({'ok': False, 'error': 'нет поля service_account или неверный формат'}), 400
    target = Path(BOT_DIR) / 'service_account.json'
    try:
        tmp = target.with_name(target.name + '.tmp')
        tmp.write_text(_json.dumps(sa, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(str(tmp), str(target))
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
    return jsonify({'ok': True, 'message': f'service_account.json сохранён ({sa.get("client_email", "?")})'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    if not IS_CLOUD:
        threading.Timer(2.0, lambda: __import__('webbrowser').open(f'http://localhost:{port}')).start()
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
