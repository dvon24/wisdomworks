/**
 * Remote Command Parser — takes natural language from SMS/email
 * and converts it to actionable commands.
 *
 * Examples:
 *   "status" → { type: 'status', scope: 'sprint' }
 *   "deploy to vercel" → { type: 'deploy', target: 'vercel', requiresConfirmation: true }
 *   "what's the test count" → { type: 'status', scope: 'tests' }
 *   "create a story for the about page" → { type: 'create', target: 'story', details: 'about page' }
 */

export type CommandType = 'status' | 'deploy' | 'create' | 'run' | 'query' | 'update' | 'unknown';
export type CommandScope = 'read' | 'write' | 'deploy';

export interface ParsedCommand {
  type: CommandType;
  scope: CommandScope;
  target?: string;
  details?: string;
  requiresConfirmation: boolean;
  rawInput: string;
}

const COMMAND_PATTERNS: { pattern: RegExp; type: CommandType; scope: CommandScope; confirm: boolean }[] = [
  // Run commands FIRST (more specific than status)
  { pattern: /^(run|execute) (tests|build|lint)/i, type: 'run', scope: 'write', confirm: false },
  { pattern: /^run code review/i, type: 'run', scope: 'write', confirm: false },

  // Create/modify
  { pattern: /create (a )?story/i, type: 'create', scope: 'write', confirm: false },
  { pattern: /create (a )?task/i, type: 'create', scope: 'write', confirm: false },
  { pattern: /(update|change|modify|edit) (the|a|my|this)/i, type: 'update', scope: 'write', confirm: false },

  // Status queries (read-only)
  { pattern: /^(status|sprint status|what'?s the status|how'?s it going|update me)/i, type: 'status', scope: 'read', confirm: false },
  { pattern: /(test count|how many tests|test results)/i, type: 'status', scope: 'read', confirm: false },
  { pattern: /(what'?s deployed|deployment status|vercel status)/i, type: 'status', scope: 'read', confirm: false },
  { pattern: /(show|list|get) (stories|epics|tasks|agents)/i, type: 'query', scope: 'read', confirm: false },

  // Deploy (requires confirmation — high impact)
  { pattern: /deploy/i, type: 'deploy', scope: 'deploy', confirm: true },
  { pattern: /push to (prod|production|main|vercel)/i, type: 'deploy', scope: 'deploy', confirm: true },
  { pattern: /go live/i, type: 'deploy', scope: 'deploy', confirm: true },

  // Destructive (requires confirmation)
  { pattern: /(delete|remove|drop|reset)/i, type: 'update', scope: 'deploy', confirm: true },
];

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  for (const { pattern, type, scope, confirm } of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        type,
        scope,
        target: extractTarget(trimmed),
        details: trimmed,
        requiresConfirmation: confirm,
        rawInput: trimmed,
      };
    }
  }

  return {
    type: 'unknown',
    scope: 'read',
    details: trimmed,
    requiresConfirmation: false,
    rawInput: trimmed,
  };
}

function extractTarget(input: string): string {
  const targetMatch = input.match(/(?:to|for|on|the)\s+(.+?)(?:\s*$|\.)/i);
  return targetMatch?.[1] ?? input;
}

/**
 * Check if a command from a given source is authorized.
 */
export function isAuthorized(
  source: { type: 'sms' | 'email' | 'whatsapp'; identifier: string },
  registeredSources: { type: string; identifier: string }[],
): boolean {
  return registeredSources.some(
    (s) => s.type === source.type && s.identifier.toLowerCase() === source.identifier.toLowerCase(),
  );
}
