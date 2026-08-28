from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .chunking import count_script_items
from .config import LANGUAGE, SCRIPTS_DIR

INDEX_PATH = SCRIPTS_DIR / "index.json"
_UNSAFE = re.compile(r"[^a-zA-Z0-9]+")
_ITEM_MARK = re.compile(r"^\s*(?:\d{1,3}[\.\)、:：]|\(\d{1,3}\)|\（\d{1,3}\）)\s*")


def _slug(name: str) -> str:
    slug = _UNSAFE.sub("-", name.strip()).strip("-").lower()
    return slug or uuid.uuid4().hex[:8]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_index() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def save_index(items: list[dict]) -> None:
    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def _md_path(script_id: str) -> Path:
    return SCRIPTS_DIR / f"{script_id}.md"


def _preview(markdown: str) -> str:
    for line in (markdown or "").splitlines():
        value = _ITEM_MARK.sub("", line).strip()
        if value:
            return value[:48]
    return ""


def _public(item: dict, markdown: str, *, include_text: bool) -> dict:
    language = item.get("language") or LANGUAGE
    public = {
        "id": item["id"],
        "name": item["name"],
        "language": language,
        "chunks": count_script_items(markdown),
        "preview": _preview(markdown),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at") or item.get("created_at"),
    }
    if include_text:
        public["markdown"] = markdown
    return public


def list_scripts() -> list[dict]:
    scripts = []
    for item in load_index():
        path = _md_path(item["id"])
        if not path.exists():
            continue
        markdown = path.read_text(encoding="utf-8")
        scripts.append(_public(item, markdown, include_text=True))
    scripts.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return scripts


def get_script(script_id: str) -> dict:
    for item in load_index():
        if item["id"] != script_id:
            continue
        path = _md_path(script_id)
        if not path.exists():
            raise FileNotFoundError(f"Script file missing for {script_id}")
        return _public(item, path.read_text(encoding="utf-8"), include_text=True)
    raise KeyError(script_id)


def create_script(name: str, markdown: str, language: str = LANGUAGE) -> dict:
    cleaned = name.strip()
    text = (markdown or "").strip()
    if not cleaned:
        raise ValueError("请填写列表名称")
    if not text:
        raise ValueError("文稿是空的")
    script_id = _slug(cleaned)
    existing = {item["id"] for item in load_index()}
    if script_id in existing:
        script_id = f"{script_id}-{uuid.uuid4().hex[:4]}"
    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    _md_path(script_id).write_text(text + "\n", encoding="utf-8")
    now = _now()
    item = {
        "id": script_id,
        "name": cleaned,
        "language": language,
        "created_at": now,
        "updated_at": now,
    }
    items = load_index()
    items.append(item)
    save_index(items)
    return _public(item, text, include_text=True)


def update_script(
    script_id: str,
    *,
    name: str | None = None,
    markdown: str | None = None,
    language: str | None = None,
) -> dict:
    items = load_index()
    found = None
    for item in items:
        if item["id"] == script_id:
            found = item
            break
    if found is None:
        raise KeyError(script_id)
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("请填写列表名称")
        found["name"] = cleaned
    if language is not None:
        found["language"] = language
    path = _md_path(script_id)
    if markdown is not None:
        text = markdown.strip()
        if not text:
            raise ValueError("文稿是空的")
        path.write_text(text + "\n", encoding="utf-8")
    elif not path.exists():
        raise FileNotFoundError(f"Script file missing for {script_id}")
    found["updated_at"] = _now()
    save_index(items)
    return _public(found, path.read_text(encoding="utf-8"), include_text=True)


def delete_script(script_id: str) -> None:
    items = [item for item in load_index() if item["id"] != script_id]
    save_index(items)
    _md_path(script_id).unlink(missing_ok=True)
