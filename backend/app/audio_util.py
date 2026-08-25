from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .config import OUTPUT_SAMPLE_RATE


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
