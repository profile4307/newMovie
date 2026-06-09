import { Env } from '../index'

// Bunny Storage Zone 헬퍼 — 썸네일·아바타 저장용 (Supabase Storage 대체).
// Supabase egress(~$0.09/GB) 대신 Bunny CDN(~$0.01/GB)으로 서빙해 전송비 절감.
//
// 업로드: PUT  https://{endpoint}/{zone}/{path}   (AccessKey 헤더)
// 삭제:   DELETE 동일 경로
// 목록:   GET  https://{endpoint}/{zone}/{prefix} (JSON 배열)
// 서빙:   https://{host}/{path}  (연결된 Pull Zone CDN)
export function bunnyStorage(env: Env) {
  const endpoint = env.BUNNY_STORAGE_ENDPOINT || 'storage.bunnycdn.com'
  const zone = env.BUNNY_STORAGE_ZONE_NAME
  const key = env.BUNNY_STORAGE_PASSWORD
  const host = env.BUNNY_STORAGE_HOSTNAME

  // path 예: 'thumbnails/uid_123.jpg' → 반환 'https://{host}/thumbnails/uid_123.jpg'
  async function upload(path: string, bytes: ArrayBuffer, mime: string): Promise<string> {
    const res = await fetch(`https://${endpoint}/${zone}/${path}`, {
      method: 'PUT',
      headers: { AccessKey: key, 'Content-Type': mime },
      body: bytes,
    })
    if (!res.ok) {
      throw new Error(`Bunny storage upload failed: ${res.status} ${await res.text()}`)
    }
    return `https://${host}/${path}`
  }

  async function remove(path: string): Promise<void> {
    await fetch(`https://${endpoint}/${zone}/${path}`, {
      method: 'DELETE',
      headers: { AccessKey: key },
    })
  }

  // prefix는 폴더 경로(끝에 '/' 포함). 반환: zone 기준 파일 경로 배열 (디렉터리 제외)
  async function list(prefix: string): Promise<string[]> {
    const res = await fetch(`https://${endpoint}/${zone}/${prefix}`, {
      headers: { AccessKey: key, Accept: 'application/json' },
    })
    if (!res.ok) return []
    const items = (await res.json()) as { ObjectName: string; IsDirectory: boolean }[]
    return items.filter((i) => !i.IsDirectory).map((i) => prefix + i.ObjectName)
  }

  return { upload, remove, list }
}
