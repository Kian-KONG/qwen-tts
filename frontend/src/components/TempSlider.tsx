import { useI18n } from "../i18n";

export function TempSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n();
  return (
    <label className="temp-control">
      {t("output.temp")}
      <div className="temp-row">
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span>{value.toFixed(2)}</span>
      </div>
    </label>
  );
}
