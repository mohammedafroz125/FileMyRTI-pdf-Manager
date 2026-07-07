import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FileText, Download, RotateCcw, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { FileRow } from "@/components/FileRow";
import { mergeFiles, type MergeItem } from "@/lib/pdf-merge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PDF Manager — Merge PDFs & Images" },
      {
        name: "description",
        content:
          "Internal PDF Manager. Merge an original PDF with additional PDFs and images (JPG, PNG) in any order. Free, private, no watermark.",
      },
      { property: "og:title", content: "PDF Manager" },
      {
        property: "og:description",
        content: "Merge PDFs and images into a single PDF. Free, private, no watermark.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Status =
  | { kind: "idle" }
  | { kind: "working"; pct: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

function classify(file: File): "pdf" | "image" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (/\.(jpe?g|png)$/.test(n) || file.type === "image/jpeg" || file.type === "image/png")
    return "image";
  return null;
}

function Index() {
  const [original, setOriginal] = useState<File | null>(null);
  const [items, setItems] = useState<MergeItem[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const canGenerate = useMemo(
    () => (original || items.length > 0) && status.kind !== "working",
    [original, items, status],
  );

  const addOriginal = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (classify(f) !== "pdf") {
      setStatus({ kind: "error", message: "Original file must be a PDF." });
      return;
    }
    setOriginal(f);
    setStatus({ kind: "idle" });
  };

  const addFiles = (files: File[]) => {
    const next: MergeItem[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      const kind = classify(f);
      if (!kind) {
        rejected.push(f.name);
        continue;
      }
      next.push({
        id: `${f.name}-${f.size}-${crypto.randomUUID()}`,
        name: f.name,
        kind,
        file: f,
      });
    }
    setItems((prev) => [...prev, ...next]);
    if (rejected.length) {
      setStatus({
        kind: "error",
        message: `Skipped unsupported files: ${rejected.join(", ")}`,
      });
    } else {
      setStatus({ kind: "idle" });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      return arrayMove(prev, index, target);
    });
  };

  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const reset = () => {
    setOriginal(null);
    setItems([]);
    setStatus({ kind: "idle" });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
  };

  const generate = async () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setStatus({ kind: "working", pct: 0 });
    try {
      const blob = await mergeFiles(original, items, (pct) =>
        setStatus({ kind: "working", pct }),
      );
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus({ kind: "done" });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">PDF Manager</h1>
            <p className="text-xs text-muted-foreground">Internal tool · Merge PDFs & images</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-foreground">1. Original PDF</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              This PDF will always be the first document in the output.
            </p>
            <Dropzone
              label={original ? "Replace original PDF" : "Drop original PDF here"}
              hint="Accepts a single .pdf file"
              accept="application/pdf,.pdf"
              onFiles={addOriginal}
            />
            {original && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                <FileText className="h-4 w-4" />
                <span className="truncate">{original.name}</span>
                <button
                  type="button"
                  onClick={() => setOriginal(null)}
                  className="ml-auto text-xs font-medium text-blue-700 hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-foreground">2. Additional files</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Add more PDFs or images (JPG, JPEG, PNG). Images become PDF pages.
            </p>
            <Dropzone
              label="Drop files here or click to browse"
              hint="Multiple .pdf, .jpg, .jpeg, .png"
              multiple
              accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
              onFiles={addFiles}
            />
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              3. Order ({items.length + (original ? 1 : 0)} item
              {items.length + (original ? 1 : 0) === 1 ? "" : "s"})
            </h2>
            <p className="text-xs text-muted-foreground">Drag to reorder</p>
          </div>

          {original && (
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2.5">
              <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                Original
              </span>
              <FileText className="h-4 w-4 text-blue-700" />
              <p className="truncate text-sm font-medium text-foreground">{original.name}</p>
            </div>
          )}

          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No additional files yet.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {items.map((it, idx) => (
                    <FileRow
                      key={it.id}
                      item={it}
                      index={idx}
                      total={items.length}
                      onUp={() => move(idx, -1)}
                      onDown={() => move(idx, 1)}
                      onDelete={() => remove(it.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {status.kind === "working" ? `Generating… ${status.pct}%` : "Generate Final PDF"}
            </button>

            {downloadUrl && (
              <a
                href={downloadUrl}
                download="merged.pdf"
                className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
              >
                <Download className="h-4 w-4" />
                Download Final PDF
              </a>
            )}

            <button
              type="button"
              onClick={reset}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>

          {status.kind === "working" && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${status.pct}%` }}
              />
            </div>
          )}

          {status.kind === "done" && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              Merged successfully. Click Download to save your PDF.
            </div>
          )}

          {status.kind === "error" && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4" />
              {status.message}
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Runs entirely in your browser · No files uploaded to any server · No watermark
        </p>
      </main>
    </div>
  );
}
