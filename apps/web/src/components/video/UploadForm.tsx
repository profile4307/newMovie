'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

type UploadState = 'idle' | 'uploading' | 'processing' | 'saving' | 'done' | 'error'

export function UploadForm() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState(0)
  const [streamUid, setStreamUid] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')

  // 로그인 후 채널이 없으면 자동 생성
  useEffect(() => {
    async function ensureChannel() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      try {
        await api.auth.me()
      } catch {
        // users 테이블에 없으면 생성
        const name = (session.user.user_metadata?.full_name
          ?? session.user.user_metadata?.name
          ?? session.user.email
          ?? '사용자') as string
        const username = name.replace(/\s+/g, '_').slice(0, 30)
        await api.auth.createProfile(username).catch(() => null)
      }

      // 채널 없으면 자동 생성
      try {
        await api.channels.create({
          name: (session.user.user_metadata?.full_name
            ?? session.user.user_metadata?.name
            ?? session.user.email
            ?? '내 채널') as string,
          description: '',
        })
      } catch {
        // 이미 있으면 무시
      }
    }
    ensureChannel()
  }, [])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setState('uploading')
      setProgress(0)
      setError('')

      const { uploadUrl, streamUid: uid } = await api.upload.getStreamUrl()
      setStreamUid(uid)

      await uploadWithProgress(file, uploadUrl, setProgress)

      setState('processing')
      await waitForProcessing(uid)
      setState('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 실패')
      setState('error')
    }
  }

  async function uploadWithProgress(
    file: File,
    uploadUrl: string,
    onProgress: (pct: number) => void
  ) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`업로드 실패 (${xhr.status})`))
      })
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류')))
      xhr.open('POST', uploadUrl)
      const fd = new FormData()
      fd.append('file', file)
      xhr.send(fd)
    })
  }

  async function waitForProcessing(uid: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      const status = await api.upload.getStatus(uid)
      if (status.state === 'ready') return status
      if (status.state === 'error') throw new Error('트랜스코딩 실패')
    }
    throw new Error('처리 시간 초과')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!streamUid || !title) return

    try {
      setState('saving')
      const status = await api.upload.getStatus(streamUid)
      await api.videos.create({
        title,
        description,
        stream_uid: streamUid,
        thumbnail_url: status.thumbnail || undefined,
        duration: status.duration ? Math.floor(status.duration) : undefined,
        category: category || undefined,
      })
      setState('done')
      router.push('/')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패'
      setError(msg)
      setState('error')
    }
  }

  const CATEGORIES = ['게임', '음악', '교육', '엔터테인먼트', '뉴스', '스포츠', '기술', '여행', '요리', '기타']

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-8">동영상 업로드</h1>

      {/* 파일 선택 영역 */}
      {!streamUid && state !== 'uploading' && state !== 'processing' && (
        <div
          className="border-2 border-dashed border-gray-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <svg className="w-16 h-16 text-gray-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-gray-400">동영상 파일을 클릭하여 선택</p>
          <p className="text-gray-600 text-sm mt-2">MP4, MOV, AVI 등 지원</p>
        </div>
      )}

      {/* 업로드 진행률 */}
      {state === 'uploading' && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>업로드 중...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state === 'processing' && (
        <div className="mt-8 text-center text-gray-400">
          <div className="inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-white font-medium">트랜스코딩 처리 중...</p>
          <p className="text-sm mt-1">완료까지 수 분이 걸릴 수 있습니다</p>
        </div>
      )}

      {/* 메타데이터 입력 폼 */}
      {streamUid && state === 'idle' && (
        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-400 text-sm">
            ✅ 업로드 완료 — 아래 정보를 입력하고 등록하세요
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
              placeholder="동영상 제목을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 resize-none"
              placeholder="동영상에 대한 설명을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">카테고리 선택</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={!title}
            className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-sky-200 disabled:text-sky-400 text-white font-medium py-3 rounded-lg transition-colors"
          >
            업로드 완료
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-400 text-sm">
          <p className="font-medium mb-1">오류 발생</p>
          <p>{error}</p>
          <button
            onClick={() => { setError(''); setState('idle'); setStreamUid('') }}
            className="mt-3 text-xs underline hover:text-red-300"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}
