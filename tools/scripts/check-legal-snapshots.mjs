/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Verifies the ACCEPTANCE SNAPSHOTS behind `LEGAL_DOCUMENTS` (AGL-1497).
//
// ## Why this check has to exist
//
// The snapshots used to sit in the repo as `constants/legal/v*/…txt`, one
// folder per version, and the list grew without bound — seven versions in
// eight days, none of which anyone had accepted. They now live in the shared
// drive at `Platform Docs/Legal/Acceptance-Snapshots/<version>/`, and the repo
// keeps only the `sha256`.
//
// That trade is only safe if something READS the archive. A hash in a manifest
// pointing at a file nobody fetches is the "written but never read" failure:
// the record would name a document it cannot reproduce, which is the exact
// problem the snapshot exists to prevent. So this runs in CI beside
// legal-drift, on the same Drive credentials, and FAILS when:
//
//  - the archived file for the current version is missing;
//  - its bytes do not hash to the `sha256` in the manifest;
//  - the manifest and the archive disagree on length.
//
// ## Why the archive is .txt and not a Google Doc
//
// The hash is of the PAGE CAPTURE — a DOM text-node walk of the published
// page. A Google Doc export re-flows lines, so a Doc could never hash back to
// it however faithful its words. The archived file must be byte-identical to
// what was hashed, or this check is theatre.
//
// Exit codes match the legal-drift family: 0 verified, 1 a hash disagrees,
// 2 could not check (no credentials, archive unreachable). A run that verified
// NOTHING exits 2 — "no mismatches found" and "nothing was compared" must
// never render the same.

import { createSign, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadLocalEnv, readServiceAccount } from './lib/firebase-rules-api.mjs'

loadLocalEnv()

const LEGAL_FOLDER_ID =
  process.env['LEGAL_DRIVE_FOLDER_ID'] ||
  process.argv.find((a) => a.startsWith('--folder='))?.slice('--folder='.length)

/** Read the manifest without importing TypeScript — same trade as pricing-drift. */
function readManifest() {
  const src = readFileSync('apps/console/constants/legal-documents.ts', 'utf8')
  const version = /LEGAL_DOCUMENT_VERSION = '([^']+)'/.exec(src)?.[1]
  const entries = []
  for (const m of src.matchAll(
    /key:\s*'([^']+)'[\s\S]*?sha256:\s*\n?\s*'([0-9a-f]{64})',\s*\n\s*bytes:\s*(\d+)/g,
  )) {
    entries.push({ key: m[1], sha256: m[2], bytes: Number(m[3]) })
  }
  return { version, entries }
}

async function mintDriveToken() {
  const sa = readServiceAccount()
  if (!sa) return null
  const b64 = (i) => Buffer.from(i).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned =
    b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64(JSON.stringify({
      iss: sa.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600,
    }))
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.privateKey)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64(sig)}`,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return body.access_token ?? null
}

async function child(token, parent, name) {
  const u = new URL('https://www.googleapis.com/drive/v3/files')
  u.searchParams.set('q', `'${parent}' in parents and name = '${name}' and trashed = false`)
  u.searchParams.set('fields', 'files(id,name,mimeType,size)')
  u.searchParams.set('supportsAllDrives', 'true')
  u.searchParams.set('includeItemsFromAllDrives', 'true')
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const { files = [] } = await res.json()
  return files[0] ?? null
}


/**
 * §18.5 AS PUBLISHED vs §18.5 AS COMPUTED (AGL-2316).
 *
 * Moved here from `legal-acceptance-optout-window.spec.ts` when the snapshots
 * left the repo: the check needs the TEXT, and the text is in Drive now. The
 * guarantee is unchanged and worth keeping — a clause that says 30 days while
 * the evaluator counts 60 is a promise the product does not keep, and nothing
 * else in the codebase would notice.
 *
 * A null match FAILS. The clause being reworded or moved is exactly the change
 * this exists to catch, so "could not find it" is a red, never a skip.
 */
function clauseAgrees(termsText) {
  const src = readFileSync('libs/tenant/data/admin/src/lib/server/legal-acceptance.ts', 'utf8')
  const days = Number(/ARBITRATION_OPT_OUT_DAYS\s*=\s*(\d+)/.exec(src)?.[1])
  if (!Number.isFinite(days)) return false
  const flat = termsText.replace(/\s+/g, ' ')
  const m = /opt out of arbitration[\s\S]{0,160}?within (\d+) days of first accepting these Terms/i.exec(flat)
  if (!m) return false
  // The wording the evaluator's "from FIRST acceptance" clock depends on.
  if (!flat.includes('of first accepting these Terms')) return false
  return Number(m[1]) === days
}

const { version, entries } = readManifest()
if (!version || !entries.length) {
  console.error('CANNOT CHECK: LEGAL_DOCUMENT_VERSION or LEGAL_DOCUMENTS could not be parsed.')
  process.exit(2)
}
if (!LEGAL_FOLDER_ID) {
  console.error('CANNOT CHECK: LEGAL_DRIVE_FOLDER_ID is not set (repo variable, or --folder=).')
  process.exit(2)
}
const token = await mintDriveToken()
if (!token) {
  console.error('CANNOT CHECK: no Drive credentials — FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY.')
  process.exit(2)
}

const archiveRoot = await child(token, LEGAL_FOLDER_ID, 'Acceptance-Snapshots')
if (!archiveRoot) {
  console.error('CANNOT CHECK: Legal/Acceptance-Snapshots not found in the Drive folder.')
  process.exit(2)
}
const versionFolder = await child(token, archiveRoot.id, version)
if (!versionFolder) {
  console.error(`MISSING: no archived snapshot folder for ${version}. Every acceptance recorded`)
  console.error('against it names text that cannot be produced. Archive it before shipping.')
  process.exit(1)
}

console.log(`Acceptance snapshots — ${version} (Drive: Legal/Acceptance-Snapshots/${version})`)
let bad = 0
let verified = 0
for (const doc of entries) {
  const f = await child(token, versionFolder.id, `${doc.key}.txt`)
  if (!f) { console.log(`  MISSING     ${doc.key}.txt`); bad++; continue }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { console.log(`  UNREADABLE  ${doc.key}.txt — HTTP ${res.status}`); bad++; continue }
  const text = await res.text()
  const sha = createHash('sha256').update(text, 'utf8').digest('hex')
  const bytes = Buffer.byteLength(text, 'utf8')
  if (sha !== doc.sha256) {
    console.log(`  DIFFERS     ${doc.key}.txt — archive ${sha.slice(0, 16)}… vs manifest ${doc.sha256.slice(0, 16)}…`)
    bad++
  } else if (bytes !== doc.bytes) {
    console.log(`  DIFFERS     ${doc.key}.txt — archive ${bytes} bytes vs manifest ${doc.bytes}`)
    bad++
  } else if (doc.key === 'terms' && !clauseAgrees(text)) {
    console.log(`  DIFFERS     terms.txt — §18.5 arbitration opt-out window disagrees with ARBITRATION_OPT_OUT_DAYS`)
    bad++
  } else if (!/Aglyn/.test(text) || !/^Last updated:/m.test(text)) {
    // Cheap sanity that the archive holds the DOCUMENT and not a 404 page or
    // the site chrome around it. A matching hash proves the bytes are the ones
    // that were pinned; it cannot notice that the wrong thing was pinned.
    console.log(`  SUSPECT     ${doc.key}.txt — hash matches but the text does not read like a legal document`)
    bad++
  } else {
    console.log(`  VERIFIED    ${doc.key}.txt — ${bytes} bytes, sha matches`)
    verified++
  }
}
const code = bad > 0 ? 1 : verified > 0 ? 0 : 2
console.log(`\n${verified} verified, ${bad} problem(s) — exit ${code}`)
process.exit(code)
