import type { AppRoute } from "../route";

export type ThemeName = "light" | "dark";

function IconDub() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAsr() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5a3.2 3.2 0 0 0-3.2 3.2v5.1a3.2 3.2 0 1 0 6.4 0V6.7A3.2 3.2 0 0 0 12 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M6.5 12.5a5.5 5.5 0 0 0 11 0M12 18v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v2M12 18.5v2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M3.5 12h2M18.5 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M16.2 13.6A6.4 6.4 0 0 1 10.4 5.2 6.6 6.6 0 1 0 18.8 14a6.3 6.3 0 0 1-2.6-.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeGlyph({ theme }: { theme: ThemeName }) {
  return theme === "dark" ? <IconSun /> : <IconMoon />;
}

const ITEMS: { id: AppRoute; label: string; icon: typeof IconDub }[] = [
  { id: "dub", label: "配音", icon: IconDub },
  { id: "transcribe", label: "转写", icon: IconAsr },
];

export function AppSidebar({
  route,
  collapsed,
  theme,
  onGo,
  onToggle,
  onTheme,
}: {
  route: AppRoute;
  collapsed: boolean;
  theme: ThemeName;
  onGo: (route: AppRoute) => void;
  onToggle: () => void;
  onTheme: () => void;
}) {
  const nextLabel = theme === "dark" ? "亮色" : "暗色";
  return (
    <aside className="sidebar">
      <div className="sidebar-brand" title="Qwen3-TTS 配音台">
        <span className="sidebar-mark">Q</span>
        <div className="sidebar-brand-text">
          <strong>Qwen3-TTS</strong>
          <span>配音台</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={route === item.id ? "sidebar-link on" : "sidebar-link"}
              onClick={() => onGo(item.id)}
              title={item.label}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-theme"
          onClick={onTheme}
          title={`切换到${nextLabel}`}
          aria-label={`切换到${nextLabel}主题`}
        >
          <ThemeGlyph theme={theme} />
          <span>{nextLabel}</span>
        </button>
        <button
          type="button"
          className="sidebar-collapse"
          onClick={onToggle}
          title={collapsed ? "展开侧栏" : "折叠侧栏"}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{collapsed ? "展开" : "折叠"}</span>
        </button>
      </div>
    </aside>
  );
}
