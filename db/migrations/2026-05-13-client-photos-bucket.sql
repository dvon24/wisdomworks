-- Story 2b.1 Phase 2 — Supabase Storage bucket for client photos.
--
-- Photos are tenant-isolated under the path layout:
--   {tenant_phone}/{yyyy}/{mm}/{uuid}.{ext}
--
-- Service role bypasses RLS so the webhook can upload. We don't expose
-- the bucket publicly — display in the deck uses signed URLs (30-day
-- expiry generated at upload time and stored on client_photos.display_url).
--
-- Run once in the Supabase SQL Editor.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-photos',
  'client-photos',
  false,
  16777216,  -- 16 MB cap per photo (WhatsApp caps at 5 MB anyway)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: service role is unrestricted (the webhook uses the
-- service-role key). Anonymous/authenticated roles can only read via
-- signed URLs which bypass these policies.

SELECT 'client-photos bucket ready' AS status;
