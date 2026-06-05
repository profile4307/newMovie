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

// 채널 조회
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

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
  if (!isUUID(channelId)) return c.json({ error: 'Invalid ID' }, 400)

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
      `/channels?select=id&owner_id=eq.${userId}&limit=1`
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

// 구독 토글 (DB RPC — race condition 방지)
app.post('/:id/subscribe', requireAuth, async (c) => {
  const channelId = c.req.param('id')
  if (!isUUID(channelId)) return c.json({ error: 'Invalid ID' }, 400)

  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.rpc<boolean>('toggle_subscription', {
    p_user_id: userId,
    p_channel_id: channelId,
  })

  if (error) return c.json({ error }, 500)
  return c.json({ subscribed: data })
})

export { app as channels }
