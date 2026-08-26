import type { ReactNode } from "react";

export function FoldSection({
  title,
  badge,
  open,
  onToggle,
  className,
  children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`fold${open ? " on" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="fold-head" onClick={onToggle} aria-expanded={open}>
        <h3>{title}</h3>
        {badge ? <span>{badge}</span> : null}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open ? <div className="fold-body">{children}</div> : null}
    </div>
  );
}
