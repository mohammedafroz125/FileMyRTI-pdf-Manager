
-- 1) Extend rti_documents
ALTER TABLE public.rti_documents
  ADD COLUMN IF NOT EXISTS rti_type_selected TEXT,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

-- 2) rti_originals
CREATE TABLE IF NOT EXISTS public.rti_originals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.rti_documents(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rti_originals_doc_idx ON public.rti_originals(document_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rti_originals TO anon, authenticated;
GRANT ALL ON public.rti_originals TO service_role;
ALTER TABLE public.rti_originals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal tool - anyone can read rti originals" ON public.rti_originals FOR SELECT USING (true);
CREATE POLICY "Internal tool - anyone can insert rti originals" ON public.rti_originals FOR INSERT WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can update rti originals" ON public.rti_originals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can delete rti originals" ON public.rti_originals FOR DELETE USING (true);

-- 3) rti_mobile_tokens
CREATE TABLE IF NOT EXISTS public.rti_mobile_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.rti_documents(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rti_mobile_tokens_token_idx ON public.rti_mobile_tokens(token);
CREATE INDEX IF NOT EXISTS rti_mobile_tokens_doc_idx ON public.rti_mobile_tokens(document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rti_mobile_tokens TO anon, authenticated;
GRANT ALL ON public.rti_mobile_tokens TO service_role;
ALTER TABLE public.rti_mobile_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal tool - anyone can read tokens" ON public.rti_mobile_tokens FOR SELECT USING (true);
CREATE POLICY "Internal tool - anyone can insert tokens" ON public.rti_mobile_tokens FOR INSERT WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can update tokens" ON public.rti_mobile_tokens FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can delete tokens" ON public.rti_mobile_tokens FOR DELETE USING (true);

-- 4) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rti_originals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rti_mobile_tokens;

-- 5) Backfill originals for existing documents
INSERT INTO public.rti_originals (document_id, path, name, sort_order)
SELECT d.id, d.original_path, d.original_name, 0
FROM public.rti_documents d
LEFT JOIN public.rti_originals o ON o.document_id = d.id
WHERE o.id IS NULL;
