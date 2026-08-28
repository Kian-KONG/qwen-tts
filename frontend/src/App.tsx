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
  fetchSpeakerPreview,
  getHealth,
  getJob,
  getScript,
  getTranscribeJob,
  importScript,
  listJobs,
  listLanguages,
  listScripts,
  listSpeakers,
  listVoices,
  renameVoice,
  updateScript,
  voiceAudioUrl,
  withDownload,
  type Health,
  type Job,
  type Language,
  type ScriptList,
  type Speaker,
  type Transcript,
  type Voice,
} from "./api";
import { FileField } from "./components/FileField";
import { TempSlider } from "./components/TempSlider";
import { TranscribePanel } from "./components/TranscribePanel";
import { AppSidebar, ThemeGlyph, type ThemeName } from "./components/AppSidebar";
import { AudioRow } from "./components/AudioRow";
import { ClipList } from "./components/ClipList";
import { ScriptLists, type ScriptPending } from "./components/ScriptLists";
import { FoldSection } from "./components/FoldSection";
import { jobFullTrackName, jobFullTrackUrl, jobNeedsZip, jobZipName, jobZipUrl, wavName } from "./lib/jobUtils";
import { useHashRoute } from "./route";

const SAMPLE_MARKDOWN = `1. Welcome to this week's product update.
2. We shipped faster voice cloning for internal videos, running entirely on a Mac mini.
3. The narration should sound natural, steady, and easy to cut against picture.`;

const CLONE_PROMPT = "已为您开锁，欢迎回家。门已关闭并反锁，一切正常。";
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
    label: "沉稳男旁白",
    text: "A calm adult male narrator, warm mid pitch, clear studio diction, American English, no accent, professional documentary tone.",
  },
  {
    label: "年轻女声",
    text: "A cheerful young female voice, bright and energetic, slightly high pitch, natural conversational English.",
  },
  {
    label: "新闻主播",
    text: "A confident news anchor voice, even pacing, authoritative but not harsh, broadcast studio quality.",
  },
  {
    label: "温柔女旁白",
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

const MODE_LABEL: Record<string, string> = {
  preset: "预设",
  design: "描述",
  clone: "克隆",
  mixed: "混合",
};

const JOB_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  cancelling: "正在终止",
  cancelled: "已终止",
  error: "失败",
};

const JOB_STAGE: Record<string, string> = {
  tts: "生成中",
  asr: "ASR 校对中",
  retake: "校对重配中",
  done: "完成",
};

function jobPhaseLabel(job?: { status?: string; stage?: string | null } | null) {
  if (!job?.status) return "";
  if (job.status === "running") return JOB_STAGE[job.stage || ""] || "生成中";
  return JOB_STATUS[job.status] || job.status;
}

function verifySummary(job?: Pick<Job, "verify"> | null) {
  const verify = job?.verify;
  if (!verify?.enabled) return "";
  if (verify.skipped) return verify.reason ? `校对跳过（${verify.reason}）` : "校对跳过";
  if (verify.retaken) return `重配 ${verify.retaken} 段`;
  if (verify.checked) return "校对通过";
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
  const [language, setLanguage] = useState("Auto");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>(() => storedList(SPEAKERS_KEY, ["Ryan"]));
  const [voiceId, setVoiceId] = useState(() => stored(VOICE_ID_KEY, "") || storedList(VOICE_IDS_KEY, [])[0] || "");
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>(() => {
    const ids = storedList(VOICE_IDS_KEY, []);
    if (ids.length) return ids;
    const one = stored(VOICE_ID_KEY, "");
    return one ? [one] : [];
  });
  const [voiceName, setVoiceName] = useState("我的音色");
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
  const [refText, setRefText] = useState(CLONE_PROMPT);
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
  const roster = useMemo(() => {
    const items: { key: string; kind: "preset" | "design" | "clone"; name: string; detail?: string; remove: () => void }[] = [];
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
  }, [selectedSpeakers, speakers, designs, selectedVoiceIds, voices]);
  const voiceCount = roster.length + (pendingClone ? 1 : 0);

  async function refresh() {
    try {
      const [nextHealth, nextVoices, nextLanguages, nextSpeakers, nextScripts] = await Promise.all([
        getHealth(),
        listVoices(),
        listLanguages(),
        listSpeakers(),
        listScripts().catch(() => null),
      ]);
      setHealth(nextHealth);
      setVoices(nextVoices);
      setLanguages(nextLanguages);
      setSpeakers(nextSpeakers.data);
      if (nextScripts) {
        setScripts(nextScripts);
        setActiveScriptId((current) => (current && nextScripts.some((item) => item.id === current) ? current : ""));
      }
      setScriptsReady(true);
      setSelectedSpeakers((current) => current.filter((id) => nextSpeakers.data.some((item) => item.id === id)));
      setSelectedVoiceIds((current) => current.filter((id) => nextVoices.some((item) => item.id === id)));
      setVoiceId((current) => {
        if (current && nextVoices.some((item) => item.id === current)) return current;
        return nextVoices[0]?.id || "";
      });
      void refreshHistory();
    } catch (error) {
      setScriptsReady(true);
      setMessage(error instanceof Error ? error.message : "无法连接后端");
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
      window.localStorage.setItem(VOICE_FOLD_KEY, voiceFold);
      window.localStorage.setItem(HISTORY_FOLD_KEY, historyOpen ? "1" : "0");
      window.localStorage.setItem(PREVIEW_FOLD_KEY, previewOpen ? "1" : "0");
      window.localStorage.setItem(VOICES_COLLAPSE_KEY, voicesCollapsed ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }, [voiceId, selectedSpeakers, selectedVoiceIds, designs, railCollapsed, theme, voiceFold, historyOpen, previewOpen, voicesCollapsed]);

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
            ? { ...current, status: "error", error: "任务已中断（服务重启后丢失），请重新点分段配音" }
            : current,
        );
        setMessage("上次生成在服务重启时丢掉了，重新点一次分段配音即可");
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
            ? { ...current, status: "error", stage: "error", error: error instanceof Error ? error.message : "查询失败" }
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
          setMessage("找不到转写任务");
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
          if (jobLost(error)) setMessage("上次未完成的任务已经不在了，重新点一次分段配音即可");
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
      setMessage(`已从表格导入 ${result.count} 段，每个单元格一段`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
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
      setMessage("请填写列表名称和文稿");
      return;
    }
    setScriptPending({ action: "save" });
    try {
      const saved = await createScript({ name, markdown, language });
      setScripts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setActiveScriptId(saved.id);
      setScriptName(saved.name);
      setMessage(`已保存列表「${saved.name}」· ${saved.chunks ?? filledSegments.length} 段`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setScriptPending(null);
    }
  }

  async function onUpdateScript() {
    if (!activeScriptId) return;
    if (!markdown.trim()) {
      setMessage("文稿是空的");
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
      setMessage(`已更新「${saved.name}」· ${saved.chunks ?? filledSegments.length} 段`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
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
      setMessage(`已载入「${item.name}」· ${parseMarkdownList(item.markdown || "").length} 段`);
    } catch (error) {
      if (!cached?.markdown) setMessage(error instanceof Error ? error.message : "载入失败");
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
      setMessage(`已重命名为 ${saved.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setScriptPending(null);
    }
  }

  async function onDeleteScript(id: string, name: string) {
    if (!window.confirm(`删除配音列表「${name}」？文稿会从本机去掉。`)) return;
    setScriptPending({ action: "delete", id });
    try {
      await deleteScript(id);
      setScripts((current) => current.filter((item) => item.id !== id));
      if (activeScriptId === id) setActiveScriptId("");
      setMessage(`已删除 ${name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
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
      setMessage("当前浏览器不支持麦克风录音，请改用上传文件");
      return;
    }
    if (!refText.trim()) setRefText(CLONE_PROMPT);
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
          setMessage("没录到声音，请再试一次");
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
      setMessage(denied ? "请允许使用麦克风后再录，或检查有没有接好话筒" : "无法打开麦克风");
    }
  }

  async function onSaveVoice(event: FormEvent) {
    event.preventDefault();
    if (!refFile) {
      setMessage("请先对着麦克风录音，或上传 3–10 秒参考音频");
      return;
    }
    if (!refText.trim()) {
      setMessage("请填写朗读稿，需和录音内容一致");
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
      setMessage(`已保存音色 ${voice.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function onTranscribe() {
    if (!asrFile) {
      setMessage("请先选择要识别的音频");
      return;
    }
    if (health?.asr_model_ready === false) {
      setMessage("还没下载 Qwen3-ASR，请先运行 make download-asr");
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
      const detail = error instanceof Error ? error.message : "转写提交失败";
      setAsrJob({ status: "error", progress: 0, stage: "error", error: detail });
      setMessage(detail);
    }
  }

  async function onCancelAsr() {
    if (!asrJob?.id) return;
    try {
      const next = await cancelTranscribeJob(asrJob.id);
      setAsrJob(next);
      setMessage(next.status === "cancelled" ? "已终止转写" : "正在终止转写");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "终止失败");
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
    setMessage("已填入配音文稿");
  }

  function applyAsrToClone() {
    if (!asrText.trim()) return;
    setRefText(asrText.trim());
    setCloneStudioOpen(true);
    setVoiceFold("clone");
    setDrawerOpen(false);
    go("dub");
    setMessage("已填入克隆逐字稿");
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
    setMessage("已复制转写结果");
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
      const next = await createJob({
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
        scriptName: scriptName.trim() || "文稿",
      });
      setJob(next);
      try {
        window.localStorage.setItem(JOB_ID_KEY, next.id);
      } catch {
        /* ignore */
      }
      void refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function onCancelJob(id: string) {
    try {
      const next = await cancelJob(id);
      setJob(next);
      setMessage(next.status === "cancelled" ? "已终止配音" : "正在终止，当前批次结束后停下");
      void refreshHistory();
    } catch (error) {
      if (jobLost(error)) {
        setJob((current) =>
          current && current.id === id
            ? { ...current, status: "error", error: "任务已中断（服务重启后丢失），请重新点分段配音" }
            : current,
        );
        setMessage("任务已经不在了，直接重新生成即可");
        try {
          window.localStorage.removeItem(JOB_ID_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      setMessage(error instanceof Error ? error.message : "终止失败");
    }
  }

  function toggleSpeaker(id: string) {
    setSelectedSpeakers((current) => toggleId(current, id));
  }

  function toggleCloneVoice(id: string) {
    setSelectedVoiceIds((current) => toggleId(current, id));
    setVoiceId(id);
  }

  function addDesign() {
    const text = instruct.trim();
    if (!text) {
      setMessage("请先填写音色描述");
      return;
    }
    if (designs.some((item) => item.instruct === text)) {
      setMessage("这个描述已经在已选音色里");
      return;
    }
    const name = VOICE_PRESETS.find((item) => item.text === text)?.label || `描述音色 ${designs.length + 1}`;
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
      setMessage(error instanceof Error ? error.message : "无法播放音色");
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
      setMessage(error instanceof Error ? error.message : "无法试听预设音色");
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
      setMessage("请填写音色名称");
      return;
    }
    try {
      const updated = await renameVoice(renamingId, name);
      setRenamingId(null);
      setVoiceId(updated.id);
      await refresh();
      setMessage(`已重命名为 ${updated.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function onDeleteVoice(id: string, name?: string) {
    const label = name || id;
    if (!window.confirm(`删除克隆音色「${label}」？录音会从本机去掉，不能恢复。`)) return;
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
      setMessage(`已删除 ${label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function onDownload(url: string, filename: string) {
    try {
      await downloadFile(url, filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载失败");
    }
  }

  function onDownloadZip(item: Job) {
    void onDownload(jobZipUrl(item), jobZipName(item));
  }

  function onDownloadFullTrack(item: Job) {
    const segment = item.segments?.[0];
    if (!jobNeedsZip(item) && segment?.url) {
      void onDownload(withDownload(segment.url), wavName(segment.filename || jobFullTrackName(item)));
      return;
    }
    void onDownload(jobFullTrackUrl(item), jobFullTrackName(item));
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
      setMessage(error instanceof Error ? error.message : "找不到成片");
    }
  }

  async function onDeleteHistory(id: string) {
    try {
      await deleteJob(id);
      if (job?.id === id) setJob(null);
      await refreshHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
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
      item.mode ? MODE_LABEL[item.mode] || item.mode : "",
      item.speakers?.length ? item.speakers.join(" / ") : item.speaker || "",
      item.audio_sec ? `${item.audio_sec}s` : "",
      item.chunks && item.speakers && item.speakers.length > 1
        ? `${item.chunks} 段 × ${item.speakers.length} 音色`
        : item.segments?.length
          ? `${item.segments.length} 段`
          : item.chunks
            ? `${item.chunks} 段`
            : "",
      item.status && item.status !== "done" ? JOB_STATUS[item.status] || item.status : "",
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
      : (
          health?.current_mode === "design"
            ? health?.design_model_id
            : health?.current_mode === "preset"
              ? health?.custom_model_id
              : health?.model_id
        )?.split("/").pop() || "等待模型";
  const modelDetail =
    route === "transcribe"
      ? health?.asr_loaded
        ? "转写已加载"
        : health?.asr_model_ready
          ? "转写就绪"
          : "转写未下载"
      : `${health?.model_loaded ? "已加载" : "未加载"}${health?.custom_model_ready ? " · 预设可用" : " · 预设未下载"}${health?.design_model_ready ? " · 描述可用" : " · 描述未下载"}`;

  return (
    <div className={appClass}>
      {drawerOpen ? <button type="button" className="sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setDrawerOpen(false)} /> : null}
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
            aria-label="打开菜单"
            onClick={() => setDrawerOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="app-bar-title">
            <strong>{route === "transcribe" ? "转写" : "配音"}</strong>
            <span>{route === "transcribe" ? "语音转文字，结果可填回配音页" : "音色、文稿、成片并排工作"}</span>
          </div>
          <button
            type="button"
            className="theme-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
            aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
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
              ? "录音中，先停止再折叠"
              : voicesCollapsed
                ? "展开音色"
                : "折叠音色"
          }
        >
          <h2>音色</h2>
          <span>{voiceCount} 个已选</span>
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
                <h3>录制克隆</h3>
                <button
                  type="button"
                  className="ghost mini"
                  disabled={recStatus === "recording"}
                  onClick={() => setCloneStudioOpen(false)}
                >
                  返回选音色
                </button>
              </header>
              <p className="hint">对着麦克风朗读下面这句，3–10 秒干净人声。保存后会留在本机 `data/voices/`。</p>
              <form className="stack" onSubmit={onSaveVoice}>
                <label>
                  音色名称
                  <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
                </label>
                <div className="rec-script">
                  <span>请朗读</span>
                  {CLONE_PROMPT}
                </div>
                <div className="rec-bar">
                  {recStatus === "recording" ? (
                    <button type="button" className="rec-stop" onClick={stopMic}>
                      停止
                    </button>
                  ) : (
                    <button type="button" onClick={() => void startMic()} disabled={busy}>
                      开始录音
                    </button>
                  )}
                  <span className={recStatus === "recording" ? "rec-live" : "hint"}>
                    {recStatus === "recording"
                      ? `录音中 ${recSeconds.toFixed(1)}s / ${REC_MAX_SEC}s`
                      : recStatus === "ready"
                        ? `已录 ${recSeconds.toFixed(1)}s`
                        : "建议 5–8 秒，最长 10 秒"}
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
                      重录
                    </button>
                  ) : null}
                </div>
                {recUrl ? <audio className="rec-player" controls src={recUrl} /> : null}
                <FileField
                  label="或上传参考音频"
                  accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
                  file={refFile}
                  emptyText="wav / m4a / mp3 / 麦克风录音，3–10 秒"
                  onChange={(file) => {
                    if (file) clearMicTake();
                    setRefFile(file);
                  }}
                />
                <label>
                  朗读稿（需和录音一致）
                  <textarea
                    rows={3}
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    placeholder={CLONE_PROMPT}
                  />
                </label>
                <button type="button" className="ghost mini" onClick={() => setRefText(CLONE_PROMPT)}>
                  填入门锁模板
                </button>
                <button type="submit" disabled={busy}>
                  保存到音色库
                </button>
              </form>
            </div>
          ) : (
            <>
          <p className="hint">
            预设、描述和克隆可以同时选。同一文稿会为每个已选音色各生成一段短音频。
          </p>
          <div className="roster">
            <div className="roster-head">
              <strong>已选音色</strong>
              <span>温度 {temperature.toFixed(2)}</span>
            </div>
            {roster.length || pendingClone ? (
              <div className="roster-list">
                {roster.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="roster-chip"
                    onClick={item.remove}
                    title="移出已选"
                  >
                    <small>{MODE_LABEL[item.kind]}</small>
                    {item.name}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                {pendingClone ? (
                  <span className="roster-chip pending">
                    <small>克隆</small>
                    未保存参考音频
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="hint">还没有选音色。从下面三类里点选，描述音色点「加入已选」。</p>
            )}
          </div>
          <p className="hint">温度在文稿栏调节，所有已选音色共用。稳定配音另外管句号和时长。</p>

          <FoldSection
            title="预设说话人"
            badge={`${selectedSpeakers.length}`}
            open={voiceFold === "preset"}
            onToggle={() => setVoiceFold("preset")}
          >
            <p className="hint">
              可多选。点「试听」听一句该说话人的样例，第一次会现场生成并缓存。
              {health?.custom_model_ready ? "" : " 当前还没下载 CustomVoice 权重，请先运行 `make download-custom`。"}
            </p>
            <div className="speaker-grid">
              {speakers.map((item) => (
                <div key={item.id} className={selectedSpeakers.includes(item.id) ? "speaker-card on" : "speaker-card"}>
                  <button
                    type="button"
                    className={selectedSpeakers.includes(item.id) ? "speaker on" : "speaker"}
                    aria-pressed={selectedSpeakers.includes(item.id)}
                    onClick={() => toggleSpeaker(item.id)}
                  >
                    {item.label}
                    <small>
                      {item.native}
                      {item.description ? ` · ${item.description}` : ""}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="ghost mini"
                    disabled={health?.custom_model_ready === false || previewingSpeaker !== null}
                    onClick={() => void togglePlaySpeaker(item.id)}
                  >
                    {previewingSpeaker === item.id
                      ? "生成中…"
                      : playingVoiceId === `preset:${item.id}`
                        ? "暂停"
                        : "试听"}
                  </button>
                </div>
              ))}
            </div>
            <label>
              预设语气（可选）
              <input
                value={styleInstruct}
                onChange={(e) => setStyleInstruct(e.target.value)}
                placeholder="语速平稳，语气中性，不拖腔，句末利落，不要额外停顿。"
              />
            </label>
          </FoldSection>

          <FoldSection
            title="描述音色"
            badge={`${designs.length}`}
            open={voiceFold === "design"}
            onToggle={() => setVoiceFold("design")}
          >
            <p className="hint">
              不用上传参考音频。写好描述后点「加入已选」，可以加多条。
              {health?.design_model_ready ? "" : " 当前还没下载 VoiceDesign 权重，请先运行 `make download-design`。"}
            </p>
            <div className="chips">
              {VOICE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={instruct === preset.text ? "chip on" : "chip"}
                  onClick={() => setInstruct(preset.text)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label>
              音色描述
              <textarea
                rows={4}
                value={instruct}
                onChange={(e) => setInstruct(e.target.value)}
                placeholder="A calm adult male narrator, warm mid pitch, clear studio diction..."
              />
            </label>
            <button type="button" className="ghost" onClick={addDesign} disabled={!instruct.trim()}>
              加入已选
            </button>
          </FoldSection>

          <FoldSection
            title="声音克隆"
            badge={`${selectedVoiceIds.length}${voices.length ? `/${voices.length}` : ""}`}
            open={voiceFold === "clone"}
            onToggle={() => setVoiceFold("clone")}
          >
            <p className="hint">从已保存的克隆里点选。录音和上传在「录制新音色」里。</p>
            {voices.length ? (
              <div className="voice-list">
                {voices.map((voice) => (
                  <div key={voice.id} className={selectedVoiceIds.includes(voice.id) ? "voice-card on" : "voice-card"}>
                    <button type="button" className="voice-select" onClick={() => toggleCloneVoice(voice.id)}>
                      <strong>{voice.name}</strong>
                      <small>
                        {voice.duration_sec ? `${voice.duration_sec}s` : "已保存"}
                        {voice.ref_text ? ` · ${voice.ref_text.slice(0, 36)}` : ""}
                      </small>
                    </button>
                    <div className="voice-actions">
                      <button type="button" className="ghost mini" onClick={() => void togglePlayVoice(voice.id)}>
                        {playingVoiceId === voice.id ? "暂停" : "播放"}
                      </button>
                      <button type="button" className="ghost mini" onClick={() => startRenameVoice(voice)}>
                        重命名
                      </button>
                      <button
                        type="button"
                        className="ghost mini"
                        onClick={() => void onDeleteVoice(voice.id, voice.name)}
                      >
                        删除
                      </button>
                    </div>
                    {renamingId === voice.id ? (
                      <form className="voice-rename" onSubmit={(event) => void onRenameVoice(event)}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          placeholder="新的音色名称"
                        />
                        <button type="submit" disabled={busy || !renameValue.trim()}>
                          保存
                        </button>
                        <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                          取消
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">还没有保存过克隆音色。录制一次后会留在本机，下次直接选用。</p>
            )}
            <button type="button" className="ghost" onClick={() => setCloneStudioOpen(true)}>
              录制新音色
            </button>
          </FoldSection>
            </>
          )}
        </div>
        </section>

        <section className="panel studio-script">
          <header className="panel-head">
            <h2>文稿</h2>
            <span>{filledSegments.length} 段</span>
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
                语言
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                并发
                <div className="stepper">
                  <button
                    type="button"
                    className="ghost"
                    aria-label="减少并发"
                    disabled={batchSize <= 1}
                    onClick={() => setBatchSize((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <span className="stepper-value">{batchSize}</span>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="增加并发"
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
                  稳定配音
                </label>
                <label className="check" title={health?.asr_model_ready ? "配完用转写听一遍，对不上的句子再配一次" : "需要先下载 ASR"}>
                  <input
                    type="checkbox"
                    checked={verifyAsr}
                    disabled={health?.asr_model_ready === false}
                    onChange={(e) => setVerifyAsr(e.target.checked)}
                  />
                  ASR 校对一轮
                </label>
              </div>
              <TempSlider value={temperature} onChange={setTemperature} />
            </div>
            <p className="hint hint-compact">
              {verifyAsr
                ? "配完会切到转写模型听一遍，对不上的句子再配一次。时间会更长。"
                : stableDub
                ? "Markdown 一项一段。zip 包名是列表名 + 音色 + 时间；里面每段是「文稿 - 音色.wav」，同一句重配会覆盖。"
                : "已关闭稳定配音，短句语气和时长会更随性。一项一段；zip 内文件名不含时间，重配同句会覆盖。"}
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
                  正在载入列表…
                </div>
              ) : null}
            </div>
            <div className="row meta">
              <button type="button" className="ghost" onClick={addSegment}>
                添加一项
              </button>
              <button type="button" className="ghost" onClick={tidyNumbers}>
                整理编号
              </button>
              <FileField
                label=""
                accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                emptyText={excelName || "导入 Excel / CSV"}
                buttonText="导入表格"
                onChange={(file) => void onImportScript(file)}
              />
              <span>{filledSegments.length} 段</span>
            </div>
            <FoldSection
              title="分段预览"
              badge={`${filledSegments.length} 段`}
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
                  ? "正在终止…"
                  : `终止配音 · ${Math.round((job?.progress || 0) * 100)}%`}
              </button>
            ) : (
              <button
                type="submit"
                className="generate"
                disabled={
                  busy ||
                  filledSegments.length === 0 ||
                  voiceCount === 0 ||
                  (selectedSpeakers.length > 0 && health?.custom_model_ready === false) ||
                  (designs.length > 0 && health?.design_model_ready === false) ||
                  ((selectedVoiceIds.length > 0 || pendingClone) && health?.model_dir_ready === false)
                }
              >
                {busy
                  ? "提交中…"
                  : `分段配音（${filledSegments.length} 段${voiceCount > 1 ? ` × ${voiceCount} 音色` : ""}）`}
              </button>
            )}
          </form>
        </section>

      <section className="panel studio-output">
        <header className="panel-head">
          <h2>成片</h2>
        </header>
        <p className="hint">
          {API_BASE
            ? "成片在 Mac 的 data/output/。zip：列表名 + 音色 + 时间；里面每段「文稿 - 音色.wav」，同句重配即覆盖。"
            : "zip 包名是列表名 + 音色 + 时间；分段是「文稿 - 音色.wav」，同句重配会覆盖。整轨按编号拼接。试听 16-bit，下载 24-bit。"}
        </p>
        {history.length ? (
          <FoldSection
            title="历史"
            badge={`${history.length}${job?.title ? ` · ${job.title}` : job?.id ? ` · ${job.id}` : ""}`}
            open={historyOpen}
            onToggle={() => setHistoryOpen((current) => !current)}
            className="history-fold"
          >
            <div className="history-list clips">
              {history.map((item) => (
                <div key={item.id} className={job?.id === item.id ? "media-card on" : "media-card"}>
                  <AudioRow
                    label={item.title || item.id}
                    title={historyHint(item)}
                    src={item.status === "done" ? item.download_url || undefined : undefined}
                    onLabelClick={() => void openHistory(item.id)}
                    actions={
                      jobActive(item.status) ? (
                        <button
                          type="button"
                          className="ghost mini stop"
                          disabled={item.status === "cancelling"}
                          onClick={() => void onCancelJob(item.id)}
                        >
                          {item.status === "cancelling" ? "终止中…" : "终止"}
                        </button>
                      ) : item.status === "done" ? (
                        <>
                          {jobNeedsZip(item) ? (
                            <>
                              <button type="button" className="ghost mini" onClick={() => void onDownloadZip(item)}>
                                打包分段
                              </button>
                              <button type="button" className="ghost mini" onClick={() => void onDownloadFullTrack(item)}>
                                下载整轨
                              </button>
                            </>
                          ) : (
                            <button type="button" className="ghost mini" onClick={() => void onDownloadFullTrack(item)}>
                              下载
                            </button>
                          )}
                          <button type="button" className="ghost mini" onClick={() => void onDeleteHistory(item.id)}>
                            删除
                          </button>
                        </>
                      ) : null
                    }
                  />
                </div>
              ))}
            </div>
          </FoldSection>
        ) : (
          <p className="hint">还没有成片。生成一次后会留在历史记录里。</p>
        )}
        {job ? (
          <div className="job">
            <div className="bar">
              <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
            </div>
            <p>
              {job.status === "done"
                ? `完成 · ${job.chunks || job.segments?.length || 0} 段${
                    job.speakers && job.speakers.length > 1 ? ` × ${job.speakers.length} 音色` : ""
                  } · ${job.audio_sec}s · 耗时 ${job.elapsed_sec}s · RTF ${job.rtf}${
                    verifySummary(job) ? ` · ${verifySummary(job)}` : ""
                  }`
                : job.status === "error"
                  ? job.error
                  : job.status === "cancelled"
                    ? "已终止"
                    : `${jobPhaseLabel(job)} · ${Math.round((job.progress || 0) * 100)}%`}
            </p>
            {jobActive(job.status) ? (
              <button
                type="button"
                className="ghost stop"
                disabled={job.status === "cancelling"}
                onClick={() => void onCancelJob(job.id)}
              >
                {job.status === "cancelling" ? "正在终止…" : "终止"}
              </button>
            ) : null}
            {job.status === "done" && job.local_dir && !API_BASE ? (
              <p className="hint">本机目录 {job.local_dir} · zip「列表名 - 音色 - 时间」· 分段「文稿 - 音色.wav」</p>
            ) : null}
            {job.status === "done" && jobNeedsZip(job) ? (
              <div className="tracks">
                <button type="button" className="ghost" onClick={() => void onDownloadZip(job)}>
                  打包全部分段
                </button>
                <button type="button" className="ghost" onClick={() => void onDownloadFullTrack(job)}>
                  下载整轨
                </button>
              </div>
            ) : null}
            {job.status === "done" && job.segments?.length ? (
              <ClipList segments={job.segments} onDownload={onDownload} />
            ) : null}
          </div>
        ) : history.length ? null : (
          <p className="hint">生成结果会按编号显示在这里。</p>
        )}
      </section>
      </div>
      )}
      </div>
    </div>
  );
}
