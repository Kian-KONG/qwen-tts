from __future__ import annotations

import shutil
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

    def unload_unlocked(self) -> None:
        if self.model is None and not self.loaded:
            return
        self.model = None
        self.loaded = False
        import gc
        import mlx.core as mx

        gc.collect()
        mx.clear_cache()

    def _load_unlocked(self, mode: str) -> None:
        mode = normalize_engine_mode(mode)
        if self.loaded and self.mode == mode and self.model is not None:
            return
        from mlx_audio.tts.utils import load_model
        from .asr import asr_engine

        asr_engine.unload_unlocked()
        self.unload_unlocked()
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
        voices: list[dict] | None = None,
        progress_cb=None,
    ) -> dict:
        mode = normalize_engine_mode(mode)
        lang = LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])
        lang_code = lang["lang_code"]
        chunks = chunking.split_script(text, language)
        if not chunks:
            raise ValueError("Script is empty after splitting")
        speaker_id = (speaker or DEFAULT_SPEAKER).strip()
        voice_list = [item for item in (voices or []) if item.get("id") or item.get("name")]
        if not voice_list:
            if mode == "design":
                voice_list = [{"id": "design", "name": "描述音色", "kind": "design"}]
            elif mode == "preset":
                voice_list = [
                    {
                        "id": speaker_id,
                        "name": SPEAKER_BY_ID.get(speaker_id, {}).get("label") or speaker_id,
                        "kind": "preset",
                    }
                ]
            else:
                voice_list = [{"id": "clone", "name": "克隆", "kind": "clone"}]
        if mode == "design":
            if not instruct.strip():
                raise ValueError("Voice description is required")
        elif mode == "preset":
            for item in voice_list:
                sid = str(item.get("id") or speaker_id)
                if sid not in SPEAKER_BY_ID:
                    raise ValueError(f"Unknown speaker: {sid}")
                item["id"] = sid
                item["name"] = item.get("name") or SPEAKER_BY_ID[sid]["label"]
                item["kind"] = "preset"
        else:
            for item in voice_list:
                ref = item.get("ref_audio") or ref_audio
                transcript = item.get("ref_text") or ref_text
                if not ref or not Path(ref).exists():
                    raise FileNotFoundError("Reference audio is required for voice cloning")
                if not (transcript or "").strip():
                    raise ValueError("Reference transcript is required for ICL voice cloning")
                item["ref_audio"] = str(audio_util.ensure_pcm_wav(ref))
                item["ref_text"] = str(transcript).strip()
                item["kind"] = "clone"
                item["name"] = item.get("name") or item.get("id") or "克隆"

        batch_size = max(1, min(batch_size or BATCH_SIZE, 8))
        started = time.perf_counter()
        native_sr = self.sample_rate
        style = instruct.strip()
        stem = job_id or time.strftime("%Y%m%d-%H%M%S")
        segment_dir = OUTPUT_DIR / stem
        segment_dir.mkdir(parents=True, exist_ok=True)
        used_names: set[str] = set()
        segments: list[dict] = []
        tracks: list[dict] = []
        clip_index = 0
        n_voices = max(1, len(voice_list))

        with self.lock:
            self._load_unlocked(mode)
            for voice_offset, voice in enumerate(voice_list):
                wavs: list[np.ndarray] = []
                sid = str(voice.get("id") or speaker_id)
                for offset in range(0, len(chunks), batch_size):
                    batch = chunks[offset : offset + batch_size]
                    if mode == "design":
                        collected = self._generate_design_batch(batch, style, lang_code)
                    elif mode == "preset":
                        collected = self._generate_preset_batch(batch, sid, lang_code, style)
                    else:
                        collected = self._generate_batch(
                            batch,
                            str(voice["ref_audio"]),
                            str(voice["ref_text"]),
                            lang_code,
                        )
                    for index in range(len(batch)):
                        if index not in collected:
                            raise RuntimeError(f"Missing audio for chunk {offset + index}")
                        audio, rate = collected[index]
                        native_sr = rate
                        wavs.append(audio_util.to_float32(audio))
                    if progress_cb:
                        local = min(1.0, (offset + len(batch)) / len(chunks))
                        progress_cb(min(1.0, (voice_offset + local) / n_voices))

                voice_name = str(voice.get("name") or sid)
                for chunk, wav in zip(chunks, wavs):
                    clip_index += 1
                    filename = audio_util.unique_wav_name(segment_dir, chunk, voice_name, used_names)
                    raw_path = segment_dir / f".seg_{clip_index:03d}.raw.wav"
                    out_seg = segment_dir / filename
                    audio_util.write_wav(raw_path, wav, native_sr)
                    audio_util.resample_for_video(raw_path, out_seg)
                    raw_path.unlink(missing_ok=True)
                    duration = float(wav.size) / float(native_sr) if native_sr else 0.0
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

                audio = audio_util.concat_with_gap(wavs, native_sr, GAP_MS)
                track_name = audio_util.unique_wav_name(segment_dir, "完整轨", voice_name, used_names)
                raw_path = segment_dir / f".full_{sid}.raw.wav"
                track_path = segment_dir / track_name
                audio_util.write_wav(raw_path, audio, native_sr)
                audio_util.resample_for_video(raw_path, track_path)
                raw_path.unlink(missing_ok=True)
                tracks.append(
                    {
                        "index": len(tracks) + 1,
                        "voice": voice_name,
                        "voice_id": sid,
                        "filename": track_name,
                        "path": str(track_path),
                        "duration_sec": round(float(audio.size) / float(native_sr), 2) if native_sr else 0.0,
                    }
                )

        elapsed = time.perf_counter() - started
        out_path = Path(tracks[0]["path"]) if tracks else segment_dir / "full.wav"
        full_alias = segment_dir / "full.wav"
        if out_path.exists() and full_alias.resolve() != out_path.resolve():
            shutil.copy2(out_path, full_alias)
        duration = max((float(item.get("duration_sec") or 0) for item in tracks), default=0.0)

        stats = {
            "chunks": len(chunks),
            "language": language,
            "mode": mode,
            "speaker": voice_list[0]["id"] if mode == "preset" and voice_list else (speaker_id if mode == "preset" else None),
            "speakers": [str(item.get("name") or item.get("id")) for item in voice_list],
            "batch_size": batch_size,
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(full_alias if full_alias.exists() else out_path),
            "tracks": tracks,
            "segments": segments,
        }
        self.last_stats = {key: value for key, value in stats.items() if key not in {"segments", "tracks"}}
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
