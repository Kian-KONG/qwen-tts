# Qwen3-TTS 英文视频配音（Apple Silicon / MLX）

面向公司内部英文视频配音。在 **Mac Apple 芯片**（M 系列，本机已在 Mac mini M4 16GB 验证）上用 **Qwen3-TTS 1.7B Base bf16**（Apache 2.0）做声音克隆。React 前端 + Python 后端，推理走 MLX。

不要用 4bit：输出会乱码。bf16 峰值大约 6GB，16GB 机器够用。

下载默认走国内源：ModelScope → hf-mirror，PyPI 清华，npm npmmirror，Homebrew 中科大。

## 一次安装

```bash
make setup
make download
make start
```

然后打开 http://127.0.0.1:8000

`make setup` 会装 Python 3.12 虚拟环境、`mlx-audio` 和 `ffmpeg`。Cloudflare Tunnel **不是必需项**，本机或局域网直接用 `:8000` 即可。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `make setup` | Apple Silicon 环境 |
| `make download` | 拉 bf16 权重（ModelScope / hf-mirror） |
| `make start` | 打包前端并由 FastAPI 提供 |
| `make dev` | 后端 + Vite 热更新 |
| `make health` | 探活 |
| `make tunnel-setup` | 可选：安装 cloudflared |
| `make tunnel` | 可选：临时公网链接 |

## 准备参考音频

1. 录 3–10 秒干净英文，尽量 44.1kHz / 24bit WAV
2. 写好逐字稿，保存到音色库后再配长文稿

麦克风示例：

```bash
ffmpeg -f avfoundation -i ":0" -t 8 -ar 44100 -c:a pcm_s24le data/voices/ref.wav
```

## 命令行配音

```bash
./scripts/generate.sh \
  --text-file data/samples/demo_script.txt \
  --ref-audio ./ref.wav \
  --ref-text "transcript of reference audio"
```

长文本会按句切分，`batch=4` 批量合成后再拼成 44.1kHz / 24bit WAV。

## OpenAI 兼容 API

`POST /v1/audio/speech`，克隆音色用已保存的 `voice`，或显式传 `ref_audio` + `ref_text`：

```bash
curl http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Your English script here.",
    "voice": "studio-a",
    "response_format": "wav"
  }' \
  --output speech.wav
```

上传参考音频：

```bash
curl -X POST http://127.0.0.1:8000/v1/audio/clone \
  -F "input=Your English script here." \
  -F "ref_audio=@./ref.wav" \
  -F "ref_text=transcript of reference audio" \
  --output speech.wav
```

可选环境变量 `QWEN_TTS_API_KEY` 后，请求需带 `Authorization: Bearer ...`。

## oMLX

同一套 MLX 权重也可以交给已安装的 oMLX：

```bash
mkdir -p ~/.omlx/models
ln -sfn "$(pwd)/models/qwen3-tts" ~/.omlx/models/qwen3-tts
omlx serve --model-dir ~/.omlx/models --port 8001
```

配音主路径仍是本仓库的 FastAPI。

## 备注

- 仅支持 Apple Silicon + MLX
- 首次推理有 warmup，会偏慢；之后 RTF 大约 0.48，快于实时
- 只使用 Base bf16，不要量化到 4bit
- 参考音频和文字稿必须对齐，否则克隆质量会掉
