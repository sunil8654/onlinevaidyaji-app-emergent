"""Centralized normalization of stored media paths into absolute URLs.

The website (Node/Express on Hostinger) owns the canonical profile photos and
stores RELATIVE paths in `users.image` (e.g. "/uploads/profiles/p1.webp"). Those
files are served by the website's file host, NOT by this FastAPI app, so a bare
relative "/uploads/..." value never resolves from the mobile client. Every
read-side serializer must absolutise it before the value leaves the API.

Keeping the rule in ONE place (this module) means the website's storage
convention and the app's rendering stay in sync without duplicating uploads.
"""
import os

# The website's file host. Overridable so a different host can be configured
# without a code change; a blank/whitespace value falls back to the default
# (the previous code read the env var directly, so a blank value produced
# relative URLs and broke rendering).
DEFAULT_MEDIA_BASE_URL = "https://api.onlinevaidyaji.com"


def _resolve_base_url() -> str:
    raw = (os.environ.get("PROFILE_MEDIA_BASE_URL") or "").strip()
    if not raw:
        raw = DEFAULT_MEDIA_BASE_URL
    return raw.rstrip("/")


MEDIA_BASE_URL = _resolve_base_url()


def absolute_media_url(raw):
    """Return an <Image>-loadable URL for a stored media value.

    - absolute http(s) URL (Google avatar, CDN) -> returned unchanged
    - protocol-relative "//host/path"            -> "https://host/path"
    - relative "/uploads/..." or "uploads/..."   -> prefixed with the media host
    - data: URI or anything unrecognised          -> None (UI falls back)
    """
    if not raw or not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value:
        return None
    if value.startswith("data:"):
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("//"):
        return f"https:{value}"
    if value.startswith("/"):
        return f"{MEDIA_BASE_URL}{value}"
    if value.startswith("uploads/"):
        return f"{MEDIA_BASE_URL}/{value}"
    return None
