import type { ReactNode } from "react";
import { ThemeAudio } from "./ThemeAudio";

export function AudioRow({
  label,
  title,
  src,
  actions,
  onLabelClick,
}: {
  label: string;
  title?: string;
  src?: string;
  actions?: ReactNode;
  onLabelClick?: () => void;
}) {
  const tip = title || label;
  const name = <strong title={tip}>{label}</strong>;
  return (
    <div className="clip-voice">
      {onLabelClick ? (
        <button type="button" className="clip-voice-label" title={tip} onClick={onLabelClick}>
          {name}
        </button>
      ) : (
        name
      )}
      {src ? <ThemeAudio src={src} /> : null}
      {actions}
    </div>
  );
}
