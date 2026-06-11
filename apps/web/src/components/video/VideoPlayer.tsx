'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  streamUid: string
  customerSubdomain: string  // Bunny CDN 호스트명 (하위 호환 prop명 유지)
  playbackUrl?: string       // API가 내려준 재생 URL (Bunny/R2 서빙 호스트 반영) — 있으면 우선
  poster?: string
}

export function VideoPlayer({ streamUid, customerSubdomain, playbackUrl, poster }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // 클릭-투-플레이: 재생 버튼을 누르기 전에는 스트림을 한 바이트도 받지 않음 (전송비 절감)
  const [started, setStarted] = useState(false)

  const hlsUrl = playbackUrl ?? `https://${customerSubdomain}/${streamUid}/playlist.m3u8`

  useEffect(() => {
    if (!started) return
    const video = videoRef.current
    if (!video) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null

    async function initHls() {
      const Hls = (await import('hls.js')).default
      if (Hls.isSupported()) {
        hls = new Hls({
          // 버퍼 상한 — 이탈 시 미리 받은 세그먼트 낭비(Bunny 전송비) 차단.
          // 리버퍼가 잦으면 30/60으로 되돌릴 것.
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          // 플레이어 표시 크기보다 높은 해상도는 받지 않음 — 모바일·작은 창에서 전송량 대폭 절감
          capLevelToPlayerSize: true,
          // 최저 화질로 시작 후 ABR이 끌어올림 — 초기 전송량·시작 지연 최소화.
          // 첫 1~2 세그먼트의 화질 저하가 거슬리면 -1(자동)로 변경.
          startLevel: 0,
        })
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
  }, [hlsUrl, started])

  return (
    <div className="relative w-full bg-black aspect-video rounded-lg overflow-hidden">
      {started ? (
        <video
          ref={videoRef}
          controls
          poster={poster}
          className="w-full h-full"
          playsInline
        />
      ) : (
        <button
          onClick={() => setStarted(true)}
          className="group absolute inset-0 w-full h-full"
          aria-label="동영상 재생"
        >
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-16 h-16 rounded-full bg-black/60 group-hover:bg-sky-500/90 transition-colors flex items-center justify-center">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
