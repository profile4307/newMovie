import { SupabaseClient } from './supabase'

export async function attachChannels<T extends { channel_id: string }>(
  db: SupabaseClient,
  videos: T[]
): Promise<(T & { channel: { id: string; name: string; avatar_url: string | null } })[]> {
  if (videos.length === 0) return []
  const ids = [...new Set(videos.map((v) => v.channel_id))]
  const inFilter = ids.map((id) => `"${id}"`).join(',')
  const { data: channels } = await db.query<
    { id: string; name: string; avatar_url: string | null; owner: { avatar_url: string | null } | null }[]
  >(`/channels?select=id,name,avatar_url,owner:users!owner_id(avatar_url)&id=in.(${inFilter})`)

  const channelMap = Object.fromEntries(
    (channels ?? []).map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        // channel avatar 없으면 채널 소유자의 user avatar로 fallback
        avatar_url: c.avatar_url || c.owner?.avatar_url || null,
      },
    ])
  )
  return videos.map((v) => ({
    ...v,
    channel: channelMap[v.channel_id] ?? { id: v.channel_id, name: '', avatar_url: null },
  }))
}
