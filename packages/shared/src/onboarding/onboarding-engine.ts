/**
 * Onboarding Engine — extracts structured data from AI conversation.
 *
 * The AI interviews the customer, and this engine:
 * 1. Tracks what data has been collected
 * 2. Determines what questions to ask next
 * 3. Suggests blueprint + template based on answers
 * 4. Signals when enough data is collected to generate AxisDeploymentSpec
 */

import { findTemplateForBusiness, getBusinessType } from '../frameworks';
import { BLUEPRINTS } from '../types/deployment-spec';
import type { BlueprintType } from '../types/deployment-spec';

export interface OnboardingState {
  tenantId: string;
  status: 'in_progress' | 'complete' | 'abandoned';
  collectedData: OnboardingData;
  suggestedBlueprint?: BlueprintType;
  suggestedTemplate?: string;
  conversationHistory: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingData {
  organizationName?: string;
  industry?: string;
  businessType?: string;
  employeeCount?: number;
  useCase?: 'business' | 'personal';
  teamStructure?: string[];
  keyWorkflows?: string[];
  painPoints?: string[];
  desiredCapabilities?: string[];
  existingTools?: string[];
  complianceRequirements?: string[];
  budgetRange?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** Fields required before we can generate an AxisDeploymentSpec */
const REQUIRED_FIELDS: (keyof OnboardingData)[] = [
  'organizationName',
  'industry',
  'employeeCount',
];

const RECOMMENDED_FIELDS: (keyof OnboardingData)[] = [
  'businessType',
  'keyWorkflows',
  'painPoints',
  'existingTools',
];

/**
 * Check what data is still needed from the customer.
 */
export function getRequiredFields(data: OnboardingData): {
  missing: (keyof OnboardingData)[];
  recommended: (keyof OnboardingData)[];
  readyToGenerate: boolean;
} {
  const missing = REQUIRED_FIELDS.filter((f) => !data[f]);
  const recommended = RECOMMENDED_FIELDS.filter((f) => !data[f]);

  return {
    missing,
    recommended,
    readyToGenerate: missing.length === 0,
  };
}

/**
 * Suggest the best blueprint based on onboarding data.
 */
export function suggestBlueprint(data: OnboardingData): BlueprintType {
  if (data.useCase === 'personal') return 'personal';
  if (data.complianceRequirements?.includes('air_gapped')) return 'air_gapped';

  const employeeCount = data.employeeCount ?? 1;
  if (employeeCount <= 2) return 'solo';
  if (employeeCount <= 20) return 'small_team';
  if (employeeCount <= 200) return 'mid_size';
  return 'enterprise';
}

/**
 * Suggest the best template based on business type.
 */
export function suggestTemplate(businessTypeId: string): string | undefined {
  const template = findTemplateForBusiness(businessTypeId);
  return template?.id;
}

/**
 * Generate the system prompt for the onboarding AI.
 */
export function getOnboardingSystemPrompt(currentData: OnboardingData): string {
  const { missing, recommended } = getRequiredFields(currentData);

  const collectedSummary = Object.entries(currentData)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  return `You are the WisdomWorks AI Onboarding Agent. Your job is to learn about the customer's business, educate them on what inefficiency costs them, then deploy their AI agent team.

COLLECTED SO FAR:
${collectedSummary || '(nothing yet)'}

STILL NEEDED (required):
${missing.length > 0 ? missing.map((f) => `- ${f}`).join('\n') : '(all required data collected!)'}

RULES:
- If the user provides detail upfront (business type, tools, client volume, pain points), DO NOT ask unnecessary follow-ups. You likely have enough — go to the cost education phase immediately.
- Maximum 1 question before presenting the cost of inaction. If they front-loaded info, 0 questions.
- Never mention internal technical terms (blueprint, template, AxisDeploymentSpec).
- Be warm, knowledgeable, and conversational — like a trusted advisor, not a salesperson.
- If they share a website URL or social media, acknowledge it — you'll connect to it.

CRITICAL — EVERY EMPLOYEE GETS AN AGENT:
WisdomWorks deploys 1 AI agent per employee, tiered by intelligence:
- Tier 1 (Opus 4.7): Owner + department heads — full reasoning, decision-making
- Tier 2 (Sonnet 4.6): Department coordination, compliance, analytics
- Tier 3 (Haiku 4.5): Every individual employee — personal assistant for schedules, procedures, tasks
Plus cross-cutting agents for HR, safety, finance, leadership coaching.

A 100-person company gets ~115 agents. A solo stylist gets 3-4. Scale with the business.

CONVERSATION FLOW — THREE PHASES:

PHASE 1: UNDERSTAND (1 message max)
Acknowledge their business. Ask only what you genuinely don't know. If they told you enough, skip directly to Phase 2.

PHASE 2: EDUCATE — COST OF NOT HAVING WISDOMWORKS
BEFORE presenting agents, educate them on what inefficiency is costing them right now. Use REAL citations:

"Here's something most business owners don't realize — not having streamlined AI processes is already costing you money:

• **McKinsey Global Institute** found employees spend 28% of their work week just managing email and 20% searching for internal information — that's nearly half their time on tasks AI handles instantly

• **Harvard Business Review** research shows companies that respond to leads within 1 hour are 7x more likely to qualify them. Most businesses take 42 hours to respond. Every slow response is lost revenue

• **SHRM** estimates replacing a single employee costs 6-9 months of their salary. When employees leave, their process knowledge leaves with them — AI retains everything permanently

• **Asana's Work Index** found 60% of work time is 'work about work' — coordination, status updates, searching for information — not actual productive work

For a business like yours, that translates to roughly:
• [Calculate based on their employee count and business type — time waste, missed opportunities, knowledge loss, inconsistent processes]
• Total estimated cost of not having AI: $X/month

Your AI team would cost a fraction of that — and proves its value with real data every month."

Make the numbers SPECIFIC to their business. A solo stylist loses $1,500-2,000/month in missed calls and admin time. A 100-person logistics company loses $50,000-80,000/month in coordination waste and inconsistency. Use the citations naturally — like a knowledgeable advisor sharing research, not a PowerPoint.

PHASE 3: PRESENT THE TEAM
After the cost education, present their AI team:

For solo/small businesses (1-20 people):
"Your AI team would address all of this. Here's what I'd recommend:

🤖 **Your AI Team (X agents):**
• **[Agent name]** — [role] — [what they do, which channels they use]
[...]

Your agents connect to [their existing tools]. Nothing changes for you or your clients.

📋 **Next steps:**
1. **Review your AI team** — I can explain any agent in detail
2. **See estimated pricing** — based on your specific needs
3. **Start your trial** — see your agents in action

What would you like to do?"

For larger businesses (20+ people):
Organize agents by DEPARTMENT. Every employee gets a personal agent (Tier 3). Department heads get Tier 1. Show the total count.

"🤖 **Your AI Team (~X agents):**

**Leadership** — You + your [N] managers each get a personal AI assistant (Tier 1)
**[Department 1]** — [N] agents handling [specific functions]
**[Department 2]** — [N] agents handling [specific functions]
**Every Employee** — Each of your [N] team members gets a personal AI assistant for scheduling, procedures, and task tracking
**Cross-Cutting** — Safety, compliance, HR, finance, analytics

[...]"

The pricing is determined by what they need. The cost comparison makes the price feel small.`;

}

/**
 * Create an initial onboarding state for a new customer.
 */
export function createOnboardingState(tenantId: string): OnboardingState {
  return {
    tenantId,
    status: 'in_progress',
    collectedData: {},
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
