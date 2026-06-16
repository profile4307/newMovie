# R2 커스텀 도메인 연결 — 작업 체크리스트

> 차후 진행용. 현재는 `/media` 프록시로 서빙 중 (전송비 0, 단 세그먼트 요청이 Worker 한도 소비).
> 커스텀 도메인을 붙이면 세그먼트가 Cloudflare 엣지에서 직접 나가 Worker 요청을 안 쓴다.
> **전제: 소유 도메인이 Cloudflare 존에 등록돼 있어야 함.**

---

## 1. 대시보드 작업 (코드 아님)

**R2 → `newmovie-media` → Settings → Custom Domains → Connect Domain**
- 도메인 입력 (예: `media.example.com`) → Connect → 상태 **Active** 될 때까지 대기

**(같은 존) Rules → Caching → Cache Rules → Create rule**
- 조건: `Hostname equals media.example.com`
- 동작: **Cache Everything** + **Edge TTL = 1 year**

---

## 2. 파일 수정 — `apps/api/wrangler.toml`

`[vars]` 의 `MEDIA_BASE_URL` 한 줄 교체:

```toml
# 변경 전
MEDIA_BASE_URL = "https://newmovie-api.profile4307.workers.dev/media"
# 변경 후
MEDIA_BASE_URL = "https://media.example.com"
```

배포:
```bash
cd apps/api && npx wrangler deploy
```

→ 기존 영상 포함 모두 자동으로 새 도메인 서빙 (DB 마이그레이션·백필 불필요).

---

## 3. (선택) 썸네일 URL 정리 — Supabase SQL 에디터

이미 R2로 넘어간 영상의 썸네일은 기존 프록시 URL을 가리킨다. 둘 다 동작하므로
안 해도 무방. 깔끔히 정리하려면:

```sql
update videos
set thumbnail_url = replace(
  thumbnail_url,
  'https://newmovie-api.profile4307.workers.dev/media/',
  'https://media.example.com/'
)
where thumbnail_url like 'https://newmovie-api.profile4307.workers.dev/media/%';
```

---

## 4. 확인

- 영상 1개 재생 → 네트워크 탭에서 세그먼트가 `media.example.com` 으로 나가는지 확인

## 롤백

`MEDIA_BASE_URL` 을 프록시 URL로 되돌리고 `npx wrangler deploy` → 즉시 원복 (무손실).
