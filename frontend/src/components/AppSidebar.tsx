import { AudioLines, Languages, LogOut, Mic, Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { setSessionToken } from "@/lib/session-token";
import { loginHref } from "@/lib/app-path";
import type { AppRoute } from "../route";
import { useI18n } from "../i18n";

export type ThemeName = "light" | "dark";

export function ThemeGlyph({ theme }: { theme: ThemeName }) {
  return theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />;
}

const ITEMS: { id: AppRoute; icon: typeof AudioLines; labelKey: string }[] = [
  { id: "dub", labelKey: "nav.dub", icon: AudioLines },
  { id: "transcribe", labelKey: "nav.transcribe", icon: Mic },
  { id: "translate", labelKey: "nav.translate", icon: Languages },
];

export function AppSidebar({
  route,
  collapsed,
  open,
  theme,
  email,
  onGo,
  onToggle,
  onTheme,
}: {
  route: AppRoute;
  collapsed: boolean;
  open?: boolean;
  theme: ThemeName;
  email?: string;
  onGo: (route: AppRoute) => void;
  onToggle: () => void;
  onTheme: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextLocale = locale === "zh" ? "en" : "zh";

  async function onSignOut() {
    await authClient.signOut().catch(() => undefined);
    setSessionToken(null);
    window.location.assign(loginHref());
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-60 max-md:transition-transform",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        collapsed ? "md:w-16" : "md:w-56",
      )}
    >
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "md:justify-center md:px-2")}>
        <Logo className="size-6 shrink-0 text-foreground" />
        <div className={cn("min-w-0", collapsed && "md:hidden")}>
          <strong className="type-h2 block truncate">TTS</strong>
          <span className="type-caption text-muted-foreground">{t("app.studio")}</span>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-1" aria-label={t("app.brandTitle")}>
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          const active = route === item.id;
          return (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              title={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "h-10 w-full justify-start gap-3 rounded-xl px-3 font-normal",
                collapsed && "md:justify-center md:px-0",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              onClick={() => onGo(item.id)}
            >
              <Icon className="size-4" />
              <span className={cn("truncate", collapsed && "md:hidden")}>{label}</span>
            </Button>
          );
        })}
      </nav>
      <div className={cn("flex flex-col gap-1 border-t border-sidebar-border p-2", collapsed && "md:items-center")}>
        {email ? (
          <div className={cn("flex min-w-0 items-center gap-2 px-1", collapsed && "md:justify-center md:px-0")} title={email}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted type-caption">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className={cn("min-w-0 truncate type-caption text-muted-foreground", collapsed && "md:hidden")}>
              {email}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("ml-auto", collapsed && "md:hidden")}
              onClick={() => void onSignOut()}
              aria-label={t("auth.signOut")}
            >
              <LogOut />
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className={cn("h-9 w-full justify-start gap-3 rounded-xl px-3 font-normal", collapsed && "md:justify-center md:px-0")}
          onClick={() => setLocale(nextLocale)}
          title={nextLocale === "en" ? t("locale.switchToEn") : t("locale.switchToZh")}
          aria-label={nextLocale === "en" ? t("locale.switchToEn") : t("locale.switchToZh")}
        >
          <span className="flex size-4 items-center justify-center text-[11px] font-bold">
            {nextLocale === "en" ? "EN" : "中"}
          </span>
          <span className={cn("truncate", collapsed && "md:hidden")}>{t(nextLocale === "en" ? "locale.en" : "locale.zh")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-9 w-full justify-start gap-3 rounded-xl px-3 font-normal", collapsed && "md:justify-center md:px-0")}
          onClick={onTheme}
          title={nextTheme === "light" ? t("theme.toLight") : t("theme.toDark")}
          aria-label={nextTheme === "light" ? t("theme.toLightTheme") : t("theme.toDarkTheme")}
        >
          <ThemeGlyph theme={theme} />
          <span className={cn("truncate", collapsed && "md:hidden")}>
            {t(nextTheme === "light" ? "theme.light" : "theme.dark")}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-9 w-full justify-start gap-3 rounded-xl px-3 font-normal", collapsed && "md:justify-center md:px-0")}
          onClick={onToggle}
          title={collapsed ? t("sidebar.expandRail") : t("sidebar.collapseRail")}
          aria-label={collapsed ? t("sidebar.expandRail") : t("sidebar.collapseRail")}
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className={cn("truncate", collapsed && "md:hidden")}>
            {collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          </span>
        </Button>
      </div>
    </aside>
  );
}
