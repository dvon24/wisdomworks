-- Story 2.16 Phase 4 — Extend received_documents.source enum.
--
-- Adds 'drive_doc' and 'onedrive_doc' so cloud-pulled documents can
-- be stored alongside whatsapp / email-attachment sources. Same row
-- shape, same analysis flow.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE received_documents
  DROP CONSTRAINT IF EXISTS received_documents_source_check;

ALTER TABLE received_documents
  ADD CONSTRAINT received_documents_source_check
  CHECK (source IN (
    'whatsapp',
    'outlook_attachment',
    'gmail_attachment',
    'yahoo_attachment',
    'drive_doc',
    'onedrive_doc',
    'manual'
  ));

SELECT 'received_documents source constraint extended for cloud sources' AS status;
