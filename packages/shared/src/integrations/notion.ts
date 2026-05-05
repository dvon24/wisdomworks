/**
 * Notion integration — read pages and databases, create pages, update content.
 *
 * Uses Notion's REST API with internal integration tokens.
 * Docs: https://developers.notion.com/reference/intro
 */

import type { IntegrationContext, IntegrationResult } from './types';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  parentDatabaseId?: string;
  parentPageId?: string;
  createdAt: string;
  updatedAt: string;
  /** Plain text content extracted from blocks */
  content?: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  properties: Record<string, { type: string; name: string }>;
}

async function notionFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<any> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return res.json();
}

/** Search across pages and databases the integration has access to */
export async function search(
  ctx: IntegrationContext,
  query: string,
): Promise<IntegrationResult<(NotionPage | NotionDatabase)[]>> {
  try {
    const data = await notionFetch(ctx.accessToken, '/search', {
      method: 'POST',
      body: JSON.stringify({ query, page_size: 25 }),
    });
    if (!data.results) return { success: false, error: data.message ?? 'Search failed' };

    const results: (NotionPage | NotionDatabase)[] = data.results.map((item: any) => {
      if (item.object === 'database') {
        return {
          id: item.id,
          title: item.title?.[0]?.plain_text ?? '(untitled)',
          url: item.url,
          properties: Object.fromEntries(
            Object.entries(item.properties ?? {}).map(([name, prop]: [string, any]) => [
              name,
              { type: prop.type, name },
            ]),
          ),
        } as NotionDatabase;
      }
      return {
        id: item.id,
        title: extractTitle(item),
        url: item.url,
        parentDatabaseId: item.parent?.database_id,
        parentPageId: item.parent?.page_id,
        createdAt: item.created_time,
        updatedAt: item.last_edited_time,
      } as NotionPage;
    });

    return { success: true, data: results };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Get the contents of a page (blocks → plain text) */
export async function getPageContent(
  ctx: IntegrationContext,
  pageId: string,
): Promise<IntegrationResult<NotionPage>> {
  try {
    const [page, blocks] = await Promise.all([
      notionFetch(ctx.accessToken, `/pages/${pageId}`),
      notionFetch(ctx.accessToken, `/blocks/${pageId}/children?page_size=100`),
    ]);
    if (!page.id) return { success: false, error: 'Page not found' };

    const content = (blocks.results ?? [])
      .map((b: any) => extractBlockText(b))
      .filter(Boolean)
      .join('\n');

    return {
      success: true,
      data: {
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        parentDatabaseId: page.parent?.database_id,
        parentPageId: page.parent?.page_id,
        createdAt: page.created_time,
        updatedAt: page.last_edited_time,
        content,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Create a new page in a database or as a child of another page */
export async function createPage(
  ctx: IntegrationContext,
  options: {
    parentDatabaseId?: string;
    parentPageId?: string;
    title: string;
    content?: string;
    /** Database property values keyed by property name */
    properties?: Record<string, any>;
  },
): Promise<IntegrationResult<NotionPage>> {
  try {
    const parent = options.parentDatabaseId
      ? { database_id: options.parentDatabaseId }
      : { page_id: options.parentPageId! };

    const body: any = {
      parent,
      properties: options.parentDatabaseId
        ? {
            // For databases, title goes in the title property (often "Name")
            ...(options.properties ?? {}),
            title: { title: [{ text: { content: options.title } }] },
          }
        : { title: { title: [{ text: { content: options.title } }] } },
    };

    if (options.content) {
      body.children = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: options.content } }] },
        },
      ];
    }

    const data = await notionFetch(ctx.accessToken, '/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!data.id) return { success: false, error: data.message ?? 'Create failed' };

    return {
      success: true,
      data: {
        id: data.id,
        title: options.title,
        url: data.url,
        parentDatabaseId: options.parentDatabaseId,
        parentPageId: options.parentPageId,
        createdAt: data.created_time,
        updatedAt: data.last_edited_time,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Append content blocks to an existing page */
export async function appendBlocks(
  ctx: IntegrationContext,
  pageId: string,
  text: string,
): Promise<IntegrationResult<void>> {
  try {
    // Split on blank lines into paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const children = paragraphs.map((p) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: p } }] },
    }));

    const data = await notionFetch(ctx.accessToken, `/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    });
    if (data.message && !data.results) return { success: false, error: data.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Helpers ───

function extractTitle(item: any): string {
  if (item.title?.[0]?.plain_text) return item.title[0].plain_text;
  // Page in a database: title lives in properties
  for (const [, prop] of Object.entries(item.properties ?? {})) {
    if ((prop as any).type === 'title' && (prop as any).title?.[0]?.plain_text) {
      return (prop as any).title[0].plain_text;
    }
  }
  return '(untitled)';
}

function extractBlockText(block: any): string {
  const type = block.type;
  if (!type) return '';
  const data = block[type];
  if (!data) return '';

  if (data.rich_text) {
    return data.rich_text.map((t: any) => t.plain_text ?? '').join('');
  }
  if (type === 'image' && data.caption) {
    return '[image] ' + data.caption.map((t: any) => t.plain_text ?? '').join('');
  }
  return '';
}
