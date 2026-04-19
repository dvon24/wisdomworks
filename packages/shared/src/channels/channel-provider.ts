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
 */
export class ChannelRegistry {
  private channels = new Map<string, CommunicationChannel>();

  register(channel: CommunicationChannel): void {
    this.channels.set(channel.channelType, channel);
  }

  get(channelType: ChannelType): CommunicationChannel | undefined {
    return this.channels.get(channelType);
  }

  getAll(): CommunicationChannel[] {
    return Array.from(this.channels.values());
  }

  has(channelType: ChannelType): boolean {
    return this.channels.has(channelType);
  }

  /**
   * Route a message to the appropriate channel based on urgency.
   */
  route(
    urgency: keyof ChannelRoutingConfig,
    routing: ChannelRoutingConfig = DEFAULT_CHANNEL_ROUTING,
  ): CommunicationChannel | undefined {
    const channelType = routing[urgency];
    return this.get(channelType) ?? this.get(routing.default);
  }
}
