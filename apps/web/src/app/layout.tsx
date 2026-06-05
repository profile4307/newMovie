import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Header } from '@/components/ui/Header'
import { Sidebar } from '@/components/ui/Sidebar'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'NewMovie — 글로벌 동영상 플랫폼',
  description: '누구나 자유롭게 동영상을 공유하는 글로벌 플랫폼',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-sky-50 text-slate-900">
        <Header />
        <Sidebar />
        <main className="ml-56 pt-14 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  )
}
