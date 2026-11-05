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
 * Media URLs under "all sites except" (AGL-4047), driven through the real
 * `resolveMediaSrc` and the real `serveMediaCdn`, with Firestore and Storage
 * stubbed the way `serve-media-cdn.published-reference.spec.ts` stubs them.
 *
 * Three things are pinned:
 *
 * 1. A published page holding a legacy stored CDN path renders what it rendered.
 *    Each row serves the URL the page used to name, the stored path itself, and
 *    the URL it names now, and compares them over every scope a document in
 *    production can carry. No document here carries a marker, because none in
 *    production does.
 * 2. A bare URL serves an asset shared with all sites except some, and the
 *    excluded site's own URL does not.
 * 3. A private asset stays signed under every one of those URLs.
 */

import { Readable, Writable } from 'node:stream'
import { MEDIA_CDN_ROUTE, resolveMediaSrc } from '@aglyn/aglyn/server'
import { mediaSignatureQuery, mintMediaSignature } from './media-signing'
import { serveMediaCdn } from './serve-media-cdn'

const SITE = 'site1'
const OTHER = 'site2'
const BYTES = 'PNGBYTES'

const mockState: { doc: Record<string, unknown> | null } = { doc: null }

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
    getMetadata: async () => [{ contentType: 'image/png', size: 8 }],
    createReadStream: () => Readable.from([Buffer.from('PNGBYTES')]),
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
  // A real response answers 200 until told otherwise, and the handler relies on
  // that when it streams. Starting at 0 would let a served row read as refused.
  statusCode = 200
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

async function serve(url: string): Promise<MockRes> {
  const [pathname, search = ''] = url.split('?')
  const query: Record<string, unknown> = {
    path: pathname.slice(`${MEDIA_CDN_ROUTE}/`.length).split('/'),
  }
  for (const [key, value] of new URLSearchParams(search)) query[key] = value
  const res = new MockRes()
  await serveMediaCdn({ method: 'GET', query, headers: {} } as never, res as never)
  return res
}

const asset = (fields: Record<string, unknown>): Record<string, unknown> => ({
  fileName: 'logo.png',
  contentType: 'image/png',
  sizeBytes: BYTES.length,
  storagePath: 'orgs/acme/media/m1',
  contentHash: '0123456789abcdef',
  ...fields,
})

const hostToken = (hostId: string) => `host:${hostId}`

/** A document's `visibleTo`, as far as production documents go today. */
const SCOPES: ReadonlyArray<[string, unknown]> = [
  ['every site', ['org']],
  ['every site, plus a stray token', ['org', hostToken(OTHER)]],
  ['the rendering site alone', [hostToken(SITE)]],
  ['the rendering site and another', [hostToken(SITE), hostToken(OTHER)]],
  ['another site alone', [hostToken(OTHER)]],
  ['nobody, stored empty', []],
  ['no scope at all', undefined],
]

const BARE = `${MEDIA_CDN_ROUTE}/org:acme/m1`
const BAKED_HERE = `${MEDIA_CDN_ROUTE}/org:acme:${SITE}/m1`
const BAKED_ELSEWHERE = `${MEDIA_CDN_ROUTE}/org:acme:${OTHER}/m1`
const HOST_LIBRARY = `${MEDIA_CDN_ROUTE}/${SITE}/m1`

const STORED: ReadonlyArray<string> = [
  BARE,
  BAKED_HERE,
  BAKED_ELSEWHERE,
  HOST_LIBRARY,
  `${BARE}/0123456789abcdef`,
]

let errorSpy: jest.SpyInstance
const previousSecret = process.env['TOKEN_SIGNING_SECRET']

beforeAll(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-only-signing-secret'
})

afterAll(() => {
  if (previousSecret === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = previousSecret
})

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('a published page holding a legacy CDN path renders what it rendered', () => {
  const rows = STORED.flatMap((stored) =>
    SCOPES.map(
      ([label, visibleTo]) => [stored, label, visibleTo] as const,
    ),
  )

  it.each(rows)('%s, shared with %s', async (stored, _label, visibleTo) => {
    mockState.doc = asset(visibleTo === undefined ? {} : { visibleTo })
    const before = await serve(stored)
    const after = await serve(resolveMediaSrc(stored, { hostId: SITE }) as string)
    if (before.statusCode === 200) {
      // The whole promise: whatever served still serves, the same bytes.
      expect(after.statusCode).toBe(200)
      expect(after.body).toBe(before.body)
      return
    }
    // A bare path to an asset restricted to this very site is the one row that
    // moves: its image was a 404 on the site it was shared with.
    const gained =
      stored === BARE &&
      Array.isArray(visibleTo) &&
      visibleTo.includes(hostToken(SITE))
    expect(after.statusCode).toBe(gained ? 200 : before.statusCode)
  })

  it('names the site only for a bare org path', () => {
    expect(resolveMediaSrc(BARE, { hostId: SITE })).toBe(BAKED_HERE)
    for (const stored of STORED.slice(1)) {
      expect(resolveMediaSrc(stored, { hostId: SITE })).toBe(stored)
    }
  })

  it('leaves every path alone where no site is known', () => {
    for (const stored of STORED) {
      expect(resolveMediaSrc(stored)).toBe(stored)
      expect(resolveMediaSrc(stored, { hostId: 'not a segment' })).toBe(stored)
    }
  })
})

describe('an asset shared with all sites except some', () => {
  const EXCLUDED = 'site9'
  const MARKED = {
    visibleTo: [hostToken(SITE), hostToken(OTHER)],
    scopeMode: 'allExcept',
    scopeExcept: [hostToken(EXCLUDED)],
  }

  it('serves a bare URL, the one a raw string or a sent email still holds', async () => {
    mockState.doc = asset(MARKED)
    const res = await serve(BARE)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(BYTES)
  })

  it('serves an included site and refuses the excluded one, silently', async () => {
    mockState.doc = asset(MARKED)
    expect((await serve(BAKED_HERE)).statusCode).toBe(200)
    const refused = await serve(`${MEDIA_CDN_ROUTE}/org:acme:${EXCLUDED}/m1`)
    expect(refused.statusCode).toBe(404)
    expect(refused.headers['cache-control']).toBe('public, max-age=60')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('a stored legacy path follows the site rendering it', async () => {
    mockState.doc = asset(MARKED)
    const here = resolveMediaSrc(BARE, { hostId: SITE }) as string
    const excluded = resolveMediaSrc(BARE, { hostId: EXCLUDED }) as string
    expect((await serve(here)).statusCode).toBe(200)
    expect((await serve(excluded)).statusCode).toBe(404)
  })

  it('keeps refusing the bare URL for chosen sites, with or without a stray marker', async () => {
    for (const scopeMode of [undefined, null, 'allexcept', 'selected', true]) {
      mockState.doc = asset({ visibleTo: MARKED.visibleTo, scopeMode })
      expect((await serve(BARE)).statusCode).toBe(404)
    }
  })

  it('refuses every URL once no included site is left, and says so', async () => {
    mockState.doc = asset({ ...MARKED, visibleTo: [] })
    expect((await serve(BARE)).statusCode).toBe(404)
    expect(errorSpy).toHaveBeenCalledWith(
      '[media-cdn] asset has no site it can be served to',
      expect.stringContaining('"refusal":"no-sites"'),
    )
  })

  describe('and private', () => {
    const signed = (scope: string): string =>
      `${MEDIA_CDN_ROUTE}/${scope}/m1?${mediaSignatureQuery(
        mintMediaSignature(scope, 'm1'),
      )}`

    beforeEach(() => {
      mockState.doc = asset({ ...MARKED, private: true })
    })

    it('refuses an unsigned URL under every form, and nothing may keep it', async () => {
      for (const url of [BARE, BAKED_HERE]) {
        const res = await serve(url)
        expect(res.statusCode).toBe(404)
        expect(res.headers['cache-control']).toBe('private, no-store')
      }
    })

    it('resolves a signed URL to itself, so its signature still answers', async () => {
      const url = signed('org:acme')
      expect(resolveMediaSrc(url, { hostId: SITE })).toBe(url)
      const res = await serve(url)
      expect(res.statusCode).toBe(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('binds a signature to the form it was made for', async () => {
      const qualified = signed(`org:acme:${SITE}`)
      expect((await serve(qualified)).statusCode).toBe(200)
      const query = qualified.slice(qualified.indexOf('?'))
      expect((await serve(`${BARE}${query}`)).statusCode).toBe(404)
    })

    it('refuses an excluded site even with a good signature', async () => {
      const res = await serve(signed(`org:acme:${EXCLUDED}`))
      expect(res.statusCode).toBe(404)
    })
  })
})
