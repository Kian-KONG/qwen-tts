import { useEffect, useState } from "react";
import type { LiveTranslateLine } from "../api";
import { LIVE_CAPTION_CHANNEL, isCaptionEvent } from "../liveCaptions";
import { LiveCaptionOverlay } from "./LiveCaptionOverlay";

export function LiveCaptionsPage() {
  const [lines, setLines] = useState<LiveTranslateLine[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "会议字幕";
    const channel = new BroadcastChannel(LIVE_CAPTION_CHANNEL);
    channel.onmessage = (event) => {
      if (!isCaptionEvent(event.data) || event.data.type !== "state") return;
      setLines(event.data.lines);
      setRunning(event.data.running);
      setBusy(event.data.busy);
    };
    channel.postMessage({ type: "hello" });
    return () => channel.close();
  }, []);

  return (
    <div className="live-pop">
      <LiveCaptionOverlay
        lines={lines}
        running={running}
        busy={busy}
        onStop={() => {
          const channel = new BroadcastChannel(LIVE_CAPTION_CHANNEL);
          channel.postMessage({ type: "halt" });
          channel.close();
        }}
      />
      <p className="hint live-pop-hint">此窗口不会置顶，请拖到会议旁边。请用 Chrome / Edge 弹出字幕才能浮在 Zoom 上。</p>
    </div>
  );
}
