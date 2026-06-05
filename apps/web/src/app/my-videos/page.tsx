'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'

type MyVideo = {
  id: string
  title: string
  description: string
  thumbnail_url: string | null
  stream_uid: string
  duration: number | null
  view_count: number
  like_count: number
  status: string
  category: string | null
  created_at: string
}

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDuration(s: number | null) {
  if (!s) return ''
  const m = Math.floor(s / 60); const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  published: { label: '공개', className: 'bg-green-100 text-green-700' },
  processing: { label: '처리중', className: 'bg-amber-100 text-amber-700' },
  private: { label: '비공개', className: 'bg-slate-100 text-slate-600' },
  unlisted: { label: '미등록', className: 'bg-blue-100 text-blue-700' },
  failed: { label: '실패', className: 'bg-red-100 text-red-600' },
}

export default function MyVideosPage() {
  const router = useRouter()
  const [videos, setVideos] = useState<MyVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)

  const loadVideos = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/login'); return }
    try {
      const result = await api.videos.mine()
      setVideos(result.data as MyVideo[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadVideos() }, [loadVideos])

  // 트랜스코딩 완료 여부 수동 확인
  async function checkStatus(video: MyVideo) {
    setChecking(video.id)
    try {
      const status = await api.upload.getStatus(video.stream_uid)
      if (status.state === 'ready') {
        // API가 자동으로 DB 업데이트 → 목록 새로고침
        await loadVideos()
      } else {
        alert(`처리 상태: ${status.state} (${status.pctComplete ?? '?'}% 완료)`)
      }
    } catch {
      alert('상태 확인 중 오류가 발생했습니다')
    } finally {
      setChecking(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <div className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-slate-800">내 동영상</h1>
          <Link
            href="/upload"
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            새 영상 업로드
          </Link>
        </div>

        {videos.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-sky-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-lg text-slate-500">업로드한 영상이 없습니다</p>
            <Link href="/upload" className="mt-4 inline-block text-sky-500 hover:underline text-sm">
              첫 영상을 업로드해보세요
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {videos.map((video) => {
              const statusInfo = STATUS_LABEL[video.status] ?? STATUS_LABEL.processing!
              const isProcessing = video.status === 'processing'

              return (
                <div
                  key={video.id}
                  className={`flex gap-4 bg-white rounded-2xl p-4 border transition-colors ${
                    isProcessing ? 'border-amber-200 bg-amber-50/30' : 'border-sky-100 hover:border-sky-200'
                  }`}
                >
                  {/* 썸네일 */}
                  <div className="flex-shrink-0">
                    <div className="relative w-40 aspect-video bg-sky-100 rounded-xl overflow-hidden">
                      {video.thumbnail_url ? (
                        <Image src={video.thumbnail_url} alt={video.title} fill className="object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-sky-200">
                          {isProcessing ? (
                            <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </div>
                      )}
                      {video.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                          {formatDuration(video.duration)}
                        </span>
                      )}
                      {isProcessing && (
                        <div className="absolute inset-0 bg-amber-400/10 flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      {!isProcessing ? (
                        <Link href={`/watch/${video.id}`} className="font-semibold text-slate-800 hover:text-sky-600 transition-colors line-clamp-1">
                          {video.title}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-700 line-clamp-1">{video.title}</span>
                      )}
                      <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </div>

                    {isProcessing && (
                      <p className="text-sm text-amber-600 mt-1">
                        🔄 트랜스코딩 처리 중입니다. 완료되면 자동으로 공개됩니다.
                      </p>
                    )}

                    <p className="text-sm text-slate-400 mt-1 line-clamp-2">{video.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      {!isProcessing && <span>조회수 {formatCount(video.view_count)}회</span>}
                      {!isProcessing && <span>좋아요 {formatCount(video.like_count)}</span>}
                      <span>{new Date(video.created_at).toLocaleDateString('ko-KR')}</span>
                      {video.category && (
                        <span className="bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full">{video.category}</span>
                      )}
                    </div>
                  </div>

                  {/* 액션 */}
                  <div className="flex-shrink-0 flex flex-col gap-2">
                    {!isProcessing && (
                      <Link
                        href={`/watch/${video.id}`}
                        className="text-xs text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-full transition-colors text-center"
                      >
                        보기
                      </Link>
                    )}
                    {isProcessing && (
                      <button
                        onClick={() => checkStatus(video)}
                        disabled={checking === video.id}
                        className="text-xs text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full transition-colors"
                      >
                        {checking === video.id ? '확인중...' : '상태 확인'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
