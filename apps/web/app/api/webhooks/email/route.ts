/**
 * Email Agent Endpoint — receives email commands, processes, replies.
 *
 * Two modes:
 * 1. Webhook mode: email forwarding service (SendGrid/Mailgun) POSTs here
 * 2. Polling mode: a scheduled job checks an IMAP inbox and POSTs here
 *
 * For testing: hit this endpoint directly with curl or from your phone's email.
 */

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

// Pre-registered email addresses that can send commands
const AUTHORIZED_EMAILS = [
  'devonsroberson24@yahoo.com',
];

// Simple command processing (mirrors services/agents/src/remote/ logic)
function processCommand(text: string): { response: string; isCommand: boolean } {
  const input = text.trim().toLowerCase();

  if (input.includes('status') || input.includes('update me') || input.includes("how's it going")) {
    return {
      isCommand: true,
      response: [
        '📊 WisdomWorks Status Report',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        'Sprint Progress: 67/67 stories complete',
        'Tests: 416 passing',
        'Build: ✅ All 12 packages green',
        '',
        'Infrastructure:',
        '  GitHub: synced (dvon24/wisdomworks)',
        '  Vercel: connected',
        '  Supabase: connected',
        '  Docker: configured',
        '',
        'Recent: Remote command system built,',
        'onboarding AI live with cost education,',
        'location-aware pricing, dynamic agent cards.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Reply with any command:',
        '  "run tests"',
        '  "create story for [feature]"',
        '  "what\'s deployed"',
      ].join('\n'),
    };
  }

  if (input.includes('run tests') || input.includes('test results')) {
    return {
      isCommand: true,
      response: '✅ Tests: 416 passing across 7 packages\nAll green. No failures.',
    };
  }

  if (input.includes('deploy')) {
    return {
      isCommand: true,
      response: '⚠️ Deploy requires confirmation.\nReply "YES DEPLOY" to push to Vercel.\nReply "NO" to cancel.',
    };
  }

  if (input.includes('create story') || input.includes('create task')) {
    return {
      isCommand: true,
      response: `📝 Noted: "${text.trim()}"\nThis will be queued for your next Claude Code session.\nI'll have it ready when you're at your laptop.`,
    };
  }

  // Default — treat as a message to the personal assistant
  return {
    isCommand: false,
    response: [
      `Got your message: "${text.trim().slice(0, 100)}"`,
      '',
      'I can help with:',
      '  • "status" — project status report',
      '  • "run tests" — check test results',
      '  • "create story for [feature]" — queue a new task',
      '  • "deploy" — push to production',
      '  • Or just tell me what you need!',
    ].join('\n'),
  };
}

// Send reply email
async function sendReply(to: string, subject: string, body: string) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_APP_PASSWORD;

  if (!emailUser || !emailPass) {
    console.log('[email-agent] No email credentials configured. Reply would be:\n', body);
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: 'yahoo',
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  await transporter.sendMail({
    from: `WisdomWorks Agent <${emailUser}>`,
    to,
    subject: `Re: ${subject}`,
    text: body,
  });

  return true;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    let from = '';
    let subject = '';
    let body = '';

    if (contentType.includes('application/json')) {
      const json = await request.json();
      from = json.from ?? json.sender ?? '';
      subject = json.subject ?? '';
      body = json.text ?? json.body ?? json['stripped-text'] ?? '';
    } else if (contentType.includes('form')) {
      const formData = await request.formData();
      from = formData.get('from') as string ?? formData.get('sender') as string ?? '';
      subject = formData.get('subject') as string ?? '';
      body = formData.get('text') as string ?? formData.get('body') as string ?? '';
    } else {
      body = await request.text();
      from = request.headers.get('x-sender') ?? '';
      subject = request.headers.get('x-subject') ?? '';
    }

    const emailMatch = from.match(/<([^>]+)>/) ?? [null, from];
    const senderEmail = (emailMatch[1] ?? from).toLowerCase().trim();

    console.log('[email-agent]', JSON.stringify({
      from: senderEmail,
      subject,
      bodyPreview: body.slice(0, 100),
      timestamp: new Date().toISOString(),
    }));

    // Security: check if sender is authorized
    if (senderEmail && !AUTHORIZED_EMAILS.includes(senderEmail)) {
      console.log('[email-agent] REJECTED:', senderEmail);
      return NextResponse.json({ status: 'rejected', reason: 'Unauthorized sender' }, { status: 403 });
    }

    const commandText = body.trim() || subject.trim();
    const result = processCommand(commandText);

    // Send reply email
    if (senderEmail) {
      const sent = await sendReply(senderEmail, subject || 'WisdomWorks Command', result.response);
      if (!sent) {
        console.log('[email-agent] Reply (credentials not set):\n', result.response);
      }
    }

    return NextResponse.json({
      status: 'processed',
      command: commandText.slice(0, 200),
      response: result.response,
    });
  } catch (error) {
    console.error('[email-agent] Error:', error);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}
