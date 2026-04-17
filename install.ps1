#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Repo       = "imjszhang/js-eyes"
$SkillName  = "js-eyes"
$SiteUrl    = "https://js-eyes.com"
$InstallDir = if ($env:JS_EYES_DIR) { $env:JS_EYES_DIR } else { ".\skills" }
$SkipNativeHost = $false
if ($env:JS_EYES_SKIP_NATIVE_HOST -eq '1') { $SkipNativeHost = $true }
foreach ($argv in $args) {
    if ($argv -eq '--skip-native-host') { $SkipNativeHost = $true }
}

function Write-Info  ($msg) { Write-Host "[info]  $msg" -ForegroundColor Cyan }
function Write-Ok    ($msg) { Write-Host "[ok]    $msg" -ForegroundColor Green }
function Write-Warn  ($msg) { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err   ($msg) { Write-Host "[error] $msg" -ForegroundColor Red }

function Try-Download {
    param([string]$Dest, [string[]]$Urls)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    foreach ($url in $Urls) {
        Write-Info "Trying: $url"
        try {
            Invoke-WebRequest $url -OutFile $Dest -UseBasicParsing -TimeoutSec 15
            return $true
        } catch {
            Write-Warn "Failed, trying next source..."
        }
    }
    return $false
}

function Verify-Sha256 {
    param([string]$File, [string]$Expected)
    if (-not $Expected -or $Expected.Trim() -eq '' -or $Expected -eq 'null') {
        Write-Warn "No sha256 in registry; refusing to proceed without integrity hash."
        return $false
    }
    $actual = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
    $exp = $Expected.ToLower()
    if ($actual -ne $exp) {
        Write-Err "SHA-256 mismatch: expected $exp, got $actual"
        return $false
    }
    Write-Ok "SHA-256 verified ($actual)"
    return $true
}

function Run-NpmCi {
    param([string]$Dir)
    if (-not (Test-Path (Join-Path $Dir 'package.json'))) { return $true }
    if (-not (Test-Path (Join-Path $Dir 'package-lock.json'))) {
        Write-Err "$Dir missing package-lock.json; refusing 'npm install' (set JS_EYES_REQUIRE_LOCKFILE=0 to relax)."
        if ($env:JS_EYES_REQUIRE_LOCKFILE -eq '0') {
            Push-Location $Dir
            try { npm install --ignore-scripts --no-audit --no-fund } finally { Pop-Location }
            return $LASTEXITCODE -eq 0
        }
        return $false
    }
    Push-Location $Dir
    try { npm ci --ignore-scripts --no-audit --no-fund } finally { Pop-Location }
    return $LASTEXITCODE -eq 0
}

function Confirm-Overwrite {
    param([string]$Prompt)
    if ($env:JS_EYES_FORCE -eq '1') { return $true }
    if ([Environment]::UserInteractive -eq $false -and -not $Host.UI.RawUI) {
        Write-Warn "Non-interactive shell; refusing to proceed (set JS_EYES_FORCE=1 to override)."
        return $false
    }
    $reply = Read-Host "  $Prompt [y/N]"
    return ($reply -in @('y', 'Y'))
}

# ── Sub-skill installer (callable after sourcing) ─────────────────────

function Install-JsEyesSkill {
    param([Parameter(Mandatory)][string]$SkillId)

    $JsEyesRoot = Join-Path $InstallDir $SkillName
    if (-not (Test-Path $JsEyesRoot)) {
        Write-Err "JS Eyes is not installed at $JsEyesRoot."
        Write-Err "Install js-eyes first: irm $SiteUrl/install.ps1 | iex"
        return
    }

    try   { $null = Get-Command node -ErrorAction Stop }
    catch { Write-Err "Node.js is required. Install: https://nodejs.org/"; return }
    try   { $null = Get-Command npm -ErrorAction Stop }
    catch { Write-Err "npm is required."; return }

    Write-Info "Installing extension skill: $SkillId"
    Write-Info "Fetching skill registry..."

    $Registry = $null
    try {
        $Registry = Invoke-RestMethod "$SiteUrl/skills.json" -UseBasicParsing -TimeoutSec 10
    } catch {
        Write-Err "Could not fetch skill registry from $SiteUrl/skills.json"
        return
    }

    $Skill = $Registry.skills | Where-Object { $_.id -eq $SkillId } | Select-Object -First 1
    if (-not $Skill) {
        Write-Err "Skill '$SkillId' not found in registry."
        Write-Info "Available skills:"
        foreach ($s in $Registry.skills) { Write-Host "  - $($s.id)" }
        return
    }

    $Target = Join-Path $JsEyesRoot "skills\$SkillId"
    if (Test-Path $Target) {
        Write-Warn "Directory already exists: $Target"
        if (-not (Confirm-Overwrite -Prompt 'Overwrite?')) { Write-Info "Aborted."; return }
        Remove-Item $Target -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Target -Force | Out-Null

    $TmpDir = Join-Path ([IO.Path]::GetTempPath()) ("js-eyes-skill-" + [guid]::NewGuid().ToString("N").Substring(0,8))
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

    try {
        $ZipPath = Join-Path $TmpDir "skill.zip"
        $Urls = @($Skill.downloadUrl)
        if ($Skill.downloadUrlFallback -and ($Skill.downloadUrlFallback -notmatch '/(refs/heads/)?main(?=[/?])')) {
            $Urls += $Skill.downloadUrlFallback
        }
        Write-Info "Downloading $SkillId..."

        if (-not (Try-Download -Dest $ZipPath -Urls $Urls)) {
            Write-Err "Failed to download skill bundle."
            return
        }

        if (-not (Verify-Sha256 -File $ZipPath -Expected $Skill.sha256)) {
            Write-Err "Refusing to install skill without verified SHA-256."
            return
        }

        Write-Info "Extracting..."
        Expand-Archive -Path $ZipPath -DestinationPath $Target -Force

        if (Test-Path (Join-Path $Target "package.json")) {
            Write-Info "Installing dependencies (npm ci --ignore-scripts)..."
            if (-not (Run-NpmCi -Dir $Target)) {
                Write-Err "Dependency installation failed."
                return
            }
        }
    } finally {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    $AbsTarget  = (Resolve-Path $Target).Path
    $PluginPath = (Join-Path $AbsTarget "openclaw-plugin") -replace '\\', '/'

    Write-Ok "$SkillId installed to: $AbsTarget"
    Write-Host ""
    Write-Host ([string]::new([char]0x2501, 57))
    Write-Host "  Next: register the plugin in ~/.openclaw/openclaw.json"
    Write-Host ""
    Write-Host "  Add to plugins.load.paths:"
    Write-Host "    `"$PluginPath`""
    Write-Host ""
    Write-Host "  Add to plugins.entries:"
    Write-Host "    `"$SkillId`": { `"enabled`": true }"
    Write-Host ""
    Write-Host "  Then restart OpenClaw."
    Write-Host ([string]::new([char]0x2501, 57))
}

# ── Check for env-based sub-skill install ─────────────────────────────

if ($env:JS_EYES_SKILL) {
    Install-JsEyesSkill -SkillId $env:JS_EYES_SKILL
    return
}

# ══════════════════════════════════════════════════════════════════════
# Main skill install
# ══════════════════════════════════════════════════════════════════════

# ── Prerequisites ─────────────────────────────────────────────────────

try   { $null = Get-Command node -ErrorAction Stop }
catch { Write-Err "Node.js is required. Install: https://nodejs.org/"; exit 1 }

try   { $null = Get-Command npm -ErrorAction Stop }
catch { Write-Err "npm is required."; exit 1 }

# ── Resolve latest version ────────────────────────────────────────────

Write-Info "Fetching latest release info..."
$Tag = $null
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing -TimeoutSec 10
    $Tag = $release.tag_name
} catch {}

if ($Tag) {
    Write-Info "Latest version: $Tag"
} else {
    Write-Warn "Could not determine latest release - using latest available."
}

# ── Prepare target directory ──────────────────────────────────────────

$Target = Join-Path $InstallDir $SkillName

if (Test-Path $Target) {
    Write-Warn "Directory already exists: $Target"
    if (-not (Confirm-Overwrite -Prompt 'Overwrite?')) {
        Write-Info "Aborted."
        exit 0
    }
    Remove-Item $Target -Recurse -Force
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null

# ── Download with multi-source fallback ───────────────────────────────

$TmpDir = Join-Path ([IO.Path]::GetTempPath()) ("js-eyes-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $SkillZip  = Join-Path $TmpDir "skill.zip"
    $UrlsSkillZip = @("$SiteUrl/js-eyes-skill.zip")
    $ShaUrl       = "$SiteUrl/js-eyes-skill.zip.sha256"
    if ($Tag) {
        $Version = $Tag -replace '^v', ''
        $UrlsSkillZip += "https://github.com/$Repo/releases/download/$Tag/js-eyes-skill-v$Version.zip"
        $ShaUrl       = "https://github.com/$Repo/releases/download/$Tag/js-eyes-skill-v$Version.zip.sha256"
    }

    Write-Info "Downloading skill bundle..."

    if (-not (Try-Download -Dest $SkillZip -Urls $UrlsSkillZip)) {
        Write-Err "All download sources failed. Check your network and try again."
        exit 1
    }

    $ExpectedSha = $null
    try {
        $line = Invoke-WebRequest -Uri $ShaUrl -UseBasicParsing -TimeoutSec 15
        $ExpectedSha = ($line.Content -split '\s+')[0]
    } catch {
        $ExpectedSha = $null
    }
    if (-not (Verify-Sha256 -File $SkillZip -Expected $ExpectedSha)) {
        Write-Err "Refusing to install js-eyes without verified SHA-256."
        Write-Err "Expected sha file URL: $ShaUrl"
        exit 1
    }

    Write-Info "Extracting skill bundle..."

    Expand-Archive -Path $SkillZip -DestinationPath $Target -Force
} finally {
    Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Install dependencies ──────────────────────────────────────────────

Write-Info "Installing dependencies (npm ci --ignore-scripts)..."
if (-not (Run-NpmCi -Dir $Target)) {
    Write-Err "Dependency installation failed."
    exit 1
}

# ── Done ──────────────────────────────────────────────────────────────

$AbsTarget  = (Resolve-Path $Target).Path
$PluginPath = (Join-Path $AbsTarget "openclaw-plugin") -replace '\\', '/'

Write-Ok "JS Eyes installed to: $AbsTarget"

if (-not $SkipNativeHost) {
    $HasNpx = $false
    try { $null = Get-Command npx -ErrorAction Stop; $HasNpx = $true } catch {}
    if ($HasNpx) {
        Write-Info "Registering browser native-messaging host (skip with --skip-native-host)..."
        try {
            & npx --yes js-eyes native-host install --browser all | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Native messaging host registered (Chrome + Firefox)."
            } else {
                Write-Warn "Native messaging host registration failed; run 'npx js-eyes native-host install' later."
            }
        } catch {
            Write-Warn "Native messaging host registration failed; run 'npx js-eyes native-host install' later."
        }
    } else {
        Write-Warn "npx not found; skipping native-messaging host registration."
    }
}

Write-Host ""
Write-Host ([string]::new([char]0x2501, 57))
Write-Host "  Next: register the plugin in ~/.openclaw/openclaw.json"
Write-Host ""
Write-Host "  Add to plugins.load.paths:"
Write-Host "    `"$PluginPath`""
Write-Host ""
Write-Host "  Add to plugins.entries:"
Write-Host '    "js-eyes": {'
Write-Host '      "enabled": true,'
Write-Host '      "config": { "serverPort": 18080, "autoStartServer": true }'
Write-Host '    }'
Write-Host ""
Write-Host "  Then restart OpenClaw."
Write-Host ([string]::new([char]0x2501, 57))
