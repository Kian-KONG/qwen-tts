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

export type Health = {
  ok: boolean;
  model_id: string;
  model_path: string;
  model_loaded: boolean;
  model_dir_ready: boolean;
  batch_size: number;
  languages?: Language[];
};

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.detail || data.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function getHealth(): Promise<Health> {
  const res = await fetch("/health");
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listLanguages(): Promise<Language[]> {
  const res = await fetch("/api/languages");
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.data ?? [];
}

export async function previewSplit(text: string, language: string): Promise<PreviewSegment[]> {
  const res = await fetch("/api/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.segments ?? [];
}

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch("/api/voices");
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.data ?? [];
}

export async function createVoice(name: string, file: File, refText: string): Promise<Voice> {
  const body = new FormData();
  body.set("name", name);
  body.set("ref_text", refText);
  body.set("ref_audio", file);
  const res = await fetch("/api/voices", { method: "POST", body });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteVoice(id: string): Promise<void> {
  const res = await fetch(`/api/voices/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function createJob(opts: {
  text: string;
  voiceId?: string;
  refAudio?: File;
  refText?: string;
  batchSize: number;
  language: string;
}): Promise<Job> {
  const body = new FormData();
  body.set("text", opts.text);
  body.set("batch_size", String(opts.batchSize));
  body.set("language", opts.language);
  if (opts.voiceId) body.set("voice_id", opts.voiceId);
  if (opts.refAudio) body.set("ref_audio", opts.refAudio);
  if (opts.refText) body.set("ref_text", opts.refText);
  const res = await fetch("/api/jobs", { method: "POST", body });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
