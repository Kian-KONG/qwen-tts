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
INSTRUCT_MODEL_ID = os.getenv(
    "QWEN_INSTRUCT_MODEL_ID",
    "mlx-community/Qwen3-1.7B-bf16",
)
INSTRUCT_MODEL_DIR = Path(
    os.getenv("QWEN_INSTRUCT_MODEL", ROOT / "models" / "qwen3-instruct")
).resolve()
KOKORO_MODEL_ID = os.getenv("QWEN_KOKORO_MODEL_ID", "mlx-community/Kokoro-82M-bf16")
KOKORO_MODEL_DIR = Path(os.getenv("QWEN_KOKORO_MODEL", ROOT / "models" / "kokoro")).resolve()
DEFAULT_KOKORO_VOICE = os.getenv("QWEN_KOKORO_VOICE", "af_heart")
# Kokoro v1.1-zh is a separate checkpoint with its own vocabulary (Zhuyin tokens),
# so it lives beside the English model instead of replacing it.
KOKORO_ZH_MODEL_ID = os.getenv("QWEN_KOKORO_ZH_MODEL_ID", "hexgrad/Kokoro-82M-v1.1-zh")
KOKORO_ZH_MODEL_DIR = Path(
    os.getenv("QWEN_KOKORO_ZH_MODEL", ROOT / "models" / "kokoro-zh")
).resolve()
DEFAULT_KOKORO_ZH_VOICE = os.getenv("QWEN_KOKORO_ZH_VOICE", "zf_001")
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
KOKORO_VOICES = [
    {"id": "af_heart", "label": "Heart", "native": "US", "description": "默认女声，适合旁白", "family": "en"},
    {"id": "af_bella", "label": "Bella", "native": "US", "description": "清晰美式女声", "family": "en"},
    {"id": "af_nicole", "label": "Nicole", "native": "US", "description": "沉稳美式女声", "family": "en"},
    {"id": "af_sarah", "label": "Sarah", "native": "US", "description": "柔和美式女声", "family": "en"},
    {"id": "af_sky", "label": "Sky", "native": "US", "description": "年轻美式女声", "family": "en"},
    {"id": "af_aoede", "label": "Aoede", "native": "US", "description": "明亮美式女声", "family": "en"},
    {"id": "am_adam", "label": "Adam", "native": "US", "description": "沉稳美式男声", "family": "en"},
    {"id": "am_michael", "label": "Michael", "native": "US", "description": "标准美式男声", "family": "en"},
    {"id": "am_eric", "label": "Eric", "native": "US", "description": "自然美式男声", "family": "en"},
    {"id": "am_liam", "label": "Liam", "native": "US", "description": "年轻美式男声", "family": "en"},
    {"id": "am_puck", "label": "Puck", "native": "US", "description": "轻快美式男声", "family": "en"},
    {"id": "bf_emma", "label": "Emma", "native": "UK", "description": "清晰英式女声", "family": "en"},
    {"id": "bf_isabella", "label": "Isabella", "native": "UK", "description": "柔和英式女声", "family": "en"},
    {"id": "bf_alice", "label": "Alice", "native": "UK", "description": "利落英式女声", "family": "en"},
    {"id": "bm_george", "label": "George", "native": "UK", "description": "沉稳英式男声", "family": "en"},
    {"id": "bm_daniel", "label": "Daniel", "native": "UK", "description": "标准英式男声", "family": "en"},
    {"id": "bm_lewis", "label": "Lewis", "native": "UK", "description": "自然英式男声", "family": "en"},
]

# Kokoro-82M-v1.1-zh ships 100 Chinese voices in one checkpoint (plus 3 English
# ones trained in the same run). Ids are upstream; the number carries no meaning,
# so the label shows gender + number and users audition with the preview button.
_KOKORO_ZH_FEMALE = (
    "001 002 003 004 005 006 007 008 017 018 019 021 022 023 024 026 027 028 "
    "032 036 038 039 040 042 043 044 046 047 048 049 051 059 060 067 070 071 "
    "072 073 074 075 076 077 078 079 083 084 085 086 087 088 090 092 093 094 099"
).split()
_KOKORO_ZH_MALE = (
    "009 010 011 012 013 014 015 016 020 025 029 030 031 033 034 035 037 041 "
    "045 050 052 053 054 055 056 057 058 061 062 063 064 065 066 068 069 080 "
    "081 082 089 091 095 096 097 098 100"
).split()
# Voices used by the upstream v1.1-zh samples, surfaced first in the UI.
KOKORO_ZH_HIGHLIGHT = {"zf_001", "zm_010"}

KOKORO_ZH_VOICES = [
    {
        "id": f"zf_{number}",
        "label": f"女声 {number}",
        "native": "CN",
        "description": "中文女声，官方示例音色" if f"zf_{number}" in KOKORO_ZH_HIGHLIGHT else "",
        "family": "zh",
        "recommended": f"zf_{number}" in KOKORO_ZH_HIGHLIGHT,
    }
    for number in _KOKORO_ZH_FEMALE
] + [
    {
        "id": f"zm_{number}",
        "label": f"男声 {number}",
        "native": "CN",
        "description": "中文男声，官方示例音色" if f"zm_{number}" in KOKORO_ZH_HIGHLIGHT else "",
        "family": "zh",
        "recommended": f"zm_{number}" in KOKORO_ZH_HIGHLIGHT,
    }
    for number in _KOKORO_ZH_MALE
] + [
    # English voices trained in the v1.1-zh run. `family` is the *language* (they
    # read English and belong in the English group); `model` is the *checkpoint*
    # they were trained with, which is v1.1-zh and not interchangeable with v1.0.
    {"id": "af_maple", "label": "Maple", "native": "US", "description": "美式女声，v1.1-zh 自带", "family": "en", "model": "kokoro-zh"},
    {"id": "af_sol", "label": "Sol", "native": "US", "description": "美式女声，v1.1-zh 自带", "family": "en", "model": "kokoro-zh"},
    {"id": "bf_vale", "label": "Vale", "native": "UK", "description": "英式女声，v1.1-zh 自带", "family": "en", "model": "kokoro-zh"},
]

# Every voice records which checkpoint its style vector was trained with, so the
# loader can pick the right weights even when the language and the checkpoint
# disagree (the 3 English voices above).
for _voice in KOKORO_VOICES:
    _voice.setdefault("model", "kokoro")
for _voice in KOKORO_ZH_VOICES:
    _voice.setdefault("model", "kokoro-zh")

KOKORO_VOICE_BY_ID = {item["id"]: item for item in KOKORO_VOICES + KOKORO_ZH_VOICES}
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
    INSTRUCT_MODEL_DIR.parent,
    KOKORO_MODEL_DIR.parent,
):
    path.mkdir(parents=True, exist_ok=True)
