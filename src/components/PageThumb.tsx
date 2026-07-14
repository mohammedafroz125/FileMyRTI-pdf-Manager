import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, Image as ImageIcon, X, RotateCw, Replace } from "lucide-react";

type Props = {
  id: string;
  label: string;
  sublabel?: string;
  thumbnail: string | null;
  loading?: boolean;
  kind: "original" | "pdf" | "image";
  rotation?: number;
  /** Lazy loader; called once when the thumb enters viewport if `thumbnail` is null. */
  getThumbnail?: () => Promise<string | null>;
  onDelete?: () => void;
  onRotate?: () => void;
  onReplace?: () => void;
};

import React, { useEffect, useRef, useState } from "react";

export const PageThumb = React.memo(function PageThumb({
  id,
  label,
  sublabel,
  thumbnail,
  loading,
  kind,
  rotation = 0,
  getThumbnail,
  onDelete,
  onRotate,
  onReplace,
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

  // Lazy-load thumbnail on first visibility.
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [lazyThumb, setLazyThumb] = useState<string | null>(null);
  const [lazyLoading, setLazyLoading] = useState(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (thumbnail || !getThumbnail || requestedRef.current) return;
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // Fallback: load immediately.
      requestedRef.current = true;
      setLazyLoading(true);
      getThumbnail()
        .then((u) => setLazyThumb(u))
        .finally(() => setLazyLoading(false));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !requestedRef.current) {
            requestedRef.current = true;
            setLazyLoading(true);
            getThumbnail()
              .then((u) => setLazyThumb(u))
              .finally(() => setLazyLoading(false));
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thumbnail, getThumbnail]);

  const shownThumb = thumbnail ?? lazyThumb;
  const shownLoading = loading || (lazyLoading && !shownThumb);

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    outerRef.current = node;
  };

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative flex cursor-grab touch-none flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm hover:border-blue-400 hover:shadow-md active:cursor-grabbing"
    >
      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-slate-50">
        {shownThumb ? (
          <img
            src={shownThumb}
            alt={label}
            loading="lazy"
            className="h-full w-full object-contain transition-transform"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        ) : shownLoading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        ) : (
          <FallbackIcon className="h-8 w-8 text-muted-foreground" />
        )}
        <span
          className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badgeColor}`}
        >
          {badgeText}
        </span>

        <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onRotate && (
            <IconBtn onClick={onRotate} onPointerDown={stop} title="Rotate 90°">
              <RotateCw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {onReplace && (
            <IconBtn onClick={onReplace} onPointerDown={stop} title="Replace page">
              <Replace className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {onDelete && (
            <IconBtn onClick={onDelete} onPointerDown={stop} title="Delete page" danger>
              <X className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </div>
      <div className="border-t border-border px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-foreground">{label}</p>
        {sublabel && <p className="truncate text-[10px] text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
});

function IconBtn({
  children,
  onClick,
  onPointerDown,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`rounded-full bg-white/95 p-1 shadow ${danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-blue-50"}`}
    >
      {children}
    </button>
  );
}
