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

// Back-fill the CDN WebP variants that were never generated (AGL-1468).
//
//   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-media-variants.mjs           # DRY RUN
//   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-media-variants.mjs --apply
//
//   --scope=hosts/DXnRbPH4CQ   limit to one library
//   --limit=10                 stop after N assets (rehearse on a few first)
//   --json                     machine-readable summary
//
// DRY RUN IS THE DEFAULT AND IT WRITES NOTHING — not a document, not an
// object. It downloads each eligible original, encodes the variants in
// memory, and reports exactly what `--apply` would upload, in bytes.
//
// WHY THIS EXISTS
//
// Measured 2026-08-13: 1 of 180 media documents has a non-empty `variants`
// array. Every image uploaded since 2026-07-19 has an empty one, because
// generation failed inside a `catch` that only reached a serverless log.
// Fixing the routes fixes NEW uploads; the existing library stays slow —
// `serve-media-cdn.ts` serves a variant only when the document's `variants`
// array contains the requested width, so `?w=320` on all 174 of them returns
// the full-size original with a 200, which is exactly why nobody noticed.
//
// TWO RULES THIS SCRIPT MUST NOT BREAK
//
// 1. VARIANT BYTES ARE EXCLUDED FROM THE STORAGE COUNTER, deliberately and
//    since AGL-175: they are derived artifacts the platform can regenerate,
//    so a host is not billed for them. This script therefore touches
//    `counters/media` for ONE reason only — to clear `variantFailures` it has
//    resolved — and never adjusts `bytes`. A back-fill that inflated the
//    counter would push orgs toward a storage limit for files they did not
//    upload, and on a metered plan that is real money.
//
// 2. IT ONLY ADDS. It writes `variants` and clears `variantsError`; it never
//    deletes an original, never moves an object, never touches `cdnPath`,
//    `contentHash` or `url`. An asset it cannot process is left exactly as it
//    is and counted as `skipped`.
//
// ELIGIBILITY mirrors the route's own rule, because a document claiming a
// width whose object does not exist is worse than no variant at all — the CDN
// route would select it and stream a 404 body.
//
//   - `contentType` starts with `image/` and is not `image/svg+xml`
//   - the document has a `cdnPath` (paid `mediaCdn` entitlement, not private)
//   - no `deletedAt`
//   - at least one of 320/640/1280 is narrower than the source

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import sharp from 'sharp'

const VARIANT_WIDTHS = [320, 640, 1280]
const apply = process.argv.includes('--apply')
const asJson = process.argv.includes('--json')
const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : null
}
const onlyScope = arg('scope')
const limit = Number(arg('limit') ?? 0) || Infinity

const projectId = process.env.GCLOUD_PROJECT ?? 'aglyn-main'
initializeApp({
  credential: applicationDefault(),
  projectId,
  storageBucket: process.env.STORAGE_BUCKET ?? `${projectId}.appspot.com`,
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const bucket = getStorage().bucket()

const log = (...args) => {
  if (!asJson) console.log(...args)
}

log(
  apply
    ? `APPLYING to ${projectId} — this writes Storage objects and media documents.`
    : `DRY RUN against ${projectId}. Nothing will be written. Pass --apply to write.`,
)

const snapshot = await firestore.collectionGroup('media').get()
log(`media documents: ${snapshot.size}`)

const summary = {
  projectId,
  apply,
  documents: snapshot.size,
  eligible: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  variantsWritten: 0,
  bytesDownloaded: 0,
  bytesToWrite: 0,
  storageReads: 0,
  storageWrites: 0,
  documentWrites: 0,
  scopes: {},
  failures: [],
}

for (const doc of snapshot.docs) {
  if (summary.processed + summary.failed >= limit) break
  const data = doc.data()
  const parent = doc.ref.parent.parent
  const scope = parent ? `${parent.parent.id}/${parent.id}` : '?'
  if (onlyScope && scope !== onlyScope) continue

  const contentType = String(data.contentType ?? '')
  const existing = Array.isArray(data.variants) ? data.variants : []
  const widths = VARIANT_WIDTHS.filter(
    (width) => !(data.width && data.width <= width),
  )
  const eligible =
    contentType.startsWith('image/') &&
    contentType !== 'image/svg+xml' &&
    Boolean(data.cdnPath) &&
    !data.deletedAt &&
    widths.length > 0 &&
    existing.length === 0

  if (!eligible) {
    summary.skipped += 1
    continue
  }
  summary.eligible += 1

  const objectPath = data.storagePath || `${scope}/media/${doc.id}`
  try {
    // ONE Class B read per asset. The originals total ~28 MB across the whole
    // corpus, so the download side of this is roughly one page view.
    const [buffer] = await bucket.file(objectPath).download()
    summary.storageReads += 1
    summary.bytesDownloaded += buffer.length

    const produced = []
    for (const width of widths) {
      const webp = await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
      summary.bytesToWrite += webp.length
      produced.push({ width, bytes: webp.length })
      if (apply) {
        await bucket.file(`${objectPath}__w${width}.webp`).save(webp, {
          contentType: 'image/webp',
          metadata: { cacheControl: 'public, max-age=31536000, immutable' },
        })
        summary.storageWrites += 1
      }
    }

    if (apply) {
      // `variants` LAST and in one write: the CDN route reads this array to
      // decide whether to serve `${path}__w{n}.webp`, so the objects must
      // exist before the document claims them or `?w=320` starts 404ing.
      await doc.ref.set(
        {
          variants: produced.map((entry) => entry.width),
          variantsError: FieldValue.delete(),
        },
        { merge: true },
      )
      summary.documentWrites += 1
    }

    summary.processed += 1
    summary.variantsWritten += produced.length
    summary.scopes[scope] = (summary.scopes[scope] ?? 0) + 1
    log(
      `${apply ? 'wrote' : 'would write'} ${objectPath}: ` +
        produced.map((e) => `w${e.width}=${e.bytes}B`).join(' '),
    )
  } catch (error) {
    summary.failed += 1
    summary.failures.push({ scope, id: doc.id, error: String(error?.message ?? error) })
    log(`FAILED ${objectPath}: ${error?.message ?? error}`)
  }
}

// The counter's `variantFailures` is a monotonic count of route failures, and
// this pass resolves the assets behind them. Cleared per scope AFTER the
// variants land, so a partial run never claims more than it fixed.
if (apply) {
  for (const scope of Object.keys(summary.scopes)) {
    await firestore
      .doc(scope)
      .collection('counters')
      .doc('media')
      .set({ variantFailures: 0 }, { merge: true })
    summary.documentWrites += 1
  }
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('\n--- summary ---')
  console.log(`eligible          ${summary.eligible}`)
  console.log(`processed         ${summary.processed}`)
  console.log(`skipped           ${summary.skipped}`)
  console.log(`failed            ${summary.failed}`)
  console.log(`variants          ${summary.variantsWritten}`)
  console.log(`bytes downloaded  ${summary.bytesDownloaded}`)
  console.log(`bytes to write    ${summary.bytesToWrite}`)
  console.log(`Storage reads     ${summary.storageReads} (Class B)`)
  console.log(`Storage writes    ${summary.storageWrites} (Class A)`)
  console.log(`document writes   ${summary.documentWrites}`)
  console.log(`by scope          ${JSON.stringify(summary.scopes)}`)
  if (summary.failures.length) console.log('failures', summary.failures)
  if (!apply) console.log('\nDRY RUN — nothing was written.')
}

process.exit(summary.failed ? 1 : 0)
