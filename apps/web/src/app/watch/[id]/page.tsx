import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { api } from '@/lib/api'

type Props = { params: Promise<{ id: string }> }

export default async function WatchPage({ params }: Props) {
  const { id } = await params

  let video
  try {
    const result = await api.videos.get(id)
    video = result.data
  } catch {
    notFound()
  }

  const customerSubdomain = process.env.CF_STREAM_CUSTOMER_SUBDOMAIN ?? 'customer-subdomain'

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

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
                <div className="w-10 h-10 rounded-full bg-gray-700" />
                <div>
                  <p className="font-medium text-white">{video.channel.name}</p>
                  <p className="text-sm text-gray-400">
                    구독자 {formatCount(video.channel.subscriber_count ?? 0)}명
                  </p>
                </div>
                <button className="ml-2 bg-white text-black text-sm font-medium px-4 py-2 rounded-full hover:bg-gray-200 transition-colors">
                  구독
                </button>
              </div>

              {/* 좋아요 */}
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                  </svg>
                  {formatCount(video.like_count)}
                </button>
                <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors">
                  공유
                </button>
              </div>
            </div>

            {/* 설명 */}
            <div className="mt-4 bg-gray-900 rounded-xl p-4">
              <p className="text-sm text-gray-400 mb-2">
                조회수 {formatCount(video.view_count)}회 · {new Date(video.created_at).toLocaleDateString('ko-KR')}
              </p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{video.description}</p>
              {video.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {video.tags.map((tag) => (
                    <span key={tag} className="text-blue-400 text-sm">#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 사이드바 — 추천 동영상 (추후 구현) */}
        <aside className="w-full lg:w-80 flex-shrink-0">
          <p className="text-gray-500 text-sm text-center py-8">추천 동영상 준비 중</p>
        </aside>
      </div>
    </div>
  )
}
