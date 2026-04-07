#!/bin/bash
# Claude Workbench — start script
#
# Default: production mode (FastAPI serves built frontend)
# --dev:   development mode (backend + Vite dev server)

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# Load .env if it exists
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# Auto-detect host IP if not set
if [ -z "$CWB_PUBLIC_HOST" ]; then
    CWB_PUBLIC_HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$CWB_PUBLIC_HOST" ]; then
        CWB_PUBLIC_HOST="localhost"
    fi
    export CWB_PUBLIC_HOST
fi

BACKEND_PORT="${CWB_BACKEND_PORT:-8000}"
FRONTEND_PORT="${CWB_FRONTEND_PORT:-3000}"
WATCHDOG_PORT="${CWB_WATCHDOG_PORT:-8099}"

# Parse flags
DEV_MODE=false
for arg in "$@"; do
    case "$arg" in
        --dev) DEV_MODE=true ;;
    esac
done

echo "=== Claude Workbench ==="
echo "Host: $CWB_PUBLIC_HOST"

if [ "$DEV_MODE" = true ]; then
    # --- Development mode: backend + Vite dev server ---
    export CWB_DEV_MODE=1

    echo "Mode: Development (two-process)"
    echo "Backend:  http://${CWB_PUBLIC_HOST}:${BACKEND_PORT}"
    echo "Frontend: http://${CWB_PUBLIC_HOST}:${FRONTEND_PORT}"
    echo ""

    # Create logs directory and truncate log files for this run
    LOGS_DIR="$PROJECT_DIR/logs"
    mkdir -p "$LOGS_DIR"
    > "$LOGS_DIR/backend.log"
    > "$LOGS_DIR/frontend.log"

    # Pre-flight: kill anything occupying our ports to prevent orphan accumulation
    for CHECK_PORT in $BACKEND_PORT $FRONTEND_PORT $WATCHDOG_PORT; do
        EXISTING_PID=$(ss -tlnp "sport = :$CHECK_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
        if [ -n "$EXISTING_PID" ]; then
            echo "Killing existing process on port $CHECK_PORT (PID $EXISTING_PID)"
            kill -9 "$EXISTING_PID" 2>/dev/null
            sleep 0.5
        fi
    done

    # Kill any stale start.sh --dev processes (but not our own process tree).
    # Build a set of PIDs to protect: ourselves, our ancestors up to init.
    PROTECTED_PIDS="$$"
    _WALK_PID=$$
    while [ "$_WALK_PID" -gt 1 ] 2>/dev/null; do
        _WALK_PID=$(ps -o ppid= -p "$_WALK_PID" 2>/dev/null | tr -d ' ')
        [ -z "$_WALK_PID" ] && break
        PROTECTED_PIDS="$PROTECTED_PIDS $_WALK_PID"
    done
    for STALE_PID in $(pgrep -f 'start\.sh --dev' 2>/dev/null); do
        SKIP=false
        for PROT_PID in $PROTECTED_PIDS; do
            [ "$STALE_PID" = "$PROT_PID" ] && SKIP=true && break
        done
        if [ "$SKIP" = false ]; then
            echo "Killing stale start.sh process (PID $STALE_PID)"
            kill -9 "$STALE_PID" 2>/dev/null || true
        fi
    done

    # Start backend (output to log file for Logs tab in UI)
    echo "Starting backend..."
    cd "$BACKEND_DIR"
    source venv/bin/activate
    python main.py >> "$LOGS_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!

    # Start frontend (output to log file for Logs tab in UI)
    echo "Starting frontend..."
    cd "$FRONTEND_DIR"
    npm run dev >> "$LOGS_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!

    # Start watchdog (lightweight restart endpoint on separate port)
    echo "Starting watchdog..."
    python "$PROJECT_DIR/scripts/watchdog.py" >> "$LOGS_DIR/backend.log" 2>&1 &
    WATCHDOG_PID=$!

    echo ""
    echo "Backend PID:  $BACKEND_PID"
    echo "Frontend PID: $FRONTEND_PID"
    echo "Watchdog PID: $WATCHDOG_PID (port $WATCHDOG_PORT)"
    echo ""
    echo "Press Ctrl+C to stop all services."

    # Trap and kill all three
    cleanup() {
        echo ""
        echo "Stopping services..."
        kill $BACKEND_PID 2>/dev/null
        kill $FRONTEND_PID 2>/dev/null
        kill $WATCHDOG_PID 2>/dev/null
        wait $BACKEND_PID 2>/dev/null
        wait $FRONTEND_PID 2>/dev/null
        wait $WATCHDOG_PID 2>/dev/null
        echo "Done."
    }
    trap cleanup EXIT INT TERM
    wait
else
    # --- Production mode: single process ---
    # Backend serves built frontend via StaticFiles mount
    if [ ! -d "$FRONTEND_DIR/dist" ]; then
        echo "ERROR: Frontend not built. Run ./setup.sh first, or:"
        echo "  cd frontend && npm run build"
        exit 1
    fi

    echo "Mode: Production (single-process)"
    echo "URL: http://${CWB_PUBLIC_HOST}:${BACKEND_PORT}"
    echo ""

    cd "$BACKEND_DIR"
    source venv/bin/activate

    echo "Starting server..."
    exec python -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --log-level info --timeout-graceful-shutdown 3
fi
