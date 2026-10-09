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

import {
  createPixabayClient,
  isPixabayImageUrl,
  parsePixabayAnswer,
  PIXABAY_LOCAL_PER_MINUTE,
  pixabayLargeSize,
  pixabaySearchParams,
} from './pixabay'
import {
  PIXABAY_CERAMIC_POTTERY_ANSWER,
  PIXABAY_YOGA_STUDIO_ANSWER,
  pixabayResponse,
  TINY_JPEG,
} from '../testing/pixabay-fixtures'

/**
 * The Pixabay wire (AGL-3660), against recorded-shape answers: what is
 * asked, what is kept of an answer, the rate limit, and the image fetch
 * that goes nowhere but Pixabay's image hosts.
 */

const KEY = 'test-key-not-real'

function fakeFetch(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = answers.shift()
    if (!next) throw new Error('no answer queued')
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fn, calls }
}

describe('the Pixabay search request', () => {
  it('asks for safe photos in the canonical form, without the key', () => {
    const params = pixabaySearchParams({
      query: '  Yoga   Studio ',
      orientation: 'horizontal',
      minWidth: 1600.7,
      minHeight: 900,
      people: true,
    })
    expect(Object.fromEntries(params)).toEqual({
      q: 'yoga studio',
      image_type: 'photo',
      orientation: 'horizontal',
      min_width: '1600',
      min_height: '900',
      category: 'people',
      safesearch: 'true',
      order: 'popular',
      per_page: '20',
    })
    expect(params.has('key')).toBe(false)
  })

  it('caps the query at 100 characters and reads any other orientation as all', () => {
    const params = pixabaySearchParams({ query: 'a'.repeat(150), orientation: 'any' })
    expect(params.get('q')).toHaveLength(100)
    expect(params.get('orientation')).toBe('all')
    expect(params.has('min_width')).toBe(false)
  })
})

describe('a Pixabay answer', () => {
  it('keeps each hit with its large copy, its credit and its tags', () => {
    const [first] = parsePixabayAnswer(PIXABAY_YOGA_STUDIO_ANSWER)
    expect(first).toEqual({
      provider: 'pixabay',
      id: '7101001',
      width: 1280,
      height: 853,
      pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
      photographer: 'StudioLight',
      photographerUrl: 'https://pixabay.com/users/StudioLight-101/',
      tags: ['yoga', 'studio', 'woman', 'meditation'],
      downloadUrl: 'https://pixabay.com/get/g7101001large_1280.jpg',
    })
    expect(parsePixabayAnswer(PIXABAY_CERAMIC_POTTERY_ANSWER)).toHaveLength(4)
  })

  it('drops a hit whose image is not on Pixabay, or which lacks an id or a size', () => {
    const base = PIXABAY_YOGA_STUDIO_ANSWER.hits[0]
    expect(
      parsePixabayAnswer({
        hits: [
          { ...base, largeImageURL: 'https://evil.example/x.jpg' },
          { ...base, largeImageURL: 'http://pixabay.com/get/x.jpg' },
          { ...base, id: 'abc' },
          { ...base, imageWidth: 0 },
          { ...base, pageURL: 'https://evil.example/' },
          null,
        ],
      }),
    ).toEqual([])
    expect(parsePixabayAnswer({ nothing: true })).toEqual([])
  })

  it('scales the large copy so its longer edge is at most 1280', () => {
    expect(pixabayLargeSize(4000, 6000)).toEqual({ width: 853, height: 1280 })
    expect(pixabayLargeSize(1000, 800)).toEqual({ width: 1000, height: 800 })
  })

  it('knows its image hosts and nothing else', () => {
    expect(isPixabayImageUrl('https://cdn.pixabay.com/photo/a.jpg')).toBe(true)
    expect(isPixabayImageUrl('https://pixabay.com/get/a.jpg')).toBe(true)
    expect(isPixabayImageUrl('https://pixabay.com.evil.example/a.jpg')).toBe(false)
    expect(isPixabayImageUrl('https://user:pw@pixabay.com/a.jpg')).toBe(false)
    expect(isPixabayImageUrl('ftp://pixabay.com/a.jpg')).toBe(false)
  })
})

describe('the Pixabay client', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('is unconfigured and asks nothing without a key', async () => {
    const { fn, calls } = fakeFetch([])
    const client = createPixabayClient({ apiKey: () => '', fetch: fn })
    expect(client.configured()).toBe(false)
    expect(await client.search({ query: 'yoga studio' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('searches the API with the key and parses the hits', async () => {
    const { fn, calls } = fakeFetch([pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER)])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
    const photos = await client.search({ query: 'yoga studio', orientation: 'horizontal' })
    expect(photos?.map((photo) => photo.id)).toHaveLength(6)
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe('https://pixabay.com/api/')
    expect(url.searchParams.get('key')).toBe(KEY)
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(calls[0].init?.redirect).toBe('error')
  })

  it('answers null on a refusal or a network failure, and never logs the key', async () => {
    const { fn } = fakeFetch([
      pixabayResponse('[ERROR 400] "key" is invalid', { status: 400 }),
      new Error(`connect failed for https://pixabay.com/api/?key=${KEY}`),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
    expect(await client.search({ query: 'yoga' })).toBeNull()
    expect(await client.search({ query: 'yoga' })).toBeNull()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY)
  })

  it('stops asking when the window is nearly spent, until it resets', async () => {
    let now = 1_000_000
    const { fn, calls } = fakeFetch([
      pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER, { remaining: 5, reset: 30 }),
      pixabayResponse(PIXABAY_YOGA_STUDIO_ANSWER, { remaining: 99, reset: 60 }),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn, now: () => now })
    expect(await client.search({ query: 'yoga' })).not.toBeNull()
    expect(client.rateLimited()).toBe(true)
    expect(await client.search({ query: 'pottery' })).toBeNull()
    expect(calls).toHaveLength(1)
    now += 31_000
    expect(await client.search({ query: 'pottery' })).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('stops for the window a 429 names', async () => {
    let now = 0
    const { fn, calls } = fakeFetch([
      pixabayResponse('API rate limit exceeded', { status: 429, remaining: 0, reset: 45 }),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn, now: () => now })
    expect(await client.search({ query: 'yoga' })).toBeNull()
    now += 44_000
    expect(await client.search({ query: 'yoga' })).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('keeps its own count when no header says otherwise', async () => {
    const answers = Array.from({ length: PIXABAY_LOCAL_PER_MINUTE }, () =>
      pixabayResponse({ hits: [] }, { headers: {} }),
    )
    for (const answer of answers) answer.headers.delete('x-ratelimit-remaining')
    const { fn, calls } = fakeFetch(answers)
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn, now: () => 5 })
    for (let index = 0; index < PIXABAY_LOCAL_PER_MINUTE; index += 1) {
      await client.search({ query: `q${index}` })
    }
    expect(await client.search({ query: 'one more' })).toBeNull()
    expect(calls).toHaveLength(PIXABAY_LOCAL_PER_MINUTE)
  })

  it('downloads an image from Pixabay, following a redirect between its hosts', async () => {
    const { fn, calls } = fakeFetch([
      new Response(null, { status: 302, headers: { location: 'https://cdn.pixabay.com/photo/a_1280.jpg' } }),
      new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
    const got = await client.download('https://pixabay.com/get/a_1280.jpg', { maxBytes: 1_000_000 })
    expect(got?.contentType).toBe('image/jpeg')
    expect(got?.bytes.length).toBe(TINY_JPEG.length)
    expect(calls.map((call) => call.url)).toEqual([
      'https://pixabay.com/get/a_1280.jpg',
      'https://cdn.pixabay.com/photo/a_1280.jpg',
    ])
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true)
    // The key never rides an image request.
    expect(calls.some((call) => call.url.includes(KEY))).toBe(false)
  })

  it('refuses to fetch anywhere but Pixabay, a redirect included', async () => {
    const { fn, calls } = fakeFetch([
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
    expect(await client.download('https://internal.example/a.jpg', { maxBytes: 10 })).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await client.download('https://pixabay.com/get/a.jpg', { maxBytes: 10 })).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('refuses what is not an image, or is larger than asked', async () => {
    const { fn } = fakeFetch([
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      new Response(TINY_JPEG, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '99999' },
      }),
      new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    ])
    const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
    const url = 'https://cdn.pixabay.com/photo/a.jpg'
    expect(await client.download(url, { maxBytes: 1_000_000 })).toBeNull()
    expect(await client.download(url, { maxBytes: 1_000 })).toBeNull()
    expect(await client.download(url, { maxBytes: 10 })).toBeNull()
  })
})
