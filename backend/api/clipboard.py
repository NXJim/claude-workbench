"""Cross-session clipboard API — in-memory shared clipboard."""

from fastapi import APIRouter
from schemas import ClipboardContent

router = APIRouter(prefix="/clipboard", tags=["clipboard"])

# In-memory clipboard (no persistence needed)
_clipboard_content: str = ""


@router.get("")
async def get_clipboard():
    """Get current clipboard content."""
    return {"content": _clipboard_content}


@router.put("")
async def set_clipboard(data: ClipboardContent):
    """Set clipboard content. Broadcasts via SSE."""
    global _clipboard_content
    _clipboard_content = data.content

    # Broadcast clipboard change via SSE
    try:
        from api.notifications import broadcast_notification
        await broadcast_notification("clipboard", {
            "type": "clipboard",
            "content": data.content[:100],  # Preview only in notification
        })
    except Exception:
        pass  # SSE broadcast failure is non-critical

    return {"content": _clipboard_content, "size": len(_clipboard_content)}
