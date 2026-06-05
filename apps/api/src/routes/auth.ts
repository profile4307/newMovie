import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// 현재 유저 프로필 조회
app.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const db = createSupabaseClient(c.env)

  const { data, error } = await db.query<unknown[]>(
    `/users?select=id,username,avatar_url,created_at&id=eq.${userId}&limit=1`
  )

  if (error) return c.json({ error }, 500)
  if (!data || data.length === 0) return c.json({ error: 'User not found' }, 404)
  return c.json({ data: data[0] })
})

// 유저 프로필 초기화/수정
app.post(
  '/profile',
  requireAuth,
  zValidator(
    'json',
    z.object({
      username: z
        .string()
        .min(2, '2자 이상 입력하세요')
        .max(30, '30자 이하로 입력하세요')
        .regex(/^[a-zA-Z0-9_가-힣]+$/, '영문, 숫자, 한글, 밑줄(_)만 사용 가능합니다'),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const { username } = c.req.valid('json')
    const db = createSupabaseClient(c.env)

    const { data: existing } = await db.query<unknown[]>(
      `/users?select=id&id=eq.${userId}&limit=1`
    )

    if (existing && existing.length > 0) {
      const { data, error } = await db.query<unknown[]>(`/users?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ username }),
      })
      if (error) return c.json({ error }, 500)
      return c.json({ data: data?.[0] })
    }

    const { data, error } = await db.query<unknown[]>('/users', {
      method: 'POST',
      body: JSON.stringify({ id: userId, username }),
    })

    if (error) return c.json({ error }, 500)
    return c.json({ data: data?.[0] }, 201)
  }
)

export { app as auth }
