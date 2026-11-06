# Creates a "Marquee" shortcut on your desktop that opens the widget with no console window.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File widget\install-shortcut.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Marquee.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $here 'Marquee.vbs') + '"'
$s.WorkingDirectory = $here
$s.IconLocation = (Join-Path $here 'marquee.ico') + ',0'
$s.Description = 'Control the BUSY Bar Marquee app'
$s.Save()
Write-Host "Created $link"
