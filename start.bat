@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
    echo Setting up virtual environment, please wait...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: could not create venv.
        echo Make sure Python is installed and added to PATH.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat

python -c "import playwright" 2>nul
if errorlevel 1 (
    echo Installing dependencies, this can take a few minutes...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: pip install failed. Check your internet connection.
        pause
        exit /b 1
    )
    playwright install chromium
    if errorlevel 1 (
        echo ERROR: playwright install chromium failed.
        pause
        exit /b 1
    )
)

if not exist "config.txt" (
    echo ERROR: config.txt not found.
    echo Copy config.example.txt to config.txt and fill in GOOGLE_SHEET_WEBHOOK.
    pause
    exit /b 1
)

python bot.py

echo.
echo Done. Press any key to exit.
pause >nul
