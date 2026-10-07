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
 * the provider and the upload route stood in.
 *
 * - NOT HERE UNTIL CONFIGURED: no provider, no door, and nothing read first.
 * - RESERVED BEFORE SPENT, AND HANDED BACK when nothing was made or kept.
 * - A WALL IS NOT RUN PAST: a Free workspace asking for more pictures than
 *   its credits cover is refused before the provider is called.
 * - SETTLED ON WHAT WAS STORED, at the billed per-picture rate.
 * - STORED THROUGH THE UPLOAD ROUTE, as the caller, then given alt text and
 *   a record of how it was made.
 */

const mockGate = jest.fn()
const mockReadGate = jest.fn()
const mockRelease = jest.fn()
const mockRecordCost = jest.fn()
let mockCredits: { used: number; limit: number; remaining: number } | null = null
const mockProvider = {
  id: 'google-vertex',
  label: 'Google Vertex AI',
  defaultModel: jest.fn(() => 'imagen-4.0-generate-001'),
  configured: jest.fn(() => true),
  endpointHost: () => 'us-central1-aiplatform.googleapis.com',
  generate: jest.fn(),
}

jest.mock('../runtime/ai-gate', () => ({ aiGateLadder: (...args: unknown[]) => mockGate(...args) }))
jest.mock('./ai-jobs-gate', () => ({ aiJobsGate: (...args: unknown[]) => mockReadGate(...args) }))
jest.mock('../providers/vertex-imagen', () => ({
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
import {
  aiImageAltText,
  aiImageCreditsPerImage,
  aiImageFileName,
  GET,
  POST,
} from './ai-media-image'

/** Every `update` a stored picture's document received, by path. */
const updates: Array<{ path: string; data: Record<string, unknown> }> = []

function fakeFirestore() {
  const ref = (path: string): any => ({
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
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
  prompt: 'a red barn at dawn',
  aspectRatio: '16:9',
  count: 2,
}

const image = (base64: string) => ({ base64, mimeType: 'image/jpeg' })

let mockFetch: jest.Mock
let uploadCount = 0

beforeEach(() => {
  jest.clearAllMocks()
  // The door logs its faults for the operator; the assertions read the answers.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  updates.length = 0
  uploadCount = 0
  mockCredits = null
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
  it('prices a picture in credits from the billed rate', () => {
    expect(aiImageCreditsPerImage('imagen-4.0-generate-001')).toBe(60)
    expect(aiImageCreditsPerImage('imagen-4.0-fast-generate-001')).toBe(30)
  })

  it('writes alt text from the description, inside the library’s limit', () => {
    expect(aiImageAltText('a red barn at dawn')).toBe('A red barn at dawn')
    const long = aiImageAltText(`a field ${'of tall golden wheat '.repeat(40)}`)
    expect(long.length).toBeLessThanOrEqual(300)
    expect(long.endsWith('…')).toBe(true)
  })

  it('names a file from the description’s first words', () => {
    expect(aiImageFileName('A red barn, at dawn!', 1, 'image/jpeg')).toBe('ai-a-red-barn-at-dawn-2.jpg')
    expect(aiImageFileName('???', 0, 'image/png')).toBe('ai-image-1.png')
  })
})

describe('GET — the button’s verdict', () => {
  const get = () => new Request('https://console.example.com/api/ai/media/images?orgId=org-1')

  it('passes a gate refusal through as it is', async () => {
    mockReadGate.mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }))
    expect((await GET(get())).status).toBe(404)
  })

  it('is a 404 when no image provider is configured', async () => {
    mockReadGate.mockResolvedValue(admitted())
    mockProvider.configured.mockReturnValue(false)
    expect((await GET(get())).status).toBe(404)
  })

  it('answers the model, the shapes, the ceiling and the credits per picture', async () => {
    mockReadGate.mockResolvedValue(admitted())
    const response = await GET(get())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      model: { id: 'imagen-4.0-generate-001', label: 'Imagen 4' },
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      maxCount: 4,
      creditsPerImage: 60,
    })
    expect(mockReadGate.mock.calls[0][1]).toBe('org-1')
  })
})

describe('POST — gates and refusals before anything is spent', () => {
  it('is a 404 with no provider, before the ladder reads anything', async () => {
    mockProvider.configured.mockReturnValue(false)
    expect((await POST(post(BODY))).status).toBe(404)
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('climbs the generative ladder for the named org and site', async () => {
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A')], filtered: 0 })
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
  ])('refuses %p with a 400 and hands the reservation back', async (patch, message) => {
    const response = await POST(post({ ...BODY, ...patch }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(message)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockProvider.generate).not.toHaveBeenCalled()
  })

  it('refuses a Free workspace whose credits do not cover the pictures, before the provider', async () => {
    mockGate.mockResolvedValue(admitted({ plan: 'free' }))
    mockCredits = { used: 220, limit: 300, remaining: 80 }
    const response = await POST(post(BODY))
    expect(response.status).toBe(429)
    expect((await response.json()).error).toMatch(/needs 120 credits.*80 left/)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockProvider.generate).not.toHaveBeenCalled()
  })

  it('lets a plan that buys past its band through, whatever is left in it', async () => {
    mockCredits = { used: 2_700, limit: 2_750, remaining: 50 }
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A')], filtered: 0 })
    expect((await POST(post(BODY))).status).toBe(200)
  })
})

describe('POST — the provider', () => {
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

  it('records a declined description at zero credits, as a declined request', async () => {
    mockProvider.generate.mockRejectedValue(new AiImageSafetyRefusal(['39322892']))
    const response = await POST(post(BODY))
    expect(response.status).toBe(422)
    expect((await response.json()).reason).toBe('safety')
    expect(mockRelease).not.toHaveBeenCalled()
    const [, orgId, record] = mockRecordCost.mock.calls[0]
    expect(orgId).toBe('org-1')
    expect(record).toMatchObject({ stopReason: 'refusal', kind: 'image', usage: { images: 0 } })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('POST — stored through the upload route, settled on what was stored', () => {
  it('posts each picture to /api/media/upload as the caller, into the open folder', async () => {
    mockProvider.generate.mockResolvedValue({
      model: 'imagen-4.0-generate-001',
      images: [image('AAAA'), image('BBBB')],
      filtered: 0,
    })
    const response = await POST(post(BODY))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mediaIds: ['media-1', 'media-2'], filtered: 0, failed: 0, credits: 120 })
    expect(mockProvider.generate).toHaveBeenCalledWith({
      model: 'imagen-4.0-generate-001',
      prompt: 'a red barn at dawn',
      aspectRatio: '16:9',
      count: 2,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe('https://console.example.com/api/media/upload')
    expect(init.headers.Authorization).toBe('Bearer user-token')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      fileName: 'ai-a-red-barn-at-dawn-1.jpg',
      contentType: 'image/jpeg',
      folderId: 'folder-9',
      data: 'AAAA',
    })
  })

  it('sends an org library’s scope, with the site on screen for its default sharing', async () => {
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A')], filtered: 0 })
    await POST(post({ ...BODY, library: 'org', hostId: 'host-1' }))
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.orgId).toBe('org-1')
    expect(body.forHostId).toBe('host-1')
    expect(body.hostId).toBeUndefined()
    expect(updates[0].path).toBe('orgs/org-1/media/media-1')
  })

  it('settles the stored pictures at the per-picture rate, on the image kind', async () => {
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A'), image('B')], filtered: 0 })
    await POST(post(BODY))
    expect(mockRecordCost).toHaveBeenCalledTimes(1)
    const [, , record] = mockRecordCost.mock.calls[0]
    expect(record).toMatchObject({
      model: 'imagen-4.0-generate-001',
      kind: 'image',
      uid: 'u1',
      hostId: 'host-1',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, images: 2 },
    })
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('writes the alt text and the provenance onto each stored document', async () => {
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A')], filtered: 0 })
    await POST(post(BODY))
    expect(updates).toHaveLength(1)
    expect(updates[0].path).toBe('hosts/host-1/media/media-1')
    expect(updates[0].data).toMatchObject({
      alt: 'A red barn at dawn',
      hasAlt: true,
      aiGenerated: {
        model: 'imagen-4.0-generate-001',
        prompt: 'a red barn at dawn',
        aspectRatio: '16:9',
        signalId: 'signal-1',
        generatedBy: 'u1',
      },
    })
  })

  it('charges only for what the library kept, and reports the rest', async () => {
    mockProvider.generate.mockResolvedValue({
      model: 'imagen-4.0-generate-001',
      images: [image('A'), image('B')],
      filtered: 1,
    })
    mockFetch
      .mockImplementationOnce(async () => new Response(JSON.stringify({ mediaId: 'media-1' }), { status: 200 }))
      .mockImplementationOnce(
        async () => new Response(JSON.stringify({ error: 'Storage limit reached (250 MB)' }), { status: 402 }),
      )
    const response = await POST(post({ ...BODY, count: 3 }))
    expect(await response.json()).toEqual({
      mediaIds: ['media-1'],
      filtered: 1,
      failed: 1,
      credits: 60,
      warning: 'Storage limit reached (250 MB)',
    })
    expect(mockRecordCost.mock.calls[0][2].usage.images).toBe(1)
  })

  it('hands the reservation back and answers the library’s refusal when nothing was kept', async () => {
    mockProvider.generate.mockResolvedValue({ model: 'imagen-4.0-generate-001', images: [image('A')], filtered: 0 })
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
