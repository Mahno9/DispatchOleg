<#
Публичный адрес игры с этого ПК без своего сервера: cloudflared quick tunnel.

Без ключей — работает супервизором в цикле. Держит две вещи и следит за обеими:
  1. игру на локальном порту — `node server/dist/index.js` с NO_QR=1
     (без печатных QR: START сам выдаёт операцию, онбординг без камеры);
  2. туннель `cloudflared tunnel --url` — публичный https://*.trycloudflare.com.
Адрес пишется первой строкой в $OutFile. Раз в $CheckEverySec секунд
проверяется /api/health локально и через публичный адрес; упавший процесс
или молчащий туннель перезапускаются, файл переписывается новым адресом.
Quick tunnel бесплатный и без аккаунта, но адрес живёт только с процессом —
потому и присмотр.

Переключатель (то, что лежат рядом .cmd):
  -Start   включить: автозапуск при входе в систему + супервизор в фоне
  -Stop    выключить: погасить супервизор, сервер и туннель, снять автозапуск,
           первой строкой в $OutFile написать «ВЫКЛЮЧЕНО»
  -Status  что сейчас работает и какой адрес
  -Update  накатить правки: `npm run build` в корне проекта и перезапуск
           сервера; адрес туннеля при этом не меняется
  -Autostart on|off — только ярлык в автозагрузке, ничего не запуская

Пути без имени пользователя: проект — от расположения скрипта, состояние,
логи и секреты — %LOCALAPPDATA%\DispatchOleg\, автозагрузка — shell:startup.
#>
param(
  [switch]$Start,
  [switch]$Stop,
  [switch]$Status,
  [switch]$Update,
  [ValidateSet('on', 'off')][string]$Autostart,
  [int]$Port = 8090,
  [string]$OutFile = 'C:\YandexDisk\Configs\dispatch.txt',
  [int]$CheckEverySec = 30
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$local = "http://127.0.0.1:$Port"
# Служебный порт cloudflared: /ready отвечает 200, пока есть соединение с
# краем Cloudflare. Это и есть здоровье туннеля — проверять его через
# публичный адрес с этого же ПК нельзя: свежее имя *.trycloudflare.com
# появляется в DNS с задержкой, а роутер успевает закешировать «нет такого
# домена» и потом врёт минутами, хотя снаружи адрес уже работает.
$metrics = "http://127.0.0.1:$($Port + 10000)"
$mutexName = 'Global\DispatchOlegQuickTunnel'

$stateDir = Join-Path $env:LOCALAPPDATA 'DispatchOleg'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$log = Join-Path $stateDir 'quick-tunnel.log'
$tunnelLog = Join-Path $stateDir 'cloudflared.err.log'
$pidsFile = Join-Path $stateDir 'pids.json'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'DispatchOleg quick tunnel.lnk'
# Тот же PowerShell, что выполняет скрипт сейчас — pwsh или powershell.
$psHost = (Get-Process -Id $PID).Path

function Log($m) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $log -Encoding UTF8
}

function Test-Ready {
  try {
    return (Invoke-WebRequest -Uri "$metrics/ready" -TimeoutSec 5 -UseBasicParsing).StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-Health($base, $timeoutSec = 8) {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/health" -TimeoutSec $timeoutSec -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

# --- учёт процессов: супервизор пишет свои PID'ы, -Stop гасит ровно их ---------

function Read-Pids {
  if (Test-Path $pidsFile) { Get-Content $pidsFile -Raw | ConvertFrom-Json } else { $null }
}

function Save-Pids($server, $tunnel) {
  @{
    supervisor = $PID
    server = if ($server) { $server.Id } else { $null }
    tunnel = if ($tunnel) { $tunnel.Id } else { $null }
    savedAt = (Get-Date).ToString('s')
  } | ConvertTo-Json | Set-Content -Path $pidsFile -Encoding UTF8
}

# Процесс из pids.json, если это всё ещё он: PID мог достаться кому-то другому
# после перезагрузки, поэтому сверяем имя и кусок командной строки.
function Get-Tracked($id, $name, $marker) {
  if (-not $id -or $id -eq $PID) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if ($p -and $p.Name -ieq $name -and $p.CommandLine -like "*$marker*") { $p } else { $null }
}

function Test-SupervisorRunning {
  $m = New-Object System.Threading.Mutex($false, $mutexName)
  try {
    if ($m.WaitOne(0)) { $m.ReleaseMutex(); return $false }
    return $true
  } finally { $m.Dispose() }
}

# --- автозагрузка: ярлык в shell:startup ------------------------------------------

function Set-Autostart($on) {
  if ($on -eq 'on') {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($startupLnk)
    $lnk.TargetPath = $psHost
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Port $Port -OutFile `"$OutFile`""
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.WindowStyle = 7
    $lnk.Description = 'DispatchOleg: игра без QR + cloudflared quick tunnel'
    $lnk.Save()
  } else {
    Remove-Item $startupLnk -ErrorAction SilentlyContinue
  }
}

# --- режимы переключателя -----------------------------------------------------------

function Show-Status {
  $pids = Read-Pids
  $sup = if ($pids) { Get-Tracked $pids.supervisor (Split-Path $psHost -Leaf) 'quick-tunnel.ps1' }
  $srv = if ($pids) { Get-Tracked $pids.server 'node.exe' 'dist/index.js' }
  $tun = if ($pids) { Get-Tracked $pids.tunnel 'cloudflared.exe' "--url $local" }
  $running = Test-SupervisorRunning
  $addr = if (Test-Path $OutFile) { (Get-Content $OutFile -TotalCount 1) } else { '—' }
  ''
  '  DispatchOleg quick tunnel'
  '  -------------------------'
  if ($running -and $sup) {
    "  супервизор : работает, pid $($sup.ProcessId), с $($sup.CreationDate.ToString('dd.MM HH:mm'))"
  } elseif ($running) {
    '  супервизор : работает (pid не сверился — запущен не этим скриптом?)'
  } else {
    '  супервизор : ВЫКЛЮЧЕН'
  }
  "  сервер     : " + $(if ($srv) { "pid $($srv.ProcessId), " } else { '' }) + $(if (Test-Health $local) { "отвечает на $local" } else { 'не отвечает' })
  "  туннель    : " + $(if ($tun) { "pid $($tun.ProcessId), " } else { '' }) + $(if (Test-Ready) { 'соединение с Cloudflare есть' } else { 'нет соединения' })
  "  адрес      : $addr"
  "  автозапуск : " + $(if (Test-Path $startupLnk) { 'да (shell:startup)' } else { 'нет' })
  "  логи       : $stateDir"
  ''
}

if ($Autostart) {
  Set-Autostart $Autostart
  "автозапуск: $Autostart"
  exit 0
}

if ($Status) { Show-Status; exit 0 }

if ($Update) {
  # Публичный экземпляр работает с собранного: server/dist, web/*/dist,
  # server/static/minigames. Правки в исходниках сами не подтягиваются —
  # только контент из БД (общая data/). Собираем всё, потом снимаем сервер:
  # супервизор поднимет его заново уже с новым dist, туннель не трогается.
  Push-Location $root
  try { npm run build; $ok = $LASTEXITCODE -eq 0 } finally { Pop-Location }
  if (-not $ok) { ''; 'сборка не удалась — старый билд остался как был, сервер не трогаю'; exit 1 }
  $pids = Read-Pids
  $srv = if ($pids) { Get-Tracked $pids.server 'node.exe' 'dist/index.js' }
  if ($srv) {
    Stop-Process -Id $srv.ProcessId -Force -ErrorAction SilentlyContinue
    "сервер pid $($srv.ProcessId) снят — супервизор поднимет его с новым билдом"
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 2
      $p2 = Read-Pids
      if ($p2 -and $p2.server -and $p2.server -ne $srv.ProcessId -and (Test-Health $local)) { break }
    }
  } else {
    'сервер не под присмотром (не запущен переключателем?) — собрал, но не перезапускал'
  }
  Log 'update: пересборка и перезапуск сервера'
  Show-Status
  exit 0
}

if ($Stop) {
  Set-Autostart 'off'
  $pids = Read-Pids
  if ($pids) {
    # Сначала супервизор — иначе он поднимет детей обратно.
    foreach ($t in @(
        @{ id = $pids.supervisor; name = (Split-Path $psHost -Leaf); marker = 'quick-tunnel.ps1' },
        @{ id = $pids.server;     name = 'node.exe';       marker = 'dist/index.js' },
        @{ id = $pids.tunnel;     name = 'cloudflared.exe'; marker = "--url $local" }
      )) {
      $p = Get-Tracked $t.id $t.name $t.marker
      if ($p) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        "остановлен $($t.name) pid $($p.ProcessId)"
      }
    }
    Remove-Item $pidsFile -ErrorAction SilentlyContinue
  }
  # Туннели на этот порт, о которых pids.json не знал (осиротевшие).
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
    Where-Object { $_.CommandLine -like "*--url $local*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; "остановлен cloudflared pid $($_.ProcessId) (осиротевший)" }
  if (Test-Path $OutFile) {
    $rest = Get-Content $OutFile | Select-Object -Skip 1
    Set-Content -Path $OutFile -Value (@("ВЫКЛЮЧЕНО $(Get-Date -Format 'yyyy-MM-dd HH:mm')") + $rest) -Encoding UTF8
  }
  Log 'stop: выключено переключателем'
  Show-Status
  exit 0
}

if ($Start) {
  Set-Autostart 'on'
  if (Test-SupervisorRunning) {
    'уже работает'
  } else {
    Start-Process -FilePath $psHost -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', "`"$PSCommandPath`"", '-Port', "$Port", '-OutFile', "`"$OutFile`"") | Out-Null
    # Ждём адрес, чтобы окно закрылось уже с готовой ссылкой.
    $before = if (Test-Path $OutFile) { (Get-Item $OutFile).LastWriteTime } else { [DateTime]::MinValue }
    for ($i = 0; $i -lt 90; $i++) {
      Start-Sleep -Seconds 1
      if ((Test-Path $OutFile) -and (Get-Item $OutFile).LastWriteTime -gt $before -and
          (Get-Content $OutFile -TotalCount 1) -like 'https://*') { break }
    }
  }
  Show-Status
  exit 0
}

# --- супервизор -------------------------------------------------------------------

# Второй экземпляр поднял бы второй туннель и перебивал бы файл — не пускаем.
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
  Log 'уже запущен другой экземпляр — выхожу'
  exit 0
}

# Секреты публичного экземпляра. Дефолтные admin/admin и cookie-секрет из
# config.ts годятся для localhost, но не для адреса, торчащего в интернет:
# зная дефолтный секрет, admin-cookie можно подделать. Генерируем один раз,
# храним рядом с логами; пароль админки попадает в $OutFile.
function Get-Secret($name, $len) {
  $f = Join-Path $stateDir $name
  if (-not (Test-Path $f)) {
    $bytes = [byte[]]::new($len)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ((($bytes | ForEach-Object { '{0:x2}' -f $_ }) -join '').Substring(0, $len)) | Set-Content -Path $f -NoNewline -Encoding ascii
  }
  (Get-Content -Path $f -Raw).Trim()
}
$adminPassword = Get-Secret 'admin-password.txt' 16
$cookieSecret = Get-Secret 'cookie-secret.txt' 48

function Start-Server {
  if (Test-Health $local) {
    # Порт уже кто-то держит (например, экземпляр, переживший прошлый
    # супервизор) — работаем с ним, свой не плодим.
    Log "server: $local уже отвечает, использую его"
    return $null
  }
  $env:NO_QR = '1'
  $env:PORT = "$Port"
  $env:HOST = '127.0.0.1'   # наружу — только через туннель
  $env:DATA_DIR = Join-Path $root 'data'
  $env:ADMIN_PASSWORD = $adminPassword
  $env:COOKIE_SECRET = $cookieSecret
  $p = Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' `
    -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $stateDir 'server.out.log') `
    -RedirectStandardError (Join-Path $stateDir 'server.err.log')
  Log "server: запущен pid $($p.Id)"
  return $p
}

function Stop-StaleTunnels {
  # Туннели, осиротевшие после прошлого супервизора: их адрес уже никому не
  # известен, а два туннеля на один порт только путают.
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
    Where-Object { $_.CommandLine -like "*--url $local*" } |
    ForEach-Object {
      Log "tunnel: снимаю осиротевший pid $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Write-Address($url) {
  $lines = @(
    $url,
    "обновлено: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "игра:    $url/",
    "админка: $url/admin/  логин admin  пароль $adminPassword",
    "режим без QR (NO_QR=1); адрес живёт, пока включён этот ПК"
  )
  $dir = Split-Path $OutFile
  if ($dir) { New-Item -ItemType Directory -Force $dir | Out-Null }
  Set-Content -Path $OutFile -Value $lines -Encoding UTF8
  Log "address: $url → $OutFile"
}

function Start-Tunnel {
  Stop-StaleTunnels
  Remove-Item $tunnelLog -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel --url $local --no-autoupdate --metrics $($metrics -replace '^http://','')" `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardError $tunnelLog `
    -RedirectStandardOutput (Join-Path $stateDir 'cloudflared.out.log')
  Log "tunnel: запущен pid $($p.Id)"
  # Адрес cloudflared печатает в stderr обычно за 3–15 с.
  $url = ''
  for ($i = 0; $i -lt 90 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
  if (-not $url) {
    Log 'tunnel: адрес не появился, убиваю и попробую снова'
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    return @{ proc = $null; url = '' }
  }
  Write-Address $url
  return @{ proc = $p; url = $url }
}

Log "старт: root=$root port=$Port out=$OutFile"
$server = Start-Server
# node слушает не сразу — иначе первая же проверка снимет только что
# запущенный процесс как «не отвечающий».
if ($server) { Start-Sleep -Seconds 5 }
$tunnel = @{ proc = $null; url = '' }
Save-Pids $server $tunnel.proc
$publicFailures = 0

while ($true) {
  # 1. Локальная игра.
  if (-not (Test-Health $local)) {
    if ($server -and -not $server.HasExited) {
      Log "server: pid $($server.Id) не отвечает, снимаю"
      Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
    $server = Start-Server
    Save-Pids $server $tunnel.proc
    Start-Sleep -Seconds 5
    if (-not (Test-Health $local)) {
      Log 'server: не поднялся, туннель не трогаю, подожду'
      Start-Sleep -Seconds $CheckEverySec
      continue
    }
  }

  # 2. Туннель: нет / умер / потерял соединение с краем Cloudflare.
  $dead = (-not $tunnel.proc) -or $tunnel.proc.HasExited -or (-not $tunnel.url)
  if (-not $dead) {
    if (Test-Ready) {
      $publicFailures = 0
    } else {
      $publicFailures++
      Log "tunnel: /ready не отвечает ($publicFailures)"
      # Одна осечка — cloudflared сам переподключается; две подряд — сброшен.
      if ($publicFailures -ge 2) { $dead = $true }
    }
  }
  if ($dead) {
    if ($tunnel.proc -and -not $tunnel.proc.HasExited) {
      Stop-Process -Id $tunnel.proc.Id -Force -ErrorAction SilentlyContinue
    }
    $publicFailures = 0
    $tunnel = Start-Tunnel
    Save-Pids $server $tunnel.proc
    if (-not $tunnel.url) { Start-Sleep -Seconds 15; continue }
  }

  Start-Sleep -Seconds $CheckEverySec
}
