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
 *
 * @jest-environment node
 */

/**
 * AGL-2371 — the two marketplace install doors hold `templatesPerHost` under
 * CONCURRENCY.
 *
 * AGL-2231 named the shape on `/api/hosts/resources`: count, decide, await
 * something, then write. Every await is a yield, so N in-flight installs each
 * read the same pre-count, each find room, and each land — and nothing
 * re-counts afterwards, so the extra templates are permanent.
 *
 *  - **`install-template.ts`** counted the library, decided, then awaited
 *    `recordInstallProvenance`, then awaited a second `source.listingId` query,
 *    and only then committed a `WriteBatch`. Two long awaits between the
 *    decision and the write.
 *  - **`install-layout.ts`** counted, decided, then awaited
 *    `hasDivergedFromBase` and `recordInstallProvenance` before its batch.
 *
 * A `WriteBatch` is atomic but NOT conditional on a read taken before it —
 * the lesson AGL-2369 paid for one route over — so neither batch was ever the
 * gate it looked like.
 *
 * ## The vector is DISTINCT listings
 *
 * Twenty concurrent installs of the SAME listing are not laundering: a
 * re-install replaces its own bundle (AGL-671), so the library lands on the
 * same number however many arrive. Twenty installs of twenty DIFFERENT
 * listings each spend a slot, and that is what the cases below fire.
 *
 * ## What the double models, and why that is not cheating
 *
 * `Transaction.get(Query)` holds a pessimistic lock on every document the query
 * matched, so two transactions counting the same collection cannot both commit
 * against the same snapshot: the loser aborts, retries, re-reads the higher
 * count and is refused. The fake models that and nothing more — a body runs
 * holding a global lock, reads see the store as of that moment, buffered writes
 * apply on commit, and a read after a write throws as the server does.
 *
 * **The lock is on the TRANSACTION, not on the handler.** Both routes still
 * carry a pre-check outside it, so with the authoritative check hoisted back
 * out beside that one, serializing the transaction body changes nothing. See
 * `FORCED RED` on each concurrency test.
 *
 * ## Both halves, always
 *
 * Every case pins the pair: the last permitted install SUCCEEDS and the next is
 * refused, the concurrent cases assert the EXACT number of survivors, an
 * UNLIMITED plan lands all of them, and the paid finite plan is enforced at ITS
 * number rather than free's.
 */

interface FakeTemplate {
  id: string
  [field: string]: unknown
}

const mockState: {
  org: Record<string, unknown>
  /** `hosts/{host}/templates`, keyed by id — the SERVER's view. */
  templates: Map<string, FakeTemplate>
  /** Screens on the published template version under install. */
  screens: unknown[]
  /** How many transaction bodies ran, including retries. */
  attempts: number
} = {
  org: {},
  templates: new Map(),
  screens: [],
  attempts: 0,
}

/** Sequential ids, so twenty concurrent installs are twenty distinct docs. */
let mockUid = 0

/** Dotted field paths, exactly as a real `DocumentSnapshot.get` reads them. */
const readPath = (data: Record<string, unknown>, path: string) =>
  path
    .split('.')
    .reduce<any>(
      (branch, key) => (branch == null ? undefined : branch[key]),
      data,
    )

const mockTemplateRef = (id: string) => ({
  id,
  get: async () => mockSnapshot(id),
  set: async (payload: Record<string, unknown>) => {
    mockState.templates.set(id, { id, ...payload })
  },
  update: async (payload: Record<string, unknown>) => {
    const current = mockState.templates.get(id)
    // Firestore's `update` FAILS on a missing document rather than creating
    // one. Modelled, so a route updating the wrong ref reads as a failure here
    // instead of silently minting a template.
    if (!current) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
    mockState.templates.set(id, { ...current, ...payload })
  },
})

const mockSnapshot = (id: string) => {
  const data = mockState.templates.get(id)
  return {
    id,
    exists: data != null,
    data: () => data,
    get: (path: string) => readPath((data ?? {}) as Record<string, unknown>, path),
    ref: mockTemplateRef(id),
  }
}

const mockTemplatesCollection: any = {
  __isTemplates: true,
  get: async () => ({
    docs: [...mockState.templates.keys()].map((id) => mockSnapshot(id)),
  }),
  doc: (id: string) => mockTemplateRef(id),
}

const mockHostRef: any = {
  id: 'host-1',
  get: async () => ({
    exists: true,
    get: (field: string) =>
      field === 'memberRoles' ? { 'user-1': 'admin' } : undefined,
  }),
  collection: () => mockTemplatesCollection,
}

/** The listing under install — its id decides which slot it spends. */
let mockListingId = 'listing-1'

const mockListingRef = (listingId: string) => ({
  get: async () => ({
    data: () => ({
      priceUsd: 0,
      profileId: 'seller-org',
      latestVersion: 1,
      displayName: 'Fancy layout',
      artifactType: mockArtifactType,
    }),
  }),
  collection: () => ({
    doc: () => ({
      get: async () => ({
        get: (field: string) =>
          field === 'template'
            ? { screens: mockState.screens }
            : { rootId: 'root', nodes: { root: {} } },
      }),
    }),
  }),
  update: async () => undefined,
  __listingId: listingId,
})

/** `template` or `layout`, so one double drives both doors. */
let mockArtifactType = 'template'

/**
 * A transaction that SERIALIZES and defers its writes, which is what the fix
 * leans on.
 *
 * One global lock stands in for the per-collection pessimistic lock: an install
 * touches one host's templates collection, so a finer-grained model would be
 * more code for the same verdict. Each body runs to completion — reads, then
 * decision, then the buffered writes applied on commit — before the next
 * begins. The serialization is what makes the second body's COUNT see the first
 * body's writes, which is the property under test.
 */
let mockLock: Promise<unknown> = Promise.resolve()
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  const attempt = mockLock.then(async () => {
    mockState.attempts += 1
    const buffered: Array<() => unknown> = []
    const result = await body({
      get: async (target: any) => {
        if (buffered.length) {
          throw new Error('Firestore transactions cannot read after a write')
        }
        return target.get()
      },
      set: (ref: any, payload: unknown) => {
        buffered.push(() => ref.set(payload))
      },
      update: (ref: any, payload: unknown) => {
        buffered.push(() => ref.update(payload))
      },
    })
    for (const write of buffered) await write()
    return result
  })
  // The lock must advance even when a body rejects, or one failure deadlocks
  // every later install in the suite.
  mockLock = attempt.catch(() => undefined)
  return attempt
}

const mockFirestore = {
  runTransaction: (body: (tx: any) => Promise<any>) => mockRunTransaction(body),
  // A batch is left in place and DELIBERATELY unusable: a route that fell back
  // to one would throw here rather than quietly pass the cases below.
  batch: () => {
    throw new Error('the install doors write through a transaction (AGL-2371)')
  },
  collection: (name: string) => ({
    doc: (id: string) =>
      name === 'hosts' ? mockHostRef : mockListingRef(id ?? mockListingId),
  }),
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({ canActAsPublisher: async () => true }))

jest.mock('./purchase-entitlement', () => ({
  requirePurchase: async () => null,
}))

jest.mock('./provenance', () => ({
  hasDivergedFromBase: async () => false,
  recordInstallProvenance: async () => ({
    installedFrom: { sha256: 'sha' },
    baseStored: true,
  }),
}))

jest.mock('./version-stats', () => ({ recordVersionMove: async () => undefined }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1' }) }),
      firestore: () => mockFirestore,
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW', increment: (by: number) => by } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockState.org }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table. Stubbing `checkQuota` would let this suite pass
  // against a route enforcing nothing — which IS the bug.
  ...jest.requireActual('../../../../../aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL node codec (AGL-1151). Both install handlers compress the tree
  // they write, and this factory is a CLOSED WORLD — an absent export throws
  // and the handler's own catch answers 500, which reads exactly like the CAP
  // arithmetic under test regressing.
  ...jest.requireActual('../../../../../aglyn/src/lib/app-utils/stored-nodes'),
  createResourceUid: () => `tpl-${(mockUid += 1)}`,
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { installTemplateHandler } from './install-template'
import { installLayoutHandler } from './install-layout'

const FREE_TEMPLATES = PLAN_ENTITLEMENTS.free.templatesPerHost
const STARTER_TEMPLATES = PLAN_ENTITLEMENTS.starter.templatesPerHost

const makeRes = () => {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const install = async (
  handler: typeof installTemplateHandler,
  listingId: string,
) => {
  const res = makeRes()
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { listingId, hostId: 'host-1' },
    } as any,
    res,
  )
  return res
}

const installTemplate = (listingId: string) =>
  install(installTemplateHandler, listingId)
const installLayout = (listingId: string) =>
  install(installLayoutHandler, listingId)

/**
 * `count` templates already in the library, none of them from a listing under
 * test, none of them platform starters.
 *
 * `source.type: 'authored'` matters: the template route excludes
 * `source.type === 'starter'` from the count (AGL-687), so seeding starters
 * would seed rows the cap does not see and every assertion would be off by
 * however many were seeded.
 */
const seed = (count: number) => {
  mockState.templates = new Map()
  for (let index = 0; index < count; index += 1) {
    mockState.templates.set(`seed-${index}`, {
      id: `seed-${index}`,
      kind: 'page',
      source: { type: 'authored', listingId: `unrelated-${index}` },
    })
  }
}

/** Templates the plan is charged for, by the template route's own rule. */
const billable = () =>
  [...mockState.templates.values()].filter(
    (entry) =>
      !entry['deletedAt'] &&
      (entry['source'] as any)?.type !== 'starter',
  ).length

beforeEach(() => {
  jest.clearAllMocks()
  mockLock = Promise.resolve()
  mockUid = 0
  mockArtifactType = 'template'
  mockListingId = 'listing-1'
  mockState.org = { plan: 'free' }
  mockState.templates = new Map()
  mockState.screens = [{ displayName: 'Home', nodes: { root: {} } }]
  mockState.attempts = 0
})

describe('the premise', () => {
  it('free includes a small, FINITE template library', () => {
    // If this ever became UNLIMITED the whole suite would go vacuous — every
    // install would succeed and every assertion below would still pass.
    expect(FREE_TEMPLATES).toBe(10)
    expect(Number.isFinite(FREE_TEMPLATES)).toBe(true)
    expect(STARTER_TEMPLATES).toBe(50)
  })
})

describe('SEQUENTIALLY: a template install admits the last slot and refuses the next', () => {
  it('installs into the 10th slot', async () => {
    seed(FREE_TEMPLATES - 1)
    const res = await installTemplate('listing-1')
    expect(res.statusCode).toBe(200)
    expect(billable()).toBe(FREE_TEMPLATES)
  })

  it('refuses the 11th, and writes nothing', async () => {
    seed(FREE_TEMPLATES)
    const res = await installTemplate('listing-1')
    expect(res.statusCode).toBe(403)
    // A 403 with the template written anyway is the same defect with a status
    // in front of it.
    expect(billable()).toBe(FREE_TEMPLATES)
  })

  it('prices a MULTI-SCREEN bundle by the slots it spends, both ways', async () => {
    mockState.screens = [
      { displayName: 'Home', nodes: {} },
      { displayName: 'About', nodes: {} },
      { displayName: 'Contact', nodes: {} },
    ]
    seed(FREE_TEMPLATES - 3)
    expect((await installTemplate('listing-1')).statusCode).toBe(200)
    expect(billable()).toBe(FREE_TEMPLATES)

    seed(FREE_TEMPLATES - 2)
    expect((await installTemplate('listing-1')).statusCode).toBe(403)
    expect(billable()).toBe(FREE_TEMPLATES - 2)
  })

  it('a RE-INSTALL of the same listing replaces rather than stacks', async () => {
    // The reason the concurrent cases below use distinct listings: this path
    // must stay free even from a full library, or "Update available" becomes
    // unusable the moment a plan is at its cap.
    seed(FREE_TEMPLATES - 1)
    expect((await installTemplate('listing-1')).statusCode).toBe(200)
    expect(billable()).toBe(FREE_TEMPLATES)
    const second = await installTemplate('listing-1')
    expect(second.statusCode).toBe(200)
    expect(second.body.replaced).toBe(1)
    expect(billable()).toBe(FREE_TEMPLATES)
  })
})

describe('CONCURRENTLY: templatesPerHost cannot be laundered at the template door', () => {
  /**
   * FORCED RED (2026-08-19). Hoisting the authoritative count and decision back
   * out of `runTransaction` in `install-template.ts` — leaving the pre-check as
   * the whole gate and the writes in a `WriteBatch`, which is the code as it
   * shipped — lands **20 of 20** installs on a plan that includes 10, with
   * `billable()` at 29. The double is UNCHANGED between the two runs:
   * serializing a transaction body cannot save a count taken before it opened.
   */
  it('lands exactly the one free slot from a library one short', async () => {
    const attempts = 20
    seed(FREE_TEMPLATES - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installTemplate(`listing-${index}`),
      ),
    )
    const created = responses.filter((res) => res.statusCode === 200)
    const refused = responses.filter((res) => res.statusCode === 403)

    // BOTH halves. Exactly one install fits the remaining slot, and the rest
    // are refused — not "some", not "all".
    expect(created).toHaveLength(1)
    expect(refused).toHaveLength(attempts - 1)
    expect(billable()).toBe(FREE_TEMPLATES)
    // Every request really ran a transaction; a route that stopped transacting
    // would otherwise still pass the counts above.
    expect(mockState.attempts).toBe(attempts)
  })

  it('lands nothing at all from a library already at its cap', async () => {
    const attempts = 20
    seed(FREE_TEMPLATES)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installTemplate(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 403)).toHaveLength(
      attempts,
    )
    expect(billable()).toBe(FREE_TEMPLATES)
  })

  it('an UNLIMITED plan lands all of them', async () => {
    // The other half of every cap assertion above: a gate that refused
    // everything would pass all of them and fail only this.
    expect(PLAN_ENTITLEMENTS.pro.templatesPerHost).toBe(
      Number.POSITIVE_INFINITY,
    )
    mockState.org = { plan: 'pro' }
    const attempts = 20
    seed(0)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installTemplate(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(
      attempts,
    )
    expect(billable()).toBe(attempts)
  })

  it('a PAID finite plan is enforced at ITS number, not free’s', async () => {
    // A gate that only refuses free orgs is the same defect wearing a
    // different number, so the paid cap gets the identical concurrent proof.
    mockState.org = { plan: 'starter' }
    const attempts = 20
    seed(STARTER_TEMPLATES - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installTemplate(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1)
    expect(billable()).toBe(STARTER_TEMPLATES)
  })

  it('a DEAD subscription is enforced at the free number it resolves to', async () => {
    // A canceled subscription downgrades to free (`resolveEffectivePlan`), so
    // the cap must follow the EFFECTIVE plan or a canceled org keeps the
    // library it stopped paying for.
    mockState.org = { plan: 'pro', billingStatus: 'canceled' }
    const attempts = 20
    seed(FREE_TEMPLATES - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installTemplate(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1)
    expect(billable()).toBe(FREE_TEMPLATES)
  })
})

describe('SEQUENTIALLY: a layout install admits the last slot and refuses the next', () => {
  beforeEach(() => {
    mockArtifactType = 'layout'
  })

  it('installs into the 10th slot', async () => {
    seed(FREE_TEMPLATES - 1)
    const res = await installLayout('listing-1')
    expect(res.statusCode).toBe(200)
    expect(billable()).toBe(FREE_TEMPLATES)
  })

  it('refuses the 11th, and writes nothing', async () => {
    seed(FREE_TEMPLATES)
    const res = await installLayout('listing-1')
    expect(res.statusCode).toBe(403)
    expect(billable()).toBe(FREE_TEMPLATES)
  })
})

describe('CONCURRENTLY: templatesPerHost cannot be laundered at the layout door', () => {
  beforeEach(() => {
    mockArtifactType = 'layout'
  })

  /**
   * FORCED RED (2026-08-19). Hoisting the authoritative count and decision back
   * out of `runTransaction` in `install-layout.ts` lands **20 of 20** layouts
   * on a plan that includes 10, with `billable()` at 29.
   */
  it('lands exactly the one free slot from a library one short', async () => {
    const attempts = 20
    seed(FREE_TEMPLATES - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installLayout(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1)
    expect(responses.filter((res) => res.statusCode === 403)).toHaveLength(
      attempts - 1,
    )
    expect(billable()).toBe(FREE_TEMPLATES)
    expect(mockState.attempts).toBe(attempts)
  })

  it('an UNLIMITED plan lands all of them', async () => {
    mockState.org = { plan: 'pro' }
    const attempts = 20
    seed(0)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installLayout(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(
      attempts,
    )
    expect(billable()).toBe(attempts)
  })

  it('a PAID finite plan is enforced at ITS number, not free’s', async () => {
    mockState.org = { plan: 'starter' }
    const attempts = 20
    seed(STARTER_TEMPLATES - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        installLayout(`listing-${index}`),
      ),
    )
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1)
    expect(billable()).toBe(STARTER_TEMPLATES)
  })
})
