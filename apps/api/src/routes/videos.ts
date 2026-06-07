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
      >('get_subscription_feed', { p_user_id: userId, p_limit: 200, p_offset: offset })
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

// ─── 구독순 피드 (채널별 그룹) ──────────────────────────────────────────────
app.get('/subscription-by-channel', requireAuth, async (c) => {
  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  type Row = {
    video_id: string; title: string; thumbnail_url: string | null; stream_uid: string
    duration: number | null; view_count: number; created_at: string
    channel_id: string; channel_name: string; channel_avatar_url: string | null; channel_latest_at: string
  }

  const { data, error } = await db.rpc<Row[]>('get_subscription_feed_by_channel', {
    p_user_id: userId,
    p_videos_per_channel: 6,
  })
  if (error) return c.json({ error }, 500)

  // 채널별 그룹핑
  type ChannelGroup = {
    channel: { id: string; name: string; avatar_url: string | null; latest_at: string }
    videos: { id: string; title: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; created_at: string }[]
  }
  const map: Record<string, ChannelGroup> = {}
  for (const row of data ?? []) {
    if (!map[row.channel_id]) {
      map[row.channel_id] = {
        channel: { id: row.channel_id, name: row.channel_name, avatar_url: row.channel_avatar_url, latest_at: row.channel_latest_at },
        videos: [],
      }
    }
    map[row.channel_id]!.videos.push({
      id: row.video_id, title: row.title, thumbnail_url: row.thumbnail_url,
      stream_uid: row.stream_uid, duration: row.duration,
      view_count: row.view_count, created_at: row.created_at,
    })
  }
  const groups = Object.values(map).sort((a, b) =>
    b.channel.latest_at.localeCompare(a.channel.latest_at)
  )
  return c.json({ data: groups })
})

// ─── 내 영상 목록 (processing 포함) ─────────────────────────────────────────
app.get('/mine', requireAuth, async (c) => {
  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data: channels } = await db.query<{ id: string }[]>(
    `/channels?select=id&owner_id=eq.${userId}&limit=1`
  )
  if (!channels || channels.length === 0) return c.json({ data: [] })

  const { data, error } = await db.query<unknown[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,status,category,tags,created_at&channel_id=eq.${channels[0]!.id}&order=created_at.desc`
  )
  if (error) return c.json({ error }, 500)
  return c.json({ data })
})

// ─── 동영상 상세 ─────────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)

  type VideoRow = {
    id: string; title: string; description: string; thumbnail_url: string | null
    stream_uid: string; duration: number | null; view_count: number; like_count: number; comment_count: number
    category: string | null; tags: string[]; created_at: string; status: string
    channel: { id: string; name: string; avatar_url: string | null; subscriber_count: number; owner_id: string; owner: { avatar_url: string | null } | null }
  }

  const { data, error } = await db.query<VideoRow[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,comment_count,category,tags,created_at,status,channel:channels(id,name,avatar_url,subscriber_count,owner_id,owner:users!owner_id(avatar_url))&id=eq.${id}&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'Not found' }, 404)

  const video = data[0]!

  // 비공개/일부공개/처리중: 소유자만 접근 가능
  if (video.status !== 'published') {
    const authHeader = c.req.header('Authorization')
    let isOwner = false
    if (authHeader?.startsWith('Bearer ')) {
      const { createAnonClient } = await import('../lib/supabase')
      const { userId } = await createAnonClient(c.env).verifyToken(authHeader.slice(7))
      isOwner = userId === video.channel.owner_id
    }
    if (!isOwner) return c.json({ error: 'Not found' }, 404)
  }

  // 공개 영상만 조회수 증가
  if (video.status === 'published') {
    c.executionCtx.waitUntil(db.rpc('increment_view_count', { p_video_id: id }))
  }

  // owner_id 제외, avatar_url 없으면 소유자 users.avatar_url로 fallback
  const { channel: { owner_id: _, owner, ...channelRest }, ...videoPublic } = video
  const channelPublic = {
    ...channelRest,
    avatar_url: channelRest.avatar_url || owner?.avatar_url || null,
  }
  return c.json({ data: { ...videoPublic, channel: channelPublic } })
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
      duration: z.number().positive().transform(Math.floor).optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string().max(30)).max(10).default([]),
      visibility: z.enum(['published', 'private', 'unlisted']).default('published'),
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

    const { visibility, ...videoBody } = body
    const { data, error } = await db.query<unknown[]>('/videos', {
      method: 'POST',
      body: JSON.stringify({
        ...videoBody,
        channel_id: channels[0]!.id,
        status: 'processing',
        target_status: visibility,  // 트랜스코딩 완료 후 전환될 상태
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

// ─── 동영상 삭제 ─────────────────────────────────────────────────────────────
app.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  // 소유권 확인 + stream_uid 조회
  const { data: existing } = await db.query<{ id: string; stream_uid: string; channel: { owner_id: string } }[]>(
    `/videos?select=id,stream_uid,channel:channels(owner_id)&id=eq.${id}&limit=1`
  )
  if (!existing || existing.length === 0) return c.json({ error: 'Not found' }, 404)
  if (existing[0]!.channel.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const streamUid = existing[0]!.stream_uid

  // DB에서 삭제 (cascade로 likes, comments 등 자동 삭제)
  const { error } = await db.query(`/videos?id=eq.${id}`, { method: 'DELETE' })
  if (error) return c.json({ error }, 500)

  // Bunny Stream에서도 삭제 (비동기 — 실패해도 무관)
  c.executionCtx.waitUntil(
    fetch(
      `https://video.bunnycdn.com/library/${c.env.BUNNY_STREAM_LIBRARY_ID}/videos/${streamUid}`,
      { method: 'DELETE', headers: { AccessKey: c.env.BUNNY_STREAM_API_KEY } }
    )
  )

  return c.json({ success: true })
})

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
