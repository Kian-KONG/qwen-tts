#!/usr/bin/env python3
"""Convert PyTorch `.pt` checkpoints to `.safetensors` without installing torch.

Why this exists: `mlx.core.load` cannot read torch's zip/pickle `.pt` format, and
the upstream Chinese Kokoro release (`hexgrad/Kokoro-82M-v1.1-zh`) only ships
`kokoro-v1_1-zh.pth` plus `voices/*.pt`. Rather than depend on a third-party MLX
conversion, we fetch the official weights from a China mirror and convert them
locally.

The reader implements the subset of torch's pickle protocol that `torch.save`
emits for plain tensors and state dicts:

* `torch._utils._rebuild_tensor_v2` / `_rebuild_tensor`
* `torch._utils._rebuild_parameter`
* `<Dtype>Storage` entries arriving through `persistent_load`
* `collections.OrderedDict`

Tensor key names are preserved verbatim. mlx-audio's Kokoro loader already
sanitises torch-style names (LSTM `weight_ih_l0` -> `Wx_forward`, `weight_v`
transposes, `.gamma`/`.beta` -> `.weight`/`.bias`), so a straight conversion is
loadable, exactly like the official `mlx-community/Kokoro-82M-bf16` repo.

Usage:
    python scripts/pt_to_safetensors.py file.pt out.safetensors
    python scripts/pt_to_safetensors.py --voices-dir models/kokoro-zh/voices
"""

from __future__ import annotations

import argparse
import io
import pickle
import sys
import zipfile
from collections import OrderedDict
from pathlib import Path

import numpy as np

# torch storage class name -> numpy dtype. bfloat16 has no numpy equivalent and
# is widened to float32 on read (exact, since bf16 is the top half of fp32).
_STORAGE_DTYPES = {
    "FloatStorage": "float32",
    "DoubleStorage": "float64",
    "HalfStorage": "float16",
    "BFloat16Storage": "bfloat16",
    "LongStorage": "int64",
    "IntStorage": "int32",
    "ShortStorage": "int16",
    "CharStorage": "int8",
    "ByteStorage": "uint8",
    "BoolStorage": "bool",
}

_ALLOWED_GLOBALS = {
    ("collections", "OrderedDict"): OrderedDict,
    ("builtins", "set"): set,
    ("builtins", "list"): list,
    ("builtins", "dict"): dict,
    ("builtins", "tuple"): tuple,
    ("builtins", "int"): int,
    ("builtins", "float"): float,
    ("builtins", "str"): str,
    ("builtins", "bool"): bool,
}


class _StorageType:
    """Stand-in for `torch.<Dtype>Storage` inside the pickle stream."""

    __slots__ = ("name", "dtype")

    def __init__(self, name: str, dtype: str) -> None:
        self.name = name
        self.dtype = dtype

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<{self.name}>"


class _Storage:
    __slots__ = ("dtype", "flat")

    def __init__(self, dtype: str, flat: np.ndarray) -> None:
        self.dtype = dtype
        self.flat = flat


def _widen_bfloat16(raw: bytes) -> np.ndarray:
    """bfloat16 -> float32 by shifting the 16 bit pattern up."""
    half = np.frombuffer(raw, dtype=np.uint16).astype(np.uint32)
    return np.left_shift(half, 16).view(np.float32)


def _is_contiguous(size: tuple[int, ...], stride: tuple[int, ...]) -> bool:
    expected = 1
    for dim, step in zip(reversed(size), reversed(stride)):
        if step != expected:
            return False
        expected *= dim
    return True


def _rebuild_tensor(storage, storage_offset, size, stride, *args, **kwargs):
    size = tuple(int(dim) for dim in size)
    flat = storage.flat
    count = int(np.prod(size)) if size else 1
    if stride is None or _is_contiguous(size, tuple(int(s) for s in stride)):
        data = flat[int(storage_offset) : int(storage_offset) + count]
        return np.ascontiguousarray(data.reshape(size))
    itemsize = flat.dtype.itemsize
    steps = tuple(int(s) * itemsize for s in stride)
    view = np.lib.stride_tricks.as_strided(
        flat[int(storage_offset) :], shape=size, strides=steps
    )
    return np.ascontiguousarray(view)


class _Unpickler(pickle.Unpickler):
    def __init__(self, file, read_storage) -> None:
        super().__init__(file)
        self._read_storage = read_storage

    def find_class(self, module: str, name: str):  # noqa: D102
        if module == "torch" and name in _STORAGE_DTYPES:
            return _StorageType(name, _STORAGE_DTYPES[name])
        if module == "torch._utils" and name in {"_rebuild_tensor_v2", "_rebuild_tensor"}:
            return _rebuild_tensor
        if module == "torch._utils" and name == "_rebuild_parameter":
            return lambda data, requires_grad, backward_hooks=None: data
        if (module, name) in _ALLOWED_GLOBALS:
            return _ALLOWED_GLOBALS[(module, name)]
        raise pickle.UnpicklingError(f"unsupported global in checkpoint: {module}.{name}")

    def persistent_load(self, pid):  # noqa: D102
        if not isinstance(pid, tuple) or not pid or pid[0] != "storage":
            raise pickle.UnpicklingError(f"unsupported persistent id: {pid!r}")
        storage_type, key = pid[1], pid[2]
        return _Storage(storage_type.dtype, self._read_storage(str(key), storage_type.dtype))


def load_checkpoint(path: Path):
    """Read a torch `.pt` file into numpy arrays (tensor or dict of tensors)."""
    with zipfile.ZipFile(path) as archive:
        pickles = [name for name in archive.namelist() if name.endswith("data.pkl")]
        if not pickles:
            raise ValueError(f"{path} is not a zip-serialized torch checkpoint")
        prefix = pickles[0][: -len("data.pkl")]
        cache: dict[str, np.ndarray] = {}

        def read_storage(key: str, dtype: str) -> np.ndarray:
            if key in cache:
                return cache[key]
            raw = archive.read(f"{prefix}data/{key}")
            if dtype == "bfloat16":
                array = _widen_bfloat16(raw)
            else:
                array = np.frombuffer(raw, dtype=np.dtype(dtype))
            cache[key] = array
            return array

        blob = archive.read(pickles[0])
        # Storage blobs are pulled lazily while unpickling, so stay inside the
        # archive context manager until the object graph is materialised.
        return _Unpickler(io.BytesIO(blob), read_storage).load()


def _unwrap_data_parallel(obj: dict) -> dict:
    """Drop the `module.` wrapper `nn.DataParallel` adds to state-dict keys.

    The upstream v1.1-zh checkpoint was saved from a `nn.DataParallel` wrapper.
    Depending on how the wrapper was nested at save time this shows up either as
    an extra `{"module": {...}}` level or — as in the official release — as a
    `module.` segment baked into every key of each submodule state dict
    (`"module.embeddings.weight"`). Handle the nested form here; the dotted form
    is stripped by `_strip_module_segment` once names are flattened.
    """
    if set(obj) == {"module"} and isinstance(obj["module"], dict):
        return _unwrap_data_parallel(obj["module"])
    return {
        key: _unwrap_data_parallel(value) if isinstance(value, dict) else value
        for key, value in obj.items()
    }


def _strip_module_segment(name: str) -> str:
    """Remove the single `module.` path segment DataParallel injects.

    `nn.DataParallel` prefixes every parameter name with `module.`, so the
    official v1.1-zh checkpoint stores `bert` as `module.embeddings...` where
    the plain (v1.0 / mlx-community) layout is `embeddings...`. Dropping that
    segment once yields keys that line up 1:1 with mlx-audio's `sanitize()`
    prefixes (`bert`, `bert_encoder`, `text_encoder`, `predictor`, `decoder`).
    """
    parts = name.split(".")
    if "module" in parts:
        parts.remove("module")
    return ".".join(parts)


def _flatten(obj: dict, prefix: str = "") -> "OrderedDict[str, np.ndarray]":
    out: "OrderedDict[str, np.ndarray]" = OrderedDict()
    for key, value in obj.items():
        name = f"{prefix}{key}"
        if isinstance(value, np.ndarray):
            out[_strip_module_segment(name)] = value
        elif isinstance(value, dict):
            out.update(_flatten(value, f"{name}."))
    return out


def tensor_dict(obj) -> "OrderedDict[str, np.ndarray]":
    """Normalise a checkpoint into a name -> array mapping.

    Voice packs are a bare tensor; Kokoro's model checkpoint is a dict of
    per-submodule state dicts (`bert`, `predictor`, ...) whose keys are relative
    to the module, so nesting is flattened back into dotted names.
    """
    if isinstance(obj, np.ndarray):
        return OrderedDict([("voice", obj)])
    if isinstance(obj, dict):
        tensors = _flatten(_unwrap_data_parallel(obj))
        if tensors:
            return tensors
    raise ValueError("checkpoint has no tensors to convert")


def save_safetensors(dest: Path, tensors: "OrderedDict[str, np.ndarray]") -> None:
    import mlx.core as mx

    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = {name: mx.array(np.ascontiguousarray(array)) for name, array in tensors.items()}
    mx.eval(list(payload.values()))
    mx.save_safetensors(str(dest), payload)


def convert_file(src: Path, dest: Path, *, force: bool = False) -> bool:
    if dest.exists() and not force and dest.stat().st_size > 0:
        return False
    tensors = tensor_dict(load_checkpoint(src))
    save_safetensors(dest, tensors)
    return True


def convert_voices(voices_dir: Path, *, force: bool = False) -> tuple[int, int]:
    """Convert every `*.pt` voice pack next to it as `<name>.safetensors`."""
    done = skipped = 0
    for source in sorted(voices_dir.glob("*.pt")):
        target = source.with_suffix(".safetensors")
        if convert_file(source, target, force=force):
            done += 1
        else:
            skipped += 1
    return done, skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", nargs="?", help="source .pt checkpoint")
    parser.add_argument("dest", nargs="?", help="destination .safetensors path")
    parser.add_argument(
        "--voices-dir",
        help="convert every *.pt voice pack in this directory in place",
    )
    parser.add_argument("--force", action="store_true", help="overwrite existing output")
    args = parser.parse_args(argv)

    if args.voices_dir:
        done, skipped = convert_voices(Path(args.voices_dir), force=args.force)
        print(f"voices: converted {done}, kept {skipped} already present")
        return 0

    if not args.src or not args.dest:
        parser.error("need src and dest, or --voices-dir")
    src, dest = Path(args.src), Path(args.dest)
    if not src.exists():
        print(f"missing source: {src}", file=sys.stderr)
        return 1
    if convert_file(src, dest, force=args.force):
        print(f"{src.name} -> {dest}")
    else:
        print(f"{dest} already present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
