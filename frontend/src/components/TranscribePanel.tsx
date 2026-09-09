import { FileField } from "./FileField";
import type { Health, Language, Transcript } from "../api";
import { languageLabel, useI18n } from "../i18n";

function asrStageLabel(stage: string, t: (path: string) => string): string {
  const keys: Record<string, string> = {
    queued: "status.queued",
    converting: "asr.converting",
    loading: "asr.loadingModel",
    transcribing: "asr.transcribing",
    cancelling: "status.cancelling",
    cancelled: "status.cancelled",
    done: "status.done",
    error: "status.error",
  };
  return keys[stage] ? t(keys[stage]) : stage;
}

export function TranscribePanel({
  health,
  languages,
  asrFile,
  asrLanguage,
  asrJob,
  asrText,
  asrCopied,
  onFile,
  onLanguage,
  onTranscribe,
  onCancel,
  onTextChange,
  onCopy,
  onApplyToScript,
  onApplyToClone,
}: {
  health: Health | null;
  languages: Language[];
  asrFile: File | null;
  asrLanguage: string;
  asrJob: Transcript | null;
  asrText: string;
  asrCopied: boolean;
  onFile: (file: File | null) => void;
  onLanguage: (value: string) => void;
  onTranscribe: () => void;
  onCancel: () => void;
  onTextChange: (value: string) => void;
  onCopy: () => void;
  onApplyToScript: () => void;
  onApplyToClone: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="asr-workspace">
      <div className="panel asr-side">
        <header className="panel-head">
          <h2>{t("asr.title")}</h2>
        </header>
        <p className="hint">
          {t("asr.hint")}
          {health?.asr_model_ready ? "" : t("asr.missing")}
        </p>
        <div className="stack">
          <FileField
            label={t("asr.audio")}
            accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
            file={asrFile}
            emptyText="wav / m4a / mp3"
            onChange={onFile}
          />
          <label>
            {t("common.language")}
            <select value={asrLanguage} onChange={(e) => onLanguage(e.target.value)}>
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {languageLabel(item.id, item.label)}
                </option>
              ))}
            </select>
          </label>
          {asrJob?.id && (asrJob.status === "queued" || asrJob.status === "running" || asrJob.status === "cancelling") ? (
            <button
              type="button"
              className="stop"
              disabled={asrJob.status === "cancelling"}
              onClick={onCancel}
            >
              {asrJob.status === "cancelling" ? t("common.stopping") : t("asr.stop")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onTranscribe}
              disabled={!asrFile || health?.asr_model_ready === false}
            >
              {t("asr.start")}
            </button>
          )}
          {asrJob ? (
            <div className="job">
              <div className="bar">
                <span style={{ width: `${Math.round((asrJob.progress || 0) * 100)}%` }} />
              </div>
              <p>
                {asrJob.status === "done"
                  ? t("asr.doneLine", {
                      n: asrJob.segments?.length || 1,
                      duration: asrJob.duration_sec ?? "-",
                      elapsed: asrJob.elapsed_sec ?? "-",
                      language: asrJob.language || asrLanguage,
                    })
                  : asrJob.status === "error"
                    ? asrJob.error
                    : asrJob.status === "cancelled"
                      ? t("status.cancelled")
                      : asrJob.chunk && asrJob.chunks
                      ? t("asr.runningLine", {
                          chunk: asrJob.chunk,
                          chunks: asrJob.chunks,
                          pct: Math.round((asrJob.progress || 0) * 100),
                        })
                      : `${asrStageLabel(asrJob.stage || asrJob.status || "", t)} · ${Math.round((asrJob.progress || 0) * 100)}%`}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="panel asr-result-pane">
        <header className="panel-head">
          <h2>{t("asr.result")}</h2>
          <p className="hint">
            {health?.asr_loaded ? t("asr.modelLoaded") : health?.asr_model_ready ? t("asr.modelReady") : t("status.asrMissing")}
          </p>
        </header>
        <textarea
          rows={16}
          className="asr-result"
          value={asrText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={t("asr.placeholder")}
        />
        <div className="row">
          <button type="button" className="ghost" onClick={onCopy} disabled={!asrText.trim()}>
            {asrCopied ? t("common.copied") : t("asr.copy")}
          </button>
          <button type="button" className="ghost" onClick={onApplyToScript} disabled={!asrText.trim()}>
            {t("asr.toScript")}
          </button>
          <button type="button" className="ghost" onClick={onApplyToClone} disabled={!asrText.trim()}>
            {t("asr.toClone")}
          </button>
        </div>
      </div>
    </section>
  );
}
