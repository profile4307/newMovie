import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// 동영상 목록 조회 (홈 피드)
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(50).default(20),
      category: z.string().optional(),
      search: z.string().optional(),
    })
  ),
  async (c) => {
    const { page, limit, category, search } = c.req.valid('query')
    const offset = (page - 1) * limit
    const db = createSupabaseClient(c.env)

    let path = `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,created_at,channel:channels(id,name,avatar_url)&status=eq.published&order=created_at.desc&limit=${limit}&offset=${offset}`

    if (category) path += `&category=eq.${category}`
    if (search) path += `&title=ilike.*${encodeURIComponent(search)}*`

    const { data, error } = await db.query<unknown[]>(path)
    if (error) return c.json({ error }, 500)

    return c.json({ data, page, limit })
  }
)

// 동영상 상세 조회
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.query<unknown[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,tags,category,created_at,channel:channels(id,name,avatar_url,subscriber_count)&id=eq.${id}&status=eq.published&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'Not found' }, 404)

  // 조회수 증가 (비동기, 실패해도 무관)
  c.executionCtx.waitUntil(
    db.query(`/videos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ view_count: { raw: `view_count + 1` } }),
    })
  )

  return c.json({ data: data[0] })
})

// 동영상 업로드 (메타데이터 저장)
app.post(
  '/',
  requireAuth,
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000).default(''),
      stream_uid: z.string(),
      thumbnail_url: z.string().url().optional(),
      duration: z.number().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).max(10).default([]),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    // 채널 조회
    const { data: channels } = await db.query<{ id: string }[]>(
      `/channels?owner_id=eq.${userId}&limit=1`
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

// 동영상 수정
app.put(
  '/:id',
  requireAuth,
  zValidator(
    'json',
    z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
      thumbnail_url: z.string().url().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).max(10).optional(),
      status: z.enum(['published', 'private', 'unlisted']).optional(),
    })
  ),
  async (c) => {
    const id = c.req.param('id')
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    // 소유권 확인
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

// 좋아요 토글
app.post('/:id/like', requireAuth, async (c) => {
  const videoId = c.req.param('id')
  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data: existing } = await db.query<{ id: string }[]>(
    `/likes?user_id=eq.${userId}&video_id=eq.${videoId}&limit=1`
  )

  if (existing && existing.length > 0) {
    await db.query(`/likes?user_id=eq.${userId}&video_id=eq.${videoId}`, { method: 'DELETE' })
    await db.query(`/videos?id=eq.${videoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ like_count: { raw: 'like_count - 1' } }),
    })
    return c.json({ liked: false })
  } else {
    await db.query('/likes', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, video_id: videoId }),
    })
    await db.query(`/videos?id=eq.${videoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ like_count: { raw: 'like_count + 1' } }),
    })
    return c.json({ liked: true })
  }
})

export { app as videos }
