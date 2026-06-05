import { VideoCard } from '@/components/video/VideoCard'
import { api, type Video } from '@/lib/api'

const CATEGORIES = ['전체', '게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리']

type Props = {
  searchParams: Promise<{ category?: string; search?: string; page?: string }>
}

async function getVideos(params: { category?: string; search?: string; page?: string }) {
  try {
    const result = await api.videos.list({
      category: params.category,
      search: params.search,
      page: params.page ? Number(params.page) : 1,
    })
    return result.data
  } catch {
    return [] as Video[]
  }
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams
  const videos = await getVideos(params)
  const activeCategory = params.category ?? '전체'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* 카테고리 필터 */}
      <div className="sticky top-14 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="flex gap-2 py-3 overflow-x-auto">
            {CATEGORIES.map((cat) => {
              const href = cat === '전체' ? '/' : `/?category=${cat}`
              return (
                <a
                  key={cat}
                  href={href}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-white text-black'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {cat}
                </a>
              )
            })}
          </div>
        </div>
      </div>

      {/* 동영상 그리드 */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        {videos.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">동영상이 없습니다</p>
            {params.search && <p className="text-sm mt-2">&#34;{params.search}&#34; 검색 결과가 없습니다</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
