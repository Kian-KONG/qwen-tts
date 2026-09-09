import { withDownload, type Job, type JobTrack } from "../api";
import { useI18n } from "../i18n";
import { jobTrackName } from "../lib/jobUtils";
import { AudioRow } from "./AudioRow";

export function TrackList({
  job,
  tracks,
  onDownload,
}: {
  job: Job;
  tracks: JobTrack[];
  onDownload: (url: string, filename: string) => void;
}) {
  const { t } = useI18n();
  if (!tracks.length) return null;
  return (
    <div className="track-list">
      {tracks.map((track) => (
        <AudioRow
          key={track.index}
          label={track.voice || t("output.track", { n: track.index })}
          title={track.filename || track.voice || t("output.track", { n: track.index })}
          src={track.url}
          actions={
            <button
              type="button"
              className="ghost mini"
              onClick={() => onDownload(withDownload(track.url), jobTrackName(job, track))}
            >
              {t("common.download")}
            </button>
          }
        />
      ))}
    </div>
  );
}
