/**
 * Agent Tools — Anthropic tool definitions + executor.
 *
 * When Iris receives a WhatsApp message, she's given these tool definitions.
 * If she chooses to call a tool, we execute it against the customer's stored
 * OAuth connections and feed the result back to her for the final response.
 *
 * Each customer only sees the tools they have connections for — no point
 * showing "list_calendar_events" to a customer who hasn't connected a calendar.
 */

import {
  listEmails,
  sendEmail,
  listCalendarEvents,
  createCalendarEvent,
  analyzeWebsite,
  type OAuthConnection,
} from '@wisdomworks/shared';
import { listImapUnread, sendImap } from '../../_lib/imap-runtime';
import { queryKnowledge } from '../../_lib/knowledge-base';
import { logCorrection } from '../../_lib/classification-learning';
import { transitionProcess, proposeWorkflowFor } from '../../_lib/process-capture';
import { listAllSkills, retireSkill } from '../../_lib/skill-formation';
import { getVoiceProfile, getTopContacts, renderVoiceForDraft, searchContacts, type TopContact } from '../../_lib/email-intelligence';
import { listPendingFollowups, markFollowupSent, markFollowupDeclined } from '../../_lib/email-followup';
import { decryptToken } from '@wisdomworks/shared';
import {
  generateWordDoc,
  generatePowerPoint,
  generateExcel,
  generatePdf,
  uploadToGoogleDrive,
  uploadToOneDrive,
  type DocSection,
  type SlideSpec,
  type SheetSpec,
} from '../../_lib/doc-gen';
import { saveUserContext, type UserContext } from './context-store';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.NEXT_PUBLIC_WEBSITE_URL || 'http://localhost:3001';

// Provider list used by connect_service — mirrors the OAuth routes that exist
// under apps/website/app/api/oauth/.
const SUPPORTED_PROVIDERS: Record<string, { services: string[]; route: string }> = {
  google: { services: ['email', 'calendar'], route: '/api/oauth/google' },
  microsoft: { services: ['email', 'calendar'], route: '/api/oauth/microsoft' },
  apple: { services: ['calendar'], route: '/api/oauth/apple' },
  meta: { services: ['whatsapp'], route: '/api/oauth/meta' },
};

// ─── Tool Definitions (Anthropic format) ───

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const TOOL_LIST_EMAILS: AnthropicTool = {
  name: 'list_unread_emails',
  description:
    "List the user's unread emails from the last 24 hours. Returns sender, subject, and a preview. Use when the user asks about their inbox, recent emails, or what they've missed.",
  input_schema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max emails to return (default 10).',
      },
    },
  },
};

const TOOL_SEND_EMAIL: AnthropicTool = {
  name: 'send_email',
  description:
    'Send an email on behalf of the user. CONFIRM with the user before calling this — never send without explicit approval. Use only after the user has reviewed and approved a draft.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain text body of the email' },
      inReplyToMessageId: {
        type: 'string',
        description: "Optional. If replying to a specific email, pass that email's ID.",
      },
    },
    required: ['to', 'subject', 'body'],
  },
};

const TOOL_LIST_CALENDAR: AnthropicTool = {
  name: 'list_calendar_events',
  description:
    "List the user's calendar events. Use when asked about their schedule, upcoming meetings, or what's on the calendar. Default range is today through 7 days from now.",
  input_schema: {
    type: 'object',
    properties: {
      daysAhead: {
        type: 'number',
        description: 'How many days from today to look ahead (default 7).',
      },
    },
  },
};

const TOOL_CREATE_CALENDAR_EVENT: AnthropicTool = {
  name: 'create_calendar_event',
  description:
    'Create a new event on the user\'s calendar. CONFIRM with the user before calling — they should see and approve the title, time, and attendees first.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      location: { type: 'string' },
      start: { type: 'string', description: 'ISO 8601 start datetime' },
      end: { type: 'string', description: 'ISO 8601 end datetime' },
      attendees: {
        type: 'array',
        items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } } },
      },
    },
    required: ['title', 'start', 'end'],
  },
};

const TOOL_CREATE_DOCUMENT: AnthropicTool = {
  name: 'create_document',
  description:
    "Generate a Word/PowerPoint/Excel/PDF document and upload it to the user's Google Drive or OneDrive (whichever they have connected). Use when the user asks for a doc/deck/spreadsheet/PDF — meeting notes, report, proposal, status update, etc. Returns the file URL.",
  input_schema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['docx', 'pptx', 'xlsx', 'pdf'], description: 'docx for Word, pptx for PowerPoint, xlsx for Excel, pdf for PDF.' },
      filename: { type: 'string', description: 'Filename WITHOUT extension. Will be appended automatically.' },
      title: { type: 'string', description: 'Document title shown on the cover/first page.' },
      // Format-specific payloads
      sections: {
        type: 'array',
        description: 'For docx/pdf: sections of [heading, paragraphs[], bullets[]].',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' } },
            bullets: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      slides: {
        type: 'array',
        description: 'For pptx: slides of [title, body, bullets[], notes].',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['title'],
        },
      },
      sheets: {
        type: 'array',
        description: 'For xlsx: sheets of [name, rows: string[][]].',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rows: { type: 'array', items: { type: 'array' } },
          },
          required: ['name', 'rows'],
        },
      },
    },
    required: ['format', 'filename', 'title'],
  },
};

const TOOL_RUN_WORKFLOW: AnthropicTool = {
  name: 'run_workflow',
  description:
    'Execute a multi-step workflow (chained tool calls with conditionals + retries). Use for repeatable procedures: weekly report cycle, client onboarding sequence, meeting follow-up. Returns a per-step trace.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Workflow name (for logging).' },
      description: { type: 'string' },
      steps: {
        type: 'array',
        description: "Steps: { id, type: 'tool'|'if'|'parallel'|'delay', ... }. Tool steps reference other tools by name and can use {{stepId.field}} templating to thread outputs.",
        items: { type: 'object' },
      },
    },
    required: ['name', 'steps'],
  },
};

const TOOL_LIST_PROCESSES: AnthropicTool = {
  name: 'list_proposed_processes',
  description:
    'List process_records in proposed status — patterns the team detected the user doing repeatedly that could be automated. Use when the user asks "what could we automate" or for proactive surfacing.',
  input_schema: { type: 'object', properties: {} },
};

const TOOL_APPROVE_PROCESS: AnthropicTool = {
  name: 'approve_process_for_automation',
  description:
    'When the user agrees to automate a proposed process, transition it to approved + generate the workflow definition. Returns the workflow so the user can review before it actually runs.',
  input_schema: {
    type: 'object',
    properties: {
      process_id: { type: 'string', description: 'The id of the process_record (from list_proposed_processes).' },
    },
    required: ['process_id'],
  },
};

const TOOL_DECLINE_PROCESS: AnthropicTool = {
  name: 'decline_process_automation',
  description: 'Move a proposed process to declined when the user says they do not want to automate it. Reduces noise on future tick prompts.',
  input_schema: {
    type: 'object',
    properties: { process_id: { type: 'string' } },
    required: ['process_id'],
  },
};

// ─── Story 2.15 — Skill formation ───
const TOOL_LIST_SKILLS: AnthropicTool = {
  name: 'list_skills',
  description:
    "List the techniques each lane has learned (cross-agent skill catalog). Use when the user asks 'what have my agents learned' or wants to audit what's being shared between agents. Includes success rate per technique.",
  input_schema: {
    type: 'object',
    properties: {
      include_retired: { type: 'boolean', description: 'Include retired skills (default false).' },
    },
  },
};

const TOOL_RETIRE_SKILL: AnthropicTool = {
  name: 'retire_skill',
  description:
    'Manually retire a learned technique that is producing bad results or no longer applies. Stops the skill from being injected into future agent prompts. Use when the user says a particular technique is wrong or outdated.',
  input_schema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'The id of the agent_skills row (from list_skills).' },
      reason: { type: 'string', description: "Why it's being retired (1 line)." },
    },
    required: ['skill_id', 'reason'],
  },
};

const TOOL_REPORT_MISCLASSIFICATION: AnthropicTool = {
  name: 'report_email_misclassification',
  description:
    "When the user says an email was wrongly classified (e.g. 'that wasn't personal, it was a client'), record the correction so future classifications learn from it. Use whenever the user disputes a privacy or action label.",
  input_schema: {
    type: 'object',
    properties: {
      email_from: { type: 'string' },
      email_subject: { type: 'string' },
      original_privacy_class: { type: 'string', enum: ['business', 'personal', 'uncertain'] },
      original_classification: { type: 'string' },
      corrected_privacy_class: { type: 'string', enum: ['business', 'personal', 'uncertain'] },
      corrected_classification: { type: 'string' },
      user_reason: { type: 'string', description: "Optional: why the user said it should be different (helps the model learn)." },
    },
    required: ['original_privacy_class', 'corrected_privacy_class'],
  },
};

const TOOL_QUERY_KB: AnthropicTool = {
  name: 'query_knowledge_base',
  description:
    "Search the user's organizational knowledge base (their org documentation, roles, capabilities, projects, tasks, risks) using semantic similarity. Returns relevant snippets with their source entity citations. Use when the user asks about company policy, team structure, what someone does, project history, or any factual question about their org.",
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The natural-language question to search for.' },
      limit: { type: 'number', description: 'Max snippets to return (default 5).' },
    },
    required: ['question'],
  },
};

const TOOL_ERROR_CHECK: AnthropicTool = {
  name: 'error_check',
  description:
    "Before taking a significant action (sending an email, scheduling a meeting, making a financial decision), check the knowledge base for any relevant policies, constraints, or known risks that should inform the action. Returns matching snippets — call BEFORE acting on something with external impact.",
  input_schema: {
    type: 'object',
    properties: {
      proposed_action: { type: 'string', description: 'Plain-English description of what you intend to do.' },
    },
    required: ['proposed_action'],
  },
};

const TOOL_LIST_TASKS: AnthropicTool = {
  name: 'list_open_tasks',
  description:
    "List the user's open tasks pulled from the ontology (extracted from email action items, conversation, and manual additions). Use when the user asks 'what's on my plate', 'what's open', or 'todo list'.",
  input_schema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max tasks (default 10).' } },
  },
};

const TOOL_FIND_CONFLICTS: AnthropicTool = {
  name: 'find_calendar_conflicts',
  description:
    "Check the user's calendar for scheduling conflicts with a proposed time window. Use when drafting a meeting invite or proposing a slot to confirm it's free.",
  input_schema: {
    type: 'object',
    properties: {
      proposedStart: { type: 'string', description: 'ISO 8601 start time of the proposed slot.' },
      proposedEnd: { type: 'string', description: 'ISO 8601 end time.' },
    },
    required: ['proposedStart', 'proposedEnd'],
  },
};

const TOOL_DRAFT_EMAIL: AnthropicTool = {
  name: 'draft_email',
  description:
    "Compose a polished email draft for the user to review BEFORE sending. Use when the user says 'draft an email to X about Y' or 'reply to that LinkedIn email'. The 'to' field accepts EITHER email addresses OR names — names get resolved against the user's contacts table automatically (so 'Ron Beaman' will be matched to ron@example.com if Ron is in their contacts). Returns the draft text — DOES NOT send. The user must explicitly approve, then you call send_email.",
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: "Recipients — either email addresses (foo@bar.com) OR names (Ron Beaman). Names get resolved against the contact list automatically." },
      subject: { type: 'string' },
      intent: { type: 'string', description: 'What the email needs to communicate (1-3 sentences).' },
      tone: { type: 'string', enum: ['professional', 'friendly', 'direct', 'warm'], description: 'Optional tone override. Default: match the owner\'s voice profile.' },
      contextSnippets: { type: 'array', items: { type: 'string' }, description: 'Optional snippets from the original email being replied to.' },
    },
    required: ['intent'],
  },
};

const TOOL_LIST_FOLLOWUPS: AnthropicTool = {
  name: 'list_pending_followups',
  description:
    "List the email follow-ups currently waiting for the user's review. Use when the user asks 'what follow-ups do I have' or 'show me what needs my attention'. The daily email-followup cron creates these for sent emails that haven't gotten a reply.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_APPROVE_FOLLOWUP: AnthropicTool = {
  name: 'approve_followup',
  description:
    "Send a pending follow-up email after the user approves it. Use when the user says 'send', 'approve it', 'yeah send the follow-up to ron'. Looks up by id prefix or by recipient name. Returns confirmation when sent.",
  input_schema: {
    type: 'object',
    properties: {
      proposal_id: { type: 'string', description: 'Either the full UUID, an 8-char id prefix from the WhatsApp prompt, or a recipient name to disambiguate.' },
    },
    required: ['proposal_id'],
  },
};

const TOOL_DECLINE_FOLLOWUP: AnthropicTool = {
  name: 'decline_followup',
  description:
    "Mark a pending follow-up as declined when the user says 'skip', 'no don't send', 'dismiss', etc. The proposal stays in history but won't be re-prompted (until a fresh stale email triggers a new one).",
  input_schema: {
    type: 'object',
    properties: {
      proposal_id: { type: 'string' },
    },
    required: ['proposal_id'],
  },
};

const TOOL_FIND_CONTACT: AnthropicTool = {
  name: 'find_contact',
  description:
    "Look up an email contact by name or partial name. Use when the user mentions someone by name and you need their email address — e.g. 'send Ron a follow-up' before drafting. Returns matching contacts with addresses and how often the user emails them.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: "Name or partial name to search for (case-insensitive). E.g. 'Ron', 'ron beaman', 'beaman'." },
    },
    required: ['query'],
  },
};

const TOOL_CORRECT_GRAMMAR: AnthropicTool = {
  name: 'correct_grammar',
  description:
    'Fix grammar/spelling/tone in user-supplied text without changing meaning. Use when the user says "fix this", "polish this", or pastes text and asks for a clean version.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to correct.' },
      tone: { type: 'string', enum: ['professional', 'friendly', 'direct', 'warm'], description: 'Default keep original tone.' },
    },
    required: ['text'],
  },
};

const TOOL_ANALYZE_WEBSITE: AnthropicTool = {
  name: 'analyze_website',
  description:
    "Crawl and analyze the user's website (or any URL). Returns title, platform (Shopify/WordPress/etc.), navigation, business signals (booking, pricing, reviews), social links, and performance. Use when the user asks about their site or wants improvements.",
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to analyze' },
    },
    required: ['url'],
  },
};

const TOOL_ADD_TOOL_TO_AGENT: AnthropicTool = {
  name: 'add_tool_to_agent',
  description:
    "Add a tool/integration to an agent on the user's team. Use when they say things like \"give Marcus access to GitHub\" or \"Luna needs Instagram\". The tool name is stored on the agent's profile and surfaced in their card.",
  input_schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: 'The name of the agent (e.g. Marcus, Luna).' },
      tool: { type: 'string', description: 'The tool to add (e.g. GitHub, Slack, VS Code, Notion).' },
    },
    required: ['agentName', 'tool'],
  },
};

const TOOL_UPDATE_AGENT: AnthropicTool = {
  name: 'update_agent',
  description:
    "Update an agent's role, description, or channels. Use when the user wants to refocus an agent's responsibilities (e.g. \"Marcus should also handle au7o billing\").",
  input_schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string' },
      role: { type: 'string', description: 'Optional new role/title.' },
      description: { type: 'string', description: 'Optional new short description.' },
      addChannels: { type: 'array', items: { type: 'string' }, description: 'Channels to add (e.g. Slack, Email).' },
    },
    required: ['agentName'],
  },
};

const TOOL_ADD_AGENT: AnthropicTool = {
  name: 'add_agent_to_team',
  description:
    "Add a brand-new agent to the user's team. Before calling, think about hierarchy fit: does this role belong under an existing manager (e.g. a recruiter under an Ops/People manager) or is it independent? If it fits under someone, pass parentAgentName so it goes into that person's sub-team. If not, leave parentAgentName blank for a top-level slot. Always pick a sensible tier (Haiku for routine, Sonnet for general work, Opus for critical reasoning).",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A friendly first-name for the agent (e.g. Riley, Atlas).' },
      role: { type: 'string', description: 'Their role/title (e.g. Recruiter, Bookkeeper).' },
      description: { type: 'string', description: 'One-sentence description of what they do.' },
      parentAgentName: {
        type: 'string',
        description: 'Optional. Name of the existing top-level agent this new agent should report to. Leave blank for top-level.',
      },
      tier: { type: 'string', enum: ['Haiku', 'Sonnet', 'Opus'] },
      tools: { type: 'array', items: { type: 'string' } },
      channels: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'role'],
  },
};

const TOOL_MOVE_AGENT: AnthropicTool = {
  name: 'move_agent_under_manager',
  description:
    "Re-parent an existing agent so they report to a different manager. Use when the user says 'move Riley under Marcus' or 'put the recruiter on Marcus's team'. The agent is removed from their current location (top-level OR another manager's sub-team) and added to the target manager's sub-team.",
  input_schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: 'The agent being moved.' },
      parentAgentName: { type: 'string', description: "The manager who will become the agent's new parent." },
    },
    required: ['agentName', 'parentAgentName'],
  },
};

const TOOL_REMOVE_AGENT: AnthropicTool = {
  name: 'remove_agent_from_team',
  description:
    "Remove an agent from the team entirely. Use when the user says 'remove Riley' or 'fire the recruiter'. Searches both top-level and all sub-teams. CONFIRM with the user first if there's any ambiguity.",
  input_schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string' },
    },
    required: ['agentName'],
  },
};

const TOOL_CONSULT_MANAGER: AnthropicTool = {
  name: 'consult_manager',
  description:
    "Get an existing top-level agent/manager's opinion on a proposed change (e.g. adding a new agent, changing scope). Use this BEFORE adding a new agent so the relevant managers can weigh in on whether it makes sense, whether it overlaps with their existing scope, or whether it should report to them. Call once per manager whose domain could plausibly overlap. Their reply is treated as advisory — Iris/Sophia still makes the final call.",
  input_schema: {
    type: 'object',
    properties: {
      managerName: { type: 'string', description: 'The exact name of the existing top-level agent to consult.' },
      proposal: {
        type: 'string',
        description: "Plain-English description of the change being proposed (e.g. 'User wants to add a recruiter named Riley to handle hiring for both businesses').",
      },
    },
    required: ['managerName', 'proposal'],
  },
};

const TOOL_CONNECT_SERVICE: AnthropicTool = {
  name: 'connect_service',
  description:
    'Hand the user a clickable OAuth link to connect a service (Gmail, Google Calendar, Microsoft 365, Apple Calendar). Returns the URL the user should open. Use when they want to connect email/calendar/etc.',
  input_schema: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['google', 'microsoft', 'apple', 'meta'],
        description: 'OAuth provider.',
      },
      service: {
        type: 'string',
        description: 'What to connect — email, calendar, whatsapp.',
      },
    },
    required: ['provider'],
  },
};

// ─── Tool Selection — gate by what the user has connected ───

export function buildToolList(connections: OAuthConnection[]): AnthropicTool[] {
  const tools: AnthropicTool[] = [];

  const hasEmail = connections.some((c) => c.service === 'email');
  const hasCalendar = connections.some((c) => c.service === 'calendar');

  if (hasEmail) {
    tools.push(TOOL_LIST_EMAILS);
    tools.push(TOOL_SEND_EMAIL);
  }
  if (hasCalendar) {
    tools.push(TOOL_LIST_CALENDAR);
    tools.push(TOOL_CREATE_CALENDAR_EVENT);
  }
  // Website + team-mutation + connect tools are always available
  tools.push(TOOL_ANALYZE_WEBSITE);
  tools.push(TOOL_DRAFT_EMAIL);
  tools.push(TOOL_FIND_CONTACT);
  tools.push(TOOL_LIST_FOLLOWUPS);
  tools.push(TOOL_APPROVE_FOLLOWUP);
  tools.push(TOOL_DECLINE_FOLLOWUP);
  tools.push(TOOL_CORRECT_GRAMMAR);
  tools.push(TOOL_LIST_TASKS);
  tools.push(TOOL_FIND_CONFLICTS);
  tools.push(TOOL_QUERY_KB);
  tools.push(TOOL_ERROR_CHECK);
  tools.push(TOOL_CREATE_DOCUMENT);
  tools.push(TOOL_RUN_WORKFLOW);
  tools.push(TOOL_REPORT_MISCLASSIFICATION);
  tools.push(TOOL_LIST_PROCESSES);
  tools.push(TOOL_APPROVE_PROCESS);
  tools.push(TOOL_DECLINE_PROCESS);
  tools.push(TOOL_LIST_SKILLS);
  tools.push(TOOL_RETIRE_SKILL);
  tools.push(TOOL_ADD_AGENT);
  tools.push(TOOL_ADD_TOOL_TO_AGENT);
  tools.push(TOOL_UPDATE_AGENT);
  tools.push(TOOL_MOVE_AGENT);
  tools.push(TOOL_REMOVE_AGENT);
  tools.push(TOOL_CONSULT_MANAGER);
  tools.push(TOOL_CONNECT_SERVICE);

  return tools;
}

// ─── Tool Executor ───

export interface ToolCall {
  name: string;
  input: Record<string, any>;
}

export interface ToolResult {
  /** Text fed back to the AI as the result */
  content: string;
  /** Was the tool successful? */
  success: boolean;
}

export async function executeTool(
  call: ToolCall,
  connections: OAuthConnection[],
  user?: UserContext,
): Promise<ToolResult> {
  try {
    switch (call.name) {
      case 'list_unread_emails': {
        const conn = connections.find((c) => c.service === 'email');
        if (!conn) return { content: 'No email account connected.', success: false };
        // For IMAP-based providers (yahoo, generic imap), call the local apps/web
        // runtime so imapflow can be loaded without going through the transpiled
        // shared package (which can't bundle Node modules cleanly).
        const result = (conn.provider === 'yahoo' || conn.provider === 'imap')
          ? await listImapUnread(conn as any, call.input.limit ?? 10)
          : await listEmails(conn, call.input.limit ?? 10);
        if (!result.success || !result.data) {
          return { content: `Could not fetch emails: ${result.error}`, success: false };
        }
        if (result.data.length === 0) {
          return { content: 'No unread emails in the last 24 hours.', success: true };
        }
        const lines = result.data.map(
          (e, i) =>
            `${i + 1}. From: ${e.fromName ?? e.from} | Subject: ${e.subject} | Preview: ${e.bodyPreview.slice(0, 120)}`,
        );
        return { content: `Found ${result.data.length} unread emails:\n${lines.join('\n')}`, success: true };
      }

      case 'send_email': {
        const conn = connections.find((c) => c.service === 'email');
        if (!conn) return { content: 'No email account connected.', success: false };
        const req = {
          to: call.input.to,
          cc: call.input.cc,
          bcc: call.input.bcc,
          subject: call.input.subject,
          body: call.input.body,
          inReplyToMessageId: call.input.inReplyToMessageId,
        };
        // Yahoo + generic IMAP go through SMTP via the local runtime; everything
        // else uses the shared router (Gmail API / Microsoft Graph).
        const result = (conn.provider === 'yahoo' || conn.provider === 'imap')
          ? await sendImap(conn as any, req)
          : await sendEmail(conn, req);
        if (!result.success) {
          return { content: `Send failed: ${result.error}`, success: false };
        }
        return { content: `Email sent to ${call.input.to.join(', ')}.`, success: true };
      }

      case 'list_calendar_events': {
        const conn = connections.find((c) => c.service === 'calendar');
        if (!conn) return { content: 'No calendar connected.', success: false };
        const days = call.input.daysAhead ?? 7;
        const from = new Date();
        const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
        const result = await listCalendarEvents(conn, { from, to });
        if (!result.success || !result.data) {
          return { content: `Could not fetch calendar: ${result.error}`, success: false };
        }
        if (result.data.length === 0) {
          return { content: `No events scheduled in the next ${days} days.`, success: true };
        }
        const lines = result.data.map((e) => {
          const start = new Date(e.start);
          const dateStr = start.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          return `${dateStr}  ${e.title}${e.location ? ` (${e.location})` : ''}`;
        });
        return { content: `Found ${result.data.length} events:\n${lines.join('\n')}`, success: true };
      }

      case 'create_calendar_event': {
        const conn = connections.find((c) => c.service === 'calendar');
        if (!conn) return { content: 'No calendar connected.', success: false };
        const result = await createCalendarEvent(conn, {
          title: call.input.title,
          description: call.input.description,
          location: call.input.location,
          start: call.input.start,
          end: call.input.end,
          attendees: call.input.attendees,
        });
        if (!result.success || !result.data) {
          return { content: `Could not create event: ${result.error}`, success: false };
        }
        return {
          content: `Event "${result.data.title}" created for ${new Date(result.data.start).toLocaleString()}.`,
          success: true,
        };
      }

      case 'list_proposed_processes': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const SU = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SU || !SK) return { content: 'Supabase not configured.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const res = await fetch(
          `${SU}/rest/v1/process_records?tenant_phone=eq.${cleanPhone}&automation_status=eq.proposed&order=occurrence_count.desc&limit=10&select=id,name,description,occurrence_count,last_observed_at`,
          { headers: { apikey: SK, Authorization: `Bearer ${SK}` } },
        );
        if (!res.ok) return { content: 'Could not load processes.', success: false };
        const rows = await res.json();
        if (rows.length === 0) return { content: 'No proposed processes yet. The team needs more activity to detect repeating patterns.', success: true };
        const lines = rows.map((p: any, i: number) =>
          `${i + 1}. [${p.id.slice(0, 8)}] ${p.description?.slice(0, 100) ?? p.name} (${p.occurrence_count}x)`,
        );
        return { content: `${rows.length} proposed automation${rows.length > 1 ? 's' : ''}:\n${lines.join('\n')}\n\nApprove with 'approve [id]' to auto-generate the workflow.`, success: true };
      }

      case 'approve_process_for_automation': {
        const processId = call.input.process_id;
        if (!processId) return { content: 'Missing process_id.', success: false };
        const workflow = await proposeWorkflowFor(processId);
        if (!workflow) return { content: 'Could not load process.', success: false };
        const result = await transitionProcess(processId, 'automated', workflow);
        if (!result.ok) return { content: `Approval failed: ${result.error}`, success: false };
        return {
          content: `Approved + automated. Workflow definition:\n${JSON.stringify(workflow, null, 2)}\n\nIt'll run on its next trigger condition.`,
          success: true,
        };
      }

      case 'decline_process_automation': {
        const processId = call.input.process_id;
        if (!processId) return { content: 'Missing process_id.', success: false };
        const result = await transitionProcess(processId, 'declined');
        return result.ok
          ? { content: 'Declined. Won\'t surface again.', success: true }
          : { content: `Decline failed: ${result.error}`, success: false };
      }

      case 'list_skills': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const skills = await listAllSkills(cleanPhone, !!call.input.include_retired);
        if (skills.length === 0) return { content: 'No skills learned yet — agents will start cataloging techniques as they complete successful work.', success: true };
        // Group by lane
        const byLane = new Map<string, any[]>();
        for (const s of skills) {
          const bucket = byLane.get(s.lane) ?? [];
          bucket.push(s);
          byLane.set(s.lane, bucket);
        }
        const sections = Array.from(byLane.entries()).map(([lane, rows]) => {
          const lines = rows.map((s) => {
            const total = (s.success_count || 0) + (s.failure_count || 0);
            const rate = total === 0 ? 'new' : `${Math.round((s.success_count / total) * 100)}% (${total} uses)`;
            const tag = s.retired_at ? ' [RETIRED]' : '';
            return `  • [${s.id.slice(0, 8)}] ${s.description?.slice(0, 100) ?? s.technique_signature} — ${rate}${tag}`;
          });
          return `${lane.toUpperCase()}\n${lines.join('\n')}`;
        });
        return { content: `Skill catalog (${skills.length} total):\n\n${sections.join('\n\n')}`, success: true };
      }

      case 'retire_skill': {
        const skillId = call.input.skill_id;
        const reason = call.input.reason || 'manually retired by owner';
        if (!skillId) return { content: 'Missing skill_id.', success: false };
        const ok = await retireSkill(skillId, reason);
        return ok
          ? { content: `Retired. Agents won't be prompted with that technique anymore.`, success: true }
          : { content: 'Retire failed.', success: false };
      }

      case 'report_email_misclassification': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        try {
          await logCorrection(user.phoneNumber.replace(/[\s\-+()]/g, ''), {
            original_privacy_class: call.input.original_privacy_class,
            original_classification: call.input.original_classification,
            corrected_privacy_class: call.input.corrected_privacy_class,
            corrected_classification: call.input.corrected_classification,
            email_from: call.input.email_from,
            email_subject: call.input.email_subject,
            user_reason: call.input.user_reason,
            source: 'whatsapp',
          });
          return {
            content: `Got it — recorded "${call.input.original_privacy_class}" → "${call.input.corrected_privacy_class}". Future classifications will learn from this.`,
            success: true,
          };
        } catch (err) {
          return { content: `Couldn't save correction: ${err}`, success: false };
        }
      }

      case 'create_document': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const { format, filename, title } = call.input;
        const ext = format === 'docx' ? '.docx' : format === 'pptx' ? '.pptx' : format === 'xlsx' ? '.xlsx' : '.pdf';
        const mime = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : format === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';
        const safeName = `${filename}${ext}`;

        try {
          let buffer: Buffer;
          if (format === 'docx') {
            buffer = await generateWordDoc(title, (call.input.sections ?? []) as DocSection[]);
          } else if (format === 'pptx') {
            buffer = await generatePowerPoint(title, (call.input.slides ?? []) as SlideSpec[]);
          } else if (format === 'xlsx') {
            buffer = await generateExcel((call.input.sheets ?? []) as SheetSpec[]);
          } else {
            buffer = await generatePdf(title, (call.input.sections ?? []) as DocSection[]);
          }

          // Pick a destination: prefer Google Drive if connected, else OneDrive
          const googleConn = connections.find((c) => c.provider === 'google');
          const msConn = connections.find((c) => c.provider === 'microsoft');
          let upload: any = null;
          if (googleConn) {
            upload = await uploadToGoogleDrive(googleConn.access_token, safeName, mime, buffer);
            if (upload.ok) return { content: `Created ${safeName} in your Google Drive: ${upload.webUrl}`, success: true };
          }
          if (msConn) {
            upload = await uploadToOneDrive(msConn.access_token, safeName, buffer);
            if (upload.ok) return { content: `Created ${safeName} in your OneDrive: ${upload.webUrl}`, success: true };
          }
          // Fallback: return the size + base64 length so the user knows it was generated
          return {
            content: `Generated ${safeName} (${(buffer.length / 1024).toFixed(1)} KB) but no Drive/OneDrive connection found. Connect one in the deck to auto-upload, or I can attach via WhatsApp on next iteration.`,
            success: true,
          };
        } catch (err) {
          return { content: `Document generation failed: ${err}`, success: false };
        }
      }

      case 'run_workflow': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        try {
          // Late-bind to avoid an import cycle (workflow-runner imports from this file)
          const { runWorkflow } = await import('../../_lib/workflow-runner');
          const wf = {
            name: call.input.name,
            description: call.input.description,
            steps: call.input.steps ?? [],
          };
          const result = await runWorkflow(user.phoneNumber, wf);
          const summary = `${wf.name}: ${result.ok ? '✓' : '✗'} ${result.steps.length} steps in ${result.totalDurationMs}ms`;
          const stepLines = result.steps.map((s) =>
            `  ${s.success ? '✓' : '✗'} ${s.id} (${s.type}, ${s.durationMs}ms)${s.error ? ' — ' + s.error : ''}`,
          );
          return { content: `${summary}\n${stepLines.join('\n')}`, success: result.ok };
        } catch (err) {
          return { content: `Workflow execution failed: ${err}`, success: false };
        }
      }

      case 'query_knowledge_base': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const question = call.input.question?.toString();
        if (!question) return { content: 'Missing question.', success: false };
        try {
          const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
          const { matches, embedTokens } = await queryKnowledge(cleanPhone, question, { limit: call.input.limit ?? 5 });
          if (matches.length === 0) {
            return { content: `No knowledge-base matches for "${question}". The KB may be empty or the question is outside the org's recorded scope.`, success: true };
          }
          const lines = matches.map((m, i) =>
            `${i + 1}. [${m.source_entity_type}: ${m.source_entity_name}] (similarity ${(m.similarity * 100).toFixed(0)}%)\n   ${m.content.slice(0, 240)}${m.content.length > 240 ? '…' : ''}`,
          );
          return {
            content: `${matches.length} match${matches.length > 1 ? 'es' : ''} (embed: ${embedTokens} tok):\n\n${lines.join('\n\n')}`,
            success: true,
          };
        } catch (err) {
          return { content: `Knowledge base error: ${err}`, success: false };
        }
      }

      case 'error_check': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const action = call.input.proposed_action?.toString();
        if (!action) return { content: 'Missing proposed_action.', success: false };
        try {
          const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
          // Lower threshold for error_check: we'd rather show a possibly-relevant
          // policy than miss a real one. minSimilarity=0.3 errs on the side of more results.
          const { matches } = await queryKnowledge(cleanPhone, action, { limit: 5, minSimilarity: 0.3 });
          if (matches.length === 0) {
            return { content: 'No relevant policies, constraints, or risks found in the knowledge base. Action is unconstrained from the KB perspective.', success: true };
          }
          const flags = matches.filter((m) => m.source_entity_type === 'risk' || /policy|compliance|constraint/i.test(m.content));
          const lines = matches.map((m, i) =>
            `${i + 1}. [${m.source_entity_type}: ${m.source_entity_name}]: ${m.content.slice(0, 200)}`,
          );
          const verdict = flags.length > 0
            ? `⚠ ${flags.length} potential issue${flags.length > 1 ? 's' : ''} flagged. Review before proceeding.`
            : `${matches.length} related entries found. Review for context, no hard blockers identified.`;
          return { content: `${verdict}\n\n${lines.join('\n')}`, success: true };
        } catch (err) {
          return { content: `Error check failed: ${err}`, success: false };
        }
      }

      case 'list_open_tasks': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const SUPABASE_URL_LOCAL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_KEY_LOCAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL_LOCAL || !SUPABASE_KEY_LOCAL) return { content: 'Supabase not configured.', success: false };
        const limit = call.input.limit ?? 10;
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const res = await fetch(
          `${SUPABASE_URL_LOCAL}/rest/v1/ontology_entities?tenant_phone=eq.${cleanPhone}&entity_type=eq.task&order=created_at.desc&limit=${limit}&select=name,metadata,created_at`,
          { headers: { apikey: SUPABASE_KEY_LOCAL, Authorization: `Bearer ${SUPABASE_KEY_LOCAL}` } },
        );
        if (!res.ok) return { content: 'Could not load tasks.', success: false };
        const tasks = await res.json();
        if (tasks.length === 0) return { content: 'No open tasks tracked yet.', success: true };
        const lines = tasks.map((t: any, i: number) =>
          `${i + 1}. ${t.name}${t.metadata?.from_email_subject ? ` (from: ${t.metadata.from_email_subject})` : ''}`,
        );
        return { content: `Open tasks (${tasks.length}):\n${lines.join('\n')}`, success: true };
      }

      case 'find_calendar_conflicts': {
        const conn = connections.find((c) => c.service === 'calendar');
        if (!conn) return { content: 'No calendar connected.', success: false };
        const start = new Date(call.input.proposedStart);
        const end = new Date(call.input.proposedEnd);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return { content: 'Invalid proposed times — pass ISO 8601 datetimes.', success: false };
        }
        // Scan a small window around the proposed slot
        const result = await listCalendarEvents(conn, {
          from: new Date(start.getTime() - 60 * 60 * 1000),
          to: new Date(end.getTime() + 60 * 60 * 1000),
        });
        if (!result.success || !result.data) {
          return { content: `Could not check calendar: ${result.error}`, success: false };
        }
        const conflicts = result.data.filter((e: any) => {
          const eStart = new Date(e.start).getTime();
          const eEnd = new Date(e.end ?? e.start).getTime();
          return eStart < end.getTime() && eEnd > start.getTime();
        });
        if (conflicts.length === 0) {
          return { content: `No conflicts in the proposed window (${start.toLocaleString()} → ${end.toLocaleString()}).`, success: true };
        }
        const lines = conflicts.map((e: any) =>
          `- ${new Date(e.start).toLocaleString()} ${e.title}`,
        );
        return { content: `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}:\n${lines.join('\n')}`, success: true };
      }

      case 'draft_email': {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { content: 'No AI key configured.', success: false };
        const { intent, tone, subject, to, contextSnippets } = call.input;
        const ctxBlock = contextSnippets?.length
          ? `\n\nContext (original email being replied to):\n${(contextSnippets as string[]).slice(0, 3).join('\n---\n')}`
          : '';

        const cleanPhone = user?.phoneNumber.replace(/[\s\-+()]/g, '');

        // Resolve any names in `to` against the contacts table. Items that
        // contain @ are treated as already-resolved addresses; everything
        // else becomes a name lookup.
        let resolvedTo: string[] = [];
        const ambiguous: { query: string; matches: TopContact[] }[] = [];
        const unresolved: string[] = [];
        if (to?.length && cleanPhone) {
          for (const item of to as string[]) {
            const trimmed = item.trim();
            if (trimmed.includes('@')) {
              resolvedTo.push(trimmed);
              continue;
            }
            const matches = await searchContacts(cleanPhone, trimmed, 5);
            if (matches.length === 0) {
              unresolved.push(trimmed);
            } else if (matches.length === 1) {
              resolvedTo.push(matches[0]!.address);
            } else {
              ambiguous.push({ query: trimmed, matches });
            }
          }
          // Bail early if anything needs human disambiguation
          if (unresolved.length > 0) {
            return {
              content: `I don't have an email for ${unresolved.join(', ')} in your contacts. Either give me their address or call find_contact with a different spelling.`,
              success: false,
            };
          }
          if (ambiguous.length > 0) {
            const lines = ambiguous.map((a) =>
              `"${a.query}" matches ${a.matches.length}: ${a.matches.map((m) => `${m.display_name ?? m.address} <${m.address}>`).join(', ')}`,
            );
            return {
              content: `Need disambiguation:\n${lines.join('\n')}\n\nReply with which one (or include the full address in your draft request).`,
              success: false,
            };
          }
        } else if (to?.length) {
          resolvedTo = to as string[];
        }

        // Pull the owner's voice profile so the draft sounds like them.
        const profile = cleanPhone ? await getVoiceProfile(cleanPhone) : null;
        const voiceBlock = renderVoiceForDraft(profile);
        const toneInstruction = profile
          ? `Match the OWNER VOICE PROFILE below. ${tone ? `User asked for tone override: ${tone}.` : ''}`
          : `Tone: ${tone ?? 'professional'}.`;

        const prompt = `Draft an email${resolvedTo.length ? ` to ${resolvedTo.join(', ')}` : ''}${subject ? ` with subject "${subject}"` : ''}. Intent: ${intent}. ${toneInstruction}${voiceBlock}${ctxBlock}\n\nReturn ONLY the email body — no greeting/sign-off scaffolding unless the intent requires them, no "Subject:" prefix.`;
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 600,
              system: [{ type: 'text', text: 'You draft email bodies for human review. When a voice profile is provided, match it precisely — that is more important than generic professionalism. Concise, on-tone, no fluff.', cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          if (!res.ok) return { content: `Draft generation failed: ${await res.text()}`, success: false };
          const data = await res.json();
          const draft = data.content?.[0]?.text ?? '';
          const recipient = resolvedTo.length ? `to ${resolvedTo.join(', ')}` : '(recipient TBD)';
          const voiceTag = profile ? ` · matched to your voice (${profile.sample_size ?? 0} sent samples)` : '';
          return {
            content: `Draft ${recipient}${subject ? ` · subject: "${subject}"` : ''}${voiceTag}:\n\n${draft}\n\n— Reply 'send' to send, 'edit' to revise, or paste your version.`,
            success: true,
          };
        } catch (err) {
          return { content: `Draft error: ${err}`, success: false };
        }
      }

      case 'list_pending_followups': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const proposals = await listPendingFollowups(cleanPhone);
        if (proposals.length === 0) {
          return { content: 'No follow-ups pending. The cron checks once a day at 2 PM UTC for stale sent emails.', success: true };
        }
        const lines = proposals.map((p, i) => {
          const recipient = p.recipient_name ? `${p.recipient_name} <${p.recipient_address}>` : p.recipient_address;
          return `${i + 1}. [${p.id.slice(0, 8)}] ${recipient} — "${p.original_subject}" (${p.days_since_sent}d ago)`;
        });
        return {
          content: `${proposals.length} pending follow-up${proposals.length > 1 ? 's' : ''}:\n${lines.join('\n')}\n\nReply 'send [id]' to send, 'skip [id]' to dismiss, or 'show [id]' to see the draft.`,
          success: true,
        };
      }

      case 'approve_followup': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const inputId = String(call.input.proposal_id ?? '').trim();
        if (!inputId) return { content: 'Missing proposal_id.', success: false };

        // Resolve: full UUID, prefix, or name
        const all = await listPendingFollowups(cleanPhone);
        const lower = inputId.toLowerCase();
        let matches = all.filter((p) => p.id === inputId || p.id.startsWith(lower));
        if (matches.length === 0) {
          matches = all.filter((p) =>
            (p.recipient_name ?? '').toLowerCase().includes(lower) ||
            p.recipient_address.toLowerCase().includes(lower),
          );
        }
        if (matches.length === 0) return { content: `No pending follow-up matches "${inputId}".`, success: false };
        if (matches.length > 1) {
          const lines = matches.map((m) => `[${m.id.slice(0, 8)}] ${m.recipient_name ?? m.recipient_address} — "${m.original_subject}"`);
          return { content: `Multiple matches:\n${lines.join('\n')}\n\nReply with which one (paste the 8-char id).`, success: false };
        }

        const proposal = matches[0]!;

        // Look up the IMAP connection so we can send via SMTP
        const SU = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SU || !SK) return { content: 'Supabase not configured.', success: false };
        const connRes = await fetch(
          `${SU}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&service=eq.email&status=eq.active&select=provider,service,account_email,access_token,metadata&limit=1`,
          { headers: { apikey: SK, Authorization: `Bearer ${SK}` } },
        );
        const conns = connRes.ok ? await connRes.json() : [];
        if (conns.length === 0) return { content: 'No active email connection — can\'t send the follow-up.', success: false };
        const conn = conns[0];
        const password = await decryptToken(conn.access_token);

        const result = await sendImap(
          {
            provider: conn.provider,
            service: conn.service,
            account_email: conn.account_email,
            access_token: password,
            metadata: conn.metadata,
          },
          {
            to: [proposal.recipient_address],
            subject: proposal.draft_subject ?? `Re: ${proposal.original_subject}`,
            body: proposal.draft_body,
            inReplyToMessageId: proposal.original_message_id ?? undefined,
          },
        );
        if (!result.success) return { content: `Send failed: ${result.error}`, success: false };

        await markFollowupSent(proposal.id, result.data?.messageId);
        return {
          content: `Sent. Followed up with ${proposal.recipient_name ?? proposal.recipient_address} on "${proposal.original_subject}".`,
          success: true,
        };
      }

      case 'decline_followup': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const inputId = String(call.input.proposal_id ?? '').trim();
        if (!inputId) return { content: 'Missing proposal_id.', success: false };

        const all = await listPendingFollowups(cleanPhone);
        const lower = inputId.toLowerCase();
        let matches = all.filter((p) => p.id === inputId || p.id.startsWith(lower));
        if (matches.length === 0) {
          matches = all.filter((p) =>
            (p.recipient_name ?? '').toLowerCase().includes(lower) ||
            p.recipient_address.toLowerCase().includes(lower),
          );
        }
        if (matches.length === 0) return { content: `No pending follow-up matches "${inputId}".`, success: false };
        if (matches.length > 1) {
          const lines = matches.map((m) => `[${m.id.slice(0, 8)}] ${m.recipient_name ?? m.recipient_address}`);
          return { content: `Multiple matches:\n${lines.join('\n')}\n\nWhich one to skip?`, success: false };
        }

        const ok = await markFollowupDeclined(matches[0]!.id);
        return ok
          ? { content: `Skipped. Won't re-prompt about ${matches[0]!.recipient_name ?? matches[0]!.recipient_address} for that thread.`, success: true }
          : { content: 'Decline failed.', success: false };
      }

      case 'find_contact': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const query = call.input.query;
        if (!query) return { content: 'Need a name or address fragment to search.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const matches = await searchContacts(cleanPhone, query, 8);
        if (matches.length === 0) {
          return { content: `No contact found matching "${query}". Either give me their email directly or check the spelling.`, success: true };
        }
        const lines = matches.map((m, i) => {
          const total = m.sent_count + m.received_count;
          const tag = m.trust_label === 'trusted' ? ' [trusted]' : '';
          return `${i + 1}. ${m.display_name ?? m.address} <${m.address}> — ${m.sent_count} sent, ${total} total${tag}`;
        });
        return { content: `Matches for "${query}":\n${lines.join('\n')}`, success: true };
      }

      case 'correct_grammar': {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { content: 'No AI key configured.', success: false };
        const { text, tone } = call.input;
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 800,
              system: [{
                type: 'text',
                text: `Correct grammar/spelling/punctuation. ${tone ? `Adjust to ${tone} tone.` : 'Preserve original tone.'} Do not change meaning. Return ONLY the corrected text — no commentary.`,
                cache_control: { type: 'ephemeral' },
              }],
              messages: [{ role: 'user', content: text }],
            }),
          });
          if (!res.ok) return { content: `Grammar fix failed: ${await res.text()}`, success: false };
          const data = await res.json();
          return { content: data.content?.[0]?.text ?? text, success: true };
        } catch (err) {
          return { content: `Grammar error: ${err}`, success: false };
        }
      }

      case 'analyze_website': {
        const result = await analyzeWebsite(call.input.url);
        if (!result.success || !result.data) {
          return { content: `Could not analyze website: ${result.error}`, success: false };
        }
        const s = result.data;
        const lines = [
          `Title: ${s.title}`,
          `Platform: ${s.platform}`,
          s.description ? `Description: ${s.description}` : '',
          `Navigation: ${s.navigation.slice(0, 8).join(', ')}`,
          `Has booking: ${s.hasBookingFlow}`,
          `Has pricing visible: ${s.hasPricing}`,
          `Has reviews: ${s.hasReviews}`,
          `Mobile-friendly: ${s.hasMobileMeta}`,
          `Load time: ${s.performance.loadTimeMs}ms`,
          `Social: ${s.socialLinks.map((l) => l.platform).join(', ') || 'none'}`,
          `Signals: ${s.signals.join('; ')}`,
        ].filter(Boolean);
        return { content: lines.join('\n'), success: true };
      }

      case 'add_agent_to_team': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const name = call.input.name?.toString().trim();
        const role = call.input.role?.toString().trim();
        if (!name || !role) return { content: 'Missing name or role.', success: false };

        const id = name.toLowerCase().replace(/\s+/g, '-');
        const tier = (['Haiku', 'Sonnet', 'Opus'].includes(call.input.tier) ? call.input.tier : 'Sonnet') as string;
        const newAgent = {
          id,
          name,
          role,
          tier,
          description: call.input.description?.toString(),
          tools: Array.isArray(call.input.tools) ? call.input.tools : [],
          channels: Array.isArray(call.input.channels) ? call.input.channels : [],
        };

        const parent = call.input.parentAgentName?.toString().toLowerCase();
        if (parent) {
          const manager = team.find((a) => a.name?.toLowerCase() === parent || a.id?.toLowerCase() === parent);
          if (!manager) {
            return { content: `Couldn't find a manager named "${call.input.parentAgentName}". Top-level agents: ${team.map((a) => a.name).join(', ')}.`, success: false };
          }
          const sub = manager.subTeam ?? { count: 0, label: `${manager.name}'s team`, agents: [] };
          sub.agents.push({ id: `${manager.id ?? manager.name?.toLowerCase()}-${id}`, name, role, tier });
          sub.count = sub.agents.length;
          manager.subTeam = sub;
          user.profile.team = team;
          await saveUserContext(user);
          return { content: `Added ${name} (${role}) under ${manager.name}. ${manager.name}'s team is now ${sub.count}.`, success: true };
        }

        team.push(newAgent as any);
        user.profile.team = team;
        await saveUserContext(user);
        return { content: `Added ${name} (${role}) as a top-level agent on the team.`, success: true };
      }

      case 'add_tool_to_agent': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const target = call.input.agentName?.toString().toLowerCase();
        const agent = team.find((a) => a.name?.toLowerCase() === target || a.id?.toLowerCase() === target);
        if (!agent) {
          return { content: `Couldn't find an agent named "${call.input.agentName}". Team members: ${team.map((a) => a.name).join(', ')}.`, success: false };
        }
        const tool = call.input.tool?.toString().trim();
        if (!tool) return { content: 'Missing tool name.', success: false };
        const existing = agent.tools ?? [];
        if (existing.some((t) => t.toLowerCase() === tool.toLowerCase())) {
          return { content: `${agent.name} already has ${tool}.`, success: true };
        }
        agent.tools = [...existing, tool];
        user.profile.team = team;
        await saveUserContext(user);
        return { content: `Added ${tool} to ${agent.name}'s toolset.`, success: true };
      }

      case 'update_agent': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const target = call.input.agentName?.toString().toLowerCase();
        const agent = team.find((a) => a.name?.toLowerCase() === target || a.id?.toLowerCase() === target);
        if (!agent) {
          return { content: `Couldn't find "${call.input.agentName}".`, success: false };
        }
        const changes: string[] = [];
        if (call.input.role) {
          agent.role = call.input.role;
          changes.push(`role → "${call.input.role}"`);
        }
        if (call.input.description) {
          agent.description = call.input.description;
          changes.push('description updated');
        }
        if (Array.isArray(call.input.addChannels) && call.input.addChannels.length > 0) {
          const existing = agent.channels ?? [];
          const merged = [...existing];
          for (const c of call.input.addChannels) {
            if (!merged.some((x) => x.toLowerCase() === c.toLowerCase())) merged.push(c);
          }
          agent.channels = merged;
          changes.push(`channels: ${merged.join(', ')}`);
        }
        if (changes.length === 0) {
          return { content: 'Nothing to update — pass role, description, or addChannels.', success: false };
        }
        user.profile.team = team;
        await saveUserContext(user);
        return { content: `Updated ${agent.name}: ${changes.join('; ')}.`, success: true };
      }

      case 'move_agent_under_manager': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const targetName = call.input.agentName?.toString().toLowerCase();
        const parentName = call.input.parentAgentName?.toString().toLowerCase();
        if (!targetName || !parentName) return { content: 'Missing agentName or parentAgentName.', success: false };

        const newParent = team.find((a) => a.name?.toLowerCase() === parentName || a.id?.toLowerCase() === parentName);
        if (!newParent) {
          return { content: `Couldn't find a manager named "${call.input.parentAgentName}". Top-level: ${team.map((a) => a.name).join(', ')}.`, success: false };
        }
        if (newParent.name?.toLowerCase() === targetName) {
          return { content: `${newParent.name} can't be moved under themselves.`, success: false };
        }

        // Find and detach the target — first check top-level, then every sub-team
        let movedAgent: any = null;
        const topIdx = team.findIndex((a) => a.name?.toLowerCase() === targetName || a.id?.toLowerCase() === targetName);
        if (topIdx >= 0) {
          movedAgent = team.splice(topIdx, 1)[0];
        } else {
          for (const a of team) {
            if (!a.subTeam?.agents) continue;
            const subIdx = a.subTeam.agents.findIndex((s) => s.name?.toLowerCase() === targetName || s.id?.toLowerCase() === targetName);
            if (subIdx >= 0) {
              movedAgent = a.subTeam.agents.splice(subIdx, 1)[0];
              a.subTeam.count = a.subTeam.agents.length;
              break;
            }
          }
        }
        if (!movedAgent) {
          return { content: `Couldn't find an agent named "${call.input.agentName}" anywhere on the team.`, success: false };
        }

        // Attach to new parent's sub-team (preserve as much as we can)
        const sub = newParent.subTeam ?? { count: 0, label: `${newParent.name}'s team`, agents: [] };
        sub.agents.push({
          id: movedAgent.id ?? targetName,
          name: movedAgent.name,
          role: movedAgent.role,
          tier: movedAgent.tier,
        });
        sub.count = sub.agents.length;
        newParent.subTeam = sub;

        user.profile.team = team;
        await saveUserContext(user);
        return { content: `Moved ${movedAgent.name} under ${newParent.name}. ${newParent.name}'s team is now ${sub.count}.`, success: true };
      }

      case 'remove_agent_from_team': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const target = call.input.agentName?.toString().toLowerCase();
        if (!target) return { content: 'Missing agentName.', success: false };

        const topIdx = team.findIndex((a) => a.name?.toLowerCase() === target || a.id?.toLowerCase() === target);
        if (topIdx >= 0) {
          if (team[topIdx]?.required) {
            return { content: `${team[topIdx].name} is your required personal assistant — can't remove.`, success: false };
          }
          const removed = team.splice(topIdx, 1)[0];
          user.profile.team = team;
          await saveUserContext(user);
          return { content: `Removed ${removed?.name} from the team.`, success: true };
        }
        for (const a of team) {
          if (!a.subTeam?.agents) continue;
          const subIdx = a.subTeam.agents.findIndex((s) => s.name?.toLowerCase() === target || s.id?.toLowerCase() === target);
          if (subIdx >= 0) {
            const removed = a.subTeam.agents.splice(subIdx, 1)[0];
            a.subTeam.count = a.subTeam.agents.length;
            user.profile.team = team;
            await saveUserContext(user);
            return { content: `Removed ${removed?.name} from ${a.name}'s sub-team.`, success: true };
          }
        }
        return { content: `Couldn't find an agent named "${call.input.agentName}" on the team.`, success: false };
      }

      case 'consult_manager': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const team = user.profile?.team ?? [];
        const target = call.input.managerName?.toString().toLowerCase();
        const manager = team.find((a) => a.name?.toLowerCase() === target || a.id?.toLowerCase() === target);
        if (!manager) {
          return { content: `No manager named "${call.input.managerName}" on the team. Top-level: ${team.map((a) => a.name).join(', ')}.`, success: false };
        }
        const proposal = call.input.proposal?.toString().trim();
        if (!proposal) return { content: 'Missing proposal.', success: false };

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return { content: `${manager.name} is offline (no API key). Skipping consultation.`, success: false };
        }

        // Build a brief persona prompt from the manager's profile
        const personaLines = [
          `You are ${manager.name}, ${manager.role}.`,
          manager.description ? `Your remit: ${manager.description}` : '',
          manager.tools?.length ? `Your current tools: ${manager.tools.join(', ')}.` : '',
          manager.subTeam?.count ? `You manage ${manager.subTeam.count} ${manager.subTeam.label || 'specialists'}.` : '',
          `Business context: ${user.businessName ?? 'this business'} — ${user.businessType ?? 'unknown industry'}.`,
          '',
          'A teammate is asking your opinion on a proposed change to the team. Give a short, direct take (under 80 words):',
          '- Does it overlap with your scope? Should it report to you?',
          '- Is it actually needed, or is it solving a problem the existing team can already solve?',
          '- Any risk you see (budget, scope creep, redundancy)?',
          'Speak in first person. Be honest — push back if it doesn\'t make sense.',
        ].filter(Boolean).join('\n');

        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              system: [{ type: 'text', text: personaLines, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: `Proposal: ${proposal}\n\nYour take?` }],
            }),
          });
          if (!res.ok) {
            const err = await res.json();
            return { content: `${manager.name} consultation failed: ${JSON.stringify(err)}`, success: false };
          }
          const data = await res.json();
          const reply = data.content?.find((b: any) => b.type === 'text')?.text ?? '(no response)';
          return { content: `${manager.name} (${manager.role}) says:\n${reply}`, success: true };
        } catch (err) {
          return { content: `${manager.name} consultation error: ${err}`, success: false };
        }
      }

      case 'connect_service': {
        const provider = call.input.provider?.toString().toLowerCase();
        const service = call.input.service?.toString().toLowerCase();
        const cfg = SUPPORTED_PROVIDERS[provider];
        if (!cfg) {
          return {
            content: `Provider "${provider}" isn't wired up yet. Supported: ${Object.keys(SUPPORTED_PROVIDERS).join(', ')}.`,
            success: false,
          };
        }
        const phone = user?.phoneNumber ?? '';
        const url = `${APP_BASE_URL}${cfg.route}?phone=${encodeURIComponent(phone)}${service ? `&service=${encodeURIComponent(service)}` : ''}`;
        return {
          content: `Connect ${provider}${service ? ` (${service})` : ''} here: ${url}\nThe link opens the OAuth flow for the user's account.`,
          success: true,
        };
      }

      default:
        return { content: `Unknown tool: ${call.name}`, success: false };
    }
  } catch (err) {
    return { content: `Tool execution error: ${err}`, success: false };
  }
}
