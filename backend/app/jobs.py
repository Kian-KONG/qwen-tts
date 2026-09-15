from __future__ import annotations

import shutil
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import OUTPUT_DIR
from .engine import JobCancelled, _voice_kind, engine
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
    stable: bool = True
    temperature: float = 0.3
    script_name: str = ""
    verify_asr: bool = False
    stage: str = ""
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False, compare=False)


def _is_clone_voice(item: dict, fallback: str = "preset") -> bool:
    return _voice_kind(item, fallback) == "clone"


def _merge_tts_stats(first: dict, second: dict) -> dict:
    segments = list(first.get("segments") or []) + list(second.get("segments") or [])
    tracks = list(first.get("tracks") or []) + list(second.get("tracks") or [])
    for index, segment in enumerate(segments, 1):
        segment["index"] = index
    for index, track in enumerate(tracks, 1):
        track["index"] = index
    elapsed = float(first.get("elapsed_sec") or 0) + float(second.get("elapsed_sec") or 0)
    duration = max((float(item.get("duration_sec") or 0) for item in tracks), default=0.0)
    speakers = list(first.get("speakers") or []) + list(second.get("speakers") or [])
    first_path = Path(str(tracks[0]["path"])) if tracks else None
    full_alias = first_path.parent / "full.wav" if first_path else None
    if first_path and first_path.exists() and full_alias and full_alias.resolve() != first_path.resolve():
        shutil.copy2(first_path, full_alias)
    stats = dict(first)
    stats.update(
        {
            "mode": "mixed",
            "speakers": speakers,
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "tracks": tracks,
            "segments": segments,
            "output_path": str(
                full_alias if full_alias and full_alias.exists() else first_path or first.get("output_path")
            ),
        }
    )
    return stats


def _qwen_mode(voices: list[dict], fallback: str) -> str:
    kinds = list(dict.fromkeys(_voice_kind(item, fallback) for item in voices))
    if not kinds:
        return fallback if fallback != "clone" else "preset"
    return kinds[0] if len(kinds) == 1 else "mixed"


def _run_job_tts(job: Job, on_progress, cancel_check) -> dict:
    if job.mode == "kokoro":
        from .kokoro import kokoro_engine

        return kokoro_engine.synthesize(
            job.text,
            batch_size=job.batch_size,
            language=job.language or "English",
            job_id=job.id,
            voices=job.voices or None,
            script_name=job.script_name,
            created_at=job.created_at,
            progress_cb=on_progress,
            cancel_check=cancel_check,
        )

    voices = list(job.voices or [])
    clone_voices = [item for item in voices if _is_clone_voice(item, job.mode)]
    qwen_voices = [item for item in voices if not _is_clone_voice(item, job.mode)]
    if not voices and job.mode == "clone":
        clone_voices = [
            {
                "id": "clone",
                "name": "克隆",
                "kind": "clone",
                "ref_audio": job.ref_audio,
                "ref_text": job.ref_text,
            }
        ]

    n = max(len(clone_voices) + len(qwen_voices), 1)

    def scale_progress(start: float, span: float):
        if not on_progress:
            return None
        return lambda value, s=start, p=span: on_progress(s + value * p)

    qwen_stats = None
    clone_stats = None
    if qwen_voices or (not clone_voices and job.mode != "clone"):
        qwen_stats = engine.synthesize(
            job.text,
            job.ref_audio,
            job.ref_text,
            batch_size=job.batch_size,
            language=job.language,
            job_id=job.id,
            mode=_qwen_mode(qwen_voices, job.mode),
            instruct=job.instruct,
            speaker=job.speaker,
            voices=qwen_voices or None,
            stable=job.stable,
            temperature=job.temperature,
            script_name=job.script_name,
            created_at=job.created_at,
            progress_cb=scale_progress(0.0, len(qwen_voices) / n if clone_voices else 1.0),
            cancel_check=cancel_check,
        )
    if clone_voices:
        from .longcat import longcat_engine

        start = (len(qwen_voices) / n) if qwen_voices else 0.0
        span = (len(clone_voices) / n) if qwen_voices else 1.0
        clone_stats = longcat_engine.synthesize(
            job.text,
            job.ref_audio,
            job.ref_text,
            batch_size=job.batch_size,
            language=job.language,
            job_id=job.id,
            voices=clone_voices,
            stable=job.stable,
            script_name=job.script_name,
            created_at=job.created_at,
            progress_cb=scale_progress(start, span),
            cancel_check=cancel_check,
        )
    if qwen_stats and clone_stats:
        return _merge_tts_stats(qwen_stats, clone_stats)
    return clone_stats or qwen_stats or {}


class JobRunner:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._pending: list[str] = []
        self._cv = threading.Condition()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="tts-worker")
        self._thread.start()

    def submit(self, **kwargs) -> Job:
        from .live import live_session

        with live_session.lock:
            if live_session.active:
                raise RuntimeError("实时翻译进行中，请先停止")
            job = Job(id=uuid.uuid4().hex[:12], status="queued", **kwargs)
            with self._cv:
                self.jobs[job.id] = job
                self._pending.append(job.id)
                self._cv.notify()
            return job

    def busy(self) -> bool:
        return any(item.status in {"queued", "running", "cancelling"} for item in self.jobs.values())

    def get(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status in {"done", "error", "cancelled"}:
            raise ValueError("任务已经结束")
        job.cancel_event.set()
        with self._cv:
            if job_id in self._pending:
                self._pending.remove(job_id)
                job.status = "cancelled"
                job.error = "已终止"
            elif job.status == "running":
                job.status = "cancelling"
        return job

    def forget(self, job_id: str) -> None:
        with self._cv:
            if job_id in self._pending:
                self._pending.remove(job_id)
            self.jobs.pop(job_id, None)

    def _drop_output(self, job_id: str) -> None:
        out = OUTPUT_DIR / job_id
        if out.exists():
            shutil.rmtree(out, ignore_errors=True)

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._pending:
                    self._cv.wait()
                job_id = self._pending.pop(0)
                job = self.jobs[job_id]
            if job.cancel_event.is_set():
                job.status = "cancelled"
                job.error = "已终止"
                continue
            job.status = "running"
            try:
                job.stage = "tts"
                job.stats["stage"] = "tts"
                tts_scale = 0.55 if job.verify_asr else 1.0

                def on_progress(value: float, current=job, scale=tts_scale) -> None:
                    current.progress = round(min(1.0, value * scale), 3)

                def cancel_check(current=job) -> None:
                    if current.cancel_event.is_set():
                        raise JobCancelled("已终止")

                def set_stage(name: str, current=job) -> None:
                    current.stage = name
                    current.stats["stage"] = name

                job.stats = _run_job_tts(job, on_progress, cancel_check)
                if job.cancel_event.is_set():
                    raise JobCancelled("已终止")
                if job.verify_asr and job.mode != "kokoro":
                    from .verify import run_verify_round

                    job.stage = "asr"
                    job.stats["stage"] = "asr"
                    job.progress = 0.55
                    job.stats = run_verify_round(
                        stats=job.stats,
                        voices=job.voices or [],
                        language=job.language,
                        stable=job.stable,
                        temperature=job.temperature,
                        script_name=job.script_name,
                        created_at=job.created_at,
                        progress_cb=lambda value, current=job: setattr(current, "progress", round(value, 3)),
                        stage_cb=set_stage,
                        cancel_check=cancel_check,
                    )
                job.progress = 1.0
                job.stage = "done"
                job.stats["stage"] = "done"
                job.status = "done"
                try:
                    persist_job(job)
                except Exception:
                    pass
            except JobCancelled:
                job.status = "cancelled"
                job.error = "已终止"
                self._drop_output(job.id)
            except Exception as exc:
                job.status = "error"
                job.error = str(exc)


runner = JobRunner()


def public_job(job: Job) -> dict:
    from .job_public import public_from_job

    return public_from_job(job)
