from __future__ import annotations

from pathlib import Path


def is_local_model_dir(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").exists() and any(path.glob("*.safetensors"))
