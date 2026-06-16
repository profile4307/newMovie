#!/usr/bin/env node
// 배포 버전(KST)을 현재 시각으로 갱신한 뒤 커밋·푸시한다.
// 사용: node scripts/release.mjs ["커밋 메시지"]  (또는 pnpm release "메시지")
// 메시지 생략 시 "chore: 배포 <버전>"
//
// 목적: 사이드바 하단의 DEPLOY_VERSION으로 배포 반영 여부를 육안 확인.
// 푸시 직전에 항상 현재 시각으로 갱신되도록 푸시는 이 스크립트로 수행한다.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// KST(UTC+9) 현재 시각 → 'YYYY-MM-DD HH:mm:ss'
const version = new Date(Date.now() + 9 * 3600 * 1000)
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ')

writeFileSync(
  join(root, 'apps/web/src/lib/version.ts'),
  `// 배포 버전 (KST) — scripts/release.mjs가 푸시 직전 자동 갱신.\n` +
    `// 사이드바 하단에 표시되어 배포 반영 여부를 육안 확인하는 용도.\n` +
    `export const DEPLOY_VERSION = '${version}'\n`
)

const message = process.argv.slice(2).join(' ') || `chore: 배포 ${version}`
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' })

git('add', '-A')
git('commit', '-m', message)
git('push', 'origin', 'master')

console.log(`\n✅ 배포 버전 ${version} (KST) 푸시 완료`)
