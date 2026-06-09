'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'

type Props = {
  file: File
  onConfirm: (croppedFile: File) => void
  onCancel: () => void
}

const CANVAS_SIZE = 400  // 출력 해상도 (px)
const CIRCLE_RADIUS = 160 // 원형 마스크 반지름 (preview용)

export function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const previewUrl = useRef<string>('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // 이미지 자연 크기
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  // 컨테이너 안에서 이미지가 렌더링되는 실제 크기
  const [renderSize, setRenderSize] = useState({ w: 0, h: 0 })
  // 드래그로 이동하는 오프셋 (px, 렌더 좌표계)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // 스케일 (1 = 원본 크기에 fit)
  const [scale, setScale] = useState(1)

  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  // ── 이미지 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    previewUrl.current = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      imgRef.current = img
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = previewUrl.current
    return () => URL.revokeObjectURL(previewUrl.current)
  }, [file])

  // 컨테이너 크기 측정 → renderSize 계산
  useEffect(() => {
    if (!imgSize.w || !containerRef.current) return
    const { clientWidth: cw, clientHeight: ch } = containerRef.current
    const ratio = Math.min(cw / imgSize.w, ch / imgSize.h)
    setRenderSize({ w: imgSize.w * ratio, h: imgSize.h * ratio })
    setScale(ratio)
    setOffset({ x: 0, y: 0 })
  }, [imgSize])

  // ── 드래그 핸들러 ──────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.startX
    const dy = e.clientY - drag.current.startY
    setOffset(clamp({ x: drag.current.ox + dx, y: drag.current.oy + dy }))
  }

  function onPointerUp() { drag.current = null }

  // 오프셋을 이미지 범위 안으로 제한 (원이 이미지 밖으로 나가지 않도록)
  const clamp = useCallback(({ x, y }: { x: number; y: number }) => {
    const halfW = renderSize.w / 2
    const halfH = renderSize.h / 2
    const maxX = halfW - CIRCLE_RADIUS
    const minX = -(halfW - CIRCLE_RADIUS)
    const maxY = halfH - CIRCLE_RADIUS
    const minY = -(halfH - CIRCLE_RADIUS)
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    }
  }, [renderSize])

  // ── 확인: 캔버스로 크롭 후 File 생성 ─────────────────────────
  function handleConfirm() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    const ctx = canvas.getContext('2d')!
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE

    // render 좌표계에서 원 중심 = (containerWidth/2 - offset.x, containerHeight/2 - offset.y)
    // 이걸 원본 이미지 좌표로 역산
    const centerX = (renderSize.w / 2 - offset.x) / scale
    const centerY = (renderSize.h / 2 - offset.y) / scale
    const radius = CIRCLE_RADIUS / scale

    const sx = centerX - radius
    const sy = centerY - radius
    const sw = radius * 2
    const sh = radius * 2

    // 원형 클리핑 후 그리기
    ctx.beginPath()
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_SIZE, CANVAS_SIZE)

    canvas.toBlob((blob) => {
      if (!blob) return
      const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' })
      onConfirm(croppedFile)
    }, 'image/png', 0.95)
  }

  const containerSize = 320

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 배경 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* 모달 */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sky-100">
          <h2 className="font-bold text-slate-800">프로필 사진 조정</h2>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-sky-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 크롭 영역 */}
        <div className="flex flex-col items-center px-5 py-6 gap-4">
          <p className="text-sm text-slate-500">원을 기준으로 사진을 드래그해서 위치를 조정하세요</p>

          {/* 드래그 컨테이너 */}
          <div
            ref={containerRef}
            className="relative overflow-hidden bg-slate-100 rounded-xl cursor-grab active:cursor-grabbing select-none"
            style={{ width: containerSize, height: containerSize }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {previewUrl.current && renderSize.w > 0 && (
              <div
                className="absolute"
                style={{
                  width: renderSize.w,
                  height: renderSize.h,
                  left: containerSize / 2 - renderSize.w / 2 + offset.x,
                  top: containerSize / 2 - renderSize.h / 2 + offset.y,
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              >
                <Image
                  src={previewUrl.current}
                  alt="crop preview"
                  width={renderSize.w}
                  height={renderSize.h}
                  className="object-fill"
                  draggable={false}
                  unoptimized
                />
              </div>
            )}

            {/* 어두운 오버레이 + 원형 구멍 */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={containerSize}
              height={containerSize}
            >
              <defs>
                <mask id="circleMask">
                  <rect width={containerSize} height={containerSize} fill="white" />
                  <circle
                    cx={containerSize / 2}
                    cy={containerSize / 2}
                    r={CIRCLE_RADIUS}
                    fill="black"
                  />
                </mask>
              </defs>
              {/* 원 바깥 어둡게 */}
              <rect
                width={containerSize}
                height={containerSize}
                fill="rgba(0,0,0,0.5)"
                mask="url(#circleMask)"
              />
              {/* 원 테두리 */}
              <circle
                cx={containerSize / 2}
                cy={containerSize / 2}
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="white"
                strokeWidth={2}
                strokeDasharray="6 4"
                opacity={0.8}
              />
            </svg>
          </div>

          {/* 미리보기 */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <div
                className="rounded-full overflow-hidden bg-sky-100 border-2 border-sky-200"
                style={{ width: 64, height: 64 }}
              >
                {previewUrl.current && renderSize.w > 0 && (
                  <div className="relative w-full h-full overflow-hidden rounded-full">
                    <div style={{
                      position: 'absolute',
                      width: renderSize.w / scale * (64 / (CIRCLE_RADIUS * 2 / scale)),
                      height: renderSize.h / scale * (64 / (CIRCLE_RADIUS * 2 / scale)),
                      left: 32 - (renderSize.w / 2 - offset.x) / scale * (64 / (CIRCLE_RADIUS * 2 / scale)),
                      top: 32 - (renderSize.h / 2 - offset.y) / scale * (64 / (CIRCLE_RADIUS * 2 / scale)),
                    }}>
                      <Image src={previewUrl.current} alt="" width={200} height={200} className="object-fill" unoptimized draggable={false} style={{ width: '100%', height: '100%' }} />
                    </div>
                  </div>
                )}
              </div>
              <span className="text-xs text-slate-400">64px</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div
                className="rounded-full overflow-hidden bg-sky-100 border-2 border-sky-200"
                style={{ width: 36, height: 36 }}
              >
                {previewUrl.current && renderSize.w > 0 && (
                  <div className="relative w-full h-full overflow-hidden rounded-full">
                    <div style={{
                      position: 'absolute',
                      width: renderSize.w / scale * (36 / (CIRCLE_RADIUS * 2 / scale)),
                      height: renderSize.h / scale * (36 / (CIRCLE_RADIUS * 2 / scale)),
                      left: 18 - (renderSize.w / 2 - offset.x) / scale * (36 / (CIRCLE_RADIUS * 2 / scale)),
                      top: 18 - (renderSize.h / 2 - offset.y) / scale * (36 / (CIRCLE_RADIUS * 2 / scale)),
                    }}>
                      <Image src={previewUrl.current} alt="" width={100} height={100} className="object-fill" unoptimized draggable={false} style={{ width: '100%', height: '100%' }} />
                    </div>
                  </div>
                )}
              </div>
              <span className="text-xs text-slate-400">36px</span>
            </div>
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-sky-200 text-slate-600 text-sm font-medium hover:bg-sky-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors"
          >
            적용
          </button>
        </div>
      </div>

      {/* 오프스크린 캔버스 (크롭 결과 생성용) */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
