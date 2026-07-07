import { PDFDocument, type PDFPage } from "pdf-lib";

export type MergeItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  file: File;
};

export type PlanEntry =
  | { kind: "original-page"; pageIndex: number }
  | { kind: "item"; item: MergeItem };

export async function mergeByPlan(
  original: File | null,
  plan: PlanEntry[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (plan.length === 0) throw new Error("No pages to merge");

  const out = await PDFDocument.create();

  // Cache loaded PDFDocuments so multi-page originals/items load once.
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

  let done = 0;
  for (const entry of plan) {
    if (entry.kind === "original-page") {
      if (!original) throw new Error("Original PDF missing for page entry");
      const src = await loadPdf("__original__", original);
      const [page] = await out.copyPages(src, [entry.pageIndex]);
      out.addPage(page);
    } else {
      const it = entry.item;
      if (it.kind === "pdf") {
        try {
          const src = await loadPdf(it.id, it.file);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((p: PDFPage) => out.addPage(p));
        } catch (e) {
          throw new Error(`Failed to read PDF "${it.name}": ${(e as Error).message}`);
        }
      } else {
        const bytes = await it.file.arrayBuffer();
        const lower = it.name.toLowerCase();
        const img = lower.endsWith(".png")
          ? await out.embedPng(bytes)
          : await out.embedJpg(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
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

// Kept for backward compatibility with earlier call site.
export async function mergeFiles(
  original: File | null,
  items: MergeItem[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const plan: PlanEntry[] = [];
  if (original) {
    // We don't know the page count here; caller should use mergeByPlan.
    // Fallback: load once to get indices.
    const src = await PDFDocument.load(await original.arrayBuffer(), {
      ignoreEncryption: true,
    });
    for (const i of src.getPageIndices()) plan.push({ kind: "original-page", pageIndex: i });
  }
  for (const item of items) plan.push({ kind: "item", item });
  return mergeByPlan(original, plan, onProgress);
}
