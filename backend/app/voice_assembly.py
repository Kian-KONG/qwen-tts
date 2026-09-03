from __future__ import annotations

import json
from typing import Optional

from . import voices
from .config import DEFAULT_KOKORO_VOICE, DEFAULT_SPEAKER, KOKORO_VOICE_BY_ID, SPEAKER_BY_ID
from .kokoro import parse_blend_weights, require_same_gender


def parse_id_list(*values: Optional[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if not value:
            continue
        for item in str(value).replace(";", ",").split(","):
            token = item.strip()
            if token and token not in seen:
                seen.append(token)
    return seen


def preset_voices(ids: list[str]) -> list[dict]:
    result = []
    for speaker_id in ids:
        if speaker_id not in SPEAKER_BY_ID:
            raise ValueError(f"Unknown speaker: {speaker_id}")
        result.append({"id": speaker_id, "name": SPEAKER_BY_ID[speaker_id]["label"], "kind": "preset"})
    return result


def design_voices(raw: Optional[str], instruct: Optional[str]) -> list[dict]:
    items: list[dict] = []
    parsed = []
    if raw and raw.strip():
        try:
            loaded = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid designs JSON: {exc}") from exc
        parsed = loaded if isinstance(loaded, list) else [loaded]
    for index, item in enumerate(parsed):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("instruct") or item.get("text") or "").strip()
        if not prompt:
            continue
        name = str(item.get("name") or "").strip() or f"描述音色 {index + 1}"
        items.append(
            {
                "id": str(item.get("id") or f"design-{index + 1}"),
                "name": name,
                "kind": "design",
                "instruct": prompt,
            }
        )
    if not items and (instruct or "").strip():
        items.append({"id": "design", "name": "描述音色", "kind": "design", "instruct": instruct.strip()})
    return items


def clone_voices(ids: list[str], ref_audio: str = "", ref_text: str = "") -> list[dict]:
    if ids:
        result = []
        for voice_id in ids:
            profile = voices.get_voice(voice_id)
            result.append(
                {
                    "id": profile["id"],
                    "name": profile.get("name") or profile["id"],
                    "kind": "clone",
                    "ref_audio": profile["ref_audio"],
                    "ref_text": profile["ref_text"],
                }
            )
        return result
    if ref_audio and ref_text:
        return [{"id": "clone", "name": "克隆", "kind": "clone", "ref_audio": ref_audio, "ref_text": ref_text}]
    raise ValueError("Select a saved clone voice or upload reference audio")


def kokoro_voices(ids: list[str], *, blend: bool = False, weights=None) -> list[dict]:
    result = []
    for voice_id in ids:
        if voice_id not in KOKORO_VOICE_BY_ID:
            raise ValueError(f"Unknown Kokoro voice: {voice_id}")
        meta = KOKORO_VOICE_BY_ID[voice_id]
        result.append({"id": voice_id, "name": meta["label"], "kind": "kokoro"})
    if blend and len(result) >= 2:
        selected = [item["id"] for item in result]
        require_same_gender(selected)
        parsed = parse_blend_weights(selected, weights)
        labels = [item["name"] for item in result]
        return [
            {
                "id": ",".join(selected),
                "name": " + ".join(labels),
                "kind": "kokoro",
                "blend": True,
                "voices": selected,
                "weights": parsed,
            }
        ]
    return result


def assemble_job_voices(
    mode: str,
    *,
    speakers: Optional[str] = None,
    speaker: Optional[str] = None,
    voice_id: Optional[str] = None,
    voice_ids: Optional[str] = None,
    designs: Optional[str] = None,
    instruct: Optional[str] = None,
    style_instruct: Optional[str] = None,
    ref_audio: str = "",
    ref_text: str = "",
    blend: bool = False,
    blend_weights=None,
) -> tuple[str, list[dict], str, str, str, str]:
    if mode == "kokoro":
        ids = parse_id_list(speakers, speaker, voice_id)
        job_voices = kokoro_voices(ids or [DEFAULT_KOKORO_VOICE], blend=blend, weights=blend_weights)
        first = job_voices[0]
        speaker_id = str((first.get("voices") or [first["id"]])[0])
        return "kokoro", job_voices, speaker_id, "", "", ""

    preset_ids = parse_id_list(speakers, speaker)
    clone_ids = parse_id_list(voice_ids)
    if voice_id:
        if voice_id in SPEAKER_BY_ID and mode == "preset" and voice_id not in preset_ids:
            preset_ids.append(voice_id)
        elif voice_id not in SPEAKER_BY_ID and voice_id not in clone_ids:
            clone_ids.append(voice_id)

    style = (style_instruct or "").strip()
    if mode == "preset" and not style:
        style = (instruct or "").strip()

    job_voices: list[dict] = []
    for item in preset_voices(preset_ids):
        if style:
            item["style"] = style
        job_voices.append(item)
    if mode == "design":
        job_voices.extend(design_voices(designs, instruct))
    elif mode == "mixed":
        job_voices.extend(design_voices(designs if designs is not None else None, None))
    else:
        job_voices.extend(design_voices(designs, None))

    audio_path, transcript = "", ""
    if clone_ids or ref_audio:
        clones = clone_voices(clone_ids, ref_audio, ref_text)
        job_voices.extend(clones)
        audio_path = str(clones[0]["ref_audio"])
        transcript = str(clones[0]["ref_text"])

    if not job_voices:
        if mode == "design":
            raise ValueError("instruct is required for described voices")
        if mode == "clone":
            raise ValueError("Select a saved clone voice or upload reference audio")
        job_voices = preset_voices([DEFAULT_SPEAKER])

    kinds = list(dict.fromkeys(str(item.get("kind")) for item in job_voices))
    job_mode = kinds[0] if len(kinds) == 1 else "mixed"
    speaker_id = next((str(item["id"]) for item in job_voices if item.get("kind") == "preset"), "")
    description = next(
        (str(item.get("instruct") or "") for item in job_voices if item.get("kind") == "design"),
        (instruct or style or ""),
    )
    return job_mode, job_voices, speaker_id, audio_path, transcript, description
