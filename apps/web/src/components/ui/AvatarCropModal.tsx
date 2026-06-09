'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'

type Props = {
  file: File
  onConfirm: (croppedFile: File) => void
  onCancel: () => void
}

const CONTAINER = 420   // 크롭 영역 컨테이너 크기 (px)
const RADIUS = 160      // 원형 마스크 반지름 (px)
const OUT_SIZE = 400    // 최종 출력 이미지 크기 (px)

export function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const objectUrl = useRef('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 })

  // scale: 이미지 렌더 배율 (minScale 기준)
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [maxScale, setMaxScale] = useState(4)

  // 이미지 중심 오프셋 (컨테이너 중심 기준, px)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // ── 이미지 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    objectUrl.current = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      imgRef.current = img
      const nat = { w: img.naturalWidth, h: img.naturalHeight }
      setImgNatural(nat)

      // 원을 꽉 채우는 최소 배율 (이미지의 짧은 쪽 = 원 지름)
      const min = (RADIUS * 2) / Math.min(nat.w, nat.h)
      setMinScale(min)
      setMaxScale(min * 5)
      setScale(min * 1.3)   // 처음엔 살짝 줌인 상태
      setOffset({ x: 0, y: 0 })
    }
    img.src = objectUrl.current
    return () => URL.revokeObjectURL(objectUrl.current)
  }, [file])

  // 렌더 크기 (scale 적용)
  const renderW = imgNatural.w * scale
  const renderH = imgNatural.h * scale

  // 오프셋 클램핑: 이미지가 항상 원을 완전히 덮어야 함
  const clamp = useCallback((ox: number, oy: number, s: number) => {
    const rw = imgNatural.w * s
    const rh = imgNatural.h * s
    const maxX = rw / 2 - RADIUS
    const maxY = rh / 2 - RADIUS
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    }
  }, [imgNatural])

  // ── 드래그 핸들러 ────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const nx = drag.current.ox + (e.clientX - drag.current.sx)
    const ny = drag.current.oy + (e.clientY - drag.current.sy)
    setOffset(clamp(nx, ny, scale))
  }
  function onPointerUp() { drag.current = null }

  // ── 줌 슬라이더 ──────────────────────────────────────────────────
  function handleZoom(e: React.ChangeEvent<HTMLInputElement>) {
    const newScale = Number(e.target.value)
    // 줌 변경 시 오프셋 비율 유지
    const ratio = newScale / scale
    const clamped = clamp(offset.x * ratio, offset.y * ratio, newScale)
    setScale(newScale)
    setOffset(clamped)
  }

  // 슬라이더 0~100 % ↔ minScale~maxScale
  const sliderVal = minScale > 0
    ? ((scale - minScale) / (maxScale - minScale)) * 100
    : 50

  function sliderToScale(v: number) {
    return minScale + (v / 100) * (maxScale - minScale)
  }

  // ── 확인: Canvas 크롭 후 File 생성 ──────────────────────────────
  function handleConfirm() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgNatural.w) return

    const ctx = canvas.getContext('2d')!
    canvas.width = OUT_SIZE
    canvas.height = OUT_SIZE

    // 원 중심 = 컨테이너 중심, 이미지 중심 = 컨테이너 중심 + offset
    // → 이미지 좌표계에서 원 중심:
    //   imgCenterX = renderW/2 - offset.x  (px, 렌더 기준)
    // → 원본 이미지 좌표:
    //   cx_nat = (renderW/2 - offset.x) / scale
    const cx = (renderW / 2 - offset.x) / scale
    const cy = (renderH / 2 - offset.y) / scale
    const r  = RADIUS / scale   // 원 반지름 (원본 좌표계)

    ctx.beginPath()
    ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2, 0, 0, OUT_SIZE, OUT_SIZE)

    canvas.toBlob((blob) => {
      if (!blob) return
      onConfirm(new File([blob], 'avatar.png', { type: 'image/png' }))
    }, 'image/png', 0.95)
  }

  // ── 미리보기 헬퍼 ────────────────────────────────────────────────
  function PreviewCircle({ size }: { size: number }) {
    // 원 안에서 이미지가 보이는 비율
    const viewScale = size / (RADIUS * 2)
    const pw = renderW * viewScale
    const ph = renderH * viewScale
    const px = size / 2 - pw / 2 + offset.x * viewScale
    const py = size / 2 - ph / 2 + offset.y * viewScale
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className="rounded-full overflow-hidden bg-sky-100 border-2 border-sky-200 flex-shrink-0"
          style={{ width: size, height: size }}
        >
          {objectUrl.current && pw > 0 && (
            <div className="relative w-full h-full">
              <Image
                src={objectUrl.current}
                alt=""
                unoptimized
                draggable={false}
                width={Math.round(pw)}
                height={Math.round(ph)}
                style={{ position: 'absolute', left: px, top: py, width: pw, height: ph, pointerEvents: 'none', userSelect: 'none' }}
              />
            </div>
          )}
        </div>
        <span className="text-xs text-slate-400">{size}px</span>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 백드롭 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* 모달 */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sky-100">
          <div>
            <h2 className="font-bold text-slate-800">프로필 사진 조정</h2>
            <p className="text-xs text-slate-400 mt-0.5">드래그로 위치 조정 · 슬라이더로 크기 조정</p>
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
              {objectUrl.current && renderW > 0 && (
                <Image
                  src={objectUrl.current}
                  alt="crop"
                  unoptimized
                  draggable={false}
                  width={Math.round(renderW)}
                  height={Math.round(renderH)}
                  style={{
                    position: 'absolute',
                    left: CONTAINER / 2 - renderW / 2 + offset.x,
                    top:  CONTAINER / 2 - renderH / 2 + offset.y,
                    width: renderW,
                    height: renderH,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
              )}

              {/* 원 마스크 오버레이 */}
              <svg className="absolute inset-0 pointer-events-none" width={CONTAINER} height={CONTAINER}>
                <defs>
                  <mask id="hole">
                    <rect width={CONTAINER} height={CONTAINER} fill="white" />
                    <circle cx={CONTAINER / 2} cy={CONTAINER / 2} r={RADIUS} fill="black" />
                  </mask>
                </defs>
                <rect width={CONTAINER} height={CONTAINER} fill="rgba(0,0,0,0.55)" mask="url(#hole)" />
                <circle cx={CONTAINER / 2} cy={CONTAINER / 2} r={RADIUS} fill="none" stroke="white" strokeWidth={2} strokeDasharray="6 4" opacity={0.85} />
              </svg>
            </div>
          </div>

          {/* ── 줌 슬라이더 ── */}
          <div className="flex items-center gap-3">
            {/* 축소 아이콘 */}
            <button
              type="button"
              onClick={() => {
                const ns = Math.max(minScale, scale - (maxScale - minScale) * 0.05)
                const c = clamp(offset.x * (ns / scale), offset.y * (ns / scale), ns)
                setScale(ns); setOffset(c)
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-sky-50 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
              </svg>
            </button>

            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={sliderVal}
              onChange={(e) => {
                const ns = sliderToScale(Number(e.target.value))
                const ratio = ns / scale
                const c = clamp(offset.x * ratio, offset.y * ratio, ns)
                setScale(ns); setOffset(c)
              }}
              className="flex-1 h-1.5 rounded-full accent-sky-500 cursor-pointer"
            />

            {/* 확대 아이콘 */}
            <button
              type="button"
              onClick={() => {
                const ns = Math.min(maxScale, scale + (maxScale - minScale) * 0.05)
                const c = clamp(offset.x * (ns / scale), offset.y * (ns / scale), ns)
                setScale(ns); setOffset(c)
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-sky-50 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </button>
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
          <button onClick={handleConfirm} disabled={!imgNatural.w} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 text-white text-sm font-semibold transition-colors">
            적용
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
