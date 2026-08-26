import { FileField } from "./FileField";
import type { Health, Language, Transcript } from "../api";

const ASR_STAGES: Record<string, string> = {
  queued: "排队中",
  converting: "转换音频",
  loading: "加载转写模型",
  transcribing: "识别中",
  done: "完成",
  error: "失败",
};

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
  onTextChange: (value: string) => void;
  onCopy: () => void;
  onApplyToScript: () => void;
  onApplyToClone: () => void;
}) {
  return (
    <section className="asr-workspace">
      <div className="panel asr-side">
        <header className="panel-head">
          <h2>语音转文字</h2>
        </header>
        <p className="hint">
          上传音频后会显示进度；第一次会先卸载 TTS、加载 Qwen3-ASR 1.7B。转写完成后可填入配音页。
          {health?.asr_model_ready ? "" : " 当前还没下载 ASR 权重，请先运行 `make download-asr`。"}
        </p>
        <div className="stack">
          <FileField
            label="音频"
            accept="audio/wav,audio/mpeg,audio/mp4,audio/*"
            file={asrFile}
            emptyText="wav / m4a / mp3"
            onChange={onFile}
          />
          <label>
            语言
            <select value={asrLanguage} onChange={(e) => onLanguage(e.target.value)}>
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onTranscribe}
            disabled={!asrFile || health?.asr_model_ready === false || asrJob?.status === "queued" || asrJob?.status === "running"}
          >
            {asrJob?.status === "queued" || asrJob?.status === "running" ? "转写中…" : "开始转写"}
          </button>
          {asrJob ? (
            <div className="job">
              <div className="bar">
                <span style={{ width: `${Math.round((asrJob.progress || 0) * 100)}%` }} />
              </div>
              <p>
                {asrJob.status === "done"
                  ? `完成 · ${asrJob.segments?.length || 1} 段 · ${asrJob.duration_sec ?? "-"}s · 耗时 ${asrJob.elapsed_sec ?? "-"}s · ${asrJob.language || asrLanguage}`
                  : asrJob.status === "error"
                    ? asrJob.error
                    : asrJob.chunk && asrJob.chunks
                      ? `识别中 ${asrJob.chunk}/${asrJob.chunks} · ${Math.round((asrJob.progress || 0) * 100)}%`
                      : `${ASR_STAGES[asrJob.stage || asrJob.status || ""] || asrJob.stage || asrJob.status} · ${Math.round((asrJob.progress || 0) * 100)}%`}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <div className="panel asr-result-pane">
        <header className="panel-head">
          <h2>转写结果</h2>
          <p className="hint">
            {health?.asr_loaded ? "转写模型已加载" : health?.asr_model_ready ? "转写模型就绪，未加载" : "转写未下载"}
          </p>
        </header>
        <textarea
          rows={16}
          className="asr-result"
          value={asrText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="识别结果会出现在这里，可再编辑。"
        />
        <div className="row">
          <button type="button" className="ghost" onClick={onCopy} disabled={!asrText.trim()}>
            {asrCopied ? "已复制" : "复制结果"}
          </button>
          <button type="button" className="ghost" onClick={onApplyToScript} disabled={!asrText.trim()}>
            填入配音文稿
          </button>
          <button type="button" className="ghost" onClick={onApplyToClone} disabled={!asrText.trim()}>
            填入克隆逐字稿
          </button>
        </div>
      </div>
    </section>
  );
}
