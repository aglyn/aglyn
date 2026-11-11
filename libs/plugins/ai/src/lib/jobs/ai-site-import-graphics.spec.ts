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
 *
 * @jest-environment node
 */

/**
 * Which of a page's photos are graphics, read as the import brings them in
 * (AGL-4152): real `sharp` decodes invented pictures made here (a two-ink
 * wordmark on white saved as WebP with a camera's size, a noisy photo-like
 * JPEG, a cut-out PNG, a flat illustration, a product on white), read from
 * the site's library in place off Vercel and by the images function on
 * Vercel, one signed request a page. Firestore and storage are in-memory
 * fakes, and the CDN's block answers "not blocked".
 */

type MockData = Record<string, unknown>

const mockDocs = new Map<string, MockData>()
const mockObjects = new Map<string, Buffer>()

function mockDocRef(path: string): any {
  return {
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
  }
}

function mockCollectionRef(path: string): any {
  return { doc: (id: string) => mockDocRef(`${path}/${id}`) }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

const mockStorage = {
  bucket: () => ({
    file: (path: string) => ({
      download: async () => {
        const bytes = mockObjects.get(path)
        if (!bytes) throw new Error(`No such object: ${path}`)
        return [bytes]
      },
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore, storage: () => mockStorage }) },
}))

jest.mock('@aglyn/tenant-data-admin/server/serve-media-cdn', () => ({
  __esModule: true,
  mediaCdnServeBlock: jest.fn(async () => null),
}))

import type { AiSiteImportPhoto } from '../model/ai-site-import'
import { aiImageReadsRoute } from '../server/ai-image-reads-route'
import { AI_IMAGE_READS_PATH, AI_IMAGE_READS_SIGNATURE, AI_PICTURE_GRAPHICS_MAX_REFS, setAiImageReadsSecretForTests, signAiImageReadsRequest } from './ai-image-reads'
import { loadAiMediaSharp } from './ai-media-asset'
import { AI_SITE_IMPORT_GRAPHICS_MS, aiSiteImportGraphicOfBytes, aiSiteImportPhotoGraphics, readAiSiteImportGraphicsHere } from './ai-site-import-graphics'

const HOST = 'host-1'
const ORG = 'org-1'
const FUNCTION_URL = `https://console.example.com/api/plugin-images/${AI_IMAGE_READS_PATH}`
const firestore = mockFirestore as unknown as FirebaseFirestore.Firestore

let sharp: any

const imagesCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []

/** The images function, on its own origin: served by its real handler. */
const fetchMock = jest.fn(async (url: any, init: any) => {
  const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries())
  imagesCalls.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? '{}')) })
  if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  return aiImageReadsRoute(new Request(String(url), { method: init?.method, headers, body: init?.body }))
})

const realFetch = global.fetch

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

const svg = (width: number, height: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)

/** A partner's wordmark: a building of three blocks and a row of letters in navy, a red rule, on white, as a phone names and sizes it. */
const WORDMARK = svg(
  1200,
  900,
  `<rect width="100%" height="100%" fill="#fff"/><g fill="#1d3a6e"><rect x="120" y="300" width="60" height="260"/><rect x="190" y="220" width="80" height="340"/><rect x="280" y="340" width="50" height="220"/>` +
    Array.from({ length: 7 }, (_, at) => `<rect x="${380 + at * 105}" y="380" width="70" height="140"/>`).join('') +
    `</g><rect x="380" y="560" width="700" height="34" fill="#c8102e"/>`,
)

/** A mark with no background at all. */
const CUTOUT = svg(600, 300, `<rect x="60" y="80" width="480" height="140" rx="30" fill="#0a7"/>`)

/** A flat illustration: hills, a sun and a house in a few fills. */
const ILLUSTRATION = svg(
  900,
  600,
  `<rect width="100%" height="100%" fill="#f4e9d8"/><circle cx="700" cy="150" r="80" fill="#f2b134"/><path d="M0 420 L250 220 L480 420 Z" fill="#4f6d7a"/><path d="M300 420 L560 180 L900 420 Z" fill="#2d4654"/><rect y="420" width="900" height="180" fill="#7a9e7e"/><rect x="380" y="330" width="140" height="110" fill="#c0392b"/>`,
)

/** A photo-like picture: a gradient with soft blobs of color and a camera's grain. */
function photoLike(seed: number): any {
  const random = seeded(seed)
  const width = 800
  const height = 600
  const data = Buffer.alloc(width * height * 3)
  const blobs = Array.from({ length: 14 }, () => ({ x: random() * width, y: random() * height, size: 40 + random() * 160, color: [random() * 255, random() * 255, random() * 255] }))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = [90 + 80 * (x / width), 110 + 60 * (y / height), 70 + 40 * Math.sin(x / 50)]
      for (const blob of blobs) {
        const reach = ((x - blob.x) ** 2 + (y - blob.y) ** 2) / blob.size ** 2
        if (reach < 1) color = color.map((value, at) => value * reach + (blob.color[at] as number) * (1 - reach))
      }
      const grain = (random() - 0.5) * 40
      for (let channel = 0; channel < 3; channel += 1) data[(y * width + x) * 3 + channel] = Math.max(0, Math.min(255, color[channel] + grain))
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

/** A shaded object photographed on a white sweep: a flat background, but grain on the object. */
function productOnWhite(): any {
  const random = seeded(7)
  const width = 800
  const height = 600
  const data = Buffer.alloc(width * height * 3, 255)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const reach = (x - 400) ** 2 / 220 ** 2 + (y - 300) ** 2 / 200 ** 2
      if (reach >= 1) continue
      const shade = 1 - 0.6 * reach
      const grain = (random() - 0.5) * 12
      const at = (y * width + x) * 3
      data[at] = 180 * shade + grain
      data[at + 1] = 90 * shade + grain
      data[at + 2] = 40 * shade + grain
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

let pictures: Record<'wordmark' | 'wordmarkJpeg' | 'cutout' | 'illustration' | 'photo' | 'photoQuiet' | 'product', { bytes: Buffer; type: string }>

function seedAsset(mediaId: string, picture: { bytes: Buffer; type: string }, doc: MockData = {}) {
  mockDocs.set(`hosts/${HOST}/media/${mediaId}`, { contentType: picture.type, sizeBytes: picture.bytes.length, ...doc })
  mockObjects.set(`hosts/${HOST}/media/${mediaId}`, picture.bytes)
}

const onVercel = () => {
  process.env.VERCEL = '1'
  process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com/'
}

const photo = (mediaId: string): AiSiteImportPhoto => ({ mediaId, src: `media:${HOST}/${mediaId}`, width: 1200, height: 900, from: `https://www.example.com/uploads/IMG_${mediaId}.webp` })

beforeAll(async () => {
  sharp = await loadAiMediaSharp()
  pictures = {
    wordmark: { bytes: await sharp(WORDMARK).webp({ quality: 80 }).toBuffer(), type: 'image/webp' },
    wordmarkJpeg: { bytes: await sharp(WORDMARK).jpeg({ quality: 70 }).toBuffer(), type: 'image/jpeg' },
    cutout: { bytes: await sharp(CUTOUT).png().toBuffer(), type: 'image/png' },
    illustration: { bytes: await sharp(ILLUSTRATION).png().toBuffer(), type: 'image/png' },
    photo: { bytes: await photoLike(1).jpeg({ quality: 80 }).toBuffer(), type: 'image/jpeg' },
    photoQuiet: { bytes: await photoLike(2).webp({ quality: 60 }).toBuffer(), type: 'image/webp' },
    product: { bytes: await productOnWhite().jpeg({ quality: 85 }).toBuffer(), type: 'image/jpeg' },
  }
})

beforeEach(() => {
  imagesCalls.length = 0
  fetchMock.mockClear()
  mockDocs.clear()
  mockObjects.clear()
  ;(global as any).fetch = fetchMock
  setAiImageReadsSecretForTests(() => 'images-secret')
  for (const [mediaId, picture] of Object.entries(pictures)) seedAsset(mediaId, picture)
})

afterEach(() => {
  for (const key of ['VERCEL', 'NEXT_PUBLIC_CONSOLE_URL']) delete process.env[key]
  setAiImageReadsSecretForTests(null)
  ;(global as any).fetch = realFetch
  jest.restoreAllMocks()
})

describe('a picture’s bytes, decoded', () => {
  it.each([
    ['a two-ink wordmark on white, as WebP', 'wordmark', true],
    ['the same wordmark as a JPEG', 'wordmarkJpeg', true],
    ['a cut-out mark', 'cutout', true],
    ['a flat illustration', 'illustration', true],
    ['a noisy photo-like JPEG', 'photo', false],
    ['a photo-like WebP', 'photoQuiet', false],
    ['a product photographed on white', 'product', false],
  ] as const)('%s is a graphic: %s', async (_name, key, graphic) => {
    expect(await aiSiteImportGraphicOfBytes(pictures[key].bytes)).toBe(graphic)
  })
})

describe('a page’s pictures in the site’s library', () => {
  it('are read in place off Vercel, with null for one that is not the site’s or is not in the library', async () => {
    const refs = [`media:${HOST}/wordmark`, `media:${HOST}/photo`, `media:${HOST}/missing`, 'media:host-2/wordmark', 'https://www.example.com/a.jpg']
    expect(await readAiSiteImportGraphicsHere(firestore, refs, HOST, ORG)).toEqual([true, false, null, null, null])
    expect(imagesCalls).toHaveLength(0)
  })

  it('are not read where the library keeps them private or deleted', async () => {
    seedAsset('hidden', pictures.wordmark, { private: true })
    seedAsset('gone', pictures.wordmark, { deletedAt: '2026-11-01T00:00:00Z' })
    expect(await readAiSiteImportGraphicsHere(firestore, [`media:${HOST}/hidden`, `media:${HOST}/gone`], HOST, ORG)).toEqual([null, null])
  })

  it('go to the images function on Vercel, one signed request for the page, and come back flagged on their photo entries', async () => {
    onVercel()
    const assets = ['wordmark', 'photo', 'cutout', 'product'].map(photo)
    const flagged = await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG })
    expect(flagged.map((entry) => entry.graphic)).toEqual([true, false, true, false])
    expect(flagged.map(({ graphic: _graphic, ...rest }) => rest)).toEqual(assets)
    expect(imagesCalls).toHaveLength(1)
    expect(imagesCalls[0]?.url).toBe(FUNCTION_URL)
    expect(imagesCalls[0]?.body).toEqual({ op: 'picture-graphics', refs: assets.map((entry) => entry.src), hostId: HOST, orgId: ORG })
    expect(imagesCalls[0]?.headers[AI_IMAGE_READS_SIGNATURE]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
  })

  it('read the same off Vercel as on it', async () => {
    const assets = Object.keys(pictures).map(photo)
    const here = await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG })
    onVercel()
    expect(await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG })).toEqual(here)
  })

  it('ask in chunks the function takes, on a page with more pictures than one request names', async () => {
    onVercel()
    const assets = Array.from({ length: AI_PICTURE_GRAPHICS_MAX_REFS + 3 }, () => photo('photo'))
    const flagged = await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG })
    expect(imagesCalls.map((call) => (call.body['refs'] as string[]).length)).toEqual([AI_PICTURE_GRAPHICS_MAX_REFS, 3])
    expect(flagged.every((entry) => entry.graphic === false)).toBe(true)
  })

  it('keep no flag where the read fails or does not come in time, and the photos as they came', async () => {
    const assets = [photo('wordmark')]
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG }, async () => Promise.reject(new Error('down')))).toEqual(assets)
    // A read that never answers is cut off by the page's own clock.
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')))
    expect(await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG }, () => new Promise(() => undefined))).toEqual(assets)
    expect(timeout).toHaveBeenCalledWith(AI_SITE_IMPORT_GRAPHICS_MS)
    timeout.mockRestore()
    expect(warn).toHaveBeenCalled()
    // A page with no pictures, or a pass already stopped, reads nothing.
    const read = jest.fn(async () => [true])
    expect(await aiSiteImportPhotoGraphics([], { firestore, hostId: HOST, orgId: ORG }, read)).toEqual([])
    expect(await aiSiteImportPhotoGraphics(assets, { firestore, hostId: HOST, orgId: ORG, signal: AbortSignal.abort() }, read)).toEqual(assets)
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the images function’s picture-graphics read', () => {
  const body = { op: 'picture-graphics', refs: [`media:${HOST}/wordmark`], hostId: HOST, orgId: ORG }
  const post = (payload: Record<string, unknown>, header?: string) =>
    aiImageReadsRoute(new Request(FUNCTION_URL, { method: 'POST', headers: header === undefined ? {} : { [AI_IMAGE_READS_SIGNATURE]: header }, body: JSON.stringify(payload) }))

  it('answers only our own signed request', async () => {
    expect((await post(body)).status).toBe(401)
    const answer = await post(body, signAiImageReadsRequest(JSON.stringify(body)))
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ graphics: [true] })
  })

  it('refuses refs that are not a list of strings, or more than one request names', async () => {
    for (const refs of [null, 'media:host-1/wordmark', [7], Array.from({ length: AI_PICTURE_GRAPHICS_MAX_REFS + 1 }, () => `media:${HOST}/wordmark`)]) {
      const payload = { ...body, refs }
      expect((await post(payload, signAiImageReadsRequest(JSON.stringify(payload)))).status).toBe(400)
    }
    const badHost = { ...body, hostId: 'hosts/other' }
    expect((await post(badHost, signAiImageReadsRequest(JSON.stringify(badHost)))).status).toBe(400)
  })
})
