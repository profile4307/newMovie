import { Env } from '../index'
import { createSupabaseClient } from './supabase'

// R2 HLS 서빙 파이프라인 (docs/r2-serving-design.md)
// 트랜스코딩은 Bunny에 맡기고, 완료된 HLS 파일을 R2로 복사해 egress 무료로 서빙.
// MEDIA_BUCKET/MEDIA_CDN_HOSTNAME 미설정 시 모든 함수가 no-op → Bunny 서빙 유지.

const COPY_CONCURRENCY = 6
// 무료 플랜 invocation당 subrequest 50개 한도 내 안전 배치 (세그먼트당 fetch+put=2, 고정 오버헤드 ~10)
const FILES_PER_RUN = 18
const PURGE_GRACE_DAYS = 7 // 복사 후 Bunny 원본 삭제까지의 유예 (롤백 창)
const PURGE_BATCH = 10

// R2 서빙 활성화 여부 — 버킷 바인딩과 서빙 base URL이 모두 있어야 함
export function r2Enabled(env: Env): env is Env & { MEDIA_BUCKET: R2Bucket; MEDIA_BASE_URL: string } {
  return !!env.MEDIA_BUCKET && !!env.MEDIA_BASE_URL
}

export function r2PlaybackUrl(env: Env, streamUid: string): string {
  return `${env.MEDIA_BASE_URL}/${streamUid}/playlist.m3u8`
}

// HLS manifest에서 참조 경로 추출 (#로 시작하지 않는 줄)
function parseManifestPaths(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

// Bunny manifest는 상대 경로만 사용 — 절대 URL이 나오면 복사 포기 (재작성 없이는 동작 불가)
function assertRelative(path: string, uid: string): void {
  if (path.includes('://') || path.startsWith('/')) {
    throw new Error(`[r2-copy] ${uid}: 절대 경로 발견 — 복사 불가: ${path}`)
  }
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (path.endsWith('.ts')) return 'video/mp2t'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

type CopyItem = { path: string; body?: string } // body가 있으면 fetch 없이 put만

async function putFile(bucket: R2Bucket, base: string, uid: string, item: CopyItem): Promise<void> {
  let body: ArrayBuffer | string
  if (item.body !== undefined) {
    body = item.body
  } else {
    const res = await fetch(base + item.path)
    if (!res.ok) throw new Error(`[r2-copy] ${uid}: fetch 실패 ${item.path} (${res.status})`)
    body = await res.arrayBuffer()
  }
  await bucket.put(`${uid}/${item.path}`, body, {
    httpMetadata: { contentType: contentTypeFor(item.path) },
  })
}

// Bunny HLS 전체(마스터/렌디션 manifest + 세그먼트 + 썸네일)를 R2로 복사하고
// videos.playback_host='r2'로 전환. 반환: true=완료, false=일부만 복사(재호출 필요).
//
// 재개 가능(resumable): R2에 이미 있는 키는 건너뛰고 한 번에 FILES_PER_RUN개씩만 복사
// — 무료 플랜 subrequest 50개 한도 안에서 큐 메시지를 이어가며 완주.
// 복사 순서는 세그먼트 → 썸네일 → 렌디션 manifest → 마스터 manifest.
// 마스터가 마지막이므로 R2에 마스터가 생긴 시점 = 전체 재생 가능 보장.
// 멱등: 이미 'r2'인 영상은 스킵, 재복사는 동일 키 덮어쓰기. 실패 시 throw → 큐 재시도.
export async function copyVideoToR2(env: Env, uid: string): Promise<boolean> {
  if (!r2Enabled(env)) return true
  const bucket = env.MEDIA_BUCKET
  const db = createSupabaseClient(env)

  const { data: rows } = await db.query<{ id: string; thumbnail_url: string | null; playback_host: string }[]>(
    `/videos?select=id,thumbnail_url,playback_host&stream_uid=eq.${uid}&limit=1`
  )
  if (!rows || rows.length === 0 || rows[0]!.playback_host !== 'bunny') return true

  const base = `https://${env.BUNNY_CDN_HOSTNAME}/${uid}/`

  // 1. 마스터 manifest → 렌디션 목록
  const masterRes = await fetch(`${base}playlist.m3u8`)
  if (!masterRes.ok) throw new Error(`[r2-copy] ${uid}: 마스터 manifest fetch 실패 (${masterRes.status})`)
  const masterText = await masterRes.text()
  const variantPaths = parseManifestPaths(masterText)
  if (variantPaths.length === 0) throw new Error(`[r2-copy] ${uid}: 렌디션 없음`)
  variantPaths.forEach((p) => assertRelative(p, uid))

  // 2. 렌디션 manifest → 세그먼트 목록
  const variantManifests: CopyItem[] = []
  const segmentPaths: string[] = []
  for (const variantPath of variantPaths) {
    const res = await fetch(base + variantPath)
    if (!res.ok) throw new Error(`[r2-copy] ${uid}: 렌디션 manifest fetch 실패 ${variantPath} (${res.status})`)
    const text = await res.text()
    variantManifests.push({ path: variantPath, body: text })
    const dir = variantPath.includes('/') ? variantPath.slice(0, variantPath.lastIndexOf('/') + 1) : ''
    for (const seg of parseManifestPaths(text)) {
      assertRelative(seg, uid)
      segmentPaths.push(dir + seg)
    }
  }

  // 3. 전체 파일 목록 (복사 순서 보장: 마스터 manifest가 항상 마지막)
  const thumb = rows[0]!.thumbnail_url
  const thumbPath = thumb?.startsWith(base) ? thumb.slice(base.length) : undefined
  const allFiles: CopyItem[] = [
    ...segmentPaths.map((path) => ({ path })),
    ...(thumbPath ? [{ path: thumbPath }] : []),
    ...variantManifests,
    { path: 'playlist.m3u8', body: masterText },
  ]

  // 4. 이미 복사된 키는 건너뛰기 (재시도/재호출 시 이어서 진행)
  const existing = new Set<string>()
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix: `${uid}/`, cursor, limit: 1000 })
    listed.objects.forEach((o) => existing.add(o.key))
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  const pending = allFiles.filter((f) => !existing.has(`${uid}/${f.path}`))
  const batch = pending.slice(0, FILES_PER_RUN)

  let i = 0
  async function workerLoop() {
    while (i < batch.length) {
      await putFile(bucket, base, uid, batch[i++]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, batch.length) }, workerLoop))

  if (pending.length > batch.length) return false // 다음 호출에서 이어서

  // 5. 전환 — playback_host=eq.bunny 가드로 중복 실행에도 1회만 적용
  const newThumbnailUrl = thumbPath ? `${env.MEDIA_BASE_URL}/${uid}/${thumbPath}` : undefined
  const { error } = await db.query(`/videos?stream_uid=eq.${uid}&playback_host=eq.bunny`, {
    method: 'PATCH',
    body: JSON.stringify({
      playback_host: 'r2',
      r2_copied_at: new Date().toISOString(),
      ...(newThumbnailUrl ? { thumbnail_url: newThumbnailUrl } : {}),
    }),
  })
  if (error) throw new Error(`[r2-copy] ${uid}: DB 전환 실패: ${error}`)
  return true
}

// 트랜스코딩 완료 시 복사 트리거 — 큐가 있으면 큐로(자동 재시도 + 분할 복사),
// 없으면 waitUntil에서 완료까지 반복 호출 (Paid 플랜의 subrequest 1,000개 한도 필요)
export async function enqueueR2Copy(env: Env, uid: string, ctx: ExecutionContext): Promise<void> {
  if (!r2Enabled(env)) return
  if (env.R2_COPY_QUEUE) {
    await env.R2_COPY_QUEUE.send({ uid })
  } else {
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < 30; i++) {
          if (await copyVideoToR2(env, uid)) return
        }
        console.error('[r2-copy] 반복 한도 내 미완료:', uid)
      })().catch((e) => console.error('[r2-copy] 직접 복사 실패:', uid, e))
    )
  }
}

// R2 전환 후 유예 기간이 지난 영상의 Bunny 원본 삭제 (cron에서 호출)
export async function purgeBunnyOriginals(env: Env): Promise<void> {
  if (!r2Enabled(env)) return
  const db = createSupabaseClient(env)
  const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 86400_000).toISOString()

  const { data } = await db.query<{ stream_uid: string }[]>(
    `/videos?select=stream_uid&playback_host=eq.r2&bunny_purged=eq.false&r2_copied_at=lt.${cutoff}&limit=${PURGE_BATCH}`
  )
  for (const v of data ?? []) {
    const res = await fetch(
      `https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${v.stream_uid}`,
      { method: 'DELETE', headers: { AccessKey: env.BUNNY_STREAM_API_KEY } }
    )
    if (res.ok || res.status === 404) {
      await db.query(`/videos?stream_uid=eq.${v.stream_uid}`, {
        method: 'PATCH',
        body: JSON.stringify({ bunny_purged: true }),
      })
    } else {
      console.error('[r2-purge] Bunny 삭제 실패:', v.stream_uid, res.status)
    }
  }
}

// 영상 삭제 시 R2의 HLS 파일 정리 (uid prefix 전체)
export async function deleteR2Prefix(env: Env, uid: string): Promise<void> {
  const bucket = env.MEDIA_BUCKET
  if (!bucket) return
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix: `${uid}/`, cursor })
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((o) => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}
