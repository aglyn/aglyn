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
 * PUTTING A PRICE ON EMAIL MUST NOT MAKE TRANSACTIONAL MAIL REFUSABLE.
 *
 * The band now costs money past its edge, and the tempting simplification
 * once a meter has a rate is to enforce it on everything that moves the
 * meter. That would be the worst possible reading of this change. The two
 * classes fail in opposite directions:
 *
 *  - a refused CAMPAIGN is the product working. The customer is told, the
 *    audience is untouched, and they upgrade or wait.
 *  - a refused PASSWORD RESET locks somebody out of their own account, and
 *    the message explaining why is itself an email that will not send. A
 *    dropped order confirmation reads to a buyer as a failed order.
 *
 * So the cap and the price are asserted TOGETHER, at one plan's real band,
 * through the real functions: at the edge a campaign is refused and writes
 * nothing, transactional mail keeps going out and keeps being counted, and
 * the excess that produces is what the invoice prices.
 *
 * `email-send-metering-coverage.spec.ts` proves the same rule structurally —
 * exactly one sending file may name `emailSendsPerMonth`. This one proves it
 * behaviourally, which is the half that would survive a sender learning to
 * consult the cap through a helper with a different name.
 */

// `FieldValue.increment` returns an opaque transform the Admin SDK resolves
// server-side, so a fake store cannot apply it. Swapped for a sentinel the
// fake below adds for real — an increment that never landed would make every
// count read 0, and a cap compared against 0 admits everything.
jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        throw new Error('no default app in tests — inject a firestore')
      },
    }),
    firestore: {
      FieldValue: { increment: (value: number) => ({ increment: value }) },
    },
  },
}))

import {
  CAMPAIGN_EMAIL_SENDS_COUNTER,
  EMAIL_SENDS_COUNTER,
  emailSendsOverage,
  recordEmailSends,
  reserveCampaignEmailSends,
} from './email-metering'
import {
  PLAN_ENTITLEMENTS,
  priceEmailSendOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

const MONTH = '2026-08'
const ORG = 'org-acme'
const HOST = 'host-a'

/** Business, whose band is the smallest of the four that were lowered. */
const BAND = PLAN_ENTITLEMENTS.business.emailSendsPerMonth

// ---------------------------------------------------------------------------
// A path-keyed store. `{ increment: n }` is applied as a real addition, and a
// transaction re-runs when a document it read has moved — without that the
// cap would look atomic when it is not.
// ---------------------------------------------------------------------------
interface Store {
  docs: Map<string, Record<string, any>>
  versions: Map<string, number>
}

function newStore(): Store {
  return { docs: new Map(), versions: new Map() }
}

function apply(current: Record<string, any>, value: Record<string, any>) {
  const next = { ...current }
  for (const [field, raw] of Object.entries(value)) {
    next[field] =
      raw && typeof raw === 'object' && 'increment' in raw
        ? Number(next[field] ?? 0) + Number((raw as any).increment)
        : raw
  }
  return next
}

function write(
  store: Store,
  path: string,
  value: Record<string, any>,
  merge: boolean,
) {
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
    set: async (value: any, options?: { merge?: boolean }) =>
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
        const writes: Array<[string, Record<string, any>, boolean]> = []
        const tx = {
          get: async (ref: any) => {
            read.set(ref.path, store.versions.get(ref.path) ?? 0)
            return snapshot(store, ref.path)
          },
          set: (ref: any, value: any, options?: { merge?: boolean }) => {
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

const campaignCounter = (store: Store) =>
  Number(
    store.docs.get(`orgs/${ORG}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`)?.[
      MONTH
    ] ?? 0,
  )

const costCounter = (store: Store, scope: string) =>
  Number(store.docs.get(`${scope}/counters/${EMAIL_SENDS_COUNTER}`)?.[MONTH] ?? 0)

describe('the premise: the band is a real, finite number', () => {
  it('Business includes 25,000 campaign emails a month', () => {
    // Every assertion below compares against this. A stubbed entitlements
    // module would resolve it to 0, and a cap of 0 refuses everything — so
    // "the campaign was refused" would pass while proving nothing at all.
    expect(BAND).toBe(25_000)
    expect(Number.isFinite(BAND)).toBe(true)
    expect(
      resolveOrgEntitlements({ plan: 'business' } as never).emailSendsPerMonth,
    ).toBe(BAND)
  })
})

describe('at the cap, a campaign is refused', () => {
  it('refuses the claim that would cross the band', () => {
    const store = newStore()
    store.docs.set(`orgs/${ORG}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`, {
      [MONTH]: BAND - 100,
    })
    return reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 500,
      limit: BAND,
      firestore: fakeFirestore(store),
    }).then((result) => {
      expect(result.ok).toBe(false)
      expect(result.used).toBe(BAND - 100)
      expect(result.limit).toBe(BAND)
      // A refused reservation writes NOTHING. A cap that spent the allowance
      // it just declined to grant would refuse the next campaign too, for a
      // send that never happened.
      expect(campaignCounter(store)).toBe(BAND - 100)
    })
  })

  it('BOTH WAYS: the same claim inside the band is granted', async () => {
    // The control. A reservation function that refused unconditionally would
    // satisfy the case above and be a total outage on campaign sending.
    const store = newStore()
    store.docs.set(`orgs/${ORG}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`, {
      [MONTH]: BAND - 600,
    })
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 500,
      limit: BAND,
      firestore: fakeFirestore(store),
    })
    expect(result.ok).toBe(true)
    expect(campaignCounter(store)).toBe(BAND - 100)
  })

  it('BOTH WAYS: a raised band grants what the shipped band refused', async () => {
    // The refusal has to depend on the NUMBER, not on the arithmetic being
    // broken in the refusing direction. Same store, same claim, larger cap.
    const store = newStore()
    store.docs.set(`orgs/${ORG}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`, {
      [MONTH]: BAND - 100,
    })
    const result = await reserveCampaignEmailSends({
      orgId: ORG,
      month: MONTH,
      count: 500,
      limit: PLAN_ENTITLEMENTS.agency.emailSendsPerMonth,
      firestore: fakeFirestore(store),
    })
    expect(result.ok).toBe(true)
  })
})

describe('…while transactional mail keeps going out', () => {
  it('sends and counts past the band, and never touches the campaign meter', async () => {
    const store = newStore()
    const firestore = fakeFirestore(store)
    // The org is already at its cap on campaigns.
    store.docs.set(`orgs/${ORG}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`, {
      [MONTH]: BAND,
    })
    store.docs.set(`hosts/${HOST}/counters/${EMAIL_SENDS_COUNTER}`, {
      [MONTH]: BAND,
    })

    // Receipts, booking reminders and password resets, after the cap.
    await recordEmailSends({
      scope: { kind: 'host', hostId: HOST },
      count: 4_000,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })

    // The function does not throw, does not refuse, and takes no cap as an
    // argument — there is no parameter it could have consulted.
    expect(costCounter(store, `hosts/${HOST}`)).toBe(BAND + 4_000)
    // The enforceable meter is untouched, so the next campaign is refused for
    // campaigns the org actually sent and not for its order confirmations.
    expect(campaignCounter(store)).toBe(BAND)
  })

  it('a campaign moves BOTH meters, which is what makes the split real', async () => {
    // Non-vacuous: if `recordEmailSends` never wrote the campaign counter at
    // all, the assertion above would hold for the wrong reason.
    const store = newStore()
    await recordEmailSends({
      scope: { kind: 'org', orgId: ORG },
      count: 300,
      sendClass: 'campaign',
      month: MONTH,
      firestore: fakeFirestore(store),
    })
    expect(costCounter(store, `orgs/${ORG}`)).toBe(300)
    expect(campaignCounter(store)).toBe(300)
  })
})

describe('the excess that produces is what the invoice prices', () => {
  it('prices the transactional overflow, not the campaigns', () => {
    // The month above: 25,000 campaign emails inside the band, then 4,000
    // transactional past it. The cost meter reads 29,000 and the band is
    // 25,000, so 4,000 is billable at Business's $2.00/1,000.
    const overage = emailSendsOverage(BAND + 4_000, BAND)
    expect(overage).toBe(4_000)
    const priced = priceEmailSendOverage({ plan: 'business' } as never, overage)
    expect(priced.overageRateUsd).toBe(2)
    expect(priced.overageMonthlyUsd).toBe(8)
  })

  it('a month inside the band bills nothing', () => {
    // The other direction, and the one a customer meets far more often.
    expect(emailSendsOverage(BAND - 1, BAND)).toBe(0)
    expect(
      priceEmailSendOverage({ plan: 'business' } as never, 0).overageMonthlyUsd,
    ).toBe(0)
    // The boundary belongs to the customer: exactly at the band is free.
    expect(emailSendsOverage(BAND, BAND)).toBe(0)
  })

  it('an unbounded band yields no overage rather than the whole month', () => {
    // A per-org contract can still grant one, and the direction to be wrong
    // in is the one that cannot invent a charge.
    expect(emailSendsOverage(1_000_000, Number.POSITIVE_INFINITY)).toBe(0)
    // …and so does a band of zero, which is how "no included allowance" is
    // written. Free sends no campaigns and is billed for none.
    expect(emailSendsOverage(500, 0)).toBe(0)
  })
})
