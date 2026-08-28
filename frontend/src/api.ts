export type Voice = {
  id: string;
  name: string;
  ref_text: string;
  duration_sec?: number | null;
  created_at?: string;
};

export type Language = {
  id: string;
  label: string;
  lang_code: string;
};

export type PreviewSegment = {
  index: number;
  text: string;
  chars: number;
};

export type JobSegment = {
  index: number;
  text: string;
  voice?: string | null;
  filename?: string | null;
  duration_sec?: number | null;
  url: string;
};

export type JobTrack = {
  index: number;
  voice?: string | null;
  filename?: string | null;
  duration_sec?: number | null;
  url: string;
};

export type Job = {
  id: string;
  status: "queued" | "running" | "done" | "error" | string;
  progress: number;
  error?: string | null;
  download_url?: string | null;
  zip_url?: string | null;
  segments?: JobSegment[];
  tracks?: JobTrack[];
  speakers?: string[] | null;
  created_at?: string;
  title?: string;
  local_dir?: string | null;
  mode?: string | null;
  speaker?: string | null;
  text?: string;
  chunks?: number;
  language?: string;
  batch_size?: number;
  elapsed_sec?: number;
  audio_sec?: number;
  rtf?: number | null;
};

export type Speaker = {
  id: string;
  label: string;
  native: string;
  description?: string;
};

export type Health = {
  ok: boolean;
  model_id: string;
  model_path: string;
  model_loaded: boolean;
  model_dir_ready: boolean;
  design_model_id?: string;
  design_model_ready?: boolean;
  custom_model_id?: string;
  custom_model_ready?: boolean;
  asr_model_id?: string;
  asr_model_ready?: boolean;
  asr_loaded?: boolean;
  current_mode?: "clone" | "design" | "preset" | string;
  default_speaker?: string;
  batch_size: number;
  languages?: Language[];
};

export const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const key = String(import.meta.env.VITE_API_KEY || "").trim();
  const headers = new Headers(extra);
  if (key && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  return headers;
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.detail || data.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    ...init,
    cache: "no-store",
    headers: authHeaders(init.headers),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res;
}

function withJobUrls(job: Job): Job {
  return {
    ...job,
    download_url: job.download_url ? apiUrl(job.download_url) : job.download_url,
    zip_url: job.zip_url ? apiUrl(job.zip_url) : job.zip_url,
    segments: job.segments?.map((segment) => ({
      ...segment,
      url: apiUrl(segment.url),
    })),
    tracks: job.tracks?.map((track) => ({
      ...track,
      url: apiUrl(track.url),
    })),
  };
}

export async function getHealth(): Promise<Health> {
  const res = await request("/health");
  return res.json();
}

export async function listLanguages(): Promise<Language[]> {
  const res = await request("/api/languages");
  const data = await res.json();
  return data.data ?? [];
}

export type TranscriptSegment = {
  index: number;
  text: string;
  chars: number;
};

export type Transcript = {
  id?: string;
  status?: string;
  progress?: number;
  stage?: string;
  error?: string | null;
  text?: string;
  language?: string;
  duration_sec?: number | null;
  elapsed_sec?: number;
  model_id?: string;
  chunk?: number;
  chunks?: number;
  segments?: TranscriptSegment[];
};

export async function createTranscribeJob(
  file: File,
  language: string,
  context?: string,
): Promise<Transcript> {
  const body = new FormData();
  body.set("audio", file);
  body.set("language", language);
  if (context?.trim()) body.set("context", context.trim());
  const res = await request("/api/transcribe", { method: "POST", body });
  return res.json();
}

export async function getTranscribeJob(id: string): Promise<Transcript> {
  const res = await request(`/api/transcribe/${id}`);
  return res.json();
}

export async function cancelTranscribeJob(id: string): Promise<Transcript> {
  const res = await request(`/api/transcribe/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  return res.json();
}

export async function previewSplit(text: string, language: string): Promise<PreviewSegment[]> {
  const res = await request("/api/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  const data = await res.json();
  return data.segments ?? [];
}

export type ImportedScript = {
  markdown: string;
  count: number;
  segments?: PreviewSegment[];
};

export async function importScript(file: File): Promise<ImportedScript> {
  const body = new FormData();
  body.set("file", file);
  const res = await request("/api/import-script", { method: "POST", body });
  return res.json();
}

export function voiceAudioUrl(id: string): string {
  return apiUrl(`/api/voices/${id}/audio`);
}

export function speakerPreviewUrl(id: string): string {
  return apiUrl(`/api/speakers/${encodeURIComponent(id)}/preview`);
}

export async function fetchSpeakerPreview(id: string): Promise<string> {
  const res = await request(`/api/speakers/${encodeURIComponent(id)}/preview`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function listSpeakers(): Promise<{ data: Speaker[]; default: string }> {
  const res = await request("/api/speakers");
  const data = await res.json();
  return { data: data.data ?? [], default: data.default ?? "Ryan" };
}

export async function listVoices(): Promise<Voice[]> {
  const res = await request("/api/voices");
  const data = await res.json();
  return data.data ?? [];
}

export async function createVoice(name: string, file: File, refText: string): Promise<Voice> {
  const body = new FormData();
  body.set("name", name);
  body.set("ref_text", refText);
  body.set("ref_audio", file);
  const res = await request("/api/voices", { method: "POST", body });
  return res.json();
}

export async function renameVoice(id: string, name: string): Promise<Voice> {
  const res = await request(`/api/voices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function deleteVoice(id: string): Promise<void> {
  await request(`/api/voices/${id}`, { method: "DELETE" });
}

export type ScriptList = {
  id: string;
  name: string;
  language?: string;
  chunks?: number;
  preview?: string;
  markdown?: string;
  created_at?: string;
  updated_at?: string;
};

export async function listScripts(): Promise<ScriptList[]> {
  const res = await request("/api/scripts");
  const data = await res.json();
  return data.data ?? [];
}

export async function getScript(id: string): Promise<ScriptList> {
  const res = await request(`/api/scripts/${encodeURIComponent(id)}`);
  return res.json();
}

export async function createScript(opts: {
  name: string;
  markdown: string;
  language: string;
}): Promise<ScriptList> {
  const res = await request("/api/scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return res.json();
}

export async function updateScript(
  id: string,
  opts: { name?: string; markdown?: string; language?: string },
): Promise<ScriptList> {
  const res = await request(`/api/scripts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return res.json();
}

export async function deleteScript(id: string): Promise<void> {
  await request(`/api/scripts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function withDownload(url: string): string {
  if (!url) return url;
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createJob(opts: {
  text: string;
  voiceId?: string;
  refAudio?: File;
  refText?: string;
  batchSize: number;
  language: string;
  mode?: "clone" | "design" | "preset" | "mixed";
  instruct?: string;
  speaker?: string;
  speakers?: string[];
  voiceIds?: string[];
  designs?: { id?: string; name: string; instruct: string }[];
  styleInstruct?: string;
  stable?: boolean;
  temperature?: number;
}): Promise<Job> {
  const body = new FormData();
  body.set("text", opts.text);
  body.set("batch_size", String(opts.batchSize));
  body.set("language", opts.language);
  body.set("mode", opts.mode || "preset");
  body.set("stable", opts.stable === false ? "false" : "true");
  if (opts.temperature != null) body.set("temperature", String(opts.temperature));
  if (opts.instruct) body.set("instruct", opts.instruct);
  if (opts.styleInstruct) body.set("style_instruct", opts.styleInstruct);
  if (opts.speaker) body.set("speaker", opts.speaker);
  if (opts.speakers?.length) body.set("speakers", opts.speakers.join(","));
  if (opts.voiceId) body.set("voice_id", opts.voiceId);
  if (opts.voiceIds?.length) body.set("voice_ids", opts.voiceIds.join(","));
  if (opts.designs?.length) body.set("designs", JSON.stringify(opts.designs));
  else if (opts.mode === "mixed") body.set("designs", "[]");
  if (opts.refAudio) body.set("ref_audio", opts.refAudio);
  if (opts.refText) body.set("ref_text", opts.refText);
  const res = await request("/api/jobs", { method: "POST", body });
  return withJobUrls(await res.json());
}

export async function getJob(id: string): Promise<Job> {
  const res = await request(`/api/jobs/${id}`);
  return withJobUrls(await res.json());
}

export async function listJobs(): Promise<Job[]> {
  const res = await request("/api/jobs");
  const data = await res.json();
  return (data.data ?? []).map((item: Job) => withJobUrls(item));
}

export async function deleteJob(id: string): Promise<void> {
  await request(`/api/jobs/${id}`, { method: "DELETE" });
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await request(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  return withJobUrls(await res.json());
}
