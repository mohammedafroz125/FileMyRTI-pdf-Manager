import { useRef, useState, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

type Props = {
  label: string;
  hint: string;
  multiple?: boolean;
  accept: string;
  onFiles: (files: File[]) => void;
};

export function Dropzone({ label, hint, multiple, accept, onFiles }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        over
          ? "border-blue-500 bg-blue-50"
          : "border-border bg-card hover:border-blue-400 hover:bg-blue-50/40"
      }`}
    >
      <UploadCloud className="mb-2 h-8 w-8 text-blue-600" />
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
