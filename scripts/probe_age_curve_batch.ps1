# Runs scripts/probe_age_curve.ts one career at a time, waiting for RAM (1500 MB) before each.
#   powershell -File scripts/probe_age_curve_batch.ps1 <out.jsonl> [policy=auto] [talent=role] [year=2021] [seasons=14] [seeds=11,23]
param([string]$out, [string]$policy = 'auto', [string]$talent = 'role', [int]$year = 2021, [int]$seasons = 14, [string]$seeds = '11,23')
$roles = @('duelist', 'initiator', 'controller', 'sentinel')
$starts = @('chal', 't1')
foreach ($r in $roles) { foreach ($st in $starts) { foreach ($sd in $seeds.Split(',')) {
  while (((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) -lt 1500) { Start-Sleep 60 }
  npx tsx scripts/probe_age_curve.ts $out $r $st $sd $year $seasons $policy $talent
} } }
