import { describe, expect, it } from "vitest";

import { getSessionToken, setSessionToken, tokenFromAuthData } from "./session-token";

describe("session-token", () => {
  it("stores a token in memory only", () => {
    setSessionToken(null);
    expect(getSessionToken()).toBeNull();
    setSessionToken("abc");
    expect(getSessionToken()).toBe("abc");
    setSessionToken(null);
    expect(getSessionToken()).toBeNull();
  });

  it("reads session.token from auth data", () => {
    expect(tokenFromAuthData(null)).toBeNull();
    expect(tokenFromAuthData({ session: { token: "sess" } })).toBe("sess");
  });
});
