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
  Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dropzone } from "@/components/Dropzone";
import { PageThumb } from "@/components/PageThumb";
import { RtiSidebar } from "@/components/RtiSidebar";
import { QrPhonePanel } from "@/components/QrPhonePanel";
import { mergeByPlan, type MergeItem, type PlanEntry } from "@/lib/pdf-merge";
import { getPdfPageCount, renderPdfPage, evictPdfDoc } from "@/lib/pdf-thumbnails";
import {
  deleteDocumentData,
  downloadFromPath,
  listMobileUploads,
  listOriginals,
  loadItemFile,
  updateDocument,
  uploadEdited,
  uploadItemFile,
  type RtiDocument,
  type RtiStatus,
  type SavedPlan,
  type SavedPlanItem,
  type SavedTimelineEntry,
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
  waiting_ack: "🔴 Pending",
  completed: "🟢 Successful",
};

const MANUAL_PROJECT_ID = "manual-edit";

type ProjectCacheEntry = {
  activeDoc: RtiDocument;
  originals: { id: string; name: string; file: File }[];
  originalThumbs: Record<string, string[]>;
  originalPageCounts: Record<string, number>;
  items: MergeItem[];
  itemPaths: Record<string, string>;
  itemThumbs: Record<string, string[]>;
  itemPageCounts: Record<string, number>;
  timeline: SavedTimelineEntry[];
  pdfName: string;
  seenMobilePaths: string[];
};

function classify(file: File): "pdf" | "image" | "word" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(n) || file.type.startsWith("image/")) return "image";
  if (/\.(docx?)$/.test(n) || file.type.includes("word") || file.type.includes("msword"))
    return "word";
  return null;
}

function sanitizeFile(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
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

async function savePdfBlob(blob: Blob, filename: string): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (typeof picker !== "function") {
    downloadBlob(blob, filename);
    return true;
  }
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return false;
    downloadBlob(blob, filename);
    return true;
  }
}

async function fileToPdf(file: File): Promise<File | null> {
  const kind = classify(file);
  if (kind === "pdf") return file;
  if (kind === "word") {
    try {
      const { convertWordToPdfBlob } = await import("@/lib/word-to-pdf");
      const blob = await convertWordToPdfBlob(file);
      return new File([blob], file.name.replace(/\.docx?$/i, ".pdf"), {
        type: "application/pdf",
      });
    } catch (e) {
      console.error("Word conversion failed", e);
      return null;
    }
  }
  if (kind === "image") {
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((r) => { img.onload = r; });
      const imgProps = pdf.getImageProperties(img);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(img, "JPEG", 0, 0, pdfWidth, pdfHeight);
      URL.revokeObjectURL(url);
      return new File([pdf.output("blob")], file.name + ".pdf", { type: "application/pdf" });
    } catch (e) {
      console.error("Image conversion failed", e);
      return null;
    }
  }
  return null;
}

function defaultPdfNameForDoc(doc: RtiDocument): string {
  if (doc.final_name) return doc.final_name.replace(/\.pdf$/i, "");
  return doc.original_name.replace(/\.pdf$/i, "");
}

function Index() {
  const [activeDoc, setActiveDoc] = useState<RtiDocument | null>(null);
  const [originals, setOriginals] = useState<{ id: string; name: string; file: File }[]>([]);
  const [originalThumbs, setOriginalThumbs] = useState<Record<string, string[]>>({});
  const [originalPageCounts, setOriginalPageCounts] = useState<Record<string, number>>({});
  const [items, setItems] = useState<MergeItem[]>([]);
  const [itemPaths, setItemPaths] = useState<Record<string, string>>({});
  const [itemThumbs, setItemThumbs] = useState<Record<string, string[]>>({});
  const [itemPageCounts, setItemPageCounts] = useState<Record<string, number>>({});
  const [timeline, setTimeline] = useState<SavedTimelineEntry[]>([]);
  const [pdfName, setPdfName] = useState<string>("");
  const [pageRange, setPageRange] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadingDoc, setLoadingDoc] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);
  const seenMobilePathsRef = useRef<Set<string>>(new Set());
  const projectCacheRef = useRef<Record<string, ProjectCacheEntry>>({});
  const replaceForEntryRef = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const persistTimerRef = useRef<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const manualSessionIdRef = useRef<string>(crypto.randomUUID());

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

  const isManualProject = activeDoc?.id === MANUAL_PROJECT_ID;

  const cacheCurrentProject = () => {
    if (!activeDoc || activeDoc.id === MANUAL_PROJECT_ID || loadingDoc) return;
    projectCacheRef.current[activeDoc.id] = {
      activeDoc,
      originals,
      originalThumbs,
      originalPageCounts,
      items,
      itemPaths,
      itemThumbs,
      itemPageCounts,
      timeline,
      pdfName,
      seenMobilePaths: Array.from(seenMobilePathsRef.current),
    };
  };

  const restoreCachedProject = (cached: ProjectCacheEntry) => {
    setActiveDoc(cached.activeDoc);
    setOriginals(cached.originals);
    setOriginalThumbs(cached.originalThumbs);
    setOriginalPageCounts(cached.originalPageCounts);
    setItems(cached.items);
    setItemPaths(cached.itemPaths);
    setItemThumbs(cached.itemThumbs);
    setItemPageCounts(cached.itemPageCounts);
    setTimeline(cached.timeline);
    setPdfName(cached.pdfName);
    seenMobilePathsRef.current = new Set(cached.seenMobilePaths);
    setStatus({ kind: "idle" });
  };

  const resetLocalState = () => {
    setOriginals([]);
    setOriginalThumbs({});
    setOriginalPageCounts({});
    setItems([]);
    setItemPaths({});
    setItemThumbs({});
    setItemPageCounts({});
    setTimeline([]);
    setPdfName("");
    setPageRange("");
    setStatus({ kind: "idle" });
    seenMobilePathsRef.current = new Set();
  };

  // Lazy thumbnail resolver — renders and caches a single page on demand.
  const getOriginalThumb = (originalId: string, pageIndex: number) => async (): Promise<string | null> => {
    const cached = originalThumbs[originalId]?.[pageIndex];
    if (cached) return cached;
    const orig = originalsById.get(originalId);
    if (!orig) return null;
    const url = await renderPdfPage(`orig-${originalId}`, orig.file, pageIndex);
    if (url) {
      setOriginalThumbs((prev) => {
        const arr = prev[originalId] ? [...prev[originalId]] : [];
        arr[pageIndex] = url;
        return { ...prev, [originalId]: arr };
      });
    }
    return url;
  };

  const getItemThumb = (itemId: string, pageIndex: number) => async (): Promise<string | null> => {
    const cached = itemThumbs[itemId]?.[pageIndex];
    if (cached) return cached;
    const it = itemById.get(itemId);
    if (!it || it.kind !== "pdf") return null;
    const url = await renderPdfPage(`item-${itemId}`, it.file, pageIndex);
    if (url) {
      setItemThumbs((prev) => {
        const arr = prev[itemId] ? [...prev[itemId]] : [];
        arr[pageIndex] = url;
        return { ...prev, [itemId]: arr };
      });
    }
    return url;
  };

  // ---------- Add PDF/image item helper (expands PDF into per-page timeline entries) ----------
  const registerItem = async (
    file: File,
    kind: "pdf" | "image",
    opts?: { append?: boolean; replaceEntryId?: string },
  ): Promise<void> => {
    const it: MergeItem = {
      id: `item-${crypto.randomUUID()}`,
      name: file.name,
      kind,
      file,
    };
    setItems((prev) => [...prev, it]);

    if (kind === "image") {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      setItemThumbs((prev) => ({ ...prev, [it.id]: [url] }));
      setItemPageCounts((prev) => ({ ...prev, [it.id]: 1 }));
      const entry: SavedTimelineEntry = {
        id: `entry-${crypto.randomUUID()}`,
        type: "item",
        itemId: it.id,
        pageIndex: 0,
      };
      if (opts?.replaceEntryId) {
        setTimeline((prev) =>
          prev.map((e) => (e.id === opts.replaceEntryId ? { ...entry, id: e.id } : e)),
        );
      } else {
        setTimeline((prev) => [...prev, entry]);
      }
      return;
    }

    // PDF item: fetch page count only; thumbnails render lazily per page.
    let pageCount = 1;
    try {
      pageCount = await getPdfPageCount(`item-${it.id}`, file);
    } catch (e) {
      console.error("PDF page-count failed", e);
    }
    setItemPageCounts((prev) => ({ ...prev, [it.id]: pageCount }));

    const newEntries: SavedTimelineEntry[] = Array.from({ length: pageCount }, (_, i) => ({
      id: `entry-${crypto.randomUUID()}`,
      type: "item",
      itemId: it.id,
      pageIndex: i,
    }));

    if (opts?.replaceEntryId) {
      setTimeline((prev) => {
        const idx = prev.findIndex((e) => e.id === opts.replaceEntryId);
        if (idx < 0) return [...prev, ...newEntries];
        const copy = [...prev];
        copy.splice(idx, 1, ...newEntries);
        return copy;
      });
    } else {
      setTimeline((prev) => [...prev, ...newEntries]);
    }
  };

  const openDocument = async (doc: RtiDocument) => {
    if (activeDoc?.id === doc.id) return;
    cacheCurrentProject();
    const cached = projectCacheRef.current[doc.id];
    if (cached) {
      setLoadingDoc(true);
      resetLocalState();
      restoreCachedProject(cached);
      setLoadingDoc(false);
      return;
    }

    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Loading project…" });
    resetLocalState();
    setActiveDoc(doc);
    setPdfName(defaultPdfNameForDoc(doc));
    try {
      const origRows = await listOriginals(doc.id);
      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const origCounts: Record<string, number> = {};
      for (const row of origRows) {
        const f = await downloadFromPath(row.path, row.name, "application/pdf");
        loadedOriginals.push({ id: row.id, name: row.name, file: f });
        try {
          origCounts[row.id] = await getPdfPageCount(`orig-${row.id}`, f);
        } catch {
          origCounts[row.id] = 0;
        }
      }
      setOriginals(loadedOriginals);
      setOriginalPageCounts(origCounts);

      const plan = doc.plan_json as SavedPlan | null;
      if (plan) {
        const restoredItems: MergeItem[] = [];
        const nextPaths: Record<string, string> = {};
        const nextThumbs: Record<string, string[]> = {};
        const nextCounts: Record<string, number> = {};
        for (const savedItem of plan.items) {
          try {
            const f = await loadItemFile(savedItem);
            restoredItems.push({ id: savedItem.id, name: savedItem.name, kind: savedItem.kind, file: f });
            nextPaths[savedItem.id] = savedItem.path;
            if (savedItem.kind === "image") {
              const url = URL.createObjectURL(f);
              objectUrlsRef.current.push(url);
              nextThumbs[savedItem.id] = [url];
              nextCounts[savedItem.id] = 1;
            } else {
              try {
                nextCounts[savedItem.id] = await getPdfPageCount(`item-${savedItem.id}`, f);
              } catch {
                nextCounts[savedItem.id] = 1;
              }
            }
          } catch (e) {
            console.error("Skipping missing item", savedItem, e);
          }
        }
        setItems(restoredItems);
        setItemPaths(nextPaths);
        setItemThumbs(nextThumbs);
        setItemPageCounts(nextCounts);

        // Migrate legacy timeline entries (no pageIndex on item) → expand to all pages
        const migrated: SavedTimelineEntry[] = [];
        for (const e of plan.timeline) {
          if (e.type === "item") {
            const count = nextCounts[e.itemId] ?? 1;
            if (e.pageIndex === undefined && count > 1) {
              for (let i = 0; i < count; i++) {
                migrated.push({
                  id: `entry-${crypto.randomUUID()}`,
                  type: "item",
                  itemId: e.itemId,
                  pageIndex: i,
                  rotation: e.rotation,
                });
              }
            } else {
              migrated.push({ ...e, pageIndex: e.pageIndex ?? 0 });
            }
          } else {
            migrated.push(e);
          }
        }
        setTimeline(migrated);
      } else {
        const t: SavedTimelineEntry[] = [];
        for (const o of loadedOriginals) {
          const count = origCounts[o.id] ?? 0;
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

  const openManualProject = async (files: File[]) => {
    if (activeDoc?.id === MANUAL_PROJECT_ID && files.length === 0) {
      // already open, just re-focus
      return;
    }
    if (activeDoc?.id === MANUAL_PROJECT_ID) {
      if (!confirm("Discard current Manual Edit?")) return;
    }

    manualSessionIdRef.current = crypto.randomUUID();

    resetLocalState();
    const initialName = files[0]?.name?.replace(/\.pdf$/i, "") ?? "";
    const manualDoc: RtiDocument = {
      id: MANUAL_PROJECT_ID,
      customer_name: "Manual Edit",
      rti_type: "RTI",
      status: "pending",
      original_path: "",
      original_name: files[0]?.name ?? "manual-edit.pdf",
      edited_path: null,
      final_name: null,
      plan_json: null,
      rti_type_selected: null,
      deletion_scheduled_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setActiveDoc(manualDoc);
    setPdfName(initialName);

    if (files.length === 0) return;

    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Processing files…" });
    try {
      const pdfs: File[] = [];
      for (const f of files) {
        const p = await fileToPdf(f);
        if (p) pdfs.push(p);
      }
      if (!pdfs.length) {
        setStatus({ kind: "error", message: "No supported files found." });
        return;
      }
      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const countsMap: Record<string, number> = {};
      for (const file of pdfs) {
        const id = `manual-${crypto.randomUUID()}`;
        loadedOriginals.push({ id, name: file.name, file });
        try {
          countsMap[id] = await getPdfPageCount(`orig-${id}`, file);
        } catch {
          countsMap[id] = 0;
        }
      }
      const timelineEntries: SavedTimelineEntry[] = [];
      for (const o of loadedOriginals) {
        const count = countsMap[o.id] ?? 0;
        for (let i = 0; i < count; i++) {
          timelineEntries.push({
            id: `manual-orig-${o.id}-${i}-${crypto.randomUUID()}`,
            type: "original-page",
            originalId: o.id,
            pageIndex: i,
          });
        }
      }
      setOriginals(loadedOriginals);
      setOriginalPageCounts(countsMap);
      setTimeline(timelineEntries);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: `Failed: ${(err as Error).message}` });
    } finally {
      setLoadingDoc(false);
    }
  };

  // Poll mobile uploads for the active DB project.
  useEffect(() => {
    if (!activeDoc || activeDoc.id === MANUAL_PROJECT_ID) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listMobileUploads(activeDoc.id);
        const fresh = list.filter((m) => !seenMobilePathsRef.current.has(m.path));
        if (!fresh.length || cancelled) return;
        for (const m of fresh) seenMobilePathsRef.current.add(m.path);
        for (const m of fresh) {
          const lower = m.name.toLowerCase();
          const isDoc = lower.endsWith(".doc") || lower.endsWith(".docx");
          const isPdf = lower.endsWith(".pdf");
          const mime = isPdf
            ? "application/pdf"
            : isDoc
              ? (lower.endsWith(".docx")
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/msword")
              : lower.endsWith(".png")
                ? "image/png"
                : "image/jpeg";
          const raw = await downloadFromPath(m.path, m.name, mime);
          let file: File = raw;
          let kind: "pdf" | "image" = isPdf || isDoc ? "pdf" : "image";
          if (isDoc) {
            const conv = await fileToPdf(raw);
            if (!conv) continue;
            file = conv;
            kind = "pdf";
          }
          if (cancelled) return;
          await registerItem(file, kind);
        }
      } catch {
        /* ignore */
      }
    };
    const channel = supabase
      .channel(`rti_mobile_tokens_${activeDoc.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rti_mobile_tokens", filter: `document_id=eq.${activeDoc.id}` },
        () => { void tick(); },
      )
      .subscribe();
    const iv = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.id]);

  // Poll mobile uploads for Manual Edit session (uses manualSessionIdRef).
  useEffect(() => {
    if (!isManualProject) return;
    const sessionId = manualSessionIdRef.current;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await supabase.storage
          .from("rti-files")
          .list(`${sessionId}/items`, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
        if (!data || cancelled) return;
        const fresh = data.filter(
          (f) => f.name.includes("-mobile-") && !seenMobilePathsRef.current.has(`${sessionId}/items/${f.name}`),
        );
        for (const f of fresh) {
          const path = `${sessionId}/items/${f.name}`;
          seenMobilePathsRef.current.add(path);
          const lower = f.name.toLowerCase();
          const isDoc = lower.endsWith(".doc") || lower.endsWith(".docx");
          const isPdf = lower.endsWith(".pdf");
          const mime = isPdf
            ? "application/pdf"
            : isDoc
              ? (lower.endsWith(".docx")
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/msword")
              : lower.endsWith(".png")
                ? "image/png"
                : "image/jpeg";
          const cleanName = f.name.replace(/^[a-f0-9-]+-mobile-/, "");
          const raw = await downloadFromPath(path, cleanName, mime);
          let file: File = raw;
          let kind: "pdf" | "image" = isPdf || isDoc ? "pdf" : "image";
          if (isDoc) {
            const conv = await fileToPdf(raw);
            if (!conv) continue;
            file = conv;
            kind = "pdf";
          }
          if (cancelled) return;
          await registerItem(file, kind);
        }
      } catch {
        /* ignore */
      }
    };
    const channel = supabase
      .channel(`manual_mobile_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rti_mobile_tokens", filter: `document_id=eq.${sessionId}` },
        () => { void tick(); },
      )
      .subscribe();
    const iv = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualProject, activeDoc?.id]);

  // Live-update status via realtime
  useEffect(() => {
    if (!activeDoc || activeDoc.id === MANUAL_PROJECT_ID) return;
    const channel = supabase
      .channel(`rti_doc_${activeDoc.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rti_documents", filter: `id=eq.${activeDoc.id}` },
        (payload) => setActiveDoc(payload.new as RtiDocument),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeDoc?.id]);

  useEffect(() => {
    cacheCurrentProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, originals, originalThumbs, originalPageCounts, items, itemPaths, itemThumbs, itemPageCounts, timeline, pdfName, loadingDoc]);

  // ---- Auto-persist plan for real projects (debounced) ----
  const persistPlan = async () => {
    if (!activeDoc || activeDoc.id === MANUAL_PROJECT_ID) return;
    try {
      const nextPaths = { ...itemPaths };
      let changed = false;
      for (const it of items) {
        if (!nextPaths[it.id]) {
          nextPaths[it.id] = await uploadItemFile(activeDoc.id, it.file, it.kind);
          changed = true;
        }
      }
      if (changed) setItemPaths(nextPaths);
      const savedItems: SavedPlanItem[] = items
        .filter((it) => !!nextPaths[it.id])
        .map((it) => ({ id: it.id, name: it.name, kind: it.kind, path: nextPaths[it.id] }));
      const savedPlan: SavedPlan = { items: savedItems, timeline };
      await updateDocument(activeDoc.id, { plan_json: savedPlan });
    } catch (e) {
      console.error("Auto-persist failed", e);
    }
  };

  useEffect(() => {
    if (!activeDoc || activeDoc.id === MANUAL_PROJECT_ID || loadingDoc) return;
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void persistPlan();
    }, 800);
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, timeline, activeDoc?.id, loadingDoc]);

  const addFiles = async (files: File[]) => {
    setStatus({ kind: "working", pct: 0, label: "Processing files…" });
    const rejected: string[] = [];
    for (const f of files) {
      const kind = classify(f);
      if (!kind) {
        rejected.push(f.name);
        continue;
      }
      if (kind === "word") {
        const p = await fileToPdf(f);
        if (!p) { rejected.push(f.name); continue; }
        await registerItem(p, "pdf");
      } else if (kind === "pdf") {
        await registerItem(f, "pdf");
      } else {
        await registerItem(f, "image");
      }
    }
    if (rejected.length) setStatus({ kind: "error", message: `Skipped: ${rejected.join(", ")}` });
    else setStatus({ kind: "idle" });
  };

  const removeEntry = (entryId: string) => {
    setTimeline((prev) => prev.filter((e) => e.id !== entryId));
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

    setStatus({ kind: "working", pct: 0, label: "Processing replacement…" });
    let f = fs[0];
    let kind = classify(f);
    if (!kind) {
      setStatus({ kind: "idle" });
      return;
    }
    if (kind === "word") {
      const p = await fileToPdf(f);
      if (!p) { setStatus({ kind: "idle" }); return; }
      f = p;
      kind = "pdf";
    }
    await registerItem(f, kind, { replaceEntryId: targetId });
    setStatus({ kind: "idle" });
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

  const generateAndSave = async () => {
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
          return {
            entryId: entry.id,
            kind: "item",
            item,
            pageIndex: entry.pageIndex ?? 0,
            rotation: entry.rotation,
          };
        })
        .filter((x): x is PlanEntry => x !== null);

      const blob = await mergeByPlan(originalFiles, plan, (pct) =>
        setStatus({ kind: "working", pct, label: "Merging pages…" }),
      );

      const fallback = activeDoc.original_name.replace(/\.pdf$/i, "") || "Merged_PDF";
      const rawName = pdfName.trim() || fallback;
      const filename = sanitizeFile(/\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`);
      const saved = await savePdfBlob(blob, filename);
      if (!saved) {
        setStatus({ kind: "idle" });
        return;
      }

      if (activeDoc.id === MANUAL_PROJECT_ID) {
        setStatus({ kind: "done", message: `Saved ${filename}` });
        return;
      }

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
      const savedPlan: SavedPlan = { items: savedItems, timeline };
      const editedPath = await uploadEdited(activeDoc.id, blob, filename);
      const patch: Parameters<typeof updateDocument>[1] = {
        plan_json: savedPlan,
        edited_path: editedPath,
        final_name: filename,
        status: "completed",
        deletion_scheduled_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      };
      const updated = await updateDocument(activeDoc.id, patch);
      setActiveDoc(updated);
      projectCacheRef.current[activeDoc.id] = {
        activeDoc: updated,
        originals,
        originalThumbs,
        originalPageCounts,
        items,
        itemPaths: nextPaths,
        itemThumbs,
        itemPageCounts,
        timeline,
        pdfName,
        seenMobilePaths: Array.from(seenMobilePathsRef.current),
      };
      setStatus({ kind: "done", message: `Saved. Status: ${STATUS_TEXT.completed}` });
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
    delete projectCacheRef.current[activeDoc.id];
    setActiveDoc(null);
    resetLocalState();
  };

  const deleteProject = async (doc: RtiDocument) => {
    await deleteDocumentData(doc.id);
    delete projectCacheRef.current[doc.id];
    if (activeDoc?.id === doc.id) {
      setActiveDoc(null);
      resetLocalState();
    }
  };

  const canGenerate = timeline.length > 0 && status.kind !== "working" && !loadingDoc && !!activeDoc;

  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <RtiSidebar
        activeId={activeDoc?.id ?? null}
        onSelect={openDocument}
        onDelete={deleteProject}
        onManualEdit={() => openManualProject([])}
      />

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

      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="border-b border-border bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-foreground">RTI PDF Manager</h1>
              <p className="text-xs text-muted-foreground">
                Internal tool · Merge PDFs &amp; images · ACK workflow
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {!activeDoc ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center">
              <p className="text-sm font-medium text-foreground">No project open</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a project from the queue on the left, use <b>Admin Upload</b>, or start a
                manual edit by dropping one or more PDFs below.
              </p>
              <div className="mt-5 text-left">
                <Dropzone
                  label="Start manual edit"
                  hint="Drop PDFs, Word docs, or Images"
                  multiple
                  accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onFiles={openManualProject}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{activeDoc.customer_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {originals.length} original file{originals.length === 1 ? "" : "s"}
                  </p>
                </div>
                {!isManualProject && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium shadow-sm">
                    {STATUS_TEXT[activeDoc.status]}
                  </span>
                )}
              </div>

              {!isManualProject && activeDoc.status === "completed" && activeDoc.deletion_scheduled_at && (
                <AutoDeleteBanner
                  scheduledAt={activeDoc.deletion_scheduled_at}
                  onCancel={cancelAutoDelete}
                  onDeleteNow={deleteNow}
                />
              )}

              <div className="mb-6">
                <QrPhonePanel
                  docId={activeDoc.id}
                  sessionId={isManualProject ? manualSessionIdRef.current : undefined}
                />
              </div>

              {isManualProject && originals.length === 0 && (
                <section className="mb-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                  <h2 className="mb-1 text-sm font-semibold text-foreground">Original PDF</h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Drop one or more PDFs / images / Word docs to start editing.
                  </p>
                  <Dropzone
                    label="Drop original files here"
                    hint=".pdf, .jpg, .png, .docx"
                    multiple
                    accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onFiles={openManualProject}
                  />
                </section>
              )}

              <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold text-foreground">Add more files</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Add PDFs, Images, or Word docs. Drag thumbnails below to reorder / interleave.
                </p>
                <Dropzone
                  label="Drop files here or click to browse"
                  hint="Multiple .pdf, .jpg, .png, .docx"
                  multiple
                  accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                      Drag to reorder · Hover a page for rotate, replace, delete.
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
                                />
                              </div>
                            );
                          }
                          const item = itemById.get(entry.itemId);
                          if (!item) return null;
                          const page = entry.pageIndex ?? 0;
                          const thumbList = itemThumbs[item.id] ?? [];
                          const thumb = thumbList[page] ?? null;
                          const totalPages = itemPageCounts[item.id] ?? 1;
                          const isLoading =
                            item.kind === "pdf" && thumbList.length === 0;
                          const sub =
                            item.kind === "pdf" && totalPages > 1
                              ? `P.${page + 1} · #${idx + 1}`
                              : `#${idx + 1}`;
                          return (
                            <div key={entry.id} className="relative">
                              <PageThumb
                                id={entry.id}
                                label={item.name}
                                sublabel={sub}
                                thumbnail={thumb}
                                loading={isLoading}
                                rotation={entry.rotation}
                                kind={item.kind}
                                onDelete={() => removeEntry(entry.id)}
                                onRotate={() => rotateEntry(entry.id)}
                                onReplace={() => startReplace(entry.id)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </section>

              <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    PDF Name
                  </label>
                  <input
                    type="text"
                    value={pdfName}
                    onChange={(e) => setPdfName(e.target.value)}
                    placeholder={activeDoc.original_name.replace(/\.pdf$/i, "")}
                    className="w-full max-w-md rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    If empty, the original PDF filename is used.
                  </p>
                </div>

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
    </div>
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
