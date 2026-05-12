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
import { squareAdapter } from '../../_lib/booking-adapters/square';
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

// ─── Booking-system connections ──────────────────────────────────────────

const TOOL_CONNECT_BOOKING_SYSTEM: AnthropicTool = {
  name: 'connect_booking_system',
  description:
    "Generate a one-tap link to connect a booking system (Square Appointments first; Mindbody/Calendly/etc. later). Use when owner says 'connect Square', 'I use Square for bookings', 'pull my client list from <booking system>', or any time the owner mentions they already have a booking platform. Returns the secure OAuth URL — when they tap it, we pull their entire customer list into client_profiles automatically.",
  input_schema: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['square'],
        description: 'Which booking system to connect. Today only square is wired up.',
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
        if (provider !== 'square') {
          return { content: `${provider} isn't wired up yet. Square Appointments is the first booking integration; more land soon.`, success: false };
        }
        if (!process.env.SQUARE_APP_ID) {
          return { content: 'Square integration not configured yet (admin needs to set SQUARE_APP_ID).', success: false };
        }
        const base = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
        const cleanPhone = user.phoneNumber.replace(/[\s\-+()]/g, '');
        const link = `${base}/api/oauth/square?phone=${encodeURIComponent(cleanPhone)}`;
        return {
          content: `Tap to connect Square:\n\n${link}\n\nAfter you approve, I'll pull your entire customer list into your client profiles automatically. Your existing scheduling stays in Square — we just sync the customer roster + visit history so your team can act on it.`,
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
        for (const conn of conns) {
          if (conn.provider !== 'square') continue;
          const res = await syncCustomersFromConnection(conn, squareAdapter);
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
        const base = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
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
