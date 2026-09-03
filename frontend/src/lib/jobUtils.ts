import { apiUrl, type Job, type JobSegment, type JobTrack } from "../api";

export function clipLabel(segment: { text?: string | null; voice?: string | null; filename?: string | null }): string {
  const text = (segment.text || "").trim();
  if (text) return text;
  if (segment.filename) return segment.filename.replace(/\.wav$/i, "");
  return "片段";
}

export function wavName(label: string): string {
  return label.toLowerCase().endsWith(".wav") ? label : `${label}.wav`;
}

export function groupSegments(segments: JobSegment[]): { text: string; clips: JobSegment[] }[] {
  const groups: { text: string; clips: JobSegment[] }[] = [];
  const index = new Map<string, { text: string; clips: JobSegment[] }>();
  for (const segment of segments) {
    const key = segment.text || `\0${segment.index}`;
    let group = index.get(key);
    if (!group) {
      group = { text: segment.text || "", clips: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.clips.push(segment);
  }
  return groups;
}

export function jobVoiceCount(job: Job): number {
  const fromTracks = job.tracks?.length || 0;
  const fromSpeakers = job.speakers?.length || 0;
  const fromClips = new Set((job.segments || []).map((item) => item.voice).filter(Boolean)).size;
  return Math.max(fromTracks, fromSpeakers, fromClips);
}

export function jobClipCount(job: Job): number {
  return Math.max(job.segments?.length || 0, job.chunks || 0);
}

export function jobVoiceTracks(job: Job): JobTrack[] {
  if (job.tracks?.length) return job.tracks;
  if (job.status === "done" && job.download_url) {
    return [
      {
        index: 1,
        voice: job.speakers?.[0] || job.speaker || null,
        filename: job.download_name || null,
        duration_sec: job.audio_sec,
        url: job.download_url,
      },
    ];
  }
  return [];
}

export function jobTrackName(job: Job, track: JobTrack): string {
  if (track.filename) return wavName(track.filename);
  const voice = (track.voice || "").trim() || `音色${track.index}`;
  return wavName(`${job.script_name || job.title || job.id} - ${voice}`);
}

export function jobNeedsZip(job: Job): boolean {
  return jobClipCount(job) > 1 || jobVoiceCount(job) > 1;
}

export function jobZipUrl(job: Job): string {
  return job.zip_url || apiUrl(`/api/jobs/${job.id}/zip`);
}

export function jobZipName(job: Job): string {
  return job.zip_name || `${job.title || job.id}.zip`;
}
