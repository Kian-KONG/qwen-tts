from __future__ import annotations

import re

from .config import LANGUAGE_BY_ID, MAX_CHUNK_CHARS

_ABBREVIATIONS = {
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "sr.",
    "jr.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "u.s.",
    "u.k.",
    "inc.",
    "ltd.",
    "st.",
    "ave.",
}

_SENTENCE_END = re.compile(r"([.!?…。！？]+)([\"'」』）)\]]*)")
_WHITESPACE = re.compile(r"[^\S\n]+")
_CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_NUMBER_MARK = re.compile(
    r"^\s*(?:(?:\d{1,3}[\.\)、:：])|(?:[\(（]\d{1,3}[\)）]))\s*"
)
_INLINE_NUMBER = re.compile(
    r"(?:(?<=\s)|(?<=^))(?:\d{1,3}[\.\)、:：]|[\(（]\d{1,3}[\)）])\s+"
)


def language_meta(language: str) -> dict:
    return LANGUAGE_BY_ID.get(language, LANGUAGE_BY_ID["Auto"])


def is_cjk_language(language: str) -> bool:
    return language_meta(language)["script"] == "cjk"


def max_chars_for(language: str, override: int | None = None) -> int:
    if override and override > 0:
        return override
    if MAX_CHUNK_CHARS > 0:
        return MAX_CHUNK_CHARS
    return 80 if is_cjk_language(language) else 220


def split_script(text: str, language: str = "Auto", max_chars: int | None = None) -> list[str]:
    """Prefer numbered-list items; otherwise one non-empty line is one clip."""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return []

    cleaned = _break_inline_numbers(cleaned)

    numbered = _split_numbered(cleaned)
    if numbered:
        return numbered

    limit = max_chars_for(language, max_chars)
    tiny = 12 if is_cjk_language(language) else 24
    lines = [_WHITESPACE.sub(" ", line).strip() for line in cleaned.split("\n")]
    lines = [line for line in lines if line]

    pieces: list[str] = []
    for line in lines:
        if len(line) <= limit:
            pieces.append(line)
            continue
        sentences = _split_sentences(line)
        for sentence in sentences:
            if len(sentence) <= limit:
                pieces.append(sentence)
            else:
                pieces.extend(_split_long(sentence, limit))

    # Only glue fragments that came from a single paragraph. Separate lines stay separate clips.
    if len(lines) == 1:
        return _merge_tiny(pieces, tiny)
    return [item for item in pieces if item]


def preview_segments(text: str, language: str = "Auto") -> list[dict]:
    chunks = split_script(text, language)
    return [{"index": i + 1, "text": chunk, "chars": len(chunk)} for i, chunk in enumerate(chunks)]


def to_numbered_script(items: list[str]) -> str:
    lines = []
    for index, item in enumerate(items, start=1):
        body = item.strip()
        if body:
            lines.append(f"{index}. {body}")
    return "\n".join(lines)


def _break_inline_numbers(text: str) -> str:
    """Turn '1. foo 2. bar' on one line into two numbered lines."""
    rebuilt: list[str] = []
    for raw in text.split("\n"):
        marks = list(_INLINE_NUMBER.finditer(raw))
        if len(marks) < 2:
            rebuilt.append(raw)
            continue
        for index, match in enumerate(marks):
            end = marks[index + 1].start() if index + 1 < len(marks) else len(raw)
            piece = raw[match.start() : end].strip()
            if piece:
                rebuilt.append(piece)
    return "\n".join(rebuilt)


def _split_numbered(text: str) -> list[str]:
    items: list[str] = []
    current: str | None = None
    saw_mark = False
    for raw in text.split("\n"):
        match = _NUMBER_MARK.match(raw)
        if match:
            saw_mark = True
            if current is not None and current.strip():
                items.append(current.strip())
            current = raw[match.end() :]
            continue
        if current is None:
            continue
        extra = raw.strip()
        if extra:
            joiner = "" if _CJK.search(extra) or _CJK.search(current) else " "
            current = f"{current.rstrip()}{joiner}{extra}"
    if current is not None and current.strip():
        items.append(current.strip())
    if saw_mark and items:
        return items
    return []


def _split_sentences(paragraph: str) -> list[str]:
    sentences: list[str] = []
    start = 0
    for match in _SENTENCE_END.finditer(paragraph):
        token = paragraph[start : match.end()].strip()
        lookbehind = paragraph[max(start, match.start() - 12) : match.start() + 1].lower()
        word = lookbehind.rsplit(" ", 1)[-1]
        if word in _ABBREVIATIONS:
            continue
        if token:
            sentences.append(token)
        start = match.end()
    tail = paragraph[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences or [paragraph]


def _split_long(text: str, max_chars: int) -> list[str]:
    parts = re.split(r"(?<=[,:;，、；])\s*", text)
    packed: list[str] = []
    current = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        extra = part if not current else f"{current} {part}" if not _CJK.search(part) else f"{current}{part}"
        if current and len(extra) > max_chars:
            packed.append(current)
            current = part
        else:
            current = extra
    if current:
        packed.append(current)
    return packed or [text]


def _merge_tiny(pieces: list[str], tiny: int) -> list[str]:
    merged: list[str] = []
    complete = re.compile(r"[.!?…。！？][\"'」』）)\]]*$")
    for piece in pieces:
        if merged and len(piece) <= tiny and not complete.search(piece):
            prev = merged[-1]
            joiner = "" if _CJK.search(piece) or _CJK.search(prev) else " "
            merged[-1] = f"{prev}{joiner}{piece}"
        else:
            merged.append(piece)
    return [item for item in merged if item]
