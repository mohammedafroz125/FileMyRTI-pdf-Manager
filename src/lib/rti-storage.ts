import { supabase } from "@/integrations/supabase/client";

export type RtiStatus = "pending" | "waiting_ack" | "completed";
export type RtiTypeSelected = "RTI Application" | "First Appeal";

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
  rti_type_selected: RtiTypeSelected | null;
  deletion_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RtiOriginal = {
  id: string;
  document_id: string;
  path: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type SavedPlanItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  path: string;
};

export type SavedTimelineEntry =
  | { id: string; type: "original-page"; originalId: string; pageIndex: number; rotation?: number }
  | { id: string; type: "item"; itemId: string; rotation?: number };

export type SavedPlan = {
  items: SavedPlanItem[];
  timeline: SavedTimelineEntry[];
};

const BUCKET = "rti-files";

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
}

// -------- Originals --------

export async function uploadOriginalFile(docId: string, file: File): Promise<string> {
  const path = `${docId}/originals/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function createProjectWithOriginals(
  customerName: string,
  files: File[],
): Promise<RtiDocument> {
  if (files.length === 0) throw new Error("At least one PDF is required.");

  // Insert doc first so we have an id for storage paths.
  const first = files[0];
  const firstPath = await uploadTempOriginal(first);
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
  // Move first file into project folder for consistency.
  const finalFirstPath = await moveObject(firstPath, `${doc.id}/originals/0-${slugify(first.name)}.pdf`);
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

  // Update doc's original_path/name to point to the moved first file.
  const { data: updated, error: updErr } = await supabase
    .from("rti_documents")
    .update({ original_path: finalFirstPath, original_name: first.name })
    .eq("id", doc.id)
    .select()
    .single();
  if (updErr) throw updErr;
  return updated as RtiDocument;
}

async function uploadTempOriginal(file: File): Promise<string> {
  const path = `_incoming/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function moveObject(from: string, to: string): Promise<string> {
  const { error } = await supabase.storage.from(BUCKET).move(from, to);
  if (error) {
    // Fallback: copy+delete-ish is unavailable; if move fails, keep original path.
    return from;
  }
  return to;
}

export async function listOriginals(docId: string): Promise<RtiOriginal[]> {
  const { data, error } = await supabase
    .from("rti_originals")
    .select("*")
    .eq("document_id", docId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RtiOriginal[];
}

// -------- Documents --------

export async function listDocuments(): Promise<RtiDocument[]> {
  const { data, error } = await supabase
    .from("rti_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RtiDocument[];
}

export async function getDocument(id: string): Promise<RtiDocument> {
  const { data, error } = await supabase.from("rti_documents").select("*").eq("id", id).single();
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
    rti_type_selected: RtiTypeSelected;
    deletion_scheduled_at: string | null;
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

export async function deleteDocumentData(id: string): Promise<void> {
  // Delete all storage objects under this id/ prefix.
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

export async function loadItemFile(item: SavedPlanItem): Promise<File> {
  return downloadFromPath(item.path, item.name, mimeForItem(item.kind, item.name));
}

// -------- Mobile upload tokens --------

export type MobileToken = {
  id: string;
  document_id: string;
  token: string;
  expires_at: string;
  created_at: string;
};

export async function createMobileToken(docId: string, ttlMinutes = 120): Promise<MobileToken> {
  // Deactivate any existing active tokens for this doc (delete for simplicity).
  await supabase.from("rti_mobile_tokens").delete().eq("document_id", docId);
  const token =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const expires_at = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("rti_mobile_tokens")
    .insert({ document_id: docId, token, expires_at })
    .select()
    .single();
  if (error) throw error;
  return data as MobileToken;
}

export async function getTokenInfo(token: string): Promise<MobileToken | null> {
  const { data } = await supabase
    .from("rti_mobile_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return (data as MobileToken) ?? null;
}

export async function uploadMobileFile(
  docId: string,
  token: string,
  file: File,
): Promise<string> {
  const lower = file.name.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
  const contentType = isPdf
    ? "application/pdf"
    : lower.endsWith(".png") || file.type === "image/png"
      ? "image/png"
      : "image/jpeg";
  const path = `${docId}/items/${crypto.randomUUID()}-mobile-${slugify(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  // Log an "upload event" as a mobile_uploads row via lightweight approach:
  // reuse rti_mobile_tokens? no. Just return path — the desktop realtime channel
  // picks up new storage objects via the token table's updated_at bump.
  await supabase
    .from("rti_mobile_tokens")
    .update({ expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
    .eq("token", token);
  return path;
}

export async function listMobileUploads(docId: string): Promise<{ name: string; path: string }[]> {
  const { data } = await supabase.storage
    .from(BUCKET)
    .list(`${docId}/items`, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (!data) return [];
  return data
    .filter((f) => f.name.includes("-mobile-"))
    .map((f) => ({ name: f.name.replace(/^[a-f0-9-]+-mobile-/, ""), path: `${docId}/items/${f.name}` }));
}
