'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

type UploadState = 'ready' | 'uploading' | 'saving' | 'done' | 'error'

const CATEGORIES = ['게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리', '기타']

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_DURATION = 180 // 3분 (초)

// HTML5 video 엘리먼트로 재생 시간 측정
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(video.duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('영상 파일을 읽을 수 없습니다'))
    }
    video.src = url
  })
}

export function UploadForm() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<UploadState>('ready')
  const [progress, setProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [visibility, setVisibility] = useState<'published' | 'private' | 'unlisted'>('published')
  const [error, setError] = useState('')
  const [durationWarning, setDurationWarning] = useState('')

  // 채널 자동 생성 (Google 로그인 사용자)
  useEffect(() => {
    async function ensureChannel() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const name = (session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? session.user.email ?? '내 채널') as string
      try {
        await api.auth.createProfile(name.replace(/\s+/g, '_').slice(0, 30))
      } catch { /* 이미 있으면 무시 */ }
      try {
        await api.channels.create({ name, description: '' })
      } catch { /* 이미 있으면 무시 */ }
    }
    ensureChannel()
  }, [])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setError('')
    setDurationWarning('')

    if (!file) {
      setSelectedFile(null)
      return
    }

    // 파일 크기 체크 (500MB)
    if (file.size > MAX_FILE_SIZE) {
      setError(`파일 크기는 500MB 이하여야 합니다. (현재: ${(file.size / 1024 / 1024).toFixed(0)}MB)`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    // 재생 시간 체크 (3분)
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
      // 재생 시간을 읽을 수 없는 경우 경고만 표시하고 계속 진행
      setDurationWarning('재생 시간을 확인할 수 없습니다. 3분 이하의 영상만 업로드 가능합니다.')
    }

    setSelectedFile(file)
    // 파일명에서 기본 제목 추출
    if (!title) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
      setTitle(name.slice(0, 200))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !title) return

    setError('')

    try {
      // 1. Bunny 비디오 ID + tus 인증 정보 발급
      setState('uploading')
      setProgress(0)
      const { streamUid, tusSignature, tusExpiry, tusLibraryId } = await api.upload.getStreamUrl()

      // 2. tus 프로토콜로 Bunny Stream에 직접 업로드
      await uploadViaTus(selectedFile, { streamUid, tusSignature, tusExpiry, tusLibraryId })

      // 3. DB에 저장 (status: processing — 트랜스코딩 완료 전)
      setState('saving')
      await api.videos.create({
        title,
        description,
        stream_uid: streamUid,
        category: category || undefined,
        visibility,
      })

      // 4. 완료 → 내 동영상으로 이동
      setState('done')
      router.push('/my-videos')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다'
      setError(msg)
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
        metadata: {
          filename: file.name,
          filetype: file.type,
        },
        chunkSize: 5 * 1024 * 1024, // 5MB 청크
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
      <h1 className="text-2xl font-bold text-slate-800 mb-8">동영상 업로드</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 파일 선택 */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={isSubmitting}
          />

          {selectedFile ? (
            <div className="flex items-center gap-4 bg-sky-50 border border-sky-200 rounded-xl p-4">
              <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{selectedFile.name}</p>
                <p className="text-sm text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              {!isSubmitting && (
                <button
                  type="button"
                  onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-sky-300 hover:border-sky-400 rounded-xl p-12 text-center transition-colors group"
            >
              <svg className="w-14 h-14 text-sky-300 group-hover:text-sky-400 mx-auto mb-4 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-slate-600 font-medium">클릭하여 영상 파일 선택</p>
              <p className="text-slate-400 text-sm mt-1">MP4, MOV, AVI 등 지원</p>
              <p className="text-slate-400 text-xs mt-2">최대 3분 · 500MB 이하</p>
            </button>
          )}
        </div>

        {/* 제목 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">제목 *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            disabled={isSubmitting}
            placeholder="동영상 제목을 입력하세요"
            className="w-full bg-white border border-sky-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-400 transition-colors disabled:bg-sky-50"
          />
        </div>

        {/* 설명 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">설명</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
            disabled={isSubmitting}
            placeholder="동영상에 대한 설명을 입력하세요"
            className="w-full bg-white border border-sky-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-400 transition-colors resize-none disabled:bg-sky-50"
          />
        </div>

        {/* 카테고리 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">카테고리</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isSubmitting}
            className="w-full bg-white border border-sky-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-sky-400 transition-colors disabled:bg-sky-50"
          >
            <option value="">카테고리 선택 (선택사항)</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* 공개 설정 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">공개 설정</label>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: 'published', icon: '🌐', label: '전체공개', desc: '누구나 볼 수 있습니다' },
              { value: 'unlisted',  icon: '🔗', label: '일부공개', desc: '링크가 있는 사람만' },
              { value: 'private',   icon: '🔒', label: '비공개',   desc: '본인만 볼 수 있습니다' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={isSubmitting}
                onClick={() => setVisibility(opt.value)}
                className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border-2 text-center transition-colors ${
                  visibility === opt.value
                    ? 'border-sky-400 bg-sky-50 text-sky-700'
                    : 'border-sky-100 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50'
                }`}
              >
                <span className="text-xl">{opt.icon}</span>
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs text-slate-400 leading-tight">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 업로드 진행률 */}
        {state === 'uploading' && (
          <div className="bg-sky-50 rounded-xl p-4">
            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span className="font-medium">업로드 중...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-sky-200 rounded-full h-2">
              <div
                className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">업로드가 완료되면 자동으로 처리됩니다</p>
          </div>
        )}

        {state === 'saving' && (
          <div className="bg-sky-50 rounded-xl p-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-slate-600">DB 저장 중...</p>
          </div>
        )}

        {/* 경고 */}
        {durationWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm">
            ⚠️ {durationWarning}
          </div>
        )}

        {/* 오류 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-sky-200 disabled:text-sky-400 text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          {isSubmitting ? '처리 중...' : '업로드 완료'}
        </button>

        {!selectedFile && (
          <p className="text-center text-sm text-slate-400">영상 파일을 먼저 선택하세요</p>
        )}
      </form>
    </div>
  )
}
