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
 * The email-starter install, driven end to end.
 *
 * `email-starter-policy.spec.ts` proves the predicates; this proves the WIRING
 * — that the refusals are reached by the route rather than by helpers nobody
 * calls, which is the failure mode `install-email-template.ts` records for
 * takedown across six artifact types.
 *
 * Deliberately NOT mocking `../model` or the revocation predicate: the policy
 * and the kill switch are what is on trial.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'
import { isPluginRevoked } from '@aglyn/aglyn/app-utils/plugin-manifest'

let mintedIds = 0

jest.mock('@aglyn/aglyn/server', () => ({
  createResourceUid: () => `minted-${++mintedIds}`,
  isPluginRevoked: (revocation: unknown, version: string) =>
    isPluginRevoked(revocation as never, version),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'buyer-org',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => state.ownsListing,
}))

jest.mock('./purchase-entitlement', () => ({
  requirePurchase: async () => null,
}))

jest.mock('./provenance', () => ({
  recordInstallProvenance: async (input: {
    listingId: string
    version: unknown
    artifactType: string
    listing: { profileId?: string }
  }) => ({
    sha256: 'sha-of-content',
    baseStored: true,
    installedFrom: {
      listingId: input.listingId,
      version: input.version == null ? null : String(input.version),
      sha256: 'sha-of-content',
      artifactType: input.artifactType,
      installedAt: 'NOW',
      publisherOrgId: input.listing.profileId ?? null,
    },
  }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

const ROOT = '_@_'

/** A clean one-block design, as a plain Firestore map. */
const cleanNodes = (): Record<string, unknown> => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['section'] },
  section: {
    $id: 'section',
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: ROOT,
    nodes: ['text'],
  },
  text: {
    $id: 'text',
    componentId: 'emailText',
    pluginId: 'email',
    parentId: 'section',
    props: { children: 'Hello {{contact.firstName}},' },
  },
})

/** The same design with a remote tracking pixel in it. */
const pixelNodes = (): Record<string, unknown> => {
  const nodes = cleanNodes()
  ;(nodes as any).pixel = {
    $id: 'pixel',
    componentId: 'emailImage',
    pluginId: 'email',
    parentId: 'section',
    props: { src: 'https://publisher.example/open.gif', width: 1 },
  }
  return nodes
}

interface Written {
  path: string
  data: Record<string, unknown>
}

const state = {
  ownsListing: false,
  listing: {} as Record<string, unknown>,
  version: {} as Record<string, unknown>,
  versionExists: true,
  revocation: undefined as Record<string, unknown> | undefined,
  writes: [] as Written[],
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshotOf = (data: Record<string, unknown>, exists = true) => ({
    exists,
    data: () => (exists ? data : undefined),
    get: (field: string) => data[field],
  })
  const docRef = (path: string): any => ({
    path,
    get: async () => {
      if (path === 'hosts/host-1') {
        return snapshotOf({ memberRoles: { 'buyer-1': 'admin' } })
      }
      if (path === 'marketplaceListings/listing-1') {
        return snapshotOf(state.listing)
      }
      if (path === 'revocations/listing-1') {
        return snapshotOf(state.revocation ?? {}, Boolean(state.revocation))
      }
      if (path.startsWith('marketplaceListings/listing-1/versions/')) {
        return snapshotOf(state.version, state.versionExists)
      }
      return snapshotOf({}, false)
    },
    set: async (data: Record<string, unknown>) => {
      state.writes.push({ path, data })
    },
    update: async () => undefined,
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  const firestore = {
    collection: (name: string) => collectionRef(name),
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        state.writes.push({ path: ref.path, data })
      },
      commit: async () => undefined,
    }),
  }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: { serverTimestamp: () => 'NOW', increment: (by: number) => by },
      },
    },
  }
})

import { installEmailStarterHandler } from './install-email-starter'

function makeRes() {
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
  return res
}

const makeReq = () =>
  ({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { listingId: 'listing-1', hostId: 'host-1' },
  }) as any

async function install() {
  const res = makeRes()
  await installEmailStarterHandler(makeReq(), res)
  return res
}

/** Every write that landed in the buyer's own site. */
const siteWrites = () =>
  state.writes.filter((write) => write.path.startsWith('hosts/host-1/'))

/** The screen document the install minted, if any. */
const screenWrite = () =>
  siteWrites().find((write) => write.path.split('/').length === 4)

beforeEach(() => {
  mintedIds = 0
  state.ownsListing = false
  state.versionExists = true
  state.revocation = undefined
  state.writes = []
  state.listing = {
    artifactType: 'emailStarter',
    profileId: 'seller-org',
    priceUsd: 0,
    latestVersion: 3,
    displayName: 'Spring sale',
  }
  state.version = {
    rootId: ROOT,
    nodes: cleanNodes(),
    subject: 'Spring is here',
    preheader: '20% off',
  }
})

describe('a clean install lands as an ordinary email of the site’s own', () => {
  it('writes a kind:email screen plus its first version', async () => {
    const res = await install()
    expect(res.statusCode).toBe(200)
    const screen = screenWrite()
    expect(screen?.data).toMatchObject({
      kind: 'email',
      displayName: 'Spring sale',
      emailSubject: 'Spring is here',
      emailPreheader: '20% off',
    })
    // The version pointer and the version document agree, which is what the
    // Email templates list and the besigner both read.
    expect(screen?.data['versionId']).toBe(res.body.versionId)
    expect(siteWrites().map((write) => write.path)).toEqual([
      `hosts/host-1/screens/${res.body.screenId}`,
      `hosts/host-1/screens/${res.body.screenId}/versions/${res.body.versionId}`,
    ])
  })

  it('stamps provenance on the version as well as the screen', async () => {
    await install()
    for (const write of siteWrites()) {
      expect(write.data['installedFrom']).toMatchObject({
        listingId: 'listing-1',
        version: '3',
        artifactType: 'emailStarter',
        publisherOrgId: 'seller-org',
      })
    }
  })
})

describe('an unreviewed version is never treated as reviewed', () => {
  it('stamps unreviewed when the version carries no verdict', async () => {
    const res = await install()
    expect(res.body.assurance).toBe('unreviewed')
    expect(screenWrite()?.data['installedFrom']).toMatchObject({
      assurance: 'unreviewed',
    })
  })

  it('does not inherit the listing’s own verified badge', async () => {
    state.listing['reviewStatus'] = 'verified'
    state.listing['latestVersionReviewState'] = 'approved'
    state.listing['latestApprovedVersion'] = '2'
    const res = await install()
    expect(res.body.assurance).toBe('unreviewed')
  })

  it('does not inherit an approval the PUBLISHER installing their own version has', async () => {
    // The deliberate self-install path: the publisher's org installs its own
    // listing to test it. Nothing about owning the listing reviews the bytes.
    state.ownsListing = true
    state.listing['reviewStatus'] = 'verified'
    const res = await install()
    expect(res.body.assurance).toBe('unreviewed')
    expect(screenWrite()?.data['installedFrom']).toMatchObject({
      assurance: 'unreviewed',
    })
  })

  it('records an approval when THIS version really has one', async () => {
    state.version['reviewState'] = 'approved'
    const res = await install()
    expect(res.body.assurance).toBe('approved')
  })

  it('refuses a version review turned down, for the publisher too', async () => {
    state.version['reviewState'] = 'rejected'
    state.ownsListing = true
    const res = await install()
    expect(res.statusCode).toBe(409)
    expect(siteWrites()).toHaveLength(0)
  })
})

describe('the kill switch is reached at install', () => {
  it('refuses the version staff stopped', async () => {
    state.revocation = { versions: ['3'], reason: 'Phishing layout' }
    const res = await install()
    expect(res.statusCode).toBe(409)
    expect(siteWrites()).toHaveLength(0)
  })

  it('refuses when the whole listing is stopped', async () => {
    state.revocation = { versions: 'all' }
    expect((await install()).statusCode).toBe(409)
  })

  it('still installs when a DIFFERENT version was stopped', async () => {
    state.revocation = { versions: ['1'] }
    expect((await install()).statusCode).toBe(200)
  })
})

describe('the content policy is enforced where content is handed over', () => {
  it('refuses a template carrying a remote tracking pixel', async () => {
    state.version['nodes'] = pixelNodes()
    const res = await install()
    expect(res.statusCode).toBe(422)
    expect(res.body.violations[0]).toMatchObject({ code: 'remote-asset' })
    expect(siteWrites()).toHaveLength(0)
  })

  it('refuses a merge tag inside a link', async () => {
    const nodes = cleanNodes()
    ;(nodes as any).cta = {
      $id: 'cta',
      componentId: 'emailButton',
      parentId: 'section',
      props: { href: 'https://shop.example/?e={{contact.email}}' },
    }
    state.version['nodes'] = nodes
    const res = await install()
    expect(res.statusCode).toBe(422)
    expect(res.body.violations[0]).toMatchObject({ code: 'merge-tag-in-url' })
  })

  it('sees a violation hidden in the compressed storage form', async () => {
    // A naive walk over these bytes yields byte indices and reports the design
    // clean. The install would then hand a tracking pixel to the buyer.
    state.version['nodes'] = Buffer.from(compress(pixelNodes()))
    const res = await install()
    expect(res.statusCode).toBe(422)
    expect(res.body.violations[0]).toMatchObject({ code: 'remote-asset' })
  })

  it('installs a clean design stored in the compressed form', async () => {
    state.version['nodes'] = Buffer.from(compress(cleanNodes()))
    const res = await install()
    expect(res.statusCode).toBe(200)
    // Decoded on the way in, so the buyer's document is a readable map rather
    // than the publisher's bytes.
    expect(
      Object.keys(
        siteWrites()[1].data['nodes'] as Record<string, unknown>,
      ),
    ).toContain('text')
  })

  it('reports the outbound link hosts so the buyer can see them', async () => {
    const nodes = cleanNodes()
    ;(nodes as any).cta = {
      $id: 'cta',
      componentId: 'emailButton',
      parentId: 'section',
      props: { href: 'https://shop.example/sale' },
    }
    state.version['nodes'] = nodes
    expect((await install()).body.linkHosts).toEqual(['shop.example'])
  })

  it('reports media still served out of the publisher’s own scope', async () => {
    const nodes = cleanNodes()
    ;(nodes as any).hero = {
      $id: 'hero',
      componentId: 'emailImage',
      parentId: 'section',
      props: { src: 'media:seller-host/hero' },
    }
    state.version['nodes'] = nodes
    const res = await install()
    expect(res.statusCode).toBe(200)
    expect(res.body.foreignMediaScopes).toEqual(['seller-host'])
  })
})

describe('the storefront gates apply to this type too', () => {
  it('404s a listing staff took down', async () => {
    state.listing['hiddenAt'] = 'THEN'
    expect((await install()).statusCode).toBe(404)
  })

  it('404s an unpublished listing', async () => {
    state.listing['deletedAt'] = 'THEN'
    expect((await install()).statusCode).toBe(404)
  })

  it('404s a private listing for anyone but its publisher', async () => {
    state.listing['visibility'] = 'private'
    expect((await install()).statusCode).toBe(404)
    state.ownsListing = true
    expect((await install()).statusCode).toBe(200)
  })

  it('404s a listing of some other artifact type', async () => {
    state.listing['artifactType'] = 'emailTemplate'
    expect((await install()).statusCode).toBe(404)
  })
})

describe('a publisher’s update never reaches an installed copy', () => {
  it('mints a NEW email each install and writes to no existing document', async () => {
    const first = await install()
    // The publisher pushes a new version with different content.
    state.listing['latestVersion'] = 4
    state.version = { rootId: ROOT, nodes: cleanNodes(), subject: 'Rewritten' }
    const paths = [...state.writes.map((write) => write.path)]
    state.writes = []
    const second = await install()

    expect(second.body.screenId).not.toBe(first.body.screenId)
    // Not one write lands on anything created by the first install — which is
    // the whole of "an installed template does not silently change".
    for (const write of state.writes) {
      expect(paths).not.toContain(write.path)
      expect(write.path).not.toContain(String(first.body.screenId))
    }
  })
})
