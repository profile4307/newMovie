import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// 채널 조회
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.query<unknown[]>(
    `/channels?select=id,name,description,avatar_url,banner_url,subscriber_count,created_at&id=eq.${id}&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'Not found' }, 404)

  return c.json({ data: data[0] })
})

// 채널 동영상 목록
app.get('/:id/videos', async (c) => {
  const channelId = c.req.param('id')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.query<unknown[]>(
    `/videos?select=id,title,thumbnail_url,stream_uid,duration,view_count,created_at&channel_id=eq.${channelId}&status=eq.published&order=created_at.desc`
  )

  if (error) return c.json({ error }, 500)
  return c.json({ data })
})

// 채널 생성
app.post(
  '/',
  requireAuth,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).default(''),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    const { data: existing } = await db.query<unknown[]>(
      `/channels?owner_id=eq.${userId}&limit=1`
    )
    if (existing && existing.length > 0) {
      return c.json({ error: 'Channel already exists' }, 400)
    }

    const { data, error } = await db.query<unknown[]>('/channels', {
      method: 'POST',
      body: JSON.stringify({ ...body, owner_id: userId, subscriber_count: 0 }),
    })

    if (error) return c.json({ error }, 500)
    return c.json({ data: data?.[0] }, 201)
  }
)

// 구독 토글
app.post('/:id/subscribe', requireAuth, async (c) => {
  const channelId = c.req.param('id')
  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data: existing } = await db.query<{ id: string }[]>(
    `/subscriptions?user_id=eq.${userId}&channel_id=eq.${channelId}&limit=1`
  )

  if (existing && existing.length > 0) {
    await db.query(`/subscriptions?user_id=eq.${userId}&channel_id=eq.${channelId}`, {
      method: 'DELETE',
    })
    await db.query(`/channels?id=eq.${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ subscriber_count: { raw: 'subscriber_count - 1' } }),
    })
    return c.json({ subscribed: false })
  } else {
    await db.query('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, channel_id: channelId }),
    })
    await db.query(`/channels?id=eq.${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ subscriber_count: { raw: 'subscriber_count + 1' } }),
    })
    return c.json({ subscribed: true })
  }
})

export { app as channels }
