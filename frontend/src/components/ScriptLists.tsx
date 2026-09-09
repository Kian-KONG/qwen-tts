import { FormEvent, useState } from "react";
import type { ScriptList } from "../api";
import { displayScriptName, languageLabel, useI18n } from "../i18n";
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const active = scripts.find((item) => item.id === activeId);
  const busy = Boolean(pending);
  const listing = pending?.action === "list";

  function scriptLanguage(id?: string) {
    if (!id) return "";
    return languageLabel(id, languages.find((item) => item.id === id)?.label || id);
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
      title={t("lists.title")}
      badge={`${scripts.length}${active ? ` · ${displayScriptName(active.name)}` : ""}`}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      <p className="hint">{t("lists.hint")}</p>
      <div className="script-save">
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder={t("lists.namePlaceholder")}
          disabled={busy}
        />
        <button type="button" className="ghost mini" disabled={busy || !canSave || !name.trim()} onClick={onSave}>
          {pending?.action === "save" ? (
            <>
              <span className="spin" />
              {t("common.saving")}
            </>
          ) : (
            t("lists.saveNew")
          )}
        </button>
        {activeId ? (
          <button type="button" className="ghost mini" disabled={busy || !canSave} onClick={onUpdate}>
            {pending?.action === "update" ? (
              <>
                <span className="spin" />
                {t("common.updating")}
              </>
            ) : (
              t("lists.update")
            )}
          </button>
        ) : null}
      </div>
      {listing ? (
        <p className="hint loading-line">
          <span className="spin" />
          {t("lists.loading")}
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
                  <strong>{displayScriptName(item.name)}</strong>
                  <small>
                    {t("common.segments", { n: count })}
                    {item.language ? ` · ${scriptLanguage(item.language)}` : ""}
                    {item.preview ? ` · ${item.preview}` : ""}
                  </small>
                </button>
                <div className="voice-actions">
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => onLoad(item.id)}>
                    {loadingThis ? (
                      <>
                        <span className="spin" />
                        {t("common.loading")}
                      </>
                    ) : (
                      t("lists.load")
                    )}
                  </button>
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => startRename(item)}>
                    {t("common.rename")}
                  </button>
                  <button type="button" className="ghost mini" disabled={busy} onClick={() => onDelete(item.id, item.name)}>
                    {deletingThis ? (
                      <>
                        <span className="spin" />
                        {t("common.deleting")}
                      </>
                    ) : (
                      t("common.delete")
                    )}
                  </button>
                </div>
                {renamingId === item.id ? (
                  <form className="voice-rename" onSubmit={submitRename}>
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      autoFocus
                      placeholder={t("lists.renamePlaceholder")}
                      disabled={busy}
                    />
                    <button type="submit" disabled={busy || !renameValue.trim()}>
                      {t("common.save")}
                    </button>
                    <button type="button" className="ghost" onClick={() => setRenamingId(null)}>
                      {t("common.cancel")}
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">{t("lists.empty")}</p>
      )}
    </FoldSection>
  );
}
