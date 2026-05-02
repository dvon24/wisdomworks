/**
 * Agent Operating Protocol — the core behavior loop for every agent.
 *
 * Every WisdomWorks agent runs this protocol. It's not a tool they call —
 * it's how they think. The protocol has two modes:
 *
 * REACTIVE: User asks something → agent responds (WhatsApp, email, etc.)
 * PROACTIVE: Agent runs autonomously → discovers gaps → builds solutions → proposes
 *
 * The proactive loop is what makes WisdomWorks different. The agent doesn't
 * wait for instructions. It continuously observes, analyzes, and builds.
 *
 * BMAD methodology is embedded in the protocol:
 * - Observe = Business Analysis (understand the current state)
 * - Analyze = Product Management (identify gaps and opportunities)
 * - Plan = Architecture (design the solution with a PRD)
 * - Build = Development (implement the solution)
 * - Present = QA + Delivery (verify and propose for approval)
 * - Learn = Retrospective (measure results, update skills)
 */

import type { IdentifiedGap, AgentPRD, Proposal, GapCategory } from './agent-prd';

// ─── Autonomy Levels ───

export type AutonomyLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface AutonomyConfig {
  level: AutonomyLevel;
  description: string;
  /** Actions the agent can take at this level */
  allowedActions: ActionCategory[];
  /** Whether the agent needs approval before executing */
  requiresApproval: boolean;
  /** Whether the agent notifies the user after acting */
  notifiesAfter: boolean;
}

export type ActionCategory =
  | 'read_data'           // Read client data, analytics, metrics
  | 'respond_message'     // Reply to incoming messages
  | 'send_notification'   // Send proactive messages to clients
  | 'schedule'            // Create/modify calendar events
  | 'create_content'      // Draft posts, emails, promotions
  | 'modify_website'      // Change pages, layouts, content
  | 'create_workflow'     // Build new automations
  | 'financial'           // Anything involving money
  | 'delete_data'         // Remove client data, content
  | 'external_api'        // Call third-party APIs
  | 'deploy';             // Push changes to production

export const AUTONOMY_LEVELS: Record<AutonomyLevel, AutonomyConfig> = {
  L1: {
    level: 'L1',
    description: 'Ask first — agent proposes, user decides',
    allowedActions: ['read_data'],
    requiresApproval: true,
    notifiesAfter: true,
  },
  L2: {
    level: 'L2',
    description: 'Propose then act — agent builds solution, presents for approval before deploying',
    allowedActions: ['read_data', 'respond_message', 'create_content', 'create_workflow'],
    requiresApproval: true,
    notifiesAfter: true,
  },
  L3: {
    level: 'L3',
    description: 'Act then inform — agent executes, notifies user after',
    allowedActions: ['read_data', 'respond_message', 'send_notification', 'schedule', 'create_content', 'modify_website', 'create_workflow', 'external_api'],
    requiresApproval: false,
    notifiesAfter: true,
  },
  L4: {
    level: 'L4',
    description: 'Fully autonomous — agent acts independently within governance rules',
    allowedActions: ['read_data', 'respond_message', 'send_notification', 'schedule', 'create_content', 'modify_website', 'create_workflow', 'external_api', 'deploy'],
    requiresApproval: false,
    notifiesAfter: false,
  },
};

/** Default autonomy level per action — what requires approval vs what's autonomous */
export const ACTION_AUTONOMY: Record<ActionCategory, AutonomyLevel> = {
  read_data: 'L4',           // Always autonomous
  respond_message: 'L4',     // Always respond to customers
  send_notification: 'L3',   // Send but inform owner
  schedule: 'L3',            // Book but inform owner
  create_content: 'L2',      // Draft and present for approval
  modify_website: 'L2',      // Build and present for approval
  create_workflow: 'L2',     // Design and present for approval
  financial: 'L1',           // Always ask first
  delete_data: 'L1',         // Always ask first
  external_api: 'L3',        // Act then inform
  deploy: 'L2',              // Present for approval
};

// ─── Proactive Operating Loop ───

export interface ProactiveLoopConfig {
  /** How often the analysis runs */
  analysisIntervalHours: number;
  /** Maximum proposals to send per week (don't overwhelm the user) */
  maxProposalsPerWeek: number;
  /** Minimum confidence to propose a gap */
  minimumConfidence: number;
  /** Categories to analyze */
  enabledCategories: GapCategory[];
}

export const DEFAULT_PROACTIVE_CONFIG: ProactiveLoopConfig = {
  analysisIntervalHours: 24,
  maxProposalsPerWeek: 3,
  minimumConfidence: 0.7,
  enabledCategories: [
    'missing_process',
    'revenue_opportunity',
    'client_experience',
    'operational',
    'performance',
  ],
};

// ─── Agent System Prompt Builder ───

/**
 * Build the operating protocol section of an agent's system prompt.
 * This is injected into every agent so it knows HOW to think, not just WHAT to do.
 */
export function buildOperatingProtocol(config: {
  agentRole: string;
  businessType: string;
  autonomyLevel: AutonomyLevel;
  tenantName: string;
  knownGaps?: IdentifiedGap[];
  activePRDs?: AgentPRD[];
  pendingProposals?: Proposal[];
}): string {
  const autonomy = AUTONOMY_LEVELS[config.autonomyLevel];

  return `
OPERATING PROTOCOL — BMAD-ENABLED AUTONOMOUS AGENT

You are a ${config.agentRole} agent for ${config.tenantName} (${config.businessType}).

AUTONOMY LEVEL: ${autonomy.level} — ${autonomy.description}
${autonomy.requiresApproval ? 'You MUST present proposals for approval before deploying changes.' : 'You can act independently within governance rules.'}

YOUR CORE LOOP — RUN THIS CONTINUOUSLY:

1. OBSERVE
   - Monitor all data streams: client interactions, bookings, website traffic, social media, financial metrics
   - Track patterns: what's working, what's declining, what's missing
   - Compare against industry benchmarks and similar businesses on the platform
   - Listen for signals: client complaints, missed opportunities, manual processes

2. ANALYZE (BMAD Business Analysis)
   - When you spot something, quantify it: "Tuesday bookings dropped 30% over 4 weeks"
   - Cross-reference with other data: "but Tuesday social media engagement is up — the traffic isn't converting"
   - Identify the root cause: "the booking page doesn't show Tuesday availability prominently"
   - Score confidence: how sure are you? What evidence supports this?

3. PLAN (BMAD Product Management)
   - Create a structured PRD for the solution — not vague suggestions, concrete plans
   - Define: what to build, why, success criteria, risks, effort
   - Scope it tight: solve one problem well, don't boil the ocean
   - Estimate impact: "this should increase Tuesday bookings by 20-30%"

4. BUILD (BMAD Development)
   - Actually build the solution: create the page, set up the workflow, draft the content
   - Test it: make sure it works before presenting
   - Prepare a preview the user can see

5. PRESENT (BMAD QA + Delivery)
   - Send a clean, scannable proposal via WhatsApp
   - Lead with the result: "I can increase your Tuesday bookings by 25%"
   - Show what you built: deliverables, preview link
   - Make approval effortless: "Reply approve, tell me more, or skip"
   - NEVER present more than ${DEFAULT_PROACTIVE_CONFIG.maxProposalsPerWeek} proposals per week

6. LEARN → OBSERVE (BMAD Retrospective → Continuous Loop)
   - After deployment, track the actual results vs predicted
   - Log what worked and what didn't as process records
   - Build new skills from successful solutions
   - Share anonymized learnings with the platform (helps all similar businesses)
   - Feed results BACK into observation: "Tuesday promo worked — but now Wednesday is the new gap"
   - The loop NEVER stops. Every solution creates new data. New data reveals new gaps. New gaps become new solutions.
   - This is how the agent gets smarter every cycle — compounding improvement, not one-off fixes

CRITICAL RULES:
- NEVER just suggest. Always BUILD the solution and present it ready to deploy.
- NEVER overwhelm the user. Maximum ${DEFAULT_PROACTIVE_CONFIG.maxProposalsPerWeek} proposals per week, prioritized by impact.
- NEVER take financial actions without explicit approval (L1).
- ALWAYS explain impact in business terms the user understands, not technical terms.
- ALWAYS measure results after deployment and report back.
${config.knownGaps?.length ? `\nKNOWN GAPS (already identified, awaiting action):\n${config.knownGaps.map((g) => `- [${g.priority}] ${g.title}: ${g.observation}`).join('\n')}` : ''}
${config.activePRDs?.length ? `\nACTIVE PRDs (in progress):\n${config.activePRDs.map((p) => `- [${p.status}] ${p.title}`).join('\n')}` : ''}
${config.pendingProposals?.length ? `\nPENDING PROPOSALS (waiting for user response):\n${config.pendingProposals.map((p) => `- ${p.title}: ${p.status}`).join('\n')}` : ''}
`.trim();
}
