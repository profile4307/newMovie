# NewMovie

글로벌 동영상 공유 플랫폼. 운영 비용을 최소화하는 서버리스 아키텍처로 구축되었습니다.

## 기술 스택

| 영역 | 기술 | 비용 |
|------|------|------|
| 프론트엔드 | Next.js 14 (App Router) + Tailwind CSS | 무료 |
| 호스팅 | Cloudflare Pages | 무료 |
| API 서버 | Cloudflare Workers + Hono.js | 무료 (100k req/일) |
| 데이터베이스 | Supabase (PostgreSQL + RLS) | 무료 ~ $25/월 |
| 인증 | Supabase Auth | 무료 |
| 동영상 저장/전송 | Cloudflare Stream | $5/1,000분 저장 + $1/1,000분 시청 |

> AWS + VPS 대비 동등 트래픽에서 약 70~80% 비용 절감. Cloudflare R2를 통한 egress 비용 0원.

## 주요 기능

- **동영상 업로드** — Cloudflare Stream 직접 업로드, 자동 트랜스코딩(360p~1080p), HLS 스트리밍
- **추천 피드** — 시간 가중 좋아요 점수 기반 정렬 (`총점 = Σ daily_likes × (10 - 경과일)`)
- **구독 피드** — 구독 채널의 최신 영상을 업로드 시간 역순으로 표시
- **멀티 키워드 검색** — 띄어쓰기로 여러 단어 AND 검색, title + description + tags FTS
- **관련 영상 추천** — 현재 영상의 태그 기반 FTS, 없으면 같은 카테고리 최신 영상
- **영상 공유** — 링크 복사, X(트위터), Facebook 공유
- **채널 / 구독** — 채널 생성, 구독 토글 (race condition 방지 DB 함수)
- **댓글** — 대댓글 지원
- **글로벌 CDN** — Cloudflare 300+ PoP 자동 적용

## 시작하기

### 필수 조건

- Node.js 20+
- pnpm 8+
- [Supabase](https://supabase.com) 계정
- [Cloudflare](https://cloudflare.com) 계정 (Stream 활성화 필요)

### 1. 설치

```bash
git clone <repo>
cd newMovie
pnpm install --ignore-scripts
```

> `--ignore-scripts` 필수 — Windows 환경에서 `sharp`, `unrs-resolver` 빌드 스크립트 충돌

### 2. 데이터베이스 설정

Supabase 대시보드 → SQL 에디터에서 [`packages/db/schema.sql`](packages/db/schema.sql) 전체를 실행합니다.

생성되는 항목:
- 테이블: `users`, `channels`, `videos`, `likes`, `video_daily_likes`, `subscriptions`, `comments`, `reports`
- RLS 정책 (모든 테이블)
- RPC 함수: `toggle_like`, `toggle_subscription`, `increment_view_count`, `get_trending_videos`, `get_subscription_feed`, `search_videos`, `get_related_videos`

### 3. 환경변수 설정

**프론트엔드** — `apps/web/.env.local` 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8787
CF_STREAM_CUSTOMER_SUBDOMAIN=your-customer-subdomain
```

**API** — `apps/api/.dev.vars` 생성:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CF_STREAM_ACCOUNT_ID=your-cloudflare-account-id
CF_STREAM_API_TOKEN=your-stream-api-token
CF_STREAM_CUSTOMER_SUBDOMAIN=your-customer-subdomain
ALLOWED_ORIGINS=http://localhost:3000
```

> `CF_STREAM_CUSTOMER_SUBDOMAIN`은 Cloudflare Stream 대시보드 → 동영상 선택 → "Use Stream Player" 섹션에서 확인

### 4. 개발 서버 실행

```bash
# 터미널 1 — API (http://localhost:8787)
pnpm dev:api

# 터미널 2 — 프론트엔드 (http://localhost:3000)
pnpm dev:web
```

## 배포

### Cloudflare Workers (API)

```bash
cd apps/api
npx wrangler deploy
```

Cloudflare 대시보드 → Workers → 해당 Worker → Settings → Variables에서 환경변수를 등록합니다.

### Cloudflare Pages (프론트엔드)

Cloudflare Pages에서 GitHub 저장소를 연결하고 아래와 같이 설정합니다:

| 항목 | 값 |
|------|-----|
| Framework preset | Next.js |
| Build command | `pnpm build:web` |
| Build output directory | `apps/web/.next` |
| Root directory | `/` |

빌드 환경변수에 `NEXT_PUBLIC_*` 값들을 추가합니다.

## 프로젝트 구조

```
newMovie/
├── apps/
│   ├── web/                  # Next.js 프론트엔드
│   │   └── src/
│   │       ├── app/          # App Router 페이지
│   │       ├── components/   # UI 컴포넌트
│   │       └── lib/          # API 클라이언트, Supabase
│   └── api/                  # Cloudflare Workers API
│       └── src/
│           ├── routes/       # videos, channels, upload, comments, auth
│           ├── middleware/   # 인증 미들웨어
│           └── lib/          # Supabase fetch 클라이언트
└── packages/
    └── db/
        └── schema.sql        # PostgreSQL 스키마 + RPC 함수
```

## API 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/videos` | 동영상 목록 (feed, search, category, page) | - |
| GET | `/api/videos/:id` | 동영상 상세 | - |
| GET | `/api/videos/:id/related` | 관련 영상 | - |
| POST | `/api/videos` | 동영상 등록 | ✅ |
| PUT | `/api/videos/:id` | 동영상 수정 | ✅ |
| POST | `/api/videos/:id/like` | 좋아요 토글 | ✅ |
| GET | `/api/channels/:id` | 채널 조회 | - |
| GET | `/api/channels/:id/videos` | 채널 동영상 목록 | - |
| POST | `/api/channels` | 채널 생성 | ✅ |
| POST | `/api/channels/:id/subscribe` | 구독 토글 | ✅ |
| POST | `/api/upload/stream-url` | 업로드 URL 발급 | ✅ |
| GET | `/api/upload/stream-status/:uid` | 트랜스코딩 상태 | ✅ |
| GET | `/api/comments?video_id=` | 댓글 목록 | - |
| POST | `/api/comments` | 댓글 작성 | ✅ |
| DELETE | `/api/comments/:id` | 댓글 삭제 | ✅ |
| GET | `/api/auth/me` | 내 프로필 | ✅ |
| POST | `/api/auth/profile` | 프로필 생성/수정 | ✅ |

피드 파라미터: `?feed=trending` (기본) / `?feed=subscriptions` / `?feed=latest`

## 추천 점수 알고리즘

```
총점 = (오늘 좋아요 × 10) + (1일 전 × 9) + (2일 전 × 8) + ... + (9일 전 × 1)
```

좋아요 발생 시 `video_daily_likes` 테이블에 날짜별로 집계되며, `get_trending_videos` RPC가 실시간으로 계산합니다.

## 비용 추정

| 단계 | MAU | 예상 월 비용 |
|------|-----|-------------|
| 초기 | 1,000명 | ~$7 |
| 성장 | 50,000명 | ~$155 |
