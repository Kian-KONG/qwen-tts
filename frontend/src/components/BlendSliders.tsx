import { kokoroWeight, normalizedBlendPercents } from "../lib/kokoroBlend";

export function BlendSliders({
  voices,
  weights,
  onWeight,
}: {
  voices: { id: string; label: string }[];
  weights: Record<string, number>;
  onWeight: (id: string, value: number) => void;
}) {
  const percents = normalizedBlendPercents(
    voices.map((item) => item.id),
    weights,
  );
  return (
    <div className="blend-sliders">
      {voices.map((item) => (
        <label key={item.id} className="blend-slider">
          <span>
            {item.label}
            <small>{Math.round(percents[item.id] || 0)}%</small>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={kokoroWeight(item.id, weights)}
            onChange={(e) => onWeight(item.id, Number(e.target.value))}
          />
        </label>
      ))}
    </div>
  );
}
