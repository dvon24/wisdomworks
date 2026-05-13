/**
 * Meta Business (Instagram + Facebook) adapter — read/write helpers.
 *
 * OAuth flow is already wired in apps/website/api/oauth/meta. This
 * module provides the runtime read/write operations agents call.
 *
 * Stored on oauth_connections:
 *   provider='meta', service='instagram'
 *   access_token = page access token (used for Instagram Graph API)
 *   metadata.instagram_account_id = the IG Business Account ID
 *   metadata.page_id = the Facebook Page id
 *   metadata.user_access_token = fallback user token for some endpoints
 *
 * Key endpoints used:
 *   - GET /{ig-user-id}/media → list recent posts
 *   - GET /{ig-media-id}/comments → comments on a post
 *   - POST /{ig-media-id}/comments → reply to a comment
 *   - POST /{ig-user-id}/media + /{ig-user-id}/media_publish → publish a post
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export interface InstagramPost {
  id: string;
  caption?: string;
  permalink?: string;
  mediaUrl?: string;
  mediaType?: string;
  timestamp?: string;
  likeCount?: number;
  commentsCount?: number;
}

export interface InstagramComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  /** Number of replies + likes for sorting */
  likeCount?: number;
}

export async function listInstagramPosts(input: {
  accessToken: string;
  igAccountId: string;
  limit?: number;
}): Promise<InstagramPost[]> {
  try {
    const fields = 'id,caption,permalink,media_url,media_type,timestamp,like_count,comments_count';
    const url = `${GRAPH_API}/${input.igAccountId}/media?fields=${fields}&limit=${input.limit ?? 12}&access_token=${input.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[meta] listPosts failed:', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return (data.data ?? []).map((p: any) => ({
      id: p.id,
      caption: p.caption,
      permalink: p.permalink,
      mediaUrl: p.media_url,
      mediaType: p.media_type,
      timestamp: p.timestamp,
      likeCount: p.like_count,
      commentsCount: p.comments_count,
    }));
  } catch (err) {
    console.warn('[meta] listPosts exception:', err);
    return [];
  }
}

export async function listInstagramComments(input: {
  accessToken: string;
  igMediaId: string;
}): Promise<InstagramComment[]> {
  try {
    const fields = 'id,text,username,timestamp,like_count';
    const url = `${GRAPH_API}/${input.igMediaId}/comments?fields=${fields}&access_token=${input.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? []).map((c: any) => ({
      id: c.id,
      text: c.text,
      username: c.username,
      timestamp: c.timestamp,
      likeCount: c.like_count,
    }));
  } catch {
    return [];
  }
}

/** Reply to a specific Instagram comment. Requires
 *  instagram_business_manage_comments scope. */
export async function replyToInstagramComment(input: {
  accessToken: string;
  igMediaId: string;
  parentCommentId: string;
  message: string;
}): Promise<{ ok: boolean; commentId?: string; error?: string }> {
  try {
    const url = `${GRAPH_API}/${input.parentCommentId}/replies`;
    const body = new URLSearchParams({
      message: input.message.slice(0, 2200),
      access_token: input.accessToken,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[meta] replyToComment failed:', res.status, errBody);
      return { ok: false, error: errBody };
    }
    const data = await res.json();
    return { ok: true, commentId: data.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Publish an Instagram post. Two-step:
 *   1. POST /media with image_url + caption → creates a "container"
 *   2. POST /media_publish with the container id → publishes
 *
 * For Reels or carousels, additional fields needed — Phase 2.
 */
export async function publishInstagramPhoto(input: {
  accessToken: string;
  igAccountId: string;
  imageUrl: string;
  caption: string;
}): Promise<{ ok: boolean; postId?: string; error?: string }> {
  try {
    // Step 1: create container
    const createUrl = `${GRAPH_API}/${input.igAccountId}/media`;
    const createBody = new URLSearchParams({
      image_url: input.imageUrl,
      caption: input.caption.slice(0, 2200),
      access_token: input.accessToken,
    });
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });
    if (!createRes.ok) {
      const errBody = await createRes.text();
      return { ok: false, error: `container create failed: ${errBody}` };
    }
    const created = await createRes.json();
    const creationId = created.id;
    if (!creationId) return { ok: false, error: 'no container id returned' };

    // Step 2: publish
    const publishUrl = `${GRAPH_API}/${input.igAccountId}/media_publish`;
    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: input.accessToken,
    });
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishBody.toString(),
    });
    if (!publishRes.ok) {
      const errBody = await publishRes.text();
      return { ok: false, error: `publish failed: ${errBody}` };
    }
    const published = await publishRes.json();
    return { ok: true, postId: published.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Aggregate recent activity for the owner's daily-brief / agent tick:
 *  recent posts + their comment counts + the latest comment per post. */
export interface InstagramActivitySummary {
  posts: Array<{
    id: string;
    caption: string;
    permalink?: string;
    likeCount: number;
    commentsCount: number;
    latestComment?: { username?: string; text?: string; timestamp?: string };
  }>;
}

export async function summarizeInstagramActivity(input: {
  accessToken: string;
  igAccountId: string;
}): Promise<InstagramActivitySummary> {
  const posts = await listInstagramPosts({
    accessToken: input.accessToken,
    igAccountId: input.igAccountId,
    limit: 6,
  });
  const summary: InstagramActivitySummary = { posts: [] };
  for (const p of posts) {
    let latestComment: { username?: string; text?: string; timestamp?: string } | undefined;
    if ((p.commentsCount ?? 0) > 0) {
      const comments = await listInstagramComments({ accessToken: input.accessToken, igMediaId: p.id });
      if (comments.length > 0) {
        const c = comments[comments.length - 1]!; // most recent
        latestComment = { username: c.username, text: c.text, timestamp: c.timestamp };
      }
    }
    summary.posts.push({
      id: p.id,
      caption: (p.caption ?? '').slice(0, 100),
      permalink: p.permalink,
      likeCount: p.likeCount ?? 0,
      commentsCount: p.commentsCount ?? 0,
      latestComment,
    });
  }
  return summary;
}
