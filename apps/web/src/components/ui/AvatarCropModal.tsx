'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

type Props = {
  file: File
  onConfirm: (croppedFile: File) => void
  onCancel: () => void
}

const CONTAINER  = 440   // 크롭 컨테이너 크기 (px)
const MIN_RADIUS = 60
const MAX_RADIUS = 180
const DEF_RADIUS = 130
const OUT_SIZE   = 400   // 출력 해상도

export function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const objectUrl  = useRef('')
  const canvasRef  = useRef<HTMLCanvasElement>(null)   // 출력용 캔버스
  const p72Ref     = useRef<HTMLCanvasElement>(null)   // 미리보기 72px
  const p44Ref     = useRef<HTMLCanvasElement>(null)   // 미리보기 44px
  const p28Ref     = useRef<HTMLCanvasElement>(null)   // 미리보기 28px
  const imgEl      = useRef<HTMLImageElement | null>(null)

  const [imgNat, setImgNat] = useState({ w: 0, h: 0 })
  const [radius, setRadius] = useState(DEF_RADIUS)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)

  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // ── 렌더 크기: 이미지 전체가 컨테이너 안에 들어오도록 (contain) ──
  const scale = imgNat.w && imgNat.h
    ? Math.min(CONTAINER / imgNat.w, CONTAINER / imgNat.h)
    : 1
  const rw = imgNat.w * scale
  const rh = imgNat.h * scale

  // ── 이미지 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    setLoaded(false)
    objectUrl.current = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      imgEl.current = img
      setImgNat({ w: img.naturalWidth, h: img.naturalHeight })
      setOffset({ x: 0, y: 0 })
      setRadius(DEF_RADIUS)
      setLoaded(true)
    }
    img.src = objectUrl.current
    return () => URL.revokeObjectURL(objectUrl.current)
  }, [file])

  // ── 오프셋 클램핑 ─────────────────────────────────────────────────
  // 최소 ±180px (360px) 드래그 보장 → 원이 이미지 밖으로 자유롭게 이동 가능
  const HALF_MIN_DRAG = 180
  const clamp = useCallback((ox: number, oy: number, _r: number) => ({
    x: Math.max(-Math.max(rw / 2, HALF_MIN_DRAG), Math.min(Math.max(rw / 2, HALF_MIN_DRAG), ox)),
    y: Math.max(-Math.max(rh / 2, HALF_MIN_DRAG), Math.min(Math.max(rh / 2, HALF_MIN_DRAG), oy)),
  }), [rw, rh])

  // ── 드래그 ───────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    setOffset(clamp(
      drag.current.ox + (e.clientX - drag.current.sx),
      drag.current.oy + (e.clientY - drag.current.sy),
      radius,
    ))
  }
  function onPointerUp() { drag.current = null }

  // ── 슬라이더 → 원 크기 변경 ─────────────────────────────────────
  function handleRadiusSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const nr = Number(e.target.value)
    setRadius(nr)
    setOffset(prev => clamp(prev.x, prev.y, nr))
  }

  // ── 미리보기 Canvas 그리기 ───────────────────────────────────────
  // 미리보기 = 크롭 영역 전체를 canvas 크기에 맞게 축소
  // → radius 변경 시 이미지 크기 불변, 원 크기만 변함
  function drawPreview(canvas: HTMLCanvasElement | null, size: number) {
    const img = imgEl.current
    if (!canvas || !img || !imgNat.w) return

    const dpr = window.devicePixelRatio || 1
    canvas.width  = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size, size)

    const s = size / CONTAINER   // 컨테이너 → 미리보기 배율

    // 이미지 그리기 (원본 → 미리보기 크기로 직접 drawImage)
    const imgLeft = (CONTAINER / 2 - rw / 2 + offset.x) * s
    const imgTop  = (CONTAINER / 2 - rh / 2 + offset.y) * s
    ctx.drawImage(img, 0, 0, imgNat.w, imgNat.h, imgLeft, imgTop, rw * s, rh * s)

    // 원 바깥 어둡게
    const cx = size / 2
    const cy = size / 2
    const cr = radius * s
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.rect(0, 0, size, size)
    ctx.arc(cx, cy, cr, 0, Math.PI * 2, true)  // CCW = 구멍
    ctx.fill()

    // 원 테두리
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth   = 1
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.arc(cx, cy, cr, 0, Math.PI * 2)
    ctx.stroke()
  }

  useEffect(() => {
    if (!loaded) return
    drawPreview(p72Ref.current, 72)
    drawPreview(p44Ref.current, 44)
    drawPreview(p28Ref.current, 28)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, offset.x, offset.y, radius, imgNat.w, imgNat.h, rw, rh])

  // ── 최종 크롭 Canvas 내보내기 ────────────────────────────────────
  function handleConfirm() {
    const canvas = canvasRef.current
    const img    = imgEl.current
    if (!canvas || !img || !imgNat.w) return

    const ctx = canvas.getContext('2d')!
    canvas.width  = OUT_SIZE
    canvas.height = OUT_SIZE
    ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE)

    // 원 중심 → 원본 이미지 좌표
    const cxNat = (rw / 2 - offset.x) / scale
    const cyNat = (rh / 2 - offset.y) / scale
    const rNat  = radius / scale

    ctx.beginPath()
    ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(img, cxNat - rNat, cyNat - rNat, rNat * 2, rNat * 2, 0, 0, OUT_SIZE, OUT_SIZE)

    canvas.toBlob(blob => {
      if (!blob) return
      onConfirm(new File([blob], 'avatar.png', { type: 'image/png' }))
    }, 'image/png', 0.95)
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
              {loaded && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={objectUrl.current}
                  alt="crop"
                  draggable={false}
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

              {/* 원 바깥 어둡게 + 테두리 */}
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
              <div className="w-3 h-3 rounded-full border-2 border-slate-300 flex-shrink-0" />
              <input
                type="range" min={MIN_RADIUS} max={MAX_RADIUS} step={1} value={radius}
                onChange={handleRadiusSlider}
                className="flex-1 h-1.5 rounded-full accent-sky-500 cursor-pointer"
              />
              <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0" />
            </div>
          </div>

          {/* ── 미리보기 (크롭 영역 축소판) ── */}
          <div className="flex items-end justify-center gap-6 py-1">
            {[
              { ref: p72Ref, size: 72 },
              { ref: p44Ref, size: 44 },
              { ref: p28Ref, size: 28 },
            ].map(({ ref, size }) => (
              <div key={size} className="flex flex-col items-center gap-1.5">
                <canvas
                  ref={ref}
                  style={{ width: size, height: size, borderRadius: 4, border: '1px solid #bae6fd', backgroundColor: '#1e293b' }}
                />
                <span className="text-xs text-slate-400">{size}px</span>
              </div>
            ))}
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 px-6 pb-5">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-sky-200 text-slate-600 text-sm font-medium hover:bg-sky-50 transition-colors">
            취소
          </button>
          <button onClick={handleConfirm} disabled={!loaded} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 text-white text-sm font-semibold transition-colors">
            적용
          </button>
        </div>
      </div>

      {/* 출력용 캔버스: display:none 대신 화면 밖으로 배치 (toBlob 안정성) */}
      <canvas ref={canvasRef} style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0, pointerEvents: 'none' }} />
    </div>
  )
}
