import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  FileText,
  Save,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { FileRow } from "@/components/FileRow";
import { PageThumb } from "@/components/PageThumb";
import { RtiSidebar } from "@/components/RtiSidebar";
import { mergeByPlan, type MergeItem, type PlanEntry } from "@/lib/pdf-merge";
import {
  renderPdfFirstThumbnail,
  renderPdfThumbnails,
} from "@/lib/pdf-thumbnails";
import {
  downloadFromPath,
  getDocument,
  loadItemFile,
  updateDocument,
  uploadEdited,
  uploadItemFile,
  type RtiDocument,
  type RtiStatus,
  type SavedPlan,
  type SavedPlanItem,
} from "@/lib/rti-storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RTI PDF Manager — Pending Queue & Editor" },
      {
        name: "description",
        content:
          "Internal RTI PDF Manager. Manage pending documents, merge PDFs and images, and track ACK workflow.",
      },
      { property: "og:title", content: "RTI PDF Manager" },
      { property: "og:description", content: "Internal RTI document workflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Status =
  | { kind: "idle" }
  | { kind: "working"; pct: number; label?: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

type TimelineEntry =
  | { id: string; type: "original-page"; pageIndex: number }
  | { id: string; type: "item"; itemId: string };

function classify(file: File): "pdf" | "image" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    /\.(jpe?g|png)$/.test(n) ||
    file.type === "image/jpeg" ||
    file.type === "image/png"
  )
    return "image";
  return null;
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/\.pdf$/i, "");
  const cleaned = trimmed.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.length ? `${cleaned}.pdf` : "";
}

function defaultFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `Merged_PDF_${ts}.pdf`;
}

const STATUS_TEXT: Record<RtiStatus, string> = {
  pending: "🔴 Pending",
  waiting_ack: "🟠 Waiting for ACK",
  completed: "🟢 Completed",
};

function nextStatus(current: RtiStatus): RtiStatus {
  if (current === "pending") return "waiting_ack";
  if (current === "waiting_ack") return "completed";
  return "completed";
}

async function saveBlobAs(blob: Blob, suggestedName: string) {
  const anyWin = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  if (anyWin.showSaveFilePicker) {
    try {
      const handle = await anyWin.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PDF file", accept: { "application/pdf": [".pdf"] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (err) {
      const e = err as { name?: string };
      if (e?.name === "AbortError") return false;
      // fall through to download fallback
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function Index() {
  const [activeDoc, setActiveDoc] = useState<RtiDocument | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [items, setItems] = useState<MergeItem[]>([]);
  const [itemPaths, setItemPaths] = useState<Record<string, string>>({});
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [originalThumbs, setOriginalThumbs] = useState<string[]>([]);
  const [itemThumbs, setItemThumbs] = useState<Record<string, string | null>>({});
  const [thumbLoading, setThumbLoading] = useState(false);
  const [finalName, setFinalName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadingDoc, setLoadingDoc] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const canGenerate = useMemo(
    () => timeline.length > 0 && status.kind !== "working" && !loadingDoc,
    [timeline, status, loadingDoc],
  );

  // Render original PDF thumbnails whenever original changes.
  useEffect(() => {
    let cancelled = false;
    if (!original) {
      setOriginalThumbs([]);
      return;
    }
    setThumbLoading(true);
    renderPdfThumbnails(original)
      .then((thumbs) => {
        if (cancelled) return;
        setOriginalThumbs(thumbs);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: `Could not read original PDF: ${(err as Error).message}`,
        });
      })
      .finally(() => {
        if (!cancelled) setThumbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [original]);

  const resetLocalState = () => {
    setOriginal(null);
    setItems([]);
    setItemPaths({});
    setTimeline([]);
    setOriginalThumbs([]);
    setItemThumbs({});
    setFinalName("");
    setStatus({ kind: "idle" });
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    objectUrlsRef.current = [];
  };

  // Open a document from the sidebar.
  const openDocument = async (doc: RtiDocument) => {
    if (activeDoc?.id === doc.id) return;
    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Loading document…" });
    resetLocalState();
    setActiveDoc(doc);
    try {
      const origFile = await downloadFromPath(doc.original_path, doc.original_name, "application/pdf");
      setOriginal(origFile);

      const plan = doc.plan_json as SavedPlan | null;
      if (plan) {
        // Restore saved items.
        const restoredItems: MergeItem[] = [];
        const nextPaths: Record<string, string> = {};
        const nextThumbs: Record<string, string | null> = {};
        for (const savedItem of plan.items) {
          const f = await loadItemFile(savedItem);
          restoredItems.push({ id: savedItem.id, name: savedItem.name, kind: savedItem.kind, file: f });
          nextPaths[savedItem.id] = savedItem.path;
          if (savedItem.kind === "image") {
            const url = URL.createObjectURL(f);
            objectUrlsRef.current.push(url);
            nextThumbs[savedItem.id] = url;
          } else {
            nextThumbs[savedItem.id] = null;
            renderPdfFirstThumbnail(f)
              .then((t) => setItemThumbs((prev) => ({ ...prev, [savedItem.id]: t })))
              .catch(() => {});
          }
        }
        setItems(restoredItems);
        setItemPaths(nextPaths);
        setItemThumbs(nextThumbs);
        setTimeline(plan.timeline);
      } else {
        // Fresh: seed timeline from original pages once they load. We do this in a
        // separate effect below based on originalThumbs.
      }
      if (doc.final_name) setFinalName(doc.final_name.replace(/\.pdf$/i, ""));
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: `Failed to load document: ${(err as Error).message}` });
    } finally {
      setLoadingDoc(false);
    }
  };

  // Seed timeline with original pages if no saved plan.
  useEffect(() => {
    if (!original || originalThumbs.length === 0) return;
    const hasOrigInTimeline = timeline.some((e) => e.type === "original-page");
    if (hasOrigInTimeline) return;
    const originals: TimelineEntry[] = originalThumbs.map((_, i) => ({
      id: `orig-${i}-${crypto.randomUUID()}`,
      type: "original-page",
      pageIndex: i,
    }));
    setTimeline((prev) => [...originals, ...prev]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalThumbs]);

  const addOriginal = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (classify(f) !== "pdf") {
      setStatus({ kind: "error", message: "Original file must be a PDF." });
      return;
    }
    // Replacing the original in the editor detaches from the active doc.
    setActiveDoc(null);
    setOriginal(f);
    setTimeline((prev) => prev.filter((e) => e.type !== "original-page"));
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
    if (next.length === 0) {
      if (rejected.length) {
        setStatus({
          kind: "error",
          message: `Skipped unsupported files: ${rejected.join(", ")}`,
        });
      }
      return;
    }

    setItems((prev) => [...prev, ...next]);
    setTimeline((prev) => [
      ...prev,
      ...next.map<TimelineEntry>((it) => ({
        id: `item-${it.id}`,
        type: "item",
        itemId: it.id,
      })),
    ]);

    for (const it of next) {
      if (it.kind === "image") {
        const url = URL.createObjectURL(it.file);
        objectUrlsRef.current.push(url);
        setItemThumbs((prev) => ({ ...prev, [it.id]: url }));
      } else {
        setItemThumbs((prev) => ({ ...prev, [it.id]: null }));
        renderPdfFirstThumbnail(it.file)
          .then((thumb) => setItemThumbs((prev) => ({ ...prev, [it.id]: thumb })))
          .catch(() => {});
      }
    }

    if (rejected.length) {
      setStatus({
        kind: "error",
        message: `Skipped unsupported files: ${rejected.join(", ")}`,
      });
    } else {
      setStatus({ kind: "idle" });
    }
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const currentId = items[index].id;
    const swapId = items[target].id;
    setItems((prev) => arrayMove(prev, index, target));
    setTimeline((prev) => {
      const a = prev.findIndex((e) => e.type === "item" && e.itemId === currentId);
      const b = prev.findIndex((e) => e.type === "item" && e.itemId === swapId);
      if (a < 0 || b < 0) return prev;
      const next = prev.slice();
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTimeline((prev) => prev.filter((e) => !(e.type === "item" && e.itemId === id)));
    setItemThumbs((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setItemPaths((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const removeOriginal = () => {
    setOriginal(null);
    setActiveDoc(null);
    setTimeline((prev) => prev.filter((e) => e.type !== "original-page"));
  };

  const onItemsDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);
    setTimeline((prev) => {
      let cursor = 0;
      return prev.map((entry) => {
        if (entry.type !== "item") return entry;
        const nextItem = newItems[cursor++];
        return nextItem ? { ...entry, id: `item-${nextItem.id}`, itemId: nextItem.id } : entry;
      });
    });
  };

  const onTimelineDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setTimeline((prev) => {
      const oldIndex = prev.findIndex((x) => x.id === active.id);
      const newIndex = prev.findIndex((x) => x.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const reset = () => {
    setActiveDoc(null);
    resetLocalState();
  };

  const itemById = useMemo(() => {
    const map = new Map<string, MergeItem>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  const resolvedFilename = useMemo(() => {
    const sanitized = sanitizeFilename(finalName);
    return sanitized || defaultFilename();
  }, [finalName]);

  const generateAndSave = async () => {
    setStatus({ kind: "working", pct: 0, label: "Merging pages…" });
    try {
      const plan: PlanEntry[] = timeline
        .map<PlanEntry | null>((entry) => {
          if (entry.type === "original-page") {
            return { kind: "original-page", pageIndex: entry.pageIndex };
          }
          const item = itemById.get(entry.itemId);
          if (!item) return null;
          return { kind: "item", item };
        })
        .filter((x): x is PlanEntry => x !== null);

      const blob = await mergeByPlan(original, plan, (pct) =>
        setStatus({ kind: "working", pct, label: "Merging pages…" }),
      );

      // Save As dialog first — the user picks the file location/name.
      const saved = await saveBlobAs(blob, resolvedFilename);
      if (!saved) {
        setStatus({ kind: "idle" });
        return;
      }

      // Persist to backend if we have an active document.
      if (activeDoc) {
        setStatus({ kind: "working", pct: 100, label: "Saving to queue…" });

        // Upload any newly-added items that have no path yet.
        const nextPaths = { ...itemPaths };
        for (const it of items) {
          if (!nextPaths[it.id]) {
            nextPaths[it.id] = await uploadItemFile(activeDoc.id, it.file, it.kind);
          }
        }
        setItemPaths(nextPaths);

        const savedItems: SavedPlanItem[] = items.map((it) => ({
          id: it.id,
          name: it.name,
          kind: it.kind,
          path: nextPaths[it.id],
        }));
        const savedPlan: SavedPlan = { items: savedItems, timeline };
        const editedPath = await uploadEdited(activeDoc.id, blob, resolvedFilename);
        const newStatus = nextStatus(activeDoc.status);
        const updated = await updateDocument(activeDoc.id, {
          plan_json: savedPlan,
          edited_path: editedPath,
          final_name: resolvedFilename,
          status: newStatus,
        });
        setActiveDoc(updated);
        setStatus({
          kind: "done",
          message: `Saved. Status: ${STATUS_TEXT[newStatus]}`,
        });
      } else {
        setStatus({ kind: "done", message: "PDF saved." });
      }
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  const statusBanner = activeDoc ? (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">{activeDoc.customer_name}</p>
        <p className="text-xs text-muted-foreground">{activeDoc.rti_type}</p>
      </div>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium shadow-sm">
        {STATUS_TEXT[activeDoc.status]}
      </span>
    </div>
  ) : null;

  return (
    <div className="flex min-h-screen bg-background">
      <RtiSidebar activeId={activeDoc?.id ?? null} onSelect={openDocument} />

      <div className="min-w-0 flex-1">
        <header className="border-b border-border bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">RTI PDF Manager</h1>
              <p className="text-xs text-muted-foreground">
                Internal tool · Merge PDFs & images · ACK workflow
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {statusBanner}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-foreground">1. Original PDF</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Loaded automatically when you open a queued document.
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
                    onClick={removeOriginal}
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onItemsDragEnd}
              >
                <SortableContext
                  items={items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {items.map((it, idx) => (
                      <FileRow
                        key={it.id}
                        item={it}
                        index={idx}
                        total={items.length}
                        onUp={() => moveItem(idx, -1)}
                        onDown={() => moveItem(idx, 1)}
                        onDelete={() => removeItem(it.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  4. Page editor ({timeline.length} page
                  {timeline.length === 1 ? "" : "s"})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Drag any thumbnail to insert uploaded files before, after, or between original pages.
                </p>
              </div>
              {thumbLoading && (
                <span className="text-xs text-muted-foreground">Loading thumbnails…</span>
              )}
            </div>

            {timeline.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Open a document from the queue or upload an original PDF to start.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onTimelineDragEnd}
              >
                <SortableContext
                  items={timeline.map((e) => e.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {timeline.map((entry, idx) => {
                      if (entry.type === "original-page") {
                        return (
                          <PageThumb
                            key={entry.id}
                            id={entry.id}
                            label={`Page ${entry.pageIndex + 1}`}
                            sublabel={`Position ${idx + 1}`}
                            thumbnail={originalThumbs[entry.pageIndex] ?? null}
                            loading={thumbLoading}
                            kind="original"
                          />
                        );
                      }
                      const item = itemById.get(entry.itemId);
                      if (!item) return null;
                      return (
                        <PageThumb
                          key={entry.id}
                          id={entry.id}
                          label={item.name}
                          sublabel={`Position ${idx + 1}`}
                          thumbnail={itemThumbs[item.id] ?? null}
                          loading={item.kind === "pdf" && itemThumbs[item.id] === null}
                          kind={item.kind}
                          onDelete={() => removeItem(item.id)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-4">
              <label
                htmlFor="final-name"
                className="mb-1 block text-sm font-semibold text-foreground"
              >
                Final PDF name
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="final-name"
                  type="text"
                  value={finalName}
                  onChange={(e) => setFinalName(e.target.value)}
                  placeholder="e.g. RTI_Response_Bundle"
                  className="flex-1 rounded-lg border border-input bg-white px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  .pdf
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Suggested filename: <span className="font-medium">{resolvedFilename}</span>
                {finalName.trim() ? "" : " (auto-generated because the field is empty)"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generateAndSave}
                disabled={!canGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.kind === "working" ? (
                  <>
                    <Sparkles className="h-4 w-4 animate-pulse" />
                    {status.label ?? "Working…"} {status.pct ? `${status.pct}%` : ""}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Generate &amp; Save
                  </>
                )}
              </button>

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
                {status.message}
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
            Merging runs in your browser · Documents & edits stored in the internal queue
          </p>
        </main>
      </div>
    </div>
  );
}
