import { useEffect, useState } from "react";

import { AuthPages } from "@/components/auth-pages";
import { currentAppPath, loginHref } from "@/lib/app-path";
import { authClient } from "@/lib/auth-client";
import { isAuthPage, shouldRedirectIfSession } from "@/lib/auth-routes";
import { setSessionToken, tokenFromAuthData } from "@/lib/session-token";
import { t } from "@/i18n";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(() => currentAppPath());
  const session = authClient.useSession();

  useEffect(() => {
    const sync = () => setPath(currentAppPath());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    setSessionToken(tokenFromAuthData(session.data));
  }, [session.data]);

  if (isAuthPage(path)) {
    if (session.data && shouldRedirectIfSession(path)) {
      window.location.replace("#/");
      return null;
    }
    return <AuthPages path={path} />;
  }

  if (session.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background type-body text-muted-foreground">
        {t("auth.checking")}
      </div>
    );
  }

  if (!session.data) {
    window.location.replace(loginHref(path));
    return null;
  }

  return children;
}
