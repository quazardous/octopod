@echo off
rem octopod-tray.cmd -- the tray, started from a terminal (hidden PowerShell).
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0octopod-tray.ps1"
