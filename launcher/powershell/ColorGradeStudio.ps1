[CmdletBinding()]
param(
  [switch]$NoOpen,
  [switch]$Stop,
  [switch]$Diagnostic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProductName = 'Color Grade Studio'
$DefaultPort = 4174
$StateDirectoryName = 'ColorGradeStudio\Launcher'
$MimeTypes = @{
  '.cube' = 'text/plain; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md' = 'text/markdown; charset=utf-8'
}

function Show-LauncherError([string]$Code, [string]$Message) {
  if ($Diagnostic) {
    Write-Error "${Code}: $Message"
    return
  }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "$Message`n`n错误码：$Code",
      $ProductName,
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Error "${Code}: $Message"
  }
}

function Get-ChildPath([string]$BasePath, [string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
    throw '包清单包含无效的绝对路径。'
  }
  $parts = $RelativePath -split '[\\/]'
  if ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }) {
    throw '包清单包含无效的相对路径。'
  }
  $base = [IO.Path]::GetFullPath($BasePath)
  $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $RelativePath))
  $prefix = $base.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw '资源路径超出了独立包目录。'
  }
  return $candidate
}

function Test-ReparsePoint([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw '独立包不支持符号链接或其他重解析点。'
  }
}

function Get-Sha256([string]$Path) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function New-InstanceToken {
  $bytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  } finally {
    $random.Dispose()
  }
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Get-StateDirectory {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw '无法确定用户级应用数据目录。'
  }
  $directory = Join-Path $env:LOCALAPPDATA $StateDirectoryName
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $probe = Join-Path $directory '.write-probe'
  [IO.File]::WriteAllText($probe, 'ok', [Text.Encoding]::UTF8)
  Remove-Item -LiteralPath $probe -Force
  return $directory
}

function Read-LauncherState([string]$StatePath) {
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Test-ProcessAlive([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Acquire-LaunchLock([string]$LockPath, [string]$StatePath) {
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    try {
      $lock = New-Item -ItemType File -Path $LockPath -ErrorAction Stop
      [IO.File]::WriteAllText($lock.FullName, $PID.ToString(), [Text.Encoding]::UTF8)
      return $true
    } catch [IO.IOException] {
      if (Test-LauncherHealth (Read-LauncherState $StatePath)) {
        return $false
      }
      try {
        $owner = [int](Get-Content -LiteralPath $LockPath -Raw -Encoding UTF8)
        $age = (Get-Date) - (Get-Item -LiteralPath $LockPath).LastWriteTime
        if (-not (Test-ProcessAlive $owner) -or $age.TotalSeconds -gt 10) {
          Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
        }
      } catch {
        Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 150
    }
  }
  throw '另一个启动器正在启动，但服务没有就绪。请稍后重试。'
}

function Write-LauncherState([string]$StatePath, [string]$Token, [int]$Port, [string]$Version) {
  $state = [ordered]@{
    schemaVersion = 1
    pid = $PID
    port = $Port
    token = $Token
    version = $Version
  } | ConvertTo-Json -Compress
  $temporary = "$StatePath.$PID.tmp"
  [IO.File]::WriteAllText($temporary, $state, [Text.Encoding]::UTF8)
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function Test-LauncherHealth($State) {
  if ($null -eq $State -or $State.port -ne $DefaultPort -or [string]::IsNullOrWhiteSpace($State.token)) {
    return $false
  }
  try {
    $uri = "http://127.0.0.1:$DefaultPort/_launcher/health?token=$($State.token)"
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 2
    $body = $response.Content | ConvertFrom-Json
    return $response.StatusCode -eq 200 -and $body.ok -eq $true -and $body.token -eq $State.token
  } catch {
    return $false
  }
}

function Open-Workspace([string]$Origin) {
  try {
    Start-Process $Origin
    return $true
  } catch {
    if ($Diagnostic) {
      Write-Warning "本地服务已就绪，但无法自动打开浏览器：$Origin"
    }
    return $false
  }
}

function Stop-Workspace([string]$StatePath) {
  $state = Read-LauncherState $StatePath
  if (-not (Test-LauncherHealth $state)) {
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    return
  }
  $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    Stop-Process -Id $process.Id -Force
  }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
}

function Get-ValidatedPackage([string]$PackageRoot) {
  if ($PackageRoot -match '^[\\/]{2}') {
    throw '不支持从 UNC 网络共享启动独立包。请将整个包复制到本地或可移动磁盘。'
  }
  Test-ReparsePoint $PackageRoot
  $manifestPath = Join-Path $PackageRoot 'MANIFEST.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw '缺少 MANIFEST.json，无法验证独立包。'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $manifest.files -or $manifest.files.Count -eq 0 -or $null -eq $manifest.package.version) {
    throw '独立包清单格式无效。'
  }
  $appRoot = Get-ChildPath $PackageRoot 'app'
  if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'index.html') -PathType Leaf)) {
    throw '独立包缺少 app/index.html。'
  }
  Test-ReparsePoint $appRoot
  $allowedAppPaths = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($entry in $manifest.files) {
    if ($null -eq $entry.path -or $null -eq $entry.sha256 -or $null -eq $entry.bytes) {
      throw '独立包清单包含不完整条目。'
    }
    $relative = [string]$entry.path
    $file = Get-ChildPath $PackageRoot $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "独立包缺少资源：$relative"
    }
    Test-ReparsePoint $file
    if ((Get-Item -LiteralPath $file).Length -ne [int64]$entry.bytes -or (Get-Sha256 $file) -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "独立包完整性校验失败：$relative"
    }
    if ($relative.StartsWith('app/', [StringComparison]::OrdinalIgnoreCase)) {
      [void]$allowedAppPaths.Add($relative.Substring(4).Replace('\', '/'))
    }
  }
  $actualAppPaths = Get-ChildItem -LiteralPath $appRoot -Recurse -File -Force | ForEach-Object {
    $_.FullName.Substring($appRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar).Replace('\', '/')
  }
  foreach ($relative in $actualAppPaths) {
    if (-not $allowedAppPaths.Contains($relative)) {
      throw "独立包包含未列入清单的资源：app/$relative"
    }
  }
  if (-not $allowedAppPaths.Contains('index.html')) {
    throw '独立包清单未列出 app/index.html。'
  }
  return [pscustomobject]@{
    AppRoot = $appRoot
    AllowedAppPaths = $allowedAppPaths
    Version = [string]$manifest.package.version
  }
}

function Write-Response($Context, [int]$StatusCode, [string]$ContentType, [byte[]]$Body) {
  $response = $Context.Response
  $response.StatusCode = $StatusCode
  $response.ContentType = $ContentType
  $response.Headers['Cache-Control'] = 'no-store'
  $response.Headers['X-Content-Type-Options'] = 'nosniff'
  $response.ContentLength64 = $Body.Length
  if ($Context.Request.HttpMethod -ne 'HEAD' -and $Body.Length -gt 0) {
    $response.OutputStream.Write($Body, 0, $Body.Length)
  }
  $response.Close()
}

function Handle-Request($Context, $Package, [string]$Token) {
  try {
    $request = $Context.Request
    if ($null -eq $request.RemoteEndPoint -or -not [Net.IPAddress]::IsLoopback($request.RemoteEndPoint.Address)) {
      Write-Response $Context 403 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))
      return
    }
    if ($request.HttpMethod -notin @('GET', 'HEAD')) {
      $Context.Response.Headers['Allow'] = 'GET, HEAD'
      Write-Response $Context 405 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Method Not Allowed'))
      return
    }
    $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ($path -eq '/_launcher/health') {
      if ($request.QueryString['token'] -ne $Token) {
        Write-Response $Context 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Not Found'))
        return
      }
      $body = [Text.Encoding]::UTF8.GetBytes((@{ ok = $true; token = $Token } | ConvertTo-Json -Compress))
      Write-Response $Context 200 'application/json; charset=utf-8' $body
      return
    }
    $relative = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
    if (-not $Package.AllowedAppPaths.Contains($relative.Replace('\', '/'))) {
      Write-Response $Context 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Not Found'))
      return
    }
    $file = Get-ChildPath $Package.AppRoot $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      Write-Response $Context 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Not Found'))
      return
    }
    Test-ReparsePoint $file
    $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $contentType = if ($MimeTypes.ContainsKey($extension)) { $MimeTypes[$extension] } else { 'application/octet-stream' }
    Write-Response $Context 200 $contentType ([IO.File]::ReadAllBytes($file))
  } catch {
    try {
      Write-Response $Context 500 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Internal Server Error'))
    } catch {}
  }
}

$listener = $null
$statePath = $null
$lockPath = $null
$ownsLock = $false
try {
  $packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
  $stateDirectory = Get-StateDirectory
  $statePath = Join-Path $stateDirectory 'instance.json'
  $lockPath = Join-Path $stateDirectory 'startup.lock'
  if ($Stop) {
    Stop-Workspace $statePath
    exit 0
  }

  $existing = Read-LauncherState $statePath
  if (Test-LauncherHealth $existing) {
    if (-not $NoOpen) { Open-Workspace "http://127.0.0.1:$DefaultPort/" }
    exit 0
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue

  $ownsLock = Acquire-LaunchLock $lockPath $statePath
  if (-not $ownsLock) {
    if (-not $NoOpen) { Open-Workspace "http://127.0.0.1:$DefaultPort/" }
    exit 0
  }

  $package = Get-ValidatedPackage $packageRoot
  $token = New-InstanceToken
  $listener = New-Object Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$DefaultPort/")
  try {
    $listener.Start()
  } catch [Net.HttpListenerException] {
    throw "端口 $DefaultPort 已被其他应用占用。为了保护浏览器本地数据，启动器不会自动改用其他端口。"
  }
  Write-LauncherState $statePath $token $DefaultPort $package.Version
  if (-not $NoOpen) { Open-Workspace "http://127.0.0.1:$DefaultPort/" }

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    Handle-Request $context $package $token
  }
} catch {
  Show-LauncherError 'CGS-LAUNCH-001' $_.Exception.Message
  exit 1
} finally {
  if ($null -ne $listener) {
    $listener.Stop()
    $listener.Close()
  }
  if ($null -ne $statePath) {
    $state = Read-LauncherState $statePath
    if ($null -ne $state -and $state.pid -eq $PID) {
      Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
  }
  if ($ownsLock -and $null -ne $lockPath) {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

