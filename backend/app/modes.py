from __future__ import annotations


def parse_mode(mode: str | None, *, strict: bool = True) -> str:
    value = (mode or "preset").strip().lower()
    if value in {"design", "voice_design", "describe", "description"}:
        return "design"
    if value in {"preset", "custom", "custom_voice"}:
        return "preset"
    if value in {"mixed", "all", "multi"}:
        return "mixed"
    if value in {"clone", "base", "icl"}:
        return "clone"
    if value in {"kokoro", "kokoro-82m", "light", "light_en"}:
        return "kokoro"
    if strict:
        raise ValueError(f"Unsupported mode: {mode}")
    return "clone"
