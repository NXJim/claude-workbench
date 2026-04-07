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

# Set during uvicorn shutdown to unblock SSE streams immediately,
# preventing the 30s wait_for timeout from hanging graceful reload.
_shutdown_event = asyncio.Event()


def signal_shutdown():
    """Called from main.py's shutdown handler to break all SSE loops."""
    _shutdown_event.set()


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
            while not _shutdown_event.is_set():
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                # Race queue.get() against shutdown event so we don't block
                # uvicorn's graceful reload for up to 30 seconds.
                get_task = asyncio.ensure_future(queue.get())
                shutdown_task = asyncio.ensure_future(_shutdown_event.wait())
                done, pending = await asyncio.wait(
                    {get_task, shutdown_task},
                    timeout=2,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                # Cancel whichever didn't finish
                for task in pending:
                    task.cancel()
                # Shutdown requested — exit immediately
                if shutdown_task in done:
                    break
                # Got a message from the queue
                if get_task in done:
                    data = get_task.result()
                    yield f"data: {data}\n\n"
                else:
                    # Both timed out — send keepalive
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
