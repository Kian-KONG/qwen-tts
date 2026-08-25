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
    PREVIEW_DIR,
    SPEAKER_BY_ID,
    SPEAKER_PREVIEW,
    STABLE_STYLE,
    TTS_REPETITION_PENALTY,
    TTS_SEED,
    TTS_TEMPERATURE,
    TTS_TOP_P,
)


def normalize_engine_mode(mode: str | None) -> str:
    value = (mode or "preset").strip().lower()
    if value in {"design", "voice_design", "describe", "description"}:
        return "design"
    if value in {"preset", "custom", "custom_voice"}:
        return "preset"
    if value in {"mixed", "all", "multi"}:
        return "mixed"
    return "clone"


def _voice_kind(item: dict, fallback: str = "preset") -> str:
    raw = str(item.get("kind") or "").strip().lower()
    if raw in {"design", "voice_design", "describe", "description"}:
        return "design"
    if raw in {"preset", "custom", "custom_voice"}:
        return "preset"
    if raw in {"clone", "base", "icl"}:
        return "clone"
    mode = normalize_engine_mode(fallback)
    return "preset" if mode == "mixed" else mode


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
        if mode == "mixed":
            mode = "preset"
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

    def preview_speaker(self, speaker_id: str) -> Path:
        speaker_id = speaker_id.strip()
        meta = SPEAKER_BY_ID.get(speaker_id)
        if not meta:
            raise KeyError(speaker_id)
        dest = PREVIEW_DIR / f"{speaker_id}.wav"
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        text, lang_code = SPEAKER_PREVIEW.get(meta.get("native") or "English", SPEAKER_PREVIEW["English"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        with self.lock:
            self._load_unlocked("preset")
            collected = self._generate_preset_batch([text], speaker_id, lang_code, "", stable=True)
            if 0 not in collected:
                raise RuntimeError(f"Missing preview audio for {speaker_id}")
            audio, rate = collected[0]
            audio_util.write_wav(dest, audio_util.to_float32(audio), rate)
        return dest

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
        stable: bool = True,
        progress_cb=None,
    ) -> dict:
        mode = normalize_engine_mode(mode)
        lang = LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])
        lang_code = lang["lang_code"]
        chunks = chunking.split_script(text, language)
        if not chunks:
            raise ValueError("Script is empty after splitting")
        tts_chunks = [audio_util.normalize_tts_text(item) if stable else item for item in chunks]
        speaker_id = (speaker or DEFAULT_SPEAKER).strip()
        voice_list = [item for item in (voices or []) if item.get("id") or item.get("name") or item.get("instruct")]
        if not voice_list:
            if mode == "design":
                voice_list = [{"id": "design", "name": "描述音色", "kind": "design", "instruct": instruct}]
            elif mode == "clone":
                voice_list = [{"id": "clone", "name": "克隆", "kind": "clone"}]
            else:
                voice_list = [
                    {
                        "id": speaker_id,
                        "name": SPEAKER_BY_ID.get(speaker_id, {}).get("label") or speaker_id,
                        "kind": "preset",
                    }
                ]
        for item in voice_list:
            kind = _voice_kind(item, mode)
            item["kind"] = kind
            if kind == "design":
                prompt = str(item.get("instruct") or instruct or "").strip()
                if not prompt:
                    raise ValueError("Voice description is required")
                item["instruct"] = prompt
                item["name"] = item.get("name") or "描述音色"
            elif kind == "preset":
                sid = str(item.get("id") or speaker_id)
                if sid not in SPEAKER_BY_ID:
                    raise ValueError(f"Unknown speaker: {sid}")
                item["id"] = sid
                item["name"] = item.get("name") or SPEAKER_BY_ID[sid]["label"]
                if instruct.strip() and not item.get("style"):
                    item["style"] = instruct.strip()
                if stable and not str(item.get("style") or "").strip():
                    item["style"] = STABLE_STYLE
            else:
                ref = item.get("ref_audio") or ref_audio
                transcript = item.get("ref_text") or ref_text
                if not ref or not Path(ref).exists():
                    raise FileNotFoundError("Reference audio is required for voice cloning")
                if not (transcript or "").strip():
                    raise ValueError("Reference transcript is required for ICL voice cloning")
                item["ref_audio"] = str(audio_util.ensure_pcm_wav(ref))
                item["ref_text"] = str(transcript).strip()
                item["name"] = item.get("name") or item.get("id") or "克隆"
        kinds = list(dict.fromkeys(_voice_kind(item, mode) for item in voice_list))
        if len(kinds) > 1:
            mode = "mixed"
            order = {"preset": 0, "design": 1, "clone": 2}
            voice_list.sort(key=lambda item: order.get(str(item.get("kind")), 9))
        elif kinds:
            mode = kinds[0]

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
            if stable:
                import mlx.core as mx

                mx.random.seed(TTS_SEED)
            for voice_offset, voice in enumerate(voice_list):
                wavs: list[np.ndarray] = []
                kind = _voice_kind(voice, mode)
                sid = str(voice.get("id") or speaker_id)
                self._load_unlocked(kind)
                for offset in range(0, len(tts_chunks), batch_size):
                    batch = tts_chunks[offset : offset + batch_size]
                    if kind == "design":
                        collected = self._generate_design_batch(
                            batch, str(voice.get("instruct") or style), lang_code, stable=stable
                        )
                    elif kind == "preset":
                        collected = self._generate_preset_batch(
                            batch, sid, lang_code, str(voice.get("style") or style), stable=stable
                        )
                    else:
                        collected = self._generate_batch(
                            batch,
                            str(voice["ref_audio"]),
                            str(voice["ref_text"]),
                            lang_code,
                            stable=stable,
                        )
                    for index in range(len(batch)):
                        if index not in collected:
                            raise RuntimeError(f"Missing audio for chunk {offset + index}")
                        audio, rate = collected[index]
                        native_sr = rate
                        wavs.append(audio_util.to_float32(audio))
                    if progress_cb:
                        local = min(1.0, (offset + len(batch)) / len(tts_chunks))
                        progress_cb(min(1.0, (voice_offset + local) / n_voices))

                if stable:
                    wavs = audio_util.stabilize_clips(wavs, chunks, native_sr)

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
                if wavs:
                    track_audio = audio_util.concat_with_gap(wavs, native_sr, GAP_MS)
                    track_name = audio_util.unique_wav_name(segment_dir, "完整轨", voice_name, used_names)
                    raw_track = segment_dir / f".track_{voice_offset + 1:03d}.raw.wav"
                    out_track = segment_dir / track_name
                    audio_util.write_wav(raw_track, track_audio, native_sr)
                    audio_util.resample_for_video(raw_track, out_track)
                    raw_track.unlink(missing_ok=True)
                    track_duration = float(track_audio.size) / float(native_sr) if native_sr else 0.0
                    tracks.append(
                        {
                            "index": len(tracks) + 1,
                            "voice": voice_name,
                            "voice_id": sid,
                            "filename": track_name,
                            "duration_sec": round(track_duration, 2),
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
            "mode": mode,
            "speaker": next(
                (str(item.get("id")) for item in voice_list if item.get("kind") == "preset"),
                speaker_id if mode == "preset" else None,
            ),
            "speakers": [str(item.get("name") or item.get("id")) for item in voice_list],
            "batch_size": batch_size,
            "elapsed_sec": round(elapsed, 2),
            "audio_sec": round(duration, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "sample_rate": native_sr,
            "output_path": str(full_alias if full_alias.exists() else first),
            "tracks": tracks,
            "segments": segments,
        }
        self.last_stats = {key: value for key, value in stats.items() if key not in {"segments", "tracks"}}
        return stats

    def _decode_kwargs(self, stable: bool) -> dict:
        if not stable:
            return {}
        return {
            "temperature": TTS_TEMPERATURE,
            "top_p": TTS_TOP_P,
            "repetition_penalty": TTS_REPETITION_PENALTY,
        }

    def _generate_batch(
        self,
        batch: list[str],
        ref_audio: str,
        ref_text: str,
        language: str,
        *,
        stable: bool = True,
    ) -> dict[int, tuple[np.ndarray, int]]:
        kwargs = {
            "texts": batch,
            "ref_audio": ref_audio,
            "ref_text": ref_text,
            "lang_code": language,
            "stream": False,
            "verbose": False,
            **self._decode_kwargs(stable),
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
        except TypeError:
            return self._generate_one_by_one(
                batch, language, ref_audio=ref_audio, ref_text=ref_text, stable=stable
            )
        return _collect(results, self.sample_rate)

    def _generate_design_batch(
        self,
        batch: list[str],
        instruct: str,
        language: str,
        *,
        stable: bool = True,
    ) -> dict[int, tuple[np.ndarray, int]]:
        kwargs = {
            "texts": batch,
            "instructs": [instruct] * len(batch),
            "lang_code": language,
            "stream": False,
            "verbose": False,
            **self._decode_kwargs(stable),
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
            return _collect(results, self.sample_rate)
        except Exception:
            return self._generate_one_by_one(batch, language, instruct=instruct, stable=stable)

    def _generate_preset_batch(
        self,
        batch: list[str],
        speaker: str,
        language: str,
        instruct: str,
        *,
        stable: bool = True,
    ) -> dict[int, tuple[np.ndarray, int]]:
        style = instruct or None
        kwargs = {
            "texts": batch,
            "voices": [speaker] * len(batch),
            "instructs": [style] * len(batch),
            "lang_code": language,
            "stream": False,
            "verbose": False,
            **self._decode_kwargs(stable),
        }
        try:
            results = list(self.model.batch_generate(**kwargs))
            return _collect(results, self.sample_rate)
        except Exception:
            return self._generate_one_by_one(
                batch, language, voice=speaker, instruct=style, stable=stable
            )

    def _generate_one_by_one(
        self,
        batch: list[str],
        language: str,
        *,
        ref_audio: str | None = None,
        ref_text: str | None = None,
        instruct: str | None = None,
        voice: str | None = None,
        stable: bool = True,
    ) -> dict[int, tuple[np.ndarray, int]]:
        collected: dict[int, tuple[np.ndarray, int]] = {}
        extra = self._decode_kwargs(stable)
        for index, text in enumerate(batch):
            kwargs: dict = {
                "text": text,
                "lang_code": language,
                "stream": False,
                "verbose": False,
                **extra,
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
