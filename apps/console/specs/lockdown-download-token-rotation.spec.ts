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
 * IS THE AGL-1526 REVOCATION WIRED? — `applyOrgLockdown` / `applyHostLockdown`
 * unmocked.
 *
 * `media-download-tokens.spec.ts` proves rotation WORKS. It says nothing
 * about whether anything calls it, and this repo's most repeated failure is
 * exactly that: a control that exists, is tested, and runs nowhere
 * (`feedback_verify_control_is_wired`). A rotation helper sitting in
 * `libs/` while the panic button never invokes it would leave every raw
 * `firebasestorage.googleapis.com/...?alt=media&token=` URL of a locked org
 * serving — the original bug, with a green test suite over it.
 *
 * So this spec drives the real lock core and asserts on the CALL: that it
 * happens, on the lock action only, for the `security` reason only, and
 * with the prefixes that actually cover the scope's assets.
 *
 * `lockRotatesDownloadTokens` is delegated to the REAL implementation
 * rather than restated here. The policy ("security + full, nothing else")
 * is the thing under test; a local copy of the rule would agree with itself
 * forever while the shipped predicate drifted.
 *
 * The negative controls carry as much weight as the positives:
 *  - a `billing` lock rotates NOTHING — an unpaid invoice must not
 *    permanently break every embedded asset URL the customer ever pasted;
 *  - a read-only lock rotates nothing, because its whole promise is that
 *    the sites keep serving;
 *  - an UNLOCK rotates nothing;
 *  - and the prefixes named are the locked scope's, so an unlocked org's
 *    assets are never in the blast radius.
 */

/** Every `rotateScopeDownloadTokens` call the lock core made. */
const mockRotationCalls: Array<{ prefixes: string[] }> = []
let mockMembers: Array<Record<string, unknown>> = []

const mockDeleteSentinel = Symbol('FieldValue.delete')
const mockServerTimestamp = Symbol('FieldValue.serverTimestamp')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => mockServerTimestamp,
    delete: () => mockDeleteSentinel,
  },
}))

// The rotation module reaches for the admin app at bucket-resolution time.
// Nothing here gets that far — `rotateScopeDownloadTokens` is the spy — but
// the import must not drag a real Firebase app into the process.
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({ __esModule: true, firebaseAdmin: { app: () => ({}) } }),
)

jest.mock('@aglyn/tenant-data-admin', () => {
  const actual = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-download-tokens',
  )
  return {
    __esModule: true,
    listOrgMembers: async () => mockMembers,
    findUserByUidAcrossPools: async () => null,
    authForPool: () => ({ revokeRefreshTokens: async () => undefined }),
    // THE REAL POLICY PREDICATE.
    lockRotatesDownloadTokens: actual.lockRotatesDownloadTokens,
    rotateScopeDownloadTokens: async (options: { prefixes: string[] }) => {
      mockRotationCalls.push({ prefixes: [...options.prefixes] })
      return options.prefixes.map((prefix) => ({
        prefix,
        scanned: 2,
        rotated: 2,
        failed: 0,
        truncated: false,
        ok: true,
        reason: 'ok',
      }))
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  screenRoutePathToUrl: (path: string) => path,
}))

/**
 * The same Firestore double the revocation wiring spec uses: `set(merge)`
 * conjures a missing doc, a `FieldValue.delete()` value REMOVES the key,
 * and batched writes land only on `commit()`.
 */
let store: Record<string, Record<string, unknown>> = {}

function applyMerge(path: string, data: Record<string, unknown>): void {
  const next = { ...(store[path] ?? {}) }
  for (const [key, value] of Object.entries(data)) {
    if (value === mockDeleteSentinel) delete next[key]
    else next[key] = value
  }
  store[path] = next
}

interface DocRef {
  path: string
  set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>
  get: () => Promise<{
    exists: boolean
    get: (field: string) => unknown
    data: () => Record<string, unknown> | undefined
  }>
  collection: (name: string) => { doc: (id: string) => DocRef }
}

function docRef(path: string): DocRef {
  return {
    path,
    set: async (data, options) => {
      if (options?.merge) applyMerge(path, data)
      else store[path] = { ...data }
    },
    get: async () => {
      const data = store[path] ? { ...store[path] } : undefined
      return {
        exists: data !== undefined,
        get: (field: string) => data?.[field],
        data: () => data,
      }
    },
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
  }
}

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  batch: () => {
    const queued: Array<() => void> = []
    return {
      set: (
        ref: DocRef,
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        queued.push(() => {
          if (options?.merge) applyMerge(ref.path, data)
          else store[ref.path] = { ...data }
        })
      },
      commit: async () => {
        for (const write of queued) write()
      },
    }
  },
} as never

// `require` after the factories, so the module under test resolves its own
// imports against the mocks.
const { applyOrgLockdown, applyHostLockdown } =
  require('../utils/server/org-lockdown') as {
    applyOrgLockdown: (options: Record<string, unknown>) => Promise<{
      downloadTokensRotated: Array<Record<string, unknown>>
    }>
    applyHostLockdown: (options: Record<string, unknown>) => Promise<{
      downloadTokensRotated: Array<Record<string, unknown>>
    }>
  }

const ORG = 'org-acme'

const lockOrg = (
  action: 'lock' | 'unlock',
  reason: string,
  mode?: 'full' | 'read-only',
) =>
  applyOrgLockdown({
    firestore,
    orgId: ORG,
    action,
    lock: { reason, ...(mode ? { mode } : {}) },
    revokeMemberTokens: false,
  })

beforeEach(() => {
  mockRotationCalls.length = 0
  mockMembers = [{ $id: 'user-1' }]
  store = {
    // Two sites: the org tree alone is never the whole library.
    [`orgs/${ORG}`]: { hosts: { 'host-one': true, 'host-two': true } },
  }
  delete process.env['REVALIDATE_SECRET']
})

describe('org lockdown wires the raw-URL revocation', () => {
  it('CALLS rotation on a security lock, over the org tree AND every site tree', async () => {
    const result = await lockOrg('lock', 'security')

    // The wiring assertion. Without it, everything else here is theatre.
    expect(mockRotationCalls.length).toBe(1)
    expect(mockRotationCalls[0].prefixes).toEqual([
      `orgs/${ORG}/`,
      'hosts/host-one/',
      'hosts/host-two/',
    ])
    // And the outcome is reported back, so the audit row can record it.
    expect(result.downloadTokensRotated.length).toBe(3)
    expect(result.downloadTokensRotated.every((entry) => entry['ok'])).toBe(true)
  })

  it('rotates only AFTER the lock is durable', async () => {
    // Rotation is the slow, truncatable effect; enforcement must never wait
    // behind it or depend on it having finished.
    let lockedWhenRotated: unknown
    mockMembers = [{ $id: 'user-1' }]
    const spyStore = store
    const original = mockRotationCalls.push.bind(mockRotationCalls)
    mockRotationCalls.push = ((entry: { prefixes: string[] }) => {
      lockedWhenRotated = spyStore[`orgs/${ORG}`]?.['suspendedAt']
      return original(entry)
    }) as never

    await lockOrg('lock', 'security')
    mockRotationCalls.push = original

    expect(lockedWhenRotated).toBe(mockServerTimestamp)
  })

  it('NEGATIVE CONTROL: a billing lock rotates nothing', async () => {
    // An unpaid invoice must not permanently kill every embedded raw URL.
    const result = await lockOrg('lock', 'billing')
    expect(mockRotationCalls.length).toBe(0)
    expect(result.downloadTokensRotated).toEqual([])
    // ...while the lock itself still landed, so this is not just a no-op run.
    expect(store[`orgs/${ORG}`]['suspendedAt']).toBe(mockServerTimestamp)
  })

  it('NEGATIVE CONTROL: maintenance and manual locks rotate nothing', async () => {
    await lockOrg('lock', 'maintenance')
    await lockOrg('lock', 'manual')
    expect(mockRotationCalls.length).toBe(0)
  })

  it('NEGATIVE CONTROL: a read-only security lock rotates nothing', async () => {
    // `security` is chosen deliberately — it is the reason that DOES rotate
    // under a full lock, so a pass discriminates on the MODE, not on a mild
    // reason.
    const result = await lockOrg('lock', 'security', 'read-only')
    expect(mockRotationCalls.length).toBe(0)
    expect(result.downloadTokensRotated).toEqual([])
  })

  it('NEGATIVE CONTROL: an UNLOCK rotates nothing', async () => {
    await lockOrg('lock', 'security')
    mockRotationCalls.length = 0
    const result = await lockOrg('unlock', 'security')
    expect(mockRotationCalls.length).toBe(0)
    expect(result.downloadTokensRotated).toEqual([])
    // Rotation is irreversible: an unlock cannot hand the old URLs back, and
    // must not pretend to by rotating again.
    expect(store[`orgs/${ORG}`]['suspendedAt']).toBeUndefined()
  })

  it('NEGATIVE CONTROL: an unlocked org is never named in the prefixes', async () => {
    await lockOrg('lock', 'security')
    const named = mockRotationCalls[0].prefixes.join(' ')
    expect(named).not.toContain('org-other')
    expect(named).not.toContain('host-three')
    // No bucket-wide sweep: every prefix is scoped to the locked org.
    expect(
      mockRotationCalls[0].prefixes.every(
        (prefix) => prefix.startsWith(`orgs/${ORG}/`) || prefix.startsWith('hosts/'),
      ),
    ).toBe(true)
    expect(mockRotationCalls[0].prefixes).not.toContain('')
  })
})

describe('host takedown wires the raw-URL revocation', () => {
  const lockHost = (
    action: 'lock' | 'unlock',
    reason: string,
    mode?: 'full' | 'read-only',
  ) =>
    applyHostLockdown({
      firestore,
      hostId: 'host-one',
      action,
      lock: { reason, ...(mode ? { mode } : {}) },
    })

  it('CALLS rotation on a security takedown, scoped to that one site', async () => {
    const result = await lockHost('lock', 'security')
    expect(mockRotationCalls.length).toBe(1)
    expect(mockRotationCalls[0].prefixes).toEqual(['hosts/host-one/'])
    expect(result.downloadTokensRotated.length).toBe(1)
  })

  it('NEGATIVE CONTROL: another site under the same org is untouched', async () => {
    await lockHost('lock', 'security')
    expect(mockRotationCalls[0].prefixes).not.toContain('hosts/host-two/')
    expect(mockRotationCalls[0].prefixes).not.toContain(`orgs/${ORG}/`)
  })

  it('NEGATIVE CONTROL: a billing or read-only host lock rotates nothing', async () => {
    await lockHost('lock', 'billing')
    await lockHost('lock', 'security', 'read-only')
    await lockHost('unlock', 'security')
    expect(mockRotationCalls.length).toBe(0)
  })
})
