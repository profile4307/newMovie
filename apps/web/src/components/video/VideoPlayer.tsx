'use client'

import { useEffect, useRef } from 'react'

type Props = {
  streamUid: string
  customerSubdomain: string  // Bunny CDN 호스트명 (하위 호환 prop명 유지)
  poster?: string
}

export function VideoPlayer({ streamUid, customerSubdomain, poster }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Bunny Stream HLS URL
  const hlsUrl = `https://${customerSubdomain}/${streamUid}/playlist.m3u8`

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null

    async function initHls() {
      const Hls = (await import('hls.js')).default
      if (Hls.isSupported()) {
        // 버퍼 상한 — 이탈 시 미리 받은 세그먼트 낭비(Bunny 전송비) 차단.
        // 더 공격적으로 줄이려면 15/30. 리버퍼 위험과 트레이드오프.
        hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 })
        hls.loadSource(hlsUrl)
        hls.attachMedia(video!)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video!.play().catch(() => {
            // 브라우저 자동재생 정책으로 차단된 경우 무음으로 재시도
            video!.muted = true
            video!.play().catch(() => {})
          })
        })
      } else if (video!.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari 네이티브 HLS
        video!.src = hlsUrl
        video!.addEventListener('loadedmetadata', () => {
          video!.play().catch(() => {
            video!.muted = true
            video!.play().catch(() => {})
          })
        }, { once: true })
      }
    }

    initHls()

    return () => {
      hls?.destroy()
    }
  }, [hlsUrl])

  return (
    <div className="relative w-full bg-black aspect-video rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        controls
        autoPlay
        poster={poster}
        className="w-full h-full"
        playsInline
      />
    </div>
  )
}
