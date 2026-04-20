/**
 * Communication Channel Abstraction Layer.
 *
 * All channels (email, WhatsApp, SMS, voice, web dashboard) implement
 * this interface. New channels can be added without modifying existing code.
 */

export interface ChannelMessage {
  id: string;
  tenantId: string;
  channelType: ChannelType;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  content: string;
  contentType: 'text' | 'html' | 'media';
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface ChannelMessageFilter {
  tenantId: string;
  channelType?: ChannelType;
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  since?: string;
  limit?: number;
}

export interface ChannelStatus {
  channelType: ChannelType;
  connected: boolean;
  lastActivity?: string;
  error?: string;
}

/**
 * CommunicationChannel — the contract every channel implements.
 */
export interface CommunicationChannel {
  readonly channelType: ChannelType;

  /** Send a message through this channel */
  send(message: Omit<ChannelMessage, 'id' | 'timestamp' | 'channelType' | 'direction'>): Promise<ChannelMessage>;

  /** Register a handler for inbound messages */
  onReceive(handler: (message: ChannelMessage) => Promise<void>): void;

  /** Get message history */
  getHistory(filters: ChannelMessageFilter): Promise<ChannelMessage[]>;

  /** Get current channel status */
  getStatus(): Promise<ChannelStatus>;
}

export const CHANNEL_TYPES = ['email', 'whatsapp', 'sms', 'voice', 'web_dashboard', 'calendar'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/**
 * Channel routing — determines which channel to use based on urgency and preferences.
 */
export interface ChannelRoutingConfig {
  urgent: ChannelType;       // e.g., 'sms'
  routine: ChannelType;      // e.g., 'whatsapp'
  scheduling: ChannelType;   // e.g., 'calendar'
  default: ChannelType;      // fallback
}

export const DEFAULT_CHANNEL_ROUTING: ChannelRoutingConfig = {
  urgent: 'sms',
  routine: 'whatsapp',
  scheduling: 'calendar',
  default: 'whatsapp',
};

/**
 * Channel registry — manages registered channels per tenant.
 * Map key is `${tenantId}:${channelType}` to ensure tenant isolation.
 */
export class ChannelRegistry {
  private channels = new Map<string, CommunicationChannel>();

  private key(tenantId: string, channelType: ChannelType): string {
    return `${tenantId}:${channelType}`;
  }

  register(tenantId: string, channel: CommunicationChannel): void {
    this.channels.set(this.key(tenantId, channel.channelType), channel);
  }

  get(tenantId: string, channelType: ChannelType): CommunicationChannel | undefined {
    return this.channels.get(this.key(tenantId, channelType));
  }

  getAll(tenantId: string): CommunicationChannel[] {
    const prefix = `${tenantId}:`;
    return Array.from(this.channels.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([_, v]) => v);
  }

  has(tenantId: string, channelType: ChannelType): boolean {
    return this.channels.has(this.key(tenantId, channelType));
  }

  /**
   * Route a message to the appropriate channel based on urgency.
   */
  route(
    tenantId: string,
    urgency: keyof ChannelRoutingConfig,
    routing: ChannelRoutingConfig = DEFAULT_CHANNEL_ROUTING,
  ): CommunicationChannel | undefined {
    const channelType = routing[urgency];
    return this.get(tenantId, channelType) ?? this.get(tenantId, routing.default);
  }
}
