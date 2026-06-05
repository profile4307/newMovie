import { Hono } from 'hono'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

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
        maxDurationSeconds: 3600, // 최대 1시간
        expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30분 유효
        meta: { userId: c.get('userId') },
        requireSignedURLs: false,
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    return c.json({ error: `Stream API error: ${err}` }, 500)
  }

  const result = (await res.json()) as {
    result: { uploadURL: string; uid: string }
  }

  return c.json({
    uploadUrl: result.result.uploadURL,
    streamUid: result.result.uid,
  })
})

// 업로드 완료 후 상태 확인
app.get('/stream-status/:uid', requireAuth, async (c) => {
  const uid = c.req.param('uid')
  const { CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN } = c.env

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_STREAM_ACCOUNT_ID}/stream/${uid}`,
    {
      headers: { Authorization: `Bearer ${CF_STREAM_API_TOKEN}` },
    }
  )

  if (!res.ok) return c.json({ error: 'Not found' }, 404)

  const result = (await res.json()) as {
    result: {
      uid: string
      status: { state: string; pctComplete: string }
      duration: number
      thumbnail: string
    }
  }

  return c.json({
    uid: result.result.uid,
    state: result.result.status.state,
    pctComplete: result.result.status.pctComplete,
    duration: result.result.duration,
    thumbnail: result.result.thumbnail,
  })
})

export { app as upload }
