'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function Header() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (search.trim()) router.push(`/?search=${encodeURIComponent(search.trim())}`)
  }

  return (
    <header className="sticky top-0 z-50 h-14 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center px-4 gap-4">
      {/* 로고 */}
      <Link href="/" className="flex items-center gap-2 flex-shrink-0">
        <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="font-bold text-lg hidden sm:block">NewMovie</span>
      </Link>

      {/* 검색창 */}
      <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-auto flex">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="검색"
          className="flex-1 bg-gray-800 border border-gray-600 rounded-l-full px-5 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="bg-gray-700 hover:bg-gray-600 border border-l-0 border-gray-600 rounded-r-full px-5 py-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>

      {/* 우측 액션 */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          href="/upload"
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-sm font-medium px-4 py-2 rounded-full transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:block">업로드</span>
        </Link>
        <Link
          href="/login"
          className="bg-blue-600 hover:bg-blue-700 text-sm font-medium px-4 py-2 rounded-full transition-colors"
        >
          로그인
        </Link>
      </div>
    </header>
  )
}
