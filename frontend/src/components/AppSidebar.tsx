import type { AppRoute } from "../route";
import { useI18n } from "../i18n";

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

function IconTranslate() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6h9M8.5 6c0 5-2 9-5.5 12M7 10.5h5.5M13.5 13.5h6.2M16.6 13.5l2.6 7M19.7 20.5h-4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
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

const ITEMS: { id: AppRoute; icon: typeof IconDub; labelKey: string }[] = [
  { id: "dub", labelKey: "nav.dub", icon: IconDub },
  { id: "transcribe", labelKey: "nav.transcribe", icon: IconAsr },
  { id: "translate", labelKey: "nav.translate", icon: IconTranslate },
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
  const { t, locale, setLocale } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextLocale = locale === "zh" ? "en" : "zh";
  return (
    <aside className="sidebar">
      <div className="sidebar-brand" title={t("app.brandTitle")}>
        <span className="sidebar-mark">T</span>
        <div className="sidebar-brand-text">
          <strong>TTS</strong>
          <span>{t("app.studio")}</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <button
              key={item.id}
              type="button"
              className={route === item.id ? "sidebar-link on" : "sidebar-link"}
              onClick={() => onGo(item.id)}
              title={label}
            >
              <Icon />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-locale"
          onClick={() => setLocale(nextLocale)}
          title={nextLocale === "en" ? t("locale.switchToEn") : t("locale.switchToZh")}
          aria-label={nextLocale === "en" ? t("locale.switchToEn") : t("locale.switchToZh")}
        >
          <span className="sidebar-locale-mark">{nextLocale === "en" ? "EN" : "中"}</span>
          <span>{t(nextLocale === "en" ? "locale.en" : "locale.zh")}</span>
        </button>
        <button
          type="button"
          className="sidebar-theme"
          onClick={onTheme}
          title={nextTheme === "light" ? t("theme.toLight") : t("theme.toDark")}
          aria-label={nextTheme === "light" ? t("theme.toLightTheme") : t("theme.toDarkTheme")}
        >
          <ThemeGlyph theme={theme} />
          <span>{t(nextTheme === "light" ? "theme.light" : "theme.dark")}</span>
        </button>
        <button
          type="button"
          className="sidebar-collapse"
          onClick={onToggle}
          title={collapsed ? t("sidebar.expandRail") : t("sidebar.collapseRail")}
          aria-label={collapsed ? t("sidebar.expandRail") : t("sidebar.collapseRail")}
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
          <span>{collapsed ? t("sidebar.expand") : t("sidebar.collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
