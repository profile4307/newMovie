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

# 배포
cd apps/api && npx wrangler deploy   # Cloudflare Workers 배포
pnpm build:web                        # Next.js 빌드 (Cloudflare Pages는 CI에서 자동)
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
- **동영상 업로드**: [`src/routes/upload.ts`](apps/api/src/routes/upload.ts) — Cloudflare Stream에 직접 업로드 URL 발급 → 클라이언트가 Stream으로 직접 업로드 → 완료 후 `/api/upload/stream-status/:uid`로 트랜스코딩 상태 확인.
- **라우트 구조**: `POST /api/videos` → 메타데이터 저장 (업로드는 별도 `/api/upload`). 조회수 증가는 `c.executionCtx.waitUntil()`로 비동기 처리.

### `apps/web` — Next.js 14 (App Router)

- **API 호출**: [`src/lib/api.ts`](apps/web/src/lib/api.ts) — 모든 백엔드 호출의 단일 진입점. Supabase 세션 토큰을 자동으로 Authorization 헤더에 첨부.
- **Supabase 클라이언트**: [`src/lib/supabase.ts`](apps/web/src/lib/supabase.ts) — 브라우저용 싱글톤. 서버 컴포넌트에서는 직접 사용 금지 (쿠키 기반 세션 처리 필요 시 별도 서버 클라이언트 생성 필요).
- **동영상 플레이어**: [`src/components/video/VideoPlayer.tsx`](apps/web/src/components/video/VideoPlayer.tsx) — HLS.js를 동적 import로 로드 (SSR 방지). Cloudflare Stream의 HLS 매니페스트 URL 패턴: `https://{customerSubdomain}.cloudflarestream.com/{streamUid}/manifest/video.m3u8`.
- **업로드 흐름**: `UploadForm` → `POST /api/upload/stream-url` (업로드 URL 발급) → XHR로 Cloudflare Stream에 직접 업로드 → 폴링으로 트랜스코딩 완료 확인 → `POST /api/videos` (메타데이터 저장).

### `packages/db`

[`schema.sql`](packages/db/schema.sql)을 Supabase SQL 에디터에서 직접 실행. 모든 테이블에 RLS(Row Level Security) 적용됨. `view_count`/`like_count`/`subscriber_count` 증감은 Workers에서 raw SQL 표현식 대신 PATCH로 처리 중 — 동시성 문제가 생기면 Supabase RPC(stored function)로 교체 필요.

## 외부 서비스 의존성

| 서비스 | 용도 |
|--------|------|
| **Cloudflare Stream** | 동영상 트랜스코딩 + HLS 전송 (비용: $5/1,000분 저장, $1/1,000분 시청) |
| **Cloudflare Workers** | API 서버 (서버리스, 엣지 실행) |
| **Cloudflare Pages** | Next.js 프론트 호스팅 (무료) |
| **Supabase** | PostgreSQL DB + Auth + RLS |

## 주의사항

- `pnpm install`은 항상 `--ignore-scripts` 플래그 필요 (없으면 `sharp`, `unrs-resolver` 빌드 스크립트 오류 발생).
- Workers에서 Supabase를 사용할 때 Supabase JS SDK 대신 `src/lib/supabase.ts`의 raw fetch 방식 유지 — Workers 런타임과의 호환성 때문.
- 새 라우트 추가 시 [`apps/api/src/index.ts`](apps/api/src/index.ts)에 `app.route()` 등록 필요.
- `CF_STREAM_CUSTOMER_SUBDOMAIN` 환경변수는 Cloudflare Stream 대시보드 → "Use Stream Player" → 도메인에서 확인.
