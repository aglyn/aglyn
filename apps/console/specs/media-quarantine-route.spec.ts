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
 * /api/admin/media-quarantine driven in-process (AGL-1512).
 *
 * Only Firestore and the auth verification are mocked; the route's own
 * validation, key derivation, audit shape and read-back run for real. Five
 * properties, each of which a shallow implementation would break silently:
 *
 *  1. **The role gate.** Setting a quarantine is a takedown, so it is
 *     super-only and fails CLOSED on a missing `staffRole` claim.
 *  2. **Every action audits — set AND lift.** A lift row that could not say
 *     what it released would make a forgotten quarantine indistinguishable
 *     from a procedural one.
 *  3. **The write touches TWO collections and no others.** The storage
 *     counter is a BILLING input: the media document, `counters/media` and
 *     the object in Storage must all be untouched. Quarantine suppresses;
 *     it does not erase, and it must never re-bill a customer.
 *  4. **No `undefined` reaches Firestore.** Explicit `null` throughout, so
 *     a merge can never wipe a sibling field and an absent key never reads
 *     as "this record predates expiry".
 *  5. **The read-back is real.** Every write answers with a fresh read of
 *     what it wrote (AGL-1571) — a click that never left the pointer looks
 *     exactly like one that succeeded.
 */

import {
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINES_COLLECTION,
} from '@aglyn/aglyn/server'

const INDEX_PATH = `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}`

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
/** Every doc path written, so "touched nothing else" is provable. */
let mockWrites: string[] = []
let mockInvalidations = 0
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

/**
 * A merge that behaves like Firestore's: nested maps merge key-by-key and
 * a `FieldValue.delete()` sentinel removes the key. Modelled rather than
 * stubbed because the route depends on exactly this — two operators acting
 * on different assets during one incident must not overwrite each other.
 */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDelete) {
      delete next[key]
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof next[key] === 'object' &&
      next[key] !== null &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeInto(
        next[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

const mockDocHandle = (path: string) => ({
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ) => {
    mockWrites.push(path)
    mockStore[path] = options?.merge
      ? mergeInto(mockStore[path] ?? {}, data)
      : data
  },
})

const mockFirestore = {
  collection: (collection: string) => ({
    add: async (data: Record<string, unknown>) => {
      mockWrites.push(`${collection}/<generated>`)
      if (collection !== 'adminAudit') {
        throw new Error(`unexpected add: ${collection}`)
      }
      mockAuditRows.push(data)
      return { id: `audit-${mockAuditRows.length}` }
    },
    doc: (id: string) => mockDocHandle(`${collection}/${id}`),
  }),
}

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
  invalidateMediaQuarantineCache: () => {
    mockInvalidations += 1
  },
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

async function get(query = ''): Promise<Response> {
  return route.GET(
    new Request(`https://app.aglyn.com/api/admin/media-quarantine${query}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
}

const HASH = '0123456789abcdef'
const KEY = `hash--${HASH}`

const entries = () =>
  (mockStore[INDEX_PATH]?.['entries'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >

const onlyRow = () => {
  expect(mockAuditRows).toHaveLength(1)
  return mockAuditRows[0]
}

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  mockWrites = []
  mockInvalidations = 0
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
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

describe('AGL-1512 · the role gate', () => {
  it('rejects a non-staff caller', async () => {
    mockDecodedToken['staff'] = false
    expect((await post({ action: 'quarantine' })).status).toBe(403)
  })

  it('rejects a staff caller who is not super — a takedown is not support work', async () => {
    mockDecodedToken['staffRole'] = 'support'
    const response = await post({
      action: 'quarantine',
      contentHash: HASH,
      reason: 'malware',
    })
    expect(response.status).toBe(403)
    expect(mockWrites).toEqual([])
  })

  it('fails CLOSED on a missing staffRole claim (AGL-495)', async () => {
    delete mockDecodedToken['staffRole']
    expect(
      (await post({ action: 'quarantine', contentHash: HASH, reason: 'malware' }))
        .status,
    ).toBe(403)
  })

  it('lets a support-role reader PROBE — incident answers are read-only', async () => {
    mockDecodedToken['staffRole'] = 'support'
    const response = await get()
    expect(response.status).toBe(200)
    expect((await response.json()).records).toEqual([])
  })

  it('rejects an unauthenticated caller', async () => {
    const response = await route.POST(
      new Request('https://app.aglyn.com/api/admin/media-quarantine', {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('AGL-1512 · validation', () => {
  it('refuses an unknown action', async () => {
    expect((await post({ action: 'nuke', contentHash: HASH })).status).toBe(400)
  })

  it('refuses a lockdown reason code — the vocabularies are not the same', async () => {
    const response = await post({
      action: 'quarantine',
      contentHash: HASH,
      reason: 'security',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('dmca')
  })

  it('refuses a hash quarantine with no hash, and says what to send instead', async () => {
    const response = await post({ action: 'quarantine', reason: 'malware' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('by: "asset"')
  })

  it('refuses a non-hex contentHash', async () => {
    expect(
      (
        await post({
          action: 'quarantine',
          contentHash: '../../etc/passwd',
          reason: 'malware',
        })
      ).status,
    ).toBe(400)
  })

  it('refuses a scope segment that could not be addressed as a map key', async () => {
    // A `.` would read as a field-path separator, and a key that cannot be
    // addressed is a quarantine that cannot be LIFTED.
    expect(
      (
        await post({
          action: 'quarantine',
          by: 'asset',
          scopeSegment: 'org.acme',
          mediaId: 'm1',
          reason: 'abuse',
        })
      ).status,
    ).toBe(400)
  })

  it('refuses an expiry already in the past', async () => {
    const response = await post({
      action: 'quarantine',
      contentHash: HASH,
      reason: 'malware',
      untilMs: Date.now() - 1000,
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('never bite')
  })
})

describe('AGL-1512 · setting and lifting', () => {
  it('writes the entry, invalidates, and reads back what it wrote', async () => {
    const untilMs = Date.now() + 15 * 60_000
    const response = await post({
      action: 'quarantine',
      contentHash: HASH,
      scopeSegment: 'org:acme',
      mediaId: 'm1',
      reason: 'dmca',
      message: 'Disabled pending a copyright claim.',
      note: 'Notice #4417 — staff eyes only',
      untilMs,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.key).toBe(KEY)
    expect(body.confirmed).toBe(true)
    expect(body.verified).toMatchObject({ key: KEY, reason: 'dmca', untilMs })
    // The read-back state feeds the owner notice, and the STAFF note must
    // not be anywhere in it.
    expect(JSON.stringify(body)).not.toContain('Notice #4417')
    expect(body.notice.contact).toBe('support@aglyn.com')
    expect(mockInvalidations).toBe(1)
    expect(entries()[KEY]).toMatchObject({
      reason: 'dmca',
      actorUid: 'staff-super-1',
      originScopeSegment: 'org:acme',
      originMediaId: 'm1',
    })
  })

  it('a lift removes the entry and leaves every other one alone', async () => {
    mockStore[INDEX_PATH] = {
      entries: {
        [KEY]: { reason: 'malware', atMs: 1, untilMs: null, actorUid: 'x' },
        'hash--deadbeefdeadbeef': { reason: 'abuse', atMs: 2 },
      },
    }
    const response = await post({ action: 'release', contentHash: HASH })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.confirmed).toBe(true)
    expect(body.verified).toBeNull()
    expect(Object.keys(entries())).toEqual(['hash--deadbeefdeadbeef'])
  })

  it('the asset key is available for a document with no hash', async () => {
    const response = await post({
      action: 'quarantine',
      by: 'asset',
      scopeSegment: 'h1',
      mediaId: 'hashless',
      reason: 'legal',
    })
    expect((await response.json()).key).toBe('asset--h1--hashless')
  })

  it('by: "asset" narrows to ONE document even when a hash is available', async () => {
    // The same bytes can be innocuous in one workspace and reported in
    // another; a hash key would take both down.
    const response = await post({
      action: 'quarantine',
      by: 'asset',
      contentHash: HASH,
      scopeSegment: 'org:acme',
      mediaId: 'm1',
      reason: 'abuse',
    })
    expect((await response.json()).key).toBe('asset--org:acme--m1')
  })
})

describe('AGL-1512 · the audit trail', () => {
  it('a SET records reason, expiry, message, note and the actor', async () => {
    const untilMs = Date.now() + 15 * 60_000
    await post({
      action: 'quarantine',
      contentHash: HASH,
      reason: 'dmca',
      message: 'Disabled pending a copyright claim.',
      note: 'Notice #4417',
      untilMs,
    })
    const row = onlyRow()
    expect(row['action']).toBe('mediaQuarantine.quarantine')
    expect(row['scope']).toBe('asset')
    expect(row['target']).toBe(`${INDEX_PATH}#${KEY}`)
    expect(row['actorUid']).toBe('staff-super-1')
    expect(row['actorEmail']).toBe('ops@aglyn.com')
    expect(row['before']).toEqual({
      quarantined: false,
      reason: null,
      message: null,
      note: null,
      untilMs: null,
      atMs: null,
      actorUid: null,
    })
    expect(row['after']).toMatchObject({
      quarantined: true,
      reason: 'dmca',
      message: 'Disabled pending a copyright claim.',
      // The staff rationale belongs in the TRAIL — it is the only place it
      // is allowed to live besides the stored entry.
      note: 'Notice #4417',
      untilMs,
    })
  })

  it('a LIFT records what it released — not merely that it released', async () => {
    const untilMs = Date.now() + 15 * 60_000
    mockStore[INDEX_PATH] = {
      entries: {
        [KEY]: {
          reason: 'malware',
          message: 'Flagged by a scan.',
          note: null,
          atMs: 1,
          untilMs,
          actorUid: 'staff-1',
        },
      },
    }
    await post({ action: 'release', contentHash: HASH })
    const row = onlyRow()
    expect(row['action']).toBe('mediaQuarantine.release')
    expect(row['before']).toMatchObject({
      quarantined: true,
      reason: 'malware',
      message: 'Flagged by a scan.',
      untilMs,
    })
    expect(row['after']).toMatchObject({ quarantined: false, reason: null })
  })

  it('a REFUSED request writes no audit row and no entry', async () => {
    mockDecodedToken['staffRole'] = 'support'
    await post({ action: 'quarantine', contentHash: HASH, reason: 'malware' })
    expect(mockAuditRows).toEqual([])
    expect(mockStore[INDEX_PATH]).toBeUndefined()
  })
})

describe('AGL-1512 · the storage counter is a billing input', () => {
  it('writes ONLY the deny list and the audit row — nothing else', async () => {
    await post({ action: 'quarantine', contentHash: HASH, reason: 'malware' })
    // No media document, no `counters/media`, no org doc, no Storage. The
    // file still exists and still belongs to the org; it is SUPPRESSED,
    // not erased, and quietly re-billing a customer while refusing their
    // file would be a worse bug than the one this fixes.
    expect(mockWrites).toEqual([INDEX_PATH, 'adminAudit/<generated>'])
  })

  it('a lift writes only those two as well', async () => {
    mockStore[INDEX_PATH] = { entries: { [KEY]: { reason: 'malware' } } }
    await post({ action: 'release', contentHash: HASH })
    expect(mockWrites).toEqual([INDEX_PATH, 'adminAudit/<generated>'])
  })
})

describe('AGL-1512 · no undefined ever reaches Firestore', () => {
  it('every optional field is written as an explicit null', async () => {
    await post({ action: 'quarantine', contentHash: HASH, reason: 'manual' })
    const entry = entries()[KEY]
    for (const field of [
      'message',
      'note',
      'untilMs',
      'originScopeSegment',
      'originMediaId',
    ]) {
      expect(entry).toHaveProperty(field)
      expect(entry[field]).toBeNull()
    }
    expect(
      Object.values(entry).some((value) => value === undefined),
    ).toBe(false)
  })
})

describe('AGL-1512 · the probe', () => {
  it('reports an unknown key as not quarantined, with no notice', async () => {
    const body = await (await get('?key=hash--nope')).json()
    expect(body.quarantined).toBe(false)
    expect(body.notice).toBeNull()
  })

  it('reports a live entry with the OWNER copy, never the staff note', async () => {
    mockStore[INDEX_PATH] = {
      entries: {
        [KEY]: { reason: 'dmca', note: 'Notice #4417', atMs: 1 },
      },
    }
    const body = await (await get(`?key=${KEY}`)).json()
    expect(body.quarantined).toBe(true)
    expect(body.notice.title).toBe('This file was disabled')
    expect(body.notice.body).toContain('not been deleted')
    expect(JSON.stringify(body)).not.toContain('Notice #4417')
  })

  it('the listing is never cached — a stale takedown list is worse than none', async () => {
    expect((await get()).headers.get('cache-control')).toBe('no-store')
  })
})
