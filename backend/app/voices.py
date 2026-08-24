from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .audio_util import ensure_pcm_wav, probe_duration
from .config import VOICES_DIR

INDEX_PATH = VOICES_DIR / "index.json"


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip()).strip("-").lower()
    return slug or uuid.uuid4().hex[:8]


def load_index() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def save_index(items: list[dict]) -> None:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def list_voices() -> list[dict]:
    voices = []
    for item in load_index():
        wav = VOICES_DIR / f"{item['id']}.wav"
        if wav.exists():
            try:
                item = {**item, "duration_sec": round(probe_duration(wav), 2)}
            except Exception:
                item = {**item, "duration_sec": None}
        voices.append(item)
    return voices


def get_voice(voice_id: str) -> dict:
    for item in load_index():
        if item["id"] == voice_id:
            wav = VOICES_DIR / f"{voice_id}.wav"
            txt = VOICES_DIR / f"{voice_id}.txt"
            if not wav.exists() or not txt.exists():
                raise FileNotFoundError(f"Voice files missing for {voice_id}")
            return {
                **item,
                "ref_audio": str(wav),
                "ref_text": txt.read_text(encoding="utf-8").strip() or item.get("ref_text", ""),
            }
    raise KeyError(voice_id)


def create_voice(name: str, audio_path: Path, ref_text: str) -> dict:
    voice_id = _slug(name)
    existing = {item["id"] for item in load_index()}
    if voice_id in existing:
        voice_id = f"{voice_id}-{uuid.uuid4().hex[:4]}"

    dest_audio = VOICES_DIR / f"{voice_id}.wav"
    dest_text = VOICES_DIR / f"{voice_id}.txt"
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    ensure_pcm_wav(audio_path, dest_audio)
    dest_text.write_text(ref_text.strip() + "\n", encoding="utf-8")

    item = {
        "id": voice_id,
        "name": name.strip() or voice_id,
        "ref_text": ref_text.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    items = load_index()
    items.append(item)
    save_index(items)
    return {**item, "ref_audio": str(dest_audio)}


def delete_voice(voice_id: str) -> None:
    items = [item for item in load_index() if item["id"] != voice_id]
    save_index(items)
    for suffix in (".wav", ".txt"):
        path = VOICES_DIR / f"{voice_id}{suffix}"
        path.unlink(missing_ok=True)
