import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, UploadCloud, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { createProjectWithOriginals } from "@/lib/rti-storage";

export const Route = createFileRoute("/admin")({
  component: AdminUpload,
});

type UploadSlot = {
  id: string;
  files: File[];
  customerName: string;
  status: "idle" | "uploading" | "done" | "error";
  errorMsg?: string;
};

function AdminUpload() {
  const [slots, setSlots] = useState<UploadSlot[]>([
    { id: crypto.randomUUID(), files: [], customerName: "", status: "idle" },
  ]);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      { id: crypto.randomUUID(), files: [], customerName: "", status: "idle" },
    ]);
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSlot = (id: string, patch: Partial<UploadSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleFiles = (id: string, files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (!pdfs.length) return;

    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const newFiles = [...s.files, ...pdfs];
        // Auto-extract customer name if empty
        let newCustomerName = s.customerName;
        if (!newCustomerName.trim() && newFiles.length > 0) {
          newCustomerName = newFiles[0].name.replace(/\.pdf$/i, "");
        }
        return { ...s, files: newFiles, customerName: newCustomerName, errorMsg: "", status: "idle" };
      })
    );
  };

  const removeFile = (id: string, index: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const newFiles = [...s.files];
        newFiles.splice(index, 1);
        return { ...s, files: newFiles };
      })
    );
  };

  const uploadProject = async (slot: UploadSlot) => {
    if (slot.files.length === 0) return;
    updateSlot(slot.id, { status: "uploading", errorMsg: "" });
    try {
      const nameToUse = slot.customerName.trim() || slot.files[0].name.replace(/\.pdf$/i, "");
      await createProjectWithOriginals(nameToUse, slot.files);
      updateSlot(slot.id, { status: "done" });
    } catch (err) {
      updateSlot(slot.id, { status: "error", errorMsg: (err as Error).message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 text-center">
          <h1 className="text-2xl font-bold text-foreground">Admin Upload</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create new RTI projects. Each card creates a separate project in the pending queue.
          </p>
        </header>

        <div className="flex flex-wrap justify-center gap-6">
          {slots.map((slot, index) => (
            <div
              key={slot.id}
              className="relative flex w-full max-w-sm flex-col rounded-xl border border-border bg-white shadow-sm transition-all duration-300 animate-in fade-in zoom-in-95"
            >
              {slots.length > 1 && slot.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => removeSlot(slot.id)}
                  className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow-sm hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              <div className="flex-1 p-5">
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Customer Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder={
                      slot.files.length > 0
                        ? slot.files[0].name.replace(/\.pdf$/i, "")
                        : "Auto-extracted from PDF"
                    }
                    value={slot.customerName}
                    onChange={(e) => updateSlot(slot.id, { customerName: e.target.value })}
                    disabled={slot.status === "uploading" || slot.status === "done"}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                <div className="mb-4">
                  {slot.files.length === 0 ? (
                    <div
                      className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-slate-50 p-6 text-center hover:border-blue-400 hover:bg-blue-50/50"
                    >
                      <input
                        type="file"
                        multiple
                        accept="application/pdf,.pdf"
                        onChange={(e) => {
                          const fs = Array.from(e.target.files ?? []);
                          if (fs.length) handleFiles(slot.id, fs);
                          e.target.value = "";
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <UploadCloud className="mb-2 h-6 w-6 text-blue-500" />
                      <p className="text-xs font-medium text-foreground">Click or drop PDFs</p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {slot.files.length} File{slot.files.length === 1 ? "" : "s"}
                        </span>
                        {slot.status === "idle" && (
                          <div className="relative cursor-pointer text-xs font-medium text-blue-600 hover:underline">
                            Add more
                            <input
                              type="file"
                              multiple
                              accept="application/pdf,.pdf"
                              onChange={(e) => {
                                const fs = Array.from(e.target.files ?? []);
                                if (fs.length) handleFiles(slot.id, fs);
                                e.target.value = "";
                              }}
                              className="absolute inset-0 cursor-pointer opacity-0"
                            />
                          </div>
                        )}
                      </div>
                      <ul className="space-y-1">
                        {slot.files.map((f, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs shadow-sm"
                          >
                            <span className="truncate">{f.name}</span>
                            {slot.status === "idle" && (
                              <button
                                type="button"
                                onClick={() => removeFile(slot.id, i)}
                                className="ml-2 text-muted-foreground hover:text-red-600"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {slot.status === "error" && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{slot.errorMsg}</span>
                  </div>
                )}
                {slot.status === "done" && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Project created successfully!</span>
                  </div>
                )}
              </div>

              <div className="border-t border-border p-4">
                {slot.status === "done" ? (
                  <button
                    type="button"
                    onClick={() => updateSlot(slot.id, { status: "idle", files: [], customerName: "" })}
                    className="w-full rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-foreground hover:bg-slate-200"
                  >
                    Upload Another
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => uploadProject(slot)}
                    disabled={slot.files.length === 0 || slot.status === "uploading"}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {slot.status === "uploading" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                      </>
                    ) : (
                      "Create Project"
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add Slot Card */}
          <button
            type="button"
            onClick={addSlot}
            className="group flex w-full max-w-sm flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-transparent p-10 text-muted-foreground transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600"
          >
            <Plus className="h-8 w-8 transition-transform group-hover:scale-110" />
            <span className="mt-3 text-sm font-medium">Add another project</span>
          </button>
        </div>
      </div>
    </div>
  );
}
