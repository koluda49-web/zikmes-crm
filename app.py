import sys
import os
import subprocess
import threading
from pathlib import Path
from flask import Flask, render_template, Response, jsonify, request, stream_with_context

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / 'config.txt'

app = Flask(__name__)

_process = None
_process_lock = threading.Lock()


def is_running():
    return _process is not None and _process.poll() is None


def load_config():
    config = {}
    if not CONFIG_FILE.exists():
        return config
    for line in CONFIG_FILE.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        config[k.strip()] = v.strip()
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


def _run_proc(cmd):
    global _process
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1'}
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
            cwd=str(BASE_DIR),
            env=env,
        )
        return _process


def sse_stream(cmd, label):
    @stream_with_context
    def generate():
        proc = _run_proc(cmd)
        if proc is None:
            yield 'data: [ЗАНЯТО] Дождитесь завершения текущего процесса\n\n'
            return
        yield f'data: ▶ {label}\n\n'
        try:
            for line in iter(proc.stdout.readline, ''):
                yield f'data: {line.rstrip()}\n\n'
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


@app.route('/')
def index():
    cfg = load_config()
    return render_template('dashboard.html', cfg=cfg)


@app.route('/api/status')
def api_status():
    return jsonify({'running': is_running()})


@app.route('/api/stop', methods=['POST'])
def api_stop():
    if _process and _process.poll() is None:
        _process.terminate()
        return jsonify({'ok': True})
    return jsonify({'ok': False})


@app.route('/api/config', methods=['POST'])
def api_config():
    save_config_keys(request.json or {})
    return jsonify({'ok': True})


MTS_LABELS = {
    'debtors_export':       'Экспорт номеров из реестра',
    'call_debtors':         'Запуск задания обзвона в МТС',
    'fetch_debtors_report': 'Скачивание отчёта МТС и отправка в реестр',
    'debtors_full_cycle':   'Полный цикл: экспорт → обзвон → отчёт',
    'debtors_merge':        'Отправка отчёта в реестр',
}


@app.route('/stream/scan')
def stream_scan():
    return sse_stream([sys.executable, 'bot.py'], 'Парсер просрочки CRM')


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


if __name__ == '__main__':
    import webbrowser
    port = 5000
    webbrowser.open(f'http://localhost:{port}')
    app.run(host='127.0.0.1', port=port, threaded=True, debug=False)
