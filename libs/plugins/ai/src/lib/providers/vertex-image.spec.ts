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
 * - OFF UNTIL NAMED. No project, no provider.
 * - THE REQUEST IS EXACTLY WHAT THE DOCS SAY IS SENT: the description and the
 *   shape, one picture per request, image-only, 1K, thinking HIGH, and the
 *   four harm categories at "block some".
 * - A DECLINE IS TYPED. A blocked prompt, a withheld picture or a model that
 *   answered in words is an `AiImageSafetyRefusal`; a fault is an
 *   `AiUpstreamError`.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({}) },
}))

import { AiUpstreamError } from './contract'
import { AiImageSafetyRefusal } from './image-contract'
import {
  createVertexImageProvider,
  parseVertexImageAnswer,
  VERTEX_IMAGE_DEFAULT_LOCATION,
  VERTEX_IMAGE_DEFAULT_MODEL,
  vertexImageLocation,
  vertexImageModel,
  vertexImageProject,
} from './vertex-image'

const ENV = ['AI_IMAGE_VERTEX_PROJECT', 'AI_IMAGE_VERTEX_LOCATION', 'AI_IMAGE_MODEL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of ENV) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

const answer = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const picture = (data = 'AAAA', usage = { promptTokenCount: 12, thoughtsTokenCount: 300 }) => ({
  candidates: [
    {
      content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data } }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { ...usage, candidatesTokenCount: 1120 },
})

function provider(fetchImpl: jest.Mock) {
  return createVertexImageProvider({
    fetch: fetchImpl as unknown as typeof fetch,
    accessToken: async () => 'sa-token',
  })
}

const REQUEST = {
  model: 'gemini-3.1-flash-image',
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

  it('defaults to Gemini 3.1 Flash Image on the global endpoint, and takes an operator’s', () => {
    expect(VERTEX_IMAGE_DEFAULT_MODEL).toBe('gemini-3.1-flash-image')
    expect(vertexImageLocation()).toBe(VERTEX_IMAGE_DEFAULT_LOCATION)
    expect(provider(jest.fn()).endpointHost()).toBe('aiplatform.googleapis.com')
    expect(vertexImageModel()).toBe('gemini-3.1-flash-image')
    process.env['AI_IMAGE_VERTEX_LOCATION'] = 'us-central1'
    process.env['AI_IMAGE_MODEL'] = 'gemini-3-pro-image'
    expect(vertexImageLocation()).toBe('us-central1')
    expect(vertexImageModel()).toBe('gemini-3-pro-image')
    expect(provider(jest.fn()).endpointHost()).toBe('us-central1-aiplatform.googleapis.com')
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

  it('posts one :generateContent per picture, as the service account', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => answer(picture()))
    const result = await provider(fetchImpl).generate(REQUEST)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/aglyn-main/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent',
    )
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sa-token')
    expect(JSON.parse(init.body)).toEqual({
      contents: [{ role: 'USER', parts: [{ text: 'A red barn at dawn' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        candidateCount: 1,
        imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    })
    expect(result).toEqual({
      model: 'gemini-3.1-flash-image',
      images: [
        { base64: 'AAAA', mimeType: 'image/png' },
        { base64: 'AAAA', mimeType: 'image/png' },
      ],
      filtered: 0,
      // The prompt and the thinking, never the picture's own tokens.
      usage: { inputTokens: 24, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it('never makes more than four, whatever it is handed', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => answer(picture()))
    await provider(fetchImpl).generate({ ...REQUEST, count: 40 })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})

describe('declines and faults', () => {
  beforeEach(() => {
    process.env['AI_IMAGE_VERTEX_PROJECT'] = 'aglyn-main'
  })

  it('counts a picture the filter withheld, and returns the rest', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(async () => answer(picture()))
      .mockImplementationOnce(async () => answer({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }))
    const result = await provider(fetchImpl).generate(REQUEST)
    expect(result.images).toHaveLength(1)
    expect(result.filtered).toBe(1)
  })

  it('throws a typed refusal for a blocked prompt, a withheld picture, or words instead of a picture', async () => {
    const blocked = await provider(
      jest.fn().mockImplementation(async () => answer({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })),
    )
      .generate({ ...REQUEST, count: 1 })
      .catch((caught) => caught)
    expect(blocked).toBeInstanceOf(AiImageSafetyRefusal)
    expect(blocked.reasons).toEqual(['PROHIBITED_CONTENT'])

    const words = await provider(
      jest.fn().mockImplementation(async () =>
        answer({ candidates: [{ content: { parts: [{ text: 'I can’t make that.' }] }, finishReason: 'STOP' }] }),
      ),
    )
      .generate({ ...REQUEST, count: 1 })
      .catch((caught) => caught)
    expect(words).toBeInstanceOf(AiImageSafetyRefusal)
  })

  it('maps a 5xx to a retryable upstream error, and a 403 to a credential problem', async () => {
    const server = await provider(jest.fn().mockImplementation(async () => answer('oops', 503)))
      .generate(REQUEST)
      .catch((caught) => caught)
    expect(server).toBeInstanceOf(AiUpstreamError)
    expect(server.retryable).toBe(true)

    const denied = await provider(jest.fn().mockImplementation(async () => answer('denied', 403)))
      .generate(REQUEST)
      .catch((caught) => caught)
    expect(denied).toBeInstanceOf(AiUpstreamError)
    expect(denied.accountProblem).toBe('credentials')
  })

  it('keeps what came back when one of the requests failed', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(async () => answer(picture()))
      .mockImplementationOnce(async () => answer('oops', 500))
    const result = await provider(fetchImpl).generate(REQUEST)
    expect(result.images).toHaveLength(1)
    expect(result.filtered).toBe(1)
  })

  it('maps no answer at all to a retryable upstream error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('socket hang up'))
    const error = await provider(fetchImpl).generate(REQUEST).catch((caught) => caught)
    expect(error).toBeInstanceOf(AiUpstreamError)
    expect(error.retryable).toBe(true)
  })

  it('drops a part in a type the library would not take', () => {
    expect(
      parseVertexImageAnswer({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/gif', data: 'AAAA' } }] }, finishReason: 'STOP' }],
      }).image,
    ).toBeNull()
  })
})
