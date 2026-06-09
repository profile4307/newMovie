import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'
import { bunnyStorage } from '../lib/bunny-storage'

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

// 프로필 사진 업로드 (Supabase Storage)
app.post('/avatar', requireAuth, async (c) => {
  const userId = c.get('userId')

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ error: '파일 데이터를 읽을 수 없습니다' }, 400)
  }

  const file = formData.get('file') as Blob | null
  if (!file) {
    return c.json({ error: '파일이 없습니다' }, 400)
  }

  // CF Workers에서 file.type이 빈 문자열로 올 수 있음 → PNG로 폴백
  const mimeType = file.type || 'image/png'
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(mimeType)) {
    return c.json({ error: 'JPG, PNG, WEBP, GIF만 업로드 가능합니다' }, 400)
  }
  if (file.size > 2 * 1024 * 1024) {
    return c.json({ error: '파일 크기는 2MB 이하여야 합니다' }, 400)
  }

  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]
  // 유저별 폴더 + 타임스탬프 → 정리 쉽고, 매 업로드마다 새 CDN URL (캐시 우회)
  const ts = Date.now()
  const folder = `avatars/${userId}/`
  const path = `${folder}${ts}.${ext}`
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = c.env

  const storage = bunnyStorage(c.env)

  // ── 이전 아바타 파일 삭제 (Bunny Storage 절약) ──────────────────────
  try {
    const old = await storage.list(folder)
    await Promise.all(old.map((p) => storage.remove(p)))
  } catch {
    // 삭제 실패해도 업로드는 계속 진행
  }

  // Bunny Storage Zone에 업로드
  let avatarUrl: string
  try {
    avatarUrl = await storage.upload(path, await file.arrayBuffer(), mimeType)
  } catch (e) {
    return c.json({ error: `업로드 실패: ${e instanceof Error ? e.message : String(e)}` }, 500)
  }

  const db = createSupabaseClient(c.env)

  // 1) public.users 테이블 업데이트
  const { error } = await db.query(`/users?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ avatar_url: avatarUrl }),
  })
  if (error) return c.json({ error }, 500)

  // 2) Supabase Auth user_metadata 업데이트
  //    → 새로고침 후에도 올바른 아바타가 session에서 읽힘
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_metadata: { avatar_url: avatarUrl } }),
  })

  return c.json({ avatar_url: avatarUrl })
})

export { app as auth }
