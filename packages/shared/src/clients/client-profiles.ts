/**
 * Stories 2b.1-2b.2 — Client Profiles & Business Intelligence
 *
 * Agents build profiles on the business owner's clients — including photos,
 * preferences, history, and visual pattern recognition.
 * Business intelligence generates actionable insights from accumulated data.
 */

export interface ClientProfile {
  id: string;
  tenantId: string;
  name: string;
  phone?: string;
  email?: string;
  visitHistory: VisitRecord[];
  preferences: Record<string, unknown>;
  notes: string[];
  photos: ClientPhoto[];
  satisfactionSignals: SatisfactionSignal[];
  createdAt: string;
  updatedAt: string;
}

export interface VisitRecord {
  date: string;
  service: string;
  provider?: string;
  notes?: string;
  amount?: number;
}

export interface ClientPhoto {
  id: string;
  url: string;
  category: 'before' | 'after' | 'issue' | 'result' | 'reference';
  description?: string;
  aiAnalysis?: string; // visual intelligence output
  uploadedAt: string;
}

export interface SatisfactionSignal {
  type: 'review' | 'referral' | 'complaint' | 'compliment' | 'no_show' | 'rebooking';
  value: number; // -1 to 1
  source: string;
  date: string;
}

// Story 2b.2 — Business Intelligence
export interface BusinessInsight {
  id: string;
  tenantId: string;
  agentId: string;
  insightType: InsightType;
  title: string;
  description: string;
  recommendedAction: string;
  estimatedImpact: string;
  confidence: number;
  data: Record<string, unknown>;
  status: 'pending' | 'approved' | 'dismissed' | 'implemented';
  createdAt: string;
}

export type InsightType =
  | 'seasonal_analysis'
  | 'gap_analysis'
  | 'client_behavior'
  | 'revenue_optimization'
  | 'operational_efficiency'
  | 'cross_agent_correlation';
