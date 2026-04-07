#!/usr/bin/env python3
"""
Watchdog — lightweight restart endpoint that runs independently of the main backend.

Listens on port 8099. When the backend (uvicorn on port 8000) hangs during reload,
the frontend can hit this endpoint to force-restart it. The watchdog is never killed
by backend restarts because it runs on a separate port and isn't matched by the
pkill patterns used in restart scripts.

Endpoints:
  GET  /health   → {"status": "ok"}
  POST /restart  → kills the backend, restarts it, returns {"status": "restarting"}
"""

import http.server
import json
import os
import subprocess
import sys

PORT = int(os.environ.get("CWB_WATCHDOG_PORT", "8099"))
BACKEND_PORT = int(os.environ.get("CWB_BACKEND_PORT", "8000"))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(PROJECT_DIR, "backend")


def _cors_headers(handler):
    """Set CORS headers so the frontend can call us cross-origin."""
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")


def _restart_backend():
    """Kill the hung backend and start a fresh one."""
    # Kill any process on the backend port
    subprocess.run(
        ["bash", "-c", f"""
            pid=$(ss -tlnp 'sport = :{BACKEND_PORT}' 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | head -1)
            if [ -n "$pid" ]; then
                kill -9 "$pid" 2>/dev/null
            fi
        """],
        capture_output=True,
    )

    # Start a new backend process (fully detached)
    subprocess.Popen(
        ["bash", "-c", f"""
            sleep 1
            cd "{BACKEND_DIR}" && source venv/bin/activate && python main.py
        """],
        start_new_session=True,
        stdout=open(os.path.join(PROJECT_DIR, "logs", "backend.log"), "a"),
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )


class WatchdogHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP handler — health check and restart."""

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            _cors_headers(self)
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            _cors_headers(self)
            self.end_headers()

    def do_POST(self):
        if self.path == "/restart":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            _cors_headers(self)
            self.end_headers()
            self.wfile.write(json.dumps({"status": "restarting"}).encode())
            _restart_backend()
        else:
            self.send_response(404)
            _cors_headers(self)
            self.end_headers()

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(200)
        _cors_headers(self)
        self.end_headers()

    def log_message(self, format, *args):
        """Suppress request logging to keep output clean."""
        pass


if __name__ == "__main__":
    # Ensure logs directory exists
    os.makedirs(os.path.join(PROJECT_DIR, "logs"), exist_ok=True)

    server = http.server.HTTPServer(("0.0.0.0", PORT), WatchdogHandler)
    print(f"Watchdog listening on port {PORT}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
