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
CUSTOM_MODEL_ID = os.getenv(
    "QWEN_TTS_CUSTOM_MODEL_ID",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
)
CUSTOM_MODEL_DIR = Path(
    os.getenv("QWEN_TTS_CUSTOM_MODEL", ROOT / "models" / "qwen3-tts-custom-voice")
).resolve()
ASR_MODEL_ID = os.getenv(
    "QWEN_ASR_MODEL_ID",
    "mlx-community/Qwen3-ASR-1.7B-bf16",
)
ASR_MODEL_DIR = Path(os.getenv("QWEN_ASR_MODEL", ROOT / "models" / "qwen3-asr")).resolve()
VOICES_DIR = Path(os.getenv("QWEN_TTS_VOICES", ROOT / "data" / "voices")).resolve()
SCRIPTS_DIR = Path(os.getenv("QWEN_TTS_SCRIPTS", ROOT / "data" / "scripts")).resolve()
OUTPUT_DIR = Path(os.getenv("QWEN_TTS_OUTPUT", ROOT / "data" / "output")).resolve()
PREVIEW_DIR = Path(os.getenv("QWEN_TTS_PREVIEWS", ROOT / "data" / "previews" / "speakers")).resolve()
FRONTEND_DIST = ROOT / "frontend" / "dist"

HOST = os.getenv("QWEN_TTS_HOST", "0.0.0.0")
PORT = int(os.getenv("QWEN_TTS_PORT", "8000"))
BATCH_SIZE = int(os.getenv("QWEN_TTS_BATCH_SIZE", "4"))
LANGUAGE = os.getenv("QWEN_TTS_LANGUAGE", "Auto")
OUTPUT_SAMPLE_RATE = int(os.getenv("QWEN_TTS_OUTPUT_SR", "44100"))
GAP_MS = int(os.getenv("QWEN_TTS_GAP_MS", "400"))
MAX_CHUNK_CHARS = int(os.getenv("QWEN_TTS_MAX_CHUNK_CHARS", "0"))
API_KEY = os.getenv("QWEN_TTS_API_KEY", "")
TTS_TEMPERATURE = float(os.getenv("QWEN_TTS_TEMPERATURE", "0.3"))
TTS_SEED = int(os.getenv("QWEN_TTS_SEED", "42"))
TTS_TOP_P = float(os.getenv("QWEN_TTS_TOP_P", "0.9"))
TTS_REPETITION_PENALTY = float(os.getenv("QWEN_TTS_REPETITION_PENALTY", "1.05"))
STABLE_STYLE = os.getenv(
    "QWEN_TTS_STABLE_STYLE",
    "语速平稳，语气中性，不拖腔，句末利落，不要额外停顿。",
)
SILENCE_PAD_MS = int(os.getenv("QWEN_TTS_SILENCE_PAD_MS", "80"))
ATEMPO_MIN = float(os.getenv("QWEN_TTS_ATEMPO_MIN", "0.88"))
ATEMPO_MAX = float(os.getenv("QWEN_TTS_ATEMPO_MAX", "1.12"))
ATEMPO_SHORT_MIN = float(os.getenv("QWEN_TTS_ATEMPO_SHORT_MIN", "0.75"))
ATEMPO_SHORT_MAX = float(os.getenv("QWEN_TTS_ATEMPO_SHORT_MAX", "1.33"))

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

DEFAULT_SPEAKER = os.getenv("QWEN_TTS_SPEAKER", "Ryan")
SPEAKERS = [
    {"id": "Ryan", "label": "Ryan", "native": "English", "description": "节奏感强的男声"},
    {"id": "Aiden", "label": "Aiden", "native": "English", "description": "阳光美式男声"},
    {"id": "Vivian", "label": "Vivian", "native": "Chinese", "description": "明亮略带锋芒的年轻女声"},
    {"id": "Serena", "label": "Serena", "native": "Chinese", "description": "温暖柔和的年轻女声"},
    {"id": "Uncle_Fu", "label": "Uncle Fu", "native": "Chinese", "description": "低沉醇厚的成熟男声"},
    {"id": "Dylan", "label": "Dylan", "native": "Chinese", "description": "清晰自然的北京男声"},
    {"id": "Eric", "label": "Eric", "native": "Chinese", "description": "略带沙哑的成都男声"},
    {"id": "Ono_Anna", "label": "Ono Anna", "native": "Japanese", "description": "轻快灵动的日语女声"},
    {"id": "Sohee", "label": "Sohee", "native": "Korean", "description": "情感丰富的韩语女声"},
]
SPEAKER_BY_ID = {item["id"]: item for item in SPEAKERS}
SPEAKER_PREVIEW = {
    "English": ("Hello, this is a preview of my voice.", "English"),
    "Chinese": ("你好，这是我的声音试听。", "Chinese"),
    "Japanese": ("こんにちは。これは声のサンプルです。", "Japanese"),
    "Korean": ("안녕하세요, 제 목소리 미리듣기입니다.", "Korean"),
}

for path in (
    VOICES_DIR,
    SCRIPTS_DIR,
    OUTPUT_DIR,
    PREVIEW_DIR,
    MODEL_DIR.parent,
    DESIGN_MODEL_DIR.parent,
    CUSTOM_MODEL_DIR.parent,
    ASR_MODEL_DIR.parent,
):
    path.mkdir(parents=True, exist_ok=True)
