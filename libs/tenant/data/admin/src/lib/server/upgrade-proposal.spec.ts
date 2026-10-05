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
 * AGL-3466 — staff ask a workspace to upgrade as a separate step, and a live
 * subscription settles the ask and ends the sales-trial comp.
 */

export {}

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()
const DELETE = '__delete__'

function mockMerge(existing: Doc | undefined, data: Doc, merge: boolean): Doc {
  const base: Doc = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
    }
    if (value === DELETE) {
      delete base[key]
    } else if (
      merge &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      base[key] = mockMerge(base[key] as Doc, value as Doc, true)
    } else {
      base[key] = value
    }
  }
  return base
}

const mockSnapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => (store.get(path) ?? {})[field],
})

let mockAutoId = 0
function mockMakeDoc(path: string): any {
  return {
    path,
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
  }
}
function mockMakeCollection(prefix: string): any {
  return {
    doc: (id?: string) => mockMakeDoc(`${prefix}/${id ?? `auto-${(mockAutoId += 1)}`}`),
  }
}
function mockFirestore(): any {
  return {
    collection: (name: string) => mockMakeCollection(name),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
          writes.push(() =>
            store.set(ref.path, mockMerge(store.get(ref.path), data, Boolean(options?.merge))),
          )
        },
      }
      const result = await fn(tx)
      for (const write of writes) write()
      return result
    },
  }
}

const mockActivity: Array<{ actor: unknown; action: string }> = []
const mockSent: Array<Record<string, unknown>> = []

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__', delete: () => '__delete__' },
}))
jest.mock('./organizations', () => ({
  __esModule: true,
  logOrgActivity: async (_orgId: string, actor: unknown, action: string) => {
    mockActivity.push({ actor, action })
  },
}))
jest.mock('./email-metering', () => ({
  __esModule: true,
  meterOrgEmail: async () => undefined,
}))
jest.mock('./render-system-email', () => ({
  __esModule: true,
  systemEmailBrand: (org: Record<string, unknown> | null) => ({
    merge: { 'brand.productName': 'Aglyn' },
    options: {},
    orgName: typeof org?.['name'] === 'string' ? org['name'] : undefined,
  }),
  renderSystemEmailContent: async (
    key: string,
    merge: Record<string, string>,
    _brand: unknown,
    fallback: { subject: string; text: string },
  ) => ({ ...fallback, key, merge }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))

const {
  proposeOrgUpgrade,
  settleSubscriptionStart,
  UpgradeProposalError,
  withdrawOrgUpgrade,
} = require('./upgrade-proposal') as typeof import('./upgrade-proposal')

const ORG = 'org-1'
const audits = () =>
  [...store.entries()].filter(([path]) => path.startsWith('adminAudit/')).map(([, row]) => row)
const org = () => store.get(`orgs/${ORG}`) as Doc

/** A workspace staff comped to Starter for a sales trial, owned by the client. */
function seedTrial(extra: Doc = {}): void {
  store.set(`orgs/${ORG}`, {
    name: 'Acme',
    slug: 'acme',
    ownerUid: 'client',
    entitlements: {
      planComp: { plan: 'starter', reason: 'trial', note: null, grantedBy: 'staff' },
    },
    ...extra,
  })
  store.set(`orgs/${ORG}/members/client`, { role: 'owner', email: 'client@acme.test' })
}

beforeEach(() => {
  store = new Map()
  mockActivity.length = 0
  mockSent.length = 0
})

describe('proposing an upgrade (AGL-3466)', () => {
  const propose = (plan: unknown = 'starter', note?: string) =>
    proposeOrgUpgrade({
      orgId: ORG,
      plan,
      note,
      actor: { uid: 'staff', email: 'zed@aglyn.test' },
      origin: 'https://app.aglyn.test',
    })

  it('records the proposal, audits it, and emails the owner the Billing link', async () => {
    seedTrial()
    const result = await propose('starter', '  as discussed  ')
    expect(result.emailed).toBe(true)
    expect(org()['upgradeProposal']).toMatchObject({
      plan: 'starter',
      proposedBy: 'staff',
      note: 'as discussed',
    })
    expect(audits()).toEqual([
      expect.objectContaining({
        actorUid: 'staff',
        action: 'org.upgradeProposal.propose',
        target: `orgs/${ORG}`,
      }),
    ])
    expect(mockSent).toHaveLength(1)
    expect(mockSent[0]).toMatchObject({
      to: 'client@acme.test',
      context: 'org-upgrade-proposal',
    })
    expect(String(mockSent[0]['text'])).toContain(
      'https://app.aglyn.test/acme/billing?plan=starter',
    )
  })

  it('refuses a plan the workspace cannot buy itself, writing nothing', async () => {
    seedTrial()
    for (const plan of ['free', 'enterprise', 'platinum']) {
      await expect(propose(plan)).rejects.toBeInstanceOf(UpgradeProposalError)
    }
    expect(org()['upgradeProposal']).toBeUndefined()
    expect(audits()).toHaveLength(0)
  })

  it('refuses when a subscription is already live', async () => {
    seedTrial()
    store.set(`orgs/${ORG}/billing/stripe`, { subscription: { status: 'active' } })
    await expect(propose()).rejects.toMatchObject({ status: 409 })
    expect(mockSent).toHaveLength(0)
  })

  it('withdraws a standing proposal, audited, and says when there was none', async () => {
    seedTrial({ upgradeProposal: { plan: 'pro', proposedBy: 'staff', proposedAt: 1 } })
    expect(await withdrawOrgUpgrade({ orgId: ORG, actor: { uid: 'staff' } })).toBe(true)
    expect(org()['upgradeProposal']).toBeUndefined()
    expect(audits()[0]).toMatchObject({ action: 'org.upgradeProposal.withdraw' })
    expect(await withdrawOrgUpgrade({ orgId: ORG, actor: { uid: 'staff' } })).toBe(false)
    expect(audits()).toHaveLength(1)
  })
})

describe('a live subscription settles the proposal and the trial comp (AGL-3466)', () => {
  it('clears both, with an audit row and activity naming why', async () => {
    seedTrial({ upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1 } })
    const outcome = await settleSubscriptionStart(ORG, {
      status: 'active',
      subscriptionId: 'sub_1',
    })
    expect(outcome).toEqual({ proposalCleared: true, trialCompRemoved: true })
    expect(org()['upgradeProposal']).toBeUndefined()
    // The comp was the only override, so the map goes with it.
    expect(org()['entitlements']).toBeUndefined()
    expect(audits()).toEqual([
      expect.objectContaining({
        actorUid: 'system',
        action: 'org.subscriptionStarted.settle',
        reason: expect.objectContaining({ code: 'subscription_live' }),
      }),
    ])
    expect(mockActivity.map((row) => row.action)).toEqual([
      'The Starter plan proposal closed — the subscription is live',
      'The Starter sales-trial comp ended — the subscription is live',
    ])
    expect(mockActivity.every((row) => (row.actor as { uid: unknown }).uid === null)).toBe(true)
  })

  it('keeps the other overrides when it removes the trial comp', async () => {
    seedTrial()
    store.set(`orgs/${ORG}`, {
      ...org(),
      entitlements: { ...(org()['entitlements'] as Doc), hostLimit: 9 },
    })
    await settleSubscriptionStart(ORG, { status: 'active' })
    expect(org()['entitlements']).toEqual({ hostLimit: 9 })
  })

  it('leaves a comp granted for any other reason alone', async () => {
    seedTrial({
      upgradeProposal: { plan: 'pro', proposedBy: 'staff', proposedAt: 1 },
      entitlements: { planComp: { plan: 'pro', reason: 'partner' } },
    })
    const outcome = await settleSubscriptionStart(ORG, { status: 'active' })
    expect(outcome).toEqual({ proposalCleared: true, trialCompRemoved: false })
    expect(org()['entitlements']).toEqual({ planComp: { plan: 'pro', reason: 'partner' } })
  })

  it('is idempotent: a redelivery writes nothing', async () => {
    seedTrial({ upgradeProposal: { plan: 'starter', proposedBy: 'staff', proposedAt: 1 } })
    await settleSubscriptionStart(ORG, { status: 'active' })
    const after = new Map(store)
    const again = await settleSubscriptionStart(ORG, { status: 'active' })
    expect(again).toEqual({ proposalCleared: false, trialCompRemoved: false })
    expect(store).toEqual(after)
  })

  it('does nothing for an org that is gone', async () => {
    expect(await settleSubscriptionStart('missing', { status: 'active' })).toEqual({
      proposalCleared: false,
      trialCompRemoved: false,
    })
  })
})
