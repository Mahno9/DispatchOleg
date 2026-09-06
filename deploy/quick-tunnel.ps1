<#
Публичный адрес игры с этого ПК без своего сервера: cloudflared quick tunnel.

Держит две вещи и следит за обеими:
  1. игру на локальном порту — `node server/dist/index.js` с NO_QR=1
     (без печатных QR: START сам выдаёт операцию, онбординг без камеры);
  2. туннель `cloudflared tunnel --url` — публичный https://*.trycloudflare.com.

Адрес туннеля пишется первой строкой в $OutFile. Раз в $CheckEverySec секунд
проверяется /api/health и локально, и через публичный адрес; упавший процесс
или молчащий туннель перезапускаются, файл переписывается новым адресом.
Quick tunnel бесплатный и без аккаунта, но адрес живёт только вместе с
процессом — потому и нужен этот присмотр.

Запуск руками:   pwsh -File deploy/quick-tunnel.ps1
Как служба:      задача планировщика «DispatchOleg quick tunnel» (при входе
                 в систему, перезапуск при падении) — см. отчёт в чате/README.
Логи:            %LOCALAPPDATA%\DispatchOleg\
#>
param(
  [int]$Port = 8090,
  [string]$OutFile = 'C:\YandexDisk\Configs\dispatch.txt',
  [int]$CheckEverySec = 30
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$local = "http://127.0.0.1:$Port"

$stateDir = Join-Path $env:LOCALAPPDATA 'DispatchOleg'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$log = Join-Path $stateDir 'quick-tunnel.log'
$tunnelLog = Join-Path $stateDir 'cloudflared.err.log'

function Log($m) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $log -Encoding UTF8
}

# Второй экземпляр поднял бы второй туннель и перебивал бы файл — не пускаем.
$mutex = New-Object System.Threading.Mutex($false, 'Global\DispatchOlegQuickTunnel')
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
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    ((($bytes | ForEach-Object { '{0:x2}' -f $_ }) -join '').Substring(0, $len)) | Set-Content -Path $f -NoNewline -Encoding ascii
  }
  (Get-Content -Path $f -Raw).Trim()
}
$adminPassword = Get-Secret 'admin-password.txt' 16
$cookieSecret = Get-Secret 'cookie-secret.txt' 48

function Test-Health($base, $timeoutSec = 8) {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/health" -TimeoutSec $timeoutSec -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

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
    -ArgumentList "tunnel --url $local --no-autoupdate" `
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
$publicFailures = 0

while ($true) {
  # 1. Локальная игра.
  if (-not (Test-Health $local)) {
    if ($server -and -not $server.HasExited) {
      Log "server: pid $($server.Id) не отвечает, снимаю"
      Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
    $server = Start-Server
    Start-Sleep -Seconds 5
    if (-not (Test-Health $local)) {
      Log 'server: не поднялся, туннель не трогаю, подожду'
      Start-Sleep -Seconds $CheckEverySec
      continue
    }
  }

  # 2. Туннель: нет / умер / молчит снаружи при живом локальном сервере.
  $dead = (-not $tunnel.proc) -or $tunnel.proc.HasExited -or (-not $tunnel.url)
  if (-not $dead) {
    if (Test-Health $tunnel.url 20) {
      $publicFailures = 0
    } else {
      $publicFailures++
      Log "tunnel: $($tunnel.url) не отвечает ($publicFailures)"
      # Одна осечка — это может быть сеть; две подряд — туннель сброшен.
      if ($publicFailures -ge 2) { $dead = $true }
    }
  }
  if ($dead) {
    if ($tunnel.proc -and -not $tunnel.proc.HasExited) {
      Stop-Process -Id $tunnel.proc.Id -Force -ErrorAction SilentlyContinue
    }
    $publicFailures = 0
    $tunnel = Start-Tunnel
    if (-not $tunnel.url) { Start-Sleep -Seconds 15; continue }
  }

  Start-Sleep -Seconds $CheckEverySec
}
