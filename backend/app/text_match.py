from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from .audio_util import spoken_len

_STRIP = re.compile(r"[。！？.!?…，,、；;：:\s\"'“”‘’「」『』（）()\[\]【】·\-—_/\\]+")


def normalize_spoken(text: str) -> str:
    value = unicodedata.normalize("NFKC", text or "")
    value = value.casefold()
    value = _STRIP.sub("", value)
    return value.strip()


def texts_match(expected: str, heard: str) -> bool:
    want = normalize_spoken(expected)
    got = normalize_spoken(heard)
    if not want:
        return True
    if not got:
        return False
    if want == got:
        return True
    if spoken_len(expected) <= 12:
        return want == got
    if want in got and len(got) <= int(len(want) * 1.2) + 2:
        return True
    if got in want and len(got) >= int(len(want) * 0.85):
        return True
    return SequenceMatcher(None, want, got).ratio() >= 0.9
