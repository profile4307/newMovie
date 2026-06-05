import Link from 'next/link'
import Image from 'next/image'
import type { Video } from '@/lib/api'

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
  if (months < 12) return `${months}개월 전`
  return `${Math.floor(months / 12)}년 전`
}

type Props = { video: Video }

export function VideoCard({ video }: Props) {
  return (
    <Link href={`/watch/${video.id}`} className="group block">
      <div className="relative aspect-video bg-gray-900 rounded-xl overflow-hidden">
        {video.thumbnail_url ? (
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600">
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-700 overflow-hidden">
          {video.channel.avatar_url && (
            <Image src={video.channel.avatar_url} alt={video.channel.name} width={36} height={36} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm leading-snug line-clamp-2 text-white group-hover:text-blue-400 transition-colors">
            {video.title}
          </h3>
          <p className="text-gray-400 text-xs mt-1">{video.channel.name}</p>
          <p className="text-gray-500 text-xs">
            조회수 {formatCount(video.view_count)} · {timeAgo(video.created_at)}
          </p>
        </div>
      </div>
    </Link>
  )
}
