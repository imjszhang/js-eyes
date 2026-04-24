# js-eyes-native-host-install.ps1 — recommended local launcher for installing
# the native-messaging host on Windows.
#
# Unlike `npx js-eyes native-host install`, this script never contacts the
# npm registry or downloads anything: it simply shells out to the repo-local
# CLI using the currently-checked-out tree. Use this when you've already
# cloned or npm-installed `js-eyes` locally and want to minimize the surface
# on which remote code could run during setup.
#
# Usage:
#   .\bin\js-eyes-native-host-install.ps1 [-Browser all|chrome|firefox|edge|brave|chromium|chrome-canary]
#
# Anything passed after the script name is forwarded to the CLI verbatim.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $PassThroughArgs
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
$CliEntry  = Join-Path $RepoRoot 'apps\cli\bin\js-eyes.js'

if (-not (Test-Path $CliEntry)) {
    Write-Error "[js-eyes] CLI entry not found at $CliEntry"
    Write-Error "[js-eyes] Run this script from a checked-out js-eyes repository (or a local npm-installed copy)."
    exit 1
}

if (-not $PassThroughArgs -or $PassThroughArgs.Count -eq 0) {
    & node $CliEntry 'native-host' 'install' '--browser' 'all'
} else {
    & node $CliEntry 'native-host' 'install' @PassThroughArgs
}

exit $LASTEXITCODE
