from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

import numpy as np

from . import audio_util, chunking
from .config import (
    DEFAULT_KOKORO_VOICE,
    GAP_MS,
    KOKORO_MODEL_DIR,
    KOKORO_MODEL_ID,
    KOKORO_VOICE_BY_ID,
    OUTPUT_DIR,
    PREVIEW_DIR,
)
from .paths import is_local_model_dir


def kokoro_lang_code(voice_id: str) -> str:
    return "b" if voice_id.startswith(("bf_", "bm_")) else "a"


def kokoro_voice_path(voice_id: str) -> Path:
    return KOKORO_MODEL_DIR / "voices" / f"{voice_id}.safetensors"


def is_kokoro_ready() -> bool:
    return is_local_model_dir(KOKORO_MODEL_DIR) and kokoro_voice_path(DEFAULT_KOKORO_VOICE).exists()


class KokoroEngine:
    def __init__(self) -> None:
        self.model = None
        self.sample_rate = 24000
        self.lock = threading.Lock()
        self.loaded = False
        self.model_path = str(KOKORO_MODEL_DIR if is_kokoro_ready() else KOKORO_MODEL_ID)

    def ready(self) -> bool:
        return is_kokoro_ready()

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
        if not is_kokoro_ready():
            raise FileNotFoundError("Kokoro model is missing. Run: make download-kokoro")
        from mlx_audio.tts.utils import load_model
        from .asr import asr_engine
        from .engine import engine
        from .translate import instruct_engine

        engine.unload_unlocked()
        asr_engine.unload_unlocked()
        instruct_engine.unload_unlocked()
        self.unload_unlocked()
        self.model_path = str(KOKORO_MODEL_DIR)
        self.model = load_model(self.model_path)
        self.model.repo_id = self.model_path
        self.sample_rate = int(getattr(self.model, "sample_rate", 24000))
        self.loaded = True

    def load(self) -> None:
        from .engine import engine

        with engine.lock:
            with self.lock:
                self._load_unlocked()

    def preview_voice(self, voice_id: str) -> Path:
        voice_id = voice_id.strip()
        if voice_id not in KOKORO_VOICE_BY_ID:
            raise KeyError(voice_id)
        dest = PREVIEW_DIR / f"kokoro-{voice_id}.wav"
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        from .engine import engine

        with engine.lock:
            with self.lock:
                self._load_unlocked()
                audio, rate = self._generate_one("Hello, this is a preview of my voice.", voice_id)
                audio_util.write_wav(dest, audio_util.to_float32(audio), rate)
        return dest

    def _generate_one(self, text: str, voice_id: str) -> tuple[np.ndarray, int]:
        pack = kokoro_voice_path(voice_id)
        if not pack.exists():
            raise FileNotFoundError(f"Kokoro voice pack missing: {voice_id}")
        parts: list[np.ndarray] = []
        rate = self.sample_rate
        for item in self.model.generate(
            text=text,
            voice=str(pack),
            lang_code=kokoro_lang_code(voice_id),
            speed=1.0,
            split_pattern=r"\n+",
        ):
            wave = np.array(item.audio).reshape(-1)
            rate = int(getattr(item, "sample_rate", rate) or rate)
            if wave.size:
                parts.append(audio_util.to_float32(wave))
        if not parts:
            raise RuntimeError(f"No audio generated for {voice_id}")
        return (np.concatenate(parts) if len(parts) > 1 else parts[0], rate)

    def synthesize(
        self,
        text: str,
        *,
        batch_size: int = 4,
        language: str = "English",
        job_id: str | None = None,
        voices: list[dict] | None = None,
        script_name: str = "",
        created_at: str | None = None,
        progress_cb=None,
        cancel_check=None,
    ) -> dict:
        chunks = chunking.split_script(text, language or "English")
        if not chunks:
            raise ValueError("Script is empty after splitting")
        voice_list = [item for item in (voices or []) if item.get("id")]
        if not voice_list:
            voice_list = [
                {
                    "id": DEFAULT_KOKORO_VOICE,
                    "name": KOKORO_VOICE_BY_ID[DEFAULT_KOKORO_VOICE]["label"],
                    "kind": "kokoro",
                }
            ]
        for item in voice_list:
            sid = str(item.get("id") or "")
            if sid not in KOKORO_VOICE_BY_ID:
                raise ValueError(f"Unknown Kokoro voice: {sid}")
            item["kind"] = "kokoro"
            item["name"] = item.get("name") or KOKORO_VOICE_BY_ID[sid]["label"]
        started = time.perf_counter()
        native_sr = self.sample_rate
        stem = job_id or time.strftime("%Y%m%d-%H%M%S")
        segment_dir = OUTPUT_DIR / stem
        segment_dir.mkdir(parents=True, exist_ok=True)
        used_names: set[str] = set()
        segments: list[dict] = []
        tracks: list[dict] = []
        clip_index = 0
        n_voices = max(1, len(voice_list))
        from .engine import engine

        with engine.lock:
            with self.lock:
                self._load_unlocked()
                for voice_offset, voice in enumerate(voice_list):
                    if cancel_check:
                        cancel_check()
                    sid = str(voice.get("id") or DEFAULT_KOKORO_VOICE)
                    wavs: list[np.ndarray] = []
                    for index, chunk in enumerate(chunks):
                        if cancel_check:
                            cancel_check()
                        spoken = audio_util.normalize_tts_text(chunk)
                        audio, rate = self._generate_one(spoken, sid)
                        native_sr = rate
                        wavs.append(audio_util.to_float32(audio))
                        if progress_cb:
                            local = (index + 1) / max(len(chunks), 1)
                            progress_cb(min(1.0, (voice_offset + local) / n_voices))
                    voice_name = str(voice.get("name") or sid)
                    clip_paths: list[Path] = []
                    label = (script_name or "").strip() or "文稿"
                    for chunk, wav in zip(chunks, wavs):
                        clip_index += 1
                        filename = audio_util.unique_wav_name(segment_dir, chunk, voice_name, used_names)
                        raw_path = segment_dir / f".seg_{clip_index:03d}.raw.wav"
                        out_seg = segment_dir / filename
                        audio_util.write_wav(raw_path, wav, native_sr)
                        audio_util.resample_for_video(raw_path, out_seg)
                        raw_path.unlink(missing_ok=True)
                        duration = float(wav.size) / float(native_sr) if native_sr else 0.0
                        clip_paths.append(out_seg)
                        segments.append(
                            {
                                "index": clip_index,
                                "text": chunk,
                                "voice": voice_name,
                                "voice_id": sid,
                                "filename": filename,
                                "duration_sec": round(duration, 2),
                                "path": str(out_seg),
                            }
                        )
                    if clip_paths:
                        track_name = audio_util.unique_file_name(
                            segment_dir,
                            audio_util.job_track_stem(label, voice_name, created_at),
                            used_names,
                        )
                        out_track = segment_dir / track_name
                        audio_util.concat_wav_files(clip_paths, out_track, gap_ms=GAP_MS)
                        tracks.append(
                            {
                                "index": len(tracks) + 1,
                                "voice": voice_name,
                                "voice_id": sid,
                                "filename": track_name,
                                "duration_sec": round(audio_util.probe_duration(out_track), 2),
                                "path": str(out_track),
                            }
                        )

        elapsed = time.perf_counter() - started
        first = Path(tracks[0]["path"]) if tracks else Path(segments[0]["path"]) if segments else segment_dir / "full.wav"
        full_alias = segment_dir / "full.wav"
        if first.exists() and full_alias.resolve() != first.resolve():
            shutil.copy2(first, full_alias)
        duration = max((float(item.get("duration_sec") or 0) for item in tracks), default=0.0)
        stats = {
            "chunks": len(chunks),
            "language": language or "English",
            "mode": "kokoro",
            "speaker": str(voice_list[0].get("id") or ""),
            "speakers": [str(item.get("name") or item.get("id")) for item in voice_list],
            "batch_size": max(1, batch_size),
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(full_alias if full_alias.exists() else first),
            "tracks": tracks,
            "segments": segments,
        }
        return stats


kokoro_engine = KokoroEngine()
