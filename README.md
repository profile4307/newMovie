# NewMovie

글로벌 동영상 공유 플랫폼. 운영 비용을 최소화하는 서버리스 아키텍처로 구축되었습니다.

## 라이브

| | URL |
|------|------|
| 웹 | https://new-movie.profile4307.workers.dev |
| API | https://newmovie-api.profile4307.workers.dev |

## 기술 스택

| 영역 | 기술 | 비용 |
|------|------|------|
| 프론트엔드 | Next.js 16 (App Router) + Tailwind CSS | 무료 |
| 웹 호스팅 | Cloudflare Workers ([OpenNext](https://opennext.js.org/cloudflare) 어댑터, SSR) | 무료 (100k req/일) |
| API 서버 | Cloudflare Workers + Hono.js | 무료 (100k req/일) |
| 피드 캐시 | Cloudflare Workers KV + Cron Trigger | 무료 (읽기 10만/일) |
| 데이터베이스 | Supabase (PostgreSQL + RLS) | 무료 ~ $25/월 |
| 인증 | Supabase Auth (이메일 + Google OAuth) | 무료 |
| 이미지 저장 (썸네일·아바타) | Bunny Storage Zone + CDN | ~$0.01/GB |
| 동영상 저장/전송 | Bunny Stream | ~$0.005/1,000분 저장 + $0.009~$0.045/GB 전송 |

## 주요 기능

- **동영상 업로드** — Bunny Stream tus 직접 업로드, 자동 트랜스코딩, HLS 스트리밍
- **공개 설정** — 전체공개 / 일부공개(링크 공유) / 비공개, 업로드 및 이후 변경 가능
- **메인 피드 캐싱** — 추천·최신 피드를 Cron Trigger로 주기적으로(기본 30분) 미리 만들어 Workers KV에 저장 → 매 요청마다의 DB 조회를 제거해 트래픽·비용 절감 (캐시 미스/비인기 카테고리는 DB 폴백)
- **Google 로그인** — Supabase Auth OAuth, 클라이언트 `/auth/callback`에서 세션 설정
- **추천 피드** — 시간 가중 좋아요 점수 기반 정렬 (`총점 = Σ daily_likes × (10 - 경과일)`)
- **구독 피드** — 구독 채널의 최신 영상을 업로드 시간 역순으로 표시
- **멀티 키워드 검색** — 띄어쓰기로 여러 단어 AND 검색, title + description + tags FTS
- **관련 영상 추천** — 현재 영상의 태그 기반 FTS, 없으면 같은 카테고리 최신 영상
- **영상 공유** — 링크 복사, X(트위터), Facebook 공유
- **채널 / 구독** — 채널 생성, 구독 토글, 구독자수 표시 (한국식 단위: 천/만)
- **내 동영상 관리** — 수정, 삭제, 공개 설정 변경, 트랜스코딩 상태 확인
- **프로필 사진 변경** — 헤더 아바타 클릭으로 Supabase Storage에 직접 업로드
- **댓글** — 영상별 댓글 작성/삭제

## 시작하기

### 필수 조건

- Node.js 20+
- pnpm 8+
- [Supabase](https://supabase.com) 계정
- [Bunny.net](https://bunny.net) 계정 (Stream 라이브러리 생성 필요)

### 1. 설치

```bash
git clone <repo>
cd newMovie
pnpm install --ignore-scripts
```

> `--ignore-scripts` 필수 — `sharp`, `unrs-resolver` 빌드 스크립트 충돌 방지

### 2. 데이터베이스 설정

Supabase 대시보드 → SQL 에디터에서 [`packages/db/schema.sql`](packages/db/schema.sql) 전체를 실행합니다.

생성되는 항목:
- 테이블: `users`, `channels`, `videos`, `likes`, `video_daily_likes`, `subscriptions`, `comments`
- RLS 정책 (모든 테이블)
- RPC 함수: `toggle_like`, `toggle_subscription`, `increment_view_count`, `get_trending_videos`, `get_subscription_feed`, `get_subscription_feed_by_channel`, `search_videos`, `get_related_videos`

**프로필 사진 Storage 설정** — Supabase 대시보드 → Storage → New bucket:
- Bucket name: `avatars`, Public bucket: **체크**

그 후 SQL 에디터에서 실행:
```sql
create policy "공개 읽기" on storage.objects for select using (bucket_id = 'avatars');
create policy "인증 사용자 업로드" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "본인 파일 수정" on storage.objects for update to authenticated using (bucket_id = 'avatars');
```

### 3. Bunny Stream 설정

1. [bunny.net](https://bunny.net) → **Stream** → **Add Video Library** 생성
2. **Library ID** 확인 (숫자)
3. **API Key** 탭에서 Stream API Key 복사
4. 생성된 **Pull Zone** 호스트명 확인 (예: `vz-xxxx.b-cdn.net`)
5. Stream 라이브러리 → **Security** → **Block direct url file access** **비활성화** (썸네일/영상 403 방지)

### 4. 환경변수 설정

**프론트엔드** — `apps/web/.env.local` 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_BUNNY_CDN_HOSTNAME=vz-xxxx.b-cdn.net
```

**API** — `apps/api/.dev.vars` 생성:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
BUNNY_STREAM_LIBRARY_ID=your-library-id
BUNNY_STREAM_API_KEY=your-stream-api-key
BUNNY_CDN_HOSTNAME=vz-xxxx.b-cdn.net
BUNNY_WEBHOOK_SECRET=your-webhook-secret
# Bunny Storage Zone (썸네일·아바타)
BUNNY_STORAGE_ZONE_NAME=your-storage-zone-name
BUNNY_STORAGE_PASSWORD=your-storage-zone-api-password
BUNNY_STORAGE_HOSTNAME=your-pull-zone.b-cdn.net
BUNNY_STORAGE_ENDPOINT=sg.storage.bunnycdn.com
ALLOWED_ORIGINS=http://localhost:3000
```

> 피드 캐시 설정(`FEED_CACHE_TTL_MINUTES`, `FEED_CACHE_SIZE`)과 Cron 주기는 `apps/api/wrangler.toml`에서 관리합니다. 로컬에서 Cron을 테스트하려면 `npx wrangler dev --test-scheduled` 후 `curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"`로 캐시를 워밍합니다 (KV 바인딩이 없으면 자동 DB 폴백).

### 5. 개발 서버 실행

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

# 최초 1회: 피드 캐시용 KV 네임스페이스 생성 후 wrangler.toml의 id/preview_id 입력
npx wrangler kv namespace create FEED_CACHE
npx wrangler kv namespace create FEED_CACHE --preview

# 프로덕션 secret 등록 (최초 1회, 값마다 1회)
npx wrangler secret put SUPABASE_URL          # 그 외 SUPABASE_*, BUNNY_*, ALLOWED_ORIGINS 모두
npx wrangler secret put ALLOWED_ORIGINS        # 예: https://new-movie.<sub>.workers.dev,http://localhost:3000

# 배포 (Cron Trigger */30 * * * * 와 FEED_CACHE 바인딩이 wrangler.toml에서 함께 등록됨)
npx wrangler deploy
```

> `wrangler.toml`의 `[vars]`(ENVIRONMENT, FEED_CACHE_*)는 배포 시 자동 반영됩니다. 비밀값(`SUPABASE_*`, `BUNNY_*`, `ALLOWED_ORIGINS`)만 `wrangler secret put`으로 등록하세요.

### Cloudflare Workers (프론트엔드 — OpenNext)

Next.js SSR 앱을 [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)로 Workers에 배포합니다. **GitHub 연동(Workers Builds)을 권장** — Cloudflare가 Linux에서 빌드하므로 로컬 환경 의존성이 없습니다.

Cloudflare 대시보드 → Workers & Pages → Create → Workers → **Connect to Git**:

| 항목 | 값 |
|------|-----|
| Root directory | `apps/web` |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `NEXT_PUBLIC_*` 4개 (API URL, Supabase URL/anon key, Bunny CDN 호스트) |

> `NEXT_PUBLIC_*`는 **빌드 시점에 번들에 박히므로** 런타임 변수가 아니라 **Build variables**에 등록해야 합니다. `wrangler.jsonc`의 Worker `name`은 대시보드에서 만든 Worker 이름과 일치해야 합니다.

로컬에서 빌드·배포하려면 (Linux/WSL 권장 — Windows는 OpenNext의 pnpm 심링크 처리 비호환):

```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://<api-worker-url> pnpm deploy   # opennextjs-cloudflare build && deploy
```

> 배포 후 Supabase 대시보드 → Authentication → URL Configuration에서 **Site URL**과 **Redirect URLs**(`https://<web-url>/**`, `http://localhost:3000/**`)에 배포 도메인을 추가해야 Google 로그인 리다이렉트가 정상 동작합니다.

## 프로젝트 구조

```
newMovie/
├── apps/
│   ├── web/                  # Next.js 프론트엔드 (Cloudflare Workers / OpenNext)
│   │   ├── src/
│   │   │   ├── app/          # App Router 페이지 (auth/callback 포함)
│   │   │   ├── components/   # UI 컴포넌트
│   │   │   └── lib/          # API 클라이언트, Supabase
│   │   ├── open-next.config.ts  # OpenNext (Cloudflare) 빌드 설정
│   │   └── wrangler.jsonc       # 웹 Worker 설정
│   └── api/                  # Cloudflare Workers API
│       ├── wrangler.toml     # KV 바인딩 + Cron Trigger + 피드 캐시 설정
│       └── src/
│           ├── routes/       # videos, channels, upload, comments, auth
│           ├── middleware/   # 인증 미들웨어
│           └── lib/          # supabase(fetch), feed-cache(KV 갱신), channels, bunny-storage
└── packages/
    └── db/
        └── schema.sql        # PostgreSQL 스키마 + RPC 함수
```

## API 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/videos` | 동영상 목록 (feed, search, category, page) | - |
| GET | `/api/videos/mine` | 내 동영상 목록 (processing 포함) | ✅ |
| GET | `/api/videos/:id` | 동영상 상세 | - |
| GET | `/api/videos/:id/related` | 관련 영상 | - |
| POST | `/api/videos` | 동영상 등록 | ✅ |
| PUT | `/api/videos/:id` | 동영상 수정 | ✅ |
| DELETE | `/api/videos/:id` | 동영상 삭제 | ✅ |
| POST | `/api/videos/:id/like` | 좋아요 토글 | ✅ |
| POST | `/api/videos/:id/view` | 조회수 증가 (클라이언트가 하루 1회 호출) | - |
| GET | `/api/videos/subscription-by-channel` | 구독 피드 (채널별 그룹) | ✅ |
| GET | `/api/channels/mine` | 내 채널 조회 | ✅ |
| GET | `/api/channels/:id` | 채널 조회 | - |
| GET | `/api/channels/:id/videos` | 채널 동영상 목록 | - |
| POST | `/api/channels` | 채널 생성 | ✅ |
| POST | `/api/channels/:id/subscribe` | 구독 토글 (본인 채널 불가) | ✅ |
| POST | `/api/upload/stream-url` | Bunny tus 인증 정보 발급 | ✅ |
| GET | `/api/upload/stream-status/:uid` | 트랜스코딩 상태 확인 | ✅ |
| POST | `/api/upload/webhook` | Bunny 웹훅 (트랜스코딩 완료) | - |
| GET | `/api/comments?video_id=` | 댓글 목록 | - |
| POST | `/api/comments` | 댓글 작성 | ✅ |
| DELETE | `/api/comments/:id` | 댓글 삭제 | ✅ |
| GET | `/api/auth/me` | 내 프로필 | ✅ |
| POST | `/api/auth/profile` | 프로필 생성/수정 | ✅ |
| POST | `/api/auth/avatar` | 프로필 사진 업로드 | ✅ |

피드 파라미터: `?feed=trending` (기본) / `?feed=subscriptions` / `?feed=latest`

## 추천 점수 알고리즘

```
총점 = (오늘 좋아요 × 10) + (1일 전 × 9) + (2일 전 × 8) + ... + (9일 전 × 1)
```

좋아요 발생 시 `video_daily_likes` 테이블에 날짜별로 집계되며, `get_trending_videos` RPC가 실시간으로 계산합니다.

## 비용 추정

Bunny Stream 기준. 전송 단가는 지역별로 다름 (유럽/미국 $0.009/GB, 아시아-태평양 $0.045/GB).

| 단계 | MAU | 예상 월 비용 (한국 기준) |
|------|-----|-------------|
| 초기 | 1,000명 | ~$5 ~ $20 |
| 성장 | 10,000명 | ~$50 ~ $200 |
