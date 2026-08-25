from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audio_util import probe_duration
from .config import OUTPUT_DIR

RECORD_NAME = "job.json"


def _clip_wavs(folder: Path) -> list[Path]:
    clips = []
    for path in sorted(folder.glob("*.wav")):
        name = path.name
        stem = name.lower()
        if (
            name.startswith(".")
            or ".browser." in name
            or name == "full.wav"
            or name.startswith("完整轨")
            or stem.startswith("full.")
        ):
            continue
        clips.append(path)
    return clips


def job_dir(job_id: str) -> Path:
    return OUTPUT_DIR / job_id


def _title(text: str, segments: list[dict]) -> str:
    for item in segments:
        value = str(item.get("text") or "").strip()
        if value:
            return value[:48]
    line = (text or "").strip().split("\n")[0]
    line = line.lstrip("0123456789.、)）:： ").strip()
    return line[:48]


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
        **(job.stats or {}),
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
    job_id = str(record["id"])
    folder = job_dir(job_id)
    full = folder / "full.wav"
    raw_segments = list(record.get("segments") or [])
    segments = []
    for item in raw_segments:
        try:
            index = int(item["index"])
        except (KeyError, TypeError, ValueError):
            continue
        segments.append(
            {
                "index": index,
                "text": item.get("text") or "",
                "voice": item.get("voice"),
                "filename": item.get("filename"),
                "duration_sec": item.get("duration_sec"),
                "url": f"/api/jobs/{job_id}/segments/{index}/audio",
            }
        )
    if not segments:
        inferred = _infer(folder) if full.exists() else {"segments": []}
        for item in inferred.get("segments") or []:
            segments.append(
                {
                    "index": item["index"],
                    "text": "",
                    "duration_sec": item.get("duration_sec"),
                    "url": f"/api/jobs/{job_id}/segments/{item['index']}/audio",
                }
            )
    done = full.exists()
    status = record.get("status") or ("done" if done else "error")
    return {
        "id": job_id,
        "status": status,
        "progress": 1.0 if done else record.get("progress") or 0,
        "error": record.get("error"),
        "created_at": record.get("created_at"),
        "title": _title(str(record.get("text") or ""), segments),
        "download_url": f"/api/jobs/{job_id}/audio" if done else None,
        "zip_url": f"/api/jobs/{job_id}/zip" if done else None,
        "segments": segments,
        "tracks": [
            {
                "index": item.get("index") or i + 1,
                "voice": item.get("voice"),
                "filename": item.get("filename"),
                "duration_sec": item.get("duration_sec"),
                "url": f"/api/jobs/{job_id}/tracks/{item.get('index') or i + 1}/audio",
            }
            for i, item in enumerate(record.get("tracks") or [])
        ],
        "speakers": record.get("speakers"),
        "chunks": record.get("chunks") or len(segments) or 1,
        "language": record.get("language") or None,
        "mode": record.get("mode") or None,
        "speaker": record.get("speaker"),
        "batch_size": record.get("batch_size"),
        "elapsed_sec": record.get("elapsed_sec"),
        "audio_sec": record.get("audio_sec"),
        "rtf": record.get("rtf"),
        "text": record.get("text") or "",
        "local_dir": f"data/output/{job_id}",
    }


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
