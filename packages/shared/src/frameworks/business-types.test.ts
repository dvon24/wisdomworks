import { describe, it, expect } from 'vitest';
import {
  BUSINESS_TYPE_DICTIONARY,
  BUSINESS_CATEGORIES,
  getBusinessType,
  getBusinessTypesByCategory,
} from './business-types';

describe('Business Type Framework Dictionary', () => {
  it('contains 20+ business types', () => {
    expect(BUSINESS_TYPE_DICTIONARY.length).toBeGreaterThanOrEqual(20);
  });

  it('every business type has required fields', () => {
    for (const bt of BUSINESS_TYPE_DICTIONARY) {
      expect(bt.id, `${bt.name} missing id`).toBeTruthy();
      expect(bt.name, `${bt.id} missing name`).toBeTruthy();
      expect(bt.category, `${bt.id} missing category`).toBeTruthy();
      expect(bt.requiredAgentRoles.length, `${bt.id} has no agent roles`).toBeGreaterThan(0);
      expect(bt.recommendedOutputChannels.length, `${bt.id} has no channels`).toBeGreaterThan(0);
      expect(bt.keyMetrics.length, `${bt.id} has no metrics`).toBeGreaterThan(0);
    }
  });

  it('all categories are represented', () => {
    const categories = new Set(BUSINESS_TYPE_DICTIONARY.map((bt) => bt.category));
    for (const cat of Object.keys(BUSINESS_CATEGORIES)) {
      expect(categories.has(cat as any), `Missing category: ${cat}`).toBe(true);
    }
  });

  it('getBusinessType finds by ID', () => {
    const electrician = getBusinessType('electrician');
    expect(electrician?.name).toBe('Electrician');
    expect(electrician?.category).toBe('skilled_trades');
  });

  it('getBusinessType returns undefined for unknown ID', () => {
    expect(getBusinessType('nonexistent')).toBeUndefined();
  });

  it('getBusinessTypesByCategory returns correct types', () => {
    const trades = getBusinessTypesByCategory('skilled_trades');
    expect(trades.length).toBeGreaterThanOrEqual(3);
    expect(trades.every((bt) => bt.category === 'skilled_trades')).toBe(true);
  });

  it('hair_stylist has visual intelligence enabled', () => {
    const stylist = getBusinessType('hair_stylist');
    expect(stylist?.visualIntelligence).toBe(true);
  });

  it('restaurant does NOT have visual intelligence', () => {
    const restaurant = getBusinessType('restaurant');
    expect(restaurant?.visualIntelligence).toBe(false);
  });

  it('all IDs are unique', () => {
    const ids = BUSINESS_TYPE_DICTIONARY.map((bt) => bt.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
