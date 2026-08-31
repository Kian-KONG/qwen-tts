from __future__ import annotations

import shutil
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .config import OUTPUT_DIR
from .engine import JobCancelled, engine
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
                    stable=job.stable,
                    temperature=job.temperature,
                    script_name=job.script_name,
                    created_at=job.created_at,
                    progress_cb=on_progress,
                    cancel_check=cancel_check,
                )
                if job.cancel_event.is_set():
                    raise JobCancelled("已终止")
                if job.verify_asr:
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
