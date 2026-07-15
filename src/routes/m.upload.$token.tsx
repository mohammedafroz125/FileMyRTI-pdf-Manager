import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Image as ImageIcon, CheckCircle2, AlertCircle, Upload, FolderOpen } from "lucide-react";
import { getTokenInfo, uploadMobileFile, type MobileToken } from "@/lib/rti-storage";


export const Route = createFileRoute("/m/upload/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mobile Upload — RTI PDF Manager" },
      { name: "robots", content: "noindex" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
  component: MobileUploadPage,
});

function MobileUploadPage() {
  const { token } = Route.useParams();
  const [info, setInfo] = useState<MobileToken | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired">("loading");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getTokenInfo(token)
      .then((t) => {
        if (!t) return setState("invalid");
        if (new Date(t.expires_at).getTime() < Date.now()) return setState("expired");
        setInfo(t);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const handleFiles = async (files: File[]) => {
    if (!info) return;
    setError(null);
    setUploading(true);
    try {
      for (const f of files) {
        await uploadMobileFile(info.document_id, token, f);
        setUploaded((prev) => [f.name, ...prev]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (state === "loading") {
    return <Centered><p className="text-sm text-muted-foreground">Loading…</p></Centered>;
  }
  if (state === "invalid") {
    return <Centered><p className="text-sm text-red-700">This upload link is invalid.</p></Centered>;
  }
  if (state === "expired") {
    return <Centered><p className="text-sm text-red-700">This upload link has expired.</p></Centered>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-4 rounded-xl bg-blue-600 px-4 py-4 text-white shadow-sm">
          <h1 className="text-lg font-semibold">Upload to RTI project</h1>
          <p className="text-xs opacity-90">Files upload directly into the open project.</p>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length) handleFiles(fs);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length) handleFiles(fs);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Camera className="h-5 w-5" /> Take photo (Camera)
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => galleryRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-3 text-sm font-semibold text-foreground shadow-sm hover:bg-accent disabled:opacity-50"
          >
            <ImageIcon className="h-5 w-5" /> Pick from gallery
          </button>

          <p className="text-center text-xs text-muted-foreground">
            ACK · Envelope · IPO · Court Fee · PDF · DOC · DOCX · Images
          </p>

          {uploading && (
            <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <Upload className="h-4 w-4 animate-pulse" /> Uploading…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {uploaded.length > 0 && (
            <div className="rounded-md bg-green-50 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-green-800">
                <CheckCircle2 className="h-4 w-4" /> Uploaded ({uploaded.length})
              </div>
              <ul className="space-y-0.5 text-xs text-green-900/80">
                {uploaded.map((n, i) => (
                  <li key={i} className="truncate">• {n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}
