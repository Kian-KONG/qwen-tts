import { FormEvent, useState } from "react";
import type { ScriptList } from "../api";
import { FoldSection } from "./FoldSection";

export type ScriptPending = {
  action: "list" | "save" | "update" | "load" | "delete";
  id?: string;
} | null;

export function ScriptLists({
  scripts,
  activeId,
  name,
  languages,
  canSave,
  pending,
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
  pending: ScriptPending;
  onName: (value: string) => void;
  onSave: () => void;
  onUpdate: () => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const active = scripts.find((item) => item.id === activeId);
  const busy = Boolean(pending);
  const listing = pending?.action === "list";

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
    if (!renamingId || !renameValue.trim() || busy) return;
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
      <p className="hint">保存当前编号文稿；载入会替换下面的列表。保存在本机 data/scripts/。</p>
      <div className="script-save">
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="列表名称，如 门锁中文"
          disabled={busy}
        />
        <button type="button" className="ghost mini" disabled={busy || !canSave || !name.trim()} onClick={onSave}>
          {pending?.action === "save" ? (
            <>
              <span className="spin" />
              保存中…
            </>
          ) : (
            "保存为新列表"
          )}
        </button>
        {activeId ? (
          <button type="button" className="ghost mini" disabled={busy || !canSave} onClick={onUpdate}>
            {pending?.action === "update" ? (
              <>
                <span className="spin" />
                更新中…
              </>
            ) : (
              "更新当前"
            )}
          </button>
        ) : null}
      </div>
      {listing ? (
        <p className="hint loading-line">
          <span className="spin" />
          读取已保存的列表…
        </p>
      ) : scripts.length ? (
        <div className="voice-list">
          {scripts.map((item) => {
            const loadingThis = pending?.action === "load" && pending.id === item.id;
            const deletingThis = pending?.action === "delete" && pending.id === item.id;
            const count = item.chunks ?? 0;
            return (
              <div key={item.id} className={item.id === activeId ? "voice-card on" : "voice-card"}>
                <button type="button" className="voice-select" disabled={busy} onClick={() => onLoad(item.id)}>
                  <strong>{item.name}</strong>
                  <small>
                    {count} 段
                    {item.language ? ` · ${languageLabel(item.language)}` : ""}
                    {item.preview ? ` · ${item.preview}` : ""}
                  </small>
                </button>
                <div className="voice-actions">
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => onLoad(item.id)}>
                    {loadingThis ? (
                      <>
                        <span className="spin" />
                        载入中…
                      </>
                    ) : (
                      "载入"
                    )}
                  </button>
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => startRename(item)}>
                    重命名
                  </button>
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => onDelete(item.id, item.name)}>
                    {deletingThis ? (
                      <>
                        <span className="spin" />
                        删除中…
                      </>
                    ) : (
                      "删除"
                    )}
                  </button>
                </div>
                {renamingId === item.id ? (
                  <form className="voice-rename" onSubmit={submitRename}>
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      autoFocus
                      placeholder="新的列表名称"
                      disabled={busy}
                    />
                    <button type="submit" disabled={busy || !renameValue.trim()}>
                      保存
                    </button>
                    <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                      取消
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">还没有保存过列表。写好文稿后起个名字，点「保存为新列表」。</p>
      )}
    </FoldSection>
  );
}
