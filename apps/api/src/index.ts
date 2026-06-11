import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { videos } from './routes/videos'
import { channels } from './routes/channels'
import { auth } from './routes/auth'
import { upload } from './routes/upload'
import { comments } from './routes/comments'
import { refreshFeedCache } from './lib/feed-cache'
import { copyVideoToR2, purgeBunnyOriginals } from './lib/r2-copy'

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
  // R2 HLS 서빙 (optional — 미설정 시 Bunny CDN 서빙, docs/r2-serving-design.md)
  MEDIA_BUCKET?: R2Bucket
  // 재생 URL prefix. 커스텀 도메인이 없으면 이 Worker의 /media 프록시 사용
  // (예: https://newmovie-api.xxx.workers.dev/media)
  MEDIA_BASE_URL?: string
  R2_COPY_QUEUE?: Queue<{ uid: string }>
  ADMIN_API_KEY?: string // 백필 라우트(POST /api/videos/backfill-r2) 보호용
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

// ─── R2 미디어 프록시 ────────────────────────────────────────────────────────
// 커스텀 도메인 없이 R2의 HLS 파일을 서빙 (egress 무료, Workers 요청 과금만).
// 콘텐츠 불변 → immutable 캐시. hls.js의 교차 출처 fetch를 위해 CORS 허용.
app.get('/media/*', async (c) => {
  const bucket = c.env.MEDIA_BUCKET
  if (!bucket) return c.json({ error: 'Not found' }, 404)

  const key = decodeURIComponent(new URL(c.req.url).pathname.slice('/media/'.length))
  if (!key || key.includes('..')) return c.json({ error: 'Not found' }, 404)

  const rangeHeader = c.req.header('Range')
  const obj = await bucket.get(key, rangeHeader ? { range: c.req.raw.headers } : undefined)
  if (!obj) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('ETag', obj.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Accept-Ranges', 'bytes')

  // Range 요청(Safari 네이티브 HLS 등) → 206 Partial Content
  if (rangeHeader && obj.range) {
    const offset = 'offset' in obj.range ? (obj.range.offset ?? 0) : 0
    const length = 'length' in obj.range && obj.range.length != null ? obj.range.length : obj.size - offset
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    return new Response(obj.body, { status: 206, headers })
  }
  return new Response(obj.body, { headers })
})

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
    ctx.waitUntil(purgeBunnyOriginals(env)) // R2 전환 후 유예 지난 Bunny 원본 정리 (R2 미설정 시 no-op)
  },
  // r2-copy 큐 컨슈머 — Bunny HLS → R2 복사 (실패 시 자동 재시도).
  // 무료 플랜 subrequest 한도 때문에 한 invocation에 일부만 복사하고,
  // 미완료면 새 메시지로 재큐잉해 이어간다 (진행분은 R2에 남아 다음 호출이 건너뜀).
  async queue(batch: MessageBatch<{ uid: string }>, env: Env) {
    for (const msg of batch.messages) {
      try {
        const complete = await copyVideoToR2(env, msg.body.uid)
        if (!complete) await env.R2_COPY_QUEUE?.send({ uid: msg.body.uid })
        msg.ack()
      } catch (e) {
        console.error('[r2-copy] 복사 실패, 재시도 예약:', msg.body.uid, e)
        msg.retry({ delaySeconds: 60 })
      }
    }
  },
}
