import { createMiddleware } from 'hono/factory'
import { createAnonClient } from '../lib/supabase'
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
  const client = createAnonClient(c.env)
  const { userId } = await client.verifyToken(token)

  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  c.set('userId', userId)
  await next()
})
