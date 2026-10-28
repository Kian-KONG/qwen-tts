import { describe, expect, it } from "vitest";

import { isAllowedEmail } from "./allowed-emails";

describe("isAllowedEmail", () => {
  it("rejects everyone when the list is empty", () => {
    expect(isAllowedEmail("ada@example.com", "")).toBe(false);
    expect(isAllowedEmail("ada@example.com", "  ,  ")).toBe(false);
  });

  it("matches trimmed case-insensitive emails", () => {
    expect(isAllowedEmail("Ada@Example.COM", "bob@x.com, ada@example.com")).toBe(true);
  });

  it("rejects emails outside the list", () => {
    expect(isAllowedEmail("eve@example.com", "ada@example.com")).toBe(false);
  });
});
