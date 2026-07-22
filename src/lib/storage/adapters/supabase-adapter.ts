import { supabase } from "@/integrations/supabase/client";
import type { IStorageProvider } from "../types";
import type {
  RtiDocument,
  RtiOriginal,
  RtiStatus,
  RtiTypeSelected,
  SavedPlan,
  MobileToken,
} from "../../rti-storage";
import type { DraftSummary, ManualDraft } from "../../manual-drafts";
import {
  listDrafts as listIdbDrafts,
  loadDraft as loadIdbDraft,
  saveDraft as saveIdbDraft,
  renameDraft as renameIdbDraft,
  deleteDraft as deleteIdbDraft,
} from "../../manual-drafts";

const BUCKET = "rti-files";

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
}

function mimeForItem(kind: "pdf" | "image", name: string) {
  if (kind === "pdf") return "application/pdf";
  return name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export class SupabaseStorageAdapter implements IStorageProvider {
  name: "supabase" = "supabase";

  async listDocuments(): Promise<RtiDocument[]> {
    const { data, error } = await supabase
      .from("rti_documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as RtiDocument[];
  }

  async getDocument(id: string): Promise<RtiDocument> {
    const { data, error } = await supabase.from("rti_documents").select("*").eq("id", id).single();
    if (error) throw error;
    return data as RtiDocument;
  }

  async uploadOriginalFile(docId: string, file: File): Promise<string> {
    const path = `${docId}/originals/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  private async uploadTempOriginal(file: File): Promise<string> {
    const path = `_incoming/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  private async moveObject(from: string, to: string): Promise<string> {
    const { error } = await supabase.storage.from(BUCKET).move(from, to);
    if (error) return from;
    return to;
  }

  async createProjectWithOriginals(customerName: string, files: File[]): Promise<RtiDocument> {
    if (files.length === 0) throw new Error("At least one PDF is required.");

    const first = files[0];
    const firstPath = await this.uploadTempOriginal(first);
    const { data: doc, error: docErr } = await supabase
      .from("rti_documents")
      .insert({
        customer_name: customerName.trim(),
        rti_type: "RTI",
        status: "pending",
        original_path: firstPath,
        original_name: first.name,
      })
      .select()
      .single();
    if (docErr) throw docErr;

    const rows: Omit<RtiOriginal, "id" | "created_at">[] = [];
    const finalFirstPath = await this.moveObject(firstPath, `${doc.id}/originals/0-${slugify(first.name)}.pdf`);
    rows.push({ document_id: doc.id, path: finalFirstPath, name: first.name, sort_order: 0 });

    for (let i = 1; i < files.length; i++) {
      const f = files[i];
      const path = `${doc.id}/originals/${i}-${slugify(f.name)}.pdf`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (error) throw error;
      rows.push({ document_id: doc.id, path, name: f.name, sort_order: i });
    }

    const { error: origErr } = await supabase.from("rti_originals").insert(rows);
    if (origErr) throw origErr;

    const { data: updated, error: updErr } = await supabase
      .from("rti_documents")
      .update({ original_path: finalFirstPath, original_name: first.name })
      .eq("id", doc.id)
      .select()
      .single();
    if (updErr) throw updErr;
    return updated as RtiDocument;
  }

  async updateDocument(
    id: string,
    patch: Partial<{
      status: RtiStatus;
      edited_path: string;
      final_name: string;
      plan_json: SavedPlan;
      rti_type_selected: RtiTypeSelected;
      deletion_scheduled_at: string | null;
    }>
  ): Promise<RtiDocument> {
    const { data, error } = await supabase
      .from("rti_documents")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as RtiDocument;
  }

  async deleteDocumentData(id: string): Promise<void> {
    const paths: string[] = [];
    const subfolders = ["originals", "items", "edited", "mobile"];
    for (const sub of subfolders) {
      const { data: subList } = await supabase.storage.from(BUCKET).list(`${id}/${sub}`, { limit: 1000 });
      if (subList) for (const f of subList) paths.push(`${id}/${sub}/${f.name}`);
    }
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from("rti_documents").delete().eq("id", id);
    if (error) throw error;
  }

  async listOriginals(docId: string): Promise<RtiOriginal[]> {
    const { data, error } = await supabase
      .from("rti_originals")
      .select("*")
      .eq("document_id", docId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as RtiOriginal[];
  }

  async uploadItemFile(docId: string, file: File, kind: "pdf" | "image"): Promise<string> {
    const path = `${docId}/items/${crypto.randomUUID()}-${slugify(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: mimeForItem(kind, file.name),
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async uploadEdited(docId: string, blob: Blob, finalName: string): Promise<string> {
    const path = `${docId}/edited/${Date.now()}-${slugify(finalName)}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async downloadFromPath(path: string, filename: string, mime: string): Promise<File> {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) throw error ?? new Error("Download failed");
    return new File([data], filename, { type: mime });
  }

  // Drafts fallback to local IndexedDB for manual edit sessions
  async listDrafts(): Promise<DraftSummary[]> {
    return listIdbDrafts();
  }

  async loadDraft(id: string): Promise<ManualDraft | null> {
    return loadIdbDraft(id);
  }

  async saveDraft(draft: ManualDraft): Promise<void> {
    return saveIdbDraft(draft);
  }

  async renameDraft(id: string, name: string): Promise<void> {
    return renameIdbDraft(id, name);
  }

  async deleteDraft(id: string): Promise<void> {
    return deleteIdbDraft(id);
  }

  async createMobileToken(docId: string, ttlMinutes = 120): Promise<MobileToken> {
    await supabase.from("rti_mobile_tokens").delete().eq("document_id", docId);
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const expires_at = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const { data, error } = await supabase
      .from("rti_mobile_tokens")
      .insert({ document_id: docId, token, expires_at })
      .select()
      .single();
    if (error) throw error;
    return data as MobileToken;
  }

  async getOrCreateActiveMobileToken(docId: string, ttlMinutes = 120): Promise<MobileToken> {
    const { data } = await supabase
      .from("rti_mobile_tokens")
      .select("*")
      .eq("document_id", docId)
      .gt("expires_at", new Date(Date.now() + 5000).toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return data as MobileToken;
    return this.createMobileToken(docId, ttlMinutes);
  }

  async getTokenInfo(token: string): Promise<MobileToken | null> {
    const { data } = await supabase
      .from("rti_mobile_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    return (data as MobileToken) ?? null;
  }

  async uploadMobileFile(docId: string, token: string, file: File): Promise<string> {
    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    const contentType = isPdf
      ? "application/pdf"
      : lower.endsWith(".png") || file.type === "image/png"
        ? "image/png"
        : lower.endsWith(".webp") || file.type === "image/webp"
          ? "image/webp"
          : "image/jpeg";

    const path = `${docId}/items/${Date.now()}-${crypto.randomUUID()}-mobile-${slugify(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
    await supabase
      .from("rti_mobile_tokens")
      .update({ expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
      .eq("token", token);
    return path;
  }

  async listMobileUploads(docId: string): Promise<{ name: string; path: string }[]> {
    const { data } = await supabase.storage
      .from(BUCKET)
      .list(`${docId}/items`, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (!data) return [];
    return data
      .filter((f) => f.name.includes("-mobile-"))
      .map((f) => ({ name: f.name.replace(/^\d+-[a-f0-9-]+-mobile-/, ""), path: `${docId}/items/${f.name}` }));
  }
}
