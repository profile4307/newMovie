# NewMovie

글로벌 동영상 공유 플랫폼. 운영 비용을 최소화하는 서버리스 아키텍처로 구축되었습니다.

## 라이브

| | URL |
|------|------|
| 웹 | https://new-movie.profile4307.workers.dev |
| API | https://newmovie-api.profile4307.workers.dev |
| 아키텍처·데이터 흐름도 | https://new-movie.profile4307.workers.dev/architecture.html |

## 기술 스택

| 영역 | 기술 | 비용 |
|------|------|------|
| 프론트엔드 | Next.js 16 (App Router) + Tailwind CSS | 무료 |
| 웹 호스팅 | Cloudflare Workers ([OpenNext](https://opennext.js.org/cloudflare), SSR) | 무료 (100k req/일) |
| API 서버 | Cloudflare Workers + Hono.js | 무료 (100k req/일) |
| 피드 캐시 | Cloudflare Workers KV + Cron Trigger | 무료 (읽기 10만/일) |
| 데이터베이스 / 인증 | Supabase (PostgreSQL + RLS + Auth) | 무료 ~ $25/월 |
| 동영상 트랜스코딩 | Bunny Stream (트랜스코딩 + HLS 생성) | 트랜스코딩 무료 · 원본은 R2 복사 후 7일 뒤 삭제 |
| 동영상 저장·서빙 | Cloudflare R2 (HLS) | 저장 ~$0.015/GB · **egress 무료** |
| 이미지 저장 (썸네일·아바타) | Bunny Storage Zone + CDN | ~$0.01/GB |

## 주요 기능

- **R2 HLS 서빙 (전송비 0)** — 트랜스코딩 완료 후 HLS 파일을 R2로 복사해 egress 무료로 서빙. 큐(`r2-copy`)가 자동 처리하고 7일 유예 후 Bunny 원본 삭제. 영상별 `playback_host`로 점진 전환·롤백 ([설계](docs/r2-serving-design.md))
- **재생 전송량 절감** — 클릭-투-플레이(재생 전 0 byte), 화면 크기에 맞춘 화질(`capLevelToPlayerSize`), 버퍼 상한으로 이탈 낭비 차단
- **동영상 업로드** — Bunny Stream tus 직접 업로드, 자동 트랜스코딩, 공개 설정(전체/일부/비공개)
- **메인 피드 캐싱** — 추천·최신 피드를 Cron(기본 30분)으로 미리 만들어 KV에 저장 → DB 조회 제거 (미스 시 DB 폴백)
- **추천 피드** — 시간 가중 좋아요 점수 정렬 (`총점 = Σ daily_likes × (10 - 경과일)`)
- **구독 피드 / 채널** — 구독 채널 최신 영상, 채널 생성·구독·구독자수
- **멀티 키워드 검색** — 띄어쓰기 AND 검색, title + description + tags FTS
- **관련 영상 추천** — 태그 FTS, 없으면 같은 카테고리 최신
- **Google 로그인** — Supabase Auth OAuth (`/auth/callback` 클라이언트 세션 설정)
- **댓글 / 좋아요 / 공유** — 댓글·대댓글, 좋아요 토글, 링크·SNS 공유
- **프로필** — 아바타 업로드, 내 동영상 관리(수정·삭제·상태 확인)

## 시작하기

### 필수 조건

Node.js 20+ · pnpm 8+ · [Supabase](https://supabase.com) 계정 · [Bunny.net](https://bunny.net) 계정 (Stream 라이브러리)

### 1. 설치

```bash
git clone <repo> && cd newMovie
pnpm install --ignore-scripts   # --ignore-scripts 필수 (sharp/unrs-resolver 빌드 충돌 방지)
```

### 2. 데이터베이스

Supabase SQL 에디터에서 [`packages/db/schema.sql`](packages/db/schema.sql) 전체 실행 (테이블·RLS·RPC 함수 생성).

**아바타 Storage** — Storage → New bucket `avatars` (Public 체크) 후 SQL 실행:
```sql
create policy "공개 읽기" on storage.objects for select using (bucket_id = 'avatars');
create policy "인증 사용자 업로드" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "본인 파일 수정" on storage.objects for update to authenticated using (bucket_id = 'avatars');
```

### 3. Bunny Stream

[bunny.net](https://bunny.net) → **Stream** → **Add Video Library** 생성 후: **Library ID**·**API Key**·**Pull Zone 호스트명**(예: `vz-xxxx.b-cdn.net`) 확인. **Security → Block direct url file access 비활성화** (썸네일/영상 403 방지).

### 4. Cloudflare R2 (선택 — 미설정 시 Bunny CDN 폴백)

로컬 개발엔 생략 가능. 프로덕션 전송비 제거용:
```bash
cd apps/api
npx wrangler r2 bucket create newmovie-media
npx -y wrangler@4 queues create r2-copy --message-retention-period-secs 86400
```
[`wrangler.toml`](apps/api/wrangler.toml)의 `[[r2_buckets]]`·`[[queues.*]]`·`MEDIA_BASE_URL` 확인. 커스텀 도메인 연결은 [`docs/r2-custom-domain-setup.md`](docs/r2-custom-domain-setup.md).

### 5. 환경변수

**프론트** `apps/web/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_BUNNY_CDN_HOSTNAME=vz-xxxx.b-cdn.net
```

**API** `apps/api/.dev.vars` ([`.dev.vars.example`](apps/api/.dev.vars.example) 참고):
```env
SUPABASE_URL=... / SUPABASE_ANON_KEY=... / SUPABASE_SERVICE_ROLE_KEY=...
BUNNY_STREAM_LIBRARY_ID=... / BUNNY_STREAM_API_KEY=... / BUNNY_CDN_HOSTNAME=...
BUNNY_STORAGE_ZONE_NAME=... / BUNNY_STORAGE_PASSWORD=... / BUNNY_STORAGE_HOSTNAME=... / BUNNY_STORAGE_ENDPOINT=sg.storage.bunnycdn.com
ALLOWED_ORIGINS=http://localhost:3000
# MEDIA_BASE_URL=http://localhost:8787/media   # R2 서빙 (비우면 Bunny CDN 폴백)
# ADMIN_API_KEY=...                            # POST /api/videos/backfill-r2 보호용
```

> KV·R2·Queue 바인딩과 피드 캐시 설정(`FEED_CACHE_*`)·Cron 주기는 `wrangler.toml`에서 관리. 로컬 Cron 테스트: `npx wrangler dev --test-scheduled` 후 `curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"`.

### 6. 개발 서버

```bash
pnpm dev:api   # API  → http://localhost:8787
pnpm dev:web   # 프론트 → http://localhost:3000
```

## 배포

### API (Cloudflare Workers)

```bash
cd apps/api
npx wrangler kv namespace create FEED_CACHE            # 최초 1회 (--preview 도 함께), id를 wrangler.toml에 입력
npx wrangler secret put SUPABASE_URL                   # SUPABASE_*·BUNNY_*·ALLOWED_ORIGINS·ADMIN_API_KEY 각각
npx wrangler deploy                                    # Cron·KV·R2·Queue 바인딩 자동 등록
# (선택) 기존 영상 R2 전환 — remaining 0 될 때까지 반복
curl -X POST https://<api-url>/api/videos/backfill-r2 -H "X-Admin-Key: <ADMIN_API_KEY>"
```

> `[vars]`는 자동 반영, 비밀값만 `wrangler secret put`으로 등록.

### 프론트엔드 (OpenNext → Workers)

**GitHub 연동(Workers Builds) 권장** — Cloudflare가 Linux에서 빌드 (로컬 환경 의존 없음). 대시보드 → Workers → **Connect to Git**:

| 항목 | 값 |
|------|-----|
| Root directory | `apps/web` |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `NEXT_PUBLIC_*` 4개 (빌드 시 번들에 박히므로 런타임 변수 아님) |

> `wrangler.jsonc`의 Worker `name`은 대시보드 Worker 이름과 일치해야 함. 배포 후 Supabase → Authentication → URL Configuration의 **Site URL**·**Redirect URLs**(`https://<web-url>/**`)에 도메인 추가해야 Google 로그인 정상 동작.

## 프로젝트 구조

```
newMovie/
├── apps/
│   ├── web/   # Next.js 프론트 (Workers/OpenNext) — public/architecture.html 흐름도 포함
│   └── api/   # Hono API — index.ts(/media 프록시·큐·Cron), routes/, lib/(supabase·feed-cache·bunny-storage·r2-copy)
├── packages/db/   # schema.sql + migrations/
└── docs/          # R2 서빙 설계·커스텀 도메인 가이드
```

> **API·데이터 흐름과 전체 엔드포인트 목록은 [흐름도](https://new-movie.profile4307.workers.dev/architecture.html)에서 확인**하세요. 피드 파라미터: `?feed=trending`(기본)·`subscriptions`·`latest`.

## 추천 점수 알고리즘

```
총점 = (오늘 좋아요 × 10) + (1일 전 × 9) + ... + (9일 전 × 1)
```

좋아요는 `video_daily_likes`에 날짜별 집계, `get_trending_videos` RPC가 실시간 계산.

## 비용 추정

> 추정치 (시청 패턴·캐시 적중률에 따라 변동). **R2 HLS 서빙으로 영상 전송비(egress)가 0** — 이전 지배 항목이던 Bunny 전송(지역별 $0.01~$0.06/GB)이 사라졌습니다.

| 항목 (월) | 초기<br>(시청 2만) | 성장<br>(시청 30만) | 대규모<br>(시청 300만) |
|------|------|------|------|
| R2 영상 전송 (egress) | **$0** | **$0** | **$0** |
| R2 저장 (~$0.015/GB) | $0.2 | $2 | $18 |
| R2 요청 (쓰기/읽기) | ~$0 | ~$1 | ~$12 |
| Cloudflare Workers + KV | $0 | $5 | $5~$40 ※ |
| Supabase / 이미지 | $0 | $0~$25 | ~$26 |
| **합계** | **~$0** | **~$8** | **~$60** (커스텀 도메인 시 ~$35) |

> ※ 대규모 Workers 비용은 `/media` 프록시가 세그먼트 요청을 받기 때문. **R2에 커스텀 도메인을 연결하면 엣지에서 직접 서빙되어 제거**됩니다 (`MEDIA_BASE_URL` 한 줄 교체, [가이드](docs/r2-custom-domain-setup.md)).

**핵심**: R2 전환으로 전송비 0 → 대규모도 이전 월 수천 달러(Bunny $4,500)에서 **월 ~$35~60**로, 시청자 지역과 무관해졌습니다. 남은 변수는 R2 저장(누적량 비례)과 `/media` Worker 요청(커스텀 도메인으로 제거 가능)뿐입니다.
