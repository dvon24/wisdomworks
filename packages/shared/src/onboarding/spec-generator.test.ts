import { describe, it, expect } from 'vitest';
import { generateDeploymentSpec, generatePreview } from './spec-generator';
import type { OnboardingData } from './onboarding-engine';

describe('generateDeploymentSpec', () => {
  it('generates a valid spec for a solo hair stylist', () => {
    const data: OnboardingData = {
      organizationName: 'Salon Bella',
      industry: 'personal_services',
      businessType: 'hair_stylist',
      employeeCount: 1,
    };
    const spec = generateDeploymentSpec(data);
    expect(spec.organization.name).toBe('Salon Bella');
    expect(spec.blueprint).toBe('solo');
    expect(spec.template).toBe('small_business');
    expect(spec.agents.length).toBeGreaterThan(0);
    expect(spec.pricing.deposit).toBe(50);
    expect(spec.pricing.trialDays).toBe(30);
  });

  it('generates a valid spec for a mid-size consulting firm', () => {
    const data: OnboardingData = {
      organizationName: 'WisdomWorks Consulting',
      industry: 'professional_services',
      businessType: 'consulting_firm',
      employeeCount: 50,
    };
    const spec = generateDeploymentSpec(data);
    expect(spec.blueprint).toBe('mid_size');
    expect(spec.template).toBe('professional_services');
    expect(spec.surfaces.globe).toBe(true);
    expect(spec.surfaces.desktopApp).toBe(true);
    expect(spec.pricing.deposit).toBe(500);
    expect(spec.pricing.trialDays).toBe(60);
  });

  it('always includes webDashboard', () => {
    const spec = generateDeploymentSpec({
      organizationName: 'Test',
      industry: 'retail',
      employeeCount: 1,
    });
    expect(spec.surfaces.webDashboard).toBe(true);
  });

  it('passes Zod validation', () => {
    const spec = generateDeploymentSpec({
      organizationName: 'Test',
      industry: 'personal_services',
      businessType: 'barber',
      employeeCount: 2,
    });
    // If it doesn't throw, validation passed
    expect(spec.organization.name).toBe('Test');
  });
});

describe('generatePreview', () => {
  it('creates a preview from a spec', () => {
    const spec = generateDeploymentSpec({
      organizationName: 'Test Salon',
      industry: 'personal_services',
      businessType: 'hair_stylist',
      employeeCount: 1,
    });
    const preview = generatePreview(spec);
    expect(preview.agentRoster.length).toBeGreaterThan(0);
    expect(preview.costBreakdown.tier).toBe('solo');
    expect(preview.costBreakdown.deposit).toBe(50);
    expect(preview.surfaces).toContain('webDashboard');
    expect(preview.blueprint).toBe('solo');
    expect(preview.template).toBe('small_business');
  });

  it('agent roster includes capabilities', () => {
    const spec = generateDeploymentSpec({
      organizationName: 'Test',
      industry: 'personal_services',
      employeeCount: 1,
    });
    const preview = generatePreview(spec);
    for (const agent of preview.agentRoster) {
      expect(agent.capabilities.length).toBeGreaterThan(0);
    }
  });
});
