import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, FileText, X, UploadCloud } from "lucide-react";
import { createProjectWithOriginals } from "@/lib/rti-storage";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Upload — RTI PDF Manager" },
      { name: "description", content: "Add a new RTI project to the pending queue." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fs: File[]) => {
    const pdfs = fs.filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (pdfs.length !== fs.length) {
      setError("Only PDF files are allowed.");
    } else {
      setError(null);
    }
    setFiles((prev) => [...prev, ...pdfs]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= files.length) return;
    const copy = files.slice();
    [copy[idx], copy[t]] = [copy[t], copy[idx]];
    setFiles(copy);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customerName.trim()) return setError("Customer name is required.");
    if (files.length === 0) return setError("Select at least one PDF.");
    setBusy(true);
    try {
      await createProjectWithOriginals(customerName, files);
      setDone(true);
      setTimeout(() => navigate({ to: "/" }), 700);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="text-lg font-semibold">Admin Upload</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <form
          onSubmit={submit}
          className="space-y-5 rounded-xl border border-border bg-white p-6 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Customer Name</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. P Chandu"
              className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Original PDF(s)</label>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (fs.length) addFiles(fs);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card px-4 py-6 text-sm font-semibold text-foreground hover:border-blue-400 hover:bg-blue-50/40"
            >
              <UploadCloud className="h-5 w-5 text-blue-600" />
              Select PDF(s)
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose one or multiple PDFs. Order is preserved.
            </p>

            {files.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {i + 1}
                    </span>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button type="button" onClick={() => moveFile(i, -1)} disabled={i === 0} className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => removeFile(i)} className="rounded p-1 text-muted-foreground hover:text-red-600">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" /> Project added to the pending queue.
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Uploading…" : "Add to Pending Queue"}
          </button>
        </form>
      </main>
    </div>
  );
}
