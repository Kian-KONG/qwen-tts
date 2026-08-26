from __future__ import annotations

import io
import zipfile
from pathlib import Path

from .audio_util import concat_wav_files, is_master_wav, is_packable_clip, probe_duration
from .config import GAP_MS, OUTPUT_DIR


def job_folder(job_id: str) -> Path:
    return OUTPUT_DIR / job_id


def clip_paths_for_full(job_id: str, segments: list[dict]) -> list[Path]:
    folder = job_folder(job_id)
    clips: list[Path] = []
    seen: set[str] = set()
    first_voice: str | None = None
    for item in segments:
        path = Path(item.get("path") or "")
        if not path.exists():
            name = str(item.get("filename") or "")
            if name:
                path = folder / name
        if not path.exists() or not is_packable_clip(path.name):
            continue
        voice = str(item.get("voice_id") or item.get("voice") or "")
        if first_voice is None:
            first_voice = voice
        elif voice and first_voice and voice != first_voice:
            continue
        key = str(path.resolve())
        if key in seen:
            continue
        seen.add(key)
        clips.append(path)
    if not clips and folder.is_dir():
        for path in sorted(folder.glob("*.wav")):
            if not is_packable_clip(path.name):
                continue
            clips.append(path)
    return clips


def full_wav(job_id: str, segments: list[dict]) -> Path:
    folder = job_folder(job_id)
    dest = folder / "full.wav"
    marker = folder / ".full.clips24"
    clips = clip_paths_for_full(job_id, segments)
    if len(clips) > 1:
        rebuild = True
        if dest.exists() and marker.exists() and is_master_wav(dest):
            try:
                full_dur = probe_duration(dest)
                clip_dur = sum(probe_duration(path) for path in clips)
                newest = max(path.stat().st_mtime for path in clips)
                rebuild = full_dur < clip_dur * 0.5 or marker.stat().st_mtime < newest
            except Exception:
                rebuild = True
        if rebuild:
            concat_wav_files(clips, dest, gap_ms=GAP_MS)
            marker.touch()
        return dest
    if dest.exists():
        return dest
    if clips:
        return clips[0]
    raise FileNotFoundError(job_id)


def segment_wav(job_id: str, index: int, segments: list[dict]) -> tuple[Path, str]:
    for item in segments:
        if int(item.get("index") or 0) != index:
            continue
        path = Path(item.get("path") or "")
        if path.exists():
            return path, str(item.get("filename") or path.name)
    path = job_folder(job_id) / f"seg_{index:03d}.wav"
    if path.exists():
        return path, path.name
    raise FileNotFoundError(f"segment {index}")


def track_wav(job_id: str, index: int, tracks: list[dict]) -> tuple[Path, str]:
    for item in tracks:
        if int(item.get("index") or 0) != index:
            continue
        path = Path(item.get("path") or "")
        if path.exists():
            return path, str(item.get("filename") or path.name)
    raise FileNotFoundError(f"track {index}")


def zip_bytes(job_id: str, segments: list[dict]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        added: set[str] = set()
        for item in segments:
            path = Path(item.get("path") or "")
            name = str(item.get("filename") or path.name)
            if path.exists() and name not in added and is_packable_clip(name):
                archive.write(path, name)
                added.add(name)
        folder = job_folder(job_id)
        if folder.is_dir():
            for path in sorted(folder.glob("*.wav")):
                if not is_packable_clip(path.name) or path.name in added:
                    continue
                archive.write(path, path.name)
                added.add(path.name)
        if not added:
            raise FileNotFoundError(job_id)
    return buffer.getvalue()
