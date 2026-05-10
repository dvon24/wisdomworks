/**
 * Agent categories — the "lane" each agent operates in.
 *
 * Modeled after BMAD's module concept (cis = Creative & Innovation Suite,
 * bmm = Build Methodology Module, etc). Every agent_config carries a
 * category in config.category so:
 *   1. Agents can be told to STAY IN THEIR LANE in tick prompts
 *   2. The orchestrator can route work by category ("send this to your
 *      operations agent")
 *   3. The deck can group, filter, and badge agents by lane
 *   4. Capability/tool defaults can be applied per category
 *
 * Categories are intentionally broad — a Marketing Agent and a Brand
 * Manager and a Content Creator all sit in 'marketing'. The agent's
 * specific role/name still distinguishes them.
 */

export type AgentCategory =
  | 'orchestrator'
  | 'operations'
  | 'sales'
  | 'marketing'
  | 'support'
  | 'finance'
  | 'analytics'
  | 'creative'
  | 'people'
  | 'technical'
  | 'legal'
  | 'specialist';

export interface CategoryDefinition {
  id: AgentCategory;
  label: string;
  /** Short description of the lane — used in system prompts */
  domain: string;
  /** Channels this kind of agent typically uses */
  typicalChannels: string[];
  /** Tools/integrations this kind of agent typically needs */
  typicalTools: string[];
  /** Stay-in-lane guidance for the tick system prompt */
  laneGuidance: string;
  /** Emoji shortcut for UI rendering */
  emoji: string;
}

export const AGENT_CATEGORIES: Record<AgentCategory, CategoryDefinition> = {
  orchestrator: {
    id: 'orchestrator',
    label: 'Orchestrator',
    domain: 'coordinates the rest of the team, surfaces patterns across all domains, primary point of contact for the owner',
    typicalChannels: ['WhatsApp', 'CommandDeck'],
    typicalTools: ['Project Management', 'Communication', 'Calendar'],
    laneGuidance: 'You are the cross-domain synthesizer. You may pull signal from ANY agent and route work to whoever owns it. You DO NOT do specialist work yourself — you coordinate.',
    emoji: '✦',
  },
  operations: {
    id: 'operations',
    label: 'Operations',
    domain: 'project management, internal logistics, client coordination, recurring processes, scheduling, task tracking',
    typicalChannels: ['Email', 'Calendar', 'WhatsApp', 'Project Management'],
    typicalTools: ['CRM', 'Project Management', 'Calendar', 'Communication'],
    laneGuidance: 'Stay in operations: scheduling, project tracking, internal coordination. Defer marketing decisions to a marketing agent. Defer client outreach to sales. Defer financial decisions to finance.',
    emoji: '⚙️',
  },
  sales: {
    id: 'sales',
    label: 'Sales & Business Development',
    domain: 'lead generation, prospect outreach, deal pipeline, contract negotiation, account expansion, partnership development',
    typicalChannels: ['Email', 'CRM', 'WhatsApp', 'LinkedIn'],
    typicalTools: ['CRM', 'Email', 'LinkedIn', 'Calendar'],
    laneGuidance: 'Stay in sales/BD: prospecting, deal flow, account growth. Defer day-to-day operations to ops. Defer marketing campaigns to marketing. Defer billing/contracts execution to finance/legal.',
    emoji: '🤝',
  },
  marketing: {
    id: 'marketing',
    label: 'Marketing & Brand',
    domain: 'campaigns, content creation, brand voice, social media, audience growth, channel engagement, messaging',
    typicalChannels: ['Email', 'Instagram', 'Twitter', 'LinkedIn', 'Website'],
    typicalTools: ['Instagram', 'Content Creation', 'Scheduling', 'Email', 'Analytics'],
    laneGuidance: 'Stay in marketing/brand: campaigns, content, audience engagement. Defer specific deal-by-deal outreach to sales. Defer client onboarding to operations.',
    emoji: '🎯',
  },
  support: {
    id: 'support',
    label: 'Customer Support',
    domain: 'inbound customer questions, issue resolution, satisfaction tracking, FAQ management, escalation triage',
    typicalChannels: ['Email', 'WhatsApp', 'Chat', 'Phone'],
    typicalTools: ['CRM', 'Email', 'WhatsApp', 'Knowledge Base'],
    laneGuidance: 'Stay in support: customer-facing inbound. Hand actively-selling motions to sales. Hand product/operational complaints that need fixing to operations.',
    emoji: '🛟',
  },
  finance: {
    id: 'finance',
    label: 'Finance',
    domain: 'invoicing, billing, expense tracking, cashflow, budget reporting, financial forecasting, vendor payments',
    typicalChannels: ['Email', 'Accounting Software'],
    typicalTools: ['Stripe', 'QuickBooks', 'Email', 'Spreadsheets'],
    laneGuidance: 'Stay in finance: money in, money out, reporting. Defer business strategy to analytics. Defer contract negotiation to legal/sales.',
    emoji: '💰',
  },
  analytics: {
    id: 'analytics',
    label: 'Analytics & Strategy',
    domain: 'cross-functional data analysis, KPI tracking, strategic recommendations, opportunity identification, market intelligence',
    typicalChannels: ['Email', 'Dashboard'],
    typicalTools: ['Analytics', 'Spreadsheets', 'Database'],
    laneGuidance: 'Stay in analytics/strategy: read the data, surface patterns, recommend direction. Do NOT execute the recommendations yourself — hand them to the operating agent in the right lane.',
    emoji: '📊',
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    domain: 'design, copywriting, visual content, brand assets, video, photography',
    typicalChannels: ['Instagram', 'Email', 'Website'],
    typicalTools: ['Content Creation', 'Design Tools', 'Instagram'],
    laneGuidance: 'Stay in creative: produce assets and copy. Defer distribution strategy to marketing. Defer publishing decisions to whoever owns the channel.',
    emoji: '🎨',
  },
  people: {
    id: 'people',
    label: 'People & HR',
    domain: 'hiring, recruiting, onboarding, team coordination, performance, culture, compensation',
    typicalChannels: ['Email', 'LinkedIn', 'WhatsApp'],
    typicalTools: ['LinkedIn', 'Applicant Tracking', 'HRIS', 'Email'],
    laneGuidance: 'Stay in people: hiring, team health, internal HR. Defer day-to-day work assignment to operations. Defer payroll execution to finance.',
    emoji: '👥',
  },
  technical: {
    id: 'technical',
    label: 'Technical / Engineering',
    domain: 'product/website development, IT operations, system maintenance, infrastructure, integrations',
    typicalChannels: ['Email', 'Slack', 'GitHub'],
    typicalTools: ['GitHub', 'VS Code', 'Cloud Console', 'Email'],
    laneGuidance: 'Stay technical: build, deploy, maintain systems. Defer feature priority to product/operations. Defer marketing copy to marketing.',
    emoji: '⚡',
  },
  legal: {
    id: 'legal',
    label: 'Legal & Compliance',
    domain: 'contracts, compliance, risk review, IP, vendor agreements, policy',
    typicalChannels: ['Email'],
    typicalTools: ['Document Management', 'Email'],
    laneGuidance: 'Stay legal/compliance: review, flag risk, draft contracts. Do NOT make business or strategic decisions — surface implications and let the owner decide.',
    emoji: '⚖️',
  },
  specialist: {
    id: 'specialist',
    label: 'Specialist',
    domain: 'a niche function that does not fit a standard lane',
    typicalChannels: ['Email', 'WhatsApp'],
    typicalTools: [],
    laneGuidance: 'Stay focused on your specific specialty. Defer anything outside your declared scope to whoever owns the relevant lane.',
    emoji: '★',
  },
};

/**
 * Categorize an agent by inspecting its name + role + description.
 * Returns the best-matching AgentCategory.
 */
export function categorizeAgent(input: {
  name?: string;
  role?: string;
  description?: string;
}): AgentCategory {
  const haystack = `${input.name ?? ''} ${input.role ?? ''} ${input.description ?? ''}`.toLowerCase();

  // Order matters — check more-specific patterns before broad ones.
  if (/orchestrat|coordinator|personal assistant|chief of staff|executive assistant/i.test(haystack)) return 'orchestrator';
  if (/legal|compliance|contract|counsel|attorney/i.test(haystack)) return 'legal';
  if (/finance|account|book|billing|invoice|cashflow|treasur/i.test(haystack)) return 'finance';
  if (/recruit|hiring|talent|hr |human resources|people\b|onboard.*employee|culture/i.test(haystack)) return 'people';
  if (/analytic|insight|intelligence|strateg|data scientist|forecast|kpi/i.test(haystack)) return 'analytics';
  if (/sales|biz dev|business development|account executive|partnership|deal/i.test(haystack)) return 'sales';
  if (/marketing|brand|content|social media|campaign|seo|growth/i.test(haystack)) return 'marketing';
  if (/customer (?:care|support|service)|support|help.?desk|cs\b/i.test(haystack)) return 'support';
  if (/design|creative|copy|writer|video|photograph|art\b/i.test(haystack)) return 'creative';
  if (/engineer|developer|technical|devops|infra|sysadmin|backend|frontend|website manager|web manager/i.test(haystack)) return 'technical';
  if (/operations|ops\b|logistics|project manager|process|admin|operations manager/i.test(haystack)) return 'operations';

  return 'specialist';
}

export function getCategoryDefinition(category: AgentCategory): CategoryDefinition {
  return AGENT_CATEGORIES[category] ?? AGENT_CATEGORIES.specialist;
}
