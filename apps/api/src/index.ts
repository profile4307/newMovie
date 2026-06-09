import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { videos } from './routes/videos'
import { channels } from './routes/channels'
import { auth } from './routes/auth'
import { upload } from './routes/upload'
import { comments } from './routes/comments'
import { refreshFeedCache } from './lib/feed-cache'

export type Env = {
  ENVIRONMENT: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  BUNNY_STREAM_LIBRARY_ID: string
  BUNNY_STREAM_API_KEY: string
  BUNNY_CDN_HOSTNAME: string
  BUNNY_WEBHOOK_SECRET?: string
  // Bunny Storage Zone (썸네일·아바타용 — Supabase Storage 대체)
  BUNNY_STORAGE_ZONE_NAME: string
  BUNNY_STORAGE_PASSWORD: string
  BUNNY_STORAGE_HOSTNAME: string
  BUNNY_STORAGE_ENDPOINT?: string
  ALLOWED_ORIGINS: string
  // Feed cache (optional — KV 미설정 시 DB 폴백)
  FEED_CACHE?: KVNamespace
  FEED_CACHE_TTL_MINUTES: string
  FEED_CACHE_SIZE: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('/api/*', async (c, next) => {
  const allowedOrigins = (c.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim())
  return cors({
    origin: allowedOrigins,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })(c, next)
})

app.get('/', (c) => c.json({ status: 'ok', service: 'newmovie-api' }))

app.route('/api/auth', auth)
app.route('/api/videos', videos)
app.route('/api/channels', channels)
app.route('/api/upload', upload)
app.route('/api/comments', comments)

export default {
  fetch: app.fetch,
  // workers-types v4: 첫 인자는 ScheduledController
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshFeedCache(env))
  },
}
