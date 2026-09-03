import { withDownload, type Job, type JobTrack } from "../api";
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
  if (!tracks.length) return null;
  return (
    <div className="track-list">
      {tracks.map((track) => (
        <AudioRow
          key={track.index}
          label={track.voice || `完整轨 ${track.index}`}
          title={track.filename || track.voice || `完整轨 ${track.index}`}
          src={track.url}
          actions={
            <button
              type="button"
              className="ghost mini"
              onClick={() => onDownload(withDownload(track.url), jobTrackName(job, track))}
            >
              下载
            </button>
          }
        />
      ))}
    </div>
  );
}
