import { supabase } from './supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error: string }).error ?? 'Request failed')
  }

  return res.json() as Promise<T>
}

export type Video = {
  id: string
  title: string
  description: string
  stream_uid: string
  thumbnail_url: string | null
  duration: number | null
  view_count: number
  like_count: number
  category: string | null
  tags: string[]
  created_at: string
  channel: {
    id: string
    name: string
    avatar_url: string | null
    subscriber_count?: number
  }
}

export type Channel = {
  id: string
  name: string
  description: string
  avatar_url: string | null
  banner_url: string | null
  subscriber_count: number
  created_at: string
}

export type Comment = {
  id: string
  content: string
  created_at: string
  user: { id: string; username: string; avatar_url: string | null }
}

export const api = {
  videos: {
    list: (params?: { page?: number; category?: string; search?: string }) => {
      const q = new URLSearchParams()
      if (params?.page) q.set('page', String(params.page))
      if (params?.category) q.set('category', params.category)
      if (params?.search) q.set('search', params.search)
      return request<{ data: Video[] }>(`/api/videos?${q}`)
    },
    get: (id: string) => request<{ data: Video }>(`/api/videos/${id}`),
    create: (body: {
      title: string
      description: string
      stream_uid: string
      thumbnail_url?: string
      duration?: number
      category?: string
      tags?: string[]
    }) => request<{ data: Video }>('/api/videos', { method: 'POST', body: JSON.stringify(body) }),
    like: (id: string) =>
      request<{ liked: boolean }>(`/api/videos/${id}/like`, { method: 'POST' }),
  },
  channels: {
    get: (id: string) => request<{ data: Channel }>(`/api/channels/${id}`),
    videos: (id: string) => request<{ data: Video[] }>(`/api/channels/${id}/videos`),
    create: (body: { name: string; description: string }) =>
      request<{ data: Channel }>('/api/channels', { method: 'POST', body: JSON.stringify(body) }),
    subscribe: (id: string) =>
      request<{ subscribed: boolean }>(`/api/channels/${id}/subscribe`, { method: 'POST' }),
  },
  upload: {
    getStreamUrl: () =>
      request<{ uploadUrl: string; streamUid: string }>('/api/upload/stream-url', {
        method: 'POST',
      }),
    getStatus: (uid: string) =>
      request<{ uid: string; state: string; pctComplete: string; duration: number; thumbnail: string }>(
        `/api/upload/stream-status/${uid}`
      ),
  },
  comments: {
    list: (videoId: string, page = 1) =>
      request<{ data: Comment[] }>(`/api/comments?video_id=${videoId}&page=${page}`),
    create: (body: { video_id: string; content: string; parent_id?: string }) =>
      request<{ data: Comment }>('/api/comments', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: string) => request<{ success: boolean }>(`/api/comments/${id}`, { method: 'DELETE' }),
  },
  auth: {
    me: () => request<{ data: { id: string; username: string; avatar_url: string | null } }>('/api/auth/me'),
    createProfile: (username: string) =>
      request('/api/auth/profile', { method: 'POST', body: JSON.stringify({ username }) }),
  },
}
