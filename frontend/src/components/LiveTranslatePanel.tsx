import { useEffect, useRef, useState } from "react";
import {
  sendLiveTranslateChunk,
  startLiveTranslate,
  stopLiveTranslate,
  type Health,
  type Language,
  type LiveTranslateLine,
} from "../api";

const SLICE_MS = 2500;

function recorderFormat(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  return options.find((item) => MediaRecorder.isTypeSupported(item.mime)) || { mime: "", ext: "webm" };
}

export function LiveTranslatePanel({
  health,
  languages,
}: {
  health: Health | null;
  languages: Language[];
}) {
  const [sourceLanguage, setSourceLanguage] = useState("Auto");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<LiveTranslateLine[]>([]);
  const [copied, setCopied] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueRef = useRef<Blob[]>([]);
  const sendingRef = useRef(false);
  const runningRef = useRef(false);
  const startGenRef = useRef(0);
  const format = recorderFormat();
  const targets = languages.filter((item) => item.id !== "Auto");
  const ready = health?.asr_model_ready !== false && health?.instruct_model_ready !== false;

  useEffect(() => {
    return () => {
      void halt();
    };
  }, []);

  async function flush() {
    if (sendingRef.current || !queueRef.current.length || !runningRef.current) return;
    const blob = queueRef.current.shift();
    if (!blob || blob.size < 800) {
      void flush();
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    try {
      const result = await sendLiveTranslateChunk(new File([blob], `chunk.${format.ext}`, { type: blob.type || format.mime }));
      if (!result.skipped && (result.source_text || result.target_text)) {
        setLines((current) => [...current, result]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "这一段翻译失败");
    } finally {
      sendingRef.current = false;
      setBusy(false);
      void flush();
    }
  }

  async function halt() {
    startGenRef.current += 1;
    runningRef.current = false;
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    queueRef.current = [];
    try {
      await stopLiveTranslate();
    } catch {
      /* ignore */
    }
    setRunning(false);
    setStarting(false);
    setBusy(false);
  }

  async function onStart() {
    if (!ready || starting || running) return;
    const gen = startGenRef.current;
    setStarting(true);
    setError("");
    try {
      await startLiveTranslate(sourceLanguage, targetLanguage);
      if (startGenRef.current !== gen) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (startGenRef.current !== gen) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = format.mime
        ? new MediaRecorder(stream, { mimeType: format.mime })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          queueRef.current.push(event.data);
          void flush();
        }
      };
      recorder.onerror = () => setError("麦克风录音失败");
      streamRef.current = stream;
      recorderRef.current = recorder;
      runningRef.current = true;
      recorder.start(SLICE_MS);
      setRunning(true);
    } catch (err) {
      await halt();
      setError(err instanceof Error ? err.message : "无法开始实时翻译");
    } finally {
      setStarting(false);
    }
  }

  async function onCopy() {
    const text = lines
      .map((line) => [line.source_text, line.target_text].filter(Boolean).join("\n"))
      .join("\n\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("复制失败");
    }
  }

  return (
    <section className="live-workspace">
      <div className="panel live-side">
        <header className="panel-head">
          <h2>实时翻译</h2>
        </header>
        <p className="hint">
          对着麦克风说话，每隔几秒出一列原文和译文。不接配音队列。第一次会卸掉 TTS，同时加载转写和翻译模型。
          {health?.asr_model_ready === false ? " 请先运行 `make download-asr`。" : ""}
          {health?.instruct_model_ready === false ? " 请先运行 `make download-instruct`。" : ""}
        </p>
        <div className="stack">
          <label>
            源语言
            <select
              value={sourceLanguage}
              disabled={running || starting}
              onChange={(e) => setSourceLanguage(e.target.value)}
            >
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标语言
            <select
              value={targetLanguage}
              disabled={running || starting}
              onChange={(e) => setTargetLanguage(e.target.value)}
            >
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <button type="button" className="stop" onClick={() => void halt()}>
              停止
            </button>
          ) : (
            <button type="button" className="live-start" onClick={() => void onStart()} disabled={!ready || starting}>
              {starting ? "正在加载模型…" : "开始听写翻译"}
            </button>
          )}
          <p className="hint">
            {running ? (busy ? "正在识别并翻译…" : "正在听…") : health?.instruct_loaded ? "翻译模型已加载" : "翻译模型未加载"}
          </p>
          {error ? <p className="flash">{error}</p> : null}
        </div>
      </div>
      <div className="live-captions">
        <div className="panel live-caption">
          <header className="panel-head">
            <h2>原文</h2>
            <button type="button" className="ghost mini" onClick={() => setLines([])} disabled={!lines.length}>
              清空
            </button>
          </header>
          <ol className="live-lines">
            {lines.map((line, index) => (
              <li key={`${index}-${line.source_text.slice(0, 12)}`}>{line.source_text}</li>
            ))}
          </ol>
        </div>
        <div className="panel live-caption">
          <header className="panel-head">
            <h2>译文</h2>
            <button type="button" className="ghost mini" onClick={() => void onCopy()} disabled={!lines.length}>
              {copied ? "已复制" : "复制"}
            </button>
          </header>
          <ol className="live-lines">
            {lines.map((line, index) => (
              <li key={`${index}-${line.target_text.slice(0, 12)}`}>{line.target_text}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
