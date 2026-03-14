"""
Server-Sent Events (SSE) endpoint for real-time notifications.

Replaces the old WebSocket notification prefix (\x01N) approach.
The frontend subscribes with EventSource and receives activity state changes.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["notifications"])

# All active SSE connections — each is an asyncio.Queue
_subscribers: list[asyncio.Queue] = []


async def broadcast_notification(session_id: str, message: dict[str, Any]):
    """Push a notification to all SSE subscribers."""
    event_data = json.dumps({"session_id": session_id, **message})
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(event_data)
        except asyncio.QueueFull:
            dead.append(q)
    # Clean up dead queues
    for q in dead:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


@router.get("/stream")
async def notification_stream(request: Request):
    """
    SSE endpoint. The frontend connects with EventSource and receives
    JSON events for activity state changes and other notifications.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    async def event_generator():
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        finally:
            try:
                _subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
