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
 * Suggest the best blueprint based on employee count.
 */
export function suggestBlueprint(employeeCount: number): BlueprintType {
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

  return `You are the WisdomWorks AI Onboarding Agent. Your job is to learn about the customer's business through natural conversation, then help them deploy their AI agent team.

COLLECTED SO FAR:
${collectedSummary || '(nothing yet)'}

STILL NEEDED (required):
${missing.length > 0 ? missing.map((f) => `- ${f}`).join('\n') : '(all required data collected!)'}

RECOMMENDED (optional but helpful):
${recommended.length > 0 ? recommended.map((f) => `- ${f}`).join('\n') : '(all recommended data collected!)'}

RULES:
- Ask ONE question at a time. Be conversational, not interrogative.
- Adapt your questions based on what you already know (a salon gets different questions than a consulting firm).
- When you have enough data, suggest the deployment plan and ask if they want to proceed.
- Never mention internal technical terms (blueprint, template, AxisDeploymentSpec). Use plain language.
- Be warm and professional. You're helping them build their AI team.
- If they mention a business type you recognize, use your knowledge of that type to ask better follow-up questions.`;
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
