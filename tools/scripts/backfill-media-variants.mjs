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
 * Backfill missing WebP variants for existing media (AGL-1442 S7).
 *
 *   node tools/scripts/backfill-media-variants.mjs            # report only
 *   node tools/scripts/backfill-media-variants.mjs --write    # generate
 *   node tools/scripts/backfill-media-variants.mjs --write --limit 25
 *
 * REPORT-ONLY IS THE DEFAULT. This writes objects to the production bucket and
 * mutates media documents; the shape of the corpus should be a thing you have
 * READ before it is a thing you have changed.
 *
 * ## Why this exists
 *
 * `image.tsx` used to append the BARE url to its srcSet labelled `1920w` — the
 * only candidate that is never WebP — and with `sizes="100vw"` that is exactly
 * the candidate a retina desktop picks. Measured on aglyn.com: 335 KB / 305 KB
 * / 164 KB PNG originals against 4 KB / 5 KB WebP variants, and ~94% of a media
 * serve is bandwidth.
 *
 * The renderer now asks for `?w=1920` instead. `serveMediaCdn` answers a width
 * an asset does not have by serving the ORIGINAL, so that change shipped with
 * zero regression and zero saving: this script is what turns it into a saving.
 *
 * ## What it does and does not touch
 *
 * - Only `image/*`, never `image/svg+xml` — there is nothing to downscale in a
 *   vector and rasterising it would be a different asset.
 * - Only widths BELOW the source width, which is `mediaVariantWidthsFor`'s own
 *   rule, reused rather than restated. An 800px logo gains nothing and is
 *   skipped, not upscaled.
 * - Regenerates the full eligible set rather than only the new width. That is
 *   deliberate: AGL-1442 noted assets whose generation was interrupted, and a
 *   full pass is self-healing where a diff would preserve the gap. Output is
 *   deterministic, so rerunning is idempotent.
 * - `variants` on the document is REPLACED with what now exists, never merged,
 *   so a width that failed to save cannot be advertised.
 *
 * Credentials follow every other admin script here:
 * `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`.
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const WRITE = process.argv.includes('--write')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
if (!projectId || !clientEmail || !privateKey || !bucketName) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const bucket = getStorage().bucket(bucketName)

// The generator comes from the WORKSPACE SOURCE, loaded through jiti, so this
// script cannot drift from what the upload routes do. Not the `dist/` build:
// swc emits extensionless relative imports that raw Node ESM will not resolve.
const { default: createJiti } = await import('jiti')
// `@aglyn/*` aliases come from tsconfig.base.json, the same map the apps
// resolve through, so a remap there cannot silently break this script.
const { readFileSync } = await import('node:fs')
const { dirname, join, resolve: resolvePath } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
const tsPaths =
  JSON.parse(
    readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    ),
  ).compilerOptions?.paths ?? {}
// BOTH forms, longest-prefix first. The wildcard entries matter: jiti does
// prefix replacement, so mapping only `@aglyn/x` -> `.../src/index.ts` turns a
// subpath import like `@aglyn/x/y` into `.../src/index.ts/y`.
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
const srv = '../../libs/tenant/data/admin/src/lib/server'
const { mediaVariantWidthsFor, generateStoredMediaVariants } = jiti(
  `${srv}/media-variants.ts`,
)
const { MEDIA_CDN_VARIANT_WIDTHS } = jiti(
  '../../libs/aglyn/src/lib/app-utils/media-ref.ts',
)

console.log(
  `variant widths: [${[...MEDIA_CDN_VARIANT_WIDTHS].join(', ')}]  mode: ${
    WRITE ? 'WRITE' : 'report only'
  }`,
)

// Collection group, so `orgs/{id}/media` and `hosts/{id}/media` are both swept
// without hardcoding which scopes exist.
const snapshot = await firestore.collectionGroup('media').get()
console.log(`media documents: ${snapshot.size}`)

const plan = []
let skippedNonImage = 0
let skippedSvg = 0
let skippedNoPath = 0
let skippedComplete = 0
let skippedTooSmall = 0

for (const doc of snapshot.docs) {
  const d = doc.data()
  if (d.deletedAt) continue
  const contentType = String(d.contentType ?? '')
  const storagePath = d.storagePath
  if (!contentType.startsWith('image/')) { skippedNonImage++; continue }
  if (contentType === 'image/svg+xml') { skippedSvg++; continue }
  if (!storagePath) { skippedNoPath++; continue }

  const sourceWidth = d.dimensions?.width ?? null
  const eligible = mediaVariantWidthsFor({ contentType, sourceWidth })
  if (!eligible.length) { skippedTooSmall++; continue }

  const have = Array.isArray(d.variants) ? d.variants.map(Number) : []
  const missing = eligible.filter((w) => !have.includes(w))
  if (!missing.length) { skippedComplete++; continue }

  plan.push({
    ref: doc.ref,
    path: doc.ref.path,
    contentType,
    storagePath,
    sourceWidth,
    sizeBytes: Number(d.sizeBytes ?? 0),
    have,
    eligible,
    missing,
  })
}

console.log(
  `\nskipped: ${skippedNonImage} non-image, ${skippedSvg} svg, ` +
    `${skippedNoPath} no storagePath, ${skippedTooSmall} smaller than every width, ` +
    `${skippedComplete} already complete`,
)
console.log(`WOULD BACKFILL: ${plan.length}\n`)

if (!plan.length) process.exit(0)

const totalBytes = plan.reduce((a, p) => a + p.sizeBytes, 0)
console.log(`source bytes to fetch: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
for (const p of plan.slice(0, 15)) {
  console.log(
    `  ${p.path}  ${p.contentType}  src=${p.sourceWidth ?? '?'}w  ` +
      `${(p.sizeBytes / 1024).toFixed(0)}KB  have=[${p.have.join(',')}]  missing=[${p.missing.join(',')}]`,
  )
}
if (plan.length > 15) console.log(`  … and ${plan.length - 15} more`)

if (!WRITE) {
  console.log('\nREPORT ONLY. Nothing was written. Re-run with --write to apply.')
  process.exit(0)
}

let done = 0
let failed = 0
for (const p of plan.slice(0, LIMIT)) {
  const file = bucket.file(p.storagePath)
  const outcome = await generateStoredMediaVariants({
    contentType: p.contentType,
    sizeBytes: p.sizeBytes,
    sourceWidth: p.sourceWidth,
    objectPath: p.storagePath,
    readSource: async () => (await file.download())[0],
    // Identical to the upload routes: a variant url is content-addressed by
    // width and never changes, so it is immutable for a year.
    saveVariant: (path, webp) =>
      bucket.file(path).save(webp, {
        contentType: 'image/webp',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      }),
  })
  if (outcome.error) {
    failed++
    console.error(`  FAIL ${p.path} — ${outcome.error}`)
    // Recorded on the document the same way the upload path records it, so a
    // failure is a query rather than archaeology.
    await p.ref.set({ variantError: outcome.error }, { merge: true })
    continue
  }
  await p.ref.set(
    { variants: outcome.variants, variantError: null },
    { merge: true },
  )
  done++
  console.log(`  ok   ${p.path} -> [${outcome.variants.join(',')}]`)
}

console.log(`\nbackfilled ${done}, failed ${failed}`)
