export function FileField({
  label,
  accept,
  file,
  emptyText = "未选择文件",
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
  return (
    <label className="file-field-wrap">
      {label ? label : null}
      <span className="file-field">
        <span className="file-name">{file ? file.name : emptyText}</span>
        <span className="file-btn">{buttonText || (file ? "更换文件" : "选择文件")}</span>
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
