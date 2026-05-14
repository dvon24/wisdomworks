-- Story 6.2 — RLS defense-in-depth on every tenant-scoped table.
--
-- Audit finding: 0 of 49 tenant-scoped tables had RLS enabled. The serverless
-- API layer uses SUPABASE_SERVICE_ROLE_KEY for all reads + writes, which
-- bypasses RLS by design (service_role has BYPASSRLS attribute). So adding
-- RLS now is purely defense-in-depth — it does NOT break any existing
-- code path. It activates the moment ANY caller uses the anon key against
-- a tenant-scoped table.
--
-- Strategy:
--   1. app_tenant_phone() helper reads the current tenant identity from
--      either (a) a Supabase JWT claim `phone` (preferred — future state)
--      or (b) a session-level `app.tenant_phone` setting (fallback for our
--      custom HMAC session tokens; app code would set this via
--      set_config('app.tenant_phone', $phone, true) before queries).
--      Returns NULL if neither is set → all rows denied for anon callers.
--
--   2. ENABLE ROW LEVEL SECURITY on each tenant-scoped table.
--
--   3. ONE permissive policy per table: tenant_isolation, FOR ALL,
--      USING + WITH CHECK enforcing tenant_phone = app_tenant_phone().
--      (whatsapp_contexts + oauth_connections use phone_number column.)
--
--   4. Helper function _enable_tenant_rls(table, column) does the
--      enable+drop+create with table-existence guards so the migration
--      is order-resilient. Cleaned up at end.
--
-- Cross-tenant tables (business_type_skills, business_type_skill_contributors,
-- processed_messages) are intentionally NOT enabled — they're either
-- shared-read or service-role-only. Future work can add per-table policies
-- if needed.
--
-- Run once in the Supabase SQL Editor.

-- ─── 1. Tenant identity helper ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_tenant_phone() RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_phone TEXT;
BEGIN
  -- Preferred path: Supabase JWT claim. When deck/widget callers eventually
  -- migrate to anon-key + JWT auth, this lights up automatically.
  BEGIN
    v_phone := current_setting('request.jwt.claims', true)::json->>'phone';
    IF v_phone IS NOT NULL AND v_phone <> '' THEN
      RETURN v_phone;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- claim absent or malformed — fall through
    NULL;
  END;

  -- Fallback path: session-level setting. App code that's still on the
  -- service-role pattern could opt INTO RLS-mode by calling
  -- SELECT set_config('app.tenant_phone', $phone, true) before queries.
  BEGIN
    v_phone := current_setting('app.tenant_phone', true);
    IF v_phone IS NOT NULL AND v_phone <> '' THEN
      RETURN v_phone;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app_tenant_phone() IS
  'Story 6.2 — resolves the current tenant identity from JWT claim or session var. Returns NULL if neither is set (RLS policies then deny all rows for non-service-role callers).';

-- ─── 2. Admin helper to apply RLS + policy ──────────────────────────────────

CREATE OR REPLACE FUNCTION _enable_tenant_rls(p_table TEXT, p_column TEXT DEFAULT 'tenant_phone')
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_policy TEXT := 'tenant_isolation';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = p_table) THEN
    RETURN format('SKIPPED %I (table not found)', p_table);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column) THEN
    RETURN format('SKIPPED %I (column %I not found)', p_table, p_column);
  END IF;

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', v_policy, p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR ALL TO authenticated, anon USING (%I = app_tenant_phone()) WITH CHECK (%I = app_tenant_phone())',
    v_policy, p_table, p_column, p_column
  );

  RETURN format('OK %I (column %I)', p_table, p_column);
END;
$$;

-- ─── 3. Apply RLS to every tenant-scoped table ──────────────────────────────

-- Tables that scope by `tenant_phone` column (the vast majority).
SELECT _enable_tenant_rls('agent_configs');
SELECT _enable_tenant_rls('agent_instances');
SELECT _enable_tenant_rls('agent_runs');
SELECT _enable_tenant_rls('agent_consultations');
SELECT _enable_tenant_rls('agent_skills');
SELECT _enable_tenant_rls('agent_skill_applications');
SELECT _enable_tenant_rls('agent_state_snapshots');
SELECT _enable_tenant_rls('business_insights');
SELECT _enable_tenant_rls('channel_link_codes');
SELECT _enable_tenant_rls('chat_runs');
SELECT _enable_tenant_rls('client_photos');
SELECT _enable_tenant_rls('client_profiles');
SELECT _enable_tenant_rls('client_visits');
SELECT _enable_tenant_rls('credential_access_log');
SELECT _enable_tenant_rls('email_classification_corrections');
SELECT _enable_tenant_rls('email_classification_samples');
SELECT _enable_tenant_rls('email_contacts');
SELECT _enable_tenant_rls('email_engagement_signals');
SELECT _enable_tenant_rls('email_followup_proposals');
SELECT _enable_tenant_rls('email_voice_profiles');
SELECT _enable_tenant_rls('event_webhooks');
SELECT _enable_tenant_rls('event_webhook_deliveries');
SELECT _enable_tenant_rls('knowledge_atoms');         -- table created later than initial audit
SELECT _enable_tenant_rls('knowledge_chunks');
SELECT _enable_tenant_rls('known_people');
SELECT _enable_tenant_rls('lessons_learned');
SELECT _enable_tenant_rls('marketing_autonomy_prefs');
SELECT _enable_tenant_rls('marketing_drafts');
SELECT _enable_tenant_rls('marketing_post_metrics');
SELECT _enable_tenant_rls('marketing_styles');
SELECT _enable_tenant_rls('notification_queue');
SELECT _enable_tenant_rls('ontology_entities');
SELECT _enable_tenant_rls('ontology_relationships');
SELECT _enable_tenant_rls('overage_events');
SELECT _enable_tenant_rls('process_records');
SELECT _enable_tenant_rls('project_connections');
SELECT _enable_tenant_rls('project_snapshots');
SELECT _enable_tenant_rls('received_documents');
SELECT _enable_tenant_rls('research_requests');
SELECT _enable_tenant_rls('tenant_channels');
SELECT _enable_tenant_rls('tenant_configs');
SELECT _enable_tenant_rls('tenant_disposition_rules');
SELECT _enable_tenant_rls('tenant_events');
SELECT _enable_tenant_rls('tenant_knowledge_atoms');
SELECT _enable_tenant_rls('tenant_sites');
SELECT _enable_tenant_rls('tenant_voice_config');
SELECT _enable_tenant_rls('video_generation_jobs');
SELECT _enable_tenant_rls('voice_calls');
SELECT _enable_tenant_rls('widget_api_keys');
SELECT _enable_tenant_rls('widget_conversations');

-- Tables that scope by `phone_number` (canonical tenant tables created
-- outside the migration repo).
SELECT _enable_tenant_rls('whatsapp_contexts', 'phone_number');
SELECT _enable_tenant_rls('oauth_connections', 'phone_number');

-- Tables INTENTIONALLY skipped:
--   processed_messages       — idempotency, tenant_phone nullable, service-role only
--   business_type_skills     — shared cross-tenant dictionary
--   business_type_skill_contributors — same as above

-- ─── 4. Cleanup the admin helper ────────────────────────────────────────────

DROP FUNCTION _enable_tenant_rls(TEXT, TEXT);

SELECT 'RLS tenant-isolation policies installed on all tenant-scoped tables' AS status;
