/**
 * Slack integration — post messages, list channels, react to mentions.
 *
 * Uses Slack Web API with bot tokens. OAuth flow not implemented yet — for
 * launch, customers paste their Bot User OAuth Token from a Slack app they
 * create at api.slack.com/apps (or we provide a "WisdomWorks for Slack" app
 * they install).
 *
 * Docs: https://api.slack.com/methods
 */

import type { IntegrationContext, IntegrationResult } from './types';

const SLACK_API = 'https://slack.com/api';

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  num_members?: number;
}

export interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  channel?: string;
  thread_ts?: string;
}

export interface PostMessageRequest {
  channel: string; // channel ID or #name
  text: string;
  threadTs?: string;
  /** Slack Block Kit blocks for rich formatting */
  blocks?: any[];
}

async function slackPost(token: string, method: string, body: any): Promise<any> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function slackGet(token: string, method: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** List channels the bot has been added to */
export async function listChannels(ctx: IntegrationContext): Promise<IntegrationResult<SlackChannel[]>> {
  try {
    const data = await slackGet(ctx.accessToken, 'conversations.list', {
      types: 'public_channel,private_channel',
      limit: '100',
    });
    if (!data.ok) return { success: false, error: data.error ?? 'Slack API error' };
    return {
      success: true,
      data: (data.channels ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private,
        num_members: c.num_members,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Post a message to a Slack channel */
export async function postMessage(
  ctx: IntegrationContext,
  req: PostMessageRequest,
): Promise<IntegrationResult<{ ts: string }>> {
  try {
    const body: any = { channel: req.channel, text: req.text };
    if (req.threadTs) body.thread_ts = req.threadTs;
    if (req.blocks) body.blocks = req.blocks;

    const data = await slackPost(ctx.accessToken, 'chat.postMessage', body);
    if (!data.ok) return { success: false, error: data.error ?? 'Post failed' };
    return { success: true, data: { ts: data.ts } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Get recent messages from a channel */
export async function listMessages(
  ctx: IntegrationContext,
  channel: string,
  limit: number = 25,
): Promise<IntegrationResult<SlackMessage[]>> {
  try {
    const data = await slackGet(ctx.accessToken, 'conversations.history', {
      channel,
      limit: String(limit),
    });
    if (!data.ok) return { success: false, error: data.error ?? 'History fetch failed' };
    return {
      success: true,
      data: (data.messages ?? []).map((m: any) => ({
        ts: m.ts,
        text: m.text ?? '',
        user: m.user,
        channel,
        thread_ts: m.thread_ts,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Search messages — useful for "did anyone ask about X recently?" */
export async function searchMessages(
  ctx: IntegrationContext,
  query: string,
): Promise<IntegrationResult<SlackMessage[]>> {
  try {
    const data = await slackGet(ctx.accessToken, 'search.messages', { query });
    if (!data.ok) return { success: false, error: data.error ?? 'Search failed' };
    return {
      success: true,
      data: (data.messages?.matches ?? []).map((m: any) => ({
        ts: m.ts,
        text: m.text,
        user: m.user,
        channel: m.channel?.id,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
