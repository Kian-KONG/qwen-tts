from __future__ import annotations

import tempfile
import threading
from pathlib import Path

from .asr import asr_engine, asr_runner
from .config import LANGUAGE_BY_ID
from .engine import JobCancelled, engine
from .translate import instruct_engine


class LiveTranslateSession:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active = False
        self.source_language = "Auto"
        self.target_language = "English"

    def start(self, source_language: str, target_language: str) -> dict:
        src = source_language if source_language in LANGUAGE_BY_ID else "Auto"
        dst = target_language if target_language in LANGUAGE_BY_ID else "English"
        if dst == "Auto":
            dst = "English"
        from .jobs import runner

        with self.lock:
            if self.active:
                raise RuntimeError("实时翻译已在进行")
            if runner.busy() or asr_runner.busy():
                raise RuntimeError("配音或转写正在进行，请先结束再开实时翻译")
            if not asr_engine.ready():
                raise FileNotFoundError("Qwen3-ASR model is missing. Run: make download-asr")
            if not instruct_engine.ready():
                raise FileNotFoundError("Qwen3 Instruct model is missing. Run: make download-instruct")
            self.source_language = src
            self.target_language = dst
            self.active = True
        try:
            with engine.lock:
                engine.unload_unlocked()
                with asr_engine.lock:
                    asr_engine._load_unlocked()
                with instruct_engine.lock:
                    instruct_engine._load_unlocked()
        except Exception:
            with self.lock:
                self.active = False
            raise
        return {
            "ok": True,
            "active": True,
            "source_language": src,
            "target_language": dst,
            "asr_loaded": asr_engine.loaded,
            "instruct_loaded": instruct_engine.loaded,
        }

    def stop(self) -> dict:
        with self.lock:
            self.active = False
            with engine.lock:
                instruct_engine.unload_unlocked()
            return {"ok": True, "active": False}

    def process_chunk(self, audio_path: str) -> dict:
        with self.lock:
            if not self.active:
                raise RuntimeError("实时翻译未开始")
            src_lang = self.source_language
            dst_lang = self.target_language
        src = Path(audio_path)
        pcm = src.with_name(f"{src.stem}.pcm.wav")
        heard = ""
        try:
            result = asr_engine.transcribe(str(src), language=src_lang)
            heard = str(result.get("text") or "").strip()
        except JobCancelled:
            raise
        except (ValueError, FileNotFoundError):
            heard = ""
        except Exception:
            heard = ""
        finally:
            src.unlink(missing_ok=True)
            if pcm.exists() and pcm.resolve() != src.resolve():
                pcm.unlink(missing_ok=True)
        if not heard:
            return {"source_text": "", "target_text": "", "skipped": True}
        if src_lang != "Auto" and src_lang == dst_lang:
            translated = heard
        else:
            translated = instruct_engine.translate(
                heard, source_language=src_lang, target_language=dst_lang
            )
        return {
            "source_text": heard,
            "target_text": translated,
            "skipped": False,
            "source_language": src_lang,
            "target_language": dst_lang,
        }


def save_upload(data: bytes, suffix: str = ".webm") -> str:
    handle = tempfile.NamedTemporaryFile(suffix=suffix or ".webm", delete=False)
    handle.write(data)
    handle.close()
    return handle.name


live_session = LiveTranslateSession()
