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
 * The durable half of the daily transactional ceiling (AGL-4145), through
 * the real functions against a path-keyed fake store whose transactions
 * re-run when a document they read has moved — without that, the claim
 * would look atomic when it is not.
 *
 * The last block runs the whole path a site's receipt takes: the identity
 * `hostSendingIdentity` stamps from the org document, the real `sendEmail`,
 * and the gate this module installs at load. `fetch` refuses anything but
 * the recorder, so no real mail leaves.
 */

type Doc = Record<string, any>

interface Store {
  docs: Map<string, Doc>
  versions: Map<string, number>
}

function newStore(): Store {
  return { docs: new Map(), versions: new Map() }
}

function apply(current: Doc, value: Doc): Doc {
  const next = { ...current }
  for (const [field, raw] of Object.entries(value)) {
    next[field] =
      raw && typeof raw === 'object' && 'increment' in raw
        ? Number(next[field] ?? 0) + Number((raw as any).increment)
        : raw
  }
  return next
}

function write(store: Store, path: string, value: Doc, merge: boolean): void {
  const current = merge ? (store.docs.get(path) ?? {}) : {}
  store.docs.set(path, apply(current, value))
  store.versions.set(path, (store.versions.get(path) ?? 0) + 1)
}

function snapshot(store: Store, path: string) {
  const data = store.docs.get(path)
  return {
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(store: Store, path: string): any {
  return {
    path,
    get: async () => snapshot(store, path),
    set: async (value: Doc, options?: { merge?: boolean }) =>
      write(store, path, value, Boolean(options?.merge)),
    collection: (name: string) => collectionRef(store, `${path}/${name}`),
  }
}

function collectionRef(store: Store, path: string): any {
  return { doc: (id: string) => docRef(store, `${path}/${id}`) }
}

function fakeFirestore(store: Store): any {
  return {
    collection: (name: string) => collectionRef(store, name),
    runTransaction: async (callback: (tx: any) => Promise<any>) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const read = new Map<string, number>()
        const writes: Array<[string, Doc, boolean]> = []
        const tx = {
          get: async (ref: any) => {
            read.set(ref.path, store.versions.get(ref.path) ?? 0)
            return snapshot(store, ref.path)
          },
          set: (ref: any, value: Doc, options?: { merge?: boolean }) => {
            writes.push([ref.path, value, Boolean(options?.merge)])
          },
        }
        const result = await callback(tx)
        const moved = [...read].some(
          ([path, version]) => (store.versions.get(path) ?? 0) !== version,
        )
        if (moved) continue
        for (const [path, value, merge] of writes) write(store, path, value, merge)
        return result
      }
      throw new Error('transaction retried too many times')
    },
  }
}

let mockDb: any = null

// `FieldValue.increment` is an opaque server-side transform, so it is swapped
// for a sentinel the fake store adds for real. Both export shapes, because
// the modules on this path import the admin app either way.
jest.mock('./firebase-admin', () => {
  const admin = {
    app: () => ({ firestore: () => mockDb }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        delete: () => '<delete>',
        serverTimestamp: () => '<now>',
      },
    },
  }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})

const mockRaiseOperatorAlert = jest.fn<Promise<unknown>, unknown[]>(async () => ({
  outcome: 'delivered',
  type: 'deliverability.transactionalCeilingReached',
}))
jest.mock('./operator-alerts', () => ({
  __esModule: true,
  raiseOperatorAlert: (...args: unknown[]) => mockRaiseOperatorAlert(...args),
}))

const mockOrgs = new Map<string, Doc>()
jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: async (hostId: string) => {
    const org = mockOrgs.get(hostId)
    return org ? { orgId: `org-${hostId}`, org } : null
  },
  getHostDocAdmin: async () => null,
}))

jest.mock('./dns-probe', () => ({
  __esModule: true,
  lookupTxt: async () => ({ answered: true, records: [] }),
  lookupMx: async () => ({ answered: true, records: [] }),
  lookupCaa: async () => ({ answered: true, records: [] }),
}))

import {
  getTransactionalSendCeilingGate,
  rateLimitedRetryAtMs,
  resetEmailDeliverabilityPreflightForTests,
  resetEmailSendGovernorForTests,
  resetOutboundScreenGateForTests,
  sendEmail,
  sendFailureReason,
  transactionalCeilingResetMs,
} from '@aglyn/shared-util-email'
import {
  resolveTransactionalEmailDailyCeiling,
  TRANSACTIONAL_EMAILS_PER_DAY_KEY,
} from '@aglyn/aglyn/app-utils/transactional-email-ceiling'
import {
  claimTransactionalEmailSends,
  installTransactionalSendCeiling,
  recordTransactionalCeilingRefusal,
  releaseTransactionalEmailSends,
  TRANSACTIONAL_CEILING_ALERT_TYPE,
  TRANSACTIONAL_EMAIL_SENDS_COUNTER,
  TRANSACTIONAL_EMAILS_REFUSED_COUNTER,
} from './email-transactional-ceiling'
import { invalidatePlatformLockdownCache, resetTakedownLedger } from './lockdown'
import { hostSendingIdentity } from './sending-domains'

const ORG = 'org-acme'
const DAY_1 = Date.UTC(2026, 10, 3, 15, 0, 0)
const DAY_1_LAST_MINUTE = Date.UTC(2026, 10, 3, 23, 59, 30)
const DAY_2 = Date.UTC(2026, 10, 4, 0, 0, 1)

const sendsOn = (store: Store, orgId: string, dayKey: string) =>
  Number(store.docs.get(`orgs/${orgId}/counters/${TRANSACTIONAL_EMAIL_SENDS_COUNTER}`)?.[dayKey] ?? 0)

const claim = (store: Store, ceiling: number, nowMs = DAY_1, count = 1, orgId = ORG) =>
  claimTransactionalEmailSends({
    orgId,
    hostId: 'host-a',
    count,
    ceiling,
    context: 'receipt',
    nowMs,
    firestore: fakeFirestore(store),
  })

beforeEach(() => {
  mockRaiseOperatorAlert.mockClear()
  mockOrgs.clear()
  mockDb = null
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the claim against the organization’s day', () => {
  it('admits up to the ceiling and refuses the N+1th, writing nothing', async () => {
    const store = newStore()
    for (let i = 0; i < 3; i += 1) {
      await expect(claim(store, 3)).resolves.toMatchObject({
        allowed: true,
        used: i,
        claim: { orgId: ORG, dayKey: '2026-11-03', count: 1 },
      })
    }
    const path = `orgs/${ORG}/counters/${TRANSACTIONAL_EMAIL_SENDS_COUNTER}`
    const version = store.versions.get(path)

    const refused = await claim(store, 3)
    expect(refused).toEqual({
      allowed: false,
      ceiling: 3,
      used: 3,
      retryAtMs: transactionalCeilingResetMs(DAY_1),
    })
    // The refused claim wrote nothing to the counter.
    expect(store.versions.get(path)).toBe(version)
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(3)
  })

  it('lives on the ORGANIZATION, so every site of it shares one day', async () => {
    const store = newStore()
    await claimTransactionalEmailSends({
      orgId: ORG, hostId: 'host-a', count: 1, ceiling: 2, context: 'receipt', nowMs: DAY_1,
      firestore: fakeFirestore(store),
    })
    await claimTransactionalEmailSends({
      orgId: ORG, hostId: 'host-b', count: 1, ceiling: 2, context: 'booking reminder', nowMs: DAY_1,
      firestore: fakeFirestore(store),
    })
    const third = await claimTransactionalEmailSends({
      orgId: ORG, hostId: 'host-c', count: 1, ceiling: 2, context: 'flow step', nowMs: DAY_1,
      firestore: fakeFirestore(store),
    })
    expect(third.allowed).toBe(false)
    expect([...store.docs.keys()].some((path) => path.startsWith('hosts/'))).toBe(false)
  })

  it('lets only one of two concurrent claims take the last slot', async () => {
    const store = newStore()
    await claim(store, 2)
    const [a, b] = await Promise.all([claim(store, 2), claim(store, 2)])
    expect([a.allowed, b.allowed].sort()).toEqual([false, true])
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(2)
  })

  it('starts again at 00:00 UTC, on a field of its own', async () => {
    const store = newStore()
    await expect(claim(store, 1, DAY_1_LAST_MINUTE)).resolves.toMatchObject({ allowed: true })
    await expect(claim(store, 1, DAY_1_LAST_MINUTE)).resolves.toMatchObject({
      allowed: false,
      retryAtMs: Date.UTC(2026, 10, 4),
    })
    await expect(claim(store, 1, DAY_2)).resolves.toMatchObject({
      allowed: true,
      claim: { dayKey: '2026-11-04' },
    })
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(1)
    expect(sendsOn(store, ORG, '2026-11-04')).toBe(1)
  })

  it('holds a workspace to its per-org override, not its plan', async () => {
    const store = newStore()
    const org = {
      plan: 'pro',
      billingStatus: 'active',
      entitlements: { [TRANSACTIONAL_EMAILS_PER_DAY_KEY]: 2 },
    }
    const ceiling = resolveTransactionalEmailDailyCeiling(org as never)
    expect(ceiling).toBe(2)
    expect((await claim(store, ceiling)).allowed).toBe(true)
    expect((await claim(store, ceiling)).allowed).toBe(true)
    expect((await claim(store, ceiling)).allowed).toBe(false)
  })

  it('hands a released claim back, and never below zero', async () => {
    const store = newStore()
    const granted = await claim(store, 5, DAY_1, 3)
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(3)
    await releaseTransactionalEmailSends(granted.claim, fakeFirestore(store))
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(0)
    await releaseTransactionalEmailSends(granted.claim, fakeFirestore(store))
    expect(sendsOn(store, ORG, '2026-11-03')).toBe(0)
  })

  it('fails open when the counter cannot be reached', async () => {
    const broken = {
      collection: fakeFirestore(newStore()).collection,
      runTransaction: async () => {
        throw new Error('UNAVAILABLE')
      },
    }
    await expect(
      claimTransactionalEmailSends({
        orgId: ORG, hostId: null, count: 1, ceiling: 0, context: 'receipt', nowMs: DAY_1,
        firestore: broken,
      }),
    ).resolves.toEqual({ allowed: true, claim: null })
  })
})

describe('a refusal is recorded where staff see it', () => {
  const refuse = (store: Store, count = 1, nowMs = DAY_1) =>
    recordTransactionalCeilingRefusal({
      orgId: ORG,
      hostId: 'host-a',
      dayKey: new Date(nowMs).toISOString().slice(0, 10),
      count,
      used: 200,
      ceiling: 200,
      context: 'flow step',
      nowMs,
      firestore: fakeFirestore(store),
    })

  it('counts every refusal on the day and raises the operator alert on the first only', async () => {
    const store = newStore()
    store.docs.set(`orgs/${ORG}`, { name: 'Acme Builders' })
    await refuse(store)
    await refuse(store, 2)
    await refuse(store)

    const refused = store.docs.get(`orgs/${ORG}/counters/${TRANSACTIONAL_EMAILS_REFUSED_COUNTER}`)
    expect(refused).toMatchObject({
      '2026-11-03': 4,
      ceiling: 200,
      lastRefusedAtMs: DAY_1,
      lastContext: 'flow step',
    })
    expect(mockRaiseOperatorAlert).toHaveBeenCalledTimes(1)
    expect(mockRaiseOperatorAlert).toHaveBeenCalledWith(TRANSACTIONAL_CEILING_ALERT_TYPE, {
      dedupeKey: `${ORG}:2026-11-03`,
      orgId: ORG,
      hostId: 'host-a',
      context: {
        orgId: ORG,
        orgName: 'Acme Builders',
        used: '200',
        ceiling: '200',
        context: 'flow step',
      },
    })
    // Logged as well — the line a person searching the runtime logs finds.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`workspace ${ORG}`))
  })

  it('raises again on the next UTC day', async () => {
    const store = newStore()
    await refuse(store, 1, DAY_1)
    await refuse(store, 1, DAY_2)
    expect(mockRaiseOperatorAlert).toHaveBeenCalledTimes(2)
    expect(mockRaiseOperatorAlert.mock.calls.map((call) => (call[1] as any).dedupeKey)).toEqual([
      `${ORG}:2026-11-03`,
      `${ORG}:2026-11-04`,
    ])
  })

  it('never throws, even when the record cannot be written', async () => {
    await expect(
      recordTransactionalCeilingRefusal({
        orgId: ORG, hostId: null, dayKey: '2026-11-03', count: 1, used: 1, ceiling: 1,
        context: null, nowMs: DAY_1,
        firestore: { collection: () => { throw new Error('UNAVAILABLE') } },
      }),
    ).resolves.toBeUndefined()
  })
})

describe('a site’s receipts, end to end through the installed gate', () => {
  const HOST = 'host-1'
  const originalFetch = global.fetch
  const ENV = { ...process.env }
  let requests: unknown[] = []
  let store: Store

  beforeEach(() => {
    store = newStore()
    mockDb = fakeFirestore(store)
    invalidatePlatformLockdownCache()
    resetTakedownLedger()
    resetEmailDeliverabilityPreflightForTests()
    resetOutboundScreenGateForTests()
    resetEmailSendGovernorForTests()
    installTransactionalSendCeiling()
    requests = []
    process.env = {
      ...ENV,
      RESEND_API_KEY: 're_test',
      USAGE_EMAIL_FROM: 'Aglyn <noreply@aglyn.com>',
    }
    global.fetch = jest.fn(async (url: unknown, init: { body: string }) => {
      if (!String(url).startsWith('https://api.resend.com/')) {
        throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
      }
      requests.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ id: 'email_test' }), text: async () => '' }
    }) as unknown as typeof fetch
    store.docs.set(`hosts/${HOST}`, { subdomain: 'acme', displayName: 'Acme Store' })
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = ENV
  })

  const receipt = async () =>
    sendEmail({
      to: 'buyer@example.com',
      subject: 'Your order',
      text: 'Thanks for your order.',
      sendingIdentity: await hostSendingIdentity(HOST),
      audience: 'tenant',
      owedFor: 'order',
      context: 'receipt',
    })

  it('installs itself at module load', () => {
    expect(getTransactionalSendCeilingGate()).not.toBeNull()
  })

  it('stamps the org’s ceiling on the workspace, override first', async () => {
    mockOrgs.set(HOST, { name: 'Acme', plan: 'starter', billingStatus: 'active' })
    expect((await hostSendingIdentity(HOST)).workspace?.transactionalEmailsPerDay).toBe(1_000)
    mockOrgs.set(HOST, {
      name: 'Acme',
      plan: 'starter',
      billingStatus: 'active',
      entitlements: { [TRANSACTIONAL_EMAILS_PER_DAY_KEY]: 3 },
    })
    expect((await hostSendingIdentity(HOST)).workspace?.transactionalEmailsPerDay).toBe(3)
  })

  it('stamps no ceiling when the org cannot be read, so none is applied', async () => {
    expect((await hostSendingIdentity(HOST)).workspace?.transactionalEmailsPerDay).toBeNull()
    expect((await receipt()).sent).toBe(true)
    expect(
      [...store.docs.keys()].some((path) => path.endsWith(TRANSACTIONAL_EMAIL_SENDS_COUNTER)),
    ).toBe(false)
  })

  it('sends the override’s N, refuses the N+1th, records it, and lets security mail through', async () => {
    mockOrgs.set(HOST, {
      name: 'Acme Builders',
      plan: 'pro',
      billingStatus: 'active',
      entitlements: { [TRANSACTIONAL_EMAILS_PER_DAY_KEY]: 2 },
    })
    expect((await receipt()).sent).toBe(true)
    expect((await receipt()).sent).toBe(true)

    const refused = await receipt()
    expect(sendFailureReason(refused)).toBe('rate-limited')
    expect(rateLimitedRetryAtMs(refused)).toBe(transactionalCeilingResetMs(Date.now()))
    expect(requests).toHaveLength(2)

    const day = new Date().toISOString().slice(0, 10)
    expect(sendsOn(store, `org-${HOST}`, day)).toBe(2)
    expect(
      store.docs.get(`orgs/org-${HOST}/counters/${TRANSACTIONAL_EMAILS_REFUSED_COUNTER}`)?.[day],
    ).toBe(1)
    expect(mockRaiseOperatorAlert).toHaveBeenCalledTimes(1)

    // A site member's password reset at the same moment still goes out.
    const reset = await sendEmail({
      to: 'member@example.com',
      subject: 'Reset your password',
      text: 'Use this link to choose a new password.',
      sendingIdentity: await hostSendingIdentity(HOST),
      audience: 'tenant',
      owedFor: 'account',
      context: 'membership recovery',
    })
    expect(reset.sent).toBe(true)
    expect(requests).toHaveLength(3)
    expect(sendsOn(store, `org-${HOST}`, day)).toBe(2)
  })
})
