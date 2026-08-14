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
 * A locked org's assets stop serving (AGL-1520).
 *
 * The tenant middleware 503s a locked org's pages within seconds (AGL-1501);
 * before this gate its public media kept serving worldwide — hot-links,
 * third-party embeds, and the infected asset itself under a security lock.
 * These specs drive the REAL `serveMediaCdn` (the etag/range harness, with
 * Firestore routed per collection so the lock reads and the media read are
 * distinguishable) and hold four properties:
 *
 *  1. the reason matrix — `security`/`manual` refuse; `billing`/
 *     `maintenance` serve (argued at `mediaCdnServeBlock`);
 *  2. the refusal shape — a neutral 410 with `no-store` (never cached into
 *     the asset's URL identity, the AGL-1515 lesson) and the CSP/nosniff
 *     pair every exit of this handler carries;
 *  3. the read cost — the verdict is TTL-cached per scope, so a burst of
 *     asset requests pays ONE org read, not one per asset;
 *  4. the hot path unchanged — image policy, ETag, 304, Range and the
 *     immutable form are pinned byte-for-byte for unlocked scopes.
 */

import { Readable, Writable } from 'node:stream'
import { invalidatePlatformLockdownCache } from './lockdown'
import {
  invalidateMediaCdnLockCache,
  MEDIA_CDN_BASE_CSP,
  MEDIA_CDN_IMMUTABLE_CACHE_CONTROL,
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  serveMediaCdn,
} from './serve-media-cdn'

const mockState: {
  media: Record<string, unknown> | null
  org: Record<string, unknown> | null
  host: Record<string, unknown> | null
  hostIndex: Record<string, unknown> | null
  platform: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** Top-level collection reads, in order — the read-cost evidence. */
  reads: string[]
  /** Simulate a Firestore outage on the lock-read path. */
  orgReadThrows: boolean
} = {
  media: null,
  org: null,
  host: null,
  hostIndex: null,
  platform: null,
  metadata: null,
  reads: [],
  orgReadThrows: false,
}

jest.mock('./firebase-admin', () => {
  const snapshotFor = (data: Record<string, unknown> | null) => ({
    get exists() {
      return data !== null
    },
    get: (field: string) => data?.[field],
    data: () => data ?? undefined,
  })
  // The media subcollection read is what the pre-existing harnesses stub;
  // here it must be separable from the scope-doc read the lock check adds.
  const scopeDocRef = (collection: string, key: 'org' | 'host') => ({
    collection: (sub: string) => ({
      doc: () => ({
        get: async () => {
          mockState.reads.push(`${collection}/${sub}`)
          return snapshotFor(mockState.media)
        },
        set: async () => undefined,
      }),
    }),
    get: async () => {
      if (mockState.orgReadThrows) throw new Error('UNAVAILABLE')
      mockState.reads.push(collection)
      return snapshotFor(mockState[key])
    },
  })
  const firestoreApi = {
    collection: (name: string) => ({
      doc: () => {
        if (name === 'orgs') return scopeDocRef('orgs', 'org')
        if (name === 'hosts') return scopeDocRef('hosts', 'host')
        if (name === 'hostIndex') {
          return {
            get: async () => {
              mockState.reads.push('hostIndex')
              return snapshotFor(mockState.hostIndex)
            },
          }
        }
        if (name === 'lockdowns') {
          return {
            get: async () => {
              mockState.reads.push('lockdowns')
              return snapshotFor(mockState.platform)
            },
          }
        }
        throw new Error(`Unexpected collection ${name}`)
      },
    }),
  }
  const file = () => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    createReadStream: () => Readable.from([Buffer.from('PNGBYTES')]),
  })
  const firebaseAdmin = {
    app: () => ({
      firestore: () => firestoreApi,
      storage: () => ({ bucket: () => ({ file }) }),
    }),
    firestore: {
      FieldValue: { increment: (n: number) => ({ increment: n }) },
    },
  }
  return { __esModule: true, firebaseAdmin, default: firebaseAdmin }
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
  headers: Record<string, string> = {},
  method: 'GET' | 'HEAD' = 'GET',
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path, ...query }, headers } as never,
    res as never,
  )
  return res
}

const MEDIA = {
  fileName: 'logo.png',
  contentType: 'image/png',
  sizeBytes: 8,
  contentHash: '0123456789abcdef',
  variants: [],
  visibleTo: ['org'],
}

beforeEach(() => {
  mockState.media = { ...MEDIA }
  mockState.org = {}
  mockState.host = {}
  mockState.hostIndex = { orgId: 'acme' }
  mockState.platform = null
  mockState.metadata = { contentType: 'image/png', size: 8 }
  mockState.reads = []
  mockState.orgReadThrows = false
  invalidateMediaCdnLockCache()
  invalidatePlatformLockdownCache()
})

/** A served GET streams the object without ever calling `res.status()`. */
const served = (res: MockRes) => res.statusCode === 0 && res.body === 'PNGBYTES'

/** The full refusal contract: neutral 410, uncacheable, headers intact. */
function expectRefused(res: MockRes) {
  expect(res.statusCode).toBe(410)
  expect(res.body).toBe(JSON.stringify({ error: 'Gone' }))
  expect(res.headers['cache-control']).toBe('no-store')
  expect(res.headers['content-security-policy']).toBe(MEDIA_CDN_BASE_CSP)
  expect(res.headers['x-content-type-options']).toBe('nosniff')
}

describe('AGL-1520 · a locked scope stops serving', () => {
  it('security-locked org: the stable URL refuses with 410 + no-store + CSP', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['org:acme', 'm1']))
  })

  it('security-locked org: the immutable content-hashed URL refuses too', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['org:acme', 'm1', '0123456789abcdef']))
  })

  it('security-locked org: HEAD refuses like GET', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    const res = await serve(['org:acme', 'm1'], {}, {}, 'HEAD')
    expect(res.statusCode).toBe(410)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a revalidation during the lock is refused, never handed a 304', async () => {
    // The browser holds a 60s copy with the asset ETag. If the lock lands
    // between fetches, its conditional GET must not renew the copy.
    const etag = (await serve(['org:acme', 'm1'])).headers['etag']
    expect(etag).toBe('"0123456789abcdef"')
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    invalidateMediaCdnLockCache()
    const res = await serve(['org:acme', 'm1'], {}, { 'if-none-match': etag })
    expect(res.statusCode).toBe(410)
    expect(res.statusCode).not.toBe(304)
  })

  it('manual lock (the bare legacy suspendedAt) refuses — a kill is total', async () => {
    mockState.org = { suspendedAt: 1 }
    expectRefused(await serve(['org:acme', 'm1']))
  })

  it('billing lock SERVES — the site 503s already; assets are the cheap answer', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'billing' }
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })

  it('maintenance lock SERVES — the notice page may reference org assets', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'maintenance' }
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })

  it('an EXPIRED lock serves — untilMs passing restores with no write', async () => {
    mockState.org = {
      suspendedAt: 1,
      suspendedReasonCode: 'security',
      suspendedUntilMs: Date.now() - 60_000,
    }
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })
})

describe('AGL-1520 · host-library scope', () => {
  it('a security-locked HOST refuses its library assets', async () => {
    mockState.host = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['h1', 'm1']))
  })

  it('the OWNING org’s lock reaches host-library assets via hostIndex', async () => {
    // An org lock never stamps host docs (AGL-1506) — a host-only read
    // would miss exactly the lock this issue is about.
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['h1', 'm1']))
  })

  it('an unlocked host serves', async () => {
    expect(served(await serve(['h1', 'm1']))).toBe(true)
  })
})

describe('AGL-1520 · platform scope', () => {
  it('a platform security lockdown (the panic button) stops delivery', async () => {
    mockState.platform = { scope: 'platform', reason: 'security', atMs: 1 }
    expectRefused(await serve(['org:acme', 'm1']))
  })

  it('a platform maintenance window does NOT blank customer images', async () => {
    mockState.platform = { scope: 'platform', reason: 'maintenance', atMs: 1 }
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })

  it('an org security lock is not masked by a platform maintenance window', async () => {
    // resolveLockdown returns the WIDEST scope — which here would answer
    // "maintenance" and serve. The gate checks scopes individually so the
    // infected asset stops regardless of what notice a visitor would see.
    mockState.platform = { scope: 'platform', reason: 'maintenance', atMs: 1 }
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['org:acme', 'm1']))
  })
})

describe('AGL-1520 · read cost and convergence', () => {
  it('a burst of asset requests pays ONE org read, not one per asset', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(served(await serve(['org:acme', 'm1']))).toBe(true)
    }
    // Five media-doc reads (per request, pre-existing), one lock read.
    expect(
      mockState.reads.filter((read) => read === 'orgs/media').length,
    ).toBe(5)
    expect(mockState.reads.filter((read) => read === 'orgs').length).toBe(1)
  })

  it('an unlock restores delivery once the TTL rolls (no negative cache)', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['org:acme', 'm1']))
    mockState.org = {}
    // Stands in for the 15s TTL expiring — production convergence is the
    // TTL; the lock is written by the console app and served by the tenant
    // app, so no in-process invalidation could reach the serving process.
    invalidateMediaCdnLockCache()
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })

  it('fails OPEN on a lock-read outage — an outage is not a lockdown', async () => {
    mockState.orgReadThrows = true
    expect(served(await serve(['org:acme', 'm1']))).toBe(true)
  })
})

describe('AGL-1520 · the hot path is unchanged for unlocked scopes', () => {
  it('stable image URL: bytes, exact cache policy, exact ETag', async () => {
    const res = await serve(['org:acme', 'm1'])
    expect(served(res)).toBe(true)
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
    expect(res.headers['etag']).toBe('"0123456789abcdef"')
  })

  it('conditional GET still answers 304', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { 'if-none-match': '"0123456789abcdef"' },
    )
    expect(res.statusCode).toBe(304)
    expect(res.body).toBe('')
  })

  it('a single byte range still answers 206 with an exact Content-Range', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=0-3' })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-3/8')
    expect(res.headers['content-length']).toBe('4')
  })

  it('immutable URL: the year-long policy, untouched', async () => {
    const res = await serve(['org:acme', 'm1', '0123456789abcdef'])
    expect(served(res)).toBe(true)
    expect(res.headers['cache-control']).toBe(
      MEDIA_CDN_IMMUTABLE_CACHE_CONTROL,
    )
  })
})
