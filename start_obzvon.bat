@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Обзвон должников - МТС

cd /d "%~dp0"

echo.
echo ========================================
echo   Обзвон должников через МТС
echo ========================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python не найден!
    echo Скачай и установи Python отсюда:
    echo https://www.python.org/downloads/
    echo.
    echo ВАЖНО: при установке поставь галочку "Add Python to PATH".
    echo После установки запусти этот файл снова.
    echo.
    start https://www.python.org/downloads/
    pause
    exit
)

echo Устанавливаю/проверяю нужные библиотеки...
pip install selenium beautifulsoup4 webdriver-manager openpyxl requests pandas -q
echo.

:menu
echo ========================================
echo   Выбери действие:
echo ========================================
echo   1. Выгрузить номера должников из реестра
echo   2. Запустить задание в МТС ("Обзвон должников + дата")
echo   3. Скачать отчёт МТС и отправить результаты в реестр
echo   4. Отправить в реестр уже скачанный отчёт вручную
echo   ----------------------------------------
echo   5. ПОЛНЫЙ ЦИКЛ: пункты 1+2+3 подряд
echo   ----------------------------------------
echo   6. Выход
echo ========================================
set /p choice="Введи цифру: "

if "%choice%"=="1" goto debtorsexport
if "%choice%"=="2" goto debtorscall
if "%choice%"=="3" goto debtorsfetch
if "%choice%"=="4" goto debtorsmerge
if "%choice%"=="5" goto debtorsfullcycle
if "%choice%"=="6" goto end
echo Неверный выбор, попробуй ещё раз.
goto menu

:debtorsexport
echo.
echo Выгружаю номера должников из реестра и готовлю файл для МТС...
echo.
python scrape_crm.py debtors_export
echo.
echo Дальше выбери пункт 2, чтобы создать задание "Обзвон должников" в МТС.
goto finish

:debtorscall
echo.
echo Создаю в МТС задание "Обзвон должников" с датой, загружаю номера...
echo.
python scrape_crm.py call_debtors
goto finish

:debtorsfetch
echo.
echo Открываю МТС, показываю список заданий, скачиваю отчёт и отправляю
echo результаты в реестр должников...
echo.
python scrape_crm.py fetch_debtors_report
goto finish

:debtorsmerge
echo.
set "reportfile=report.csv"
set /p "reportfile=Введи имя файла отчёта МТС (Enter - по умолчанию report.csv): "
echo.
echo Отправляю результаты обзвона должников в реестр...
python scrape_crm.py debtors_merge "%reportfile%"
goto finish

:debtorsfullcycle
echo.
echo ========================================
echo   ПОЛНЫЙ ЦИКЛ ОБЗВОНА ДОЛЖНИКОВ
echo ========================================
echo   Выгрузка из реестра + задание в МТС + ожидание +
echo   скачивание отчёта + отправка результатов в реестр - всё подряд.
echo ========================================
echo.
python scrape_crm.py debtors_full_cycle
goto finish

:finish
echo.
echo ========================================
echo Готово.
echo ========================================
pause
goto menu

:end
exit
