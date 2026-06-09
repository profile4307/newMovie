import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Cloudflare Image Resizing($0.50/1,000 변환) 과금 차단.
    // 이미지는 Bunny/Supabase에서 적정 크기로 서빙되므로 최적화 불필요.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '*.b-cdn.net' },
      { protocol: 'https', hostname: '*.cloudflarestream.com' },
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  // Next.js 16 Turbopack 기본 활성화 — 빈 설정으로 명시
  turbopack: {},
};

export default nextConfig;
