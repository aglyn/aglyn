/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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

import { parseSiteIconSpec } from '@aglyn/aglyn/app-utils/site-icon-set'
import sharp from 'sharp'

import { mediaCdnIconEtag, serveMediaCdnIcon } from './media-cdn-icon'

/**
 * The `?icon=` representation on the media CDN (AGL-3484): drawn once per
 * content version and cached for a year, re-pointed when a DAM Replace changes
 * the version, and degraded to the original for anything it cannot draw.
 */

const STABLE = '/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA'
const CACHE = {
  stable: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
  immutable: 'public, max-age=31536000, immutable',
}

/** A minimal node-style response that records what the handler did. */
function fakeResponse() {
  const headers = new Map<string, string>()
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    headers,
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), String(value))
      return res
    },
    removeHeader: (name: string) => {
      headers.delete(name.toLowerCase())
    },
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (body: unknown) => {
      res.body = body
      res.ended = true
      return res
    },
    end: (body?: unknown) => {
      res.body = body
      res.ended = true
      return res
    },
  }
  return res
}

const pngSource = () =>
  sharp({ create: { width: 512, height: 256, channels: 4, background: '#f00' } })
    .png()
    .toBuffer()

async function serve(options: {
  query: Record<string, string>
  contentType?: string
  contentHash?: string
  ifNoneMatch?: string
  source?: Buffer
  size?: number
  method?: string
}) {
  const res = fakeResponse()
  const download = jest.fn(async () => [options.source ?? (await pngSource())])
  const rateLimit = jest.fn(async () => null)
  const spec = parseSiteIconSpec(options.query['icon'])
  if (!spec) throw new Error('bad spec in test')
  await serveMediaCdnIcon({
    req: {
      method: options.method ?? 'GET',
      query: options.query,
      headers: options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {},
    } as never,
    res: res as never,
    spec,
    source: {
      contentType: options.contentType ?? 'image/png',
      contentHash: options.contentHash ?? 'hashB',
      stablePath: STABLE,
      file: {
        getMetadata: async () => [{ size: options.size ?? 2048 }],
        download: download as never,
      },
    },
    setCacheControl: (value) => res.setHeader('Cache-Control', value),
    cacheControl: CACHE,
    rateLimit,
  })
  return { res, download, rateLimit }
}

describe('a current version', () => {
  it('is drawn and cached for a year', async () => {
    const { res, download } = await serve({
      query: { icon: 'png-32', v: 'hashB' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe(CACHE.immutable)
    expect(res.headers.get('etag')).toBe('"hashB-icon-png-32"')
    expect(download).toHaveBeenCalledTimes(1)
    const meta = await sharp(res.body as Buffer).metadata()
    expect([meta.width, meta.height]).toEqual([32, 32])
  })

  it('answers a revalidation from its validator, without drawing', async () => {
    const { res, download } = await serve({
      query: { icon: 'png-32', v: 'hashB' },
      ifNoneMatch: '"hashB-icon-png-32"',
    })
    expect(res.statusCode).toBe(304)
    expect(download).not.toHaveBeenCalled()
  })

  it('serves the multi-size ICO as an icon', async () => {
    const { res } = await serve({ query: { icon: 'ico', v: 'hashB' } })
    expect(res.headers.get('content-type')).toBe('image/x-icon')
    expect((res.body as Buffer).readUInt16LE(4)).toBe(3)
  })
})

describe('a DAM Replace', () => {
  it('re-points a stale version at the current one, keeping the representation', async () => {
    const { res, download } = await serve({
      query: { icon: 'flat-180', bg: 'fafaf9', v: 'hashA', exp: '9', sig: 's' },
      contentHash: 'hashB',
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.get('location')).toBe(
      `${STABLE}?icon=flat-180&bg=fafaf9&v=hashB&exp=9&sig=s`,
    )
    // Revalidated rather than pinned: the pointer moves with the next Replace.
    expect(res.headers.get('cache-control')).toBe(CACHE.stable)
    expect(download).not.toHaveBeenCalled()
  })

  it('changes the validator, so no cache can hand back the old icon', () => {
    const spec = { plate: 'transparent', size: 32 } as const
    expect(mediaCdnIconEtag('hashA', spec, undefined)).not.toBe(
      mediaCdnIconEtag('hashB', spec, undefined),
    )
    // The plate color is part of the representation too.
    const flat = { plate: 'flat', size: 180 } as const
    expect(mediaCdnIconEtag('hashA', flat, 'ffffff')).not.toBe(
      mediaCdnIconEtag('hashA', flat, '000000'),
    )
  })
})

describe('an unversioned URL', () => {
  it('is drawn under the stable, revalidated policy', async () => {
    const { res } = await serve({ query: { icon: 'maskable-192', bg: '000' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers.get('cache-control')).toBe(CACHE.stable)
    expect(res.headers.get('etag')).toBe('"hashB-icon-maskable-192-000000"')
  })
})

describe('a source it cannot draw', () => {
  it('redirects an uploaded ICO to the original', async () => {
    const { res, download } = await serve({
      query: { icon: 'png-16', v: 'hashB' },
      contentType: 'image/x-icon',
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.get('location')).toBe(STABLE)
    expect(download).not.toHaveBeenCalled()
  })

  it('redirects a source over the fetch ceiling to the original', async () => {
    const { res, download } = await serve({
      query: { icon: 'png-16', v: 'hashB' },
      size: 16 * 1024 * 1024,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.get('location')).toBe(STABLE)
    expect(download).not.toHaveBeenCalled()
  })

  it('redirects a file that will not decode, uncached, so a Replace can fix it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { res } = await serve({
      query: { icon: 'png-16', v: 'hashB' },
      source: Buffer.from('not an image'),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.get('location')).toBe(STABLE)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.has('etag')).toBe(false)
  })
})
