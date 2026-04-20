/**
 * Stories 2b.3-2b.6 — Mobile & Voice Channel Types
 *
 * WhatsApp, SMS, Calendar sync, and Voice AI integration types.
 * These define the contracts that Twilio/Vapi/CalDAV adapters implement.
 */

// Story 2b.3 — WhatsApp + SMS + Calendar
export interface WhatsAppMessage {
  tenantId: string;
  to: string;
  from: string;
  body: string;
  mediaUrl?: string;
  quickReplies?: string[];
  template?: string;
}

export interface SMSMessage {
  tenantId: string;
  to: string;
  from: string;
  body: string;
}

export interface CalendarEvent {
  tenantId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  location?: string;
  reminders: { minutesBefore: number; method: 'sms' | 'whatsapp' | 'push' }[];
}

export interface NotificationPreferences {
  tenantId: string;
  userId: string;
  urgentChannel: 'sms' | 'whatsapp' | 'voice';
  routineChannel: 'whatsapp' | 'email';
  schedulingChannel: 'calendar';
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "07:00"
  maxDailyMessages: number;
}

// Stories 2b.4-2b.6 — Voice AI
export interface VoiceCallConfig {
  tenantId: string;
  phoneNumber: string;
  greeting: string;
  businessName: string;
  voicePersonality: 'professional' | 'friendly' | 'warm';
  language: string;
  escalationRules: EscalationRule[];
}

export interface EscalationRule {
  trigger: 'complaint' | 'complex_request' | 'vip_client' | 'emergency';
  action: 'transfer_owner' | 'take_message' | 'schedule_callback';
}

export interface VoiceCallRecord {
  id: string;
  tenantId: string;
  callerPhone: string;
  clientProfileId?: string;
  duration: number; // seconds
  transcription: string;
  summary: string;
  actionsTs: VoiceAction[];
  recordedAt: string;
}

export interface VoiceAction {
  type: 'appointment_booked' | 'message_taken' | 'question_answered' | 'escalated';
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AppointmentBooking {
  clientName: string;
  clientPhone: string;
  service: string;
  dateTime: string;
  duration: number; // minutes
  notes?: string;
  confirmationSentVia: 'sms' | 'whatsapp';
}
