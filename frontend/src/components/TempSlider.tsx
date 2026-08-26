export function TempSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="temp-control">
      温度 temp
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
