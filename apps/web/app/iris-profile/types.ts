// API contract for the iris-profile endpoint.
// Mirrors the JSON returned by GET /api/iris-profile?phone=<tenant_phone>.

export type DispositionKind =
  | "preference"
  | "frustration_trigger"
  | "communication_style"
  | "correction"
  | "approval";

export interface DispositionRule {
  id: string;
  rule_text: string;
  why: string;
  evidence?: string;
  scope: string; // "everywhere" or comma-separated agent names
  confidence: number; // 0..1
  applied_count: number;
  last_applied_at: string; // ISO
  created_at: string; // ISO
}

export interface DispositionGroup {
  kind: DispositionKind;
  label: string;
  rules: DispositionRule[];
}

export type ActivityOutcome = "observed" | "proposed" | "acted" | "escalated";

export interface ActivitySample {
  outcome: ActivityOutcome | string; // server may include other tags (e.g. "drafted")
  text: string;
}

export interface AgentRecentActivity {
  total_ticks: number;
  by_outcome: Partial<Record<ActivityOutcome, number>>;
  last_acted_at?: string;
  sample_outputs: ActivitySample[];
}

export interface ProvenTechnique {
  technique: string;
  success_rate: number; // 0..1
  uses: number;
}

export interface Guardrail {
  rule: string;
  severity: "high" | "medium" | "low";
  reason: string;
}

export interface DomainFact {
  kind: "preference" | "constraint" | string;
  content: string;
}

export interface Agent {
  agent_name: string;
  agent_role: string;
  lane: string;
  description: string;
  recent_activity: AgentRecentActivity;
  capabilities: string[];
  proven_techniques: ProvenTechnique[];
  guardrails: Guardrail[];
  domain_facts: DomainFact[];
  idle?: boolean;
}

export interface LearningStats {
  total_rules: number;
  rules_by_kind: Partial<Record<DispositionKind, number>>;
  agents_with_skills: number;
  total_skills: number;
  earliest_rule_created_at: string;
  most_recent_rule_at: string;
}

export interface IrisProfile {
  tenant_phone: string;
  computed_at: string; // ISO
  learning_stats: LearningStats;
  disposition: DispositionGroup[];
  agents: Agent[];
}
