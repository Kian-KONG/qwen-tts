from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .engine import engine
from .history import persist_job


@dataclass
class Job:
    id: str
    status: str
    progress: float = 0.0
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    stats: dict[str, Any] = field(default_factory=dict)
    text: str = ""
    ref_audio: str = ""
    ref_text: str = ""
    batch_size: int = 4
    language: str = "Auto"
    mode: str = "preset"
    instruct: str = ""
    speaker: str = ""
    voices: list[dict] = field(default_factory=list)


class JobRunner:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._pending: list[str] = []
        self._cv = threading.Condition()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="tts-worker")
        self._thread.start()

    def submit(self, **kwargs) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], status="queued", **kwargs)
        with self._cv:
            self.jobs[job.id] = job
            self._pending.append(job.id)
            self._cv.notify()
        return job

    def get(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def forget(self, job_id: str) -> None:
        with self._cv:
            if job_id in self._pending:
                self._pending.remove(job_id)
            self.jobs.pop(job_id, None)

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._pending:
                    self._cv.wait()
                job_id = self._pending.pop(0)
                job = self.jobs[job_id]
            job.status = "running"
            try:

                def on_progress(value: float, current=job) -> None:
                    current.progress = round(value, 3)

                job.stats = engine.synthesize(
                    job.text,
                    job.ref_audio,
                    job.ref_text,
                    batch_size=job.batch_size,
                    language=job.language,
                    job_id=job.id,
                    mode=job.mode,
                    instruct=job.instruct,
                    speaker=job.speaker,
                    voices=job.voices or None,
                    progress_cb=on_progress,
                )
                job.progress = 1.0
                job.status = "done"
                try:
                    persist_job(job)
                except Exception:
                    pass
            except Exception as exc:
                job.status = "error"
                job.error = str(exc)


runner = JobRunner()


def public_job(job: Job) -> dict:
    stats = dict(job.stats)
    raw_segments = stats.pop("segments", []) or []
    raw_tracks = stats.pop("tracks", []) or []
    segments = [
        {
            "index": item["index"],
            "text": item["text"],
            "voice": item.get("voice"),
            "filename": item.get("filename"),
            "duration_sec": item.get("duration_sec"),
            "url": f"/api/jobs/{job.id}/segments/{item['index']}/audio",
        }
        for item in raw_segments
    ]
    tracks = [
        {
            "index": item.get("index") or i + 1,
            "voice": item.get("voice"),
            "filename": item.get("filename"),
            "duration_sec": item.get("duration_sec"),
            "url": f"/api/jobs/{job.id}/tracks/{item.get('index') or i + 1}/audio",
        }
        for i, item in enumerate(raw_tracks)
    ]
    download = f"/api/jobs/{job.id}/audio" if job.status == "done" else None
    zip_url = f"/api/jobs/{job.id}/zip" if job.status == "done" and segments else None
    title = next((item["text"].strip()[:48] for item in segments if (item.get("text") or "").strip()), "")
    if not title:
        line = (job.text or "").strip().split("\n")[0]
        title = line.lstrip("0123456789.、)）:： ").strip()[:48]
    speakers = stats.get("speakers") or [
        str(item.get("name") or item.get("id") or "") for item in (job.voices or [])
    ]
    speakers = [name for name in speakers if name]
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "created_at": job.created_at,
        "title": title,
        "download_url": download,
        "zip_url": zip_url,
        "local_dir": f"data/output/{job.id}" if job.status == "done" else None,
        **stats,
        "segments": segments,
        "tracks": tracks,
        "speakers": speakers or None,
    }
