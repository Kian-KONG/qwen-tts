import { useRef, useState } from "react";
import { useI18n } from "../i18n";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ThemeAudio({ src, className }: { src: string; className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className={`theme-audio${className ? ` ${className}` : ""}`}>
      <audio
        ref={ref}
        preload="none"
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
      />
      <button
        type="button"
        className="theme-audio-play"
        aria-label={playing ? t("common.pause") : t("common.play")}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {playing ? (
            <path d="M5 3.5h2.2v9H5zm3.8 0H11v9H8.8z" fill="currentColor" />
          ) : (
            <path d="M5.2 3.2v9.6L13 8z" fill="currentColor" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.05}
        value={duration > 0 ? current : 0}
        onChange={(event) => {
          const next = Number(event.target.value);
          setCurrent(next);
          if (ref.current) ref.current.currentTime = next;
        }}
      />
      <span>{formatTime(current)}</span>
    </div>
  );
}
