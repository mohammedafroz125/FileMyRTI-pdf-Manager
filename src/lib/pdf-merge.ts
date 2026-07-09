import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from "pdf-lib";
import type { TextAnnotation } from "@/lib/rti-storage";

export type MergeItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  file: File;
};

export type PlanEntry =
  | { entryId: string; kind: "original-page"; originalId: string; pageIndex: number; rotation?: number }
  | { entryId: string; kind: "item"; item: MergeItem; rotation?: number };

export async function mergeByPlan(
  originals: Record<string, File>,
  plan: PlanEntry[],
  annotations: TextAnnotation[] = [],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (plan.length === 0) throw new Error("No pages to merge");

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  const cache = new Map<string, PDFDocument>();
  const loadPdf = async (key: string, file: File) => {
    let doc = cache.get(key);
    if (!doc) {
      const bytes = await file.arrayBuffer();
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      cache.set(key, doc);
    }
    return doc;
  };

  const anByEntry = new Map<string, TextAnnotation[]>();
  for (const a of annotations) {
    const arr = anByEntry.get(a.entryId) ?? [];
    arr.push(a);
    anByEntry.set(a.entryId, arr);
  }

  const applyAnnotations = (page: PDFPage, entryId: string) => {
    const list = anByEntry.get(entryId);
    if (!list?.length) return;
    const { width, height } = page.getSize();
    for (const a of list) {
      const text = a.text ?? "";
      if (!text.trim()) continue;
      const size = Math.max(6, a.fontSize || 12);
      const px = a.x * width;
      // Convert top-origin fraction to PDF bottom-origin baseline.
      const py = height - a.y * height - size;
      page.drawText(text, {
        x: px,
        y: py,
        size,
        font,
        color: rgb(0, 0, 0),
        maxWidth: (a.widthFrac || 0.5) * width,
      });
    }
  };

  let done = 0;
  for (const entry of plan) {
    if (entry.kind === "original-page") {
      const file = originals[entry.originalId];
      if (!file) throw new Error(`Original file missing for id ${entry.originalId}`);
      const src = await loadPdf(`orig-${entry.originalId}`, file);
      const [page] = await out.copyPages(src, [entry.pageIndex]);
      if (entry.rotation) page.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
      const added = out.addPage(page);
      applyAnnotations(added, entry.entryId);
    } else {
      const it = entry.item;
      if (it.kind === "pdf") {
        const src = await loadPdf(`item-${it.id}`, it.file);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p, i) => {
          if (entry.rotation) p.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
          const added = out.addPage(p);
          if (i === 0) applyAnnotations(added, entry.entryId);
        });
      } else {
        const bytes = await it.file.arrayBuffer();
        const lower = it.name.toLowerCase();
        const img = lower.endsWith(".png")
          ? await out.embedPng(bytes)
          : await out.embedJpg(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        if (entry.rotation) page.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
        applyAnnotations(page, entry.entryId);
      }
    }
    done += 1;
    onProgress?.(Math.round((done / plan.length) * 100));
  }

  const finalBytes = await out.save();
  const ab = new ArrayBuffer(finalBytes.byteLength);
  new Uint8Array(ab).set(finalBytes);
  return new Blob([ab], { type: "application/pdf" });
}
