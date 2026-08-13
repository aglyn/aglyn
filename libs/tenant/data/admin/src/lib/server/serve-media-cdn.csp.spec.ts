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
 * The CDN's own Content-Security-Policy (AGL-1474).
 *
 * The claim under test is narrow and load-bearing: **this response carries a
 * policy no matter what the middleware does.** Both apps' matchers exclude
 * `api`, so a directly-navigated `/api/media/cdn/…` URL never passes through
 * the code that AGL-523 made the single owner of CSP — which is why an
 * uploaded SVG's `<script>` ran on the console's own origin. A header set in
 * a matcher would be one config edit from vanishing again; a header set on
 * the response is not, and that is the property asserted here.
 *
 * Driven through the real `serveMediaCdn` rather than the pure helper, for
 * the same reason the AGL-1411 disposition suite is: a policy that is correct
 * and never SET is worth nothing. Firestore and Storage are stubbed, so this
 * runs in the default sweep.
 *
 * What is NOT asserted here, because a spec cannot: that a browser refuses to
 * execute the script. That is the owed manual check, and it is written up on
 * the issue — the mechanism (`sandbox` + `script-src 'none'` on a top-level
 * document, and CSP not applying to an `<img>`-embedded SVG at all) is a
 * browser guarantee, not ours.
 */

import { Readable, Writable } from 'node:stream'
import {
  MEDIA_CDN_ACTIVE_DOCUMENT_CSP,
  MEDIA_CDN_BASE_CSP,
  mediaCdnContentSecurityPolicy,
  serveMediaCdn,
} from './serve-media-cdn'

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
} = { doc: null, metadata: null }

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
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    createReadStream: () => Readable.from([Buffer.from('<svg/>')]),
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
  send(payload: unknown) {
    this.end(String(payload))
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

async function serve(
  path: string[],
  query: Record<string, string> = {},
  method: 'GET' | 'HEAD' | 'POST' = 'GET',
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path, ...query }, headers } as never,
    res as never,
  )
  return res
}

const policy = (res: MockRes) => res.headers['content-security-policy']

beforeEach(() => {
  mockState.doc = {
    contentType: 'image/svg+xml',
    visibleTo: ['org'],
    contentHash: 'hash1',
    fileName: 'aglyn-logo-mark.svg',
  }
  mockState.metadata = { contentType: 'image/svg+xml', size: 6 }
})

describe('media CDN Content-Security-Policy (AGL-1474)', () => {
  it('sandboxes an SVG and forbids script outright', async () => {
    const res = await serve(['org:acme', 'm1'])
    expect(res.headers['content-type']).toBe('image/svg+xml')
    expect(policy(res)).toBe(MEDIA_CDN_ACTIVE_DOCUMENT_CSP)
    expect(policy(res)).toContain("script-src 'none'")
    expect(policy(res)).toContain("default-src 'none'")
    expect(policy(res)).toContain('sandbox')
    // The bytes are still served — this is a containment, not a refusal.
    expect(res.body).toBe('<svg/>')
  })

  it('does NOT depend on the disposition — the default stays inline', async () => {
    // Flipping the default to `attachment` was AGL-1474's option (1) and was
    // explicitly rejected: every `<img src>` in every published site depends
    // on inline. The policy has to do the work instead.
    const res = await serve(['org:acme', 'm1'])
    expect(res.headers['content-disposition']).toContain('inline')
    expect(policy(res)).toContain('sandbox')
  })

  it('carries `nosniff` on the response itself', async () => {
    // The policy above keys off the DECLARED content type. That is only sound
    // because the browser is bound to the declared type — so this response
    // sets the header itself rather than trusting an app-level config that
    // this route's own CSP already proves can miss it.
    expect((await serve(['org:acme', 'm1'])).headers['x-content-type-options'])
      .toBe('nosniff')
  })

  it('withholds `sandbox` from a raster image, and still forbids script', async () => {
    mockState.doc = { ...mockState.doc, contentType: 'image/png' }
    mockState.metadata = { contentType: 'image/png', size: 6 }
    const res = await serve(['org:acme', 'm1'])
    expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    expect(policy(res)).not.toContain('sandbox')
    expect(policy(res)).toContain("script-src 'none'")
  })

  it('withholds `sandbox` from a PDF, whose viewer it would change for no gain', async () => {
    mockState.doc = { ...mockState.doc, contentType: 'application/pdf' }
    mockState.metadata = { contentType: 'application/pdf', size: 6 }
    expect(policy(await serve(['org:acme', 'm1']))).not.toContain('sandbox')
  })

  it('sandboxes text/html too — /api/orgs/media accepted it for its whole life', async () => {
    mockState.doc = { ...mockState.doc, contentType: 'text/html' }
    mockState.metadata = { contentType: 'text/html', size: 6 }
    expect(policy(await serve(['org:acme', 'm1']))).toBe(
      MEDIA_CDN_ACTIVE_DOCUMENT_CSP,
    )
  })

  it('sets the policy on HEAD as well as GET', async () => {
    const res = await serve(['org:acme', 'm1'], {}, 'HEAD')
    expect(res.statusCode).toBe(200)
    expect(policy(res)).toContain('sandbox')
  })

  describe('no exit is reachable without a policy', () => {
    it('a malformed path (400)', async () => {
      const res = await serve(['org:acme'])
      expect(res.statusCode).toBe(400)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })

    it('a missing asset (404)', async () => {
      mockState.doc = null
      const res = await serve(['org:acme', 'm1'])
      expect(res.statusCode).toBe(404)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })

    it('an out-of-scope asset (404)', async () => {
      mockState.doc = { ...mockState.doc, visibleTo: ['host:other'] }
      const res = await serve(['org:acme', 'm1'])
      expect(res.statusCode).toBe(404)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })

    it('a private asset with no signature (404)', async () => {
      mockState.doc = { ...mockState.doc, private: true }
      const res = await serve(['org:acme', 'm1'])
      expect(res.statusCode).toBe(404)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })

    it('a conditional request answered 304', async () => {
      const first = await serve(['org:acme', 'm1'])
      const res = await serve(['org:acme', 'm1'], {}, 'GET', {
        'if-none-match': first.headers['etag'],
      })
      expect(res.statusCode).toBe(304)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })

    it('a rejected method (405)', async () => {
      const res = await serve(['org:acme', 'm1'], {}, 'POST')
      expect(res.statusCode).toBe(405)
      expect(policy(res)).toBe(MEDIA_CDN_BASE_CSP)
    })
  })
})

describe('mediaCdnContentSecurityPolicy', () => {
  it.each([
    'image/svg+xml',
    'IMAGE/SVG+XML',
    'image/svg+xml; charset=utf-8',
    'text/html',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'text/xsl',
  ])('sandboxes %s', (type) => {
    expect(mediaCdnContentSecurityPolicy(type)).toBe(
      MEDIA_CDN_ACTIVE_DOCUMENT_CSP,
    )
  })

  it.each([
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'application/pdf',
    'application/zip',
    'application/octet-stream',
    '',
  ])('leaves %s on the base policy', (type) => {
    expect(mediaCdnContentSecurityPolicy(type)).toBe(MEDIA_CDN_BASE_CSP)
  })

  it('never emits a policy that permits script', () => {
    for (const type of ['image/svg+xml', 'image/png', 'application/pdf']) {
      expect(mediaCdnContentSecurityPolicy(type)).toContain("script-src 'none'")
      expect(mediaCdnContentSecurityPolicy(type)).toContain("object-src 'none'")
    }
  })

  it('lets an SVG opened directly still render — style and raster fills survive', () => {
    // `default-src 'none'` alone would blank an SVG's own <style> block and
    // its embedded data: images. Nothing there can execute with
    // `script-src 'none'` and `sandbox` in force, and blanking legitimate
    // logos would be a visible regression bought for no safety.
    expect(MEDIA_CDN_ACTIVE_DOCUMENT_CSP).toContain("style-src 'unsafe-inline'")
    expect(MEDIA_CDN_ACTIVE_DOCUMENT_CSP).toContain('img-src data:')
  })
})
