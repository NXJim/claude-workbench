"""Application configuration — all values driven by environment/.env file."""

import os
import socket
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (one level above backend/)
PROJECT_ROOT = Path(__file__).resolve().parent
_env_file = PROJECT_ROOT.parent / ".env"
load_dotenv(_env_file)


def _detect_host() -> str:
    """Auto-detect a reachable hostname/IP for browser access."""
    # Try to get the LAN IP by connecting to a public DNS (no data sent)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        pass
    # Fallback
    return "localhost"


# --- Public host (used by CORS, ttyd URLs, project creator) ---
PUBLIC_HOST = os.getenv("CWB_PUBLIC_HOST") or _detect_host()

# --- Paths ---
DB_PATH = PROJECT_ROOT / "workbench.db"
TMUX_CONF_PATH = PROJECT_ROOT / "tmux_workbench.conf"
PROJECTS_ROOT = Path(os.getenv("CWB_PROJECTS_ROOT", str(Path.home() / "projects"))).expanduser()

# --- Server ---
HOST = "0.0.0.0"
PORT = int(os.getenv("CWB_BACKEND_PORT", "7860"))
FRONTEND_PORT = int(os.getenv("CWB_FRONTEND_PORT", "5173"))
FRONTEND_ORIGIN = f"http://{PUBLIC_HOST}:{FRONTEND_PORT}"

# --- tmux ---
TMUX_SESSION_PREFIX = "cwb"

# --- ttyd (per-session terminal server) ---
TTYD_BINARY = "ttyd"
TTYD_PORT_BASE = int(os.getenv("CWB_TTYD_PORT_BASE", "9100"))
TTYD_PORT_MAX = int(os.getenv("CWB_TTYD_PORT_MAX", "9200"))

# --- Activity detection (tmux polling) ---
ACTIVITY_POLL_INTERVAL = 2  # seconds between tmux process checks
IDLE_SHELLS = {"bash", "zsh", "fish", "sh", "dash"}  # commands that mean "idle"

# --- Debug ---
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
