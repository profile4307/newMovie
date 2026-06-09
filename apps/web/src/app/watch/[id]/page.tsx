'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ShareButton } from '@/components/video/ShareButton'

// hls.js는 SSR에서 실행 불가 → ssr: false로 클라이언트 전용 처리 (Turbopack 워커 크래시 방지)
const VideoPlayer = dynamic(
  () => import('@/components/video/VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
  { ssr: false }
)
import { VideoActions } from '@/components/video/VideoActions'
import { CommentSection } from '@/components/video/CommentSection'
import { api, type Video } from '@/lib/api'

const CF_SUBDOMAIN = process.env.NEXT_PUBLIC_BUNNY_CDN_HOSTNAME ?? process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_SUBDOMAIN ?? 'cdn-hostname'

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
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
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

function RelatedCard({ video }: { video: Video }) {
  return (
    <Link href={`/watch/${video.id}`} className="group flex gap-2">
      <div className="relative w-36 flex-shrink-0 aspect-video bg-sky-100 rounded-lg overflow-hidden">
        {video.thumbnail_url ? (
          <Image src={video.thumbnail_url} alt={video.title} fill className="object-cover group-hover:scale-105 transition-transform duration-200" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sky-200">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 line-clamp-2 group-hover:text-sky-600 transition-colors leading-snug">
          {video.title}
        </p>
        <p className="text-xs text-slate-500 mt-1">{video.channel?.name}</p>
        <p className="text-xs text-slate-400">조회수 {formatKorean(video.view_count)} · {timeAgo(video.created_at)}</p>
      </div>
    </Link>
  )
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  private:   { label: '🔒 비공개', className: 'bg-slate-100 text-slate-600 border border-slate-300' },
  unlisted:  { label: '🔗 일부공개', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  processing:{ label: '⏳ 처리중', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
}

export default function WatchPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [video, setVideo] = useState<Video & { status?: string } | null>(null)
  const [related, setRelated] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!params.id) return

    api.videos.get(params.id)
      .then(async (res) => {
        setVideo(res.data)
        // 관련 영상 병렬 로드
        api.videos.related(params.id).then((r) => setRelated(r.data)).catch(() => {})
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !video) {
    return (
      <div className="min-h-screen bg-sky-50 flex flex-col items-center justify-center gap-4">
        <p className="text-4xl">🎬</p>
        <p className="text-xl font-semibold text-slate-700">영상을 찾을 수 없습니다</p>
        <p className="text-slate-400 text-sm">비공개이거나 삭제된 영상일 수 있습니다</p>
        <Link href="/" className="mt-2 bg-sky-500 hover:bg-sky-600 text-white px-5 py-2 rounded-full text-sm font-medium transition-colors">
          홈으로 돌아가기
        </Link>
      </div>
    )
  }

  const statusBadge = video.status ? STATUS_BADGE[video.status] : null

  return (
    <div className="bg-sky-50 min-h-screen">
      {/* 뒤로가기 */}
      <div className="max-w-screen-2xl mx-auto px-4 pt-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-sky-600 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          뒤로
        </button>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 pb-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* 메인 */}
          <div className="flex-1 min-w-0">
            <VideoPlayer
              streamUid={video.stream_uid}
              customerSubdomain={CF_SUBDOMAIN}
              poster={video.thumbnail_url ?? undefined}
            />

            <div className="mt-4 bg-white rounded-2xl p-5 shadow-sm border border-sky-100">
              {/* 제목 + 상태 배지 */}
              <div className="flex items-start gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900 flex-1">{video.title}</h1>
                {statusBadge && (
                  <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge.className}`}>
                    {statusBadge.label}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-4">
                {/* 채널 */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-sky-100 overflow-hidden flex-shrink-0">
                    {video.channel.avatar_url && (
                      <Image src={video.channel.avatar_url} alt={video.channel.name} width={40} height={40} />
                    )}
                  </div>
                  <Link href={`/channel/${video.channel.id}`} className="font-semibold text-slate-900 hover:text-sky-600 transition-colors">
                    {video.channel.name}
                  </Link>
                </div>

                {/* 액션 */}
                <div className="flex items-center gap-2">
                  <VideoActions
                    videoId={video.id}
                    channelId={video.channel.id}
                    initialLikeCount={video.like_count}
                    initialSubscriberCount={video.channel.subscriber_count ?? 0}
                  />
                  <ShareButton title={video.title} />
                </div>
              </div>

              {/* 설명 */}
              <div className="mt-4 pt-4 border-t border-sky-100">
                <p className="text-sm text-slate-500 mb-2">
                  조회수 {formatKorean(video.view_count)}회 · {new Date(video.created_at).toLocaleDateString('ko-KR')}
                </p>
                {video.description && (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{video.description}</p>
                )}
                {video.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {video.tags.map((tag) => (
                      <a key={tag} href={`/?search=${encodeURIComponent(tag)}`}
                        className="text-sky-600 text-sm hover:text-sky-800 transition-colors">
                        #{tag}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 댓글 */}
            <CommentSection videoId={video.id} initialCommentCount={video.comment_count ?? 0} />
          </div>

          {/* 관련 영상 */}
          <aside className="w-full lg:w-80 flex-shrink-0">
            <h2 className="font-bold text-slate-700 mb-3">관련 동영상</h2>
            {related.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">관련 동영상이 없습니다</p>
            ) : (
              <div className="flex flex-col gap-3">
                {related.map((v) => <RelatedCard key={v.id} video={v} />)}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
