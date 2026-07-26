import sys
import os
import platform
import subprocess
import threading
import queue
from pathlib import Path
from flask import Flask, render_template, Response, jsonify, request, stream_with_context

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / 'config.txt'

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True

_process = None
_process_lock = threading.Lock()

BOT_DIR    = str(BASE_DIR / 'okcrm_bot')
BOT_PYTHON = sys.executable

# Облачный режим: нет локальных скриптов (Render, Railway и т.д.)
IS_CLOUD = 'RENDER' in os.environ or platform.system() != 'Windows'


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


@app.route('/')
def index():
    cfg = load_config()
    cfg['IS_CLOUD'] = IS_CLOUD
    return render_template('dashboard.html', cfg=cfg)


@app.route('/api/status')
def api_status():
    return jsonify({'running': is_running(), 'cloud': IS_CLOUD})


@app.route('/api/stop', methods=['POST'])
def api_stop():
    if _process and _process.poll() is None:
        _process.terminate()
        return jsonify({'ok': True})
    return jsonify({'ok': False})


@app.route('/api/config', methods=['POST'])
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
def stream_bot_run():
    return sse_stream([BOT_PYTHON, 'bot.py'], 'Оформление рассрочек (полный прогон)', cwd=BOT_DIR)


@app.route('/stream/bot/dry_run')
def stream_bot_dry_run():
    return sse_stream([BOT_PYTHON, 'bot.py', '--dry-run'], 'Пробный прогон (dry-run, без изменений)', cwd=BOT_DIR)


@app.route('/stream/bot/order')
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
def stream_bot_session():
    if IS_CLOUD:
        return sse_cloud_error('Захват сессии — нужен локальный Chrome с CDP')
    return sse_stream([BOT_PYTHON, 'grab_session_from_cdp.py'], 'Захват сессии Google (CDP)', cwd=BOT_DIR)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    if not IS_CLOUD:
        threading.Timer(2.0, lambda: __import__('webbrowser').open(f'http://localhost:{port}')).start()
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
