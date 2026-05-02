# js-eyes-native-host-install.ps1 — recommended local launcher for installing
# the native-messaging host on Windows.
#
# Unlike `npx js-eyes native-host install`, this script never contacts the
# npm registry or downloads anything: it simply shells out to the repo-local
# CLI using the currently-checked-out tree. Use this when you've already
# cloned or npm-installed `js-eyes` locally and want to minimize the surface
# on which remote code could run during setup.
#
# In addition to writing the browser native-messaging manifest + launcher,
# this script also runs `js-eyes server token init` (idempotent) so that a
# fresh install has a `%USERPROFILE%/.js-eyes/runtime/server.token` file
# ready before the extension's "Sync Token From Host" / 从本机同步 button
# is used. Without that file the host returns `token-missing` and the popup
# falls back to manual paste. Pass `-SkipTokenInit` (or set
# JS_EYES_SKIP_TOKEN_INIT=1) to opt out.
#
# Usage:
#   .\bin\js-eyes-native-host-install.ps1 [-SkipTokenInit] `
#                                          [-Browser all|chrome|firefox|edge|brave|chromium|chrome-canary]
#
# Anything passed after the script name (other than -SkipTokenInit) is
# forwarded to the CLI's `native-host install` verbatim.

[CmdletBinding()]
param(
    [switch] $SkipTokenInit,
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

if ($env:JS_EYES_SKIP_TOKEN_INIT -eq '1') { $SkipTokenInit = $true }

if (-not $PassThroughArgs -or $PassThroughArgs.Count -eq 0) {
    & node $CliEntry 'native-host' 'install' '--browser' 'all'
} else {
    & node $CliEntry 'native-host' 'install' @PassThroughArgs
}
$installExitCode = $LASTEXITCODE

if (-not $SkipTokenInit) {
    # `server token init` is idempotent — it's a no-op when the file already
    # exists. Running it here closes the gap where a brand-new install has
    # the native-messaging host registered but no token file for it to read.
    & node $CliEntry 'server' 'token' 'init'
}

exit $installExitCode
