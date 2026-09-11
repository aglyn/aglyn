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
 * A replace reaches the URL a published page names (AGL-2798), driven through
 * the real `resolveMediaSrc` and the real `serveMediaCdn`.
 *
 * Propagation has two halves, and neither needs an edge in the room to be
 * checked:
 *
 * 1. WHICH URL the page names. A stored reference is resolved at render
 *    time, so the page names whatever `resolveMediaSrc` returns for it —
 *    including for a reference that carries a content pin.
 * 2. HOW that URL may be cached. An `immutable` response is kept by Vercel's
 *    edge and by every browser that fetched it, and nothing asks the handler
 *    about it again, so no replace can reach a page that names one. A
 *    revalidating response is asked about again, and the handler answers from
 *    the current document.
 *
 * So each case resolves a stored reference, serves the URL it resolved to,
 * replaces the asset, and serves the SAME URL again. Firestore and Storage are
 * stubbed the way `serve-media-cdn.stale-pin.spec.ts` stubs them, so this runs
 * in the default sweep.
 */

import { Readable, Writable } from 'node:stream'
import { MEDIA_CDN_ROUTE, resolveMediaSrc } from '@aglyn/aglyn/server'
import {
  MEDIA_CDN_IMMUTABLE_CACHE_CONTROL,
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  serveMediaCdn,
} from './serve-media-cdn'

/** The content hash the upload earned, and the one the replace earns. */
const UPLOADED = 'aaaaaaaaaaaaaaaa'
const REPLACED = 'bbbbbbbbbbbbbbbb'
const HOST_ID = 'site1'

const mockState: {
  doc: Record<string, unknown> | null
  bytes: string
} = { doc: null, bytes: '' }

jest.mock('./firebase-admin', () => {
  const snapshot = () => ({
    get exists() {
      return mockState.doc !== null
    },
    get: (field: string) => mockState.doc?.[field],
  })
  const docRef = (): unknown => ({
    collection: () => ({ doc: () => docRef() }),
    get: async () => snapshot(),
    set: async () => undefined,
  })
  const file = () => ({
    getMetadata: async () => [
      {
        contentType: mockState.doc?.['contentType'],
        size: mockState.bytes.length,
      },
    ],
    createReadStream: () => Readable.from([Buffer.from(mockState.bytes)]),
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({ collection: () => ({ doc: () => docRef() }) }),
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: { FieldValue: { increment: (n: number) => ({ increment: n }) } },
    },
  }
})

class MockRes extends Writable {
  headers: Record<string, string> = {}
  statusCode = 0
  headersSent = false
  body = ''

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = String(value)
    return this
  }
  getHeader(key: string) {
    return this.headers[key.toLowerCase()]
  }
  status(code: number) {
    this.statusCode = code
    this.headersSent = true
    return this
  }
  json(payload: unknown) {
    this.end(JSON.stringify(payload))
    return this
  }
  override _write(
    chunk: Buffer | string,
    _encoding: unknown,
    done: (error?: Error) => void,
  ) {
    this.body += String(chunk)
    done()
  }
}

/** The route's `path` segments for a URL a page names. */
const pathOf = (url: string): string[] =>
  url.slice(`${MEDIA_CDN_ROUTE}/`.length).split('?')[0].split('/')

async function serve(
  url: string,
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method: 'GET', query: { path: pathOf(url) }, headers } as never,
    res as never,
  )
  return res
}

/** What `/api/media/replace` leaves behind: the same id, new bytes, new hash. */
function replaceAsset(bytes: string, contentHash: string): void {
  mockState.bytes = bytes
  mockState.doc = { ...mockState.doc, contentHash }
}

/** Where the page's `<img src>` points, for a stored value. */
const publishedUrl = (stored: string): string => {
  const url = resolveMediaSrc(stored, { hostId: HOST_ID })
  if (!url) throw new Error(`${stored} resolved to nothing`)
  return url
}

beforeEach(() => {
  mockState.doc = {
    contentType: 'image/png',
    visibleTo: ['org'],
    contentHash: UPLOADED,
    fileName: 'hero.png',
    variants: [],
  }
  mockState.bytes = 'the uploaded picture'
})

describe('a replace reaches the URL a published page names (AGL-2798)', () => {
  const STORED = [
    ['an unpinned reference', 'media:org:acme/hero'],
    ['a reference pinned to the upload', `media:org:acme/hero@${UPLOADED}`],
  ] as const

  it.each(STORED)('%s names the stable URL', (_label, stored) => {
    expect(publishedUrl(stored)).toBe(`${MEDIA_CDN_ROUTE}/org:acme:${HOST_ID}/hero`)
  })

  it.each(STORED)(
    '%s is served revalidating, never immutable',
    async (_label, stored) => {
      const res = await serve(publishedUrl(stored))
      expect(res.body).toBe('the uploaded picture')
      expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
      expect(res.headers['cache-control']).not.toMatch(/immutable/)
    },
  )

  it.each(STORED)(
    '%s serves the new bytes at the same URL after a replace',
    async (_label, stored) => {
      const url = publishedUrl(stored)
      const first = await serve(url)
      replaceAsset('the replacement picture', REPLACED)
      // A browser revalidating its copy sends the validator it was handed. The
      // answer has to be the new file, never a 304 renewing the old one.
      const again = await serve(url, {
        'if-none-match': String(first.headers['etag']),
      })
      expect(again.statusCode).not.toBe(304)
      expect(again.body).toBe('the replacement picture')
      expect(again.headers['etag']).toBe(`"${REPLACED}"`)
    },
  )

  it('is needed because the content-hashed form is served immutable', async () => {
    // The negative control: the URL a pinned reference used to resolve to, and
    // the response it earns — the one an edge and a browser keep for a year
    // without asking this handler again.
    const res = await serve(
      `${MEDIA_CDN_ROUTE}/org:acme:${HOST_ID}/hero/${UPLOADED}`,
    )
    expect(res.body).toBe('the uploaded picture')
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_IMMUTABLE_CACHE_CONTROL)
  })
})
