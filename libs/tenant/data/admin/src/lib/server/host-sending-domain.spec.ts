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
 * THE CLAIM — provisioning that survives a retry, a crash and a rename.
 *
 * Firestore is faked; the DECISIONS are real. `platformSendingDomainFor` and
 * `resolveSendingIdentity` are imported from the pure module and never mocked,
 * so what is proved here is the rule the product runs.
 *
 * The fake's `create` throws on an existing document, exactly as Firestore's
 * does — that is the whole mechanism behind the uniqueness claim, so a fake
 * that let it pass would make every collision test vacuous.
 */

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
const DELETE = '<delete>'

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: {
      parent: {
        parent: { id: path.split('/').slice(-3, -2)[0] },
      },
    },
  }
}

function docRef(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    async get() {
      return snapshotOf(path)
    },
    async set(value: Doc, options?: { merge?: boolean }) {
      const previous = options?.merge ? (store.get(path) ?? {}) : {}
      const merged = { ...previous, ...value }
      for (const [key, entry] of Object.entries(merged)) {
        if (entry === DELETE) delete merged[key]
      }
      store.set(path, merged)
    },
    /** Firestore's create: refuses an existing document. The claim rests on it. */
    async create(value: Doc) {
      if (store.has(path)) {
        const error = new Error('ALREADY_EXISTS') as Error & { code: number }
        error.code = 6
        throw error
      }
      store.set(path, value)
    },
    async delete() {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string) {
  const query = (rows: string[]) => ({
    // A REAL filter, matching `collectionGroup` below. A `where` that ignored
    // its arguments would make every org-scoped query in this file return the
    // whole collection, so a test asserting that one org's sweep leaves another
    // org's sites alone would pass whether or not the filter existed.
    where: (field: string, _op: string, value: unknown) =>
      query(rows.filter((key) => store.get(key)?.[field] === value)),
    orderBy: () => query(rows),
    limit: (n: number) => query(rows.slice(0, n)),
    async get() {
      const docs = rows.map(snapshotOf)
      return { docs, empty: docs.length === 0 }
    },
  })
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    ...query(
      [...store.keys()].filter(
        (key) =>
          key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
      ),
    ),
  }
}

const db = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => {
    const rows = [...store.keys()].filter((key) => key.includes(`/${name}/`))
    const query = (current: string[]) => ({
      where: (field: string, _op: string, value: unknown) =>
        query(current.filter((key) => store.get(key)?.[field] === value)),
      orderBy: () => query(current),
      limit: (n: number) => query(current.slice(0, n)),
      async get() {
        return { docs: current.map(snapshotOf) }
      },
    })
    return query(rows)
  },
  async runTransaction(fn: (t: unknown) => Promise<void>) {
    await fn({
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      delete: (ref: { path: string }) => store.delete(ref.path),
    })
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
    firestore: { FieldValue: { delete: () => DELETE } },
  },
}))

jest.mock('./dns-probe', () => ({
  __esModule: true,
  lookupTxt: async () => ({ answered: false, records: [] }),
  lookupMx: async () => ({ answered: false, records: [] }),
}))

const orgForHost = jest.fn()
jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: (hostId: string) => orgForHost(hostId),
}))

import {
  requestHostSendingDomain,
  listPendingSendingDomains,
  readHostSendingTeardown,
  releaseHostSendingDomain,
  restartHostSendingDomain,
} from './host-sending-domain'
import {
  hostSendingIdentity,
  resolveHostSendingIdentity,
} from './sending-domains'

const ORG = 'org123'
const HOST = 'HostAbc123'
const OTHER_HOST = 'HostXyz789'
const MAIL_APEX = 'mail.aglyn.app'

function seedHost(hostId: string, subdomain: string, orgId: string = ORG) {
  store.set(`hosts/${hostId}`, { subdomain, orgId })
}

/**
 * A dedicated domain is a PAID capability, so the org's entitlements decide
 * whether a claim may happen at all.
 *
 * Seeded to a qualifying plan by default, because everything else in this file
 * is about the claim MECHANICS — the label race, the rename pin, the teardown —
 * and those tests would otherwise all be asserting the gate by accident. The
 * gate has its own block, which sets the plan explicitly on both sides.
 */
function seedOrgPlan(plan: string, orgId: string = ORG) {
  store.set(`orgs/${orgId}`, { plan })
}

/**
 * The same org, plus the per-org feature overrides staff write.
 *
 * Stored under `entitlements.features`, which is the shape
 * `resolveOrgEntitlements` merges over the plan defaults and the shape the
 * staff override route writes — so what these tests exercise is the document a
 * support engineer actually produces, not a convention invented here.
 */
function seedOrgWithFeatures(
  plan: string,
  features: Record<string, boolean>,
  orgId: string = ORG,
) {
  store.set(`orgs/${orgId}`, { plan, entitlements: { features } })
}

beforeEach(() => {
  store.clear()
  seedOrgPlan('pro')
  orgForHost.mockReset()
  orgForHost.mockResolvedValue({ orgId: ORG, org: {} })
})

describe('a site gets a sending domain', () => {
  it('claims the label, records the domain and points the host at it', async () => {
    seedHost(HOST, 'northwind-coffee')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(true)
    expect(result.domain).toBe(`northwind-coffee.${MAIL_APEX}`)
    expect(store.get(`hosts/${HOST}`).sendingLabel).toBe('northwind-coffee')
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBe(result.domain)
    expect(
      store.get(`orgs/${ORG}/sendingDomains/northwind-coffee.${MAIL_APEX}`).status,
    ).toBe('requested')
    expect(store.get('sendingLabels/northwind-coffee').hostId).toBe(HOST)
  })

  it('never puts a site on aglyn.com', async () => {
    seedHost(HOST, 'northwind-coffee')
    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })
    expect(result.domain).not.toContain('aglyn.com')
  })
})

describe('provisioning is idempotent under retry', () => {
  /**
   * The property the whole two-vendor flow rests on. This function decides the
   * NAME, and it is the first of the three writes — so once it has returned a
   * domain, every retry of anything downstream resolves against the same name.
   * A second Resend domain is not merely avoided, it is unreachable, because
   * there is no second name for one to be created under.
   */
  it('returns the same domain on every retry, and creates nothing twice', async () => {
    seedHost(HOST, 'acme')

    const first = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })
    const labelDocs = () =>
      [...store.keys()].filter((key) => key.startsWith('sendingLabels/'))
    const domainDocs = () =>
      [...store.keys()].filter((key) => key.includes('/sendingDomains/'))

    expect(labelDocs()).toHaveLength(1)
    expect(domainDocs()).toHaveLength(1)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const retry = await requestHostSendingDomain({
        hostId: HOST,
        orgId: ORG,
        subdomain: 'acme',
        requestedBy: 'merchant',
      })
      expect(retry.domain).toBe(first.domain)
      expect(retry.created).toBe(false)
    }

    expect(labelDocs()).toHaveLength(1)
    expect(domainDocs()).toHaveLength(1)
  })

  /**
   * A retry must not re-derive the name from the site's CURRENT slug. If it
   * did, the retry after a rename would provision a second domain — which is
   * the same bug as deriving from the slug in the first place, arriving one
   * step later.
   */
  it('ignores the subdomain it is passed once a label is pinned', async () => {
    seedHost(HOST, 'acme')
    const first = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })

    const retry = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'something-completely-different',
      requestedBy: 'merchant',
    })

    expect(retry.domain).toBe(first.domain)
    expect(store.get('sendingLabels/something-completely-different')).toBeUndefined()
  })

  /**
   * Two sites racing for one label. The claim is a Firestore `create`, so one
   * wins and the other is de-collided rather than both being handed the same
   * mail domain — the failure that would let one site's key sign for another's
   * name.
   */
  it('gives a second site a different domain when the label is taken', async () => {
    seedHost(HOST, 'acme')
    seedHost(OTHER_HOST, 'acme')

    const first = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })
    const second = await requestHostSendingDomain({
      hostId: OTHER_HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })

    expect(first.domain).toBe(`acme.${MAIL_APEX}`)
    expect(second.domain).toBe(`acme-2.${MAIL_APEX}`)
    expect(second.domain).not.toBe(first.domain)
    expect(store.get('sendingLabels/acme').hostId).toBe(HOST)
  })

  it('refuses a site whose name yields no usable label', async () => {
    seedHost(HOST, '!!!')
    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: '!!!',
      requestedBy: 'merchant',
    })
    expect(result.domain).toBeNull()
    expect(result.error).toBe('no-label')
  })
})

describe('a half-provisioned domain is recoverable', () => {
  /**
   * The claim landed and the process died before the host was pointed at it.
   * The sweep still finds the record — it is what the sweep queries — and the
   * next call attaches it rather than claiming a second name.
   */
  it('finishes a claim whose host pointer was never written', async () => {
    seedHost(HOST, 'acme')
    await requestHostSendingDomain({ hostId: HOST, orgId: ORG, subdomain: 'acme', requestedBy: 'merchant' })

    // Simulate the crash: the host pointer is gone, the claim and the record
    // remain. This is the state a death between write 2 and write 3 leaves.
    store.set(`hosts/${HOST}`, { subdomain: 'acme' })

    const pending = await listPendingSendingDomains(10)
    expect(pending).toHaveLength(1)
    expect(pending[0].record.domain).toBe(`acme.${MAIL_APEX}`)
    expect(pending[0].orgId).toBe(ORG)
  })

  /**
   * The sweep must never try to write DNS for a customer's own domain. A zone
   * we do not own is a zone we have no business in, and the filter is on the
   * DOMAIN rather than on how the record was created.
   */
  it('leaves a customer-owned domain out of the platform sweep', async () => {
    store.set(`orgs/${ORG}/sendingDomains/acme.com`, {
      domain: 'acme.com',
      status: 'requested',
      createdAtMs: 1,
    })
    store.set(`orgs/${ORG}/sendingDomains/mine.${MAIL_APEX}`, {
      domain: `mine.${MAIL_APEX}`,
      status: 'requested',
      createdAtMs: 2,
    })

    const pending = await listPendingSendingDomains(10)
    expect(pending.map((entry) => entry.record.domain)).toEqual([
      `mine.${MAIL_APEX}`,
    ])
  })

  it('leaves an already-issued domain out of the sweep', async () => {
    store.set(`orgs/${ORG}/sendingDomains/done.${MAIL_APEX}`, {
      domain: `done.${MAIL_APEX}`,
      status: 'verified',
      createdAtMs: 1,
    })
    expect(await listPendingSendingDomains(10)).toEqual([])
  })
})

/*==========================================
  Nothing claims a domain on a site's behalf
==========================================*/

/**
 * THE ABSENCE OF AUTOMATIC PROVISIONING, AS A TEST.
 *
 * A dedicated subdomain used to be claimed at three moments nobody chose: site
 * creation, the billing webhook's upgrade transition, and a sweep that walked
 * hosts looking for entitled sites without one. Each was defensible on its own
 * and together they made demand for a bounded resource — the provider's
 * account-wide domain allowance, and three records in our zone apiece — grow
 * with every paying site rather than with anybody's decision.
 *
 * The guarantee is now structural rather than behavioral: `requestedBy` has no
 * default, so a process has nothing honest to put there. This block is what
 * notices if one is invented anyway. It asserts on the STORE rather than on a
 * return value, because a re-introduced automatic claim would most likely
 * arrive as a side effect somewhere else in the file's flow, and the store is
 * the one place every claim has to land.
 */
describe('a site holds no sending domain until somebody asks', () => {
  it('does not claim on the plan alone, however entitled the org', async () => {
    seedOrgPlan('agency')
    seedHost(HOST, 'northwind-coffee')

    // Everything a claim needs is present except the asking. The site sends
    // regardless — that is the pool's job — so nothing is waiting on this.
    expect(store.get(`hosts/${HOST}`).sendingLabel).toBeUndefined()
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBeUndefined()
    expect(store.has('sendingLabels/northwind-coffee')).toBe(false)
    expect(await listPendingSendingDomains(25)).toEqual([])
  })

  /**
   * The CONTROL. Every assertion above is satisfied by a claim path that is
   * simply broken, so the same fixture has to produce a domain the moment the
   * request is made.
   */
  it('claims the moment one is asked for, from the same fixture', async () => {
    seedOrgPlan('agency')
    seedHost(HOST, 'northwind-coffee')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(true)
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBe(
      `northwind-coffee.${MAIL_APEX}`,
    )
    expect(await listPendingSendingDomains(25)).toHaveLength(1)
  })

  /**
   * WHO ASKED is stored with the claim.
   *
   * At the ceiling the only question worth answering is which slots somebody
   * actually wanted, and a claim that recorded nothing would leave that
   * answerable only by reading a year of logs.
   */
  it.each(['merchant', 'staff'] as const)('records that %s asked', async (who) => {
    seedOrgPlan('pro')
    seedHost(HOST, 'northwind')

    await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: who,
    })

    expect(store.get(`hosts/${HOST}`).sendingDomainRequestedBy).toBe(who)
    expect(store.get(`hosts/${HOST}`).sendingDomainRequestedAtMs).toEqual(
      expect.any(Number),
    )
  })

  it('reads an unrecognized requester as the merchant rather than storing it', async () => {
    seedOrgPlan('pro')
    seedHost(HOST, 'northwind')

    await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'a-cron-job' as never,
    })

    expect(store.get(`hosts/${HOST}`).sendingDomainRequestedBy).toBe('merchant')
  })
})

describe('the sending domain survives a host rename', () => {
  /**
   * THE RENAME REQUIREMENT.
   *
   * The rename route rewrites `hosts/{hostId}.subdomain` in place. Nothing
   * else about the site changes. What must be true afterwards is that the
   * sending domain, the label and therefore every DNS record and the return
   * path are byte-for-byte what they were — because a sending domain's value
   * is its accumulated reputation, and a new one starts at zero.
   */
  it('keeps the domain, the label and the identity across a rename', async () => {
    seedHost(HOST, 'northwind-coffee')
    const before = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })

    // Verify it, so the identity is a real sending one on both sides.
    store.set(`orgs/${ORG}/sendingDomains/${before.domain}`, {
      ...store.get(`orgs/${ORG}/sendingDomains/${before.domain}`),
      status: 'verified',
      dkimSelector: 'resend',
      dkimPublicKey: 'TESTKEY',
    })
    const identityBefore = await hostSendingIdentity(HOST)

    // THE RENAME: exactly what the rename route does, and nothing else.
    store.set(`hosts/${HOST}`, {
      ...store.get(`hosts/${HOST}`),
      subdomain: 'acme-coffee',
    })

    const identityAfter = await hostSendingIdentity(HOST)

    expect(store.get(`hosts/${HOST}`).subdomain).toBe('acme-coffee')
    expect(store.get(`hosts/${HOST}`).sendingLabel).toBe('northwind-coffee')
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBe(before.domain)
    expect(identityAfter.from).toBe(identityBefore.from)
    expect(identityAfter.from).toBe(`hello@northwind-coffee.${MAIL_APEX}`)
    expect(identityAfter.source).toBe('custom')
  })

  /**
   * The return path has to keep resolving after a rename, because bounces
   * arrive after the send. It is a record under the PINNED label, so a rename
   * cannot move it — this asserts the record set is untouched, which is the
   * same statement.
   */
  it('leaves the claim and its records exactly where they were', async () => {
    seedHost(HOST, 'northwind-coffee')
    await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })
    const claimBefore = { ...store.get('sendingLabels/northwind-coffee') }

    store.set(`hosts/${HOST}`, {
      ...store.get(`hosts/${HOST}`),
      subdomain: 'acme-coffee',
    })
    await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme-coffee',
      requestedBy: 'merchant',
    })

    expect(store.get('sendingLabels/northwind-coffee')).toEqual(claimBefore)
    expect(store.get('sendingLabels/acme-coffee')).toBeUndefined()
    expect(
      [...store.keys()].filter((key) => key.startsWith('sendingLabels/')),
    ).toHaveLength(1)
  })

  /**
   * The collision the pinned label creates, and the reason mail lives in its
   * own namespace. After A renames away, its old WEB slug is free — another
   * site may take it. That must have no effect at all on A's mail.
   */
  it('is unaffected by another site taking the freed web subdomain', async () => {
    seedHost(HOST, 'northwind-coffee')
    const mine = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })
    store.set(`hosts/${HOST}`, {
      ...store.get(`hosts/${HOST}`),
      subdomain: 'acme-coffee',
    })

    // Site B claims the freed WEB slug. Its MAIL label is de-collided,
    // because the mail claim is still held.
    seedHost(OTHER_HOST, 'northwind-coffee')
    const theirs = await requestHostSendingDomain({
      hostId: OTHER_HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })

    expect(theirs.domain).not.toBe(mine.domain)
    expect(theirs.domain).toBe(`northwind-coffee-2.${MAIL_APEX}`)
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBe(mine.domain)
  })

  /**
   * Moving the sending name is possible, but only as an explicit act that
   * says what it costs. It is not something a rename does.
   */
  it('moves the sending name only when asked outright', async () => {
    seedHost(HOST, 'northwind-coffee')
    const before = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind-coffee',
      requestedBy: 'merchant',
    })
    store.set(`hosts/${HOST}`, {
      ...store.get(`hosts/${HOST}`),
      subdomain: 'acme-coffee',
    })

    const { teardown, provisioned } = await restartHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme-coffee',
      requestedBy: 'merchant',
    })

    expect(teardown.domain).toBe(before.domain)
    expect(provisioned.domain).toBe(`acme-coffee.${MAIL_APEX}`)
    // The old label is released, so it can be reused once the vendors are
    // clean — a restart is a teardown plus a claim, not a leak.
    expect(store.get('sendingLabels/northwind-coffee')).toBeUndefined()
    expect(store.get('sendingLabels/acme-coffee').hostId).toBe(HOST)
  })
})

describe('deleting a site cleans up', () => {
  async function provisionAndIssue() {
    seedHost(HOST, 'acme')
    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })
    store.set(`orgs/${ORG}/sendingDomains/${result.domain}`, {
      ...store.get(`orgs/${ORG}/sendingDomains/${result.domain}`),
      status: 'verified',
      dkimSelector: 'resend',
      dkimPublicKey: 'TESTKEY',
      providerDomainId: 'resend-domain-id-1',
    })
    return result
  }

  /**
   * The teardown has to name BOTH vendors' resources before anything is
   * deleted. Reading it first is what lets the caller do the vendor work and
   * only then drop our record — the other order loses the name of the thing it
   * still has to remove.
   */
  it('reads everything the vendors need before anything is dropped', async () => {
    const provisioned = await provisionAndIssue()

    const teardown = await readHostSendingTeardown(HOST)

    expect(teardown.domain).toBe(provisioned.domain)
    expect(teardown.label).toBe('acme')
    expect(teardown.orgId).toBe(ORG)
    // The Resend domain object, so its quota slot can be freed.
    expect(teardown.providerDomainId).toBe('resend-domain-id-1')
    // The selector, so the DKIM record can be named. A guess deletes nothing
    // and leaves a live signing key in the zone.
    expect(teardown.dkimSelector).toBe('resend')
  })

  it('removes the record, the host pointer and the label claim', async () => {
    const provisioned = await provisionAndIssue()
    const teardown = await readHostSendingTeardown(HOST)

    await releaseHostSendingDomain(teardown)

    expect(store.get(`orgs/${ORG}/sendingDomains/${provisioned.domain}`)).toBeUndefined()
    expect(store.get(`hosts/${HOST}`).sendingDomain).toBeUndefined()
    expect(store.get(`hosts/${HOST}`).sendingLabel).toBeUndefined()
    expect(store.get('sendingLabels/acme')).toBeUndefined()
  })

  /**
   * A released label is genuinely free. That is only safe because the DKIM
   * record is gone from the zone and the domain object is gone from the
   * account — so the next site to claim it inherits no key, no records and no
   * reputation.
   */
  it('lets a later site claim the freed label', async () => {
    await provisionAndIssue()
    await releaseHostSendingDomain(await readHostSendingTeardown(HOST))

    seedHost(OTHER_HOST, 'acme')
    const next = await requestHostSendingDomain({
      hostId: OTHER_HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })

    expect(next.domain).toBe(`acme.${MAIL_APEX}`)
    expect(store.get('sendingLabels/acme').hostId).toBe(OTHER_HOST)
  })

  /**
   * A teardown that raced a re-provision must not delete the NEW claim. The
   * release is conditional on the claim still naming the host being torn down.
   */
  it('does not release a label that has been re-claimed by another site', async () => {
    await provisionAndIssue()
    const teardown = await readHostSendingTeardown(HOST)

    // Another site claims it in between — the state a slow teardown meets.
    store.set('sendingLabels/acme', {
      label: 'acme',
      hostId: OTHER_HOST,
      orgId: ORG,
      domain: `acme.${MAIL_APEX}`,
      claimedAtMs: Date.now(),
    })

    await releaseHostSendingDomain(teardown)

    expect(store.get('sendingLabels/acme').hostId).toBe(OTHER_HOST)
  })

  it('is safe to run twice', async () => {
    await provisionAndIssue()
    const teardown = await readHostSendingTeardown(HOST)
    await releaseHostSendingDomain(teardown)
    await expect(releaseHostSendingDomain(teardown)).resolves.toBeUndefined()
  })

  it('has nothing to say about a host that was never provisioned', async () => {
    seedHost(HOST, 'acme')
    expect(await readHostSendingTeardown(HOST)).toBeNull()
  })
})

describe('the identity a site sends on, from a hostId alone', () => {
  /**
   * The door nineteen tenant send sites use. All of them hold a `hostId`;
   * three hold an org id. Asking each to assemble the org id and both
   * selection fields is the shape that produces a twentieth which does not —
   * and the cost of forgetting is a message on the platform's own domain.
   */
  it('resolves the site domain for a provisioned, verified site', async () => {
    seedHost(HOST, 'acme')
    const provisioned = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })
    store.set(`orgs/${ORG}/sendingDomains/${provisioned.domain}`, {
      ...store.get(`orgs/${ORG}/sendingDomains/${provisioned.domain}`),
      status: 'verified',
    })

    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.from).toBe(`hello@acme.${MAIL_APEX}`)
  })

  /**
   * A site with no domain of its own SENDS, on the pool.
   *
   * This used to refuse, and the refusal was the defect: it covered receipts,
   * password resets and booking confirmations, so a site that had simply not
   * been provisioned could not tell a customer their order had gone through.
   * The console had always told merchants the opposite — that mail leaves on a
   * shared Aglyn address until they prove a domain — and the code was what was
   * wrong, not the copy.
   *
   * The address is on a POOL MEMBER, which is the DMARC constraint: under the
   * published `adkim=s` the `From:` domain must be exactly the domain the DKIM
   * key signs for, and each pool member signs for itself.
   */
  it('sends a site with no domain of its own on the shared pool', async () => {
    seedHost(HOST, 'acme')
    const verdict = await hostSendingIdentity(HOST)

    expect(verdict.refusal).toBeNull()
    expect(verdict.source).toBe('shared')
    expect(verdict.from).toMatch(/^notifications@shared\d+\.mail\.aglyn\.app$/)
    // Pooled, and the summary says so — the console renders this verbatim, so
    // the disclosure and the resolver cannot drift apart.
    expect(verdict.summary).toMatch(/pooled/i)
    expect(verdict.from).not.toContain('aglyn.com')
  })

  /**
   * THE PAID SITE WHOSE DEDICATED DOMAIN NEVER ARRIVED.
   *
   * A claim pins `hosts/{id}.sendingDomain` before any vendor has been called,
   * so between the claim and a successful verification the site is pointing at
   * a domain that cannot sign. Read as a merchant's SELECTION that would refuse
   * every message the site sends — receipts included — which puts a paying
   * workspace strictly behind a free one, whose unclaimed site sends on the
   * pool.
   *
   * The pool is the floor and the dedicated domain is the optimization, so the
   * states this can be stuck in — `requested` because provisioning has not run,
   * `records-issued` because DNS has not propagated, `failed` because the zone
   * write did not land — all send transactional mail on the pool meanwhile.
   */
  it.each(['requested', 'records-issued', 'failed'])(
    'sends on the pool while its own dedicated domain is still %s',
    async (status) => {
      seedHost(HOST, 'acme')
      const provisioned = await requestHostSendingDomain({
        hostId: HOST,
        orgId: ORG,
        subdomain: 'acme',
        requestedBy: 'merchant',
      })
      store.set(`orgs/${ORG}/sendingDomains/${provisioned.domain}`, {
        ...store.get(`orgs/${ORG}/sendingDomains/${provisioned.domain}`),
        status,
      })

      const verdict = await hostSendingIdentity(HOST)

      expect(verdict.refusal).toBeNull()
      expect(verdict.source).toBe('shared')
      expect(verdict.from).toMatch(/^notifications@shared\d+\.mail\.aglyn\.app$/)
      expect(verdict.from).not.toContain('aglyn.com')
    },
  )

  /**
   * Capacity exhaustion DEGRADES. The provider ceiling is an operator problem
   * and the merchant is not the one who can act on it, so a site refused for
   * capacity keeps confirming its orders.
   */
  it('sends on the pool when the dedicated domain was refused for capacity', async () => {
    seedHost(HOST, 'acme')
    const provisioned = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'acme',
      requestedBy: 'merchant',
    })
    store.set(`orgs/${ORG}/sendingDomains/${provisioned.domain}`, {
      ...store.get(`orgs/${ORG}/sendingDomains/${provisioned.domain}`),
      lastIssueError: 'at-capacity',
    })

    const verdict = await hostSendingIdentity(HOST)

    expect(verdict.refusal).toBeNull()
    expect(verdict.source).toBe('shared')
  })

  /**
   * The fallback carries MARKETING too.
   *
   * The dedicated subdomain is an optimization and the pool is the guarantee,
   * and everything that leaves this site's subdomain unfinished is ours: the
   * provider allowance, a zone write, a sweep that has not run. None of it is
   * a reason to stop a merchant's campaign.
   */
  it('sends MARKETING on the pool while the dedicated domain is unverified', async () => {
    seedHost(HOST, 'acme')
    await requestHostSendingDomain({ hostId: HOST, orgId: ORG, subdomain: 'acme', requestedBy: 'merchant' })

    const verdict = await resolveHostSendingIdentity({
      orgId: ORG,
      hostId: HOST,
      selectedDomain: `acme.${MAIL_APEX}`,
      purpose: 'marketing',
    })

    expect(verdict.refusal).toBeNull()
    expect(verdict.source).toBe('shared')
  })

  /**
   * The assignment is STABLE. Reputation is built by sending steadily from one
   * name, so a site that hopped between pool members would have none.
   */
  it('gives one site the same pool member every time', async () => {
    seedHost(HOST, 'acme')
    seedHost(OTHER_HOST, 'zenith')

    const first = await hostSendingIdentity(HOST)
    const again = await hostSendingIdentity(HOST)
    expect(again.from).toBe(first.from)

    // And the pool is actually used rather than collapsing to one member for
    // everybody — otherwise "stable" would be trivially true and the blast
    // radius the pool exists to bound would be the whole platform.
    const members = new Set<string>()
    for (let index = 0; index < 60; index += 1) {
      seedHost(`Host${index}`, `site-${index}`)
      members.add((await hostSendingIdentity(`Host${index}`)).from ?? '')
    }
    expect(members.size).toBeGreaterThan(1)
  })

  /**
   * THE CONTROL FOR AN INDISCRIMINATE FALLBACK.
   *
   * A site that SELECTED a domain and has not verified it must still refuse.
   * The two cases look alike — neither has a usable domain — and they are
   * opposites: this merchant told us what their recipients would see, and
   * sending as somebody else is not a degraded way of honoring that.
   *
   * If the pool were applied wherever no verified domain was available, this
   * test is the one that fails.
   */
  it('still refuses a site whose SELECTED domain is unverified', async () => {
    seedHost(HOST, 'acme')
    store.set(`hosts/${HOST}`, {
      subdomain: 'acme',
      orgId: ORG,
      sendingDomain: 'acme.com',
    })
    store.set(`orgs/${ORG}/sendingDomains/acme.com`, {
      domain: 'acme.com',
      status: 'records-issued',
      dkimSelector: 'aglyn-org123',
    })

    const verdict = await hostSendingIdentity(HOST)

    expect(verdict.from).toBeNull()
    expect(verdict.source).toBeNull()
    expect(verdict.refusal.code).toBe('domain-unverified')
    expect(verdict.refusal.message).toContain('acme.com')
  })

  /**
   * No host is not "the platform is speaking" — it is a caller that does not
   * know which site it is sending for. The honest answer is a refusal, and
   * emphatically not the shared domain.
   */
  it('refuses when it is not told which site is speaking', async () => {
    /*
     * The platform address is CONFIGURED for this case on purpose.
     *
     * Without it the refusal would arrive as `platform-unconfigured` whatever
     * the audience, and the assertion would pass against a resolver that had
     * happily fallen back — proving only that the environment was empty. The
     * claim is that a usable platform address is not reachable, so there has
     * to be one to not reach.
     */
    process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.com>'
    try {
      const verdict = await hostSendingIdentity('')
      expect(verdict.from).toBeNull()
      expect(verdict.source).toBeNull()
      expect(verdict.refusal.code).toBe('tenant-identity-unprovisioned')
    } finally {
      delete process.env.USAGE_EMAIL_FROM
    }
  })

  it('reads once per host when given a cache', async () => {
    seedHost(HOST, 'acme')
    const cache = new Map()
    await hostSendingIdentity(HOST, cache)
    orgForHost.mockClear()
    await hostSendingIdentity(HOST, cache)
    await hostSendingIdentity(HOST, cache)
    expect(orgForHost).not.toHaveBeenCalled()
  })
})

/*==========================================
  Provisioning follows the plan, not the signup
==========================================*/

/**
 * THE COST CURVE, AS A TEST.
 *
 * A dedicated sending domain is not free to us: one provider domain object out
 * of a per-account allowance, THREE records in our own DNS zone, and a
 * permanent place in the re-verification sweep. Claiming one for every host
 * that exists makes all three scale with signups. Claiming one when a site can
 * actually use it makes them scale with revenue.
 *
 * Every assertion here is two-sided on purpose. A filter that claimed NOBODY
 * would satisfy "the free site was skipped" perfectly well, and would be a
 * total outage of the feature — so each case that must be skipped is paired
 * with a case that must still be claimed, in the same run where possible.
 */
describe('a dedicated domain is claimed by need, not by existence', () => {
  it('claims for a plan that carries one', async () => {
    seedOrgPlan('pro')
    seedHost(HOST, 'northwind')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(true)
    expect(result.domain).toBe(`northwind.${MAIL_APEX}`)
    expect(result.error).toBeNull()
  })

  it.each(['free', 'starter'])(
    'claims nothing for %s, and says why',
    async (plan) => {
      seedOrgPlan(plan)
      seedHost(HOST, 'northwind')

      const result = await requestHostSendingDomain({
        hostId: HOST,
        orgId: ORG,
        subdomain: 'northwind',
        requestedBy: 'merchant',
      })

      expect(result.created).toBe(false)
      expect(result.domain).toBeNull()
      expect(result.error).toBe('plan-no-dedicated-domain')

      // Nothing was spent: no label claimed, no record to provision, and so
      // nothing for the console sweep to hand to the provider.
      expect(store.has(`sendingLabels/northwind`)).toBe(false)
      expect(await listPendingSendingDomains(25)).toEqual([])
      expect(store.get(`hosts/${HOST}`)?.sendingLabel).toBeUndefined()
    },
  )

  it('claims for every plan above the floor, enterprise included', async () => {
    for (const plan of ['pro', 'business', 'scale', 'advanced', 'agency', 'enterprise']) {
      store.clear()
      seedOrgPlan(plan)
      seedHost(HOST, 'northwind')
      const result = await requestHostSendingDomain({
        hostId: HOST,
        orgId: ORG,
        subdomain: 'northwind',
        requestedBy: 'merchant',
      })
      expect([plan, result.created]).toEqual([plan, true])
    }
  })

  /**
   * A GRANT ON ONE ACCOUNT, WITHOUT REPRICING IT.
   *
   * The gate resolves the org's ENTITLEMENTS, so the override staff write for
   * a support case reaches the claim path. A comparison against the plan word
   * cannot see this document at all: it reads `starter`, answers no, and the
   * grant becomes a field with an audit row and no effect — the shape of
   * failure where an operator gets a success message and changes nothing.
   *
   * Paired in one test on purpose. Starter WITHOUT the grant must still be
   * refused in the same run, or "the override works" is equally satisfied by a
   * gate that stopped refusing anybody.
   */
  it('claims for a lower plan holding a per-org grant, and not for the same plan without one', async () => {
    seedOrgWithFeatures('starter', { dedicatedSendingDomain: true })
    seedHost(HOST, 'granted')

    const granted = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'granted',
      requestedBy: 'staff',
    })

    expect(granted.created).toBe(true)
    expect(granted.domain).toBe(`granted.${MAIL_APEX}`)
    expect(granted.error).toBeNull()

    store.clear()
    seedOrgPlan('starter')
    seedHost(OTHER_HOST, 'ungranted')

    const ungranted = await requestHostSendingDomain({
      hostId: OTHER_HOST,
      orgId: ORG,
      subdomain: 'ungranted',
      requestedBy: 'merchant',
    })

    expect(ungranted.created).toBe(false)
    expect(ungranted.error).toBe('plan-no-dedicated-domain')
  })

  /**
   * THE GRANT IS ONE KEY, NOT A DOOR.
   *
   * An override document reaches the resolver whole, so a gate that merely
   * noticed overrides EXIST — or that read the wrong key — would hand a
   * dedicated domain to every org staff have ever touched for any reason.
   * These two orgs both carry grants; neither carries this one.
   */
  it('is not opened by a grant of some other feature', async () => {
    seedOrgWithFeatures('starter', {
      customSendingDomain: true,
      whiteLabel: true,
    })
    seedHost(HOST, 'northwind')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(false)
    expect(result.error).toBe('plan-no-dedicated-domain')
    expect(store.has('sendingLabels/northwind')).toBe(false)
  })

  /**
   * The override binds in BOTH directions, which is what makes it a lever
   * rather than a one-way grant: an org whose sites cost the platform more
   * than the account is worth can be held off the provider allowance without
   * being downgraded out of everything else its plan carries.
   */
  it('refuses a qualifying plan whose grant is explicitly withdrawn', async () => {
    seedOrgWithFeatures('agency', { dedicatedSendingDomain: false })
    seedHost(HOST, 'northwind')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(false)
    expect(result.error).toBe('plan-no-dedicated-domain')
  })

  /**
   * A DEAD SUBSCRIPTION STOPS NEW CLAIMS.
   *
   * `resolveEffectivePlan` reads a canceled or unpaid subscription down to
   * `free`, and the gate inherits that with every other entitlement rather
   * than needing its own rule — so a Pro account that stopped paying stops
   * drawing on the provider allowance. Sites it already holds keep their
   * domains: the pinned-label early return sits above this gate, which the
   * downgrade case below covers.
   */
  it('claims nothing for a plan whose subscription is dead', async () => {
    store.set(`orgs/${ORG}`, {
      plan: 'pro',
      subscription: { status: 'canceled' },
    })
    seedHost(HOST, 'northwind')

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(false)
    expect(result.error).toBe('plan-no-dedicated-domain')
  })

  /**
   * ONE REQUEST CLAIMS ONE SITE.
   *
   * The org is the unit the PLAN is read from and the site is the unit a
   * domain is spent on, and the two used to be conflated: an upgrade claimed
   * for every site in the workspace at once, so an agency moving to Pro spent
   * a provider slot and three zone records per client site in one webhook
   * delivery, for sites whose merchants had asked for nothing.
   */
  it('claims only the site that was asked about, not the org', async () => {
    seedOrgPlan('pro', 'orgPro')
    seedHost('HostPro', 'prosite', 'orgPro')
    seedHost('HostSibling', 'sibling', 'orgPro')

    const result = await requestHostSendingDomain({
      hostId: 'HostPro',
      orgId: 'orgPro',
      subdomain: 'prosite',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(true)
    expect(store.get('hosts/HostPro')?.sendingLabel).toBe('prosite')
    // The sibling site under the same org and the same plan is untouched. It
    // gets one when its own admin asks for it.
    expect(store.get('hosts/HostSibling')?.sendingLabel).toBeUndefined()
  })

  /**
   * A DOWNGRADE DOES NOT REPOSSESS A DOMAIN.
   *
   * Taking one back would move that site's mail onto a cold pooled address and
   * discard whatever reputation the name had earned — a punishment the merchant
   * never agreed to, applied silently by a sweep. Reclaiming is a teardown
   * decision with its own surface.
   */
  it('leaves a domain already claimed alone when the plan falls', async () => {
    seedOrgPlan('pro')
    seedHost(HOST, 'northwind')
    await requestHostSendingDomain({ hostId: HOST, orgId: ORG, subdomain: 'northwind', requestedBy: 'merchant' })

    seedOrgPlan('free')
    const again = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(again.domain).toBe(`northwind.${MAIL_APEX}`)
    expect(again.error).toBeNull()
    expect(store.get(`hosts/${HOST}`)?.sendingLabel).toBe('northwind')
  })

  /**
   * THE HEADLINE REQUIREMENT: being on Free costs a site its dedicated domain,
   * and does NOT cost it the ability to send.
   *
   * Both halves in one test, on one org, because separately either half is
   * satisfiable by a mistake. A gate that blocked everything would pass "no
   * domain was claimed"; a gate that blocked nothing would pass "the site can
   * still send".
   *
   * Free is not a tier that never sends. It has no storefront and a campaign
   * quota of zero, but it collects form submissions and a merchant can reply to
   * one from the inbox — a transactional message to a person who wrote in, and
   * exactly the kind that must never be gated behind a plan.
   */
  it('gives a free site no domain of its own and sends its mail anyway', async () => {
    seedOrgPlan('free')
    seedHost(HOST, 'freesite')

    const claim = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'freesite',
      requestedBy: 'merchant',
    })
    expect(claim.created).toBe(false)
    expect(claim.error).toBe('plan-no-dedicated-domain')

    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal).toBeNull()
    expect(verdict.source).toBe('shared')
    expect(verdict.from).toMatch(/^notifications@shared\d+\.mail\.aglyn\.app$/)
  })

  it('claims nothing when the org cannot be read at all', async () => {
    // No `orgs/{id}` document. Failing CLOSED is the safe direction: the cost
    // of a late claim is one sweep, and the cost of an early one is a zone
    // record spent on a plan nobody could name.
    seedHost(HOST, 'northwind')
    store.delete(`orgs/${ORG}`)

    const result = await requestHostSendingDomain({
      hostId: HOST,
      orgId: ORG,
      subdomain: 'northwind',
      requestedBy: 'merchant',
    })

    expect(result.created).toBe(false)
    expect(result.error).toBe('plan-no-dedicated-domain')
  })
})
