# Qwen3-TTS 英文视频配音（Apple Silicon / MLX）

面向公司内部英文视频配音。在 **Mac Apple 芯片**（M 系列，本机已在 Mac mini M4 16GB 验证）上用 **Qwen3-TTS 1.7B bf16**（Apache 2.0）。支持三种音色：

- **预设说话人**（CustomVoice）：点选 Ryan / Vivian 等 9 个官方音色，贴文字即可配
- **描述音色**（VoiceDesign）：写一段声音描述造音色
- **声音克隆**（Base）：3–10 秒参考音频 + 逐字稿

React 前端 + Python 后端，推理走 MLX。16GB 机器同一时间只加载其中一个模型。

不要用 4bit：输出会乱码。bf16 峰值大约 6GB。

下载默认走国内源：ModelScope → hf-mirror，PyPI 清华，npm npmmirror，Homebrew 中科大。

## 一次安装

```bash
make setup
make download
make download-design
make download-custom
make start
```

然后打开 http://127.0.0.1:8000

`make setup` 会装 Python 3.12 虚拟环境、`mlx-audio` 和 `ffmpeg`。公网访问用 GitHub Pages + 命名隧道；本机或局域网直接用 `:8000`。临时 trycloudflare **不是必需项**。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `make setup` | Apple Silicon 环境 |
| `make download` | 拉 Base bf16（声音克隆） |
| `make download-design` | 拉 VoiceDesign bf16（描述音色） |
| `make download-custom` | 拉 CustomVoice bf16（预设说话人） |
| `make start` | 打包前端并由 FastAPI 提供 |
| `make dev` | 后端 + Vite 热更新 |
| `make health` | 探活 |
| `make tunnel-setup` | 可选：安装 cloudflared |
| `make tunnel-named` | 固定 Cloudflare 命名隧道（需登录） |
| `make tunnel` | 可选：临时 trycloudflare 链接 |

## GitHub Pages + 命名隧道

GitHub Pages 只托管静态页面，推理仍在这台 Mac。页面地址：

https://kian-kong.github.io/qwen-tts/

1. 浏览器登录一次：`cloudflared tunnel login`
2. 本机先 `make start`，另开终端 `make tunnel-named`
3. 把脚本打印的 **Public API origin** 写进仓库 **Settings → Secrets and variables → Actions → Variables**，变量名 `VITE_API_BASE`（不要末尾斜杠）
4. 若本机设了 `QWEN_TTS_API_KEY`，再加 Actions Secret `VITE_API_KEY`，值相同
5. 等 **Actions → Deploy GitHub Pages** 跑绿，会写出 `gh-pages` 分支
6. 仓库 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**，Branch 选 `gh-pages` / `/ (root)`，保存
7. 打开 https://kian-kong.github.io/qwen-tts/

Mac 要保持 FastAPI 和命名隧道都在跑。重启电脑后重新 `make start` 和 `make tunnel-named`。临时 quick tunnel 仍可用 `make tunnel`，但地址会变。

如果 `*.cfargotunnel.com` 打不开，到 Cloudflare Zero Trust 给这条隧道加 Public Hostname，或：

```bash
cloudflared tunnel route dns qwen-tts <子域.你的域名>
```

然后把 `VITE_API_BASE` 改成那个 `https://...` 再推一次。

## 预设说话人（默认）

先下载 CustomVoice 权重。打开页面默认就是预设说话人，点 Ryan 等即可配音；API 传 `mode=preset` 和 `voice`/`speaker`：

```bash
curl http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Your English script here.",
    "mode": "preset",
    "voice": "Ryan",
    "language": "English",
    "response_format": "wav"
  }' \
  --output speech.wav
```

可选 `instruct` 只控制语气（如 `Very happy.`），不会改成另一种音色。

## 描述音色（不用克隆）

先下载 VoiceDesign 权重，然后在界面选「描述音色」，或 API 传 `mode=design` 和 `instruct`：

```bash
curl http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Your English script here.",
    "mode": "design",
    "instruct": "A calm adult male narrator, warm mid pitch, clear studio diction.",
    "language": "English",
    "response_format": "wav"
  }' \
  --output speech.wav
```

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
