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
 * The Vertex AI image adapter (AGL-3602), against a stand-in network — no
 * spec here reaches Google.
 *
 * - OFF UNTIL NAMED. No project, no provider: a self-hosted deployment does
 *   not reach Vertex AI until its operator names a project.
 * - THE REQUEST IS EXACTLY WHAT THE DOCS SAY IS SENT: the description, the
 *   shape and the count, with the safety filter at "block some", no pictures
 *   of children, the watermark on and the description left as written.
 * - A DECLINE IS TYPED. Every picture held back, or a description refused
 *   outright, is an `AiImageSafetyRefusal`; a fault is an `AiUpstreamError`.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({}) },
}))

import { AiUpstreamError } from './contract'
import { AiImageSafetyRefusal } from './image-contract'
import {
  createVertexImageProvider,
  parseVertexImagePredictions,
  VERTEX_IMAGE_DEFAULT_LOCATION,
  VERTEX_IMAGE_DEFAULT_MODEL,
  vertexImageLocation,
  vertexImageModel,
  vertexImageProject,
} from './vertex-imagen'

const ENV = ['AI_IMAGE_VERTEX_PROJECT', 'AI_IMAGE_VERTEX_LOCATION', 'AI_IMAGE_MODEL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of ENV) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
})
afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

function provider(fetchImpl: jest.Mock) {
  return createVertexImageProvider({
    fetch: fetchImpl as unknown as typeof fetch,
    accessToken: async () => 'sa-token',
  })
}

const REQUEST = {
  model: 'imagen-4.0-generate-001',
  prompt: 'A red barn at dawn',
  aspectRatio: '16:9' as const,
  count: 2,
}

describe('configuration', () => {
  it('is off until a project is named, and ignores a malformed one', () => {
    expect(provider(jest.fn()).configured()).toBe(false)
    process.env['AI_IMAGE_VERTEX_PROJECT'] = 'Not A Project!'
    expect(vertexImageProject()).toBeNull()
    process.env['AI_IMAGE_VERTEX_PROJECT'] = 'aglyn-main'
    expect(provider(jest.fn()).configured()).toBe(true)
  })

  it('defaults the region and the model, and takes an operator’s', () => {
    expect(vertexImageLocation()).toBe(VERTEX_IMAGE_DEFAULT_LOCATION)
    expect(vertexImageModel()).toBe(VERTEX_IMAGE_DEFAULT_MODEL)
    process.env['AI_IMAGE_VERTEX_LOCATION'] = 'europe-west4'
    process.env['AI_IMAGE_MODEL'] = 'imagen-4.0-fast-generate-001'
    expect(vertexImageLocation()).toBe('europe-west4')
    expect(vertexImageModel()).toBe('imagen-4.0-fast-generate-001')
    expect(provider(jest.fn()).endpointHost()).toBe('europe-west4-aiplatform.googleapis.com')
  })

  it('refuses to call out with no project, before touching the network', async () => {
    const fetchImpl = jest.fn()
    await expect(provider(fetchImpl).generate(REQUEST)).rejects.toBeInstanceOf(AiUpstreamError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the request', () => {
  beforeEach(() => {
    process.env['AI_IMAGE_VERTEX_PROJECT'] = 'aglyn-main'
  })

  it('posts the description, shape and count to the model’s :predict, as the service account', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      answer({
        predictions: [
          { mimeType: 'image/jpeg', bytesBase64Encoded: 'AAAA' },
          { mimeType: 'image/jpeg', bytesBase64Encoded: 'BBBB' },
        ],
      }),
    )
    const result = await provider(fetchImpl).generate(REQUEST)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/aglyn-main/locations/us-central1/publishers/google/models/imagen-4.0-generate-001:predict',
    )
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sa-token')
    expect(JSON.parse(init.body)).toEqual({
      instances: [{ prompt: 'A red barn at dawn' }],
      parameters: {
        sampleCount: 2,
        aspectRatio: '16:9',
        safetySetting: 'block_medium_and_above',
        personGeneration: 'allow_adult',
        addWatermark: true,
        enhancePrompt: false,
        includeRaiReason: true,
        outputOptions: { mimeType: 'image/jpeg', compressionQuality: 90 },
      },
    })
    expect(result).toEqual({
      model: 'imagen-4.0-generate-001',
      images: [
        { base64: 'AAAA', mimeType: 'image/jpeg' },
        { base64: 'BBBB', mimeType: 'image/jpeg' },
      ],
      filtered: 0,
    })
  })

  it('never asks for more than four, whatever it is handed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      answer({ predictions: [{ mimeType: 'image/png', bytesBase64Encoded: 'AAAA' }] }),
    )
    await provider(fetchImpl).generate({ ...REQUEST, count: 40 })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).parameters.sampleCount).toBe(4)
  })
})

describe('declines and faults', () => {
  beforeEach(() => {
    process.env['AI_IMAGE_VERTEX_PROJECT'] = 'aglyn-main'
  })

  it('counts a picture the filter held back, and returns the rest', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      answer({
        predictions: [
          { mimeType: 'image/jpeg', bytesBase64Encoded: 'AAAA' },
          { raiFilteredReason: '56562880' },
        ],
      }),
    )
    const result = await provider(fetchImpl).generate(REQUEST)
    expect(result.images).toHaveLength(1)
    expect(result.filtered).toBe(1)
  })

  it('throws a typed refusal when every picture was held back', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      answer({ predictions: [{ raiFilteredReason: '39322892' }, { raiFilteredReason: '39322892' }] }),
    )
    const error = await provider(fetchImpl).generate(REQUEST).catch((caught) => caught)
    expect(error).toBeInstanceOf(AiImageSafetyRefusal)
    expect((error as AiImageSafetyRefusal).reasons).toEqual(['39322892', '39322892'])
  })

  it('throws a typed refusal when the answer holds no picture at all', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(answer({}))
    await expect(provider(fetchImpl).generate(REQUEST)).rejects.toBeInstanceOf(AiImageSafetyRefusal)
  })

  it('reads a 400 naming the responsible-AI policy as a decline, not a fault', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        answer({ error: { message: 'Image generation failed with the following error: The prompt could not be submitted. Responsible AI practices.' } }, 400),
      )
    await expect(provider(fetchImpl).generate(REQUEST)).rejects.toBeInstanceOf(AiImageSafetyRefusal)
  })

  it('maps a 5xx to a retryable upstream error, and a 403 to a credential problem', async () => {
    const server = await provider(jest.fn().mockResolvedValue(answer('oops', 503)))
      .generate(REQUEST)
      .catch((caught) => caught)
    expect(server).toBeInstanceOf(AiUpstreamError)
    expect(server.retryable).toBe(true)
    expect(server.accountProblem).toBeNull()

    const denied = await provider(jest.fn().mockResolvedValue(answer('denied', 403)))
      .generate(REQUEST)
      .catch((caught) => caught)
    expect(denied).toBeInstanceOf(AiUpstreamError)
    expect(denied.retryable).toBe(false)
    expect(denied.accountProblem).toBe('credentials')
  })

  it('maps no answer at all to a retryable upstream error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('socket hang up'))
    const error = await provider(fetchImpl).generate(REQUEST).catch((caught) => caught)
    expect(error).toBeInstanceOf(AiUpstreamError)
    expect(error.retryable).toBe(true)
  })

  it('drops a prediction in a type the library would not take', () => {
    expect(
      parseVertexImagePredictions({
        predictions: [{ mimeType: 'image/gif', bytesBase64Encoded: 'AAAA' }, null, 'x'],
      }),
    ).toEqual({ images: [], filteredReasons: [] })
  })
})
