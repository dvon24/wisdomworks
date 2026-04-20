import { describe, it, expect } from 'vitest';
import { ChannelRegistry, DEFAULT_CHANNEL_ROUTING, CHANNEL_TYPES } from './channel-provider';
import type { CommunicationChannel } from './channel-provider';

const TEST_TENANT = 'tenant-test-123';

function createMockChannel(type: string): CommunicationChannel {
  return {
    channelType: type as any,
    send: async (msg) => ({ ...msg, id: 'test-id', timestamp: new Date().toISOString(), channelType: type as any, direction: 'outbound' as const }),
    onReceive: () => {},
    getHistory: async () => [],
    getStatus: async () => ({ channelType: type as any, connected: true }),
  };
}

describe('ChannelRegistry (tenant-scoped)', () => {
  it('registers and retrieves channels per tenant', () => {
    const registry = new ChannelRegistry();
    const channel = createMockChannel('whatsapp');
    registry.register(TEST_TENANT, channel);
    expect(registry.get(TEST_TENANT, 'whatsapp')).toBe(channel);
    expect(registry.has(TEST_TENANT, 'whatsapp')).toBe(true);
    expect(registry.has(TEST_TENANT, 'sms')).toBe(false);
  });

  it('isolates channels between tenants', () => {
    const registry = new ChannelRegistry();
    const channelA = createMockChannel('whatsapp');
    const channelB = createMockChannel('whatsapp');
    registry.register('tenant-a', channelA);
    registry.register('tenant-b', channelB);
    expect(registry.get('tenant-a', 'whatsapp')).toBe(channelA);
    expect(registry.get('tenant-b', 'whatsapp')).toBe(channelB);
    expect(registry.get('tenant-a', 'whatsapp')).not.toBe(channelB);
  });

  it('routes to correct channel by urgency', () => {
    const registry = new ChannelRegistry();
    registry.register(TEST_TENANT, createMockChannel('sms'));
    registry.register(TEST_TENANT, createMockChannel('whatsapp'));
    registry.register(TEST_TENANT, createMockChannel('calendar'));

    expect(registry.route(TEST_TENANT, 'urgent')?.channelType).toBe('sms');
    expect(registry.route(TEST_TENANT, 'routine')?.channelType).toBe('whatsapp');
    expect(registry.route(TEST_TENANT, 'scheduling')?.channelType).toBe('calendar');
  });

  it('falls back to default when requested channel not registered', () => {
    const registry = new ChannelRegistry();
    registry.register(TEST_TENANT, createMockChannel('whatsapp'));
    const result = registry.route(TEST_TENANT, 'urgent');
    expect(result?.channelType).toBe('whatsapp');
  });

  it('returns all registered channels for a tenant', () => {
    const registry = new ChannelRegistry();
    registry.register(TEST_TENANT, createMockChannel('email'));
    registry.register(TEST_TENANT, createMockChannel('whatsapp'));
    registry.register(TEST_TENANT, createMockChannel('sms'));
    expect(registry.getAll(TEST_TENANT)).toHaveLength(3);
  });
});

describe('CHANNEL_TYPES', () => {
  it('includes all expected channel types', () => {
    expect(CHANNEL_TYPES).toContain('email');
    expect(CHANNEL_TYPES).toContain('whatsapp');
    expect(CHANNEL_TYPES).toContain('sms');
    expect(CHANNEL_TYPES).toContain('voice');
    expect(CHANNEL_TYPES).toContain('web_dashboard');
    expect(CHANNEL_TYPES).toContain('calendar');
  });
});

describe('DEFAULT_CHANNEL_ROUTING', () => {
  it('routes urgent to SMS', () => {
    expect(DEFAULT_CHANNEL_ROUTING.urgent).toBe('sms');
  });
  it('routes routine to WhatsApp', () => {
    expect(DEFAULT_CHANNEL_ROUTING.routine).toBe('whatsapp');
  });
  it('routes scheduling to calendar', () => {
    expect(DEFAULT_CHANNEL_ROUTING.scheduling).toBe('calendar');
  });
});
