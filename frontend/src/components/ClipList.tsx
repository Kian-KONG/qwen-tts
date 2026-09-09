import { withDownload, type JobSegment } from "../api";
import { useI18n } from "../i18n";
import { clipLabel, groupSegments, wavName } from "../lib/jobUtils";
import { AudioRow } from "./AudioRow";

function clipFlag(segment: JobSegment, t: (path: string) => string) {
  if (segment.retaken) {
    return { className: "clip-flag ok", label: t("output.flagRetake"), title: segment.asr_text || t("output.flagRetakeTitle") };
  }
  if (segment.match === false) {
    return { className: "clip-flag warn", label: t("output.flagMismatch"), title: segment.asr_text || t("output.asrEmpty") };
  }
  return null;
}

export function ClipList({
  segments,
  onDownload,
}: {
  segments: JobSegment[];
  onDownload: (url: string, filename: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ol className="clips">
      {groupSegments(segments).map((group) => (
        <li key={group.clips.map((clip) => clip.index).join("-")} className="media-card">
          <div className="clip-voices">
            {group.clips.map((segment) => {
              const name = clipLabel(segment);
              const flag = clipFlag(segment, t);
              return (
                <AudioRow
                  key={segment.index}
                  label={group.clips.length > 1 ? segment.voice || name : name}
                  title={group.clips.length > 1 ? group.text || name : name}
                  src={segment.url}
                  actions={
                    <>
                      {flag ? (
                        <span className={flag.className} title={flag.title}>
                          {flag.label}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="ghost mini"
                        onClick={() => void onDownload(withDownload(segment.url), wavName(segment.filename || name))}
                      >
                        {t("common.download")}
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}
