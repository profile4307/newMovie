'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'

type Props = {
  file: File
  onConfirm: (croppedFile: File) => void
  onCancel: () => void
}

const CONTAINER    = 440   // 크롭 컨테이너 크기 (px)
const MIN_RADIUS   = 60    // 원 최소 반지름
const MAX_RADIUS   = 180   // 원 최대 반지름
const DEF_RADIUS   = 130   // 초기 원 반지름
const OUT_SIZE     = 400   // 출력 이미지 해상도

export function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const objectUrl  = useRef('')
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const imgEl      = useRef<HTMLImageElement | null>(null)
  const [imgNat, setImgNat] = useState({ w: 0, h: 0 })

  // ── 원 반지름 (슬라이더로 변경) ──────────────────────────────────
  const [radius, setRadius] = useState(DEF_RADIUS)

  // ── 이미지 오프셋 (드래그로 변경, 컨테이너 중심 기준) ───────────
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // ── 이미지 렌더 크기 (컨테이너 fill + 40% 여유) ─────────────────
  // fill scale: 이미지의 짧은 쪽이 CONTAINER 이상이 되도록
  const fillScale = imgNat.w && imgNat.h
    ? Math.max(CONTAINER / imgNat.w, CONTAINER / imgNat.h) * 1.4
    : 1
  const rw = imgNat.w * fillScale
  const rh = imgNat.h * fillScale

  // ── 이미지 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    objectUrl.current = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      imgEl.current = img
      setImgNat({ w: img.naturalWidth, h: img.naturalHeight })
      setOffset({ x: 0, y: 0 })
      setRadius(DEF_RADIUS)
    }
    img.src = objectUrl.current
    return () => URL.revokeObjectURL(objectUrl.current)
  }, [file])

  // ── 오프셋 클램핑 ────────────────────────────────────────────────
  // 이미지가 원을 항상 완전히 덮어야 함
  const clamp = useCallback((ox: number, oy: number, r: number) => {
    const maxX = Math.max(0, rw / 2 - r)
    const maxY = Math.max(0, rh / 2 - r)
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    }
  }, [rw, rh])

  // ── 드래그 ───────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const nx = drag.current.ox + (e.clientX - drag.current.sx)
    const ny = drag.current.oy + (e.clientY - drag.current.sy)
    setOffset(clamp(nx, ny, radius))
  }
  function onPointerUp() { drag.current = null }

  // ── 슬라이더 → 원 크기 변경 ─────────────────────────────────────
  function handleRadiusSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const nr = Number(e.target.value)
    setRadius(nr)
    setOffset(prev => clamp(prev.x, prev.y, nr))
  }

  // ── 확인: Canvas로 크롭 ──────────────────────────────────────────
  function handleConfirm() {
    const canvas = canvasRef.current
    const img    = imgEl.current
    if (!canvas || !img || !imgNat.w) return
    const ctx = canvas.getContext('2d')!
    canvas.width  = OUT_SIZE
    canvas.height = OUT_SIZE

    // 원 중심 = 컨테이너 중심 (고정)
    // 이미지에서 원 중심에 해당하는 좌표 (render 좌표계):
    //   imageLeft = CONTAINER/2 - rw/2 + offset.x
    //   circleCX_in_image = CONTAINER/2 - imageLeft = rw/2 - offset.x
    const cxRender = rw / 2 - offset.x
    const cyRender = rh / 2 - offset.y

    // 원본 이미지 좌표로 변환
    const cxNat = cxRender / fillScale
    const cyNat = cyRender / fillScale
    const rNat  = radius   / fillScale   // 반지름 (원본 좌표계)

    // 원형 클립 후 그리기
    ctx.beginPath()
    ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, cxNat - rNat, cyNat - rNat, rNat * 2, rNat * 2, 0, 0, OUT_SIZE, OUT_SIZE)

    canvas.toBlob(blob => {
      if (!blob) return
      onConfirm(new File([blob], 'avatar.png', { type: 'image/png' }))
    }, 'image/png', 0.95)
  }

  // ── 미리보기 컴포넌트 ────────────────────────────────────────────
  // viewScale: 원 지름 → preview size 배율
  // 이미지 위치 = preview중심 - (render좌표계에서 원중심까지 거리) * viewScale
  //   = size/2 - (rw/2 - offset.x) * viewScale
  //   = size/2 - pw/2 + offset.x * viewScale
  function PreviewCircle({ size }: { size: number }) {
    const vs = size / (radius * 2)
    const pw = rw * vs
    const ph = rh * vs
    const px = size / 2 - pw / 2 + offset.x * vs
    const py = size / 2 - ph / 2 + offset.y * vs
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className="rounded-full overflow-hidden bg-slate-200 border-2 border-sky-200 flex-shrink-0 relative"
          style={{ width: size, height: size }}
        >
          {objectUrl.current && pw > 0 && (
            <Image
              src={objectUrl.current}
              alt=""
              unoptimized
              draggable={false}
              width={Math.max(1, Math.round(pw))}
              height={Math.max(1, Math.round(ph))}
              style={{ position: 'absolute', left: px, top: py, width: pw, height: ph, pointerEvents: 'none', userSelect: 'none' }}
            />
          )}
        </div>
        <span className="text-xs text-slate-400">{size}px</span>
      </div>
    )
  }

  const cx = CONTAINER / 2
  const cy = CONTAINER / 2

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sky-100">
          <div>
            <h2 className="font-bold text-slate-800">프로필 사진 조정</h2>
            <p className="text-xs text-slate-400 mt-0.5">이미지 드래그로 위치 조정 · 슬라이더로 원 크기 조정</p>
          </div>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-sky-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* ── 크롭 영역 ── */}
          <div className="flex justify-center">
            <div
              className="relative overflow-hidden bg-slate-800 rounded-xl cursor-grab active:cursor-grabbing select-none"
              style={{ width: CONTAINER, height: CONTAINER }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* 이미지 */}
              {objectUrl.current && rw > 0 && (
                <Image
                  src={objectUrl.current}
                  alt="crop"
                  unoptimized
                  draggable={false}
                  width={Math.round(rw)}
                  height={Math.round(rh)}
                  style={{
                    position: 'absolute',
                    left: cx - rw / 2 + offset.x,
                    top:  cy - rh / 2 + offset.y,
                    width: rw,
                    height: rh,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
              )}

              {/* 바깥 어둡게 + 원 테두리 */}
              <svg className="absolute inset-0 pointer-events-none" width={CONTAINER} height={CONTAINER}>
                <defs>
                  <mask id="cropHole">
                    <rect width={CONTAINER} height={CONTAINER} fill="white" />
                    <circle cx={cx} cy={cy} r={radius} fill="black" />
                  </mask>
                </defs>
                <rect width={CONTAINER} height={CONTAINER} fill="rgba(0,0,0,0.55)" mask="url(#cropHole)" />
                <circle cx={cx} cy={cy} r={radius} fill="none" stroke="white" strokeWidth={2} strokeDasharray="6 4" opacity={0.9} />
              </svg>
            </div>
          </div>

          {/* ── 원 크기 슬라이더 ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-600">원 크기</span>
              <span className="text-xs text-slate-400">{radius}px</span>
            </div>
            <div className="flex items-center gap-3">
              {/* 작은 원 아이콘 */}
              <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
              <input
                type="range"
                min={MIN_RADIUS}
                max={MAX_RADIUS}
                step={1}
                value={radius}
                onChange={handleRadiusSlider}
                className="flex-1 h-1.5 rounded-full accent-sky-500 cursor-pointer"
              />
              {/* 큰 원 아이콘 */}
              <div className="w-6 h-6 rounded-full border-2 border-slate-300 flex-shrink-0" />
            </div>
          </div>

          {/* ── 미리보기 ── */}
          <div className="flex items-end justify-center gap-6 py-1">
            <PreviewCircle size={72} />
            <PreviewCircle size={44} />
            <PreviewCircle size={28} />
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 px-6 pb-5">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-sky-200 text-slate-600 text-sm font-medium hover:bg-sky-50 transition-colors">
            취소
          </button>
          <button onClick={handleConfirm} disabled={!imgNat.w} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 text-white text-sm font-semibold transition-colors">
            적용
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
