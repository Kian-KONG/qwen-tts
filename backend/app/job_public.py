from __future__ import annotations

from typing import Any


def job_title(text: str, segments: list[dict]) -> str:
    for item in segments:
        value = str(item.get("text") or "").strip()
        if value:
            return value[:48]
    line = (text or "").strip().split("\n")[0]
    return line.lstrip("0123456789.、)）:： ").strip()[:48]


def _public_segments(job_id: str, raw: list[dict]) -> list[dict]:
    segments = []
    for item in raw:
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
    return segments


def _public_tracks(job_id: str, raw: list[dict]) -> list[dict]:
    tracks = []
    for i, item in enumerate(raw):
        index = item.get("index") or i + 1
        tracks.append(
            {
                "index": index,
                "voice": item.get("voice"),
                "filename": item.get("filename"),
                "duration_sec": item.get("duration_sec"),
                "url": f"/api/jobs/{job_id}/tracks/{index}/audio",
            }
        )
    return tracks


def to_public_job(
    *,
    job_id: str,
    status: str,
    progress: float,
    error: Any,
    created_at: Any,
    text: str = "",
    voices: list[dict] | None = None,
    stats: dict | None = None,
    download: bool = False,
    zip_if_segments: bool = True,
    local_dir: str | None = None,
    include_text: bool = False,
    default_chunks: bool = False,
) -> dict:
    payload = dict(stats or {})
    raw_segments = list(payload.pop("segments", []) or [])
    raw_tracks = list(payload.pop("tracks", []) or [])
    segments = _public_segments(job_id, raw_segments)
    tracks = _public_tracks(job_id, raw_tracks)
    speakers = payload.get("speakers") or [
        str(item.get("name") or item.get("id") or "") for item in (voices or [])
    ]
    speakers = [name for name in speakers if name]
    zip_url = None
    if download and (segments if zip_if_segments else True):
        zip_url = f"/api/jobs/{job_id}/zip"
    public = {
        "id": job_id,
        "status": status,
        "progress": progress,
        "error": error,
        "created_at": created_at,
        "title": job_title(text, segments),
        "download_url": f"/api/jobs/{job_id}/audio" if download else None,
        "zip_url": zip_url,
        "local_dir": local_dir if local_dir is not None else (f"data/output/{job_id}" if download else None),
        **payload,
        "segments": segments,
        "tracks": tracks,
        "speakers": speakers or None,
    }
    if default_chunks:
        public["chunks"] = payload.get("chunks") or len(segments) or 1
    if include_text:
        public["text"] = text or payload.get("text") or ""
    return public


def public_from_job(job: Any) -> dict:
    done = job.status == "done"
    return to_public_job(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        error=job.error,
        created_at=job.created_at,
        text=job.text or "",
        voices=getattr(job, "voices", None) or [],
        stats=dict(job.stats or {}),
        download=done,
        zip_if_segments=True,
    )


def public_from_record(record: dict, *, full_exists: bool, inferred_segments: list[dict] | None = None) -> dict:
    job_id = str(record["id"])
    raw_segments = list(record.get("segments") or [])
    if not raw_segments and inferred_segments:
        raw_segments = inferred_segments
    done = full_exists
    status = record.get("status") or ("done" if done else "error")
    stats = {
        key: record.get(key)
        for key in (
            "chunks",
            "language",
            "mode",
            "speaker",
            "speakers",
            "batch_size",
            "elapsed_sec",
            "audio_sec",
            "rtf",
            "tracks",
        )
        if key in record
    }
    if raw_segments:
        stats["segments"] = raw_segments
    return to_public_job(
        job_id=job_id,
        status=status,
        progress=1.0 if done else record.get("progress") or 0,
        error=record.get("error"),
        created_at=record.get("created_at"),
        text=str(record.get("text") or ""),
        voices=list(record.get("voices") or []),
        stats=stats,
        download=done,
        zip_if_segments=False,
        local_dir=f"data/output/{job_id}",
        include_text=True,
        default_chunks=True,
    )
