<#
training/js/bench-page/vm-sampler.ps1 — browser memory sampler for T67 (Windows client)

Description:
  Samples the total working set (resident memory) of all processes of one
  browser (chrome or msedge) every IntervalMs and posts batches to the bench
  server's /__bench/memory endpoint. Timestamps use this machine's clock,
  the same clock as the bench page's phase marks, so the Mac-side driver
  (bench_browsers.mjs --serve) can compute peak memory per phase.

Usage (PowerShell, after the SSH tunnel is up):
  powershell -ExecutionPolicy Bypass -File .\vm-sampler.ps1 -Browser chrome
  Stop with Ctrl+C after the suite page shows "finished".

Phase: 10 (T67). Dependencies: Windows PowerShell 5.1+ (built in).
Status: implemented (T67).
#>

param(
  [string]$Server = "http://localhost:5180",
  [ValidateSet("chrome", "msedge")][string]$Browser = "chrome",
  [int]$IntervalMs = 250,
  [int]$BatchSize = 8
)

Write-Host "Sampling '$Browser' memory every $IntervalMs ms -> $Server/__bench/memory (Ctrl+C to stop)"
while ($true) {
  $batch = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $BatchSize; $i++) {
    $sum = (Get-Process -Name $Browser -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum
    if ($null -eq $sum) { $sum = 0 }
    $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    [void]$batch.Add(@{ t = $t; mb = [math]::Round($sum / 1MB, 1) })
    Start-Sleep -Milliseconds $IntervalMs
  }
  try {
    $json = ConvertTo-Json -InputObject @($batch) -Compress
    Invoke-RestMethod -Uri "$Server/__bench/memory" -Method Post -Body $json -ContentType "application/json" | Out-Null
    Write-Host -NoNewline "."
  } catch {
    Write-Host "`npost failed: $($_.Exception.Message)"
  }
}
