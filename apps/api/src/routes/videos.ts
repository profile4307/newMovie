import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, getUserIdFromAuthHeader, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'
import { attachChannels } from '../lib/channels'
import { bunnyStorage } from '../lib/bunny-storage'
import { CachedFeed, CachedVideo, FeedVideoRow } from '../lib/feed-cache'
import { isUUID } from '../lib/validation'
import { r2Enabled, r2PlaybackUrl, deleteR2Prefix, copyVideoToR2 } from '../lib/r2-copy'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// KV 캐시에서 페이지를 잘라 반환. 캐시 미스 / 비인기 카테고리 (필터 결과 < limit/2) /
// page 범위 초과 시 null → 호출부에서 DB 폴백.
function sliceCachedFeed(
  cached: CachedFeed | null | undefined,
  category: string | undefined,
  offset: number,
  limit: number
): CachedVideo[] | null {
  if (!cached?.data) return null
  let result = cached.data
  if (category) result = result.filter((v) => v.category === category)
  if (category != null && result.length < Math.ceil(limit / 2)) return null
  if (offset >= result.length) return null
  return result.slice(offset, offset + limit)
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
      const { data, error } = await db.rpc<FeedVideoRow[]>(
        'search_videos',
        { p_query: search.trim(), p_limit: limit, p_offset: offset }
      )
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
      const userId = await getUserIdFromAuthHeader(c.env, authHeader)
      if (!userId) return c.json({ error: 'Invalid token' }, 401)

      const { data, error } = await db.rpc<FeedVideoRow[]>(
        'get_subscription_feed',
        { p_user_id: userId, p_limit: limit, p_offset: offset }
      )
      if (error) return c.json({ error }, 500)
      const withChannels = await attachChannels(db, data ?? [])
      return c.json({ data: withChannels, feed, page, limit })
    }

    // 추천 피드 (기본)
    if (feed === 'trending') {
      const cached = await c.env.FEED_CACHE?.get<CachedFeed>('feed:trending', 'json')
      const cachedPage = sliceCachedFeed(cached, category, offset, limit)
      if (cachedPage) return c.json({ data: cachedPage, feed, page, limit })

      const { data, error } = await db.rpc<(FeedVideoRow & { trend_score: number })[]>(
        'get_trending_videos',
        { p_limit: limit, p_offset: offset }
      )
      if (error) return c.json({ error }, 500)

      let result = data ?? []
      if (category) result = result.filter((v) => v.category === category)
      const withChannels = await attachChannels(db, result)
      return c.json({ data: withChannels, feed, page, limit })
    }

    // 최신순
    const latestCached = await c.env.FEED_CACHE?.get<CachedFeed>('feed:latest', 'json')
    const latestCachedPage = sliceCachedFeed(latestCached, category, offset, limit)
    if (latestCachedPage) return c.json({ data: latestCachedPage, feed, page, limit })

    let path = `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${limit}&offset=${offset}`
    if (category) path += `&category=eq.${encodeURIComponent(category)}`

    const { data, error } = await db.query<FeedVideoRow[]>(path)
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

// ─── 기존 영상 R2 백필 (관리자 전용 — docs/r2-serving-design.md Phase 4) ────
// X-Admin-Key 헤더로 보호. 큐가 있으면 일괄 큐잉, 없으면 호출당 1개씩 동기 복사.
app.post('/backfill-r2', async (c) => {
  if (!c.env.ADMIN_API_KEY || c.req.header('X-Admin-Key') !== c.env.ADMIN_API_KEY) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (!r2Enabled(c.env)) return c.json({ error: 'R2 not configured' }, 400)

  const db = createSupabaseClient(c.env)
  const { data, error } = await db.query<{ stream_uid: string }[]>(
    `/videos?select=stream_uid&playback_host=eq.bunny&status=in.(published,private,unlisted)&order=created_at.asc&limit=100`
  )
  if (error) return c.json({ error }, 500)
  const uids = (data ?? []).map((v) => v.stream_uid)
  if (uids.length === 0) return c.json({ queued: 0, remaining: 0 })

  if (c.env.R2_COPY_QUEUE) {
    await c.env.R2_COPY_QUEUE.sendBatch(uids.map((uid) => ({ body: { uid } })))
    return c.json({ queued: uids.length })
  }

  // 큐 미설정: 1개씩 분할 복사 — remaining이 0이 될 때까지 반복 호출
  const complete = await copyVideoToR2(c.env, uids[0]!)
  return c.json({ copied: uids[0], complete, remaining: complete ? uids.length - 1 : uids.length })
})

// ─── 동영상 상세 ─────────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)

  type VideoRow = {
    id: string; title: string; description: string; thumbnail_url: string | null
    stream_uid: string; duration: number | null; view_count: number; like_count: number; comment_count: number
    category: string | null; tags: string[]; created_at: string; status: string; playback_host?: string
    channel: { id: string; name: string; avatar_url: string | null; subscriber_count: number; owner_id: string; owner: { avatar_url: string | null } | null }
  }

  // playback_host 컬럼은 R2 활성화(= 마이그레이션 적용) 시에만 조회 — 배포 순서 무관하게 동작
  const playbackCol = r2Enabled(c.env) ? ',playback_host' : ''
  const { data, error } = await db.query<VideoRow[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,comment_count,category,tags,created_at,status${playbackCol},channel:channels(id,name,avatar_url,subscriber_count,owner_id,owner:users!owner_id(avatar_url))&id=eq.${id}&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'Not found' }, 404)

  const video = data[0]!

  // 비공개/일부공개/처리중: 소유자만 접근 가능
  if (video.status !== 'published') {
    const userId = await getUserIdFromAuthHeader(c.env, c.req.header('Authorization'))
    if (userId !== video.channel.owner_id) return c.json({ error: 'Not found' }, 404)
  }

  // 조회수 증가는 GET에서 분리됨 → POST /:id/view (클라이언트가 하루 1회만 호출)

  // owner_id 제외, avatar_url 없으면 소유자 users.avatar_url로 fallback
  const { channel: { owner_id: _, owner, ...channelRest }, playback_host, ...videoPublic } = video
  const channelPublic = {
    ...channelRest,
    avatar_url: channelRest.avatar_url || owner?.avatar_url || null,
  }
  // 재생 URL — R2로 복사된 영상은 egress 무료인 R2 커스텀 도메인에서 서빙
  const playback_url =
    playback_host === 'r2' && r2Enabled(c.env)
      ? r2PlaybackUrl(c.env, video.stream_uid)
      : `https://${c.env.BUNNY_CDN_HOSTNAME}/${video.stream_uid}/playlist.m3u8`
  return c.json({ data: { ...videoPublic, playback_url, channel: channelPublic } })
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

// ─── 조회수 증가 (클라이언트가 하루 1회만 호출) ─────────────────────────────
app.post('/:id/view', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)
  c.executionCtx.waitUntil(db.rpc('increment_view_count', { p_video_id: id }))
  return c.json({ ok: true })
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

  // 소유권 확인 + stream_uid/thumbnail_url 조회
  const { data: existing } = await db.query<{ id: string; stream_uid: string; thumbnail_url: string | null; channel: { owner_id: string } }[]>(
    `/videos?select=id,stream_uid,thumbnail_url,channel:channels(owner_id)&id=eq.${id}&limit=1`
  )
  if (!existing || existing.length === 0) return c.json({ error: 'Not found' }, 404)
  if (existing[0]!.channel.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const streamUid = existing[0]!.stream_uid
  const thumbnailUrl = existing[0]!.thumbnail_url

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

  // 커스텀 썸네일이 Bunny Storage에 있으면 함께 삭제 (Bunny 자동 썸네일은 Stream 삭제로 정리됨)
  const storagePrefix = `https://${c.env.BUNNY_STORAGE_HOSTNAME}/`
  if (thumbnailUrl?.startsWith(storagePrefix)) {
    c.executionCtx.waitUntil(bunnyStorage(c.env).remove(thumbnailUrl.slice(storagePrefix.length)))
  }

  // R2로 복사된 HLS 파일도 정리 (R2 미설정 시 no-op)
  c.executionCtx.waitUntil(deleteR2Prefix(c.env, streamUid))

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
