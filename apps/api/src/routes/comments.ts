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

// 댓글 목록
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      video_id: z.string().uuid(),
      page: z.coerce.number().int().min(1).default(1),
    })
  ),
  async (c) => {
    const { video_id, page } = c.req.valid('query')
    const limit = 20
    const offset = (page - 1) * limit
    const db = createSupabaseClient(c.env)

    const { data, error } = await db.query<unknown[]>(
      `/comments?select=id,content,created_at,user:users(id,username,avatar_url)&video_id=eq.${video_id}&parent_id=is.null&order=created_at.desc&limit=${limit}&offset=${offset}`
    )

    if (error) return c.json({ error }, 500)
    return c.json({ data })
  }
)

// 댓글 작성
app.post(
  '/',
  requireAuth,
  zValidator(
    'json',
    z.object({
      video_id: z.string().uuid(),
      content: z.string().min(1).max(2000),
      parent_id: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    const { data, error } = await db.query<unknown[]>(
      '/comments?select=id,content,created_at,user:users(id,username,avatar_url)',
      {
        method: 'POST',
        body: JSON.stringify({ ...body, user_id: userId }),
      }
    )

    if (error) return c.json({ error }, 500)
    return c.json({ data: data?.[0] }, 201)
  }
)

// 대댓글 목록 (특정 댓글의 답글)
app.get('/:id/replies', async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const db = createSupabaseClient(c.env)
  const { data, error } = await db.query<unknown[]>(
    `/comments?select=id,content,created_at,user:users(id,username,avatar_url)&parent_id=eq.${id}&order=created_at.asc`
  )
  if (error) return c.json({ error }, 500)
  return c.json({ data })
})

// 댓글 삭제
app.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid ID' }, 400)

  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data: existing } = await db.query<{ user_id: string }[]>(
    `/comments?select=user_id&id=eq.${id}&limit=1`
  )
  if (!existing || existing.length === 0) return c.json({ error: 'Not found' }, 404)
  if (existing[0]!.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.query(`/comments?id=eq.${id}`, { method: 'DELETE' })
  return c.json({ success: true })
})

export { app as comments }
