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
