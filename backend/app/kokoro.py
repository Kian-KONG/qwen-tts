from __future__ import annotations

import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

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


def parse_kokoro_voice_ids(voice_id: str) -> list[str]:
    parts = [
        item.strip()
        for item in str(voice_id).replace("+", ",").replace(";", ",").split(",")
        if item.strip()
    ]
    if not parts:
        raise KeyError(voice_id)
    for part in parts:
        if part not in KOKORO_VOICE_BY_ID:
            raise KeyError(part)
    return parts


def kokoro_blend_name(ids: list[str]) -> str:
    return " + ".join(KOKORO_VOICE_BY_ID[item]["label"] for item in ids)


def kokoro_gender(voice_id: str) -> str:
    if len(voice_id) >= 2 and voice_id[1] in {"f", "m"}:
        return voice_id[1]
    return ""


def same_kokoro_gender(ids: list[str]) -> bool:
    genders = {kokoro_gender(item) for item in ids}
    return len(ids) >= 2 and len(genders) == 1 and "" not in genders


def require_same_gender(ids: list[str]) -> None:
    if not same_kokoro_gender(ids):
        raise ValueError("Kokoro 融合只支持同性音色（女声+女声或男声+男声）")


def parse_blend_weights(ids: list[str], raw: Any = None) -> list[float]:
    values: list[float] = []
    if isinstance(raw, dict):
        values = [float(raw.get(vid, 1.0) or 0.0) for vid in ids]
    elif isinstance(raw, (list, tuple)):
        values = [float(item) for item in raw]
    elif isinstance(raw, str) and raw.strip():
        values = [float(item.strip()) for item in raw.split(",") if item.strip() != ""]
    if len(values) < len(ids):
        values.extend([1.0] * (len(ids) - len(values)))
    clipped = [max(0.0, float(item)) for item in values[: len(ids)]]
    if sum(clipped) <= 0:
        return [1.0] * len(ids)
    return clipped


def normalize_weights(weights: list[float]) -> list[float]:
    total = sum(max(0.0, float(item)) for item in weights)
    if total <= 0:
        n = max(len(weights), 1)
        return [1.0 / n] * len(weights)
    return [max(0.0, float(item)) / total for item in weights]


def blend_voice_tensors(packs: list[Any], weights: list[float]) -> Any:
    import mlx.core as mx

    if not packs:
        raise ValueError("No Kokoro voice packs to blend")
    if len(packs) == 1:
        return packs[0]
    w = normalize_weights(weights if len(weights) == len(packs) else [1.0] * len(packs))
    eps = mx.array(1e-8, dtype=packs[0].dtype)
    mixed = None
    target = None
    for pack, wi in zip(packs, w):
        mag = mx.linalg.norm(pack, axis=-1, keepdims=True)
        unit = pack / (mag + eps)
        piece = unit * wi
        mixed = piece if mixed is None else mixed + piece
        scaled = mag * wi
        target = scaled if target is None else target + scaled
    mixed_mag = mx.linalg.norm(mixed, axis=-1, keepdims=True)
    return (mixed / (mixed_mag + eps)) * target


def write_blended_voice(ids: list[str], weights: list[float] | None = None) -> Path:
    from mlx_audio.tts.models.kokoro.voice import load_voice_tensor
    import mlx.core as mx

    require_same_gender(ids)
    packs = []
    for vid in ids:
        path = kokoro_voice_path(vid)
        if not path.exists():
            raise FileNotFoundError(f"Kokoro voice pack missing: {vid}")
        packs.append(load_voice_tensor(str(path)))
    blended = blend_voice_tensors(packs, parse_blend_weights(ids, weights))
    handle = tempfile.NamedTemporaryFile(prefix="kokoro-blend-", suffix=".safetensors", delete=False)
    handle.close()
    dest = Path(handle.name)
    mx.save_safetensors(str(dest), {"voice": blended})
    return dest


def kokoro_lang_code(voice_id: str) -> str:
    return "b" if voice_id.startswith(("bf_", "bm_")) else "a"


def kokoro_voice_path(voice_id: str) -> Path:
    return KOKORO_MODEL_DIR / "voices" / f"{voice_id}.safetensors"


def is_kokoro_ready() -> bool:
    return is_local_model_dir(KOKORO_MODEL_DIR) and kokoro_voice_path(DEFAULT_KOKORO_VOICE).exists()


def require_misaki_en() -> None:
    try:
        import misaki.en  # noqa: F401
        import misaki.espeak  # noqa: F401
        import spacy
    except ImportError as exc:
        raise ImportError(
            "Kokoro English G2P needs num2words, phonemizer, spaCy. Run: make setup"
        ) from exc
    if not spacy.util.is_package("en_core_web_sm"):
        raise ImportError("Kokoro needs spaCy model en_core_web_sm. Run: make setup")


_g2p_lock = threading.Lock()
_g2p_cache: dict[bool, Any] = {}


def english_g2p(*, british: bool = False):
    require_misaki_en()
    with _g2p_lock:
        if british not in _g2p_cache:
            from misaki.en import G2P
            from misaki.espeak import EspeakFallback

            try:
                fallback = EspeakFallback(british=british)
            except Exception:
                fallback = None
            _g2p_cache[british] = G2P(trf=False, british=british, fallback=fallback, unk="")
        return _g2p_cache[british]


# Isolated A is tagged DT → ɐ (article). Force letter names instead.
_ISOLATED_LETTER = re.compile(
    r"^(?:\[([A-Za-z])\]\(/[^)]*/\)|([A-Za-z]))[。.!?！？,，、;；:：'\"”’)\]]*$"
)
_US_LETTER_NAMES = {
    "A": "ˈA",
    "B": "bˈi",
    "C": "sˈi",
    "D": "dˈi",
    "E": "ˈi",
    "F": "ˈɛf",
    "G": "ʤˈi",
    "H": "ˈAʧ",
    "I": "ˈI",
    "J": "ʤˈA",
    "K": "kˈA",
    "L": "ˈɛl",
    "M": "ˈɛm",
    "N": "ˈɛn",
    "O": "ˈO",
    "P": "pˈi",
    "Q": "kjˈu",
    "R": "ˈɑɹ",
    "S": "ˈɛs",
    "T": "tˈi",
    "U": "jˈu",
    "V": "vˈi",
    "W": "dˈʌbᵊlju",
    "X": "ˈɛks",
    "Y": "wˈI",
    "Z": "zˈi",
}
_GB_LETTER_NAMES = {
    **_US_LETTER_NAMES,
    "B": "bˈiː",
    "C": "sˈiː",
    "D": "dˈiː",
    "E": "ˈiː",
    "G": "ʤˈiː",
    "O": "ˈQ",
    "P": "pˈiː",
    "Q": "kjˈuː",
    "R": "ˈɑː",
    "T": "tˈiː",
    "U": "jˈuː",
    "V": "vˈiː",
    "W": "dˈʌbᵊljuː",
    "Z": "zˈiː",
}


def isolated_letter(text: str) -> str | None:
    match = _ISOLATED_LETTER.match((text or "").strip())
    if not match:
        return None
    return match.group(1) or match.group(2)


def letter_name_phonemes(letter: str, *, british: bool = False) -> str:
    table = _GB_LETTER_NAMES if british else _US_LETTER_NAMES
    return table[letter.upper()]


def spell_letter_clip(text: str, *, british: bool = False) -> str:
    """Read a lone A–Z (or a line of them) as letter names, not the article/pronoun."""
    raw = text or ""
    stripped = raw.strip()
    if not stripped:
        return raw
    parts = re.findall(r"\S+|\s+", stripped)
    words = [part for part in parts if not part.isspace()]
    if not words or not all(isolated_letter(part) for part in words):
        return raw
    spelled: list[str] = []
    for part in parts:
        if part.isspace():
            spelled.append(part)
            continue
        grapheme = isolated_letter(part) or part
        spelled.append(f"[{grapheme}](/{letter_name_phonemes(grapheme, british=british)}/)")
    return "".join(spelled)


def single_letter_clip(text: str, *, british: bool = False) -> str | None:
    """Bare A–Z (or default letter-name markup). Custom /phonemes/ stay as written."""
    stripped = (text or "").strip()
    letter = isolated_letter(stripped)
    if not letter:
        return None
    marked = re.match(r"^\[([A-Za-z])\]\(/([^)]*)/\)[。.!?！？]*$", stripped)
    if marked:
        expected = letter_name_phonemes(marked.group(1), british=british)
        if marked.group(2) != expected:
            return None
    return letter.upper()


def _token_letter(token: Any) -> str | None:
    letters = re.sub(r"[^A-Za-z]", "", str(getattr(token, "text", "") or ""))
    if len(letters) != 1:
        return None
    return letters.upper()


def crop_letter_wave(wave: np.ndarray, sample_rate: int, tokens: list | None, letter: str) -> np.ndarray | None:
    """Cut on token timestamps only. Keep the whole letter; do not eat the onset."""
    if wave.size == 0 or sample_rate <= 0 or not tokens:
        return None
    index = None
    target = None
    for i, token in enumerate(tokens):
        if _token_letter(token) == letter.upper() and getattr(token, "start_ts", None) is not None:
            index = i
            target = token
    if target is None:
        return None
    start_t = float(target.start_ts)
    prev = tokens[index - 1] if index else None
    if prev is not None and getattr(prev, "end_ts", None) is not None and _token_letter(prev) is None:
        pause_end = float(prev.end_ts)
        if pause_end <= start_t:
            start_t = pause_end
    start = max(0, int((start_t - 0.012) * sample_rate))
    end = min(wave.size, int((float(target.end_ts) + 0.09) * sample_rate))
    if end - start < int(sample_rate * 0.12):
        start = max(0, int(float(target.start_ts) * sample_rate))
        end = min(wave.size, int((float(target.end_ts) + 0.09) * sample_rate))
    if end - start < int(sample_rate * 0.12):
        return None
    return audio_util.fade_edges(wave[start:end], sample_rate, 8.0)


def _annotate_token(text: str, phonemes: str | None) -> str:
    word = text or ""
    ps = (phonemes or "").strip()
    if word and ps and any(ch.isalpha() for ch in word):
        return f"[{word}](/{ps}/)"
    return word


def phonemize_text(text: str, *, british: bool = False) -> dict:
    raw = spell_letter_clip((text or "").strip(), british=british)
    if not raw:
        return {"text": "", "phonemes": "", "annotated": "", "tokens": []}
    g2p = english_g2p(british=british)
    with _g2p_lock:
        phonemes, tokens = g2p(raw)
    items = []
    annotated: list[str] = []
    for token in tokens:
        piece = _annotate_token(str(token.text or ""), token.phonemes)
        space = token.whitespace or ""
        annotated.append(piece + space)
        items.append(
            {
                "text": token.text,
                "phonemes": token.phonemes or "",
                "whitespace": space,
            }
        )
    return {
        "text": raw,
        "phonemes": str(phonemes or "").strip(),
        "annotated": "".join(annotated).strip(),
        "tokens": items,
    }


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
        require_misaki_en()
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

    def preview_voice(self, voice_id: str, weights: list[float] | str | None = None) -> Path:
        ids = parse_kokoro_voice_ids(voice_id)
        parsed = parse_blend_weights(ids, weights) if len(ids) > 1 else None
        if parsed:
            require_same_gender(ids)
            stamp = "-".join(f"{vid}_{int(round(w * 1000))}" for vid, w in zip(ids, normalize_weights(parsed)))
        else:
            stamp = "-".join(ids)
        dest = PREVIEW_DIR / f"kokoro-{stamp}.wav"
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        from .engine import engine

        with engine.lock:
            with self.lock:
                self._load_unlocked()
                audio, rate = self._generate_one("Hello, this is a preview of my voice.", ids, parsed)
                audio_util.write_wav(dest, audio_util.to_float32(audio), rate)
        return dest

    def _wave_from_audio(self, audio) -> np.ndarray:
        wave = np.array(audio)
        if wave.ndim > 1:
            wave = np.squeeze(wave)
        return audio_util.to_float32(wave)

    def _generate_one(
        self,
        text: str,
        voice_id: str | list[str],
        weights: list[float] | None = None,
    ) -> tuple[np.ndarray, int]:
        ids = parse_kokoro_voice_ids(",".join(voice_id) if isinstance(voice_id, list) else voice_id)
        british = kokoro_lang_code(ids[0]) == "b"
        letter = single_letter_clip(text, british=british)
        if not letter:
            text = spell_letter_clip(text, british=british)
        blend_path: Path | None = None
        if len(ids) > 1:
            blend_path = write_blended_voice(ids, weights)
            voice_arg = str(blend_path)
        else:
            pack = kokoro_voice_path(ids[0])
            if not pack.exists():
                raise FileNotFoundError(f"Kokoro voice pack missing: {ids[0]}")
            voice_arg = str(pack)
        parts: list[np.ndarray] = []
        rate = self.sample_rate
        lang = kokoro_lang_code(ids[0])
        try:
            if letter:
                wave, rate = self._generate_letter(letter, voice_arg, lang)
                if wave.size:
                    parts.append(wave)
            else:
                for item in self.model.generate(
                    text=text,
                    voice=voice_arg,
                    lang_code=lang,
                    speed=1.0,
                    split_pattern=r"\n+",
                ):
                    wave = self._wave_from_audio(item.audio)
                    rate = int(getattr(item, "sample_rate", rate) or rate)
                    if wave.size:
                        parts.append(wave)
        finally:
            if blend_path:
                blend_path.unlink(missing_ok=True)
        if not parts:
            raise RuntimeError(f"No audio generated for {','.join(ids)}")
        return (np.concatenate(parts) if len(parts) > 1 else parts[0], rate)

    def _generate_letter(self, letter: str, voice_arg: str, lang: str) -> tuple[np.ndarray, int]:
        pipeline = self.model._get_pipeline(lang)
        pipeline.voices = {}
        carrier = f"Letter. {letter}."
        rate = self.sample_rate
        for result in pipeline(carrier, voice=voice_arg, speed=1.0, split_pattern=None):
            wave = self._wave_from_audio(result.audio)
            rate = int(getattr(self.model, "sample_rate", rate) or rate)
            cropped = crop_letter_wave(wave, rate, result.tokens, letter)
            if cropped is not None and cropped.size:
                return cropped, rate
            if wave.size:
                return wave, rate
        raise RuntimeError(f"No audio generated for letter {letter}")

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
        voice_list = [item for item in (voices or []) if item.get("id") or item.get("voices")]
        if not voice_list:
            voice_list = [
                {
                    "id": DEFAULT_KOKORO_VOICE,
                    "name": KOKORO_VOICE_BY_ID[DEFAULT_KOKORO_VOICE]["label"],
                    "kind": "kokoro",
                    "voices": [DEFAULT_KOKORO_VOICE],
                }
            ]
        for item in voice_list:
            try:
                ids = item.get("voices") or parse_kokoro_voice_ids(str(item.get("id") or DEFAULT_KOKORO_VOICE))
                ids = parse_kokoro_voice_ids(",".join(str(part) for part in ids))
            except KeyError as exc:
                raise ValueError(f"Unknown Kokoro voice: {exc}") from exc
            item["voices"] = ids
            item["id"] = ",".join(ids)
            item["kind"] = "kokoro"
            item["name"] = item.get("name") or kokoro_blend_name(ids)
            item["blend"] = len(ids) > 1
            if item["blend"]:
                require_same_gender(ids)
                item["weights"] = parse_blend_weights(ids, item.get("weights"))
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
                    voice_ids = voice.get("voices") or parse_kokoro_voice_ids(sid)
                    wavs: list[np.ndarray] = []
                    for index, chunk in enumerate(chunks):
                        if cancel_check:
                            cancel_check()
                        spoken = audio_util.normalize_tts_text(chunk)
                        audio, rate = self._generate_one(spoken, voice_ids, voice.get("weights"))
                        native_sr = rate
                        letter = single_letter_clip(spoken, british=kokoro_lang_code(voice_ids[0]) == "b")
                        wav = audio_util.polish_clip(
                            audio,
                            rate,
                            short=False if letter else audio_util.is_short_clip(spoken, audio, rate),
                            pad_ms=80 if letter else None,
                        )
                        wavs.append(wav)
                        if progress_cb:
                            local = (index + 1) / max(len(chunks), 1)
                            progress_cb(min(1.0, (voice_offset + local) / n_voices))
                    voice_name = str(voice.get("name") or sid)
                    clip_paths: list[Path] = []
                    label = (script_name or "").strip() or "文稿"
                    for chunk, wav in zip(chunks, wavs):
                        clip_index += 1
                        filename = audio_util.unique_wav_name(
                            segment_dir, audio_util.spoken_script_text(chunk), voice_name, used_names
                        )
                        raw_path = segment_dir / f".seg_{clip_index:03d}.raw.wav"
                        out_seg = segment_dir / filename
                        audio_util.write_wav(raw_path, wav, native_sr, subtype="FLOAT")
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
