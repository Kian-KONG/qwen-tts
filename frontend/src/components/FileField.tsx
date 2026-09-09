import { useI18n } from "../i18n";

export function FileField({
  label,
  accept,
  file,
  emptyText,
  buttonText,
  onChange,
}: {
  label?: string;
  accept: string;
  file?: File | null;
  emptyText?: string;
  buttonText?: string;
  onChange: (file: File | null) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="file-field-wrap">
      {label ? label : null}
      <span className="file-field">
        <span className="file-name">{file ? file.name : emptyText ?? t("file.none")}</span>
        <span className="file-btn">{buttonText || (file ? t("file.replace") : t("file.choose"))}</span>
        <input
          type="file"
          accept={accept}
          onChange={(event) => {
            onChange(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </span>
    </label>
  );
}
