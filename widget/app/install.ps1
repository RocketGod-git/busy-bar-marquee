# Builds Marquee.exe from source, installs it to %LOCALAPPDATA%\Programs\Marquee, and adds Start menu
# and desktop shortcuts. Needs the .NET 10 SDK and Node.js 24.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File widget\app\install.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Marquee'
$exe = Join-Path $dest 'Marquee.exe'

Get-Process Marquee -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet publish (Join-Path $here 'Marquee.csproj') -c Release --self-contained false -o $dest --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

$shell = New-Object -ComObject WScript.Shell
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Marquee.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Marquee.lnk'
foreach ($link in @($startMenu, $desktop)) {
    $s = $shell.CreateShortcut($link)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $dest
    $s.IconLocation = "$exe,0"
    $s.Description = 'Control the BUSY Bar Marquee app'
    $s.Save()
}
Write-Host "Installed $exe"
Write-Host 'To pin it, open Marquee, right-click its taskbar icon, and choose Pin to taskbar.'
