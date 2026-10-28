"""鉴权：Better Auth session 或可选 QWEN_TTS_API_KEY 机器入口。"""

from __future__ import annotations

import hmac
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request

from .config import API_KEY, AUTH_DB_PATH

_PUBLIC_EXACT = frozenset({"/health", "/docs", "/openapi.json", "/redoc"})
_PUBLIC_PREFIXES = ("/api/auth",)


@dataclass(frozen=True)
class Principal:
    user_id: str | None
    email: str
    name: str
    actor: str  # "user" | "system"


def is_public_path(path: str) -> bool:
    if path in _PUBLIC_EXACT:
        return True
    return any(path == prefix or path.startswith(prefix + "/") for prefix in _PUBLIC_PREFIXES)


def _bearer(header: str) -> str:
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def require_user(request: Request) -> Principal:
    if is_public_path(request.url.path):
        principal = Principal(user_id=None, email="", name="", actor="system")
        request.state.principal = principal
        return principal
    token = _bearer(request.headers.get("Authorization", ""))
    if token:
        principal = _from_session(token)
        if principal is None:
            principal = _from_api_token(token)
        if principal is not None:
            request.state.principal = principal
            return principal
    raise HTTPException(status_code=401, detail="未授权")


def _from_api_token(provided: str) -> Principal | None:
    expected = (API_KEY or "").strip()
    if not expected:
        return None
    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        return None
    return Principal(user_id=None, email="", name="system", actor="system")


def _parse_expires(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        expires = value
    elif isinstance(value, (int, float)):
        expires = datetime.fromtimestamp(float(value), tz=timezone.utc)
    else:
        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            expires = datetime.fromtimestamp(float(text), tz=timezone.utc)
        else:
            expires = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires


def _from_session(token: str) -> Principal | None:
    path = Path(AUTH_DB_PATH)
    if not path.exists():
        return None
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT s.token, s.expires_at, s.user_id, u.id, u.email, u.name
                FROM session s
                JOIN user u ON u.id = s.user_id
                WHERE s.token = ?
                """,
                (token,),
            ).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    expires = _parse_expires(row["expires_at"])
    if expires is None or expires <= datetime.now(timezone.utc):
        return None
    return Principal(user_id=row["id"], email=row["email"] or "", name=row["name"] or "", actor="user")
