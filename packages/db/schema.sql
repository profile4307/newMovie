-- =============================================
-- NewMovie 데이터베이스 스키마 (Supabase PostgreSQL)
-- =============================================

-- UUID 확장
create extension if not exists "uuid-ossp";

-- =============================================
-- 유저 프로필 (Supabase Auth와 연동)
-- =============================================
create table if not exists users (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table users enable row level security;

create policy "Public profiles are viewable by everyone"
  on users for select using (true);

create policy "Users can update own profile"
  on users for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on users for insert with check (auth.uid() = id);

-- =============================================
-- 채널
-- =============================================
create table if not exists channels (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references users(id) on delete cascade,
  name              text not null,
  description       text not null default '',
  avatar_url        text,
  banner_url        text,
  subscriber_count  integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists channels_owner_id_idx on channels(owner_id);

alter table channels enable row level security;

create policy "Channels are viewable by everyone"
  on channels for select using (true);

create policy "Owner can manage channel"
  on channels for all using (auth.uid() = owner_id);

-- =============================================
-- 동영상
-- =============================================
create type video_status as enum ('processing', 'published', 'private', 'unlisted', 'failed');

create table if not exists videos (
  id              uuid primary key default uuid_generate_v4(),
  channel_id      uuid not null references channels(id) on delete cascade,
  title           text not null,
  description     text not null default '',
  stream_uid      text not null unique,  -- Cloudflare Stream UID
  thumbnail_url   text,
  duration        integer,              -- 초 단위
  status          video_status not null default 'processing',
  category        text,
  tags            text[] not null default '{}',
  view_count      bigint not null default 0,
  like_count      bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_channel_id_idx on videos(channel_id);
create index if not exists videos_status_created_at_idx on videos(status, created_at desc);
create index if not exists videos_category_idx on videos(category) where status = 'published';
create index if not exists videos_title_fts_idx on videos using gin(to_tsvector('simple', title));

alter table videos enable row level security;

create policy "Published videos are viewable by everyone"
  on videos for select using (status = 'published' or channel_id in (
    select id from channels where owner_id = auth.uid()
  ));

create policy "Channel owner can manage videos"
  on videos for all using (channel_id in (
    select id from channels where owner_id = auth.uid()
  ));

-- updated_at 자동 갱신
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger videos_updated_at
  before update on videos
  for each row execute function update_updated_at();

-- =============================================
-- 좋아요
-- =============================================
create table if not exists likes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  video_id    uuid not null references videos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique(user_id, video_id)
);

create index if not exists likes_user_id_idx on likes(user_id);
create index if not exists likes_video_id_idx on likes(video_id);

alter table likes enable row level security;

create policy "Users can manage own likes"
  on likes for all using (auth.uid() = user_id);

create policy "Likes are viewable by everyone"
  on likes for select using (true);

-- =============================================
-- 구독
-- =============================================
create table if not exists subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  channel_id  uuid not null references channels(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique(user_id, channel_id)
);

create index if not exists subscriptions_user_id_idx on subscriptions(user_id);
create index if not exists subscriptions_channel_id_idx on subscriptions(channel_id);

alter table subscriptions enable row level security;

create policy "Users can manage own subscriptions"
  on subscriptions for all using (auth.uid() = user_id);

-- =============================================
-- 댓글
-- =============================================
create table if not exists comments (
  id          uuid primary key default uuid_generate_v4(),
  video_id    uuid not null references videos(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  parent_id   uuid references comments(id) on delete cascade,
  content     text not null check (char_length(content) <= 2000),
  created_at  timestamptz not null default now()
);

create index if not exists comments_video_id_idx on comments(video_id, created_at desc);
create index if not exists comments_parent_id_idx on comments(parent_id);

alter table comments enable row level security;

create policy "Comments are viewable by everyone"
  on comments for select using (true);

create policy "Users can manage own comments"
  on comments for all using (auth.uid() = user_id);

-- =============================================
-- 신고
-- =============================================
create type report_type as enum ('spam', 'inappropriate', 'copyright', 'other');

create table if not exists reports (
  id          uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references users(id) on delete cascade,
  video_id    uuid references videos(id) on delete cascade,
  comment_id  uuid references comments(id) on delete cascade,
  type        report_type not null,
  description text,
  created_at  timestamptz not null default now(),
  check (video_id is not null or comment_id is not null)
);

alter table reports enable row level security;

create policy "Users can submit reports"
  on reports for insert with check (auth.uid() = reporter_id);
