/**
 * Stories 2.5-2.15 — Agent feature definitions
 *
 * Each feature is a capability that agents can have.
 * The actual AI execution happens in services/agents (Python LangGraph).
 * These TypeScript types define the interfaces and contracts.
 */

// Story 2.5 — Data Extraction
export interface ExtractedData {
  dates: string[];
  deadlines: string[];
  budgetFigures: number[];
  projectReferences: string[];
  personnel: string[];
  milestones: string[];
  actionItems: string[];
}

// Story 2.6 — Morning Briefing
export interface MorningBriefing {
  tenantId: string;
  userId: string;
  date: string;
  actionableItems: BriefingItem[];
  pendingTasks: BriefingItem[];
  uncertainClassifications: BriefingItem[];
  calendarConflicts: BriefingItem[];
  crossAgentDiscoveries: BriefingItem[];
  deadlineAlerts: BriefingItem[];
}

export interface BriefingItem {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  source: string;
  actionRequired: boolean;
}

// Story 2.8 — Task Management
export interface AgentTask {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  source: 'email' | 'manual' | 'agent';
  createdAt: string;
  completedAt?: string;
}

// Story 2.10 — Agent State
export interface AgentState {
  agentId: string;
  tenantId: string;
  version: number;
  learnedPreferences: Record<string, unknown>;
  conversationHistory: { role: string; content: string; timestamp: string }[];
  taskContext: Record<string, unknown>;
  lastCheckpoint: string;
}

// Story 2.11 — BMAD Innovation
export interface SolutionBrief {
  id: string;
  tenantId: string;
  agentId: string;
  title: string;
  problemDescription: string;
  proposedSolution: string;
  confidenceScore: number;
  expectedImpact: string;
  riskAssessment: string;
  status: 'pending' | 'approved' | 'dismissed' | 'implemented';
  reviewerNotes?: string;
  createdAt: string;
}

// Story 2.14 — Process Capture
export interface ProcessRecord {
  id: string;
  tenantId: string;
  agentId?: string;
  userId?: string;
  intent: string;
  processSteps: { step: number; action: string; result: string }[];
  decisions: { point: string; choice: string; reasoning: string }[];
  endState: { outcome: string; success: boolean };
  evaluation: 'success' | 'partial' | 'failure';
  reflection: { whatWorked: string[]; whatDidnt: string[]; doNextTime: string[] };
  tags: { businessType?: string; agentRole?: string; taskCategory?: string };
  durationMs: number;
  createdAt: string;
}

// Story 2.15 — Skill Formation
export interface AgentSkill {
  id: string;
  tenantId: string;
  agentId?: string; // null = shared across agents
  skillName: string;
  triggerConditions: Record<string, unknown>;
  actionSteps: { step: number; action: string }[];
  evidence: { processRecordIds: string[]; successRate: number };
  confidence: number;
  status: 'candidate' | 'active' | 'deprecated';
  createdFrom?: string; // process_record_id
  createdAt: string;
}

// Story 2.15 — Lesson Learned
export interface LessonLearned {
  id: string;
  tenantId: string;
  processRecordId: string;
  whatWentWrong: string;
  correctiveAction: string;
  appliesTo: string; // task category
  createdAt: string;
}
