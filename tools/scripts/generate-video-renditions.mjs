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
 * Produce compressed delivery renditions for DAM videos (AGL-2745).
 *
 *   node tools/scripts/generate-video-renditions.mjs                  # report
 *   node tools/scripts/generate-video-renditions.mjs --write
 *   node tools/scripts/generate-video-renditions.mjs --write --limit 3
 *   node tools/scripts/generate-video-renditions.mjs --write --webm
 *   node tools/scripts/generate-video-renditions.mjs --write --media orgs/ID/media/ID
 *
 * REPORT-ONLY IS THE DEFAULT, for the reason `backfill-media-variants.mjs`
 * states: this writes objects to the production bucket and mutates media
 * documents, and the shape of the corpus should be something you have READ
 * before it is something you have changed.
 *
 * ## Why a script and not a service
 *
 * Video is served origin-only by design (AGL-1515), so every play streams the
 * master through a Vercel function — Fast Origin Transfer plus Fast Data
 * Transfer, the largest non-build line on the bill. A 1080p master at ~8 Mbps
 * is ~60 MB of egress for a 60-second film; the 720p CRF-26 rendition this
 * produces is ~10-14 MB of it. That is the saving, and it is worth having.
 *
 * What it is NOT worth is a transcoder. The options were costed against a
 * $40/month on-demand budget before any of this was written:
 *
 * - **GCP Transcoder API** — $0.030 per output minute at HD, per output
 *   stream, no free tier. Trivial at ten videos a month; $300 at ten thousand.
 * - **Cloud Run + a static ffmpeg** — genuinely near-free (~$0.0026 per source
 *   minute, and the first ~2,000 minutes a month land inside the always-free
 *   tier), but a new deployable service: a container image, an Eventarc
 *   trigger, a service account, and a deploy path a Vercel promotion does not
 *   ship. New moving part, new failure mode.
 * - **Cloudflare Stream / Mux** — a $5-a-month floor and a second vendor, and
 *   both move delivery off this platform's own CDN, which is where the
 *   entitlement gate, the analytics day doc and the `media:` reference model
 *   all live.
 *
 * So the shape ships (the `videoRenditions` field and the CDN's `?r=`
 * selector) and the producer is a script, which is this repo's established
 * pattern for expensive media work — the 1920px variant pass is recorded in
 * `media-ref.ts` as "a script and not a patch (AGL-1442 S7)". When volume
 * justifies a service it drops in behind the SAME document shape and the SAME
 * URL, with no schema migration and no republish of any screen.
 *
 * ## Requirements
 *
 * `ffmpeg` and `ffprobe` on PATH (`brew install ffmpeg`). Credentials follow
 * every other admin script here: `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL`
 * / `FIREBASE_PRIVATE_KEY` / `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`.
 *
 * ## What it does and does not touch
 *
 * - Only `video/*`, and only a source TALLER than the target. Re-encoding a
 *   720p master to 720p spends CPU to produce a file that is not reliably
 *   smaller and is certainly not better.
 * - `videoRenditions` is REPLACED with what now exists, never merged, for the
 *   reason the variant backfill replaces `variants`: a rendition that failed
 *   to upload must not stay advertised.
 * - Backfills `video` (duration, width, height) from `ffprobe` when the
 *   document has none — every video uploaded before AGL-2742 is in that state,
 *   and the file is already on disk by then.
 * - Never touches the master object. A rendition is additive; deleting one
 *   returns the asset to serving its original, which is what it does today.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const run = promisify(execFile)

const WRITE = process.argv.includes('--write')
const WEBM = process.argv.includes('--webm')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity
const mediaArg = process.argv.indexOf('--media')
const ONLY = mediaArg > -1 ? String(process.argv[mediaArg + 1] ?? '') : ''

/**
 * The profiles produced, in the order a renderer should emit `<source>`
 * elements — a browser takes the first it can decode, so the most efficient
 * codec goes first.
 *
 * H.264 High at CRF 26 is the baseline every browser and every set-top box
 * has decoded for a decade, and `+faststart` is not optional: it relocates the
 * `moov` atom to the front of the file, without which a player must download
 * the whole thing before it can show a frame — which would spend the saving
 * this script exists to make.
 *
 * VP9/WebM is opt-in (`--webm`) rather than default. It is roughly 30% smaller
 * again and Safari has decoded it since 14, but it costs several times the
 * encode wall-clock and produces a second object per asset, and a second
 * object is a second thing to keep in step on every replace. AV1 is
 * deliberately absent: the quality-per-byte is better still and the encode is
 * slow enough (minutes per second of source, with libaom) that a manual pass
 * over a real library stops being practical.
 */
const PROFILES = [
  ...(WEBM
    ? [
        {
          key: '720p-vp9',
          ext: 'webm',
          contentType: 'video/webm',
          height: 720,
          args: (input, output) => [
            '-y', '-i', input,
            '-vf', 'scale=-2:720',
            '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1',
            '-c:a', 'libopus', '-b:a', '96k',
            output,
          ],
        },
      ]
    : []),
  {
    key: '720p',
    ext: 'mp4',
    contentType: 'video/mp4',
    height: 720,
    args: (input, output) => [
      '-y', '-i', input,
      '-vf', 'scale=-2:720',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ],
  },
]

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

// Checked BEFORE Firebase is touched: a missing encoder is the commonest way
// to run this by mistake, and discovering it after a 200 MB download is an
// expensive way to be told to `brew install ffmpeg`.
for (const binary of ['ffmpeg', 'ffprobe']) {
  try {
    await run(binary, ['-version'])
  } catch {
    console.error(`${binary} is not on PATH — brew install ffmpeg`)
    process.exit(1)
  }
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const bucket = getStorage().bucket(bucketName)

// The path grammar comes from the WORKSPACE SOURCE through jiti, so this
// script cannot mint an object path the CDN would not look for. Same
// discipline, and the same jiti alias construction, as
// `backfill-media-variants.mjs`.
const { default: createJiti } = await import('jiti')
const { readFileSync } = await import('node:fs')
const { dirname, resolve: resolvePath } = await import('node:path')
const { fileURLToPath } = await import('node:url')
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
const { mediaRenditionObjectPath, isMediaRenditionKey } = jiti(
  '../../libs/aglyn/src/lib/app-utils/media-ref.ts',
)

for (const profile of PROFILES) {
  if (!isMediaRenditionKey(profile.key)) {
    console.error(`profile key "${profile.key}" is not a valid rendition key`)
    process.exit(1)
  }
}

console.log(
  `profiles: [${PROFILES.map((p) => p.key).join(', ')}]  mode: ${
    WRITE ? 'WRITE' : 'report only'
  }`,
)

const snapshot = await firestore.collectionGroup('media').get()
console.log(`media documents: ${snapshot.size}`)

const plan = []
let skippedNonVideo = 0
let skippedNoPath = 0
let skippedComplete = 0
let skippedSmallSource = 0

for (const doc of snapshot.docs) {
  const d = doc.data()
  if (d.deletedAt) continue
  if (ONLY && doc.ref.path !== ONLY) continue
  const contentType = String(d.contentType ?? '')
  if (!contentType.startsWith('video/')) {
    skippedNonVideo++
    continue
  }
  if (!d.storagePath) {
    skippedNoPath++
    continue
  }
  // The document's own metadata when it has any (AGL-2742). A video uploaded
  // before that has none, and its real height is only knowable after the
  // download — so it is PLANNED and skipped later, by `ffprobe`, rather than
  // guessed at here.
  const sourceHeight = Number(d.video?.height ?? 0)
  const target = Math.max(...PROFILES.map((p) => p.height))
  if (sourceHeight && sourceHeight <= target) {
    skippedSmallSource++
    continue
  }
  const have = Array.isArray(d.videoRenditions)
    ? d.videoRenditions.map((r) => String(r?.key ?? ''))
    : []
  const missing = PROFILES.filter((p) => !have.includes(p.key))
  if (!missing.length) {
    skippedComplete++
    continue
  }
  plan.push({
    ref: doc.ref,
    path: doc.ref.path,
    contentType,
    storagePath: d.storagePath,
    sizeBytes: Number(d.sizeBytes ?? 0),
    hasVideoMeta: Boolean(d.video),
    missing,
  })
}

console.log(
  `\nskipped: ${skippedNonVideo} non-video, ${skippedNoPath} no storagePath, ` +
    `${skippedSmallSource} already at or below the target height, ` +
    `${skippedComplete} already complete`,
)
console.log(`WOULD ENCODE: ${plan.length}\n`)
if (!plan.length) process.exit(0)

const totalBytes = plan.reduce((a, p) => a + p.sizeBytes, 0)
console.log(
  `source bytes to fetch: ${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${plan.length} assets`,
)
for (const p of plan.slice(0, 15)) {
  console.log(
    `  ${p.path}  ${p.contentType}  ${(p.sizeBytes / 1024 / 1024).toFixed(1)} MB  ` +
      `→ [${p.missing.map((m) => m.key).join(', ')}]`,
  )
}
if (plan.length > 15) console.log(`  … and ${plan.length - 15} more`)
if (!WRITE) {
  console.log('\nreport only — rerun with --write to encode')
  process.exit(0)
}

/** `ffprobe` the one stream that matters. Returns null on anything odd. */
async function probe(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file,
    ])
    const parsed = JSON.parse(stdout)
    const stream = parsed.streams?.[0] ?? {}
    const width = Number(stream.width)
    const height = Number(stream.height)
    const durationMs = Math.round(Number(parsed.format?.duration) * 1000)
    if (!(width > 0) || !(height > 0)) return null
    return {
      width,
      height,
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
    }
  } catch {
    return null
  }
}

let encoded = 0
let failed = 0
for (const item of plan.slice(0, LIMIT)) {
  const workDir = await mkdtemp(join(tmpdir(), 'aglyn-rendition-'))
  const source = join(workDir, 'source')
  try {
    console.log(`\n${item.path}`)
    await bucket.file(item.storagePath).download({ destination: source })
    const probed = await probe(source)
    if (!probed) {
      console.log('  ffprobe could not read a video stream — skipped')
      failed++
      continue
    }
    console.log(`  source ${probed.width}x${probed.height}`)

    const renditions = []
    for (const profile of item.missing) {
      if (probed.height <= profile.height) {
        console.log(`  ${profile.key}: source is not taller than the target — skipped`)
        continue
      }
      const output = join(workDir, `out.${profile.ext}`)
      const started = Date.now()
      await run('ffmpeg', profile.args(source, output), {
        maxBuffer: 1024 * 1024 * 32,
      })
      const { size } = await stat(output)
      const objectPath = mediaRenditionObjectPath(item.storagePath, profile)
      await bucket.upload(output, {
        destination: objectPath,
        contentType: profile.contentType,
        metadata: {
          // The same immutable policy the WebP variants get. The object name
          // carries the rendition key, so a regenerated rendition overwrites
          // in place and the CDN's ETag — the MASTER's content hash plus the
          // representation tag — is what busts a client's copy.
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })
      renditions.push({
        key: profile.key,
        ext: profile.ext,
        contentType: profile.contentType,
        width: Math.round((probed.width * profile.height) / probed.height / 2) * 2,
        height: profile.height,
        sizeBytes: size,
      })
      console.log(
        `  ${profile.key}: ${(size / 1024 / 1024).toFixed(1)} MB ` +
          `(${((size / item.sizeBytes) * 100).toFixed(0)}% of source) ` +
          `in ${((Date.now() - started) / 1000).toFixed(0)}s`,
      )
    }
    if (!renditions.length) continue

    await item.ref.set(
      {
        // REPLACED, never merged — see the header. A key that failed to
        // upload above is simply not in this array, so it cannot stay
        // advertised on the document.
        videoRenditions: renditions,
        // Backfill the AGL-2742 metadata while the file is on disk. Only when
        // the document has none: a browser measured the display dimensions,
        // `ffprobe` reports the coded ones, and for anisotropic pixels those
        // differ — the browser's answer is the one a renderer should size to.
        ...(item.hasVideoMeta ? {} : { video: probed }),
      },
      { merge: true },
    )
    encoded++
  } catch (error) {
    failed++
    console.log(`  FAILED — ${error?.message ?? error}`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

console.log(`\nencoded ${encoded} asset(s), ${failed} failure(s)`)
