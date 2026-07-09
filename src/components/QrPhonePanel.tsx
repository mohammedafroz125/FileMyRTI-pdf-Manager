import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode, RefreshCw, Copy, Check } from "lucide-react";
import { createMobileToken, type MobileToken } from "@/lib/rti-storage";

type Props = { docId: string; mobileUploadCount?: number };

export function QrPhonePanel({ docId, mobileUploadCount = 0 }: Props) {
  const [token, setToken] = useState<MobileToken | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/m/upload/${token.token}`
    : "";

  const generate = async () => {
    setBusy(true);
    try {
      const t = await createMobileToken(docId, 120); // 2 hours
      setToken(t);
      const u = `${window.location.origin}/m/upload/${t.token}`;
      const png = await QRCode.toDataURL(u, { margin: 1, width: 220 });
      setDataUrl(png);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setToken(null);
    setDataUrl(null);
    generate().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    if (!token) {
      setTimeLeft(null);
      return;
    }
    const tick = () => {
      const ms = new Date(token.expires_at).getTime() - Date.now();
      if (ms <= 0) {
        setTimeLeft(0);
        // Auto refresh when expired
        generate().catch(console.error);
      } else {
        setTimeLeft(Math.floor(ms / 1000));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [token]);

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
        <div className="flex items-center gap-3">
          {mobileUploadCount > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 shadow-sm transition-all">
              <Check className="h-3.5 w-3.5" />
              {mobileUploadCount} {mobileUploadCount === 1 ? "Upload" : "Uploads"} received
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 shadow-sm transition-all">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Waiting for upload...
            </span>
          )}
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
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-[220px] w-[220px] shrink-0 items-center justify-center rounded-lg border border-border bg-slate-50">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code" className="h-full w-full" />
          ) : (
            <span className="text-xs text-muted-foreground">Generating…</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {token && (
            <>
              <p className="text-xs text-muted-foreground">Expires</p>
              <p className="text-sm font-medium text-foreground">
                {new Date(token.expires_at).toLocaleTimeString()}
                {timeLeft !== null && timeLeft > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (in {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")})
                  </span>
                )}
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
