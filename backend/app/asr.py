from __future__ import annotations

import threading
import time
from pathlib import Path

from . import audio_util, chunking
from .config import ASR_MODEL_DIR, ASR_MODEL_ID, LANGUAGE, LANGUAGE_BY_ID
from .engine import engine


def _looks_like_model(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").exists() and any(path.glob("*.safetensors"))


class ASREngine:
    def __init__(self) -> None:
        self.model = None
        self.loaded = False
        self.model_path = str(ASR_MODEL_DIR if _looks_like_model(ASR_MODEL_DIR) else ASR_MODEL_ID)
        self.lock = threading.Lock()

    def ready(self) -> bool:
        return _looks_like_model(ASR_MODEL_DIR)

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
        if not _looks_like_model(ASR_MODEL_DIR):
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
    ) -> dict:
        if not audio_path or not Path(audio_path).exists():
            raise FileNotFoundError("Audio file is required for transcription")
        wav = audio_util.ensure_pcm_wav(audio_path)
        lang = LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])
        lang_hint = None if lang["lang_code"] in {"auto", ""} else lang["lang_code"]
        started = time.perf_counter()
        # Share the TTS lock so 16GB machines do not run both at once.
        with engine.lock:
            with self.lock:
                engine.unload_unlocked()
                self._load_unlocked()
                kwargs: dict = {"verbose": False}
                if lang_hint:
                    kwargs["language"] = lang_hint
                if context.strip():
                    kwargs["system_prompt"] = context.strip()
                result = self.model.generate(str(wav), **kwargs)
        elapsed = time.perf_counter() - started
        text = str(getattr(result, "text", "") or "").strip()
        if not text:
            raise ValueError("Transcription is empty")
        detected = getattr(result, "language", None)
        if isinstance(detected, list):
            detected = next((item for item in detected if item), None)
        detected = str(detected or lang_hint or "Auto")
        try:
            duration = audio_util.probe_duration(wav)
        except Exception:
            duration = None
        segments = chunking.preview_segments(text, language)
        return {
            "text": text,
            "language": detected,
            "duration_sec": round(duration, 2) if duration is not None else None,
            "elapsed_sec": round(elapsed, 2),
            "model_id": ASR_MODEL_ID,
            "segments": segments,
        }


asr_engine = ASREngine()
