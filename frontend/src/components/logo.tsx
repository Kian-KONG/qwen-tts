import type { ReactElement } from "react";

export function Logo({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
    </svg>
  );
}
