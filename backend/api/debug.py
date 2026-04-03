"""Temporary diagnostic logging for terminal garbling investigation.

DIAG START — Remove this entire file when debugging is complete.

Receives batched diagnostic entries from the frontend terminal iframe
and appends them to /tmp/terminal-diag-{sessionId}.jsonl for analysis.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/debug", tags=["debug"])

LOG_DIR = Path("/tmp")


class DiagEntry(BaseModel):
    ts: int  # millisecond timestamp from Date.now()
    type: str  # write-in, flush, buffer-snapshot, corruption-detected, integrity-scan
    data: Any  # varies by type


class DiagBatch(BaseModel):
    sessionId: str
    entries: list[DiagEntry]


@router.post("/terminal-log")
async def terminal_log(batch: DiagBatch):
    """Append diagnostic entries to a per-session JSONL log file.

    Each line is one JSON object with ts, type, data, and a server-received timestamp.
    """
    log_path = LOG_DIR / f"terminal-diag-{batch.sessionId}.jsonl"

    lines = []
    for entry in batch.entries:
        record = {
            "server_ts": datetime.now().isoformat(),
            "client_ts": entry.ts,
            "type": entry.type,
            "data": entry.data,
        }
        lines.append(json.dumps(record, ensure_ascii=False))

    # Append all entries in one write to minimize I/O
    with open(log_path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return {"ok": True, "count": len(batch.entries)}
