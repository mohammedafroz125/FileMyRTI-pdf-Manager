// pdfjs-dist references browser globals (DOMMatrix, etc.) at import time.
// Lazy-load it on the client only so the SSR bundle never touches it.

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (typeof window === "undefined") {
    throw new Error("PDF rendering is only available in the browser");
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerMod = await import("pdfjs-dist/build/pdf.worker.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function renderPdfThumbnails(
  file: File,
  scale = 0.35,
): Promise<string[]> {
  const pdfjs = await getPdfjs();
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
  await loadingTask.destroy();
  return out;
}

export async function renderPdfFirstThumbnail(
  file: File,
  scale = 0.35,
): Promise<string | null> {
  const thumbs = await renderPdfThumbnails(file, scale);
  return thumbs[0] ?? null;
}
