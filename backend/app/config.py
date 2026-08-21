from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"

MODEL_ID = os.getenv(
    "QWEN_TTS_MODEL_ID",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
)
MODEL_DIR = Path(os.getenv("QWEN_TTS_MODEL", ROOT / "models" / "qwen3-tts")).resolve()
DESIGN_MODEL_ID = os.getenv(
    "QWEN_TTS_DESIGN_MODEL_ID",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
)
DESIGN_MODEL_DIR = Path(
    os.getenv("QWEN_TTS_DESIGN_MODEL", ROOT / "models" / "qwen3-tts-voice-design")
).resolve()
VOICES_DIR = Path(os.getenv("QWEN_TTS_VOICES", ROOT / "data" / "voices")).resolve()
OUTPUT_DIR = Path(os.getenv("QWEN_TTS_OUTPUT", ROOT / "data" / "output")).resolve()
FRONTEND_DIST = ROOT / "frontend" / "dist"

HOST = os.getenv("QWEN_TTS_HOST", "0.0.0.0")
PORT = int(os.getenv("QWEN_TTS_PORT", "8000"))
BATCH_SIZE = int(os.getenv("QWEN_TTS_BATCH_SIZE", "4"))
LANGUAGE = os.getenv("QWEN_TTS_LANGUAGE", "Auto")
OUTPUT_SAMPLE_RATE = int(os.getenv("QWEN_TTS_OUTPUT_SR", "44100"))
GAP_MS = int(os.getenv("QWEN_TTS_GAP_MS", "180"))
MAX_CHUNK_CHARS = int(os.getenv("QWEN_TTS_MAX_CHUNK_CHARS", "0"))
API_KEY = os.getenv("QWEN_TTS_API_KEY", "")

LANGUAGES = [
    {"id": "Auto", "label": "自动检测", "lang_code": "auto", "script": "mixed"},
    {"id": "Chinese", "label": "中文", "lang_code": "Chinese", "script": "cjk"},
    {"id": "English", "label": "English", "lang_code": "English", "script": "latin"},
    {"id": "Japanese", "label": "日本語", "lang_code": "Japanese", "script": "cjk"},
    {"id": "Korean", "label": "한국어", "lang_code": "Korean", "script": "cjk"},
    {"id": "German", "label": "Deutsch", "lang_code": "German", "script": "latin"},
    {"id": "French", "label": "Français", "lang_code": "French", "script": "latin"},
    {"id": "Spanish", "label": "Español", "lang_code": "Spanish", "script": "latin"},
    {"id": "Portuguese", "label": "Português", "lang_code": "Portuguese", "script": "latin"},
    {"id": "Italian", "label": "Italiano", "lang_code": "Italian", "script": "latin"},
    {"id": "Russian", "label": "Русский", "lang_code": "Russian", "script": "latin"},
]

LANGUAGE_BY_ID = {item["id"]: item for item in LANGUAGES}

for path in (VOICES_DIR, OUTPUT_DIR, MODEL_DIR.parent, DESIGN_MODEL_DIR.parent):
    path.mkdir(parents=True, exist_ok=True)
