'use client'

import { useEffect, useState } from 'react'
import { VideoCard } from './VideoCard'
import { api, type Video } from '@/lib/api'
import Link from 'next/link'

export function SubscriptionFeed() {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)

  useEffect(() => {
    api.videos.list({ feed: 'subscriptions' })
      .then((res) => setVideos(res.data))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('Login required') || msg.includes('Unauthorized') || msg.includes('UNAUTHENTICATED')) {
          setAuthError(true)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (authError) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl mb-3">📺</p>
        <p className="text-lg text-white font-medium">구독 피드를 보려면 로그인하세요</p>
        <p className="text-gray-400 text-sm mt-2">로그인 후 채널을 구독하면 최신 영상을 여기서 볼 수 있어요</p>
        <Link
          href="/login"
          className="mt-6 inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-full transition-colors"
        >
          로그인
        </Link>
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg text-white">구독 중인 채널의 영상이 없습니다</p>
        <p className="text-sm mt-2">채널을 구독하고 최신 영상을 받아보세요</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  )
}
