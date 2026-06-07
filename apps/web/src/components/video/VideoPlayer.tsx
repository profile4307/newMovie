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

    let hls: import('hls.js').default | null = null

    async function initHls() {
      const Hls = (await import('hls.js')).default
      if (Hls.isSupported()) {
        hls = new Hls()
        hls.loadSource(hlsUrl)
        hls.attachMedia(video!)
      } else if (video!.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari 네이티브 HLS
        video!.src = hlsUrl
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
        poster={poster}
        className="w-full h-full"
        playsInline
      />
    </div>
  )
}
