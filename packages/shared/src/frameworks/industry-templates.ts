/**
 * Industry Templates — prebuilt agent rosters and configurations per industry.
 * Combined with Blueprints to generate AxisDeploymentSpecs.
 *
 * Blueprint × Template × Business Type = AxisDeploymentSpec
 */

import type { AgentSpec } from '../types/deployment-spec';

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  targetIndustries: string[];
  defaultAgents: AgentSpec[];
  defaultIntegrations: string[];
  defaultOutputChannels: string[];
}

/**
 * Professional Services template — consulting, legal, accounting.
 * Full agent roster with organizational intelligence.
 */
export const PROFESSIONAL_SERVICES_TEMPLATE: IndustryTemplate = {
  id: 'professional_services',
  name: 'Professional Services',
  description: 'Consulting firms, law firms, accounting firms — full organizational intelligence',
  targetIndustries: ['consulting_firm', 'law_firm', 'accounting_firm', 'real_estate_office'],
  defaultAgents: [
    {
      role: 'founder',
      name: 'Founder Agent',
      modelRouting: {
        orchestration: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        strategy: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        delegation: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'project_manager',
      name: 'Project Manager Agent',
      modelRouting: {
        planning: { provider: 'openai', model: 'gpt-4o' },
        status_reporting: { provider: 'openai', model: 'gpt-4o-mini' },
        scheduling: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['email', 'dashboard', 'calendar'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'business_analyst',
      name: 'Business Analyst Agent',
      modelRouting: {
        analysis: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        requirements: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        documentation: { provider: 'openai', model: 'gpt-4o' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'communications',
      name: 'Communications Agent',
      modelRouting: {
        writing: { provider: 'openai', model: 'gpt-4o' },
        editing: { provider: 'openai', model: 'gpt-4o' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [
        { action: 'send_external', effect: 'deny', conditions: { requiresApproval: true } },
      ],
    },
    {
      role: 'hr',
      name: 'HR Agent',
      modelRouting: {
        policy: { provider: 'openai', model: 'gpt-4o' },
        scheduling: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'finance',
      name: 'Finance Agent',
      modelRouting: {
        reporting: { provider: 'openai', model: 'gpt-4o' },
        analysis: { provider: 'openai', model: 'gpt-4o' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [
        { action: 'financial_transaction', effect: 'deny', conditions: { requiresApproval: true } },
      ],
    },
  ],
  defaultIntegrations: ['email', 'calendar', 'directory', 'project_management', 'document_management'],
  defaultOutputChannels: ['email', 'dashboard', 'desktop', 'calendar'],
};

/**
 * Small Business template — salon, restaurant, retail, trades.
 * Lean agent team focused on scheduling, marketing, and customer service.
 */
export const SMALL_BUSINESS_TEMPLATE: IndustryTemplate = {
  id: 'small_business',
  name: 'Small Business',
  description: 'Solo operators and small teams — scheduling, marketing, customer care',
  targetIndustries: [
    'hair_stylist', 'barber', 'cosmetician', 'personal_trainer',
    'restaurant', 'cafe', 'retail_shop',
    'electrician', 'plumber', 'hvac_tech', 'auto_mechanic', 'landscaper',
    'dentist', 'chiropractor',
    'photography_studio', 'construction_company',
  ],
  defaultAgents: [
    {
      role: 'scheduler',
      name: 'Scheduling Agent',
      modelRouting: {
        parse_appointments: { provider: 'openai', model: 'gpt-4o-mini' },
        conflict_detection: { provider: 'openai', model: 'gpt-4o-mini' },
        reminders: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['whatsapp', 'sms', 'voice', 'calendar'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'marketing',
      name: 'Marketing Agent',
      modelRouting: {
        write_promos: { provider: 'openai', model: 'gpt-4o' },
        analyze_engagement: { provider: 'openai', model: 'gpt-4o-mini' },
        social_content: { provider: 'openai', model: 'gpt-4o' },
      },
      outputChannels: ['email', 'whatsapp'],
      governanceRules: [
        { action: 'send_external', effect: 'deny', conditions: { requiresApproval: true } },
      ],
    },
    {
      role: 'website_manager',
      name: 'Website Manager Agent',
      modelRouting: {
        content_updates: { provider: 'openai', model: 'gpt-4o' },
        seo: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'customer_service',
      name: 'Customer Care Agent',
      modelRouting: {
        respond_inquiries: { provider: 'openai', model: 'gpt-4o' },
        followup: { provider: 'openai', model: 'gpt-4o-mini' },
        review_responses: { provider: 'openai', model: 'gpt-4o' },
      },
      outputChannels: ['email', 'whatsapp', 'voice'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
  ],
  defaultIntegrations: ['calendar', 'payment_processing'],
  defaultOutputChannels: ['whatsapp', 'sms', 'voice', 'calendar'],
};

/** All available templates */
export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  PROFESSIONAL_SERVICES_TEMPLATE,
  SMALL_BUSINESS_TEMPLATE,
];

/** Look up a template by ID */
export function getTemplate(id: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find((t) => t.id === id);
}

/** Find the best template for a business type */
export function findTemplateForBusiness(businessTypeId: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find((t) => t.targetIndustries.includes(businessTypeId));
}
