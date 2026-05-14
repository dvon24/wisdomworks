-- Story 6.7 — GDPR/CCPA Right-to-Be-Forgotten + Data Export.
--
-- Two RPCs:
--   delete_tenant_data(phone)  — atomic deletion across every tenant-scoped
--                                 table. Returns per-table row counts.
--   list_tenant_tables()       — read-only enumeration of which tables are
--                                 tenant-scoped (drives the TS-side export).
--
-- Deletion is intentionally a single transaction. Either everything deletes
-- cleanly or nothing does (rollback on first error). Half-deleted tenants
-- are worse than not-deleted ones — surfaces FK conflicts as a hard error
-- the operator can fix and retry.
--
-- Retained tables (NOT deleted):
--   unified_audit_log     — append-only audit trail (security epic
--                           memory: "audit log entries are append-only,
--                           never deleted, retained per the compliance
--                           regime that applies")
--   credential_access_log — same audit purpose
--   overage_events        — billing record; legal retention obligations
--                           often exceed deletion-request window
--
-- Caller responsibility: log a deletion audit entry to unified_audit_log
-- BEFORE invoking delete_tenant_data. The audit trail of the deletion
-- itself must outlive the deleted data.
--
-- Run once in the Supabase SQL Editor.

-- ─── Canonical list of tenant-scoped tables ────────────────────────────────
-- Returns (table_name, tenant_column). The TS-side data exporter iterates
-- this to build the export bundle, and delete_tenant_data uses it as the
-- delete target list. ONE source of truth so adding a new tenant-scoped
-- table only requires updating this function.

CREATE OR REPLACE FUNCTION list_tenant_tables()
RETURNS TABLE (table_name TEXT, tenant_column TEXT)
LANGUAGE sql STABLE AS $$
  SELECT t::TEXT, 'tenant_phone'::TEXT FROM UNNEST(ARRAY[
    'agent_configs', 'agent_instances', 'agent_runs', 'agent_consultations',
    'agent_skills', 'agent_skill_applications', 'agent_state_snapshots',
    'business_insights', 'channel_link_codes', 'chat_runs',
    'client_photos', 'client_profiles', 'client_visits',
    'credential_access_log',
    'email_classification_corrections', 'email_classification_samples',
    'email_contacts', 'email_engagement_signals', 'email_followup_proposals',
    'email_voice_profiles', 'event_webhooks', 'event_webhook_deliveries',
    'knowledge_atoms', 'knowledge_chunks', 'known_people', 'lessons_learned',
    'marketing_autonomy_prefs', 'marketing_drafts', 'marketing_post_metrics',
    'marketing_styles', 'notification_queue', 'ontology_entities',
    'ontology_relationships', 'overage_events', 'process_records',
    'project_connections', 'project_snapshots', 'received_documents',
    'research_requests', 'tenant_channels', 'tenant_compliance_profiles',
    'tenant_configs', 'tenant_disposition_rules', 'tenant_events',
    'tenant_knowledge_atoms', 'tenant_sites', 'tenant_voice_config',
    'unified_audit_log', 'video_generation_jobs', 'voice_calls',
    'widget_api_keys', 'widget_conversations'
  ]) AS t
  UNION ALL
  SELECT t::TEXT, 'phone_number'::TEXT FROM UNNEST(ARRAY[
    'whatsapp_contexts', 'oauth_connections'
  ]) AS t;
$$;

GRANT EXECUTE ON FUNCTION list_tenant_tables() TO authenticated, anon, service_role;

-- ─── delete_tenant_data ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_tenant_data(p_tenant_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_counts JSONB := '{}'::jsonb;
  v_count INT;
  v_table TEXT;
  v_column TEXT;
  v_retained TEXT[] := ARRAY['unified_audit_log', 'credential_access_log', 'overage_events'];
BEGIN
  IF p_tenant_phone IS NULL OR p_tenant_phone = '' THEN
    RAISE EXCEPTION 'tenant_phone required';
  END IF;

  FOR v_table, v_column IN
    SELECT table_name, tenant_column FROM list_tenant_tables()
  LOOP
    -- Skip retained tables. Their data is the audit trail of what was
    -- deleted; killing it would defeat the audit purpose.
    IF v_table = ANY(v_retained) THEN
      v_counts := jsonb_set(v_counts, ARRAY[v_table], to_jsonb('retained'::text));
      CONTINUE;
    END IF;

    -- Defensive: skip if the table doesn't exist (migration ordering).
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND information_schema.tables.table_name = v_table) THEN
      v_counts := jsonb_set(v_counts, ARRAY[v_table], to_jsonb('missing'::text));
      CONTINUE;
    END IF;

    EXECUTE format('DELETE FROM %I WHERE %I = $1', v_table, v_column) USING p_tenant_phone;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := jsonb_set(v_counts, ARRAY[v_table], to_jsonb(v_count));
  END LOOP;

  RETURN v_counts;
END;
$$;

COMMENT ON FUNCTION delete_tenant_data(TEXT) IS
  'Story 6.7 — atomic GDPR/CCPA right-to-be-forgotten. Deletes every tenant-scoped row across all tables except the retained audit/billing tables. Single transaction: rollback on first error. Caller must log a deletion audit entry to unified_audit_log BEFORE invoking this.';

GRANT EXECUTE ON FUNCTION delete_tenant_data(TEXT) TO service_role;

SELECT 'data export + deletion RPCs ready' AS status;
