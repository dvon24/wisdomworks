-- Story 2.16 — Document evaluation registry.
--
-- Tracks documents the owner has SENT to Iris (PDFs via WhatsApp,
-- attachments from Outlook/Gmail) along with the Claude-generated
-- analysis. Lets agents recall past analyses ("what was in that
-- contract I sent you last week") via the existing knowledge query
-- patterns.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS received_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Where the doc came from. 'whatsapp' (owner sent), 'outlook_attachment',
  -- 'gmail_attachment', 'manual' (admin upload)
  source TEXT NOT NULL DEFAULT 'whatsapp',
  -- Original filename if we have it (whatsapp document caption sometimes has it)
  filename TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  -- Public URL of the stored file (Supabase received-docs bucket)
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  -- Claude's analysis output — structured for fast recall
  summary TEXT,
  key_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_amounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Free-form metadata (e.g. source_message_id for whatsapp, email_id for attachments)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle. 'analyzed' = success. 'analysis_failed' = we have the file but couldn't process.
  -- 'processing' = mid-flight (rare, the analysis is sync within the receive path).
  status TEXT NOT NULL DEFAULT 'analyzed',
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT received_documents_source_check
    CHECK (source IN ('whatsapp', 'outlook_attachment', 'gmail_attachment', 'manual')),
  CONSTRAINT received_documents_status_check
    CHECK (status IN ('processing', 'analyzed', 'analysis_failed'))
);

CREATE INDEX IF NOT EXISTS received_documents_tenant_idx
  ON received_documents (tenant_phone, analyzed_at DESC);

-- For full-text recall via knowledge_base in the future, the summary
-- column will be embedded. For now Iris recalls via this table directly.
CREATE INDEX IF NOT EXISTS received_documents_tags_gin
  ON received_documents USING gin (tags);

SELECT 'received_documents ready' AS status;
