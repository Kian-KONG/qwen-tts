import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createJob,
  createVoice,
  deleteVoice,
  getHealth,
  getJob,
  listVoices,
  type Health,
  type Job,
  type Voice,
} from "./api";

const SAMPLE_SCRIPT = `Welcome to this week's product update.
We shipped faster voice cloning for internal English videos, running entirely on a Mac mini.
The narration should sound natural, steady, and easy to cut against picture.`;

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [voiceName, setVoiceName] = useState("Studio A");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [batchSize, setBatchSize] = useState(4);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const chunks = useMemo(
    () =>
      script
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean),
    [script],
  );

  async function refresh() {
    try {
      const [nextHealth, nextVoices] = await Promise.all([getHealth(), listVoices()]);
      setHealth(nextHealth);
      setVoices(nextVoices);
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

  async function onSaveVoice(event: FormEvent) {
    event.preventDefault();
    if (!refFile) {
      setMessage("请先上传 3–10 秒英文参考音频");
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
        text: script,
        voiceId: voiceId || undefined,
        refAudio: voiceId ? undefined : refFile || undefined,
        refText: voiceId ? undefined : refText,
        batchSize,
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

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Internal English Dubbing</p>
          <h1>Qwen3-TTS 配音台</h1>
        </div>
        <div className="status">
          <span className={health?.model_loaded || health?.model_dir_ready ? "dot on" : "dot"} />
          <div>
            <strong>{health?.model_id?.split("/").pop() || "等待模型"}</strong>
            <p>
              {health?.model_loaded ? "已加载" : health?.model_dir_ready ? "权重已就绪" : "未下载"} · batch {batchSize}
            </p>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>1. 克隆音色</h2>
          <p className="hint">录一段干净的 3–10 秒英文，44.1 kHz / 24-bit WAV 最佳，并写上逐字稿。</p>
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
        </section>

        <section className="panel">
          <h2>2. 英文文稿</h2>
          <form className="stack" onSubmit={onGenerate}>
            <textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} />
            <div className="row meta">
              <span>{script.trim().split(/\s+/).filter(Boolean).length} words</span>
              <span>{chunks.length} sentences</span>
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
            <button type="submit" disabled={busy || !script.trim()}>
              {busy ? "提交中…" : "分段批量配音"}
            </button>
          </form>
        </section>
      </main>

      <section className="panel playback">
        <div>
          <h2>3. 成片音频</h2>
          <p className="hint">长文本按句切分后 batch=4 合成，再拼成 44.1 kHz / 24-bit WAV，方便导入剪辑软件。</p>
        </div>
        {job ? (
          <div className="job">
            <div className="bar">
              <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
            </div>
            <p>
              {job.status === "done"
                ? `完成 · ${job.audio_sec}s 音频 · 耗时 ${job.elapsed_sec}s · RTF ${job.rtf}`
                : job.status === "error"
                  ? job.error
                  : `${job.status} · ${Math.round((job.progress || 0) * 100)}%`}
            </p>
            {audioUrl ? (
              <div className="player">
                <audio controls src={audioUrl} />
                <a className="button" href={audioUrl} download={`${job.id}.wav`}>
                  下载 WAV
                </a>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="hint">生成结果会显示在这里。</p>
        )}
        {message ? <p className="flash">{message}</p> : null}
      </section>
    </div>
  );
}
