# R2 HLS 서빙 전환 설계

> 상태: **구현 완료 — 인프라 활성화 대기** (R2 버킷·도메인·큐 생성 후 wrangler.toml 주석 해제) · 작성일: 2026-06-11
>
> 구현 위치: `apps/api/src/lib/r2-copy.ts`(복사·purge·정리), `index.ts`(queue 컨슈머·cron),
> `routes/upload.ts`(완료 시 큐잉), `routes/videos.ts`(playback_url·백필·삭제 정리),
> `packages/db/migrations/2026-06-11-r2-playback.sql`(스키마), 웹 `VideoPlayer`(playbackUrl prop)

## 1. 목표와 배경

현재 비용의 95% 이상이 Bunny Stream **전송비**(아시아 ~$0.03/GB)다. Cloudflare R2는 **egress가 무료**이므로, 트랜스코딩은 지금처럼 Bunny에 맡기고(무료) **HLS 파일 서빙만 R2로 옮기면** 전송비가 규모와 무관하게 사실상 0이 된다.

- Cloudflare는 2023년 ToS 개정으로 R2/Workers에 저장된 콘텐츠의 영상 서빙을 명시적으로 허용한다 (제한은 CDN으로 외부 오리진을 프록시하는 경우에만 적용).
- 비용 비교 (월 150TB 전송, 영상 1만 개 시나리오): Bunny 아시아 ~$4,500 → R2 ~$30 (저장 $18 + Class B 요청 ~$11).

## 2. 아키텍처 개요

```
[업로드]  브라우저 ──tus──▶ Bunny Stream (트랜스코딩, 현행 유지)
                              │
[복사]    트랜스코딩 완료 (webhook / stream-status 폴링)
          → finalizeTranscodedVideo() 직후 복사 작업 시작
          → Worker가 playlist.m3u8 파싱 → 렌디션 m3u8 + 세그먼트(.ts)를
            Bunny CDN에서 fetch → R2 버킷에 streaming put
          → 검증(파일 수·바이트 합) 후 videos.playback_host = 'r2' 갱신
                              │
[서빙]    브라우저 hls.js ──▶ media.<도메인> (R2 public bucket + CF 캐시)
                              egress $0
[정리]    복사 후 7일 유예 → Bunny Stream 영상 삭제 (저장비 중복 제거)
```

## 3. 구성 요소

### 3.1 R2 버킷 + 커스텀 도메인

- 버킷 `newmovie-media`, 키 구조는 Bunny와 동일하게 유지: `{stream_uid}/playlist.m3u8`, `{stream_uid}/{해상도}/video.m3u8`, `{stream_uid}/{해상도}/video{N}.ts`
- 커스텀 도메인 연결 (예: `media.example.com`) → Cloudflare CDN 경유, **Cache Everything + Edge TTL 길게** (콘텐츠 불변이므로 영구 캐시 가능). 캐시 히트는 R2 Class B 요청에 과금되지 않아 요청 비용도 줄어든다.
- Bunny의 HLS manifest는 **상대 경로**를 사용하므로 (검증됨: `240p/video.m3u8`, `video0.ts`) 그대로 복사하면 재작성 없이 동작한다. 복사 시 절대 URL이 발견되면 해당 영상은 복사 실패로 처리하고 Bunny 서빙 유지.

### 3.2 복사 파이프라인 (apps/api Worker 내)

`finalizeTranscodedVideo()`(apps/api/src/routes/upload.ts)가 status 전환에 성공한 직후 트리거.

1. `https://{BUNNY_CDN_HOSTNAME}/{uid}/playlist.m3u8` fetch → 렌디션 목록 파싱
2. 각 렌디션 m3u8 fetch → 세그먼트 목록 파싱
3. 모든 파일을 `fetch → R2 put` 순차/소규모 병렬 streaming 복사 (메모리에 통째로 올리지 않음 — `res.body`를 그대로 `bucket.put`에 전달)
4. 파일 수 + Content-Length 합으로 검증 → `videos.playback_host='r2'`, `r2_copied_at=now()` PATCH
5. 실패 시: R2에 올라간 부분 삭제(prefix delete), `playback_host`는 'bunny' 유지. 재시도는 다음 stream-status 폴링/cron에서.

**파일 수 추정**: 3분 영상, 세그먼트 ~5초, 렌디션 3~4개 → 약 110~150 파일.

**Workers 플랜 제약 (중요)**:
- 무료 플랜은 요청당 subrequest **50개** 제한 → 한 번에 복사 불가. 선택지:
  - (권장) **Workers Paid $5/월** — subrequest 1,000개로 한 번에 복사 + Cloudflare Queues 사용 가능. 전송비 절감 규모를 생각하면 $5는 무시 가능.
  - (무료 유지 시) 복사 상태 테이블을 두고 cron(이미 피드 캐시용 cron 존재)이 영상당 40파일씩 나눠 복사.
- 복사는 IO-bound라 CPU 시간 제한과는 무관. `waitUntil` 한도(요청 후 ~30초)가 빠듯할 수 있으므로 **Cloudflare Queues**(Paid 포함)에 `{uid}` 메시지를 넣고 큐 컨슈머가 복사하는 구성을 기본으로 한다 (자동 재시도 + DLQ 포함).

### 3.3 DB 변경 (packages/db/schema.sql)

```sql
alter table videos add column playback_host text not null default 'bunny'
  check (playback_host in ('bunny','r2'));
alter table videos add column r2_copied_at timestamptz;
-- 변경 후: notify pgrst, 'reload schema';
```

### 3.4 API·플레이어 변경

- 영상 응답(목록·상세)에 `playback_url` 필드 추가: `playback_host`에 따라 `https://media.example.com/{uid}/playlist.m3u8` 또는 기존 Bunny URL을 서버에서 조립.
- `VideoPlayer`는 `streamUid + CDN hostname` 조합 대신 **`playback_url`을 받아 그대로 재생** (영상별 점진 전환·즉시 롤백 가능).
- 썸네일: Bunny 자동 썸네일을 쓰는 영상은 `thumbnail.jpg`도 함께 복사하고 `thumbnail_url` 갱신 (Bunny 삭제 후 깨짐 방지).

### 3.5 접근 제어

| 공개 설정 | 서빙 방식 |
|---|---|
| published / unlisted | R2 public 커스텀 도메인 직접 (uid가 UUID라 추측 불가 — unlisted 의미론과 동일) |
| private | Worker 프록시 라우트 `GET /api/media/{uid}/*`: Authorization 검증 → 소유자만 R2 binding으로 읽어 반환. egress 무료, Workers 요청 과금만 |

핫링크 방지가 필요해지면 public 경로도 같은 Worker 프록시로 옮겨 Referer 검사 (지금은 불요).

### 3.6 기존 영상 백필

로컬 Node 스크립트 (`scripts/backfill-r2.ts`):
1. `videos`에서 `playback_host='bunny'` 목록 조회
2. 3.2와 동일한 파싱·복사 로직을 S3 API(R2 호환)로 실행
3. 검증 후 `playback_host='r2'` 갱신

로컬 실행이므로 Workers 제한과 무관하고, 영상 수가 적은 지금 돌리면 수 분 내 완료.

### 3.7 Bunny 정리

- `r2_copied_at`이 **7일** 지난 영상을 cron이 Bunny Stream API로 삭제 (유예 기간 = 문제 발견 시 롤백 창).
- 주의: Bunny 삭제 후에는 **재트랜스코딩 불가** — 원본이 필요해질 가능성이 있으면 삭제 전 원본 MP4를 R2 `originals/`에 보관하는 옵션 고려 (저장비 +~40MB/영상).
- 영상 삭제 라우트(`DELETE /api/videos/:id`)에 R2 prefix 삭제 추가.

## 4. 비용 (월, 아시아 시청 기준)

| 항목 | 초기 (시청 2만) | 성장 (30만) | 대규모 (300만) |
|---|---|---|---|
| 현행 Bunny 전송 | $30 | $450 | $4,500 |
| **R2 전환 후** | | | |
| R2 저장 ($0.015/GB) | $0.2 | $2 | $18 |
| Class A 쓰기 (복사, $4.50/백만) | ~$0 | ~$0.1 | ~$1 |
| Class B 읽기 ($0.36/백만, 캐시 미스만) | ~$0 | ~$1 | ~$11 |
| Workers Paid | $5 | $5 | $5~7 |
| **합계** | **~$5** | **~$8** | **~$35** |

## 5. 마이그레이션 단계

| 단계 | 내용 | 롤백 |
|---|---|---|
| 1 | R2 버킷 + 커스텀 도메인 + 캐시 규칙, DB 컬럼 추가 | 무영향 |
| 2 | API `playback_url` 필드 + 플레이어 전환 (전 영상 아직 'bunny' → 동작 동일) | 무영향 |
| 3 | 복사 파이프라인 배포 — 신규 업로드만 R2 전환 | 영상별 `playback_host='bunny'` 되돌리기 |
| 4 | 백필 스크립트로 기존 영상 전환 | 동일 |
| 5 | 7일 유예 후 Bunny 정리 cron 활성화 | 유예 내 컬럼 되돌리기로 즉시 복구 |

## 6. 리스크

- **체감 속도**: Cloudflare 캐시 미스 시 R2(단일 리전)에서 읽음 — 첫 시청자만 약간 느림, 이후 엣지 캐시. Bunny 대비 차이는 미미할 것으로 예상되나 전환 후 모니터링.
- **Workers 한도**: 복사 작업이 Queues 재시도로도 실패하는 영상은 'bunny'로 남음 — 비용 누수는 없고 알림만 필요.
- **ToS**: R2 저장 콘텐츠 서빙은 허용 확인됨. 단 Worker 프록시 경로는 Workers 요청 단가 적용.
