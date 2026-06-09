/**
 * hls.js SSR stub
 * Turbopack이 서버사이드에서 hls.js를 분석하려다 워커 크래시하는 버그 방지.
 * next.config.ts의 turbo.resolveAlias로 서버 번들에서 이 파일로 교체됨.
 */
const HlsStub = {
  isSupported: () => false,
  Events: {},
} as unknown

export default HlsStub
