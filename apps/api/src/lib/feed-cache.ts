import { Env } from '../index'
import { createSupabaseClient } from './supabase'
import { attachChannels } from './channels'

type FeedVideoRow = {
  id: string
  title: string
  description: string
  thumbnail_url: string | null
  stream_uid: string
  duration: number | null
  view_count: number
  like_count: number
  category: string | null
  tags: string[]
  created_at: string
  channel_id: string
}

export type CachedVideo = FeedVideoRow & {
  channel: { id: string; name: string; avatar_url: string | null }
}

export interface CachedFeed {
  data: CachedVideo[]
  cachedAt: string
}

export async function refreshFeedCache(env: Env): Promise<void> {
  const db = createSupabaseClient(env)
  const size = parseInt(env.FEED_CACHE_SIZE ?? '50', 10)
  const ttlMinutes = parseInt(env.FEED_CACHE_TTL_MINUTES ?? '30', 10)
  const ttlSeconds = ttlMinutes * 60 * 2 // 갱신 주기의 2배 — 장애 시 stale 데이터 유지

  // Trending 피드
  const { data: trendingRaw, error: tErr } = await db.rpc<FeedVideoRow[]>(
    'get_trending_videos',
    { p_limit: size, p_offset: 0 }
  )
  if (!tErr && trendingRaw && trendingRaw.length > 0) {
    const trending = await attachChannels(db, trendingRaw)
    const payload: CachedFeed = { data: trending, cachedAt: new Date().toISOString() }
    await env.FEED_CACHE.put('feed:trending', JSON.stringify(payload), {
      expirationTtl: ttlSeconds,
    })
  }

  // Latest 피드
  const { data: latestRaw, error: lErr } = await db.query<FeedVideoRow[]>(
    `/videos?select=id,title,description,thumbnail_url,stream_uid,duration,view_count,like_count,category,tags,created_at,channel_id&status=eq.published&order=created_at.desc&limit=${size}&offset=0`
  )
  if (!lErr && latestRaw && latestRaw.length > 0) {
    const latest = await attachChannels(db, latestRaw)
    const payload: CachedFeed = { data: latest, cachedAt: new Date().toISOString() }
    await env.FEED_CACHE.put('feed:latest', JSON.stringify(payload), {
      expirationTtl: ttlSeconds,
    })
  }
}
