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
VOICES_DIR = Path(os.getenv("QWEN_TTS_VOICES", ROOT / "data" / "voices")).resolve()
OUTPUT_DIR = Path(os.getenv("QWEN_TTS_OUTPUT", ROOT / "data" / "output")).resolve()
FRONTEND_DIST = ROOT / "frontend" / "dist"

HOST = os.getenv("QWEN_TTS_HOST", "0.0.0.0")
PORT = int(os.getenv("QWEN_TTS_PORT", "8000"))
BATCH_SIZE = int(os.getenv("QWEN_TTS_BATCH_SIZE", "4"))
LANGUAGE = os.getenv("QWEN_TTS_LANGUAGE", "English")
OUTPUT_SAMPLE_RATE = int(os.getenv("QWEN_TTS_OUTPUT_SR", "44100"))
GAP_MS = int(os.getenv("QWEN_TTS_GAP_MS", "180"))
MAX_CHUNK_CHARS = int(os.getenv("QWEN_TTS_MAX_CHUNK_CHARS", "240"))
API_KEY = os.getenv("QWEN_TTS_API_KEY", "")

for path in (VOICES_DIR, OUTPUT_DIR, MODEL_DIR.parent):
    path.mkdir(parents=True, exist_ok=True)
