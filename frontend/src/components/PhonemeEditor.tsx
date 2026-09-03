import { useEffect, useState } from "react";
import type { KokoroPhonemeSegment, KokoroPhonemeToken, KokoroPhonemes } from "../api";

function annotateToken(token: KokoroPhonemeToken): string {
  const word = token.text || "";
  const ps = (token.phonemes || "").trim();
  if (word && ps && /[A-Za-z]/.test(word)) {
    return `[${word}](/${ps}/)`;
  }
  return word;
}

function lineFromSegment(seg: KokoroPhonemeSegment): string {
  if (seg.tokens?.length) {
    return seg.tokens.map((token) => `${annotateToken(token)}${token.whitespace || ""}`).join("").trim();
  }
  return (seg.annotated || "").trim();
}

function numberedScript(segments: KokoroPhonemeSegment[]): string {
  return segments.map((seg, index) => `${index + 1}. ${lineFromSegment(seg)}`).join("\n");
}

export function PhonemeEditor({
  data,
  onApply,
}: {
  data: KokoroPhonemes;
  onApply: (annotated: string) => void;
}) {
  const [segments, setSegments] = useState(data.segments);

  useEffect(() => {
    setSegments(
      data.segments.map((seg) => ({
        ...seg,
        tokens: (seg.tokens || []).map((token) => ({ ...token })),
      })),
    );
  }, [data]);

  function setPhoneme(si: number, ti: number, phonemes: string) {
    setSegments((current) =>
      current.map((seg, index) => {
        if (index !== si || !seg.tokens) return seg;
        return {
          ...seg,
          tokens: seg.tokens.map((token, inner) => (inner === ti ? { ...token, phonemes } : token)),
        };
      }),
    );
  }

  return (
    <div className="phoneme-box">
      <div className="phoneme-head">
        <strong>Misaki 读音</strong>
        <button type="button" className="ghost mini" onClick={() => onApply(numberedScript(segments))}>
          写入标注
        </button>
      </div>
      <p className="hint hint-compact phoneme-hint">
        默认音标就是模型读法，原样写入听感不变。改右边音标后再写入。美式：I=aɪ、A=eɪ、O=oʊ、Q=ɔɪ、W=aʊ，例如 nine 是 nˈIn。
      </p>
      <ol className="phoneme-list">
        {segments.map((seg, si) => (
          <li key={`${si}-${seg.text.slice(0, 24)}`}>
            <span>{si + 1}.</span>
            <div className="phoneme-words">
              {(seg.tokens || []).map((token, ti) =>
                /[A-Za-z]/.test(token.text || "") ? (
                  <label key={`${ti}-${token.text}`} className="phoneme-word">
                    <span>{token.text}</span>
                    <input
                      value={token.phonemes}
                      spellCheck={false}
                      aria-label={`${token.text} 音标`}
                      onChange={(e) => setPhoneme(si, ti, e.target.value)}
                    />
                  </label>
                ) : null,
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
