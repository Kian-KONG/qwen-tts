#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KIND="${1:-base}"

case "$KIND" in
  base)
    DEST="$ROOT/models/qwen3-tts"
    MODEL_ID="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
    ;;
  design)
    DEST="$ROOT/models/qwen3-tts-voice-design"
    MODEL_ID="mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
    ;;
  custom)
    DEST="$ROOT/models/qwen3-tts-custom-voice"
    MODEL_ID="mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
    ;;
  asr)
    DEST="$ROOT/models/qwen3-asr"
    MODEL_ID="mlx-community/Qwen3-ASR-1.7B-bf16"
    ;;
  asr-0.6b)
    DEST="$ROOT/models/qwen3-asr"
    MODEL_ID="mlx-community/Qwen3-ASR-0.6B-bf16"
    ;;
  instruct)
    DEST="$ROOT/models/qwen3-instruct"
    MODEL_ID="mlx-community/Qwen3-1.7B-bf16"
    ;;
  kokoro)
    DEST="$ROOT/models/kokoro"
    MODEL_ID="mlx-community/Kokoro-82M-bf16"
    ;;
  kokoro-zh)
    DEST="$ROOT/models/kokoro-zh"
    # Official Chinese/English Kokoro. Only ships .pth + voices/*.pt, so we
    # convert to safetensors locally after downloading.
    MODEL_ID="hexgrad/Kokoro-82M-v1.1-zh"
    ;;
  longcat)
    DEST="$ROOT/models/longcat-audiodit"
    MODEL_ID="mlx-community/LongCat-AudioDiT-3.5B-bf16"
    ;;
  *)
    echo "Usage: $0 [base|design|custom|asr|asr-0.6b|instruct|kokoro|kokoro-zh|longcat]"
    exit 1
    ;;
esac

# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

mkdir -p "$DEST"
export DEST MODEL_ID HF_ENDPOINT="${HF_MIRROR}"

if [[ -f "$DEST/config.json" ]] && compgen -G "$DEST/*.safetensors" >/dev/null; then
  if [[ -f "$DEST/.repo_id" ]] && [[ "$(tr -d '[:space:]' < "$DEST/.repo_id")" == "$MODEL_ID" ]]; then
    echo "Model already present at $DEST"
    exit 0
  fi
  echo "Existing weights in $DEST are not $MODEL_ID; re-downloading."
fi

# shellcheck disable=SC1091
if [[ -f "$ROOT/mlx-tts-env/bin/activate" ]]; then
  source "$ROOT/mlx-tts-env/bin/activate"
fi

# Pulls `config.json` + the 327 MB torch checkpoint from ModelScope. Kept in a
# function so the heredoc can stay at column zero, which lets the caller skip the
# whole fetch when a converted `model.safetensors` already exists.
fetch_kokoro_zh_torch() {
  echo "Kokoro v1.1-zh: fetching config + weights from ModelScope (${MODELSCOPE_ENDPOINT}) ..."
  set +e
  python - <<'PY'
import os
import sys

endpoint = os.environ.setdefault("MODELSCOPE_ENDPOINT", "https://www.modelscope.cn")

try:
    from modelscope.hub.snapshot_download import snapshot_download

    snapshot_download(
        os.environ["MODEL_ID"],
        local_dir=os.environ["DEST"],
        allow_patterns=["config.json", "*.pth"],
        endpoint=endpoint,
    )
    print("ModelScope download ok")
except Exception as exc:
    print(f"ModelScope failed: {exc}", file=sys.stderr)
    sys.exit(2)
PY
  set -e
}

# Kokoro v1.1-zh is a torch release: grab the official weights from the mirrors,
# then convert to MLX safetensors in place.
if [[ "$KIND" == "kokoro-zh" ]]; then
  mkdir -p "$DEST/voices"

  # `model.safetensors` is the runtime artifact; once it exists the torch
  # checkpoint is redundant, so don't re-fetch 327 MB just to delete it again.
  if [[ -f "$DEST/model.safetensors" ]]; then
    echo "Kokoro v1.1-zh: converted weights already present, skipping torch checkpoint fetch"
  else
    fetch_kokoro_zh_torch
  fi

  # ModelScope's mirror of this repo has no voices/ directory, and hf-mirror is
  # the designated China endpoint for Hugging Face, so voice packs come from there.
  # Plain curl per file: no temp-file churn, resumable, and it survives a mirror
  # hiccup on one of the 103 files without losing the rest.
  echo "Kokoro v1.1-zh: fetching voice packs from Hugging Face mirror (${HF_MIRROR}) ..."
  export HF_ENDPOINT="$HF_MIRROR"
  VOICE_LIST="$(python - <<'PY'
import json
import os
import urllib.request

url = f"{os.environ['HF_ENDPOINT']}/api/models/{os.environ['MODEL_ID']}?blobs=true"
request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
with urllib.request.urlopen(request, timeout=60) as response:
    payload = json.load(response)
for sibling in payload.get("siblings", []):
    name = sibling.get("rfilename", "")
    if name.startswith("voices/") and name.endswith(".pt"):
        print(name)
PY
)"
  if [[ -z "$VOICE_LIST" ]]; then
    echo "Could not list voice packs from $HF_MIRROR" >&2
    exit 1
  fi
  TOTAL="$(printf '%s\n' "$VOICE_LIST" | wc -l | tr -d ' ')"
  SEEN=0
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    out="$DEST/$rel"
    SEEN=$((SEEN + 1))
    # A converted `.safetensors` next to the `.pt` means this voice is already
    # done — the `.pt` is only kept as the provenance source, so don't re-pull it.
    if [[ -s "$out" || -s "${out%.pt}.safetensors" ]]; then
      continue
    fi
    if ! curl -fL --connect-timeout 20 --retry 3 --retry-delay 2 \
      -o "$out.part" "${HF_MIRROR}/${MODEL_ID}/resolve/main/${rel}"; then
      echo "Failed to download $rel" >&2
      exit 1
    fi
    mv "$out.part" "$out"
    if (( SEEN % 25 == 0 )); then
      echo "  ... ${SEEN}/${TOTAL}"
    fi
  done <<<"$VOICE_LIST"
  echo "Voice packs ready ($(ls "$DEST"/voices/*.pt 2>/dev/null | wc -l | tr -d ' ')/${TOTAL})"

  # Backstop for an incomplete ModelScope response. The torch checkpoint is only
  # worth fetching while it has not been converted yet.
  for rel in config.json kokoro-v1_1-zh.pth; do
    [[ -s "$DEST/$rel" ]] && continue
    [[ "$rel" == "kokoro-v1_1-zh.pth" && -f "$DEST/model.safetensors" ]] && continue
    echo "ModelScope was incomplete; pulling $rel from $HF_MIRROR ..."
    curl -fL --connect-timeout 20 --retry 3 --retry-delay 2 \
      -o "$DEST/$rel" "${HF_MIRROR}/${MODEL_ID}/resolve/main/${rel}"
  done

  echo "Kokoro v1.1-zh: converting torch checkpoints to safetensors ..."
  python "$ROOT/scripts/pt_to_safetensors.py" --voices-dir "$DEST/voices"
  if [[ -f "$DEST/kokoro-v1_1-zh.pth" ]]; then
    python "$ROOT/scripts/pt_to_safetensors.py" "$DEST/kokoro-v1_1-zh.pth" "$DEST/model.safetensors"
    # The 327 MB torch checkpoint is not used at runtime.
    rm -f "$DEST/kokoro-v1_1-zh.pth"
  fi

  if [[ -f "$DEST/config.json" && -f "$DEST/model.safetensors" ]]; then
    printf '%s\n' "$MODEL_ID" > "$DEST/.repo_id"
    echo "Model ready: $DEST"
    exit 0
  fi
  echo "Kokoro v1.1-zh download failed" >&2
  exit 1
fi

echo "Trying ModelScope (${MODELSCOPE_ENDPOINT}) for $MODEL_ID ..."
set +e
python - <<'PY'
import os
import sys

os.environ.setdefault("MODELSCOPE_ENDPOINT", "https://www.modelscope.cn")

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
  printf '%s\n' "$MODEL_ID" > "$DEST/.repo_id"
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

printf '%s\n' "$MODEL_ID" > "$DEST/.repo_id"
echo "Model ready: $DEST"
