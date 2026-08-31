import type { LiveTranslateLine } from "../api";

export function LiveCaptionOverlay({
  lines,
  running,
  busy,
  onStop,
}: {
  lines: LiveTranslateLine[];
  running: boolean;
  busy: boolean;
  onStop?: () => void;
}) {
  const recent = lines.slice(-4);
  const last = recent[recent.length - 1];
  return (
    <div className="live-overlay">
      <header className="live-overlay-bar">
        <span>{running ? (busy ? "正在识别并翻译…" : "正在听会议…") : "等待开始"}</span>
        {onStop ? (
          <button type="button" className="stop mini" onClick={onStop} disabled={!running}>
            停止
          </button>
        ) : null}
      </header>
      <p className="live-overlay-target">{last?.target_text || "字幕会出现在这里"}</p>
      {last?.source_text ? <p className="live-overlay-source">{last.source_text}</p> : null}
      {recent.length > 1 ? (
        <ol className="live-overlay-prev">
          {recent.slice(0, -1).map((line, index) => (
            <li key={`${index}-${line.target_text.slice(0, 12)}`}>
              <strong>{line.target_text}</strong>
              {line.source_text ? <span>{line.source_text}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
