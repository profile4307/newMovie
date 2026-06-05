import { VideoCard } from '@/components/video/VideoCard'
import { api, type Video } from '@/lib/api'

const CATEGORIES = ['전체', '게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리']

type Props = {
  searchParams: Promise<{ category?: string; search?: string; page?: string }>
}

async function fetchVideos(params: { category?: string; search?: string; page?: string }) {
  const page = params.page ? Number(params.page) : 1
  const [trendingRes, latestRes] = await Promise.all([
    api.videos.list({ feed: 'trending', category: params.category, search: params.search, page }).catch(() => ({ data: [] as Video[] })),
    api.videos.list({ feed: 'latest', category: params.category, search: params.search, page }).catch(() => ({ data: [] as Video[] })),
  ])
  return { trending: trendingRes.data, latest: latestRes.data }
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams
  const activeCategory = params.category ?? '전체'
  const { trending, latest } = await fetchVideos(params)

  function categoryHref(cat: string) {
    const q = new URLSearchParams()
    if (cat !== '전체') q.set('category', cat)
    if (params.search) q.set('search', params.search)
    const qs = q.toString()
    return qs ? `/?${qs}` : '/'
  }

  const isEmpty = trending.length === 0 && latest.length === 0

  return (
    <div className="min-h-screen bg-sky-50">
      {/* 카테고리 필터 */}
      <div className="sticky top-14 z-10 bg-white border-b border-sky-200 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4">
          <div className="flex gap-2 py-3 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <a
                key={cat}
                href={categoryHref(cat)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-sky-600 text-white'
                    : 'bg-white text-slate-600 border border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {cat}
              </a>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {params.search && (
          <p className="text-slate-500 text-sm mb-4">
            <span className="font-medium text-slate-800">&#34;{params.search}&#34;</span> 검색 결과
          </p>
        )}

        {isEmpty ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-lg">동영상이 없습니다</p>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* 왼쪽: 추천 영상 */}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-lg">🔥</span> 추천 영상
              </h2>
              {trending.length === 0 ? (
                <p className="text-slate-400 text-sm">추천 영상이 없습니다</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {trending.map((video) => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              )}
            </div>

            {/* 구분선 */}
            <div className="w-px bg-sky-200 hidden lg:block" />

            {/* 오른쪽: 최신 영상 */}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-lg">🆕</span> 최신 영상
              </h2>
              {latest.length === 0 ? (
                <p className="text-slate-400 text-sm">최신 영상이 없습니다</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {latest.map((video) => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
