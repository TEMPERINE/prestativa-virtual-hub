import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const paths = [
  'bda8d793-865e-4e19-aedf-0d4d3d0ee1f8/1780773838803.webm',
  '3da75ef7-f1c5-48e8-a7f9-f3010c3104ad/1780769078609.webm',
];

for (const path of paths) {
  const { error } = await supabaseAdmin.storage.from('meeting-recordings').remove([path]);
  if (error) console.error('Erro:', path, error.message);
  else console.log('OK:', path);
}
