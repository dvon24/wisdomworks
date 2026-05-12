-- Phase 1B — Agent peer consultations.
--
-- Cross-pollination without crosstalk noise. When Riley spots an email
-- mentioning Au7o, she can consult Alex before escalating. When Alex
-- spots a deploy that touches finances, he asks Marcus. The peer answers
-- on their next tick; the asker sees the answer on the tick after.
--
-- Loop prevention: propagation_depth cap (max 1 hop, the asker cannot
-- be re-consulted in the same chain). Timeout: if a peer doesn't answer
-- in 2 ticks (~10 min) the asker proceeds without the consult.
--
-- Trigger conditions (agents self-trigger, server validates):
--   - pre_escalation: before setting escalation_priority='high'
--   - cross_domain: observation mentions entities outside own lane
--   - recurring_stuck: same observation 2+ ticks with no resolution
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Who's asking
  from_agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  from_agent_name TEXT NOT NULL,
  -- Who's being asked (specific peer, not a lane)
  to_agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  to_agent_name TEXT NOT NULL,
  -- The actual ask
  question TEXT NOT NULL,
  reason TEXT,
  -- Why this consult was warranted
  trigger_kind TEXT NOT NULL DEFAULT 'pre_escalation',
  -- Answer (filled in when peer responds)
  answer TEXT,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'asked',
  -- Loop guard: depth=1 = original, depth=2 = consult-of-consult (blocked)
  propagation_depth INTEGER NOT NULL DEFAULT 1,
  -- If this consult was spawned from another consult, link back
  parent_consultation_id UUID REFERENCES agent_consultations(id) ON DELETE SET NULL,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT agent_consultations_status_check CHECK (
    status IN ('asked', 'answered', 'timeout', 'declined')
  ),
  CONSTRAINT agent_consultations_trigger_check CHECK (
    trigger_kind IN ('pre_escalation', 'cross_domain', 'recurring_stuck', 'owner_directed')
  ),
  CONSTRAINT agent_consultations_depth_check CHECK (
    propagation_depth >= 1 AND propagation_depth <= 2
  )
);

CREATE INDEX IF NOT EXISTS agent_consultations_inbox_idx
  ON agent_consultations (to_agent_instance_id, status, asked_at)
  WHERE status = 'asked';

CREATE INDEX IF NOT EXISTS agent_consultations_outbox_idx
  ON agent_consultations (from_agent_instance_id, status, asked_at DESC);

CREATE INDEX IF NOT EXISTS agent_consultations_tenant_idx
  ON agent_consultations (tenant_phone, asked_at DESC);


-- ─── expire_stale_consultations ────────────────────────────────────────────
-- Anything still 'asked' past expires_at gets marked 'timeout' so the asker
-- can proceed without waiting forever.
CREATE OR REPLACE FUNCTION expire_stale_consultations()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE agent_consultations
  SET status = 'timeout'
  WHERE status = 'asked'
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ─── inbox_for_agent ───────────────────────────────────────────────────────
-- Pending consults targeting this agent. Agents read this on their tick
-- and answer ONE per tick (priority by recency).
CREATE OR REPLACE FUNCTION consult_inbox_for_agent(p_agent_instance_id UUID)
RETURNS TABLE (
  id UUID,
  from_agent_name TEXT,
  question TEXT,
  reason TEXT,
  trigger_kind TEXT,
  asked_at TIMESTAMPTZ,
  propagation_depth INTEGER
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, from_agent_name, question, reason, trigger_kind, asked_at, propagation_depth
  FROM agent_consultations
  WHERE to_agent_instance_id = p_agent_instance_id
    AND status = 'asked'
    AND expires_at >= now()
  ORDER BY asked_at ASC
  LIMIT 5;
$$;


-- ─── outbox_for_agent ──────────────────────────────────────────────────────
-- Answered/timed-out consults the asking agent should fold into next tick.
CREATE OR REPLACE FUNCTION consult_outbox_for_agent(p_agent_instance_id UUID, p_lookback_minutes INTEGER DEFAULT 30)
RETURNS TABLE (
  id UUID,
  to_agent_name TEXT,
  question TEXT,
  answer TEXT,
  status TEXT,
  answered_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, to_agent_name, question, answer, status, answered_at
  FROM agent_consultations
  WHERE from_agent_instance_id = p_agent_instance_id
    AND status IN ('answered', 'timeout')
    AND COALESCE(answered_at, asked_at) >= now() - (p_lookback_minutes || ' minutes')::interval
    AND metadata->>'folded_in' IS NULL  -- not yet incorporated into a tick
  ORDER BY asked_at DESC;
$$;

SELECT 'agent_consultations + expire/inbox/outbox RPCs ready' AS status;
