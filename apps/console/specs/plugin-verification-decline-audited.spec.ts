/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * A DECLINED VERIFICATION LEAVES A RECORD (AGL-2328, item 4).
 *
 * `decline-verification` mutates `verificationRequest.state`, notifies the
 * publisher and starts a cooldown they must wait out before asking again —
 * and wrote no `adminAudit` row, unlike every sibling branch in the same
 * file, while the route's own header claims it is audited. It was therefore
 * the one staff decision here that could not be reviewed afterwards, on the
 * action whose reason staff are REQUIRED to type: the route refuses a
 * decline without one, and the publisher is shown it.
 *
 * WHAT THIS FILE HAS TO CATCH, and the false greens it is shaped against:
 *
 *  - **A row that exists but says nothing.** Asserting "one audit row was
 *    written" passes on a row with an empty reason and no target. Every
 *    field is asserted, and the reason is asserted as THE OPERATOR'S OWN
 *    TEXT, twice, with two different reasons — so a writer recording a
 *    constant, or the listing name, or the action string, dies here.
 *  - **The reason must land in the column the audit page can read.** It goes
 *    in `reason`, which the audit log renders, exports and searches
 *    (AGL-1652). A reason buried in `after` would satisfy any "is the string
 *    present somewhere in the document" check and remain unreadable in the
 *    product, which is the exact class of defect this sweep exists to end.
 *  - **No write on the paths that do not decline.** A refused decline (no
 *    reason, or nothing pending) must leave the log alone; an audit row for
 *    a decision that did not happen is worse than none.
 */

const mockVerifyIdToken = jest.fn()
const mockNotifyOrgAdmins = jest.fn(async () => undefined)

/** `path → data`. One flat store, so a wrong path is a visible wrong answer. */
const mockStore: Record<string, Record<string, unknown>> = {}
/** Everything added to `adminAudit`, in order. */
const mockAudit: Record<string, unknown>[] = []

function mockDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    get: async () => ({
      exists: mockStore[path] != null,
      id: path.split('/').pop(),
      data: () => mockStore[path],
      get: (field: string) => mockStore[path]?.[field],
    }),
    set: async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
      // `set(merge)` merges at the TOP level only — a nested object replaces
      // rather than deep-merges. Modelled exactly, because the route writes
      // `verificationRequest` by spreading the existing one, and a double
      // that deep-merged would hide a spread the route had dropped.
      const base = options?.merge ? (mockStore[path] ?? {}) : {}
      mockStore[path] = { ...base, ...patch }
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

function mockCollection(path: string): any {
  return {
    doc: (id: string) => mockDoc(`${path}/${id}`),
    add: async (data: Record<string, unknown>) => {
      if (path === 'adminAudit') mockAudit.push(data)
      return { id: `${path}-${Math.random()}` }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => mockCollection(name),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  // The rest of the module's surface. A wholesale `jest.mock` is a CLOSED
  // WORLD: an export the route's import list names and this factory omits is
  // `undefined` at module load, and the failure surfaces far from its cause.
  findUserByUidAcrossPools: jest.fn(async () => null),
  updateExisting: jest.fn(async () => undefined),
  listOrgMembers: jest.fn(async () => []),
  meterPlatformEmail: jest.fn(async () => undefined),
  notifyOrgAdmins: (...args: unknown[]) => mockNotifyOrgAdmins(...(args as [])),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: jest.fn(async () => undefined),
}))

import { POST } from '../app/api/admin/plugin-reviews/route'

const LISTING = 'listing-atlas'

const decline = (reason: string, token = 'staff-token') =>
  POST(
    new Request('https://console.aglyn.com/api/admin/plugin-reviews', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'decline-verification',
        listingId: LISTING,
        reason,
      }),
    }),
  )

const seed = (verificationRequest: Record<string, unknown> | null) => {
  mockStore[`marketplaceListings/${LISTING}`] = {
    displayName: 'Atlas Maps',
    profileId: 'org-publisher',
    ...(verificationRequest ? { verificationRequest } : {}),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockAudit.length = 0
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-reviewer',
    email: 'reviewer@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('declining a verification request is audited (AGL-2328)', () => {
  it('writes the row, carrying the reason the operator actually typed', async () => {
    seed({ state: 'pending', requestedBy: 'u-publisher' })
    const response = await decline(
      'The support address on the listing bounces and the company registration could not be matched.',
    )
    expect(response.status).toBe(200)

    expect(mockAudit).toHaveLength(1)
    const row = mockAudit[0]
    expect(row).toMatchObject({
      actorUid: 'u-reviewer',
      actorEmail: 'reviewer@aglyn.com',
      action: 'plugins.verification.decline',
      scope: 'marketplace',
      target: `marketplaceListings/${LISTING}`,
    })
    // THE OPERATOR'S OWN WORDS, in the column the audit page renders,
    // exports and searches. A reason tucked inside `after` would be present
    // in the document and absent from the product.
    expect(row['reason']).toBe(
      'The support address on the listing bounces and the company registration could not be matched.',
    )
    expect(row['before']).toMatchObject({ verificationState: 'pending' })
    expect(row['after']).toMatchObject({ verificationState: 'declined' })

    // The decision itself still lands — the audit row is an addition, not a
    // replacement for the mutation.
    expect(
      (mockStore[`marketplaceListings/${LISTING}`]['verificationRequest'] as any)
        .state,
    ).toBe('declined')
    expect(mockNotifyOrgAdmins).toHaveBeenCalled()
  })

  it('records a DIFFERENT reason differently, so a constant cannot pass', async () => {
    // The same route, a second decline, another operator's words. A writer
    // recording a fixed string, the listing name, or the action id satisfies
    // the test above and fails here.
    seed({ state: 'pending' })
    await decline('Duplicate of an existing verified publisher.')
    expect(mockAudit[0]['reason']).toBe(
      'Duplicate of an existing verified publisher.',
    )
    expect(mockAudit[0]['reason']).not.toBe('Atlas Maps')
    expect(mockAudit[0]['reason']).not.toContain('decline-verification')
  })

  it('writes nothing when the decline is refused for want of a reason', async () => {
    seed({ state: 'pending' })
    const response = await decline('   ')
    expect(response.status).toBe(400)
    // An audit row for a decision that did not happen is worse than none.
    expect(mockAudit).toHaveLength(0)
    expect(
      (mockStore[`marketplaceListings/${LISTING}`]['verificationRequest'] as any)
        .state,
    ).toBe('pending')
  })

  it('writes nothing when there is no request waiting', async () => {
    seed({ state: 'declined' })
    const response = await decline('Already handled.')
    expect(response.status).toBe(409)
    expect(mockAudit).toHaveLength(0)
  })

  it('writes nothing for a non-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-customer',
      email_verified: true,
    })
    seed({ state: 'pending' })
    const response = await decline('Nice try.')
    expect(response.status).toBe(403)
    expect(mockAudit).toHaveLength(0)
  })
})
