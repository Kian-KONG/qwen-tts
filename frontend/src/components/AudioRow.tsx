import type { ReactNode } from "react";

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
  const name = <strong title={title || label}>{label}</strong>;
  return (
    <div className="clip-voice">
      {onLabelClick ? (
        <button type="button" className="clip-voice-label" onClick={onLabelClick}>
          {name}
        </button>
      ) : (
        name
      )}
      {src ? <audio controls preload="none" src={src} /> : null}
      {actions}
    </div>
  );
}
