/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * `by: "key"` — the mode the AGL-1700 deny-list table releases through.
 *
 * The mode exists because a table ROW is a key and the two original modes can
 * only construct one from parts. Four properties, each of which the obvious
 * alternative gets wrong:
 *
 *  1. **It clears the key it names and nothing else.** Media mode clears
 *     every key that could refuse a FILE, which is right there and wrong
 *     here: a hash entry covers workspaces the row never mentions, and
 *     widening a row's Release into "and everything near it" would lift
 *     takedowns nobody clicked on.
 *  2. **It cannot set one.** A hand-supplied key that matches no file is a
 *     quarantine that looks set and refuses nothing — the failure AGL-1687's
 *     whole media mode was built to remove. Releasing a key that matches
 *     nothing is only a no-op, so the asymmetry is deliberate.
 *  3. **A key it would not itself emit is refused.** These strings become map
 *     keys in a Firestore document; the alphabet is the one
 *     `mediaQuarantineHashKey`/`mediaQuarantineAssetKey` produce, and a `.`
 *     would be read as a field path by anything that later addresses the
 *     entry by one.
 *  4. **It is still a write**, so it is still super-only and still audited by
 *     key.
 *
 * The GET the table reads is asserted too, and that one was already green:
 * the table depends on `note` and the origin fields surviving to the wire,
 * which `normalizeMediaQuarantine` deliberately drops on the customer path.
 * Left here as the guard that stops a later "normalize the listing too" from
 * silently emptying two columns.
 */

import {
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINES_COLLECTION,
} from '@aglyn/aglyn/server'

const INDEX_PATH = `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}`

const SHA =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const SHA_KEY = `hash--${SHA}`
const LEGACY_KEY = 'hash--0123456789abcdef'
const ASSET_KEY = 'asset--org:acme--m1'

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
const mockDecodedToken: Record<string, unknown> = {}

const mockServerTimestamp = Symbol('serverTimestamp')
const mockDelete = Symbol('delete')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => mockServerTimestamp,
    delete: () => mockDelete,
  },
}))

/** Firestore's merge semantics, including the delete sentinel. */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDelete) {
      delete next[key]
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = next[key]
      next[key] = mergeInto(
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        value as Record<string, unknown>,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

const mockDocHandle = (path: string): any => ({
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockStore[path] = options?.merge
      ? mergeInto(mockStore[path] ?? {}, data)
      : data
  },
  collection: (child: string) => mockCollectionHandle(`${path}/${child}`),
})

const mockCollectionHandle = (prefix: string): any => ({
  add: async (data: Record<string, unknown>) => {
    if (prefix !== 'adminAudit') throw new Error(`unexpected add: ${prefix}`)
    mockAuditRows.push(data)
    return { id: `audit-${mockAuditRows.length}` }
  },
  doc: (id: string) => mockDocHandle(`${prefix}/${id}`),
})

const mockFirestore = { collection: mockCollectionHandle }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  invalidateMediaQuarantineCache: () => undefined,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/media-quarantine/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

async function post(body: Record<string, unknown>): Promise<Response> {
  return route.POST(
    new Request('https://app.aglyn.com/api/admin/media-quarantine', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

async function listing(): Promise<Response> {
  return route.GET(
    new Request('https://app.aglyn.com/api/admin/media-quarantine', {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
}

const entries = () =>
  (mockStore[INDEX_PATH]?.['entries'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >

/** Three live entries, the shape a real deny list holds. */
function seedList() {
  mockStore[INDEX_PATH] = {
    entries: {
      [SHA_KEY]: {
        reason: 'dmca',
        message: null,
        note: 'notice 2026-114, Meridian Publishing',
        atMs: 1_700_000_000_000,
        untilMs: null,
        actorUid: 'staff-super-1',
        originScopeSegment: 'org:acme',
        originMediaId: 'm1',
      },
      [LEGACY_KEY]: {
        reason: 'malware',
        message: null,
        note: null,
        atMs: 1_600_000_000_000,
        untilMs: 1_650_000_000_000,
        actorUid: 'staff-super-2',
        originScopeSegment: null,
        originMediaId: null,
      },
      [ASSET_KEY]: {
        reason: 'abuse',
        message: null,
        note: null,
        atMs: 1_690_000_000_000,
        untilMs: null,
        actorUid: 'staff-super-1',
        originScopeSegment: 'org:acme',
        originMediaId: 'm1',
      },
    },
  }
}

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-1700 · a release by key removes only the key it names', () => {
  it('clears the named entry and leaves every other one in force', async () => {
    seedList()
    const response = await post({
      action: 'release',
      by: 'key',
      key: LEGACY_KEY,
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.key).toBe(LEGACY_KEY)
    expect(payload.keys).toEqual([LEGACY_KEY])
    expect(payload.confirmed).toBe(true)
    // The other two keys cover the SAME asset as the released one. Media mode
    // would have cleared all three, which is right when the subject is a file
    // and wrong when the subject is a row.
    expect(Object.keys(entries()).sort()).toEqual(
      [SHA_KEY, ASSET_KEY].sort(),
    )
  })

  it('audits exactly the key it released', async () => {
    seedList()
    await post({ action: 'release', by: 'key', key: ASSET_KEY })
    expect(mockAuditRows).toHaveLength(1)
    expect(mockAuditRows[0]['action']).toBe('mediaQuarantine.release')
    expect(String(mockAuditRows[0]['target'])).toContain(`#${ASSET_KEY}`)
    expect((mockAuditRows[0]['before'] as any).quarantined).toBe(true)
    expect((mockAuditRows[0]['after'] as any).quarantined).toBe(false)
  })

  it('is a confirmed no-op on a key that is not on the list', async () => {
    seedList()
    const payload = await (
      await post({ action: 'release', by: 'key', key: 'hash--deadbeefdeadbeef' })
    ).json()
    expect(payload.confirmed).toBe(true)
    expect(Object.keys(entries())).toHaveLength(3)
  })
})

describe('AGL-1700 · a key can be released, never set', () => {
  it('refuses to quarantine a typed key', async () => {
    const response = await post({
      action: 'quarantine',
      by: 'key',
      key: SHA_KEY,
      reason: 'dmca',
    })
    expect(response.status).toBe(400)
    expect(String((await response.json()).error)).toContain('never from a typed key')
    expect(mockStore[INDEX_PATH]).toBeUndefined()
    expect(mockAuditRows).toHaveLength(0)
  })

  it('refuses a key it would never have emitted', async () => {
    seedList()
    for (const key of [
      '',
      'hash--not-hex',
      'entries.hash--0123456789abcdef',
      `hash--${SHA}--extra`,
      'asset--org:acme',
    ]) {
      const response = await post({ action: 'release', by: 'key', key })
      expect(response.status).toBe(400)
    }
    expect(Object.keys(entries())).toHaveLength(3)
    expect(mockAuditRows).toHaveLength(0)
  })

  it('still refuses a non-super staff role', async () => {
    seedList()
    mockDecodedToken['staffRole'] = 'support'
    const response = await post({
      action: 'release',
      by: 'key',
      key: SHA_KEY,
    })
    expect(response.status).toBe(403)
    expect(Object.keys(entries())).toHaveLength(3)
  })
})

describe('AGL-1700 · the listing the table renders', () => {
  it('carries the staff note and the origin breadcrumb the table needs', async () => {
    seedList()
    const payload = await (await listing()).json()
    expect(payload.count).toBe(3)
    expect(payload.maxEntries).toBe(2000)
    const row = (payload.records as any[]).find((r) => r.key === SHA_KEY)
    // `normalizeMediaQuarantine` drops `note` so it can never reach a customer
    // surface. This route is staff-gated end to end and must NOT normalize:
    // the note is the notice number an operator needs to decide on a lift, and
    // the origin fields are the only breadcrumb from a hash key back to a file.
    expect(row.note).toBe('notice 2026-114, Meridian Publishing')
    expect(row.originScopeSegment).toBe('org:acme')
    expect(row.originMediaId).toBe('m1')
  })
})
