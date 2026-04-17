#!/usr/bin/env bash
set -euo pipefail

REPO="imjszhang/js-eyes"
SKILL_NAME="js-eyes"
SITE_URL="https://js-eyes.com"
INSTALL_DIR="${JS_EYES_DIR:-./skills}"
SUB_SKILL="${JS_EYES_SKILL:-${1:-}}"
SKIP_NATIVE_HOST="${JS_EYES_SKIP_NATIVE_HOST:-0}"
for arg in "$@"; do
  if [ "$arg" = "--skip-native-host" ]; then
    SKIP_NATIVE_HOST=1
  fi
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { printf "${CYAN}[info]${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}[ok]${NC}    %s\n" "$1"; }
warn()  { printf "${YELLOW}[warn]${NC}  %s\n" "$1"; }
err()   { printf "${RED}[error]${NC} %s\n" "$1" >&2; }

http_get() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else err "curl or wget is required."; exit 1; fi
}

try_download() {
  local dest="$1"; shift
  for url in "$@"; do
    info "Trying: ${url}"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --connect-timeout 10 "$url" -o "$dest" 2>/dev/null && return 0
    elif command -v wget >/dev/null 2>&1; then
      wget --timeout=10 -qO "$dest" "$url" 2>/dev/null && return 0
    fi
    warn "Failed, trying next source..."
  done
  return 1
}

confirm() {
  if [ "${JS_EYES_FORCE:-}" = "1" ]; then return 0; fi
  printf "  %s [y/N] " "$1"
  if [ -t 0 ]; then read -r reply
  elif [ -e /dev/tty ]; then read -r reply < /dev/tty
  else
    warn "Non-interactive shell; refusing to proceed (set JS_EYES_FORCE=1 to override)."
    return 1
  fi
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

verify_sha256() {
  local file="$1" expected="$2"
  if [ -z "$expected" ] || [ "$expected" = "null" ]; then
    warn "No sha256 in registry for this download; refusing to proceed without integrity hash."
    return 1
  fi
  local actual=""
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  else
    err "Neither shasum nor sha256sum is installed; cannot verify integrity."
    return 1
  fi
  if [ "$actual" != "$expected" ]; then
    err "SHA-256 mismatch: expected ${expected}, got ${actual}"
    return 1
  fi
  ok "SHA-256 verified (${actual})"
}

run_npm_ci() {
  local dir="$1"
  if [ ! -f "${dir}/package.json" ]; then return 0; fi
  if [ ! -f "${dir}/package-lock.json" ]; then
    err "${dir} missing package-lock.json; refusing 'npm install' (set JS_EYES_REQUIRE_LOCKFILE=0 to relax)."
    if [ "${JS_EYES_REQUIRE_LOCKFILE:-1}" = "0" ]; then
      warn "Falling back to 'npm install --ignore-scripts --no-audit --no-fund'"
      (cd "$dir" && npm install --ignore-scripts --no-audit --no-fund)
      return $?
    fi
    return 1
  fi
  (cd "$dir" && npm ci --ignore-scripts --no-audit --no-fund)
}

# ── Prerequisites ─────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { err "Node.js is required. Install: https://nodejs.org/"; exit 1; }
command -v npm  >/dev/null 2>&1 || { err "npm is required."; exit 1; }

# ══════════════════════════════════════════════════════════════════════
# Sub-skill install: curl ... | JS_EYES_SKILL=<id> bash  or  bash -s -- <skill-id>
# ══════════════════════════════════════════════════════════════════════
if [ -n "$SUB_SKILL" ]; then
  JS_EYES_ROOT="${INSTALL_DIR}/${SKILL_NAME}"
  if [ ! -d "$JS_EYES_ROOT" ]; then
    err "JS Eyes is not installed at ${JS_EYES_ROOT}."
    err "Install js-eyes first: curl -fsSL ${SITE_URL}/install.sh | bash"
    exit 1
  fi

  info "Installing extension skill: ${SUB_SKILL}"
  info "Fetching skill registry..."
  REGISTRY_JSON=$(http_get "${SITE_URL}/skills.json" 2>/dev/null || true)

  if [ -z "$REGISTRY_JSON" ]; then
    err "Could not fetch skill registry from ${SITE_URL}/skills.json"
    exit 1
  fi

  _download_urls_raw=$(node -e "
    let r; try { r = JSON.parse(process.argv[1]); } catch (_) { process.exit(1); }
    const s = r.skills && r.skills.find(x => x.id === process.argv[2]);
    if (!s) process.exit(1);
    const urls = [s.downloadUrl];
    if (s.downloadUrlFallback && !/(refs\\/heads\\/)?main(?=[\\/?])/.test(s.downloadUrlFallback)) {
      urls.push(s.downloadUrlFallback);
    }
    console.log(urls.join('\n'));
  " "$REGISTRY_JSON" "$SUB_SKILL" 2>/dev/null) || true

  if [ -z "$_download_urls_raw" ]; then
    err "Skill '${SUB_SKILL}' not found in registry."
    info "Available skills:"
    printf '%s' "$REGISTRY_JSON" | grep '"id"' | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/  - \1/'
    exit 1
  fi

  EXPECTED_SHA256=$(node -e "
    let r; try { r = JSON.parse(process.argv[1]); } catch (_) { process.exit(0); }
    const s = r.skills && r.skills.find(x => x.id === process.argv[2]);
    if (s && s.sha256) console.log(s.sha256);
  " "$REGISTRY_JSON" "$SUB_SKILL" 2>/dev/null) || true

  download_urls=()
  while IFS= read -r _line; do
    [ -n "$_line" ] && download_urls+=("$_line")
  done <<< "$_download_urls_raw"

  TARGET="${JS_EYES_ROOT}/skills/${SUB_SKILL}"
  if [ -d "$TARGET" ]; then
    warn "Directory already exists: ${TARGET}"
    confirm "Overwrite?" || { info "Aborted."; exit 0; }
    rm -rf "$TARGET"
  fi
  mkdir -p "$TARGET"

  _tmpdir=$(mktemp -d)
  trap 'rm -rf "$_tmpdir"' EXIT

  SKILL_ZIP="${_tmpdir}/skill.zip"
  info "Downloading ${SUB_SKILL}..."
  if ! try_download "$SKILL_ZIP" "${download_urls[@]}"; then
    err "Failed to download skill bundle."; exit 1
  fi

  if ! verify_sha256 "$SKILL_ZIP" "$EXPECTED_SHA256"; then
    err "Refusing to install skill without verified SHA-256."
    exit 1
  fi

  info "Extracting..."
  if command -v unzip >/dev/null 2>&1; then
    unzip -qo "$SKILL_ZIP" -d "$TARGET"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$SKILL_ZIP" "$TARGET"
  else
    err "unzip or python3 is required."; exit 1
  fi

  # Fix permissions: OpenClaw rejects world-writable plugin paths
  find "$TARGET" -type f -exec chmod 644 {} + 2>/dev/null || true
  find "$TARGET" -type d -exec chmod 755 {} + 2>/dev/null || true

  if [ -f "${TARGET}/package.json" ]; then
    info "Installing dependencies (npm ci --ignore-scripts)..."
    if ! run_npm_ci "$TARGET"; then
      err "Dependency installation failed."
      exit 1
    fi
  fi

  ABSOLUTE_TARGET=$(cd "$TARGET" && pwd)
  PLUGIN_PATH="${ABSOLUTE_TARGET}/openclaw-plugin"

  ok "${SUB_SKILL} installed to: ${ABSOLUTE_TARGET}"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Next: register the plugin in ~/.openclaw/openclaw.json"
  echo ""
  echo "  Add to plugins.load.paths:"
  echo "    \"${PLUGIN_PATH}\""
  echo ""
  echo "  Add to plugins.entries:"
  echo "    \"${SUB_SKILL}\": { \"enabled\": true }"
  echo ""
  echo "  Then restart OpenClaw."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════
# Main skill install (no argument)
# ══════════════════════════════════════════════════════════════════════

# ── Resolve latest version ────────────────────────────────────────────
info "Fetching latest release info..."
TAG=$(http_get "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
      | grep '"tag_name"' | head -1 | sed 's/.*"\(v[^"]*\)".*/\1/' || true)

if [ -n "$TAG" ]; then
  info "Latest version: ${TAG}"
else
  warn "Could not determine latest release — using latest available."
fi

# ── Prepare target directory ──────────────────────────────────────────
TARGET="${INSTALL_DIR}/${SKILL_NAME}"

if [ -d "$TARGET" ]; then
  warn "Directory already exists: ${TARGET}"
  confirm "Overwrite?" || { info "Aborted."; exit 0; }
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"

# ── Download with multi-source fallback ───────────────────────────────
_tmpdir=$(mktemp -d)
trap 'rm -rf "$_tmpdir"' EXIT

SKILL_ZIP="${_tmpdir}/skill.zip"
SKILL_ZIP_SHA256_URL="${SITE_URL}/js-eyes-skill.zip.sha256"
urls_skill_zip=("${SITE_URL}/js-eyes-skill.zip")
if [ -n "$TAG" ]; then
  VERSION="${TAG#v}"
  urls_skill_zip+=("https://github.com/${REPO}/releases/download/${TAG}/js-eyes-skill-v${VERSION}.zip")
  SKILL_ZIP_SHA256_URL="https://github.com/${REPO}/releases/download/${TAG}/js-eyes-skill-v${VERSION}.zip.sha256"
fi

info "Downloading skill bundle..."

if ! try_download "$SKILL_ZIP" "${urls_skill_zip[@]}"; then
  err "All download sources failed. Check your network and try again."
  exit 1
fi

EXPECTED_SHA256_LINE=$(http_get "${SKILL_ZIP_SHA256_URL}" 2>/dev/null || true)
EXPECTED_SHA256=$(printf '%s' "${EXPECTED_SHA256_LINE}" | awk 'NR==1{print $1}')
if ! verify_sha256 "$SKILL_ZIP" "$EXPECTED_SHA256"; then
  err "Refusing to install js-eyes without verified SHA-256."
  err "Expected sha file URL: ${SKILL_ZIP_SHA256_URL}"
  exit 1
fi

# ── Extract ───────────────────────────────────────────────────────────
info "Extracting skill bundle..."

extract_zip() {
  local zipfile="$1" dest="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -qo "$zipfile" -d "$dest"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$zipfile" "$dest"
  else
    err "unzip or python3 is required to extract the skill bundle zip."; exit 1
  fi
}

extract_zip "$SKILL_ZIP" "$TARGET"

# Fix permissions: OpenClaw rejects world-writable plugin paths
find "$TARGET" -type f -exec chmod 644 {} + 2>/dev/null || true
find "$TARGET" -type d -exec chmod 755 {} + 2>/dev/null || true

# ── Install dependencies ──────────────────────────────────────────────
info "Installing dependencies (npm ci --ignore-scripts)..."
if ! run_npm_ci "$TARGET"; then
  err "Dependency installation failed."
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────
ABSOLUTE_TARGET=$(cd "$TARGET" && pwd)
PLUGIN_PATH="${ABSOLUTE_TARGET}/openclaw-plugin"

ok "JS Eyes installed to: ${ABSOLUTE_TARGET}"

if [ "${SKIP_NATIVE_HOST}" != "1" ]; then
  if command -v npx >/dev/null 2>&1; then
    info "Registering browser native-messaging host (skip with --skip-native-host)..."
    if npx --yes js-eyes native-host install --browser all >/dev/null 2>&1; then
      ok "Native messaging host registered (Chrome + Firefox)."
    else
      warn "Native messaging host registration failed; run 'npx js-eyes native-host install' later."
    fi
  else
    warn "npx not found; skipping native-messaging host registration."
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Next: register the plugin in ~/.openclaw/openclaw.json"
echo ""
echo "  Add to plugins.load.paths:"
echo "    \"${PLUGIN_PATH}\""
echo ""
echo "  Add to plugins.entries:"
echo "    \"js-eyes\": {"
echo "      \"enabled\": true,"
echo "      \"config\": { \"serverPort\": 18080, \"autoStartServer\": true }"
echo "    }"
echo ""
echo "  Then restart OpenClaw."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
