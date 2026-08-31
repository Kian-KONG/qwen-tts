import type { LiveTranslateLine } from "./api";

export const LIVE_CAPTION_CHANNEL = "qwen-live-captions";

export type LiveCaptionEvent =
  | { type: "state"; lines: LiveTranslateLine[]; running: boolean; busy: boolean }
  | { type: "hello" }
  | { type: "halt" };

export function isCaptionEvent(value: unknown): value is LiveCaptionEvent {
  return Boolean(value && typeof value === "object" && "type" in value);
}
