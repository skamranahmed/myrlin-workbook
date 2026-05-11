# Setup Myrlin Workbook auto-start on Windows boot (NO user login required).
#
# Registers a Scheduled Task that:
#   1. Fires AT SYSTEM STARTUP (before any user logs on).
#   2. Runs the supervisor (src/supervisor.js), which auto-restarts gui.js on
#      crash (existing CWM_MAX_RESTARTS + CWM_RESTART_DELAY behavior).
#   3. Uses S4U logon (runs as current user without an interactive session,
#      no password prompt). The task fires whether the user is logged on
#      or not -- exactly what the workbook needs to stay reachable on the
#      LAN even after a reboot.
#   4. Restart-on-failure policy on the TASK itself so the supervisor process
#      is relaunched by Task Scheduler if the entire node tree dies (e.g.
#      hard kill, OOM, JS crash that escapes the supervisor's loop).
#
# Run once:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-autostart.ps1
#
# To remove:
#   powershell -Command "Unregister-ScheduledTask -TaskName 'Myrlin-Workbook' -Confirm:$false"

$ErrorActionPreference = 'Stop'

# Resolve project root from this script's location so the installer works
# regardless of where the repo is checked out.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SupervisorScript = Join-Path $ProjectRoot 'src\supervisor.js'

# Locate node.exe via PATH (works for nvm/fnm/Volta) with a Program Files fallback.
$NodeExe = $null
try { $NodeExe = (Get-Command node -ErrorAction Stop).Source } catch { $NodeExe = $null }
if (-not $NodeExe) {
    $candidate = 'C:\Program Files\nodejs\node.exe'
    if (Test-Path $candidate) { $NodeExe = $candidate }
}
if (-not $NodeExe) {
    Write-Error 'Could not locate node.exe on PATH or in C:\Program Files\nodejs. Install Node.js or add it to PATH.'
    exit 1
}

Write-Host "Project root: $ProjectRoot" -ForegroundColor Gray
Write-Host "Node:         $NodeExe" -ForegroundColor Gray
Write-Host "Supervisor:   $SupervisorScript" -ForegroundColor Gray
Write-Host ''

# Build the action: spawn node supervisor.js with --max-old-space-size to
# match the supervisor's own child-spawn args. The supervisor handles its
# own logging (logs/server.log) so we do not redirect stdio here; Task
# Scheduler captures stdout/stderr to its history when verbose history is
# enabled (Event Viewer > Microsoft > Windows > TaskScheduler).
$action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument "--max-old-space-size=4096 `"$SupervisorScript`"" `
    -WorkingDirectory $ProjectRoot

# Trigger: at system boot. Delay 30s so the network stack is up before
# Express tries to bind to 0.0.0.0:3456.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'

# Settings:
#   - Run with highest privileges? No -- the workbook does not need admin.
#   - ExecutionTimeLimit zero so a long-running server is never auto-killed.
#   - StartWhenAvailable so a missed boot trigger (machine was off) runs
#     when the system comes back up.
#   - Battery flags so laptops still start the task on AC or DC.
#   - RestartCount / RestartInterval: belt-and-suspenders. The supervisor's
#     internal loop covers gui.js crashes; this covers cases where the
#     supervisor itself dies (rare but possible: signal 9, JS uncaught
#     during boot, etc). Task Scheduler will relaunch the supervisor up
#     to 3 times with 1-minute spacing.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

# Principal: S4U so the task runs whether the user is logged on or not.
# S4U is the closest Scheduled Task equivalent of "run as service" -- the
# task fires under the user account without an interactive session and
# without storing a password. Works for any account that can log on
# locally; does NOT need admin.
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

# Remove any previous registration so re-running this script is idempotent.
try {
    Unregister-ScheduledTask -TaskName 'Myrlin-Workbook' -Confirm:$false -ErrorAction Stop
    Write-Host 'Removed existing Myrlin-Workbook task.' -ForegroundColor Yellow
} catch {
    # Task did not exist; that is fine.
}

# Also clean up the legacy task name from the previous installer so there
# is only one autostart entry on disk after upgrading.
try {
    Unregister-ScheduledTask -TaskName 'CWM-GUI-AutoStart' -Confirm:$false -ErrorAction Stop
    Write-Host 'Removed legacy CWM-GUI-AutoStart task.' -ForegroundColor Yellow
} catch { }

Register-ScheduledTask `
    -TaskName 'Myrlin-Workbook' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Myrlin Workbook: starts at boot via supervisor, auto-restarts on crash. Runs whether user is logged on or not.' | Out-Null

Write-Host 'Scheduled task "Myrlin-Workbook" registered.' -ForegroundColor Green
Write-Host ''
Write-Host '  Trigger:     System startup (30s delay)' -ForegroundColor Cyan
Write-Host '  Account:     ' -NoNewline -ForegroundColor Cyan; Write-Host "$env:USERDOMAIN\$env:USERNAME (S4U, no login needed)"
Write-Host '  Auto-restart inner: supervisor restarts gui.js on crash' -ForegroundColor Cyan
Write-Host '  Auto-restart outer: Task Scheduler restarts supervisor 3x' -ForegroundColor Cyan
Write-Host ''
Write-Host 'The workbook will be reachable at http://localhost:3456 after every reboot.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'To start the task immediately without rebooting, run:' -ForegroundColor Gray
Write-Host '  Start-ScheduledTask -TaskName "Myrlin-Workbook"' -ForegroundColor Gray
Write-Host ''
Write-Host 'To check status:' -ForegroundColor Gray
Write-Host '  Get-ScheduledTaskInfo -TaskName "Myrlin-Workbook"' -ForegroundColor Gray
Write-Host ''
Write-Host 'To remove autostart:' -ForegroundColor Gray
Write-Host '  Unregister-ScheduledTask -TaskName "Myrlin-Workbook" -Confirm:$false' -ForegroundColor Gray
