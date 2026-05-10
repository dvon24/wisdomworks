-- Story 1.11/1.12 cleanup — helpers to wipe a tenant's agent_configs +
-- agent_instances + ontology before a re-deploy, so renamed agents don't
-- coexist with their old names.
--
-- Called by /api/deploy-complete before the upsert pipeline runs so each
-- onboarding deployment is the canonical state.
--
-- Run once in the Supabase SQL Editor.

-- agent_configs cascades to agent_instances via FK; agent_instances cascades
-- to agent_runs. So this also clears stale ticks. Intentional: a re-deploy
-- is a fresh provisioning event.
CREATE OR REPLACE FUNCTION reset_tenant_agents(p_tenant_phone TEXT)
RETURNS TABLE(configs_deleted INTEGER, ontology_deleted INTEGER) AS $$
DECLARE
  cfgs INTEGER := 0;
  ents INTEGER := 0;
BEGIN
  WITH deleted AS (
    DELETE FROM agent_configs WHERE tenant_phone = p_tenant_phone RETURNING 1
  )
  SELECT count(*) INTO cfgs FROM deleted;

  -- Wipe ontology too — the new onboarding will rebuild from fresh data.
  -- agent_configs.entity_id has ON DELETE SET NULL so the order is safe
  -- regardless, but cleaning entities prevents stale role/documentation
  -- entities from compounding across deploys.
  WITH deleted AS (
    DELETE FROM ontology_entities WHERE tenant_phone = p_tenant_phone RETURNING 1
  )
  SELECT count(*) INTO ents FROM deleted;

  RETURN QUERY SELECT cfgs, ents;
END;
$$ LANGUAGE plpgsql;

SELECT 'reset_tenant_agents ready' AS status;
