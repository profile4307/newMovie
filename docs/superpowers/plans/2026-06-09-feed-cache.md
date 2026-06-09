# Feed Cache (KV + Cron Trigger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인페이지 trending/latest 피드를 Cloudflare Workers KV에 캐시하고 Cron Trigger로 주기적으로 갱신해 DB 트래픽을 99%+ 절감한다.

**Architecture:** Cron Trigger가 설정된 주기(기본 30분)마다 DB에서 trending/latest 피드를 조회해 KV에 저장한다. 사용자 요청은 KV에서 먼저 읽고, 비인기 카테고리나 캐시 범위 초과 시만 DB로 폴백한다. `attachChannels`는 순환 import 방지를 위해 `lib/channels.ts`로 추출한다.

**Tech Stack:** Cloudflare Workers KV, Cron Trigger, Hono.js, TypeScript, `@cloudflare/workers-types` v4

---

## 파일 구조

| 상태 | 파일 | 변경 내용 |
|------|------|-----------|
| 신규 | `apps/api/src/lib/channels.ts` | `attachChannels` 함수 추출 (videos.ts → lib) |
| 신규 | `apps/api/src/lib/feed-cache.ts` | `refreshFeedCache`, `CachedFeed` 타입 |
| 수정 | `apps/api/wrangler.toml` | KV namespace, cron trigger, vars 추가 |
| 수정 | `apps/api/src/index.ts` | `Env` 타입 추가 + `scheduled` 핸들러 |
| 수정 | `apps/api/src/routes/videos.ts` | `attachChannels` import 변경 + KV 읽기 로직 |

---

## Task 1: wrangler.toml 업데이트

**Files:**
- Modify: `apps/api/wrangler.toml`

- [ ] **Step 1: wrangler.toml에 KV, cron, config vars 추가**

`apps/api/wrangler.toml` 전체를 아래로 교체한다:

```toml
name = "newmovie-api"
main = "src/index.ts"
compatibility_date = "2024-07-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "development"
FEED_CACHE_TTL_MINUTES = "30"   # 캐시 갱신 주기(분) — [triggers].crons 와 함께 수정
FEED_CACHE_SIZE = "50"           # 캐시할 영상 수 (카테고리 필터 여유분)

# KV namespace for feed caching
# 처음 설정 시: npx wrangler kv namespace create FEED_CACHE
# 출력된 id를 아래에 입력
[[kv_namespaces]]
binding = "FEED_CACHE"
id = ""          # wrangler kv namespace create FEED_CACHE 실행 후 입력
id_preview = ""  # wrangler kv namespace create FEED_CACHE --preview 실행 후 입력

[triggers]
crons = ["*/30 * * * *"]   # FEED_CACHE_TTL_MINUTES 변경 시 함께 수정

# R2 bucket for original video storage
# [[r2_buckets]]
# binding = "VIDEO_BUCKET"
# bucket_name = "newmovie-videos"
```

- [ ] **Step 2: 타입 체크**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 에러 없음 (아직 `Env` 타입에 `FEED_CACHE`가 없어 다음 Task에서 처리)

- [ ] **Step 3: 커밋**

```bash
git add apps/api/wrangler.toml
git commit -m "chore: wrangler.toml에 KV namespace, cron trigger, feed cache vars 추가"
```

---

## Task 2: `attachChannels`를 `lib/channels.ts`로 추출

**Files:**
- Create: `apps/api/src/lib/channels.ts`
- Modify: `apps/api/src/routes/videos.ts`

`feed-cache.ts`와 `videos.ts` 둘 다 `attachChannels`가 필요한데, 서로 import하면 순환 참조가 된다. 공유 lib으로 추출한다.

- [ ] **Step 1: `lib/channels.ts` 파일 생성**

```typescript
// apps/api/src/lib/channels.ts
import { SupabaseClient } from './supabase'

export async function attachChannels<T extends { channel_id: string }>(
  db: SupabaseClient,
  videos: T[]
): Promise<(T & { channel: { id: string; name: string; avatar_url: string | null } })[]> {
  if (videos.length === 0) return []
  const ids = [...new Set(videos.map((v) => v.channel_id))]
  const inFilter = ids.map((id) => `"${id}"`).join(',')
  const { data: channels } = await db.query<
    { id: string; name: string; avatar_url: string | null; owner: { avatar_url: string | null } | null }[]
  >(`/channels?select=id,name,avatar_url,owner:users!owner_id(avatar_url)&id=in.(${inFilter})`)

  const channelMap = Object.fromEntries(
    (channels ?? []).map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        // channel avatar 없으면 채널 소유자의 user avatar로 fallback
        avatar_url: c.avatar_url || c.owner?.avatar_url || null,
      },
    ])
  )
  return videos.map((v) => ({
    ...v,
    channel: channelMap[v.channel_id] ?? { id: v.channel_id, name: '', avatar_url: null },
  }))
}
```

- [ ] **Step 2: `videos.ts`에서 기존 `attachChannels` 함수 제거 + import 추가**

`apps/api/src/routes/videos.ts` 상단에서 아래 import 추가 (기존 import 다음 줄):

```typescript
import { attachChannels } from '../lib/channels'
```

그리고 파일 내 `attachChannels` 함수 정의 블록 (아래)을 삭제한다:

```typescript
// 삭제할 블록 (lines 18-45 근처):
// 채널 정보를 video 배열에 병합
async function attachChannels<T extends { channel_id: string }>(
  db: ReturnType<typeof createSupabaseClient>,
  videos: T[]
): Promise<(T & { channel: { id: string; name: string; avatar_url: string | null } })[]> {
  if (videos.length === 0) return []
  ...
}
```

- [ ] **Step 3: 타입 체크**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add apps/api/src/lib/channels.ts apps/api/src/routes/videos.ts
git commit -m "refactor: attachChannels를 lib/channels.ts로 추출"
```

---

## Task 3: `lib/feed-cache.ts` 신규 작성

**Files:**
- Create: `apps/api/src/lib/feed-cache.ts`

- [ ] **Step 1: `feed-cache.ts` 생성**

```typescript
// apps/api/src/lib/feed-cache.ts
import { Env } from '../index'
import { createSupabaseClient } from './supabase'
import { attachChannels } from './channels'

type FeedVideoRow = {
  id: string
  title: string
  description: string
  thumbnail_url: string | null
  stream_uid: string
  duration: number | null
  view_count: number
  like_count: number
  category: string | null
  tags: string[]
  created_at: string
  channel_id: string
}

export type CachedVideo = FeedVideoRow & {
  channel: { id: string; name: string; avatar_url: string | null }
}

export interface CachedFeed {
  data: CachedVideo[]
  cachedAt: string
}

export async function refreshFeedCache(env: Env): Promise<void> {
  const db = createSupabaseClient(env)
  const size = parseInt(env.FEED_CACHE_SIZE ?? '50', 10)
  const ttlMinutes = parseInt(env.FEED_CACHE_TTL_MINUTES ?? '30', 10)
  const ttlSeconds = ttlMinutes * 60 * 2 // 갱신 주기의 2배 — 장애 시 stale 데이터 유지

  // Trending 피드
  const { data: trendingRaw, error: tErr } = await db.rpc<FeedVideoRow[]>(
    'get_trending_videos',
    { p_limit: size, p_offset: 0 }
  )
  if (!tErr && trendingRaw && trendingRaw.length > 0) {
    const trending = await attachChannels(db, trendingRaw)
    const payload: CachedFeed = { data: trending, cachedAt: new Date().toISOString() }
    await env.FEED_CACHE.put('feed:trending', JSON.stringify(payload), {
      expirationTtl: ttlSeconds,
    })
  }

  // Latest 피드
  const { data: latestRaw, error: lErr } = await db.query<FeedVideoRow[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${size}&offset=0`
  )
  if (!lErr && latestRaw && latestRaw.length > 0) {
    const latest = await attachChannels(db, latestRaw)
    const payload: CachedFeed = { data: latest, cachedAt: new Date().toISOString() }
    await env.FEED_CACHE.put('feed:latest', JSON.stringify(payload), {
      expirationTtl: ttlSeconds,
    })
  }
}
```

- [ ] **Step 2: 타입 체크 (`Env`에 `FEED_CACHE`가 아직 없어서 에러 예상 — 다음 Task에서 해결)**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: `FEED_CACHE` 관련 에러 (다음 Task에서 `Env` 타입 추가하면 해결됨)

- [ ] **Step 3: 커밋 (타입 에러 있어도 커밋 — 다음 Task와 묶어서 해결됨)**

```bash
git add apps/api/src/lib/feed-cache.ts
git commit -m "feat: feed-cache.ts 신규 — refreshFeedCache, CachedFeed 타입"
```

---

## Task 4: `index.ts` — Env 타입 + scheduled 핸들러

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: `Env` 타입에 KV 바인딩 및 config vars 추가**

`apps/api/src/index.ts`의 `Env` 타입 블록을 아래로 교체한다:

```typescript
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
  // Feed cache
  FEED_CACHE: KVNamespace
  FEED_CACHE_TTL_MINUTES: string
  FEED_CACHE_SIZE: string
}
```

- [ ] **Step 2: `scheduled` 핸들러 추가 — `export default app` 교체**

파일 맨 위에 import 추가:

```typescript
import { refreshFeedCache } from './lib/feed-cache'
```

파일 맨 아래의 `export default app`을 아래로 교체한다:

```typescript
export default {
  fetch: app.fetch,
  // workers-types v4: 첫 인자는 ScheduledController
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshFeedCache(env))
  },
}
```

- [ ] **Step 3: 타입 체크**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add apps/api/src/index.ts
git commit -m "feat: Env 타입에 FEED_CACHE KV 바인딩 추가 + scheduled 핸들러"
```

---

## Task 5: `videos.ts` — KV 읽기 + 폴백 로직

**Files:**
- Modify: `apps/api/src/routes/videos.ts`

- [ ] **Step 1: `CachedFeed` import 추가**

`apps/api/src/routes/videos.ts` 상단 import 블록에 추가:

```typescript
import { CachedFeed } from '../lib/feed-cache'
```

- [ ] **Step 2: trending 분기 교체**

현재 코드 (lines 94-104):
```typescript
    // 추천 피드 (기본)
    if (feed === 'trending') {
      const { data, error } = await db.rpc<
        { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string; trend_score: number }[]
      >('get_trending_videos', { p_limit: limit, p_offset: offset })
      if (error) return c.json({ error }, 500)

      let result = data ?? []
      if (category) result = result.filter((v) => v.category === category)
      const withChannels = await attachChannels(db, result)
      return c.json({ data: withChannels, feed, page, limit })
    }
```

위 블록을 아래로 교체한다:
```typescript
    // 추천 피드 (기본)
    if (feed === 'trending') {
      // KV 캐시 읽기
      const cached = await c.env.FEED_CACHE.get<CachedFeed>('feed:trending', 'json')
      if (cached?.data) {
        let result = cached.data
        if (category) result = result.filter((v) => v.category === category)
        const underfilled = category != null && result.length < Math.ceil(limit / 2)
        const beyondCache = offset >= cached.data.length
        if (!underfilled && !beyondCache) {
          return c.json({ data: result.slice(offset, offset + limit), feed, page, limit })
        }
      }
      // DB 폴백: 캐시 미스 / 비인기 카테고리 (필터 결과 < limit/2) / page 범위 초과
      const { data, error } = await db.rpc<
        { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string; trend_score: number }[]
      >('get_trending_videos', { p_limit: limit, p_offset: offset })
      if (error) return c.json({ error }, 500)

      let result = data ?? []
      if (category) result = result.filter((v) => v.category === category)
      const withChannels = await attachChannels(db, result)
      return c.json({ data: withChannels, feed, page, limit })
    }
```

- [ ] **Step 3: latest 분기 교체**

현재 코드 (lines 107-116):
```typescript
    // 최신순
    let path = `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${limit}&offset=${offset}`
    if (category) path += `&category=eq.${encodeURIComponent(category)}`

    const { data, error } = await db.query<
      { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string }[]
    >(path)
    if (error) return c.json({ error }, 500)
    const withChannels = await attachChannels(db, data ?? [])
    return c.json({ data: withChannels, feed, page, limit })
```

위 블록을 아래로 교체한다:
```typescript
    // 최신순
    // KV 캐시 읽기
    const latestCached = await c.env.FEED_CACHE.get<CachedFeed>('feed:latest', 'json')
    if (latestCached?.data) {
      let result = latestCached.data
      if (category) result = result.filter((v) => v.category === category)
      const underfilled = category != null && result.length < Math.ceil(limit / 2)
      const beyondCache = offset >= latestCached.data.length
      if (!underfilled && !beyondCache) {
        return c.json({ data: result.slice(offset, offset + limit), feed, page, limit })
      }
    }
    // DB 폴백: 캐시 미스 / 비인기 카테고리 (필터 결과 < limit/2) / page 범위 초과
    let path = `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${limit}&offset=${offset}`
    if (category) path += `&category=eq.${encodeURIComponent(category)}`

    const { data, error } = await db.query<
      { id: string; title: string; description: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; like_count: number; category: string | null; tags: string[]; created_at: string; channel_id: string }[]
    >(path)
    if (error) return c.json({ error }, 500)
    const withChannels = await attachChannels(db, data ?? [])
    return c.json({ data: withChannels, feed, page, limit })
```

- [ ] **Step 4: 타입 체크**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/routes/videos.ts
git commit -m "feat: videos.ts trending/latest 피드에 KV 캐시 읽기 + DB 폴백 추가"
```

---

## Task 6: KV 네임스페이스 생성 및 동작 검증

**Files:**
- Modify: `apps/api/wrangler.toml` (ID 입력)

- [ ] **Step 1: KV 네임스페이스 생성**

```bash
cd apps/api

# 프로덕션용 namespace 생성
npx wrangler kv namespace create FEED_CACHE
# 출력 예시: { binding: 'FEED_CACHE', id: 'abc123...' }

# 로컬 개발용 preview namespace 생성
npx wrangler kv namespace create FEED_CACHE --preview
# 출력 예시: { binding: 'FEED_CACHE', preview_id: 'def456...' }
```

출력된 `id`와 `preview_id`를 `wrangler.toml`의 해당 필드에 입력한다:

```toml
[[kv_namespaces]]
binding = "FEED_CACHE"
id = "abc123..."          # 위에서 출력된 id
id_preview = "def456..."  # 위에서 출력된 preview_id
```

- [ ] **Step 2: `--test-scheduled` 모드로 개발 서버 실행**

```bash
# pnpm dev:api 대신 --test-scheduled 플래그 필요
npx wrangler dev --test-scheduled
```

Expected: 서버가 `http://localhost:8787`에서 실행됨

- [ ] **Step 3: Cron 수동 트리거 (캐시 워밍)**

새 터미널에서:

```bash
curl "http://localhost:8787/__scheduled?cron=*%2F30+*+*+*+*"
```

Expected: `{"outcome":"ok"}` 또는 빈 응답 (Workers scheduled handler 정상 실행)

- [ ] **Step 4: 캐시 히트 확인**

```bash
# trending 피드 조회 — 캐시 히트 시 빠른 응답
curl "http://localhost:8787/api/videos?feed=trending"
# 응답 예시: {"data":[...],"feed":"trending","page":1,"limit":20}

# latest 피드 조회
curl "http://localhost:8787/api/videos?feed=latest"

# 카테고리 필터 (인기 카테고리 — 캐시에서 in-memory 필터)
curl "http://localhost:8787/api/videos?feed=latest&category=%EA%B2%8C%EC%9E%84"
```

- [ ] **Step 5: KV 저장 내용 확인**

```bash
# 로컬 wrangler dev KV는 인메모리라 wrangler kv key get이 안 됨
# 배포 후 확인하려면:
npx wrangler kv key list --namespace-id=<위에서 입력한 id>
npx wrangler kv key get "feed:trending" --namespace-id=<id>
```

- [ ] **Step 6: 최종 커밋**

```bash
git add apps/api/wrangler.toml
git commit -m "chore: wrangler.toml에 KV namespace ID 입력"
```

---

## 스펙 커버리지 자가 검토

| 스펙 요구사항 | 구현 Task |
|-------------|-----------|
| trending/latest KV 캐시 | Task 3 (feed-cache.ts), Task 5 (videos.ts) |
| Cron Trigger 갱신 | Task 1 (wrangler.toml), Task 4 (index.ts scheduled) |
| FEED_CACHE_TTL_MINUTES 설정 변수 | Task 1, Task 3 |
| FEED_CACHE_SIZE 설정 변수 | Task 1, Task 3 |
| 카테고리 in-memory 필터 | Task 5 |
| 비인기 카테고리 DB 폴백 | Task 5 (underfilled 조건) |
| page 범위 초과 DB 폴백 | Task 5 (beyondCache 조건) |
| 캐시 미스 DB 폴백 | Task 5 (cached == null 경로) |
| subscriptions/search — DB 유지 | 변경 없음 (기존 로직 유지) |
| ScheduledController 타입 (v4) | Task 4 |
| attachChannels 순환 import 방지 | Task 2 (lib/channels.ts 추출) |
