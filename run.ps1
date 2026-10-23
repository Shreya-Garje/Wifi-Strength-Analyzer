# PowerShell launcher for Wi-Fi Signal Strength Analyzer
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   Starting Wi-Fi Signal Strength Analyzer..." -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan

$PythonExe = Join-Path $ScriptDir "venv\Scripts\python.exe"
if (Test-Path $PythonExe) {
    & $PythonExe (Join-Path $ScriptDir "app.py")
} else {
    Write-Host "[ERROR] Virtual environment not found at .\venv" -ForegroundColor Red
}
