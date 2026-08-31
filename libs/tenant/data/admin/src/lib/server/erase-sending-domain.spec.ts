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
 * A SENDING DOMAIN GOES WHEN ITS SITE DOES — and when it cannot, it is owed.
 *
 * `eraseHost` destroyed the site and left its sending domain standing: one of
 * a small number of plan-capped provider slots spent forever, and a live DKIM
 * key in our own zone under a label a future site could claim and inherit a
 * stranger's signature from. Only `/api/hosts/delete` ever cleaned it up, so
 * every workspace erasure — and every per-host erasure inside one — leaked.
 *
 * Firestore is faked; the DECISIONS are real. `platformSendingDomainFor`,
 * `sendingDomainTeardownRefusal` and the whole `sending-domain-debt` module run
 * unmocked, so what is proved here is the rule the product runs. The one thing
 * that IS a double is the vendor driver, which is the point: an erasure must
 * survive a provider that refuses, and the only way to prove that is to have
 * one refuse.
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
    ref: { path, parent: { parent: { id: path.split('/').slice(-3, -2)[0] } } },
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
      const merged: Doc = { ...previous, ...value }
      for (const [key, entry] of Object.entries(merged)) {
        if (entry === DELETE) delete merged[key]
      }
      store.set(path, merged)
    },
    async create(value: Doc) {
      if (store.has(path)) throw new Error('ALREADY_EXISTS')
      store.set(path, value)
    },
    async delete() {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function childKeys(path: string): string[] {
  return [...store.keys()].filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )
}

function collectionRef(path: string) {
  const query = (rows: string[]) => ({
    // A REAL filter. A `where` that ignored its arguments would make the
    // bystander cases below pass whether or not the sweeps were bounded.
    where: (field: string, _op: string, value: unknown) =>
      query(rows.filter((key) => store.get(key)?.[field] === value)),
    orderBy: () => query([...rows].sort()),
    startAfter: (ref: { id?: string }) =>
      query(rows.filter((key) => (key.split('/').pop() ?? '') > String(ref?.id ?? ''))),
    limit: (n: number) => query(rows.slice(0, n)),
    async get() {
      const docs = rows.map(snapshotOf)
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  })
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    ...query(childKeys(path)),
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
  batch: () => {
    const pending: string[] = []
    return {
      delete: (ref: { path: string }) => pending.push(ref.path),
      async commit() {
        for (const path of pending) store.delete(path)
      },
    }
  },
  /** Firestore's cascade: the document AND everything beneath its path. */
  async recursiveDelete(ref: { path: string }) {
    for (const key of [...store.keys()]) {
      if (key === ref.path || key.startsWith(`${ref.path}/`)) store.delete(key)
    }
  },
  async runTransaction(fn: (t: unknown) => Promise<void>) {
    await fn({
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      delete: (ref: { path: string }) => store.delete(ref.path),
      set: (ref: { path: string }, value: Doc, options?: { merge?: boolean }) => {
        const previous = options?.merge ? (store.get(ref.path) ?? {}) : {}
        store.set(ref.path, { ...previous, ...value })
      },
    })
  },
}

const deleteFiles = jest.fn(async () => undefined)

jest.mock('./firebase-admin', () => {
  const admin = {
    app: () => ({
      firestore: () => db,
      storage: () => ({ bucket: () => ({ deleteFiles }) }),
    }),
    firestore: {
      FieldValue: { delete: () => DELETE, serverTimestamp: () => '__now__' },
    },
  }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { delete: () => DELETE, serverTimestamp: () => '__now__' },
}))

// Everything `erase.ts` imports for the ORG path, which none of these cases
// walks. Named explicitly because a jest factory is a closed world.
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteHostProjectionForAllMembers: async () => undefined,
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  detachWorkspaceDomain: async () => undefined,
}))
jest.mock('./console-domains', () => ({
  __esModule: true,
  CONSOLE_DOMAINS_COLLECTION: 'consoleDomains',
  releaseConsoleDomain: async () => undefined,
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  authForPool: () => ({}),
  findUserByUidAcrossPools: async () => null,
}))
jest.mock('./email-delivery-log', () => ({
  __esModule: true,
  eraseEmailDeliveriesForAddresses: async () => ({ erased: 0, visited: 0 }),
}))
jest.mock('./account-addresses', () => ({
  __esModule: true,
  resolveAccountAddresses: async () => ({
    uid: '',
    primary: null,
    addresses: [],
    incomplete: false,
  }),
}))
jest.mock('./account-emails', () => ({
  __esModule: true,
  EMAIL_IDENTITY_INDEX_COLLECTION: 'emailIdentityIndex',
}))
jest.mock('./organizations', () => ({
  __esModule: true,
  removeOrgMember: async () => undefined,
  getOrgForHost: async () => null,
}))
jest.mock('./org-billing', () => ({
  __esModule: true,
  readOrgBilling: async () => ({}),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isBillingSubscription: () => false,
}))
jest.mock('./dns-probe', () => ({
  __esModule: true,
  lookupTxt: async () => ({ answered: false, records: [] }),
  lookupMx: async () => ({ answered: false, records: [] }),
}))

import { eraseHost } from './erase'
import type { HostSendingDomainTeardown } from './host-sending-domain'
import { readSendingDomainTeardownByLabel } from './sending-domain-debt'

const ORG = 'org123'
const HOST = 'HostAbc'
const LABEL = 'northwind'
const DOMAIN = 'northwind.mail.aglyn.app'
const PROVIDER_ID = 'dom_live_1'
const SELECTOR = 'resend'

/** A fully provisioned site: host, label claim and the org's domain record. */
function seedProvisionedSite(options: {
  hostId?: string
  label?: string
  orgId?: string
} = {}) {
  const hostId = options.hostId ?? HOST
  const label = options.label ?? LABEL
  const orgId = options.orgId ?? ORG
  const domain = `${label}.mail.aglyn.app`
  store.set(`hosts/${hostId}`, {
    orgId,
    subdomain: label,
    sendingLabel: label,
    sendingDomain: domain,
  })
  store.set(`hostIndex/${hostId}`, { hostId, subdomain: label })
  store.set(`orgs/${orgId}`, { plan: 'pro', hosts: { [hostId]: true } })
  store.set(`sendingLabels/${label}`, {
    label,
    hostId,
    orgId,
    domain,
    claimedAtMs: Date.now() - 60 * 60 * 1000,
  })
  store.set(`orgs/${orgId}/sendingDomains/${domain}`, {
    domain,
    status: 'verified',
    providerDomainId: PROVIDER_ID,
    dkimSelector: SELECTOR,
    dkimPublicKey: 'k',
    createdAtMs: Date.now() - 60 * 60 * 1000,
  })
  return { hostId, label, domain, orgId }
}

beforeEach(() => {
  store.clear()
  deleteFiles.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('erasing a site releases its sending domain', () => {
  it('names the provider domain and the selector, then drops every record', async () => {
    seedProvisionedSite()
    const tearDown = jest.fn(async (_teardown: HostSendingDomainTeardown) => ({
      outcome: 'removed' as const,
      detail: null,
    }))

    const result = await eraseHost(HOST, { tearDownSendingDomain: tearDown })

    // The vendor call gets what it needs to name BOTH resources: the Resend
    // domain object holding the slot, and the selector without which the DKIM
    // record cannot be addressed and is left live in the zone.
    expect(tearDown).toHaveBeenCalledTimes(1)
    expect(tearDown.mock.calls[0][0]).toEqual({
      hostId: HOST,
      orgId: ORG,
      label: LABEL,
      domain: DOMAIN,
      providerDomainId: PROVIDER_ID,
      dkimSelector: SELECTOR,
    })

    expect(result.sendingDomain).toBe('released')
    expect(store.has(`orgs/${ORG}/sendingDomains/${DOMAIN}`)).toBe(false)
    expect(store.has(`sendingLabels/${LABEL}`)).toBe(false)
    // …and the site itself is gone, which is the thing that was asked for.
    expect(store.has(`hosts/${HOST}`)).toBe(false)
    expect(store.has(`hostIndex/${HOST}`)).toBe(false)
  })

  it('does not resurrect the host document while clearing its fields', async () => {
    /*
     * A merging `set` CREATES the document it is given. Clearing
     * `sendingLabel`/`sendingDomain` on a site that has just been
     * recursive-deleted would write an empty `hosts/{hostId}` back into
     * existence — a fragment of a site the customer asked us to destroy,
     * resurrected by its own cleanup.
     */
    seedProvisionedSite()

    await eraseHost(HOST, {
      tearDownSendingDomain: async () => ({ outcome: 'removed', detail: null }),
    })

    expect(store.has(`hosts/${HOST}`)).toBe(false)
    expect([...store.keys()].filter((key) => key.startsWith('hosts/'))).toEqual([])
  })

  it('leaves every OTHER site’s domain exactly where it was', async () => {
    // The direction that fails if the teardown were ever bounded by anything
    // looser than the one host being erased.
    seedProvisionedSite()
    const bystander = seedProvisionedSite({
      hostId: 'HostXyz',
      label: 'acme',
    })
    const tearDown = jest.fn(async (_teardown: HostSendingDomainTeardown) => ({
      outcome: 'removed' as const,
      detail: null,
    }))

    await eraseHost(HOST, { tearDownSendingDomain: tearDown })

    expect(tearDown).toHaveBeenCalledTimes(1)
    expect(tearDown.mock.calls[0][0].domain).toBe(DOMAIN)
    expect(store.has(`hosts/${bystander.hostId}`)).toBe(true)
    expect(store.has(`sendingLabels/${bystander.label}`)).toBe(true)
    expect(store.has(`orgs/${ORG}/sendingDomains/${bystander.domain}`)).toBe(true)
  })

  it('does nothing at any vendor for a site that never had a domain', async () => {
    store.set(`hosts/${HOST}`, { orgId: ORG, subdomain: 'northwind' })
    const tearDown = jest.fn(async (_teardown: HostSendingDomainTeardown) => ({
      outcome: 'removed' as const,
      detail: null,
    }))

    const result = await eraseHost(HOST, { tearDownSendingDomain: tearDown })

    expect(result.sendingDomain).toBe('none')
    expect(tearDown).not.toHaveBeenCalled()
  })
})

describe('a vendor that refuses does not hold up the erasure', () => {
  it('completes the erasure and records the debt on the surviving claim', async () => {
    seedProvisionedSite()

    const result = await eraseHost(HOST, {
      tearDownSendingDomain: async () => ({
        outcome: 'failed',
        detail: 'provider-release',
      }),
    })

    // The erasure is COMPLETE. A deletion somebody has a legal right to does
    // not wait on Resend being reachable.
    expect(store.has(`hosts/${HOST}`)).toBe(false)
    expect(store.has(`hostIndex/${HOST}`)).toBe(false)

    // And the slot is not on the floor: the claim survives, carrying what the
    // next pass needs to release it.
    expect(result.sendingDomain).toBe('deferred')
    const debt = store.get(`sendingLabels/${LABEL}`) as Doc
    expect(debt.teardownDetail).toBe('provider-release')
    expect(debt.teardownAttempts).toBe(1)
    expect(debt.providerDomainId).toBe(PROVIDER_ID)
    expect(debt.dkimSelector).toBe(SELECTOR)
    expect(Number(debt.orphanedAtMs)).toBeGreaterThan(0)
    // The claim still names its host, which is what lets the reaper release it.
    expect(debt.hostId).toBe(HOST)
  })

  it('records the same debt when the driver THROWS', async () => {
    seedProvisionedSite()

    const result = await eraseHost(HOST, {
      tearDownSendingDomain: async () => {
        throw new Error('ECONNRESET')
      },
    })

    expect(result.sendingDomain).toBe('deferred')
    expect((store.get(`sendingLabels/${LABEL}`) as Doc).teardownDetail).toBe('threw')
    expect(store.has(`hosts/${HOST}`)).toBe(false)
  })

  it('records a debt when the caller holds no vendor credential at all', async () => {
    // The tenant-side and operator-script shape. This library cannot import
    // the driver — the credential must not be reachable from the process that
    // serves published sites — so an erasure from there defers by design.
    seedProvisionedSite()

    const result = await eraseHost(HOST)

    expect(result.sendingDomain).toBe('deferred')
    expect((store.get(`sendingLabels/${LABEL}`) as Doc).teardownDetail).toBe(
      'no-teardown-driver',
    )
  })

  it('survives the org record being destroyed with its workspace', async () => {
    /*
     * The eraseOrg shape, and the reason the tombstone is the LABEL CLAIM and
     * not the domain record. `recursiveDelete(orgs/{orgId})` destroys
     * `orgs/{orgId}/sendingDomains/{domain}`, which is where the provider's id
     * and the selector live. A debt recorded there would be erased along with
     * the workspace it belonged to, and the slot would be unreleasable — there
     * would be no id left to release it with.
     */
    seedProvisionedSite()

    await eraseHost(HOST, {
      tearDownSendingDomain: async () => ({
        outcome: 'failed',
        detail: 'provider-release',
      }),
    })
    // …then the workspace goes, as `eraseOrg` would take it.
    store.delete(`orgs/${ORG}/sendingDomains/${DOMAIN}`)
    store.delete(`orgs/${ORG}`)

    const teardown = await readSendingDomainTeardownByLabel(LABEL)

    expect(teardown).toEqual({
      hostId: HOST,
      orgId: ORG,
      label: LABEL,
      domain: DOMAIN,
      providerDomainId: PROVIDER_ID,
      dkimSelector: SELECTOR,
    })
  })

  it('counts a second failed pass rather than looking identical to the first', async () => {
    seedProvisionedSite()
    const failing = async () => ({ outcome: 'failed' as const, detail: 'zone-unreadable' })

    await eraseHost(HOST, { tearDownSendingDomain: failing })
    const firstStamp = Number((store.get(`sendingLabels/${LABEL}`) as Doc).orphanedAtMs)

    // A second pass over the same claim — the reaper's retry, in miniature.
    const teardown = await readSendingDomainTeardownByLabel(LABEL)
    const { recordSendingDomainDebt } = await import('./sending-domain-debt')
    await recordSendingDomainDebt(teardown as never, 'zone-unreadable')

    const debt = store.get(`sendingLabels/${LABEL}`) as Doc
    expect(debt.teardownAttempts).toBe(2)
    // The FIRST orphaning time is kept: it is when the site stopped existing,
    // and overwriting it would make a debt that has been stuck for a month
    // read as one raised this morning.
    expect(Number(debt.orphanedAtMs)).toBe(firstStamp)
  })
})

describe('⛔ the shared pool is never torn down', () => {
  it('refuses even a host that has somehow been pinned to a pool label', async () => {
    /*
     * Impossible by construction — pool labels are reserved against tenants
     * and `ensureHostSendingDomain` refuses them — which is exactly why it is
     * forced here. `shared3.mail.aglyn.app` is live infrastructure carrying a
     * quarter of the platform's receipts and password resets, and no path may
     * release it however it is reached.
     */
    store.set(`hosts/${HOST}`, {
      orgId: ORG,
      subdomain: 'shared3',
      sendingLabel: 'shared3',
      sendingDomain: 'shared3.mail.aglyn.app',
    })
    store.set('sendingLabels/shared3', {
      label: 'shared3',
      hostId: HOST,
      orgId: ORG,
      domain: 'shared3.mail.aglyn.app',
      claimedAtMs: Date.now(),
    })
    const tearDown = jest.fn(async (_teardown: HostSendingDomainTeardown) => ({
      outcome: 'removed' as const,
      detail: null,
    }))

    const result = await eraseHost(HOST, { tearDownSendingDomain: tearDown })

    expect(result.sendingDomain).toBe('protected')
    expect(tearDown).not.toHaveBeenCalled()
    // Nothing about the pool member was touched, including our own record of
    // the claim — the operator has to be able to see what happened.
    expect(store.has('sendingLabels/shared3')).toBe(true)
    // The site itself is still erased. Refusing the pool is not refusing the
    // deletion.
    expect(store.has(`hosts/${HOST}`)).toBe(false)
  })
})

describe('running it twice', () => {
  it('is a no-op the second time, with no second vendor call', async () => {
    seedProvisionedSite()
    const tearDown = jest.fn(async (_teardown: HostSendingDomainTeardown) => ({
      outcome: 'removed' as const,
      detail: null,
    }))

    await eraseHost(HOST, { tearDownSendingDomain: tearDown })
    const second = await eraseHost(HOST, { tearDownSendingDomain: tearDown })

    expect(tearDown).toHaveBeenCalledTimes(1)
    expect(second.sendingDomain).toBe('none')
  })
})
