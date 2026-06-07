import { Hono } from 'hono'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

type Variables = AuthVariables

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

const BUNNY_API = 'https://video.bunnycdn.com'

// SHA-256 해시 (tus 서명 생성용)
async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Bunny 비디오 상태코드 → 공통 state 문자열 변환
function bunnyStatusToState(status: number): string {
  if (status === 4) return 'ready'
  if (status === 5 || status === 6) return 'error'
  return 'processing'
}

// Bunny 비디오 생성 + tus 인증 정보 발급
app.post('/stream-url', requireAuth, async (c) => {
  const { BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY } = c.env

  // 1. Bunny에 비디오 항목 생성
  const createRes = await fetch(`${BUNNY_API}/library/${BUNNY_STREAM_LIBRARY_ID}/videos`, {
    method: 'POST',
    headers: {
      AccessKey: BUNNY_STREAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: `upload_${Date.now()}`, isPublic: true }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    return c.json({ error: `Bunny API error: ${err}` }, 500)
  }

  const video = (await createRes.json()) as { guid: string }
  const videoId = video.guid

  // 2. tus 업로드 서명 생성 (1시간 유효)
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const signature = await sha256(BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY + expiry + videoId)

  return c.json({
    streamUid: videoId,
    tusSignature: signature,
    tusExpiry: expiry,
    tusLibraryId: BUNNY_STREAM_LIBRARY_ID,
  })
})

// 트랜스코딩 상태 확인
app.get('/stream-status/:uid', requireAuth, async (c) => {
  const uid = c.req.param('uid')
  const { BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY } = c.env

  const res = await fetch(`${BUNNY_API}/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${uid}`, {
    headers: { AccessKey: BUNNY_STREAM_API_KEY },
  })

  if (!res.ok) return c.json({ error: 'Not found' }, 404)

  const video = (await res.json()) as {
    guid: string
    status: number
    encodeProgress: number
    length: number
    thumbnailFileName: string
  }

  const state = bunnyStatusToState(video.status)

  // 트랜스코딩 완료 시 target_status로 전환
  if (state === 'ready') {
    const db = createSupabaseClient(c.env)
    const { data: videos } = await db.query<{ target_status: string }[]>(
      `/videos?select=target_status&stream_uid=eq.${uid}&limit=1`
    )
    const targetStatus = videos?.[0]?.target_status ?? 'published'
    const thumbnailUrl = video.thumbnailFileName
      ? `https://${c.env.BUNNY_CDN_HOSTNAME}/${uid}/${video.thumbnailFileName}`
      : undefined

    await db.query(`/videos?stream_uid=eq.${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: targetStatus,
        duration: video.length ? Math.floor(video.length) : undefined,
        thumbnail_url: thumbnailUrl,
      }),
    })
  }

  return c.json({
    uid: video.guid,
    state,
    pctComplete: String(video.encodeProgress ?? 0),
    duration: video.length,
    thumbnail: video.thumbnailFileName
      ? `https://${c.env.BUNNY_CDN_HOSTNAME}/${uid}/${video.thumbnailFileName}`
      : '',
  })
})

// Bunny 웹훅 — 트랜스코딩 완료 시 자동 호출
app.post('/webhook', async (c) => {
  const { BUNNY_WEBHOOK_SECRET, BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_CDN_HOSTNAME } = c.env as Env & { BUNNY_WEBHOOK_SECRET?: string }

  const body = (await c.req.json()) as {
    VideoLibraryId?: number
    VideoGuid?: string
    Status?: number
  }

  // 시크릿 검증 (설정된 경우)
  if (BUNNY_WEBHOOK_SECRET) {
    const sig = c.req.header('BunnyCDN-Signature') ?? c.req.header('Webhook-Signature')
    if (!sig || sig !== BUNNY_WEBHOOK_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  if (body.Status === 4 && body.VideoGuid) {
    const uid = body.VideoGuid

    // 썸네일 URL 조회 (완료 후 Bunny에서 확인)
    const infoRes = await fetch(`${BUNNY_API}/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${uid}`, {
      headers: { AccessKey: BUNNY_STREAM_API_KEY },
    })
    let thumbnailUrl: string | undefined
    let duration: number | undefined
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { thumbnailFileName: string; length: number }
      thumbnailUrl = info.thumbnailFileName
        ? `https://${BUNNY_CDN_HOSTNAME}/${uid}/${info.thumbnailFileName}`
        : undefined
      duration = info.length ? Math.floor(info.length) : undefined
    }

    const db = createSupabaseClient(c.env)
    const { data: videos } = await db.query<{ target_status: string }[]>(
      `/videos?select=target_status&stream_uid=eq.${uid}&limit=1`
    )
    const targetStatus = videos?.[0]?.target_status ?? 'published'
    await db.query(`/videos?stream_uid=eq.${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: targetStatus,
        duration,
        thumbnail_url: thumbnailUrl,
      }),
    })
  }

  return c.json({ ok: true })
})

export { app as upload }
