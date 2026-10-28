import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appHref, currentSearch, loginHref } from "@/lib/app-path";
import { authClient } from "@/lib/auth-client";
import { setSessionToken, tokenFromAuthData } from "@/lib/session-token";
import { t } from "@/i18n";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return error.message || t("auth.networkError");
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message || "");
    const status = "status" in error ? (error as { status?: unknown }).status : undefined;
    if (status === 0 || /failed to fetch|networkerror|load failed|网络/i.test(message)) {
      return message || t("auth.networkError");
    }
  }
  if (error instanceof Error && /failed to fetch|networkerror|load failed|网络/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Logo className="mb-1 size-6 text-foreground" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(errorText(result.error, t("auth.badCredentials")));
        return;
      }
      const session = await authClient.getSession();
      setSessionToken(tokenFromAuthData(session.data));
      window.location.assign(appHref(safeNext(currentSearch().get("next"))));
    } catch (err) {
      setError(errorText(err, t("auth.badCredentials")));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title={t("auth.loginTitle")} description={t("auth.loginHint")}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <a href="#/forgot-password" className="type-caption text-primary underline-offset-4 hover:underline">
              {t("auth.forgot")}
            </a>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="type-body text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("auth.signingIn") : t("auth.signIn")}
        </Button>
        <p className="type-body text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <a href="#/register" className="text-primary underline-offset-4 hover:underline">
            {t("auth.register")}
          </a>
        </p>
      </form>
    </AuthShell>
  );
}

function registerError(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : "";
  if (message.includes("未在允许名单")) return message;
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed|网络/i.test(message)) {
    return message || t("auth.networkError");
  }
  return t("auth.registerFail");
}

function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setError(registerError(result.error));
        return;
      }
      const session = await authClient.getSession();
      setSessionToken(tokenFromAuthData(session.data));
      window.location.assign("#/");
    } catch (err) {
      setError(registerError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title={t("auth.registerTitle")} description={t("auth.registerHint")}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">{t("auth.name")}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="type-body text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("auth.registering") : t("auth.register")}
        </Button>
        <p className="type-body text-muted-foreground">
          {t("auth.hasAccount")}{" "}
          <a href={loginHref()} className="text-primary underline-offset-4 hover:underline">
            {t("auth.signIn")}
          </a>
        </p>
      </form>
    </AuthShell>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const origin = window.location.origin;
      const base = String(import.meta.env.BASE_URL || "/");
      const redirectTo = `${origin}${base}#/reset-password`.replace(/([^:]\/)\/+/g, "$1");
      const result = await authClient.requestPasswordReset({ email, redirectTo });
      if (result.error) {
        setError(errorText(result.error, t("auth.resetSendFail")));
        return;
      }
      setSent(true);
    } catch (err) {
      setError(errorText(err, t("auth.resetSendFail")));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.resetTitle")}
      description={sent ? t("auth.resetSent") : t("auth.resetHint")}
    >
      {sent ? (
        <p className="type-body text-muted-foreground">
          {t("auth.resetCheckSpam")}{" "}
          <a href={loginHref()} className="text-primary underline-offset-4 hover:underline">
            {t("auth.backToLogin")}
          </a>
        </p>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {error ? <p className="type-body text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("auth.sending") : t("auth.sendReset")}
          </Button>
          <p className="type-body text-muted-foreground">
            <a href={loginHref()} className="text-primary underline-offset-4 hover:underline">
              {t("auth.backToLogin")}
            </a>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

function resetError(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : "";
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed|网络/i.test(message)) {
    return message || t("auth.networkError");
  }
  if (/too short|至少|min/i.test(message)) return t("auth.passwordMin");
  if (/invalid|expired|token/i.test(message)) return t("auth.resetInvalid");
  return t("auth.resetFail");
}

function ResetPasswordPage() {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = currentSearch();
    if (params.get("error")) {
      setLinkError(t("auth.resetInvalid"));
      setToken("");
      return;
    }
    setToken(params.get("token") || "");
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError(t("auth.resetInvalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordMin"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(resetError(result.error));
        return;
      }
      window.location.assign(loginHref());
    } catch (err) {
      setError(resetError(err));
    } finally {
      setPending(false);
    }
  }

  const invalid = Boolean(linkError || token === "");
  const blocked = token === undefined || invalid;

  return (
    <AuthShell title={t("auth.newPasswordTitle")} description={invalid ? t("auth.resetAgain") : t("auth.passwordMin")}>
      {invalid ? (
        <p className="type-body text-muted-foreground">
          {linkError || t("auth.resetInvalid")}{" "}
          <a href="#/forgot-password" className="text-primary underline-offset-4 hover:underline">
            {t("auth.requestAgain")}
          </a>
        </p>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          {error ? <p className="type-body text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending || blocked}>
            {pending ? t("auth.saving") : t("auth.savePassword")}
          </Button>
          <p className="type-body text-muted-foreground">
            <a href={loginHref()} className="text-primary underline-offset-4 hover:underline">
              {t("auth.backToLogin")}
            </a>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export function AuthPages({ path }: { path: string }) {
  if (path === "/register") return <RegisterPage />;
  if (path === "/forgot-password") return <ForgotPasswordPage />;
  if (path === "/reset-password") return <ResetPasswordPage />;
  return <LoginPage />;
}
