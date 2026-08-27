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

// Backfill the normalized `nameLower` search key on existing docs (AGL-835/836)
// so the switchers' name-prefix query finds pre-existing screens and sites, not
// only ones created/renamed after the write-path change shipped.
//
// Scope: `hosts/{hostId}` and `hosts/{hostId}/screens` (both from
// displayName, `nameLower` only), and `orgs/{orgId}` (from name — `nameLower`
// AND the `nameTokens` word-prefix array the staff search matches on).
//
// ORGS WERE DELIBERATELY EXCLUDED, and are not any more (AGL-693). The
// original reason was sound — "they stay client-filtered, so a nameLower on
// them would be an index nothing reads" — and it stopped being true when the
// staff organization list moved its search to the server. A filter applied in
// the browser sees the rows on screen, ten of them, which answers "no such
// organization" for every organization past the first page.
//
// ⚠️ Until this has run, an org WITHOUT `nameLower` is invisible to that
// search: `orderBy('nameLower')` drops documents that lack the field. It
// still lists normally, which is what makes the gap quiet.
//
// Layouts stay excluded, and for the original reason: nothing reads a
// nameLower on them.
//
// Dry-run by default (reads + prints the plan, writes nothing). Pass --commit
// to apply. Idempotent: re-running converges (a doc whose nameLower already
// matches is skipped). Optional --host <id> limits to a single site.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-name-lower.mjs [--host <id>] [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// Load admin creds from the repo's local env files so this script is
// self-contained. Already-set process.env wins.
function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  const files = roots.flatMap((r) => names.map((n) => `${r}/${n}`))
  for (const file of files) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : fallback
}

const COMMIT = flag('--commit')
const ONLY_HOST = opt('--host', '')

// MUST match `nameSearchKey` in libs/aglyn/src/lib/app-utils/name-search.ts —
// the stored key and the query are normalized the same way or the prefix range
// silently disagrees.
const nameSearchKey = (name) =>
  (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

// MUST match `nameSearchTokens` in the same module. Every prefix of every
// word, so `array-contains` answers "contains a word starting with X" — which
// is what lets the staff search find "Acme Coffee" by "coffee". The caps are
// the library's: twelve characters per prefix, 120 tokens per document.
const NAME_TOKEN_MAX_PREFIX = 12
const NAME_TOKEN_LIMIT = 120
const nameSearchTokens = (name) => {
  const key = nameSearchKey(name)
  if (!key) return []
  const tokens = new Set()
  for (const word of key.split(' ')) {
    if (!word) continue
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= NAME_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

// ── Admin init (same pattern as migrate-blog-covers.mjs) ────────────────────
const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    console.error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `\nBackfill nameLower — project=${projectId} ` +
    `${ONLY_HOST ? `host=${ONLY_HOST} ` : ''}` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

// Buffered writer: commits in batches of 400 (Firestore's per-batch cap is
// 500), no-op in dry-run.
let batch = firestore.batch()
let buffered = 0
let written = 0
const stamp = async (ref, value, fields = undefined) => {
  written += 1
  if (!COMMIT) return
  batch.update(ref, { nameLower: value, ...(fields ?? {}) })
  if ((buffered += 1) >= 400) {
    // Swap in the fresh batch BEFORE awaiting the full one: `batch` never
    // points at an in-flight commit, which is also what satisfies
    // require-atomic-updates (AGL-1815).
    const full = batch
    batch = firestore.batch()
    buffered = 0
    await full.commit()
  }
}

let hostsScanned = 0
let hostsChanged = 0
let screensScanned = 0
let screensChanged = 0

const hostsQuery = ONLY_HOST
  ? firestore.collection('hosts').where('__name__', '==', ONLY_HOST)
  : firestore.collection('hosts')
const hostSnap = await hostsQuery.get()

for (const hostDoc of hostSnap.docs) {
  hostsScanned += 1
  const host = hostDoc.data()
  if (typeof host.displayName === 'string' && host.displayName.trim()) {
    const want = nameSearchKey(host.displayName)
    if (host.nameLower !== want) {
      hostsChanged += 1
      await stamp(hostDoc.ref, want)
    }
  }

  // Screens subcollection — fetch only the fields we compare.
  const screenSnap = await hostDoc.ref
    .collection('screens')
    .select('displayName', 'nameLower')
    .get()
  for (const screenDoc of screenSnap.docs) {
    screensScanned += 1
    const s = screenDoc.data()
    if (typeof s.displayName !== 'string' || !s.displayName.trim()) continue
    const want = nameSearchKey(s.displayName)
    if (s.nameLower !== want) {
      screensChanged += 1
      await stamp(screenDoc.ref, want)
    }
  }
}

// Organizations — the staff list's server-side search orders by this.
let orgsScanned = 0
let orgsChanged = 0
if (!ONLY_HOST) {
  const orgSnap = await firestore
    .collection('orgs')
    .select('name', 'nameLower', 'nameTokens')
    .get()
  for (const orgDoc of orgSnap.docs) {
    orgsScanned += 1
    const org = orgDoc.data()
    // An org with no name has nothing to key on. Skipped rather than
    // stamped with an empty string: `orderBy` would then place it at the
    // very front of every prefix range it does not belong to.
    if (typeof org.name !== 'string' || !org.name.trim()) continue
    const want = nameSearchKey(org.name)
    // The staff search is `array-contains` over word-prefix tokens, so the
    // tokens are what makes an org findable — `nameLower` only orders the
    // result. A doc with one and not the other is half-migrated, so both are
    // compared and both are written.
    const wantTokens = nameSearchTokens(org.name)
    const haveTokens = Array.isArray(org.nameTokens) ? org.nameTokens : null
    const tokensDiffer =
      !haveTokens ||
      haveTokens.length !== wantTokens.length ||
      wantTokens.some((token, index) => haveTokens[index] !== token)
    if (org.nameLower !== want || tokensDiffer) {
      orgsChanged += 1
      await stamp(orgDoc.ref, want, { nameTokens: wantTokens })
    }
  }
}

if (COMMIT && buffered > 0) await batch.commit()

console.log(`hosts:   scanned=${hostsScanned} changed=${hostsChanged}`)
console.log(`screens: scanned=${screensScanned} changed=${screensChanged}`)
console.log(
  ONLY_HOST
    ? 'orgs:    skipped (--host limits this run to one site)'
    : `orgs:    scanned=${orgsScanned} changed=${orgsChanged}`,
)
console.log(
  `\n${COMMIT ? `Committed ${written} update(s).` : `Dry-run — ${written} update(s) planned. Re-run with --commit to apply.`}\n`,
)
process.exit(0)
