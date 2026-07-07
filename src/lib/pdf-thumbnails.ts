import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export async function renderPdfThumbnails(
  file: File,
  scale = 0.35,
): Promise<string[]> {
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push(canvas.toDataURL("image/jpeg", 0.7));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export async function renderPdfFirstThumbnail(
  file: File,
  scale = 0.35,
): Promise<string | null> {
  const thumbs = await renderPdfThumbnails(file, scale);
  return thumbs[0] ?? null;
}
