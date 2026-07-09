import { useEffect, useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, FileText, RefreshCw, Trash2, Search, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listDocuments, type RtiDocument, type RtiStatus } from "@/lib/rti-storage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  activeId?: string | null;
  onSelect: (doc: RtiDocument) => void;
  onDelete: (doc: RtiDocument) => Promise<void>;
  onOpenManualEdit: () => void;
};

const STATUS_META: Record<RtiStatus, { dot: string; label: string; text: string }> = {
  pending: { dot: "bg-red-500", label: "Pending", text: "text-red-700" },
  waiting_ack: { dot: "bg-orange-500", label: "Waiting for ACK", text: "text-orange-700" },
  completed: { dot: "bg-green-500", label: "Completed", text: "text-green-700" },
};

export function RtiSidebar({ activeId, onSelect, onDelete, onOpenManualEdit }: Props) {
  const [docs, setDocs] = useState<RtiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RtiStatus | "all">("all");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest" | "name">("latest");

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

  const filteredDocs = useMemo(() => {
    let result = docs;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => d.customer_name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      result = result.filter(d => d.status === statusFilter);
    }
    result = [...result].sort((a, b) => {
      if (sortOrder === "latest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortOrder === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortOrder === "name") return a.customer_name.localeCompare(b.customer_name);
      return 0;
    });
    return result;
  }, [docs, searchQuery, statusFilter, sortOrder]);

  return (
    <TooltipProvider>
    <aside className="flex h-screen w-full md:w-72 shrink-0 flex-col border-r border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Pending Queue</h2>
          <p className="text-xs text-muted-foreground">{filteredDocs.length} project{filteredDocs.length === 1 ? "" : "s"}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={refresh}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh Queue</TooltipContent>
        </Tooltip>
      </div>

      <div className="mx-3 mt-3 flex flex-col gap-2">
        <Link
          to="/admin"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          <Plus className="h-4 w-4" /> Admin Upload
        </Link>
        <button
          type="button"
          onClick={onOpenManualEdit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-slate-50 focus:ring-2 focus:ring-slate-200"
        >
          <FileText className="h-4 w-4" /> Manual Edit
        </button>
      </div>

      <div className="mx-3 mt-4 flex flex-col gap-2 border-b border-border pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search projects..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent pl-8 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="waiting_ack">Waiting ACK</option>
            <option value="completed">Completed</option>
          </select>
          <select 
            value={sortOrder} 
            onChange={(e) => setSortOrder(e.target.value as any)}
            className="flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name A-Z</option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-4">
        {filteredDocs.length === 0 && !loading && (
          <p className="mt-6 px-3 text-center text-xs text-muted-foreground">
            {docs.length === 0 ? "No projects yet. Use Admin Upload to add one." : "No projects match your search/filter."}
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {filteredDocs.map((d) => {
            const meta = STATUS_META[d.status];
            const active = d.id === activeId;
            return (
              <li key={d.id}>
                <div
                  className={`group flex items-stretch gap-1 rounded-lg px-1 py-0.5 transition-all duration-200 ${
                    active ? "bg-blue-100 ring-2 ring-blue-400 shadow-sm" : "hover:bg-accent hover:shadow-sm"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    className="min-w-0 flex-1 rounded-md px-2 py-2 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <FileText className={`mt-0.5 h-4 w-4 shrink-0 transition-colors ${active ? "text-blue-600" : "text-muted-foreground group-hover:text-foreground"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium transition-colors ${active ? "text-blue-900" : "text-foreground"}`}>{d.customer_name}</p>
                        <p className={`truncate text-xs transition-colors ${active ? "text-blue-700" : "text-muted-foreground"}`}>
                          {d.rti_type_selected ?? "RTI"}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-full shadow-sm ${meta.dot}`} />
                          <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                        className={`mt-1.5 h-8 w-8 shrink-0 rounded-md p-1.5 transition-colors ${active ? "text-blue-400 hover:bg-blue-200 hover:text-red-600" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"}`}
                        aria-label={`Delete ${d.customer_name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Delete Project</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
    </TooltipProvider>
  );
}
