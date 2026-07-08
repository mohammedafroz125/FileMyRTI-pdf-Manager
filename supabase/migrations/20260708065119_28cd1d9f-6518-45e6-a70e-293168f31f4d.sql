
CREATE POLICY "rti-files read" ON storage.objects FOR SELECT USING (bucket_id = 'rti-files');
CREATE POLICY "rti-files insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'rti-files');
CREATE POLICY "rti-files update" ON storage.objects FOR UPDATE USING (bucket_id = 'rti-files') WITH CHECK (bucket_id = 'rti-files');
CREATE POLICY "rti-files delete" ON storage.objects FOR DELETE USING (bucket_id = 'rti-files');
