// ==UserScript==
// @name         \u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0434\u043E\u043B\u0436\u043D\u0438\u043A\u043E\u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0438
// @namespace    http://tampermonkey.net/
// @version      4.4
// @updateURL    https://raw.githubusercontent.com/koluda49-web/zikmes-crm/main/tampermonkey/debtor_checker.user.js
// @downloadURL  https://raw.githubusercontent.com/koluda49-web/zikmes-crm/main/tampermonkey/debtor_checker.user.js
// @description  \u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0438 \u0432 CRM \u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u0441\u0442\u0430\u0442\u0443\u0441\u044B \u0432 Google Sheets
// @author       You
// @match        https://a.ok-crm.com/*
// @match        http://localhost:5000/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      a.ok-crm.com
// @connect      sheets.googleapis.com
// @connect      accounts.google.com
// ==/UserScript==

(function () {
    'use strict';

    const ON_CRM = window.location.hostname === 'a.ok-crm.com';

    // ===================== \u041A\u041E\u041D\u0424\u0418\u0413\u0423\u0420\u0410\u0426\u0418\u042F =====================
    const CONFIG = {
        SPREADSHEET_ID: '1rD1WChulpVdzwX6PZ1B4OI7PlmhfU3PqOl1iIbBM3WI',
        SKIP_SHEETS: ['\u0412\u0441\u0435 \u0434\u043E\u043B\u0436\u043D\u0438\u043A\u0438', '\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', '2023 \u0434\u043E\u043B\u0436', '2024 \u0434\u043E\u043B\u0436', '26 \u0434\u043E\u043B\u0436', '\u0421\u043F\u0438\u0441\u043E\u043A 2025 -2026', '\u0421\u0432\u043E\u0434\u043D\u0430\u044F \u0442\u0430\u0431\u043B\u0438\u0446\u0430 6', '\u041E\u0442\u0447\u0451\u0442'],
        COL_ID: 0,
        COL_SUM: 3,
        COL_DATE_DAY: 4,
        COL_DATE_YEAR: 5,
        COL_STATUS: 9,
        OVERDUE_DAYS: 7,
        GOOGLE_CLIENT_ID: '974900437551-dsnncbnaeo9vk71mlsh2m7riv1hrkksg.apps.googleusercontent.com',
        GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
        FETCH_CONCURRENCY: 3,   // \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u044B\u0445 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 \u043A CRM
        FETCH_DELAY: 400,       // \u043F\u0430\u0443\u0437\u0430 \u043C\u0435\u0436\u0434\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u0430\u043C\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u043F\u043E\u0442\u043E\u043A\u0430, \u043C\u0441
    };

    // ===================== \u0421\u0422\u0418\u041B\u0418 =====================
    GM_addStyle(`
        #dc-panel {
            position: fixed;
            top: 60px;
            right: 16px;
            width: 360px;
            background: #1a1f2e;
            border: 1px solid #2d3550;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            color: #c8d0e7;
            z-index: 99999;
            overflow: hidden;
        }
        #dc-header {
            background: #252b3d;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            border-bottom: 1px solid #2d3550;
            user-select: none;
        }
        #dc-header h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: #e8eaf6;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #dc-header h3::before { content: '\u26A0'; color: #f59e0b; }
        #dc-toggle { background: none; border: none; color: #8892b0; cursor: pointer; font-size: 18px; padding: 0; }
        #dc-body { padding: 14px 16px; }
        #dc-panel.collapsed #dc-body { display: none; }
        .dc-btn {
            display: block; width: 100%; padding: 9px 0;
            border: none; border-radius: 8px; font-size: 13px;
            font-weight: 600; cursor: pointer; margin-bottom: 8px;
            transition: opacity 0.15s;
        }
        .dc-btn:hover { filter: brightness(1.1); }
        .dc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .dc-btn-auth   { background: #4285f4; color: #fff; }
        .dc-btn-run    { background: #10b981; color: #fff; }
        .dc-btn-stop   { background: #ef4444; color: #fff; }
        .dc-btn-single { background: #6366f1; color: #fff; }
        #dc-status {
            background: #0f1420; border-radius: 8px;
            padding: 10px 12px; min-height: 60px; max-height: 200px;
            overflow-y: auto; font-size: 12px; line-height: 1.7;
            margin-bottom: 8px; white-space: pre-wrap; word-break: break-all;
        }
        #dc-progress { height: 4px; background: #1e2535; border-radius: 2px; margin-bottom: 8px; overflow: hidden; }
        #dc-progress-bar { height: 100%; background: linear-gradient(90deg,#10b981,#6366f1); width: 0%; transition: width 0.3s; }
        #dc-stats { display: flex; gap: 8px; margin-bottom: 8px; }
        .dc-stat { flex: 1; background: #0f1420; border-radius: 8px; padding: 8px; text-align: center; }
        .dc-stat-num { font-size: 20px; font-weight: 700; line-height: 1.2; }
        .dc-stat-lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; }
        .dc-stat.checked .dc-stat-num { color: #6366f1; }
        .dc-stat.debtors .dc-stat-num { color: #ef4444; }
        .dc-stat.updated .dc-stat-num { color: #10b981; }
        #dc-token-status { font-size: 11px; color: #6b7280; text-align: center; margin-bottom: 8px; }
        #dc-token-status.ok { color: #10b981; }
        #dc-token-status.err { color: #ef4444; }
        .dc-divider { border: none; border-top: 1px solid #2d3550; margin: 10px 0; }
        #dc-sheets-wrap { margin-bottom: 8px; display: none; }
        #dc-sheets-label { font-size: 11px; color: #8892b0; margin-bottom: 6px; display: flex; justify-content: space-between; }
        #dc-sheets-list { display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
        .dc-sheet-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #c8d0e7; cursor: pointer; padding: 3px 0; }
        .dc-sheet-item input { cursor: pointer; accent-color: #10b981; }
        #dc-sheets-all { font-size: 11px; color: #10b981; cursor: pointer; text-decoration: underline; }
        #dc-period-wrap { margin-bottom: 8px; }
        #dc-period-label { font-size: 11px; color: #8892b0; margin-bottom: 5px; }
        #dc-period-row { display: flex; align-items: center; gap: 6px; }
        #dc-period-row input[type=text] {
            width: 88px; background: #0f1420; border: 1px solid #2d3550;
            border-radius: 6px; color: #e8eaf6; padding: 5px 8px;
            font-size: 12px; outline: none; text-align: center;
        }
        #dc-period-row input[type=text]:focus { border-color: #6366f1; }
        #dc-period-row span { color: #6b7280; font-size: 13px; }
        #dc-period-clear {
            font-size: 11px; color: #6b7280; cursor: pointer;
            text-decoration: underline; margin-left: auto;
        }
        #dc-period-clear:hover { color: #ef4444; }

        /* ===== \u0412\u0421\u0422\u0420\u041E\u0415\u041D\u041D\u042B\u0419 \u0420\u0415\u0416\u0418\u041C (localhost) ===== */
        #dc-panel.embedded {
            position: static;
            width: 100%;
            box-shadow: none;
            margin-bottom: 16px;
            border-radius: 12px;
        }
        #dc-panel.embedded.collapsed #dc-header {
            border-bottom: none;
            border-radius: 12px;
        }
        #dc-panel.embedded #dc-toggle {
            font-size: 13px;
            font-weight: 600;
            color: #8892b0;
        }
    `);

    // ===================== \u0421\u041E\u0421\u0422\u041E\u042F\u041D\u0418\u0415 =====================
    let accessToken = GM_getValue('dc_access_token', null);
    let tokenExpiry = GM_getValue('dc_token_expiry', 0);
    let stopFlag = false;
    let running = false;

    // ===================== UI =====================
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'dc-panel';
        panel.innerHTML = `
            <div id="dc-header">
                <h3>\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0434\u043E\u043B\u0436\u043D\u0438\u043A\u043E\u0432</h3>
                <button id="dc-toggle">${ON_CRM ? '\u2212' : '\u25BE \u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C'}</button>
            </div>
            <div id="dc-body">
                <div id="dc-token-status">\u25CF \u041D\u0435 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D</div>
                <button class="dc-btn dc-btn-auth" id="dc-auth-btn">\uD83D\uDD11 \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F Google</button>
                <hr class="dc-divider">
                <div id="dc-period-wrap">
                    <div id="dc-period-label">\uD83D\uDCC5 \u041F\u0435\u0440\u0438\u043E\u0434 \u043F\u043B\u0430\u0442\u0435\u0436\u0435\u0439 (\u043C\u043C.\u0433\u0433\u0433\u0433):</div>
                    <div id="dc-period-row">
                        <input type="text" id="dc-date-from" placeholder="01.2025" maxlength="7">
                        <span>\u2014</span>
                        <input type="text" id="dc-date-to" placeholder="12.2026" maxlength="7">
                        <span id="dc-period-clear">\u0441\u0431\u0440\u043E\u0441</span>
                    </div>
                </div>
                <div id="dc-stats">
                    <div class="dc-stat checked"><div class="dc-stat-num" id="st-checked">0</div><div class="dc-stat-lbl">\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E</div></div>
                    <div class="dc-stat debtors"><div class="dc-stat-num" id="st-debtors">0</div><div class="dc-stat-lbl">\u0414\u043E\u043B\u0436\u043D\u0438\u043A\u043E\u0432</div></div>
                    <div class="dc-stat updated"><div class="dc-stat-num" id="st-updated">0</div><div class="dc-stat-lbl">\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E</div></div>
                </div>
                <div id="dc-progress"><div id="dc-progress-bar"></div></div>
                <div id="dc-sheets-wrap">
                    <div id="dc-sheets-label">
                        <span>\uD83D\uDCCB \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043B\u0438\u0441\u0442\u044B:</span>
                        <span>
                            <span id="dc-sheets-all">\u0412\u0441\u0435</span>
                            &nbsp;|&nbsp;
                            <span id="dc-sheets-none" style="color:#ef4444;cursor:pointer;text-decoration:underline;font-size:11px">\u0421\u043D\u044F\u0442\u044C</span>
                        </span>
                    </div>
                    <div id="dc-sheets-list"></div>
                </div>
                <div id="dc-status">\u0413\u043E\u0442\u043E\u0432 \u043A \u0440\u0430\u0431\u043E\u0442\u0435.</div>
                <button class="dc-btn dc-btn-run" id="dc-run-btn" disabled>\u25B6 \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0432\u0441\u0435\u0445</button>
                ${ON_CRM ? '<button class="dc-btn dc-btn-single" id="dc-single-btn" disabled>\uD83D\uDD0D \u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0437\u0430\u043A\u0430\u0437</button>' : ''}
                <button class="dc-btn dc-btn-stop" id="dc-stop-btn" style="display:none">\u25A0 \u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C</button>
            </div>
        `;

        function setup() {
            document.getElementById('dc-toggle').onclick = () => {
                panel.classList.toggle('collapsed');
                document.getElementById('dc-toggle').textContent =
                    panel.classList.contains('collapsed')
                        ? (ON_CRM ? '+' : '\u25BE \u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C')
                        : (ON_CRM ? '\u2212' : '\u25B4 \u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C');
            };
            document.getElementById('dc-auth-btn').onclick = doAuth;
            document.getElementById('dc-run-btn').onclick = runAll;
            document.getElementById('dc-stop-btn').onclick = () => { stopFlag = true; };
            if (ON_CRM) document.getElementById('dc-single-btn').onclick = checkCurrentOrder;

            document.getElementById('dc-sheets-all').onclick = () => {
                document.querySelectorAll('.dc-sheet-cb').forEach(cb => cb.checked = true);
            };
            document.getElementById('dc-sheets-none').onclick = () => {
                document.querySelectorAll('.dc-sheet-cb').forEach(cb => cb.checked = false);
            };

            const fromEl = document.getElementById('dc-date-from');
            const toEl   = document.getElementById('dc-date-to');
            fromEl.value = GM_getValue('dc_date_from', '');
            toEl.value   = GM_getValue('dc_date_to', '');
            fromEl.oninput = () => GM_setValue('dc_date_from', fromEl.value.trim());
            toEl.oninput   = () => GM_setValue('dc_date_to',   toEl.value.trim());
            document.getElementById('dc-period-clear').onclick = () => {
                fromEl.value = ''; toEl.value = '';
                GM_setValue('dc_date_from', ''); GM_setValue('dc_date_to', '');
            };

            checkTokenStatus();
        }

        if (ON_CRM) {
            document.body.appendChild(panel);
            setup();
        } else {
            panel.classList.add('embedded', 'collapsed');
            const inject = () => {
                const tab = document.getElementById('tab-debtors');
                if (tab) tab.prepend(panel);
                else document.body.appendChild(panel);
                setup();
            };
            if (document.readyState === 'complete') inject();
            else window.addEventListener('load', inject);
        }
    }

    function log(msg, append = true) {
        const el = document.getElementById('dc-status');
        if (!el) return;
        const ts = new Date().toLocaleTimeString('ru-RU');
        if (append) { el.textContent += `[${ts}] ${msg}\n`; el.scrollTop = el.scrollHeight; }
        else el.textContent = `[${ts}] ${msg}\n`;
    }
    function setStat(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    function setProgress(pct) { const el = document.getElementById('dc-progress-bar'); if (el) el.style.width = Math.min(100, pct) + '%'; }
    function setRunning(val) {
        running = val;
        const r = document.getElementById('dc-run-btn');
        const s = document.getElementById('dc-stop-btn');
        const si = document.getElementById('dc-single-btn');
        if (r) r.style.display = val ? 'none' : 'block';
        if (s) s.style.display = val ? 'block' : 'none';
        if (si) si.disabled = val;
    }

    // ===================== \u0424\u0418\u041B\u042C\u0422\u0420 \u041F\u0415\u0420\u0418\u041E\u0414\u0410 =====================
    function parseMonthYear(str) {
        if (!str) return null;
        const m = str.trim().match(/^(\d{1,2})\.(\d{4})$/);
        if (!m) return null;
        return { month: parseInt(m[1], 10) - 1, year: parseInt(m[2], 10) };
    }

    function getDateFilter() {
        const from = parseMonthYear(document.getElementById('dc-date-from')?.value);
        const to   = parseMonthYear(document.getElementById('dc-date-to')?.value);
        return (from || to) ? { from, to } : null;
    }

    function rowInPeriod(rowData, period) {
        if (!period) return true;
        const dayMonth = String(rowData[CONFIG.COL_DATE_DAY] || '').trim();
        const year     = String(rowData[CONFIG.COL_DATE_YEAR] || '').trim();
        if (!dayMonth || !year) return true;
        const parts = dayMonth.split('.');
        if (parts.length < 2) return true;
        const month = parseInt(parts[1], 10) - 1;
        const yr    = parseInt(year, 10);
        if (isNaN(month) || isNaN(yr)) return true;
        const rowVal = yr * 12 + month;
        if (period.from && rowVal < period.from.year * 12 + period.from.month) return false;
        if (period.to   && rowVal > period.to.year   * 12 + period.to.month)   return false;
        return true;
    }

    // ===================== \u0410\u0412\u0422\u041E\u0420\u0418\u0417\u0410\u0426\u0418\u042F =====================
    function checkTokenStatus() {
        const el = document.getElementById('dc-token-status');
        const runBtn = document.getElementById('dc-run-btn');
        const singleBtn = document.getElementById('dc-single-btn');
        if (!el) return;
        if (accessToken && Date.now() < tokenExpiry) {
            el.className = 'ok'; el.textContent = '\u25CF \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D (Google)';
            if (runBtn) runBtn.disabled = false;
            if (singleBtn) singleBtn.disabled = false;
            loadSheetsList();
        } else {
            el.className = 'err'; el.textContent = '\u25CF \u041D\u0435 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D';
            if (runBtn) runBtn.disabled = true;
            if (singleBtn) singleBtn.disabled = true;
        }
    }

    async function loadSheetsList() {
        try {
            const sheets = await getSheetNames();
            const available = sheets.filter(s => !CONFIG.SKIP_SHEETS.includes(s));
            const wrap = document.getElementById('dc-sheets-wrap');
            const list = document.getElementById('dc-sheets-list');
            if (!wrap || !list) return;
            list.innerHTML = '';
            available.forEach(name => {
                const label = document.createElement('label');
                label.className = 'dc-sheet-item';
                label.innerHTML = `<input type="checkbox" class="dc-sheet-cb" value="${name}"> ${name}`;
                list.appendChild(label);
            });
            wrap.style.display = 'block';
        } catch(e) {
            // \u043D\u0435 \u043A\u0440\u0438\u0442\u0438\u0447\u043D\u043E
        }
    }

    function getSelectedSheets() {
        const checked = document.querySelectorAll('.dc-sheet-cb:checked');
        if (checked.length === 0) return null;
        return Array.from(checked).map(cb => cb.value);
    }

    function doAuth() {
        const redirectUri = 'https://a.ok-crm.com/oauth2callback';
        const scope = encodeURIComponent(CONFIG.GOOGLE_SCOPES);
        const state = Math.random().toString(36).slice(2);
        GM_setValue('dc_oauth_state', state);

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${CONFIG.GOOGLE_CLIENT_ID}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=token&` +
            `scope=${scope}&` +
            `state=${state}&` +
            `prompt=select_account`;

        const authTab = window.open(authUrl, '_blank');
        log('\u23F3 \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u0430 \u0432 \u043D\u043E\u0432\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435. \u041F\u043E\u0441\u043B\u0435 \u0432\u0445\u043E\u0434\u0430 \u0432\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u0441\u044E\u0434\u0430.');

        const messageHandler = (event) => {
            if (event.data && event.data.type === 'dc_oauth_token') {
                window.removeEventListener('message', messageHandler);
                accessToken = event.data.token;
                tokenExpiry = Date.now() + (event.data.expiresIn || 3600) * 1000;
                GM_setValue('dc_access_token', accessToken);
                GM_setValue('dc_token_expiry', tokenExpiry);
                log('\u2713 \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u043E\u0448\u043B\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E!');
                checkTokenStatus();
            }
        };
        window.addEventListener('message', messageHandler);

        const checkInterval = setInterval(() => {
            if (!authTab || authTab.closed) {
                clearInterval(checkInterval);
                const savedToken = GM_getValue('dc_access_token', null);
                const savedExpiry = GM_getValue('dc_token_expiry', 0);
                if (savedToken && Date.now() < savedExpiry && savedToken !== accessToken) {
                    accessToken = savedToken;
                    tokenExpiry = savedExpiry;
                    log('\u2713 \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u043E\u0448\u043B\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E!');
                    checkTokenStatus();
                }
                return;
            }
            try {
                const url = authTab.location.href;
                if (url.includes('access_token=') || url.includes('/oauth2callback')) {
                    clearInterval(checkInterval);
                    const hash = url.split('#')[1] || url.split('?')[1] || '';
                    const params = new URLSearchParams(hash);
                    const token = params.get('access_token');
                    if (token) {
                        authTab.close();
                        accessToken = token;
                        const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
                        tokenExpiry = Date.now() + expiresIn * 1000;
                        GM_setValue('dc_access_token', accessToken);
                        GM_setValue('dc_token_expiry', tokenExpiry);
                        log('\u2713 \u0410\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u043E\u0448\u043B\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E!');
                        checkTokenStatus();
                    }
                }
            } catch (e) {
                // Cross-origin \u2014 \u0436\u0434\u0451\u043C \u043F\u043E\u043A\u0430 \u043D\u0435 \u0432\u0435\u0440\u043D\u0451\u0442\u0441\u044F \u043D\u0430 \u043D\u0430\u0448 \u0434\u043E\u043C\u0435\u043D
            }
        }, 300);
    }

    // ===================== SHEETS API =====================
    function sheetsRequest(method, path, body = null) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url: `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${path}`,
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                data: body ? JSON.stringify(body) : undefined,
                onload: r => r.status >= 200 && r.status < 300 ? resolve(JSON.parse(r.responseText)) : reject(new Error(`Sheets ${r.status}: ${r.responseText}`)),
                onerror: e => reject(e),
            });
        });
    }

    async function getSheetNames() {
        const data = await sheetsRequest('GET', '?fields=sheets.properties');
        return data.sheets.map(s => s.properties.title);
    }

    async function getSheetValues(sheetName) {
        const data = await sheetsRequest('GET', `/values/${encodeURIComponent(sheetName)}`);
        return data.values || [];
    }

    function colIndexToLetter(idx) {
        let letter = ''; idx += 1;
        while (idx > 0) { const rem = (idx-1)%26; letter = String.fromCharCode(65+rem)+letter; idx = Math.floor((idx-1)/26); }
        return letter;
    }

    const sheetIdCache = {};

    async function getSheetId(sheetName) {
        if (sheetName in sheetIdCache) return sheetIdCache[sheetName];
        const data = await sheetsRequest('GET', '?fields=sheets.properties');
        for (const s of data.sheets) {
            sheetIdCache[s.properties.title] = s.properties.sheetId;
        }
        return sheetIdCache[sheetName] ?? 0;
    }

    // \u041F\u0430\u043A\u0435\u0442\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C: \u043E\u0434\u0438\u043D batchUpdate \u043D\u0430 \u0444\u043E\u0440\u043C\u0430\u0442\u044B + \u043E\u0434\u0438\u043D values:batchUpdate \u043D\u0430 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F
    async function batchWriteChanges(changes) {
        if (!changes.length) return;
        await getSheetId(changes[0].sheet); // \u043F\u0440\u043E\u0433\u0440\u0435\u0432\u0430\u0435\u043C \u043A\u044D\u0448 sheetId \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u043B\u0438\u0441\u0442\u043E\u0432

        // 1. \u0421\u0431\u0440\u043E\u0441 \u0444\u043E\u0440\u043C\u0430\u0442\u0430 \u044F\u0447\u0435\u0435\u043A (\u0431\u0435\u043B\u044B\u0439 \u0444\u043E\u043D, \u0447\u0451\u0440\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442)
        const fmtRequests = changes.map(c => ({
            repeatCell: {
                range: {
                    sheetId: sheetIdCache[c.sheet] ?? 0,
                    startRowIndex: c.rowIndex - 1,
                    endRowIndex: c.rowIndex,
                    startColumnIndex: CONFIG.COL_STATUS,
                    endColumnIndex: CONFIG.COL_STATUS + 1,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 1, green: 1, blue: 1 },
                        textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
        }));
        for (let i = 0; i < fmtRequests.length; i += 100) {
            await sheetsRequest('POST', ':batchUpdate', { requests: fmtRequests.slice(i, i + 100) });
        }

        // 2. \u0417\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043E\u0434\u043D\u0438\u043C \u043F\u0430\u043A\u0435\u0442\u043E\u043C
        const col = colIndexToLetter(CONFIG.COL_STATUS);
        const data = changes.map(c => ({
            range: `'${c.sheet.replace(/'/g, "''")}'!${col}${c.rowIndex}`,
            majorDimension: 'ROWS',
            values: [['\u0414\u043E\u043B\u0436\u043D\u0438\u043A']],
        }));
        for (let i = 0; i < data.length; i += 100) {
            await sheetsRequest('POST', '/values:batchUpdate', {
                valueInputOption: 'USER_ENTERED',
                data: data.slice(i, i + 100),
            });
        }
    }

    function pushChange(pending, sheet, rowIndex) {
        if (!pending.some(c => c.sheet === sheet && c.rowIndex === rowIndex)) {
            pending.push({ sheet, rowIndex });
        }
    }

    // ===================== CRM \u041F\u0410\u0420\u0421\u0415\u0420 =====================
    function fetchCRMOrder(orderId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://a.ok-crm.com/order/view/${orderId}`,
                headers: { 'Accept': 'text/html' },
                onload: r => r.status === 200 ? resolve(r.responseText) : r.status === 404 ? resolve(null) : reject(new Error(`CRM ${r.status}`)),
                onerror: e => reject(e),
            });
        });
    }

    // \u041F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u0430\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0432\u0441\u0435\u0445 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0438\u0437 CRM (\u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0442\u043E\u043A\u043E\u0432)
    async function fetchAllOrders(ids) {
        const cache = {};
        const queue = [...ids];
        let done = 0;

        async function worker() {
            while (queue.length) {
                if (stopFlag) return;
                const id = queue.shift();
                try {
                    const html = await fetchCRMOrder(id);
                    if (!html) {
                        cache[id] = null;
                        log(`\u26A0 #${id} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D`);
                    } else {
                        cache[id] = parseCRMPayments(html);
                        if (!cache[id]) log(`\u26A0 #${id}: \u043F\u043B\u0430\u0442\u0435\u0436\u0438 \u043D\u0435 \u0440\u0430\u0441\u043F\u0430\u0440\u0441\u0435\u043D\u044B`);
                    }
                } catch (e) {
                    cache[id] = null;
                    log(`\u2717 #${id}: ${e.message}`);
                }
                done++;
                if (done % 25 === 0 || done === ids.length) log(`\u23EC \u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E ${done}/${ids.length}...`);
                setProgress((done / ids.length) * 70);
                await sleep(CONFIG.FETCH_DELAY);
            }
        }

        const workers = Array.from(
            { length: Math.min(CONFIG.FETCH_CONCURRENCY, ids.length) },
            () => worker()
        );
        await Promise.all(workers);
        return cache;
    }

    function parseCRMPayments(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let paymentsTable = null;

        const paymentWidget = doc.querySelector('#w15-widget-payment, [id*="widget-payment"]');
        if (paymentWidget) {
            paymentsTable = paymentWidget.querySelector('table');
        }

        if (!paymentsTable) {
            const allElements = doc.querySelectorAll('h3, h4, .box-header, .panel-title, .card-title');
            for (const el of allElements) {
                if (el.textContent.trim() === '\u041F\u043B\u0430\u0442\u0435\u0436\u0438') {
                    let next = el.closest('.box, .panel, .card');
                    if (next) { paymentsTable = next.querySelector('table'); }
                    if (paymentsTable) break;
                }
            }
        }

        if (!paymentsTable) {
            for (const tbl of doc.querySelectorAll('table')) {
                const text = tbl.textContent.toLowerCase();
                if (text.includes('\u0441\u0443\u043C\u043C\u0430') && text.includes('\u0441\u0442\u0430\u0442\u0443\u0441') && text.includes('\u0438\u0441\u0442\u0435\u043A\u0430\u0435\u0442')) {
                    paymentsTable = tbl;
                    break;
                }
            }
        }

        if (!paymentsTable) return null;

        const payments = [];
        const dataRows = paymentsTable.querySelectorAll('tr[data-key], tbody tr');

        for (const row of dataRows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;

            let sum = 0, status = '', expiryText = '', dateText = '';

            let foundBySeq = false;
            for (const cell of cells) {
                const seq = cell.getAttribute('data-col-seq');
                if (seq === '1') {
                    sum = parseFloat(cell.textContent.trim().replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                    foundBySeq = true;
                }
                if (seq === '4') dateText = cell.textContent.trim();
                if (seq === '6') {
                    const btn = cell.querySelector('button.kv-editable-value') || cell.querySelector('button') || cell.querySelector('a') || cell;
                    status = btn.textContent.trim();
                }
                if (seq === '8') expiryText = cell.textContent.trim();
            }

            if (!foundBySeq && cells.length >= 6) {
                sum = parseFloat(cells[1]?.textContent.trim().replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                dateText = cells[4]?.textContent.trim() || '';
                const statusCell = cells[5];
                const btn = statusCell?.querySelector('button.kv-editable-value') || statusCell?.querySelector('button') || statusCell?.querySelector('a') || statusCell;
                status = btn?.textContent.trim() || '';
                expiryText = cells[7]?.textContent.trim() || '';
            }

            if (sum <= 0) continue;

            const expiryDate = parseDate(expiryText);
            const payDate = parseDate(dateText);

            payments.push({ sum, status, expiryText, expiryDate, dateText, payDate });
        }

        return payments.length > 0 ? payments : null;
    }

    function parseDate(str) {
        if (!str) return null;
        str = str.trim();
        let m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) return new Date(+m[3], +m[2]-1, +m[1]);
        m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]);
        return null;
    }

    // ===================== \u041B\u041E\u0413\u0418\u041A\u0410 \u0421\u0422\u0410\u0422\u0423\u0421\u041E\u0412 =====================
    function isDebtor(payment) {
        const s = payment.status.toLowerCase();
        if (s.includes('\u043F\u043E\u0433\u0430\u0448') || s.includes('\u043E\u043F\u043B\u0430\u0447') || s.includes('paid') || s.includes('\u043D\u0435\u0430\u043A\u0442\u0438\u0432') || s.includes('inactive')) return false;
        if (s.includes('\u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D') || s.includes('overdue')) return true;
        if (s.includes('\u043E\u0436\u0438\u0434\u0430') || s.includes('pending')) {
            const deadline = payment.expiryDate || payment.payDate;
            if (deadline) {
                const today = new Date(); today.setHours(0,0,0,0);
                return (today - deadline) / 86400000 > CONFIG.OVERDUE_DAYS;
            }
        }
        return false;
    }

    // ===================== \u0421\u0422\u0420\u0423\u041A\u0422\u0423\u0420\u0410 \u0422\u0410\u0411\u041B\u0418\u0426\u042B =====================
    function groupRowsById(rows, sheet) {
        const blocks = [];
        let current = null;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const idVal = String(row[CONFIG.COL_ID] || '').trim();
            const rowIndex = i + 1;
            if (idVal && !isNaN(idVal) && idVal !== '') {
                current = { id: parseInt(idVal, 10), sheet, paymentRows: [] };
                const hasDate = String(row[CONFIG.COL_DATE_DAY] || '').trim() !== '';
                if (hasDate) current.paymentRows.push({ rowIndex, rowData: row });
                blocks.push(current);
            } else if (current) {
                const hasDate = String(row[CONFIG.COL_DATE_DAY] || '').trim() !== '';
                if (hasDate) current.paymentRows.push({ rowIndex, rowData: row });
            }
        }
        return blocks;
    }

    // ===================== \u0421\u041E\u041F\u041E\u0421\u0422\u0410\u0412\u041B\u0415\u041D\u0418\u0415 \u041F\u041B\u0410\u0422\u0415\u0416\u0415\u0419 =====================
    function matchPayment(rowData, crmPayments) {
        const tableSum = parseFloat(String(rowData[CONFIG.COL_SUM] || '').replace(',', '.')) || 0;
        const dayMonth = String(rowData[CONFIG.COL_DATE_DAY] || '').trim();
        const year = String(rowData[CONFIG.COL_DATE_YEAR] || '').trim();

        let tableMonth = null, tableYear = null;
        if (dayMonth.includes('.') && year) {
            const parts = dayMonth.split('.');
            if (parts.length >= 2) {
                tableMonth = parseInt(parts[1], 10) - 1;
                tableYear = parseInt(year, 10);
            }
        }

        if (tableSum <= 0) return null;

        const candidates = crmPayments.filter(p => Math.abs(p.sum - tableSum) <= 1.0);
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        if (tableMonth !== null && tableYear !== null) {
            for (const p of candidates) {
                if (p.expiryDate && p.expiryDate.getMonth() === tableMonth && p.expiryDate.getFullYear() === tableYear) return p;
                if (p.payDate && p.payDate.getMonth() === tableMonth && p.payDate.getFullYear() === tableYear) return p;
            }
            for (const p of candidates) {
                if (p.expiryDate && p.expiryDate.getMonth() === tableMonth) return p;
            }
        }

        return candidates[0];
    }

    // ===================== \u041E\u0411\u0420\u0410\u0411\u041E\u0422\u041A\u0410 \u0421\u0422\u0420\u041E\u041A\u0418 (\u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E, \u0431\u0435\u0437 \u0437\u0430\u043F\u0438\u0441\u0438) =====================
    function processRow(sheet, rowIndex, rowData, crmPayments, counts, orderId, changedIds, pending) {
        const matched = matchPayment(rowData, crmPayments);
        if (!matched) {
            log(`  \u24D8 \u0441\u0442\u0440.${rowIndex}: \u043D\u0435 \u0441\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D (\u0441\u0443\u043C\u043C\u0430=${rowData[CONFIG.COL_SUM]}, \u0434\u0430\u0442\u0430=${rowData[CONFIG.COL_DATE_DAY]}.${rowData[CONFIG.COL_DATE_YEAR]})`);
            return;
        }

        const usedIdx = crmPayments.indexOf(matched);
        if (usedIdx !== -1) crmPayments.splice(usedIdx, 1);

        const debtor = isDebtor(matched);
        const currentStatus = String(rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
        const alreadyDebtor = currentStatus.includes('\u0434\u043E\u043B\u0436');

        if (debtor && !alreadyDebtor) {
            counts.debtors++;
            setStat('st-debtors', counts.debtors);
            log(`  \uD83D\uDD34 ${sheet} \u0441\u0442\u0440.${rowIndex}: \u0441\u0442\u0430\u0442\u0443\u0441 CRM="${matched.status}" \u2192 \u0414\u043E\u043B\u0436\u043D\u0438\u043A`);
            pushChange(pending, sheet, rowIndex);
            if (orderId && changedIds && !changedIds.includes(orderId)) changedIds.push(orderId);
        } else if (debtor && alreadyDebtor) {
            counts.debtors++;
            setStat('st-debtors', counts.debtors);
        }
    }

    // ===================== \u0417\u0410\u041F\u0423\u0421\u0422\u0418\u0422\u042C \u0412\u0421\u0415 =====================
    async function runAll() {
        if (running) return;
        if (!accessToken || Date.now() >= tokenExpiry) { log('\u26A0 \u041D\u0443\u0436\u043D\u0430 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F!'); return; }

        stopFlag = false;
        setRunning(true);
        setProgress(0);
        setStat('st-checked', 0); setStat('st-debtors', 0); setStat('st-updated', 0);
        const counts = { checked: 0, debtors: 0, updated: 0 };
        const changedIds = [];
        const pending = [];

        try {
            log('\uD83D\uDCCB \u0427\u0438\u0442\u0430\u0435\u043C \u043B\u0438\u0441\u0442\u044B...', false);
            const selected = getSelectedSheets();
            if (!selected || selected.length === 0) {
                log('\u26A0 \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u043B\u0438\u0441\u0442!');
                setRunning(false);
                return;
            }

            const period = getDateFilter();
            if (period) {
                const fromStr = period.from ? `${String(period.from.month+1).padStart(2,'0')}.${period.from.year}` : '...';
                const toStr   = period.to   ? `${String(period.to.month+1).padStart(2,'0')}.${period.to.year}`   : '...';
                log(`\uD83D\uDCC5 \u041F\u0435\u0440\u0438\u043E\u0434: ${fromStr} \u2014 ${toStr}`);
            }

            log(`\u2713 \u041B\u0438\u0441\u0442\u043E\u0432: ${selected.length} (${selected.join(', ')})`);

            const allBlocks = [];
            for (const sheet of selected) {
                if (stopFlag) break;
                const rows = await getSheetValues(sheet);
                const blocks = groupRowsById(rows, sheet);
                log(`  "${sheet}": ${blocks.length} \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432`);
                allBlocks.push(...blocks);
            }

            const blocks = period
                ? allBlocks.map(b => ({ ...b, paymentRows: b.paymentRows.filter(r => rowInPeriod(r.rowData, period)) }))
                           .filter(b => b.paymentRows.length > 0)
                : allBlocks;

            log(`\uD83D\uDCCA \u041A\u043B\u0438\u0435\u043D\u0442\u043E\u0432${period ? ' \u0432 \u043F\u0435\u0440\u0438\u043E\u0434\u0435' : ''}: ${blocks.length}`);
            if (blocks.length === 0) { log('\u2705 \u041D\u0435\u0447\u0435\u0433\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0442\u044C'); return; }

            // ===== \u0424\u0410\u0417\u0410 1: \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u044B\u0439 \u043F\u0430\u0440\u0441\u0438\u043D\u0433 CRM =====
            const ids = [...new Set(blocks.map(b => b.id))];
            log(`\u23EC \u0424\u0430\u0437\u0430 1: \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 ${ids.length} \u0437\u0430\u043A\u0430\u0437\u043E\u0432 \u0438\u0437 CRM (${CONFIG.FETCH_CONCURRENCY} \u043F\u043E\u0442\u043E\u043A\u043E\u0432)...`);
            const crmCache = await fetchAllOrders(ids);
            if (stopFlag) { log('\u25A0 \u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E'); return; }

            // ===== \u0424\u0410\u0417\u0410 2: \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0430\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 =====
            log(`\uD83D\uDD0E \u0424\u0430\u0437\u0430 2: \u0441\u0432\u0435\u0440\u043A\u0430 \u043F\u043B\u0430\u0442\u0435\u0436\u0435\u0439...`);
            for (const block of blocks) {
                if (stopFlag) break;
                const crmPayments = crmCache[block.id];
                if (!crmPayments) continue;

                const crmPaymentsCopy = [...crmPayments];
                counts.checked++;
                setStat('st-checked', counts.checked);

                for (const { rowIndex, rowData } of block.paymentRows) {
                    processRow(block.sheet, rowIndex, rowData, crmPaymentsCopy, counts, block.id, changedIds, pending);
                }

                // \u041D\u0435\u043F\u0430\u0440\u043D\u044B\u0435 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0438 \u0432 CRM
                const unpaired = crmPaymentsCopy.filter(p => isDebtor(p));
                if (unpaired.length > 0 && block.paymentRows.length > 0) {
                    const lastRow = block.paymentRows[block.paymentRows.length - 1];
                    const lastStatus = String(lastRow.rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
                    const alreadyDebtor = lastStatus.includes('\u0434\u043E\u043B\u0436');
                    counts.debtors++;
                    setStat('st-debtors', counts.debtors);
                    if (!alreadyDebtor) {
                        log(`  \uD83D\uDD34 #${block.id}: \u043D\u0435\u043F\u0430\u0440\u043D\u044B\u0439 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0439 \u043F\u043B\u0430\u0442\u0451\u0436 (${unpaired[0].sum} \u0440\u0443\u0431, "${unpaired[0].status}") \u2192 \u0414\u043E\u043B\u0436\u043D\u0438\u043A \u043D\u0430 \u0441\u0442\u0440.${lastRow.rowIndex}`);
                        pushChange(pending, block.sheet, lastRow.rowIndex);
                        if (!changedIds.includes(block.id)) changedIds.push(block.id);
                    } else {
                        log(`  \uD83D\uDD34 #${block.id}: \u043D\u0435\u043F\u0430\u0440\u043D\u044B\u0439 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0439 \u043F\u043B\u0430\u0442\u0451\u0436, \u0441\u0442\u0440.${lastRow.rowIndex} \u0443\u0436\u0435 \u0414\u043E\u043B\u0436\u043D\u0438\u043A`);
                    }
                }
            }
            setProgress(85);

            // ===== \u0424\u0410\u0417\u0410 3: \u043F\u0430\u043A\u0435\u0442\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C =====
            if (pending.length > 0) {
                log(`\uD83D\uDCBE \u0424\u0430\u0437\u0430 3: \u0437\u0430\u043F\u0438\u0441\u044C ${pending.length} \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043F\u0430\u043A\u0435\u0442\u043E\u043C...`);
                await batchWriteChanges(pending);
                counts.updated = pending.length;
                setStat('st-updated', counts.updated);
                log(`\u2713 \u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E: ${pending.length}`);
            } else {
                log('\uD83D\uDCBE \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043D\u0435\u0442 \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u043D\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F');
            }

            setProgress(100);
            log(`\n\u2705 \u0413\u043E\u0442\u043E\u0432\u043E! \u041A\u043B\u0438\u0435\u043D\u0442\u043E\u0432: ${counts.checked}, \u0414\u043E\u043B\u0436\u043D\u0438\u043A\u043E\u0432: ${counts.debtors}, \u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E: ${counts.updated}`);
            if (changedIds.length > 0) {
                log(`\n\uD83D\uDCDD ID \u0441 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F\u043C\u0438 (${changedIds.length}):`);
                log(changedIds.join(', '));
            } else {
                log(`\uD83D\uDCDD \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043D\u0435 \u0431\u044B\u043B\u043E`);
            }
        } catch (e) {
            log(`\u2717 \u041E\u0448\u0438\u0431\u043A\u0430: ${e.message}`);
            console.error('[DebtorChecker]', e);
        } finally {
            setRunning(false);
        }
    }

    // ===================== \u041F\u0420\u041E\u0412\u0415\u0420\u0418\u0422\u042C \u0422\u0415\u041A\u0423\u0429\u0418\u0419 \u0417\u0410\u041A\u0410\u0417 =====================
    async function checkCurrentOrder() {
        const m = window.location.pathname.match(/\/order\/view\/(\d+)/);
        if (!m) { log('\u26A0 \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0437\u0430\u043A\u0430\u0437\u0430'); return; }
        if (!accessToken || Date.now() >= tokenExpiry) { log('\u26A0 \u041D\u0443\u0436\u043D\u0430 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F!'); return; }

        const orderId = parseInt(m[1], 10);
        log(`\uD83D\uDD0D \u0417\u0430\u043A\u0430\u0437 #${orderId}...`, false);

        try {
            const crmPayments = parseCRMPayments(document.documentElement.outerHTML);
            if (!crmPayments || crmPayments.length === 0) { log('\u26A0 \u041F\u043B\u0430\u0442\u0435\u0436\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435'); return; }

            log(`\u2713 \u041F\u043B\u0430\u0442\u0435\u0436\u0435\u0439 \u0432 CRM: ${crmPayments.length}`);
            crmPayments.forEach((p, i) => {
                const mark = isDebtor(p) ? '\uD83D\uDD34 \u0414\u041E\u041B\u0416\u041D\u0418\u041A' : '\uD83D\uDFE2 OK';
                log(`  ${i+1}. ${p.sum} \u0440\u0443\u0431 | \u0441\u0442\u0430\u0442\u0443\u0441: "${p.status}" | \u0438\u0441\u0442\u0435\u043A\u0430\u0435\u0442: ${p.expiryText||'\u2014'} | ${mark}`);
            });

            log(`\n\uD83D\uDCCB \u0418\u0449\u0435\u043C \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435...`);
            const period = getDateFilter();
            const sheets = await getSheetNames();
            const targetSheets = sheets.filter(s => !CONFIG.SKIP_SHEETS.includes(s));
            const counts = { checked: 0, debtors: 0, updated: 0 };
            const pending = [];

            for (const sheet of targetSheets) {
                const rows = await getSheetValues(sheet);
                const blocks = groupRowsById(rows, sheet).filter(b => b.id === orderId);
                if (blocks.length === 0) continue;

                for (const block of blocks) {
                    const filteredRows = period
                        ? block.paymentRows.filter(r => rowInPeriod(r.rowData, period))
                        : block.paymentRows;
                    if (filteredRows.length === 0) continue;

                    log(`  \u041B\u0438\u0441\u0442 "${sheet}": ${filteredRows.length} \u0441\u0442\u0440\u043E\u043A \u043F\u043B\u0430\u0442\u0435\u0436\u0435\u0439`);
                    counts.checked++;
                    const crmPaymentsCopy = [...crmPayments];
                    for (const { rowIndex, rowData } of filteredRows) {
                        processRow(sheet, rowIndex, rowData, crmPaymentsCopy, counts, orderId, null, pending);
                    }
                    const unpaired = crmPaymentsCopy.filter(p => isDebtor(p));
                    if (unpaired.length > 0 && filteredRows.length > 0) {
                        const lastRow = filteredRows[filteredRows.length - 1];
                        const lastStatus = String(lastRow.rowData[CONFIG.COL_STATUS] || '').trim().toLowerCase();
                        if (!lastStatus.includes('\u0434\u043E\u043B\u0436')) {
                            counts.debtors++;
                            setStat('st-debtors', counts.debtors);
                            log(`  \uD83D\uDD34 \u043D\u0435\u043F\u0430\u0440\u043D\u044B\u0439 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0439 \u043F\u043B\u0430\u0442\u0451\u0436 (${unpaired[0].sum} \u0440\u0443\u0431) \u2192 \u0441\u0442\u0440.${lastRow.rowIndex}`);
                            pushChange(pending, sheet, lastRow.rowIndex);
                        }
                    }
                }
            }

            if (pending.length > 0) {
                log(`\uD83D\uDCBE \u0417\u0430\u043F\u0438\u0441\u044C ${pending.length} \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439...`);
                await batchWriteChanges(pending);
                counts.updated = pending.length;
                setStat('st-updated', counts.updated);
            }

            if (counts.checked === 0) log(`\u26A0 \u0417\u0430\u043A\u0430\u0437 #${orderId} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435`);
            else log(`\n\u2705 \u0413\u043E\u0442\u043E\u0432\u043E! \u0414\u043E\u043B\u0436\u043D\u0438\u043A\u043E\u0432: ${counts.debtors}, \u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E: ${counts.updated}`);

        } catch (e) {
            log(`\u2717 \u041E\u0448\u0438\u0431\u043A\u0430: ${e.message}`);
            console.error('[DebtorChecker]', e);
        }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ===================== \u0421\u0422\u0410\u0420\u0422 =====================
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
    else createPanel();

})();
