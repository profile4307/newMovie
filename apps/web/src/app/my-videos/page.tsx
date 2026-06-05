'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { ToastContainer, useToast } from '@/components/ui/Toast'

type MyVideo = {
  id: string
  title: string
  description: string
  thumbnail_url: string | null
  stream_uid: string
  duration: number | null
  view_count: number
  like_count: number
  status: string
  category: string | null
  tags: string[]
  created_at: string
}

type StatusType = 'published' | 'private' | 'unlisted'

const STATUS_INFO: Record<string, { label: string; icon: string; className: string }> = {
  published: { label: '전체공개', icon: '🌐', className: 'bg-green-100 text-green-700 border-green-200' },
  processing: { label: '처리중',  icon: '⏳', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  private:    { label: '비공개',  icon: '🔒', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  unlisted:   { label: '일부공개', icon: '🔗', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  failed:     { label: '실패',    icon: '❌', className: 'bg-red-100 text-red-600 border-red-200' },
}

const CATEGORIES = ['게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리', '기타']

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
function formatDuration(s: number | null) {
  if (!s) return ''
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ── 수정 모달 ───────────────────────────────────────────────────────────────
function EditModal({
  video,
  onClose,
  onSaved,
}: {
  video: MyVideo
  onClose: () => void
  onSaved: (updated: Partial<MyVideo>) => void
}) {
  const [title, setTitle] = useState(video.title)
  const [description, setDescription] = useState(video.description)
  const [category, setCategory] = useState(video.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.videos.update(video.id, {
        title: title.trim(),
        description,
        category: category || undefined,
      })
      onSaved({ title: title.trim(), description, category: category || null })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-sky-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-sky-100">
          <h2 className="font-bold text-slate-800 text-lg">동영상 수정</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full border border-sky-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:border-sky-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              className="w-full border border-sky-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:border-sky-400 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-sky-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:border-sky-400 transition-colors"
            >
              <option value="">선택 안 함</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-sky-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-sky-200 text-slate-600 hover:bg-sky-50 text-sm font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 text-white text-sm font-semibold transition-colors"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 삭제 확인 모달 ──────────────────────────────────────────────────────────
function DeleteModal({
  video,
  onClose,
  onDeleted,
  onError,
}: {
  video: MyVideo
  onClose: () => void
  onDeleted: () => void
  onError: (msg: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.videos.delete(video.id)
      onDeleted()
    } catch {
      onError('삭제 중 오류가 발생했습니다')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-sky-100">
        <div className="px-6 py-6 text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h2 className="font-bold text-slate-800 text-lg mb-2">동영상 삭제</h2>
          <p className="text-slate-500 text-sm mb-1">
            <span className="font-medium text-slate-700">&#34;{video.title}&#34;</span>
          </p>
          <p className="text-slate-400 text-sm">삭제된 영상은 복구할 수 없습니다.</p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 py-2.5 rounded-xl border border-sky-200 text-slate-600 hover:bg-sky-50 text-sm font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-sm font-semibold transition-colors"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 공개 설정 드롭다운 ──────────────────────────────────────────────────────
function StatusDropdown({
  video,
  onChanged,
  onToast,
}: {
  video: MyVideo
  onChanged: (status: StatusType) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const current = STATUS_INFO[video.status] ?? STATUS_INFO.private!

  const OPTIONS: { value: StatusType; label: string; icon: string; desc: string }[] = [
    { value: 'published', label: '전체공개', icon: '🌐', desc: '누구나 볼 수 있습니다' },
    { value: 'unlisted',  label: '일부공개', icon: '🔗', desc: '링크가 있는 사람만 볼 수 있습니다' },
    { value: 'private',   label: '비공개',   icon: '🔒', desc: '본인만 볼 수 있습니다' },
  ]

  async function handleSelect(status: StatusType) {
    if (status === video.status || saving) return
    setSaving(true)
    setOpen(false)
    try {
      await api.videos.update(video.id, { status })
      onChanged(status)
      const label = OPTIONS.find((o) => o.value === status)?.label ?? status
      onToast(`공개 설정을 "${label}"로 변경했습니다`, 'success')
    } catch {
      onToast('공개 설정 변경에 실패했습니다', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (video.status === 'processing' || video.status === 'failed') return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${current.className}`}
      >
        <span>{current.icon}</span>
        <span>{saving ? '변경중...' : current.label}</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 w-52 bg-white border border-sky-200 rounded-xl shadow-lg z-20 overflow-hidden">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-sky-50 transition-colors ${
                  video.status === opt.value ? 'bg-sky-50' : ''
                }`}
              >
                <span className="text-base mt-0.5">{opt.icon}</span>
                <div>
                  <p className={`text-sm font-medium ${video.status === opt.value ? 'text-sky-600' : 'text-slate-700'}`}>
                    {opt.label}
                    {video.status === opt.value && ' ✓'}
                  </p>
                  <p className="text-xs text-slate-400">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────────────────────
export default function MyVideosPage() {
  const router = useRouter()
  const { toasts, show: showToast, remove: removeToast } = useToast()
  const [videos, setVideos] = useState<MyVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState<MyVideo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MyVideo | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)

  const loadVideos = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/login'); return }
    try {
      const result = await api.videos.mine()
      setVideos(result.data as MyVideo[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadVideos() }, [loadVideos])

  function updateVideo(id: string, patch: Partial<MyVideo>) {
    setVideos((prev) => prev.map((v) => v.id === id ? { ...v, ...patch } : v))
  }

  async function checkStatus(video: MyVideo) {
    setCheckingId(video.id)
    try {
      const status = await api.upload.getStatus(video.stream_uid)
      if (status.state === 'ready') {
        await loadVideos()
        showToast('트랜스코딩이 완료되었습니다! 영상이 공개되었습니다.', 'success')
      } else {
        const pct = status.pctComplete ? `${status.pctComplete}% 완료` : '진행중'
        showToast(`트랜스코딩 처리중입니다 (${pct}). 잠시 후 다시 확인해보세요.`, 'warning')
      }
    } catch {
      showToast('상태 확인 중 오류가 발생했습니다', 'error')
    } finally {
      setCheckingId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 수정 모달 */}
      {editTarget && (
        <EditModal
          video={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => {
            updateVideo(editTarget.id, updated)
            setEditTarget(null)
            showToast('동영상 정보가 수정되었습니다', 'success')
          }}
        />
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <DeleteModal
          video={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setVideos((prev) => prev.filter((v) => v.id !== deleteTarget.id))
            setDeleteTarget(null)
            showToast('동영상이 삭제되었습니다', 'info')
          }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}

      <div className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-slate-800">내 동영상</h1>
          <Link
            href="/upload"
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-full transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            새 영상 업로드
          </Link>
        </div>

        {videos.length === 0 ? (
          <div className="text-center py-20">
            <svg className="w-16 h-16 mx-auto mb-4 text-sky-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-lg text-slate-500">업로드한 영상이 없습니다</p>
            <Link href="/upload" className="mt-4 inline-block text-sky-500 hover:underline text-sm">
              첫 영상을 업로드해보세요
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {videos.map((video) => {
              const isProcessing = video.status === 'processing'

              return (
                <div
                  key={video.id}
                  className={`flex gap-4 bg-white rounded-2xl p-4 border transition-colors ${
                    isProcessing ? 'border-amber-200' : 'border-sky-100'
                  }`}
                >
                  {/* 썸네일 */}
                  <div className="flex-shrink-0">
                    <div className="relative w-40 aspect-video bg-sky-100 rounded-xl overflow-hidden">
                      {video.thumbnail_url ? (
                        <Image src={video.thumbnail_url} alt={video.title} fill className="object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-sky-200">
                          {isProcessing
                            ? <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                            : <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                          }
                        </div>
                      )}
                      {video.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                          {formatDuration(video.duration)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-slate-800 line-clamp-1">{video.title}</p>
                    </div>

                    {isProcessing && (
                      <p className="text-sm text-amber-600 mb-1">
                        🔄 트랜스코딩 처리 중 — 완료되면 공개 설정에 따라 표시됩니다
                      </p>
                    )}

                    <p className="text-sm text-slate-400 line-clamp-2 mb-2">{video.description}</p>

                    <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                      {!isProcessing && <span>조회수 {formatCount(video.view_count)}</span>}
                      {!isProcessing && <span>좋아요 {formatCount(video.like_count)}</span>}
                      <span>{new Date(video.created_at).toLocaleDateString('ko-KR')}</span>
                      {video.category && (
                        <span className="bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full">{video.category}</span>
                      )}
                    </div>

                    {/* 공개 설정 드롭다운 */}
                    <div className="mt-3">
                      {isProcessing ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border ${STATUS_INFO.processing!.className}`}>
                          {STATUS_INFO.processing!.icon} {STATUS_INFO.processing!.label}
                        </span>
                      ) : (
                        <StatusDropdown
                          video={video}
                          onChanged={(status) => updateVideo(video.id, { status })}
                          onToast={(msg, type) => showToast(msg, type)}
                        />
                      )}
                    </div>
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex-shrink-0 flex flex-col gap-2 min-w-[72px]">
                    {!isProcessing && (
                      <Link
                        href={`/watch/${video.id}`}
                        className="text-xs text-center text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-full transition-colors"
                      >
                        보기
                      </Link>
                    )}
                    <button
                      onClick={() => setEditTarget(video)}
                      className="text-xs text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full transition-colors"
                    >
                      수정
                    </button>
                    {isProcessing && (
                      <button
                        onClick={() => checkStatus(video)}
                        disabled={checkingId === video.id}
                        className="text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full transition-colors"
                      >
                        {checkingId === video.id ? '확인중' : '상태확인'}
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(video)}
                      className="text-xs text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-full transition-colors"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
