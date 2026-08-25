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

export async function createJob(opts: {
  text: string;
  voiceId?: string;
  refAudio?: File;
  refText?: string;
  batchSize: number;
  language: string;
  mode?: "clone" | "design" | "preset";
  instruct?: string;
  speaker?: string;
}): Promise<Job> {
  const body = new FormData();
  body.set("text", opts.text);
  body.set("batch_size", String(opts.batchSize));
  body.set("language", opts.language);
  body.set("mode", opts.mode || "preset");
  if (opts.instruct) body.set("instruct", opts.instruct);
  if (opts.speaker) body.set("speaker", opts.speaker);
  if (opts.voiceId) body.set("voice_id", opts.voiceId);
  if (opts.refAudio) body.set("ref_audio", opts.refAudio);
  if (opts.refText) body.set("ref_text", opts.refText);
  const res = await request("/api/jobs", { method: "POST", body });
  return withJobUrls(await res.json());
}

export async function getJob(id: string): Promise<Job> {
  const res = await request(`/api/jobs/${id}`);
  return withJobUrls(await res.json());
}
