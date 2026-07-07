import { PDFDocument } from "pdf-lib";

export type MergeItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  file: File;
};

export async function mergeFiles(
  original: File | null,
  items: MergeItem[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const out = await PDFDocument.create();
  const queue: { file: File; kind: "pdf" | "image"; name: string }[] = [];
  if (original) queue.push({ file: original, kind: "pdf", name: original.name });
  for (const it of items) queue.push({ file: it.file, kind: it.kind, name: it.name });

  if (queue.length === 0) throw new Error("No files to merge");

  let done = 0;
  for (const entry of queue) {
    const bytes = await entry.file.arrayBuffer();
    if (entry.kind === "pdf") {
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } catch (e) {
        throw new Error(`Failed to read PDF "${entry.name}": ${(e as Error).message}`);
      }
    } else {
      const lower = entry.name.toLowerCase();
      const img =
        lower.endsWith(".png")
          ? await out.embedPng(bytes)
          : await out.embedJpg(bytes);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    done += 1;
    onProgress?.(Math.round((done / queue.length) * 100));
  }

  const finalBytes = await out.save();
  // Copy into a fresh ArrayBuffer to satisfy BlobPart typing
  const ab = new ArrayBuffer(finalBytes.byteLength);
  new Uint8Array(ab).set(finalBytes);
  return new Blob([ab], { type: "application/pdf" });
}
