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

BACKEND_PORT="${CWB_BACKEND_PORT:-8084}"
FRONTEND_PORT="${CWB_FRONTEND_PORT:-5173}"

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
    echo "Mode: Development (two-process)"
    echo "Backend:  http://${CWB_PUBLIC_HOST}:${BACKEND_PORT}"
    echo "Frontend: http://${CWB_PUBLIC_HOST}:${FRONTEND_PORT}"
    echo ""

    # Start backend
    echo "Starting backend..."
    cd "$BACKEND_DIR"
    source venv/bin/activate
    python main.py &
    BACKEND_PID=$!

    # Start frontend
    echo "Starting frontend..."
    cd "$FRONTEND_DIR"
    npm run dev &
    FRONTEND_PID=$!

    echo ""
    echo "Backend PID:  $BACKEND_PID"
    echo "Frontend PID: $FRONTEND_PID"
    echo ""
    echo "Press Ctrl+C to stop both services."

    # Trap and kill both
    cleanup() {
        echo ""
        echo "Stopping services..."
        kill $BACKEND_PID 2>/dev/null
        kill $FRONTEND_PID 2>/dev/null
        wait $BACKEND_PID 2>/dev/null
        wait $FRONTEND_PID 2>/dev/null
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
    exec python -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --log-level info
fi
