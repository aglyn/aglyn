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
 * A job step's image reads have their own function on Vercel (AGL-4048):
 * only the console's plugins' image function ships `sharp`'s native library,
 * so the products step's photo read and the theme step's logo read ask it
 * over HTTP, signed, and it reads the asset again under the media library's
 * own rule. Off Vercel both run in place, exactly as before, and a function
 * that does not answer is an unreadable photo or logo, as a failed read in
 * place always was.
 *
 * Firestore and storage are in-memory fakes and the CDN's block answers
 * "not blocked"; `sharp` is the real one the job loads, so the pictures are
 * really decoded and encoded on both sides of the wire. The images function
 * is its real handler, reached through a `fetch` stub on its own origin.
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

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import { aiImageReadsRoute } from '../server/ai-image-reads-route'
import {
  AI_IMAGE_READS_PATH,
  AI_IMAGE_READS_SIGNATURE,
  aiImageReadsOrigin,
  setAiImageReadsSecretForTests,
  signAiImageReadsRequest,
  verifyAiImageReadsRequest,
} from './ai-image-reads'
import { loadAiMediaSharp } from './ai-media-asset'
import { AI_PRODUCT_IMAGE_MAX_EDGE_PX, AI_PRODUCT_IMAGE_READ_MS, readAiProductImage } from './ai-product-image'
import { gatherAiThemeBrandInputs } from './ai-theme-brand-inputs'

const HOST = 'host-1'
const ORG = 'org-1'
const FUNCTION_URL = `https://console.example.com/api/plugin-images/${AI_IMAGE_READS_PATH}`
const firestore = mockFirestore as unknown as FirebaseFirestore.Firestore

/** The `sharp` the job itself loads. */
let sharp: any

/** Every request to the images function, as it arrived. */
const imagesCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []

/** The images function, on its own origin: served by its real handler. */
const fetchMock = jest.fn(async (url: any, init: any) => {
  const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries())
  imagesCalls.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? '{}')) })
  if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  return aiImageReadsRoute(new Request(String(url), { method: init?.method, headers, body: init?.body }))
})

const realFetch = global.fetch

/** A camera's photo: larger than the model is shown, and transparent. */
async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 0.5 } } })
    .png()
    .toBuffer()
}

/** A logo in one brand color. */
async function logo(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 15, g: 118, b: 110, alpha: 1 } } })
    .png()
    .toBuffer()
}

function seedAsset(scope: 'hosts' | 'orgs', scopeId: string, mediaId: string, bytes: Buffer, doc: MockData = {}) {
  mockDocs.set(`${scope}/${scopeId}/media/${mediaId}`, {
    contentType: 'image/png',
    sizeBytes: bytes.length,
    ...doc,
  })
  mockObjects.set(`${scope}/${scopeId}/media/${mediaId}`, bytes)
}

const onVercel = () => {
  process.env.VERCEL = '1'
  process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com/'
}

/** One request to the function as a caller of ours would make it, or as anyone else could. */
const images = (body: Record<string, unknown>, header?: string) =>
  aiImageReadsRoute(
    new Request(FUNCTION_URL, {
      method: 'POST',
      headers: header === undefined ? {} : { [AI_IMAGE_READS_SIGNATURE]: header },
      body: JSON.stringify(body),
    }),
  )

const signed = (body: Record<string, unknown>) => images(body, signAiImageReadsRequest(JSON.stringify(body)))

beforeAll(async () => {
  sharp = await loadAiMediaSharp()
})

beforeEach(async () => {
  imagesCalls.length = 0
  fetchMock.mockClear()
  mockDocs.clear()
  mockObjects.clear()
  ;(global as any).fetch = fetchMock
  setAiImageReadsSecretForTests(() => 'images-secret')
  seedAsset('hosts', HOST, 'lamp', await photo(1_600, 800))
  seedAsset('orgs', ORG, 'lamp', await photo(1_200, 1_200), { visibleTo: [ORG_SCOPE_TOKEN] })
  seedAsset('hosts', HOST, 'logo', await logo())
})

afterEach(() => {
  for (const key of ['VERCEL', 'NEXT_PUBLIC_CONSOLE_URL']) delete process.env[key]
  setAiImageReadsSecretForTests(null)
  ;(global as any).fetch = realFetch
  jest.restoreAllMocks()
})

describe('where a job step’s image read runs', () => {
  it('asks the images function only on Vercel, at the console’s address; anywhere else it reads in place', () => {
    expect(aiImageReadsOrigin()).toBeNull()
    onVercel()
    expect(aiImageReadsOrigin()).toBe('https://console.example.com')
  })

  it('is registered on the AI plugin as a machine’s route that draws images, at the path the steps ask', () => {
    const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8')
    expect(AI_IMAGE_READS_PATH).toBe('ai/image-reads')
    expect(server).toMatch(
      /registerPluginApiRoute\(\s*'ai\/image-reads',[\s\S]*?aiImageReadsRoute\(request\),\s*\},\s*\{ machine: true, images: true \},\s*\)/,
    )
  })
})

describe('a product’s photo (the products step)', () => {
  const input = { value: `media:${HOST}/lamp`, hostId: HOST, orgId: ORG }

  async function sentPicture(read: Awaited<ReturnType<typeof readAiProductImage>>) {
    expect(read.status).toBe('read')
    const data = read.status === 'read' ? read.image.data : ''
    return sharp(Buffer.from(data, 'base64')).metadata()
  }

  it('is read and encoded by the images function on Vercel, signed, bounded by the time a pass counts for it', async () => {
    onVercel()
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    const read = await readAiProductImage(firestore, input)
    const sent = await sentPicture(read)
    expect([sent.format, Math.max(sent.width, sent.height)]).toEqual(['jpeg', AI_PRODUCT_IMAGE_MAX_EDGE_PX])
    expect(imagesCalls).toHaveLength(1)
    expect(imagesCalls[0].url).toBe(FUNCTION_URL)
    expect(imagesCalls[0].body).toEqual({ op: 'product-photo', ref: `media:${HOST}/lamp`, hostId: HOST, orgId: ORG })
    expect(imagesCalls[0].headers[AI_IMAGE_READS_SIGNATURE]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(timeout).toHaveBeenCalledWith(AI_PRODUCT_IMAGE_READ_MS)
  })

  it('reads an org library photo named by its CDN path the same way', async () => {
    onVercel()
    const read = await readAiProductImage(firestore, { ...input, value: `/api/media/cdn/org:${ORG}/lamp` })
    const sent = await sentPicture(read)
    expect([sent.format, sent.width, sent.height]).toEqual(['jpeg', 768, 768])
    expect(imagesCalls.map((call) => call.body['ref'])).toEqual([`media:org:${ORG}/lamp`])
  })

  it('is read in place off Vercel, with the same picture and no request', async () => {
    const here = await readAiProductImage(firestore, input)
    expect(imagesCalls).toHaveLength(0)
    onVercel()
    const there = await readAiProductImage(firestore, input)
    expect(there).toEqual(here)
  })

  it('reads in place whenever a caller hands its own reads (a spec, the eval harness)', async () => {
    onVercel()
    const readBytes = jest.fn(async () => ({ buffer: await photo(300, 200), contentType: 'image/png' }))
    const read = await readAiProductImage(firestore, input, { readBytes })
    expect(read.status).toBe('read')
    expect(readBytes).toHaveBeenCalledTimes(1)
    expect(imagesCalls).toHaveLength(0)
  })

  it('asks nothing for a link or another site’s asset', async () => {
    onVercel()
    for (const value of ['https://cdn.example.com/lamp.jpg', 'media:host-2/lamp', 'media:org:org-2/lamp']) {
      expect(await readAiProductImage(firestore, { ...input, value })).toEqual({ status: 'not-in-library' })
    }
    expect(imagesCalls).toHaveLength(0)
  })

  it('is unreadable, and never throws, when the function cannot read it, fails, does not answer or answers nonsense', async () => {
    onVercel()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    // The function cannot read what storage does not hold: its 500 is the step's unreadable photo.
    mockObjects.delete(`hosts/${HOST}/media/lamp`)
    expect(await readAiProductImage(firestore, input)).toEqual({ status: 'unreadable' })
    // A function that is down, or does not answer inside the bound.
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await readAiProductImage(firestore, input)).toEqual({ status: 'unreadable' })
    fetchMock.mockImplementationOnce(async () => new Response('Bad gateway', { status: 502 }))
    expect(await readAiProductImage(firestore, input)).toEqual({ status: 'unreadable' })
    // Only a JPEG picture part is ever sent on.
    for (const read of [
      { status: 'read', image: { type: 'image', mediaType: 'image/png', data: 'AAAA' } },
      { status: 'read', image: { type: 'image', mediaType: 'image/jpeg', data: '' } },
      { status: 'read' },
      { status: 'model' },
      null,
    ]) {
      fetchMock.mockImplementationOnce(async () => Response.json({ read }))
      expect([read, await readAiProductImage(firestore, input)]).toEqual([read, { status: 'unreadable' }])
    }
  })
})

describe('the site logo’s colors (the theme step)', () => {
  const gather = (host: Record<string, unknown>, signal?: AbortSignal) =>
    gatherAiThemeBrandInputs({
      firestore,
      org: null,
      hostId: HOST,
      host,
      brief: 'Make it warmer.',
      ...(signal ? { signal } : {}),
    })

  it('are read by the images function on Vercel, signed, and only hex colors come back', async () => {
    onVercel()
    const inputs = await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` })
    expect(inputs).toEqual({ colors: [{ hex: '#0f766e', source: 'logo' }], notes: [] })
    expect(imagesCalls).toHaveLength(1)
    expect(imagesCalls[0].body).toEqual({ op: 'logo-colors', ref: `media:${HOST}/logo`, hostId: HOST, orgId: '' })
    expect(imagesCalls[0].headers[AI_IMAGE_READS_SIGNATURE]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
  })

  it('are read in place off Vercel, with the same colors and no request', async () => {
    const here = await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` })
    expect(here.colors).toEqual([{ hex: '#0f766e', source: 'logo' }])
    expect(imagesCalls).toHaveLength(0)
  })

  it('are left out with their note when the function fails, or the brand reads’ bound has passed', async () => {
    onVercel()
    const note = "The site logo's colors could not be read, so the proposal does not use them."
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockImplementationOnce(async () => new Response('Bad gateway', { status: 502 }))
    expect(await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` })).toEqual({ colors: [], notes: [note] })
    // A storage object that is gone: the function answers 500.
    mockObjects.delete(`hosts/${HOST}/media/logo`)
    expect(await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` })).toEqual({ colors: [], notes: [note] })
    // The step's own signal, already spent: the request is never waited on.
    const spent = new AbortController()
    spent.abort()
    expect(await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` }, spent.signal)).toEqual({
      colors: [],
      notes: [note],
    })
  })

  it('keep only what reads as a color from whatever the function answers', async () => {
    onVercel()
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ colors: ['#0F766E', 'url(https://x.example)', 7, '#abc', '#123456', '#654321', '#000000'] }),
    )
    const inputs = await gather({ orgId: ORG, logoUrl: `media:${HOST}/logo` })
    expect(inputs.colors.map((color) => color.hex)).toEqual(['#0f766e', '#aabbcc', '#123456', '#654321'])
  })
})

describe('the images function itself', () => {
  const body = { op: 'product-photo', ref: `media:${HOST}/lamp`, hostId: HOST, orgId: ORG }

  it('refuses an unsigned, a forged, a stale, a re-aimed, a foreign and another route’s request, and reads nothing', async () => {
    const download = jest.spyOn(mockStorage, 'bucket')
    const raw = JSON.stringify(body)
    expect((await images(body)).status).toBe(401)
    expect((await images(body, `t=${Date.now()},v1=${'0'.repeat(64)}`)).status).toBe(401)
    expect((await images(body, signAiImageReadsRequest(raw, Date.now() - 6 * 60 * 1000))).status).toBe(401)
    expect((await images({ ...body, hostId: 'host-2' }, signAiImageReadsRequest(raw))).status).toBe(401)
    // Signed over the same body under another route's name: the start-up screen's.
    const at = Date.now()
    const digest = createHash('sha256').update(raw).digest('hex')
    const elsewhere = createHmac('sha256', 'images-secret').update(`pos-reader-splash-images:${at}.${digest}`).digest('hex')
    expect((await images(body, `t=${at},v1=${elsewhere}`)).status).toBe(401)
    const ours = signAiImageReadsRequest(raw)
    expect(verifyAiImageReadsRequest(ours, raw)).toBe(true)
    // Signed under another deploy's secret.
    setAiImageReadsSecretForTests(() => 'another-secret')
    expect(verifyAiImageReadsRequest(ours, raw)).toBe(false)
    // A deploy with no secret refuses everything.
    setAiImageReadsSecretForTests(() => {
      throw new Error('TOKEN_SIGNING_SECRET is not configured')
    })
    expect(verifyAiImageReadsRequest(`t=${Date.now()},v1=${'0'.repeat(64)}`, raw)).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('locates the asset again, and reads nothing outside the site’s library or its org’s', async () => {
    const download = jest.spyOn(mockStorage, 'bucket')
    for (const ref of ['media:host-2/lamp', 'media:org:org-2/lamp', 'https://cdn.example.com/lamp.jpg']) {
      const read = await signed({ ...body, ref })
      expect([ref, read.status, await read.json()]).toEqual([ref, 200, { read: { status: 'not-in-library' } }])
      const colors = await signed({ ...body, op: 'logo-colors', ref })
      expect([ref, await colors.json()]).toEqual([ref, { colors: null }])
    }
    // An org asset not shared with the site is not read either.
    seedAsset('orgs', ORG, 'private-lamp', await photo(100, 100), { visibleTo: [] })
    expect(await (await signed({ ...body, ref: `media:org:${ORG}/private-lamp` })).json()).toEqual({
      read: { status: 'unreadable' },
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('answers 400 for an op it does not know or a site it cannot name, and 405 to anything but a POST', async () => {
    expect((await signed({ ...body, op: 'draw' })).status).toBe(400)
    expect((await signed({ ...body, hostId: 'hosts/host-1' })).status).toBe(400)
    expect((await signed({ ...body, orgId: '../org' })).status).toBe(400)
    expect((await aiImageReadsRoute(new Request(FUNCTION_URL, { method: 'GET' }))).status).toBe(405)
  })
})
