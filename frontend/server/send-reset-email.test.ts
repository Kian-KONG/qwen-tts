import { afterEach, describe, expect, it, vi } from "vitest";

import { isSmtpConfigured, resetPasswordEmailText, sendResetPasswordEmail } from "./send-reset-email";

describe("send-reset-email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires host and from", () => {
    expect(isSmtpConfigured({})).toBe(false);
    expect(isSmtpConfigured({ SMTP_HOST: "smtp.example.com" })).toBe(false);
    expect(isSmtpConfigured({ SMTP_FROM: "tts@example.com" })).toBe(false);
    expect(isSmtpConfigured({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "tts@example.com" })).toBe(true);
  });

  it("includes the reset url in the message body", () => {
    const text = resetPasswordEmailText("https://tts.example/reset-password?token=abc");
    expect(text).toContain("https://tts.example/reset-password?token=abc");
    expect(text).toContain("TTS");
  });

  it("logs the reset url when SMTP is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await sendResetPasswordEmail({ to: "ada@example.com", url: "https://example/reset?token=t" }, {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ada@example.com"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://example/reset?token=t"));
  });
});
