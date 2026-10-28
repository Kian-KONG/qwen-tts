const DEFAULT_SECRET = "dev-only-change-me";

export function assertProductionSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET || DEFAULT_SECRET;
  const isProd = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
  if (isProd && (!process.env.BETTER_AUTH_SECRET || secret === DEFAULT_SECRET)) {
    throw new Error("生产环境必须设置 BETTER_AUTH_SECRET，不能使用默认值");
  }
  return secret;
}
