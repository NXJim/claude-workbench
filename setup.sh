#!/bin/bash
# Claude Workbench — first-time setup
#
# Checks prerequisites, installs dependencies, builds frontend,
# and creates the .env configuration file.
#
# Usage:
#   ./setup.sh                 Check prereqs, install project deps, build
#   ./setup.sh --install-deps  Also install missing system packages via apt

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# Parse flags
INSTALL_DEPS=false
for arg in "$@"; do
    case "$arg" in
        --install-deps) INSTALL_DEPS=true ;;
    esac
done

echo "=== Claude Workbench Setup ==="
echo ""

# --- Check all prerequisites first, collect what's missing ---

MISSING_APT=()    # packages installable via apt
MISSING_OTHER=()  # issues that need manual resolution

# Python 3.10+
if command -v python3 &>/dev/null; then
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
    PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
    if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]; }; then
        MISSING_OTHER+=("Python 3.10+ required (found $PYTHON_VERSION)")
    else
        echo "[OK] Python $PYTHON_VERSION"
    fi
else
    MISSING_APT+=("python3" "python3-venv")
fi

# Node.js 18+
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        MISSING_OTHER+=("Node.js 18+ required (found $(node -v)) — see https://nodejs.org/")
    else
        echo "[OK] Node.js $(node -v)"
    fi
else
    MISSING_APT+=("nodejs")
fi

# npm
if command -v npm &>/dev/null; then
    echo "[OK] npm $(npm -v)"
else
    MISSING_APT+=("npm")
fi

# tmux
if command -v tmux &>/dev/null; then
    echo "[OK] tmux $(tmux -V)"
else
    MISSING_APT+=("tmux")
fi

# ttyd (not in apt — downloaded from GitHub releases)
NEED_TTYD=false
if command -v ttyd &>/dev/null; then
    echo "[OK] ttyd $(ttyd --version 2>&1 | head -1 || echo 'found')"
else
    NEED_TTYD=true
fi

# --- Report missing prerequisites ---

if [ ${#MISSING_OTHER[@]} -gt 0 ]; then
    echo ""
    echo "The following issues need manual resolution:"
    for issue in "${MISSING_OTHER[@]}"; do
        echo "  - $issue"
    done
    exit 1
fi

if [ ${#MISSING_APT[@]} -gt 0 ] || [ "$NEED_TTYD" = true ]; then
    echo ""

    if [ ${#MISSING_APT[@]} -gt 0 ]; then
        echo "Missing system packages: ${MISSING_APT[*]}"
    fi
    if [ "$NEED_TTYD" = true ]; then
        echo "Missing: ttyd (terminal server)"
    fi

    if [ "$INSTALL_DEPS" = true ]; then
        # Auto-install missing apt packages
        if [ ${#MISSING_APT[@]} -gt 0 ]; then
            echo ""
            echo "Installing: ${MISSING_APT[*]}"
            sudo apt update -qq
            sudo apt install -y "${MISSING_APT[@]}"
            echo ""
        fi

        # Auto-install ttyd binary
        if [ "$NEED_TTYD" = true ]; then
            ARCH=$(uname -m)
            case "$ARCH" in
                x86_64)  TTYD_ARCH="x86_64" ;;
                aarch64) TTYD_ARCH="aarch64" ;;
                *)       echo "ERROR: Cannot auto-install ttyd for $ARCH. Install manually: https://github.com/tsl0922/ttyd"; exit 1 ;;
            esac
            TTYD_URL="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"
            echo "Downloading ttyd from $TTYD_URL..."
            sudo curl -L "$TTYD_URL" -o /usr/local/bin/ttyd
            sudo chmod +x /usr/local/bin/ttyd
            echo "[OK] ttyd installed to /usr/local/bin/ttyd"
            echo ""
        fi
    else
        # Print instructions and exit
        echo ""
        echo "To install missing packages automatically, run:"
        echo "  ./setup.sh --install-deps"
        echo ""
        if [ ${#MISSING_APT[@]} -gt 0 ]; then
            echo "Or install manually:"
            echo "  sudo apt install ${MISSING_APT[*]}"
        fi
        if [ "$NEED_TTYD" = true ]; then
            echo "  ttyd: https://github.com/tsl0922/ttyd"
        fi
        echo ""
        echo "Then re-run ./setup.sh"
        exit 1
    fi
fi

echo ""

# --- Python venv + dependencies ---

echo "Setting up Python virtual environment..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt
echo "[OK] Python dependencies installed"

# --- Node.js dependencies ---

echo "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install --silent
echo "[OK] Frontend dependencies installed"

# --- Build frontend ---

echo "Building frontend for production..."
npm run build
echo "[OK] Frontend built"

# --- Create data directories ---

mkdir -p "$BACKEND_DIR/data/notes"

# --- Create .env if it doesn't exist ---

if [ ! -f "$PROJECT_DIR/.env" ]; then
    # Auto-detect host IP
    HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$HOST_IP" ]; then
        HOST_IP="localhost"
    fi

    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    # Uncomment and set the host
    sed -i "s/# CWB_PUBLIC_HOST=.*/CWB_PUBLIC_HOST=$HOST_IP/" "$PROJECT_DIR/.env"
    echo "[OK] Created .env with host $HOST_IP"
else
    echo "[OK] .env already exists (not modified)"
fi

# --- Done ---

echo ""
echo "==============================="
echo "  Setup complete!"
echo "==============================="
echo ""

# Read the configured or detected host
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi
DISPLAY_HOST="${CWB_PUBLIC_HOST:-localhost}"
DISPLAY_PORT="${CWB_BACKEND_PORT:-8084}"

echo "Start the server:"
echo "  ./scripts/start.sh"
echo ""
echo "Then open: http://${DISPLAY_HOST}:${DISPLAY_PORT}"
echo ""
echo "For development mode (with hot reload):"
echo "  ./scripts/start.sh --dev"
echo ""
