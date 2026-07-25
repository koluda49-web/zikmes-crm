@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Зикмес Mini CRM

cd /d "%~dp0"

echo.
echo ========================================
echo   Зикмес Mini CRM - Запуск дашборда
echo ========================================
echo.

:: Создать venv если нет
if not exist "venv\Scripts\python.exe" (
    echo Создаю виртуальное окружение...
    python -m venv venv
    if errorlevel 1 (
        echo ОШИБКА: не удалось создать venv. Проверь установку Python.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat

:: Установить зависимости если нужно
python -c "import flask" 2>nul
if errorlevel 1 (
    echo Устанавливаю зависимости...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ОШИБКА: pip install завершился с ошибкой.
        pause
        exit /b 1
    )
)

python -c "import playwright" 2>nul
if errorlevel 1 (
    echo Устанавливаю Playwright...
    pip install playwright
    playwright install chromium
)

if not exist "config.txt" (
    echo ОШИБКА: config.txt не найден.
    echo Скопируй config.example.txt в config.txt и заполни нужные значения.
    pause
    exit /b 1
)

:: Обновить с GitHub если есть .git
if exist ".git" (
    echo Обновляю код с GitHub...
    git pull
    echo.
)

echo Запускаю дашборд на http://localhost:5000
echo Для остановки нажми Ctrl+C в этом окне.
echo.

venv\Scripts\python.exe app.py

pause
