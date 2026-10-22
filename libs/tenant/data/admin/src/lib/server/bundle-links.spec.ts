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
 * AGL-3955 — a staff-minted bundle checkout link: the record, its audit row,
 * and the one-time waiver of the domains plugin's invoice-age gate it gives.
 */

export {}

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()

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
    id: path.split('/').pop(),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
  }
}
function mockMakeCollection(prefix: string): any {
  return {
    doc: (id?: string) => mockMakeDoc(`${prefix}/${id ?? `auto-${(mockAutoId += 1)}`}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: [...store.keys()]
            .filter(
              (path) =>
                path.startsWith(`${prefix}/`) &&
                !path.slice(prefix.length + 1).includes('/') &&
                (store.get(path) as Doc)[field] === value,
            )
            .map(mockSnapshot),
        }),
      }),
    }),
  }
}
function mockFirestore(): any {
  return {
    collection: (name: string) => mockMakeCollection(name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        set: (ref: { path: string }, data: Doc) => writes.push(() => store.set(ref.path, data)),
        commit: async () => writes.forEach((write) => write()),
      }
    },
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        update: (ref: { path: string }, data: Doc) =>
          writes.push(() => store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data })),
      }
      const result = await fn(tx)
      for (const write of writes) write()
      return result
    },
  }
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__', delete: () => '__delete__' },
}))

const {
  BUNDLE_LINK_TTL_MS,
  BundleLinkError,
  bundleLinkPreclearance,
  mintBundleLink,
  readBundleLinkDomain,
} = require('./bundle-links') as typeof import('./bundle-links')
const { parseOnboardingPlanIntent } =
  require('@aglyn/aglyn/app-utils/onboarding-deep-link') as typeof import('@aglyn/aglyn/app-utils/onboarding-deep-link')

const ORG = 'org-1'
const NOW = 1_800_000_000_000
const audits = () =>
  [...store.entries()].filter(([path]) => path.startsWith('adminAudit/')).map(([, row]) => row)
const links = () =>
  [...store.entries()].filter(([path]) => path.startsWith('bundleLinks/')).map(([path, row]) => ({
    id: path.split('/')[1],
    ...row,
  }))

const mint = (extra: Record<string, unknown> = {}) =>
  mintBundleLink({
    orgId: ORG,
    actor: { uid: 'staff-1', email: 'zed@aglyn.test' },
    origin: 'https://app.aglyn.test',
    plan: 'starter',
    addons: 'siteCare,ai,jetpack',
    interval: 'year',
    coupon: 'BOOTH25',
    now: NOW,
    ...extra,
  })

const REGISTRAR = process.env['DOMAINS_REGISTRAR']

beforeEach(() => {
  store = new Map()
  store.set(`orgs/${ORG}`, { name: 'Acme', slug: 'acme', ownerUid: 'client' })
  store.set('hosts/host-1', { orgId: ORG, subdomain: 'acme-roofing' })
  store.set('hosts/host-other', { orgId: 'org-2', subdomain: 'other' })
  delete process.env['DOMAINS_REGISTRAR']
})

afterAll(() => {
  if (REGISTRAR === undefined) delete process.env['DOMAINS_REGISTRAR']
  else process.env['DOMAINS_REGISTRAR'] = REGISTRAR
})

describe('minting a bundle link (AGL-3955)', () => {
  it('writes the record and its staff audit row together, and answers the Billing link', async () => {
    const minted = await mint()
    expect(minted.url).toBe(
      'https://app.aglyn.test/acme/billing?plan=starter&interval=year&addons=ai,siteCare&coupon=BOOTH25',
    )
    expect(minted.droppedAddons).toEqual(['jetpack'])
    // Named by createResourceUid(), never a Firestore auto-id (check:id-minting).
    expect(minted.id).not.toMatch(/^auto-/)
    expect(links()).toEqual([
      expect.objectContaining({
        id: minted.id,
        mintedBy: 'staff-1',
        workspaceId: ORG,
        createdAt: NOW,
        expiresAt: NOW + BUNDLE_LINK_TTL_MS,
        usedAt: null,
        preclearsDomainGate: true,
        intent: { plan: 'starter', addons: { aiAddon: 1, siteCare: 1 }, interval: 'year', coupon: 'BOOTH25' },
      }),
    ])
    expect(BUNDLE_LINK_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(audits()).toEqual([
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'billing.bundle-link-minted',
        target: `orgs/${ORG}`,
        after: expect.objectContaining({ bundleLinkId: minted.id, preclearsDomainGate: true }),
      }),
    ])
  })

  it('keeps the Aglyn AI tier an `ai:<tier>` entry names, on the record and the link (AGL-3965)', async () => {
    const minted = await mint({ addons: 'siteCare,ai:studio' })
    expect(minted.url).toBe(
      'https://app.aglyn.test/acme/billing?plan=starter&interval=year&addons=ai:studio,siteCare&coupon=BOOTH25',
    )
    expect(minted.intent).toMatchObject({ addons: { aiAddon: 1, siteCare: 1 }, aiTier: 'studio' })
    expect(links()[0]).toMatchObject({ intent: { aiTier: 'studio' } })
  })

  it('writes the tier staff picked as `ai:<tier>`, and Billing reads it back (AGL-4025)', async () => {
    // The staff card posts its switches as a map and the tier beside them.
    const minted = await mint({ addons: { siteCare: 1, aiAddon: 1 }, aiTier: 'plus' })
    expect(minted.url).toBe(
      'https://app.aglyn.test/acme/billing?plan=starter&interval=year&addons=ai:plus,siteCare&coupon=BOOTH25',
    )
    expect(minted.intent).toEqual({
      plan: 'starter',
      addons: { aiAddon: 1, siteCare: 1 },
      interval: 'year',
      coupon: 'BOOTH25',
      aiTier: 'plus',
    })
    expect(links()[0]).toMatchObject({ intent: { aiTier: 'plus' } })
    expect(audits()[0]).toMatchObject({ after: { intent: { aiTier: 'plus' } } })
    // What the owner's Billing page parses off that link: the same tier.
    expect(parseOnboardingPlanIntent(new URL(minted.url).searchParams)).toMatchObject({
      plan: 'starter',
      interval: 'year',
      ai: true,
      aiTier: 'plus',
      addons: { siteCare: 1, aiAddon: 1 },
      coupon: 'BOOTH25',
    })
  })

  it('the picked tier wins over an `ai:<tier>` entry; an unknown one or no AI add-on carries none (AGL-4025)', async () => {
    expect((await mint({ addons: 'siteCare,ai:studio', aiTier: 'boost' })).intent.aiTier).toBe('boost')
    // Not a tier: the entry's tier stands, and without one the link sells the default.
    expect((await mint({ addons: 'siteCare,ai:studio', aiTier: 'gold' })).intent.aiTier).toBe('studio')
    const unnamed = await mint({ addons: 'siteCare,ai', aiTier: 'gold' })
    expect(unnamed.intent.aiTier).toBeUndefined()
    expect(unnamed.url).toContain('addons=ai,siteCare')
    // A tier with Aglyn AI switched off is not sold.
    const off = await mint({ addons: { siteCare: 1 }, aiTier: 'plus' })
    expect(off.intent.aiTier).toBeUndefined()
    expect(off.url).toContain('addons=siteCare&')
  })

  it('refuses a plan nobody buys through checkout, and a workspace that already pays', async () => {
    await expect(mint({ plan: 'enterprise' })).rejects.toBeInstanceOf(BundleLinkError)
    store.set(`orgs/${ORG}/billing/stripe`, { subscription: { status: 'active' } })
    await expect(mint()).rejects.toMatchObject({ status: 409 })
    expect(links()).toHaveLength(0)
    expect(audits()).toHaveLength(0)
  })

  it('carries a domain only where domains are sold, for a site in the workspace, with its prices', async () => {
    const domain = { name: 'AcmeRoofing.com', firstYearCents: 1599, renewalCents: 1599, hostId: 'host-1' }
    await expect(mint({ domain })).rejects.toMatchObject({ status: 409 })
    process.env['DOMAINS_REGISTRAR'] = 'vercel'
    await expect(mint({ domain: { ...domain, hostId: 'host-other' } })).rejects.toBeInstanceOf(BundleLinkError)
    await expect(mint({ domain: { ...domain, renewalCents: 0 } })).rejects.toBeInstanceOf(BundleLinkError)
    const minted = await mint({ domain })
    expect(minted.domain).toEqual({ name: 'acmeroofing.com', firstYearCents: 1599, renewalCents: 1599, hostId: 'host-1' })
    expect(minted.url).toContain(`&bundle=${minted.id}`)
  })
})

describe('the link pre-clears one domain purchase (core.purchase-gate-preclearance)', () => {
  const gate = { orgId: ORG, gate: 'domain-payment-history' as const }

  it('finds the workspace’s live link and spends it exactly once', async () => {
    const minted = await mint()
    const waiver = bundleLinkPreclearance({ now: () => NOW + 1000 })
    expect(await waiver.check({ ...gate, orgId: 'org-2' })).toBeNull()
    expect(await waiver.check(gate)).toEqual({ preclearanceId: minted.id })
    expect(await waiver.consume(minted.id)).toBe(true)
    expect(store.get(`bundleLinks/${minted.id}`)).toMatchObject({
      usedAt: NOW + 1000,
      usedFor: 'domain-payment-history',
    })
    expect(await waiver.consume(minted.id)).toBe(false)
    expect(await waiver.check(gate)).toBeNull()
  })

  it('stops pre-clearing after 24 hours, and never for an id it does not hold', async () => {
    const minted = await mint()
    const later = bundleLinkPreclearance({ now: () => NOW + BUNDLE_LINK_TTL_MS + 1 })
    expect(await later.check(gate)).toBeNull()
    expect(await later.consume(minted.id)).toBe(false)
    expect(await later.consume('nope')).toBe(false)
    expect(await later.consume('bundleLinks/../x')).toBe(false)
  })
})

describe('the Billing page’s domain line (AGL-3955)', () => {
  it('reads the record, not the URL, and only for the workspace it is for', async () => {
    process.env['DOMAINS_REGISTRAR'] = 'vercel'
    const minted = await mint({
      domain: { name: 'acmeroofing.com', firstYearCents: 1599, renewalCents: 1899, hostId: 'host-1' },
    })
    expect(await readBundleLinkDomain(ORG, minted.id, NOW + 1)).toEqual({
      available: true,
      domain: {
        name: 'acmeroofing.com',
        firstYearCents: 1599,
        renewalCents: 1899,
        hostId: 'host-1',
        host: 'acme-roofing',
      },
    })
    expect(await readBundleLinkDomain('org-2', minted.id, NOW + 1)).toEqual({ available: true, domain: null })
    delete process.env['DOMAINS_REGISTRAR']
    expect((await readBundleLinkDomain(ORG, minted.id, NOW + 1)).available).toBe(false)
  })
})
