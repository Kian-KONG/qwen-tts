function smtpFrom(env: NodeJS.Dict<string>): string {
  return (env.SMTP_FROM || env.CONTACT_FROM_EMAIL || "").trim();
}

function smtpPassword(env: NodeJS.Dict<string>): string {
  return env.SMTP_PASS || env.SMTP_PASSWORD || "";
}

export function isSmtpConfigured(env: NodeJS.Dict<string> = process.env): boolean {
  return Boolean(env.SMTP_HOST?.trim() && smtpFrom(env));
}

export function resetPasswordEmailText(url: string): string {
  return `点击下面的链接重置 TTS 配音台密码（约 1 小时内有效）：\n\n${url}\n\n如果不是你本人操作，请忽略这封邮件。`;
}

export async function sendResetPasswordEmail(
  opts: { to: string; url: string },
  env: NodeJS.Dict<string> = process.env,
): Promise<void> {
  if (!isSmtpConfigured(env)) {
    console.warn(`[auth] SMTP 未配置，密码重置链接仅写在服务端日志：${opts.to} ${opts.url}`);
    return;
  }
  const nodemailer = await import("nodemailer");
  const port = Number(env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === "true" || env.SMTP_SECURE === "1" || port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: smtpPassword(env) } : undefined,
  });
  await transporter.sendMail({
    from: smtpFrom(env),
    to: opts.to,
    subject: "重置 TTS 配音台密码",
    text: resetPasswordEmailText(opts.url),
  });
}
