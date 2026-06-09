'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

type UploadState = 'ready' | 'uploading' | 'saving' | 'done' | 'error'

const CATEGORIES = ['게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리', '기타']

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_DURATION = 180 // 3분 (초)

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration) }
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('영상 파일을 읽을 수 없습니다')) }
    video.src = url
  })
}

export function UploadForm() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const thumbnailRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<UploadState>('ready')
  const [progress, setProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [visibility, setVisibility] = useState<'published' | 'private' | 'unlisted'>('published')
  const [error, setError] = useState('')
  const [durationWarning, setDurationWarning] = useState('')

  useEffect(() => {
    async function ensureChannel() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const name = (session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? session.user.email ?? '내 채널') as string
      try { await api.auth.createProfile(name.replace(/\s+/g, '_').slice(0, 30)) } catch { /* ignore */ }
      try { await api.channels.create({ name, description: '' }) } catch { /* ignore */ }
    }
    ensureChannel()
  }, [])

  // 썸네일 미리보기 URL 관리
  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailPreview(null)
      return
    }
    const url = URL.createObjectURL(thumbnailFile)
    setThumbnailPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [thumbnailFile])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setError('')
    setDurationWarning('')
    if (!file) { setSelectedFile(null); return }

    if (file.size > MAX_FILE_SIZE) {
      setError(`파일 크기는 500MB 이하여야 합니다. (현재: ${(file.size / 1024 / 1024).toFixed(0)}MB)`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    try {
      const duration = await getVideoDuration(file)
      if (duration > MAX_DURATION) {
        const mins = Math.floor(duration / 60)
        const secs = Math.floor(duration % 60)
        setError(`영상 길이는 3분 이하여야 합니다. (현재: ${mins}분 ${secs}초)`)
        if (fileRef.current) fileRef.current.value = ''
        return
      }
    } catch {
      setDurationWarning('재생 시간을 확인할 수 없습니다. 3분 이하의 영상만 업로드 가능합니다.')
    }

    setSelectedFile(file)
    if (!title) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
      setTitle(name.slice(0, 200))
    }
  }

  function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('썸네일은 JPG, PNG, WEBP 형식만 가능합니다.')
      if (thumbnailRef.current) thumbnailRef.current.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('썸네일 파일 크기는 5MB 이하여야 합니다.')
      if (thumbnailRef.current) thumbnailRef.current.value = ''
      return
    }
    setError('')
    setThumbnailFile(file)
  }

  function removeThumbnail() {
    setThumbnailFile(null)
    if (thumbnailRef.current) thumbnailRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !title) return
    setError('')

    try {
      setState('uploading')
      setProgress(0)

      // 1. Bunny stream URL + 썸네일 업로드 병렬 처리
      const [{ streamUid, tusSignature, tusExpiry, tusLibraryId }, thumbnailUrl] = await Promise.all([
        api.upload.getStreamUrl(),
        thumbnailFile ? api.upload.uploadThumbnail(thumbnailFile).then((r) => r.thumbnail_url) : Promise.resolve(undefined),
      ])

      // 2. 영상 업로드
      await uploadViaTus(selectedFile, { streamUid, tusSignature, tusExpiry, tusLibraryId })

      // 3. DB 저장
      setState('saving')
      await api.videos.create({
        title,
        description,
        stream_uid: streamUid,
        category: category || undefined,
        visibility,
        ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
      })

      setState('done')
      router.push('/my-videos')
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다')
      setState('ready')
    }
  }

  async function uploadViaTus(
    file: File,
    opts: { streamUid: string; tusSignature: string; tusExpiry: number; tusLibraryId: string }
  ) {
    const { Upload } = await import('tus-js-client')
    return new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        retryDelays: [0, 1000, 3000, 5000],
        headers: {
          AuthorizationSignature: opts.tusSignature,
          AuthorizationExpire: String(opts.tusExpiry),
          VideoId: opts.streamUid,
          LibraryId: opts.tusLibraryId,
        },
        metadata: { filename: file.name, filetype: file.type },
        chunkSize: 5 * 1024 * 1024,
        onProgress(bytesUploaded, bytesTotal) {
          setProgress(Math.round((bytesUploaded / bytesTotal) * 100))
        },
        onSuccess() { resolve() },
        onError(err) { reject(err) },
      })
      upload.start()
    })
  }

  const isSubmitting = state === 'uploading' || state === 'saving'
  const canSubmit = !!selectedFile && !!title && !isSubmitting

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">동영상 업로드</h1>
        <p className="text-sm text-slate-400 mt-1">최대 3분 · 500MB 이하</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── 영상 파일 선택 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-3">영상 파일 *</label>
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} disabled={isSubmitting} />

          {selectedFile ? (
            <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl p-3.5">
              <div className="w-9 h-9 bg-sky-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate text-sm">{selectedFile.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              {!isSubmitting && (
                <button type="button" onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-sky-200 hover:border-sky-400 bg-sky-50/50 hover:bg-sky-50 rounded-xl p-10 text-center transition-colors group">
              <svg className="w-12 h-12 text-sky-300 group-hover:text-sky-400 mx-auto mb-3 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-slate-600 font-medium text-sm">클릭하여 영상 파일 선택</p>
              <p className="text-slate-400 text-xs mt-1">MP4, MOV, AVI 등 · 최대 3분 · 500MB</p>
            </button>
          )}
        </div>

        {/* ── 제목 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-2">제목 *</label>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            required maxLength={200} disabled={isSubmitting}
            placeholder="동영상 제목을 입력하세요"
            className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-2.5 text-slate-900 placeholder-slate-300 focus:outline-none focus:border-sky-400 focus:bg-white transition-colors disabled:opacity-60 text-sm"
          />
        </div>

        {/* ── 썸네일 업로드 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-1">썸네일</label>
          <p className="text-xs text-slate-400 mb-3">설정하지 않으면 영상 처리 후 자동 생성됩니다 · JPG, PNG, WEBP · 5MB 이하</p>
          <input ref={thumbnailRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleThumbnailChange} disabled={isSubmitting} />

          {thumbnailPreview ? (
            <div className="flex items-start gap-4">
              <div className="relative w-40 aspect-video rounded-xl overflow-hidden bg-sky-100 flex-shrink-0 border border-sky-200">
                <Image src={thumbnailPreview} alt="썸네일 미리보기" fill className="object-cover" />
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-slate-500 font-medium">{thumbnailFile?.name}</p>
                <p className="text-xs text-slate-400">{thumbnailFile ? (thumbnailFile.size / 1024 / 1024).toFixed(2) : '0'} MB</p>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => thumbnailRef.current?.click()} disabled={isSubmitting}
                    className="text-xs text-sky-500 hover:text-sky-700 font-medium transition-colors disabled:opacity-50">
                    변경
                  </button>
                  <span className="text-slate-200">|</span>
                  <button type="button" onClick={removeThumbnail} disabled={isSubmitting}
                    className="text-xs text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50">
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => thumbnailRef.current?.click()} disabled={isSubmitting}
              className="flex items-center gap-3 w-full border-2 border-dashed border-sky-200 hover:border-sky-400 bg-sky-50/50 hover:bg-sky-50 rounded-xl px-5 py-4 transition-colors group disabled:opacity-50">
              <div className="w-9 h-9 rounded-lg bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center flex-shrink-0 transition-colors">
                <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-slate-600 group-hover:text-sky-600 transition-colors">썸네일 이미지 선택</p>
                <p className="text-xs text-slate-400 mt-0.5">16:9 비율 권장</p>
              </div>
            </button>
          )}
        </div>

        {/* ── 설명 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-2">설명</label>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            rows={4} maxLength={5000} disabled={isSubmitting}
            placeholder="동영상에 대한 설명을 입력하세요"
            className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-2.5 text-slate-900 placeholder-slate-300 focus:outline-none focus:border-sky-400 focus:bg-white transition-colors resize-none disabled:opacity-60 text-sm"
          />
        </div>

        {/* ── 카테고리 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-2">카테고리</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={isSubmitting}
            className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:border-sky-400 focus:bg-white transition-colors disabled:opacity-60 text-sm">
            <option value="">카테고리 선택 (선택사항)</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* ── 공개 설정 ── */}
        <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-3">공개 설정</label>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: 'published', icon: '🌐', label: '전체공개', desc: '누구나 볼 수 있습니다' },
              { value: 'unlisted',  icon: '🔗', label: '일부공개', desc: '링크가 있는 사람만' },
              { value: 'private',   icon: '🔒', label: '비공개',   desc: '본인만 볼 수 있습니다' },
            ] as const).map((opt) => (
              <button key={opt.value} type="button" disabled={isSubmitting} onClick={() => setVisibility(opt.value)}
                className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border-2 text-center transition-colors ${
                  visibility === opt.value
                    ? 'border-sky-400 bg-sky-50 text-sky-700'
                    : 'border-sky-100 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50'
                }`}>
                <span className="text-xl">{opt.icon}</span>
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs text-slate-400 leading-tight">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 진행률 ── */}
        {state === 'uploading' && (
          <div className="bg-white border border-sky-100 rounded-2xl shadow-sm p-5">
            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span className="font-medium">업로드 중...</span>
              <span className="font-semibold text-sky-500">{progress}%</span>
            </div>
            <div className="w-full bg-sky-100 rounded-full h-2">
              <div className="bg-sky-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2">업로드가 완료되면 자동으로 처리됩니다</p>
          </div>
        )}

        {state === 'saving' && (
          <div className="bg-white border border-sky-100 rounded-2xl shadow-sm p-5 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-slate-600">저장 중...</p>
          </div>
        )}

        {/* ── 경고 / 오류 ── */}
        {durationWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm">
            ⚠️ {durationWarning}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* ── 제출 버튼 ── */}
        <button type="submit" disabled={!canSubmit}
          className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 disabled:text-sky-400 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm">
          {isSubmitting ? '처리 중...' : '업로드 완료'}
        </button>

        {!selectedFile && (
          <p className="text-center text-sm text-slate-400 pb-2">영상 파일을 먼저 선택하세요</p>
        )}
      </form>
    </div>
  )
}
