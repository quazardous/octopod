@echo off
rem octopod-tray.cmd -- the tray, started from a terminal, with no window of its own.
start "" conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0octopod-tray.ps1"
