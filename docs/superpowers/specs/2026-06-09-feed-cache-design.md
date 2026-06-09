# Feed Cache (KV + Cron Trigger) 설계 문서

**날짜:** 2026-06-09  
**목적:** 메인페이지 DB 트래픽 최소화 — 매 요청마다 발생하던 trending/latest 쿼리를 Cloudflare Workers KV에 캐시하고 Cron Trigger로 주기적으로 갱신한다.

---

## 배경 및 문제

메인페이지는 매 요청마다 두 개의 DB 쿼리를 병렬 실행한다:
- `get_trending_videos()` RPC (시간 가중치 좋아요 점수 계산, 비용 높음)
- 최신순 REST 쿼리 (`/videos?order=created_at.desc`)

트래픽이 증가할수록 Supabase DB 부하와 과금이 선형으로 증가한다.  
trending/latest 피드는 사용자별 개인화가 없고 자주 변하지 않으므로 캐시에 적합하다.

---

## 설계 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 캐시 스토어 | Cloudflare Workers KV | Workers 내장, 읽기 $0.50/100만으로 거의 무료 |
| 갱신 방식 | Cloudflare Cron Trigger | DB 쿼리 횟수 완전히 예측 가능, thundering herd 없음 |
| 카테고리 필터 | in-memory (캐시 후 필터) | KV 항목 수 최소화, 저장 비용 절감 |
| 캐시 크기 | 50개 | 20개 페이지 표시 + 카테고리 필터 여유분 |

---

## 아키텍처

```
[Cron Trigger: */N * * * *]
        │
        ▼
refreshFeedCache(env)
  ├─ DB: get_trending_videos(limit=50)
  ├─ DB: /videos?order=created_at.desc&limit=50
  └─ KV.put('feed:trending', JSON)
     KV.put('feed:latest', JSON)

[사용자 요청: GET /api/videos?feed=trending&category=게임]
        │
        ▼
KV.get('feed:trending')
  ├─ 히트: category 필터 in-memory → page/limit 슬라이싱 → 응답
  └─ 미스: 기존 DB 쿼리 폴백 (캐시 워밍 전 또는 장애 시)
```

---

## 설정 변수 (wrangler.toml)

```toml
[vars]
ENVIRONMENT = "development"
FEED_CACHE_TTL_MINUTES = "30"   # 캐시 갱신 주기(분) — [triggers].crons 와 함께 수정
FEED_CACHE_SIZE = "50"           # 캐시할 영상 수 (카테고리 필터 여유분)

[[kv_namespaces]]
binding = "FEED_CACHE"
id = ""          # wrangler kv:namespace create FEED_CACHE 실행 후 입력
id_preview = ""  # 로컬 개발용 preview namespace ID

[triggers]
crons = ["*/30 * * * *"]   # FEED_CACHE_TTL_MINUTES 변경 시 함께 수정
```

> ⚠️ `FEED_CACHE_TTL_MINUTES`와 `[triggers].crons`는 동일한 주기를 가리키므로 반드시 함께 수정한다.

---

## 파일 변경 목록

### 신규: `apps/api/src/lib/feed-cache.ts`

책임: DB에서 trending/latest 피드를 조회하고 KV에 저장하는 단일 함수.

```typescript
export async function refreshFeedCache(env: Env): Promise<void>
```

- `get_trending_videos(p_limit: FEED_CACHE_SIZE)` RPC 호출
- `/videos?order=created_at.desc&limit=FEED_CACHE_SIZE` REST 호출
- 두 결과에 `attachChannels()` 적용 (채널 정보 포함)
- KV에 저장: `{ data: Video[], cachedAt: ISO string }`
- KV TTL: `FEED_CACHE_TTL_MINUTES * 60 * 2` (갱신 주기의 2배 — 장애 시 stale 데이터 유지)

### 수정: `apps/api/src/index.ts`

1. `Env` 타입에 추가:
   ```typescript
   FEED_CACHE: KVNamespace
   FEED_CACHE_TTL_MINUTES: string
   FEED_CACHE_SIZE: string
   ```

2. `scheduled` 핸들러 추가:
   ```typescript
   export default {
     fetch: app.fetch,
     async scheduled(_: ScheduledEvent, env: Env, ctx: ExecutionContext) {
       ctx.waitUntil(refreshFeedCache(env))
     }
   }
   ```

### 수정: `apps/api/src/routes/videos.ts`

`GET /` 핸들러의 trending/latest 분기에 KV 읽기 추가:

```typescript
// trending
if (feed === 'trending') {
  const cached = await c.env.FEED_CACHE?.get('feed:trending', 'json') as CachedFeed | null
  if (cached?.data) {
    let result = cached.data
    if (category) result = result.filter(v => v.category === category)
    const sliced = result.slice(offset, offset + limit)
    return c.json({ data: sliced, feed, page, limit })
  }
  // 폴백: 기존 DB 로직 유지
  ...
}
// latest도 동일 패턴 (`feed:latest` 키 사용)
```

---

## KV 데이터 구조

```typescript
// KV 키: "feed:trending" 또는 "feed:latest"
interface CachedFeed {
  data: Video[]          // attachChannels() 포함된 완전한 Video 객체
  cachedAt: string       // ISO 8601 타임스탬프
}
```

---

## 비용 계산 (하루 10만 요청 기준)

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| DB 쿼리/일 | 20만 건 | 96건 (30분 기준) |
| KV 읽기/월 | 0 | ~600만 건 → **$3** |
| KV 쓰기/월 | 0 | ~2,880건 → **$0.01 미만** |
| Cron | 0 | 무료 (5개 포함) |

DB 쿼리 **99.95% 절감**.

---

## 검증 방법

```bash
# 1. KV 네임스페이스 생성
cd apps/api && npx wrangler kv:namespace create FEED_CACHE
# 출력된 id를 wrangler.toml의 id에 입력

# 2. Preview namespace 생성 (로컬 개발용)
npx wrangler kv:namespace create FEED_CACHE --preview
# 출력된 id를 wrangler.toml의 id_preview에 입력

# 3. 개발 서버 실행
pnpm dev:api

# 4. Cron 수동 트리거 (로컬 테스트)
curl "http://localhost:8787/__scheduled?cron=*%2F30+*+*+*+*"

# 5. 캐시 확인
npx wrangler kv:key list --namespace-id=<ID>
npx wrangler kv:key get "feed:trending" --namespace-id=<ID>

# 6. API 테스트
curl "http://localhost:8787/api/videos?feed=trending"
curl "http://localhost:8787/api/videos?feed=latest&category=게임"
```

응답에서 `cached: true` 필드 (선택적으로 추가 가능) 또는 응답 속도 차이로 캐시 동작 확인.

---

## 주의사항

- `FEED_CACHE_TTL_MINUTES`와 `[triggers].crons`는 항상 일치시킨다 (코드로 cron 주기 동적 변경 불가).
- KV 네임스페이스 ID는 프로젝트마다 고유 — `.dev.vars.example`에는 빈 값으로 유지.
- 첫 배포 후 첫 번째 Cron 실행 전까지는 DB 폴백으로 동작 (정상).
- Workers 로컬(`wrangler dev`)에서 KV는 인메모리 시뮬레이션으로 동작 (별도 namespace 불필요).
