/**
 * Agent PRD System — BMAD-enabled autonomous product development.
 *
 * When an agent identifies a gap in a customer's business, it doesn't just
 * suggest a fix — it creates a full PRD, builds the solution, and presents
 * it for approval. This is what makes WisdomWorks different: every customer
 * gets an autonomous product team.
 *
 * Flow:
 * 1. Gap Analysis → Agent spots an opportunity from data
 * 2. PRD Generation → Agent creates a structured plan
 * 3. Implementation → Agent builds the solution
 * 4. Proposal → Agent presents for approval via WhatsApp/email
 * 5. Deployment → Approved changes go live
 * 6. Learning → Results feed back into the learning engine
 */

// ─── Gap Analysis ───

export type GapCategory =
  | 'missing_process'      // No follow-up workflow, no referral system
  | 'performance'          // Slow page, high bounce rate, poor SEO
  | 'revenue_opportunity'  // Untapped service, pricing gap, upsell opportunity
  | 'client_experience'    // Friction in booking, poor mobile, missing info
  | 'operational'          // Manual work that should be automated
  | 'competitive'          // Competitors have something they don't
  | 'compliance'           // Missing legal pages, accessibility issues
  | 'growth';              // Expansion opportunities based on trends

export interface IdentifiedGap {
  id: string;
  tenantId: string;
  category: GapCategory;
  title: string;
  /** What the agent observed */
  observation: string;
  /** Data points that support the finding */
  evidence: GapEvidence[];
  /** How confident the agent is (0-1) */
  confidence: number;
  /** Estimated impact if addressed */
  estimatedImpact: {
    metric: string;
    currentValue: string;
    projectedValue: string;
    basis: string; // "based on industry benchmarks" or "based on similar businesses on platform"
  };
  /** Priority based on impact × confidence × effort */
  priority: 'critical' | 'high' | 'medium' | 'low';
  discoveredAt: string;
  discoveredBy: string; // agentId
}

export interface GapEvidence {
  type: 'metric' | 'benchmark' | 'pattern' | 'client_feedback' | 'competitor' | 'industry_data';
  description: string;
  value?: string;
  source: string;
}

// ─── Agent PRD ───

export type PRDStatus =
  | 'draft'        // Agent is still building the PRD
  | 'ready'        // PRD complete, waiting for user approval
  | 'approved'     // User approved, implementation starting
  | 'in_progress'  // Agent is building the solution
  | 'review'       // Solution built, user reviewing
  | 'deployed'     // Live in production
  | 'measuring'    // Deployed, tracking results
  | 'dismissed';   // User said no

export interface AgentPRD {
  id: string;
  tenantId: string;
  /** The gap this PRD addresses */
  gapId: string;
  /** Which agent created this */
  createdBy: string;

  // ─── The PRD itself ───

  title: string;
  /** One-sentence summary for WhatsApp */
  summary: string;

  /** What problem does this solve? */
  problem: {
    statement: string;
    impact: string;
    evidence: string[];
  };

  /** What are we building? */
  solution: {
    description: string;
    /** Concrete deliverables */
    deliverables: Deliverable[];
    /** What NOT to build (scope control) */
    outOfScope: string[];
  };

  /** How do we know it worked? */
  successCriteria: {
    metric: string;
    target: string;
    measureAfterDays: number;
  }[];

  /** What could go wrong? */
  risks: {
    risk: string;
    mitigation: string;
    severity: 'low' | 'medium' | 'high';
  }[];

  /** Estimated effort */
  effort: {
    agentHours: number; // How long for the agent to build
    userTimeMinutes: number; // How much of the user's time is needed (ideally near zero)
    requiresUserInput: string[]; // Specific things the user needs to provide
  };

  /** Implementation plan — the agent's build steps */
  implementationSteps: ImplementationStep[];

  // ─── Lifecycle ───

  status: PRDStatus;
  createdAt: string;
  approvedAt?: string;
  deployedAt?: string;
  /** Results after deployment */
  results?: {
    metric: string;
    before: string;
    after: string;
    measuredAt: string;
  }[];
}

export interface Deliverable {
  type: 'page' | 'workflow' | 'integration' | 'automation' | 'content' | 'design' | 'analytics' | 'campaign';
  title: string;
  description: string;
  /** What platform/tool is used to build this */
  platform?: string;
}

export interface ImplementationStep {
  order: number;
  action: string;
  /** Which agent handles this step */
  assignedAgent: string;
  /** What tools/APIs are needed */
  tools: string[];
  /** Estimated time */
  estimatedMinutes: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// ─── Proposal (what the user sees) ───

export interface Proposal {
  id: string;
  tenantId: string;
  prdId: string;
  /** Short title for WhatsApp */
  title: string;
  /** 2-3 sentence summary */
  summary: string;
  /** What the user gets — plain language, no jargon */
  whatYouGet: string[];
  /** Expected outcome */
  expectedResult: string;
  /** How much of the user's time is needed */
  userEffort: string;
  /** Preview link if applicable */
  previewUrl?: string;
  /** User's response */
  status: 'pending' | 'approved' | 'modified' | 'dismissed';
  /** If modified, what the user changed */
  userFeedback?: string;
  presentedAt: string;
  respondedAt?: string;
}

// ─── Functions ───

/**
 * Generate a gap analysis for a tenant.
 * Called by the proactive analysis agent on a schedule.
 */
export function createGap(
  tenantId: string,
  agentId: string,
  data: Omit<IdentifiedGap, 'id' | 'tenantId' | 'discoveredAt' | 'discoveredBy'>,
): IdentifiedGap {
  return {
    ...data,
    id: crypto.randomUUID(),
    tenantId,
    discoveredAt: new Date().toISOString(),
    discoveredBy: agentId,
  };
}

/**
 * Create a PRD from an identified gap.
 * The agent fills in the structured plan.
 */
export function createPRD(
  tenantId: string,
  agentId: string,
  gapId: string,
  prd: Omit<AgentPRD, 'id' | 'tenantId' | 'gapId' | 'createdBy' | 'status' | 'createdAt'>,
): AgentPRD {
  return {
    ...prd,
    id: crypto.randomUUID(),
    tenantId,
    gapId,
    createdBy: agentId,
    status: 'ready',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Convert a PRD into a user-facing proposal.
 * This is what gets sent via WhatsApp — clean, simple, actionable.
 */
export function createProposal(prd: AgentPRD): Proposal {
  return {
    id: crypto.randomUUID(),
    tenantId: prd.tenantId,
    prdId: prd.id,
    title: prd.title,
    summary: prd.summary,
    whatYouGet: prd.solution.deliverables.map((d) => d.description),
    expectedResult: prd.successCriteria.map((c) => `${c.metric}: ${c.target}`).join('. '),
    userEffort: prd.effort.userTimeMinutes <= 1
      ? 'Just tap approve — I handle everything'
      : `${prd.effort.userTimeMinutes} minutes of your time`,
    status: 'pending',
    presentedAt: new Date().toISOString(),
  };
}

/**
 * Format a proposal for WhatsApp delivery.
 * Clean, scannable, with clear action buttons.
 */
export function formatProposalForWhatsApp(proposal: Proposal): string {
  const lines = [
    `I found an improvement for your business:`,
    ``,
    `*${proposal.title}*`,
    `${proposal.summary}`,
    ``,
    `What you get:`,
    ...proposal.whatYouGet.map((item, i) => `${i + 1}. ${item}`),
    ``,
    `Expected result: ${proposal.expectedResult}`,
    `Your time needed: ${proposal.userEffort}`,
  ];

  if (proposal.previewUrl) {
    lines.push(``, `Preview: ${proposal.previewUrl}`);
  }

  lines.push(
    ``,
    `Reply:`,
    `- "approve" to deploy`,
    `- "tell me more" for details`,
    `- "skip" to pass`,
  );

  return lines.join('\n');
}

/**
 * Format a results report after deployment.
 * Sent to the user to show the impact of an approved PRD.
 */
export function formatResultsForWhatsApp(prd: AgentPRD): string {
  if (!prd.results?.length) return '';

  const lines = [
    `Results update on: *${prd.title}*`,
    ``,
    ...prd.results.map((r) => `${r.metric}: ${r.before} -> ${r.after}`),
    ``,
    `Measured ${prd.results[0]?.measuredAt ? `on ${new Date(prd.results[0].measuredAt).toLocaleDateString()}` : 'recently'}.`,
  ];

  return lines.join('\n');
}
