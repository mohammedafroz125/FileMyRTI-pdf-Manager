import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, Image as ImageIcon, X } from "lucide-react";

type Props = {
  id: string;
  label: string;
  sublabel?: string;
  thumbnail: string | null;
  loading?: boolean;
  kind: "original" | "pdf" | "image";
  onDelete?: () => void;
};

export function PageThumb({
  id,
  label,
  sublabel,
  thumbnail,
  loading,
  kind,
  onDelete,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const badgeColor =
    kind === "original"
      ? "bg-blue-600 text-white"
      : kind === "pdf"
        ? "bg-emerald-600 text-white"
        : "bg-amber-500 text-white";

  const badgeText = kind === "original" ? "Original" : kind === "pdf" ? "PDF" : "Image";
  const FallbackIcon = kind === "image" ? ImageIcon : FileText;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative flex cursor-grab touch-none flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm hover:border-blue-400 hover:shadow-md active:cursor-grabbing"
    >
      <div className="relative flex aspect-[3/4] items-center justify-center bg-slate-50">
        {thumbnail ? (
          <img src={thumbnail} alt={label} className="h-full w-full object-contain" />
        ) : loading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        ) : (
          <FallbackIcon className="h-8 w-8 text-muted-foreground" />
        )}
        <span
          className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badgeColor}`}
        >
          {badgeText}
        </span>
        {onDelete && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-slate-600 opacity-0 shadow transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="border-t border-border px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-foreground">{label}</p>
        {sublabel && <p className="truncate text-[10px] text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
}
