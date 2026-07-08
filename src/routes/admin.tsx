import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { createDocument, uploadOriginal } from "@/lib/rti-storage";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Upload — RTI PDF Manager" },
      { name: "description", content: "Add a new RTI document to the pending queue." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [rtiType, setRtiType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customerName.trim() || !rtiType.trim() || !file) {
      setError("All fields are required.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Original document must be a PDF.");
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadOriginal(customerName, rtiType, file);
      await createDocument({
        customer_name: customerName.trim(),
        rti_type: rtiType.trim(),
        original_path: uploaded.path,
        original_name: uploaded.name,
      });
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
              placeholder="e.g. Ramesh Kumar"
              className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">RTI Type</label>
            <input
              type="text"
              value={rtiType}
              onChange={(e) => setRtiType(e.target.value)}
              placeholder="e.g. First Appeal / Information Request"
              className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Original PDF</label>
            <Dropzone
              label={file ? `Selected: ${file.name}` : "Drop original PDF or click to browse"}
              hint="A single .pdf file"
              accept="application/pdf,.pdf"
              onFiles={(fs) => setFile(fs[0] ?? null)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" /> Document added to the pending queue.
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
