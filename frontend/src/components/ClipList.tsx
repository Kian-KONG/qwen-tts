import { withDownload, type JobSegment } from "../api";
import { clipLabel, groupSegments, wavName } from "../lib/jobUtils";
import { AudioRow } from "./AudioRow";

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
              return (
                <AudioRow
                  key={segment.index}
                  label={group.clips.length > 1 ? segment.voice || name : name}
                  title={group.clips.length > 1 ? group.text || name : name}
                  src={segment.url}
                  actions={
                    <button
                      type="button"
                      className="ghost mini"
                      onClick={() => void onDownload(withDownload(segment.url), wavName(segment.filename || name))}
                    >
                      下载
                    </button>
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
