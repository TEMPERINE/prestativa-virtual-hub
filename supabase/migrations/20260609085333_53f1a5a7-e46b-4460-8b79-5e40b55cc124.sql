
CREATE POLICY "Authenticated read sprite sheets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'sprite-sheets');

CREATE POLICY "Admin writes sprite sheets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sprite-sheets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin updates sprite sheets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'sprite-sheets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin deletes sprite sheets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'sprite-sheets' AND public.has_role(auth.uid(), 'admin'));
