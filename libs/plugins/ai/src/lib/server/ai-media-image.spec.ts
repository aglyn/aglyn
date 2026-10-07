/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 */
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
 * "Create with AI" in Media, the door (AGL-3602), with the ladder, the meter,
 * both providers and the upload route stood in.
 *
 * - NO PHOTOS UNTIL CONFIGURED: no image provider, a 404 the dialog shows,
 *   and nothing read first. Illustrations run wherever text AI does.
 * - RESERVED BEFORE SPENT, AND HANDED BACK when nothing was made or kept.
 * - A WALL IS NOT RUN PAST: a Free workspace asking for more pictures than
 *   its credits cover is refused before the provider is called.
 * - SETTLED ON WHAT WAS STORED, at the billed per-picture rate.
 * - STORED THROUGH THE UPLOAD ROUTE, as the caller, then given alt text and
 *   a record of how it was made.
 */

const mockGate = jest.fn()
const mockRelease = jest.fn()
const mockRecordCost = jest.fn()
let mockCredits: { used: number; limit: number; remaining: number } | null = null
const mockSvg = jest.fn()
let mockSvgModel: string | undefined = 'claude-haiku-4-5'
let mockHostDoc: Record<string, unknown> | null = null
const mockProvider = {
  id: 'google-vertex',
  label: 'Google Vertex AI',
  defaultModel: jest.fn(() => 'gemini-3.1-flash-image'),
  configured: jest.fn(() => true),
  endpointHost: () => 'us-central1-aiplatform.googleapis.com',
  generate: jest.fn(),
}

jest.mock('../runtime/ai-gate', () => ({ aiGateLadder: (...args: unknown[]) => mockGate(...args) }))
jest.mock('./ai-media-svg', () => ({
  aiMediaSvgModel: () => mockSvgModel,
  generateAiMediaSvg: (...args: unknown[]) => mockSvg(...args),
}))
jest.mock('../runtime/site-inventory', () => ({
  aiInventoryTheme: (host: Record<string, unknown> | null) =>
    host ? { summary: [], colors: host['colors'], fonts: [] } : null,
}))
jest.mock('../providers/vertex-image', () => ({
  get vertexImageProvider() {
    return mockProvider
  },
}))
jest.mock('../usage/assist-usage', () => ({
  publicAssistQuota: () => ({ credits: mockCredits }),
  recordAssistCost: (...args: unknown[]) => mockRecordCost(...args),
  releaseAssistMessage: (...args: unknown[]) => mockRelease(...args),
}))

import { AiUpstreamError } from '../providers/contract'
import { AiImageSafetyRefusal } from '../providers/image-contract'
import { AI_MEDIA_OURS_COPY, aiImageAltText, aiImageFileName, POST } from './ai-media-image'
import { AI_MEDIA_RASTER_STYLE_WORDING } from './ai-media-raster-prompt'

/** Every `update` a stored picture's document received, by path. */
const updates: Array<{ path: string; data: Record<string, unknown> }> = []

function fakeFirestore() {
  const ref = (path: string): any => ({
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: mockHostDoc !== null, data: () => mockHostDoc }),
    update: async (data: Record<string, unknown>) => {
      updates.push({ path, data })
    },
  })
  return { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }
}

const RESERVATION = { allowed: true, dayKey: '2026-10-06', monthKey: '2026-10', free: null }

function admitted(org: Record<string, unknown> = { plan: 'pro' }) {
  return {
    uid: 'u1',
    staff: false,
    orgId: 'org-1',
    org,
    firestore: fakeFirestore(),
    reservation: RESERVATION,
  }
}

const post = (body: Record<string, unknown>) =>
  new Request('https://console.example.com/api/ai/media/images', {
    method: 'POST',
    headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const BODY = {
  orgId: 'org-1',
  library: 'host',
  hostId: 'host-1',
  folderId: 'folder-9',
  mode: 'photo',
  prompt: 'a red barn at dawn',
  aspectRatio: '16:9',
  count: 2,
}

const image = (base64: string) => ({ base64, mimeType: 'image/png' })
const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const PHOTO_USAGE = { inputTokens: 20, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }
const photos = (images: Array<{ base64: string; mimeType: string }>, filtered = 0) => ({
  model: 'gemini-3.1-flash-image',
  images,
  filtered,
  usage: PHOTO_USAGE,
})
const SVG_USAGE = { inputTokens: 1_000, outputTokens: 2_000, cacheReadTokens: 5_000, cacheWriteTokens: 0 }
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="10" height="10"/></svg>'
const drawn = (alt = 'A red barn in flat shapes') => ({
  kind: 'drawn',
  svg: SVG,
  alt,
  usage: SVG_USAGE,
  model: 'claude-haiku-4-5',
})

let mockFetch: jest.Mock
let uploadCount = 0

beforeEach(() => {
  jest.clearAllMocks()
  // The door logs its faults for the operator; the assertions read the answers.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  updates.length = 0
  uploadCount = 0
  mockCredits = null
  mockSvgModel = 'claude-haiku-4-5'
  mockHostDoc = null
  mockProvider.configured.mockReturnValue(true)
  mockGate.mockResolvedValue(admitted())
  mockRecordCost.mockResolvedValue('signal-1')
  mockRelease.mockResolvedValue(undefined)
  mockFetch = jest.fn(async () => {
    uploadCount += 1
    return new Response(JSON.stringify({ mediaId: `media-${uploadCount}`, url: 'u' }), { status: 200 })
  })
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('the helpers', () => {
  it('writes alt text from the description, inside the library’s limit', () => {
    expect(aiImageAltText('a red barn at dawn')).toBe('A red barn at dawn')
    const long = aiImageAltText(`a field ${'of tall golden wheat '.repeat(40)}`)
    expect(long.length).toBeLessThanOrEqual(300)
    expect(long.endsWith('…')).toBe(true)
  })

  it('names a file from the description’s first words, by its type', () => {
    expect(aiImageFileName('A red barn, at dawn!', 1, 'image/png')).toBe('ai-a-red-barn-at-dawn-2.png')
    expect(aiImageFileName('???', 0, 'image/svg+xml')).toBe('ai-image-1.svg')
  })
})

describe('gates and refusals before anything is spent', () => {
  it('answers a photo with a sentence on a deployment that makes none, before the ladder reads anything', async () => {
    mockProvider.configured.mockReturnValue(false)
    const response = await POST(post(BODY))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ reason: 'unavailable', error: expect.stringMatching(/Illustration/) })
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('still draws an illustration there', async () => {
    mockProvider.configured.mockReturnValue(false)
    mockSvg.mockResolvedValue(drawn())
    expect((await POST(post({ ...BODY, mode: 'illustration', style: 'icon', count: 1 }))).status).toBe(200)
  })

  it('climbs the generative ladder for the named org and site', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    await POST(post(BODY))
    const [input, config] = mockGate.mock.calls[0]
    expect(input.orgId).toBe('org-1')
    expect(input.hostId).toBe('host-1')
    expect(config).toMatchObject({
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
    })
  })

  it('passes a ladder refusal through, and spends nothing', async () => {
    mockGate.mockResolvedValue(Response.json({ error: 'locked' }, { status: 423 }))
    expect((await POST(post(BODY))).status).toBe(423)
    expect(mockProvider.generate).not.toHaveBeenCalled()
  })

  it.each([
    [{ prompt: '   ' }, /Describe the picture/],
    [{ aspectRatio: '2:1' }, /Choose a shape/],
    [{ count: 5 }, /between 1 and 4/],
    [{ count: 0 }, /between 1 and 4/],
    [{ hostId: '' }, /Open the site/],
    [{ mode: 'illustration', style: 'portrait' }, /illustration, an icon/],
    [{ mode: 'photo', style: 'portrait' }, /Choose a kind of picture/],
    [{ mode: 'photo', style: 'icon' }, /Choose a kind of picture/],
    [{ mode: 'illustration', style: 'icon', palette: { source: 'custom', colors: ['red'] } }, /hex values/],
    [{ mode: 'illustration', style: 'icon', palette: { source: 'custom', colors: [] } }, /hex values/],
  ])('refuses %p with a 400 and hands the reservation back', async (patch, message) => {
    const response = await POST(post({ ...BODY, ...patch }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(message)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockProvider.generate).not.toHaveBeenCalled()
    expect(mockSvg).not.toHaveBeenCalled()
  })

  it('refuses a Free workspace whose credits do not cover the pictures, before the provider', async () => {
    mockGate.mockResolvedValue(admitted({ plan: 'free' }))
    mockCredits = { used: 150, limit: 300, remaining: 150 }
    const response = await POST(post(BODY))
    expect(response.status).toBe(429)
    expect((await response.json()).error).toMatch(/needs about \d+ credits.*150 left/)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockProvider.generate).not.toHaveBeenCalled()
  })

  it('lets a plan that buys past its band through, whatever is left in it', async () => {
    mockCredits = { used: 2_700, limit: 2_750, remaining: 50 }
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    expect((await POST(post(BODY))).status).toBe(200)
  })
})

describe('photos', () => {
  it('hands the reservation back and charges nothing on a provider fault', async () => {
    mockProvider.generate.mockRejectedValue(new AiUpstreamError(503, true, 'req-1'))
    const response = await POST(post(BODY))
    expect(response.status).toBe(502)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockRecordCost).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('answers 503 when the platform’s own credential was refused', async () => {
    mockProvider.generate.mockRejectedValue(new AiUpstreamError(403, false, null, 'credentials'))
    expect((await POST(post(BODY))).status).toBe(503)
  })

  it('records a declined description at zero, as a declined request', async () => {
    mockProvider.generate.mockRejectedValue(new AiImageSafetyRefusal(['IMAGE_SAFETY']))
    const response = await POST(post(BODY))
    expect(response.status).toBe(422)
    expect((await response.json()).reason).toBe('safety')
    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRecordCost.mock.calls[0][2]).toMatchObject({ stopReason: 'refusal', kind: 'image', usage: { images: 0 } })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts each picture to /api/media/upload as the caller, into the open folder', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('AAAA'), image('BBBB')]))
    const response = await POST(post(BODY))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ mediaIds: ['media-1', 'media-2'], filtered: 0, failed: 0 })
    // Two pictures at 0.1008 and the prompt and thinking at 0.75 / 4.5 per million.
    expect(payload.credits).toBe(205)
    expect(mockProvider.generate).toHaveBeenCalledWith({
      model: 'gemini-3.1-flash-image',
      prompt: 'a red barn at dawn',
      aspectRatio: '16:9',
      count: 2,
    })
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe('https://console.example.com/api/media/upload')
    expect(init.headers.Authorization).toBe('Bearer user-token')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      fileName: 'ai-a-red-barn-at-dawn-1.png',
      contentType: 'image/png',
      folderId: 'folder-9',
      data: 'AAAA',
    })
  })

  it('follows the description with the kind’s style wording, and keeps the description alone as the record', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    expect((await POST(post({ ...BODY, style: 'watercolor', count: 1 }))).status).toBe(200)
    expect(mockProvider.generate).toHaveBeenCalledWith({
      model: 'gemini-3.1-flash-image',
      prompt: `a red barn at dawn\n\n${AI_MEDIA_RASTER_STYLE_WORDING.watercolor}`,
      aspectRatio: '16:9',
      count: 1,
    })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).fileName).toBe('ai-a-red-barn-at-dawn-1.png')
    expect(updates[0].data).toMatchObject({
      alt: 'A red barn at dawn',
      aiGenerated: { mode: 'photo', style: 'watercolor', prompt: 'a red barn at dawn' },
    })
  })

  it('reads a photo request with no kind as a Photo, sent exactly as written', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    await POST(post({ ...BODY, count: 1 }))
    expect(mockProvider.generate.mock.calls[0][0].prompt).toBe('a red barn at dawn')
    expect(updates[0].data).toMatchObject({ aiGenerated: { style: 'photo' } })
  })

  it('sends an org library’s scope, with the site on screen for its default sharing', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    await POST(post({ ...BODY, library: 'org', hostId: 'host-1' }))
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.orgId).toBe('org-1')
    expect(body.forHostId).toBe('host-1')
    expect(body.hostId).toBeUndefined()
    expect(updates[0].path).toBe('orgs/org-1/media/media-1')
  })

  it('settles the stored pictures and the request’s tokens, on the image kind', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A'), image('B')]))
    await POST(post(BODY))
    expect(mockRecordCost).toHaveBeenCalledTimes(1)
    expect(mockRecordCost.mock.calls[0][2]).toMatchObject({
      model: 'gemini-3.1-flash-image',
      kind: 'image',
      uid: 'u1',
      hostId: 'host-1',
      usage: { ...PHOTO_USAGE, images: 2 },
    })
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('writes the alt text and the provenance onto each stored document', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    await POST(post(BODY))
    expect(updates).toHaveLength(1)
    expect(updates[0].path).toBe('hosts/host-1/media/media-1')
    expect(updates[0].data).toMatchObject({
      alt: 'A red barn at dawn',
      hasAlt: true,
      aiGenerated: {
        model: 'gemini-3.1-flash-image',
        prompt: 'a red barn at dawn',
        mode: 'photo',
        aspectRatio: '16:9',
        signalId: 'signal-1',
        generatedBy: 'u1',
      },
    })
  })

  it('charges only for what the library kept, and reports the rest', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A'), image('B')], 1))
    mockFetch
      .mockImplementationOnce(async () => new Response(JSON.stringify({ mediaId: 'media-1' }), { status: 200 }))
      .mockImplementationOnce(
        async () => new Response(JSON.stringify({ error: 'Storage limit reached (250 MB)' }), { status: 402 }),
      )
    const response = await POST(post({ ...BODY, count: 3 }))
    expect(await response.json()).toMatchObject({
      mediaIds: ['media-1'],
      filtered: 1,
      failed: 1,
      warning: 'Storage limit reached (250 MB)',
    })
    expect(mockRecordCost.mock.calls[0][2].usage.images).toBe(1)
  })

  it('hands the reservation back and answers the library’s refusal when nothing was kept', async () => {
    mockProvider.generate.mockResolvedValue(photos([image('A')]))
    mockFetch.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'Storage limit reached (250 MB)' }), { status: 402 }),
    )
    const response = await POST(post(BODY))
    expect(response.status).toBe(402)
    expect((await response.json()).error).toBe('Storage limit reached (250 MB)')
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockRecordCost).not.toHaveBeenCalled()
  })
})

describe('illustrations', () => {
  const ILLUSTRATION = { ...BODY, mode: 'illustration', style: 'icon', count: 2 }

  it('draws each picture on the text provider, in the site theme’s colors, and stores it as SVG', async () => {
    mockHostDoc = { colors: { 'primary.main': '#1a73e8', 'secondary.main': '#fbbc04' } }
    mockSvg.mockResolvedValue(drawn())
    const response = await POST(post(ILLUSTRATION))
    expect(response.status).toBe(200)
    expect(mockProvider.generate).not.toHaveBeenCalled()
    expect(mockSvg).toHaveBeenCalledTimes(2)
    expect(mockSvg.mock.calls[0][0]).toMatchObject({
      model: 'claude-haiku-4-5',
      style: 'icon',
      aspectRatio: '16:9',
      palette: ['#1a73e8', '#fbbc04'],
      variant: 0,
      count: 2,
    })
    const upload = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(upload.contentType).toBe('image/svg+xml')
    expect(upload.fileName).toBe('ai-a-red-barn-at-dawn-1.svg')
    expect(Buffer.from(upload.data, 'base64').toString('utf8')).toBe(SVG)
    expect(updates[0].data).toMatchObject({
      alt: 'A red barn in flat shapes',
      aiGenerated: { model: 'claude-haiku-4-5', mode: 'illustration', style: 'icon' },
    })
  })

  it('draws in the person’s own colors when they chose them', async () => {
    mockSvg.mockResolvedValue(drawn())
    await POST(post({ ...ILLUSTRATION, palette: { source: 'custom', colors: ['#112233', '#ABC'] } }))
    expect(mockSvg.mock.calls[0][0].palette).toEqual(['#112233', '#abc'])
  })

  it('meters what drew the stored pictures as text tokens, at the text model’s billed rates', async () => {
    mockSvg.mockResolvedValue(drawn())
    await POST(post(ILLUSTRATION))
    expect(mockRecordCost.mock.calls[0][2]).toMatchObject({
      model: 'claude-haiku-4-5',
      kind: 'image',
      stopReason: 'end_turn',
      usage: { inputTokens: 2_000, outputTokens: 4_000, cacheReadTokens: 10_000, cacheWriteTokens: 0 },
    })
  })

  it('charges nothing for a picture that failed its check twice, and says it is on us', async () => {
    mockSvg
      .mockResolvedValueOnce(drawn())
      .mockResolvedValueOnce({ kind: 'failed', usage: SVG_USAGE, model: 'claude-haiku-4-5' })
    const response = await POST(post(ILLUSTRATION))
    expect(await response.json()).toMatchObject({ mediaIds: ['media-1'], filtered: 1, warning: AI_MEDIA_OURS_COPY })
    // One picture's tokens, not two.
    expect(mockRecordCost.mock.calls[0][2].usage).toEqual(SVG_USAGE)
  })

  it('hands the reservation back when every picture failed on our side', async () => {
    mockSvg.mockResolvedValue({ kind: 'failed', usage: SVG_USAGE, model: 'claude-haiku-4-5' })
    const response = await POST(post(ILLUSTRATION))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: AI_MEDIA_OURS_COPY, reason: 'ours' })
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockRecordCost).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('answers a real brand’s logo with the decline, recorded as a declined request', async () => {
    mockSvg.mockResolvedValue({
      kind: 'declined',
      reason: 'That is a real company’s logo.',
      usage: NO_USAGE,
      model: 'claude-haiku-4-5',
    })
    const response = await POST(post({ ...ILLUSTRATION, style: 'logo', count: 1 }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'That is a real company’s logo.', reason: 'safety' })
    expect(mockRecordCost.mock.calls[0][2]).toMatchObject({ stopReason: 'refusal', usage: { images: 0 } })
  })

  it('hands the reservation back on a text-provider fault', async () => {
    mockSvg.mockRejectedValue(new AiUpstreamError(529, true, null))
    const response = await POST(post(ILLUSTRATION))
    expect(response.status).toBe(502)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('is not here where no text model is', async () => {
    mockSvgModel = undefined
    expect((await POST(post(ILLUSTRATION))).status).toBe(404)
    expect(mockGate).not.toHaveBeenCalled()
  })
})
