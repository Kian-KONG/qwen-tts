import { useEffect, useState } from "react";

export type AppRoute = "dub" | "transcribe";

export function hashToRoute(hash: string): AppRoute {
  const value = hash.replace(/^#/, "").replace(/^\/+/, "").split("?")[0];
  if (value === "transcribe" || value === "asr") return "transcribe";
  return "dub";
}

export function routeToHash(route: AppRoute): string {
  return route === "transcribe" ? "#/transcribe" : "#/";
}

export function useHashRoute(): [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(() => hashToRoute(window.location.hash));

  useEffect(() => {
    const sync = () => setRoute(hashToRoute(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function go(next: AppRoute) {
    const hash = routeToHash(next);
    if (window.location.hash !== hash && window.location.hash !== hash.slice(1)) {
      window.location.hash = hash;
    }
    setRoute(next);
  }

  return [route, go];
}
