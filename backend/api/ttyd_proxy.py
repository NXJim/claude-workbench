"""
ttyd reverse proxy — HTTP + WebSocket proxy for production mode.

In dev mode, Vite's custom plugin handles this. In production (backend serves
built frontend), we need to proxy /ttyd/{port}/... to the per-session ttyd
processes running on 127.0.0.1:{port}.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse, Response
from starlette.websockets import WebSocketState

from config import TTYD_PORT_BASE, TTYD_PORT_MAX

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ttyd-proxy"])


def _validate_port(port: int) -> bool:
    """Only allow proxying to ports in the configured ttyd range."""
    return TTYD_PORT_BASE <= port <= TTYD_PORT_MAX


@router.api_route("/ttyd/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_ttyd_http(port: int, path: str, request: Request):
    """Proxy HTTP requests to a ttyd instance."""
    if not _validate_port(port):
        return Response(status_code=404, content="Invalid ttyd port")

    target_url = f"http://127.0.0.1:{port}/{path}"

    # Forward query string
    if request.url.query:
        target_url += f"?{request.url.query}"

    try:
        async with httpx.AsyncClient() as client:
            body = await request.body()
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers={
                    k: v for k, v in request.headers.items()
                    if k.lower() not in ("host", "connection")
                },
                content=body if body else None,
                timeout=10.0,
            )

            # Forward response headers (excluding hop-by-hop)
            excluded = {"transfer-encoding", "connection", "keep-alive"}
            headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in excluded
            }

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=headers,
            )
    except httpx.ConnectError:
        return Response(status_code=502, content="ttyd not running on this port")
    except Exception as e:
        logger.warning("ttyd HTTP proxy error for port %d: %s", port, e)
        return Response(status_code=502, content="ttyd proxy error")


@router.websocket("/ttyd/{port}/ws")
async def proxy_ttyd_ws(port: int, websocket: WebSocket):
    """Proxy WebSocket connections to a ttyd instance."""
    if not _validate_port(port):
        await websocket.close(code=4004, reason="Invalid ttyd port")
        return

    await websocket.accept()

    import websockets

    target_url = f"ws://127.0.0.1:{port}/ws"

    try:
        async with websockets.connect(
            target_url,
            subprotocols=["tty"],
            max_size=None,
            ping_interval=None,
        ) as ttyd_ws:
            # Bidirectional relay
            async def client_to_ttyd():
                """Forward messages from browser to ttyd."""
                try:
                    while True:
                        data = await websocket.receive()
                        if "text" in data:
                            await ttyd_ws.send(data["text"])
                        elif "bytes" in data:
                            await ttyd_ws.send(data["bytes"])
                except (WebSocketDisconnect, Exception):
                    pass

            async def ttyd_to_client():
                """Forward messages from ttyd to browser."""
                try:
                    async for msg in ttyd_ws:
                        if websocket.client_state != WebSocketState.CONNECTED:
                            break
                        if isinstance(msg, bytes):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except (WebSocketDisconnect, Exception):
                    pass

            # Run both directions concurrently; cancel when either finishes
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_ttyd()),
                    asyncio.create_task(ttyd_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()

    except Exception as e:
        logger.debug("ttyd WS proxy for port %d closed: %s", port, e)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
