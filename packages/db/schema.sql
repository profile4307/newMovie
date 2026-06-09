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

-- auth.users 신규 가입 시 users 테이블에 자동으로 레코드 생성
-- Google OAuth 등 소셜 로그인도 포함
create or replace function handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (id, username, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1),
      substring(new.id::text, 1, 12)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- 기존에 가입했지만 users 레코드가 없는 사용자 일괄 생성
insert into public.users (id, username, avatar_url)
select
  au.id,
  coalesce(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1),
    substring(au.id::text, 1, 12)
  ),
  au.raw_user_meta_data->>'avatar_url'
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id)
on conflict (id) do nothing;

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
  stream_uid      text not null unique,
  thumbnail_url   text,
  duration        integer,
  status          video_status not null default 'processing',
  target_status   video_status not null default 'published',  -- 트랜스코딩 완료 후 전환될 공개 상태
  category        text,
  tags            text[] not null default '{}',
  view_count      bigint not null default 0,
  like_count      bigint not null default 0,
  comment_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_channel_id_idx on videos(channel_id);
create index if not exists videos_status_created_at_idx on videos(status, created_at desc);
create index if not exists videos_category_idx on videos(category) where status = 'published';

-- array_to_string은 STABLE이라 generated column / 인덱스 표현식에 사용 불가
-- IMMUTABLE 래퍼를 먼저 만들어 우회
create or replace function tags_to_text(tags text[])
returns text immutable parallel safe language sql as $$
  select coalesce(array_to_string(tags, ' '), '')
$$;

-- title + description + tags 통합 FTS 저장 컬럼
alter table videos
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      tags_to_text(tags)
    )
  ) stored;

create index if not exists videos_fts_idx on videos using gin(fts);

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
-- 일별 좋아요 집계 (추천 점수 계산용)
-- 총점 = Σ count_i × (10 - i), i=0은 오늘, i=9는 9일 전
-- =============================================
create table if not exists video_daily_likes (
  video_id  uuid not null references videos(id) on delete cascade,
  date      date not null default current_date,
  count     integer not null default 0,
  primary key (video_id, date)
);

create index if not exists video_daily_likes_date_idx on video_daily_likes(date);

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
  reply_count integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists comments_video_id_idx on comments(video_id, created_at desc);
create index if not exists comments_parent_id_idx on comments(parent_id);

alter table comments enable row level security;

create policy "Comments are viewable by everyone"
  on comments for select using (true);

create policy "Users can manage own comments"
  on comments for all using (auth.uid() = user_id);

-- comment_count / reply_count 자동 유지 트리거
-- INSERT/DELETE 시 원자적으로 카운터를 증감 (실시간 COUNT 조회 불필요)
create or replace function update_comment_counts()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      -- 대댓글: 부모 댓글의 reply_count 증가
      update comments set reply_count = reply_count + 1 where id = new.parent_id;
    else
      -- 최상위 댓글: 영상의 comment_count 증가
      update videos set comment_count = comment_count + 1 where id = new.video_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.parent_id is not null then
      update comments set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
    else
      update videos set comment_count = greatest(0, comment_count - 1) where id = old.video_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists on_comment_change on comments;
create trigger on_comment_change
  after insert or delete on comments
  for each row execute function update_comment_counts();

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

-- =============================================
-- RPC 함수들
-- =============================================

-- 조회수 원자적 증가
create or replace function increment_view_count(p_video_id uuid)
returns void as $$
  update videos set view_count = view_count + 1 where id = p_video_id;
$$ language sql security definer;

-- 좋아요 토글 (race condition 방지, video_daily_likes 동기화)
-- returns: true=좋아요됨, false=취소됨
create or replace function toggle_like(p_user_id uuid, p_video_id uuid)
returns boolean as $$
declare
  deleted int;
begin
  delete from likes where user_id = p_user_id and video_id = p_video_id;
  get diagnostics deleted = row_count;
  if deleted > 0 then
    update videos
      set like_count = greatest(0, like_count - 1)
      where id = p_video_id;
    update video_daily_likes
      set count = greatest(0, count - 1)
      where video_id = p_video_id and date = current_date;
    return false;
  else
    insert into likes(user_id, video_id) values(p_user_id, p_video_id)
      on conflict do nothing;
    update videos set like_count = like_count + 1 where id = p_video_id;
    insert into video_daily_likes(video_id, date, count)
      values(p_video_id, current_date, 1)
      on conflict(video_id, date)
      do update set count = video_daily_likes.count + 1;
    return true;
  end if;
end;
$$ language plpgsql security definer;

-- 구독 토글 (race condition 방지)
-- returns: true=구독됨, false=취소됨
create or replace function toggle_subscription(p_user_id uuid, p_channel_id uuid)
returns boolean as $$
declare
  deleted int;
begin
  delete from subscriptions where user_id = p_user_id and channel_id = p_channel_id;
  get diagnostics deleted = row_count;
  if deleted > 0 then
    update channels
      set subscriber_count = greatest(0, subscriber_count - 1)
      where id = p_channel_id;
    return false;
  else
    insert into subscriptions(user_id, channel_id) values(p_user_id, p_channel_id)
      on conflict do nothing;
    update channels set subscriber_count = subscriber_count + 1 where id = p_channel_id;
    return true;
  end if;
end;
$$ language plpgsql security definer;

-- 추천 피드: 시간 가중 좋아요 점수 기반 정렬
-- 총점 = Σ daily_count × (10 - 경과일), 오늘=×10, 9일전=×1
create or replace function get_trending_videos(p_limit int, p_offset int)
returns table(
  id uuid, title text, description text, thumbnail_url text,
  stream_uid text, duration int, view_count bigint, like_count bigint,
  category text, tags text[], created_at timestamptz,
  channel_id uuid, trend_score bigint
) as $$
  select
    v.id, v.title, v.description, v.thumbnail_url,
    v.stream_uid, v.duration, v.view_count, v.like_count,
    v.category, v.tags, v.created_at, v.channel_id,
    coalesce(sum(
      dl.count * greatest(0, 10 - (current_date - dl.date)::int)
    ), 0)::bigint as trend_score
  from videos v
  left join video_daily_likes dl
    on dl.video_id = v.id
    and dl.date between current_date - interval '9 days' and current_date
  where v.status = 'published'
  group by v.id
  order by trend_score desc, v.created_at desc
  limit p_limit offset p_offset;
$$ language sql stable security definer;

-- 구독 피드: 구독 채널의 최신 영상 (업로드 시간 역순)
create or replace function get_subscription_feed(p_user_id uuid, p_limit int, p_offset int)
returns table(
  id uuid, title text, description text, thumbnail_url text,
  stream_uid text, duration int, view_count bigint, like_count bigint,
  category text, tags text[], created_at timestamptz, channel_id uuid
) as $$
  select
    v.id, v.title, v.description, v.thumbnail_url,
    v.stream_uid, v.duration, v.view_count, v.like_count,
    v.category, v.tags, v.created_at, v.channel_id
  from videos v
  inner join subscriptions s on s.channel_id = v.channel_id
  where s.user_id = p_user_id
    and v.status = 'published'
  order by v.created_at desc
  limit p_limit offset p_offset;
$$ language sql stable security definer;

-- 멀티 키워드 검색 (띄어쓰기로 AND 조건, title+description+tags FTS)
create or replace function search_videos(p_query text, p_limit int, p_offset int)
returns table(
  id uuid, title text, description text, thumbnail_url text,
  stream_uid text, duration int, view_count bigint, like_count bigint,
  category text, tags text[], created_at timestamptz, channel_id uuid
) as $$
declare
  tsq tsquery;
  words text[];
begin
  words := array_remove(
    string_to_array(trim(regexp_replace(p_query, '\s+', ' ', 'g')), ' '),
    ''
  );
  if array_length(words, 1) is null then
    return;
  end if;
  select string_agg(word || ':*', ' & ')
    into tsq
    from unnest(words) as word;

  return query
  select
    v.id, v.title, v.description, v.thumbnail_url,
    v.stream_uid, v.duration, v.view_count, v.like_count,
    v.category, v.tags, v.created_at, v.channel_id
  from videos v
  where v.status = 'published'
    and v.fts @@ tsq
  order by
    ts_rank(v.fts, tsq) desc,
    v.created_at desc
  limit p_limit offset p_offset;
end;
$$ language plpgsql stable security definer;

-- 태그/카테고리 기반 유사 영상 추천
create or replace function get_related_videos(p_video_id uuid, p_limit int)
returns table(
  id uuid, title text, thumbnail_url text, stream_uid text,
  duration int, view_count bigint, created_at timestamptz, channel_id uuid
) as $$
declare
  v_tags  text[];
  v_cat   text;
  v_tsq   tsquery;
begin
  select tags, category into v_tags, v_cat from videos where videos.id = p_video_id;

  if v_tags is not null and array_length(v_tags, 1) > 0 then
    select string_agg(t || ':*', ' | ')
      into v_tsq from unnest(v_tags) as t;

    return query
      select v.id, v.title, v.thumbnail_url, v.stream_uid,
             v.duration, v.view_count, v.created_at, v.channel_id
      from videos v
      where v.status = 'published' and v.id != p_video_id
        and v.fts @@ v_tsq
      order by
        ts_rank(v.fts, v_tsq) desc
      limit p_limit;
    return;
  end if;

  -- 태그 없으면 같은 카테고리 최신 영상
  return query
    select v.id, v.title, v.thumbnail_url, v.stream_uid,
           v.duration, v.view_count, v.created_at, v.channel_id
    from videos v
    where v.status = 'published' and v.id != p_video_id
      and (v_cat is null or v.category = v_cat)
    order by v.created_at desc
    limit p_limit;
end;
$$ language plpgsql stable security definer;

-- 구독순 피드: 채널별 최신 영상 그룹핑 (채널은 가장 최근 업로드 순)
create or replace function get_subscription_feed_by_channel(p_user_id uuid, p_videos_per_channel int default 6)
returns table(
  video_id uuid, title text, thumbnail_url text, stream_uid text,
  duration int, view_count bigint, created_at timestamptz,
  channel_id uuid, channel_name text, channel_avatar_url text,
  channel_latest_at timestamptz
) as $$
  with channel_order as (
    select c.id, c.name,
           -- channels.avatar_url 없으면 채널 소유자의 users.avatar_url 사용
           coalesce(c.avatar_url, u.avatar_url) as avatar_url,
           max(v.created_at) as latest_at
    from channels c
    inner join subscriptions s on s.channel_id = c.id and s.user_id = p_user_id
    left join public.users u on u.id = c.owner_id
    left join videos v on v.channel_id = c.id and v.status = 'published'
    group by c.id, c.name, coalesce(c.avatar_url, u.avatar_url)
  ),
  ranked as (
    select v.id, v.title, v.thumbnail_url, v.stream_uid,
           v.duration, v.view_count, v.created_at, v.channel_id,
           co.name as ch_name, co.avatar_url as ch_avatar, co.latest_at,
           row_number() over (partition by v.channel_id order by v.created_at desc) as rn
    from videos v
    inner join channel_order co on co.id = v.channel_id
    where v.status = 'published'
  )
  select r.id, r.title, r.thumbnail_url, r.stream_uid,
         r.duration, r.view_count, r.created_at,
         r.channel_id, r.ch_name, r.ch_avatar, r.latest_at
  from ranked r
  where r.rn <= p_videos_per_channel
  order by r.latest_at desc nulls last, r.channel_id, r.created_at desc;
$$ language sql stable security definer;


-- =============================================
-- Storage 버킷 설정
-- =============================================

-- avatars 버킷 (프로필 사진)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- thumbnails 버킷 (영상 썸네일)
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

create policy "Thumbnail images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'thumbnails');

create policy "Authenticated users can upload thumbnails"
  on storage.objects for insert
  with check (bucket_id = 'thumbnails' and auth.role() = 'authenticated');

create policy "Users can update own thumbnails"
  on storage.objects for update
  using (bucket_id = 'thumbnails' and auth.uid()::text = split_part(name, '_', 1));
