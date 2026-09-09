import { useI18n, voiceDescription, voiceNative } from "../i18n";

export function SpeakerCard({
  kind,
  id,
  name,
  native,
  description,
  selected,
  previewing,
  playing,
  previewDisabled,
  onSelect,
  onPreview,
}: {
  kind: "speakers" | "kokoro";
  id: string;
  name: string;
  native?: string;
  description?: string;
  selected: boolean;
  previewing: boolean;
  playing: boolean;
  previewDisabled?: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const { t } = useI18n();
  const tag = voiceNative(native);
  const detail = voiceDescription(kind, id, description);
  return (
    <div className={selected ? "speaker-card on" : "speaker-card"}>
      <button type="button" className={selected ? "speaker on" : "speaker"} aria-pressed={selected} onClick={onSelect}>
        <span className="speaker-name">{name}</span>
        {tag ? <span className="speaker-native">{tag}</span> : null}
        {detail ? <span className="speaker-desc">{detail}</span> : null}
      </button>
      <button type="button" className="ghost mini" disabled={previewDisabled} onClick={onPreview}>
        {previewing ? t("common.generating") : playing ? t("common.pause") : t("voices.preview")}
      </button>
    </div>
  );
}
