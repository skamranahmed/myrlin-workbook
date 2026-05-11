# Prevents the PC from sleeping so workbook.myrlin.dev stays reachable.
#
# Run once (admin shell for `powercfg -h off`):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-power-never-sleep.ps1
#
# Re-run if Windows updates reset the power scheme.

$ErrorActionPreference = 'Stop'

Write-Host 'Setting current Power Plan: never sleep on AC, never turn off display on AC...' -ForegroundColor Gray
& powercfg -change -standby-timeout-ac 0
& powercfg -change -monitor-timeout-ac 0
& powercfg -change -hibernate-timeout-ac 0
& powercfg -change -disk-timeout-ac 0

Write-Host 'Disabling hibernate file (admin only; ignore failure on non-admin shell)...' -ForegroundColor Gray
try { & powercfg -h off } catch { Write-Warning "powercfg -h off failed (not admin?): $_" }

Write-Host ''
Write-Host 'Done. PC will stay awake when on AC power.' -ForegroundColor Green
Write-Host ''
Write-Host 'Current sleep settings:' -ForegroundColor Cyan
& powercfg -query SCHEME_CURRENT SUB_SLEEP | Select-String 'Power Setting Index|Subgroup|Power Setting GUID|Description' | Select-Object -First 12
