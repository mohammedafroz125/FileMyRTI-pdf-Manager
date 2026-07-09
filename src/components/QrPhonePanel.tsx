import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, RefreshCw, Copy, Check, AlertCircle } from "lucide-react";
import { createMobileToken, type MobileToken } from "@/lib/rti-storage";

/** Pass sessionId to override the DB document_id used for the token.
 *  This is used by Manual Edit, which uses a local-only session UUID
 *  so the token can be created without a real rti_documents row. */
type Props = { docId: string; sessionId?: string };

export function QrPhonePanel({ docId, sessionId }: Props) {
  const effectiveId = sessionId ?? docId;
  const [token, setToken] = useState<MobileToken | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Track whether we have already generated for the current effectiveId.
  const lastGeneratedFor = useRef<string | null>(null);

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/m/upload/${token.token}`
    : "";

  const generate = async () => {
    setBusy(true);
    setGenError(null);
    try {
      const t = await createMobileToken(effectiveId, 120);
      setToken(t);
      lastGeneratedFor.current = effectiveId;
      const u = `${window.location.origin}/m/upload/${t.token}`;
      const png = await QRCode.toDataURL(u, { margin: 1, width: 220 });
      setDataUrl(png);
    } catch (err) {
      setGenError((err as Error).message ?? "Failed to generate QR");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setToken(null);
    setDataUrl(null);
    setGenError(null);
    lastGeneratedFor.current = null;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <QrCode className="h-4 w-4" /> Phone upload
          </h2>
          <p className="text-xs text-muted-foreground">
            Scan to upload ACK, envelope, IPO, court fee or images from your phone.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"
          title="Regenerate QR"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-[220px] w-[220px] shrink-0 items-center justify-center rounded-lg border border-border bg-slate-50">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code" className="h-full w-full" />
          ) : genError ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <p className="text-xs text-red-600">{genError}</p>
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                className="mt-1 rounded-md bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-xs text-muted-foreground">Generating…</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {token && (
            <>
              <p className="text-xs text-muted-foreground">Expires</p>
              <p className="text-sm font-medium text-foreground">
                {new Date(token.expires_at).toLocaleTimeString()}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">Link</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                  {url}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md border border-border bg-white p-1.5 text-muted-foreground hover:bg-accent"
                  title="Copy link"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
