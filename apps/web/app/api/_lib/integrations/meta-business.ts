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

/**
 * Publish an Instagram REEL. Three-step flow (more complex than photos):
 *   1. POST /media with media_type=REELS + video_url + caption → container id
 *   2. Poll /{container_id}?fields=status_code until FINISHED (uploads/encodes)
 *   3. POST /media_publish with the container id → published reel
 *
 * Reels requirements:
 *   - MP4 with H.264 + AAC, 3-90 seconds, <100MB, public HTTPS URL
 *   - 9:16 aspect ratio preferred (accepts 4:5 to 1.91:1)
 */
export async function publishInstagramReel(input: {
  accessToken: string;
  igAccountId: string;
  videoUrl: string;
  caption: string;
  shareToFeed?: boolean;
  maxWaitMs?: number;
}): Promise<{ ok: boolean; postId?: string; error?: string }> {
  try {
    const createUrl = `${GRAPH_API}/${input.igAccountId}/media`;
    const createBody = new URLSearchParams({
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption.slice(0, 2200),
      share_to_feed: input.shareToFeed === false ? 'false' : 'true',
      access_token: input.accessToken,
    });
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
    });
    if (!createRes.ok) {
      return { ok: false, error: `container create failed: ${await createRes.text()}` };
    }
    const created = await createRes.json();
    const creationId = created.id;
    if (!creationId) return { ok: false, error: 'no container id returned' };

    // Poll until FINISHED (Meta encodes the video before allowing publish)
    const maxWaitMs = input.maxWaitMs ?? 90_000;
    const start = Date.now();
    let lastStatus = 'IN_PROGRESS';
    while (Date.now() - start < maxWaitMs) {
      const statusRes = await fetch(
        `${GRAPH_API}/${creationId}?fields=status_code,status&access_token=${input.accessToken}`,
      );
      if (statusRes.ok) {
        const s = await statusRes.json();
        lastStatus = s.status_code ?? s.status ?? 'UNKNOWN';
        if (lastStatus === 'FINISHED') break;
        if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
          return { ok: false, error: `container ${lastStatus}: ${JSON.stringify(s)}` };
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (lastStatus !== 'FINISHED') {
      return { ok: false, error: `container still ${lastStatus} after ${maxWaitMs}ms — Meta is still encoding. Try again in a minute.` };
    }

    const publishRes = await fetch(`${GRAPH_API}/${input.igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: creationId, access_token: input.accessToken }).toString(),
    });
    if (!publishRes.ok) return { ok: false, error: `publish failed: ${await publishRes.text()}` };
    const published = await publishRes.json();
    return { ok: true, postId: published.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Publish a post to the owner's connected Facebook Page.
 * Uses the page_access_token (stored as access_token on the connection).
 *
 *   POST /{page-id}/feed  with `message` and optional `link` or `picture`.
 *   Returns the new post id.
 */
export async function publishFacebookPagePost(input: {
  pageAccessToken: string;
  pageId: string;
  message: string;
  linkUrl?: string;
  imageUrl?: string;
}): Promise<{ ok: boolean; postId?: string; error?: string }> {
  try {
    // If imageUrl provided, post a photo with caption instead of a text post.
    if (input.imageUrl) {
      const url = `${GRAPH_API}/${input.pageId}/photos`;
      const body = new URLSearchParams({
        url: input.imageUrl,
        caption: input.message.slice(0, 5000),
        access_token: input.pageAccessToken,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) return { ok: false, error: await res.text() };
      const data = await res.json();
      return { ok: true, postId: data.post_id ?? data.id };
    }

    // Plain text + optional link
    const url = `${GRAPH_API}/${input.pageId}/feed`;
    const body = new URLSearchParams({
      message: input.message.slice(0, 5000),
      access_token: input.pageAccessToken,
    });
    if (input.linkUrl) body.set('link', input.linkUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    const data = await res.json();
    return { ok: true, postId: data.id };
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
