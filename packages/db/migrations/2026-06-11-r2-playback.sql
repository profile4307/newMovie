-- R2 HLS 서빙 전환 (docs/r2-serving-design.md)
-- 기존 DB에 적용할 마이그레이션 — Supabase SQL 에디터에서 실행

alter table videos add column if not exists playback_host text not null default 'bunny'
  check (playback_host in ('bunny', 'r2'));
alter table videos add column if not exists r2_copied_at timestamptz;
alter table videos add column if not exists bunny_purged boolean not null default false;

-- purge cron 조회용 부분 인덱스 (R2 전환됐지만 아직 Bunny 원본이 남은 영상)
create index if not exists videos_r2_purge_idx
  on videos(r2_copied_at) where playback_host = 'r2' and bunny_purged = false;

-- PostgREST 스키마 캐시 갱신 (PGRST204 방지)
notify pgrst, 'reload schema';
