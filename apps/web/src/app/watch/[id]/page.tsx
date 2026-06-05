import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { ShareButton } from '@/components/video/ShareButton'
import { api, type Video } from '@/lib/api'

type Props = { params: Promise<{ id: string }> }

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
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
      <div className="relative w-40 flex-shrink-0 aspect-video bg-gray-800 rounded-lg overflow-hidden">
        {video.thumbnail_url ? (
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 py-0.5 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white line-clamp-2 group-hover:text-blue-400 transition-colors leading-snug">
          {video.title}
        </p>
        <p className="text-xs text-gray-400 mt-1">{video.channel?.name}</p>
        <p className="text-xs text-gray-500">
          조회수 {formatCount(video.view_count)} · {timeAgo(video.created_at)}
        </p>
      </div>
    </Link>
  )
}

export default async function WatchPage({ params }: Props) {
  const { id } = await params

  let video: Video
  let relatedVideos: Video[] = []

  try {
    const result = await api.videos.get(id)
    video = result.data
  } catch {
    notFound()
  }

  try {
    const related = await api.videos.related(id)
    relatedVideos = related.data
  } catch {
    // 관련 영상 실패는 무시
  }

  const customerSubdomain = process.env.CF_STREAM_CUSTOMER_SUBDOMAIN ?? 'customer-subdomain'

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 메인 컨텐츠 */}
        <div className="flex-1 min-w-0">
          <VideoPlayer
            streamUid={video.stream_uid}
            customerSubdomain={customerSubdomain}
            poster={video.thumbnail_url ?? undefined}
          />

          {/* 동영상 정보 */}
          <div className="mt-4">
            <h1 className="text-xl font-bold text-white">{video.title}</h1>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-3">
              {/* 채널 정보 */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex-shrink-0">
                  {video.channel.avatar_url && (
                    <Image
                      src={video.channel.avatar_url}
                      alt={video.channel.name}
                      width={40}
                      height={40}
                    />
                  )}
                </div>
                <div>
                  <Link
                    href={`/channel/${video.channel.id}`}
                    className="font-medium text-white hover:text-blue-400 transition-colors"
                  >
                    {video.channel.name}
                  </Link>
                  <p className="text-sm text-gray-400">
                    구독자 {formatCount(video.channel.subscriber_count ?? 0)}명
                  </p>
                </div>
                <button className="ml-2 bg-white text-black text-sm font-medium px-4 py-2 rounded-full hover:bg-gray-200 transition-colors">
                  구독
                </button>
              </div>

              {/* 액션 버튼 */}
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                    />
                  </svg>
                  {formatCount(video.like_count)}
                </button>
                <ShareButton title={video.title} />
              </div>
            </div>

            {/* 설명 */}
            <div className="mt-4 bg-gray-900 rounded-xl p-4">
              <p className="text-sm text-gray-400 mb-2">
                조회수 {formatCount(video.view_count)}회 ·{' '}
                {new Date(video.created_at).toLocaleDateString('ko-KR')}
              </p>
              {video.description && (
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{video.description}</p>
              )}
              {video.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {video.tags.map((tag) => (
                    <a
                      key={tag}
                      href={`/?search=${encodeURIComponent(tag)}`}
                      className="text-blue-400 text-sm hover:text-blue-300 transition-colors"
                    >
                      #{tag}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 사이드바 — 관련 영상 */}
        <aside className="w-full lg:w-80 flex-shrink-0">
          <h2 className="text-white font-semibold mb-4">관련 동영상</h2>
          {relatedVideos.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">관련 동영상이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-3">
              {relatedVideos.map((v) => (
                <RelatedCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
