import { VideoCard } from '@/components/video/VideoCard'
import { api, type Video, type FeedType } from '@/lib/api'

const CATEGORIES = ['전체', '게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리']

const FEED_TABS: { key: FeedType; label: string }[] = [
  { key: 'trending', label: '🔥 추천' },
  { key: 'subscriptions', label: '📺 구독' },
  { key: 'latest', label: '🆕 최신' },
]

type Props = {
  searchParams: Promise<{
    feed?: string
    category?: string
    search?: string
    page?: string
  }>
}

async function getVideos(params: {
  feed?: string
  category?: string
  search?: string
  page?: string
}): Promise<{ videos: Video[]; isAuthError: boolean }> {
  const feed = (['trending', 'subscriptions', 'latest'].includes(params.feed ?? '')
    ? params.feed
    : 'trending') as FeedType

  try {
    const result = await api.videos.list({
      feed,
      category: params.category,
      search: params.search,
      page: params.page ? Number(params.page) : 1,
    })
    return { videos: result.data, isAuthError: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'Login required' || msg.includes('UNAUTHENTICATED')) {
      return { videos: [], isAuthError: true }
    }
    return { videos: [], isAuthError: false }
  }
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams
  const activeFeed = (['trending', 'subscriptions', 'latest'].includes(params.feed ?? '')
    ? params.feed
    : 'trending') as FeedType
  const activeCategory = params.category ?? '전체'

  const { videos, isAuthError } = await getVideos(params)

  function feedHref(key: FeedType) {
    const q = new URLSearchParams()
    q.set('feed', key)
    if (params.category && params.category !== '전체') q.set('category', params.category)
    return `/?${q}`
  }

  function categoryHref(cat: string) {
    const q = new URLSearchParams()
    q.set('feed', activeFeed)
    if (cat !== '전체') q.set('category', cat)
    return `/?${q}`
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="sticky top-14 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-screen-xl mx-auto px-4">
          {/* 피드 탭 */}
          <div className="flex gap-1 pt-3 pb-0 border-b border-gray-800/50">
            {FEED_TABS.map(({ key, label }) => (
              <a
                key={key}
                href={feedHref(key)}
                className={`px-5 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                  activeFeed === key
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </a>
            ))}
          </div>

          {/* 카테고리 필터 (구독 탭에서는 숨김) */}
          {activeFeed !== 'subscriptions' && (
            <div className="flex gap-2 py-2.5 overflow-x-auto">
              {CATEGORIES.map((cat) => (
                <a
                  key={cat}
                  href={categoryHref(cat)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-white text-black'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {cat}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 동영상 그리드 */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        {isAuthError ? (
          <div className="text-center py-20">
            <p className="text-2xl mb-3">📺</p>
            <p className="text-lg text-white font-medium">구독 피드를 보려면 로그인하세요</p>
            <p className="text-gray-400 text-sm mt-2">로그인 후 채널을 구독하면 최신 영상을 여기서 볼 수 있어요</p>
            <a
              href="/login"
              className="mt-6 inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-full transition-colors"
            >
              로그인
            </a>
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            {params.search ? (
              <>
                <p className="text-lg text-white">검색 결과가 없습니다</p>
                <p className="text-sm mt-2">
                  &#34;{params.search}&#34; 에 대한 결과를 찾지 못했습니다
                </p>
                <p className="text-xs mt-1">다른 키워드로 검색해보세요 (띄어쓰기로 여러 단어 입력 가능)</p>
              </>
            ) : activeFeed === 'subscriptions' ? (
              <>
                <p className="text-lg text-white">구독 중인 채널의 영상이 없습니다</p>
                <p className="text-sm mt-2">채널을 구독하고 최신 영상을 받아보세요</p>
              </>
            ) : (
              <p className="text-lg">동영상이 없습니다</p>
            )}
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
