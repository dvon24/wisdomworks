import { describe, it, expect } from 'vitest';
import { ChannelRegistry, DEFAULT_CHANNEL_ROUTING, CHANNEL_TYPES } from './channel-provider';
import type { CommunicationChannel, ChannelMessage, ChannelStatus } from './channel-provider';

// Mock channel for testing
function createMockChannel(type: string): CommunicationChannel {
  return {
    channelType: type as any,
    send: async (msg) => ({ ...msg, id: 'test-id', timestamp: new Date().toISOString(), channelType: type as any, direction: 'outbound' as const }),
    onReceive: () => {},
    getHistory: async () => [],
    getStatus: async () => ({ channelType: type as any, connected: true }),
  };
}

describe('ChannelRegistry', () => {
  it('registers and retrieves channels', () => {
    const registry = new ChannelRegistry();
    const channel = createMockChannel('whatsapp');
    registry.register(channel);
    expect(registry.get('whatsapp')).toBe(channel);
    expect(registry.has('whatsapp')).toBe(true);
    expect(registry.has('sms')).toBe(false);
  });

  it('routes to correct channel by urgency', () => {
    const registry = new ChannelRegistry();
    registry.register(createMockChannel('sms'));
    registry.register(createMockChannel('whatsapp'));
    registry.register(createMockChannel('calendar'));

    const urgent = registry.route('urgent');
    expect(urgent?.channelType).toBe('sms');

    const routine = registry.route('routine');
    expect(routine?.channelType).toBe('whatsapp');

    const scheduling = registry.route('scheduling');
    expect(scheduling?.channelType).toBe('calendar');
  });

  it('falls back to default when requested channel not registered', () => {
    const registry = new ChannelRegistry();
    registry.register(createMockChannel('whatsapp'));
    // SMS not registered, should fallback to default (whatsapp)
    const result = registry.route('urgent');
    expect(result?.channelType).toBe('whatsapp');
  });

  it('returns all registered channels', () => {
    const registry = new ChannelRegistry();
    registry.register(createMockChannel('email'));
    registry.register(createMockChannel('whatsapp'));
    registry.register(createMockChannel('sms'));
    expect(registry.getAll()).toHaveLength(3);
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
