from __future__ import annotations

import threading
import time
from pathlib import Path

import numpy as np

from . import audio_util, chunking
from .config import (
    BATCH_SIZE,
    CUSTOM_MODEL_DIR,
    DEFAULT_SPEAKER,
    DESIGN_MODEL_DIR,
    GAP_MS,
    LANGUAGE,
    LANGUAGE_BY_ID,
    MODEL_DIR,
    MODEL_ID,
    OUTPUT_DIR,
    SPEAKER_BY_ID,
)


def normalize_engine_mode(mode: str | None) -> str:
    value = (mode or "preset").strip().lower()
    if value in {"design", "voice_design", "describe", "description"}:
        return "design"
    if value in {"preset", "custom", "custom_voice"}:
        return "preset"
    return "clone"


class TTSEngine:
    def __init__(self) -> None:
        self.model = None
        self.sample_rate = 24000
        self.lock = threading.Lock()
        self.loaded = False
        self.mode = "preset"
        self.model_path = str(CUSTOM_MODEL_DIR if _looks_like_model(CUSTOM_MODEL_DIR) else MODEL_ID)
        self.last_stats: dict = {}

    def load(self, mode: str = "preset") -> None:
        with self.lock:
            self._load_unlocked(mode)

    def _load_unlocked(self, mode: str) -> None:
        mode = normalize_engine_mode(mode)
        if self.loaded and self.mode == mode and self.model is not None:
            return
        from mlx_audio.tts.utils import load_model
        import gc
        import mlx.core as mx

        self.model = None
        self.loaded = False
        gc.collect()
        mx.clear_cache()
        if mode == "design":
            if not _looks_like_model(DESIGN_MODEL_DIR):
                raise FileNotFoundError(
                    "VoiceDesign model is missing. Run: make download-design"
                )
            path = DESIGN_MODEL_DIR
        elif mode == "preset":
            if not _looks_like_model(CUSTOM_MODEL_DIR):
                raise FileNotFoundError(
                    "CustomVoice model is missing. Run: make download-custom"
                )
            path = CUSTOM_MODEL_DIR
        else:
            path = MODEL_DIR if _looks_like_model(MODEL_DIR) else MODEL_ID
        self.model_path = str(path)
        self.model = load_model(self.model_path)
        self.sample_rate = int(getattr(self.model, "sample_rate", 24000))
        self.mode = mode
        self.loaded = True

    def synthesize(
        self,
        text: str,
        ref_audio: str = "",
        ref_text: str = "",
        *,
        batch_size: int = BATCH_SIZE,
        language: str = LANGUAGE,
        job_id: str | None = None,
        mode: str = "preset",
        instruct: str = "",
        speaker: str = "",
        progress_cb=None,
    ) -> dict:
        mode = normalize_engine_mode(mode)
        lang = LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])
        lang_code = lang["lang_code"]
        chunks = chunking.split_script(text, language)
        if not chunks:
            raise ValueError("Script is empty after splitting")
        speaker_id = (speaker or DEFAULT_SPEAKER).strip()
        if mode == "design":
            if not instruct.strip():
                raise ValueError("Voice description is required")
        elif mode == "preset":
            if speaker_id not in SPEAKER_BY_ID:
                raise ValueError(f"Unknown speaker: {speaker_id}")
        else:
            if not ref_audio or not Path(ref_audio).exists():
                raise FileNotFoundError("Reference audio is required for voice cloning")
            if not (ref_text or "").strip():
                raise ValueError("Reference transcript is required for ICL voice cloning")

        batch_size = max(1, min(batch_size or BATCH_SIZE, 8))
        wavs: list[np.ndarray] = []
        started = time.perf_counter()
        native_sr = self.sample_rate
        style = instruct.strip()

        with self.lock:
            self._load_unlocked(mode)
            for offset in range(0, len(chunks), batch_size):
                batch = chunks[offset : offset + batch_size]
                if mode == "design":
                    collected = self._generate_design_batch(batch, style, lang_code)
                elif mode == "preset":
                    collected = self._generate_preset_batch(batch, speaker_id, lang_code, style)
                else:
                    collected = self._generate_batch(batch, ref_audio, ref_text.strip(), lang_code)
                for index in range(len(batch)):
                    if index not in collected:
                        raise RuntimeError(f"Missing audio for chunk {offset + index}")
                    audio, rate = collected[index]
                    native_sr = rate
                    wavs.append(audio_util.to_float32(audio))
                if progress_cb:
                    progress_cb(min(1.0, (offset + len(batch)) / len(chunks)))

        stem = job_id or time.strftime("%Y%m%d-%H%M%S")
        segment_dir = OUTPUT_DIR / stem
        segments = []
        for index, (chunk, wav) in enumerate(zip(chunks, wavs), start=1):
            raw_path = segment_dir / f"seg_{index:03d}.raw.wav"
            out_seg = segment_dir / f"seg_{index:03d}.wav"
            audio_util.write_wav(raw_path, wav, native_sr)
            audio_util.resample_for_video(raw_path, out_seg)
            raw_path.unlink(missing_ok=True)
            duration = float(wav.size) / float(native_sr) if native_sr else 0.0
            segments.append(
                {
                    "index": index,
                    "text": chunk,
                    "duration_sec": round(duration, 2),
                    "path": str(out_seg),
                }
            )

        audio = audio_util.concat_with_gap(wavs, native_sr, GAP_MS)
        elapsed = time.perf_counter() - started
        duration = float(audio.size) / float(native_sr) if native_sr else 0.0
        raw_path = segment_dir / "full.raw.wav"
        out_path = segment_dir / "full.wav"
        audio_util.write_wav(raw_path, audio, native_sr)
        audio_util.resample_for_video(raw_path, out_path)
        raw_path.unlink(missing_ok=True)

        stats = {
            "chunks": len(chunks),
            "language": language,
            "mode": mode,
            "speaker": speaker_id if mode == "preset" else None,
            "batch_size": batch_size,
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(out_path),
            "segments": segments,
        }
        self.last_stats = {key: value for key, value in stats.items() if key != "segments"}
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
            return self._generate_one_by_one(batch, language, ref_audio=ref_audio, ref_text=ref_text)
        return _collect(results, self.sample_rate)

    def _generate_design_batch(
        self,
        batch: list[str],
        instruct: str,
        language: str,
    ) -> dict[int, tuple[np.ndarray, int]]:
        kwargs = {
            "texts": batch,
            "instructs": [instruct] * len(batch),
            "lang_code": language,
            "stream": False,
            "verbose": False,
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
            return _collect(results, self.sample_rate)
        except Exception:
            return self._generate_one_by_one(batch, language, instruct=instruct)

    def _generate_preset_batch(
        self,
        batch: list[str],
        speaker: str,
        language: str,
        instruct: str,
    ) -> dict[int, tuple[np.ndarray, int]]:
        style = instruct or None
        kwargs = {
            "texts": batch,
            "voices": [speaker] * len(batch),
            "instructs": [style] * len(batch),
            "lang_code": language,
            "stream": False,
            "verbose": False,
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
            return _collect(results, self.sample_rate)
        except Exception:
            return self._generate_one_by_one(batch, language, voice=speaker, instruct=style)

    def _generate_one_by_one(
        self,
        batch: list[str],
        language: str,
        *,
        ref_audio: str | None = None,
        ref_text: str | None = None,
        instruct: str | None = None,
        voice: str | None = None,
    ) -> dict[int, tuple[np.ndarray, int]]:
        collected: dict[int, tuple[np.ndarray, int]] = {}
        for index, text in enumerate(batch):
            kwargs: dict = {
                "text": text,
                "lang_code": language,
                "stream": False,
                "verbose": False,
            }
            if instruct:
                kwargs["instruct"] = instruct
            if voice:
                kwargs["voice"] = voice
            if ref_audio:
                kwargs["ref_audio"] = ref_audio
                kwargs["ref_text"] = ref_text
            item = list(self.model.generate(**kwargs))[0]
            collected[index] = (
                np.array(item.audio),
                int(getattr(item, "sample_rate", self.sample_rate)),
            )
        return collected


def _collect(results, sample_rate: int) -> dict[int, tuple[np.ndarray, int]]:
    collected: dict[int, tuple[np.ndarray, int]] = {}
    for result in results:
        collected[int(result.sequence_idx)] = (
            np.array(result.audio),
            int(getattr(result, "sample_rate", sample_rate)),
        )
    return collected


def _looks_like_model(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").exists() and any(path.glob("*.safetensors"))


engine = TTSEngine()
