import Link from 'next/link'
import Image from 'next/image'
import type { Video } from '@/lib/api'

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

type Props = { video: Video }

export function VideoCard({ video }: Props) {
  return (
    <Link href={`/watch/${video.id}`} className="group block">
      <div className="relative aspect-video bg-sky-100 rounded-xl overflow-hidden shadow-sm">
        {video.thumbnail_url ? (
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sky-300">
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex gap-2.5">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-sky-200 overflow-hidden">
          {video.channel.avatar_url && (
            <Image src={video.channel.avatar_url} alt={video.channel.name} width={32} height={32} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 text-slate-900 group-hover:text-sky-600 transition-colors">
            {video.title}
          </h3>
          <p className="text-slate-500 text-xs mt-0.5">{video.channel.name}</p>
          <p className="text-slate-400 text-xs">
            조회수 {formatKorean(video.view_count)} · {timeAgo(video.created_at)}
          </p>
        </div>
      </div>
    </Link>
  )
}
