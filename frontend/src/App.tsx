import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  API_BASE,
  createJob,
  createScript,
  createTranscribeJob,
  createVoice,
  cancelJob,
  cancelTranscribeJob,
  deleteJob,
  deleteScript,
  deleteVoice,
  downloadFile,
  fetchKokoroPreview,
  previewKokoroPhonemes,
  fetchSpeakerPreview,
  getHealth,
  getJob,
  getScript,
  getTranscribeJob,
  importScript,
  listJobs,
  listLanguages,
  listKokoroVoices,
  listScripts,
  listSpeakers,
  listVoices,
  renameVoice,
  updateScript,
  voiceAudioUrl,
  withDownload,
  type Health,
  type Job,
  type KokoroPhonemes,
  type Language,
  type ScriptList,
  type Speaker,
  type Transcript,
  type Voice,
} from "./api";
import { FileField } from "./components/FileField";
import { BlendSliders } from "./components/BlendSliders";
import { TempSlider } from "./components/TempSlider";
import { TranscribePanel } from "./components/TranscribePanel";
import { LiveCaptionsPage } from "./components/LiveCaptionsPage";
import { LiveTranslatePanel } from "./components/LiveTranslatePanel";
import { AppSidebar, ThemeGlyph, type ThemeName } from "./components/AppSidebar";
import { AudioRow } from "./components/AudioRow";
import { ClipList } from "./components/ClipList";
import { TrackList } from "./components/TrackList";
import { PhonemeEditor } from "./components/PhonemeEditor";
import { ScriptLists, type ScriptPending } from "./components/ScriptLists";
import { SpeakerCard } from "./components/SpeakerCard";
import { FoldSection } from "./components/FoldSection";
import { blendWeightsQuery, kokoroWeight, normalizedBlendPercents, pruneKokoroWeights, sameKokoroGender } from "./lib/kokoroBlend";
import { jobNeedsZip, jobVoiceTracks, jobZipName, jobZipUrl, wavName } from "./lib/jobUtils";
import { isDefaultClonePrompt, languageLabel, t, useI18n } from "./i18n";
import { useHashRoute } from "./route";

const SAMPLE_MARKDOWN = `1. Welcome to this week's product update.
2. We shipped faster voice cloning for internal videos, running entirely on a Mac mini.
3. The narration should sound natural, steady, and easy to cut against picture.`;

const REC_MAX_SEC = 10;

function recorderFormat(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  return options.find((item) => MediaRecorder.isTypeSupported(item.mime)) || { mime: "", ext: "webm" };
}

const ITEM_MARK = /^\s*(?:\d{1,3}[\.\)、:：]|\(\d{1,3}\)|\（\d{1,3}\）)\s*/;

const VOICE_PRESETS = [
  {
    id: "calmMale",
    text: "A calm adult male narrator, warm mid pitch, clear studio diction, American English, no accent, professional documentary tone.",
  },
  {
    id: "youngFemale",
    text: "A cheerful young female voice, bright and energetic, slightly high pitch, natural conversational English.",
  },
  {
    id: "news",
    text: "A confident news anchor voice, even pacing, authoritative but not harsh, broadcast studio quality.",
  },
  {
    id: "warmFemale",
    text: "A gentle adult female narrator, soft mid pitch, slow and warm, intimate storytelling tone.",
  },
];

function parseMarkdownList(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const nonempty = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!nonempty.length) return [];
  if (!ITEM_MARK.test(nonempty[0])) return nonempty;

  const items: string[] = [];
  let current: string | null = null;
  let sawMark = false;
  const broken = normalized.split("\n").flatMap((line) => {
    const marks = [...line.matchAll(/(?:(?<=\s)|(?<=^))(?:\d{1,3}[\.\)、:：]|\(\d{1,3}\)|\（\d{1,3}\）)\s+/g)];
    if (marks.length < 2) return [line];
    return marks.map((mark, index) => {
      const start = mark.index ?? 0;
      const end = index + 1 < marks.length ? (marks[index + 1].index ?? line.length) : line.length;
      return line.slice(start, end).trim();
    }).filter(Boolean);
  });
  for (const line of broken) {
    const match = line.match(ITEM_MARK);
    if (match) {
      sawMark = true;
      if (current?.trim()) items.push(current.trim());
      current = line.slice(match[0].length);
      continue;
    }
    if (current == null) continue;
    const extra = line.trim();
    if (extra) current = `${current.trim()} ${extra}`;
  }
  if (current?.trim()) items.push(current.trim());
  if (sawMark && items.length) return items;
  return nonempty;
}

function toMarkdown(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
}

const VOICE_ID_KEY = "qwen-tts-voice-id";
const VOICE_IDS_KEY = "qwen-tts-voice-ids";
const SPEAKERS_KEY = "qwen-tts-speakers";
const DESIGNS_KEY = "qwen-tts-designs";
const JOB_ID_KEY = "qwen-tts-job-id";
const SIDEBAR_KEY = "qwen-tts-sidebar";
const THEME_KEY = "qwen-tts-theme";
const VOICE_FOLD_KEY = "qwen-tts-voice-fold";
const HISTORY_FOLD_KEY = "qwen-tts-history-fold";
const PREVIEW_FOLD_KEY = "qwen-tts-preview-fold";
const VOICES_COLLAPSE_KEY = "qwen-tts-voices-collapsed";
const ENGINE_KEY = "qwen-tts-engine";
const KOKORO_VOICES_KEY = "qwen-tts-kokoro-voices";
const KOKORO_BLEND_KEY = "qwen-tts-kokoro-blend";
const KOKORO_BLEND_WEIGHTS_KEY = "qwen-tts-kokoro-blend-weights";

function modeLabel(mode?: string) {
  if (!mode) return "";
  const keys: Record<string, string> = {
    preset: "mode.preset",
    design: "mode.design",
    clone: "mode.clone",
    mixed: "mode.mixed",
    kokoro: "mode.kokoro",
  };
  return keys[mode] ? t(keys[mode]) : mode;
}

function jobStatusLabel(status: string) {
  const keys: Record<string, string> = {
    queued: "status.queued",
    running: "status.running",
    cancelling: "status.cancelling",
    cancelled: "status.cancelled",
    error: "status.error",
  };
  return keys[status] ? t(keys[status]) : status;
}

function jobStageLabel(stage: string) {
  const keys: Record<string, string> = {
    tts: "status.tts",
    asr: "status.asr",
    retake: "status.retake",
    done: "status.done",
  };
  return keys[stage] ? t(keys[stage]) : t("status.running");
}

function jobPhaseLabel(job?: { status?: string; stage?: string | null } | null) {
  if (!job?.status) return "";
  if (job.status === "running") return jobStageLabel(job.stage || "");
  return jobStatusLabel(job.status);
}

function verifySummary(job?: Pick<Job, "verify"> | null) {
  const verify = job?.verify;
  if (!verify?.enabled) return "";
  if (verify.skipped) return verify.reason ? t("status.verifySkipReason", { reason: verify.reason }) : t("status.verifySkip");
  if (verify.retaken) return t("status.verifyRetake", { n: verify.retaken });
  if (verify.checked) return t("status.verifyOk");
  return "";
}

function jobActive(status?: string) {
  return status === "queued" || status === "running" || status === "cancelling";
}

function jobLost(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return /not found|找不到/i.test(detail);
}

type DesignPick = { id: string; name: string; instruct: string };
type VoiceFold = "preset" | "design" | "clone";

function storedVoiceFold(): VoiceFold {
  const value = stored(VOICE_FOLD_KEY, "preset");
  return value === "design" || value === "clone" ? value : "preset";
}

function storedTheme(): ThemeName {
  return stored(THEME_KEY, "dark") === "light" ? "light" : "dark";
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
}

function stored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function storedList(key: string, fallback: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
    return items.length ? items : fallback;
  } catch {
    return fallback;
  }
}

function toggleId(current: string[], id: string, keepLast = false): string[] {
  if (current.includes(id)) {
    const next = current.filter((item) => item !== id);
    return keepLast && !next.length ? current : next;
  }
  return [...current, id];
}

function storedJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const clonePrompt = t("msg.clonePrompt");
  const [route, go] = useHashRoute();
  const [railCollapsed, setRailCollapsed] = useState(() => stored(SIDEBAR_KEY, "0") === "1");
  const [theme, setTheme] = useState<ThemeName>(() => {
    const next = storedTheme();
    applyTheme(next);
    return next;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceFold, setVoiceFold] = useState<VoiceFold>(storedVoiceFold);
  const [cloneStudioOpen, setCloneStudioOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => stored(HISTORY_FOLD_KEY, "1") !== "0");
  const [previewOpen, setPreviewOpen] = useState(() => stored(PREVIEW_FOLD_KEY, "0") === "1");
  const [voicesCollapsed, setVoicesCollapsed] = useState(() => stored(VOICES_COLLAPSE_KEY, "0") === "1");
  const [health, setHealth] = useState<Health | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [language, setLanguage] = useState(() =>
    stored(ENGINE_KEY, "qwen") === "kokoro" ? "English" : "Auto",
  );
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [dubEngine, setDubEngine] = useState<"qwen" | "kokoro">(() =>
    stored(ENGINE_KEY, "qwen") === "kokoro" ? "kokoro" : "qwen",
  );
  const [kokoroVoices, setKokoroVoices] = useState<Speaker[]>([]);
  const [selectedKokoro, setSelectedKokoro] = useState<string[]>(() => storedList(KOKORO_VOICES_KEY, ["af_heart"]));
  const [kokoroBlend, setKokoroBlend] = useState(() => stored(KOKORO_BLEND_KEY, "0") === "1");
  const [kokoroWeights, setKokoroWeights] = useState<Record<string, number>>(() => {
    const raw = storedJson<Record<string, number>>(KOKORO_BLEND_WEIGHTS_KEY, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  });
  const [phonemePreview, setPhonemePreview] = useState<KokoroPhonemes | null>(null);
  const [phonemeBusy, setPhonemeBusy] = useState(false);
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>(() => storedList(SPEAKERS_KEY, ["Ryan"]));
  const [voiceId, setVoiceId] = useState(() => stored(VOICE_ID_KEY, "") || storedList(VOICE_IDS_KEY, [])[0] || "");
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>(() => {
    const ids = storedList(VOICE_IDS_KEY, []);
    if (ids.length) return ids;
    const one = stored(VOICE_ID_KEY, "");
    return one ? [one] : [];
  });
  const [voiceName, setVoiceName] = useState(() => t("voices.namePlaceholder"));
  const [designs, setDesigns] = useState<DesignPick[]>(() => {
    const raw = storedJson<DesignPick[]>(DESIGNS_KEY, []);
    return Array.isArray(raw) ? raw.filter((item) => item?.instruct && item?.name) : [];
  });
  const [instruct, setInstruct] = useState(VOICE_PRESETS[0].text);
  const [styleInstruct, setStyleInstruct] = useState("");
  const [stableDub, setStableDub] = useState(true);
  const [verifyAsr, setVerifyAsr] = useState(false);
  const [temperature, setTemperature] = useState(0.3);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refText, setRefText] = useState(() => t("msg.clonePrompt"));
  const [recStatus, setRecStatus] = useState<"idle" | "recording" | "ready">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [recUrl, setRecUrl] = useState("");
  const recHandle = useRef<{
    recorder: MediaRecorder | null;
    stream: MediaStream | null;
    chunks: Blob[];
    timer: number | null;
    startedAt: number;
    url: string;
    mime: string;
    ext: string;
    ignoreStop: boolean;
  }>({
    recorder: null,
    stream: null,
    chunks: [],
    timer: null,
    startedAt: 0,
    url: "",
    mime: "",
    ext: "webm",
    ignoreStop: false,
  });
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrLanguage, setAsrLanguage] = useState("Auto");
  const [asrJob, setAsrJob] = useState<Transcript | null>(null);
  const [asrText, setAsrText] = useState("");
  const [asrCopied, setAsrCopied] = useState(false);
  const [excelName, setExcelName] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [previewingSpeaker, setPreviewingSpeaker] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [batchSize, setBatchSize] = useState(4);
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [scripts, setScripts] = useState<ScriptList[]>([]);
  const [scriptsReady, setScriptsReady] = useState(false);
  const [activeScriptId, setActiveScriptId] = useState("");
  const [scriptName, setScriptName] = useState("");
  const [scriptPending, setScriptPending] = useState<ScriptPending>(null);
  const [editorRev, setEditorRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const voicePlayerRef = useRef<HTMLAudioElement | null>(null);
  const speakerPreviewUrls = useRef<Record<string, string>>({});

  const filledSegments = useMemo(() => parseMarkdownList(markdown), [markdown]);
  const pendingClone = Boolean(!selectedVoiceIds.length && refFile && refText.trim());
  const canBlendKokoro = sameKokoroGender(selectedKokoro);
  const blendingKokoro = dubEngine === "kokoro" && kokoroBlend && canBlendKokoro;
  const roster = useMemo(() => {
    if (dubEngine === "kokoro") {
      if (blendingKokoro) {
        const percents = normalizedBlendPercents(selectedKokoro, kokoroWeights);
        const labels = selectedKokoro.map((id) => kokoroVoices.find((item) => item.id === id)?.label || id);
        return [
          {
            key: "kokoro-blend",
            kind: "kokoro" as const,
            name: labels.join(" + "),
            detail: selectedKokoro
              .map((id, index) => `${labels[index]} ${Math.round(percents[id] || 0)}%`)
              .join(" · "),
            remove: () => setKokoroBlend(false),
          },
        ];
      }
      return selectedKokoro.map((id) => {
        const voice = kokoroVoices.find((item) => item.id === id);
        return {
          key: `kokoro:${id}`,
          kind: "kokoro" as const,
          name: voice?.label || id,
          detail: voice?.description,
          remove: () => setSelectedKokoro((current) => current.filter((item) => item !== id)),
        };
      });
    }
    const items: { key: string; kind: "preset" | "design" | "clone" | "kokoro"; name: string; detail?: string; remove: () => void }[] = [];
    for (const id of selectedSpeakers) {
      const speaker = speakers.find((item) => item.id === id);
      items.push({
        key: `preset:${id}`,
        kind: "preset",
        name: speaker?.label || id,
        detail: speaker?.description,
        remove: () => setSelectedSpeakers((current) => current.filter((item) => item !== id)),
      });
    }
    for (const design of designs) {
      items.push({
        key: `design:${design.id}`,
        kind: "design",
        name: design.name,
        detail: design.instruct.slice(0, 42),
        remove: () => setDesigns((current) => current.filter((item) => item.id !== design.id)),
      });
    }
    for (const id of selectedVoiceIds) {
      const voice = voices.find((item) => item.id === id);
      items.push({
        key: `clone:${id}`,
        kind: "clone",
        name: voice?.name || id,
        remove: () => setSelectedVoiceIds((current) => current.filter((item) => item !== id)),
      });
    }
    return items;
  }, [blendingKokoro, dubEngine, selectedKokoro, kokoroVoices, kokoroWeights, selectedSpeakers, speakers, designs, selectedVoiceIds, voices]);
  const voiceCount = roster.length + (dubEngine === "kokoro" ? 0 : pendingClone ? 1 : 0);

  async function refresh() {
    try {
      const [nextHealth, nextVoices, nextLanguages, nextSpeakers, nextKokoro, nextScripts] = await Promise.all([
        getHealth(),
        listVoices(),
        listLanguages(),
        listSpeakers(),
        listKokoroVoices().catch(() => ({ data: [] as Speaker[], default: "af_heart" })),
        listScripts().catch(() => null),
      ]);
      setHealth(nextHealth);
      setVoices(nextVoices);
      setLanguages(nextLanguages);
      setSpeakers(nextSpeakers.data);
      setKokoroVoices(nextKokoro.data);
      if (nextScripts) {
        setScripts(nextScripts);
        setActiveScriptId((current) => (current && nextScripts.some((item) => item.id === current) ? current : ""));
      }
      setScriptsReady(true);
      setSelectedSpeakers((current) => current.filter((id) => nextSpeakers.data.some((item) => item.id === id)));
      setSelectedKokoro((current) => {
        const next = current.filter((id) => nextKokoro.data.some((item) => item.id === id));
        return next.length ? next : nextKokoro.data[0] ? [nextKokoro.data[0].id] : current;
      });
      setSelectedVoiceIds((current) => current.filter((id) => nextVoices.some((item) => item.id === id)));
      setVoiceId((current) => {
        if (current && nextVoices.some((item) => item.id === current)) return current;
        return nextVoices[0]?.id || "";
      });
      void refreshHistory();
    } catch (error) {
      setScriptsReady(true);
      setMessage(error instanceof Error ? error.message : t("msg.backendDown"));
    }
  }

  async function refreshHistory() {
    try {
      setHistory(await listJobs());
    } catch {
      /* listing is optional while the API is waking up */
    }
  }

  useEffect(() => {
    setRefText((current) => (isDefaultClonePrompt(current) ? clonePrompt : current));
  }, [clonePrompt]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      const handle = recHandle.current;
      if (handle.timer != null) window.clearInterval(handle.timer);
      if (handle.recorder && handle.recorder.state !== "inactive") handle.recorder.stop();
      handle.stream?.getTracks().forEach((track) => track.stop());
      if (handle.url) URL.revokeObjectURL(handle.url);
    };
  }, []);

  useEffect(() => {
    try {
      if (voiceId) window.localStorage.setItem(VOICE_ID_KEY, voiceId);
      window.localStorage.setItem(SPEAKERS_KEY, selectedSpeakers.join(","));
      window.localStorage.setItem(VOICE_IDS_KEY, selectedVoiceIds.join(","));
      window.localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs));
      window.localStorage.setItem(SIDEBAR_KEY, railCollapsed ? "1" : "0");
      window.localStorage.setItem(THEME_KEY, theme);
      window.localStorage.setItem(ENGINE_KEY, dubEngine);
      window.localStorage.setItem(KOKORO_VOICES_KEY, selectedKokoro.join(","));
      window.localStorage.setItem(KOKORO_BLEND_KEY, kokoroBlend ? "1" : "0");
      window.localStorage.setItem(KOKORO_BLEND_WEIGHTS_KEY, JSON.stringify(kokoroWeights));
      window.localStorage.setItem(VOICE_FOLD_KEY, voiceFold);
      window.localStorage.setItem(HISTORY_FOLD_KEY, historyOpen ? "1" : "0");
      window.localStorage.setItem(PREVIEW_FOLD_KEY, previewOpen ? "1" : "0");
      window.localStorage.setItem(VOICES_COLLAPSE_KEY, voicesCollapsed ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }, [voiceId, selectedSpeakers, selectedKokoro, selectedVoiceIds, designs, railCollapsed, theme, voiceFold, historyOpen, previewOpen, voicesCollapsed, dubEngine, kokoroBlend, kokoroWeights]);

  useEffect(() => {
    setKokoroWeights((current) => {
      const next = pruneKokoroWeights(selectedKokoro, current);
      const keys = Object.keys(next);
      if (keys.length === Object.keys(current).length && keys.every((id) => current[id] === next[id])) {
        return current;
      }
      return next;
    });
    if (kokoroBlend && selectedKokoro.length >= 2 && !sameKokoroGender(selectedKokoro)) {
      setKokoroBlend(false);
    }
  }, [selectedKokoro, kokoroBlend]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getJob(job.id);
        setJob(next);
      } catch (error) {
        if (!jobLost(error)) return;
        setJob((current) =>
          current && current.id === job.id
            ? { ...current, status: "error", error: t("msg.jobLostRestart") }
            : current,
        );
        setMessage(t("msg.jobLostHint"));
        try {
          window.localStorage.removeItem(JOB_ID_KEY);
        } catch {
          /* ignore */
        }
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status !== "done" || !job.id) return;
    try {
      window.localStorage.setItem(JOB_ID_KEY, job.id);
    } catch {
      /* ignore */
    }
    void refreshHistory();
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!asrJob?.id || asrJob.status === "done" || asrJob.status === "error" || asrJob.status === "cancelled") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getTranscribeJob(asrJob.id as string);
        setAsrJob(next);
        if (next.text) setAsrText(next.text);
      } catch (error) {
        setAsrJob((current) =>
          current
            ? { ...current, status: "error", stage: "error", error: error instanceof Error ? error.message : t("msg.queryFail") }
            : current,
        );
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [asrJob?.id, asrJob?.status]);

  useEffect(() => {
    const asrId = new URLSearchParams(window.location.search).get("asr");
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (asrId) {
      go("transcribe");
      void (async () => {
        try {
          const next = await getTranscribeJob(asrId);
          setAsrJob(next);
          if (next.text) setAsrText(next.text);
        } catch {
          setMessage(t("msg.asrJobMissing"));
        }
      })();
    }
    const storedJob = stored(JOB_ID_KEY, "");
    const pick = jobId || storedJob;
    if (pick) {
      void (async () => {
        try {
          const next = await getJob(pick);
          setJob(next);
        } catch (error) {
          try {
            window.localStorage.removeItem(JOB_ID_KEY);
          } catch {
            /* ignore */
          }
          if (jobLost(error)) setMessage(t("msg.jobGone"));
        }
      })();
    }
  }, []);

  function addSegment() {
    const next = filledSegments.length + 1;
    setMarkdown((current) => {
      const trimmed = current.replace(/\s+$/, "");
      return trimmed ? `${trimmed}\n${next}. ` : `1. `;
    });
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.length;
    }, 0);
  }

  function tidyNumbers() {
    setMarkdown(toMarkdown(filledSegments));
  }

  async function onImportScript(file: File | null) {
    if (!file) return;
    try {
      const result = await importScript(file);
      setMarkdown(result.markdown);
      setExcelName(file.name);
      setActiveScriptId("");
      setMessage(t("msg.imported", { n: result.count }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.importFail"));
    }
  }

  function applyScript(item: ScriptList) {
    setMarkdown(item.markdown || "");
    setActiveScriptId(item.id);
    setScriptName(item.name);
    if (item.language) setLanguage(item.language);
    setExcelName("");
    setEditorRev((n) => n + 1);
  }

  async function onSaveScript() {
    const name = scriptName.trim();
    if (!name || !markdown.trim()) {
      setMessage(t("msg.needListName"));
      return;
    }
    setScriptPending({ action: "save" });
    try {
      const saved = await createScript({ name, markdown, language });
      setScripts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setActiveScriptId(saved.id);
      setScriptName(saved.name);
      setMessage(t("msg.savedList", { name: saved.name, n: saved.chunks ?? filledSegments.length }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.saveFail"));
    } finally {
      setScriptPending(null);
    }
  }

  async function onUpdateScript() {
    if (!activeScriptId) return;
    if (!markdown.trim()) {
      setMessage(t("msg.emptyScript"));
      return;
    }
    setScriptPending({ action: "update", id: activeScriptId });
    try {
      const saved = await updateScript(activeScriptId, {
        name: scriptName.trim() || undefined,
        markdown,
        language,
      });
      setScripts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setScriptName(saved.name);
      setMessage(t("msg.updatedList", { name: saved.name, n: saved.chunks ?? filledSegments.length }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.updateFail"));
    } finally {
      setScriptPending(null);
    }
  }

  async function onLoadScript(id: string) {
    const cached = scripts.find((item) => item.id === id);
    if (cached?.markdown) applyScript(cached);
    setScriptPending({ action: "load", id });
    try {
      const item = await getScript(id);
      applyScript(item);
      setScripts((current) => current.map((row) => (row.id === item.id ? { ...row, ...item } : row)));
      setMessage(t("msg.loadedList", { name: item.name, n: parseMarkdownList(item.markdown || "").length }));
    } catch (error) {
      if (!cached?.markdown) setMessage(error instanceof Error ? error.message : t("msg.loadFail"));
    } finally {
      setScriptPending(null);
    }
  }

  async function onRenameScript(id: string, name: string) {
    setScriptPending({ action: "update", id });
    try {
      const saved = await updateScript(id, { name });
      setScripts((current) => current.map((item) => (item.id === id ? { ...item, ...saved } : item)));
      if (activeScriptId === id) setScriptName(saved.name);
      setMessage(t("msg.renamed", { name: saved.name }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.renameFail"));
    } finally {
      setScriptPending(null);
    }
  }

  async function onDeleteScript(id: string, name: string) {
    if (!window.confirm(t("msg.confirmDeleteList", { name }))) return;
    setScriptPending({ action: "delete", id });
    try {
      await deleteScript(id);
      setScripts((current) => current.filter((item) => item.id !== id));
      if (activeScriptId === id) setActiveScriptId("");
      setMessage(t("msg.deleted", { name }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.deleteFail"));
    } finally {
      setScriptPending(null);
    }
  }

  function onMarkdownKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    const editor = event.currentTarget;
    const pos = editor.selectionStart;
    const lineStart = markdown.lastIndexOf("\n", pos - 1) + 1;
    const line = markdown.slice(lineStart, pos);
    const match = line.match(/^\s*(\d+)[\.\)、:：]\s+(.*)$/);
    if (!match) return;
    event.preventDefault();
    const nextNum = Number(match[1]) + 1;
    const insert = match[2].trim() ? `\n${nextNum}. ` : "";
    if (!insert) return;
    const next = `${markdown.slice(0, pos)}${insert}${markdown.slice(editor.selectionEnd)}`;
    setMarkdown(next);
    const caret = pos + insert.length;
    window.setTimeout(() => {
      editor.selectionStart = editor.selectionEnd = caret;
    }, 0);
  }

  function stopMicTracks() {
    recHandle.current.stream?.getTracks().forEach((track) => track.stop());
    recHandle.current.stream = null;
  }

  function stopMicTimer() {
    if (recHandle.current.timer != null) {
      window.clearInterval(recHandle.current.timer);
      recHandle.current.timer = null;
    }
  }

  function clearMicTake() {
    recHandle.current.ignoreStop = true;
    stopMicTimer();
    if (recHandle.current.recorder && recHandle.current.recorder.state !== "inactive") {
      recHandle.current.recorder.stop();
    }
    recHandle.current.recorder = null;
    stopMicTracks();
    if (recHandle.current.url) {
      URL.revokeObjectURL(recHandle.current.url);
      recHandle.current.url = "";
    }
    setRecUrl("");
    setRecStatus("idle");
    setRecSeconds(0);
  }

  function finishMic(blob: Blob) {
    stopMicTracks();
    stopMicTimer();
    const mime = recHandle.current.mime || blob.type || "audio/webm";
    const ext = recHandle.current.ext || "webm";
    const file = new File([blob], `mic-ref.${ext}`, { type: mime });
    if (recHandle.current.url) URL.revokeObjectURL(recHandle.current.url);
    const url = URL.createObjectURL(blob);
    recHandle.current.url = url;
    setRecUrl(url);
    setRefFile(file);
    setRecStatus("ready");
  }

  function stopMic() {
    const recorder = recHandle.current.recorder;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    recHandle.current.recorder = null;
  }

  async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage(t("msg.noMic"));
      return;
    }
    if (!refText.trim()) setRefText(clonePrompt);
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const format = recorderFormat();
      const recorder = format.mime
        ? new MediaRecorder(stream, { mimeType: format.mime })
        : new MediaRecorder(stream);
      recHandle.current.ignoreStop = false;
      recHandle.current.recorder = recorder;
      recHandle.current.stream = stream;
      recHandle.current.chunks = [];
      recHandle.current.mime = recorder.mimeType || format.mime || "audio/webm";
      recHandle.current.ext = format.ext;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recHandle.current.chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (recHandle.current.ignoreStop) {
          recHandle.current.chunks = [];
          stopMicTracks();
          stopMicTimer();
          return;
        }
        const blob = new Blob(recHandle.current.chunks, { type: recHandle.current.mime });
        recHandle.current.chunks = [];
        if (blob.size > 0) finishMic(blob);
        else {
          stopMicTracks();
          stopMicTimer();
          setRecStatus("idle");
          setMessage(t("msg.noAudio"));
        }
      };
      recorder.start(200);
      recHandle.current.startedAt = Date.now();
      setRecSeconds(0);
      setRecStatus("recording");
      recHandle.current.timer = window.setInterval(() => {
        const sec = (Date.now() - recHandle.current.startedAt) / 1000;
        setRecSeconds(sec);
        if (sec >= REC_MAX_SEC) stopMic();
      }, 100);
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError");
      setMessage(denied ? t("msg.micDenied") : t("msg.micFail"));
    }
  }

  async function onSaveVoice(event: FormEvent) {
    event.preventDefault();
    if (!refFile) {
      setMessage(t("msg.needRef"));
      return;
    }
    if (!refText.trim()) {
      setMessage(t("msg.needTranscript"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const voice = await createVoice(voiceName, refFile, refText);
      await refresh();
      setVoiceId(voice.id);
      setSelectedVoiceIds((current) => (current.includes(voice.id) ? current : [...current, voice.id]));
      setCloneStudioOpen(false);
      setVoiceFold("clone");
      setMessage(t("msg.savedVoice", { name: voice.name }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  async function onTranscribe() {
    if (!asrFile) {
      setMessage(t("msg.needAsrFile"));
      return;
    }
    if (health?.asr_model_ready === false) {
      setMessage(t("msg.needAsrDownload"));
      return;
    }
    setMessage("");
    setAsrText("");
    setAsrJob({ status: "queued", progress: 0, stage: "queued" });
    try {
      const next = await createTranscribeJob(asrFile, asrLanguage);
      setAsrJob(next.status ? next : { ...next, status: "done", progress: 1, stage: "done" });
      if ((next.status === "done" || !next.status) && next.text) setAsrText(next.text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("msg.asrSubmitFail");
      setAsrJob({ status: "error", progress: 0, stage: "error", error: detail });
      setMessage(detail);
    }
  }

  async function onCancelAsr() {
    if (!asrJob?.id) return;
    try {
      const next = await cancelTranscribeJob(asrJob.id);
      setAsrJob(next);
      setMessage(next.status === "cancelled" ? t("msg.asrCancelled") : t("msg.asrCancelling"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.stopFail"));
    }
  }

  function applyAsrToScript() {
    if (!asrText.trim()) return;
    const original = (asrJob?.text || "").trim();
    const next =
      asrJob?.segments?.length && asrText.trim() === original
        ? asrJob.segments.map((item) => `${item.index}. ${item.text}`).join("\n")
        : toMarkdown(parseMarkdownList(asrText));
    setMarkdown(next);
    setDrawerOpen(false);
    go("dub");
    setMessage(t("msg.filledScript"));
  }

  function applyAsrToClone() {
    if (!asrText.trim()) return;
    setRefText(asrText.trim());
    setCloneStudioOpen(true);
    setVoiceFold("clone");
    setDrawerOpen(false);
    go("dub");
    setMessage(t("msg.filledClone"));
  }

  async function copyAsrText() {
    const text = asrText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.querySelector(".asr-result") as HTMLTextAreaElement | null;
      if (!area) return;
      area.focus();
      area.select();
      document.execCommand("copy");
    }
    setAsrCopied(true);
    setMessage(t("msg.copiedAsr"));
    window.setTimeout(() => setAsrCopied(false), 2000);
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const kinds: Array<"preset" | "design" | "clone"> = [];
      if (selectedSpeakers.length) kinds.push("preset");
      if (designs.length) kinds.push("design");
      if (selectedVoiceIds.length || pendingClone) kinds.push("clone");
      const jobMode = kinds.length > 1 ? "mixed" : kinds[0] || "preset";
      const next =
        dubEngine === "kokoro"
          ? await createJob({
              text: markdown,
              mode: "kokoro",
              speakers: selectedKokoro,
              blend: blendingKokoro,
              blendWeights: blendingKokoro ? blendWeightsQuery(selectedKokoro, kokoroWeights) : undefined,
              stable: stableDub,
              temperature,
              verifyAsr: false,
              batchSize,
              language: "English",
              scriptName: scriptName.trim() || t("script.fallbackName"),
            })
          : await createJob({
              text: markdown,
              mode: jobMode,
              speakers: selectedSpeakers,
              designs,
              styleInstruct: styleInstruct || undefined,
              stable: stableDub,
              temperature,
              verifyAsr,
              voiceIds: selectedVoiceIds.length ? selectedVoiceIds : undefined,
              refAudio: pendingClone ? refFile || undefined : undefined,
              refText: pendingClone ? refText : undefined,
              batchSize,
              language,
              scriptName: scriptName.trim() || t("script.fallbackName"),
            });
      setJob(next);
      try {
        window.localStorage.setItem(JOB_ID_KEY, next.id);
      } catch {
        /* ignore */
      }
      void refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.submitFail"));
    } finally {
      setBusy(false);
    }
  }

  async function onCancelJob(id: string) {
    try {
      const next = await cancelJob(id);
      setJob(next);
      setMessage(next.status === "cancelled" ? t("msg.dubCancelled") : t("msg.dubCancelling"));
      void refreshHistory();
    } catch (error) {
      if (jobLost(error)) {
        setJob((current) =>
          current && current.id === id
            ? { ...current, status: "error", error: t("msg.jobLostRestart") }
            : current,
        );
        setMessage(t("msg.jobGoneSimple"));
        try {
          window.localStorage.removeItem(JOB_ID_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      setMessage(error instanceof Error ? error.message : t("msg.stopFail"));
    }
  }

  function toggleSpeaker(id: string) {
    setSelectedSpeakers((current) => toggleId(current, id));
  }

  function toggleKokoro(id: string) {
    setSelectedKokoro((current) => {
      const next = toggleId(current, id, true);
      if (kokoroBlend && next.length >= 2 && !sameKokoroGender(next)) setKokoroBlend(false);
      return next;
    });
  }

  function pickEngine(next: "qwen" | "kokoro") {
    setDubEngine(next);
    setCloneStudioOpen(false);
    if (next === "kokoro") setLanguage("English");
    else setPhonemePreview(null);
  }

  async function onKokoroPhonemes() {
    const text = markdown.trim();
    if (!text) {
      setMessage(t("msg.needMarkdown"));
      return;
    }
    setPhonemeBusy(true);
    setMessage("");
    try {
      const british = Boolean(selectedKokoro[0]?.startsWith("b"));
      setPhonemePreview(await previewKokoroPhonemes(text, british));
    } catch (error) {
      setPhonemePreview(null);
      setMessage(error instanceof Error ? error.message : t("msg.phonemeFail"));
    } finally {
      setPhonemeBusy(false);
    }
  }

  function applyKokoroAnnotated(annotated: string) {
    const next = annotated.trim();
    if (!next) return;
    setMarkdown(next);
    setEditorRev((n) => n + 1);
    setMessage(t("msg.phonemeApplied"));
  }

  function onLanguageChange(next: string) {
    setLanguage(next);
    if (dubEngine === "kokoro" && next !== "English") {
      pickEngine("qwen");
    }
  }

  function toggleCloneVoice(id: string) {
    setSelectedVoiceIds((current) => toggleId(current, id));
    setVoiceId(id);
  }

  function addDesign() {
    const text = instruct.trim();
    if (!text) {
      setMessage(t("msg.needDesign"));
      return;
    }
    if (designs.some((item) => item.instruct === text)) {
      setMessage(t("msg.designExists"));
      return;
    }
    const preset = VOICE_PRESETS.find((item) => item.text === text);
    const name = preset ? t(`voices.presets.${preset.id}`) : t("voices.designedName", { n: designs.length + 1 });
    setDesigns((current) => [...current, { id: `d-${Date.now()}`, name, instruct: text }]);
  }

  async function togglePlayVoice(id: string) {
    const player = voicePlayerRef.current;
    if (!player) return;
    if (playingVoiceId === id && !player.paused) {
      player.pause();
      setPlayingVoiceId(null);
      return;
    }
    setVoiceId(id);
    if (playingVoiceId !== id) {
      player.src = voiceAudioUrl(id);
    }
    try {
      await player.play();
      setPlayingVoiceId(id);
    } catch (error) {
      setPlayingVoiceId(null);
      setMessage(error instanceof Error ? error.message : t("msg.playFail"));
    }
  }

  async function togglePlayKokoro(id: string | string[]) {
    const player = voicePlayerRef.current;
    if (!player) return;
    const ids = Array.isArray(id) ? id : [id];
    const weightList = ids.length > 1 ? blendWeightsQuery(ids, kokoroWeights) : undefined;
    const key = weightList
      ? `kokoro:${ids.map((item, index) => `${item}:${weightList[index]}`).join(",")}`
      : `kokoro:${ids.join(",")}`;
    if (playingVoiceId === key && !player.paused) {
      player.pause();
      setPlayingVoiceId(null);
      return;
    }
    setMessage("");
    const needsFetch = !speakerPreviewUrls.current[key];
    const previewLabel = ids.length > 1 ? "blend" : ids[0];
    if (needsFetch) setPreviewingSpeaker(previewLabel);
    try {
      if (needsFetch) {
        speakerPreviewUrls.current[key] = await fetchKokoroPreview(ids, weightList);
      }
      player.src = speakerPreviewUrls.current[key];
      await player.play();
      setPlayingVoiceId(key);
    } catch (error) {
      setPlayingVoiceId(null);
      setMessage(error instanceof Error ? error.message : t("msg.kokoroPreviewFail"));
    } finally {
      if (needsFetch) setPreviewingSpeaker(null);
    }
  }

  async function togglePlaySpeaker(id: string) {
    const player = voicePlayerRef.current;
    if (!player) return;
    const key = `preset:${id}`;
    if (playingVoiceId === key && !player.paused) {
      player.pause();
      setPlayingVoiceId(null);
      return;
    }
    setMessage("");
    const needsFetch = !speakerPreviewUrls.current[id];
    if (needsFetch) setPreviewingSpeaker(id);
    try {
      if (needsFetch) {
        speakerPreviewUrls.current[id] = await fetchSpeakerPreview(id);
      }
      player.src = speakerPreviewUrls.current[id];
      await player.play();
      setPlayingVoiceId(key);
    } catch (error) {
      setPlayingVoiceId(null);
      setMessage(error instanceof Error ? error.message : t("msg.speakerPreviewFail"));
    } finally {
      if (needsFetch) setPreviewingSpeaker(null);
    }
  }

  function startRenameVoice(voice: Voice) {
    setVoiceId(voice.id);
    setRenamingId(voice.id);
    setRenameValue(voice.name);
  }

  async function onRenameVoice(event: FormEvent) {
    event.preventDefault();
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setMessage(t("msg.needVoiceName"));
      return;
    }
    try {
      const updated = await renameVoice(renamingId, name);
      setRenamingId(null);
      setVoiceId(updated.id);
      await refresh();
      setMessage(t("msg.renamed", { name: updated.name }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.renameFail"));
    }
  }

  async function onDeleteVoice(id: string, name?: string) {
    const label = name || id;
    if (!window.confirm(t("msg.confirmDeleteVoice", { name: label }))) return;
    if (playingVoiceId === id) {
      voicePlayerRef.current?.pause();
      setPlayingVoiceId(null);
    }
    try {
      await deleteVoice(id);
      setSelectedVoiceIds((current) => current.filter((item) => item !== id));
      if (voiceId === id) setVoiceId("");
      if (renamingId === id) setRenamingId(null);
      await refresh();
      setMessage(t("msg.deleted", { name: label }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.deleteFail"));
    }
  }

  async function onDownload(url: string, filename: string) {
    try {
      await downloadFile(url, filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.downloadFail"));
    }
  }

  function onDownloadZip(item: Job) {
    void onDownload(jobZipUrl(item), jobZipName(item));
  }

  async function openHistory(id: string) {
    try {
      const next = await getJob(id);
      setJob(next);
      try {
        window.localStorage.setItem(JOB_ID_KEY, id);
      } catch {
        /* ignore */
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.trackMissing"));
    }
  }

  async function onDeleteHistory(id: string) {
    try {
      await deleteJob(id);
      if (job?.id === id) setJob(null);
      await refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("msg.deleteFail"));
    }
  }

  function formatWhen(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function historyHint(item: Job) {
    return [
      formatWhen(item.created_at),
      item.mode ? modeLabel(item.mode) : "",
      item.speakers?.length ? item.speakers.join(" / ") : item.speaker || "",
      item.audio_sec ? `${item.audio_sec}s` : "",
      item.chunks && item.speakers && item.speakers.length > 1
        ? t("output.historyVoices", { n: item.chunks, voices: item.speakers.length })
        : item.segments?.length
          ? t("common.segments", { n: item.segments.length })
          : item.chunks
            ? t("common.segments", { n: item.chunks })
            : "",
      item.status && item.status !== "done" ? jobStatusLabel(item.status) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }

  function toggleVoicesCollapsed() {
    if (recStatus === "recording") return;
    setVoicesCollapsed((current) => !current);
  }

  function goRoute(next: typeof route) {
    go(next);
    setDrawerOpen(false);
  }

  const appClass = `app${railCollapsed ? " rail-collapsed" : ""}${drawerOpen ? " drawer-open" : ""}`;
  const modelName =
    route === "transcribe"
      ? health?.asr_model_id?.split("/").pop() || "Qwen3-ASR"
      : route === "translate"
        ? health?.instruct_model_id?.split("/").pop() || "Qwen3-1.7B"
        : dubEngine === "kokoro"
          ? health?.kokoro_model_id?.split("/").pop() || "Kokoro-82M"
        : (
            health?.current_mode === "design"
              ? health?.design_model_id
              : health?.current_mode === "preset"
                ? health?.custom_model_id
                : health?.model_id
          )?.split("/").pop() || t("app.waitingModel");
  const modelDetail =
    route === "transcribe"
      ? health?.asr_loaded
        ? t("status.asrLoaded")
        : health?.asr_model_ready
          ? t("status.asrReady")
          : t("status.asrMissing")
      : route === "translate"
        ? `${health?.asr_model_ready ? t("status.asrReady") : t("status.asrMissing")} · ${
            health?.instruct_loaded ? t("status.translateLoaded") : health?.instruct_model_ready ? t("status.translateReady") : t("status.translateMissing")
          }`
        : dubEngine === "kokoro"
          ? health?.kokoro_loaded
            ? t("status.kokoroLoaded")
            : health?.kokoro_model_ready
              ? t("status.kokoroReady")
              : t("status.kokoroMissing")
        : `${health?.model_loaded ? t("status.loaded") : t("status.notLoaded")}${health?.custom_model_ready ? ` · ${t("status.presetReady")}` : ` · ${t("status.presetMissing")}`}${health?.design_model_ready ? ` · ${t("status.designReady")}` : ` · ${t("status.designMissing")}`}`;

  if (route === "captions") {
    return <LiveCaptionsPage />;
  }

  return (
    <div className={appClass}>
      {drawerOpen ? <button type="button" className="sidebar-backdrop" aria-label={t("sidebar.close")} onClick={() => setDrawerOpen(false)} /> : null}
      <AppSidebar
        route={route}
        collapsed={railCollapsed}
        theme={theme}
        onGo={goRoute}
        onToggle={() => setRailCollapsed((open) => !open)}
        onTheme={toggleTheme}
      />
      <div className="workspace">
        <header className="app-bar">
          <button
            type="button"
            className="menu-btn"
            aria-label={t("sidebar.openMenu")}
            onClick={() => setDrawerOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="app-bar-title">
            <strong>{route === "transcribe" ? t("nav.transcribe") : route === "translate" ? t("nav.translate") : t("nav.dub")}</strong>
            <span>
              {route === "transcribe"
                ? t("nav.transcribeHint")
                : route === "translate"
                  ? t("nav.translateHint")
                  : t("nav.dubHint")}
            </span>
          </div>
          <button
            type="button"
            className="locale-btn"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            title={locale === "zh" ? t("locale.switchToEn") : t("locale.switchToZh")}
            aria-label={locale === "zh" ? t("locale.switchToEn") : t("locale.switchToZh")}
          >
            {locale === "zh" ? "EN" : "中"}
          </button>
          <button
            type="button"
            className="theme-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            aria-label={theme === "dark" ? t("theme.toLightTheme") : t("theme.toDarkTheme")}
          >
            <ThemeGlyph theme={theme} />
          </button>
          <div className="status">
            <span className={health?.model_loaded || health?.model_dir_ready ? "dot on" : "dot"} />
            <div>
              <strong>{modelName}</strong>
              <p>{modelDetail}</p>
            </div>
          </div>
        </header>
        {message ? <p className="flash">{message}</p> : null}

      {route === "transcribe" ? (
      <TranscribePanel
        health={health}
        languages={languages}
        asrFile={asrFile}
        asrLanguage={asrLanguage}
        asrJob={asrJob}
        asrText={asrText}
        asrCopied={asrCopied}
        onFile={setAsrFile}
        onLanguage={setAsrLanguage}
        onTranscribe={() => void onTranscribe()}
        onCancel={() => void onCancelAsr()}
        onTextChange={setAsrText}
        onCopy={() => void copyAsrText()}
        onApplyToScript={applyAsrToScript}
        onApplyToClone={applyAsrToClone}
      />
      ) : route === "translate" ? (
      <LiveTranslatePanel health={health} languages={languages} />
      ) : (
      <div className={`studio${voicesCollapsed ? " voices-collapsed" : ""}`}>
      <section className="panel studio-voices">
        <button
          type="button"
          className="panel-head voices-head"
          onClick={toggleVoicesCollapsed}
          aria-expanded={!voicesCollapsed}
          title={
            recStatus === "recording"
              ? t("voices.collapseBusy")
              : voicesCollapsed
                ? t("voices.expand")
                : t("voices.collapse")
          }
        >
          <h2>{t("voices.title")}</h2>
          <span>{t("voices.selectedCount", { n: voiceCount })}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="voices-body" inert={voicesCollapsed || undefined}>
          <audio
            ref={voicePlayerRef}
            className="voice-player"
            onEnded={() => setPlayingVoiceId(null)}
          />
          {cloneStudioOpen ? (
            <div className="subpanel">
              <header className="subpanel-head">
                <h3>{t("voices.recordTitle")}</h3>
                <button
                  type="button"
                  className="ghost mini"
                  disabled={recStatus === "recording"}
                  onClick={() => setCloneStudioOpen(false)}
                >
                  {t("voices.back")}
                </button>
              </header>
              <p className="hint">{t("voices.recordHint")}</p>
              <form className="stack" onSubmit={onSaveVoice}>
                <label>
                  {t("voices.name")}
                  <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
                </label>
                <div className="rec-script">
                  <span>{t("voices.pleaseRead")}</span>
                  {clonePrompt}
                </div>
                <div className="rec-bar">
                  {recStatus === "recording" ? (
                    <button type="button" className="rec-stop" onClick={stopMic}>
                      {t("common.stop")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void startMic()} disabled={busy}>
                      {t("voices.startRec")}
                    </button>
                  )}
                  <span className={recStatus === "recording" ? "rec-live" : "hint"}>
                    {recStatus === "recording"
                      ? t("voices.recProgress", { sec: recSeconds.toFixed(1), max: REC_MAX_SEC })
                      : recStatus === "ready"
                        ? t("voices.recDone", { sec: recSeconds.toFixed(1) })
                        : t("voices.recHint")}
                  </span>
                  {recStatus === "ready" ? (
                    <button
                      type="button"
                      className="ghost mini"
                      onClick={() => {
                        clearMicTake();
                        setRefFile(null);
                      }}
                    >
                      {t("voices.rerecord")}
                    </button>
                  ) : null}
                </div>
                {recUrl ? <audio className="rec-player" controls src={recUrl} /> : null}
                <FileField
                  label={t("voices.uploadLabel")}
                  accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
                  file={refFile}
                  emptyText={t("voices.uploadEmpty")}
                  onChange={(file) => {
                    if (file) clearMicTake();
                    setRefFile(file);
                  }}
                />
                <label>
                  {t("voices.transcript")}
                  <textarea
                    rows={3}
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    placeholder={clonePrompt}
                  />
                </label>
                <button type="button" className="ghost mini" onClick={() => setRefText(clonePrompt)}>
                  {t("voices.doorTemplate")}
                </button>
                <button type="submit" disabled={busy}>
                  {t("voices.saveLibrary")}
                </button>
              </form>
            </div>
          ) : (
            <>
          <div className="mode-switch engine-switch">
            <button
              type="button"
              className={dubEngine === "qwen" ? "active" : ""}
              onClick={() => pickEngine("qwen")}
            >
              Qwen3
            </button>
            <button
              type="button"
              className={dubEngine === "kokoro" ? "active" : ""}
              onClick={() => pickEngine("kokoro")}
            >
              Kokoro
            </button>
          </div>
          <p className="hint">
            {dubEngine === "kokoro"
              ? blendingKokoro
                ? t("voices.hintBlend")
                : t("voices.hintKokoro")
              : t("voices.hintQwen")}
          </p>
          <div className="roster">
            <div className="roster-head">
              <strong>{t("voices.selected")}</strong>
              <span>{t("voices.tempValue", { value: temperature.toFixed(2) })}</span>
            </div>
            {roster.length || pendingClone ? (
              <div className="roster-list">
                {roster.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="roster-chip"
                    onClick={item.remove}
                    title={t("voices.remove")}
                  >
                    <small>{modeLabel(item.kind)}</small>
                    {item.name}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                {pendingClone && dubEngine !== "kokoro" ? (
                  <span className="roster-chip pending">
                    <small>{t("voices.cloneTag")}</small>
                    {t("voices.unsavedRef")}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="hint">
                {dubEngine === "kokoro"
                  ? t("voices.emptyKokoro")
                  : t("voices.emptyQwen")}
              </p>
            )}
          </div>
          <p className="hint">{t("voices.tempHint")}</p>

          {dubEngine === "kokoro" ? (
          <FoldSection
            title={t("voices.kokoroTitle")}
            badge={`${selectedKokoro.length}`}
            open
            onToggle={() => undefined}
          >
            <p className="hint">
              {t("voices.kokoroHint")}
              {health?.kokoro_model_ready ? "" : t("voices.kokoroMissing")}
              {selectedKokoro.length >= 2 && !sameKokoroGender(selectedKokoro)
                ? t("voices.kokoroMixed")
                : ""}
            </p>
            <div className="blend-row">
              <label
                className="check"
                title={
                  canBlendKokoro
                    ? t("voices.blendTitle")
                    : selectedKokoro.length < 2
                      ? t("voices.blendNeedTwo")
                      : t("voices.blendSameGender")
                }
              >
                <input
                  type="checkbox"
                  checked={kokoroBlend && canBlendKokoro}
                  disabled={!canBlendKokoro}
                  onChange={(e) => setKokoroBlend(e.target.checked)}
                />
                {t("voices.blendToggle")}
              </label>
              <button
                type="button"
                className="ghost mini"
                disabled={
                  !blendingKokoro || health?.kokoro_model_ready === false || previewingSpeaker !== null
                }
                onClick={() => void togglePlayKokoro(selectedKokoro)}
              >
                {previewingSpeaker === "blend"
                  ? t("common.generating")
                  : playingVoiceId ===
                      `kokoro:${selectedKokoro.map((id) => `${id}:${kokoroWeight(id, kokoroWeights)}`).join(",")}`
                    ? t("common.pause")
                    : t("voices.previewBlend")}
              </button>
            </div>
            {blendingKokoro ? (
              <BlendSliders
                voices={selectedKokoro.map((id) => ({
                  id,
                  label: kokoroVoices.find((item) => item.id === id)?.label || id,
                }))}
                weights={kokoroWeights}
                onWeight={(id, value) => setKokoroWeights((current) => ({ ...current, [id]: value }))}
              />
            ) : null}
            <div className="speaker-grid">
              {kokoroVoices.map((item) => (
                <SpeakerCard
                  key={item.id}
                  kind="kokoro"
                  id={item.id}
                  name={item.label}
                  native={item.native}
                  description={item.description}
                  selected={selectedKokoro.includes(item.id)}
                  previewing={previewingSpeaker === item.id}
                  playing={playingVoiceId === `kokoro:${item.id}`}
                  previewDisabled={health?.kokoro_model_ready === false || previewingSpeaker !== null}
                  onSelect={() => toggleKokoro(item.id)}
                  onPreview={() => void togglePlayKokoro(item.id)}
                />
              ))}
            </div>
          </FoldSection>
          ) : (
          <>
          <FoldSection
            title={t("voices.presetTitle")}
            badge={`${selectedSpeakers.length}`}
            open={voiceFold === "preset"}
            onToggle={() => setVoiceFold("preset")}
          >
            <p className="hint">
              {t("voices.presetHint")}
              {health?.custom_model_ready ? "" : t("voices.customMissing")}
            </p>
            <div className="speaker-grid">
              {speakers.map((item) => (
                <SpeakerCard
                  key={item.id}
                  kind="speakers"
                  id={item.id}
                  name={item.label}
                  native={item.native}
                  description={item.description}
                  selected={selectedSpeakers.includes(item.id)}
                  previewing={previewingSpeaker === item.id}
                  playing={playingVoiceId === `preset:${item.id}`}
                  previewDisabled={health?.custom_model_ready === false || previewingSpeaker !== null}
                  onSelect={() => toggleSpeaker(item.id)}
                  onPreview={() => void togglePlaySpeaker(item.id)}
                />
              ))}
            </div>
            <label>
              {t("voices.styleOptional")}
              <input
                value={styleInstruct}
                onChange={(e) => setStyleInstruct(e.target.value)}
                placeholder={t("voices.stylePlaceholder")}
              />
            </label>
          </FoldSection>

          <FoldSection
            title={t("voices.designTitle")}
            badge={`${designs.length}`}
            open={voiceFold === "design"}
            onToggle={() => setVoiceFold("design")}
          >
            <p className="hint">
              {t("voices.designHint")}
              {health?.design_model_ready ? "" : t("voices.designMissing")}
            </p>
            <div className="chips">
              {VOICE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={instruct === preset.text ? "chip on" : "chip"}
                  onClick={() => setInstruct(preset.text)}
                >
                  {t(`voices.presets.${preset.id}`)}
                </button>
              ))}
            </div>
            <label>
              {t("voices.designLabel")}
              <textarea
                rows={4}
                value={instruct}
                onChange={(e) => setInstruct(e.target.value)}
                placeholder="A calm adult male narrator, warm mid pitch, clear studio diction..."
              />
            </label>
            <button type="button" className="ghost" onClick={addDesign} disabled={!instruct.trim()}>
              {t("voices.addSelected")}
            </button>
          </FoldSection>

          <FoldSection
            title={t("voices.cloneTitle")}
            badge={`${selectedVoiceIds.length}${voices.length ? `/${voices.length}` : ""}`}
            open={voiceFold === "clone"}
            onToggle={() => setVoiceFold("clone")}
          >
            <p className="hint">{t("voices.cloneHint")}</p>
            {voices.length ? (
              <div className="voice-list">
                {voices.map((voice) => (
                  <div key={voice.id} className={selectedVoiceIds.includes(voice.id) ? "voice-card on" : "voice-card"}>
                    <button type="button" className="voice-select" onClick={() => toggleCloneVoice(voice.id)}>
                      <strong>{voice.name}</strong>
                      <small>
                        {voice.duration_sec ? t("voices.duration", { n: voice.duration_sec }) : t("voices.saved")}
                        {voice.ref_text ? ` · ${voice.ref_text.slice(0, 36)}` : ""}
                      </small>
                    </button>
                    <div className="voice-actions">
                      <button type="button" className="ghost mini" onClick={() => void togglePlayVoice(voice.id)}>
                        {playingVoiceId === voice.id ? t("common.pause") : t("common.play")}
                      </button>
                      <button type="button" className="ghost mini" onClick={() => startRenameVoice(voice)}>
                        {t("common.rename")}
                      </button>
                      <button
                        type="button"
                        className="ghost mini"
                        onClick={() => void onDeleteVoice(voice.id, voice.name)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                    {renamingId === voice.id ? (
                      <form className="voice-rename" onSubmit={(event) => void onRenameVoice(event)}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          placeholder={t("voices.renamePlaceholder")}
                        />
                        <button type="submit" disabled={busy || !renameValue.trim()}>
                          {t("common.save")}
                        </button>
                        <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                          {t("common.cancel")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">{t("voices.cloneEmpty")}</p>
            )}
            <button type="button" className="ghost" onClick={() => setCloneStudioOpen(true)}>
              {t("voices.recordNew")}
            </button>
          </FoldSection>
          </>
          )}
            </>
          )}
        </div>
        </section>

        <section className="panel studio-script">
          <header className="panel-head">
            <h2>{t("script.title")}</h2>
            <span>{t("common.segments", { n: filledSegments.length })}</span>
          </header>
          <ScriptLists
            scripts={scripts}
            activeId={activeScriptId}
            name={scriptName}
            languages={languages}
            canSave={Boolean(markdown.trim())}
            pending={scriptPending ?? (!scriptsReady ? { action: "list" } : null)}
            onName={setScriptName}
            onSave={() => void onSaveScript()}
            onUpdate={() => void onUpdateScript()}
            onLoad={(id) => void onLoadScript(id)}
            onRename={(id, name) => void onRenameScript(id, name)}
            onDelete={(id, name) => void onDeleteScript(id, name)}
          />
          <form className="stack studio-form" onSubmit={onGenerate}>
            <div className="script-controls">
              <label>
                {t("common.language")}
                <select
                  value={language}
                  onChange={(e) => onLanguageChange(e.target.value)}
                >
                  {languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {languageLabel(item.id, item.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("common.concurrency")}
                <div className="stepper">
                  <button
                    type="button"
                    className="ghost"
                    aria-label={t("common.minusConcurrency")}
                    disabled={batchSize <= 1}
                    onClick={() => setBatchSize((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <span className="stepper-value">{batchSize}</span>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={t("common.plusConcurrency")}
                    disabled={batchSize >= 8}
                    onClick={() => setBatchSize((n) => Math.min(8, n + 1))}
                  >
                    +
                  </button>
                </div>
              </label>
              <div className="script-checks">
                <label className="check">
                  <input type="checkbox" checked={stableDub} onChange={(e) => setStableDub(e.target.checked)} />
                  {t("script.stable")}
                </label>
                {dubEngine === "kokoro" ? null : (
                <label className="check" title={health?.asr_model_ready ? t("script.asrTitleReady") : t("script.asrTitleNeed")}>
                  <input
                    type="checkbox"
                    checked={verifyAsr}
                    disabled={health?.asr_model_ready === false}
                    onChange={(e) => setVerifyAsr(e.target.checked)}
                  />
                  {t("script.asrProof")}
                </label>
                )}
              </div>
              <TempSlider value={temperature} onChange={setTemperature} />
            </div>
            <p className="hint hint-compact">
              {dubEngine === "kokoro"
                ? t("script.hintKokoro")
                : verifyAsr
                ? t("script.hintAsr")
                : stableDub
                ? t("script.hintStable")
                : t("script.hintUnstable")}
            </p>
            <div
              className={`markdown-wrap${scriptPending?.action === "load" && activeScriptId !== scriptPending.id ? " is-loading" : ""}`}
            >
              <textarea
                key={editorRev}
                ref={editorRef}
                className="markdown-editor"
                rows={12}
                spellCheck={false}
                value={markdown}
                disabled={scriptPending?.action === "load" && activeScriptId !== scriptPending.id}
                onChange={(e) => setMarkdown(e.target.value)}
                onKeyDown={onMarkdownKeyDown}
                placeholder={"1. First line.\n2. Second line."}
              />
              {scriptPending?.action === "load" && activeScriptId !== scriptPending.id ? (
                <div className="markdown-loading" aria-live="polite">
                  <span className="spin" />
                  {t("script.loadingList")}
                </div>
              ) : null}
            </div>
            <div className="row meta">
              <button type="button" className="ghost" onClick={addSegment}>
                {t("script.addItem")}
              </button>
              <button type="button" className="ghost" onClick={tidyNumbers}>
                {t("script.tidy")}
              </button>
              {dubEngine === "kokoro" ? (
                <button type="button" className="ghost" disabled={phonemeBusy || !markdown.trim()} onClick={() => void onKokoroPhonemes()}>
                  {phonemeBusy ? t("script.phonemeBusy") : t("script.phoneme")}
                </button>
              ) : null}
              <FileField
                label=""
                accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                emptyText={excelName || t("script.importEmpty")}
                buttonText={t("script.importBtn")}
                onChange={(file) => void onImportScript(file)}
              />
              <span>{t("common.segments", { n: filledSegments.length })}</span>
            </div>
            {dubEngine === "kokoro" && phonemePreview ? (
              <PhonemeEditor data={phonemePreview} onApply={applyKokoroAnnotated} />
            ) : null}
            <FoldSection
              title={t("script.previewTitle")}
              badge={t("common.segments", { n: filledSegments.length })}
              open={previewOpen}
              onToggle={() => setPreviewOpen((current) => !current)}
              className="preview-fold"
            >
              <ol className="md-preview" key={`preview-${editorRev}`}>
                {filledSegments.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>
                    <span>{index + 1}.</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ol>
            </FoldSection>
            {jobActive(job?.status) ? (
              <button
                type="button"
                className="generate stop"
                disabled={job?.status === "cancelling"}
                onClick={() => job?.id && void onCancelJob(job.id)}
              >
                {job?.status === "cancelling"
                  ? t("script.stopping")
                  : t("script.stopJob", { pct: Math.round((job?.progress || 0) * 100) })}
              </button>
            ) : (
              <button
                type="submit"
                className="generate"
                disabled={
                  busy ||
                  filledSegments.length === 0 ||
                  voiceCount === 0 ||
                  (dubEngine === "kokoro" && health?.kokoro_model_ready === false) ||
                  (dubEngine !== "kokoro" && selectedSpeakers.length > 0 && health?.custom_model_ready === false) ||
                  (dubEngine !== "kokoro" && designs.length > 0 && health?.design_model_ready === false) ||
                  (dubEngine !== "kokoro" && (selectedVoiceIds.length > 0 || pendingClone) && health?.model_dir_ready === false)
                }
              >
                {busy
                  ? t("common.submitting")
                  : blendingKokoro
                    ? t("script.generateBlend", { n: filledSegments.length })
                    : voiceCount > 1
                      ? t("script.generateVoices", { n: filledSegments.length, voices: voiceCount })
                      : t("script.generate", { n: filledSegments.length })}
              </button>
            )}
          </form>
        </section>

      <section className="panel studio-output">
        <header className="panel-head">
          <h2>{t("output.title")}</h2>
        </header>
        <p className="hint">
          {API_BASE
            ? t("output.hintMac")
            : t("output.hintTracks")}
        </p>
        {history.length ? (
          <FoldSection
            title={t("output.history")}
            badge={`${history.length}${job?.title ? ` · ${job.title}` : job?.id ? ` · ${job.id}` : ""}`}
            open={historyOpen}
            onToggle={() => setHistoryOpen((current) => !current)}
            className="history-fold"
          >
            <div className="history-list clips">
              {history.map((item) => {
                const tracks = jobVoiceTracks(item);
                const multi = item.status === "done" && tracks.length > 1;
                return (
                <div key={item.id} className={job?.id === item.id ? "media-card on" : "media-card"}>
                  <AudioRow
                    label={item.title || item.id}
                    title={historyHint(item)}
                    src={item.status === "done" && !multi ? item.download_url || tracks[0]?.url : undefined}
                    onLabelClick={() => void openHistory(item.id)}
                    actions={
                      jobActive(item.status) ? (
                        <button
                          type="button"
                          className="ghost mini stop"
                          disabled={item.status === "cancelling"}
                          onClick={() => void onCancelJob(item.id)}
                        >
                          {item.status === "cancelling" ? t("status.halting") : t("output.stop")}
                        </button>
                      ) : item.status === "done" ? (
                        <>
                          {jobNeedsZip(item) ? (
                            <button type="button" className="ghost mini" onClick={() => void onDownloadZip(item)}>
                              {t("output.zip")}
                            </button>
                          ) : !multi ? (
                            <button
                              type="button"
                              className="ghost mini"
                              onClick={() =>
                                void onDownload(
                                  withDownload(tracks[0]?.url || item.download_url || ""),
                                  wavName(tracks[0]?.filename || item.download_name || item.title || item.id),
                                )
                              }
                            >
                              {t("common.download")}
                            </button>
                          ) : null}
                          <button type="button" className="ghost mini" onClick={() => void onDeleteHistory(item.id)}>
                            {t("common.delete")}
                          </button>
                        </>
                      ) : null
                    }
                  />
                  {multi ? <TrackList job={item} tracks={tracks} onDownload={onDownload} /> : null}
                </div>
                );
              })}
            </div>
          </FoldSection>
        ) : (
          <p className="hint">{t("output.empty")}</p>
        )}
        {job ? (
          <div className="job">
            <div className="bar">
              <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
            </div>
            <p>
              {job.status === "done"
                ? `${
                    job.speakers && job.speakers.length > 1
                      ? t("output.doneLineVoices", {
                          n: job.chunks || job.segments?.length || 0,
                          voices: job.speakers.length,
                          audio: job.audio_sec ?? "-",
                          elapsed: job.elapsed_sec ?? "-",
                          rtf: job.rtf ?? "-",
                        })
                      : t("output.doneLine", {
                          n: job.chunks || job.segments?.length || 0,
                          audio: job.audio_sec ?? "-",
                          elapsed: job.elapsed_sec ?? "-",
                          rtf: job.rtf ?? "-",
                        })
                  }${verifySummary(job) ? ` · ${verifySummary(job)}` : ""}`
                : job.status === "error"
                  ? job.error
                  : job.status === "cancelled"
                    ? t("status.cancelled")
                    : `${jobPhaseLabel(job)} · ${Math.round((job.progress || 0) * 100)}%`}
            </p>
            {jobActive(job.status) ? (
              <button
                type="button"
                className="ghost stop"
                disabled={job.status === "cancelling"}
                onClick={() => void onCancelJob(job.id)}
              >
                {job.status === "cancelling" ? t("common.stopping") : t("output.stop")}
              </button>
            ) : null}
            {job.status === "done" && job.local_dir && !API_BASE ? (
              <p className="hint">{t("output.localHint", { dir: job.local_dir })}</p>
            ) : null}
            {job.status === "done" && jobVoiceTracks(job).length ? (
              <TrackList job={job} tracks={jobVoiceTracks(job)} onDownload={onDownload} />
            ) : null}
            {job.status === "done" && jobNeedsZip(job) ? (
              <div className="tracks">
                <button type="button" className="ghost" onClick={() => void onDownloadZip(job)}>
                  {t("output.zipAll")}
                </button>
              </div>
            ) : null}
            {job.status === "done" && job.segments?.length ? (
              <ClipList segments={job.segments} onDownload={onDownload} />
            ) : null}
          </div>
        ) : history.length ? null : (
          <p className="hint">{t("output.placeholder")}</p>
        )}
      </section>
      </div>
      )}
      </div>
    </div>
  );
}
