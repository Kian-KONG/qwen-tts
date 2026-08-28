from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from .asr import asr_engine
from .config import GAP_MS
from .engine import JobCancelled, engine
from .text_match import texts_match


def run_verify_round(
    *,
    stats: dict[str, Any],
    voices: list[dict],
    language: str,
    stable: bool,
    temperature: float,
    script_name: str,
    created_at: str | None,
    progress_cb: Callable[[float], None] | None = None,
    stage_cb: Callable[[str], None] | None = None,
    cancel_check=None,
    asr_lo: float = 0.55,
    asr_hi: float = 0.82,
    retake_hi: float = 1.0,
) -> dict[str, Any]:
    segments = list(stats.get("segments") or [])
    summary = {
        "enabled": True,
        "checked": 0,
        "mismatched": 0,
        "retaken": 0,
        "skipped": False,
        "reason": "",
    }
    if not segments:
        stats["verify"] = summary
        return stats
    if not asr_engine.ready():
        summary["skipped"] = True
        summary["reason"] = "ASR 未下载"
        stats["verify"] = summary
        return stats

    def mark(value: float) -> None:
        if progress_cb:
            progress_cb(min(1.0, max(0.0, value)))

    mismatches: list[dict] = []
    total = max(len(segments), 1)
    for index, segment in enumerate(segments):
        if cancel_check:
            cancel_check()
        mark(asr_lo + (asr_hi - asr_lo) * (index / total))
        path = str(segment.get("path") or "")
        heard = ""
        try:
            result = asr_engine.transcribe(path, language=language, cancel_check=cancel_check)
            heard = str(result.get("text") or "").strip()
        except JobCancelled:
            raise
        except ValueError:
            heard = ""
        except Exception as exc:
            if summary["checked"] == 0:
                summary["skipped"] = True
                summary["reason"] = str(exc)[:160] or "ASR 失败"
                stats["verify"] = summary
                return stats
            heard = ""
        expected = str(segment.get("text") or "")
        matched = texts_match(expected, heard)
        segment["asr_text"] = heard
        segment["match"] = matched
        segment["retaken"] = False
        summary["checked"] += 1
        if not matched:
            mismatches.append(segment)
            summary["mismatched"] += 1
        mark(asr_lo + (asr_hi - asr_lo) * ((index + 1) / total))

    if mismatches:
        if stage_cb:
            stage_cb("retake")
        mark(asr_hi)
        engine.retake_segments(
            stats=stats,
            voices=voices,
            mismatches=mismatches,
            language=language,
            stable=stable,
            temperature=temperature,
            script_name=script_name,
            created_at=created_at,
            progress_cb=lambda local: mark(asr_hi + (retake_hi - asr_hi) * local),
            cancel_check=cancel_check,
        )
        summary["retaken"] = sum(1 for item in mismatches if item.get("retaken"))
        _rebuild_tracks(stats)
    stats["verify"] = summary
    return stats


def _rebuild_tracks(stats: dict[str, Any]) -> None:
    segments = list(stats.get("segments") or [])
    tracks = list(stats.get("tracks") or [])
    by_voice: dict[str, list[Path]] = defaultdict(list)
    for segment in sorted(segments, key=lambda item: int(item.get("index") or 0)):
        path = Path(str(segment.get("path") or ""))
        name = str(segment.get("voice") or "")
        if path.exists() and name:
            by_voice[name].append(path)
    for track in tracks:
        name = str(track.get("voice") or "")
        clips = by_voice.get(name) or []
        dest = Path(str(track.get("path") or ""))
        if not clips or not dest.parent.exists():
            continue
        from . import audio_util

        audio_util.concat_wav_files(clips, dest, gap_ms=GAP_MS)
        track["duration_sec"] = round(audio_util.probe_duration(dest), 2)
    first = Path(tracks[0]["path"]) if tracks else None
    if first and first.exists():
        alias = first.parent / "full.wav"
        if alias.resolve() != first.resolve():
            import shutil

            shutil.copy2(first, alias)
        stats["output_path"] = str(alias if alias.exists() else first)
        duration = max((float(item.get("duration_sec") or 0) for item in tracks), default=0.0)
        if duration:
            stats["audio_sec"] = round(duration, 2)
