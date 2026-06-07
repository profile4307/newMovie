import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { videos } from './routes/videos'
import { channels } from './routes/channels'
import { auth } from './routes/auth'
import { upload } from './routes/upload'
import { comments } from './routes/comments'

export type Env = {
  ENVIRONMENT: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  BUNNY_STREAM_LIBRARY_ID: string
  BUNNY_STREAM_API_KEY: string
  BUNNY_CDN_HOSTNAME: string
  BUNNY_WEBHOOK_SECRET?: string
  ALLOWED_ORIGINS: string
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

export default app
