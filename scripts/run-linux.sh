#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "c_vis native mode requires Linux. Use Docker on this platform." >&2
  exit 1
fi

missing=()
for command_name in node npm cc make gdb python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing+=("$command_name")
  fi
done

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major" -lt 22 ]]; then
    missing+=("node>=22")
  fi
fi

print_install_hint() {
  local distro_id=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    distro_id="${ID:-}"
  fi

  echo "Install the missing native dependencies, then run again:" >&2
  case "$distro_id" in
    ubuntu|debian|linuxmint|pop)
      echo "  sudo apt update && sudo apt install -y build-essential gdb python3" >&2
      ;;
    fedora|rhel|centos|rocky|almalinux)
      echo "  sudo dnf install -y gcc make gdb python3" >&2
      ;;
    arch|manjaro)
      echo "  sudo pacman -S --needed base-devel gdb python" >&2
      ;;
    *)
      echo "  Required: Node.js 22+, npm, a C compiler (cc/gcc), make, gdb, python3" >&2
      ;;
  esac
  echo "Node.js must be version 22 or newer." >&2
}

if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'Missing: %s\n' "${missing[*]}" >&2
  print_install_hint
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "c_vis native Linux prerequisites: OK"
  echo "Node: $(node --version)"
  echo "GDB: $(gdb --version | sed -n '1p')"
  echo "Compiler: $(cc --version | sed -n '1p')"
  exit 0
fi

if [[ ! -d node_modules ]]; then
  echo "Installing JavaScript dependencies..."
  npm install --no-audit --no-fund
fi

if [[ "${CVIS_SKIP_BUILD:-0}" != "1" ]]; then
  echo "Building c_vis..."
  npm run build
fi

export CVIS_RUNTIME_MODE="native-linux"
export CVIS_HOST="${CVIS_HOST:-127.0.0.1}"
export PORT="${PORT:-4173}"

case "$CVIS_HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    if [[ "${CVIS_ALLOW_REMOTE_NATIVE:-0}" != "1" ]]; then
      echo "Refusing to expose native mode on $CVIS_HOST." >&2
      echo "Native mode executes uploaded C code as your Linux user." >&2
      echo "Set CVIS_ALLOW_REMOTE_NATIVE=1 only if remote access is intentional." >&2
      exit 1
    fi
    ;;
esac

auto_workspace=0
if [[ -z "${CVIS_WORKSPACE_ROOT:-}" ]]; then
  runtime_parent="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
  mkdir -p "$runtime_parent"
  CVIS_WORKSPACE_ROOT="$(mktemp -d "$runtime_parent/cvis-native-${UID:-user}.XXXXXX")"
  chmod 700 "$CVIS_WORKSPACE_ROOT"
  export CVIS_WORKSPACE_ROOT
  auto_workspace=1
else
  mkdir -p "$CVIS_WORKSPACE_ROOT"
  chmod 700 "$CVIS_WORKSPACE_ROOT" 2>/dev/null || true
fi

server_pid=""
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$auto_workspace" -eq 1 && -n "${CVIS_WORKSPACE_ROOT:-}" ]]; then
    rm -rf -- "$CVIS_WORKSPACE_ROOT"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

echo ""
echo "c_vis native Linux"
echo "  URL:       http://$CVIS_HOST:$PORT"
echo "  Runtime:   host GDB + host compiler"
echo "  Workspace: $CVIS_WORKSPACE_ROOT"
echo "  Security:  uploaded C executes as user $(id -un)"
echo ""

node server/index.js &
server_pid=$!
wait "$server_pid"
