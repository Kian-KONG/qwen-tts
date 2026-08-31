from __future__ import annotations

import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import audio_util, chunking
from .config import ASR_MODEL_DIR, ASR_MODEL_ID, LANGUAGE, LANGUAGE_BY_ID
from .engine import JobCancelled, engine
from .paths import is_local_model_dir

ASR_CHUNK_SEC = 180.0
ASR_MAX_TOKENS = 16384


class ASREngine:
    def __init__(self) -> None:
        self.model = None
        self.loaded = False
        self.model_path = str(ASR_MODEL_DIR if is_local_model_dir(ASR_MODEL_DIR) else ASR_MODEL_ID)
        self.lock = threading.Lock()

    def ready(self) -> bool:
        return is_local_model_dir(ASR_MODEL_DIR)

    def load(self) -> None:
        with engine.lock:
            with self.lock:
                engine.unload_unlocked()
                self._load_unlocked()

    def unload_unlocked(self) -> None:
        if self.model is None and not self.loaded:
            return
        self.model = None
        self.loaded = False
        import gc
        import mlx.core as mx

        gc.collect()
        mx.clear_cache()

    def _load_unlocked(self) -> None:
        if self.loaded and self.model is not None:
            return
        if not is_local_model_dir(ASR_MODEL_DIR):
            raise FileNotFoundError("Qwen3-ASR model is missing. Run: make download-asr")
        from mlx_audio.stt.utils import load_model

        engine.unload_unlocked()
        self.unload_unlocked()
        self.model_path = str(ASR_MODEL_DIR)
        self.model = load_model(self.model_path)
        self.loaded = True

    def transcribe(
        self,
        audio_path: str,
        *,
        language: str = LANGUAGE,
        context: str = "",
        progress_cb=None,
        cancel_check=None,
    ) -> dict:
        if not audio_path or not Path(audio_path).exists():
            raise FileNotFoundError("Audio file is required for transcription")

        def mark(value: float, stage: str, extra: dict | None = None) -> None:
            if not progress_cb:
                return
            try:
                progress_cb(value, stage, extra)
            except TypeError:
                progress_cb(value, stage)

        mark(0.08, "converting")
        wav = audio_util.ensure_pcm_wav(audio_path)
        lang = LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])
        lang_hint = None if lang["lang_code"] in {"auto", ""} else lang["lang_code"]
        started = time.perf_counter()
        mark(0.2, "loading")
        parts: list[Path] = [wav]
        chunk_dir: Path | None = None
        try:
            duration = audio_util.probe_duration(wav)
        except Exception:
            duration = None
        with engine.lock:
            with self.lock:
                engine.unload_unlocked()
                mark(0.35, "loading")
                self._load_unlocked()
                mark(0.4, "transcribing")
                kwargs: dict = {"verbose": False, "max_tokens": ASR_MAX_TOKENS}
                if lang_hint:
                    kwargs["language"] = lang_hint
                if context.strip():
                    kwargs["system_prompt"] = context.strip()
                try:
                    parts, chunk_dir = _split_wav(Path(wav), ASR_CHUNK_SEC)
                except Exception:
                    parts, chunk_dir = [Path(wav)], None
                texts: list[str] = []
                detected = lang_hint
                total = max(len(parts), 1)
                try:
                    for index, part in enumerate(parts):
                        if cancel_check:
                            cancel_check()
                        mark(
                            0.4 + 0.55 * (index / total),
                            "transcribing",
                            {
                                "text": "\n".join(item for item in texts if item).strip(),
                                "chunk": index + 1,
                                "chunks": total,
                            },
                        )
                        result = self.model.generate(str(part), **kwargs)
                        piece = str(getattr(result, "text", "") or "").strip()
                        if piece:
                            texts.append(piece)
                        lang_value = getattr(result, "language", None)
                        if isinstance(lang_value, list):
                            lang_value = next((item for item in lang_value if item), None)
                        if lang_value:
                            detected = str(lang_value)
                        mark(
                            0.4 + 0.55 * ((index + 1) / total),
                            "transcribing",
                            {
                                "text": "\n".join(item for item in texts if item).strip(),
                                "chunk": index + 1,
                                "chunks": total,
                            },
                        )
                finally:
                    if chunk_dir and chunk_dir.exists():
                        shutil.rmtree(chunk_dir, ignore_errors=True)
        elapsed = time.perf_counter() - started
        text = "\n".join(item for item in texts if item).strip()
        if not text:
            raise ValueError("Transcription is empty")
        detected = str(detected or lang_hint or "Auto")
        segments = chunking.preview_segments(text, language)
        payload = {
            "text": text,
            "language": detected,
            "duration_sec": round(duration, 2) if duration is not None else None,
            "elapsed_sec": round(elapsed, 2),
            "model_id": ASR_MODEL_ID,
            "segments": segments,
            "chunks": len(parts),
        }
        mark(1.0, "done", payload)
        return payload


def _split_wav(path: Path, chunk_sec: float) -> tuple[list[Path], Path | None]:
    duration = audio_util.probe_duration(path)
    if not duration or duration <= chunk_sec + 5:
        return [path], None
    ffmpeg = audio_util.ffmpeg_bin()
    if not ffmpeg:
        return [path], None
    out_dir = path.parent / f"{path.stem}_chunks"
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(path),
            "-f",
            "segment",
            "-segment_time",
            str(int(chunk_sec)),
            "-reset_timestamps",
            "1",
            "-c",
            "copy",
            str(out_dir / "part_%03d.wav"),
        ],
        check=True,
        capture_output=True,
    )
    parts = sorted(out_dir.glob("part_*.wav"))
    return (parts or [path], out_dir if parts else None)


asr_engine = ASREngine()


@dataclass
class AsrJob:
    id: str
    status: str
    progress: float = 0.0
    stage: str = "queued"
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    audio_path: str = ""
    language: str = "Auto"
    context: str = ""
    result: dict[str, Any] = field(default_factory=dict)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False, compare=False)


class AsrJobRunner:
    def __init__(self) -> None:
        self.jobs: dict[str, AsrJob] = {}
        self._pending: list[str] = []
        self._cv = threading.Condition()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="asr-worker")
        self._thread.start()

    def submit(self, **kwargs) -> AsrJob:
        from .live import live_session

        with live_session.lock:
            if live_session.active:
                raise RuntimeError("实时翻译进行中，请先停止")
            job = AsrJob(id=uuid.uuid4().hex[:12], status="queued", **kwargs)
            with self._cv:
                self.jobs[job.id] = job
                self._pending.append(job.id)
                self._cv.notify()
            return job

    def busy(self) -> bool:
        return any(item.status in {"queued", "running", "cancelling"} for item in self.jobs.values())

    def get(self, job_id: str) -> AsrJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def cancel(self, job_id: str) -> AsrJob:
        job = self.get(job_id)
        if job.status in {"done", "error", "cancelled"}:
            raise ValueError("任务已经结束")
        job.cancel_event.set()
        with self._cv:
            if job_id in self._pending:
                self._pending.remove(job_id)
                job.status = "cancelled"
                job.stage = "cancelled"
                job.error = "已终止"
            elif job.status == "running":
                job.status = "cancelling"
                job.stage = "cancelling"
        return job

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._pending:
                    self._cv.wait()
                job_id = self._pending.pop(0)
                job = self.jobs[job_id]
            job.status = "running"
            job.stage = "converting"
            audio_path = Path(job.audio_path)
            try:

                def on_progress(value: float, stage: str, extra=None, current=job) -> None:
                    current.progress = round(value, 3)
                    current.stage = stage
                    if extra:
                        current.result = {**current.result, **extra}

                def cancel_check(current=job) -> None:
                    if current.cancel_event.is_set():
                        raise JobCancelled("已终止")

                if job.cancel_event.is_set():
                    raise JobCancelled("已终止")
                job.result = asr_engine.transcribe(
                    job.audio_path,
                    language=job.language,
                    context=job.context,
                    progress_cb=on_progress,
                    cancel_check=cancel_check,
                )
                if job.cancel_event.is_set():
                    raise JobCancelled("已终止")
                job.progress = 1.0
                job.stage = "done"
                job.status = "done"
            except JobCancelled:
                job.status = "cancelled"
                job.stage = "cancelled"
                job.error = "已终止"
            except Exception as exc:
                job.status = "error"
                job.stage = "error"
                job.error = str(exc)
            finally:
                audio_path.unlink(missing_ok=True)


def public_asr_job(job: AsrJob) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "error": job.error,
        "created_at": job.created_at,
        **(job.result or {}),
    }


asr_runner = AsrJobRunner()

