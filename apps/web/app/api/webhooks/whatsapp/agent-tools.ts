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
import { listImapUnread, sendImap, searchImap } from '../../_lib/imap-runtime';
import { queryKnowledge } from '../../_lib/knowledge-base';
import { logCorrection } from '../../_lib/classification-learning';
import { transitionProcess, proposeWorkflowFor } from '../../_lib/process-capture';
import { listAllSkills, retireSkill } from '../../_lib/skill-formation';
import { getVoiceProfile, getTopContacts, renderVoiceForDraft, searchContacts, type TopContact } from '../../_lib/email-intelligence';
import { listPendingFollowups, markFollowupSent, markFollowupDeclined } from '../../_lib/email-followup';
import { decryptToken } from '@wisdomworks/shared';
import { setMute, clearMute, isMuted, formatMuteUntil } from '../../_lib/mute-state';
import { definePerson, listKnownPeople, forgetPerson } from '../../_lib/known-people';
import { listAllAtoms, archiveAtom, confirmAtom, upsertAtom, type AtomKind } from '../../_lib/knowledge-atoms';
import { computeMonthlyUsage, evaluateBudget } from '../../_lib/usage-tracker';
import { createLinkCode, type Channel } from '../../_lib/messaging-adapters';
import { signSessionToken } from '../../_lib/api-auth';
import {
  upsertClientProfile,
  recordClientVisit,
  lookupClients,
  listClients,
  getClientProfile,
  listClientVisits,
} from '../../_lib/client-profiles';
import { loadEmailPrefs, saveEmailPrefs } from '../../_lib/email-notifications';
import { listOpenInsights, getInsightById, setInsightStatus } from '../../_lib/business-insights';
import { emitTeamGapInsight, loadCurrentTeam, loadLatestOpenTeamGap } from '../../_lib/team-gap-detector';
import { loadActiveBookingConnections, syncCustomersFromConnection } from '../../_lib/booking-adapters/customer-sync';
import { squareAdapter, calendlyAdapter, mindbodyAdapter } from '../../_lib/booking-adapters';
import {
  createEvent as createManagedEvent,
  cancelEvent as cancelManagedEvent,
  listEventsInRange,
  buildUnifiedSchedule,
  detectConflicts,
} from '../../_lib/managed-calendar';
import {
  createApiKey as createWidgetApiKey,
  listApiKeysForTenant,
  revokeApiKey as revokeWidgetApiKey,
} from '../../_lib/widget-auth';
import {
  createTenantSite,
  getTenantSiteByTenant,
} from '../../_lib/tenant-sites';
import {
  createWebhook as createEventWebhook,
  listWebhooks as listEventWebhooks,
  revokeWebhook as revokeEventWebhook,
} from '../../_lib/event-webhooks';
import { detectConnectionGaps } from '../../_lib/connection-gap-detector';
import {
  listStripeCharges,
  createStripePaymentLink,
  fetchStripeAccount,
} from '../../_lib/integrations/stripe-connect';
import {
  fetchOutstandingAR,
  listInvoices as qboListInvoices,
  createInvoice as qboCreateInvoice,
  findOrCreateCustomer as qboFindOrCreateCustomer,
  refreshQuickBooksToken,
} from '../../_lib/integrations/quickbooks';
import {
  summarizeInstagramActivity,
  publishInstagramPhoto,
  publishInstagramReel,
  publishFacebookPagePost,
  replyToInstagramComment,
} from '../../_lib/integrations/meta-business';
import { generateVideo, estimateGenerationCost, startVideoGeneration } from '../../_lib/integrations/replicate-video';
import { sendWhatsAppVideo, sendWhatsAppImage } from '../../_lib/whatsapp-media-send';
import {
  saveMarketingStyle,
  listMarketingStyles,
  findStyleByName,
  deleteMarketingStyle,
  recordStyleUsed,
} from '../../_lib/marketing-styles';
import {
  listDrafts,
  getDraft,
  dismissDraft,
  approveDraft,
  loadAutonomyPrefs,
  saveAutonomyPrefs,
  proposeDraft,
  type AutonomyLevel,
  type DraftChannel,
} from '../../_lib/marketing-drafts';
import { trackPostPublished, recentPerformance } from '../../_lib/marketing-performance';
import {
  loadActiveConnections,
  loadLatestSnapshot,
  fetchGitHubCommits,
  fetchGitHubIssues,
  fetchGitHubFile,
  fetchGitHubTree,
  fetchVercelDeployments,
} from '../../_lib/project-sync';
import { enqueueResearch, loadPendingResearch, processResearchRequest, type ResearchKind } from '../../_lib/research';
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
/**
 * Public app base — used to build any URL Iris hands to the owner.
 * NEVER falls back to localhost; if neither env var is set, this is null
 * and url-building tool cases must refuse rather than send a broken link.
 * (Bug 2026-05-13: a localhost:3001 link reached Devon's phone because
 * the old fallback string snuck through.)
 */
const APP_BASE_URL: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.NEXT_PUBLIC_WEBSITE_URL || '').trim();
  if (!raw) return null;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(raw)) return null;
  return raw.replace(/\/$/, '');
})();

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
    "List the user's UNREAD emails from the last 24 hours. Returns sender, subject, and a preview. Use only when the user is asking what's NEW in their inbox right now. If they're asking about a specific email (already read, older than 24h, or referenced by sender/subject) use search_emails instead.",
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

const TOOL_SEARCH_EMAILS: AnthropicTool = {
  name: 'search_emails',
  description:
    "Find specific emails (READ OR UNREAD) by sender, subject, or body keyword — across the last 30 days by default. Use whenever the owner references a specific email they want to act on: 'reply to John', 'find that quote from Acme', 'pull up the kitchen rewire thread'. Returns full body so you can draft a reply. This is the right tool when the email might already be read.",
  input_schema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: "Sender name or email substring. e.g. 'John' or 'acme.com'." },
      subject: { type: 'string', description: "Subject substring. e.g. 'kitchen rewire'." },
      body_keyword: { type: 'string', description: "Keyword in body. Use when from/subject aren't enough." },
      since_days: { type: 'number', description: 'How far back to search. Default 30.' },
      limit: { type: 'number', description: 'Max results. Default 10.' },
    },
  },
};

const TOOL_SEND_EMAIL: AnthropicTool = {
  name: 'send_email',
  description:
    "Send an email on behalf of the user. NEVER call this unless the user's MOST RECENT message is explicit approval to send THIS SPECIFIC email (e.g. 'send it', 'send the email to John', 'yes send', 'approve and send'). If the user pivoted topics (asked something unrelated, requested a different action, said an ambiguous 'yes' more than one turn after the draft was shown), the draft stays unsent — do NOT fire this tool. When in doubt, ask 'Should I send the email to <recipient>?' and wait for a yes-specific-to-that.",
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

const TOOL_MUTE: AnthropicTool = {
  name: 'mute_assistant',
  description:
    "Suppress proactive WhatsApp messages (digests, escalations, follow-up prompts, briefings) for a window of time. Use IMMEDIATELY when the user signals they're unavailable: 'going on a drive', 'in a meeting', 'talk later', 'gimme an hour', 'I'm busy', 'be quiet', 'stop texting me', 'shh'. Inbound user messages still work — Iris still replies when texted. Default duration if user doesn't specify: 4 hours. ALWAYS call this rather than just acknowledging — silence is the action they want.",
  input_schema: {
    type: 'object',
    properties: {
      duration_minutes: { type: 'number', description: 'How long to stay quiet, in minutes. Defaults to 240 (4 hours) if not specified. Use Infinity-equivalent (do not pass) for indefinite.' },
      reason: { type: 'string', description: "1-2 word context, e.g. 'driving', 'meeting', 'busy'. Stored so logs are interpretable." },
    },
  },
};

const TOOL_UNMUTE: AnthropicTool = {
  name: 'unmute_assistant',
  description:
    "Resume proactive WhatsApp pushes after a mute. Use when user says 'I'm back', 'you can text me again', 'all good', 'ready', 'unmute', or otherwise signals they're available again.",
  input_schema: { type: 'object', properties: {} },
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

// ─── Entity registry (disambiguate "Ron the attorney" from "Alex the agent") ───
const TOOL_DEFINE_PERSON: AnthropicTool = {
  name: 'define_person',
  description:
    "Record that someone is in the owner's personal/business network so agents stop confusing real humans with teammates. Use whenever the owner says 'Ron is my attorney', 'Sarah is my CPA', 'the Andersons are my clients', or similar. Future ticks will see this person in the agents' prompt so they don't conflate names.",
  input_schema: {
    type: 'object',
    properties: {
      display_name: { type: 'string', description: "Full name as it should appear, e.g. 'Ron Beaman'." },
      role: { type: 'string', description: "Relationship/role: 'attorney', 'accountant', 'client', 'spouse', 'partner at Acme Corp', etc." },
      notes: { type: 'string', description: 'Optional 1-2 sentences of context.' },
      email: { type: 'string', description: "Optional email address to cross-reference with contact records." },
    },
    required: ['display_name'],
  },
};

const TOOL_LIST_KNOWN_PEOPLE: AnthropicTool = {
  name: 'list_known_people',
  description:
    "List everyone in the owner's personal/business network the assistant has been told about (manually or auto-mined). Use when the owner asks 'who do you know?', 'what do you have for me?', or when you need to look someone up before drafting an email or making a recommendation.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_FORGET_PERSON: AnthropicTool = {
  name: 'forget_person',
  description:
    "Remove someone from the registry. Use when the owner says 'forget about X', 'X is no longer my Y', or corrects an auto-mined entry. The owner usually provides the name; resolve it to an id via list_known_people first.",
  input_schema: {
    type: 'object',
    properties: { person_id: { type: 'string', description: 'The id from list_known_people.' } },
    required: ['person_id'],
  },
};

// ─── Project discovery tools (Au7o / connected external projects) ───
const TOOL_GET_PROJECT_STATUS: AnthropicTool = {
  name: 'get_project_status',
  description:
    "Get the current state of one of the user's connected external projects (Au7o, WisdomWorks itself, customer sites). Returns the latest snapshot: production deploy URL, build status, recent commits, open issues, recent build errors, README excerpt. Use when an agent assigned to a project wants to know what's going on. If project_name omitted, returns all connected projects.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string', description: "Optional. Exact project_name (e.g. 'Au7o'). Omit to see all projects connected to the user." },
    },
  },
};

// ─── Phase 1A — Knowledge atom recall / management ───
const TOOL_RECALL_ATOMS: AnthropicTool = {
  name: 'recall_atoms',
  description:
    "Show what the team has learned about the owner from their messages — competitors flagged, goals stated, preferences, constraints, recent events. Use when the user asks 'what do you remember about me' / 'what do you know about my business' / 'show me my preferences' or when an agent needs to refresh context beyond what's in the tick prompt.",
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['competitor', 'goal', 'preference', 'constraint', 'person', 'event', 'fact'], description: 'Optional filter by kind.' },
    },
  },
};

const TOOL_CONFIRM_ATOM: AnthropicTool = {
  name: 'confirm_atom',
  description:
    "Mark an auto-extracted atom as owner-confirmed (locks confidence at 1.0, never gets overwritten by future extraction). Use when the owner explicitly endorses or corrects something the team has learned.",
  input_schema: {
    type: 'object',
    properties: { atom_id: { type: 'string', description: 'The 8-char prefix or full UUID from recall_atoms.' } },
    required: ['atom_id'],
  },
};

const TOOL_ARCHIVE_ATOM: AnthropicTool = {
  name: 'archive_atom',
  description:
    "Archive an atom that's wrong, stale, or no longer applies. Removes it from agent prompts. Use when owner says 'no, that's not right' / 'forget about X'.",
  input_schema: {
    type: 'object',
    properties: { atom_id: { type: 'string' } },
    required: ['atom_id'],
  },
};

const TOOL_REMEMBER_THIS: AnthropicTool = {
  name: 'remember_this',
  description:
    "Explicitly remember something the owner just told you, with owner_confirmed=true. Use when the owner makes a clear declarative statement worth durable storage ('we don't email after 7pm', 'my main competitor is X', 'my goal this quarter is Y'). IMPORTANT TAG RULES: always include 'general' in tags if this fact applies to ALL agents (not just one lane). For platform-level statements about what isn't built / is on the roadmap, include 'known_gap' or 'platform' or 'roadmap' so every agent stops flagging it as missing.",
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['competitor', 'goal', 'preference', 'constraint', 'person', 'event', 'fact'] },
      content: { type: 'string', description: 'Third-person factual statement — e.g. "Owner does not want emails sent after 7pm local time."' },
      tags: { type: 'array', items: { type: 'string' }, description: "Lowercase tags for filtering. ALWAYS include 'general' if the fact applies platform-wide (most do). For roadmap/known-gap items: 'known_gap', 'roadmap', 'platform'. For lane-specific facts: the lane name (operations / marketing / etc.)." },
    },
    required: ['kind', 'content'],
  },
};

// ─── Phase 2 — Research / competitive intelligence ───
const TOOL_REQUEST_RESEARCH: AnthropicTool = {
  name: 'request_research',
  description:
    "Queue a research request — Iris will run actual web searches and bring back a structured brief. Use when the owner mentions a competitor, market trend, news event, or asks 'what do you think about X', AND outside data would meaningfully inform the answer. Owner-initiated requests bypass the daily 5-search cap. Returns a request id; the synthesized brief lands in the approval queue when ready.",
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: "What to research, e.g. 'getviktor.com positioning and pricing' or 'best practices for solo entrepreneur scheduling'." },
      reason: { type: 'string', description: "Why this matters — gives the researcher context and the owner the rationale when the brief lands." },
      kind: { type: 'string', enum: ['competitor_analysis', 'market_research', 'best_practices', 'fact_check', 'general'], description: 'Defaults to general. Use competitor_analysis when the topic is a named competitor.' },
      owner_initiated: { type: 'boolean', description: 'Set true when the OWNER asked for this research directly (bypasses the daily search cap). Default false for agent-initiated.' },
    },
    required: ['topic'],
  },
};

const TOOL_LIST_PENDING_RESEARCH: AnthropicTool = {
  name: 'list_pending_research',
  description:
    "List research requests currently pending or in progress. Use when the user asks 'what are you researching for me' or to check Iris's queue.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_LIST_ALL_PROJECTS: AnthropicTool = {
  name: 'list_all_projects',
  description:
    "List EVERY project connected to the tenant across ALL agents — not just this agent's. Returns each project's name, provider, status, which agent is assigned, last sync time, and any sync error. Use when the owner asks 'what's connected?', 'are Alex and Marcus set up?', 'show me my projects', 'what do my agents have access to'. This is the answer to verification questions about project connections.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_GET_MY_SPEND: AnthropicTool = {
  name: 'get_my_spend',
  description:
    "Report the owner's current month-to-date AI spend and how close they are to the included budget. Use ONLY when the owner explicitly asks about cost / spend / bill / usage / 'how much have I used' / 'what's my burn'. Returns: month-to-date $, monthly budget $, % used, days-to-exhaustion, and breakdown by category (chat vs background agents). Do not proactively cite costs in unrelated replies — only when asked.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_GET_SPEND_BREAKDOWN: AnthropicTool = {
  name: 'get_spend_breakdown',
  description:
    "Detailed per-agent and per-model spend breakdown for the current month. Use when the owner asks 'where's my budget going?', 'which agent costs the most?', 'show me the breakdown'. Returns cost per agent_name and per model_used.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_ISSUE_DECK_LOGIN: AnthropicTool = {
  name: 'issue_deck_login',
  description:
    "Generate a magic-link URL the owner can tap to sign into the Command Deck on their phone or laptop. Use when the owner says 'send me a login link', 'log me in to the deck', 'I need to sign in', or whenever they want to view the dashboard. Returns a fully-formed URL valid for 30 days that, when clicked, sets a secure session cookie. NEVER paste deck URLs that lack a token — the deck refuses unauthenticated access.",
  input_schema: { type: 'object', properties: {} },
};

// ─── Marketing video generation + preview ────────────────────────────────

const TOOL_GENERATE_MARKETING_VIDEO: AnthropicTool = {
  name: 'generate_marketing_video',
  description:
    "Generate a short marketing video via Replicate AI. Use when the owner asks for a reel / video / marketing clip on a topic. ALWAYS mention the estimated cost before generating (third-party cost transparency rule). After generation, the next step is typically send_video_preview to show the owner on WhatsApp + ask for approval before publish_instagram_reel. Quality tiers: 'fast' (~$0.10, 5s), 'standard' (~$0.40, 6s, polished), 'premium' (~$1.25, 8s, best). Default fast unless owner specifies. To match a saved brand style (e.g. 'Au7o energetic'), pass style_name — the style's description is prepended to the prompt.",
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed visual prompt for the model. Be specific about scene, mood, motion, lighting. e.g. "Close-up of a hand turning the ignition key in a vintage sports car at sunset, golden hour, smooth cinematic motion."' },
      quality: { type: 'string', enum: ['fast', 'standard', 'premium'], description: 'Cost/quality tier. Default fast.' },
      duration_sec: { type: 'number', description: 'Video duration in seconds (model-dependent, typically 5-10).' },
      aspect_ratio: { type: 'string', enum: ['9:16', '16:9', '1:1'], description: '9:16 for Reels (default), 1:1 for square posts.' },
      style_name: { type: 'string', description: 'Optional name of a saved marketing style (from save_marketing_style). Its description is prepended to the prompt for brand consistency.' },
    },
    required: ['prompt'],
  },
};

const TOOL_SAVE_MARKETING_STYLE: AnthropicTool = {
  name: 'save_marketing_style',
  description:
    "Save a named marketing style template the owner can reuse across reel generations. Examples: 'Au7o energetic' = 'cinematic, neon, fast cuts, modern tech aesthetic, dramatic lighting'. Once saved, the owner can pass style_name to generate_marketing_video and the description gets prepended automatically. Use when the owner says 'save this style as X', 'remember this look', or after they describe a style they like.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short owner-friendly name (e.g. "Au7o energetic", "salon dreamy").' },
      style_prompt: { type: 'string', description: 'The style description that gets prepended to future generation prompts. Be descriptive about visual elements: mood, color palette, motion, camera angles, lighting, brand vibe.' },
      reference_video_url: { type: 'string', description: 'Optional URL to a reference video the owner sent.' },
      reference_image_url: { type: 'string', description: 'Optional URL to a reference image (e.g. brand assets).' },
      default_quality: { type: 'string', enum: ['fast', 'standard', 'premium'], description: 'Default tier when this style is used. Defaults to fast.' },
    },
    required: ['name', 'style_prompt'],
  },
};

const TOOL_LIST_MARKETING_STYLES: AnthropicTool = {
  name: 'list_marketing_styles',
  description:
    "List the owner's saved marketing styles with use counts. Use when owner asks 'what styles do I have', 'show my brand templates', 'which styles am I using most'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_DELETE_MARKETING_STYLE: AnthropicTool = {
  name: 'delete_marketing_style',
  description:
    "Delete a saved marketing style by name. Use when owner says 'delete the X style', 'I don't want that template anymore'.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
  },
};

// ─── Marketing drafts (L3 proactive) ─────────────────────────────────────

const TOOL_LIST_MARKETING_DRAFTS: AnthropicTool = {
  name: 'list_marketing_drafts',
  description:
    "List the owner's open marketing drafts (proposals waiting for approval). Use when owner asks 'what marketing ideas do you have', 'show my drafts', 'any pending posts', 'what did you draft for me'. Drafts are produced by the marketing-loop cron when the owner is on L3 autonomy. Each shows a short id, topic, channel, and estimated cost.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['proposed', 'approved', 'published', 'dismissed', 'failed', 'expired'],
        description: 'Filter by status. Defaults to "proposed" (open ones).',
      },
      limit: { type: 'number', description: 'Max drafts to return. Defaults to 8.' },
    },
  },
};

const TOOL_PROPOSE_MARKETING_DRAFT: AnthropicTool = {
  name: 'propose_marketing_draft',
  description:
    "Propose a new marketing draft on demand (owner-requested). Useful when the owner says 'draft a reel about X but don't post yet' or 'add a post idea to my queue: X'. This stores the concept without generating the video — they can review later, then approve to trigger generation + publish. To draft AND publish in one go, use generate_marketing_video + publish_instagram_reel instead.",
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Short label so the owner recognizes the idea later.' },
      caption: { type: 'string', description: 'Proposed Instagram caption (1-3 lines).' },
      prompt: { type: 'string', description: 'Visual prompt for the video model when generation runs.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags (without # prefix or with — both work).' },
      channel: { type: 'string', enum: ['instagram_reel', 'instagram_post', 'facebook_post'] },
    },
    required: ['topic', 'caption', 'prompt'],
  },
};

const TOOL_APPROVE_MARKETING_DRAFT: AnthropicTool = {
  name: 'approve_marketing_draft',
  description:
    "Approve a proposed marketing draft. By default this fires video generation and sends the video to the owner's WhatsApp for final preview (pending-action safety rule — DOES NOT publish until the owner sees the actual video and confirms 'publish it'). Pass auto_publish=true ONLY when the owner has already approved both the concept AND the generated video. Returns the video URL on success.",
  input_schema: {
    type: 'object',
    properties: {
      draft_id: { type: 'string', description: 'Full UUID or 8-char prefix from list_marketing_drafts.' },
      auto_publish: { type: 'boolean', description: 'Set true ONLY after owner has approved the generated video. Default false (preview-only).' },
      style_name: { type: 'string', description: 'Optional saved style name to apply before generating.' },
    },
    required: ['draft_id'],
  },
};

const TOOL_DISMISS_MARKETING_DRAFT: AnthropicTool = {
  name: 'dismiss_marketing_draft',
  description:
    "Dismiss a proposed marketing draft the owner doesn't want. Use when owner says 'pass on that one', 'dismiss draft X', 'not interested in the X idea'.",
  input_schema: {
    type: 'object',
    properties: {
      draft_id: { type: 'string', description: 'Full UUID or 8-char prefix.' },
    },
    required: ['draft_id'],
  },
};

const TOOL_GET_MARKETING_AUTONOMY: AnthropicTool = {
  name: 'get_marketing_autonomy',
  description:
    "Show the owner their current marketing autonomy settings: level (L1-L4), cadence, max daily auto-publishes, confidence threshold, channels and blocked words. Use when owner asks 'how autonomous is marketing', 'what are my marketing settings', 'why isn't the agent posting on its own'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_SET_MARKETING_AUTONOMY: AnthropicTool = {
  name: 'set_marketing_autonomy',
  description:
    "Update the owner's marketing autonomy preferences. L1=manual, L2=draft+approve (default), L3=propose proactively on cadence, L4=autonomous publish within guardrails. Increasing to L4 REQUIRES at least one auto-publish channel and a positive daily cap. ALWAYS confirm with the owner before raising the level — autonomy changes affect what posts go out without their review.",
  input_schema: {
    type: 'object',
    properties: {
      autonomy_level: { type: 'string', enum: ['L1', 'L2', 'L3', 'L4'] },
      max_auto_publish_per_day: { type: 'number', description: 'L4 only — max posts auto-published per day. Default 0.' },
      min_confidence_for_auto: { type: 'number', description: '0..1 — min concept confidence to auto-publish at L4. Default 0.85.' },
      blocked_words: { type: 'array', items: { type: 'string' }, description: 'Words/phrases that block auto-publish (force owner review).' },
      auto_publish_channels: {
        type: 'array',
        items: { type: 'string', enum: ['instagram_reel', 'instagram_post', 'facebook_post', 'tiktok'] },
        description: 'Channels owner authorizes for autonomous publishing at L4.',
      },
      draft_cadence_days: { type: 'number', description: 'How often the L3 detector wakes up to propose new drafts. Default 7.' },
    },
  },
};

const TOOL_MARKETING_PERFORMANCE: AnthropicTool = {
  name: 'marketing_performance_summary',
  description:
    "Show how the owner's recent marketing posts are performing. Returns the last 10 posts with likes, comments, reach, and a hour-discounted performance score so newer posts aren't unfairly compared. Use when owner asks 'how are my posts doing', 'what's working on instagram', 'which post performed best'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_SEND_VIDEO_PREVIEW: AnthropicTool = {
  name: 'send_video_preview',
  description:
    "Send a video file directly into the owner's WhatsApp chat as a preview before publishing. Use AFTER generate_marketing_video produces a URL, so the owner can see the actual video and approve or ask for regeneration. The video plays inline in WhatsApp.",
  input_schema: {
    type: 'object',
    properties: {
      video_url: { type: 'string', description: 'Public HTTPS MP4 URL (from generate_marketing_video output).' },
      caption: { type: 'string', description: 'Caption text shown under the video. Usually the proposed Instagram caption so the owner sees the full package.' },
    },
    required: ['video_url'],
  },
};

const TOOL_VIDEO_GEN_COST: AnthropicTool = {
  name: 'estimate_video_cost',
  description:
    "Surface the estimated cost of a video generation before firing it. Use proactively in the conversation when the owner asks about marketing videos so they know what they're spending. Returns the model + cost + default duration per quality tier.",
  input_schema: {
    type: 'object',
    properties: {
      quality: { type: 'string', enum: ['fast', 'standard', 'premium'] },
    },
  },
};

// ─── Meta Business (Instagram + Facebook) ────────────────────────────────

const TOOL_INSTAGRAM_ACTIVITY: AnthropicTool = {
  name: 'instagram_recent_activity',
  description:
    "Pull the owner's last 6 Instagram posts with like/comment counts + the latest comment per post. Use when owner asks 'how's instagram doing', 'any new comments', 'what's the engagement on my recent posts', 'check IG'. Requires Meta Business connected.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_PUBLISH_INSTAGRAM_POST: AnthropicTool = {
  name: 'publish_instagram_post',
  description:
    "Publish a photo to the owner's Instagram. NEVER call without explicit owner approval of THIS specific caption + image (pending-action safety rule applies). Image must be a public HTTPS URL. After approval, hits Meta Graph API two-step: create container → publish. Returns the new post id and permalink.",
  input_schema: {
    type: 'object',
    properties: {
      image_url: { type: 'string', description: 'Public HTTPS URL of the image to post.' },
      caption: { type: 'string', description: 'Caption (max 2200 chars). Include hashtags inline.' },
    },
    required: ['image_url', 'caption'],
  },
};

const TOOL_PUBLISH_INSTAGRAM_REEL: AnthropicTool = {
  name: 'publish_instagram_reel',
  description:
    "Publish an Instagram Reel given a video URL + caption. NEVER call without explicit owner approval of THIS specific caption + video (pending-action safety rule). The video MUST be public HTTPS, MP4 H.264 + AAC, 3-90s, <100MB, ideally 9:16 aspect. After approval, Meta encodes the video (15-60s), then publishes. Returns the new reel id.",
  input_schema: {
    type: 'object',
    properties: {
      video_url: { type: 'string', description: 'Public HTTPS URL to an MP4 video.' },
      caption: { type: 'string', description: 'Caption (max 2200 chars). Hashtags inline.' },
      share_to_feed: { type: 'boolean', description: 'Also share to main feed (default true).' },
    },
    required: ['video_url', 'caption'],
  },
};

const TOOL_PUBLISH_FACEBOOK_POST: AnthropicTool = {
  name: 'publish_facebook_post',
  description:
    "Publish a post to the owner's connected Facebook Page. NEVER call without explicit owner approval of THIS specific post (pending-action safety rule). Use when owner says 'post this to Facebook', 'share that on FB'. Optional image_url posts as a photo with caption; optional link_url posts with a link preview; otherwise plain text.",
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Post text (max 5000 chars).' },
      image_url: { type: 'string', description: 'Optional public HTTPS image URL — converts to a photo post.' },
      link_url: { type: 'string', description: 'Optional URL to share. If image_url is set, link is ignored.' },
    },
    required: ['message'],
  },
};

const TOOL_REPLY_INSTAGRAM_COMMENT: AnthropicTool = {
  name: 'reply_to_instagram_comment',
  description:
    "Reply to a specific Instagram comment. NEVER call without explicit owner approval of THIS specific reply (pending-action rule). Use after instagram_recent_activity surfaces a comment worth responding to.",
  input_schema: {
    type: 'object',
    properties: {
      media_id: { type: 'string', description: 'The Instagram post id (from instagram_recent_activity).' },
      comment_id: { type: 'string', description: 'The parent comment id to reply to.' },
      message: { type: 'string', description: 'Reply text.' },
    },
    required: ['media_id', 'comment_id', 'message'],
  },
};

// ─── Stripe Connect (payments) ────────────────────────────────────────────

const TOOL_CREATE_PAYMENT_LINK: AnthropicTool = {
  name: 'create_payment_link',
  description:
    "Generate a Stripe payment link to send to a customer. Use when owner says 'send X an invoice for Y', 'charge the customer', 'I need to get paid for the job'. Returns a Stripe-hosted URL the customer taps to pay by card. Owner gets paid into their connected Stripe account. NOTE: Stripe charges 2.9% + $0.30 per transaction (customer's choice to keep WisdomWorks transparent on third-party costs).",
  input_schema: {
    type: 'object',
    properties: {
      amount_usd: { type: 'number', description: 'Amount in USD (e.g. 125.50).' },
      description: { type: 'string', description: 'What the payment is for ("Kitchen rewire — 4 hours", "Balayage + toner").' },
      customer_email: { type: 'string', description: 'Optional — for receipt routing.' },
    },
    required: ['amount_usd', 'description'],
  },
};

const TOOL_LIST_RECENT_PAYMENTS: AnthropicTool = {
  name: 'list_recent_payments',
  description:
    "List the owner's recent Stripe charges (paid + pending). Use when owner asks 'who paid me', 'what came in this week', 'show me my payouts', 'recent revenue'.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 10.' },
    },
  },
};

// ─── QuickBooks Online (accounting) ──────────────────────────────────────

const TOOL_QBO_OUTSTANDING_AR: AnthropicTool = {
  name: 'qbo_outstanding_ar',
  description:
    "Show how much money the owner is currently owed via QuickBooks (sum of all unpaid invoice balances + count + oldest due date). Use when owner asks 'who owes me money', 'what's outstanding', 'how much is owed', 'how's my AR'. Requires QuickBooks Online connected.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_QBO_LIST_UNPAID_INVOICES: AnthropicTool = {
  name: 'qbo_list_unpaid_invoices',
  description:
    "List the owner's unpaid QuickBooks invoices with customer, amount, balance, due date, and overdue flag. Use when owner asks for a specific list of who owes what. After listing, the owner often wants a draft follow-up — surface that.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 10.' },
    },
  },
};

const TOOL_QBO_CREATE_INVOICE: AnthropicTool = {
  name: 'qbo_create_invoice',
  description:
    "Create an invoice in QuickBooks for a specific customer + amount. Pending-action safety: NEVER fire this from a vague request — ALWAYS confirm customer name, amount, what it's for, and due date with the owner first. Creates a customer record if one doesn't exist by that name. Returns the QuickBooks doc number.",
  input_schema: {
    type: 'object',
    properties: {
      customer_name: { type: 'string', description: 'Customer display name. We find or create the customer by this name.' },
      customer_email: { type: 'string', description: 'Optional — only used when creating a new customer.' },
      amount_usd: { type: 'number', description: 'Invoice amount in USD.' },
      description: { type: 'string', description: 'Description of the work / service.' },
      due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to net-30 if omitted.' },
    },
    required: ['customer_name', 'amount_usd', 'description'],
  },
};

// ─── Connection gap detector (Iris-as-onboarding-concierge) ──────────────

const TOOL_OFFER_MISSING_CONNECTIONS: AnthropicTool = {
  name: 'offer_missing_connections',
  description:
    "Detect integrations the owner's vertical recommends but hasn't connected yet, and return one-tap OAuth links so they connect via WhatsApp (no API key hunting, no dashboard). Use AFTER onboarding completes, or anytime the owner says 'what should I connect', 'help me set up', 'what's missing'. Iris should NOT spam these — call once at end of onboarding, and only re-surface if the owner asks. Each link is signed with their phone state token so the OAuth callback knows who they are.",
  input_schema: {
    type: 'object',
    properties: {
      max: { type: 'number', description: 'Cap on how many gaps to surface (default 3).' },
    },
  },
};

// ─── Event webhooks (Zapier / Make / IFTTT / custom) ─────────────────────

const TOOL_CONNECT_AUTOMATION: AnthropicTool = {
  name: 'connect_automation_webhook',
  description:
    "Subscribe an automation platform (Zapier, Make.com, IFTTT, n8n, custom endpoint) to receive WisdomWorks events. Returns the webhook id + signing secret. Owner pastes their automation's webhook URL → we POST JSON when bookings happen, insights fire, leads land, etc. IMPORTANT: When suggesting Zapier, ALWAYS mention 'Zapier requires their $19.99/mo Starter plan for webhooks — Make.com or IFTTT have free webhooks'. Honor the third-party-cost-transparency rule.",
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTPS URL to POST events to (Zap catch hook, Make scenario URL, etc.).' },
      label: { type: 'string', description: 'Friendly name (e.g. "new bookings → google sheet").' },
      event_types: {
        type: 'array',
        items: { type: 'string', enum: ['booking_created', 'client_created', 'client_visit_logged', 'insight_emitted', 'lead_captured', 'team_gap_proposed', 'review_received', 'photo_uploaded'] },
        description: 'Which events to subscribe to. Empty array = subscribe to ALL (catch-all webhook).',
      },
    },
    required: ['url', 'label'],
  },
};

const TOOL_LIST_AUTOMATION_WEBHOOKS: AnthropicTool = {
  name: 'list_automation_webhooks',
  description:
    "List the owner's configured automation webhooks (Zapier/Make/etc.) with their fire counts, last fired times, and any failures. Use when owner asks 'what's my Zapier hooked up to', 'show my automations'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_REVOKE_AUTOMATION_WEBHOOK: AnthropicTool = {
  name: 'revoke_automation_webhook',
  description:
    "Revoke an automation webhook. Stops sending events to it immediately. Use when owner says 'disconnect that zap', 'remove my make webhook'.",
  input_schema: {
    type: 'object',
    properties: {
      webhook_id: { type: 'string', description: 'Full UUID of the webhook (from list_automation_webhooks).' },
    },
    required: ['webhook_id'],
  },
};

// ─── Client websites (Story 2b.7) ────────────────────────────────────────

const TOOL_GENERATE_WEBSITE: AnthropicTool = {
  name: 'generate_website',
  description:
    "Provision a one-page website for the owner's business — instant publish at wisdomworks.app/sites/<slug>. Use when owner says 'build me a website', 'I need a site', 'I don't have a website yet'. Auto-pulls services from connected Square (if any), seeds defaults from the owner's vertical template, and auto-embeds the chat + booking widgets so visitors can interact / book on the live site immediately. Owner can later point a custom domain at the URL via Vercel domain settings.",
  input_schema: {
    type: 'object',
    properties: {
      business_name: { type: 'string', description: "The business name displayed in the hero. Defaults to whatsapp_contexts.business_name." },
      hero_title: { type: 'string', description: 'Override the hero headline.' },
      hero_subtitle: { type: 'string', description: 'Override the hero subtitle.' },
      contact_email: { type: 'string' },
      contact_phone: { type: 'string' },
    },
  },
};

const TOOL_MY_WEBSITE_URL: AnthropicTool = {
  name: 'get_my_website_url',
  description:
    "Return the URL of the owner's WisdomWorks-generated site (if one exists). Use when owner asks 'what's my website', 'where is my site', 'send me the link'.",
  input_schema: { type: 'object', properties: {} },
};

// ─── Widget API keys (Story 2b.8 — embeddable chat widget) ───────────────

const TOOL_CREATE_WIDGET_KEY: AnthropicTool = {
  name: 'create_widget_api_key',
  description:
    "Generate an API key + embed snippet the owner can paste into their existing website (Wix, WordPress, Squarespace, custom). Returns the plain key ONCE — owner copies it into their site. Use when owner says 'add a chat widget to my site', 'I want a contact form on my website', 'generate a widget key', 'embed chat on Wix'.",
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Descriptive name (e.g. "my wix site", "production").' },
      allowed_origins: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional whitelist of allowed origins (e.g. ["https://salonbella.com"]). Empty = any origin (less safe).',
      },
    },
    required: ['label'],
  },
};

const TOOL_LIST_WIDGET_KEYS: AnthropicTool = {
  name: 'list_widget_api_keys',
  description:
    "List the owner's widget API keys (id, label, scopes, last_used_at). Use when owner asks 'what widget keys do I have', 'which keys are active'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_REVOKE_WIDGET_KEY: AnthropicTool = {
  name: 'revoke_widget_api_key',
  description:
    "Revoke a widget API key by its 11-char prefix (e.g. 'wk_abc12345') or full id. Use when owner says 'revoke my key', 'kill the wix key', 'turn off widget access'. Revocation is immediate and irreversible.",
  input_schema: {
    type: 'object',
    properties: {
      key_or_id: { type: 'string', description: "The wk_xxxxxxxx prefix OR full UUID of the key to revoke." },
    },
    required: ['key_or_id'],
  },
};

// ─── Managed calendar (native scheduling for owners without Google/Apple) ──

const TOOL_SCHEDULE_EVENT: AnthropicTool = {
  name: 'schedule_event',
  description:
    "Add an event to the owner's native calendar (works even if no Google/Apple calendar is connected). Use when the owner says 'put X on my calendar', 'I have Y at Z', 'schedule me for W', 'block out time for Q'. The event lands in the owner's daily brief and conflict-detection runs against bookings + connected calendar. If a Google/Apple calendar IS connected, prefer create_calendar_event so it lands in the canonical calendar; use this tool when no external calendar is connected OR when owner explicitly wants a quick local note.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title (e.g. "Pickup Liam", "Coffee with Sarah").' },
      start_at: { type: 'string', description: 'ISO 8601 datetime. Resolve relative phrases like "Tuesday at 3" to a concrete time.' },
      end_at: { type: 'string', description: 'ISO 8601 datetime. If not specified by owner, default to 1h after start.' },
      notes: { type: 'string', description: 'Optional context.' },
      location: { type: 'string', description: 'Optional location.' },
      all_day: { type: 'boolean', description: 'True for all-day events (birthdays, holidays).' },
      tags: { type: 'array', items: { type: 'string' }, description: "Tags like 'work', 'personal', 'family' for filtering." },
    },
    required: ['title', 'start_at', 'end_at'],
  },
};

const TOOL_LIST_MY_SCHEDULE: AnthropicTool = {
  name: 'list_my_schedule',
  description:
    "Show the owner's unified schedule (native + connected calendar + upcoming bookings) for a date range. Use when owner asks 'what's on my calendar today', 'show me Tuesday', 'what do I have coming up'. Returns events sorted by time and FLAGS any overlaps as conflicts so the owner sees scheduling collisions across personal and business commitments.",
  input_schema: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: 'ISO date or datetime. Default: now.' },
      to_date: { type: 'string', description: 'ISO date or datetime. Default: end of today.' },
    },
  },
};

const TOOL_CANCEL_EVENT: AnthropicTool = {
  name: 'cancel_event',
  description:
    "Cancel a previously-scheduled native calendar event. Use when owner says 'cancel my X', 'remove that event', 'I don't have W anymore'. Soft-delete: the row stays for audit. Does NOT delete events from connected Google/Apple calendars (use a different flow for those — the connected calendar is the source of truth there).",
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'The 8-char prefix or full UUID from list_my_schedule.' },
    },
    required: ['event_id'],
  },
};

// ─── Booking-system connections ──────────────────────────────────────────

const TOOL_CONNECT_BOOKING_SYSTEM: AnthropicTool = {
  name: 'connect_booking_system',
  description:
    "Generate a one-tap link to connect a booking system. Use when owner says 'connect Square/Calendly/Mindbody', 'I use X for bookings', 'pull my client list from <booking system>', or any time the owner mentions they already have a booking platform. Returns the secure OAuth URL — when they tap it, we pull their customer list + appointment history into client_profiles + client_visits automatically. Square = retail/salon/trades. Calendly = consulting/coaching/services. Mindbody = fitness/yoga/spa.",
  input_schema: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['square', 'calendly', 'mindbody'],
        description: 'Which booking system to connect.',
      },
    },
    required: ['provider'],
  },
};

const TOOL_SYNC_BOOKING_CUSTOMERS: AnthropicTool = {
  name: 'sync_booking_customers',
  description:
    "Force a fresh sync of customers from the owner's connected booking system. Daily cron handles this automatically; use this tool when owner asks 'pull in my latest clients', 'sync Square now', 'refresh my client list'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_FIND_BOOKING_AVAILABILITY: AnthropicTool = {
  name: 'find_booking_availability',
  description:
    "Search open slots on the owner's connected booking system. Use when a customer asks 'when can I get in' or the owner asks 'what's open Tuesday'. Returns specific available start times so you can offer them to the customer or owner. Read-only — does NOT create a booking.",
  input_schema: {
    type: 'object',
    properties: {
      service_external_id: { type: 'string', description: 'Square service variation id. Required.' },
      staff_external_id: { type: 'string', description: 'Optional: specific staff/team member id.' },
      from_date: { type: 'string', description: 'ISO date or datetime; defaults to now.' },
      to_date: { type: 'string', description: 'ISO date or datetime; defaults to 14 days from now.' },
    },
    required: ['service_external_id'],
  },
};

const TOOL_BOOK_APPOINTMENT: AnthropicTool = {
  name: 'book_appointment',
  description:
    "Create a real booking in the owner's booking system. WRITES to the merchant's calendar — never call without explicit owner approval for THIS specific booking (same rule as send_email). If the user pivots topics or says an ambiguous 'yes' more than one turn after the proposal, do NOT call this. When in doubt, ask 'Should I book <customer> for <time>?' and wait. After creating, the booking syncs back as a client visit on the next sync.",
  input_schema: {
    type: 'object',
    properties: {
      customer_external_id: { type: 'string', description: 'The Square customer_id (from a client_profile.external_id) the booking is for.' },
      service_external_id: { type: 'string', description: 'Square service variation id.' },
      start_at: { type: 'string', description: 'ISO 8601 datetime for the appointment start.' },
      staff_external_id: { type: 'string', description: 'Optional staff/team member id.' },
      seller_note: { type: 'string', description: 'Internal note for the merchant.' },
      duration_minutes: { type: 'number', description: 'Optional override duration.' },
    },
    required: ['customer_external_id', 'service_external_id', 'start_at'],
  },
};

// ─── Team gap detection ──────────────────────────────────────────────────

const TOOL_LIST_MY_TEAM: AnthropicTool = {
  name: 'list_my_team',
  description:
    "List the owner's CURRENT active agent team (name, role, lane, status). Use BEFORE propose_team_addition so you don't suggest an agent that overlaps an existing one. Also use when the owner asks 'who's on my team', 'what agents do I have', 'who handles X'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_APPROVE_LATEST_PROPOSAL: AnthropicTool = {
  name: 'approve_latest_team_proposal',
  description:
    "Approve the MOST RECENT open team-gap proposal for this owner without needing an 8-char code. Use when you just proposed adding an agent and the owner replies affirmatively ('yes', 'do it', 'go ahead', 'sounds good', 'add them', 'let's do it'). The owner is a tradesperson on the move — never make them type a code or open the deck.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_DISMISS_LATEST_PROPOSAL: AnthropicTool = {
  name: 'dismiss_latest_team_proposal',
  description:
    "Dismiss the most recent open team-gap proposal. Use when the owner replies negatively to your suggestion ('no thanks', 'skip', 'not now', 'maybe later'). Doesn't bug them again with the same proposal.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_PROPOSE_TEAM_ADDITION: AnthropicTool = {
  name: 'propose_team_addition',
  description:
    "When the owner describes a recurring need their current team doesn't cover, propose adding a new agent. DON'T call add_agent_to_team directly — that's jarring autonomous action. Instead, propose via this tool so the owner sees the suggestion in their Insights queue and approves consciously. Call this when you hear: 'I keep losing leads', 'I can't keep up with X', 'I wish someone could handle Y', or when you notice a gap between the owner's needs and the team's lanes. ALWAYS call list_my_team first to confirm no existing agent covers this. Provides the role, why it's needed, and 3-5 example responsibilities so the owner can decide.",
  input_schema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: 'Friendly first-name suggestion (e.g. Riley, Nora, Atlas).' },
      agent_role: { type: 'string', description: 'Role title (e.g. "Lead Intake & Quoting", "Inventory Tracker").' },
      description: { type: 'string', description: 'One-sentence description of what this agent does day-to-day.' },
      trigger_reason: { type: 'string', description: 'The specific owner-observable thing that triggered this proposal. Quote them if possible: "Owner said \'I keep losing leads at night\'."' },
      tier: { type: 'string', enum: ['Haiku', 'Sonnet', 'Opus'], description: 'Routine work → Haiku; general → Sonnet; complex reasoning → Opus.' },
      lane: { type: 'string', enum: ['scheduler', 'customer_service', 'marketing', 'finance', 'operations', 'analytics', 'specialist'] },
      example_responsibilities: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 concrete things this agent would do, written for the owner to evaluate.',
      },
      parent_agent_name: { type: 'string', description: 'Optional — name of an existing top-level agent this should report to.' },
    },
    required: ['agent_name', 'agent_role', 'description', 'trigger_reason'],
  },
};

// ─── Business Insights (Story 2b.2) ──────────────────────────────────────

const TOOL_LIST_INSIGHTS: AnthropicTool = {
  name: 'list_insights',
  description:
    "List currently-open business insights (proposed recommendations like 'X clients lapsed', 'gap on Tuesdays', revenue patterns). Use when owner asks 'what should I do?', 'any opportunities?', 'show me insights'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_APPROVE_INSIGHT: AnthropicTool = {
  name: 'approve_insight',
  description:
    "Mark an insight approved so the next step can execute (e.g. drafting re-engagement messages for lapsed clients). Use when owner says 'do it', 'approve insight ABC12345', 'go ahead with that'. After approval, the agents responsible for the recommended action will pick it up. Returns confirmation + a description of what will happen next.",
  input_schema: {
    type: 'object',
    properties: {
      insight_id: { type: 'string', description: 'The 8-char prefix or full UUID from list_insights / digest message.' },
    },
    required: ['insight_id'],
  },
};

const TOOL_DISMISS_INSIGHT: AnthropicTool = {
  name: 'dismiss_insight',
  description:
    "Dismiss an insight the owner doesn't want to act on. Use when owner says 'no thanks', 'skip', 'dismiss insight ABC12345', 'not interested'. The insight won't re-surface.",
  input_schema: {
    type: 'object',
    properties: {
      insight_id: { type: 'string', description: 'The 8-char prefix or full UUID.' },
    },
    required: ['insight_id'],
  },
};

// ─── Email notification preferences ──────────────────────────────────────

const TOOL_ENABLE_EMAIL_NOTIFICATIONS: AnthropicTool = {
  name: 'enable_email_notifications',
  description:
    "Turn ON email mirroring of digest notifications so the owner gets each digest both as a WhatsApp message AND as an email. Use when owner says 'email me digests too', 'send these to my inbox', 'I want email notifications'. Requires the owner to have an email account connected (Yahoo/Gmail/Outlook) — the email is sent to themselves via their own SMTP/API.",
  input_schema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Optional override email address; defaults to the connected account.' },
      critical_only: { type: 'boolean', description: 'If true, only critical-severity items trigger email. Default false (all digests).' },
    },
  },
};

const TOOL_DISABLE_EMAIL_NOTIFICATIONS: AnthropicTool = {
  name: 'disable_email_notifications',
  description:
    "Turn OFF email mirroring of notifications. WhatsApp digests continue. Use when owner says 'stop emailing me', 'WhatsApp only please', 'turn off email notifications'.",
  input_schema: { type: 'object', properties: {} },
};

const TOOL_EMAIL_NOTIFICATION_STATUS: AnthropicTool = {
  name: 'get_email_notification_status',
  description:
    "Report whether email notifications are currently enabled and at what address. Use when owner asks 'do you have my email', 'are you emailing me too', 'check my notification settings'.",
  input_schema: { type: 'object', properties: {} },
};

// ─── Client Profiles (Story 2b.1) ────────────────────────────────────────

const TOOL_ADD_UPDATE_CLIENT: AnthropicTool = {
  name: 'add_or_update_client_profile',
  description:
    "Capture or update a CUSTOMER of the owner's business (NOT the owner's personal contacts — those use define_person/known_people). Use whenever the owner mentions one of their clients/customers/patients/guests by name: 'just finished Sarah's balayage', 'Mike was in for a #2 fade', 'Linda's wiring is done', 'table for Johnson party of 4'. Captures preferences and notes so the next interaction can pull personalized context. Returns the profile_id (use it to record a visit immediately if the mention describes a completed service).",
  input_schema: {
    type: 'object',
    properties: {
      display_name: { type: 'string', description: 'The client\'s name as the owner refers to them.' },
      phone: { type: 'string', description: 'Phone number if known.' },
      email: { type: 'string' },
      preferences: {
        type: 'object',
        description: 'Free-form key/value preferences (haircut: "#2 fade", color: "balayage 9V", allergies: ["PPD"], table: "window booth"). Merges with existing.',
      },
      notes: { type: 'string', description: 'Sticky note about this client (not visit-specific).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags: VIP, regular, lapsed, allergy, etc.' },
      source: {
        type: 'string',
        enum: ['owner_defined', 'inferred'],
        description: "'owner_defined' when the owner explicitly confirmed; 'inferred' (default) when you extracted from chat.",
      },
    },
    required: ['display_name'],
  },
};

const TOOL_RECORD_CLIENT_VISIT: AnthropicTool = {
  name: 'record_client_visit',
  description:
    "Log a completed interaction with a client (job done, service rendered, appointment kept). Bumps visit_count + last_visit_at on the profile. Pair this with add_or_update_client_profile whenever the owner reports finishing work for a customer.",
  input_schema: {
    type: 'object',
    properties: {
      client_profile_id: { type: 'string', description: 'Returned by add_or_update_client_profile.' },
      summary: { type: 'string', description: 'One-line description: "Balayage + toner 9V", "Replaced 20A GFCI in kitchen", "Dinner — table 4, 2 mains + dessert".' },
      channel: { type: 'string', enum: ['in_person', 'phone', 'whatsapp', 'video', 'email', 'remote'] },
      satisfaction: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      notes: { type: 'string', description: 'Visit-specific notes.' },
      revenue_usd: { type: 'number', description: 'Revenue from this visit if the owner mentioned an amount.' },
    },
    required: ['client_profile_id', 'summary'],
  },
};

const TOOL_LOOKUP_CLIENT: AnthropicTool = {
  name: 'lookup_client',
  description:
    "Find a client by name or phone substring before logging a visit. Use BEFORE add_or_update_client_profile when the owner mentions someone who might already exist — prevents duplicates and surfaces existing preferences so you can reference them.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Partial name or phone (e.g. "Sarah", "0123").' },
    },
    required: ['query'],
  },
};

const TOOL_LIST_MY_CLIENTS: AnthropicTool = {
  name: 'list_my_clients',
  description:
    "List the owner's recent clients (sorted by last visit). Use when the owner asks 'who came in this week', 'show me my regulars', 'who haven't I seen in a while'.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 20.' },
    },
  },
};

const TOOL_LIST_CLIENT_HISTORY: AnthropicTool = {
  name: 'list_client_history',
  description:
    "Show the full visit history for one client (last 25 visits). Use when the owner asks 'when was Sarah last in', 'what did we do for Mike last time', 'show me Linda's history'.",
  input_schema: {
    type: 'object',
    properties: {
      client_profile_id: { type: 'string', description: 'Profile id (use lookup_client first to resolve from name).' },
    },
    required: ['client_profile_id'],
  },
};

const TOOL_GET_CHANNEL_LINK_CODE: AnthropicTool = {
  name: 'get_channel_link_code',
  description:
    "Generate a short-lived link code (15 min) so the owner can connect a non-WhatsApp messaging channel (Telegram, SMS, iMessage, Discord) to their WisdomWorks account. Use when the owner asks 'link my telegram', 'give me a telegram code', 'connect telegram/sms/imessage'. Returns the code and instructions for what to do on the target channel.",
  input_schema: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        enum: ['telegram', 'sms', 'imessage', 'discord'],
        description: 'Which channel to link.',
      },
    },
    required: ['channel'],
  },
};

const TOOL_LIST_RECENT_COMMITS: AnthropicTool = {
  name: 'list_recent_commits',
  description:
    "List the most recent commits on a connected project's repo. Use when investigating recent changes or wanting to know what just shipped.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
      limit: { type: 'number', description: 'Default 10.' },
    },
    required: ['project_name'],
  },
};

const TOOL_LIST_OPEN_ISSUES: AnthropicTool = {
  name: 'list_open_issues',
  description:
    "List open issues and pull requests on a connected project's GitHub repo. Use when investigating outstanding work or what needs review.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
    },
    required: ['project_name'],
  },
};

const TOOL_READ_REPO_FILE: AnthropicTool = {
  name: 'read_repo_file',
  description:
    "Read a specific file from a connected project's GitHub repo. Use when investigating the codebase to understand how something works or identify gaps.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
      path: { type: 'string', description: "File path relative to repo root (e.g. 'README.md', 'app/page.tsx', 'package.json')." },
    },
    required: ['project_name', 'path'],
  },
};

const TOOL_LIST_REPO_TREE: AnthropicTool = {
  name: 'list_repo_tree',
  description:
    "List files and directories at a path in a connected project's repo. Use to navigate the codebase structure before reading specific files.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
      path: { type: 'string', description: "Directory path, or empty string for repo root." },
    },
    required: ['project_name'],
  },
};

const TOOL_FETCH_DEPLOYED_PAGE: AnthropicTool = {
  name: 'fetch_deployed_page',
  description:
    "HTTP GET on a page of the project's live deployment. Returns response status + body excerpt + content-type. Use to actually see what the deployed site looks like, check for broken pages, or verify a recent fix.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
      path: { type: 'string', description: "Path on the deploy URL, e.g. '/', '/pricing', '/api/health'. Defaults to '/'." },
    },
    required: ['project_name'],
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
    "Get an existing top-level agent/manager's opinion on a proposed change (e.g. adding a new agent, changing scope). Use this BEFORE adding a new agent so the relevant managers can weigh in on whether it makes sense, whether it overlaps with their existing scope, or whether it should report to them. Call once per manager whose domain could plausibly overlap. Their reply is treated as advisory — Iris still makes the final call.",
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

// ─── Video job status / debugging ────────────────────────────────────────

const TOOL_CHECK_VIDEO_JOBS: AnthropicTool = {
  name: 'check_video_jobs',
  description:
    "Diagnose video generation status. Returns the owner's recent video_generation_jobs rows: prediction_id, status (pending/succeeded/failed/timed_out/delivered), elapsed time, model, and error if any. Use when owner says 'where's my video', 'what happened to that reel', 'video never came', 'check on the generation'.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 5.' },
    },
  },
};

// ─── Story 2.16 — Recall analyzed documents ──────────────────────────────

const TOOL_RECALL_DOCUMENTS: AnthropicTool = {
  name: 'recall_recent_documents',
  description:
    "List or recall documents the owner has sent to Iris for analysis (PDFs via WhatsApp, email attachments). Returns filenames, summaries, key dates/parties/amounts, and analyzed_at timestamps. Use when owner asks 'what was in that contract', 'pull up the lease I sent', 'what documents have I shared', 'search my docs for X'. Optional `query` filters by tags or substring match in the summary.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional — substring to match against summary or tags.' },
      limit: { type: 'number', description: 'Default 5.' },
    },
  },
};

// ─── Story 2.15 — Business Type Framework Dictionary visibility ──────────

const TOOL_BUSINESS_TYPE_DICTIONARY: AnthropicTool = {
  name: 'show_business_type_dictionary',
  description:
    "Show the owner what proven techniques their business_type has accumulated in the cross-tenant Business Type Framework Dictionary. These are anonymized skills promoted from other tenants of the same vertical that hit ≥3 tenants, ≥0.7 pooled success rate, ≥5 uses. Use when owner asks 'what have other [their vertical] businesses figured out', 'what's the dictionary', 'what comes pre-loaded'.",
  input_schema: { type: 'object', properties: {} },
};

// ─── Story 2.14 — lessons learned (avoid repeating mistakes) ─────────────

const TOOL_FLAG_LESSON: AnthropicTool = {
  name: 'flag_lesson_learned',
  description:
    "Capture a lesson the owner wants the agents to remember so the SAME mistake doesn't happen again. Use when the owner says 'don't do that again', 'remember not to X', 'learn from this', 'next time avoid Y'. Specifies what went wrong + what to do instead + keywords that should trigger this lesson in future. The pre-flight matcher checks open lessons before destructive actions; matches surface to the owner.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short owner-facing label (5-12 words).' },
      what_went_wrong: { type: 'string', description: 'What happened, in one or two sentences.' },
      corrective_action: { type: 'string', description: 'The rule going forward. Specific and actionable.' },
      topic_keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '3-8 keywords/phrases that should trigger this lesson — sender names, action names, topic words. Used by the pre-flight matcher.',
      },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'critical = block action; high = surface to owner before acting; medium = inject as warning in agent prompt; low = log-only.' },
    },
    required: ['title', 'what_went_wrong', 'corrective_action', 'topic_keywords'],
  },
};

const TOOL_LIST_LESSONS: AnthropicTool = {
  name: 'list_lessons_learned',
  description:
    "Show the owner the open lessons the agents currently consult before acting. Use when owner asks 'what have you learned', 'what rules are you following', 'show my lessons'. Returns severity, what to avoid, and corrective action for each.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 10.' },
    },
  },
};

const TOOL_RESOLVE_LESSON: AnthropicTool = {
  name: 'resolve_lesson_learned',
  description:
    "Mark a lesson as no longer applicable when the owner says 'forget that one', 'that rule doesn't apply anymore', 'remove the X lesson'. Resolved lessons stop influencing pre-flight checks and agent prompts.",
  input_schema: {
    type: 'object',
    properties: {
      lesson_id: { type: 'string', description: 'Full UUID or 8-char prefix from list_lessons_learned.' },
    },
    required: ['lesson_id'],
  },
};

// ─── Story 2.13 FR102 — professional profile ingest ──────────────────────

const TOOL_SET_PROFESSIONAL_CONTEXT: AnthropicTool = {
  name: 'set_professional_context',
  description:
    "Capture the user's role, responsibilities, current projects, skills, or work focus so every agent has context. Use when the owner describes their job or work patterns, OR when they paste a resume/bio. The classifier reads this to better categorize email (e.g. knowing the user is a 'plumber doing residential service calls in Seattle' helps it distinguish 'business' from 'personal'). Pass each fact as a short sentence. Examples: 'I'm a residential electrician based in Seattle', 'I run a 5-person crew, mostly commercial retrofits', 'My specialty is panel upgrades and EV charger installs'. Append doesn't overwrite — call multiple times to build up the profile.",
  input_schema: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        description: '1-10 short sentences. Each becomes a stored fact atom.',
        items: { type: 'string' },
      },
    },
    required: ['facts'],
  },
};

const TOOL_GET_CLASSIFIER_ACCURACY: AnthropicTool = {
  name: 'get_classifier_accuracy',
  description:
    "Show the owner how well the email classifier is performing. Returns accuracy at 30d and 90d windows against the NFR9 targets (90%/95%). Use when owner asks 'how accurate is the email sorting', 'is it learning', 'is the classifier getting better', 'is it working'.",
  input_schema: { type: 'object', properties: {} },
};

// ─── Story 2.10 — state snapshots + rollback ─────────────────────────────

const TOOL_LIST_SNAPSHOTS: AnthropicTool = {
  name: 'list_state_snapshots',
  description:
    "Show the owner the recent agent state snapshots they could roll back to. Use when the owner says 'undo that', 'roll back', 'something went wrong with the agents'. Each snapshot shows when it was taken, why (periodic / pre_action / shutdown / manual), and which action it preceded if any.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Default 10.' },
    },
  },
};

const TOOL_ROLLBACK_STATE: AnthropicTool = {
  name: 'rollback_agent_state',
  description:
    "Recover an agent_instance to a previous snapshot. Use ONLY after the owner has explicitly confirmed they want to roll back THAT specific snapshot — pending-action safety applies, since rollback overwrites the current state with the snapshot. Pass the snapshot_id from list_state_snapshots. Returns the recovery duration and confirms the old state was preserved as a pre_recover snapshot in case they want to undo the rollback.",
  input_schema: {
    type: 'object',
    properties: {
      agent_instance_id: { type: 'string', description: 'The instance to roll back. From list_state_snapshots.' },
      point_in_time: { type: 'string', description: 'Optional ISO timestamp — restore the latest snapshot at-or-before this moment. Defaults to "now" (latest snapshot).' },
    },
    required: ['agent_instance_id'],
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
  // Connection-gated tool sets — agents should NEVER see tools for
  // platforms the tenant hasn't connected. This is the structural fix for
  // "Iris suggested publishing to IG when IG isn't connected" — she can
  // only suggest what she has tools for, and we don't even hand her the
  // tools if there's no underlying connection.
  const conns = connections as any[];
  const hasMeta = conns.some((c) => c.provider === 'meta');
  const hasStripe = conns.some((c) => c.provider === 'stripe');
  const hasQuickBooks = conns.some((c) => c.provider === 'quickbooks');

  if (hasEmail) {
    tools.push(TOOL_LIST_EMAILS);
    tools.push(TOOL_SEARCH_EMAILS);
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
  tools.push(TOOL_DEFINE_PERSON);
  tools.push(TOOL_LIST_KNOWN_PEOPLE);
  tools.push(TOOL_FORGET_PERSON);
  tools.push(TOOL_GET_PROJECT_STATUS);
  tools.push(TOOL_LIST_ALL_PROJECTS);
  tools.push(TOOL_GET_MY_SPEND);
  tools.push(TOOL_GET_SPEND_BREAKDOWN);
  tools.push(TOOL_GET_CHANNEL_LINK_CODE);
  tools.push(TOOL_ISSUE_DECK_LOGIN);
  tools.push(TOOL_ADD_UPDATE_CLIENT);
  tools.push(TOOL_RECORD_CLIENT_VISIT);
  tools.push(TOOL_LOOKUP_CLIENT);
  tools.push(TOOL_LIST_MY_CLIENTS);
  tools.push(TOOL_LIST_CLIENT_HISTORY);
  tools.push(TOOL_ENABLE_EMAIL_NOTIFICATIONS);
  tools.push(TOOL_DISABLE_EMAIL_NOTIFICATIONS);
  tools.push(TOOL_EMAIL_NOTIFICATION_STATUS);
  tools.push(TOOL_LIST_INSIGHTS);
  tools.push(TOOL_APPROVE_INSIGHT);
  tools.push(TOOL_DISMISS_INSIGHT);
  tools.push(TOOL_LIST_MY_TEAM);
  tools.push(TOOL_PROPOSE_TEAM_ADDITION);
  tools.push(TOOL_APPROVE_LATEST_PROPOSAL);
  tools.push(TOOL_DISMISS_LATEST_PROPOSAL);
  tools.push(TOOL_CONNECT_BOOKING_SYSTEM);
  tools.push(TOOL_SYNC_BOOKING_CUSTOMERS);
  tools.push(TOOL_FIND_BOOKING_AVAILABILITY);
  tools.push(TOOL_BOOK_APPOINTMENT);
  tools.push(TOOL_SCHEDULE_EVENT);
  tools.push(TOOL_LIST_MY_SCHEDULE);
  tools.push(TOOL_CANCEL_EVENT);
  tools.push(TOOL_CREATE_WIDGET_KEY);
  tools.push(TOOL_LIST_WIDGET_KEYS);
  tools.push(TOOL_REVOKE_WIDGET_KEY);
  tools.push(TOOL_GENERATE_WEBSITE);
  tools.push(TOOL_MY_WEBSITE_URL);
  tools.push(TOOL_CONNECT_AUTOMATION);
  tools.push(TOOL_LIST_AUTOMATION_WEBHOOKS);
  tools.push(TOOL_REVOKE_AUTOMATION_WEBHOOK);
  tools.push(TOOL_OFFER_MISSING_CONNECTIONS);

  // Stripe tools — require an active stripe connection
  if (hasStripe) {
    tools.push(TOOL_CREATE_PAYMENT_LINK);
    tools.push(TOOL_LIST_RECENT_PAYMENTS);
  }

  // QuickBooks tools — require an active quickbooks connection
  if (hasQuickBooks) {
    tools.push(TOOL_QBO_OUTSTANDING_AR);
    tools.push(TOOL_QBO_LIST_UNPAID_INVOICES);
    tools.push(TOOL_QBO_CREATE_INVOICE);
  }

  // Meta (IG + FB) tools — require an active meta connection. Without
  // this gate Iris would suggest "publish to Instagram" even when no
  // meta token is on file. Video generation + style memory stay always-
  // on (Replicate is platform-level, not per-tenant OAuth) but the
  // publish + preview path is gated.
  if (hasMeta) {
    tools.push(TOOL_INSTAGRAM_ACTIVITY);
    tools.push(TOOL_PUBLISH_INSTAGRAM_POST);
    tools.push(TOOL_PUBLISH_INSTAGRAM_REEL);
    tools.push(TOOL_PUBLISH_FACEBOOK_POST);
    tools.push(TOOL_REPLY_INSTAGRAM_COMMENT);
    tools.push(TOOL_APPROVE_MARKETING_DRAFT); // auto_publish branch needs meta
  }

  // Video generation + style memory + draft management — Replicate is
  // platform-level, so these work without a tenant OAuth. The publish
  // branch (approve_marketing_draft with auto_publish=true) still requires
  // meta, which is enforced at runtime in marketing-drafts.ts.
  tools.push(TOOL_GENERATE_MARKETING_VIDEO);
  tools.push(TOOL_SEND_VIDEO_PREVIEW);
  tools.push(TOOL_VIDEO_GEN_COST);
  tools.push(TOOL_SAVE_MARKETING_STYLE);
  tools.push(TOOL_LIST_MARKETING_STYLES);
  tools.push(TOOL_DELETE_MARKETING_STYLE);
  tools.push(TOOL_LIST_MARKETING_DRAFTS);
  tools.push(TOOL_PROPOSE_MARKETING_DRAFT);
  if (!hasMeta) tools.push(TOOL_APPROVE_MARKETING_DRAFT); // available even without meta (preview-only path)
  tools.push(TOOL_DISMISS_MARKETING_DRAFT);
  tools.push(TOOL_GET_MARKETING_AUTONOMY);
  tools.push(TOOL_SET_MARKETING_AUTONOMY);
  tools.push(TOOL_MARKETING_PERFORMANCE);
  tools.push(TOOL_REQUEST_RESEARCH);
  tools.push(TOOL_LIST_PENDING_RESEARCH);
  tools.push(TOOL_RECALL_ATOMS);
  tools.push(TOOL_CONFIRM_ATOM);
  tools.push(TOOL_ARCHIVE_ATOM);
  tools.push(TOOL_REMEMBER_THIS);
  tools.push(TOOL_LIST_RECENT_COMMITS);
  tools.push(TOOL_LIST_OPEN_ISSUES);
  tools.push(TOOL_READ_REPO_FILE);
  tools.push(TOOL_LIST_REPO_TREE);
  tools.push(TOOL_FETCH_DEPLOYED_PAGE);
  tools.push(TOOL_MUTE);
  tools.push(TOOL_UNMUTE);
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
  tools.push(TOOL_LIST_SNAPSHOTS);
  tools.push(TOOL_ROLLBACK_STATE);
  tools.push(TOOL_SET_PROFESSIONAL_CONTEXT);
  tools.push(TOOL_GET_CLASSIFIER_ACCURACY);
  tools.push(TOOL_FLAG_LESSON);
  tools.push(TOOL_LIST_LESSONS);
  tools.push(TOOL_RESOLVE_LESSON);
  tools.push(TOOL_BUSINESS_TYPE_DICTIONARY);
  tools.push(TOOL_RECALL_DOCUMENTS);
  tools.push(TOOL_CHECK_VIDEO_JOBS);

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

// Story 2.10 — destructive tools that fire a pre_action snapshot before
// executing. Adding a new destructive tool? Append its name here so the
// rollback safety net covers it automatically — no per-tool patching.
const DESTRUCTIVE_TOOLS = new Set<string>([
  'send_email',
  'create_calendar_event',
  'schedule_event',
  'cancel_event',
  'qbo_create_invoice',
  'create_payment_link',
  'publish_instagram_post',
  'publish_instagram_reel',
  'publish_facebook_post',
  'reply_to_instagram_comment',
  'approve_marketing_draft',
  'add_agent_to_team',
  'remove_agent_from_team',
  'move_agent_under_manager',
  'update_agent',
  'retire_skill',
  'set_marketing_autonomy',
]);

export async function executeTool(
  call: ToolCall,
  connections: OAuthConnection[],
  user?: UserContext,
): Promise<ToolResult> {
  // Fire-and-forget pre_action snapshot so the user can roll back if the
  // tool did something unintended. Never blocks the tool call.
  if (user && DESTRUCTIVE_TOOLS.has(call.name)) {
    const { snapshotBeforeAction } = await import('../../_lib/state-recovery');
    void snapshotBeforeAction(user.phoneNumber, call.name);

    // Story 2.14 pre-flight — query lessons_learned for matches against
    // this action. Critical-severity matches BLOCK the tool; high-severity
    // matches return a warning to the agent so it can re-think; low/medium
    // matches just bump the consult count (already done in queryLessonsForTask)
    // and trickle in via the agent's system prompt the next turn.
    try {
      const { queryLessonsForTask, markLessonApplied } = await import('../../_lib/lessons-learned');
      // Build coarse keywords from the tool name + input string values.
      // Coarse on purpose: we want to catch "schedule_event with Maria"
      // matching a "no double-booking with Maria" lesson.
      const taskKeywords: string[] = [call.name];
      for (const v of Object.values(call.input ?? {})) {
        if (typeof v === 'string' && v.length >= 3) {
          // Split into word-level tokens for the matcher
          for (const word of v.split(/\s+/)) {
            const w = word.replace(/[^\w@.+\-]/g, '').toLowerCase();
            if (w.length >= 4 && w.length < 40) taskKeywords.push(w);
          }
        }
      }
      const matches = await queryLessonsForTask({
        tenantPhone: user.phoneNumber,
        taskKeywords: Array.from(new Set(taskKeywords)).slice(0, 20),
        minSeverity: 'high',
        limit: 3,
      });
      // Skip lessons we already warned about in the last 5 minutes —
      // owner has had a chance to approve the override and the agent
      // is now retrying with that approval. Without this guard the
      // pre-flight would block in an infinite loop.
      const RECENT_APPLY_MS = 5 * 60 * 1000;
      const now = Date.now();
      const fresh = matches.filter((m) => {
        if (!m.last_applied_at) return true;
        return now - new Date(m.last_applied_at).getTime() > RECENT_APPLY_MS;
      });
      const critical = fresh.find((m) => m.severity === 'critical');
      if (critical) {
        // BLOCK — record the apply so a second call within 5min lets the
        // agent proceed after explicit owner override
        void markLessonApplied(critical.id);
        return {
          content: `🚨 Refusing ${call.name} — critical lesson "${critical.title}" applies.\n  Avoid: ${critical.what_went_wrong}\n  Do instead: ${critical.corrective_action}\n\nIf the owner has explicitly authorized this specific action, call ${call.name} again within the next 5 minutes and the gate releases. To remove the rule entirely, owner says "resolve lesson ${critical.id.slice(0, 8)}".`,
          success: false,
        };
      }
      if (fresh.length > 0) {
        // High-severity warning — agent should surface to owner before
        // proceeding. Same 5-minute window applies for the retry.
        const highest = fresh[0]!;
        void markLessonApplied(highest.id);
        return {
          content: `⚠ Lesson "${highest.title}" matches this action — surface to owner before proceeding.\n  Avoid: ${highest.what_went_wrong}\n  Do instead: ${highest.corrective_action}\n\nIf the owner confirms they want to proceed anyway, call ${call.name} again — the gate releases for 5 minutes. To remove the rule, owner says "resolve lesson ${highest.id.slice(0, 8)}".`,
          success: false,
        };
      }
    } catch (err) {
      // Pre-flight failure must never block a real action
      console.warn('[executeTool] lesson pre-flight failed (continuing):', err);
    }
  }

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

      case 'search_emails': {
        const conn = connections.find((c) => c.service === 'email');
        if (!conn) return { content: 'No email account connected.', success: false };
        const from = call.input.from ? String(call.input.from).trim() : undefined;
        const subject = call.input.subject ? String(call.input.subject).trim() : undefined;
        const bodyKeyword = call.input.body_keyword ? String(call.input.body_keyword).trim() : undefined;
        if (!from && !subject && !bodyKeyword) {
          return { content: 'Need at least one of: from, subject, body_keyword.', success: false };
        }
        const isImap = conn.provider === 'yahoo' || conn.provider === 'imap';
        if (!isImap) {
          return { content: `search_emails only supports Yahoo/IMAP today. For ${conn.provider}, use list_unread_emails for the last 24h.`, success: false };
        }
        const limit = Math.min(typeof call.input.limit === 'number' ? call.input.limit : 10, 25);
        const sinceDays = typeof call.input.since_days === 'number' ? call.input.since_days : 30;
        const result = await searchImap(conn as any, { from, subject, bodyKeyword, sinceDays, limit });
        if (!result.success || !result.data) {
          return { content: `Could not search emails: ${result.error}`, success: false };
        }
        if (result.data.length === 0) {
          return { content: `No emails matched your filters in the last ${sinceDays} days.`, success: true };
        }
        // Return enough body to draft a reply. Cap each preview at ~500 chars
        // so total stays manageable; the model can ask for more if needed.
        const lines = result.data.map((e, i) => {
          const date = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const readMark = e.isUnread ? '🔵' : '⚪';
          const senderLine = `${i + 1}. ${readMark} From: ${e.fromName ?? e.from} <${e.from}>`;
          return `${senderLine}\n   Subject: ${e.subject}\n   Date: ${date}\n   ID (use for inReplyToMessageId): ${e.threadId}\n   Body: ${e.body.slice(0, 500)}${e.body.length > 500 ? '… [truncated]' : ''}`;
        });
        return {
          content: `Found ${result.data.length} email${result.data.length === 1 ? '' : 's'} matching your filters:\n\n${lines.join('\n\n')}`,
          success: true,
        };
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
        const startedAt = Date.now();

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
          const genMs = Date.now() - startedAt;
          const sizeKb = buffer.length / 1024;

          // Audit log helper — every create_document writes to agent_runs so
          // the activity feed shows what was generated, where it landed,
          // and the NFR7 (2-min) timing.
          const auditDelivery = async (destination: string, url: string | null, totalMs: number, success: boolean, err?: string) => {
            try {
              const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
              const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
              if (!supaUrl || !supaKey) return;
              const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
              const slaOk = totalMs < 2 * 60 * 1000; // NFR7
              await fetch(`${supaUrl}/rest/v1/agent_runs`, {
                method: 'POST',
                headers: {
                  apikey: supaKey,
                  Authorization: `Bearer ${supaKey}`,
                  'Content-Type': 'application/json',
                  Prefer: 'return=minimal',
                },
                body: JSON.stringify({
                  tenant_phone: cleanPhone,
                  trigger: 'manual',
                  phase: 'execute',
                  outcome: success ? 'acted' : 'failed',
                  input_summary: `[doc-gen] create_document ${format}: ${title.slice(0, 100)}`,
                  output_summary: success
                    ? `${safeName} (${sizeKb.toFixed(1)}KB) → ${destination}${slaOk ? '' : ' [SLA breach]'}`
                    : `${safeName} delivery failed: ${err}`,
                  metadata: {
                    format,
                    filename: safeName,
                    size_bytes: buffer.length,
                    generate_ms: genMs,
                    total_ms: totalMs,
                    destination,
                    delivery_url: url,
                    sla_target_ms: 2 * 60 * 1000,
                    sla_met: slaOk,
                  },
                }),
              });
            } catch (err) {
              console.warn('[create_document] audit failed:', err);
            }
          };

          // Destination preference: Google Drive → OneDrive → WhatsApp document fallback
          const googleConn = connections.find((c) => c.provider === 'google');
          const msConn = connections.find((c) => c.provider === 'microsoft');

          if (googleConn) {
            const upload = await uploadToGoogleDrive(googleConn.access_token, safeName, mime, buffer);
            if (upload.ok) {
              const totalMs = Date.now() - startedAt;
              await auditDelivery('google_drive', upload.webUrl ?? null, totalMs, true);
              return { content: `Created ${safeName} in your Google Drive (${(sizeKb).toFixed(1)}KB, ${(totalMs / 1000).toFixed(1)}s): ${upload.webUrl}`, success: true };
            }
          }
          if (msConn) {
            const upload = await uploadToOneDrive(msConn.access_token, safeName, buffer);
            if (upload.ok) {
              const totalMs = Date.now() - startedAt;
              await auditDelivery('onedrive', upload.webUrl ?? null, totalMs, true);
              return { content: `Created ${safeName} in your OneDrive (${(sizeKb).toFixed(1)}KB, ${(totalMs / 1000).toFixed(1)}s): ${upload.webUrl}`, success: true };
            }
          }

          // Fallback: upload to Supabase Storage public bucket + send via
          // WhatsApp document message so the owner still gets the file.
          // This is the "no Drive connected" path — previously stubbed.
          const { uploadGeneratedDoc } = await import('../../_lib/generated-doc-storage');
          const stored = await uploadGeneratedDoc({
            tenantPhone: user.phoneNumber,
            buffer,
            filename: safeName,
            mimeType: mime,
          });
          if (!stored) {
            const totalMs = Date.now() - startedAt;
            await auditDelivery('whatsapp_fallback', null, totalMs, false, 'storage upload failed');
            return {
              content: `Generated ${safeName} (${sizeKb.toFixed(1)}KB) but couldn't store it. The Supabase 'generated-docs' bucket may not exist yet (admin needs to create it with public-read access).`,
              success: false,
            };
          }
          const { sendWhatsAppDocument } = await import('../../_lib/whatsapp-media-send');
          const sent = await sendWhatsAppDocument({
            to: user.phoneNumber,
            documentUrl: stored.publicUrl,
            filename: safeName,
            caption: title,
          });
          const totalMs = Date.now() - startedAt;
          if (!sent.ok) {
            await auditDelivery('whatsapp_fallback', stored.publicUrl, totalMs, false, sent.error);
            return {
              content: `Generated ${safeName} (${sizeKb.toFixed(1)}KB) and stored at ${stored.publicUrl}, but WhatsApp delivery failed: ${sent.error}`,
              success: true,
            };
          }
          await auditDelivery('whatsapp', stored.publicUrl, totalMs, true);
          return {
            content: `✓ Sent ${safeName} (${sizeKb.toFixed(1)}KB, ${(totalMs / 1000).toFixed(1)}s) to your WhatsApp as a file attachment. No Drive/OneDrive connected — connect one in the deck and future docs go there directly.`,
            success: true,
          };
        } catch (err) {
          const totalMs = Date.now() - startedAt;
          // Best-effort audit on failure too — we want broken-doc-gen failures
          // visible in the activity feed
          try {
            const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supaUrl && supaKey) {
              await fetch(`${supaUrl}/rest/v1/agent_runs`, {
                method: 'POST',
                headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({
                  tenant_phone: user.phoneNumber.replace(/[\s\-+()]/g, ''),
                  trigger: 'manual',
                  phase: 'execute',
                  outcome: 'failed',
                  input_summary: `[doc-gen] create_document ${format}: ${title.slice(0, 100)}`,
                  output_summary: `generation exception: ${String(err).slice(0, 200)}`,
                  metadata: { format, filename: safeName, total_ms: totalMs },
                }),
              });
            }
          } catch {}
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
          const { matches, embedTokens } = await queryKnowledge(cleanPhone, question, { limit: call.input.limit ?? 5, source: 'agent_query' });
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
          const { matches } = await queryKnowledge(cleanPhone, action, { limit: 5, minSimilarity: 0.3, source: 'error_check' });
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

      case 'mute_assistant': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const minutes = typeof call.input.duration_minutes === 'number' && call.input.duration_minutes > 0
          ? call.input.duration_minutes
          : 240; // 4h default
        const reason = call.input.reason ? String(call.input.reason).slice(0, 80) : undefined;
        const result = await setMute({ tenantPhone: cleanPhone, durationMinutes: minutes, reason });
        if (!result.ok) return { content: 'Could not save mute state.', success: false };
        const window = formatMuteUntil(result.until);
        return {
          content: `Got it — I'll hold all proactive notifications ${window}${reason ? ` (${reason})` : ''}. Text me anytime, I'll still respond. Say "I'm back" when you want pushes resumed.`,
          success: true,
        };
      }

      case 'unmute_assistant': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const before = await isMuted(cleanPhone);
        if (!before.muted) return { content: 'Already unmuted — pushes are flowing normally.', success: true };
        const ok = await clearMute(cleanPhone);
        return ok
          ? { content: `Welcome back. Resuming proactive pushes — anything held while you were quiet I'll surface in the next digest.`, success: true }
          : { content: 'Could not clear mute state.', success: false };
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

      case 'define_person': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const displayName = String(call.input.display_name ?? '').trim();
        if (!displayName) return { content: 'Missing display_name.', success: false };
        const id = await definePerson({
          tenantPhone: cleanPhone,
          displayName,
          role: call.input.role ? String(call.input.role) : undefined,
          notes: call.input.notes ? String(call.input.notes) : undefined,
          email: call.input.email ? String(call.input.email) : undefined,
          source: 'owner_defined',
        });
        if (!id) return { content: `Could not save ${displayName}.`, success: false };
        const roleStr = call.input.role ? ` (${call.input.role})` : '';
        return {
          content: `Got it — ${displayName}${roleStr} stored. From now on every agent will know who that is and won't confuse the name with anyone on the team.`,
          success: true,
        };
      }

      case 'list_known_people': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const people = await listKnownPeople(cleanPhone);
        if (people.length === 0) {
          return { content: "I don't know anyone in your network yet. Tell me about people you work with (attorney, accountant, key clients) and I'll remember.", success: true };
        }
        const lines = people.map((p, i) => {
          const role = p.role ? ` — ${p.role}` : '';
          const email = p.email ? ` (${p.email})` : '';
          const source = p.source === 'owner_defined' ? '' : ` [auto]`;
          return `${i + 1}. [${p.id.slice(0, 8)}] ${p.display_name}${role}${email}${source}`;
        });
        return { content: `${people.length} known:\n${lines.join('\n')}`, success: true };
      }

      case 'forget_person': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const personId = String(call.input.person_id ?? '').trim();
        if (!personId) return { content: 'Missing person_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        // Tolerate 8-char prefix lookup
        let resolvedId = personId;
        if (personId.length === 8) {
          const all = await listKnownPeople(cleanPhone);
          const match = all.find((p) => p.id.startsWith(personId.toLowerCase()));
          if (match) resolvedId = match.id;
        }
        const ok = await forgetPerson(resolvedId);
        return ok
          ? { content: 'Removed. Future ticks won\'t reference that person.', success: true }
          : { content: 'Forget failed — id not found.', success: false };
      }

      case 'get_my_spend': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const usage = await computeMonthlyUsage(cleanPhone);
        if (!usage) return { content: "Couldn't load usage right now.", success: false };
        // Look up the budget from the deployment_spec, fall back to $50.
        let monthlyBudget = 50;
        if (SUPABASE_URL && SUPABASE_KEY) {
          try {
            const specRes = await fetch(
              `${SUPABASE_URL}/rest/v1/tenant_configs?tenant_phone=eq.${cleanPhone}&config_type=eq.deployment_spec&select=config`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
            );
            const specRows = specRes.ok ? await specRes.json() : [];
            monthlyBudget = specRows[0]?.config?.pricing?.monthlyBase ?? 50;
          } catch {}
        }
        const budget = evaluateBudget(usage, monthlyBudget);
        const used = usage.totals.estimatedCostUsd;
        const cat = usage.byCategory;
        const lines: string[] = [
          `Month-to-date: $${used.toFixed(2)} of $${monthlyBudget} (${budget.pctUsed}% used)`,
          `Status: ${budget.status === 'ok' ? '✅ on track' : budget.status === 'warning' ? '⚠ approaching cap' : '🛑 over budget'}`,
        ];
        if (budget.daysToExhaustion !== null && budget.daysToExhaustion < 30) {
          lines.push(`At current burn (~$${budget.estimatedDailyBurn.toFixed(2)}/day), exhaustion in ~${budget.daysToExhaustion} days.`);
        }
        lines.push('');
        lines.push('By category:');
        lines.push(`  • Chat with me: $${cat.chat.costUsd.toFixed(2)} (${cat.chat.runs} replies)`);
        lines.push(`  • Background agents: $${cat.agents.costUsd.toFixed(2)} (${cat.agents.runs} ticks)`);
        if (cat.research.costUsd > 0) {
          lines.push(`  • Research: $${cat.research.costUsd.toFixed(2)} (${cat.research.runs} queries)`);
        }
        return { content: lines.join('\n'), success: true };
      }

      case 'get_spend_breakdown': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const usage = await computeMonthlyUsage(cleanPhone);
        if (!usage) return { content: "Couldn't load usage right now.", success: false };

        // Resolve agent_instance_id keys to human names via agent_configs join.
        const agentNameById = new Map<string, string>();
        if (SUPABASE_URL && SUPABASE_KEY) {
          try {
            const [instRes, cfgRes] = await Promise.all([
              fetch(`${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,agent_config_id`, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
              }),
              fetch(`${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&select=id,agent_name`, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
              }),
            ]);
            const insts: any[] = instRes.ok ? await instRes.json() : [];
            const cfgs: any[] = cfgRes.ok ? await cfgRes.json() : [];
            const cfgById = new Map<string, string>();
            for (const c of cfgs) cfgById.set(c.id, c.agent_name);
            for (const i of insts) {
              const name = cfgById.get(i.agent_config_id);
              if (name) agentNameById.set(i.id, name);
            }
          } catch {}
        }

        const sortedAgents = Object.entries(usage.byAgent)
          .map(([key, v]) => ({
            label: key.startsWith('chat:') ? `Chat (${key.slice(5)})` : agentNameById.get(key) ?? `Agent ${key.slice(0, 8)}`,
            ...v,
          }))
          .sort((a, b) => b.costUsd - a.costUsd);

        const sortedModels = Object.entries(usage.byModel)
          .map(([k, v]) => ({ model: k, ...v }))
          .sort((a, b) => b.costUsd - a.costUsd);

        const lines: string[] = [
          `Total this month: $${usage.totals.estimatedCostUsd.toFixed(2)} across ${usage.totals.runs} runs.`,
          '',
          'By agent:',
          ...sortedAgents.slice(0, 10).map((a) => `  • ${a.label}: $${a.costUsd.toFixed(2)} (${a.runs} runs)`),
          '',
          'By model:',
          ...sortedModels.map((m) => `  • ${m.model}: $${m.costUsd.toFixed(2)} (${(m.tokensIn + m.tokensOut).toLocaleString()} tokens)`),
        ];
        return { content: lines.join('\n'), success: true };
      }

      case 'list_my_team': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const team = await loadCurrentTeam(cleanPhone);
        if (team.length === 0) return { content: 'No active agents on the team yet.', success: true };
        const lines = team.map((m) => `  • ${m.name} — ${m.role}${m.category ? ` (${m.category})` : ''}${m.status ? ` [${m.status}]` : ''}`);
        return { content: `${team.length} agent${team.length === 1 ? '' : 's'} on the team:\n${lines.join('\n')}`, success: true };
      }

      case 'connect_booking_system': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const provider = String(call.input.provider ?? '').toLowerCase();
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const base = APP_BASE_URL ?? 'https://wisdomworks.vercel.app';
        const providerLabels: Record<string, { label: string; envVar: string; description: string }> = {
          square: {
            label: 'Square Appointments',
            envVar: 'SQUARE_APP_ID',
            description: 'I\'ll pull your entire customer list + appointment history into client profiles. Your existing scheduling stays in Square — we sync the data so your team can act on it.',
          },
          calendly: {
            label: 'Calendly',
            envVar: 'CALENDLY_CLIENT_ID',
            description: 'I\'ll pull your invitee roster from scheduled events + map past appointments into client profiles. Calendly stays your booking page — we add memory + follow-up.',
          },
          mindbody: {
            label: 'Mindbody',
            envVar: 'MINDBODY_API_KEY',
            description: 'I\'ll pull your client roster + class/appointment history. Mindbody stays your front-of-house — we add insight layer + WhatsApp ops.',
          },
        };
        const config = providerLabels[provider];
        if (!config) {
          return { content: `${provider} isn't wired up yet. Today: square, calendly, mindbody.`, success: false };
        }
        if (!process.env[config.envVar]) {
          return { content: `${config.label} integration not yet configured (admin needs to set ${config.envVar}).`, success: false };
        }
        const link = `${base}/api/oauth/${provider}?phone=${encodeURIComponent(cleanPhone)}`;
        return {
          content: `Tap to connect ${config.label}:\n\n${link}\n\n${config.description}`,
          success: true,
        };
      }

      case 'sync_booking_customers': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const conns = await loadActiveBookingConnections(cleanPhone);
        if (conns.length === 0) {
          return { content: "You don't have a booking system connected yet. Say 'connect square' to set one up.", success: false };
        }
        let totalFetched = 0;
        let totalUpserted = 0;
        let totalAppts = 0;
        let totalVisits = 0;
        const adapters: Record<string, any> = { square: squareAdapter, calendly: calendlyAdapter, mindbody: mindbodyAdapter };
        for (const conn of conns) {
          const adapter = adapters[conn.provider];
          if (!adapter) continue;
          const res = await syncCustomersFromConnection(conn, adapter);
          totalFetched += res.fetched;
          totalUpserted += res.upserted;
          totalAppts += res.appointmentsFetched;
          totalVisits += res.visitsRecorded;
        }
        return {
          content: `Synced ${conns.length} booking connection${conns.length === 1 ? '' : 's'}:\n  • Customers: ${totalUpserted} of ${totalFetched} written to client profiles\n  • Appointments: ${totalVisits} of ${totalAppts} written to visit history`,
          success: true,
        };
      }

      case 'schedule_event': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const title = String(call.input.title ?? '').trim();
        const startAt = String(call.input.start_at ?? '').trim();
        const endAt = String(call.input.end_at ?? '').trim();
        if (!title || !startAt || !endAt) return { content: 'Missing title, start_at, or end_at.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const id = await createManagedEvent({
          tenantPhone: cleanPhone,
          title,
          startAt,
          endAt,
          notes: call.input.notes ? String(call.input.notes) : undefined,
          location: call.input.location ? String(call.input.location) : undefined,
          allDay: !!call.input.all_day,
          tags: Array.isArray(call.input.tags) ? call.input.tags.map(String) : undefined,
          source: 'owner_defined',
        });
        if (!id) return { content: 'Could not save the event.', success: false };
        const when = new Date(startAt).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
        return { content: `✓ Scheduled "${title}" for ${when}. It'll appear in your daily brief and I'll flag any conflicts with other commitments.`, success: true };
      }

      case 'list_my_schedule': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const from = call.input.from_date ? new Date(String(call.input.from_date)) : new Date();
        const to = call.input.to_date
          ? new Date(String(call.input.to_date))
          : new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59);
        const fromIso = from.toISOString();
        const toIso = to.toISOString();

        // Pull connected calendar events (from profile.todaysCalendar — populated
        // by calendar-sync cron) when the window overlaps today
        const connectedEvents = (user.profile as any)?.todaysCalendar ?? [];
        const inWindow = connectedEvents.filter((e: any) => {
          const t = new Date(e.start).getTime();
          return t >= from.getTime() && t <= to.getTime();
        });

        // Pull upcoming bookings (client_visits with occurred_at in range)
        let upcomingBookings: any[] = [];
        if (SUPABASE_URL && SUPABASE_KEY) {
          try {
            const res = await fetch(
              `${SUPABASE_URL}/rest/v1/client_visits?tenant_phone=eq.${cleanPhone}&occurred_at=gte.${encodeURIComponent(fromIso)}&occurred_at=lt.${encodeURIComponent(toIso)}&select=summary,occurred_at&order=occurred_at.asc`,
              { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
            );
            upcomingBookings = res.ok ? await res.json() : [];
          } catch {}
        }

        const unified = await buildUnifiedSchedule({
          tenantPhone: cleanPhone,
          fromIso, toIso,
          connectedCalendarEvents: inWindow.map((e: any) => ({ start: e.start, end: e.end, title: e.title, location: e.location })),
          upcomingBookings,
        });

        if (unified.length === 0) {
          return { content: 'Nothing on the schedule in that window.', success: true };
        }

        const conflicts = detectConflicts(unified);
        const lines = unified.map((e) => {
          const t = new Date(e.startAt).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          const sourceMark = e.source === 'native' ? '📝' : e.source === 'connected_calendar' ? '📅' : '👥';
          const loc = e.location ? ` @ ${e.location}` : '';
          return `${sourceMark} ${t} — ${e.title}${loc}`;
        });

        let result = `${unified.length} event${unified.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
        if (conflicts.length > 0) {
          result += `\n\n⚠ ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} detected:`;
          for (const c of conflicts.slice(0, 5)) {
            const t = new Date(c.a.startAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
            result += `\n  • ${t}: "${c.a.title}" overlaps with "${c.b.title}"`;
          }
        }
        return { content: result, success: true };
      }

      case 'cancel_event': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.event_id ?? '').trim();
        if (!idIn) return { content: 'Missing event_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        // Resolve 8-char prefix → full UUID by listing nearby events
        let eventId = idIn;
        if (idIn.length === 8) {
          const upcoming = await listEventsInRange({
            tenantPhone: cleanPhone,
            fromIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            toIso: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          });
          const match = upcoming.find((e) => e.id.startsWith(idIn.toLowerCase()));
          if (!match) return { content: `No upcoming event matches ${idIn}.`, success: false };
          eventId = match.id;
        }
        const ok = await cancelManagedEvent(eventId, cleanPhone);
        if (!ok) return { content: 'Could not cancel the event.', success: false };
        return { content: '✓ Cancelled.', success: true };
      }

      case 'estimate_video_cost': {
        const q = (call.input.quality as 'fast' | 'standard' | 'premium' | undefined) ?? 'fast';
        const est = estimateGenerationCost(q);
        return {
          content: `${q} tier: ${est.modelRef}, ~${est.durationSec}s clip, ~$${est.costUsd.toFixed(2)} per generation. Replicate bills per-use; you control the spend.`,
          success: true,
        };
      }

      case 'generate_marketing_video': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        let prompt = String(call.input.prompt ?? '').trim();
        if (!prompt) return { content: 'prompt required.', success: false };
        let quality = (call.input.quality as 'fast' | 'standard' | 'premium' | undefined) ?? 'fast';
        if (!process.env.REPLICATE_API_TOKEN) {
          return { content: 'Video generation not yet configured (REPLICATE_API_TOKEN missing). Admin needs to set it up.', success: false };
        }
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');

        // Optional style lookup — prepend style description for brand consistency
        let usedStyle: { name: string; id: string } | null = null;
        if (call.input.style_name) {
          const style = await findStyleByName(cleanPhone, String(call.input.style_name));
          if (style) {
            prompt = `${style.style_prompt}. ${prompt}`;
            quality = (call.input.quality as any) ?? style.default_quality;
            usedStyle = { name: style.name, id: style.id };
          }
        }

        // ASYNC FLOW — the WhatsApp webhook is 60s capped but video gen
        // is 30-180s. Start the prediction, persist the job, return
        // immediately. The video-job-poller cron sends the preview when
        // ready (every 2 min).
        const start = await startVideoGeneration({
          prompt,
          quality,
          durationSec: typeof call.input.duration_sec === 'number' ? call.input.duration_sec : undefined,
          aspectRatio: (call.input.aspect_ratio as any) ?? undefined,
        });
        if (!start.ok || !start.predictionId) {
          return { content: `Video generation failed to start: ${start.error}`, success: false };
        }

        // Persist the job so the poller can pick it up
        try {
          const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (supaUrl && supaKey) {
            await fetch(`${supaUrl}/rest/v1/video_generation_jobs`, {
              method: 'POST',
              headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({
                tenant_phone: cleanPhone,
                prediction_id: start.predictionId,
                model_ref: start.modelRef ?? '',
                quality,
                prompt,
                caption: typeof call.input.caption === 'string' ? call.input.caption.slice(0, 1024) : null,
                style_id: usedStyle?.id ?? null,
                style_name: usedStyle?.name ?? null,
                estimated_cost_usd: start.costEstimateUsd ?? 0,
              }),
            });
          }
        } catch (err) {
          console.warn('[generate_marketing_video] job insert failed:', err);
        }

        const styleNote = usedStyle ? ` (style: ${usedStyle.name})` : '';
        return {
          content: `🎬 Generating video now${styleNote} — ${start.modelRef}, est. $${(start.costEstimateUsd ?? 0).toFixed(2)}. Typical wait: 30-90 seconds. I'll text you the preview the moment it's ready. (Job: ${start.predictionId.slice(0, 12)})`,
          success: true,
        };
      }

      case 'save_marketing_style': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const name = String(call.input.name ?? '').trim();
        const stylePrompt = String(call.input.style_prompt ?? '').trim();
        if (!name || !stylePrompt) return { content: 'name and style_prompt required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const result = await saveMarketingStyle({
          tenantPhone: cleanPhone,
          name,
          stylePrompt,
          referenceVideoUrl: call.input.reference_video_url ? String(call.input.reference_video_url) : undefined,
          referenceImageUrl: call.input.reference_image_url ? String(call.input.reference_image_url) : undefined,
          defaultQuality: (call.input.default_quality as any) ?? 'fast',
        });
        if (!result) return { content: 'Could not save style.', success: false };
        return {
          content: `✓ Saved style "${result.name}". Next time you ask for a reel, say "use ${result.name} style" and I'll match this look.`,
          success: true,
        };
      }

      case 'list_marketing_styles': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const styles = await listMarketingStyles(cleanPhone);
        if (styles.length === 0) {
          return { content: "No saved styles yet. Save one with 'save this style as X: <description>'.", success: true };
        }
        const lines = styles.map((s) => {
          const last = s.last_used_at ? new Date(s.last_used_at).toISOString().slice(0, 10) : 'never';
          return `  ${s.name}  · ${s.use_count} uses, last ${last}\n     "${s.style_prompt.slice(0, 120)}${s.style_prompt.length > 120 ? '…' : ''}"`;
        });
        return { content: `${styles.length} saved style${styles.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
      }

      case 'delete_marketing_style': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const name = String(call.input.name ?? '').trim();
        if (!name) return { content: 'name required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const ok = await deleteMarketingStyle(cleanPhone, name);
        return ok
          ? { content: `✓ Deleted style "${name}".`, success: true }
          : { content: `No style named "${name}" found.`, success: false };
      }

      case 'list_marketing_drafts': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const status = (call.input.status as any) ?? 'proposed';
        const limit = typeof call.input.limit === 'number' ? call.input.limit : 8;
        const drafts = (await listDrafts(cleanPhone, status)).slice(0, limit);
        if (drafts.length === 0) {
          return { content: `No ${status} marketing drafts. Set autonomy to L3 to have me propose ideas on cadence.`, success: true };
        }
        const lines = drafts.map((d) => {
          const sid = d.id.slice(0, 8);
          const cost = d.estimated_cost_usd ? `~$${Number(d.estimated_cost_usd).toFixed(2)}` : 'free';
          return `  [${sid}] ${d.topic}\n     ${d.channel} · ${cost} · ${d.status}\n     "${d.caption.slice(0, 140)}${d.caption.length > 140 ? '…' : ''}"`;
        });
        return {
          content: `${drafts.length} ${status} draft${drafts.length === 1 ? '' : 's'}:\n${lines.join('\n\n')}\n\nReply "approve <id>" to generate the video + preview, or "dismiss <id>".`,
          success: true,
        };
      }

      case 'propose_marketing_draft': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const topic = String(call.input.topic ?? '').trim();
        const caption = String(call.input.caption ?? '').trim();
        const prompt = String(call.input.prompt ?? '').trim();
        if (!topic || !caption || !prompt) return { content: 'topic, caption, and prompt required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const channel = (call.input.channel as DraftChannel | undefined) ?? 'instagram_reel';
        const hashtags = Array.isArray(call.input.hashtags)
          ? (call.input.hashtags as string[]).map((h) => (h.startsWith('#') ? h : `#${h}`))
          : [];
        const est = estimateGenerationCost('fast');
        const draft = await proposeDraft({
          tenantPhone: cleanPhone,
          source: 'owner_requested',
          channel,
          topic,
          caption,
          prompt,
          hashtags,
          estimatedCostUsd: est.costUsd,
          metadata: { quality: 'fast', model: est.modelRef, confidence: 0.85 },
        });
        if (!draft) return { content: 'Could not save draft.', success: false };
        return {
          content: `✓ Draft saved [${draft.id.slice(0, 8)}]: ${topic}\nEstimated cost to generate: ~$${est.costUsd.toFixed(2)}.\nReply "approve ${draft.id.slice(0, 8)}" when you want me to generate the video.`,
          success: true,
        };
      }

      case 'approve_marketing_draft': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const rawId = String(call.input.draft_id ?? '').trim();
        if (!rawId) return { content: 'draft_id required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        // Accept 8-char prefix — resolve to full UUID
        let fullId = rawId;
        let resolvedDraft: any = null;
        if (rawId.length < 36) {
          const open = await listDrafts(cleanPhone);
          const match = open.find((d) => d.id.startsWith(rawId));
          if (!match) return { content: `No draft matching id "${rawId}".`, success: false };
          fullId = match.id;
          resolvedDraft = match;
        } else {
          const d = await getDraft(fullId);
          if (!d || d.tenant_phone !== cleanPhone) return { content: 'Draft not found.', success: false };
          resolvedDraft = d;
        }
        const autoPublish = call.input.auto_publish === true;
        const styleNameOverride = call.input.style_name ? String(call.input.style_name) : undefined;

        // If the draft already has a video_url (re-running after preview),
        // skip generation and go straight through approveDraft — it'll
        // hit the synchronous publish path which is short.
        if (resolvedDraft.video_url) {
          const result = await approveDraft(fullId, { generate: false, autoPublish, styleNameOverride });
          if (!result.ok) return { content: `Approval failed: ${result.error}`, success: false };
          if (autoPublish) {
            return { content: `✓ Published. Post id: ${result.publishedPostId ?? 'pending'}.`, success: true };
          }
          return { content: `Draft already has video. Reply "publish ${fullId.slice(0, 8)}" to post.`, success: true };
        }

        // No video yet — async generation. The video-job-poller picks it
        // up within 2 min, sends the preview to WhatsApp, and (if
        // auto_publish) publishes it without further owner gating.
        if (!process.env.REPLICATE_API_TOKEN) {
          return { content: 'Video generation not configured (REPLICATE_API_TOKEN missing).', success: false };
        }
        let prompt = resolvedDraft.prompt ?? '';
        let usedStyle: { name: string; id: string } | null = null;
        if (styleNameOverride) {
          const style = await findStyleByName(cleanPhone, styleNameOverride);
          if (style) {
            prompt = `${style.style_prompt}. ${prompt}`;
            usedStyle = { name: style.name, id: style.id };
          }
        }
        const meta = (resolvedDraft.metadata ?? {}) as any;
        const quality = (meta.quality as 'fast' | 'standard' | 'premium' | undefined) ?? 'fast';

        const start = await startVideoGeneration({ prompt, quality });
        if (!start.ok || !start.predictionId) {
          return { content: `Couldn't start video generation: ${start.error}`, success: false };
        }

        // Move draft to approved status now so the lifecycle reflects intent
        const { approveDraft: _ } = { approveDraft }; // silence unused-import nag if it gets stripped
        try {
          const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (supaUrl && supaKey) {
            await fetch(`${supaUrl}/rest/v1/marketing_drafts?id=eq.${fullId}`, {
              method: 'PATCH',
              headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'approved', approved_at: new Date().toISOString() }),
            });
            // Insert the video job with draft linkage
            await fetch(`${supaUrl}/rest/v1/video_generation_jobs`, {
              method: 'POST',
              headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({
                tenant_phone: cleanPhone,
                prediction_id: start.predictionId,
                model_ref: start.modelRef ?? '',
                quality,
                prompt,
                caption: resolvedDraft.caption?.slice(0, 1024) ?? null,
                style_id: usedStyle?.id ?? null,
                style_name: usedStyle?.name ?? null,
                estimated_cost_usd: start.costEstimateUsd ?? 0,
                draft_id: fullId,
                auto_publish: autoPublish,
              }),
            });
          }
        } catch (err) {
          console.warn('[approve_marketing_draft] job insert failed:', err);
        }

        const styleNote = usedStyle ? ` (style: ${usedStyle.name})` : '';
        return {
          content: autoPublish
            ? `🎬 Generating + auto-publishing draft ${fullId.slice(0, 8)}${styleNote}. Typical wait: 30-90 seconds. I'll confirm when it goes live.`
            : `🎬 Generating draft ${fullId.slice(0, 8)}${styleNote} — ${start.modelRef}, est. $${(start.costEstimateUsd ?? 0).toFixed(2)}. I'll text you the preview when it's ready (30-90s), then you say "publish ${fullId.slice(0, 8)}" to post.`,
          success: true,
        };
      }

      case 'dismiss_marketing_draft': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const rawId = String(call.input.draft_id ?? '').trim();
        if (!rawId) return { content: 'draft_id required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        let fullId = rawId;
        if (rawId.length < 36) {
          const open = await listDrafts(cleanPhone, 'proposed');
          const match = open.find((d) => d.id.startsWith(rawId));
          if (!match) return { content: `No proposed draft matching id "${rawId}".`, success: false };
          fullId = match.id;
        }
        const updated = await dismissDraft(fullId);
        if (!updated) return { content: 'Could not dismiss draft.', success: false };
        return { content: `✓ Dismissed draft "${updated.topic}".`, success: true };
      }

      case 'get_marketing_autonomy': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const prefs = await loadAutonomyPrefs(cleanPhone);
        const lvlDesc: Record<AutonomyLevel, string> = {
          L1: 'manual only — you trigger every post',
          L2: 'draft + approve — I draft on demand, you approve',
          L3: 'propose proactively — I draft on cadence, you approve',
          L4: 'autonomous within guardrails — auto-publish allowed posts',
        };
        const lastDraft = prefs.last_draft_at ? new Date(prefs.last_draft_at).toISOString().slice(0, 10) : 'never';
        const channels = prefs.auto_publish_channels.length > 0 ? prefs.auto_publish_channels.join(', ') : '(none)';
        const blocked = prefs.blocked_words.length > 0 ? prefs.blocked_words.join(', ') : '(none)';
        return {
          content:
            `Marketing autonomy: ${prefs.autonomy_level} — ${lvlDesc[prefs.autonomy_level]}\n` +
            `Cadence: every ${prefs.draft_cadence_days}d (last draft: ${lastDraft})\n` +
            `Auto-publish cap: ${prefs.max_auto_publish_per_day}/day · min confidence ${prefs.min_confidence_for_auto}\n` +
            `Auto-publish channels: ${channels}\n` +
            `Blocked words: ${blocked}`,
          success: true,
        };
      }

      case 'set_marketing_autonomy': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const patch: Record<string, unknown> = {};
        if (call.input.autonomy_level) patch.autonomy_level = call.input.autonomy_level;
        if (typeof call.input.max_auto_publish_per_day === 'number') patch.max_auto_publish_per_day = call.input.max_auto_publish_per_day;
        if (typeof call.input.min_confidence_for_auto === 'number') patch.min_confidence_for_auto = call.input.min_confidence_for_auto;
        if (Array.isArray(call.input.blocked_words)) patch.blocked_words = (call.input.blocked_words as string[]).slice(0, 100);
        if (Array.isArray(call.input.auto_publish_channels)) patch.auto_publish_channels = (call.input.auto_publish_channels as string[]).slice(0, 8);
        if (typeof call.input.draft_cadence_days === 'number') patch.draft_cadence_days = Math.max(1, Math.min(90, call.input.draft_cadence_days));
        // Guardrail: don't allow L4 without channels + cap
        const merged = { ...(await loadAutonomyPrefs(cleanPhone)), ...patch } as any;
        if (merged.autonomy_level === 'L4') {
          if (!Array.isArray(merged.auto_publish_channels) || merged.auto_publish_channels.length === 0) {
            return { content: 'Refusing L4 — set at least one auto_publish_channels entry first.', success: false };
          }
          if (!merged.max_auto_publish_per_day || merged.max_auto_publish_per_day <= 0) {
            return { content: 'Refusing L4 — set max_auto_publish_per_day to a positive number first.', success: false };
          }
        }
        const saved = await saveAutonomyPrefs(cleanPhone, patch as any);
        if (!saved) return { content: 'Could not save autonomy preferences.', success: false };
        return {
          content: `✓ Autonomy updated to ${saved.autonomy_level}. ${saved.autonomy_level === 'L4' ? `Auto-publishing up to ${saved.max_auto_publish_per_day}/day on ${saved.auto_publish_channels.join(', ')}.` : ''}`.trim(),
          success: true,
        };
      }

      case 'marketing_performance_summary': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const rows = await recentPerformance(cleanPhone, 10);
        if (rows.length === 0) {
          return { content: 'No marketing post performance data yet. Posts get tracked once you publish through me — try generate_marketing_video + publish_instagram_reel.', success: true };
        }
        const lines = rows.map((r, i) => {
          const auto = r.auto_published ? '🤖' : '👤';
          const score = r.performance_score != null ? `score ${r.performance_score}` : 'pending';
          const ago = Math.max(0, Math.floor((Date.now() - new Date(r.published_at).getTime()) / (60 * 60 * 1000)));
          const reachBit = r.reach != null ? `, reach ${r.reach}` : '';
          return `  ${i + 1}. ${auto} ${r.channel} (${ago}h ago) — ❤️${r.like_count} 💬${r.comments_count}${reachBit} · ${score}`;
        });
        return { content: `Recent performance:\n${lines.join('\n')}\n\n🤖 = auto-published (L4)  👤 = owner-approved`, success: true };
      }

      case 'send_video_preview': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const videoUrl = String(call.input.video_url ?? '').trim();
        if (!videoUrl || !videoUrl.startsWith('https://')) return { content: 'video_url required (must be HTTPS).', success: false };
        const caption = call.input.caption ? String(call.input.caption).slice(0, 1024) : undefined;
        const result = await sendWhatsAppVideo({
          to: user.phoneNumber,
          videoUrl,
          caption,
        });
        if (!result.ok) return { content: `Video preview failed: ${result.error}`, success: false };
        return {
          content: `✓ Sent video preview to your WhatsApp. Watch it and tell me 'publish it' to post the reel, or 'regenerate with X' to try again.`,
          success: true,
        };
      }

      case 'instagram_recent_activity': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
        if (!igConn) {
          return { content: "No Instagram connected yet. Say 'connect Instagram' for the one-tap link.", success: false };
        }
        const igAccountId = igConn.metadata?.instagram_account_id;
        if (!igAccountId) {
          return { content: 'Meta connected but no Instagram Business Account linked to your Facebook Page. Set that up at business.facebook.com.', success: false };
        }
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(igConn.access_token);
          const summary = await summarizeInstagramActivity({ accessToken: token, igAccountId });
          if (summary.posts.length === 0) return { content: 'No recent Instagram posts.', success: true };
          const lines = summary.posts.map((p, i) => {
            const cap = p.caption ? `"${p.caption.slice(0, 80)}"` : '(no caption)';
            const cmt = p.latestComment
              ? `\n     💬 @${p.latestComment.username}: "${(p.latestComment.text ?? '').slice(0, 100)}"`
              : '';
            return `  ${i + 1}. ${cap}\n     ❤️ ${p.likeCount}  💬 ${p.commentsCount}${cmt}`;
          });
          return { content: `Recent IG activity:\n${lines.join('\n')}`, success: true };
        } catch (err: any) {
          return { content: `IG fetch failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'publish_instagram_post': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const imageUrl = String(call.input.image_url ?? '').trim();
        const caption = String(call.input.caption ?? '').trim();
        if (!imageUrl || !caption) return { content: 'image_url and caption required.', success: false };
        if (!imageUrl.startsWith('https://')) return { content: 'image_url must be HTTPS.', success: false };
        const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
        if (!igConn) return { content: "No Instagram connected yet.", success: false };
        const igAccountId = igConn.metadata?.instagram_account_id;
        if (!igAccountId) return { content: 'No Instagram Business Account linked to your Page.', success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(igConn.access_token);
          const result = await publishInstagramPhoto({ accessToken: token, igAccountId, imageUrl, caption });
          if (!result.ok) return { content: `Publish failed: ${result.error}`, success: false };
          if (result.postId) {
            void trackPostPublished({
              tenantPhone: user.phoneNumber,
              channel: 'instagram_post',
              platformPostId: result.postId,
              autoPublished: false,
            });
          }
          return { content: `✓ Posted to Instagram. Post id: ${result.postId}`, success: true };
        } catch (err: any) {
          return { content: `IG publish failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'publish_instagram_reel': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const videoUrl = String(call.input.video_url ?? '').trim();
        const caption = String(call.input.caption ?? '').trim();
        if (!videoUrl || !caption) return { content: 'video_url and caption required.', success: false };
        if (!videoUrl.startsWith('https://')) return { content: 'video_url must be HTTPS.', success: false };
        const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
        if (!igConn) return { content: "No Instagram connected yet.", success: false };
        const igAccountId = igConn.metadata?.instagram_account_id;
        if (!igAccountId) return { content: 'No Instagram Business Account linked.', success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(igConn.access_token);
          // Note: Meta encodes the video before publish — this can take 15-90s.
          // The chat brain may hit its own iteration cap; surface a friendly
          // message if so. The Reels endpoint polls up to 90s by default.
          const result = await publishInstagramReel({
            accessToken: token,
            igAccountId,
            videoUrl,
            caption,
            shareToFeed: call.input.share_to_feed !== false,
          });
          if (!result.ok) return { content: `Reel publish failed: ${result.error}`, success: false };
          if (result.postId) {
            void trackPostPublished({
              tenantPhone: user.phoneNumber,
              channel: 'instagram_reel',
              platformPostId: result.postId,
              autoPublished: false,
            });
          }
          return { content: `✓ Reel posted to Instagram. Post id: ${result.postId}`, success: true };
        } catch (err: any) {
          return { content: `Reel publish failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'publish_facebook_post': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const message = String(call.input.message ?? '').trim();
        if (!message) return { content: 'message required.', success: false };
        const fbConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
        if (!fbConn) return { content: "No Meta Business connected yet.", success: false };
        const pageId = fbConn.metadata?.page_id;
        if (!pageId) return { content: 'No Facebook Page linked to your Meta connection.', success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          // The access_token on the meta connection IS the page access token
          const token = await decryptToken(fbConn.access_token);
          const result = await publishFacebookPagePost({
            pageAccessToken: token,
            pageId,
            message,
            imageUrl: call.input.image_url ? String(call.input.image_url) : undefined,
            linkUrl: call.input.link_url ? String(call.input.link_url) : undefined,
          });
          if (!result.ok) return { content: `Facebook post failed: ${result.error}`, success: false };
          if (result.postId) {
            void trackPostPublished({
              tenantPhone: user.phoneNumber,
              channel: 'facebook_post',
              platformPostId: result.postId,
              autoPublished: false,
            });
          }
          return { content: `✓ Posted to Facebook Page. Post id: ${result.postId}`, success: true };
        } catch (err: any) {
          return { content: `Facebook post failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'reply_to_instagram_comment': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const mediaId = String(call.input.media_id ?? '').trim();
        const commentId = String(call.input.comment_id ?? '').trim();
        const message = String(call.input.message ?? '').trim();
        if (!mediaId || !commentId || !message) return { content: 'media_id, comment_id, and message required.', success: false };
        const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
        if (!igConn) return { content: "No Instagram connected yet.", success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(igConn.access_token);
          const result = await replyToInstagramComment({ accessToken: token, igMediaId: mediaId, parentCommentId: commentId, message });
          if (!result.ok) return { content: `Reply failed: ${result.error}`, success: false };
          return { content: `✓ Replied. New comment id: ${result.commentId}`, success: true };
        } catch (err: any) {
          return { content: `IG reply failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'create_payment_link': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const amount = Number(call.input.amount_usd);
        const description = String(call.input.description ?? '').trim();
        if (!amount || amount <= 0 || !description) {
          return { content: 'Need amount_usd > 0 and a description.', success: false };
        }
        // Find Stripe connection (cast through any — OAuthConnection.provider
        // type doesn't include new providers from the integration catalog)
        const stripeConn = (connections as any[]).find((c) => c.provider === 'stripe' && c.service === 'payments');
        if (!stripeConn) {
          return { content: "No Stripe connected yet. Say 'connect Stripe' to set it up — one tap, no API keys.", success: false };
        }
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(stripeConn.access_token);
          const link = await createStripePaymentLink({
            accessToken: token,
            amountUsd: amount,
            description,
            customerEmail: call.input.customer_email ? String(call.input.customer_email) : undefined,
          });
          if (!link) return { content: 'Could not create the payment link. Check the Stripe connection.', success: false };
          return {
            content: `✓ Payment link ready:\n\n${link.url}\n\nFor ${description} — $${amount.toFixed(2)}. Stripe takes 2.9% + $0.30 per transaction. Send the URL to your customer.`,
            success: true,
          };
        } catch (err: any) {
          return { content: `Payment link creation failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'list_recent_payments': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const stripeConn = (connections as any[]).find((c) => c.provider === 'stripe' && c.service === 'payments');
        if (!stripeConn) {
          return { content: "No Stripe connected yet. Say 'connect Stripe' to set it up.", success: false };
        }
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(stripeConn.access_token);
          const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 50) : 10;
          const charges = await listStripeCharges(token, limit);
          if (charges.length === 0) return { content: 'No recent Stripe charges.', success: true };
          const lines = charges.map((c: any) => {
            const amount = (c.amount / 100).toFixed(2);
            const date = new Date(c.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const status = c.status === 'succeeded' ? '✓' : c.status === 'pending' ? '⏳' : '⚠';
            const customer = c.billing_details?.name || c.billing_details?.email || c.description || '(no name)';
            return `  ${status} ${date}  $${amount}  ${customer}`;
          });
          return { content: `${charges.length} recent charge${charges.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
        } catch (err: any) {
          return { content: `Stripe fetch failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'qbo_outstanding_ar': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const qboConn = (connections as any[]).find((c) => c.provider === 'quickbooks' && c.service === 'accounting');
        if (!qboConn) return { content: "No QuickBooks connected yet. Say 'connect QuickBooks' to set it up.", success: false };
        const realmId = qboConn.metadata?.realm_id;
        if (!realmId) return { content: 'QuickBooks connected but realm_id missing — reconnect to fix.', success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(qboConn.access_token);
          const ar = await fetchOutstandingAR({ accessToken: token, realmId });
          if (ar.invoiceCount === 0) return { content: '🎉 No outstanding invoices — everyone is paid up.', success: true };
          const oldest = ar.oldestDueDate ? ` (oldest due ${ar.oldestDueDate})` : '';
          return {
            content: `📊 Outstanding AR: $${ar.totalOwed.toFixed(2)} across ${ar.invoiceCount} unpaid invoice${ar.invoiceCount === 1 ? '' : 's'}${oldest}.\n\nWant me to list them or draft follow-ups for the overdue ones?`,
            success: true,
          };
        } catch (err: any) {
          return { content: `QuickBooks fetch failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'qbo_list_unpaid_invoices': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const qboConn = (connections as any[]).find((c) => c.provider === 'quickbooks' && c.service === 'accounting');
        if (!qboConn) return { content: "No QuickBooks connected yet.", success: false };
        const realmId = qboConn.metadata?.realm_id;
        if (!realmId) return { content: 'QuickBooks realm_id missing — reconnect to fix.', success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(qboConn.access_token);
          const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 50) : 10;
          const invoices = await qboListInvoices({ accessToken: token, realmId, onlyUnpaid: true, limit });
          if (invoices.length === 0) return { content: 'No unpaid invoices. 💸', success: true };
          const lines = invoices.map((inv) => {
            const flag = inv.status === 'overdue' ? '🚨' : inv.status === 'partial' ? '⚠️' : '📄';
            const due = inv.dueDate ? ` due ${inv.dueDate}` : '';
            const doc = inv.docNumber ? ` #${inv.docNumber}` : '';
            return `  ${flag} ${inv.customerName ?? '(no name)'}${doc} — $${inv.balance.toFixed(2)}${due}`;
          });
          return { content: `${invoices.length} unpaid invoice${invoices.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
        } catch (err: any) {
          return { content: `QuickBooks fetch failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'qbo_create_invoice': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const qboConn = (connections as any[]).find((c) => c.provider === 'quickbooks' && c.service === 'accounting');
        if (!qboConn) return { content: "No QuickBooks connected yet.", success: false };
        const realmId = qboConn.metadata?.realm_id;
        if (!realmId) return { content: 'QuickBooks realm_id missing — reconnect to fix.', success: false };
        const customerName = String(call.input.customer_name ?? '').trim();
        const amount = Number(call.input.amount_usd);
        const description = String(call.input.description ?? '').trim();
        if (!customerName || !description || !Number.isFinite(amount) || amount <= 0) {
          return { content: 'customer_name, amount_usd (positive), and description are required.', success: false };
        }
        const customerEmail = call.input.customer_email ? String(call.input.customer_email) : undefined;
        const dueDate = call.input.due_date ? String(call.input.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(qboConn.access_token);
          const customerId = await qboFindOrCreateCustomer({
            accessToken: token,
            realmId,
            name: customerName,
            email: customerEmail,
          });
          if (!customerId) return { content: `Could not find or create customer "${customerName}" in QuickBooks.`, success: false };
          const invoice = await qboCreateInvoice({
            accessToken: token,
            realmId,
            customerId,
            amountUsd: amount,
            description,
            dueDate,
          });
          if (!invoice) return { content: 'Invoice creation failed in QuickBooks.', success: false };
          return {
            content: `✓ Invoice ${invoice.docNumber ? `#${invoice.docNumber}` : invoice.id} created in QuickBooks: $${amount.toFixed(2)} to ${customerName}, due ${dueDate}.`,
            success: true,
          };
        } catch (err: any) {
          return { content: `QuickBooks invoice creation failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'offer_missing_connections': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const max = typeof call.input.max === 'number' ? Math.min(call.input.max, 6) : 3;
        const gaps = await detectConnectionGaps(cleanPhone);
        if (gaps.length === 0) {
          return { content: "You're already connected to everything your vertical needs. Nice.", success: true };
        }
        const lines: string[] = [
          `${gaps.length} integration${gaps.length === 1 ? '' : 's'} would help — tap the link to connect (no API keys needed, OAuth handles everything):`,
          '',
        ];
        for (const g of gaps.slice(0, max)) {
          lines.push(`${g.provider.emoji} ${g.provider.label}`);
          lines.push(`   ${g.provider.tagline}`);
          if (g.provider.costNote) lines.push(`   Note: ${g.provider.costNote}`);
          lines.push(`   👉 ${g.oneTapUrl}`);
          lines.push('');
        }
        return { content: lines.join('\n').trim(), success: true };
      }

      case 'connect_automation_webhook': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const url = String(call.input.url ?? '').trim();
        const label = String(call.input.label ?? '').trim();
        if (!url || !label) return { content: 'url and label required.', success: false };
        const eventTypes = Array.isArray(call.input.event_types) ? call.input.event_types.map(String) : [];
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const result = await createEventWebhook({
          tenantPhone: cleanPhone,
          url,
          label,
          eventTypes: eventTypes as any,
        });
        if (!result) {
          return { content: 'Could not create webhook. Make sure the URL is HTTPS and well-formed.', success: false };
        }
        const isZapier = url.includes('hooks.zapier.com');
        const lines = [
          `✓ Connected "${label}".`,
          '',
          `Webhook id: ${result.id}`,
          `Signing secret (save this — shown ONCE):`,
          result.signingSecret,
          '',
          `Events will POST to that URL${eventTypes.length > 0 ? ` for: ${eventTypes.join(', ')}` : ' for ALL event types'}.`,
          `Each request includes:`,
          `  • X-WisdomWorks-Signature header (HMAC-SHA256 of body using the secret)`,
          `  • X-WisdomWorks-Event header (event type)`,
          isZapier ? '\n⚠ Heads up: Zapier requires their $19.99/mo Starter plan for "Webhooks by Zapier" triggers. Make.com and IFTTT have free webhooks if you want to avoid that.' : '',
        ].filter(Boolean);
        return { content: lines.join('\n'), success: true };
      }

      case 'list_automation_webhooks': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const hooks = await listEventWebhooks(cleanPhone);
        if (hooks.length === 0) {
          return { content: "No automation webhooks configured. Say 'connect my Zapier' (or Make/IFTTT) to add one.", success: true };
        }
        const lines = hooks.map((h) => {
          const status = h.status === 'revoked' ? '🚫 revoked' : h.status === 'paused' ? '⏸ paused' : '✓ active';
          const lastFired = h.last_fired_at ? new Date(h.last_fired_at).toISOString().slice(0, 16) : 'never';
          const events = h.event_types.length === 0 ? 'all events' : h.event_types.join(', ');
          const failures = h.failure_count > 0 ? `  ⚠ ${h.failure_count} failures` : '';
          return `  ${status}  "${h.label ?? h.url.slice(0, 40)}"\n     → ${events}\n     fired ${h.fire_count} times, last ${lastFired}${failures}`;
        });
        return { content: `${hooks.length} webhook${hooks.length === 1 ? '' : 's'}:\n${lines.join('\n\n')}`, success: true };
      }

      case 'revoke_automation_webhook': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const webhookId = String(call.input.webhook_id ?? '').trim();
        if (!webhookId) return { content: 'webhook_id required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const ok = await revokeEventWebhook(webhookId, cleanPhone);
        return ok
          ? { content: `✓ Revoked. Events will stop firing to that endpoint immediately.`, success: true }
          : { content: 'Could not revoke. Check the webhook_id is right.', success: false };
      }

      case 'generate_website': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const businessName = String(call.input.business_name ?? user.businessName ?? user.profile?.businessName ?? '').trim();
        if (!businessName) {
          return { content: "Need a business name to build a site. What's the business called?", success: false };
        }
        const verticalLabel = (user.profile as any)?.vertical_template?.label ?? undefined;
        const site = await createTenantSite({
          tenantPhone: cleanPhone,
          businessName,
          verticalLabel,
          heroTitle: call.input.hero_title ? String(call.input.hero_title) : undefined,
          heroSubtitle: call.input.hero_subtitle ? String(call.input.hero_subtitle) : undefined,
          contactEmail: call.input.contact_email ? String(call.input.contact_email) : undefined,
          contactPhone: call.input.contact_phone ? String(call.input.contact_phone) : undefined,
        });
        if (!site) return { content: 'Could not provision the site.', success: false };
        const base = APP_BASE_URL ?? 'https://wisdomworks.vercel.app';
        const url = `${base}/sites/${site.slug}`;
        const lines = [
          `✓ Your site is live: ${url}`,
          '',
          `Includes:`,
          `  • Hero with your business name${verticalLabel ? ` (themed for ${verticalLabel})` : ''}`,
          `  • ${site.services.length} service${site.services.length === 1 ? '' : 's'}${site.services.length > 0 ? ' (pulled from Square)' : ' — add some by saying "list my services on the site"'}`,
          `  • Chat widget (bottom-right)`,
          `  • Booking widget (header + floating button)${verticalLabel === 'Salon' ? '' : ''}`,
          '',
          `Want to customize the title, contact info, hours, or testimonials? Just tell me — "set my hours Mon-Fri 9 to 5", "add this testimonial...", etc.`,
          '',
          `Custom domain? Tell me and I'll walk you through the Vercel domain setup.`,
        ];
        return { content: lines.join('\n'), success: true };
      }

      case 'get_my_website_url': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const site = await getTenantSiteByTenant(cleanPhone);
        if (!site) {
          return { content: "You don't have a site yet. Say 'build me a website' and I'll provision one.", success: true };
        }
        const base = APP_BASE_URL ?? 'https://wisdomworks.vercel.app';
        return {
          content: `Your site: ${base}/sites/${site.slug}\nStatus: ${site.status}${site.custom_domain ? `\nCustom domain: ${site.custom_domain}` : ''}`,
          success: true,
        };
      }

      case 'create_widget_api_key': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const label = String(call.input.label ?? '').trim();
        if (!label) return { content: 'Label is required (e.g. "my wix site").', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const allowedOrigins = Array.isArray(call.input.allowed_origins)
          ? call.input.allowed_origins.map(String).filter(Boolean)
          : [];
        const result = await createWidgetApiKey({
          tenantPhone: cleanPhone,
          label,
          scopes: ['chat', 'booking'],
          allowedOrigins,
        });
        if (!result) return { content: 'Could not generate the API key.', success: false };

        const base = APP_BASE_URL ?? 'https://wisdomworks.vercel.app';
        const chatSnippet = `<script src="${base}/api/widget/embed.js?key=${result.plainKey}" defer></script>`;
        const bookingSnippet = `<script src="${base}/api/widget/booking.js?key=${result.plainKey}" defer></script>`;
        const lines: string[] = [
          `✓ Generated widget key for "${label}".`,
          '',
          `API key (save this — shown ONCE):`,
          result.plainKey,
          '',
          `CHAT WIDGET — paste before </body>:`,
          chatSnippet,
          '',
          `BOOKING WIDGET — paste before </body> (requires Square connected):`,
          bookingSnippet,
          '',
          allowedOrigins.length > 0
            ? `Restricted to origins: ${allowedOrigins.join(', ')}`
            : `⚠ No origin restrictions — anyone with the key can use it. To lock it down, say "restrict widget key wk_${result.plainKey.slice(3, 11)} to my domain".`,
        ];
        return { content: lines.join('\n'), success: true };
      }

      case 'list_widget_api_keys': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const keys = await listApiKeysForTenant(cleanPhone);
        if (keys.length === 0) {
          return { content: "No widget API keys yet. Say 'generate a widget key for my site' to create one.", success: true };
        }
        const lines = keys.map((k) => {
          const status = k.status === 'revoked' ? '🚫 revoked' : '✓ active';
          const lastUsed = k.last_used_at ? new Date(k.last_used_at).toISOString().slice(0, 10) : 'never';
          const origins = k.allowed_origins.length > 0 ? k.allowed_origins.join(', ') : 'any';
          return `  ${k.key_prefix}…  ${status}  "${k.label ?? '(no label)'}"  · ${k.use_count} uses, last ${lastUsed}  · origins: ${origins}`;
        });
        return { content: `${keys.length} widget API key${keys.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
      }

      case 'revoke_widget_api_key': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.key_or_id ?? '').trim();
        if (!idIn) return { content: 'Missing key_or_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const ok = await revokeWidgetApiKey(idIn, cleanPhone);
        if (!ok) return { content: `Could not revoke ${idIn}. Check the key prefix is right.`, success: false };
        return { content: `✓ Revoked ${idIn}. Widget will stop working on any site using it within seconds.`, success: true };
      }

      case 'find_booking_availability': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const serviceId = String(call.input.service_external_id ?? '').trim();
        if (!serviceId) return { content: 'service_external_id required.', success: false };
        const conns = await loadActiveBookingConnections(cleanPhone);
        const conn = conns.find((c) => c.provider === 'square');
        if (!conn) return { content: "No Square connection on file. Connect Square first.", success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(conn.access_token);
          const from = call.input.from_date ? new Date(call.input.from_date) : new Date();
          const to = call.input.to_date ? new Date(call.input.to_date) : new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
          const slots = await squareAdapter.searchAvailability!(token, from.toISOString(), to.toISOString(), {
            merchantId: conn.metadata?.merchant_id,
            serviceExternalId: serviceId,
            staffExternalId: call.input.staff_external_id ? String(call.input.staff_external_id) : undefined,
          });
          if (slots.length === 0) {
            return { content: `No open slots between ${from.toISOString().slice(0, 10)} and ${to.toISOString().slice(0, 10)}.`, success: true };
          }
          const lines = slots.slice(0, 15).map((s) => {
            const d = new Date(s.startAt);
            return `  • ${d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${s.staffExternalId ? ` (staff: ${s.staffExternalId.slice(0, 8)})` : ''}`;
          });
          return { content: `${slots.length} open slot${slots.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
        } catch (err: any) {
          return { content: `Availability search failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'book_appointment': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const customerId = String(call.input.customer_external_id ?? '').trim();
        const serviceId = String(call.input.service_external_id ?? '').trim();
        const startAt = String(call.input.start_at ?? '').trim();
        if (!customerId || !serviceId || !startAt) {
          return { content: 'Missing customer_external_id, service_external_id, or start_at.', success: false };
        }
        const conns = await loadActiveBookingConnections(cleanPhone);
        const conn = conns.find((c) => c.provider === 'square');
        if (!conn) return { content: "No Square connection on file.", success: false };
        try {
          const { decryptToken } = await import('@wisdomworks/shared');
          const token = await decryptToken(conn.access_token);
          const created = await squareAdapter.createBooking!(token, {
            customerExternalId: customerId,
            serviceExternalId: serviceId,
            startAt,
            staffExternalId: call.input.staff_external_id ? String(call.input.staff_external_id) : undefined,
            sellerNote: call.input.seller_note ? String(call.input.seller_note) : undefined,
            durationMinutes: typeof call.input.duration_minutes === 'number' ? call.input.duration_minutes : undefined,
          }, { merchantId: conn.metadata?.merchant_id });
          if (!created) return { content: 'Booking creation failed (check Square logs).', success: false };
          const when = new Date(created.startAt).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          return {
            content: `✓ Booked ${when} (Square booking id ${created.externalId.slice(0, 8)}). It'll appear in your Square calendar immediately and sync back to your visit history on the next sync.`,
            success: true,
          };
        } catch (err: any) {
          return { content: `Booking failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'approve_latest_team_proposal': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const insight = await loadLatestOpenTeamGap(cleanPhone);
        if (!insight) return { content: "There's no open team-gap proposal to approve.", success: false };
        const p = insight.payload ?? {};
        // Mirror the team_gap execution path used in approve_insight
        const team = user.profile?.team ?? [];
        const id = String(p.agent_name).toLowerCase().replace(/\s+/g, '-');
        const tier = ['Haiku', 'Sonnet', 'Opus'].includes(p.tier) ? p.tier : 'Sonnet';
        const newAgent: any = {
          id,
          name: p.agent_name,
          role: p.agent_role,
          tier,
          description: p.description,
          tools: [],
          channels: [],
        };
        const parent = (p.parent_agent_name ?? '').toString().toLowerCase();
        if (parent) {
          const manager = team.find((a: any) => a.name?.toLowerCase() === parent || a.id?.toLowerCase() === parent);
          if (manager) {
            const sub = manager.subTeam ?? { count: 0, label: `${manager.name}'s team`, agents: [] };
            sub.agents.push({ id: `${manager.id ?? id}-${id}`, name: p.agent_name, role: p.agent_role, tier });
            sub.count = sub.agents.length;
            manager.subTeam = sub;
          } else {
            team.push(newAgent);
          }
        } else {
          team.push(newAgent);
        }
        user.profile = user.profile ?? { preferences: {}, activeTopics: [] } as any;
        user.profile.team = team;
        await saveUserContext(user);
        await setInsightStatus(insight.id, 'executed');
        return {
          content: `✓ Added ${p.agent_name} (${p.agent_role}) to your team. They'll start on the next agent tick — no further action needed.`,
          success: true,
        };
      }

      case 'dismiss_latest_team_proposal': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const insight = await loadLatestOpenTeamGap(cleanPhone);
        if (!insight) return { content: "There's no open team-gap proposal to dismiss.", success: false };
        const ok = await setInsightStatus(insight.id, 'dismissed');
        if (!ok) return { content: 'Could not update the proposal.', success: false };
        const p = insight.payload ?? {};
        return { content: `Got it. Skipping ${p.agent_name ?? 'that agent'} for now. I'll keep watching for the gap and bring it back if it gets worse.`, success: true };
      }

      case 'propose_team_addition': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const agentName = String(call.input.agent_name ?? '').trim();
        const agentRole = String(call.input.agent_role ?? '').trim();
        const description = String(call.input.description ?? '').trim();
        const triggerReason = String(call.input.trigger_reason ?? '').trim();
        if (!agentName || !agentRole || !description || !triggerReason) {
          return { content: 'Missing agent_name, agent_role, description, or trigger_reason.', success: false };
        }
        const result = await emitTeamGapInsight({
          tenantPhone: cleanPhone,
          agentName,
          agentRole,
          description,
          triggerReason,
          tier: call.input.tier as any,
          lane: call.input.lane ? String(call.input.lane) : undefined,
          parentAgentName: call.input.parent_agent_name ? String(call.input.parent_agent_name) : undefined,
          exampleResponsibilities: Array.isArray(call.input.example_responsibilities)
            ? call.input.example_responsibilities.map(String).slice(0, 5)
            : undefined,
        });
        if (!result.ok) return { content: `Could not propose: ${result.reason ?? 'unknown'}`, success: false };
        return {
          content: `Proposed adding ${agentName} (${agentRole}). The owner will see it as an insight (id ${result.insightId?.slice(0, 8)}) — they can approve to provision the agent or dismiss.`,
          success: true,
        };
      }

      case 'list_insights': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const items = await listOpenInsights(cleanPhone);
        if (items.length === 0) {
          return { content: "No open insights right now. I'll surface them as they're detected (daily scan + as data accumulates).", success: true };
        }
        const lines = items.slice(0, 10).map((i) => {
          const sevMark = i.severity === 'critical' ? '🛑' : i.severity === 'high' ? '⚡' : i.severity === 'medium' ? '💡' : '·';
          const statusMark = i.status === 'approved' ? ' [approved]' : '';
          return `${sevMark} [${i.id.slice(0, 8)}]${statusMark} ${i.title}\n   → ${i.recommended_action ?? ''}`;
        });
        return { content: `${items.length} open insight${items.length === 1 ? '' : 's'}:\n\n${lines.join('\n\n')}`, success: true };
      }

      case 'approve_insight': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.insight_id ?? '').trim();
        if (!idIn) return { content: 'Missing insight_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const insight = await getInsightById(idIn, cleanPhone);
        if (!insight) return { content: `No insight matches ${idIn}.`, success: false };
        if (insight.status === 'dismissed' || insight.status === 'expired') {
          return { content: `Insight ${idIn} is already ${insight.status}.`, success: false };
        }
        const ok = await setInsightStatus(insight.id, 'approved');
        if (!ok) return { content: 'Could not update the insight.', success: false };

        // Execute inline: team_gap → provision the agent (mirrors add_agent_to_team logic)
        if (insight.detector === 'team_gap') {
          const p = insight.payload ?? {};
          const team = user.profile?.team ?? [];
          const id = String(p.agent_name).toLowerCase().replace(/\s+/g, '-');
          const tier = ['Haiku', 'Sonnet', 'Opus'].includes(p.tier) ? p.tier : 'Sonnet';
          const newAgent: any = {
            id,
            name: p.agent_name,
            role: p.agent_role,
            tier,
            description: p.description,
            tools: [],
            channels: [],
          };
          const parent = (p.parent_agent_name ?? '').toString().toLowerCase();
          if (parent) {
            const manager = team.find((a: any) => a.name?.toLowerCase() === parent || a.id?.toLowerCase() === parent);
            if (manager) {
              const sub = manager.subTeam ?? { count: 0, label: `${manager.name}'s team`, agents: [] };
              sub.agents.push({ id: `${manager.id ?? id}-${id}`, name: p.agent_name, role: p.agent_role, tier });
              sub.count = sub.agents.length;
              manager.subTeam = sub;
            } else {
              team.push(newAgent);
            }
          } else {
            team.push(newAgent);
          }
          user.profile = user.profile ?? { preferences: {}, activeTopics: [] } as any;
          user.profile.team = team;
          await saveUserContext(user);
          await setInsightStatus(insight.id, 'executed');
          return {
            content: `✓ Added ${p.agent_name} (${p.agent_role}) to your team. They'll start on the next agent tick.`,
            success: true,
          };
        }

        // Execute inline for actions that are simple state changes
        if (insight.detector === 'vip_suggestion') {
          const clientIds: string[] = insight.payload?.client_ids ?? [];
          for (const cid of clientIds) {
            try {
              const cp = await getClientProfile(cid);
              if (!cp) continue;
              const newTags = Array.from(new Set([...(cp.tags ?? []), 'VIP']));
              await upsertClientProfile({
                tenantPhone: cleanPhone,
                displayName: cp.display_name,
                phone: cp.phone ?? undefined,
                tags: newTags,
                source: 'owner_defined',
              });
            } catch (err) {
              console.warn('[insight] vip tagging failed for', cid, err);
            }
          }
          await setInsightStatus(insight.id, 'executed');
          return {
            content: `✓ Tagged ${clientIds.length} client${clientIds.length === 1 ? '' : 's'} as VIP: ${(insight.payload?.client_names ?? []).join(', ')}.`,
            success: true,
          };
        }

        // Detectors that need agent-side drafting — surface what's coming
        const draftCount = (insight.payload?.client_names ?? insight.payload?.client_ids ?? []).length || 1;
        const nextStep = insight.detector === 'lapsed_clients'
          ? `Approved. I'll draft re-engagement messages for ${draftCount} client${draftCount === 1 ? '' : 's'} and queue them for your review.`
          : insight.detector === 'inactive_recent'
          ? `Approved. I'll draft light-touch check-in messages for ${draftCount} client${draftCount === 1 ? '' : 's'} and queue them for your review.`
          : insight.detector === 'client_milestone'
          ? `Approved. I'll draft a personalized acknowledgement for ${insight.payload?.client_name ?? 'this client'} and queue it for your review.`
          : `Approved. The responsible agent will pick this up on their next tick.`;
        return { content: nextStep, success: true };
      }

      case 'dismiss_insight': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.insight_id ?? '').trim();
        if (!idIn) return { content: 'Missing insight_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const insight = await getInsightById(idIn, cleanPhone);
        if (!insight) return { content: `No insight matches ${idIn}.`, success: false };
        const ok = await setInsightStatus(insight.id, 'dismissed');
        if (!ok) return { content: 'Could not update the insight.', success: false };
        return { content: `Dismissed "${insight.title.slice(0, 80)}". It won't re-surface.`, success: true };
      }

      case 'enable_email_notifications': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        // Check the owner has an email connected first — saving prefs without
        // a connection would be a setup-trap.
        const hasEmail = connections.some((c) => c.service === 'email');
        if (!hasEmail) {
          return {
            content: "You need to connect an email account first (Yahoo, Gmail, or Outlook) — open the Command Deck's Connections tab. Once connected, ask me again.",
            success: false,
          };
        }
        const ok = await saveEmailPrefs(cleanPhone, {
          enabled: true,
          address: call.input.address ? String(call.input.address) : undefined,
          criticalOnly: !!call.input.critical_only,
        });
        if (!ok) return { content: 'Could not save email preferences.', success: false };
        const address = call.input.address ?? connections.find((c) => c.service === 'email')?.account_email;
        const mode = call.input.critical_only ? 'critical alerts only' : 'all digests';
        return { content: `Email notifications ON for ${address} (${mode}). I'll mirror future digests to your inbox.`, success: true };
      }

      case 'disable_email_notifications': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const ok = await saveEmailPrefs(cleanPhone, { enabled: false });
        if (!ok) return { content: 'Could not save email preferences.', success: false };
        return { content: 'Email notifications OFF. WhatsApp digests continue.', success: true };
      }

      case 'get_email_notification_status': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const prefs = await loadEmailPrefs(cleanPhone);
        if (!prefs.enabled) {
          return { content: 'Email notifications are OFF. Say "email me digests too" to turn them on.', success: true };
        }
        const emailConn = connections.find((c) => c.service === 'email');
        const address = prefs.address || emailConn?.account_email || '(no email connected)';
        const mode = prefs.criticalOnly ? 'critical alerts only' : 'all digests';
        return { content: `Email notifications ON: ${address} (${mode}).`, success: true };
      }

      case 'add_or_update_client_profile': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const displayName = String(call.input.display_name ?? '').trim();
        if (!displayName) return { content: 'Missing display_name.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const verticalLabel = (user.profile as any)?.vertical_template?.label ?? null;
        const id = await upsertClientProfile({
          tenantPhone: cleanPhone,
          displayName,
          phone: call.input.phone ? String(call.input.phone) : undefined,
          email: call.input.email ? String(call.input.email) : undefined,
          preferences: typeof call.input.preferences === 'object' ? call.input.preferences : undefined,
          notes: call.input.notes ? String(call.input.notes) : undefined,
          verticalLabel: verticalLabel ?? undefined,
          source: (call.input.source as any) ?? 'inferred',
          tags: Array.isArray(call.input.tags) ? call.input.tags.map(String) : undefined,
        });
        if (!id) return { content: 'Could not save client profile.', success: false };
        return { content: `Saved. Client profile_id=${id}.`, success: true };
      }

      case 'record_client_visit': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const profileId = String(call.input.client_profile_id ?? '').trim();
        const summary = String(call.input.summary ?? '').trim();
        if (!profileId || !summary) return { content: 'Missing client_profile_id or summary.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const visitId = await recordClientVisit({
          tenantPhone: cleanPhone,
          clientProfileId: profileId,
          summary,
          channel: call.input.channel ? String(call.input.channel) : undefined,
          satisfaction: call.input.satisfaction as any,
          notes: call.input.notes ? String(call.input.notes) : undefined,
          revenueUsd: typeof call.input.revenue_usd === 'number' ? call.input.revenue_usd : undefined,
        });
        if (!visitId) return { content: 'Could not record visit.', success: false };
        return { content: `Visit logged. visit_id=${visitId}.`, success: true };
      }

      case 'lookup_client': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const query = String(call.input.query ?? '').trim();
        if (!query) return { content: 'Missing query.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const results = await lookupClients({ tenantPhone: cleanPhone, query });
        if (results.length === 0) return { content: `No client matches "${query}".`, success: true };
        const lines = results.slice(0, 10).map((c) => {
          const last = c.last_visit_at ? new Date(c.last_visit_at).toISOString().slice(0, 10) : 'never';
          const prefs = Object.keys(c.preferences).length > 0
            ? ` · ${Object.entries(c.preferences).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}`
            : '';
          return `[${c.id.slice(0, 8)}] ${c.display_name} (${c.visit_count} visit${c.visit_count === 1 ? '' : 's'}, last ${last}${prefs})`;
        });
        return { content: `${results.length} match${results.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`, success: true };
      }

      case 'list_my_clients': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const limit = typeof call.input.limit === 'number' ? Math.min(50, call.input.limit) : 20;
        const all = await listClients(cleanPhone, limit);
        if (all.length === 0) return { content: "No client profiles yet. Mention a customer's name during chat and I'll capture them.", success: true };
        const lines = all.map((c) => {
          const last = c.last_visit_at ? new Date(c.last_visit_at).toISOString().slice(0, 10) : 'no visits';
          return `${c.display_name} — ${c.visit_count} visits, last ${last}`;
        });
        return { content: `${all.length} client${all.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
      }

      case 'list_client_history': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const profileId = String(call.input.client_profile_id ?? '').trim();
        if (!profileId) return { content: 'Missing client_profile_id.', success: false };
        const profile = await getClientProfile(profileId);
        if (!profile) return { content: 'Client not found.', success: false };
        const visits = await listClientVisits(profileId);
        if (visits.length === 0) {
          return { content: `${profile.display_name}: no visits logged yet.`, success: true };
        }
        const lines = visits.map((v) => {
          const date = new Date(v.occurred_at).toISOString().slice(0, 10);
          const sat = v.satisfaction ? ` (${v.satisfaction})` : '';
          return `  ${date}: ${v.summary}${sat}`;
        });
        return {
          content: `${profile.display_name} — ${visits.length} visit${visits.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
          success: true,
        };
      }

      case 'issue_deck_login': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        if (!user.isOwner) return { content: 'Only the account owner can request a deck login link.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const token = await signSessionToken(cleanPhone);
        const base = APP_BASE_URL ?? 'https://wisdomworks.vercel.app';
        const link = `${base}/api/auth/deck/redeem?token=${encodeURIComponent(token)}`;
        return {
          content: `Here's your secure deck login link (valid 30 days, do not share):\n\n${link}\n\nTap it to sign in. The link sets a cookie and drops you on the dashboard.`,
          success: true,
        };
      }

      case 'get_channel_link_code': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const channel = String(call.input.channel ?? '').toLowerCase() as Channel;
        if (!['telegram', 'sms', 'imessage', 'discord'].includes(channel)) {
          return { content: `Unsupported channel "${channel}". Try telegram, sms, imessage, or discord.`, success: false };
        }
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const code = await createLinkCode(cleanPhone, channel);
        if (!code) return { content: "Couldn't generate a link code right now.", success: false };
        const channelInstructions: Record<string, string> = {
          telegram:
            `Code: ${code}\n\nTo link Telegram:\n1. Open Telegram and find the WisdomWorks bot (your owner can share the bot link)\n2. Send: /link ${code}\n\nCode expires in 15 minutes.`,
          sms: `Code: ${code}\n\nSMS linking arrives in a later release. Save the code; it's valid for 15 minutes.`,
          imessage: `Code: ${code}\n\niMessage linking arrives in a later release. Save the code; it's valid for 15 minutes.`,
          discord: `Code: ${code}\n\nDiscord linking arrives in a later release. Save the code; it's valid for 15 minutes.`,
        };
        return { content: channelInstructions[channel]!, success: true };
      }

      case 'recall_atoms': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const kindArg = call.input.kind ? String(call.input.kind) as AtomKind : undefined;
        const atoms = await listAllAtoms(cleanPhone, kindArg);
        if (atoms.length === 0) {
          return { content: kindArg ? `Nothing remembered yet under ${kindArg}.` : "I haven't picked up any durable facts yet. Tell me about your business, goals, competitors, preferences, or constraints and I'll remember.", success: true };
        }
        const lines = atoms.slice(0, 25).map((a) => {
          const mark = a.owner_confirmed ? '✓' : '·';
          return `${mark} [${a.id.slice(0, 8)}] ${a.kind}: ${a.content.slice(0, 140)}`;
        });
        return { content: `${atoms.length} remembered${kindArg ? ` (${kindArg})` : ''}:\n${lines.join('\n')}`, success: true };
      }

      case 'confirm_atom': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.atom_id ?? '').trim();
        if (!idIn) return { content: 'Missing atom_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const all = await listAllAtoms(cleanPhone);
        const match = idIn.length === 8 ? all.find((a) => a.id.startsWith(idIn.toLowerCase())) : all.find((a) => a.id === idIn);
        if (!match) return { content: `No atom matches ${idIn}.`, success: false };
        const ok = await confirmAtom(match.id);
        return ok
          ? { content: `Confirmed. "${match.content.slice(0, 80)}" is now locked at high confidence.`, success: true }
          : { content: 'Confirm failed.', success: false };
      }

      case 'archive_atom': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const idIn = String(call.input.atom_id ?? '').trim();
        if (!idIn) return { content: 'Missing atom_id.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const all = await listAllAtoms(cleanPhone);
        const match = idIn.length === 8 ? all.find((a) => a.id.startsWith(idIn.toLowerCase())) : all.find((a) => a.id === idIn);
        if (!match) return { content: `No atom matches ${idIn}.`, success: false };
        const ok = await archiveAtom(match.id);
        return ok
          ? { content: `Archived. Won't surface again.`, success: true }
          : { content: 'Archive failed.', success: false };
      }

      case 'remember_this': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const kind = call.input.kind as AtomKind;
        const content = String(call.input.content ?? '').trim();
        if (!content) return { content: 'Missing content.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const id = await upsertAtom({
          tenantPhone: cleanPhone,
          kind,
          content,
          source: 'owner_confirmed',
          confidence: 1.0,
          ownerConfirmed: true,
          tags: Array.isArray(call.input.tags) ? call.input.tags.map(String) : [],
        });
        return id
          ? { content: `Got it. Every agent will know: "${content.slice(0, 100)}".`, success: true }
          : { content: 'Could not save.', success: false };
      }

      case 'request_research': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const topic = String(call.input.topic ?? '').trim();
        if (!topic) return { content: 'Need a topic to research.', success: false };
        const reason = call.input.reason ? String(call.input.reason) : undefined;
        const kind = (call.input.kind ?? 'general') as ResearchKind;
        const ownerInitiated = call.input.owner_initiated !== false; // tool-called via chat = owner-initiated by default

        const enq = await enqueueResearch({
          tenantPhone: cleanPhone,
          topic,
          reason,
          kind,
          ownerInitiated,
        });
        if (enq.deferred) return { content: `Daily research cap reached. ${enq.reason}`, success: false };
        if (!enq.id) return { content: `Could not queue research: ${enq.reason ?? 'unknown'}`, success: false };

        // For owner-initiated requests, execute immediately so the owner gets
        // the brief in the SAME conversation, not waiting for a tick later.
        if (ownerInitiated) {
          try {
            const { loadPendingResearch, processResearchRequest } = await import('../../_lib/research');
            const pending = await loadPendingResearch(cleanPhone, 5);
            const target = pending.find((p) => p.id === enq.id);
            if (target) {
              // Owner-initiated path: brief is delivered inline as the
              // chat reply, so skip the digest enqueue to avoid double-send.
              const result = await processResearchRequest(target, { skipEnqueue: true });
              if (result.ok && result.brief) {
                const b = result.brief;
                const briefLines = [
                  `Researched: ${topic}`,
                  '',
                  b.summary,
                  '',
                  'Key findings:',
                  ...b.key_findings.slice(0, 6).map((f: string) => `• ${f}`),
                  '',
                  'Recommendations:',
                  ...b.recommendations.map((r: string) => `→ ${r}`),
                  '',
                  `Sources: ${b.sources.slice(0, 3).map((s: any) => s.url).join(', ')}${b.sources.length > 3 ? ` (+${b.sources.length - 3} more)` : ''}`,
                  `Confidence: ${Math.round(b.confidence * 100)}%`,
                  '',
                  `(Saved to your approval queue too.)`,
                ];
                return { content: briefLines.join('\n'), success: true };
              }
              return { content: `Research queued but synthesis failed: ${result.error ?? 'unknown'}. I'll retry on my next tick.`, success: false };
            }
          } catch (err) {
            // Fall through to "queued" message
          }
        }
        return {
          content: `Got it — queued research on "${topic}". I'll run it and surface the brief in your next digest.`,
          success: true,
        };
      }

      case 'list_pending_research': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const pending = await loadPendingResearch(cleanPhone, 10);
        if (pending.length === 0) {
          return { content: "Nothing queued. If you want me to research something, just say 'research X' or 'look up Y'.", success: true };
        }
        const lines = pending.map((p, i) => `${i + 1}. [${p.status}] ${p.topic}${p.requesting_agent_name ? ` (requested by ${p.requesting_agent_name})` : ''}`);
        return { content: `${pending.length} pending research request${pending.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
      }

      case 'list_all_projects': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const allConns = await loadActiveConnections();
        const myConns = allConns.filter((c) => c.tenant_phone === cleanPhone);
        if (myConns.length === 0) {
          return {
            content: "No projects connected yet. Go to the Command Deck, click into an agent (like Alex or Marcus), then 'Connect Project' to wire up a Vercel + GitHub repo.",
            success: true,
          };
        }
        // Look up the agent_name for each connection's agent_config_id
        const SU = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const cfgIds = Array.from(new Set(myConns.map((c) => c.agent_config_id).filter(Boolean))) as string[];
        const cfgNameById = new Map<string, string>();
        if (cfgIds.length > 0 && SU && SK) {
          const cfgRes = await fetch(
            `${SU}/rest/v1/agent_configs?id=in.(${cfgIds.join(',')})&select=id,agent_name`,
            { headers: { apikey: SK, Authorization: `Bearer ${SK}` } },
          );
          if (cfgRes.ok) {
            const cfgs = await cfgRes.json();
            for (const c of cfgs) cfgNameById.set(c.id, c.agent_name);
          }
        }
        const lines = myConns.map((c) => {
          const agent = c.agent_config_id ? cfgNameById.get(c.agent_config_id) ?? 'unassigned' : 'unassigned';
          const sync = c.last_synced_at ? `synced ${new Date(c.last_synced_at).toISOString().slice(0, 16).replace('T', ' ')}` : 'awaiting first sync';
          const err = c.last_sync_error ? ` ⚠ ${c.last_sync_error.slice(0, 80)}` : '';
          return `• ${c.project_name} (${c.provider}) — owned by ${agent} — ${sync}${err}`;
        });
        return {
          content: `${myConns.length} connected project${myConns.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
          success: true,
        };
      }

      // ─── Project discovery tools (Au7o etc.) ───
      case 'get_project_status':
      case 'list_recent_commits':
      case 'list_open_issues':
      case 'read_repo_file':
      case 'list_repo_tree':
      case 'fetch_deployed_page': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const allConns = await loadActiveConnections();
        const tenantConns = allConns.filter((c) => c.tenant_phone === cleanPhone);
        if (tenantConns.length === 0) {
          return { content: 'No projects connected yet. Connect a project from the Command Deck → agent detail → Connect Project.', success: false };
        }

        const projectName = call.input.project_name as string | undefined;
        const conn = projectName
          ? tenantConns.find((c) => c.project_name.toLowerCase() === projectName.toLowerCase())
          : (call.name === 'get_project_status' ? null : tenantConns[0]);

        if (call.name === 'get_project_status' && !projectName) {
          // List all connected projects
          const lines = tenantConns.map((c) => `- ${c.project_name} (${c.provider}, tier ${c.capability_tier}, status=${c.status})`);
          return { content: `${tenantConns.length} connected project${tenantConns.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n\nUse get_project_status with project_name to see details on any one.`, success: true };
        }

        if (!conn) {
          const names = tenantConns.map((c) => c.project_name).join(', ');
          return { content: `No connected project matches "${projectName}". Available: ${names}.`, success: false };
        }

        const { auditedDecrypt } = await import('../../_lib/credential-audit');
        const auditCtx = (subTool: string) => ({
          tenantPhone: cleanPhone,
          connectionType: 'project_connection' as const,
          connectionId: conn!.id,
          caller: `tool:${call.name}`,
          callerContext: `${conn!.project_name} ${subTool}`,
        });

        try {
          if (call.name === 'get_project_status') {
            const snap = await loadLatestSnapshot(conn.id);
            if (!snap) return { content: `${conn.project_name}: connected but no snapshot yet. Run the project-sync cron or wait until the next 2-hour drain.`, success: true };
            const d = snap.snapshot_data ?? {};
            const lines = [
              `${conn.project_name} (${conn.provider})`,
              `Status: ${snap.summary ?? '(no summary)'}`,
              snap.diff_summary ? `Change: ${snap.diff_summary}` : '',
              d.deploy_url ? `Production: ${d.deploy_url}` : '',
              `Last sync: ${snap.taken_at ? new Date(snap.taken_at).toISOString().slice(0, 16).replace('T', ' ') : '?'} UTC`,
              d.recent_errors?.length ? `Recent build errors: ${d.recent_errors.length}` : '',
            ].filter(Boolean);
            return { content: lines.join('\n'), success: true };
          }

          if (call.name === 'list_recent_commits') {
            if (conn.provider !== 'vercel-github') return { content: `Commits aren't available for provider ${conn.provider}.`, success: false };
            const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 30) : 10;
            const gtoken = await auditedDecrypt(conn.credentials.github_token, auditCtx('github'));
            const commits = await fetchGitHubCommits(gtoken, conn.credentials.github_owner, conn.credentials.github_repo, limit, conn.credentials.github_branch);
            if (commits.length === 0) return { content: `${conn.project_name}: no recent commits found.`, success: true };
            const lines = commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]?.slice(0, 100)} (${c.author}, ${c.date.slice(0, 10)})`);
            return { content: `${conn.project_name} — last ${commits.length} commit${commits.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
          }

          if (call.name === 'list_open_issues') {
            if (conn.provider !== 'vercel-github') return { content: `Issues aren't available for provider ${conn.provider}.`, success: false };
            const gtoken = await auditedDecrypt(conn.credentials.github_token, auditCtx('github'));
            const issues = await fetchGitHubIssues(gtoken, conn.credentials.github_owner, conn.credentials.github_repo, 30);
            if (issues.length === 0) return { content: `${conn.project_name}: no open issues or PRs.`, success: true };
            const lines = issues.map((i) => `${i.is_pr ? 'PR' : 'Issue'} #${i.number}: ${i.title}${i.labels.length ? ` [${i.labels.join(', ')}]` : ''}`);
            return { content: `${conn.project_name} — ${issues.length} open:\n${lines.join('\n')}`, success: true };
          }

          if (call.name === 'read_repo_file') {
            if (conn.provider !== 'vercel-github') return { content: `File read isn't available for provider ${conn.provider}.`, success: false };
            const path = String(call.input.path ?? '').trim();
            if (!path) return { content: 'path required.', success: false };
            const gtoken = await auditedDecrypt(conn.credentials.github_token, auditCtx('github'));
            const content = await fetchGitHubFile(gtoken, conn.credentials.github_owner, conn.credentials.github_repo, path, conn.credentials.github_branch);
            if (content === null) return { content: `Could not read ${path} from ${conn.project_name}. Check path + permissions.`, success: false };
            const truncated = content.length > 8000 ? `${content.slice(0, 8000)}\n\n... [truncated, file is ${content.length} chars]` : content;
            return { content: `${conn.project_name}:${path}\n\n${truncated}`, success: true };
          }

          if (call.name === 'list_repo_tree') {
            if (conn.provider !== 'vercel-github') return { content: `Tree listing isn't available for provider ${conn.provider}.`, success: false };
            const path = String(call.input.path ?? '').trim();
            const gtoken = await auditedDecrypt(conn.credentials.github_token, auditCtx('github'));
            const entries = await fetchGitHubTree(gtoken, conn.credentials.github_owner, conn.credentials.github_repo, path, conn.credentials.github_branch);
            if (entries.length === 0) return { content: `${conn.project_name}:${path || '/'} is empty or path not found.`, success: false };
            const lines = entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`);
            return { content: `${conn.project_name}:${path || '/'}\n${lines.join('\n')}`, success: true };
          }

          if (call.name === 'fetch_deployed_page') {
            const path = String(call.input.path ?? '/').trim() || '/';
            const baseUrl = conn.metadata?.deploy_url;
            if (!baseUrl) return { content: `${conn.project_name}: no deploy URL on record.`, success: false };
            const fullUrl = baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
            try {
              const res = await fetch(fullUrl, { redirect: 'follow' });
              const text = await res.text();
              const excerpt = text.slice(0, 4000);
              return {
                content: `${fullUrl} → HTTP ${res.status} (${res.headers.get('content-type') ?? 'unknown'})\n\n${excerpt}${text.length > 4000 ? '\n\n... [truncated]' : ''}`,
                success: res.ok,
              };
            } catch (err: any) {
              return { content: `Fetch failed: ${err?.message ?? err}`, success: false };
            }
          }
        } catch (err: any) {
          return { content: `Project tool error: ${err?.message ?? err}`, success: false };
        }

        return { content: 'Unknown project tool path.', success: false };
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
        if (!APP_BASE_URL) {
          return {
            content: 'Cannot generate a connect link — NEXT_PUBLIC_APP_BASE_URL is not set in Vercel. Admin needs to configure the public app URL.',
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

      case 'list_state_snapshots': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const { listRecentSnapshots } = await import('../../_lib/state-recovery');
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 25) : 10;
        const snaps = await listRecentSnapshots(cleanPhone, limit);
        if (snaps.length === 0) {
          return { content: 'No agent state snapshots yet. They accumulate as agents tick and before destructive actions.', success: true };
        }
        const lines = snaps.map((s, i) => {
          const when = new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const reasonLabel = s.reason === 'pre_action' ? `pre-${s.action_name ?? 'action'}`
            : s.reason === 'shutdown' ? 'shutdown'
            : s.reason === 'manual' ? 'manual'
            : s.reason === 'recovery_test' ? 'chaos-test'
            : 'periodic';
          return `  ${i + 1}. ${when}  [${reasonLabel}]\n     instance: ${s.agent_instance_id.slice(0, 8)} · snap: ${s.id.slice(0, 8)}`;
        });
        return {
          content: `${snaps.length} recent snapshot${snaps.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n\nTo roll back, say "roll back to snap <id>" or "undo that send_email".`,
          success: true,
        };
      }

      case 'check_video_jobs': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 20) : 5;
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supaUrl || !supaKey) return { content: 'Supabase not configured.', success: false };
        try {
          const res = await fetch(
            `${supaUrl}/rest/v1/video_generation_jobs?tenant_phone=eq.${cleanPhone}&order=started_at.desc&limit=${limit}&select=id,prediction_id,model_ref,quality,status,started_at,completed_at,delivered_at,error,video_url,draft_id`,
            { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
          );
          if (!res.ok) {
            // Table missing = migration not run yet
            if (res.status === 404 || res.status === 400) {
              return {
                content: 'video_generation_jobs table not found. The migration db/migrations/2026-05-13c-video-generation-jobs.sql may not have been run in Supabase yet. Without it, generation jobs can\'t be tracked.',
                success: false,
              };
            }
            return { content: `Job fetch failed: ${res.status} ${await res.text()}`, success: false };
          }
          const jobs = await res.json();
          if (jobs.length === 0) {
            return {
              content: 'No video generation jobs in your history. Either no generations have been started, or the generation tool failed to insert the job row (check Vercel logs for [generate_marketing_video] job insert failed).',
              success: true,
            };
          }
          const now = Date.now();
          const lines = jobs.map((j: any, i: number) => {
            const elapsedSec = Math.round((now - new Date(j.started_at).getTime()) / 1000);
            const elapsedLabel = elapsedSec < 90 ? `${elapsedSec}s ago` : `${Math.round(elapsedSec / 60)}m ago`;
            const statusFlag = j.status === 'delivered' ? '✅'
              : j.status === 'succeeded' ? '🟡 (generated, awaiting send)'
              : j.status === 'pending' ? '🔄'
              : j.status === 'timed_out' ? '⏱'
              : '❌';
            const errLine = j.error ? `\n     error: ${String(j.error).slice(0, 160)}` : '';
            const urlLine = j.video_url ? `\n     video: ${j.video_url}` : '';
            const draftLine = j.draft_id ? `\n     draft: ${j.draft_id.slice(0, 8)}` : '';
            return `  ${i + 1}. ${statusFlag} ${j.status} · ${j.quality} · ${elapsedLabel}\n     prediction: ${j.prediction_id.slice(0, 24)} · ${j.model_ref}${draftLine}${urlLine}${errLine}`;
          });
          return {
            content: `${jobs.length} recent video job${jobs.length === 1 ? '' : 's'}:\n${lines.join('\n\n')}\n\nIf jobs are stuck in 🔄 pending more than ~3 minutes, the video-job-poller cron may not be running. Check Vercel cron logs for /api/cron/video-job-poller.`,
            success: true,
          };
        } catch (err: any) {
          return { content: `Job status check failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'recall_recent_documents': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const query = call.input.query ? String(call.input.query).trim().toLowerCase() : '';
        const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 20) : 5;
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supaUrl || !supaKey) return { content: 'Supabase not configured.', success: false };
        try {
          // Pull more than `limit` so we can filter by query, then trim
          const fetchLimit = query ? 25 : limit;
          const res = await fetch(
            `${supaUrl}/rest/v1/received_documents?tenant_phone=eq.${cleanPhone}&status=eq.analyzed&order=analyzed_at.desc&limit=${fetchLimit}&select=id,filename,source,summary,key_dates,key_amounts,key_parties,action_items,risks,tags,analyzed_at`,
            { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
          );
          if (!res.ok) return { content: `Document fetch failed: ${res.status}`, success: false };
          let docs = await res.json();
          if (query) {
            docs = docs.filter((d: any) => {
              const haystack = `${d.filename ?? ''} ${d.summary ?? ''} ${(d.tags ?? []).join(' ')}`.toLowerCase();
              return haystack.includes(query);
            });
          }
          docs = docs.slice(0, limit);
          if (docs.length === 0) {
            return {
              content: query
                ? `No analyzed documents matching "${query}". Try a different search term, or send the document via WhatsApp to add it.`
                : 'No analyzed documents yet. Send a PDF via WhatsApp and I\'ll extract dates, parties, amounts, and risks.',
              success: true,
            };
          }
          const lines = docs.map((d: any, i: number) => {
            const when = new Date(d.analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const tagPart = (d.tags ?? []).length > 0 ? ` · ${(d.tags as string[]).slice(0, 4).join(', ')}` : '';
            const summary = (d.summary ?? '').slice(0, 200);
            const datesPart = (d.key_dates ?? []).length > 0 ? `\n     📅 ${(d.key_dates as any[]).slice(0, 2).map((x) => `${x.when}: ${x.what}`).join(' · ')}` : '';
            const risksPart = (d.risks ?? []).filter((r: any) => r.severity === 'high').length > 0
              ? `\n     ⚠ ${(d.risks as any[]).filter((r: any) => r.severity === 'high').map((r) => r.concern).slice(0, 2).join(' · ')}`
              : '';
            return `  ${i + 1}. ${d.filename ?? `(${d.source})`} — ${when}${tagPart}\n     ${summary}${datesPart}${risksPart}`;
          });
          return {
            content: `${docs.length} document${docs.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}:\n${lines.join('\n\n')}`,
            success: true,
          };
        } catch (err: any) {
          return { content: `Document recall failed: ${err?.message ?? String(err)}`, success: false };
        }
      }

      case 'show_business_type_dictionary': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        // Pull business_type from whatsapp_contexts
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supaUrl || !supaKey) return { content: 'Supabase not configured.', success: false };
        let businessType = '';
        try {
          const res = await fetch(
            `${supaUrl}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=business_type,profile`,
            { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
          );
          if (res.ok) {
            const rows = await res.json();
            businessType = rows[0]?.business_type ?? rows[0]?.profile?.businessType ?? '';
          }
        } catch {}
        if (!businessType) {
          return { content: "I don't have your business_type recorded — tell me what kind of business you run and I'll pull the dictionary.", success: false };
        }
        const { summarizeDictionaryForBusinessType } = await import('../../_lib/cross-tenant-dictionary');
        const summary = await summarizeDictionaryForBusinessType(businessType);
        if (summary.total === 0) {
          return {
            content: `No dictionary entries for "${businessType}" yet — the cross-tenant aggregator promotes skills once ≥3 tenants of the same vertical have used them successfully. Until then, your agents learn from your own corrections only.`,
            success: true,
          };
        }
        const laneSummary = Object.entries(summary.by_lane)
          .map(([lane, n]) => `  ${lane}: ${n}`)
          .join('\n');
        const topLines = summary.top.map((t, i) =>
          `  ${i + 1}. [${t.lane}] ${t.description.slice(0, 140)}\n     ${(t.success_rate * 100).toFixed(0)}% success across ${t.tenant_count} tenants`,
        );
        return {
          content: `📚 Business Type Dictionary — "${businessType}":\n${summary.total} proven techniques across the network.\n\nBy lane:\n${laneSummary}\n\nTop 5 by success rate:\n${topLines.join('\n')}\n\nThese were anonymized + promoted from other "${businessType}" tenants who hit ≥3 deployments + ≥70% pooled success rate. Your agents already inherited the relevant ones.`,
          success: true,
        };
      }

      case 'flag_lesson_learned': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const title = String(call.input.title ?? '').trim();
        const whatWentWrong = String(call.input.what_went_wrong ?? '').trim();
        const correctiveAction = String(call.input.corrective_action ?? '').trim();
        const rawKeywords = Array.isArray(call.input.topic_keywords) ? (call.input.topic_keywords as string[]) : [];
        const topicKeywords = rawKeywords.map((k) => String(k).trim()).filter((k) => k.length >= 3).slice(0, 8);
        const severity = (call.input.severity as 'low' | 'medium' | 'high' | 'critical' | undefined) ?? 'medium';
        if (!title || !whatWentWrong || !correctiveAction || topicKeywords.length === 0) {
          return { content: 'title, what_went_wrong, corrective_action, and at least one topic_keyword are required.', success: false };
        }
        // Signature = lower-cased title squished to dashes — keeps dedup stable
        const signature = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
        const { logLesson } = await import('../../_lib/lessons-learned');
        const id = await logLesson({
          tenantPhone: cleanPhone,
          signature,
          title,
          whatWentWrong,
          correctiveAction,
          topicKeywords,
          severity,
        });
        if (!id) return { content: 'Could not save the lesson.', success: false };
        return {
          content: `✓ Lesson saved [${id.slice(0, 8)}] (${severity}). Future actions matching {${topicKeywords.join(', ')}} will trigger a pre-flight check.`,
          success: true,
        };
      }

      case 'list_lessons_learned': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const limit = typeof call.input.limit === 'number' ? Math.min(call.input.limit, 25) : 10;
        const { listOpenLessons } = await import('../../_lib/lessons-learned');
        const lessons = await listOpenLessons(cleanPhone, limit);
        if (lessons.length === 0) {
          return { content: 'No open lessons. Tell me "remember not to X" and I\'ll capture one.', success: true };
        }
        const lines = lessons.map((l, i) => {
          const flag = l.severity === 'critical' ? '🚨' : l.severity === 'high' ? '⚠' : '·';
          const stats = `consulted ${l.consult_count}×, applied ${l.apply_count}×`;
          return `  ${i + 1}. ${flag} [${l.id.slice(0, 8)}] ${l.title}\n     Avoid: ${l.what_went_wrong.slice(0, 140)}\n     Do: ${l.corrective_action.slice(0, 140)}\n     ${stats}`;
        });
        return { content: `${lessons.length} open lesson${lessons.length === 1 ? '' : 's'}:\n${lines.join('\n')}`, success: true };
      }

      case 'resolve_lesson_learned': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const rawId = String(call.input.lesson_id ?? '').trim();
        if (!rawId) return { content: 'lesson_id required.', success: false };
        const { listOpenLessons, markLessonResolved } = await import('../../_lib/lessons-learned');
        let fullId = rawId;
        if (rawId.length < 36) {
          const open = await listOpenLessons(cleanPhone, 100);
          const match = open.find((l) => l.id.startsWith(rawId));
          if (!match) return { content: `No open lesson matching id "${rawId}".`, success: false };
          fullId = match.id;
        }
        const ok = await markLessonResolved(fullId);
        return ok
          ? { content: `✓ Lesson resolved — agents will stop applying this rule.`, success: true }
          : { content: 'Could not resolve the lesson.', success: false };
      }

      case 'set_professional_context': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const facts = Array.isArray(call.input.facts) ? (call.input.facts as string[]) : [];
        const cleaned = facts.map((f) => String(f).trim()).filter((f) => f.length >= 3 && f.length <= 600).slice(0, 10);
        if (cleaned.length === 0) return { content: 'No usable facts provided. Pass 1-10 short sentences.', success: false };
        let stored = 0;
        for (const f of cleaned) {
          try {
            const id = await upsertAtom({
              tenantPhone: cleanPhone,
              kind: 'fact',
              content: f,
              tags: ['professional_context', 'classifier_hint'],
              confidence: 0.95, // owner-typed = high confidence
              source: 'whatsapp',
              ownerConfirmed: true,
            });
            if (id) stored++;
          } catch (err) {
            console.warn('[set_professional_context] upsertAtom failed:', err);
          }
        }
        return {
          content: `✓ Captured ${stored} professional context fact${stored === 1 ? '' : 's'}. Every agent — including the email classifier — now sees this in their prompt. Update anytime by saying "I also do X" or "my focus shifted to Y".`,
          success: stored > 0,
        };
      }

      case 'get_classifier_accuracy': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const { computeAccuracy } = await import('../../_lib/classification-learning');
        const report = await computeAccuracy(cleanPhone);
        if (!report) return { content: 'Could not compute accuracy.', success: false };
        const w30 = report.thirtyDay;
        const w90 = report.ninetyDay;
        const fmt = (w: typeof w30) => {
          if (w.samples === 0) return `${w.windowDays}d: no data yet`;
          if (w.accuracy === null) return `${w.windowDays}d: ${w.samples} samples, ${w.corrections} corrections`;
          const flag = w.onTrack ? '✓' : '⚠';
          return `${w.windowDays}d: ${flag} ${(w.accuracy * 100).toFixed(1)}% (${w.samples} samples, ${w.corrections} corrections) · target ${(w.target * 100).toFixed(0)}%`;
        };
        return {
          content: `📊 Email classifier accuracy:\n  ${fmt(w30)}\n  ${fmt(w90)}\n\n${(w30.onTrack && w90.onTrack) ? "On target. The classifier is learning from your corrections." : "Below target — more corrections from you will pull this up. Tell me when I miscategorize an email."}`,
          success: true,
        };
      }

      case 'rollback_agent_state': {
        if (!user) return { content: 'Internal: user context required.', success: false };
        const instanceId = String(call.input.agent_instance_id ?? '').trim();
        if (!instanceId) return { content: 'agent_instance_id required.', success: false };
        const pointInTime = call.input.point_in_time ? new Date(String(call.input.point_in_time)) : undefined;
        const { recoverFromSnapshot } = await import('../../_lib/state-recovery');
        const result = await recoverFromSnapshot(instanceId, pointInTime);
        if (!result.ok) {
          return { content: `Rollback failed: ${result.error}`, success: false };
        }
        return {
          content: `✓ Rolled back to snapshot ${result.recoveredSnapshotId?.slice(0, 8) ?? '?'} (from ${result.recoveredAt ?? '?'}) in ${result.durationMs}ms. Your prior state was preserved as snapshot ${result.preRecoverSnapshotId?.slice(0, 8) ?? '?'} — say "roll back to ${result.preRecoverSnapshotId?.slice(0, 8) ?? 'X'}" to undo this rollback if it was wrong.`,
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
