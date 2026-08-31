import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  sendLiveTranslateChunk,
  startLiveTranslate,
  stopLiveTranslate,
  type Health,
  type Language,
  type LiveTranslateLine,
} from "../api";
import { LIVE_CAPTION_CHANNEL, isCaptionEvent } from "../liveCaptions";
import {
  canDocumentPip,
  captureAudio,
  copyDocumentChrome,
  listAudioInputs,
  recorderFormat,
  type CaptureSource,
} from "../liveMedia";
import { LiveCaptionOverlay } from "./LiveCaptionOverlay";

const SLICE_MS = 2500;

export function LiveTranslatePanel({
  health,
  languages,
}: {
  health: Health | null;
  languages: Language[];
}) {
  const [sourceLanguage, setSourceLanguage] = useState("Auto");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [captureSource, setCaptureSource] = useState<CaptureSource>("mic");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
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
  const busyRef = useRef(false);
  const linesRef = useRef<LiveTranslateLine[]>([]);
  const startGenRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pipRootRef = useRef<Root | null>(null);
  const pipWinRef = useRef<Window | null>(null);
  const format = recorderFormat();
  const targets = languages.filter((item) => item.id !== "Auto");
  const ready = health?.asr_model_ready !== false && health?.instruct_model_ready !== false;
  const deviceReady = captureSource !== "device" || Boolean(deviceId);

  useEffect(() => {
    return () => {
      void halt();
      closePip();
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(LIVE_CAPTION_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (!isCaptionEvent(event.data)) return;
      if (event.data.type === "hello") {
        channel.postMessage({
          type: "state",
          lines: linesRef.current,
          running: runningRef.current,
          busy: busyRef.current,
        });
      }
      if (event.data.type === "halt") void halt();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    linesRef.current = lines;
    runningRef.current = running;
    busyRef.current = busy;
    channelRef.current?.postMessage({ type: "state", lines, running, busy });
    pipRootRef.current?.render(
      <LiveCaptionOverlay lines={lines} running={running} busy={busy} onStop={() => void halt()} />,
    );
  }, [lines, running, busy]);

  useEffect(() => {
    if (captureSource !== "device") return;
    void refreshDevices();
  }, [captureSource]);

  async function refreshDevices() {
    try {
      setDevices(await listAudioInputs());
    } catch {
      setDevices([]);
    }
  }

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

  function closePip() {
    pipRootRef.current?.unmount();
    pipRootRef.current = null;
    pipWinRef.current?.close();
    pipWinRef.current = null;
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
    if (!ready || starting || running || !deviceReady) return;
    const gen = startGenRef.current;
    setStarting(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await captureAudio(captureSource, deviceId);
      if (startGenRef.current !== gen) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      await startLiveTranslate(sourceLanguage, targetLanguage);
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
      recorder.onerror = () => setError("录音失败");
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => void halt();
      });
      streamRef.current = stream;
      recorderRef.current = recorder;
      runningRef.current = true;
      recorder.start(SLICE_MS);
      setRunning(true);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      await halt();
      setError(err instanceof Error ? err.message : "无法开始实时翻译");
    } finally {
      setStarting(false);
    }
  }

  async function onPop() {
    if (canDocumentPip()) {
      try {
        if (pipWinRef.current && !pipWinRef.current.closed) {
          pipWinRef.current.focus();
          return;
        }
        const pip = await window.documentPictureInPicture!.requestWindow({ width: 480, height: 280 });
        copyDocumentChrome(pip.document);
        pip.document.body.className = "live-pip-body";
        const mount = pip.document.createElement("div");
        pip.document.body.appendChild(mount);
        const root = createRoot(mount);
        pipRootRef.current = root;
        pipWinRef.current = pip;
        root.render(
          <LiveCaptionOverlay lines={lines} running={running} busy={busy} onStop={() => void halt()} />,
        );
        pip.addEventListener("pagehide", () => {
          root.unmount();
          if (pipRootRef.current === root) pipRootRef.current = null;
          if (pipWinRef.current === pip) pipWinRef.current = null;
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError("浏览器拒绝了置顶小窗");
          return;
        }
      }
    }
    const url = new URL(window.location.href);
    url.hash = "#/captions";
    const popup = window.open(url.toString(), "qwen-captions", "popup=yes,width=480,height=320");
    if (!popup) setError("浏览器拦截了弹窗，请允许后重试");
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

  const captureHint =
    captureSource === "share"
      ? "开始后选择会议所在标签页，并勾选分享音频。不要同时开麦。"
      : captureSource === "device"
        ? "把会议输出接到 BlackHole 或多输出设备（扬声器 + 虚拟设备），再选那个输入。不要同时开麦。"
        : "对着麦克风说话，每隔几秒出一列原文和译文。网页会议用共享标签页音频；桌面会议用虚拟输入。";

  return (
    <section className="live-workspace">
      <div className="panel live-side">
        <header className="panel-head">
          <h2>实时翻译</h2>
        </header>
        <p className="hint">
          {captureHint} 不接配音队列。第一次会卸掉 TTS，同时加载转写和翻译模型。
          {health?.asr_model_ready === false ? " 请先运行 `make download-asr`。" : ""}
          {health?.instruct_model_ready === false ? " 请先运行 `make download-instruct`。" : ""}
        </p>
        <div className="stack">
          <label>
            音频来源
            <select
              value={captureSource}
              disabled={running || starting}
              onChange={(e) => setCaptureSource(e.target.value as CaptureSource)}
            >
              <option value="mic">麦克风</option>
              <option value="share">共享会议声音</option>
              <option value="device">输入设备</option>
            </select>
          </label>
          {captureSource === "device" ? (
            <label>
              输入设备
              <select
                value={deviceId}
                disabled={running || starting}
                onChange={(e) => setDeviceId(e.target.value)}
                onFocus={() => void refreshDevices()}
              >
                <option value="">请选择 BlackHole / Loopback</option>
                {devices.map((item, index) => (
                  <option key={item.deviceId || index} value={item.deviceId}>
                    {item.label || `输入设备 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          <div className="live-actions">
            {running ? (
              <button type="button" className="stop" onClick={() => void halt()}>
                停止
              </button>
            ) : (
              <button
                type="button"
                className="live-start"
                onClick={() => void onStart()}
                disabled={!ready || starting || !deviceReady}
              >
                {starting ? "正在加载模型…" : captureSource === "mic" ? "开始听写翻译" : "开始听会议"}
              </button>
            )}
            <button type="button" className="ghost" onClick={() => void onPop()}>
              弹出字幕
            </button>
          </div>
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
