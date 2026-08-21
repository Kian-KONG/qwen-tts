from __future__ import annotations

import re

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

_SENTENCE_END = re.compile(r"([.!?]+)([\"')\]]*)(\s+|$)")
_WHITESPACE = re.compile(r"\s+")


def split_script(text: str, max_chars: int = 240) -> list[str]:
    """Split English narration into sentence-sized chunks for batch TTS."""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return []

    sentences: list[str] = []
    for paragraph in re.split(r"\n\s*\n+", cleaned):
        paragraph = _WHITESPACE.sub(" ", paragraph).strip()
        if paragraph:
            sentences.extend(_split_sentences(paragraph))

    packed = _pack(sentences, max_chars)
    expanded: list[str] = []
    for chunk in packed:
        if len(chunk) <= max_chars * 2:
            expanded.append(chunk)
        else:
            expanded.extend(_split_long(chunk, max_chars))
    return [item for item in expanded if item]


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


def _pack(sentences: list[str], max_chars: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        extra = len(sentence) + (1 if current else 0)
        if current and current_len + extra > max_chars:
            chunks.append(" ".join(current))
            current = [sentence]
            current_len = len(sentence)
        else:
            current.append(sentence)
            current_len += extra
    if current:
        chunks.append(" ".join(current))
    return chunks


def _split_long(text: str, max_chars: int) -> list[str]:
    parts = re.split(r"(?<=[,:;])\s+", text)
    return _pack([part for part in parts if part], max_chars)
