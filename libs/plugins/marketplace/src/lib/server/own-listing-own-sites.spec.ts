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
 * A publisher's members get its listing free only on its OWN sites, at every
 * install door (AGL-2484, AGL-4047).
 *
 * Plugins and site starters have asked "does the install land in the
 * publishing workspace" since AGL-2484. The other install doors and
 * `update-artifact` asked only whether the caller belonged to the publisher,
 * so a member could put the workspace's paid listing on a client's site for
 * free, or a private one onto a site it was never meant for.
 *
 * Every door runs here against one Firestore double, with the REAL membership
 * fact (`isPublisherMember` reading the members document), the REAL waiver
 * (`ownsListingHere`) and the REAL purchase predicate. The predicate is
 * wrapped so a door that gets past it answers a marker instead of going on to
 * install: what is under test is the payment decision, and stopping there
 * keeps nine doors' write paths (each held by its own spec) out of it.
 *
 * The person asking belongs to BOTH workspaces: the publisher's and the
 * client's. That is the case the waiver used to get wrong, and the only one
 * where "which site" is the whole question.
 */

const PUBLISHER = 'publisher-org'
const CLIENT = 'client-org'
const MEMBER = 'member-1'

/** What a door returns when it got past the payment gate. */
const mockPastThePaymentGate = { error: 'past the payment gate', priceUsd: 0 }

const mockWorld = {
  /** The authenticated caller. */
  uid: MEMBER,
  /** The workspace the site belongs to: where the install lands. */
  targetOrgId: PUBLISHER,
  docs: new Map<string, Record<string, unknown>>(),
  /** Every document a door wrote. */
  writes: [] as string[],
}

function mockRead(data: unknown, field: string): unknown {
  return field
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data)
}

function mockSnapshot(path: string, data: Record<string, unknown> | undefined): any {
  return {
    id: path.split('/').pop(),
    ref: mockDocRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => mockRead(data, field),
  }
}

function mockQuery(path: string, filters: Array<[string, unknown]>): any {
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(path, [...filters, [field, value]]),
    limit: () => mockQuery(path, filters),
    orderBy: () => mockQuery(path, filters),
    select: () => mockQuery(path, filters),
    get: async () => {
      const docs = [...mockWorld.docs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter(([, data]) => filters.every(([field, value]) => mockRead(data, field) === value))
        .map(([key, data]) => mockSnapshot(key, data))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  }
}

function mockCollection(path: string): any {
  return {
    ...mockQuery(path, []),
    doc: (id = 'minted') => mockDocRef(`${path}/${id}`),
  }
}

function mockDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => mockSnapshot(path, mockWorld.docs.get(path)),
    set: async () => {
      mockWorld.writes.push(path)
    },
    update: async () => {
      mockWorld.writes.push(path)
    },
    delete: async () => {
      mockWorld.writes.push(path)
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  // Install permission everywhere: the permission gates are held by their own
  // specs, and this one is about who pays.
  resolveOrgPermissions: async () => ({
    orgId: mockWorld.targetOrgId,
    permissions: { installPlugins: true },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const firestore = {
    collection: (name: string) => mockCollection(name),
    getAll: async (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
    batch: () => ({
      set: (ref: { path: string }) => mockWorld.writes.push(ref.path),
      update: (ref: { path: string }) => mockWorld.writes.push(ref.path),
      delete: (ref: { path: string }) => mockWorld.writes.push(ref.path),
      commit: async () => undefined,
    }),
    runTransaction: async (run: (tx: unknown) => unknown) =>
      run({
        get: (ref: any) => ref.get(),
        set: (ref: { path: string }) => mockWorld.writes.push(ref.path),
        update: (ref: { path: string }) => mockWorld.writes.push(ref.path),
      }),
  }
  return {
    // The site's workspace, as the host index answers it.
    getOrgForHost: async () => ({
      orgId: mockWorld.targetOrgId,
      org: { plan: 'starter' },
    }),
    resolveOrgIdForHost: async () => mockWorld.targetOrgId,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: mockWorld.uid }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          increment: (by: number) => by,
          delete: () => 'DELETE',
          arrayUnion: (...values: unknown[]) => values,
          arrayRemove: (...values: unknown[]) => values,
        },
      },
    },
  }
})

jest.mock('@aglyn/tenant-data-admin/server/theme-library-write', () => ({
  runThemeLibraryAction: async () => ({ ok: false, status: 500, error: 'not under test' }),
}))

jest.mock('./purchase-entitlement', () => {
  const actual = jest.requireActual('./purchase-entitlement')
  return {
    ...actual,
    requirePurchase: jest.fn(
      async (args: Parameters<typeof actual.requirePurchase>[0]) =>
        (await actual.requirePurchase(args)) ?? mockPastThePaymentGate,
    ),
  }
})

// The dataset schema door asks the plugin that keeps datasets whether the
// workspace may hold one, before the listing; it may.
jest.mock('./artifact-owner', () => ({
  artifactTypeOwnerOrRefusal: async () => ({
    ok: true,
    owner: { admits: async () => null },
  }),
  marketplaceInstallStamp: () => ({}),
}))

jest.mock('./provenance', () => ({
  hasDivergedFromBase: async () => false,
  recordInstallProvenance: async () => ({ installedFrom: {}, baseStored: true }),
  pinnedProvenance: () => ({}),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { installHandler } from './install'
import { installDatasetSchemaHandler } from './install-dataset-schema'
import { installEmailStarterHandler } from './install-email-starter'
import { installEmailTemplateHandler } from './install-email-template'
import { installLayoutHandler } from './install-layout'
import { installPluginHandler } from './install-plugin'
import { installTemplateHandler } from './install-template'
import { installThemeHandler } from './install-theme'
import { requirePurchase } from './purchase-entitlement'
import { updateArtifactHandler } from './update-artifact'

const requirePurchaseMock = requirePurchase as jest.MockedFunction<typeof requirePurchase>

interface Door {
  name: string
  handler: PluginApiHandler
  artifactType: string
  /** Whether it refuses a private listing to anyone but its publisher. */
  gatesPrivate: boolean
}

const DOORS: Door[] = [
  { name: 'install.ts', handler: installHandler, artifactType: 'component', gatesPrivate: true },
  { name: 'install-plugin.ts', handler: installPluginHandler, artifactType: 'plugin', gatesPrivate: true },
  { name: 'install-theme.ts', handler: installThemeHandler, artifactType: 'theme', gatesPrivate: true },
  { name: 'install-template.ts', handler: installTemplateHandler, artifactType: 'template', gatesPrivate: true },
  { name: 'install-layout.ts', handler: installLayoutHandler, artifactType: 'layout', gatesPrivate: true },
  {
    name: 'install-email-template.ts',
    handler: installEmailTemplateHandler,
    artifactType: 'emailTemplate',
    gatesPrivate: true,
  },
  {
    name: 'install-email-starter.ts',
    handler: installEmailStarterHandler,
    artifactType: 'emailStarter',
    gatesPrivate: true,
  },
  {
    name: 'install-dataset-schema.ts',
    handler: installDatasetSchemaHandler,
    artifactType: 'datasetSchema',
    gatesPrivate: true,
  },
  // A new version of an installed copy: it only reaches content a door
  // already handed over, so it has no private gate of its own.
  { name: 'update-artifact.ts', handler: updateArtifactHandler, artifactType: 'component', gatesPrivate: false },
]

async function ask(door: Door) {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  await door.handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { listingId: 'listing-1', hostId: 'host-1' },
    } as any,
    res,
  )
  return res
}

const listing = (door: Door, fields: Record<string, unknown> = {}) =>
  mockWorld.docs.set('marketplaceListings/listing-1', {
    profileId: PUBLISHER,
    artifactType: door.artifactType,
    displayName: 'Bistro kit',
    latestVersion: '1',
    priceUsd: 49,
    ...fields,
  })

/** The `ownsListing` each payment decision was asked with. */
const waivers = () => requirePurchaseMock.mock.calls.map(([args]) => args.ownsListing)

/** Nothing landed on the site, in the workspace, or anywhere else. */
const wroteNothing = () => expect(mockWorld.writes).toEqual([])

beforeEach(() => {
  requirePurchaseMock.mockClear()
  mockWorld.uid = MEMBER
  mockWorld.targetOrgId = PUBLISHER
  mockWorld.writes = []
  mockWorld.docs = new Map<string, Record<string, unknown>>([
    // The site, which the caller administers.
    ['hosts/host-1', { memberRoles: { [MEMBER]: 'admin', stranger: 'admin' } }],
    ['orgs/publisher-org', { plan: 'starter' }],
    ['orgs/client-org', { plan: 'starter' }],
    // The caller belongs to the publisher, as an editor, and to the client.
    [`orgs/${PUBLISHER}/members/${MEMBER}`, { role: 'editor' }],
    [`orgs/${CLIENT}/members/${MEMBER}`, { role: 'admin' }],
    [`orgs/${CLIENT}/members/stranger`, { role: 'admin' }],
  ])
})

describe.each(DOORS)('$name: a publisher’s listing is free on its own sites only (AGL-4047)', (door) => {
  it('own site: a member of the publisher gets the paid listing free', async () => {
    listing(door)
    const res = await ask(door)
    expect(res.body).toBe(mockPastThePaymentGate)
    expect(waivers()).toEqual([true])
  })

  it('another workspace’s site: the same member is a buyer, and is asked to buy it first', async () => {
    mockWorld.targetOrgId = CLIENT
    listing(door)
    const res = await ask(door)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'Purchase required', priceUsd: 49 })
    expect(waivers()).toEqual([false])
    wroteNothing()
  })

  it('another workspace’s site: a licence that workspace holds lets the member install it, as for any buyer', async () => {
    mockWorld.targetOrgId = CLIENT
    listing(door)
    mockWorld.docs.set('marketplacePurchases/p1', {
      buyerOrgId: CLIENT,
      buyerUid: 'someone-else',
      listingId: 'listing-1',
    })
    const res = await ask(door)
    expect(res.body).toBe(mockPastThePaymentGate)
    expect(waivers()).toEqual([false])
  })

  it('another workspace’s site: a licence of the PUBLISHER’s does not cover it', async () => {
    mockWorld.targetOrgId = CLIENT
    listing(door)
    mockWorld.docs.set('marketplacePurchases/p1', {
      buyerOrgId: PUBLISHER,
      buyerUid: 'someone-else',
      listingId: 'listing-1',
    })
    expect((await ask(door)).statusCode).toBe(402)
  })

  it('own site: someone who is not a member of the publisher is a buyer there too', async () => {
    // Same-workspace is necessary, never sufficient: the membership fact
    // still has to hold.
    mockWorld.uid = 'stranger'
    listing(door)
    const res = await ask(door)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'Purchase required', priceUsd: 49 })
    wroteNothing()
  })

  it.each([
    ['on the publisher’s own site, to its member', PUBLISHER, MEMBER],
    ['on another workspace’s site, to the publisher’s member', CLIENT, MEMBER],
    ['on another workspace’s site, to a stranger', CLIENT, 'stranger'],
  ])('a free listing is free everywhere: %s', async (_case, targetOrgId, uid) => {
    mockWorld.targetOrgId = targetOrgId
    mockWorld.uid = uid
    listing(door, { priceUsd: 0 })
    const res = await ask(door)
    if (door.name === 'update-artifact.ts') {
      // A free listing does not reach the payment question here at all; the
      // route goes on to the version it would offer.
      expect(requirePurchaseMock).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect(res.body).toEqual({ error: 'Listing version missing' })
    } else {
      expect(res.body).toBe(mockPastThePaymentGate)
    }
  })

  if (door.gatesPrivate) {
    it('a private listing installs on the publisher’s own sites, and is unknown on anyone else’s', async () => {
      listing(door, { visibility: 'private', priceUsd: 0 })
      expect((await ask(door)).body).toBe(mockPastThePaymentGate)
      mockWorld.targetOrgId = CLIENT
      const elsewhere = await ask(door)
      expect(elsewhere.statusCode).toBe(404)
      expect(requirePurchaseMock).toHaveBeenCalledTimes(1)
      wroteNothing()
    })
  }
})
