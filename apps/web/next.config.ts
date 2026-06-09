import type { NextConfig } from "next";
import path from "node:path";

// pnpm 모노레포: 실제 패키지가 루트의 node_modules/.pnpm에 위치하므로
// 파일 트레이싱/Turbopack 모두 루트를 모노레포 루트로 잡아야 next 패키지가 해석된다.
// (process.cwd()는 apps/web → 상위의 상위 = 모노레포 루트)
const monorepoRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  // OpenNext가 outputFileTracingRoot를 앱 디렉터리로 설정하면 turbopack.root와
  // 불일치하여 빌드가 깨진다. 둘을 동일하게(모노레포 루트) 고정.
  outputFileTracingRoot: monorepoRoot,
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

  // Next.js 16 Turbopack 기본 활성화.
  // pnpm 모노레포: 실제 패키지는 루트의 node_modules/.pnpm에 위치하므로
  // turbopack root를 모노레포 루트로 잡아야 next 패키지 해석이 된다.
  // (process.cwd()는 apps/web이므로 한 단계 상위의 상위 = 루트)
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;

// OpenNext (Cloudflare Workers 배포) — `next dev` 중 Cloudflare 바인딩/환경을 사용 가능하게 함
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
