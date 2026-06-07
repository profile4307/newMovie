'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { VideoCard } from '@/components/video/VideoCard'
import { api, type Video } from '@/lib/api'

type SortMode = 'by_channel' | 'latest'

type ChannelGroup = {
  channel: { id: string; name: string; avatar_url: string | null; latest_at: string }
  videos: { id: string; title: string; thumbnail_url: string | null; stream_uid: string; duration: number | null; view_count: number; created_at: string }[]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}개월 전` : `${Math.floor(months / 12)}년 전`
}

function formatKorean(n: number): string {
  if (n >= 10000) {
    const v = n / 10000
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '만'
  }
  if (n >= 1000) {
    const v = n / 1000
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '천'
  }
  return String(n)
}

function formatDuration(s: number | null): string {
  if (!s) return ''
  const m = Math.floor(s / 60); const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function SmallVideoCard({ video }: { video: ChannelGroup['videos'][0] }) {
  return (
    <Link href={`/watch/${video.id}`} className="group block">
      <div className="relative aspect-video bg-sky-100 rounded-lg overflow-hidden">
        {video.thumbnail_url ? (
          <Image src={video.thumbnail_url} alt={video.title} fill className="object-cover group-hover:scale-105 transition-transform duration-200" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sky-300">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium text-slate-900 line-clamp-2 group-hover:text-sky-600 transition-colors leading-snug">
        {video.title}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">
        조회수 {formatKorean(video.view_count)} · {timeAgo(video.created_at)}
      </p>
    </Link>
  )
}

export default function SubscriptionsPage() {
  const [mode, setMode] = useState<SortMode>('by_channel')
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [latestVideos, setLatestVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    loadData(mode)
  }, [mode])

  async function loadData(m: SortMode) {
    setLoading(true)
    setFetchError('')
    try {
      if (m === 'by_channel') {
        const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'
        const { supabase } = await import('@/lib/supabase')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setAuthError(true); return }

        const res = await fetch(`${API_URL}/api/videos/subscription-by-channel`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.status === 401) { setAuthError(true); return }
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: unknown }
          setFetchError(`서버 오류: ${JSON.stringify(err.error ?? res.status)}`)
          return
        }
        const json = await res.json() as { data: ChannelGroup[] }
        setGroups(json.data ?? [])
      } else {
        const result = await api.videos.list({ feed: 'subscriptions' })
        setLatestVideos(result.data)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Login required') || msg.includes('Unauthorized')) setAuthError(true)
      else setFetchError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-sky-50 flex flex-col items-center justify-center gap-4">
        <p className="text-2xl">📺</p>
        <p className="text-lg font-semibold text-slate-800">로그인이 필요합니다</p>
        <Link href="/login" className="bg-sky-600 hover:bg-sky-700 text-white font-medium px-6 py-2.5 rounded-full transition-colors">
          로그인
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        {/* 헤더 + 정렬 버튼 */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-800">구독</h1>
          <div className="flex gap-2 bg-white border border-sky-200 rounded-full p-1">
            <button
              onClick={() => setMode('by_channel')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                mode === 'by_channel' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-sky-700'
              }`}
            >
              구독순
            </button>
            <button
              onClick={() => setMode('latest')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                mode === 'latest' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-sky-700'
              }`}
            >
              최신순
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : fetchError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-600 text-sm">
            <p className="font-semibold mb-1">데이터를 불러오지 못했습니다</p>
            <p className="font-mono text-xs break-all">{fetchError}</p>
            <button onClick={() => loadData(mode)} className="mt-3 text-sky-600 hover:underline text-sm">다시 시도</button>
          </div>
        ) : mode === 'by_channel' ? (
          /* 구독순: 채널별 그룹 */
          groups.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <p className="text-lg text-slate-600">구독 중인 채널이 없습니다</p>
              <p className="text-sm mt-2">채널을 구독하고 최신 영상을 받아보세요</p>
            </div>
          ) : (
            <div className="space-y-10">
              {groups.map(({ channel, videos }) => (
                <div key={channel.id}>
                  {/* 채널 헤더 */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-full bg-sky-200 overflow-hidden flex-shrink-0">
                      {channel.avatar_url && (
                        <Image src={channel.avatar_url} alt={channel.name} width={36} height={36} />
                      )}
                    </div>
                    <div>
                      <Link href={`/channel/${channel.id}`} className="font-semibold text-slate-800 hover:text-sky-600 transition-colors">
                        {channel.name}
                      </Link>
                      <p className="text-xs text-slate-400">최근 업로드 {timeAgo(channel.latest_at)}</p>
                    </div>
                  </div>
                  {/* 영상 그리드 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {videos.map((v) => <SmallVideoCard key={v.id} video={v} />)}
                  </div>
                  <div className="mt-4 border-b border-sky-200" />
                </div>
              ))}
            </div>
          )
        ) : (
          /* 최신순: 플랫 그리드 */
          latestVideos.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <p className="text-lg text-slate-600">구독 채널의 영상이 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {latestVideos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
