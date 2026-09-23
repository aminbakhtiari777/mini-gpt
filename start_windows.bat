@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Mini-GPT is not installed yet.
    echo Run the installation commands in README.md first.
    pause
    exit /b 1
)

echo Starting Mini-GPT at http://localhost:8000
echo Keep this window open while using the app.
".venv\Scripts\python.exe" scripts\run.py
pause
