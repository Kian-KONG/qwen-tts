from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .config import (
    ATEMPO_MAX,
    ATEMPO_MIN,
    ATEMPO_SHORT_MAX,
    ATEMPO_SHORT_MIN,
    OUTPUT_SAMPLE_RATE,
    SILENCE_PAD_MS,
)

_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|\n\r\t]+')


def clip_stem(text: str, voice: str) -> str:
    left = _UNSAFE_NAME.sub(" ", (text or "").strip())
    left = re.sub(r"\s+", " ", left).strip(" .") or "片段"
    right = _UNSAFE_NAME.sub(" ", (voice or "").strip())
    right = re.sub(r"\s+", " ", right).strip(" .") or "音色"
    if len(left) > 40:
        left = left[:40].rstrip()
    return f"{left} - {right}"


def unique_wav_name(folder: Path, text: str, voice: str, used: set[str]) -> str:
    base = clip_stem(text, voice)
    name = f"{base}.wav"
    index = 2
    while name.lower() in used or (folder / name).exists():
        name = f"{base} {index}.wav"
        index += 1
    used.add(name.lower())
    return name


def ffmpeg_bin() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def to_float32(audio) -> np.ndarray:
    array = np.array(audio, dtype=np.float32, copy=False).reshape(-1)
    peak = float(np.max(np.abs(array))) if array.size else 0.0
    if peak > 1.2:
        array = array / 32768.0
    return np.clip(array, -1.0, 1.0)


_PUNCT = re.compile(r"[。！？.!?…，,、；;：:\s\"'「」『』（）()\[\]【】]+")
_SHORT_END = re.compile(r"[？！!?]$")
_CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_PAIR_TAILS = (
    (re.compile(r"(成功|失败)$"), "结果"),
    (re.compile(r"(太远|太近)$"), "太距"),
    (re.compile(r"(已打开|已关闭)$"), "已开关"),
    (re.compile(r"(打开|关闭)$"), "开关"),
)


def spoken_len(text: str) -> int:
    return len(_PUNCT.sub("", text or ""))


def pair_key(text: str) -> str | None:
    raw = _PUNCT.sub("", text or "").strip()
    if not raw:
        return None
    for pattern, token in _PAIR_TAILS:
        if pattern.search(raw):
            return pattern.sub(token, raw)
    return None


def align_group_key(text: str) -> str | None:
    pair = pair_key(text)
    if pair:
        return f"pair:{pair}"
    count = spoken_len(text)
    if count <= 0:
        return None
    return f"len:{count}"


def atempo_range(texts: list[str]) -> tuple[float, float]:
    if texts and max(spoken_len(item) for item in texts) <= 8:
        return ATEMPO_SHORT_MIN, ATEMPO_SHORT_MAX
    return ATEMPO_MIN, ATEMPO_MAX


def normalize_tts_text(text: str) -> str:
    value = re.sub(r"\s+", " ", (text or "").strip())
    if not value:
        return value
    value = re.sub(r"[。.]{2,}", "。", value)
    value = re.sub(r"…+", "。", value)
    cjk = len(_CJK.findall(value))
    count = spoken_len(value)
    if cjk and count <= 8 and cjk >= max(1, count // 2) and not _SHORT_END.search(value):
        value = re.sub(r"[。.!?！？\s]+$", "", value)
        if value:
            value = f"{value}。"
    return value


def trim_silence(
    audio: np.ndarray,
    sample_rate: int,
    pad_ms: int = SILENCE_PAD_MS,
    thresh: float = 0.012,
) -> np.ndarray:
    array = to_float32(audio)
    if array.size == 0 or sample_rate <= 0:
        return array
    mask = np.abs(array) > thresh
    if not mask.any():
        return array
    start = int(np.argmax(mask))
    end = int(len(mask) - np.argmax(mask[::-1]))
    pad = int(sample_rate * max(0, pad_ms) / 1000.0)
    start = max(0, start - pad)
    end = min(len(array), end + pad)
    if end - start < int(sample_rate * 0.08):
        return array
    return array[start:end]


def time_stretch(
    audio: np.ndarray,
    sample_rate: int,
    tempo: float,
    lo: float = ATEMPO_MIN,
    hi: float = ATEMPO_MAX,
) -> np.ndarray:
    array = to_float32(audio)
    tempo = min(float(hi), max(float(lo), float(tempo)))
    if array.size == 0 or abs(tempo - 1.0) < 0.01:
        return array
    ffmpeg = ffmpeg_bin()
    if ffmpeg is None:
        return array
    src = dst = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            src = Path(tmp.name)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            dst = Path(tmp.name)
        sf.write(src, array, sample_rate, subtype="PCM_16")
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(src),
                "-filter:a",
                f"atempo={tempo:.4f}",
                "-c:a",
                "pcm_s16le",
                str(dst),
            ],
            check=True,
            capture_output=True,
        )
        stretched, _rate = sf.read(str(dst), dtype="float32")
        return to_float32(stretched)
    except Exception:
        return array
    finally:
        if src:
            src.unlink(missing_ok=True)
        if dst:
            dst.unlink(missing_ok=True)


def pad_to_duration(audio: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    array = to_float32(audio)
    if sample_rate <= 0 or seconds <= 0:
        return array
    need = int(round(float(seconds) * sample_rate))
    if array.size >= need:
        return array
    return np.concatenate([array, np.zeros(need - array.size, dtype=np.float32)])


def align_clip_lengths(
    wavs: list[np.ndarray],
    texts: list[str],
    sample_rate: int,
) -> list[np.ndarray]:
    from collections import defaultdict

    if sample_rate <= 0 or len(wavs) != len(texts):
        return wavs
    groups: dict[str, list[int]] = defaultdict(list)
    for index, text in enumerate(texts):
        key = align_group_key(text)
        if key:
            groups[key].append(index)
    aligned = list(wavs)
    for key, indexes in groups.items():
        if len(indexes) < 2:
            continue
        lo, hi = atempo_range([texts[i] for i in indexes])
        durations = [aligned[i].size / float(sample_rate) for i in indexes]
        target = float(np.median(np.array(durations, dtype=np.float64)))
        if target <= 0:
            continue
        for index in indexes:
            current = aligned[index].size / float(sample_rate)
            if current <= 0:
                continue
            aligned[index] = time_stretch(aligned[index], sample_rate, current / target, lo=lo, hi=hi)
        if key.startswith("pair:"):
            target = max(aligned[i].size / float(sample_rate) for i in indexes)
        for index in indexes:
            aligned[index] = pad_to_duration(aligned[index], sample_rate, target)
    return aligned


def stabilize_clips(
    wavs: list[np.ndarray],
    texts: list[str],
    sample_rate: int,
    pad_ms: int = SILENCE_PAD_MS,
) -> list[np.ndarray]:
    trimmed = [trim_silence(item, sample_rate, pad_ms=pad_ms) for item in wavs]
    return align_clip_lengths(trimmed, texts, sample_rate)


def concat_with_gap(chunks: list[np.ndarray], sample_rate: int, gap_ms: int) -> np.ndarray:
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    gap = np.zeros(int(sample_rate * gap_ms / 1000.0), dtype=np.float32)
    pieces: list[np.ndarray] = []
    for index, chunk in enumerate(chunks):
        pieces.append(to_float32(chunk))
        if index < len(chunks) - 1 and gap.size:
            pieces.append(gap)
    return np.concatenate(pieces)


def write_master_wav(path: Path, audio: np.ndarray, sample_rate: int) -> Path:
    """Write 44.1kHz 24-bit PCM, same master format as packed clip downloads."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = to_float32(audio)
    if int(sample_rate) != OUTPUT_SAMPLE_RATE:
        raw = path.with_name(f".{path.name}.master.raw.wav")
        try:
            sf.write(str(raw), audio, int(sample_rate), format="WAV", subtype="PCM_24")
            return resample_for_video(raw, path)
        finally:
            raw.unlink(missing_ok=True)
    sf.write(str(path), audio, OUTPUT_SAMPLE_RATE, format="WAV", subtype="PCM_24")
    return path


def concat_wav_files(paths: list[Path], dest: Path, gap_ms: int = 400) -> Path:
    """Join packed clip WAVs into one 24-bit track without a 16-bit round trip."""
    clips = [Path(path) for path in paths if Path(path).exists()]
    if not clips:
        raise FileNotFoundError("No clips to concatenate")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if len(clips) == 1:
        if dest.resolve() != clips[0].resolve():
            shutil.copy2(clips[0], dest)
        return dest
    chunks: list[np.ndarray] = []
    sample_rate = OUTPUT_SAMPLE_RATE
    for path in clips:
        data, rate = sf.read(str(path), dtype="float32", always_2d=False)
        sample_rate = int(rate) or sample_rate
        chunks.append(to_float32(np.asarray(data).reshape(-1)))
    audio = concat_with_gap(chunks, sample_rate, gap_ms)
    return write_master_wav(dest, audio, sample_rate)


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, to_float32(audio), sample_rate, subtype="PCM_16")
    return path


def encode_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, to_float32(audio), sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def resample_for_video(src: Path, dst: Path, sample_rate: int = OUTPUT_SAMPLE_RATE) -> Path:
    """Resample to 44.1kHz 24-bit PCM for NLE download. Browser preview is converted separately."""
    ffmpeg = ffmpeg_bin()
    if ffmpeg is None:
        shutil.copy2(src, dst)
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "-c:a",
            "pcm_s24le",
            str(dst),
        ],
        check=True,
        capture_output=True,
    )
    return dst


def convert_format(src: Path, fmt: str) -> tuple[bytes, str]:
    fmt = (fmt or "wav").lower()
    if fmt == "wav":
        return src.read_bytes(), "audio/wav"

    ffmpeg = ffmpeg_bin()
    if ffmpeg is None:
        return src.read_bytes(), "audio/wav"

    suffix = {"mp3": ".mp3", "flac": ".flac", "opus": ".opus", "aac": ".aac"}.get(fmt, f".{fmt}")
    media_type = {
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
        "opus": "audio/opus",
        "aac": "audio/aac",
        "pcm": "audio/pcm",
    }.get(fmt, f"audio/{fmt}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        out_path = Path(tmp.name)
    try:
        cmd = [ffmpeg, "-y", "-i", str(src)]
        if fmt == "pcm":
            cmd += ["-f", "s16le", "-acodec", "pcm_s16le", str(out_path)]
        else:
            cmd += [str(out_path)]
        subprocess.run(cmd, check=True, capture_output=True)
        return out_path.read_bytes(), media_type
    finally:
        out_path.unlink(missing_ok=True)


def browser_wav(path: Path) -> Path:
    """Return a 16-bit PCM WAV path. HTML5 audio cannot play 24-bit files."""
    path = Path(path)
    try:
        info = sf.info(str(path))
    except Exception:
        return path
    subtype = str(getattr(info, "subtype", "") or "").upper()
    if subtype in {"PCM_16", "PCM_S16"}:
        return path
    preview = path.with_name(f"{path.stem}.browser.wav")
    if preview.exists() and preview.stat().st_mtime >= path.stat().st_mtime:
        return preview
    audio, rate = sf.read(str(path), dtype="float32")
    sf.write(str(preview), audio, rate, format="WAV", subtype="PCM_16")
    return preview


def probe_duration(path: Path) -> float:
    info = sf.info(str(path))
    return float(info.frames) / float(info.samplerate)


def is_master_wav(path: Path) -> bool:
    try:
        info = sf.info(str(path))
    except Exception:
        return False
    subtype = str(getattr(info, "subtype", "") or "").upper()
    return int(info.samplerate) == OUTPUT_SAMPLE_RATE and "24" in subtype


def _is_pcm_wav(path: Path) -> bool:
    try:
        info = sf.info(str(path))
    except Exception:
        return False
    fmt = str(getattr(info, "format", "") or "").upper()
    subtype = str(getattr(info, "subtype", "") or "").upper()
    return fmt == "WAV" and subtype.startswith("PCM")


def ensure_pcm_wav(src: Path | str, dst: Path | None = None, sample_rate: int = 24000) -> Path:
    src = Path(src)
    if not src.exists():
        raise FileNotFoundError(f"Reference audio not found: {src}")
    dst = Path(dst) if dst is not None else src.with_name(f"{src.stem}.pcm.wav")
    if _is_pcm_wav(src) and dst.resolve() == src.resolve():
        return src
    ffmpeg = ffmpeg_bin()
    if ffmpeg is None:
        if _is_pcm_wav(src):
            if dst.resolve() != src.resolve():
                shutil.copy2(src, dst)
                return dst
            return src
        raise RuntimeError("Reference audio is not WAV. Install ffmpeg or upload a WAV file.")
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{dst.name}.tmp.wav")
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(src),
                "-ar",
                str(sample_rate),
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(tmp),
            ],
            check=True,
            capture_output=True,
        )
        tmp.replace(dst)
    except subprocess.CalledProcessError as exc:
        tmp.unlink(missing_ok=True)
        detail = (exc.stderr or exc.stdout or b"").decode("utf-8", "ignore")[-400:]
        raise RuntimeError(f"Could not convert reference audio to WAV. {detail}".strip()) from exc
    return dst
