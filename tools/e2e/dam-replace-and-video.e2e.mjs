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

// The DAM end to end (AGL-2782): upload every family through the console's
// own input, publish a page that places each asset, then replace each one
// and follow the new bytes to every place the page references them.
//
// What it proves, in order:
//
// 1. An image, a PDF, a film and a CSV upload through the library. The film
//    arrives with a duration, a frame size and a poster frame, which only the
//    uploader's browser can produce (AGL-2742).
// 2. The published page ships what it should: a poster-only lightbox trigger,
//    an inline player that preloads nothing, links to the documents, and a
//    VideoObject for the one film that carries its SEO fields and for no
//    other (AGL-2741, AGL-2744, AGL-2747).
// 3. The media CDN answers every representation correctly: the poster is an
//    edge-cacheable image, a missing poster is a 404 and never the film, a
//    recorded rendition is served when asked for and negotiated for `?r=auto`,
//    and byte ranges work (AGL-2743, AGL-2753).
// 4. The lightbox downloads no dialog code and no film bytes until a visitor
//    approaches it, opens by click, Enter and Space, is named, traps focus,
//    closes on Escape and on its button, and hands focus back (AGL-2744).
// 5. Replace keeps the asset id and swaps the bytes behind every reference
//    for every family; a pinned reference publishes the stable URL, so the
//    page names nothing a replace cannot reach (AGL-2798); the old
//    content-hashed URL redirects instead of 404ing; the video's poster is
//    regenerated and its stale rendition is dropped (AGL-2732, AGL-2685).
// 6. The storage band refuses a signed replace when it is MINTED, and still
//    mints one that fits (AGL-2732).
// 7. The collector counts one play per play beacon, and nothing else.
//
// Prerequisites (docs/E2E_LOCAL.md): the Auth, Firestore AND Storage
// emulators, `npm run seed:e2e`, a console dev server (E2E_BASE_URL) and a
// tenant dev server on :4500 (E2E_TENANT_URL), both carrying
// FIREBASE_STORAGE_EMULATOR_HOST. E2E_STORAGE_BUCKET names the bucket the two
// servers use. Nothing is uploaded until the script has proved that both
// servers read that bucket from the emulator.
//
//   npm run e2e:dam

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { putMediaDocument } from '../scripts/lib/media-counter.mjs'
import {
  adminFirestore,
  BASE_URL,
  chromeExecutable,
  HOST_ID,
  hostUrl,
  idTokenFor,
  openConsole,
  ORG_ID,
  OWNER_UID,
  repoRoot,
  step,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const TENANT_URL = process.env.E2E_TENANT_URL ?? 'http://localhost:4500'
const BUCKET =
  process.env.E2E_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ''
const MB = 1024 * 1024
const RUN = Date.now().toString(36)
const FILM_TITLE = 'E2E tour film'
const TRIGGER_LABEL = `Play video: ${FILM_TITLE}`
/** The stable URL's policy for an edge-cacheable (image) response. */
const STABLE_IMAGE_CACHE = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'

/**
 * The tenant's `REVALIDATE_SECRET`. The tenant caches a host's routing map for
 * an hour and a publish busts it through `/api/revalidate`; a screen written
 * without that bust stays a 404 until the hour is up.
 */
const REVALIDATE_SECRET =
  process.env.E2E_REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET ?? ''

if (!BUCKET) {
  console.error('E2E_STORAGE_BUCKET is required — the bucket name the console and tenant servers use.')
  process.exit(2)
}
if (!REVALIDATE_SECRET) {
  console.error(
    'E2E_REVALIDATE_SECRET is required — the REVALIDATE_SECRET the tenant server was started with. ' +
      'A published screen is not routable until the host document cache is busted.',
  )
  process.exit(2)
}
// Set BEFORE the first `getStorage()`, which is when firebase-admin reads it:
// this script's own Storage calls can then only ever reach the emulator.
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? 'localhost:9199'

const firestore = adminFirestore()
const bucket = getStorage().bucket(BUCKET)
const tally = verdicts()
const work = mkdtempSync(join(tmpdir(), 'aglyn-e2e-dam-'))

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const media = () => firestore.collection('hosts').doc(HOST_ID).collection('media')
const cdnPath = (id, suffix = '') => `/api/media/cdn/${HOST_ID}/${id}${suffix}`

/** A GET that never follows a redirect, with the body in hand. */
async function get(url, headers = {}, redirect = 'manual') {
  const response = await fetch(url, { headers, redirect })
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer()),
  }
}

/** One console API call as the seeded owner, from Node rather than the page. */
async function callConsole(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idTokenFor(OWNER_UID)}`,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

/**
 * What the console's publish does once the documents are written: drop the
 * tenant's cached host document (the routing map) and the named pages.
 */
async function revalidateTenant(paths) {
  const response = await fetch(`${TENANT_URL}/api/revalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': REVALIDATE_SECRET },
    body: JSON.stringify({ host: HOST_ID, hostId: HOST_ID, paths }),
  })
  if (response.status !== 200) {
    throw new Error(`tenant /api/revalidate answered ${response.status} ${await response.text()}`)
  }
}

/** A step with no page behind it: a throw is a FAIL, never an abort. */
async function apiStep(name, body) {
  try {
    await body()
  } catch (error) {
    tally.fail(name, String(error?.message ?? error).split('\n')[0])
  }
}

async function docByName(fileName) {
  const snapshot = await media().where('fileName', '==', fileName).get()
  return snapshot.docs[0] ?? null
}

async function objectBytes(path) {
  const [bytes] = await bucket.file(path).download()
  return bytes
}

/** A one-page PDF whose text differs per version, so its hash does too. */
function pdf(text) {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

const solidPng = (r, g, b) =>
  sharp({ create: { width: 1400, height: 800, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer()

/** Writes one fixture into the scratch directory and returns its facts. */
function fixture(name, bytes) {
  const path = join(work, name)
  writeFileSync(path, bytes)
  return { name, path, bytes, sha: sha(bytes) }
}

const filmA = readFileSync(join(repoRoot, 'tools', 'e2e', 'fixtures', 'dam-film-a.mp4'))
const filmB = readFileSync(join(repoRoot, 'tools', 'e2e', 'fixtures', 'dam-film-b.mp4'))
const files = {
  image: {
    a: fixture(`e2e-dam-${RUN}-image.png`, await solidPng(210, 40, 40)),
    b: fixture(`e2e-dam-${RUN}-image-v2.png`, await solidPng(40, 70, 210)),
  },
  pdf: {
    a: fixture(`e2e-dam-${RUN}-guidelines.pdf`, pdf('Brand guidelines, first edition')),
    b: fixture(`e2e-dam-${RUN}-guidelines-v2.pdf`, pdf('Brand guidelines, second edition')),
  },
  film: {
    a: fixture(`e2e-dam-${RUN}-film.mp4`, filmA),
    b: fixture(`e2e-dam-${RUN}-film-v2.mp4`, filmB),
  },
  sheet: {
    a: fixture(`e2e-dam-${RUN}-prices.csv`, Buffer.from('sku,name,price\n1,Sourdough,9\n')),
    b: fixture(`e2e-dam-${RUN}-prices-v2.csv`, Buffer.from('sku,name,price\n1,Sourdough,10\n2,Rye,8\n')),
  },
}

/*==========================================
 * 0. PREFLIGHT — refuse to upload anything to a server that is not reading
 *    Storage from the emulator.
 *=========================================*/

const PREFLIGHT_ID = `e2e-dam-preflight`
{
  const path = `hosts/${HOST_ID}/media/${PREFLIGHT_ID}`
  const bytes = await solidPng(20, 160, 90)
  await bucket.file(path).save(bytes, { contentType: 'image/png' })
  // Through the shared writer, so the site's `counters/media` moves with the
  // document it counts, as it does for every other media document a script
  // mints (AGL-1488).
  await putMediaDocument({
    firestore,
    scopeRef: firestore.collection('hosts').doc(HOST_ID),
    mediaId: PREFLIGHT_ID,
    data: {
      fileName: 'e2e-dam-preflight.png',
      contentType: 'image/png',
      sizeBytes: bytes.length,
      storagePath: path,
      contentHash: sha(bytes).slice(0, 16),
      cdnPath: cdnPath(PREFLIGHT_ID),
      variants: [],
      createdAt: FieldValue.serverTimestamp(),
    },
  })
  for (const [label, origin] of [
    ['console', BASE_URL],
    ['tenant', TENANT_URL],
  ]) {
    const served = await get(`${origin}${cdnPath(PREFLIGHT_ID)}`).catch((error) => ({
      status: `unreachable (${error.message})`,
      body: Buffer.alloc(0),
    }))
    if (served.status !== 200 || sha(served.body) !== sha(bytes)) {
      console.error(
        `REFUSED — the ${label} server at ${origin} did not serve an object that exists only in the ` +
          `Storage emulator (status ${served.status}). Start it with FIREBASE_STORAGE_EMULATOR_HOST and ` +
          `E2E_STORAGE_BUCKET=${BUCKET}; uploading now could write to a real bucket.`,
      )
      process.exit(2)
    }
  }
  tally.pass('both servers read Storage from the emulator', `${BUCKET} via ${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`)
  try {
    await revalidateTenant(['/'])
  } catch (error) {
    console.error(`REFUSED — ${error.message}. Start the tenant with REVALIDATE_SECRET and pass the same value as E2E_REVALIDATE_SECRET.`)
    process.exit(2)
  }
}

/*==========================================
 * 1. UPLOAD — every family, through the library's own input.
 *=========================================*/

const session = await openConsole()
const { page } = session
const ids = {}
const before = {}

await step(tally, page, 'the library uploads an image, a PDF, a film and a CSV', async () => {
  await page.goto(hostUrl('/media'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Upload media' }).first().waitFor({ timeout: TIMEOUT_MS })
  await page.setInputFiles('input[type="file"][multiple]', [
    files.image.a.path,
    files.pdf.a.path,
    files.film.a.path,
    files.sheet.a.path,
  ])
  for (const family of ['image', 'pdf', 'film', 'sheet']) {
    const doc = await waitFor(() => docByName(files[family].a.name), Boolean, { timeoutMs: TIMEOUT_MS * 2 })
    ids[family] = doc.id
    before[family] = doc.data()
  }
  const sizes = Object.entries(ids).map(([family, id]) => `${family}=${id}`)
  tally.check(
    'the library uploads an image, a PDF, a film and a CSV',
    ['image', 'pdf', 'film', 'sheet'].every(
      (family) =>
        before[family].sizeBytes === files[family].a.bytes.length &&
        before[family].cdnPath === cdnPath(ids[family]) &&
        /^[0-9a-f]{16}$/.test(String(before[family].contentHash)),
    ),
    sizes.join(' '),
  )
})

await apiStep('the film arrives with its duration, frame size and a poster frame', async () => {
  const film = before.film
  if (!film) throw new Error('no film document to inspect')
  const posterExists = (await bucket.file(`${film.storagePath}__poster.webp`).exists())[0]
  tally.check(
    'the film arrives with its duration, frame size and a poster frame',
    Math.abs(Number(film.video?.durationMs) - 2000) <= 150 &&
      film.video?.width === 640 &&
      film.video?.height === 360 &&
      Number(film.poster?.width) > 0 &&
      Array.isArray(film.poster?.variants) &&
      posterExists,
    JSON.stringify({ video: film.video, poster: film.poster, posterError: film.posterError, posterExists }),
  )
})

await apiStep('an image gets its WebP variants', async () => {
  const image = before.image
  tally.check(
    'an image gets its WebP variants',
    Array.isArray(image?.variants) && image.variants.includes(640) && image.width === 1400,
    JSON.stringify({ variants: image?.variants, width: image?.width, height: image?.height }),
  )
})

/*==========================================
 * 2. PUBLISH — a page placing every asset, and a page whose film has no SEO
 *    fields.
 *=========================================*/

const pageSlug = `e2e-dam-${RUN}`
const bareSlug = `e2e-dam-bare-${RUN}`

async function publish(screenId, slug, children) {
  const screen = firestore.collection('hosts').doc(HOST_ID).collection('screens').doc(screenId)
  const versionId = `${screenId}-v1`
  const nodes = {
    '_@_': { $id: '_@_', componentId: 'root', nodes: ['page'] },
    page: {
      $id: 'page',
      componentId: 'muiContainer',
      parentId: '_@_',
      nodes: Object.keys(children),
      props: { maxWidth: 'md' },
    },
  }
  for (const [id, node] of Object.entries(children)) nodes[id] = { $id: id, parentId: 'page', ...node }
  await screen.collection('versions').doc(versionId).set({
    screenId,
    nodes,
    createdAt: FieldValue.serverTimestamp(),
  })
  await screen.set({
    displayName: slug,
    slug,
    versionId,
    createdAt: FieldValue.serverTimestamp(),
  })
  // The tenant resolves a path through the host's `screens` map, not the
  // screen document's own slug — a screen missing from it is a 404.
  await firestore
    .collection('hosts')
    .doc(HOST_ID)
    .set({ screens: { [screenId]: slug } }, { merge: true })
}

if (ids.film && ids.image && ids.pdf && ids.sheet) {
  await publish(`e2e-dam-${RUN}`, pageSlug, {
    photo: { componentId: 'image', props: { src: `media:${HOST_ID}/${ids.image}`, alt: 'E2E photo' } },
    tour: {
      componentId: 'video',
      props: {
        src: `media:${HOST_ID}/${ids.film}`,
        posterFromSource: true,
        lightbox: true,
        title: FILM_TITLE,
        description: 'The DAM end-to-end film.',
        uploadDate: '2026-09-10',
        durationSeconds: 2,
        intrinsicWidth: 640,
        intrinsicHeight: 360,
      },
    },
    inline: {
      componentId: 'video',
      props: {
        // PINNED to the upload's hash. The page must still name the stable
        // URL for it: the content-hashed one is what an edge keeps for a
        // year (AGL-2798).
        src: `media:${HOST_ID}/${ids.film}@${before.film.contentHash}`,
        posterFromSource: true,
        title: 'E2E inline film',
      },
    },
    guidelines: {
      componentId: 'muiButton',
      props: { children: 'Brand guidelines', href: cdnPath(ids.pdf) },
    },
    prices: {
      componentId: 'muiButton',
      props: { children: 'Price list', href: cdnPath(ids.sheet) },
    },
  })
  await publish(`e2e-dam-bare-${RUN}`, bareSlug, {
    film: {
      componentId: 'video',
      props: { src: `media:${HOST_ID}/${ids.film}`, posterFromSource: true, title: 'No description' },
    },
  })
  await revalidateTenant([`/${pageSlug}`, `/${bareSlug}`])
}

/** The page's HTML, once the dev server has compiled the route. */
async function pageHtml(slug) {
  const { body } = await waitFor(
    () => get(`${TENANT_URL}/${slug}`).catch(() => ({ status: 0, body: Buffer.alloc(0) })),
    (response) => response.status === 200,
    { timeoutMs: Math.max(TIMEOUT_MS, 180_000), everyMs: 2000 },
  )
  return body.toString('utf8')
}

const videoObjects = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((match) => {
      try {
        const value = JSON.parse(match[1])
        return Array.isArray(value) ? value : value?.['@graph'] ?? [value]
      } catch {
        return []
      }
    })
    .filter((entry) => entry?.['@type'] === 'VideoObject')

const attr = (html) => html.replace(/&amp;/g, '&')

await apiStep('the published page ships a poster-only trigger, an idle inline player and the document links', async () => {
  const raw = await pageHtml(pageSlug)
  const html = attr(raw)
  const inlineVideo = html.match(/<video[^>]*>/)?.[0] ?? ''
  const checks = {
    image: html.includes(`src="${cdnPath(ids.image)}"`),
    trigger: html.includes(`aria-label="${TRIGGER_LABEL}"`),
    triggerPoster: html.includes(`src="${cdnPath(ids.film)}?poster=1"`),
    // The pinned inline film publishes the stable URL, and the page names the
    // content-hashed one nowhere (AGL-2798).
    inlinePinnedRendersStable: inlineVideo.includes(`src="${cdnPath(ids.film)}?r=auto"`),
    noContentHashedUrl: !html.includes(cdnPath(ids.film, `/${before.film.contentHash}`)),
    inlinePreloadNone: inlineVideo.includes('preload="none"'),
    pdfLink: html.includes(`href="${cdnPath(ids.pdf)}"`),
    csvLink: html.includes(`href="${cdnPath(ids.sheet)}"`),
    noDialogInHtml: !html.includes('Close video'),
  }
  tally.check(
    'the published page ships a poster-only trigger, an idle inline player and the document links',
    Object.values(checks).every(Boolean),
    JSON.stringify(checks),
  )
})

await apiStep('a VideoObject is published for the film that carries its fields, and no other', async () => {
  const blocks = videoObjects(await pageHtml(pageSlug))
  const bare = videoObjects(await pageHtml(bareSlug))
  const [block] = blocks
  tally.check(
    'a VideoObject is published for the film that carries its fields, and no other',
    blocks.length === 1 &&
      block.name === FILM_TITLE &&
      block.uploadDate === '2026-09-10' &&
      block.duration === 'PT2S' &&
      String(block.thumbnailUrl).endsWith(`${cdnPath(ids.film)}?poster=1&w=1280`) &&
      String(block.contentUrl).endsWith(cdnPath(ids.film)) &&
      bare.length === 0,
    `page=${JSON.stringify(blocks)} bare=${bare.length}`,
  )
})

/*==========================================
 * 3. THE MEDIA CDN — every representation.
 *=========================================*/

const tenantCdn = (id, suffix = '') => `${TENANT_URL}${cdnPath(id, suffix)}`
const renditionBytes = Buffer.concat([filmA, Buffer.from('e2e-rendition')])
let posterBefore = null

await apiStep('the poster is an edge-cacheable image with its own validator', async () => {
  const poster = await get(tenantCdn(ids.film, '?poster=1'))
  const narrow = await get(tenantCdn(ids.film, '?poster=1&w=320'))
  posterBefore = poster.body
  tally.check(
    'the poster is an edge-cacheable image with its own validator',
    poster.status === 200 &&
      poster.headers.get('content-type') === 'image/webp' &&
      poster.headers.get('cache-control') === STABLE_IMAGE_CACHE &&
      poster.headers.get('etag') === `"${before.film.contentHash}-poster"` &&
      narrow.status === 200 &&
      narrow.headers.get('content-type') === 'image/webp',
    `poster ${poster.status} ${poster.headers.get('content-type')} "${poster.headers.get('cache-control')}" ${poster.headers.get('etag')} ${poster.body.length} B; w=320 ${narrow.status} ${narrow.headers.get('etag')}`,
  )
})

await apiStep('a film with no poster answers 404 for its poster, never the film', async () => {
  const uploaded = await callConsole('POST', '/api/media/upload', {
    hostId: HOST_ID,
    fileName: `e2e-dam-${RUN}-unpostered.mp4`,
    contentType: 'video/mp4',
    data: filmA.toString('base64'),
  })
  if (uploaded.status !== 200) throw new Error(`upload ${uploaded.status} ${JSON.stringify(uploaded.body)}`)
  const response = await get(tenantCdn(uploaded.body.mediaId, '?poster=1'))
  tally.check(
    'a film with no poster answers 404 for its poster, never the film',
    response.status === 404 &&
      response.headers.get('cache-control') === 'private, no-store' &&
      !String(response.headers.get('content-type')).startsWith('video/') &&
      response.body.length < 200,
    `${response.status} "${response.headers.get('cache-control')}" ${response.headers.get('content-type')} ${response.body.toString('utf8').slice(0, 80)}`,
  )
})

await apiStep('with no renditions, r=auto serves the master, private, varying on Accept', async () => {
  const response = await get(tenantCdn(ids.film, '?r=auto'), { accept: '*/*' })
  tally.check(
    'with no renditions, r=auto serves the master, private, varying on Accept',
    response.status === 200 &&
      response.headers.get('content-type') === 'video/mp4' &&
      response.headers.get('cache-control') === 'private, max-age=60' &&
      String(response.headers.get('vary')).includes('Accept') &&
      sha(response.body) === files.film.a.sha,
    `${response.status} ${response.headers.get('content-type')} "${response.headers.get('cache-control')}" vary=${response.headers.get('vary')}`,
  )
})

await apiStep('a byte range on the film is a 206 with an exact Content-Range', async () => {
  const response = await get(tenantCdn(ids.film), { range: 'bytes=0-99' })
  tally.check(
    'a byte range on the film is a 206 with an exact Content-Range',
    response.status === 206 &&
      response.headers.get('content-range') === `bytes 0-99/${filmA.length}` &&
      response.body.length === 100,
    `${response.status} ${response.headers.get('content-range')} ${response.body.length} B`,
  )
})

await apiStep('a recorded rendition is served by key and negotiated for r=auto', async () => {
  // What `generate-video-renditions.mjs` leaves behind: an object beside the
  // master and an entry on the document. Distinct bytes, so the answer shows
  // which file was served.
  await bucket.file(`${before.film.storagePath}__r720p.mp4`).save(renditionBytes, { contentType: 'video/mp4' })
  // A patch of the uploaded film's document: `update`, which cannot mint a
  // media document, so a film that never arrived fails here instead.
  await media().doc(ids.film).update({
    videoRenditions: [
      { key: '720p', ext: 'mp4', contentType: 'video/mp4', width: 1280, height: 720, sizeBytes: renditionBytes.length },
    ],
  })
  const byKey = await get(tenantCdn(ids.film, '?r=720p'))
  const wildcard = await get(tenantCdn(ids.film, '?r=auto'), { accept: '*/*' })
  const webm = await get(tenantCdn(ids.film, '?r=auto'), { accept: 'video/webm' })
  tally.check(
    'a recorded rendition is served by key and negotiated for r=auto',
    byKey.status === 200 &&
      sha(byKey.body) === sha(renditionBytes) &&
      byKey.headers.get('etag') === `"${before.film.contentHash}-r720p"` &&
      byKey.headers.get('cache-control') === 'private, max-age=60' &&
      sha(wildcard.body) === sha(renditionBytes) &&
      sha(webm.body) === sha(renditionBytes),
    `key ${byKey.status} ${byKey.headers.get('etag')} "${byKey.headers.get('cache-control')}"; */* ${sha(wildcard.body) === sha(renditionBytes) ? 'rendition' : 'master'}; video/webm ${sha(webm.body) === sha(renditionBytes) ? 'mp4 baseline' : 'other'}`,
  )
})

/*==========================================
 * 4. THE LIGHTBOX, on the published page, as a visitor.
 *=========================================*/

{
  const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
  const visitor = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const scripts = []
  const filmRequests = []
  let phase = 'load'
  visitor.on('response', (response) => {
    if (response.request().resourceType() === 'script') scripts.push({ phase, response })
  })
  visitor.on('request', (request) => {
    const url = request.url()
    if (url.includes(cdnPath(ids.film)) && !url.includes('poster=1')) filmRequests.push({ phase, url })
  })
  const dialog = visitor.getByRole('dialog', { name: FILM_TITLE })
  const trigger = visitor.getByRole('button', { name: TRIGGER_LABEL })
  const focusLabel = () => visitor.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  const focusInsideModal = () =>
    visitor.evaluate(() => Boolean(document.activeElement?.closest('.MuiDialog-root')))
  /** Whether a script body delivered in `phases` carries the dialog module. */
  const dialogCodeIn = async (phases) => {
    for (const { phase: at, response } of scripts) {
      if (!phases.includes(at)) continue
      const body = await response.text().catch(() => '')
      if (body.includes('Close video')) return true
    }
    return false
  }

  await step(tally, visitor, 'the page loads the poster and neither the dialog code nor the film', async () => {
    await visitor.goto(`${TENANT_URL}/${pageSlug}`, { waitUntil: 'load', timeout: Math.max(TIMEOUT_MS, 180_000) })
    await trigger.waitFor({ timeout: TIMEOUT_MS })
    await visitor.waitForTimeout(3000)
    const dialogCode = await dialogCodeIn(['load'])
    tally.check(
      'the page loads the poster and neither the dialog code nor the film',
      !dialogCode && filmRequests.length === 0 && (await dialog.count()) === 0,
      `dialog code at load=${dialogCode}, film requests=${filmRequests.length}, scripts=${scripts.length}`,
    )
  })

  await step(tally, visitor, 'approaching the trigger by keyboard fetches the dialog code and still no film', async () => {
    phase = 'armed'
    for (let presses = 0; presses < 25 && (await focusLabel()) !== TRIGGER_LABEL; presses += 1) {
      await visitor.keyboard.press('Tab')
    }
    const focused = (await focusLabel()) === TRIGGER_LABEL
    const loaded = await waitFor(() => dialogCodeIn(['armed']), Boolean, { timeoutMs: 60_000, everyMs: 500 }).catch(() => false)
    tally.check(
      'approaching the trigger by keyboard fetches the dialog code and still no film',
      focused && loaded && filmRequests.length === 0 && (await dialog.count()) === 0,
      `focused=${focused} dialogCode=${loaded} film=${filmRequests.length}`,
    )
  })

  await step(tally, visitor, 'Enter opens a named dialog that takes focus and starts the film', async () => {
    phase = 'open'
    await visitor.keyboard.press('Enter')
    await dialog.waitFor({ timeout: TIMEOUT_MS })
    await waitFor(async () => filmRequests.filter((entry) => entry.phase === 'open').length, (n) => n > 0, { timeoutMs: 30_000 })
    const inside = await focusInsideModal()
    const outsideHidden = await visitor.evaluate(() =>
      [...document.body.children].some(
        (element) => !element.classList.contains('MuiDialog-root') && element.getAttribute('aria-hidden') === 'true',
      ),
    )
    tally.check(
      'Enter opens a named dialog that takes focus and starts the film',
      inside && outsideHidden,
      `focus inside=${inside}, page aria-hidden=${outsideHidden}, film requests=${filmRequests.map((entry) => entry.url.replace(TENANT_URL, '')).join(' ')}`,
    )
  })

  await step(tally, visitor, 'Tab cannot leave the open dialog', async () => {
    let escaped = 0
    for (let presses = 0; presses < 8; presses += 1) {
      await visitor.keyboard.press('Tab')
      if (!(await focusInsideModal())) escaped += 1
    }
    tally.check('Tab cannot leave the open dialog', escaped === 0, `${escaped} of 8 presses left the dialog`)
  })

  const closeButton = visitor.getByRole('button', { name: 'Close video' })

  await step(tally, visitor, 'Escape from the close button closes it, removes the player and returns focus to the trigger', async () => {
    await closeButton.focus()
    await visitor.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 10_000 })
    const label = await focusLabel()
    const players = await visitor.evaluate(() => document.querySelectorAll('.MuiDialog-root video').length)
    tally.check(
      'Escape from the close button closes it, removes the player and returns focus to the trigger',
      label === TRIGGER_LABEL && players === 0,
      `focus="${label}" players left=${players}`,
    )
  })

  await step(tally, visitor, 'Space reopens it', async () => {
    if ((await focusLabel()) !== TRIGGER_LABEL) await trigger.focus()
    await visitor.keyboard.press('Space')
    await dialog.waitFor({ timeout: TIMEOUT_MS })
    tally.pass('Space reopens it', `aria-label="${await dialog.getAttribute('aria-label')}"`)
  })

  await step(tally, visitor, "Escape closes it from inside the player's native controls (AGL-2802)", async () => {
    // From the close button, one Tab reaches the <video> and the next lands in
    // Chrome's own media controls. Measured: from there no keydown or keyup
    // for Escape reaches the page in any phase, so no page listener can close
    // the dialog (AGL-2802). Closed with the button afterwards either way, so
    // the steps below start from a closed dialog.
    await closeButton.focus()
    await visitor.keyboard.press('Tab')
    await visitor.keyboard.press('Tab')
    await visitor.keyboard.press('Escape')
    const closed = await dialog
      .waitFor({ state: 'detached', timeout: 10_000 })
      .then(() => true, () => false)
    if (!closed) {
      await closeButton.click()
      await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
    }
    tally.check(
      "Escape closes it from inside the player's native controls (AGL-2802)",
      closed,
      closed ? 'closed' : 'still open with focus in the native controls; closed with the close button instead',
    )
  })

  await step(tally, visitor, 'a click opens it again and the close button closes it', async () => {
    await trigger.click()
    await dialog.waitFor({ timeout: TIMEOUT_MS })
    const named = await dialog.getAttribute('aria-label')
    await closeButton.click()
    await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
    const label = await focusLabel()
    tally.check(
      'a click opens it again and the close button closes it',
      named === FILM_TITLE && label === TRIGGER_LABEL,
      `aria-label="${named}" focus="${label}"`,
    )
  })

  await browser.close()
}

/*==========================================
 * 5. REPLACE — every family, through the card's own menu.
 *=========================================*/

async function replaceThroughCard(fileName, replacementPath) {
  await page.goto(hostUrl('/media'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const label = page.getByText(fileName, { exact: true }).first()
  await label.waitFor({ timeout: TIMEOUT_MS })
  const card = label.locator('xpath=ancestor::*[.//button[@aria-label="File actions"]][1]')
  await card.getByRole('button', { name: 'File actions' }).click()
  const chooser = page.waitForEvent('filechooser', { timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: 'Replace file' }).click()
  await (await chooser).setFiles(replacementPath)
}

const after = {}
const variantBefore = ids.image ? (await get(tenantCdn(ids.image, '?w=640'))).body : Buffer.alloc(0)

for (const family of ['image', 'pdf', 'film', 'sheet']) {
  const name = `replacing the ${family} keeps its id and serves the new bytes at its stable URL`
  await step(tally, page, name, async () => {
    await replaceThroughCard(files[family].a.name, files[family].b.path)
    const snapshot = await waitFor(
      () => media().doc(ids[family]).get(),
      (doc) => doc.get('contentHash') && doc.get('contentHash') !== before[family].contentHash,
      { timeoutMs: TIMEOUT_MS * 2 },
    )
    after[family] = snapshot.data()
    const stable = await get(tenantCdn(ids[family]))
    const sameIdOnly = (await media().where('fileName', '==', files[family].a.name).get()).size === 1
    tally.check(
      name,
      snapshot.id === ids[family] &&
        sameIdOnly &&
        after[family].cdnPath === before[family].cdnPath &&
        after[family].url !== before[family].url &&
        after[family].sizeBytes === files[family].b.bytes.length &&
        after[family].replacedBy === OWNER_UID &&
        stable.status === 200 &&
        sha(stable.body) === files[family].b.sha,
      `hash ${before[family].contentHash} → ${after[family].contentHash}, stable ${stable.status} ${sha(stable.body) === files[family].b.sha ? 'new bytes' : 'OLD bytes'}`,
    )
  })

  await apiStep(`the ${family}'s old content-hashed URL redirects to the stable URL`, async () => {
    const stale = await get(tenantCdn(ids[family], `/${before[family].contentHash}?w=640&junk=1`))
    const followed = await get(tenantCdn(ids[family], `/${before[family].contentHash}`), {}, 'follow')
    tally.check(
      `the ${family}'s old content-hashed URL redirects to the stable URL`,
      stale.status === 302 &&
        stale.headers.get('location') === `${cdnPath(ids[family])}?w=640` &&
        followed.status === 200 &&
        sha(followed.body) === files[family].b.sha,
      `${stale.status} → ${stale.headers.get('location')}; followed ${followed.status}`,
    )
  })
}

await apiStep('the replaced image regenerated its variants', async () => {
  const variant = await get(tenantCdn(ids.image, '?w=640'))
  tally.check(
    'the replaced image regenerated its variants',
    after.image?.variants?.includes(640) &&
      variant.status === 200 &&
      variant.headers.get('content-type') === 'image/webp' &&
      sha(variant.body) !== sha(variantBefore),
    `variants=${JSON.stringify(after.image?.variants)} w640 ${variant.status} ${sha(variant.body) === sha(variantBefore) ? 'UNCHANGED' : 'new'}`,
  )
})

await apiStep('the replaced film has a new poster, new metadata and no stale rendition', async () => {
  const film = after.film
  const poster = await get(tenantCdn(ids.film, '?poster=1'))
  const renditionGone = !(await bucket.file(`${film.storagePath}__r720p.mp4`).exists())[0]
  const byKey = await get(tenantCdn(ids.film, '?r=720p'))
  const posterObject = await objectBytes(`${film.storagePath}__poster.webp`)
  tally.check(
    'the replaced film has a new poster, new metadata and no stale rendition',
    Math.abs(Number(film.video?.durationMs) - 3000) <= 150 &&
      film.videoRenditions === undefined &&
      renditionGone &&
      poster.status === 200 &&
      sha(poster.body) === sha(posterObject) &&
      posterBefore !== null &&
      sha(poster.body) !== sha(posterBefore) &&
      poster.headers.get('etag') === `"${film.contentHash}-poster"` &&
      sha(byKey.body) === files.film.b.sha,
    `duration=${film.video?.durationMs} renditions=${JSON.stringify(film.videoRenditions)} objectGone=${renditionGone} poster ${sha(poster.body) === sha(posterBefore ?? Buffer.alloc(0)) ? 'OLD' : 'new'} r=720p ${sha(byKey.body) === files.film.b.sha ? 'master (new film)' : 'STALE'}`,
  )
})

await apiStep('every reference on the published page now resolves to the new bytes', async () => {
  const html = attr(await pageHtml(pageSlug))
  const inlineVideo = html.match(/<video[^>]*>/)?.[0] ?? ''
  const inlineSrc = inlineVideo.match(/ src="([^"]+)"/)?.[1] ?? ''
  const inlinePoster = inlineVideo.match(/ poster="([^"]+)"/)?.[1] ?? ''
  const posterObject = await objectBytes(`${after.film.storagePath}__poster.webp`)
  const follow = async (path) => get(`${TENANT_URL}${path}`, {}, 'follow')
  const results = {
    image: sha((await follow(cdnPath(ids.image))).body) === files.image.b.sha,
    lightboxPoster: sha((await follow(`${cdnPath(ids.film)}?poster=1`)).body) === sha(posterObject),
    // The pinned inline film's URL did not change with the replace, and needs
    // no hop to reach the new film (AGL-2798).
    inlineStableSrc: inlineSrc === `${cdnPath(ids.film)}?r=auto`,
    inlineFilm: sha((await follow(inlineSrc)).body) === files.film.b.sha,
    inlinePoster: (await follow(inlinePoster)).headers.get('content-type') === 'image/webp',
    pdf: sha((await follow(html.match(new RegExp(`href="(${cdnPath(ids.pdf)})"`))?.[1] ?? '/missing')).body) === files.pdf.b.sha,
    csv: sha((await follow(html.match(new RegExp(`href="(${cdnPath(ids.sheet)})"`))?.[1] ?? '/missing')).body) === files.sheet.b.sha,
  }
  tally.check(
    'every reference on the published page now resolves to the new bytes',
    Object.values(results).every(Boolean),
    JSON.stringify(results),
  )
})

await apiStep('a replace across families is refused', async () => {
  const response = await callConsole('POST', '/api/media/replace', {
    hostId: HOST_ID,
    mediaId: ids.pdf,
    fileName: 'not-a-pdf.png',
    contentType: 'image/png',
    data: files.image.a.bytes.toString('base64'),
  })
  tally.check(
    'a replace across families is refused',
    response.status === 415 && /same kind/.test(String(response.body.error)),
    `${response.status} ${response.body.error}`,
  )
})

/*==========================================
 * 6. THE STORAGE BAND, at signed-replace MINT time.
 *=========================================*/

await apiStep('the band refuses a signed replace at mint and still mints one that fits', async () => {
  const orgCounter = firestore.collection('orgs').doc(ORG_ID).collection('counters').doc('media')
  const savedBytes = (await orgCounter.get()).get('bytes') ?? 0
  const upload = await callConsole('POST', '/api/media/upload', {
    orgId: ORG_ID,
    fileName: `e2e-dam-${RUN}-band.csv`,
    contentType: 'text/csv',
    data: files.sheet.a.bytes.toString('base64'),
  })
  if (upload.status !== 200) throw new Error(`org upload ${upload.status} ${JSON.stringify(upload.body)}`)
  const mint = (sizeBytes) =>
    callConsole('PUT', '/api/media/replace', {
      orgId: ORG_ID,
      mediaId: upload.body.mediaId,
      contentType: 'text/csv',
      fileName: 'prices.csv',
      sizeBytes,
    })
  try {
    // Learn the band from the refusal itself rather than restating the plan
    // table here: push usage far past any band and read the limit back.
    await orgCounter.set({ bytes: 10 * 1024 * 1024 * MB }, { merge: true })
    const probe = await mint(1024)
    const limitMb = Number(/\((\d+) MB\)/.exec(String(probe.body.error))?.[1])
    if (probe.status !== 403 || !limitMb) {
      throw new Error(`could not read the band from a refusal: ${probe.status} ${JSON.stringify(probe.body)}`)
    }
    const hostIds = (await firestore.collection('hostIndex').where('orgId', '==', ORG_ID).get()).docs.map((doc) => doc.id)
    let hostBytes = 0
    for (const hostId of new Set([...hostIds, HOST_ID])) {
      hostBytes += Number((await firestore.collection('hosts').doc(hostId).collection('counters').doc('media').get()).get('bytes') ?? 0)
    }
    // One megabyte of headroom under the band, across every counter it sums.
    await orgCounter.set({ bytes: limitMb * MB - MB - hostBytes }, { merge: true })
    const tooBig = await mint(8 * MB)
    const fits = await mint(64 * 1024)
    tally.check(
      'the band refuses a signed replace at mint and still mints one that fits',
      tooBig.status === 403 &&
        tooBig.body.code === 'plan_limit_reached' &&
        !tooBig.body.uploadUrl &&
        fits.status === 200 &&
        typeof fits.body.uploadUrl === 'string',
      `band ${limitMb} MB; 8 MB → ${tooBig.status} ${tooBig.body.code}; 64 KB → ${fits.status} ${fits.body.uploadUrl ? 'uploadUrl minted' : JSON.stringify(fits.body)}`,
    )
  } finally {
    await orgCounter.set({ bytes: savedBytes }, { merge: true })
  }
})

/*==========================================
 * 7. PLAYS — the collector half. The player's half is gated to production
 *    surfaces, so on a loopback page it sends nothing by design;
 *    `video-playback-beacon.spec.tsx` proves what it sends.
 *=========================================*/

await apiStep('the collector counts one play per play beacon and no page view', async () => {
  const day = new Date().toISOString().slice(0, 10)
  const dayDoc = firestore.collection('hosts').doc(HOST_ID).collection('analytics').doc(day)
  const read = async () => {
    const snapshot = await dayDoc.get()
    return { plays: Number(snapshot.get(`media.${ids.film}.plays`) ?? 0), total: snapshot.get('total') }
  }
  const start = await read()
  const response = await fetch(`${TENANT_URL}/api/analytics/collect`, {
    method: 'POST',
    body: JSON.stringify({ hostId: HOST_ID, mediaId: ids.film, video: 'play' }),
  })
  const end = await waitFor(read, (value) => value.plays === start.plays + 1, { timeoutMs: 20_000 })
  tally.check(
    'the collector counts one play per play beacon and no page view',
    response.status === 204 && end.plays === start.plays + 1 && end.total === start.total,
    `plays ${start.plays} → ${end.plays}, total ${start.total} → ${end.total}`,
  )
})
tally.skip(
  'a loopback page sends the play beacon',
  'sendAnalyticsBeacon refuses every non-production surface; covered by libs/plugins/mui/src/lib/components/video-playback-beacon.spec.tsx',
)

await session.close()
rmSync(work, { recursive: true, force: true })
process.exit(tally.finish())
