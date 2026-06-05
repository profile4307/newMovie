import { createMiddleware } from 'hono/factory'
import { createAnonClient, createSupabaseClient } from '../lib/supabase'
import { Env } from '../index'

export type AuthVariables = {
  userId: string
}

export const requireAuth = createMiddleware<{
  Bindings: Env
  Variables: AuthVariables
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)
  const anonClient = createAnonClient(c.env)
  const { userId, userMeta } = await anonClient.verifyToken(token)

  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // users 테이블에 레코드가 없으면 자동 생성 (Google OAuth 등 소셜 로그인 대응)
  const db = createSupabaseClient(c.env)
  const { data: existing } = await db.query<{ id: string }[]>(
    `/users?select=id&id=eq.${userId}&limit=1`
  )
  if (!existing || existing.length === 0) {
    const username = (
      userMeta?.full_name ??
      userMeta?.name ??
      userMeta?.email?.split('@')[0] ??
      userId.slice(0, 12)
    ) as string
    await db.query('/users', {
      method: 'POST',
      body: JSON.stringify({
        id: userId,
        username: username.replace(/\s+/g, '_').slice(0, 30),
        avatar_url: userMeta?.avatar_url ?? null,
      }),
    })
  }

  c.set('userId', userId)
  await next()
})
