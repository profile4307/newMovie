# NewMovie

글로벌 동영상 공유 플랫폼. 운영 비용을 최소화하는 서버리스 아키텍처로 구축되었습니다.

## 기술 스택

| 영역 | 기술 | 비용 |
|------|------|------|
| 프론트엔드 | Next.js 16 (App Router) + Tailwind CSS | 무료 |
| 호스팅 | Cloudflare Pages | 무료 |
| API 서버 | Cloudflare Workers + Hono.js | 무료 (100k req/일) |
| 데이터베이스 | Supabase (PostgreSQL + RLS) | 무료 ~ $25/월 |
| 인증 | Supabase Auth | 무료 |
| 프로필 사진 | Supabase Storage | 무료 (1GB) |
| 동영상 저장/전송 | Bunny Stream | ~$0.005/1,000분 저장 + $0.009~$0.045/GB 전송 |

## 주요 기능

- **동영상 업로드** — Bunny Stream tus 직접 업로드, 자동 트랜스코딩, HLS 스트리밍
- **공개 설정** — 전체공개 / 일부공개(링크 공유) / 비공개, 업로드 및 이후 변경 가능
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
ALLOWED_ORIGINS=http://localhost:3000
```

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
npx wrangler deploy
```

Cloudflare 대시보드 → Workers → 해당 Worker → Settings → Variables에서 프로덕션 환경변수를 등록합니다.

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
| GET | `/api/videos/mine` | 내 동영상 목록 (processing 포함) | ✅ |
| GET | `/api/videos/:id` | 동영상 상세 | - |
| GET | `/api/videos/:id/related` | 관련 영상 | - |
| POST | `/api/videos` | 동영상 등록 | ✅ |
| PUT | `/api/videos/:id` | 동영상 수정 | ✅ |
| DELETE | `/api/videos/:id` | 동영상 삭제 | ✅ |
| POST | `/api/videos/:id/like` | 좋아요 토글 | ✅ |
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
