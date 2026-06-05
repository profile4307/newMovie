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
  CF_STREAM_ACCOUNT_ID: string
  CF_STREAM_API_TOKEN: string
  CF_STREAM_CUSTOMER_SUBDOMAIN: string
  // VIEW_COUNTS: KVNamespace
  // VIDEO_BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:3000', 'https://newmovie.pages.dev'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
)

app.get('/', (c) => c.json({ status: 'ok', service: 'newmovie-api' }))

app.route('/api/auth', auth)
app.route('/api/videos', videos)
app.route('/api/channels', channels)
app.route('/api/upload', upload)
app.route('/api/comments', comments)

export default app
