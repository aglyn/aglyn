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
  PIXABAY_DOWNLOAD_RETRIES,
  PIXABAY_DOWNLOADS_AT_ONCE,
  PIXABAY_LOCAL_PER_MINUTE,
  pixabayLargeSize,
  pixabayRetryAfterMs,
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
      per_page: '40',
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
      previewUrl: 'https://pixabay.com/get/g7101001web_340.jpg',
    })
    expect(parsePixabayAnswer(PIXABAY_CERAMIC_POTTERY_ANSWER)).toHaveLength(4)
  })

  it("keeps a hit's small copy at the preview size, only on Pixabay's hosts (AGL-4066)", () => {
    const base = PIXABAY_YOGA_STUDIO_ANSWER.hits[0]
    const [offHost, unsized, none] = parsePixabayAnswer({
      hits: [
        { ...base, webformatURL: 'https://evil.example/x_640.jpg' },
        { ...base, webformatURL: 'https://cdn.pixabay.com/photo/x.jpg' },
        { ...base, webformatURL: undefined },
      ],
    })
    expect(offHost.previewUrl).toBeUndefined()
    expect(unsized.previewUrl).toBe('https://cdn.pixabay.com/photo/x.jpg')
    expect(none).not.toHaveProperty('previewUrl')
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

  it('says why a download failed, by host and status, never by its signed address (AGL-3923)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { fn } = fakeFetch([
        new Response('blocked', { status: 403, headers: { server: 'cloudflare', 'cf-ray': 'abc-IAD' } }),
        new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/a.jpg' } }),
        new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ])
      const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
      const signed = 'https://pixabay.com/get/g5aaf9c_signed_1280.jpg'
      expect(await client.download(signed, { maxBytes: 1_000_000 })).toBeNull()
      expect(await client.download(signed, { maxBytes: 1_000_000 })).toBeNull()
      expect(await client.download(signed, { maxBytes: 1_000_000 })).toBeNull()
      expect(warn.mock.calls.map(([message, detail]) => [message, (detail as { reason: string }).reason])).toEqual([
        ['pixabay: a photo download failed', 'status'],
        ['pixabay: a photo download failed', 'host'],
        ['pixabay: a photo download failed', 'type'],
      ])
      expect(warn.mock.calls[0]?.[1]).toMatchObject({ status: 403, host: 'pixabay.com', server: 'cloudflare', ray: true })
      expect(warn.mock.calls[1]?.[1]).toMatchObject({ host: 'elsewhere.example', hop: 1 })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('g5aaf9c_signed')
    } finally {
      warn.mockRestore()
    }
  })

  it('says a download timed out or could not connect', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const fn = (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
      const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
      expect(await client.download('https://cdn.pixabay.com/photo/a.jpg', { maxBytes: 10 })).toBeNull()
      expect(warn.mock.calls[0]?.[1]).toMatchObject({ reason: 'network', host: 'cdn.pixabay.com' })
    } finally {
      warn.mockRestore()
    }
  })

  it('names a photo by what its bytes are, never by its label (AGL-3923)', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // Pixabay 10157445, the beta.267 Brightvale hero's pick: labeled image/png, its bytes another format.
      const webp = Uint8Array.from([...Buffer.from('RIFF'), 0x24, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 0, 0, 0, 0])
      const wave = Uint8Array.from([...Buffer.from('RIFF'), 0x24, 0, 0, 0, ...Buffer.from('WAVEfmt '), 0, 0, 0, 0])
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
      const { fn } = fakeFetch([
        new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/png' } }),
        new Response(webp, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
        new Response(png, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        new Response(wave, { status: 200, headers: { 'content-type': 'image/webp' } }),
      ])
      const client = createPixabayClient({ apiKey: () => KEY, fetch: fn })
      const url = 'https://pixabay.com/get/g56a761e2_signed_1280.png'
      expect((await client.download(url, { maxBytes: 1_000_000 }))?.contentType).toBe('image/jpeg')
      expect((await client.download(url, { maxBytes: 1_000_000 }))?.contentType).toBe('image/webp')
      expect((await client.download(url, { maxBytes: 1_000_000 }))?.contentType).toBe('image/png')
      // A RIFF file that is no WebP is no photo, whatever it is labeled.
      expect(await client.download(url, { maxBytes: 1_000_000 })).toBeNull()
      expect(info.mock.calls.map(([, detail]) => detail)).toEqual([
        { declared: 'image/png', sniffed: 'image/jpeg' },
        { declared: 'image/jpeg', sniffed: 'image/webp' },
        { declared: 'application/octet-stream', sniffed: 'image/png' },
      ])
      expect(warn.mock.calls[0]).toEqual(['pixabay: a photo download failed', { reason: 'type', declared: 'image/webp', sniffed: null, status: 200 }])
      expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain('g56a761e2_signed')
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
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

  /*
   * The beta.270 Sugar Hollow Photography start (2026-10-19 19:03Z, AGL-3988):
   * pixabay.com's Cloudflare answered 429 to 12 downloads of its dataset's
   * covers inside 200 ms, then to every pick of its home and contact pages,
   * and each slot ran through its three picks in the same burst.
   */
  describe('a burst the image hosts refuse (AGL-3988)', () => {
    const limited = (headers: Record<string, string> = {}) =>
      new Response('rate limited', { status: 429, headers: { server: 'cloudflare', 'cf-ray': 'x-IAD', ...headers } })
    const photo = () => new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })

    it('waits out a 429 and asks again, as long as the answer asks, and then copies the photo', async () => {
      const waits: number[] = []
      const { fn, calls } = fakeFetch([limited({ 'retry-after': '2' }), limited(), photo()])
      let clock = 1_000_000
      const client = createPixabayClient({
        apiKey: () => KEY,
        fetch: fn,
        now: () => clock,
        sleep: async (ms) => {
          waits.push(ms)
          clock += ms
        },
      })
      const got = await client.download('https://pixabay.com/get/a_1280.jpg', { maxBytes: 1_000_000 })
      expect(got?.contentType).toBe('image/jpeg')
      expect(calls).toHaveLength(3)
      // The answer's own two seconds, then the doubling backoff's second try.
      expect(waits).toEqual([2_000, 2_000])
    })

    it('gives up after its retries and says so, by status and the tries it took', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const answers = Array.from({ length: PIXABAY_DOWNLOAD_RETRIES + 1 }, () => limited())
        const { fn, calls } = fakeFetch(answers)
        const client = createPixabayClient({ apiKey: () => KEY, fetch: fn, sleep: async () => undefined })
        expect(await client.download('https://pixabay.com/get/g5aaf9c_signed_1280.jpg', { maxBytes: 1_000_000 })).toBeNull()
        expect(calls).toHaveLength(PIXABAY_DOWNLOAD_RETRIES + 1)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]).toEqual([
          'pixabay: a photo download failed',
          { reason: 'status', status: 429, host: 'pixabay.com', server: 'cloudflare', ray: true, attempts: PIXABAY_DOWNLOAD_RETRIES + 1 },
        ])
        expect(JSON.stringify(warn.mock.calls)).not.toContain('g5aaf9c_signed')
      } finally {
        warn.mockRestore()
      }
    })

    it('never asks again once the caller’s time is up', async () => {
      const controller = new AbortController()
      const { fn, calls } = fakeFetch([limited(), photo()])
      const client = createPixabayClient({
        apiKey: () => KEY,
        fetch: fn,
        sleep: async () => controller.abort(),
      })
      expect(await client.download('https://pixabay.com/get/a_1280.jpg', { maxBytes: 1_000_000, signal: controller.signal })).toBeNull()
      expect(calls).toHaveLength(1)
    })

    it('fetches a few photos at a time, and a 429 holds every download of the process', async () => {
      let open = 0
      let most = 0
      let first = true
      const releases: Array<() => void> = []
      const fn = (async () => {
        open += 1
        most = Math.max(most, open)
        await new Promise<void>((resolve) => releases.push(resolve))
        open -= 1
        if (first) {
          first = false
          return limited({ 'retry-after': '1' })
        }
        return photo()
      }) as unknown as typeof fetch
      const waits: number[] = []
      let clock = 0
      const client = createPixabayClient({
        apiKey: () => KEY,
        fetch: fn,
        now: () => clock,
        sleep: async (ms) => {
          waits.push(ms)
          clock += ms
        },
      })
      const downloads = Array.from({ length: 5 }, (_, index) =>
        client.download(`https://pixabay.com/get/p${index}_1280.jpg`, { maxBytes: 1_000_000 }),
      )
      // Release each fetch as it is asked, until every download has answered.
      let settled = false
      const all = Promise.all(downloads).then((value) => {
        settled = true
        return value
      })
      while (!settled) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        releases.shift()?.()
      }
      const got = await all
      expect(got.every((one) => one?.contentType === 'image/jpeg')).toBe(true)
      expect(most).toBe(PIXABAY_DOWNLOADS_AT_ONCE)
      // The first 429's one second was waited by the downloads that started after it.
      expect(waits.length).toBeGreaterThanOrEqual(1)
      expect(waits[0]).toBe(1_000)
    })

    it('reads a Retry-After in seconds or as a date', () => {
      expect(pixabayRetryAfterMs('3', 0)).toBe(3_000)
      expect(pixabayRetryAfterMs('0.5', 0)).toBe(500)
      expect(pixabayRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6_000)
      expect(pixabayRetryAfterMs('', 0)).toBeNull()
      expect(pixabayRetryAfterMs(null, 0)).toBeNull()
      expect(pixabayRetryAfterMs('soon', 0)).toBeNull()
    })
  })
})
