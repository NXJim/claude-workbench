#!/bin/bash
# Install Claude Workbench as a systemd service.
#
# Usage: sudo ./scripts/install-service.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env for port
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

PORT="${CWB_BACKEND_PORT:-8084}"
VENV="$PROJECT_DIR/backend/venv"
SERVICE_NAME="claude-workbench"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run as root (or with sudo)."
    exit 1
fi

# Check that venv exists
if [ ! -d "$VENV" ]; then
    echo "ERROR: Python venv not found at $VENV"
    echo "Run ./setup.sh first."
    exit 1
fi

# Check that frontend is built
if [ ! -d "$PROJECT_DIR/frontend/dist" ]; then
    echo "ERROR: Frontend not built."
    echo "Run ./setup.sh first."
    exit 1
fi

# Detect the user who owns the project directory
OWNER=$(stat -c '%U' "$PROJECT_DIR")

echo "Installing systemd service: $SERVICE_NAME"
echo "  User: $OWNER"
echo "  Port: $PORT"
echo "  Dir:  $PROJECT_DIR"

# Generate service file from template
sed \
    -e "s|%USER%|$OWNER|g" \
    -e "s|%WORKDIR%|$PROJECT_DIR|g" \
    -e "s|%VENV%|$VENV|g" \
    -e "s|%PORT%|$PORT|g" \
    "$PROJECT_DIR/scripts/claude-workbench.service.template" > "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo ""
echo "Service installed and started."
echo "  Status:  systemctl status $SERVICE_NAME"
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
echo "  Disable: sudo systemctl disable $SERVICE_NAME"
