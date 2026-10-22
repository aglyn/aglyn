/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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

/**
 * The owner is told why their file stopped loading (AGL-1612).
 *
 * AGL-1512 wrote `mediaQuarantineNotice()`, spec'd it, and called it from no
 * UI at all — so a workspace whose asset was taken down saw an image that had
 * simply stopped rendering. `/api/media/quarantine` is what the DAM asks.
 *
 * Four properties, and three of them are about what the route REFUSES to be:
 *
 *  1. It answers about the caller's own assets, deriving the quarantine keys
 *     from the media documents server-side.
 *  2. It is **not an oracle.** Digests in the request body are ignored
 *     entirely; a caller cannot probe what the platform has taken down
 *     elsewhere by guessing hashes. That fact is exactly what the CDN's
 *     neutral 410 exists to withhold, and a chatty console route would have
 *     handed it back.
 *  3. It never carries the staff `note`.
 *  4. It costs NOTHING on a healthy platform — an empty deny list is
 *     answered without reading a single media document.
 */

const mockVerifyIdToken = jest.fn()
const mockMediaGet = jest.fn()

const mockQuarantineLib = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/media-quarantine',
)

const state: {
  /** mediaId → document fields. */
  media: Record<string, Record<string, unknown>>
  /** Quarantine key → entry, as the admin route writes them. */
  denyList: Record<string, Record<string, unknown>>
  /** Every media document the handler actually read. */
  reads: string[]
  /** What `scopeAllows` answers — the AGL-1043 visibility rule. */
  visible: boolean
} = { media: {}, denyList: {}, reads: [], visible: true }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  hasMediaQuarantines: async () => Object.keys(state.denyList).length > 0,
  /**
   * The REAL key derivation and the REAL normalization, with only the
   * Firestore read replaced. Stubbing the lookup wholesale would have made
   * this file assert that a mock was called.
   */
  getMediaQuarantine: async (asset: Record<string, unknown>) => {
    const keys = mockQuarantineLib.mediaQuarantineKeys(asset) as string[]
    for (const key of keys) {
      const found = mockQuarantineLib.normalizeMediaQuarantine(
        state.denyList[key],
        key,
      )
      if (mockQuarantineLib.isMediaQuarantineActive(found, Date.now())) {
        return found
      }
    }
    return null
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  mediaQuarantineNotice: (...args: unknown[]) =>
    mockQuarantineLib.mediaQuarantineNotice(...args),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async () => ({
    scope: {
      base: 'orgs/org-1',
      collection: 'orgs',
      scopeId: 'org-1',
      cdnScope: 'org:org-1',
      scopeRef: {
        collection: () => ({
          doc: (mediaId: string) => ({
            get: async () => {
              state.reads.push(mediaId)
              const data = state.media[mediaId]
              return {
                exists: data != null,
                get: (field: string) => data?.[field],
              }
            },
          }),
        }),
      },
      viewerTokens: ['org'],
      viewerOrgWide: true,
    },
  }),
  scopeAllows: () => state.visible,
}))

import { POST as probe } from '../app/api/media/quarantine/route'

const STRONG = 'a'.repeat(64)
const OTHER_STRONG = 'b'.repeat(64)

const takenDown = (overrides: Record<string, unknown> = {}) => ({
  reason: 'dmca',
  message: null,
  note: 'Notice #4417 — complainant Northwind, staff eyes only',
  atMs: 1,
  untilMs: null,
  actorUid: 'staff-1',
  ...overrides,
})

const call = (mediaIds: unknown, extra: Record<string, unknown> = {}) =>
  probe(
    new Request('https://app.aglyn.com/api/media/quarantine', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ orgId: 'org-1', mediaIds, ...extra }),
    }),
  )

const quarantinedOf = async (
  response: Response,
): Promise<Record<string, Record<string, unknown>>> =>
  ((await response.json()) as { quarantined: Record<string, never> })
    .quarantined as never

beforeEach(() => {
  jest.clearAllMocks()
  state.media = {
    'media-1': { contentSha256: STRONG, visibleTo: ['org'] },
    'media-2': { contentSha256: OTHER_STRONG, visibleTo: ['org'] },
    'media-3': { visibleTo: ['org'] },
  }
  state.denyList = {}
  state.reads = []
  state.visible = true
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

// AGL-2016: the contact line on these notices is operator configuration, not
// a constant. This is the AGLYN-OPERATED shape — the self-host and
// unconfigured shapes are proved at the source, in
// libs/aglyn/src/lib/app-utils/{lockdown,media-quarantine}.spec.ts.
beforeEach(() => {
  process.env.NEXT_PUBLIC_OPERATOR_NAME = 'Aglyn LLC'
  process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@aglyn.com'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPERATOR_NAME
  delete process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL
})

describe('AGL-1612 · the owner learns why the file stopped loading', () => {
  it('names the disabled asset and leaves the healthy one alone', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    const quarantined = await quarantinedOf(await call(['media-1', 'media-2']))
    expect(Object.keys(quarantined)).toEqual(['media-1'])
    expect(quarantined['media-1']?.['reason']).toBe('dmca')
  })

  it('says the file was NOT deleted, and how to get it back', async () => {
    // The customer's first conclusion when an asset stops working is that
    // their data is gone. For every reason in this vocabulary it is not.
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    const quarantined = await quarantinedOf(await call(['media-1']))
    expect(String(quarantined['media-1']?.['body'])).toContain(
      'has not been deleted',
    )
    expect(quarantined['media-1']?.['contact']).toBe('support@aglyn.com')
  })

  it('covers an asset taken down by its PER-ASSET key, hash or no hash', async () => {
    state.denyList = {
      'asset--org:org-1--media-3': takenDown({ reason: 'malware' }),
    }
    const quarantined = await quarantinedOf(await call(['media-3']))
    expect(quarantined['media-3']?.['reason']).toBe('malware')
  })

  it('NEVER carries the staff note', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    const serialized = JSON.stringify(await quarantinedOf(await call(['media-1'])))
    expect(serialized).not.toContain('4417')
    expect(serialized).not.toContain('Northwind')
    expect(serialized).not.toContain('staff eyes only')
  })
})

describe('AGL-1612 · the route is not an oracle', () => {
  it('ignores digests in the request body entirely', async () => {
    // The client HOLDS these digests, so accepting them would be shorter.
    // It would also let any authenticated user learn what the platform has
    // taken down anywhere by guessing hashes — the exact fact the CDN's
    // neutral 410 withholds. Keys come from the caller's own documents.
    state.denyList = { [`hash--${OTHER_STRONG}`]: takenDown() }
    const quarantined = await quarantinedOf(
      await call(['media-1'], {
        contentSha256: OTHER_STRONG,
        contentHash: OTHER_STRONG.slice(0, 16),
      }),
    )
    expect(quarantined).toEqual({})
  })

  it('says nothing about an asset the caller may not see', async () => {
    // Not even "it is disabled" — that answer confirms the asset exists.
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    state.visible = false
    expect(await quarantinedOf(await call(['media-1']))).toEqual({})
  })

  it('says nothing about an id that is not in this library', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    expect(await quarantinedOf(await call(['not-here']))).toEqual({})
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await probe(
      new Request('https://app.aglyn.com/api/media/quarantine', {
        method: 'POST',
        body: JSON.stringify({ orgId: 'org-1', mediaIds: ['media-1'] }),
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('AGL-1612 · it costs nothing when nothing is quarantined', () => {
  it('reads NO media document when the deny list is empty', async () => {
    // The state of a healthy platform, and the reason this surface is
    // affordable at all: one already-cached deny-list read, then done.
    const response = await call(['media-1', 'media-2', 'media-3'])
    expect(await quarantinedOf(response)).toEqual({})
    expect(state.reads).toEqual([])
  })

  it('reads only the ids it was asked about once something IS quarantined', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    await call(['media-1', 'media-2'])
    expect(state.reads.sort()).toEqual(['media-1', 'media-2'])
  })

  it('bounds the list so a caller cannot ask for the whole library', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    const many = Array.from({ length: 500 }, (_, index) => `bulk-${index}`)
    await call(many)
    expect(state.reads.length).toBe(100)
  })

  it('answers an empty request without touching Firestore at all', async () => {
    state.denyList = { [`hash--${STRONG}`]: takenDown() }
    expect(await quarantinedOf(await call([]))).toEqual({})
    expect(state.reads).toEqual([])
  })

  it('is uncacheable — a lift must show up, not wait out a cache', async () => {
    const response = await call(['media-1'])
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
