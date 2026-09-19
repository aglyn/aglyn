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

import { mintDeliveryToken } from '../delivery-token'
import type { R2BucketBinding } from './r2-binding'
import worker, { handleVideoRequest, parseByteRange } from './video-worker'

/**
 * The delivery Worker's fetch handler (AGL-2824), driven with real `Request`
 * objects and a bucket binding faked in memory. The tokens are minted by the
 * same module the platform mints with.
 */

const SECRET = 'f'.repeat(64)
const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const KEY = 'hosts/host-1/med-film/0123456789abcdef/master/0123456789abcdef'
const OTHER_KEY = 'hosts/host-1/med-other/fedcba9876543210/master/fedcba9876543210'
const FILM = '0123456789ABCDEFGHIJ' // 20 bytes

function fakeBucket(objects: Record<string, string>): R2BucketBinding & { gets: unknown[] } {
  const gets: unknown[] = []
  const meta = (key: string) => ({
    key,
    size: new TextEncoder().encode(objects[key]).length,
    httpEtag: `"etag-${key.length}"`,
    httpMetadata: { contentType: 'video/mp4' },
  })
  return {
    gets,
    head: async (key) => (key in objects ? meta(key) : null),
    get: async (key, options) => {
      gets.push({ key, ...(options ?? {}) })
      if (!(key in objects)) return null
      const bytes = new TextEncoder().encode(objects[key])
      const range = options?.range
      const slice = range
        ? bytes.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length)
        : bytes
      return {
        ...meta(key),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(slice)
            controller.close()
          },
        }),
      }
    },
  }
}

async function tokenFor(
  key: string,
  overrides: { expiresAtMs?: number; secret?: string; mintedAtMs?: number } = {},
) {
  return mintDeliveryToken(
    {
      key,
      expiresAtMs: overrides.expiresAtMs ?? NOW + 30 * 60 * 1000,
      orgId: 'org-acme',
      hostId: 'host-1',
      mediaId: 'med-film',
      scope: 'host-1',
    },
    overrides.secret ?? SECRET,
    overrides.mintedAtMs ?? NOW,
  )
}

async function request(
  path: string,
  token: string | null,
  init: { method?: string; headers?: Record<string, string> } = {},
  env = { VIDEO_BUCKET: fakeBucket({ [KEY]: FILM }), MEDIA_VIDEO_DELIVERY_SECRET: SECRET },
) {
  const url = `https://video.example.workers.dev/${path}${token === null ? '' : `?token=${token}`}`
  return handleVideoRequest(new Request(url, init), env, NOW)
}

describe('the delivery Worker (AGL-2824)', () => {
  it('serves the whole object to a GET with a token for its key', async () => {
    const response = await request(KEY, await tokenFor(KEY))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(FILM)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('20')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    // Private, and no longer than the token has left (30 minutes, capped).
    expect(response.headers.get('cache-control')).toBe('private, max-age=1800')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers a Range request 206 with Content-Range and only the bytes asked for', async () => {
    const bucket = fakeBucket({ [KEY]: FILM })
    const response = await request(
      KEY,
      await tokenFor(KEY),
      { headers: { range: 'bytes=5-9' } },
      { VIDEO_BUCKET: bucket, MEDIA_VIDEO_DELIVERY_SECRET: SECRET },
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 5-9/20')
    expect(response.headers.get('content-length')).toBe('5')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('56789')
    // The bucket was asked for exactly those bytes.
    expect(bucket.gets).toEqual([{ key: KEY, range: { offset: 5, length: 5 } }])
  })

  it('answers the open-ended and suffix forms a player sends', async () => {
    const open = await request(KEY, await tokenFor(KEY), { headers: { range: 'bytes=15-' } })
    expect(open.status).toBe(206)
    expect(open.headers.get('content-range')).toBe('bytes 15-19/20')
    expect(await open.text()).toBe('FGHIJ')
    const suffix = await request(KEY, await tokenFor(KEY), { headers: { range: 'bytes=-3' } })
    expect(suffix.headers.get('content-range')).toBe('bytes 17-19/20')
    expect(await suffix.text()).toBe('HIJ')
  })

  it('answers a range past the end 416, and a multi-range with the whole object', async () => {
    const past = await request(KEY, await tokenFor(KEY), { headers: { range: 'bytes=50-60' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */20')
    expect(await past.text()).toBe('')
    const multi = await request(KEY, await tokenFor(KEY), {
      headers: { range: 'bytes=0-1,5-6' },
    })
    expect(multi.status).toBe(200)
    expect(await multi.text()).toBe(FILM)
  })

  it('sends the whole object when If-Range names another version', async () => {
    const response = await request(KEY, await tokenFor(KEY), {
      headers: { range: 'bytes=0-4', 'if-range': '"some-older-etag"' },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(FILM)
  })

  it('answers HEAD with the headers and no body', async () => {
    const response = await request(KEY, await tokenFor(KEY), { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('20')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.body).toBeNull()
  })

  it('answers 404 for an object the token does not name, even one the bucket holds', async () => {
    const env = {
      VIDEO_BUCKET: fakeBucket({ [KEY]: FILM, [OTHER_KEY]: 'SECRET-FILM' }),
      MEDIA_VIDEO_DELIVERY_SECRET: SECRET,
    }
    const response = await request(OTHER_KEY, await tokenFor(KEY), {}, env)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    expect(env.VIDEO_BUCKET.gets).toEqual([])
  })

  it('answers 404 for a named object the bucket no longer holds', async () => {
    const env = { VIDEO_BUCKET: fakeBucket({}), MEDIA_VIDEO_DELIVERY_SECRET: SECRET }
    expect((await request(KEY, await tokenFor(KEY), {}, env)).status).toBe(404)
    expect((await request(KEY, await tokenFor(KEY), { method: 'HEAD' }, env)).status).toBe(404)
  })

  it('refuses a bad token with 403 and no body, before touching the bucket', async () => {
    const good = await tokenFor(KEY)
    const [payload, signature] = good.split('.') as [string, string]
    const cases: Array<[string, string | null]> = [
      ['no token', null],
      ['garbage', 'not-a-token'],
      ['tampered', `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`],
      // Minted two hours ago for one hour: a genuine token, run out.
      [
        'expired',
        await tokenFor(KEY, { mintedAtMs: NOW - 2 * 3_600_000, expiresAtMs: NOW - 3_600_000 }),
      ],
      ['another secret', await tokenFor(KEY, { secret: 'g'.repeat(64) })],
    ]
    for (const [name, token] of cases) {
      const env = { VIDEO_BUCKET: fakeBucket({ [KEY]: FILM }), MEDIA_VIDEO_DELIVERY_SECRET: SECRET }
      for (const method of ['GET', 'HEAD']) {
        const response = await request(KEY, token, { method }, env)
        expect([name, method, response.status]).toEqual([name, method, 403])
        expect([name, await response.text()]).toEqual([name, ''])
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
      expect([name, env.VIDEO_BUCKET.gets]).toEqual([name, []])
    }
  })

  it('refuses everything with 503 while the Worker has no secret', async () => {
    const response = await request(KEY, await tokenFor(KEY), {}, {
      VIDEO_BUCKET: fakeBucket({ [KEY]: FILM }),
      MEDIA_VIDEO_DELIVERY_SECRET: '',
    })
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
  })

  it('allows only GET and HEAD, and answers a CORS preflight', async () => {
    const post = await request(KEY, await tokenFor(KEY), { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    const preflight = await request(KEY, null, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/range/)
  })

  it('exports the Worker entry the wrangler config deploys', async () => {
    expect(typeof worker.fetch).toBe('function')
  })
})

describe('byte ranges, with the media CDN route’s semantics', () => {
  it.each([
    ['bytes=0-4', 20, { start: 0, end: 4 }],
    ['bytes=15-', 20, { start: 15, end: 19 }],
    ['bytes=10-999', 20, { start: 10, end: 19 }],
    ['bytes=-5', 20, { start: 15, end: 19 }],
    ['bytes=-50', 20, { start: 0, end: 19 }],
    ['bytes=20-', 20, 'unsatisfiable'],
    ['bytes=-0', 20, 'unsatisfiable'],
    ['bytes=5-2', 20, null],
    ['bytes=0-1,4-5', 20, null],
    ['items=0-1', 20, null],
    [null, 20, null],
  ])('%s of %d bytes', (header, size, expected) => {
    expect(parseByteRange(header as string | null, size as number)).toEqual(expected)
  })
})
