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

/**
 * Read the metadata inside every existing media file (AGL-3331).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-media-embedded-metadata.mjs
 *   … --write               # store what was read
 *   … --write --limit 25
 *
 * REPORT-ONLY IS THE DEFAULT: it reads files and prints what it found, and
 * writes nothing until `--write`.
 *
 * ## Why, when the drawer already backfills
 *
 * `/api/media/metadata` reads any asset without a current record the first
 * time its Details drawer opens, so no asset is ever WRONG for lack of this.
 * This makes the library complete up front — the record is there before
 * anybody opens the drawer, for anything that later wants to search or list
 * by it. Rerunning is idempotent: an asset whose record is current for its
 * bytes is skipped.
 *
 * ## What it touches
 *
 * Only `embeddedMetadata`, and only on documents whose content type has a
 * reader. Never `updatedAt` — replace compares against it, and a backfill
 * must not turn the next replace into a 409 — and never the bytes. Reads go
 * through the same reader the upload routes use, loaded from workspace
 * source so the two cannot drift, and a video costs its `moov` box, not its
 * film.
 *
 * Delete this script in the commit that records the run that converged it.
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const WRITE = process.argv.includes('--write')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

const bucketName =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'aglyn-main.appspot.com'
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
  })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const bucket = getStorage().bucket(bucketName)

// Workspace source through jiti, aliases from tsconfig.base.json — the same
// loader `backfill-media-variants.mjs` uses, for the same reasons.
const { default: createJiti } = await import('jiti')
const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
const tsPaths =
  JSON.parse(
    readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    ),
  ).compilerOptions?.paths ?? {}
const alias = Object.fromEntries(
  Object.entries(tsPaths)
    .map(([k, v]) =>
      k.endsWith('/*')
        ? [k.slice(0, -1), join(repoRoot, v[0].slice(0, -1))]
        : [k, join(repoRoot, v[0])],
    )
    .sort((a, b) => b[0].length - a[0].length),
)
const jiti = createJiti(import.meta.url, { interopDefault: true, alias })
const appUtils = '../../libs/aglyn/src/lib/app-utils'
const { readMediaEmbeddedMetadata } = jiti(
  `${appUtils}/media-embedded-metadata/index.ts`,
)
const { embeddedMetadataReadable, MEDIA_EMBEDDED_METADATA_VERSION } = jiti(
  `${appUtils}/media-embedded-fields.ts`,
)

/** A stored object as the reader's random-access bytes. */
const objectReader = (file, size) => ({
  size,
  read: async (start, end) => {
    const from = Math.max(0, start)
    const to = Math.min(size, end)
    if (to <= from) return new Uint8Array(0)
    const [chunk] = await file.download({ start: from, end: to - 1 })
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  },
})

const snapshot = await firestore.collectionGroup('media').get()
console.log(
  `media documents: ${snapshot.size}  mode: ${WRITE ? 'WRITE' : 'report only'}`,
)

const plan = []
let skippedDeleted = 0
let skippedNoReader = 0
let skippedCurrent = 0
for (const doc of snapshot.docs) {
  const data = doc.data()
  if (data.deletedAt) { skippedDeleted++; continue }
  if (!embeddedMetadataReadable(data.contentType)) { skippedNoReader++; continue }
  const stored = data.embeddedMetadata
  if (
    stored?.version === MEDIA_EMBEDDED_METADATA_VERSION &&
    (typeof data.contentSha256 !== 'string' ||
      stored.contentSha256 === data.contentSha256)
  ) {
    skippedCurrent++
    continue
  }
  // `orgs/{id}/media/{mediaId}` → base `orgs/{id}`, the legacy fallback
  // `mediaStoragePathInScope` uses when a document predates `storagePath`.
  const base = doc.ref.parent.parent?.path
  const storagePath =
    typeof data.storagePath === 'string' &&
    base &&
    data.storagePath.startsWith(`${base}/media/`)
      ? data.storagePath
      : `${base}/media/${doc.id}`
  plan.push({ doc, data, storagePath })
}

console.log(
  `skipped: ${skippedDeleted} deleted, ${skippedNoReader} no reader, ` +
    `${skippedCurrent} already current\nto read: ${plan.length}\n`,
)

let read = 0
let empty = 0
let missing = 0
let failed = 0
const byFormat = new Map()
for (const item of plan.slice(0, LIMIT)) {
  const { doc, data, storagePath } = item
  try {
    const file = bucket.file(storagePath)
    const [exists] = await file.exists()
    if (!exists) {
      missing++
      console.log(`  gone ${doc.ref.path} (no object at ${storagePath})`)
      continue
    }
    const [metadata] = await file.getMetadata()
    const record = await readMediaEmbeddedMetadata({
      contentType: String(data.contentType ?? ''),
      reader: objectReader(file, Number(metadata.size ?? 0)),
      ...(typeof data.contentSha256 === 'string'
        ? { contentSha256: data.contentSha256 }
        : {}),
    })
    if (!record) {
      empty++
      continue
    }
    read++
    byFormat.set(record.format, (byFormat.get(record.format) ?? 0) + 1)
    const names = record.fields.map((field) => field.key).slice(0, 8).join(', ')
    console.log(
      `  ${record.format.padEnd(5)} ${doc.ref.path}  ${record.fields.length} field(s)` +
        (names ? `: ${names}${record.fields.length > 8 ? ', …' : ''}` : ''),
    )
    if (WRITE) await doc.ref.update({ embeddedMetadata: record })
  } catch (error) {
    failed++
    console.error(`  FAIL ${doc.ref.path} — ${error?.message ?? error}`)
  }
}

console.log(
  `\nread ${read} (${[...byFormat].map(([f, n]) => `${f} ${n}`).join(', ') || 'none'}), ` +
    `unreadable ${empty}, object missing ${missing}, failed ${failed}`,
)
if (!WRITE) console.log('REPORT ONLY. Nothing was written. Re-run with --write to store.')
