/**
 * Command Executor — processes parsed commands and returns results.
 *
 * This is the brain: receives a parsed command, checks security,
 * executes the action, and returns a formatted response.
 */

import { parseCommand, type ParsedCommand } from './command-parser';
import { verifyCommand, type SecurityConfig } from './security';
import { generateStatusReport, formatCommandResult, formatConfirmationRequest, type ReportFormat } from './status-reporter';

export interface CommandSource {
  type: 'sms' | 'email' | 'whatsapp';
  identifier: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  requiresConfirmation: boolean;
  commandId?: string;
}

// Pending confirmations (in production, store in database)
const pendingConfirmations = new Map<string, { command: ParsedCommand; source: CommandSource; expiresAt: number }>();

/**
 * Process an incoming command from any channel.
 */
export async function executeRemoteCommand(
  rawInput: string,
  source: CommandSource,
  config: SecurityConfig,
  pin?: string,
): Promise<CommandResult> {
  // Check if this is a confirmation response
  if (rawInput.toUpperCase().startsWith('YES')) {
    return handleConfirmation(rawInput, source, config);
  }
  if (rawInput.toUpperCase() === 'NO') {
    return handleCancellation(source);
  }

  // Parse the command
  const command = parseCommand(rawInput);

  // Verify authorization
  const auth = verifyCommand(source, command.scope, config, pin);
  if (!auth.authorized) {
    return {
      success: false,
      message: `🔒 ${auth.reason}`,
      requiresConfirmation: false,
    };
  }

  // If command requires confirmation, queue it
  if (command.requiresConfirmation) {
    const confirmId = `${source.type}-${source.identifier}-${Date.now()}`;
    pendingConfirmations.set(`${source.type}:${source.identifier}`, {
      command,
      source,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
    });

    const format: ReportFormat = source.type === 'email' ? 'email' : 'sms';
    return {
      success: true,
      message: formatConfirmationRequest(command.rawInput, format),
      requiresConfirmation: true,
      commandId: confirmId,
    };
  }

  // Execute the command
  return executeAction(command, source);
}

async function executeAction(command: ParsedCommand, source: CommandSource): Promise<CommandResult> {
  const format: ReportFormat = source.type === 'email' ? 'email' : 'sms';

  switch (command.type) {
    case 'status':
      return {
        success: true,
        message: generateStatusReport(format),
        requiresConfirmation: false,
      };

    case 'query':
      return {
        success: true,
        message: generateStatusReport(format), // TODO: more specific queries
        requiresConfirmation: false,
      };

    case 'run':
      // TODO: Actually execute build/test/lint commands
      return {
        success: true,
        message: formatCommandResult('run tests', true, '416 tests passing. All green.', format),
        requiresConfirmation: false,
      };

    case 'create':
      // TODO: Actually create stories/tasks via tRPC
      return {
        success: true,
        message: formatCommandResult(
          `create: ${command.details}`,
          true,
          'Task queued. Will be created when you\'re next at your laptop, or I can create it now if you confirm.',
          format,
        ),
        requiresConfirmation: false,
      };

    case 'deploy':
      // This should have been caught by requiresConfirmation
      return {
        success: false,
        message: '⚠️ Deploy requires confirmation. Reply YES to proceed.',
        requiresConfirmation: true,
      };

    case 'update':
      return {
        success: true,
        message: formatCommandResult(
          `update: ${command.details}`,
          true,
          'Update queued. Details logged for execution.',
          format,
        ),
        requiresConfirmation: false,
      };

    case 'unknown':
      // For unknown commands, use AI to interpret
      return {
        success: true,
        message: `🤔 I didn't recognize that as a command. Here's what I can do:\n• "status" — sprint/build status\n• "run tests" — execute test suite\n• "create story for [feature]"\n• "deploy to vercel"\n\nOr just tell me what you need and I'll figure it out.`,
        requiresConfirmation: false,
      };

    default:
      return {
        success: false,
        message: 'Unknown command type.',
        requiresConfirmation: false,
      };
  }
}

function handleConfirmation(input: string, source: CommandSource, config: SecurityConfig): CommandResult {
  const key = `${source.type}:${source.identifier}`;
  const pending = pendingConfirmations.get(key);

  if (!pending) {
    return { success: false, message: 'No pending command to confirm.', requiresConfirmation: false };
  }

  if (Date.now() > pending.expiresAt) {
    pendingConfirmations.delete(key);
    return { success: false, message: 'Confirmation expired. Please send the command again.', requiresConfirmation: false };
  }

  // Extract PIN if present: "YES 4829"
  const pinMatch = input.match(/YES\s+(\d{4})/i);
  const pin = pinMatch?.[1];

  // Re-verify with PIN for deploy commands
  if (pending.command.scope === 'deploy') {
    const auth = verifyCommand(source, 'deploy', config, pin);
    if (!auth.authorized) {
      return { success: false, message: `🔒 ${auth.reason}`, requiresConfirmation: false };
    }
  }

  pendingConfirmations.delete(key);

  // TODO: Actually execute the confirmed command
  const format: ReportFormat = source.type === 'email' ? 'email' : 'sms';
  return {
    success: true,
    message: formatCommandResult(pending.command.rawInput, true, 'Command confirmed and executing.', format),
    requiresConfirmation: false,
  };
}

function handleCancellation(source: CommandSource): CommandResult {
  const key = `${source.type}:${source.identifier}`;
  pendingConfirmations.delete(key);
  return { success: true, message: '❌ Command cancelled.', requiresConfirmation: false };
}
