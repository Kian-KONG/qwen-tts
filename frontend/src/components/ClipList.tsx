import { withDownload, type JobSegment } from "../api";
import { clipLabel, groupSegments, wavName } from "../lib/jobUtils";
import { AudioRow } from "./AudioRow";

function clipFlag(segment: JobSegment) {
  if (segment.retaken) {
    return { className: "clip-flag ok", label: "已重配", title: segment.asr_text || "校对未对齐，已重配" };
  }
  if (segment.match === false) {
    return { className: "clip-flag warn", label: "未对齐", title: segment.asr_text || "转写为空" };
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
  return (
    <ol className="clips">
      {groupSegments(segments).map((group) => (
        <li key={group.clips.map((clip) => clip.index).join("-")} className="media-card">
          <div className="clip-voices">
            {group.clips.map((segment) => {
              const name = clipLabel(segment);
              const flag = clipFlag(segment);
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
                        下载
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
