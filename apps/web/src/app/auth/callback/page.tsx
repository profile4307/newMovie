'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState('로그인 처리 중...')

  useEffect(() => {
    const hash = window.location.hash.slice(1) // # 제거
    const params = new URLSearchParams(hash)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')

    if (access_token && refresh_token) {
      supabase.auth
        .setSession({ access_token, refresh_token })
        .then(({ data, error }) => {
          if (error || !data.session) {
            setStatus('로그인에 실패했습니다. 다시 시도해주세요.')
            return
          }
          router.push('/')
          router.refresh()
        })
    } else {
      setStatus('잘못된 접근입니다.')
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-white text-lg">{status}</p>
    </div>
  )
}
