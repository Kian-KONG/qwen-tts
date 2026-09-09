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
import { I18nProvider, languageLabel, useI18n } from "../i18n";
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
  const { t, locale } = useI18n();
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
      <I18nProvider>
        <LiveCaptionOverlay lines={lines} running={running} busy={busy} onStop={() => void halt()} />
      </I18nProvider>,
    );
  }, [lines, running, busy, locale]);

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
      setError(err instanceof Error ? err.message : t("msg.translateChunkFail"));
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
      recorder.onerror = () => setError(t("msg.recFail"));
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
      setError(err instanceof Error ? err.message : t("msg.liveStartFail"));
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
          <I18nProvider>
            <LiveCaptionOverlay lines={lines} running={running} busy={busy} onStop={() => void halt()} />
          </I18nProvider>,
        );
        pip.addEventListener("pagehide", () => {
          root.unmount();
          if (pipRootRef.current === root) pipRootRef.current = null;
          if (pipWinRef.current === pip) pipWinRef.current = null;
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError(t("msg.pipDenied"));
          return;
        }
      }
    }
    const url = new URL(window.location.href);
    url.hash = "#/captions";
    const popup = window.open(url.toString(), "qwen-captions", "popup=yes,width=480,height=320");
    if (!popup) setError(t("msg.popupBlocked"));
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
      setError(t("msg.copyFail"));
    }
  }

  const captureHint =
    captureSource === "share"
      ? t("live.hintShare")
      : captureSource === "device"
        ? t("live.hintDevice")
        : t("live.hintMic");

  return (
    <section className="live-workspace">
      <div className="panel live-side">
        <header className="panel-head">
          <h2>{t("live.title")}</h2>
        </header>
        <p className="hint">
          {captureHint} {t("live.hint")}
          {health?.asr_model_ready === false ? t("live.needAsr") : ""}
          {health?.instruct_model_ready === false ? t("live.needInstruct") : ""}
        </p>
        <div className="stack">
          <label>
            {t("live.source")}
            <select
              value={captureSource}
              disabled={running || starting}
              onChange={(e) => setCaptureSource(e.target.value as CaptureSource)}
            >
              <option value="mic">{t("live.mic")}</option>
              <option value="share">{t("live.share")}</option>
              <option value="device">{t("live.device")}</option>
            </select>
          </label>
          {captureSource === "device" ? (
            <label>
              {t("live.device")}
              <select
                value={deviceId}
                disabled={running || starting}
                onChange={(e) => setDeviceId(e.target.value)}
                onFocus={() => void refreshDevices()}
              >
                <option value="">{t("live.pickDevice")}</option>
                {devices.map((item, index) => (
                  <option key={item.deviceId || index} value={item.deviceId}>
                    {item.label || t("live.deviceN", { n: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {t("live.sourceLang")}
            <select
              value={sourceLanguage}
              disabled={running || starting}
              onChange={(e) => setSourceLanguage(e.target.value)}
            >
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {languageLabel(item.id, item.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("live.targetLang")}
            <select
              value={targetLanguage}
              disabled={running || starting}
              onChange={(e) => setTargetLanguage(e.target.value)}
            >
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {languageLabel(item.id, item.label)}
                </option>
              ))}
            </select>
          </label>
          <div className="live-actions">
            {running ? (
              <button type="button" className="stop" onClick={() => void halt()}>
                {t("common.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="live-start"
                onClick={() => void onStart()}
                disabled={!ready || starting || !deviceReady}
              >
                {starting ? t("live.loadingModel") : captureSource === "mic" ? t("live.startMic") : t("live.startMeeting")}
              </button>
            )}
            <button type="button" className="ghost" onClick={() => void onPop()}>
              {t("live.popCaptions")}
            </button>
          </div>
          <p className="hint">
            {running ? (busy ? t("live.recognizing") : t("live.listeningShort")) : health?.instruct_loaded ? t("live.modelOn") : t("live.modelOff")}
          </p>
          {error ? <p className="flash">{error}</p> : null}
        </div>
      </div>
      <div className="live-captions">
        <div className="panel live-caption">
          <header className="panel-head">
            <h2>{t("live.sourceText")}</h2>
            <button type="button" className="ghost mini" onClick={() => setLines([])} disabled={!lines.length}>
              {t("common.clear")}
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
            <h2>{t("live.targetText")}</h2>
            <button type="button" className="ghost mini" onClick={() => void onCopy()} disabled={!lines.length}>
              {copied ? t("common.copied") : t("common.copy")}
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
