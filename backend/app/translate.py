from __future__ import annotations

import re
import threading

from .config import INSTRUCT_MODEL_DIR, INSTRUCT_MODEL_ID, LANGUAGE_BY_ID
from .engine import engine
from .paths import is_local_model_dir

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class InstructEngine:
    def __init__(self) -> None:
        self.model = None
        self.tokenizer = None
        self.loaded = False
        self.model_path = str(
            INSTRUCT_MODEL_DIR if is_local_model_dir(INSTRUCT_MODEL_DIR) else INSTRUCT_MODEL_ID
        )
        self.lock = threading.Lock()

    def ready(self) -> bool:
        return is_local_model_dir(INSTRUCT_MODEL_DIR)

    def unload_unlocked(self) -> None:
        if self.model is None and not self.loaded:
            return
        self.model = None
        self.tokenizer = None
        self.loaded = False
        import gc
        import mlx.core as mx

        gc.collect()
        mx.clear_cache()

    def _load_unlocked(self) -> None:
        if self.loaded and self.model is not None:
            return
        if not is_local_model_dir(INSTRUCT_MODEL_DIR):
            raise FileNotFoundError("Qwen3 Instruct model is missing. Run: make download-instruct")
        from mlx_lm import load
        from .kokoro import kokoro_engine

        engine.unload_unlocked()
        with kokoro_engine.lock:
            kokoro_engine.unload_unlocked()
        self.unload_unlocked()
        self.model_path = str(INSTRUCT_MODEL_DIR)
        self.model, self.tokenizer = load(self.model_path)
        self.loaded = True

    def load(self) -> None:
        with engine.lock:
            with self.lock:
                engine.unload_unlocked()
                self._load_unlocked()

    def translate(self, text: str, *, source_language: str, target_language: str) -> str:
        source = (text or "").strip()
        if not source:
            return ""
        src = LANGUAGE_BY_ID.get(source_language, LANGUAGE_BY_ID["Auto"])
        dst = LANGUAGE_BY_ID.get(target_language, LANGUAGE_BY_ID["English"])
        src_label = src["label"] if src["id"] != "Auto" else "源语言"
        dst_label = dst["label"]
        if dst["id"] != "Auto" and src["id"] == dst["id"]:
            return source
        prompt = (
            f"将下面这段{src_label}口语转写成{dst_label}字幕。"
            "只输出译文，不要解释，不要引号，不要原文。\n\n"
            f"{source}"
        )
        with engine.lock:
            with self.lock:
                self._load_unlocked()
                from mlx_lm import generate

                messages = [{"role": "user", "content": prompt}]
                try:
                    chat = self.tokenizer.apply_chat_template(
                        messages,
                        add_generation_prompt=True,
                        enable_thinking=False,
                    )
                except TypeError:
                    chat = self.tokenizer.apply_chat_template(messages, add_generation_prompt=True)
                raw = generate(
                    self.model,
                    self.tokenizer,
                    prompt=chat,
                    max_tokens=256,
                    verbose=False,
                )
        return _clean_translation(raw)


def _clean_translation(text: str) -> str:
    value = _THINK.sub("", text or "")
    value = value.replace("<think>", "").replace("</think>", "")
    return value.strip().strip('"“”')


instruct_engine = InstructEngine()
