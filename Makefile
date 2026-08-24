# Apple Silicon / MLX local English dubbing studio.
# Downloads use China mirrors (ModelScope, hf-mirror, Tsinghua PyPI, npmmirror, USTC brew).

SHELL := /bin/bash
ROOT := $(abspath .)
export HOMEBREW_NO_AUTO_UPDATE ?= 1
export HOMEBREW_BOTTLE_DOMAIN ?= https://mirrors.ustc.edu.cn/homebrew-bottles
export PIP_INDEX_URL ?= https://pypi.tuna.tsinghua.edu.cn/simple
export NPM_CONFIG_REGISTRY ?= https://registry.npmmirror.com
export HF_ENDPOINT ?= https://hf-mirror.com
export HF_MIRROR ?= https://hf-mirror.com

.PHONY: help setup download download-design download-custom download-asr start dev tunnel tunnel-named tunnel-setup health

help:
	@echo "Apple Silicon / MLX targets:"
	@echo "  make setup         Install Python env, mlx-audio, ffmpeg"
	@echo "  make download      Download Base bf16 (voice clone)"
	@echo "  make download-design Download VoiceDesign bf16 (described voice)"
	@echo "  make download-custom Download CustomVoice bf16 (preset speakers)"
	@echo "  make download-asr   Download Qwen3-ASR 1.7B bf16 (speech-to-text)"
	@echo "  make start         Build frontend and serve on :8000"
	@echo "  make dev           Backend + Vite hot reload"
	@echo "  make health        GET /health"
	@echo "  make tunnel-setup  Optional: install cloudflared"
	@echo "  make tunnel-named  Stable Cloudflare named tunnel (needs login)"
	@echo "  make tunnel        Optional: temporary trycloudflare URL"

setup:
	./scripts/setup.sh

download:
	./scripts/download_model.sh base

download-design:
	./scripts/download_model.sh design

download-custom:
	./scripts/download_model.sh custom

download-asr:
	./scripts/download_model.sh asr

start:
	./scripts/start.sh

dev:
	./scripts/dev.sh

health:
	curl -sS http://127.0.0.1:8000/health; echo

tunnel-setup:
	INSTALL_TUNNEL=1 ./scripts/setup.sh

tunnel:
	./scripts/tunnel.sh

tunnel-named:
	./scripts/tunnel-named.sh
