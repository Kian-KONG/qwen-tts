import { useEffect, useState } from "react";
import type { LiveTranslateLine } from "../api";
import { useI18n } from "../i18n";
import { LIVE_CAPTION_CHANNEL, isCaptionEvent } from "../liveCaptions";
import { LiveCaptionOverlay } from "./LiveCaptionOverlay";

export function LiveCaptionsPage() {
  const { t, locale } = useI18n();
  const [lines, setLines] = useState<LiveTranslateLine[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = t("live.captionsTitle");
    const channel = new BroadcastChannel(LIVE_CAPTION_CHANNEL);
    channel.onmessage = (event) => {
      if (!isCaptionEvent(event.data) || event.data.type !== "state") return;
      setLines(event.data.lines);
      setRunning(event.data.running);
      setBusy(event.data.busy);
    };
    channel.postMessage({ type: "hello" });
    return () => {
      document.title = t("app.title");
      channel.close();
    };
  }, [locale, t]);

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
      <p className="hint live-pop-hint">{t("live.popHint")}</p>
    </div>
  );
}
