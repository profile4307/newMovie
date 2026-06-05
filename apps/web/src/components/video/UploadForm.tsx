'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

type UploadState = 'ready' | 'uploading' | 'saving' | 'done' | 'error'

const CATEGORIES = ['게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리', '기타']

export function UploadForm() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<UploadState>('ready')
  const [progress, setProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setError('')
    // 파일명에서 기본 제목 추출
    if (file && !title) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
      setTitle(name.slice(0, 200))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !title) return

    setError('')

    try {
      // 1. 업로드 URL 발급
      setState('uploading')
      setProgress(0)
      const { uploadUrl, streamUid } = await api.upload.getStreamUrl()

      // 2. Cloudflare Stream으로 파일 업로드 (진행률 표시)
      await uploadWithProgress(selectedFile, uploadUrl)

      // 3. DB에 저장 (status: processing — 트랜스코딩 완료 전)
      setState('saving')
      await api.videos.create({
        title,
        description,
        stream_uid: streamUid,
        category: category || undefined,
      })

      // 4. 완료 → 홈으로 이동
      setState('done')
      router.push('/my-videos')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다'
      setError(msg)
      setState('ready')
    }
  }

  async function uploadWithProgress(file: File, uploadUrl: string) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`업로드 실패 (${xhr.status})`))
      })
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류가 발생했습니다')))
      xhr.open('POST', uploadUrl)
      const fd = new FormData()
      fd.append('file', file)
      xhr.send(fd)
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
