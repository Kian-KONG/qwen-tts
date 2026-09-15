#!/usr/bin/env python3
"""End-to-end check for the Chinese Kokoro (`kokoro-zh`) integration.

Four gates, cheapest first:

1. model artifacts — `models/kokoro-zh/{config.json,model.safetensors}` plus the
   default voice pack exist and no stale torch checkpoint is left behind.
2. voice routing — language (`family`) and checkpoint (`model`) resolve
   independently. They diverge for Maple/Sol/Vale, the English voices trained
   inside the v1.1-zh run, so a collapse of the two axes would send English text
   through the Chinese frontend without failing any single-voice test.
3. frontend alignment — the `module.` DataParallel prefix is stripped and every
   phoneme misaki's v1.1 `ZHG2P` emits is present in the checkpoint's vocab,
   otherwise `Model.__call__` silently drops it and syllables go missing.
4. round trip — synthesize through the real `KokoroEngine.synthesize()` path, then
   read the audio back with Qwen3-ASR and diff against the input text.

A passing run means the torch -> safetensors conversion, the G2P swap, the speed
curve and the voice routing all agree. Run inside the venv:

    mlx-tts-env/bin/python scripts/check_kokoro_zh.py
    mlx-tts-env/bin/python scripts/check_kokoro_zh.py --voice zm_010 --no-asr
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import struct
import sys
import tempfile
import time
import warnings
from pathlib import Path

warnings.simplefilter("ignore")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

DEFAULT_TEXT = "你好，这是中文语音合成测试。今天是2026年9月14日，气温25度。"
ENGLISH_TEXT = "Kokoro is a small but powerful text to speech model."


def ok(msg: str) -> None:
    print(f"  \033[32mPASS\033[0m {msg}")


def bad(msg: str) -> None:
    print(f"  \033[31mFAIL\033[0m {msg}")


def step(title: str) -> None:
    print(f"\n\033[1m{title}\033[0m")


def _must_raise(fn, arg) -> None:
    """Inverse assertion: `fn` has to reject `arg`, so the check passes when it does."""
    try:
        fn(arg)
    except ValueError:
        return
    raise AssertionError("expected a ValueError, got none")


def check_artifacts() -> bool:
    """Gate 1: converted weights and the default voice pack are on disk."""
    from app.config import KOKORO_ZH_MODEL_DIR
    from app.kokoro import default_voice, is_kokoro_zh_ready, kokoro_voice_path

    step("1. model artifacts")
    print(f"  dir: {KOKORO_ZH_MODEL_DIR}")
    passed = True

    for rel in ("config.json", "model.safetensors"):
        path = KOKORO_ZH_MODEL_DIR / rel
        if path.exists() and path.stat().st_size > 0:
            ok(f"{rel} ({path.stat().st_size / 1e6:.1f} MB)")
        else:
            bad(f"{rel} missing — run: make download-kokoro-zh")
            passed = False

    if (KOKORO_ZH_MODEL_DIR / "kokoro-v1_1-zh.pth").exists():
        bad("stale kokoro-v1_1-zh.pth still present (the converter should remove it)")
        passed = False

    voice = default_voice("zh")
    pack = kokoro_voice_path(voice)
    if pack.exists():
        ok(f"default voice {voice} ({pack.name})")
    else:
        bad(f"default voice pack missing: {pack}")
        passed = False

    if is_kokoro_zh_ready():
        ok("is_kokoro_zh_ready() -> True")
    else:
        bad("is_kokoro_zh_ready() -> False")
        passed = False
    return passed


def check_routing() -> bool:
    """Gate 2: language and checkpoint resolve independently and correctly."""
    from app.kokoro import (
        kokoro_family,
        kokoro_lang_code,
        kokoro_model_key,
        kokoro_voice_path,
        require_one_family,
        require_one_model,
    )

    step("2. voice routing (language vs checkpoint)")
    # voice -> (family, model, lang_code)
    expected = {
        "af_heart": ("en", "kokoro", "a"),
        "bf_emma": ("en", "kokoro", "b"),
        "zf_001": ("zh", "kokoro-zh", "z"),
        "zm_010": ("zh", "kokoro-zh", "z"),
        # English voices trained in the v1.1-zh run: language en, checkpoint zh.
        "af_maple": ("en", "kokoro-zh", "a"),
        "af_sol": ("en", "kokoro-zh", "a"),
        "bf_vale": ("en", "kokoro-zh", "b"),
    }
    passed = True
    print(f"  {'voice':<10} {'family':<7} {'model':<11} {'lang':<5} pack")
    for voice, want in expected.items():
        got = (kokoro_family(voice), kokoro_model_key(voice), kokoro_lang_code(voice))
        pack = kokoro_voice_path(voice)
        if got != want:
            bad(f"{voice}: got {got}, want {want}")
            passed = False
            continue
        if not pack.exists():
            bad(f"{voice}: pack missing at {pack}")
            passed = False
            continue
        ok(f"{voice:<10} {got[0]:<7} {got[1]:<11} {got[2]:<5} {pack.name}")

    # Guards: one language and one checkpoint per job. These do not need packs.
    from app.kokoro import require_same_family
    from app.main import _job_language
    from app.voice_assembly import assemble_job_voices, kokoro_voices

    def _must_message(fn, arg, *needles: str, absent: str = "") -> None:
        try:
            fn(arg)
        except ValueError as exc:
            text = str(exc)
            missing = [n for n in needles if n not in text]
            if missing or (absent and absent in text):
                raise AssertionError(f"message {text!r} missing {missing} absent={absent!r}") from exc
            return
        raise AssertionError("expected a ValueError, got none")

    def _expect(label: str, cond: bool, detail: str = "") -> None:
        nonlocal passed
        if cond:
            ok(label)
            return
        bad(f"{label} — {detail}" if detail else label)
        passed = False

    for label, fn in (
        ("zh blend allowed", lambda: require_one_family(["zf_001", "zm_010"])),
        ("en+zh rejected", lambda: _must_raise(require_one_family, ["af_heart", "zf_001"])),
        ("cross-checkpoint rejected", lambda: _must_raise(require_one_model, ["af_maple", "af_heart"])),
        ("same-checkpoint en allowed", lambda: require_one_model(["af_maple", "af_sol"])),
        ("family error says 语系", lambda: _must_message(require_one_family, ["af_heart", "zf_001"], "语系", absent="模型")),
        ("blend family error says 语系", lambda: _must_message(require_same_family, ["af_maple", "zf_001"], "语系", absent="模型")),
        ("model error keeps 模型", lambda: _must_message(require_one_model, ["af_maple", "af_heart"], "模型")),
        ("assemble rejects en+zh", lambda: _must_raise(kokoro_voices, ["af_heart", "zf_001"])),
        ("assemble rejects maple+heart", lambda: _must_raise(kokoro_voices, ["af_maple", "af_heart"])),
        ("assemble allows maple+sol", lambda: kokoro_voices(["af_maple", "af_sol"])),
    ):
        try:
            fn()
            ok(label)
        except AssertionError as exc:
            bad(f"{label} — {exc}")
            passed = False
        except Exception as exc:
            bad(f"{label} — {type(exc).__name__}: {exc}")
            passed = False

    zh_lang = _job_language("kokoro", "English", [{"id": "zf_001", "kind": "kokoro"}])
    _expect("job language follows zh family", zh_lang == "Chinese", f"got {zh_lang!r}")
    maple_lang = _job_language("kokoro", "Chinese", [{"id": "af_maple", "kind": "kokoro"}])
    _expect("job language follows maple family", maple_lang == "English", f"got {maple_lang!r}")
    mode, voices, *_ = assemble_job_voices("kokoro", speakers="zf_001")
    _expect("assemble zh job stays kokoro", mode == "kokoro" and voices[0]["id"] == "zf_001", f"got {mode} {voices}")
    return passed


def check_frontend(texts: list[str]) -> bool:
    """Gate 3: `module.` prefix gone, keys aligned, phonemes inside the vocab."""
    from app.config import KOKORO_ZH_MODEL_DIR
    from app.kokoro import phonemize_text

    step("3. checkpoint layout + G2P vocab coverage")
    passed = True

    header = KOKORO_ZH_MODEL_DIR / "model.safetensors"
    if header.exists():
        with open(header, "rb") as handle:
            size = struct.unpack("<Q", handle.read(8))[0]
            meta = json.loads(handle.read(size))
        keys = [key for key in meta if key != "__metadata__"]
        prefixed = [key for key in keys if "module" in key.split(".")]
        if prefixed:
            bad(f"{len(prefixed)}/{len(keys)} keys still carry the DataParallel prefix")
            passed = False
        else:
            ok(f"{len(keys)} tensors, no DataParallel prefix")

    vocab = json.loads((KOKORO_ZH_MODEL_DIR / "config.json").read_text())["vocab"]
    ok(f"vocab size {len(vocab)}")

    for text in texts:
        phonemes = phonemize_text(text, family="zh")["phonemes"]
        missing = sorted({char for char in phonemes if char not in vocab})
        if missing:
            bad(f"out-of-vocab phonemes {missing} for: {text}")
            passed = False
        else:
            ok(f"{len(phonemes)} phonemes in vocab — {text[:24]}")
    return passed


def check_speed_curve() -> bool:
    """The upstream anti-rushing curve: full speed up to 83 phonemes, slower after."""
    from app.kokoro import chinese_speed

    step("4. Chinese speed curve")
    cases = {40: 1.1, 83: 1.1, 103: 1.056, 183: 0.88, 400: 0.88}
    passed = True
    for length, expected in cases.items():
        got = chinese_speed(length)
        if abs(got - expected) > 0.001:
            bad(f"len={length}: got {got:.4f}, want {expected:.4f}")
            passed = False
        else:
            ok(f"len={length:<4} speed={got:.4f}")
    return passed


def _fold(text: str) -> str:
    """Canonical form for comparison: punctuation stripped, numerals in Arabic.

    TTS reads `2026年9月14日` aloud as `二零二六年九月十四日`, and the ASR then
    transcribes exactly what it heard, so a raw string diff would flag a perfectly
    correct read as a failure. Folding both sides through `cn2an` (idempotent, so
    text that is already Arabic is untouched) removes that false negative.
    """
    stripped = re.sub(r"[\s，。！？、,.!?\-]", "", text).lower()
    try:
        import cn2an

        return cn2an.transform(stripped, "cn2an")
    except Exception:
        return stripped


def check_round_trip(cases: list[tuple[str, str, str]]) -> bool:
    """Gate 5: synthesize through the real engine, then ASR the result back."""
    from app.asr import asr_engine
    from app.kokoro import kokoro_engine, kokoro_model_key

    step("5. synthesis + ASR round trip")
    passed = True
    for voice, text, language in cases:
        ids = voice.split(",")
        job_id = f"kokoro-check-{voice.replace(',', '_')}-{int(time.time())}"
        started = time.perf_counter()
        stats = kokoro_engine.synthesize(
            text,
            language=language,
            job_id=job_id,
            voices=[{"id": voice, "voices": ids, "kind": "kokoro", "name": voice}],
        )
        elapsed = time.perf_counter() - started
        audio = Path(stats["output_path"])
        if stats["audio_sec"] <= 0 or not audio.exists():
            bad(f"{voice}: no audio produced")
            passed = False
            continue
        ok(
            f"{voice:<18} {stats['audio_sec']}s audio in {elapsed:.1f}s "
            f"(rtf {stats['rtf']}, {kokoro_model_key(ids[0])})"
        )

        result = asr_engine.transcribe(str(audio), language=language)
        heard = _fold(str(result.get("text") or ""))
        wanted = _fold(text)
        ratio = difflib.SequenceMatcher(None, wanted, heard).ratio()
        if ratio >= 0.9:
            ok(f"  ASR {ratio:.3f} — {heard}")
        elif ratio >= 0.7:
            print(f"  \033[33mWARN\033[0m ASR {ratio:.3f} — {heard} (want {wanted})")
        else:
            bad(f"  ASR {ratio:.3f} — {heard} (want {wanted})")
            passed = False
    return passed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", default="zf_001", help="Chinese voice id for the round trip")
    parser.add_argument("--text", default=DEFAULT_TEXT, help="Chinese script to synthesize")
    parser.add_argument("--no-asr", action="store_true", help="skip the ASR round trip")
    parser.add_argument("--keep", action="store_true", help="keep the generated job directory")
    args = parser.parse_args(argv)

    import app.config as config_module
    import app.kokoro as kokoro_module

    tmp_output = Path(tempfile.mkdtemp(prefix="kokoro-zh-check-"))
    results = [
        check_artifacts(),
        check_routing(),
        check_frontend([DEFAULT_TEXT, args.text]),
        check_speed_curve(),
    ]

    # Redirect synthesize() output into a scratch dir so validation never litters
    # the real data/output tree with throwaway jobs.
    original_output = kokoro_module.OUTPUT_DIR
    kokoro_module.OUTPUT_DIR = tmp_output
    try:
        if args.no_asr:
            step("5. synthesis (ASR skipped)")
            cases = [(args.voice, args.text, "Chinese")]
        else:
            # Both languages are exercised because the English voices inside the
            # v1.1-zh checkpoint only prove the routing when they read English.
            cases = [
                (args.voice, args.text, "Chinese"),
                ("af_maple", ENGLISH_TEXT, "English"),
            ]
        results.append(check_round_trip(cases))
    finally:
        kokoro_module.OUTPUT_DIR = original_output
        config_module.OUTPUT_DIR = original_output
        if args.keep:
            print(f"\nkept scratch output: {tmp_output}")
        else:
            shutil.rmtree(tmp_output, ignore_errors=True)

    print()
    if all(results):
        print("\033[32mall gates passed\033[0m")
        return 0
    print("\033[31msome gates failed\033[0m")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
