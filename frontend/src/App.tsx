import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createJob,
  createVoice,
  deleteVoice,
  getHealth,
  getJob,
  listLanguages,
  listSpeakers,
  listVoices,
  type Health,
  type Job,
  type Language,
  type Speaker,
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

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [language, setLanguage] = useState("Auto");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [speaker, setSpeaker] = useState("Ryan");
  const [voiceId, setVoiceId] = useState("");
  const [voiceName, setVoiceName] = useState("Studio A");
  const [voiceMode, setVoiceMode] = useState<"preset" | "design" | "clone">("preset");
  const [instruct, setInstruct] = useState(VOICE_PRESETS[0].text);
  const [styleInstruct, setStyleInstruct] = useState("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [batchSize, setBatchSize] = useState(4);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

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
      setVoiceId((current) => current || nextVoices[0]?.id || "");
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
    if (!job || job.status === "done" || job.status === "error") return;
    const timer = window.setInterval(async () => {
      const next = await getJob(job.id);
      setJob(next);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

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

  async function onDeleteVoice() {
    if (!voiceId) return;
    await deleteVoice(voiceId);
    setVoiceId("");
    await refresh();
  }

  const audioUrl = job?.status === "done" ? `/api/jobs/${job.id}/audio` : "";
  const zipUrl = job?.status === "done" ? job.zip_url : "";

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
              {health?.design_model_ready ? " · 描述可用" : " · 描述未下载"} · {language} · batch {batchSize}
            </p>
          </div>
        </div>
      </header>

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
              声音克隆
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
              <p className="hint">录 3–10 秒干净参考音频，语言尽量和文稿一致，并写上逐字稿。</p>
              <form className="stack" onSubmit={onSaveVoice}>
                <label>
                  音色名称
                  <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
                </label>
                <label>
                  参考音频
                  <input
                    type="file"
                    accept="audio/wav,audio/mpeg,audio/*"
                    onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
                  />
                </label>
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
                  <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                    <option value="">本次上传 / 未选择</option>
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                        {voice.duration_sec ? ` · ${voice.duration_sec}s` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="ghost" onClick={() => void onDeleteVoice()} disabled={!voiceId}>
                    删除
                  </button>
                </div>
              </form>
            </>
          )}
        </section>

        <section className="panel">
          <h2>2. Markdown 文稿</h2>
          <form className="stack" onSubmit={onGenerate}>
            <div className="row">
              <label className="grow">
                语言
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline">
                batch
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value) || 4)}
                />
              </label>
            </div>
            <p className="hint">用 Markdown 有序列表编辑：`1.` `2.` `3.` 一项一段。回车会自动下一项；成片仍按编号合并。</p>
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
                <a className="button" href={audioUrl} download={`${job.id}.wav`}>
                  完整轨
                </a>
                {zipUrl ? (
                  <a className="button ghost" href={zipUrl} download={`${job.id}.zip`}>
                    打包分段
                  </a>
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
                    <a href={segment.url} download={`${job.id}_${String(segment.index).padStart(3, "0")}.wav`}>
                      下载
                    </a>
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
