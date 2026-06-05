'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'

type Props = {
  videoId: string
  channelId: string
  initialLikeCount: number
  initialSubscriberCount: number
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function VideoActions({ videoId, channelId, initialLikeCount, initialSubscriberCount }: Props) {
  const router = useRouter()
  const [liked, setLiked] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [likeCount, setLikeCount] = useState(initialLikeCount)
  const [subscriberCount, setSubscriberCount] = useState(initialSubscriberCount)
  const [userId, setUserId] = useState<string | null>(null)
  const [likeLoading, setLikeLoading] = useState(false)
  const [subLoading, setSubLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const uid = session.user.id
      setUserId(uid)

      // 좋아요 여부 확인
      const { data: likeData } = await supabase
        .from('likes')
        .select('id')
        .eq('user_id', uid)
        .eq('video_id', videoId)
        .limit(1)
      setLiked((likeData?.length ?? 0) > 0)

      // 구독 여부 확인
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', uid)
        .eq('channel_id', channelId)
        .limit(1)
      setSubscribed((subData?.length ?? 0) > 0)
    })
  }, [videoId, channelId])

  async function handleLike() {
    if (!userId) { router.push('/login'); return }
    if (likeLoading) return
    setLikeLoading(true)
    try {
      const result = await api.videos.like(videoId)
      setLiked(result.liked)
      setLikeCount((prev) => result.liked ? prev + 1 : Math.max(0, prev - 1))
    } finally {
      setLikeLoading(false)
    }
  }

  async function handleSubscribe() {
    if (!userId) { router.push('/login'); return }
    if (subLoading) return
    setSubLoading(true)
    try {
      const result = await api.channels.subscribe(channelId)
      setSubscribed(result.subscribed)
      setSubscriberCount((prev) => result.subscribed ? prev + 1 : Math.max(0, prev - 1))
    } finally {
      setSubLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* 구독 버튼 */}
      <button
        onClick={handleSubscribe}
        disabled={subLoading}
        className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
          subscribed
            ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            : 'bg-sky-600 text-white hover:bg-sky-700'
        }`}
      >
        {subLoading ? '...' : subscribed ? `구독중 ${formatCount(subscriberCount)}` : `구독 ${formatCount(subscriberCount)}`}
      </button>

      {/* 좋아요 버튼 */}
      <button
        onClick={handleLike}
        disabled={likeLoading}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
          liked
            ? 'bg-sky-600 text-white border-sky-600'
            : 'bg-white text-slate-700 border-slate-300 hover:bg-sky-50 hover:border-sky-400'
        }`}
      >
        <svg className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
        </svg>
        {likeLoading ? '...' : formatCount(likeCount)}
      </button>
    </div>
  )
}
