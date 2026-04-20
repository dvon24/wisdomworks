import { describe, it, expect } from 'vitest';
import {
  INDUSTRY_TEMPLATES,
  PROFESSIONAL_SERVICES_TEMPLATE,
  SMALL_BUSINESS_TEMPLATE,
  getTemplate,
  findTemplateForBusiness,
  PERSONAL_TEMPLATES,
  PERSONAL_BLUEPRINTS,
  getPersonalTemplate,
} from './index';

describe('Industry Templates', () => {
  it('has Professional Services and Small Business templates', () => {
    expect(INDUSTRY_TEMPLATES).toHaveLength(2);
    expect(getTemplate('professional_services')).toBeDefined();
    expect(getTemplate('small_business')).toBeDefined();
  });

  it('Professional Services has 9 agents', () => {
    expect(PROFESSIONAL_SERVICES_TEMPLATE.defaultAgents).toHaveLength(9);
    const roles = PROFESSIONAL_SERVICES_TEMPLATE.defaultAgents.map((a) => a.role);
    expect(roles).toContain('founder');
    expect(roles).toContain('project_manager');
    expect(roles).toContain('business_analyst');
    expect(roles).toContain('communications');
    expect(roles).toContain('hr');
    expect(roles).toContain('finance');
  });

  it('Small Business has 4 agents', () => {
    expect(SMALL_BUSINESS_TEMPLATE.defaultAgents).toHaveLength(4);
    const roles = SMALL_BUSINESS_TEMPLATE.defaultAgents.map((a) => a.role);
    expect(roles).toContain('scheduler');
    expect(roles).toContain('marketing');
    expect(roles).toContain('website_manager');
    expect(roles).toContain('customer_service');
  });

  it('findTemplateForBusiness maps hair_stylist to small_business', () => {
    const template = findTemplateForBusiness('hair_stylist');
    expect(template?.id).toBe('small_business');
  });

  it('findTemplateForBusiness maps consulting_firm to professional_services', () => {
    const template = findTemplateForBusiness('consulting_firm');
    expect(template?.id).toBe('professional_services');
  });

  it('every agent has modelRouting configured', () => {
    for (const template of INDUSTRY_TEMPLATES) {
      for (const agent of template.defaultAgents) {
        expect(Object.keys(agent.modelRouting).length, `${template.id}/${agent.role} has no model routing`).toBeGreaterThan(0);
      }
    }
  });

  it('templates are extensible — getTemplate returns undefined for unknown', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });
});

describe('Personal Templates', () => {
  it('defines 5 personal templates', () => {
    expect(PERSONAL_TEMPLATES).toHaveLength(5);
  });

  it('has all expected template types', () => {
    const ids = PERSONAL_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('personal_assistant');
    expect(ids).toContain('creative_professional');
    expect(ids).toContain('health_wellness');
    expect(ids).toContain('student');
    expect(ids).toContain('leadership_development');
  });

  it('Health & Wellness has HIPAA privacy level', () => {
    const hw = getPersonalTemplate('health_wellness');
    expect(hw?.privacyLevel).toBe('hipaa_intent');
    expect(hw?.defaultGovernanceOverrides.length).toBeGreaterThan(0);
    expect(hw?.defaultGovernanceOverrides.some((r) => r.action === 'share_data' && r.effect === 'deny')).toBe(true);
  });

  it('Personal Assistant has standard privacy', () => {
    const pa = getPersonalTemplate('personal_assistant');
    expect(pa?.privacyLevel).toBe('standard');
  });

  it('defines 3 personal blueprints', () => {
    expect(Object.keys(PERSONAL_BLUEPRINTS)).toHaveLength(3);
    expect(PERSONAL_BLUEPRINTS.individual).toBeDefined();
    expect(PERSONAL_BLUEPRINTS.family).toBeDefined();
    expect(PERSONAL_BLUEPRINTS.creator).toBeDefined();
  });

  it('Individual blueprint: 1 user, 2-3 agents, $5-15/mo', () => {
    const bp = PERSONAL_BLUEPRINTS.individual;
    expect(bp.userRange).toEqual([1, 1]);
    expect(bp.agentRange).toEqual([2, 3]);
    expect(bp.priceRange).toEqual([5, 15]);
  });
});
