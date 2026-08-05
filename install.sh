#!/usr/bin/env bash
#
# zk-graph installer
#
#   ./install.sh              install (copy files)
#   ./install.sh --dev        install via symlinks, so edits to the source
#                             files take effect immediately
#   ./install.sh --uninstall  remove everything this installed
#
# Installs the viewer to  ~/.local/share/zk-graph
# and a launcher command  ~/.local/bin/zk-graph
#
set -euo pipefail

# ── paths ─────────────────────────────────────────────────────────────────────
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ZK_GRAPH_APP_DIR:-$HOME/.local/share/zk-graph}"
BIN_DIR="${ZK_GRAPH_BIN_DIR:-$HOME/.local/bin}"
LAUNCHER="$BIN_DIR/zk-graph"

ASSETS=(zk-graph-viewer.html zk-graph-viewer.css zk-graph-viewer.js)

# ── pretty output ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
  GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; BLU=$'\033[34m'
else
  B=""; DIM=""; R=""; GRN=""; YLW=""; RED=""; BLU=""
fi
ok()   { printf '  %s✓%s %s\n' "$GRN" "$R" "$*"; }
info() { printf '  %s·%s %s\n' "$DIM" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$YLW" "$R" "$*"; }
die()  { printf '\n  %sError:%s %s\n\n' "$RED" "$R" "$*" >&2; exit 1; }
head_() { printf '\n%s%s%s\n' "$B" "$*" "$R"; }

# ── args ──────────────────────────────────────────────────────────────────────
MODE=install
LINK_MODE=0
for arg in "$@"; do
  case "$arg" in
    --dev)        LINK_MODE=1 ;;
    --uninstall)  MODE=uninstall ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown option: $arg (try --help)" ;;
  esac
done

# ── uninstall ─────────────────────────────────────────────────────────────────
if [ "$MODE" = uninstall ]; then
  head_ "Uninstalling zk-graph"
  [ -e "$LAUNCHER" ] && { rm -f "$LAUNCHER"; ok "removed $LAUNCHER"; } || info "no launcher at $LAUNCHER"
  if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"; ok "removed $APP_DIR"
  else
    info "no app directory at $APP_DIR"
  fi
  printf '\n  Done.\n\n'
  exit 0
fi

head_ "Installing zk-graph"

# ── 1. dependencies ───────────────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || die "python3 is required but not found."
ok "python3 $(python3 -c 'import sys;print(".".join(map(str,sys.version_info[:3])))')"

if command -v zk >/dev/null 2>&1; then
  ok "zk $(zk --version 2>/dev/null | head -1 || true)"
else
  warn "zk not found on PATH."
  warn "The viewer needs 'zk graph' and 'zk list' to generate its data."
  warn "Install it from https://github.com/zk-org/zk, then re-run this script."
fi

# ── 2. locate the notebook ────────────────────────────────────────────────────
NOTEBOOK=""
for cand in "${ZK_NOTEBOOK_DIR:-}" "$HOME/Sync/zk" "$HOME/zk" "$HOME/notes" "$HOME/Documents/zk"; do
  [ -n "$cand" ] && [ -d "$cand/.zk" ] && { NOTEBOOK="$cand"; break; }
done

if [ -n "$NOTEBOOK" ]; then
  ok "notebook: $NOTEBOOK"
else
  warn "no zk notebook found automatically."
  info "set ZK_NOTEBOOK_DIR, or pass --notebook DIR when running zk-graph."
fi

# ── 3. install the viewer files ───────────────────────────────────────────────
for f in "${ASSETS[@]}"; do
  [ -f "$SRC_DIR/$f" ] || die "missing source file: $SRC_DIR/$f"
done

mkdir -p "$APP_DIR"
for f in "${ASSETS[@]}"; do
  rm -f "$APP_DIR/$f"
  if [ "$LINK_MODE" = 1 ]; then
    ln -s "$SRC_DIR/$f" "$APP_DIR/$f"
  else
    cp "$SRC_DIR/$f" "$APP_DIR/$f"
  fi
done
if [ "$LINK_MODE" = 1 ]; then
  ok "linked ${#ASSETS[@]} files into $APP_DIR ${DIM}(dev mode)${R}"
else
  ok "installed ${#ASSETS[@]} files into $APP_DIR"
fi

# keep generated data out of version control if the source dir is a repo
printf 'graph.json\nnotes.json\n' > "$APP_DIR/.gitignore"

# ── 4. write the launcher ─────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
cat > "$LAUNCHER" <<'LAUNCHER_EOF'
#!/usr/bin/env bash
#
# zk-graph — regenerate the graph data and serve the viewer.
#
#   zk-graph                    refresh data, serve, open browser
#   zk-graph --port 9000        use a specific port
#   zk-graph --notebook DIR     use a specific notebook
#   zk-graph --no-refresh       serve existing JSON without re-running zk
#   zk-graph --no-open          don't launch a browser
#
set -euo pipefail

APP_DIR="${ZK_GRAPH_APP_DIR:-$HOME/.local/share/zk-graph}"
PORT=""
REFRESH=1
OPEN=1
NOTEBOOK="${ZK_NOTEBOOK_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --port)       PORT="${2:-}"; shift 2 ;;
    --notebook)   NOTEBOOK="${2:-}"; shift 2 ;;
    --no-refresh) REFRESH=0; shift ;;
    --no-open)    OPEN=0; shift ;;
    -h|--help)    sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "zk-graph: unknown option: $1" >&2; exit 1 ;;
  esac
done

[ -f "$APP_DIR/zk-graph-viewer.html" ] || {
  echo "zk-graph: viewer not found in $APP_DIR — re-run install.sh" >&2; exit 1; }

# ── locate the notebook ───────────────────────────────────────────────────────
if [ -z "$NOTEBOOK" ]; then
  for cand in "$HOME/Sync/zk" "$HOME/zk" "$HOME/notes" "$HOME/Documents/zk"; do
    [ -d "$cand/.zk" ] && { NOTEBOOK="$cand"; break; }
  done
fi

# ── refresh graph.json / notes.json ───────────────────────────────────────────
if [ "$REFRESH" = 1 ]; then
  if ! command -v zk >/dev/null 2>&1; then
    echo "zk-graph: 'zk' not on PATH — serving existing data." >&2
  elif [ -z "$NOTEBOOK" ] || [ ! -d "$NOTEBOOK/.zk" ]; then
    echo "zk-graph: no notebook found — serving existing data." >&2
    echo "          pass --notebook DIR or set ZK_NOTEBOOK_DIR." >&2
  else
    echo "Refreshing from $NOTEBOOK ..."
    # Write to temp files first and validate them, so a failed or noisy zk
    # run can never leave truncated or malformed data in place.
    if (cd "$NOTEBOOK" && zk graph --format json) > "$APP_DIR/.graph.tmp" 2>/dev/null \
    && (cd "$NOTEBOOK" && zk list  --format json) > "$APP_DIR/.notes.tmp" 2>/dev/null \
    && python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' \
         "$APP_DIR/.graph.tmp" "$APP_DIR/.notes.tmp" 2>/dev/null; then
      mv "$APP_DIR/.graph.tmp" "$APP_DIR/graph.json"
      mv "$APP_DIR/.notes.tmp" "$APP_DIR/notes.json"
      printf '  graph.json  %s bytes\n' "$(wc -c < "$APP_DIR/graph.json" | tr -d ' ')"
      printf '  notes.json  %s bytes\n' "$(wc -c < "$APP_DIR/notes.json" | tr -d ' ')"
    else
      rm -f "$APP_DIR/.graph.tmp" "$APP_DIR/.notes.tmp"
      echo "zk-graph: data refresh failed — serving existing data." >&2
      echo "          try running 'zk graph --format json' inside your notebook." >&2
    fi
  fi
fi

if [ ! -f "$APP_DIR/graph.json" ] || [ ! -f "$APP_DIR/notes.json" ]; then
  echo "zk-graph: no graph.json / notes.json to serve." >&2
  echo "          run without --no-refresh, with zk installed and a notebook available." >&2
  exit 1
fi

# ── pick a port ───────────────────────────────────────────────────────────────
if [ -z "$PORT" ]; then
  PORT=$(python3 - <<'PY'
import socket
for p in range(8422, 8500):
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p)); print(p); break
    except OSError:
        continue
    finally:
        s.close()
else:
    print(0)
PY
)
  [ "$PORT" = 0 ] && { echo "zk-graph: no free port found." >&2; exit 1; }
fi

URL="http://127.0.0.1:$PORT/zk-graph-viewer.html"

# ── serve ─────────────────────────────────────────────────────────────────────
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$APP_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# wait for the server to accept connections
for _ in $(seq 1 50); do
  if python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

kill -0 "$SERVER_PID" 2>/dev/null || { echo "zk-graph: server failed to start." >&2; exit 1; }

echo
echo "  zk-graph serving at  $URL"
echo "  press Ctrl-C to stop"
echo

if [ "$OPEN" = 1 ]; then
  if [ -n "${BROWSER:-}" ];              then "$BROWSER" "$URL" >/dev/null 2>&1 &
  elif command -v qutebrowser >/dev/null 2>&1; then qutebrowser "$URL" >/dev/null 2>&1 &
  elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open        >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 &
  fi
fi

wait "$SERVER_PID"
LAUNCHER_EOF

chmod +x "$LAUNCHER"
ok "launcher installed at $LAUNCHER"

# ── 5. PATH check ─────────────────────────────────────────────────────────────
case ":${PATH}:" in
  *":$BIN_DIR:"*) ok "$BIN_DIR is on your PATH" ;;
  *)
    warn "$BIN_DIR is not on your PATH."
    info "add this to your shell rc file:"
    printf '\n      %sexport PATH="%s:$PATH"%s\n' "$BLU" "$BIN_DIR" "$R"
    ;;
esac

# ── done ──────────────────────────────────────────────────────────────────────
head_ "Done"
printf '  Run %szk-graph%s to refresh your notes and open the viewer.\n' "$B" "$R"
printf '  %szk-graph --help%s lists the options.\n' "$DIM" "$R"
printf '  %s./install.sh --uninstall%s removes everything.\n\n' "$DIM" "$R"
