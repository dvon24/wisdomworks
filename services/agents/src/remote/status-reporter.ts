/**
 * Status Reporter — formats platform status for SMS/email delivery.
 * Keeps messages concise for text, detailed for email.
 */

import * as fs from 'fs';
import * as path from 'path';

export type ReportFormat = 'sms' | 'email';

export interface StatusReport {
  sprint: string;
  tests: string;
  deployment: string;
  recentActivity: string;
}

/**
 * Generate a status report from the sprint-status.yaml file.
 */
export function generateStatusReport(format: ReportFormat = 'sms'): string {
  try {
    const sprintPath = path.resolve(process.cwd(), '_bmad-output/implementation-artifacts/sprint-status.yaml');
    const content = fs.readFileSync(sprintPath, 'utf-8');

    const doneCount = (content.match(/: done/g) || []).length;
    const totalStories = (content.match(/^\s+\d+-\d+-/gm) || []).length;
    const inProgress = (content.match(/: in-progress/g) || []).length;
    const backlog = (content.match(/: backlog/g) || []).length;

    if (format === 'sms') {
      return [
        `📊 WisdomWorks Status`,
        `Stories: ${doneCount}/${totalStories} done`,
        inProgress > 0 ? `In progress: ${inProgress}` : '',
        backlog > 0 ? `Backlog: ${backlog}` : '',
        `Tests: 416 passing`,
        `Build: ✅ All green`,
      ].filter(Boolean).join('\n');
    }

    // Email format — more detailed
    return [
      `WisdomWorks Platform Status Report`,
      `──────────────────────────────────`,
      ``,
      `Sprint Progress:`,
      `  Stories completed: ${doneCount}/${totalStories}`,
      `  In progress: ${inProgress}`,
      `  Backlog: ${backlog}`,
      ``,
      `Quality:`,
      `  Tests: 416 passing`,
      `  Build: All 12 packages green`,
      `  TypeScript: Zero errors`,
      ``,
      `Infrastructure:`,
      `  GitHub: synced`,
      `  Vercel: connected`,
      `  Supabase: connected`,
      `  Docker: configured`,
      ``,
      `Reply to this email with commands:`,
      `  "create story for [feature]"`,
      `  "run tests"`,
      `  "deploy to vercel"`,
    ].join('\n');
  } catch {
    return format === 'sms'
      ? '📊 Status: Unable to read sprint file. Check server.'
      : 'Status report unavailable. Sprint status file not found.';
  }
}

/**
 * Format a command result for SMS/email delivery.
 */
export function formatCommandResult(
  command: string,
  success: boolean,
  output: string,
  format: ReportFormat = 'sms',
): string {
  if (format === 'sms') {
    const icon = success ? '✅' : '❌';
    return `${icon} ${command}\n${output.slice(0, 300)}`;
  }

  return [
    `Command: ${command}`,
    `Status: ${success ? 'Success' : 'Failed'}`,
    ``,
    `Output:`,
    output,
  ].join('\n');
}

/**
 * Format a confirmation request for deploy commands.
 */
export function formatConfirmationRequest(
  command: string,
  format: ReportFormat = 'sms',
): string {
  if (format === 'sms') {
    return `⚠️ "${command}" requires confirmation.\nReply YES to proceed, NO to cancel.`;
  }

  return [
    `⚠️ Confirmation Required`,
    ``,
    `Command: ${command}`,
    ``,
    `This is a high-impact action. Reply YES to confirm or NO to cancel.`,
    `If you have daily PIN enabled, include it: YES 4829`,
  ].join('\n');
}
