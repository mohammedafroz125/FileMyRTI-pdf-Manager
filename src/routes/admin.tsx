import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, FileText, X, UploadCloud, Plus } from "lucide-react";
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
  const [cards, setCards] = useState(() => [createCard()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const cardErrors = useMemo(
    () =>
      cards.map((card) => ({
        id: card.id,
        hasName: !!card.customerName.trim(),
        hasFiles: card.files.length > 0,
      })),
    [cards],
  );

  const allValid = cardErrors.every((card) => card.hasName && card.hasFiles);

  const addCard = (afterId?: string) => {
    const next = createCard();
    setCards((prev) => {
      if (!afterId) return [...prev, next];
      const index = prev.findIndex((card) => card.id === afterId);
      if (index < 0) return [...prev, next];
      return [...prev.slice(0, index + 1), next, ...prev.slice(index + 1)];
    });
  };

  const updateCard = (id: string, patch: Partial<CardState>) => {
    setCards((prev) => prev.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  };

  const removeCard = (id: string) => {
    setCards((prev) => (prev.length === 1 ? prev : prev.filter((card) => card.id !== id)));
  };

  const addFiles = (cardId: string, fs: File[]) => {
    const pdfs = fs.filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (pdfs.length !== fs.length) {
      setError("Only PDF files are allowed.");
    } else {
      setError(null);
    }
    setCards((prev) =>
      prev.map((card) =>
        card.id === cardId ? { ...card, files: [...card.files, ...pdfs] } : card,
      ),
    );
  };

  const moveFile = (cardId: string, idx: number, dir: -1 | 1) => {
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    const t = idx + dir;
    if (t < 0 || t >= card.files.length) return;
    const copy = card.files.slice();
    [copy[idx], copy[t]] = [copy[t], copy[idx]];
    updateCard(cardId, { files: copy });
  };

  const removeFile = (cardId: string, idx: number) => {
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    updateCard(cardId, { files: card.files.filter((_, i) => i !== idx) });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!allValid) return setError("Fill in every customer card before submitting.");
    setBusy(true);
    try {
      await Promise.all(cards.map((card) => createProjectWithOriginals(card.customerName, card.files)));
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
          {cards.map((card) => {
            const invalid = !card.customerName.trim() || card.files.length === 0;
            return (
              <div
                key={card.id}
                className={`rounded-xl border p-4 shadow-sm ${invalid ? "border-red-300 bg-red-50/20 ring-1 ring-red-100" : "border-border bg-white"}`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-sm font-medium text-foreground">Customer Name</label>
                    <input
                      type="text"
                      value={card.customerName}
                      onChange={(e) => updateCard(card.id, { customerName: e.target.value })}
                      placeholder="e.g. P Chandu"
                      className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex items-center gap-1 pt-6">
                    <button
                      type="button"
                      onClick={() => addCard(card.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Add another customer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {cards.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCard(card.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        title="Remove customer card"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Original PDF(s)</label>
                  <input
                    ref={(el) => {
                      inputRefs.current[card.id] = el;
                    }}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      if (fs.length) addFiles(card.id, fs);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => inputRefs.current[card.id]?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card px-4 py-6 text-sm font-semibold text-foreground hover:border-blue-400 hover:bg-blue-50/40"
                  >
                    <UploadCloud className="h-5 w-5 text-blue-600" />
                    Select PDF(s)
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose one or multiple PDFs. Order is preserved.
                  </p>

                  {card.files.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {card.files.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {i + 1}
                          </span>
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => moveFile(card.id, i, -1)}
                            disabled={i === 0}
                            className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveFile(card.id, i, 1)}
                            disabled={i === card.files.length - 1}
                            className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button type="button" onClick={() => removeFile(card.id, i)} className="rounded p-1 text-muted-foreground hover:text-red-600">
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {invalid && (
                  <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    {!card.customerName.trim() && <div>Customer name is required.</div>}
                    {!card.files.length && <div>Add at least one PDF.</div>}
                  </div>
                )}
              </div>
            );
          })}

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
            disabled={busy || !allValid}
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

type CardState = {
  id: string;
  customerName: string;
  files: File[];
};

function createCard(): CardState {
  return {
    id: crypto.randomUUID(),
    customerName: "",
    files: [],
  };
}
