@echo off
title Wi-Fi Signal Strength Analyzer
cd /d "%~dp0"

echo ==================================================================
echo   Starting Wi-Fi Signal Strength Analyzer...
echo ==================================================================

if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" app.py
) else (
    echo [ERROR] Virtual environment not found at .\venv.
    echo Please create the virtual environment first:
    echo   python -m venv venv
    pause
    exit /b 1
)

pause
