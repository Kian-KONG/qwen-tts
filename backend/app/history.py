from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audio_util import is_packable_clip, probe_duration
from .config import OUTPUT_DIR

RECORD_NAME = "job.json"


def _clip_wavs(folder: Path) -> list[Path]:
    return [path for path in sorted(folder.glob("*.wav")) if is_packable_clip(path.name)]


def _strip_urls(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_urls(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip_urls(item) for key, item in value.items() if key != "url"}
    return value


def job_dir(job_id: str) -> Path:
    return OUTPUT_DIR / job_id


def persist_job(job: Any) -> None:
    if job.status != "done":
        return
    folder = job_dir(job.id)
    folder.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "created_at": job.created_at,
        "text": job.text,
        "language": job.language,
        "mode": job.mode,
        "speaker": job.speaker or None,
        "voices": getattr(job, "voices", None) or [],
        "instruct": job.instruct,
        "batch_size": job.batch_size,
        **_strip_urls(dict(job.stats or {})),
    }
    (folder / RECORD_NAME).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _infer(folder: Path) -> dict:
    full = folder / "full.wav"
    segments = []
    for index, path in enumerate(_clip_wavs(folder), start=1):
        duration = None
        try:
            duration = round(probe_duration(path), 2)
        except Exception:
            pass
        segments.append(
            {
                "index": index,
                "text": "",
                "filename": path.name,
                "duration_sec": duration,
                "path": str(path),
            }
        )
    audio_sec = None
    created_at = datetime.fromtimestamp(full.stat().st_mtime, tz=timezone.utc).isoformat()
    try:
        audio_sec = round(probe_duration(full), 2)
    except Exception:
        pass
    return {
        "id": folder.name,
        "status": "done",
        "progress": 1.0,
        "error": None,
        "created_at": created_at,
        "text": "",
        "language": "",
        "mode": "",
        "speaker": None,
        "batch_size": None,
        "chunks": len(segments) or 1,
        "audio_sec": audio_sec,
        "output_path": str(full),
        "segments": segments,
    }


def load_record(job_id: str) -> dict:
    folder = job_dir(job_id)
    record_path = folder / RECORD_NAME
    if record_path.exists():
        return json.loads(record_path.read_text(encoding="utf-8"))
    if (folder / "full.wav").exists():
        return _infer(folder)
    raise KeyError(job_id)


def public_from_record(record: dict) -> dict:
    from .job_public import public_from_record as serialize_record

    job_id = str(record["id"])
    folder = job_dir(job_id)
    full = folder / "full.wav"
    inferred = None
    if not record.get("segments") and full.exists():
        inferred = _infer(folder).get("segments")
    return serialize_record(record, full_exists=full.exists(), inferred_segments=inferred)


def list_disk_jobs() -> list[dict]:
    if not OUTPUT_DIR.exists():
        return []
    items = []
    for folder in OUTPUT_DIR.iterdir():
        if not folder.is_dir() or not (folder / "full.wav").exists():
            continue
        try:
            items.append(public_from_record(load_record(folder.name)))
        except Exception:
            continue
    items.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return items


def delete_record(job_id: str) -> None:
    folder = job_dir(job_id)
    if folder.exists():
        shutil.rmtree(folder)
