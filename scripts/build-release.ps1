param(
  [string]$NotesPath = "",
  [string]$DownloadBaseUrl = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$keyFile = Join-Path $root "src-tauri/updater-keys/pata-commands.key"
$passwordFile = Join-Path $root "src-tauri/updater-keys/password.txt"

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  if (-not (Test-Path $keyFile)) {
    throw "Missing updater signing key. Run 'npx tauri signer generate -w src-tauri/updater-keys/pata-commands.key' or set TAURI_SIGNING_PRIVATE_KEY."
  }
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyFile
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -and (Test-Path $passwordFile)) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw $passwordFile).Trim()
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw "Missing updater private key password. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD or keep src-tauri/updater-keys/password.txt."
}

Write-Host "Building signed release and updater artifacts..." -ForegroundColor Cyan
& npm run tauri build
if ($LASTEXITCODE -ne 0) {
  throw "tauri build failed; updater manifest was not generated."
}

$package = Get-Content (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$bundle = Join-Path $root "src-tauri/target/release/bundle/nsis"
$installer = Get-ChildItem $bundle -Filter "*-setup.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "No NSIS installer was produced. Check bundle.createUpdaterArtifacts=true and the build log."
}

$sigPath = "$($installer.FullName).sig"
if (-not (Test-Path $sigPath)) {
  throw "Updater signature not found: $sigPath"
}
$signature = (Get-Content -Raw $sigPath).Trim()

if (-not $DownloadBaseUrl) {
  if ($env:PATA_UPDATE_BASE_URL) {
    $DownloadBaseUrl = $env:PATA_UPDATE_BASE_URL
  } else {
    $conf = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $endpoint = $conf.plugins.updater.endpoints | Select-Object -First 1
    if ($endpoint -and $endpoint -notmatch "your-org") {
      $DownloadBaseUrl = $endpoint -replace "/latest\.json$", ""
    } else {
      $DownloadBaseUrl = "https://github.com/605521553/cmdLoad/releases/latest/download"
    }
  }
}
$DownloadBaseUrl = $DownloadBaseUrl.TrimEnd("/")
$encodedName = [uri]::EscapeDataString($installer.Name)
$downloadUrl = "$DownloadBaseUrl/$encodedName"

$notes = "Pata Commands v$version"
if ($NotesPath) {
  $notesPathResolved = Resolve-Path $NotesPath
  $notes = Get-Content -Raw -Encoding UTF8 $notesPathResolved
}

$manifest = [ordered]@{
  version = $version
  notes = $notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url = $downloadUrl
    }
  }
}

$outputDir = Join-Path $root "artifacts/updater"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$manifestPath = Join-Path $outputDir "latest.json"
$json = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item $installer.FullName $outputDir -Force
Copy-Item $sigPath $outputDir -Force

Write-Host ""
Write-Host "Updater artifacts:" -ForegroundColor Green
Write-Host "  manifest: $manifestPath"
Write-Host "  package : $(Join-Path $outputDir $installer.Name)"
Write-Host "  version : $version"
Write-Host "  url     : $downloadUrl"
Write-Host ""
Write-Host "Upload latest.json, the signed setup .exe and the .sig to the same release," -ForegroundColor Yellow
Write-Host "and make sure tauri.conf.json plugins.updater.endpoints points to latest.json." -ForegroundColor Yellow
