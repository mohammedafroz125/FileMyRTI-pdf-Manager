import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode, RefreshCw, Copy, Check } from "lucide-react";
import { createMobileToken, type MobileToken } from "@/lib/rti-storage";

type Props = { docId: string };

export function QrPhonePanel({ docId }: Props) {
  const [token, setToken] = useState<MobileToken | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/m/upload/${token.token}`
    : "";

  const generate = async () => {
    setBusy(true);
    try {
      const t = await createMobileToken(docId, 120);
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
