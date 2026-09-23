' octopod-tray.vbs -- starts the tray with no console window, not even for a moment:
' what the Start menu shortcut and "Start with Windows" run.
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\octopod-tray.ps1""", 0, False
