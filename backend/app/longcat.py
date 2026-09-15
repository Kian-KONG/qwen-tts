from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

import numpy as np

from . import audio_util, chunking
from .config import (
    BATCH_SIZE,
    GAP_MS,
    LANGUAGE,
    LONGCAT_MODEL_DIR,
    LONGCAT_MODEL_ID,
    OUTPUT_DIR,
    TTS_SEED,
)
from .paths import is_local_model_dir

LONGCAT_STEPS = 16
LONGCAT_CFG = 4.0
LONGCAT_GUIDANCE = "apg"


def is_longcat_ready() -> bool:
    return is_local_model_dir(LONGCAT_MODEL_DIR)


def require_longcat() -> None:
    if not is_longcat_ready():
        raise FileNotFoundError(
            "LongCat-AudioDiT 3.5B is missing. Run: make download-longcat"
        )


def _clone_voices(
    voices: list[dict] | None,
    ref_audio: str,
    ref_text: str,
) -> list[dict]:
    voice_list = [item for item in (voices or []) if item.get("id") or item.get("ref_audio")]
    if not voice_list:
        if not ref_audio or not Path(ref_audio).exists():
            raise FileNotFoundError("Reference audio is required for voice cloning")
        if not (ref_text or "").strip():
            raise ValueError("Reference transcript is required for voice cloning")
        voice_list = [
            {
                "id": "clone",
                "name": "克隆",
                "kind": "clone",
                "ref_audio": ref_audio,
                "ref_text": ref_text,
            }
        ]
    for item in voice_list:
        ref = item.get("ref_audio") or ref_audio
        transcript = item.get("ref_text") or ref_text
        if not ref or not Path(ref).exists():
            raise FileNotFoundError("Reference audio is required for voice cloning")
        if not (transcript or "").strip():
            raise ValueError("Reference transcript is required for voice cloning")
        item["kind"] = "clone"
        item["ref_audio"] = str(audio_util.ensure_pcm_wav(ref, sample_rate=24000))
        item["ref_text"] = str(transcript).strip()
        item["name"] = item.get("name") or item.get("id") or "克隆"
        item["id"] = str(item.get("id") or "clone")
    return voice_list


class LongCatEngine:
    def __init__(self) -> None:
        self.model = None
        self.sample_rate = 24000
        self.lock = threading.Lock()
        self.loaded = False
        self.model_path = str(
            LONGCAT_MODEL_DIR if is_longcat_ready() else LONGCAT_MODEL_ID
        )
        self.last_stats: dict = {}

    def ready(self) -> bool:
        return is_longcat_ready()

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
        require_longcat()
        from mlx_audio.tts.utils import load_model
        from .asr import asr_engine
        from .engine import engine
        from .kokoro import kokoro_engine
        from .translate import instruct_engine

        engine.unload_unlocked()
        with kokoro_engine.lock:
            kokoro_engine.unload_unlocked()
        asr_engine.unload_unlocked()
        instruct_engine.unload_unlocked()
        self.unload_unlocked()
        self.model_path = str(LONGCAT_MODEL_DIR)
        self.model = load_model(self.model_path)
        self.sample_rate = int(getattr(self.model, "sample_rate", 24000))
        self.loaded = True

    def load(self) -> None:
        from .engine import engine

        with engine.lock:
            with self.lock:
                self._load_unlocked()

    def _generate_one(
        self,
        text: str,
        ref_audio: str,
        ref_text: str,
        *,
        stable: bool,
        seed: int | None = None,
    ) -> tuple[np.ndarray, int]:
        kwargs: dict = {
            "text": text,
            "ref_audio": ref_audio,
            "ref_text": ref_text,
            "guidance_method": LONGCAT_GUIDANCE,
            "cfg_strength": LONGCAT_CFG,
            "steps": LONGCAT_STEPS,
        }
        if stable:
            kwargs["seed"] = TTS_SEED if seed is None else int(seed)
        try:
            results = self.model.generate(**kwargs)
        except TypeError:
            kwargs.pop("seed", None)
            results = self.model.generate(**kwargs)
        item = results if hasattr(results, "audio") else next(iter(results))
        wave = np.array(getattr(item, "audio"))
        if wave.ndim > 1:
            wave = np.squeeze(wave)
        rate = int(getattr(item, "sample_rate", self.sample_rate) or self.sample_rate)
        if wave.size == 0:
            raise RuntimeError("LongCat produced empty audio")
        return audio_util.to_float32(wave), rate

    def synthesize(
        self,
        text: str,
        ref_audio: str = "",
        ref_text: str = "",
        *,
        batch_size: int = BATCH_SIZE,
        language: str = LANGUAGE,
        job_id: str | None = None,
        voices: list[dict] | None = None,
        stable: bool = True,
        script_name: str = "",
        created_at: str | None = None,
        progress_cb=None,
        cancel_check=None,
    ) -> dict:
        from .engine import engine

        voice_list = _clone_voices(voices, ref_audio, ref_text)
        chunks = chunking.split_script(text, language)
        if not chunks:
            raise ValueError("Script is empty after splitting")
        tts_chunks = [audio_util.normalize_tts_text(item) if stable else item for item in chunks]
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

        with engine.lock:
            with self.lock:
                self._load_unlocked()
                for voice_offset, voice in enumerate(voice_list):
                    if cancel_check:
                        cancel_check()
                    sid = str(voice.get("id") or "clone")
                    wavs: list[np.ndarray] = []
                    for index, spoken in enumerate(tts_chunks):
                        if cancel_check:
                            cancel_check()
                        audio, rate = self._generate_one(
                            spoken,
                            str(voice["ref_audio"]),
                            str(voice["ref_text"]),
                            stable=stable,
                        )
                        native_sr = rate
                        wavs.append(audio)
                        if progress_cb:
                            local = (index + 1) / max(len(tts_chunks), 1)
                            progress_cb(min(1.0, (voice_offset + local) / n_voices))
                    if stable:
                        wavs = audio_util.stabilize_clips(wavs, chunks, native_sr)
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
        if not duration:
            first_id = str(voice_list[0].get("id") or "") if voice_list else ""
            duration = sum(
                float(item.get("duration_sec") or 0)
                for item in segments
                if not first_id or str(item.get("voice_id") or "") == first_id
            )
        stats = {
            "chunks": len(chunks),
            "language": language,
            "mode": "longcat",
            "speaker": None,
            "speakers": [str(item.get("name") or item.get("id")) for item in voice_list],
            "batch_size": max(1, batch_size),
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(full_alias if full_alias.exists() else first),
            "tracks": tracks,
            "segments": segments,
            "engine": "longcat",
        }
        self.last_stats = {key: value for key, value in stats.items() if key not in {"segments", "tracks"}}
        return stats

    def retake_segments(
        self,
        *,
        stats: dict,
        voices: list[dict],
        mismatches: list[dict],
        language: str,
        stable: bool,
        script_name: str = "",
        created_at: str | None = None,
        progress_cb=None,
        cancel_check=None,
    ) -> None:
        if not mismatches:
            return
        from .engine import engine

        voice_by_id = {str(item.get("id") or ""): item for item in voices}
        voice_by_name = {str(item.get("name") or ""): item for item in voices}
        grouped: dict[str, list[dict]] = {}
        for segment in mismatches:
            key = str(segment.get("voice_id") or segment.get("voice") or "")
            grouped.setdefault(key, []).append(segment)
        total = max(len(mismatches), 1)
        done = 0
        with engine.lock:
            with self.lock:
                self._load_unlocked()
                for key, items in grouped.items():
                    voice = voice_by_id.get(key) or voice_by_name.get(key)
                    if not voice:
                        continue
                    for segment in items:
                        if cancel_check:
                            cancel_check()
                        text = str(segment.get("text") or "")
                        spoken = audio_util.normalize_tts_text(text) if stable else text
                        audio, rate = self._generate_one(
                            spoken,
                            str(voice.get("ref_audio") or ""),
                            str(voice.get("ref_text") or ""),
                            stable=stable,
                            seed=TTS_SEED + 100 + int(segment.get("index") or 0),
                        )
                        wav = audio
                        dest = Path(str(segment.get("path") or ""))
                        if not dest.parent.exists():
                            dest.parent.mkdir(parents=True, exist_ok=True)
                        raw_path = dest.parent / f".retake_{segment.get('index')}.raw.wav"
                        audio_util.write_wav(raw_path, wav, rate)
                        audio_util.resample_for_video(raw_path, dest)
                        raw_path.unlink(missing_ok=True)
                        segment["duration_sec"] = round(float(wav.size) / float(rate), 2) if rate else 0.0
                        segment["retaken"] = True
                        done += 1
                        if progress_cb:
                            progress_cb(done / total)


longcat_engine = LongCatEngine()
