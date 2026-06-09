import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// 비용 최소화 구성: incrementalCache(R2) 미지정.
// 이 앱은 홈(SSR, 매 요청 캐시된 API 호출) + 동적 라우트(클라이언트 렌더) 위주라
// ISR/SSG 캐시가 필요 없어 R2 바인딩을 생략한다 (R2 과금·설정 회피).
export default defineCloudflareConfig()
