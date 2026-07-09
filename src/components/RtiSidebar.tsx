import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, FileText, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listDocuments, type RtiDocument, type RtiStatus } from "@/lib/rti-storage";

type Props = {
  activeId?: string | null;
  onSelect: (doc: RtiDocument) => void;
  onDelete: (doc: RtiDocument) => Promise<void>;
};

const STATUS_META: Record<RtiStatus, { dot: string; label: string; text: string }> = {
  pending: { dot: "bg-red-500", label: "Pending", text: "text-red-700" },
  waiting_ack: { dot: "bg-orange-500", label: "Waiting for ACK", text: "text-orange-700" },
  completed: { dot: "bg-green-500", label: "Completed", text: "text-green-700" },
};

export function RtiSidebar({ activeId, onSelect, onDelete }: Props) {
  const [docs, setDocs] = useState<RtiDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setDocs(await listDocuments());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("rti_documents_sidebar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rti_documents" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Pending Queue</h2>
          <p className="text-xs text-muted-foreground">{docs.length} project{docs.length === 1 ? "" : "s"}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <Link
        to="/admin"
        className="mx-3 mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" /> Admin Upload
      </Link>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-4">
        {docs.length === 0 && !loading && (
          <p className="mt-6 px-3 text-center text-xs text-muted-foreground">
            No projects yet. Use Admin Upload to add one.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {docs.map((d) => {
            const meta = STATUS_META[d.status];
            const active = d.id === activeId;
            return (
              <li key={d.id}>
                <div
                  className={`flex items-stretch gap-1 rounded-lg px-1 py-0.5 transition-colors ${
                    active ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-accent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    className="min-w-0 flex-1 rounded-md px-2 py-2 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{d.customer_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.rti_type_selected ?? "RTI"}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                          <span className={`text-[11px] font-medium ${meta.text}`}>{meta.label}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete project "${d.customer_name}"? This cannot be undone.`)) {
                        return;
                      }
                      await onDelete(d);
                      await refresh();
                    }}
                    className="mt-1.5 h-8 w-8 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${d.customer_name}`}
                    title="Delete project"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
