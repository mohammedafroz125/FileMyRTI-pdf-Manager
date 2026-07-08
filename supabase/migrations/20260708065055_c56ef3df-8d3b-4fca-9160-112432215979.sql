
CREATE TABLE public.rti_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  rti_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','waiting_ack','completed')),
  original_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  edited_path TEXT,
  final_name TEXT,
  plan_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rti_documents TO anon, authenticated;
GRANT ALL ON public.rti_documents TO service_role;

ALTER TABLE public.rti_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal tool - anyone can read rti docs"
  ON public.rti_documents FOR SELECT USING (true);
CREATE POLICY "Internal tool - anyone can insert rti docs"
  ON public.rti_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can update rti docs"
  ON public.rti_documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Internal tool - anyone can delete rti docs"
  ON public.rti_documents FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_rti_documents_updated_at
  BEFORE UPDATE ON public.rti_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.rti_documents;
