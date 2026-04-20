import { describe, it, expect } from 'vitest';
import {
  getRequiredFields,
  suggestBlueprint,
  suggestTemplate,
  getOnboardingSystemPrompt,
  createOnboardingState,
} from './onboarding-engine';
import type { OnboardingData } from './onboarding-engine';

describe('getRequiredFields', () => {
  it('returns all required fields when data is empty', () => {
    const result = getRequiredFields({});
    expect(result.missing).toContain('organizationName');
    expect(result.missing).toContain('industry');
    expect(result.missing).toContain('employeeCount');
    expect(result.readyToGenerate).toBe(false);
  });

  it('returns ready when all required fields collected', () => {
    const data: OnboardingData = {
      organizationName: 'Salon Bella',
      industry: 'personal_services',
      employeeCount: 1,
    };
    const result = getRequiredFields(data);
    expect(result.missing).toHaveLength(0);
    expect(result.readyToGenerate).toBe(true);
  });

  it('tracks recommended fields separately', () => {
    const data: OnboardingData = {
      organizationName: 'Test',
      industry: 'retail',
      employeeCount: 5,
    };
    const result = getRequiredFields(data);
    expect(result.recommended.length).toBeGreaterThan(0);
    expect(result.recommended).toContain('businessType');
  });
});

describe('suggestBlueprint', () => {
  it('suggests solo for 1-2 employees', () => {
    expect(suggestBlueprint({ employeeCount: 1 })).toBe('solo');
    expect(suggestBlueprint({ employeeCount: 2 })).toBe('solo');
  });

  it('suggests small_team for 3-20 employees', () => {
    expect(suggestBlueprint({ employeeCount: 3 })).toBe('small_team');
    expect(suggestBlueprint({ employeeCount: 20 })).toBe('small_team');
  });

  it('suggests mid_size for 21-200 employees', () => {
    expect(suggestBlueprint({ employeeCount: 50 })).toBe('mid_size');
    expect(suggestBlueprint({ employeeCount: 200 })).toBe('mid_size');
  });

  it('suggests enterprise for 200+ employees', () => {
    expect(suggestBlueprint({ employeeCount: 201 })).toBe('enterprise');
    expect(suggestBlueprint({ employeeCount: 1000 })).toBe('enterprise');
  });

  it('suggests personal when useCase is personal', () => {
    expect(suggestBlueprint({ useCase: 'personal', employeeCount: 1 })).toBe('personal');
  });

  it('suggests air_gapped when compliance includes air_gapped', () => {
    expect(suggestBlueprint({ employeeCount: 50, complianceRequirements: ['air_gapped'] })).toBe('air_gapped');
  });
});

describe('suggestTemplate', () => {
  it('suggests small_business for hair_stylist', () => {
    expect(suggestTemplate('hair_stylist')).toBe('small_business');
  });

  it('suggests professional_services for consulting_firm', () => {
    expect(suggestTemplate('consulting_firm')).toBe('professional_services');
  });

  it('returns undefined for unknown business type', () => {
    expect(suggestTemplate('unknown_type')).toBeUndefined();
  });
});

describe('getOnboardingSystemPrompt', () => {
  it('generates a system prompt with collected data', () => {
    const data: OnboardingData = { organizationName: 'Test Co' };
    const prompt = getOnboardingSystemPrompt(data);
    expect(prompt).toContain('WisdomWorks AI Onboarding Agent');
    expect(prompt).toContain('Test Co');
    expect(prompt).toContain('STILL NEEDED');
  });

  it('shows all required when no data collected', () => {
    const prompt = getOnboardingSystemPrompt({});
    expect(prompt).toContain('organizationName');
    expect(prompt).toContain('industry');
    expect(prompt).toContain('employeeCount');
  });
});

describe('createOnboardingState', () => {
  it('creates initial state with correct tenant', () => {
    const state = createOnboardingState('tenant-123');
    expect(state.tenantId).toBe('tenant-123');
    expect(state.status).toBe('in_progress');
    expect(state.collectedData).toEqual({});
    expect(state.conversationHistory).toEqual([]);
  });
});
