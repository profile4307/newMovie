import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Env } from '../index'
import { requireAuth, AuthVariables } from '../middleware/auth'
import { createSupabaseClient } from '../lib/supabase'

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

  // 파일 검증
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'JPG, PNG, WEBP, GIF만 업로드 가능합니다' }, 400)
  }
  if (file.size > 2 * 1024 * 1024) {
    return c.json({ error: '파일 크기는 2MB 이하여야 합니다' }, 400)
  }

  const ext = file.type.split('/')[1]
  const path = `${userId}.${ext}`
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = c.env

  // Supabase Storage에 업로드 (upsert)
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/avatars/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: await file.arrayBuffer(),
    }
  )

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    return c.json({ error: `업로드 실패: ${err}` }, 500)
  }

  const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`

  // users 테이블 업데이트
  const db = createSupabaseClient(c.env)
  const { error } = await db.query(`/users?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ avatar_url: avatarUrl }),
  })
  if (error) return c.json({ error }, 500)

  return c.json({ avatar_url: avatarUrl })
})

export { app as auth }
