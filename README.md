# Qwen3-TTS 英文视频配音（Apple Silicon / MLX）

面向公司内部英文视频配音。在 **Mac Apple 芯片**（M 系列，本机已在 Mac mini M4 16GB 验证）上用 **Qwen3-TTS 1.7B bf16**（Apache 2.0）。支持三种音色：

- **预设说话人**（CustomVoice）：点选 Ryan / Vivian 等 9 个官方音色，贴文字即可配。配音页按语系分组，中文（Vivian / Serena / Uncle Fu / Dylan / Eric）是 **Qwen3-TTS 1.7B** 精品音色，和 Kokoro 轻量中文并列、不是同一套
- **描述音色**（VoiceDesign）：写一段声音描述造音色
- **声音克隆**（Qwen3-TTS Base）：3–10 秒参考音频 + 逐字稿，保存在本机 `data/voices/`，Qwen3 页里选用
- **轻量英文**（Kokoro-82M）：Apache 2.0 英文旁白，和 Qwen3 并列切换，不能克隆。v1.0 英文 28 个音色（11 美式女 / 9 美式男 / 4 英式女 / 4 英式男）
- **轻量中文**（Kokoro-82M v1.1-zh）：103 个音色（100 中文 + Maple/Sol/Vale 3 个英文），中文音色可中英混读，不能克隆
- **LongCat**（LongCat-AudioDiT 3.5B）：和 Qwen3、Kokoro 并列切换；只做声音克隆 + 分段配音，没有预设/描述；切到该页再生成才会加载 LongCat
- **语音转文字**（Qwen3-ASR 1.7B）：上传音频生成文稿或克隆逐字稿
- **实时翻译字幕**：麦克风或会议播放声音短窗听写后用 Qwen3-1.7B 译成目标语，可弹出字幕窗，和配音队列分开
- **Excel 导入**：每个非空单元格一段语音，按编号配音
- **配音列表**：给编号文稿起名存在本机，下次直接载入

React 前端 + Python 后端，推理走 MLX。16GB 机器上配音和转写会互相卸掉对方。实时翻译页会卸掉 TTS，尽量同时留下 ASR 和 Instruct。

不要用 4bit：输出会乱码。bf16 峰值大约 6GB。

下载默认走国内源：ModelScope → hf-mirror，PyPI 清华，npm npmmirror，Homebrew 中科大。

## 一次安装

```bash
make setup
make download
make download-design
make download-custom
make download-asr
make download-instruct
make download-kokoro
make download-kokoro-zh
make download-longcat
make start
```

然后打开 http://127.0.0.1:8000

`make setup` 会装 Python 3.12 虚拟环境、`mlx-audio` 和 `ffmpeg`。公网访问用 GitHub Pages + 命名隧道；本机或局域网直接用 `:8000`。临时 trycloudflare **不是必需项**。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `make setup` | Apple Silicon 环境 |
| `make download` | 拉 Base bf16（Qwen 声音克隆） |
| `make download-design` | 拉 VoiceDesign bf16（描述音色） |
| `make download-custom` | 拉 CustomVoice bf16（预设说话人） |
| `make download-asr` | 拉 Qwen3-ASR 1.7B bf16（语音转文字） |
| `make download-instruct` | 拉 Qwen3-1.7B bf16（实时翻译字幕） |
| `make download-kokoro` | 拉 Kokoro-82M bf16（轻量英文配音） |
| `make download-kokoro-zh` | 拉 Kokoro-82M v1.1-zh（100 个中文音色） |
| `make download-longcat` | 拉 LongCat-AudioDiT 3.5B bf16（LongCat 页克隆 + 配音） |
| `make start` | 打包前端并由 FastAPI 提供 |
| `make dev` | 后端 + Vite 热更新 |
| `make health` | 探活 |
| `make tunnel-setup` | 可选：安装 cloudflared |
| `make tunnel` | 有 token 时拉固定隧道，否则临时 trycloudflare |
| `make tunnel-named` | 强制固定隧道 `tts.efforttracking.online` |
| `make tunnel-quick` | 临时 trycloudflare 链接（每次都会变） |

## GitHub Pages + 命名隧道

GitHub Pages 只托管静态页面，推理仍在这台 Mac。页面地址：

https://kian-kong.github.io/qwen-tts/

1. 浏览器登录一次：`cloudflared tunnel login`
2. 本机先 `make start`，另开终端 `make tunnel`（本机已有 token 时就是固定域名）
3. 把 Cloudflare 公网地址写进仓库 **Settings → Secrets and variables → Actions → Variables**，变量名 `VITE_API_BASE`（不要末尾斜杠）。当前默认是 `https://tts.efforttracking.online`
4. 若本机设了 `QWEN_TTS_API_KEY`，再加 Actions Secret `VITE_API_KEY`，值相同
5. 等 **Actions → Deploy GitHub Pages** 跑绿，会写出 `gh-pages` 分支
6. 仓库 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**，Branch 选 `gh-pages` / `/ (root)`，保存
7. 打开 https://kian-kong.github.io/qwen-tts/

Mac 要保持 FastAPI 和命名隧道都在跑。重启电脑后重新 `make start` 和 `make tunnel`。只有临时链接才用 `make tunnel-quick`。

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

预设说话人在配音页按语系分组：**中文（Qwen3-TTS 1.7B）** 是 Vivian / Serena / Uncle Fu / Dylan / Eric，和 Kokoro 的轻量中文分组并列、检查点不同。文稿语言切到英文时英文组置顶，切到中文时中文组置顶。

## 声音克隆（Qwen Base）

Qwen3 页的「声音克隆」仍走 **Qwen3-TTS Base 1.7B**。先 `make download`，录音或上传 3–10 秒参考音频 + 逐字稿。

## LongCat 克隆 + 配音

和 Qwen3、Kokoro 并列的第三个引擎页，只做声音克隆再分段配音（没有预设/描述）。先 `make download-longcat`，配音页切到 **LongCat**。权重约 7GB bf16，16GB 机器上生成前会卸掉 Qwen / Kokoro / ASR。推理用 APG（`guidance_method=apg`，`steps=16`）。

```bash
curl -s -X POST http://127.0.0.1:8000/api/jobs \
  -F "text=1. 你好，这是克隆试听。" \
  -F "mode=longcat" \
  -F "ref_audio=@./ref.wav" \
  -F "ref_text=参考音频的逐字稿" \
  -F "language=Chinese"
```

## 轻量配音（Kokoro）

英文用 **Kokoro-82M v1.0**，中文用 **Kokoro-82M v1.1-zh**，是两套权重、两套词表，不能互相替代。

### 英文

`make download-kokoro` 后，配音页切到 **Kokoro**。英文是 **v1.0 的 28 个音色**（美式 11 女 / 9 男，英式 4 女 / 4 男），和中文分组分开列，避免被 100 个中文音色挤掉。适合批量旁白，Apache 2.0 可商用。不能克隆或描述音色。生成时会卸掉 Qwen TTS。

读音用 Misaki。文稿里可写 `[Kokoro](/kˈOkəɹO/)` 指定某个词的音标；点 **看读音** 会转出整段音标，**写入标注** 会把文稿改成这种格式。

多选默认仍是每个音色各出一轨。勾选 **融合已选音色** 后，只支持同性音色（女声+女声或男声+男声），每个音色有独立滑条。向量会先按最后一维 L2 归一化，再按滑条比例加性混合，最后把幅度拉回加权均值，只出一轨。

```bash
curl -s -X POST http://127.0.0.1:8000/api/jobs \
  -F "text=1. Hello from Kokoro." \
  -F "mode=kokoro" \
  -F "speakers=af_heart,af_bella" \
  -F "blend=true" \
  -F "blend_weights=70,30" \
  -F "language=English"
```

### 中文

`make download-kokoro-zh` 后，音色面板下方多出 **中文音色** 分组。上游 v1.1-zh 一共 100 个中文音色（55 女声 / 45 男声），默认只列出两个官方示例音色（`zf_001` / `zm_010`），点「展开全部」看其余。

上游还带 3 个**英文**音色：Maple（`af_maple`）、Sol（`af_sol`）、Vale（`bf_vale`），是 v1.1-zh 那次训练里一起加进来的美式/英式女声，v1.0 里没有。它们显示在**英文音色**分组里、走英文读音，但权重仍在 v1.1-zh 检查点上——所以「说什么语言」和「用哪套权重」在代码里是两个独立的维度（`family` 与 `model`），不能合并。

- 英文音色和中文音色**不能同时选**，切换检查点或语系都会替换当前选择，不会混选（后端直接拒绝）
- 文稿按所选音色所属语系分句（中文 80 字/段，英文 220 字/段）；融合只支持同检查点 + 同性别
- 中文音色没有 IPA 音标编辑（`[词](/音标/)` 标注是英文 G2P 的能力），「看读音」按钮在中文音色下会隐藏

```bash
# 中文
curl -s -X POST http://127.0.0.1:8000/api/jobs \
  -F "text=1. 这是一段中文试听。" \
  -F "mode=kokoro" \
  -F "speakers=zf_001" \
  -F "language=Chinese"

# v1.1-zh 自带的英文音色（走英文读音，权重仍是 v1.1-zh）
curl -s -X POST http://127.0.0.1:8000/api/jobs \
  -F "text=1. This is Maple reading English." \
  -F "mode=kokoro" \
  -F "speakers=af_maple" \
  -F "language=English"
```

中文 G2P 用 `misaki[zh]` 的 v1.1 前端（注音符号 + 声调）。上游只发 `.pth` 和 `voices/*.pt`，`make download-kokoro-zh` 下载后会用 `scripts/pt_to_safetensors.py` 在本地转成 MLX 的 safetensors（不需要装 torch）。转换要点：

- 官方 `.pth` 是 `nn.DataParallel` 存出来的，每个子模块的 key 都带一段 `module.`（`bert.module.embeddings...`）。mlx-audio 的 `sanitize()` 只按 `bert` / `text_encoder` / `predictor` / `decoder` 前缀匹配，前缀不剥掉就加载不上，所以转换时要还原成 `bert.embeddings...`（转换后 548 个张量，与 v1.0 的 key 集合逐一对应）
- 下载只用国内镜像：config + 权重走 ModelScope，103 个音色走 hf-mirror（ModelScope 的镜像里没有 `voices/`）。hf-mirror 不代理 Xet 存储（会返回 401），所以 `mirrors.sh` 里设了 `HF_HUB_DISABLE_XET=1`

中文长句会被上游的防「赶拍」曲线降速（v1.1-zh 训练数据只到 100 token 左右，超过就会赶）：音素 ≤83 用 1.1 倍速，之后线性降到 0.88 倍。

改完这几处可以直接体检一遍（模型文件 / 音色路由 / 词表覆盖 / 速度曲线 / ASR 回读）：

```bash
mlx-tts-env/bin/python scripts/check_kokoro_zh.py
```

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

## 语音转文字

先 `make download-asr`。页面顶部有独立的 **语音转文字** 区（带进度条），识别完可点「填入配音文稿」或「填入克隆逐字稿」。转写和配音共用 GPU：加载 ASR 会卸掉 TTS，反过来也会。

默认是 **Qwen3-ASR 1.7B bf16**。内存更紧可以用 0.6B：`./scripts/download_model.sh asr-0.6b`。

`POST /api/transcribe` 立刻返回任务，轮询 `GET /api/transcribe/{id}` 看进度：

```bash
JOB=$(curl -s -X POST http://127.0.0.1:8000/api/transcribe \
  -F "audio=@./speech.wav" \
  -F "language=Auto" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s "http://127.0.0.1:8000/api/transcribe/$JOB"
```

OpenAI 兼容：`POST /v1/audio/transcriptions`，字段 `file`。

## 会议字幕（听对方）

侧栏 **实时翻译** 可选音频来源，字幕可弹出成小窗。听的是会议扬声器，不是把本页装进 Zoom。

- **网页会议**（Chrome 里的 Meet / Zoom）：音频来源选「共享会议声音」，开始后选会议标签页并勾选分享音频。Chrome / Edge 的「弹出字幕」能浮在 Zoom 全屏上。
- **桌面 Zoom / 腾讯会议**：浏览器抓不到应用内部声音。安装 BlackHole 或 Loopback，把会议输出接到「扬声器 + 虚拟设备」的多输出，音频来源选「输入设备」。
- Safari 不能置顶，会打开一个普通小窗口，自己拖到会议旁边。

不要同时开麦克风，避免把自己的声音和对方混进同一块。

## Excel 文稿

页面「文稿」里可以把编号列表存成本机配音列表，起名后下次直接载入，不必再粘贴。文件在 `data/scripts/<id>.md`。也可以导入 `.xlsx` / `.csv`：每个非空单元格变成一段语音；表头（序号 / 文案等）和行号列会跳过。

```bash
curl -s -X POST http://127.0.0.1:8000/api/import-script \
  -F "file=@./script.xlsx"
```

## 准备参考音频

1. 录 3–10 秒干净人声（中文或英文），尽量单人、少混响
2. 写好逐字稿，点「保存到音色库」。文件写在 `data/voices/<id>.wav` + `.txt`，下次在 Qwen3 或 LongCat 的克隆列表里点选。

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

长文本会按句切分，合成后再拼成 44.1kHz / 24bit WAV。

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
- 国内镜像下载走 ModelScope → hf-mirror；hf-mirror 不代理 HF 的 Xet 存储（会 401），`scripts/mirrors.sh` 已设 `HF_HUB_DISABLE_XET=1` 回落到普通 HTTP
- 首次推理有 warmup，会偏慢；之后 RTF 大约 0.48，快于实时
- Qwen 预设 / 描述 / 克隆用 1.7B bf16，不要量化到 4bit；LongCat 页的克隆用 3.5B bf16
- 参考音频和文字稿必须对齐，否则克隆质量会掉
