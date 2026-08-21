from __future__ import annotations

import threading
import time
from pathlib import Path

import numpy as np

from . import audio_util, chunking
from .config import BATCH_SIZE, GAP_MS, LANGUAGE, MAX_CHUNK_CHARS, MODEL_DIR, MODEL_ID, OUTPUT_DIR


class TTSEngine:
    def __init__(self) -> None:
        self.model = None
        self.sample_rate = 24000
        self.lock = threading.Lock()
        self.loaded = False
        self.model_path = str(MODEL_DIR if _looks_like_model(MODEL_DIR) else MODEL_ID)
        self.last_stats: dict = {}

    def load(self) -> None:
        from mlx_audio.tts.utils import load_model

        with self.lock:
            if self.loaded:
                return
            self.model = load_model(self.model_path)
            self.sample_rate = int(getattr(self.model, "sample_rate", 24000))
            self.loaded = True

    def synthesize(
        self,
        text: str,
        ref_audio: str,
        ref_text: str,
        *,
        batch_size: int = BATCH_SIZE,
        language: str = LANGUAGE,
        job_id: str | None = None,
        progress_cb=None,
    ) -> dict:
        if not self.loaded:
            self.load()
        chunks = chunking.split_script(text, MAX_CHUNK_CHARS)
        if not chunks:
            raise ValueError("Script is empty after splitting")
        if not ref_audio or not Path(ref_audio).exists():
            raise FileNotFoundError("Reference audio is required for Qwen3-TTS Base cloning")
        if not (ref_text or "").strip():
            raise ValueError("Reference transcript is required for ICL voice cloning")

        batch_size = max(1, min(batch_size or BATCH_SIZE, 8))
        wavs: list[np.ndarray] = []
        started = time.perf_counter()
        native_sr = self.sample_rate

        with self.lock:
            for offset in range(0, len(chunks), batch_size):
                batch = chunks[offset : offset + batch_size]
                collected = self._generate_batch(batch, ref_audio, ref_text.strip(), language)
                for index in range(len(batch)):
                    if index not in collected:
                        raise RuntimeError(f"Missing audio for chunk {offset + index}")
                    audio, rate = collected[index]
                    native_sr = rate
                    wavs.append(audio_util.to_float32(audio))
                if progress_cb:
                    progress_cb(min(1.0, (offset + len(batch)) / len(chunks)))

        audio = audio_util.concat_with_gap(wavs, native_sr, GAP_MS)
        elapsed = time.perf_counter() - started
        duration = float(audio.size) / float(native_sr) if native_sr else 0.0
        stem = job_id or time.strftime("%Y%m%d-%H%M%S")
        raw_path = OUTPUT_DIR / f"{stem}.raw.wav"
        out_path = OUTPUT_DIR / f"{stem}.wav"
        audio_util.write_wav(raw_path, audio, native_sr)
        audio_util.resample_for_video(raw_path, out_path)
        raw_path.unlink(missing_ok=True)

        stats = {
            "chunks": len(chunks),
            "batch_size": batch_size,
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(out_path),
        }
        self.last_stats = stats
        return stats

    def _generate_batch(
        self,
        batch: list[str],
        ref_audio: str,
        ref_text: str,
        language: str,
    ) -> dict[int, tuple[np.ndarray, int]]:
        kwargs = {
            "texts": batch,
            "ref_audio": ref_audio,
            "ref_text": ref_text,
            "lang_code": language,
            "stream": False,
            "verbose": False,
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
        except TypeError:
            collected: dict[int, tuple[np.ndarray, int]] = {}
            for index, text in enumerate(batch):
                item = list(
                    self.model.generate(
                        text=text,
                        ref_audio=ref_audio,
                        ref_text=ref_text,
                        lang_code=language,
                        stream=False,
                        verbose=False,
                    )
                )[0]
                collected[index] = (
                    np.array(item.audio),
                    int(getattr(item, "sample_rate", self.sample_rate)),
                )
            return collected

        collected = {}
        for result in results:
            collected[int(result.sequence_idx)] = (
                np.array(result.audio),
                int(getattr(result, "sample_rate", self.sample_rate)),
            )
        return collected


def _looks_like_model(path: Path) -> bool:
    return (path / "config.json").exists() and any(path.glob("*.safetensors"))


engine = TTSEngine()
