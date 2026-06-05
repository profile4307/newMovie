import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(v: string) {
  return UUID_RE.test(v)
}

// 채널 정보를 video 배열에 병합
async function attachChannels<T extends { channel_id: string }>(
  db: ReturnType<typeof createSupabaseClient>,
  videos: T[]
): Promise<(T & { channel: { id: string; name: string; avatar_url: string | null } })[]> {
  if (videos.length === 0) return []
  const ids = [...new Set(videos.map((v) => v.channel_id))]
  const inFilter = ids.map((id) => `"${id}"`).join(',')
  const { data: channels } = await db.query<
    { id: string; name: string; avatar_url: string | null }[]
  >(`/channels?select=id,name,avatar_url&id=in.(${inFilter})`)

  const channelMap = Object.fromEntries((channels ?? []).map((c) => [c.id, c]))
  return videos.map((v) => ({
    ...v,
    channel: channelMap[v.channel_id] ?? { id: v.channel_id, name: '', avatar_url: null },
  }))
}

// ─── 동영상 목록 (피드) ──────────────────────────────────────────────────────
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      feed: z.enum(['trending', 'subscriptions', 'latest']).default('trending'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      category: z.string().max(50).optional(),
      search: z.string().max(100).optional(),
    })
  ),
  async (c) => {
    const { feed, page, limit, category, search } = c.req.valid('query')
    const offset = (page - 1) * limit
    const db = createSupabaseClient(c.env)

    // 검색은 feed와 무관하게 항상 search_videos RPC
    if (search && search.trim().length > 0) {
      const { data, error } = await db.rpc<
        { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string }[]
      >('search_videos', { p_query: search.trim(), p_limit: limit, p_offset: offset })
      if (error) return c.json({ error }, 500)
      const withChannels = await attachChannels(db, data ?? [])
      return c.json({ data: withChannels, feed: 'search', page, limit })
    }

    // 구독 피드: 인증 필요
    if (feed === 'subscriptions') {
      const authHeader = c.req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Login required', code: 'UNAUTHENTICATED' }, 401)
      }
      const { createAnonClient } = await import('../lib/supabase')
      const { userId } = await createAnonClient(c.env).verifyToken(authHeader.slice(7))
      if (!userId) return c.json({ error: 'Invalid token' }, 401)

      const { data, error } = await db.rpc<
        { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string }[]
      >('get_subscription_feed', { p_user_id: userId, p_limit: limit, p_offset: offset })
      if (error) return c.json({ error }, 500)
      const withChannels = await attachChannels(db, data ?? [])
      return c.json({ data: withChannels, feed, page, limit })
    }

    // 추천 피드 (기본)
    if (feed === 'trending') {
      const { data, error } = await db.rpc<
        { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string; trend_score: number }[]
      >('get_trending_videos', { p_limit: limit, p_offset: offset })
      if (error) return c.json({ error }, 500)

      let result = data ?? []
      if (category) result = result.filter((v) => v.category === category)
      const withChannels = await attachChannels(db, result)
      return c.json({ data: withChannels, feed, page, limit })
    }

    // 최신순
    let path = `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${limit}&offset=${offset}`
    if (category) path += `&category=eq.${encodeURIComponent(category)}`

    const { data, error } = await db.query<
      { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string }[]
    >(path)
    if (error) return c.json({ error }, 500)
    const withChannels = await attachChannels(db, data ?? [])
    return c.json({ data: withChannels, feed, page, limit })
  }
)

// ─── 동영상 상세 ─────────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)
  const { data, error } = await db.query<
    {
      id: string; title: string; description: string; thumbnail_url: string | null
      stream_uid: string; duration: number | null; view_count: number; like_count: number
      category: string | null; tags: string[]; created_at: string
      channel: { id: string; name: string; avatar_url: string | null; subscriber_count: number }
    }[]
  >(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel:channels(id,name,avatar_url,subscriber_count)&id=eq.${id}&status=eq.published&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'Not found' }, 404)

  // 조회수 비동기 증가 (실패해도 응답에 영향 없음)
  c.executionCtx.waitUntil(db.rpc('increment_view_count', { p_video_id: id }))

  return c.json({ data: data[0] })
})

// ─── 유사 영상 추천 ──────────────────────────────────────────────────────────
app.get('/:id/related', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)
  const { data, error } = await db.rpc<
    { id: string; title: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; created_at: string; channel_id: string }[]
  >('get_related_videos', { p_video_id: id, p_limit: 10 })

  if (error) return c.json({ error }, 500)
  const withChannels = await attachChannels(db, data ?? [])
  return c.json({ data: withChannels })
})

// ─── 동영상 등록 (메타데이터) ────────────────────────────────────────────────
app.post(
  '/',
  requireAuth,
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000).default(''),
      stream_uid: z.string().min(1).max(200),
      thumbnail_url: z.string().url().optional(),
      duration: z.number().int().positive().optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string().max(30)).max(10).default([]),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    const { data: channels } = await db.query<{ id: string }[]>(
      `/channels?select=id&owner_id=eq.${userId}&limit=1`
    )
    if (!channels || channels.length === 0) {
      return c.json({ error: 'Channel not found. Create a channel first.' }, 400)
    }

    const { data, error } = await db.query<unknown[]>('/videos', {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        channel_id: channels[0]!.id,
        status: 'processing',
        view_count: 0,
        like_count: 0,
      }),
    })

    if (error) return c.json({ error }, 500)
    return c.json({ data: data?.[0] }, 201)
  }
)

// ─── 동영상 수정 ─────────────────────────────────────────────────────────────
app.put(
  '/:id',
  requireAuth,
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
      thumbnail_url: z.string().url().optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      status: z.enum(['published', 'private', 'unlisted']).optional(),
    })
  ),
  async (c) => {
    const id = c.req.param('id')
    if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    const { data: existing } = await db.query<{ id: string; channel: { owner_id: string } }[]>(
      `/videos?select=id,channel:channels(owner_id)&id=eq.${id}&limit=1`
    )
    if (!existing || existing.length === 0) return c.json({ error: 'Not found' }, 404)
    if (existing[0]!.channel.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const { data, error } = await db.query<unknown[]>(`/videos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })

    if (error) return c.json({ error }, 500)
    return c.json({ data: data?.[0] })
  }
)

// ─── 좋아요 토글 ─────────────────────────────────────────────────────────────
app.post('/:id/like', requireAuth, async (c) => {
  const videoId = c.req.param('id')
  if (!isUUID(videoId)) return c.json({ error: 'Invalid ID' }, 400)

  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.rpc<boolean>('toggle_like', {
    p_user_id: userId,
    p_video_id: videoId,
  })

  if (error) return c.json({ error }, 500)
  return c.json({ liked: data })
})

export { app as videos }
