'use client'

import { useEffect, useState } from 'react'

type ToastType = 'success' | 'info' | 'error' | 'warning'

export type ToastMessage = {
  id: number
  type: ToastType
  message: string
}

const ICONS: Record<ToastType, string> = {
  success: '✅',
  info: '💬',
  error: '❌',
  warning: '⏳',
}

const COLORS: Record<ToastType, string> = {
  success: 'bg-green-50 border-green-300 text-green-800',
  info:    'bg-sky-50 border-sky-300 text-sky-800',
  error:   'bg-red-50 border-red-300 text-red-700',
  warning: 'bg-amber-50 border-amber-300 text-amber-800',
}

function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // 마운트 직후 fade-in
    requestAnimationFrame(() => setVisible(true))

    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onRemove, 300)
    }, 3500)

    return () => clearTimeout(timer)
  }, [onRemove])

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-md text-sm font-medium max-w-sm w-full transition-all duration-300 ${
        COLORS[toast.type]
      } ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      <span className="flex-shrink-0 text-base leading-none mt-0.5">{ICONS[toast.type]}</span>
      <p className="flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => { setVisible(false); setTimeout(onRemove, 300) }}
        className="flex-shrink-0 opacity-40 hover:opacity-70 transition-opacity ml-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, onRemove }: {
  toasts: ToastMessage[]
  onRemove: (id: number) => void
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={() => onRemove(t.id)} />
      ))}
    </div>
  )
}

// 간단하게 사용할 수 있는 훅
let _id = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  function show(message: string, type: ToastType = 'info') {
    const id = ++_id
    setToasts((prev) => [...prev, { id, type, message }])
  }

  function remove(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return { toasts, show, remove }
}
