import { supabase } from "@/integrations/supabase/client";

export type RtiStatus = "pending" | "waiting_ack" | "completed";

export type RtiDocument = {
  id: string;
  customer_name: string;
  rti_type: string;
  status: RtiStatus;
  original_path: string;
  original_name: string;
  edited_path: string | null;
  final_name: string | null;
  plan_json: SavedPlan | null;
  created_at: string;
  updated_at: string;
};

export type SavedPlanItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  path: string;
};

export type SavedTimelineEntry =
  | { id: string; type: "original-page"; pageIndex: number }
  | { id: string; type: "item"; itemId: string };

export type SavedPlan = {
  items: SavedPlanItem[];
  timeline: SavedTimelineEntry[];
};

const BUCKET = "rti-files";

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
}

export async function uploadOriginal(
  customerName: string,
  rtiType: string,
  file: File,
): Promise<{ path: string; name: string }> {
  const id = crypto.randomUUID();
  const path = `${id}/original-${slugify(file.name)}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name };
}

export async function createDocument(input: {
  customer_name: string;
  rti_type: string;
  original_path: string;
  original_name: string;
}): Promise<RtiDocument> {
  const { data, error } = await supabase
    .from("rti_documents")
    .insert({
      customer_name: input.customer_name,
      rti_type: input.rti_type,
      original_path: input.original_path,
      original_name: input.original_name,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data as RtiDocument;
}

export async function listDocuments(): Promise<RtiDocument[]> {
  const { data, error } = await supabase
    .from("rti_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RtiDocument[];
}

export async function getDocument(id: string): Promise<RtiDocument> {
  const { data, error } = await supabase
    .from("rti_documents")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as RtiDocument;
}

export async function downloadFromPath(path: string, filename: string, mime: string): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error("download failed");
  return new File([data], filename, { type: mime });
}

function mimeForItem(kind: "pdf" | "image", name: string) {
  if (kind === "pdf") return "application/pdf";
  return name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export async function uploadItemFile(
  docId: string,
  file: File,
  kind: "pdf" | "image",
): Promise<string> {
  const path = `${docId}/items/${crypto.randomUUID()}-${slugify(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: mimeForItem(kind, file.name),
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function uploadEdited(docId: string, blob: Blob, finalName: string): Promise<string> {
  const path = `${docId}/edited/${Date.now()}-${slugify(finalName)}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function updateDocument(
  id: string,
  patch: Partial<{
    status: RtiStatus;
    edited_path: string;
    final_name: string;
    plan_json: SavedPlan;
  }>,
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

export async function loadItemFile(item: SavedPlanItem): Promise<File> {
  return downloadFromPath(item.path, item.name, mimeForItem(item.kind, item.name));
}
