import { Hono } from 'hono'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

const STREAM_UID_RE = /^[a-f0-9]{32}$|^[a-f0-9-]{36}$/i

// Cloudflare Stream 직접 업로드 URL 발급
app.post('/stream-url', requireAuth, async (c) => {
  const { CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN } = c.env

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_STREAM_ACCOUNT_ID}/stream/direct_upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_STREAM_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        maxDurationSeconds: 3600,
        expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1시간 유효
        meta: { userId: c.get('userId') },
        requireSignedURLs: false,
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    return c.json({ error: `Stream API error: ${err}` }, 500)
  }

  const result = (await res.json()) as { result: { uploadURL: string; uid: string } }
  return c.json({ uploadUrl: result.result.uploadURL, streamUid: result.result.uid })
})

// 트랜스코딩 상태 확인 (업로드 당사자용)
app.get('/stream-status/:uid', requireAuth, async (c) => {
  const uid = c.req.param('uid')
  if (!STREAM_UID_RE.test(uid)) return c.json({ error: 'Invalid stream UID' }, 400)

  const { CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN } = c.env
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_STREAM_ACCOUNT_ID}/stream/${uid}`,
    { headers: { Authorization: `Bearer ${CF_STREAM_API_TOKEN}` } }
  )

  if (!res.ok) return c.json({ error: 'Not found' }, 404)

  const result = (await res.json()) as {
    result: { uid: string; status: { state: string; pctComplete: string }; duration: number; thumbnail: string }
  }

  // 트랜스코딩 완료 시 DB 자동 업데이트
  if (result.result.status.state === 'ready') {
    const db = createSupabaseClient(c.env)
    await db.query(`/videos?stream_uid=eq.${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'published',
        duration: result.result.duration ? Math.floor(result.result.duration) : undefined,
        thumbnail_url: result.result.thumbnail || undefined,
      }),
    })
  }

  return c.json({
    uid: result.result.uid,
    state: result.result.status.state,
    pctComplete: result.result.status.pctComplete,
    duration: result.result.duration,
    thumbnail: result.result.thumbnail,
  })
})

// Cloudflare Stream 웹훅 — 트랜스코딩 완료 시 자동 호출
app.post('/webhook', async (c) => {
  const { CF_STREAM_WEBHOOK_SECRET } = c.env as Env & { CF_STREAM_WEBHOOK_SECRET?: string }

  // 웹훅 시크릿 검증 (설정된 경우)
  if (CF_STREAM_WEBHOOK_SECRET) {
    const sig = c.req.header('Webhook-Signature')
    if (!sig || sig !== CF_STREAM_WEBHOOK_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  const body = (await c.req.json()) as {
    uid?: string
    status?: { state?: string }
    duration?: number
    thumbnail?: string
  }

  if (body.status?.state === 'ready' && body.uid) {
    const db = createSupabaseClient(c.env)
    await db.query(`/videos?stream_uid=eq.${body.uid}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'published',
        duration: body.duration ? Math.floor(body.duration) : undefined,
        thumbnail_url: body.thumbnail || undefined,
      }),
    })
  }

  return c.json({ ok: true })
})

export { app as upload }
