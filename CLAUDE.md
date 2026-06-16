# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 명령어

```bash
# 의존성 설치 (항상 --ignore-scripts 필요 — sharp/unrs-resolver 빌드 스크립트 충돌)
pnpm install --ignore-scripts

# 개발 서버 실행
pnpm dev:web        # Next.js 프론트 (http://localhost:3000)
pnpm dev:api        # Cloudflare Workers API (http://localhost:8787)

# 타입 체크
cd apps/web && npx tsc --noEmit
cd apps/api && npx tsc --noEmit

# 린트
cd apps/web && npx eslint src

# 서버 전체 종료 (Windows)
taskkill //F //IM node.exe

# 배포
cd apps/api && npx wrangler deploy   # API(Cloudflare Workers) 배포
# 웹 배포: git push origin master → Workers Builds CI가 자동 빌드·배포
#   (로컬 `pnpm run deploy`는 Windows에서 .open-next 권한 오류로 실패 — 사용 금지)
# Workers 환경변수(secrets) 등록 — .dev.vars 추가 후 배포 전 필수
cd apps/api && npx wrangler secret put <VAR_NAME>
# 큐 생성: npx -y wrangler@4 queues create <name> --message-retention-period-secs 86400
#   (로컬 wrangler 3.x는 retention 기본값으로 "invalid settings" 오류)
# wrangler API 오류 원인 확인: WRANGLER_LOG_SANITIZE=false WRANGLER_LOG=debug npx wrangler ...
```

## 환경변수 설정

- **프론트**: `apps/web/.env.local` ([`apps/web/.env.example`](apps/web/.env.example) 참고)
- **API**: `apps/api/.dev.vars` ([`apps/api/.dev.vars.example`](apps/api/.dev.vars.example) 참고)

## 아키텍처

**pnpm 모노레포** — `apps/*`, `packages/*` 워크스페이스 구조.

### `apps/api` — Cloudflare Workers (Hono.js)

엣지에서 실행되는 서버리스 API. [`src/index.ts`](apps/api/src/index.ts)가 진입점이며, `Env` 타입(환경변수 바인딩)을 정의한다.

- **인증**: [`src/middleware/auth.ts`](apps/api/src/middleware/auth.ts) — `Authorization: Bearer <token>`을 Supabase Auth로 검증. `requireAuth` 미들웨어를 보호된 라우트에 적용.
- **DB 접근**: [`src/lib/supabase.ts`](apps/api/src/lib/supabase.ts) — Supabase REST API를 `fetch`로 직접 호출 (Workers 환경에는 Supabase JS SDK 대신 raw fetch 사용). `createSupabaseClient`는 service role key, `createAnonClient`는 토큰 검증용.
- **동영상 업로드**: [`src/routes/upload.ts`](apps/api/src/routes/upload.ts) — Bunny Stream 비디오 생성 + tus 서명 발급 → 클라이언트가 tus-js-client로 Bunny에 직접 업로드 → `/api/upload/stream-status/:uid`로 트랜스코딩 상태 확인.
- **Bunny Storage**: [`src/lib/bunny-storage.ts`](apps/api/src/lib/bunny-storage.ts) — 썸네일·아바타 업로드/삭제/목록 헬퍼. `upload(path, bytes, mime)` → CDN URL 반환. `list(prefix)` → 파일 경로 배열 반환.
- **라우트 구조**: `POST /api/videos` → 메타데이터 저장 (업로드는 별도 `/api/upload`). 조회수 증가는 GET과 분리된 `POST /:id/view`로 처리 — 클라이언트가 `localStorage('nm_viewed')`로 하루 1회만 호출해 DB write 절감.

### `apps/web` — Next.js 16 (App Router)

- **API 호출**: [`src/lib/api.ts`](apps/web/src/lib/api.ts) — 모든 백엔드 호출의 단일 진입점. Supabase 세션 토큰을 자동으로 Authorization 헤더에 첨부.
- **Supabase 클라이언트**: [`src/lib/supabase.ts`](apps/web/src/lib/supabase.ts) — 브라우저용 싱글톤. 서버 컴포넌트에서는 직접 사용 금지 (쿠키 기반 세션 처리 필요 시 별도 서버 클라이언트 생성 필요).
- **동영상 플레이어**: [`src/components/video/VideoPlayer.tsx`](apps/web/src/components/video/VideoPlayer.tsx) — HLS.js를 동적 import로 로드 (SSR 방지). Bunny Stream HLS URL 패턴: `https://{BUNNY_CDN_HOSTNAME}/{videoId}/playlist.m3u8`.
- **업로드 흐름**: `UploadForm` → `POST /api/upload/stream-url` (Bunny 비디오 생성 + tus 서명 발급) → `tus-js-client`로 Bunny Stream에 직접 업로드 (endpoint: `https://video.bunnycdn.com/tusupload`) → 폴링으로 트랜스코딩 완료 확인 → `POST /api/videos` (메타데이터 저장).
- **숫자 포맷**: `formatKorean(n)` — 1000→1천, 1200→1.2천, 10000→1만. 각 컴포넌트에 로컬 함수로 구현됨.
- **댓글/대댓글**: [`src/components/video/CommentSection.tsx`](apps/web/src/components/video/CommentSection.tsx) — 최상위 댓글은 `parent_id=is.null`, 대댓글은 `GET /api/comments/:id/replies`. 대댓글 수는 CommentItem 마운트 시 비동기 조회.
- **업로드 제한**: 파일 선택 시 클라이언트에서 500MB 크기 체크 + HTML5 video `loadedmetadata`로 3분(180초) 재생시간 체크. `getVideoDuration()` 헬퍼 함수 `UploadForm.tsx` 내 정의.

### R2 HLS 서빙 (영상 전송비 절감)

영상은 Bunny 트랜스코딩 후 [`src/lib/r2-copy.ts`](apps/api/src/lib/r2-copy.ts)가 HLS 파일을 R2로 복사 → `/media/*` 프록시로 egress 무료 서빙. `videos.playback_host`(`bunny`/`r2`)로 영상별 전환·롤백. 신규 업로드는 `r2-copy` 큐 자동 처리, 기존 영상은 `POST /api/videos/backfill-r2`(X-Admin-Key). 설계·운영: [`docs/r2-serving-design.md`](docs/r2-serving-design.md), [`docs/r2-custom-domain-setup.md`](docs/r2-custom-domain-setup.md).

### `packages/db`

[`schema.sql`](packages/db/schema.sql)을 Supabase SQL 에디터에서 직접 실행. 모든 테이블에 RLS(Row Level Security) 적용됨. `view_count`/`like_count`/`subscriber_count` 증감은 모두 Supabase RPC(stored function)로 처리 (`increment_view_count`, `toggle_like`, `toggle_subscription`). race condition 방지 및 atomic 보장.

**스키마 변경 워크플로우:**
1. `schema.sql` 수정
2. Supabase SQL 에디터에서 변경 SQL 실행
3. 컬럼/테이블 추가 후 `notify pgrst, 'reload schema';` 실행 (PGRST204 오류 방지)

## 외부 서비스 의존성

| 서비스 | 용도 |
|--------|------|
| **Bunny Stream** | 동영상 트랜스코딩 + HLS 생성 (전송은 R2로 이전). R2 복사 후 7일 뒤 원본 삭제 |
| **Bunny Storage Zone** | 썸네일·아바타 이미지 저장 + CDN 서빙 (~$0.01/GB, Supabase egress 대비 9배 저렴). 헬퍼: `apps/api/src/lib/bunny-storage.ts` |
| **Cloudflare Workers** | API 서버 (서버리스, 엣지 실행) |
| **Cloudflare Workers (OpenNext)** | Next.js 프론트 호스팅 — `git push` → Workers Builds CI 자동 배포 (무료) |
| **Cloudflare R2** | 영상 HLS 최종 저장·서빙 (`newmovie-media`, egress 무료). `/media` 프록시 경유 |
| **Supabase** | PostgreSQL DB + Auth + RLS |
| **Supabase Storage** | 구버전 아바타·썸네일 파일 보관 (신규 업로드는 Bunny Storage로 이전됨, bucket `avatars`/`thumbnails` 유지 필요) |

## 주의사항

- `pnpm install`은 항상 `--ignore-scripts` 플래그 필요 (없으면 `sharp`, `unrs-resolver` 빌드 스크립트 오류 발생).
- Workers에서 Supabase를 사용할 때 Supabase JS SDK 대신 `src/lib/supabase.ts`의 raw fetch 방식 유지 — Workers 런타임과의 호환성 때문.
- 새 라우트 추가 시 [`apps/api/src/index.ts`](apps/api/src/index.ts)에 `app.route()` 등록 필요.
- Bunny 환경변수: `BUNNY_STREAM_LIBRARY_ID`(숫자), `BUNNY_STREAM_API_KEY`(Stream 라이브러리 키), `BUNNY_CDN_HOSTNAME`(예: `vz-xxxx.b-cdn.net`). Storage Zone: `BUNNY_STORAGE_ZONE_NAME`, `BUNNY_STORAGE_PASSWORD`(API/HTTP Access Key), `BUNNY_STORAGE_HOSTNAME`(Pull Zone CDN 도메인), `BUNNY_STORAGE_ENDPOINT`(리전 엔드포인트, 예: `sg.storage.bunnycdn.com`).

## 알려진 함정 및 해결책

- **Hono 라우트 순서**: 정적 경로(`/mine`, `/subscription-by-channel`)는 반드시 `/:id` 앞에 등록해야 한다. 순서가 틀리면 정적 경로가 404.
- **FTS 생성 컬럼 IMMUTABLE 오류** (42P17): `array_to_string`은 STABLE이라 generated column에 직접 사용 불가. `tags_to_text()` IMMUTABLE wrapper 함수를 만들어 우회 (schema.sql에 이미 적용됨).
- **Google OAuth 콜백**: URL hash(`#access_token=...`)는 서버 컴포넌트에서 읽을 수 없음. `/auth/callback`은 반드시 클라이언트 컴포넌트(`'use client'`)로 구현하고 `supabase.auth.setSession()` 사용.
- **Supabase 스키마 캐시 갱신**: 컬럼 추가 후 API에서 PGRST204 오류 시 SQL 에디터에서 `notify pgrst, 'reload schema';` 실행.
- **public.users FK 위반** (23503): Google OAuth 로그인 후 `public.users`에 레코드가 없어 FK 오류 발생. `requireAuth` 미들웨어에서 자동 생성 + `handle_new_auth_user()` trigger로 이중 대응 (schema.sql에 포함).
- **서버 컴포넌트에서 auth 토큰 접근 불가**: 인증이 필요한 피드(구독 등)는 클라이언트 컴포넌트로 분리해야 함.
- **Cloudflare Stream duration**: API가 float 반환 → zod에서 `.transform(Math.floor)` 필요.
- **env.example 동기화**: `.env.local` 수정 시 `.env.example`도, `.dev.vars` 수정 시 `.dev.vars.example`도 함께 수정 (민감정보 제외).
- **Next.js 외부 이미지 도메인**: 새 외부 이미지 도메인 추가 시 `apps/web/next.config.ts`의 `images.remotePatterns`에 등록 필요 (예: Google 프로필 사진 `lh3.googleusercontent.com`).
- **Bunny Stream 영상 isPublic**: 기본값 `false` — 영상 생성 시 반드시 `isPublic: true` 포함해야 CDN 접근 가능.
- **Bunny CDN "Block direct url file access"**: Stream 라이브러리 → Security → General에서 기본 활성화됨 → 반드시 비활성화 필요 (활성화 시 썸네일/영상 403).
- **next/image 변환 과금**: `next/image`가 최적화되면 Cloudflare 이미지 변환 과금 발생 가능. `next.config.ts`에 `images.unoptimized: true` 설정으로 차단 (이미지는 Bunny CDN에서 직접 서빙).
- **Bunny tus 서명**: `sha256(libraryId + apiKey + expirationTime + videoId)` — Workers에서 `crypto.subtle.digest('SHA-256', ...)` 로 생성.
- **Bunny Storage Zone 아바타**: 아바타는 `avatars/{userId}/` 폴더에 저장. 신규 업로드 시 이전 파일 자동 삭제. 구버전 Supabase `avatars` bucket 파일은 점진적으로 대체됨 (bucket 유지 필요).
- **본인 채널 구독 방지**: `POST /api/channels/:id/subscribe`에서 `channel.owner_id === userId` 체크.
- **Workers에서 File instanceof 불가**: `formData.get('file') as Blob` 으로 처리. `file.type`도 빈 문자열(`''`)로 올 수 있음 → `file.type || 'image/png'` 폴백 필수 (upload.ts, auth.ts 참고).
- **Cloudflare 무료 플랜 subrequest 한도**: Worker invocation당 외부 요청 50개 제한. 대량 파일 작업(R2 복사 등)은 한 번에 끝내지 말고 분할 + 재개(resumable) 패턴 필요 — R2에 이미 있는 키는 건너뛰고 배치로 나눠 큐 재큐잉 (`r2-copy.ts`의 `FILES_PER_RUN` 참고).
