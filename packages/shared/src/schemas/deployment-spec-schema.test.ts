import { describe, it, expect } from 'vitest';
import { axisDeploymentSpecSchema } from './deployment-spec-schema';
import { SOLO_EXAMPLE, MID_SIZE_EXAMPLE } from '../types/deployment-spec';

describe('axisDeploymentSpecSchema', () => {
  it('validates Solo example', () => {
    const result = axisDeploymentSpecSchema.safeParse(SOLO_EXAMPLE);
    expect(result.success).toBe(true);
  });

  it('validates Mid-Size example', () => {
    const result = axisDeploymentSpecSchema.safeParse(MID_SIZE_EXAMPLE);
    expect(result.success).toBe(true);
  });

  it('rejects missing organization name', () => {
    const invalid = { ...SOLO_EXAMPLE, organization: { ...SOLO_EXAMPLE.organization, name: '' } };
    const result = axisDeploymentSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects empty agents array', () => {
    const invalid = { ...SOLO_EXAMPLE, agents: [] };
    const result = axisDeploymentSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid blueprint type', () => {
    const invalid = { ...SOLO_EXAMPLE, blueprint: 'invalid' };
    const result = axisDeploymentSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative pricing', () => {
    const invalid = { ...SOLO_EXAMPLE, pricing: { ...SOLO_EXAMPLE.pricing, total: -1 } };
    const result = axisDeploymentSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates all blueprint types', () => {
    for (const blueprint of ['personal', 'solo', 'small_team', 'mid_size', 'enterprise', 'air_gapped']) {
      const spec = { ...SOLO_EXAMPLE, blueprint, pricing: { ...SOLO_EXAMPLE.pricing, tier: blueprint } };
      const result = axisDeploymentSpecSchema.safeParse(spec);
      expect(result.success, `Failed for blueprint: ${blueprint}`).toBe(true);
    }
  });
});
