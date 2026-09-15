export function kokoroGender(id: string): "f" | "m" | "" {
  const mark = id[1];
  return mark === "f" || mark === "m" ? mark : "";
}

/**
 * Kokoro ships two checkpoints (English v1.0, Chinese v1.1-zh). `family` is the
 * language a voice reads; `model` is the checkpoint holding its style vector.
 * The two agree except for Maple/Sol/Vale — English voices trained inside the
 * v1.1-zh run — so both axes have to be tracked to keep a job on one model.
 */
export type KokoroFamily = "en" | "zh";

export function kokoroFamilyOf(id: string, familyById: Record<string, string>): KokoroFamily {
  return familyById[id] === "zh" ? "zh" : "en";
}

export function sameKokoroFamily(ids: string[], familyById: Record<string, string>): boolean {
  if (ids.length < 2) return true;
  return new Set(ids.map((id) => kokoroFamilyOf(id, familyById))).size === 1;
}

export function kokoroModelOf(id: string, modelById: Record<string, string>): string {
  return modelById[id] === "kokoro-zh" ? "kokoro-zh" : "kokoro";
}

export function sameKokoroModel(ids: string[], modelById: Record<string, string>): boolean {
  if (ids.length < 2) return true;
  return new Set(ids.map((id) => kokoroModelOf(id, modelById))).size === 1;
}

export function sameKokoroGender(ids: string[]): boolean {
  if (ids.length < 2) return false;
  const genders = new Set(ids.map(kokoroGender));
  return genders.size === 1 && !genders.has("");
}

export const DEFAULT_BLEND_WEIGHT = 50;

export function kokoroWeight(id: string, weights: Record<string, number>): number {
  const value = weights[id];
  return Number.isFinite(value) ? Math.max(0, value) : DEFAULT_BLEND_WEIGHT;
}

export function pruneKokoroWeights(ids: string[], weights: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of ids) next[id] = kokoroWeight(id, weights);
  return next;
}

export function normalizedBlendPercents(ids: string[], weights: Record<string, number>): Record<string, number> {
  const raw = ids.map((id) => kokoroWeight(id, weights));
  const total = raw.reduce((sum, n) => sum + n, 0);
  const out: Record<string, number> = {};
  ids.forEach((id, index) => {
    out[id] = total > 0 ? (raw[index] / total) * 100 : 0;
  });
  return out;
}

export function blendWeightsQuery(ids: string[], weights: Record<string, number>): number[] {
  return ids.map((id) => kokoroWeight(id, weights));
}
