'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export function Header() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (search.trim()) router.push(`/?search=${encodeURIComponent(search.trim())}`)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setMenuOpen(false)
    router.push('/')
    router.refresh()
  }

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const displayName = (user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? '') as string

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-sky-400 text-white flex items-center px-4 gap-4 shadow-sm">
      {/* 로고 */}
      <Link href="/" className="flex items-center gap-2 flex-shrink-0 w-56">
        <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
          <svg className="w-5 h-5 text-sky-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="font-bold text-lg">NewMovie</span>
      </Link>

      {/* 검색창 */}
      <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-auto flex">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="검색 (띄어쓰기로 여러 단어)"
          className="flex-1 bg-sky-300/60 border border-sky-200 rounded-l-full px-5 py-2 text-sm text-white placeholder-sky-100 focus:outline-none focus:bg-white focus:text-slate-900 focus:placeholder-slate-400 transition-colors"
        />
        <button
          type="submit"
          className="bg-sky-300/60 hover:bg-sky-300 border border-l-0 border-sky-200 rounded-r-full px-5 py-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>

      {/* 우측 */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {user ? (
          <>
            <Link
              href="/upload"
              className="flex items-center gap-2 bg-white/25 hover:bg-white/40 text-sm font-medium px-4 py-2 rounded-full transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:block">업로드</span>
            </Link>

            <div ref={menuRef} className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                {avatarUrl ? (
                  <Image src={avatarUrl} alt={displayName} width={32} height={32} className="rounded-full border-2 border-white/50" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center text-sm font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium hidden sm:block max-w-[100px] truncate">{displayName}</span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white text-slate-900 border border-sky-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-sky-100">
                    <p className="font-medium text-sm truncate">{displayName}</p>
                    <p className="text-slate-400 text-xs truncate">{user.email}</p>
                  </div>
                  <Link href="/my-videos" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50 transition-colors">
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    내 동영상
                  </Link>
                  <Link href="/upload" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50 transition-colors">
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    동영상 업로드
                  </Link>
                  <button onClick={handleLogout} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-500 hover:bg-sky-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/login" className="bg-white text-sky-600 hover:bg-sky-50 text-sm font-semibold px-4 py-2 rounded-full transition-colors">
            로그인
          </Link>
        )}
      </div>
    </header>
  )
}
