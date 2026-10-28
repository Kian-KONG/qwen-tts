import { describe, expect, it } from "vitest";

import { isAuthPage, shouldRedirectIfSession } from "./auth-routes";

describe("auth-routes", () => {
  it("treats login, register, forgot and reset as public auth pages", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/register")).toBe(true);
    expect(isAuthPage("/forgot-password")).toBe(true);
    expect(isAuthPage("/reset-password")).toBe(true);
    expect(isAuthPage("/")).toBe(false);
    expect(isAuthPage("/transcribe")).toBe(false);
  });

  it("sends signed-in users away from login/register/forgot, not reset", () => {
    expect(shouldRedirectIfSession("/login")).toBe(true);
    expect(shouldRedirectIfSession("/register")).toBe(true);
    expect(shouldRedirectIfSession("/forgot-password")).toBe(true);
    expect(shouldRedirectIfSession("/reset-password")).toBe(false);
    expect(shouldRedirectIfSession("/")).toBe(false);
  });
});
