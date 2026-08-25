import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  createJob,
  createTranscribeJob,
  createVoice,
  deleteVoice,
  downloadFile,
  getHealth,
  getJob,
  getTranscribeJob,
  importScript,
  listLanguages,
  listSpeakers,
  listVoices,
  renameVoice,
  voiceAudioUrl,
  withDownload,
  type Health,
  type Job,
  type Language,
  type Speaker,
  type Transcript,
  type Voice,
} from "./api";

const SAMPLE_MARKDOWN = `1. Welcome to this week's product update.
2. We shipped faster voice cloning for internal videos, running entirely on a Mac mini.
3. The narration should sound natural, steady, and easy to cut against picture.`;

const ITEM_MARK = /^\s*(?:\d{1,3}[\.\)、:：]|\(\d{1,3}\)|\（\d{1,3}\）)\s*/;

const VOICE_PRESETS = [
  {
    label: "沉稳男旁白",
    text: "A calm adult male narrator, warm mid pitch, clear studio diction, American English, no accent, professional documentary tone.",
  },
  {
    label: "年轻女声",
    text: "A cheerful young female voice, bright and energetic, slightly high pitch, natural conversational English.",
  },
  {
    label: "新闻主播",
    text: "A confident news anchor voice, even pacing, authoritative but not harsh, broadcast studio quality.",
  },
  {
    label: "温柔女旁白",
    text: "A gentle adult female narrator, soft mid pitch, slow and warm, intimate storytelling tone.",
  },
];

function parseMarkdownList(text: string): string[] {
  const items: string[] = [];
  let current: string | null = null;
  let sawMark = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(ITEM_MARK);
    if (match) {
      sawMark = true;
      if (current?.trim()) items.push(current.trim());
      current = line.slice(match[0].length);
      continue;
    }
    if (current == null) continue;
    const extra = line.trim();
    if (extra) current = `${current.trim()} ${extra}`;
  }
  if (current?.trim()) items.push(current.trim());
  if (sawMark && items.length) return items;
  return text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toMarkdown(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
}

const ASR_STAGES: Record<string, string> = {
  queued: "排队中",
  converting: "转换音频",
  loading: "加载转写模型",
  transcribing: "识别中",
  done: "完成",
  error: "失败",
};

const VOICE_MODE_KEY = "qwen-tts-voice-mode";
const VOICE_ID_KEY = "qwen-tts-voice-id";

function stored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function storedVoiceMode(): "preset" | "design" | "clone" {
  const value = stored(VOICE_MODE_KEY, "preset");
  return value === "design" || value === "clone" || value === "preset" ? value : "preset";
}

function FileField({
  label,
  accept,
  file,
  emptyText = "未选择文件",
  buttonText,
  onChange,
}: {
  label: string;
  accept: string;
  file?: File | null;
  emptyText?: string;
  buttonText?: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="file-field-wrap">
      {label}
      <span className="file-field">
        <span className="file-name">{file ? file.name : emptyText}</span>
        <span className="file-btn">{buttonText || (file ? "更换文件" : "选择文件")}</span>
        <input
          type="file"
          accept={accept}
          onChange={(event) => {
            onChange(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </span>
    </label>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [language, setLanguage] = useState("Auto");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [speaker, setSpeaker] = useState("Ryan");
  const [voiceId, setVoiceId] = useState(() => stored(VOICE_ID_KEY, ""));
  const [voiceName, setVoiceName] = useState("Studio A");
  const [voiceMode, setVoiceMode] = useState<"preset" | "design" | "clone">(storedVoiceMode);
  const [instruct, setInstruct] = useState(VOICE_PRESETS[0].text);
  const [styleInstruct, setStyleInstruct] = useState("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrLanguage, setAsrLanguage] = useState("Auto");
  const [asrJob, setAsrJob] = useState<Transcript | null>(null);
  const [asrText, setAsrText] = useState("");
  const [asrCopied, setAsrCopied] = useState(false);
  const [excelName, setExcelName] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [batchSize, setBatchSize] = useState(4);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const voicePlayerRef = useRef<HTMLAudioElement | null>(null);

  const filledSegments = useMemo(() => parseMarkdownList(markdown), [markdown]);

  async function refresh() {
    try {
      const [nextHealth, nextVoices, nextLanguages, nextSpeakers] = await Promise.all([
        getHealth(),
        listVoices(),
        listLanguages(),
        listSpeakers(),
      ]);
      setHealth(nextHealth);
      setVoices(nextVoices);
      setLanguages(nextLanguages);
      setSpeakers(nextSpeakers.data);
      setSpeaker((current) => current || nextSpeakers.default || "Ryan");
      setVoiceId((current) => {
        if (current && nextVoices.some((item) => item.id === current)) return current;
        return nextVoices[0]?.id || "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接后端");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_MODE_KEY, voiceMode);
      if (voiceId) window.localStorage.setItem(VOICE_ID_KEY, voiceId);
    } catch {
      /* ignore quota / private mode */
    }
  }, [voiceMode, voiceId]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const timer = window.setInterval(async () => {
      const next = await getJob(job.id);
      setJob(next);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!asrJob?.id || asrJob.status === "done" || asrJob.status === "error") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getTranscribeJob(asrJob.id as string);
        setAsrJob(next);
        if (next.text) setAsrText(next.text);
      } catch (error) {
        setAsrJob((current) =>
          current
            ? { ...current, status: "error", stage: "error", error: error instanceof Error ? error.message : "查询失败" }
            : current,
        );
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [asrJob?.id, asrJob?.status]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("asr");
    if (!id) return;
    void (async () => {
      try {
        const next = await getTranscribeJob(id);
        setAsrJob(next);
        if (next.text) setAsrText(next.text);
      } catch {
        setMessage("找不到转写任务");
      }
    })();
  }, []);

  function addSegment() {
    const next = filledSegments.length + 1;
    setMarkdown((current) => {
      const trimmed = current.replace(/\s+$/, "");
      return trimmed ? `${trimmed}\n${next}. ` : `1. `;
    });
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.length;
    }, 0);
  }

  function tidyNumbers() {
    setMarkdown(toMarkdown(filledSegments));
  }

  async function onImportScript(file: File | null) {
    if (!file) return;
    try {
      const result = await importScript(file);
      setMarkdown(result.markdown);
      setExcelName(file.name);
      setMessage(`已从表格导入 ${result.count} 段，每个单元格一段`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    }
  }

  function onMarkdownKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    const editor = event.currentTarget;
    const pos = editor.selectionStart;
    const lineStart = markdown.lastIndexOf("\n", pos - 1) + 1;
    const line = markdown.slice(lineStart, pos);
    const match = line.match(/^\s*(\d+)[\.\)、:：]\s+(.*)$/);
    if (!match) return;
    event.preventDefault();
    const nextNum = Number(match[1]) + 1;
    const insert = match[2].trim() ? `\n${nextNum}. ` : "";
    if (!insert) return;
    const next = `${markdown.slice(0, pos)}${insert}${markdown.slice(editor.selectionEnd)}`;
    setMarkdown(next);
    const caret = pos + insert.length;
    window.setTimeout(() => {
      editor.selectionStart = editor.selectionEnd = caret;
    }, 0);
  }

  async function onSaveVoice(event: FormEvent) {
    event.preventDefault();
    if (!refFile) {
      setMessage("请先上传 3–10 秒参考音频");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const voice = await createVoice(voiceName, refFile, refText);
      await refresh();
      setVoiceId(voice.id);
      setMessage(`已保存音色 ${voice.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function onTranscribe() {
    if (!asrFile) {
      setMessage("请先选择要识别的音频");
      return;
    }
    if (health?.asr_model_ready === false) {
      setMessage("还没下载 Qwen3-ASR，请先运行 make download-asr");
      return;
    }
    setMessage("");
    setAsrText("");
    setAsrJob({ status: "queued", progress: 0, stage: "queued" });
    try {
      const next = await createTranscribeJob(asrFile, asrLanguage);
      setAsrJob(next.status ? next : { ...next, status: "done", progress: 1, stage: "done" });
      if ((next.status === "done" || !next.status) && next.text) setAsrText(next.text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "转写提交失败";
      setAsrJob({ status: "error", progress: 0, stage: "error", error: detail });
      setMessage(detail);
    }
  }

  function applyAsrToScript() {
    if (!asrText.trim()) return;
    const original = (asrJob?.text || "").trim();
    const next =
      asrJob?.segments?.length && asrText.trim() === original
        ? asrJob.segments.map((item) => `${item.index}. ${item.text}`).join("\n")
        : toMarkdown(parseMarkdownList(asrText));
    setMarkdown(next);
    setMessage("已填入配音文稿");
  }

  function applyAsrToClone() {
    if (!asrText.trim()) return;
    setVoiceMode("clone");
    setRefText(asrText.trim());
    setMessage("已填入克隆逐字稿");
  }

  async function copyAsrText() {
    const text = asrText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.querySelector(".asr-result") as HTMLTextAreaElement | null;
      if (!area) return;
      area.focus();
      area.select();
      document.execCommand("copy");
    }
    setAsrCopied(true);
    setMessage("已复制转写结果");
    window.setTimeout(() => setAsrCopied(false), 2000);
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const next = await createJob({
        text: markdown,
        mode: voiceMode,
        speaker: voiceMode === "preset" ? speaker : undefined,
        instruct: voiceMode === "design" ? instruct : voiceMode === "preset" ? styleInstruct || undefined : undefined,
        voiceId: voiceMode === "clone" ? voiceId || undefined : undefined,
        refAudio: voiceMode === "clone" && !voiceId ? refFile || undefined : undefined,
        refText: voiceMode === "clone" && !voiceId ? refText : undefined,
        batchSize,
        language,
      });
      setJob(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function togglePlayVoice(id: string) {
    const player = voicePlayerRef.current;
    if (!player) return;
    if (playingVoiceId === id && !player.paused) {
      player.pause();
      setPlayingVoiceId(null);
      return;
    }
    setVoiceId(id);
    if (playingVoiceId !== id) {
      player.src = voiceAudioUrl(id);
    }
    try {
      await player.play();
      setPlayingVoiceId(id);
    } catch (error) {
      setPlayingVoiceId(null);
      setMessage(error instanceof Error ? error.message : "无法播放音色");
    }
  }

  function startRenameVoice(voice: Voice) {
    setVoiceId(voice.id);
    setRenamingId(voice.id);
    setRenameValue(voice.name);
  }

  async function onRenameVoice(event: FormEvent) {
    event.preventDefault();
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setMessage("请填写音色名称");
      return;
    }
    try {
      const updated = await renameVoice(renamingId, name);
      setRenamingId(null);
      setVoiceId(updated.id);
      await refresh();
      setMessage(`已重命名为 ${updated.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function onDeleteVoice() {
    if (!voiceId) return;
    if (playingVoiceId === voiceId) {
      voicePlayerRef.current?.pause();
      setPlayingVoiceId(null);
    }
    await deleteVoice(voiceId);
    setVoiceId("");
    setRenamingId(null);
    await refresh();
  }

  async function onDownload(url: string, filename: string) {
    try {
      await downloadFile(url, filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载失败");
    }
  }

  const audioUrl = job?.status === "done" ? job.download_url || apiUrl(`/api/jobs/${job.id}/audio`) : "";
  const zipUrl = job?.status === "done" ? job.zip_url || "" : "";

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Multilingual Dubbing</p>
          <h1>Qwen3-TTS 配音台</h1>
        </div>
        <div className="status">
          <span className={health?.model_loaded || health?.model_dir_ready ? "dot on" : "dot"} />
          <div>
            <strong>
              {(health?.current_mode === "design"
                ? health?.design_model_id
                : health?.current_mode === "preset"
                  ? health?.custom_model_id
                  : health?.model_id
              )?.split("/").pop() || "等待模型"}
            </strong>
            <p>
              {health?.model_loaded ? "已加载" : "未加载"}
              {health?.custom_model_ready ? " · 预设可用" : " · 预设未下载"}
              {health?.design_model_ready ? " · 描述可用" : " · 描述未下载"}
              {health?.asr_model_ready ? " · 转写可用" : " · 转写未下载"} · {language} · batch {batchSize}
            </p>
          </div>
        </div>
      </header>

      <section className="panel asr-panel">
        <div className="asr-head">
          <div>
            <h2>语音转文字</h2>
            <p className="hint">
              独立转写区，不和配音抢界面。上传音频后会显示进度；第一次会先卸载 TTS、加载 Qwen3-ASR 1.7B。
              {health?.asr_model_ready ? "" : " 当前还没下载 ASR 权重，请先运行 `make download-asr`。"}
            </p>
          </div>
          <p className="hint">
            {health?.asr_loaded ? "转写模型已加载" : health?.asr_model_ready ? "转写模型就绪，未加载" : "转写未下载"}
          </p>
        </div>
        <div className="stack">
          <div className="row">
            <div className="grow">
              <FileField
                label="音频"
                accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
                file={asrFile}
                emptyText="wav / m4a / mp3"
                onChange={setAsrFile}
              />
            </div>
            <label>
              语言
              <select value={asrLanguage} onChange={(e) => setAsrLanguage(e.target.value)}>
                {languages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void onTranscribe()}
            disabled={!asrFile || health?.asr_model_ready === false || (asrJob?.status === "queued" || asrJob?.status === "running")}
          >
            {asrJob?.status === "queued" || asrJob?.status === "running" ? "转写中…" : "开始转写"}
          </button>
          {asrJob ? (
            <div className="job">
              <div className="bar">
                <span style={{ width: `${Math.round((asrJob.progress || 0) * 100)}%` }} />
              </div>
              <p>
                {asrJob.status === "done"
                  ? `完成 · ${asrJob.segments?.length || 1} 段 · ${asrJob.duration_sec ?? "-"}s · 耗时 ${asrJob.elapsed_sec ?? "-"}s · ${asrJob.language || asrLanguage}`
                  : asrJob.status === "error"
                    ? asrJob.error
                    : asrJob.chunk && asrJob.chunks
                      ? `识别中 ${asrJob.chunk}/${asrJob.chunks} · ${Math.round((asrJob.progress || 0) * 100)}%`
                      : `${ASR_STAGES[asrJob.stage || asrJob.status || ""] || asrJob.stage || asrJob.status} · ${Math.round((asrJob.progress || 0) * 100)}%`}
              </p>
            </div>
          ) : null}
          <label>
            转写结果
            <textarea
              rows={16}
              className="asr-result"
              value={asrText}
              onChange={(e) => setAsrText(e.target.value)}
              placeholder="识别结果会出现在这里，可再编辑。"
            />
          </label>
          <div className="row">
            <button type="button" className="ghost" onClick={() => void copyAsrText()} disabled={!asrText.trim()}>
              {asrCopied ? "已复制" : "复制结果"}
            </button>
            <button type="button" className="ghost" onClick={applyAsrToScript} disabled={!asrText.trim()}>
              填入配音文稿
            </button>
            <button type="button" className="ghost" onClick={applyAsrToClone} disabled={!asrText.trim()}>
              填入克隆逐字稿
            </button>
          </div>
        </div>
      </section>

      <main className="grid">
        <section className="panel">
          <h2>1. 音色</h2>
          <div className="mode-switch">
            <button type="button" className={voiceMode === "preset" ? "active" : "ghost"} onClick={() => setVoiceMode("preset")}>
              预设说话人
            </button>
            <button type="button" className={voiceMode === "design" ? "active" : "ghost"} onClick={() => setVoiceMode("design")}>
              描述音色
            </button>
            <button type="button" className={voiceMode === "clone" ? "active" : "ghost"} onClick={() => setVoiceMode("clone")}>
              声音克隆{voices.length ? `（${voices.length}）` : ""}
            </button>
          </div>
          {voiceMode === "preset" ? (
            <div className="stack">
              <p className="hint">
                点选官方音色后直接配音，不用写描述也不用上传参考音频。
                {health?.custom_model_ready ? "" : " 当前还没下载 CustomVoice 权重，请先运行 `make download-custom`。"}
              </p>
              <div className="speaker-grid">
                {speakers.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={speaker === item.id ? "speaker on" : "speaker"}
                    onClick={() => setSpeaker(item.id)}
                  >
                    {item.label}
                    <small>
                      {item.native}
                      {item.description ? ` · ${item.description}` : ""}
                    </small>
                  </button>
                ))}
              </div>
              <label>
                语气（可选）
                <input
                  value={styleInstruct}
                  onChange={(e) => setStyleInstruct(e.target.value)}
                  placeholder="Very happy and excited."
                />
              </label>
            </div>
          ) : voiceMode === "design" ? (
            <div className="stack">
              <p className="hint">
                不用上传参考音频。用一段话描述年龄、性别、口音和气质即可直接配音。
                {health?.design_model_ready ? "" : " 当前还没下载 VoiceDesign 权重，请先运行 `make download-design`。"}
              </p>
              <div className="chips">
                {VOICE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={instruct === preset.text ? "chip on" : "chip"}
                    onClick={() => setInstruct(preset.text)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label>
                音色描述
                <textarea
                  rows={5}
                  value={instruct}
                  onChange={(e) => setInstruct(e.target.value)}
                  placeholder="A calm adult male narrator, warm mid pitch, clear studio diction..."
                />
              </label>
            </div>
          ) : (
            <>
              <p className="hint">
                上传过的音色保存在本机 `data/voices/`，刷新后仍可点选复用。新音色录 3–10 秒干净人声，并写上逐字稿。
              </p>
              {voices.length ? (
                <div className="stack">
                  <audio
                    ref={voicePlayerRef}
                    className="voice-player"
                    onEnded={() => setPlayingVoiceId(null)}
                  />
                  <div className="voice-list">
                    {voices.map((voice) => (
                      <div key={voice.id} className={voiceId === voice.id ? "voice-card on" : "voice-card"}>
                        <button type="button" className="voice-select" onClick={() => setVoiceId(voice.id)}>
                          <strong>{voice.name}</strong>
                          <small>
                            {voice.duration_sec ? `${voice.duration_sec}s` : "已保存"}
                            {voice.ref_text ? ` · ${voice.ref_text.slice(0, 36)}` : ""}
                          </small>
                        </button>
                        <div className="voice-actions">
                          <button type="button" className="ghost mini" onClick={() => void togglePlayVoice(voice.id)}>
                            {playingVoiceId === voice.id ? "暂停" : "播放"}
                          </button>
                          <button type="button" className="ghost mini" onClick={() => startRenameVoice(voice)}>
                            重命名
                          </button>
                        </div>
                        {renamingId === voice.id ? (
                          <form className="voice-rename" onSubmit={(event) => void onRenameVoice(event)}>
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              autoFocus
                              placeholder="新的音色名称"
                            />
                            <button type="submit" disabled={busy || !renameValue.trim()}>
                              保存
                            </button>
                            <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                              取消
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="hint">还没有保存过克隆音色。保存一次后会留在本机，下次直接选用。</p>
              )}
              <form className="stack" onSubmit={onSaveVoice}>
                <label>
                  音色名称
                  <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
                </label>
                <FileField
                  label="参考音频"
                  accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
                  file={refFile}
                  emptyText="wav / m4a / mp3，3–10 秒"
                  onChange={setRefFile}
                />
                <label>
                  参考音频文字稿
                  <textarea
                    rows={4}
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    placeholder="Exactly what the reference clip says."
                  />
                </label>
                <div className="row">
                  <button type="submit" disabled={busy}>
                    保存到音色库
                  </button>
                  <button type="button" className="ghost" onClick={() => void onDeleteVoice()} disabled={!voiceId}>
                    删除所选
                  </button>
                </div>
              </form>
            </>
          )}
        </section>

        <section className="panel">
          <h2>2. Markdown 文稿</h2>
          <form className="stack" onSubmit={onGenerate}>
            <div className="script-controls">
              <label>
                语言
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                并发
                <div className="stepper">
                  <button
                    type="button"
                    className="ghost"
                    aria-label="减少并发"
                    disabled={batchSize <= 1}
                    onClick={() => setBatchSize((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <span className="stepper-value">{batchSize}</span>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="增加并发"
                    disabled={batchSize >= 8}
                    onClick={() => setBatchSize((n) => Math.min(8, n + 1))}
                  >
                    +
                  </button>
                </div>
              </label>
            </div>
            <p className="hint">
              用 Markdown 有序列表编辑：`1.` `2.` `3.` 一项一段。也可以导入 Excel / CSV，每个非空单元格就是一段语音。
            </p>
            <FileField
              label="导入 Excel / CSV"
              accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              emptyText={excelName || "xlsx / csv，每个单元格一段"}
              buttonText="导入表格"
              onChange={(file) => void onImportScript(file)}
            />
            <textarea
              ref={editorRef}
              className="markdown-editor"
              rows={12}
              spellCheck={false}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onKeyDown={onMarkdownKeyDown}
              placeholder={"1. First line.\n2. Second line."}
            />
            <ol className="md-preview">
              {filledSegments.map((item, index) => (
                <li key={`${index}-${item.slice(0, 24)}`}>
                  <span>{index + 1}.</span>
                  <p>{item}</p>
                </li>
              ))}
            </ol>
            <div className="row meta">
              <button type="button" className="ghost" onClick={addSegment}>
                添加一项
              </button>
              <button type="button" className="ghost" onClick={tidyNumbers}>
                整理编号
              </button>
              <span>{filledSegments.length} 段</span>
            </div>
            <button
              type="submit"
              disabled={
                busy ||
                filledSegments.length === 0 ||
                (voiceMode === "preset" && (!speaker || health?.custom_model_ready === false)) ||
                (voiceMode === "design" && (!instruct.trim() || health?.design_model_ready === false)) ||
                (voiceMode === "clone" && !voiceId && (!refFile || !refText.trim()))
              }
            >
              {busy ? "提交中…" : `分段配音（${filledSegments.length} 段）`}
            </button>
          </form>
        </section>
      </main>

      <section className="panel playback">
        <div>
          <h2>3. 分段成片</h2>
          <p className="hint">编号对应单段 WAV，完整轨是按编号顺序拼起来的结果。</p>
        </div>
        {job ? (
          <div className="job">
            <div className="bar">
              <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
            </div>
            <p>
              {job.status === "done"
                ? `完成 · ${job.segments?.length || job.chunks} 段 · ${job.audio_sec}s · 耗时 ${job.elapsed_sec}s · RTF ${job.rtf}`
                : job.status === "error"
                  ? job.error
                  : `${job.status} · ${Math.round((job.progress || 0) * 100)}%`}
            </p>
            {audioUrl ? (
              <div className="player">
                <audio controls src={audioUrl} />
                <button type="button" onClick={() => void onDownload(withDownload(audioUrl), `${job.id}.wav`)}>
                  完整轨
                </button>
                {zipUrl ? (
                  <button type="button" className="ghost" onClick={() => void onDownload(zipUrl, `${job.id}.zip`)}>
                    打包分段
                  </button>
                ) : null}
              </div>
            ) : null}
            {job.status === "done" && job.segments?.length ? (
              <ol className="clips">
                {job.segments.map((segment) => (
                  <li key={segment.index}>
                    <div>
                      <strong>{segment.index}.</strong>
                      <p>{segment.text}</p>
                    </div>
                    <audio controls src={segment.url} />
                    <button
                      type="button"
                      className="ghost mini"
                      onClick={() =>
                        void onDownload(
                          withDownload(segment.url),
                          `${job.id}_${String(segment.index).padStart(3, "0")}.wav`,
                        )
                      }
                    >
                      下载
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : (
          <p className="hint">生成结果会按编号显示在这里。</p>
        )}
        {message ? <p className="flash">{message}</p> : null}
      </section>
    </div>
  );
}
