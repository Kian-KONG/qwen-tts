import { FormEvent, useState } from "react";
import type { ScriptList } from "../api";
import { FoldSection } from "./FoldSection";

export function ScriptLists({
  scripts,
  activeId,
  name,
  languages,
  canSave,
  onName,
  onSave,
  onUpdate,
  onLoad,
  onRename,
  onDelete,
}: {
  scripts: ScriptList[];
  activeId: string;
  name: string;
  languages: { id: string; label: string }[];
  canSave: boolean;
  onName: (value: string) => void;
  onSave: () => void;
  onUpdate: () => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const active = scripts.find((item) => item.id === activeId);

  function languageLabel(id?: string) {
    if (!id) return "";
    return languages.find((item) => item.id === id)?.label || id;
  }

  function startRename(item: ScriptList) {
    setRenamingId(item.id);
    setRenameValue(item.name);
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renamingId || !renameValue.trim()) return;
    onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  }

  return (
    <FoldSection
      title="配音列表"
      badge={`${scripts.length}${active ? ` · ${active.name}` : ""}`}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      <p className="hint">保存当前编号文稿，下次直接点开，不用再粘贴。保存在本机 data/scripts/。</p>
      <div className="script-save">
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="列表名称，如 门锁中文"
        />
        <button type="button" className="ghost mini" disabled={!canSave || !name.trim()} onClick={onSave}>
          保存为新列表
        </button>
        {activeId ? (
          <button type="button" className="ghost mini" disabled={!canSave} onClick={onUpdate}>
            更新当前
          </button>
        ) : null}
      </div>
      {scripts.length ? (
        <div className="voice-list">
          {scripts.map((item) => (
            <div key={item.id} className={item.id === activeId ? "voice-card on" : "voice-card"}>
              <button type="button" className="voice-select" onClick={() => onLoad(item.id)}>
                <strong>{item.name}</strong>
                <small>
                  {item.chunks ? `${item.chunks} 段` : "已保存"}
                  {item.language ? ` · ${languageLabel(item.language)}` : ""}
                  {item.preview ? ` · ${item.preview}` : ""}
                </small>
              </button>
              <div className="voice-actions">
                <button type="button" className="ghost mini" onClick={() => onLoad(item.id)}>
                  载入
                </button>
                <button type="button" className="ghost mini" onClick={() => startRename(item)}>
                  重命名
                </button>
                <button type="button" className="ghost mini" onClick={() => onDelete(item.id, item.name)}>
                  删除
                </button>
              </div>
              {renamingId === item.id ? (
                <form className="voice-rename" onSubmit={submitRename}>
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    autoFocus
                    placeholder="新的列表名称"
                  />
                  <button type="submit" disabled={!renameValue.trim()}>
                    保存
                  </button>
                  <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                    取消
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">还没有保存过列表。写好文稿后起个名字，点「保存为新列表」。</p>
      )}
    </FoldSection>
  );
}
