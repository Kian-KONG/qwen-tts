from __future__ import annotations

import argparse
from pathlib import Path

from .chunking import split_script
from .config import BATCH_SIZE, LANGUAGE
from .engine import engine


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate English dubbing with Qwen3-TTS")
    parser.add_argument("--text", help="Text to speak")
    parser.add_argument("--text-file", type=Path, help="UTF-8 script file")
    parser.add_argument("--ref-audio", required=True, type=Path)
    parser.add_argument("--ref-text", help="Transcript of the reference audio")
    parser.add_argument("--ref-text-file", type=Path)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--language", default=LANGUAGE)
    parser.add_argument("--preview-chunks", action="store_true")
    args = parser.parse_args()

    if args.text_file:
        text = args.text_file.read_text(encoding="utf-8")
    elif args.text:
        text = args.text
    else:
        parser.error("Provide --text or --text-file")

    if args.ref_text_file:
        ref_text = args.ref_text_file.read_text(encoding="utf-8")
    elif args.ref_text:
        ref_text = args.ref_text
    else:
        parser.error("Provide --ref-text or --ref-text-file")

    chunks = split_script(text)
    print(f"Chunks: {len(chunks)}")
    if args.preview_chunks:
        for i, chunk in enumerate(chunks, 1):
            print(f"[{i}] {chunk}")
        return

    stats = engine.synthesize(
        text,
        str(args.ref_audio),
        ref_text,
        batch_size=args.batch_size,
        language=args.language,
    )
    print(f"Wrote {stats['output_path']}")
    print(f"Audio {stats['audio_sec']}s  elapsed {stats['elapsed_sec']}s  RTF {stats['rtf']}")


if __name__ == "__main__":
    main()
