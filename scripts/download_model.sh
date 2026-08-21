#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/models/qwen3-tts"
MODEL_ID="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"

# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

mkdir -p "$DEST"
export DEST MODEL_ID HF_ENDPOINT="${HF_MIRROR}"

if [[ -f "$DEST/config.json" ]] && compgen -G "$DEST/*.safetensors" >/dev/null; then
  echo "Model already present at $DEST"
  exit 0
fi

# shellcheck disable=SC1091
if [[ -f "$ROOT/mlx-tts-env/bin/activate" ]]; then
  source "$ROOT/mlx-tts-env/bin/activate"
fi

echo "Trying ModelScope for $MODEL_ID ..."
set +e
python - <<'PY'
import os
import sys

try:
    from modelscope.hub.snapshot_download import snapshot_download

    snapshot_download(os.environ["MODEL_ID"], local_dir=os.environ["DEST"])
    print("Downloaded from ModelScope")
except Exception as exc:
    print(f"ModelScope failed: {exc}", file=sys.stderr)
    sys.exit(2)
PY
MS_STATUS=$?
set -e

if [[ $MS_STATUS -eq 0 && -f "$DEST/config.json" ]]; then
  echo "Model ready: $DEST"
  exit 0
fi

echo "Falling back to Hugging Face mirror: $HF_MIRROR"
export HF_ENDPOINT="$HF_MIRROR"
python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id=os.environ["MODEL_ID"],
    local_dir=os.environ["DEST"],
)
print("Downloaded from Hugging Face mirror")
PY

echo "Model ready: $DEST"
