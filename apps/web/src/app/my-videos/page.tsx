'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { api, type Video } from '@/lib/api'

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDuration(s: number | null) {
  if (!s) return ''
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function MyVideosPage() {
  const router = useRouter()
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [channelId, setChannelId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }

      try {
        // 내 채널 조회
        const { data: channels } = await supabase
          .from('channels')
          .select('id')
          .eq('owner_id', session.user.id)
          .limit(1)

        if (!channels || channels.length === 0) {
          setLoading(false)
          return
        }
        const cid = channels[0].id
        setChannelId(cid)

        // 채널 영상 목록 (모든 상태 포함)
        const result = await api.channels.videos(cid)
        setVideos(result.data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white max-w-screen-xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">내 동영상</h1>
        <Link
          href="/upload"
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          새 영상 업로드
        </Link>
      </div>

      {videos.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-lg">업로드한 영상이 없습니다</p>
          <Link href="/upload" className="mt-4 inline-block text-blue-400 hover:underline text-sm">
            첫 영상을 업로드해보세요
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <div key={video.id} className="flex gap-4 bg-gray-900 rounded-xl p-4 hover:bg-gray-800 transition-colors">
              {/* 썸네일 */}
              <Link href={`/watch/${video.id}`} className="flex-shrink-0">
                <div className="relative w-40 aspect-video bg-gray-800 rounded-lg overflow-hidden">
                  {video.thumbnail_url ? (
                    <Image src={video.thumbnail_url} alt={video.title} fill className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-600">
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  )}
                  {video.duration && (
                    <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>
              </Link>

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <Link href={`/watch/${video.id}`} className="font-medium text-white hover:text-blue-400 transition-colors line-clamp-2">
                  {video.title}
                </Link>
                <p className="text-sm text-gray-400 mt-1 line-clamp-2">{video.description}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span>조회수 {formatCount(video.view_count)}회</span>
                  <span>좋아요 {formatCount(video.like_count)}</span>
                  <span>{new Date(video.created_at).toLocaleDateString('ko-KR')}</span>
                  {video.category && <span className="bg-gray-700 px-2 py-0.5 rounded-full">{video.category}</span>}
                </div>
              </div>

              {/* 액션 */}
              <div className="flex-shrink-0 flex items-start gap-2">
                <Link
                  href={`/watch/${video.id}`}
                  className="text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-full transition-colors"
                >
                  보기
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
