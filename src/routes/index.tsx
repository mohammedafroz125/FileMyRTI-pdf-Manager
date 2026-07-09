import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import {
  FileText,
  Save,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Timer,
  Ban,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dropzone } from "@/components/Dropzone";
import { PageThumb } from "@/components/PageThumb";
import { RtiSidebar } from "@/components/RtiSidebar";
import { QrPhonePanel } from "@/components/QrPhonePanel";
import { mergeByPlan, type MergeItem, type PlanEntry } from "@/lib/pdf-merge";
import { renderPdfFirstThumbnail, renderPdfThumbnails } from "@/lib/pdf-thumbnails";
import {
  deleteDocumentData,
  downloadFromPath,
  getDocument,
  listMobileUploads,
  listOriginals,
  loadItemFile,
  updateDocument,
  uploadEdited,
  uploadItemFile,
  type RtiDocument,
  type RtiStatus,
  type RtiTypeSelected,
  type SavedPlan,
  type SavedPlanItem,
  type SavedTimelineEntry,
  type TextAnnotation,
} from "@/lib/rti-storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RTI PDF Manager — Pending Queue & Editor" },
      {
        name: "description",
        content:
          "Internal RTI PDF Manager. Manage pending projects, merge PDFs and images, capture ACKs from mobile.",
      },
      { property: "og:title", content: "RTI PDF Manager — Pending Queue & Editor" },
      { property: "og:description", content: "Internal RTI PDF Manager." },
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

const STATUS_TEXT: Record<RtiStatus, string> = {
  pending: "🔴 Pending",
  waiting_ack: "🟠 Waiting for ACK",
  completed: "🟢 Completed",
};

function classify(file: File): "pdf" | "image" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (/\.(jpe?g|png)$/.test(n) || file.type === "image/jpeg" || file.type === "image/png")
    return "image";
  return null;
}

function sanitizeFile(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
}

function buildFilename(customer: string, rti: RtiTypeSelected): string {
  return sanitizeFile(`${customer} (${rti}).pdf`);
}

function nextStatus(current: RtiStatus): RtiStatus {
  if (current === "pending") return "waiting_ack";
  return "completed";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function Index() {
  const [activeDoc, setActiveDoc] = useState<RtiDocument | null>(null);
  const [originals, setOriginals] = useState<{ id: string; name: string; file: File }[]>([]);
  const [originalThumbs, setOriginalThumbs] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<MergeItem[]>([]);
  const [itemPaths, setItemPaths] = useState<Record<string, string>>({});
  const [itemThumbs, setItemThumbs] = useState<Record<string, string | null>>({});
  const [timeline, setTimeline] = useState<SavedTimelineEntry[]>([]);
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [rtiType, setRtiType] = useState<RtiTypeSelected>("RTI Application");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);
  const seenMobilePathsRef = useRef<Set<string>>(new Set());
  const replaceForEntryRef = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const originalsById = useMemo(() => {
    const m = new Map<string, { name: string; file: File }>();
    for (const o of originals) m.set(o.id, { name: o.name, file: o.file });
    return m;
  }, [originals]);

  const itemById = useMemo(() => {
    const m = new Map<string, MergeItem>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const resetLocalState = () => {
    setOriginals([]);
    setOriginalThumbs({});
    setItems([]);
    setItemPaths({});
    setItemThumbs({});
    setTimeline([]);
    setAnnotations([]);
    setStatus({ kind: "idle" });
    seenMobilePathsRef.current = new Set();
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    objectUrlsRef.current = [];
  };

  const openDocument = async (doc: RtiDocument) => {
    if (activeDoc?.id === doc.id) return;
    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Loading project…" });
    resetLocalState();
    setActiveDoc(doc);
    setRtiType(doc.rti_type_selected ?? "RTI Application");
    try {
      const origRows = await listOriginals(doc.id);
      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const thumbsMap: Record<string, string[]> = {};
      for (const row of origRows) {
        const f = await downloadFromPath(row.path, row.name, "application/pdf");
        loadedOriginals.push({ id: row.id, name: row.name, file: f });
        try {
          thumbsMap[row.id] = await renderPdfThumbnails(f);
        } catch {
          thumbsMap[row.id] = [];
        }
      }
      setOriginals(loadedOriginals);
      setOriginalThumbs(thumbsMap);

      const plan = doc.plan_json as SavedPlan | null;
      if (plan) {
        const restoredItems: MergeItem[] = [];
        const nextPaths: Record<string, string> = {};
        const nextThumbs: Record<string, string | null> = {};
        for (const savedItem of plan.items) {
          try {
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
          } catch (e) {
            console.error("Skipping missing item", savedItem, e);
          }
        }
        setItems(restoredItems);
        setItemPaths(nextPaths);
        setItemThumbs(nextThumbs);
        setTimeline(plan.timeline);
        setAnnotations(plan.annotations ?? []);
      } else {
        // Seed timeline from originals' pages in order.
        const t: SavedTimelineEntry[] = [];
        for (const o of loadedOriginals) {
          const count = thumbsMap[o.id]?.length ?? 0;
          for (let i = 0; i < count; i++) {
            t.push({
              id: `orig-${o.id}-${i}-${crypto.randomUUID()}`,
              type: "original-page",
              originalId: o.id,
              pageIndex: i,
            });
          }
        }
        setTimeline(t);
      }

      // Seed mobile-seen set with current uploads so only new ones auto-add.
      try {
        const existing = await listMobileUploads(doc.id);
        for (const m of existing) seenMobilePathsRef.current.add(m.path);
      } catch {
        /* ignore */
      }

      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: `Failed to load project: ${(err as Error).message}` });
    } finally {
      setLoadingDoc(false);
    }
  };

  // Poll mobile uploads for the active project (light polling every 4s).
  useEffect(() => {
    if (!activeDoc) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listMobileUploads(activeDoc.id);
        const fresh = list.filter((m) => !seenMobilePathsRef.current.has(m.path));
        if (fresh.length && !cancelled) {
          for (const m of fresh) seenMobilePathsRef.current.add(m.path);
          for (const m of fresh) {
            const lower = m.name.toLowerCase();
            const isPdf = lower.endsWith(".pdf");
            const kind: "pdf" | "image" = isPdf ? "pdf" : "image";
            const mime = isPdf
              ? "application/pdf"
              : lower.endsWith(".png")
                ? "image/png"
                : "image/jpeg";
            const file = await downloadFromPath(m.path, m.name, mime);
            const it: MergeItem = { id: `mobile-${crypto.randomUUID()}`, name: m.name, kind, file };
            setItems((prev) => [...prev, it]);
            setItemPaths((prev) => ({ ...prev, [it.id]: m.path }));
            setTimeline((prev) => [
              ...prev,
              { id: `entry-${crypto.randomUUID()}`, type: "item", itemId: it.id },
            ]);
            if (kind === "image") {
              const url = URL.createObjectURL(file);
              objectUrlsRef.current.push(url);
              setItemThumbs((prev) => ({ ...prev, [it.id]: url }));
            } else {
              setItemThumbs((prev) => ({ ...prev, [it.id]: null }));
              renderPdfFirstThumbnail(file)
                .then((t) => setItemThumbs((prev) => ({ ...prev, [it.id]: t })))
                .catch(() => {});
            }
          }
        }
      } catch {
        /* ignore */
      }
    };
    const iv = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [activeDoc]);

  // Live-updated status via realtime
  useEffect(() => {
    if (!activeDoc) return;
    const channel = supabase
      .channel(`rti_doc_${activeDoc.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rti_documents", filter: `id=eq.${activeDoc.id}` },
        (payload) => {
          setActiveDoc(payload.new as RtiDocument);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeDoc?.id]);

  const addFiles = (files: File[]) => {
    const next: MergeItem[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      const kind = classify(f);
      if (!kind) {
        rejected.push(f.name);
        continue;
      }
      next.push({ id: `${f.name}-${f.size}-${crypto.randomUUID()}`, name: f.name, kind, file: f });
    }
    if (!next.length) {
      if (rejected.length) setStatus({ kind: "error", message: `Skipped: ${rejected.join(", ")}` });
      return;
    }
    setItems((prev) => [...prev, ...next]);
    setTimeline((prev) => [
      ...prev,
      ...next.map<SavedTimelineEntry>((it) => ({
        id: `entry-${crypto.randomUUID()}`,
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
          .then((t) => setItemThumbs((prev) => ({ ...prev, [it.id]: t })))
          .catch(() => {});
      }
    }
    setStatus({ kind: "idle" });
  };

  const removeEntry = (entryId: string) => {
    setTimeline((prev) => prev.filter((e) => e.id !== entryId));
    setAnnotations((prev) => prev.filter((a) => a.entryId !== entryId));
  };

  const rotateEntry = (entryId: string) => {
    setTimeline((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, rotation: ((e.rotation ?? 0) + 90) % 360 } : e)),
    );
  };

  const startReplace = (entryId: string) => {
    replaceForEntryRef.current = entryId;
    replaceInputRef.current?.click();
  };

  const onReplaceFilePicked = async (fs: FileList | null) => {
    const targetId = replaceForEntryRef.current;
    replaceForEntryRef.current = null;
    if (!fs || !fs[0] || !targetId) return;
    const f = fs[0];
    const kind = classify(f);
    if (!kind) return;
    const it: MergeItem = { id: `${f.name}-${f.size}-${crypto.randomUUID()}`, name: f.name, kind, file: f };
    setItems((prev) => [...prev, it]);
    if (kind === "image") {
      const url = URL.createObjectURL(f);
      objectUrlsRef.current.push(url);
      setItemThumbs((prev) => ({ ...prev, [it.id]: url }));
    } else {
      setItemThumbs((prev) => ({ ...prev, [it.id]: null }));
      renderPdfFirstThumbnail(f)
        .then((t) => setItemThumbs((prev) => ({ ...prev, [it.id]: t })))
        .catch(() => {});
    }
    setTimeline((prev) =>
      prev.map((e) =>
        e.id === targetId ? { id: e.id, type: "item", itemId: it.id, rotation: 0 } : e,
      ),
    );
    setAnnotations((prev) => prev.filter((a) => a.entryId !== targetId));
  };

  const addTextAnnotation = (entryId: string) => {
    const a: TextAnnotation = {
      id: crypto.randomUUID(),
      entryId,
      x: 0.1,
      y: 0.1,
      widthFrac: 0.4,
      fontSize: 14,
      text: "New text",
    };
    setAnnotations((prev) => [...prev, a]);
  };

  const updateAnnotation = (id: string, patch: Partial<TextAnnotation>) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };
  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
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

  const openSaveDialog = () => setSaveOpen(true);

  const confirmSave = async (chosen: RtiTypeSelected) => {
    setSaveOpen(false);
    setRtiType(chosen);
    if (!activeDoc) return;
    setStatus({ kind: "working", pct: 0, label: "Merging pages…" });
    try {
      const originalFiles: Record<string, File> = {};
      for (const o of originals) originalFiles[o.id] = o.file;

      const plan: PlanEntry[] = timeline
        .map<PlanEntry | null>((entry) => {
          if (entry.type === "original-page") {
            if (!originalFiles[entry.originalId]) return null;
            return {
              entryId: entry.id,
              kind: "original-page",
              originalId: entry.originalId,
              pageIndex: entry.pageIndex,
              rotation: entry.rotation,
            };
          }
          const item = itemById.get(entry.itemId);
          if (!item) return null;
          return { entryId: entry.id, kind: "item", item, rotation: entry.rotation };
        })
        .filter((x): x is PlanEntry => x !== null);

      const blob = await mergeByPlan(originalFiles, plan, annotations, (pct) =>
        setStatus({ kind: "working", pct, label: "Merging pages…" }),
      );

      const filename = buildFilename(activeDoc.customer_name, chosen);
      downloadBlob(blob, filename);

      setStatus({ kind: "working", pct: 100, label: "Saving to queue…" });
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
      const savedPlan: SavedPlan = { items: savedItems, timeline, annotations };
      const editedPath = await uploadEdited(activeDoc.id, blob, filename);
      const newStatus = nextStatus(activeDoc.status);
      const patch: Parameters<typeof updateDocument>[1] = {
        plan_json: savedPlan,
        edited_path: editedPath,
        final_name: filename,
        status: newStatus,
        rti_type_selected: chosen,
      };
      if (newStatus === "completed") {
        patch.deletion_scheduled_at = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      }
      const updated = await updateDocument(activeDoc.id, patch);
      setActiveDoc(updated);
      setStatus({ kind: "done", message: `Saved. Status: ${STATUS_TEXT[newStatus]}` });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const cancelAutoDelete = async () => {
    if (!activeDoc) return;
    const updated = await updateDocument(activeDoc.id, { deletion_scheduled_at: null });
    setActiveDoc(updated);
  };

  const deleteNow = async () => {
    if (!activeDoc) return;
    if (!confirm("Delete project data now? Saved PDFs on disk are kept.")) return;
    await deleteDocumentData(activeDoc.id);
    setActiveDoc(null);
    resetLocalState();
  };

  const canGenerate = timeline.length > 0 && status.kind !== "working" && !loadingDoc && !!activeDoc;

  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <RtiSidebar activeId={activeDoc?.id ?? null} onSelect={openDocument} />

      <input
        ref={replaceInputRef}
        type="file"
        accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          onReplaceFilePicked(e.target.files);
          e.target.value = "";
        }}
      />

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
          {!activeDoc ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center">
              <p className="text-sm font-medium text-foreground">No project open</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a project from the queue on the left, or add one via <b>Admin Upload</b>.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{activeDoc.customer_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {originals.length} original PDF{originals.length === 1 ? "" : "s"} ·{" "}
                    {activeDoc.rti_type_selected ?? "RTI type not chosen yet"}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium shadow-sm">
                  {STATUS_TEXT[activeDoc.status]}
                </span>
              </div>

              {activeDoc.status === "completed" && activeDoc.deletion_scheduled_at && (
                <AutoDeleteBanner
                  scheduledAt={activeDoc.deletion_scheduled_at}
                  onCancel={cancelAutoDelete}
                  onDeleteNow={deleteNow}
                />
              )}

              <div className="mb-6">
                <QrPhonePanel docId={activeDoc.id} />
              </div>

              <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold text-foreground">Add more files</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Add PDFs or images (JPG, PNG). Drag thumbnails below to reorder / interleave.
                </p>
                <Dropzone
                  label="Drop files here or click to browse"
                  hint="Multiple .pdf, .jpg, .jpeg, .png"
                  multiple
                  accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
                  onFiles={addFiles}
                />
              </section>

              <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Page editor ({timeline.length} page{timeline.length === 1 ? "" : "s"})
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Drag to reorder · Hover a page for rotate, replace, add text, delete.
                    </p>
                  </div>
                </div>

                {timeline.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                    No pages yet.
                  </p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onTimelineDragEnd}
                  >
                    <SortableContext items={timeline.map((e) => e.id)} strategy={rectSortingStrategy}>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {timeline.map((entry, idx) => {
                          const anns = annotations.filter((a) => a.entryId === entry.id);
                          if (entry.type === "original-page") {
                            const orig = originalsById.get(entry.originalId);
                            const thumbs = originalThumbs[entry.originalId] ?? [];
                            return (
                              <div key={entry.id} className="relative">
                                <PageThumb
                                  id={entry.id}
                                  label={orig?.name ?? "Original"}
                                  sublabel={`P.${entry.pageIndex + 1} · #${idx + 1}`}
                                  thumbnail={thumbs[entry.pageIndex] ?? null}
                                  rotation={entry.rotation}
                                  kind="original"
                                  onDelete={() => removeEntry(entry.id)}
                                  onRotate={() => rotateEntry(entry.id)}
                                  onReplace={() => startReplace(entry.id)}
                                  onAddText={() => addTextAnnotation(entry.id)}
                                />
                                <AnnotationBadge count={anns.length} />
                              </div>
                            );
                          }
                          const item = itemById.get(entry.itemId);
                          if (!item) return null;
                          return (
                            <div key={entry.id} className="relative">
                              <PageThumb
                                id={entry.id}
                                label={item.name}
                                sublabel={`#${idx + 1}`}
                                thumbnail={itemThumbs[item.id] ?? null}
                                loading={item.kind === "pdf" && itemThumbs[item.id] === null}
                                rotation={entry.rotation}
                                kind={item.kind}
                                onDelete={() => removeEntry(entry.id)}
                                onRotate={() => rotateEntry(entry.id)}
                                onReplace={() => startReplace(entry.id)}
                                onAddText={() => addTextAnnotation(entry.id)}
                              />
                              <AnnotationBadge count={anns.length} />
                            </div>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </section>

              {annotations.length > 0 && (
                <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">Text annotations</h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Editable overlays for IPO Number, Speed Post Number, Date, Reference Number, notes.
                    Text is flattened into the PDF on Save.
                  </p>
                  <div className="flex flex-col gap-2">
                    {annotations.map((a) => (
                      <div key={a.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-slate-50/40 p-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                        <input
                          type="text"
                          value={a.text}
                          onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                          className="rounded border border-input bg-white px-2 py-1 text-sm"
                          placeholder="Text content"
                        />
                        <input
                          type="number"
                          min={6}
                          max={72}
                          value={a.fontSize}
                          onChange={(e) => updateAnnotation(a.id, { fontSize: Number(e.target.value) })}
                          className="w-20 rounded border border-input bg-white px-2 py-1 text-sm"
                          title="Font size"
                        />
                        <PositionInput label="X%" value={a.x} onChange={(v) => updateAnnotation(a.id, { x: v })} />
                        <PositionInput label="Y%" value={a.y} onChange={(v) => updateAnnotation(a.id, { y: v })} />
                        <button
                          type="button"
                          onClick={() => deleteAnnotation(a.id)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={openSaveDialog}
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
                </div>

                {status.kind === "working" && (
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${status.pct}%` }} />
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
                Merging runs in your browser · Projects & edits stored in the internal queue
              </p>
            </>
          )}
        </main>
      </div>

      {saveOpen && activeDoc && (
        <SaveDialog
          defaultType={rtiType}
          customerName={activeDoc.customer_name}
          onCancel={() => setSaveOpen(false)}
          onConfirm={confirmSave}
        />
      )}
    </div>
  );
}

function PositionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
        className="w-16 rounded border border-input bg-white px-1.5 py-1 text-sm text-foreground"
      />
    </label>
  );
}

function AnnotationBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
      T·{count}
    </span>
  );
}

function AutoDeleteBanner({
  scheduledAt,
  onCancel,
  onDeleteNow,
}: {
  scheduledAt: string;
  onCancel: () => void;
  onDeleteNow: () => void;
}) {
  const remaining = useCountdown(scheduledAt);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <Timer className="h-5 w-5 text-amber-700" />
      <div className="flex-1 text-sm text-amber-900">
        Auto-delete in <b>{remaining}</b>. Only project data & temp files are removed — your saved
        PDF is untouched.
      </div>
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        <Ban className="h-3.5 w-3.5" /> Cancel auto-delete
      </button>
      <button
        onClick={onDeleteNow}
        className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete now
      </button>
    </div>
  );
}

function useCountdown(target: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const diff = Math.max(0, new Date(target).getTime() - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function SaveDialog({
  defaultType,
  customerName,
  onCancel,
  onConfirm,
}: {
  defaultType: RtiTypeSelected;
  customerName: string;
  onCancel: () => void;
  onConfirm: (t: RtiTypeSelected) => void;
}) {
  const [type, setType] = useState<RtiTypeSelected>(defaultType);
  const filename = buildFilename(customerName, type);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-lg">
        <h3 className="text-base font-semibold text-foreground">Save PDF</h3>
        <p className="mt-1 text-xs text-muted-foreground">Choose the RTI Type. The filename is generated automatically.</p>
        <label className="mt-4 block text-sm font-medium text-foreground">RTI Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as RtiTypeSelected)}
          className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="RTI Application">RTI Application</option>
          <option value="First Appeal">First Appeal</option>
        </select>
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
          Filename: <span className="font-medium text-foreground">{filename}</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(type)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Generate &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Suppress unused imports warning for getDocument (kept for future use).
void getDocument;
