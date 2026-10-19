/**
 * @jest-environment node
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
 * AGL-3956 — hand off and propose, one act.
 *
 * Staff hand a workspace they built to its client and propose its plan
 * (plan, add-ons, cadence, coupon) in the same request to the invites route.
 * The invitation and the proposal commit in ONE transaction, so a refused
 * proposal never leaves an invitation standing and a refused invitation
 * never leaves a proposal. A workspace that already pays is handed off
 * alone (`proposalSkipped`). Only staff propose with a hand-off. Accepting a
 * hand-off with a standing proposal lands the new owner on Billing with the
 * bundle preselected. The plain hand-off is pinned in
 * `owner-handoff-invite.spec.ts`; the proposal library in
 * `libs/tenant/data/admin/src/lib/server/upgrade-proposal.spec.ts`.
 */

const mockRecordProposalActivity = jest.fn()
/** Set to make the next transaction fail after its reads, before it commits. */
let mockFailNextCommit: Error | null = null
/** Called as each transaction starts, with its 1-based sequence number. */
let mockOnTransaction: ((sequence: number) => void) | null = null
let mockTransactions = 0

const mockVerifyIdToken = jest.fn()
const mockIsStaffAddress = jest.fn()
const mockOwnerHandoffSeatRefusal = jest.fn()
const mockManagerSeatRefusal = jest.fn()
const mockAcceptOwnerHandoff = jest.fn()
const mockLockout = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockResolveOrgMembership = jest.fn()

type Doc = Record<string, unknown>
let mockStore = new Map<string, Doc>()

function mockSnapshot(path: string) {
  return {
    id: path.split('/').pop() as string,
    exists: mockStore.has(path),
    data: () => mockStore.get(path),
    get: (field: string) => (mockStore.get(path) ?? {})[field],
    ref: mockDoc(path),
  }
}
function mockQuery(prefix: string, filters: Array<[string, unknown]>): any {
  const run = async () => {
    const docs = [...mockStore.entries()]
      .filter(
        ([path, data]) =>
          path.startsWith(`${prefix}/`) &&
          !path.slice(prefix.length + 1).includes('/') &&
          filters.every(([field, value]) => (data[field] ?? null) === value),
      )
      .map(([path]) => mockSnapshot(path))
    return { empty: docs.length === 0, docs }
  }
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(prefix, [...filters, [field, value]]),
    limit: () => mockQuery(prefix, filters),
    get: run,
  }
}
function mockDoc(path: string): any {
  return {
    path,
    get: async () => mockSnapshot(path),
    set: async (data: Doc, options?: { merge?: boolean }) => {
      const base = options?.merge ? { ...(mockStore.get(path) ?? {}) } : {}
      for (const [key, value] of Object.entries(data)) {
        if (value === '__delete__') delete base[key]
        else base[key] = value
      }
      mockStore.set(path, base)
    },
    delete: async () => {
      mockStore.delete(path)
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}
function mockCollection(prefix: string): any {
  return { ...mockQuery(prefix, []), doc: (id: string) => mockDoc(`${prefix}/${id}`) }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW', delete: () => '__delete__' },
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: async () => ({ sent: false }),
}))
jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))
jest.mock('../app/api/_lib/sso-transfer-lockout', () => ({
  __esModule: true,
  assessOwnershipTransferLockout: (...args: unknown[]) => mockLockout(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/account-addresses', () => ({
  __esModule: true,
  attributableAccountForAddress: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  acceptOwnerHandoff: (...args: unknown[]) => mockAcceptOwnerHandoff(...args),
  ...(() => {
    class UpgradeProposalError extends Error {
      readonly status: number
      constructor(message: string, status = 400) {
        super(message)
        this.status = status
      }
    }
    const { normalizeUpgradeProposalBundle } = jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/upgrade-proposal',
    )
    return {
      UpgradeProposalError,
      // The library's own shape: a paid plan, the bundle normalized to it.
      buildUpgradeProposal: (options: Record<string, any>) => {
        if (!['starter', 'pro', 'business'].includes(String(options['plan']))) {
          throw new UpgradeProposalError('Choose a paid plan the workspace can buy itself')
        }
        return {
          plan: options['plan'],
          proposedBy: options['actor'].uid,
          proposedAt: 1,
          ...(options['note'] ? { note: options['note'] } : {}),
          ...normalizeUpgradeProposalBundle(options['plan'], options),
        }
      },
      readUpgradeProposalTarget: async (tx: any, orgRef: any) => {
        const snapshot = await tx.get(orgRef)
        if (!snapshot.exists) throw new UpgradeProposalError('Unknown organization', 404)
        if (snapshot.get('billingStatus') === 'active') {
          throw new UpgradeProposalError('This workspace already has a live subscription', 409)
        }
        return snapshot.data()
      },
      stageUpgradeProposal: (tx: any, db: any, options: Record<string, any>) => {
        tx.set(db.collection('orgs').doc(options['orgId']), { upgradeProposal: options['proposal'] }, { merge: true })
      },
      recordUpgradeProposalActivity: (...args: unknown[]) => mockRecordProposalActivity(...args),
    }
  })(),
  collaboratorSeatRefusal: async () => null,
  collaboratorSeatRefusalResponse: () => null,
  consumeRateLimit: async () => ({ allowed: true }),
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  getOrgDoc: async () => mockStore.get('orgs/org-1'),
  isImpersonationSession: () => false,
  isStaffAddress: (...args: unknown[]) => mockIsStaffAddress(...args),
  lockdownRefusal: async () => null,
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
  managerSeatRefusal: (...args: unknown[]) => mockManagerSeatRefusal(...args),
  managerSeatRefusalResponse: () => null,
  memberHasOrgPermission: async (_orgId: string, member?: { role?: string }) =>
    member?.role === 'owner' || member?.role === 'admin',
  meterOrgEmail: async () => undefined,
  notifyOrgAdmins: async () => undefined,
  notifyUsers: async () => undefined,
  orgOwnerSeatRefusalResponse: () => null,
  ownerHandoffRefusalResponse: () => null,
  ownerHandoffSeatRefusal: (...args: unknown[]) => mockOwnerHandoffSeatRefusal(...args),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
  upsertOrgMember: async () => {
    throw new Error('a handoff must not go through upsertOrgMember')
  },
  verifiedAccountEmails: async () => [],
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => mockCollection(name),
        // Reads now, writes queued and applied only when the callback
        // resolves: what a Firestore transaction promises.
        runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
          mockOnTransaction?.(++mockTransactions)
          const writes: Array<() => Promise<void>> = []
          const tx = {
            get: (ref: any) => ref.get(),
            set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
              writes.push(() => ref.set(data, options))
            },
          }
          const result = await callback(tx)
          if (mockFailNextCommit) {
            const failure = mockFailNextCommit
            mockFailNextCommit = null
            throw failure
          }
          for (const write of writes) await write()
          return result
        },
        batch: () => ({ update: () => undefined, commit: async () => undefined }),
      }),
    }),
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/console-routes'),
  createResourceUid: () => 'invite-new',
  resolveBrandingProfile: () => ({ productName: 'Aglyn', fromName: 'Aglyn' }),
  brandMergeTokens: () => ({}),
  resolveIdpDisplayName: () => 'Client',
  resolveIdpPhotoUrl: () => '',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/orgs/invites/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/invites', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

const signedInAs = (uid: string, email: string, claims: Doc = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email, email_verified: true, ...claims })

const invites = () =>
  [...mockStore.entries()].filter(([path]) => path.startsWith('orgs/org-1/invites/'))

beforeEach(() => {
  jest.clearAllMocks()
  mockFailNextCommit = null
  mockOnTransaction = null
  mockTransactions = 0
  mockStore = new Map<string, Doc>([
    ['orgs/org-1', { name: 'Acme', slug: 'acme', ownerUid: 'owner' }],
    ['orgs/org-1/members/owner', { role: 'owner', email: 'owner@acme.test' }],
    ['orgs/org-1/members/admin', { role: 'admin', email: 'admin@acme.test' }],
  ])
  mockIsStaffAddress.mockResolvedValue(false)
  mockOwnerHandoffSeatRefusal.mockResolvedValue(null)
  mockManagerSeatRefusal.mockResolvedValue(null)
  mockLockout.mockResolvedValue({ refused: false, reason: null, verdict: 'allowed' })
  mockAcceptOwnerHandoff.mockResolvedValue({ previousOwnerUid: 'owner', previousOwner: 'stay' })
  mockResolveOrgMembership.mockImplementation(async (uid: string) => {
    const row = mockStore.get(`orgs/org-1/members/${uid}`)
    return row ? { orgId: 'org-1', member: { $id: uid, ...row } } : null
  })
})

const STAFF_CLAIMS = { staff: true }

const handoffAndPropose = (proposal: Doc, previousOwner = 'leave') => ({
  action: 'create',
  email: 'client@acme.test',
  role: 'owner',
  handoff: { previousOwner },
  proposal,
})

const BUNDLE = { plan: 'starter', addons: { siteCare: true }, interval: 'year', coupon: 'BOOTH25' }

describe('hand off and propose, one act (AGL-3956)', () => {
  it('staff send both: the invitation and the bundle proposal commit together', async () => {
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    const response = await post(handoffAndPropose(BUNDLE))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      inviteId: 'invite-new',
      proposal: { plan: 'starter', addons: { siteCare: 1 }, interval: 'year', coupon: 'BOOTH25' },
    })
    expect(body.proposalSkipped).toBeUndefined()
    expect(mockStore.get('orgs/org-1/invites/invite-new')).toMatchObject({
      email: 'client@acme.test',
      role: 'owner',
      handoff: { previousOwner: 'leave' },
    })
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toMatchObject({
      plan: 'starter',
      proposedBy: 'staff',
      addons: { siteCare: 1 },
    })
    expect(mockRecordProposalActivity).toHaveBeenCalledWith(
      'org-1',
      { uid: 'staff', email: 'zed@aglyn.test' },
      expect.objectContaining({ plan: 'starter' }),
    )
  })

  it('a workspace that already pays is handed off alone, and the answer says so', async () => {
    mockStore.set('orgs/org-1', { ...mockStore.get('orgs/org-1'), billingStatus: 'active' })
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    const response = await post(handoffAndPropose(BUNDLE))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, proposalSkipped: true })
    expect(body.proposal).toBeUndefined()
    expect(mockStore.has('orgs/org-1/invites/invite-new')).toBe(true)
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
    expect(mockRecordProposalActivity).not.toHaveBeenCalled()
  })

  it('a subscription that goes live mid-request still leaves the hand-off, alone', async () => {
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    // The pre-check (transaction 1) passes; the write (transaction 2) then
    // finds the subscription live.
    mockOnTransaction = (sequence) => {
      if (sequence === 2) {
        mockStore.set('orgs/org-1', { ...mockStore.get('orgs/org-1'), billingStatus: 'active' })
      }
    }
    const response = await post(handoffAndPropose(BUNDLE))
    expect(mockTransactions).toBe(2)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, proposalSkipped: true })
    expect(body.proposal).toBeUndefined()
    expect(mockStore.has('orgs/org-1/invites/invite-new')).toBe(true)
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
    expect(mockRecordProposalActivity).not.toHaveBeenCalled()
  })

  it('a refused proposal writes nothing at all, invitation included', async () => {
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    const response = await post(handoffAndPropose({ plan: 'free' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Choose a paid plan the workspace can buy itself' })
    expect(invites()).toHaveLength(0)
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
  })

  it('a write transaction that fails leaves neither half', async () => {
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockOnTransaction = (sequence) => {
      if (sequence === 2) mockFailNextCommit = new Error('ABORTED')
    }
    const response = await post(handoffAndPropose(BUNDLE))
    expect(mockTransactions).toBe(2)
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(invites()).toHaveLength(0)
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
    expect(mockRecordProposalActivity).not.toHaveBeenCalled()
  })

  it('only staff propose with a hand-off: the owner handing on proposes nothing', async () => {
    signedInAs('owner', 'owner@acme.test')
    const response = await post(handoffAndPropose(BUNDLE, 'stay'))
    expect(response.status).toBe(403)
    expect(invites()).toHaveLength(0)
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
  })

  it('a proposal without a hand-off is ignored: an ordinary invite proposes nothing', async () => {
    signedInAs('staff', 'zed@aglyn.test', STAFF_CLAIMS)
    const response = await post({
      action: 'create',
      email: 'client@acme.test',
      role: 'admin',
      allHosts: true,
      proposal: BUNDLE,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).proposal).toBeUndefined()
    expect(mockStore.get('orgs/org-1')?.['upgradeProposal']).toBeUndefined()
  })
})

describe('accepting a hand-off that proposed its plan (AGL-3956)', () => {
  beforeEach(() => {
    mockStore.set('orgs/org-1/invites/handoff-1', {
      email: 'client@acme.test',
      role: 'owner',
      allHosts: true,
      handoff: { previousOwner: 'leave' },
      acceptedAt: null,
    })
    signedInAs('client', 'client@acme.test')
  })

  it('lands the new owner on Billing with the bundle preselected', async () => {
    mockStore.set('orgs/org-1', {
      ...mockStore.get('orgs/org-1'),
      upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1, addons: { siteCare: 1 }, interval: 'year' },
    })
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, owner: true })
    expect(body.billingDestination).toMatch(/^\/acme\/billing\?/)
    const query = new URLSearchParams(String(body.billingDestination).split('?')[1])
    expect(query.get('plan')).toBe('starter')
    expect(query.get('interval')).toBe('year')
    expect(query.get('addons')).toBe('siteCare')
  })

  it('CONTROL: without a standing proposal it is the org home, as before', async () => {
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(await response.json()).toEqual({ ok: true, owner: true })
  })

  it('a workspace that already pays is not sent to buy again', async () => {
    mockStore.set('orgs/org-1', {
      ...mockStore.get('orgs/org-1'),
      billingStatus: 'active',
      upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1 },
    })
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(await response.json()).toEqual({ ok: true, owner: true })
  })
})
