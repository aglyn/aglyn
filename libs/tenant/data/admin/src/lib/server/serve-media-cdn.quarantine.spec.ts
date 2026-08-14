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
 * ONE quarantined file stops serving; everything else keeps running
 * (AGL-1512).
 *
 * These specs drive the REAL `serveMediaCdn` with Firestore routed per
 * collection, so the deny-list read is distinguishable from the media read
 * and from the AGL-1520 scope-lock read. Six properties:
 *
 *  1. **Proportionality** — the quarantined asset refuses while its
 *     NEIGHBOUR in the same library serves. That is the entire difference
 *     between this lever and locking the host.
 *  2. **By hash** — the refusal follows the bytes: every media document
 *     sharing a `contentHash`, in any scope, and both URL shapes. A
 *     per-asset fallback key covers documents that have no hash at all.
 *  3. **The refusal contract** — a neutral 410, `no-store`, and the
 *     CSP/nosniff pair every exit of this handler carries. Byte-identical
 *     to the lockdown refusal, so nothing on the wire says which one it
 *     was.
 *  4. **Reversibility** — a lift restores delivery once the TTL rolls,
 *     with no purge and no redeploy, and an expiry passing restores with
 *     no write at all. This is the whole reason quarantine exists instead
 *     of deletion, and a cached 410 would have defeated it.
 *  5. **Billing is untouched** — a refused request performs no write of any
 *     kind. The storage counter is a billing input and the file still
 *     belongs to the org; it is suppressed, not erased.
 *  6. **Read cost** — the whole deny list is ONE document, so a burst
 *     across many distinct assets pays one quarantine read, not one each.
 */

import { Readable, Writable } from 'node:stream'
import { invalidatePlatformLockdownCache } from './lockdown'
import { invalidateMediaQuarantineCache } from './media-quarantine'
import {
  invalidateMediaCdnLockCache,
  MEDIA_CDN_BASE_CSP,
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  serveMediaCdn,
} from './serve-media-cdn'

const mockState: {
  /** Media docs keyed `{collection}/{scopeId}/media/{mediaId}`. */
  media: Record<string, Record<string, unknown>>
  org: Record<string, unknown> | null
  host: Record<string, unknown> | null
  hostIndex: Record<string, unknown> | null
  platform: Record<string, unknown> | null
  quarantine: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** Top-level collection reads, in order — the read-cost evidence. */
  reads: string[]
  /** Every write attempted, so a refusal can be proven side-effect free. */
  writes: string[]
  quarantineReadThrows: boolean
} = {
  media: {},
  org: null,
  host: null,
  hostIndex: null,
  platform: null,
  quarantine: null,
  metadata: null,
  reads: [],
  writes: [],
  quarantineReadThrows: false,
}

jest.mock('./firebase-admin', () => {
  const snapshotFor = (data: Record<string, unknown> | null | undefined) => ({
    get exists() {
      return data != null
    },
    get: (field: string) => data?.[field],
    data: () => data ?? undefined,
  })
  const scopeDocRef = (
    collection: string,
    key: 'org' | 'host',
    scopeId: string,
  ) => ({
    collection: (sub: string) => ({
      doc: (mediaId: string) => ({
        get: async () => {
          mockState.reads.push(`${collection}/${sub}`)
          return snapshotFor(
            mockState.media[`${collection}/${scopeId}/${sub}/${mediaId}`],
          )
        },
        set: async () => {
          mockState.writes.push(`${collection}/${scopeId}/${sub}/${mediaId}`)
        },
      }),
    }),
    get: async () => {
      mockState.reads.push(collection)
      return snapshotFor(mockState[key])
    },
  })
  const firestoreApi = {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'orgs') return scopeDocRef('orgs', 'org', id)
        if (name === 'hosts') return scopeDocRef('hosts', 'host', id)
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
        if (name === 'mediaQuarantines') {
          return {
            get: async () => {
              if (mockState.quarantineReadThrows) {
                throw new Error('UNAVAILABLE')
              }
              mockState.reads.push('mediaQuarantines')
              return snapshotFor(mockState.quarantine)
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

const INFECTED_HASH = '0123456789abcdef'
const CLEAN_HASH = 'fedcba9876543210'

const mediaDoc = (contentHash: string | null) => ({
  fileName: 'logo.png',
  contentType: 'image/png',
  sizeBytes: 8,
  ...(contentHash ? { contentHash } : {}),
  variants: [],
  visibleTo: ['org'],
})

/** The deny list as one document — the shape the admin route writes. */
const denyList = (entries: Record<string, unknown>) => ({ entries })

const quarantined = (overrides: Record<string, unknown> = {}) => ({
  reason: 'malware',
  message: null,
  note: null,
  atMs: 1,
  untilMs: null,
  actorUid: 'staff-1',
  ...overrides,
})

beforeEach(() => {
  mockState.media = {
    // The infected file and an innocent neighbour in the SAME org library.
    'orgs/acme/media/infected': mediaDoc(INFECTED_HASH),
    'orgs/acme/media/neighbour': mediaDoc(CLEAN_HASH),
    // The same bytes in a DIFFERENT workspace — one hash, two documents.
    'orgs/other/media/copy': mediaDoc(INFECTED_HASH),
    // A host-library asset with no hash at all (legacy / composite object).
    'hosts/h1/media/hashless': mediaDoc(null),
  }
  mockState.org = {}
  mockState.host = {}
  mockState.hostIndex = { orgId: 'acme' }
  mockState.platform = null
  mockState.quarantine = null
  mockState.metadata = { contentType: 'image/png', size: 8 }
  mockState.reads = []
  mockState.writes = []
  mockState.quarantineReadThrows = false
  invalidateMediaCdnLockCache()
  invalidatePlatformLockdownCache()
  invalidateMediaQuarantineCache()
})

const served = (res: MockRes) => res.statusCode === 0 && res.body === 'PNGBYTES'

/** The full refusal contract: neutral 410, uncacheable, headers intact. */
function expectRefused(res: MockRes) {
  expect(res.statusCode).toBe(410)
  expect(res.body).toBe(JSON.stringify({ error: 'Gone' }))
  expect(res.headers['cache-control']).toBe('no-store')
  expect(res.headers['content-security-policy']).toBe(MEDIA_CDN_BASE_CSP)
  expect(res.headers['x-content-type-options']).toBe('nosniff')
}

describe('AGL-1512 · one file stops, the site keeps running', () => {
  beforeEach(() => {
    mockState.quarantine = denyList({ [`hash--${INFECTED_HASH}`]: quarantined() })
  })

  it('the quarantined asset refuses', () => {
    return serve(['org:acme', 'infected']).then(expectRefused)
  })

  it('its NEIGHBOUR in the same library still serves — the whole point', async () => {
    expect(served(await serve(['org:acme', 'neighbour']))).toBe(true)
  })

  it('the immutable content-hashed URL refuses too', async () => {
    expectRefused(await serve(['org:acme', 'infected', INFECTED_HASH]))
  })

  it('HEAD refuses like GET', async () => {
    const res = await serve(['org:acme', 'infected'], {}, {}, 'HEAD')
    expect(res.statusCode).toBe(410)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a generated variant refuses with its source', async () => {
    // The variant serve resolves the same document, so it is covered by
    // construction — pinned because a future variant fast-path that skipped
    // the document read would silently keep serving the infected image.
    mockState.media['orgs/acme/media/infected'] = {
      ...mediaDoc(INFECTED_HASH),
      variants: [320],
    }
    expectRefused(await serve(['org:acme', 'infected'], { w: '320' }))
  })

  it('a revalidation during the quarantine is refused, never handed a 304', async () => {
    mockState.quarantine = null
    invalidateMediaQuarantineCache()
    const etag = (await serve(['org:acme', 'infected'])).headers['etag']
    expect(etag).toBe(`"${INFECTED_HASH}"`)
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    invalidateMediaQuarantineCache()
    const res = await serve(['org:acme', 'infected'], {}, { 'if-none-match': etag })
    expect(res.statusCode).toBe(410)
    expect(res.statusCode).not.toBe(304)
  })
})

describe('AGL-1512 · the key follows the bytes, not the document', () => {
  it('the same hash in a DIFFERENT workspace refuses too', async () => {
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    expectRefused(await serve(['org:other', 'copy']))
  })

  it('a per-asset entry covers a document that has NO contentHash', async () => {
    mockState.quarantine = denyList({
      'asset--h1--hashless': quarantined({ reason: 'dmca' }),
    })
    expectRefused(await serve(['h1', 'hashless']))
  })

  it('a per-asset entry is scope-qualified — it does not leak across libraries', async () => {
    mockState.quarantine = denyList({
      'asset--org:acme--hashless': quarantined(),
    })
    expect(served(await serve(['h1', 'hashless']))).toBe(true)
  })

  it('an entry with an unrecognised reason refuses to enforce, rather than guessing', async () => {
    // A malformed record is not a takedown. Normalizing it into one would
    // mean a corrupt write could disable an arbitrary file with no reason
    // anybody could later explain.
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined({ reason: 'oops' }),
    })
    expect(served(await serve(['org:acme', 'infected']))).toBe(true)
  })
})

describe('AGL-1512 · reversibility — the reason this is not deletion', () => {
  it('a lift restores delivery once the TTL rolls, with no purge', async () => {
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    expectRefused(await serve(['org:acme', 'infected']))
    mockState.quarantine = denyList({})
    // Stands in for the 15s TTL expiring — the quarantine is written by the
    // console app and enforced by the tenant app, so no in-process
    // invalidation could reach the serving process in production.
    invalidateMediaQuarantineCache()
    expect(served(await serve(['org:acme', 'infected']))).toBe(true)
  })

  it('an EXPIRED quarantine serves — untilMs passing restores with no write', async () => {
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined({ untilMs: Date.now() - 60_000 }),
    })
    expect(served(await serve(['org:acme', 'infected']))).toBe(true)
  })

  it('the refusal is never cacheable — a cached 410 would outlive the lift', async () => {
    // The deliberate cache-lifetime decision (AGL-1512): `no-store`, chosen
    // because there is no per-asset purge at the edge, so ANY positive
    // lifetime would make a lift fail to take effect for its duration —
    // defeating the only advantage quarantine has over deletion.
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    const res = await serve(['org:acme', 'infected'])
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['cache-control']).not.toContain('max-age')
    expect(res.headers['cache-control']).not.toContain('s-maxage')
  })
})

describe('AGL-1512 · the refusal leaks nothing', () => {
  it('says nothing about WHY, or that a quarantine exists at all', async () => {
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined({
        reason: 'dmca',
        message: 'Disabled pending a copyright claim.',
        note: 'Notice #4417 from Example Records',
      }),
    })
    const res = await serve(['org:acme', 'infected'])
    expect(res.body).toBe(JSON.stringify({ error: 'Gone' }))
    expect(res.body).not.toContain('dmca')
    expect(res.body).not.toContain('copyright')
    expect(res.body).not.toContain('Example Records')
    // The owning org learns the reason in the console. An anonymous fetcher
    // has no standing to learn that a takedown notice exists on a file.
    expect(Object.keys(res.headers)).not.toContain('x-aglyn-quarantine')
  })
})

describe('AGL-1512 · billing is untouched', () => {
  it('a refused request writes NOTHING — the file still belongs to the org', async () => {
    // The storage counter is a billing input. Quarantine suppresses; it
    // does not erase, does not touch `sizeBytes`, and must not even record
    // a delivery (the 410 returns before the analytics increment).
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    expectRefused(await serve(['org:acme', 'infected']))
    expect(mockState.writes).toEqual([])
  })

  it('the media document itself is only READ, never modified', async () => {
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    await serve(['org:acme', 'infected'])
    expect(mockState.media['orgs/acme/media/infected']).toEqual(
      mediaDoc(INFECTED_HASH),
    )
  })
})

describe('AGL-1512 · read cost and failure posture', () => {
  it('a burst across DISTINCT assets pays ONE deny-list read', async () => {
    // The deny list is a single document, so the cost is per process per
    // TTL — not per asset. A document per quarantined hash would have made
    // a fifty-tile DAM grid fifty-one reads.
    await serve(['org:acme', 'infected'])
    await serve(['org:acme', 'neighbour'])
    await serve(['org:other', 'copy'])
    expect(
      mockState.reads.filter((read) => read === 'mediaQuarantines').length,
    ).toBe(1)
  })

  it('fails OPEN on a deny-list outage — an outage is not a takedown', async () => {
    // Same posture as the lockdown core. Inverting it would turn a
    // Firestore blip into a total media outage across every customer site.
    mockState.quarantineReadThrows = true
    expect(served(await serve(['org:acme', 'infected']))).toBe(true)
  })

  it('an unquarantined asset keeps the exact hot-path contract', async () => {
    const res = await serve(['org:acme', 'neighbour'])
    expect(served(res)).toBe(true)
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
    expect(res.headers['etag']).toBe(`"${CLEAN_HASH}"`)
  })
})

describe('AGL-1512 · quarantine and lockdown compose', () => {
  it('a scope lock still refuses an asset that is not quarantined', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    expectRefused(await serve(['org:acme', 'neighbour']))
  })

  it('a quarantine bites inside an org that is NOT locked', async () => {
    mockState.org = {}
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    expectRefused(await serve(['org:acme', 'infected']))
  })

  it('both refusals are byte-identical on the wire', async () => {
    mockState.org = { suspendedAt: 1, suspendedReasonCode: 'security' }
    const locked = await serve(['org:acme', 'neighbour'])
    mockState.org = {}
    mockState.quarantine = denyList({
      [`hash--${INFECTED_HASH}`]: quarantined(),
    })
    invalidateMediaCdnLockCache()
    invalidateMediaQuarantineCache()
    const quarantinedRes = await serve(['org:acme', 'infected'])
    expect(quarantinedRes.statusCode).toBe(locked.statusCode)
    expect(quarantinedRes.body).toBe(locked.body)
    expect(quarantinedRes.headers['cache-control']).toBe(
      locked.headers['cache-control'],
    )
  })
})
