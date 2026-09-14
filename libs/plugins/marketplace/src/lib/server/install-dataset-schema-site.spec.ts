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
 * A marketplace dataset schema installs for the whole organization, whatever
 * the org's Default sharing says (AGL-2891).
 *
 * The org setting "New datasets and files are shared with" narrows a new
 * dataset to the site it was created in — when there is one. A dataset schema
 * has none: it installs at organization scope only, from the organization
 * Marketplace, and the install dialog says it lands on "the whole
 * organization — every site".
 *
 * But the Marketplace resolves the org through a site, and sends the org's
 * FIRST site as `hostId`. The route used to hand that to
 * `defaultScopeForNewResource` as though someone were working in it, so an
 * org set to "Only the site they were created in" got every installed dataset
 * hidden from every site but its first.
 *
 * Contracts:
 *
 *  1. THE ACTING SITE NEVER SCOPES THE DATASET — sent alone, as the console
 *     sends it, or beside an explicit org.
 *  2. A REFERENCE RELINKS ONLY TO A DATASET VISIBLE EVERYWHERE THE NEW ONE IS.
 *     A reference to a dataset some sites cannot see resolves to nothing on
 *     those sites. Relinking used to consult the acting site's view, which
 *     offered datasets shared with that site alone to an org-wide dataset.
 *
 * The scope helpers are the REAL ones, so the stored `visibleTo` and the
 * relink choice are what the route computed rather than what a stub returned.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  createResourceUid: () => 'ds-installed',
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  // An org-wide installer: the permission is not what this suite is about.
  resolveOrgPermissions: async (_uid: string, context: { orgId: string }) => ({
    orgId: context.orgId,
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
}))

jest.mock('./provenance', () => ({
  recordInstallProvenance: async () => ({
    installedFrom: { sha256: 'sha' },
    baseStored: true,
  }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    /** host id → owning org, as `hostIndex` answers it. */
    hostIndex: {
      'host-a': 'org-1',
      'host-foreign': 'org-2',
    } as Record<string, string>,
    /** `orgs/{orgId}` documents. */
    orgs: {} as Record<string, Record<string, unknown>>,
    /** Datasets each org already holds. */
    existing: {} as Record<string, Array<Record<string, unknown>>>,
    /** Datasets created, with the org they were created under. */
    creates: [] as Array<{ orgId: string; data: Record<string, unknown> }>,
  }
  const orgRef = (orgId: string) => ({
    get: async () => ({
      exists: Boolean(state.orgs[orgId]),
      data: () => state.orgs[orgId],
    }),
    collection: () => ({
      get: async () => {
        const rows = state.existing[orgId] ?? []
        return {
          size: rows.length,
          docs: rows.map((row) => ({
            id: row['$id'],
            get: (field: string) => row[field],
          })),
        }
      },
      doc: () => ({
        create: async (data: Record<string, unknown>) => {
          state.creates.push({ orgId, data })
        },
      }),
    }),
  })
  const listingRef = {
    get: async () => ({
      data: () => ({
        artifactType: 'datasetSchema',
        displayName: 'Sessions',
        priceUsd: 0,
        profileId: 'publisher-org',
        latestVersion: 1,
      }),
    }),
    collection: () => ({
      doc: () => ({
        get: async () => ({
          get: (field: string) =>
            field === 'datasetSchema'
              ? {
                  order: ['title', 'speaker', 'venue'],
                  fields: {
                    title: { name: 'Title', type: 'text' },
                    speaker: {
                      name: 'Speaker',
                      type: 'reference',
                      reference: { datasetLabel: 'Speakers' },
                    },
                    venue: {
                      name: 'Venue',
                      type: 'reference',
                      reference: { datasetLabel: 'Venues' },
                    },
                  },
                }
              : undefined,
        }),
      }),
    }),
    update: async () => undefined,
  }
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) =>
        name === 'orgs'
          ? orgRef(id)
          : name === 'marketplaceListings'
            ? listingRef
            : { get: async () => ({ exists: false, data: () => undefined }) },
    }),
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'installer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => '__now__',
          increment: () => '__increment__',
        },
      },
    },
    getOrgForHost: async (hostId: string) => {
      const orgId = state.hostIndex[hostId]
      return orgId ? { orgId, org: state.orgs[orgId] } : null
    },
  }
})

import { installDatasetSchemaHandler } from './install-dataset-schema'

const { __state: state } = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: {
    orgs: Record<string, Record<string, unknown>>
    existing: Record<string, Array<Record<string, unknown>>>
    creates: Array<{ orgId: string; data: Record<string, unknown> }>
  }
}

async function install(body: Record<string, unknown>) {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  await installDatasetSchemaHandler(
    {
      method: 'POST',
      body: { listingId: 'listing-1', ...body },
      headers: { authorization: 'Bearer token' },
    } as any,
    res,
  )
  return res as { statusCode: number; body: any }
}

beforeEach(() => {
  state.creates.length = 0
  state.existing = {}
  // Both orgs chose "Only the site they were created in" — the setting under
  // which honoring the acting site would narrow the dataset.
  state.orgs = {
    'org-1': { plan: 'pro', defaultResourceScope: 'host' },
    'org-2': { plan: 'pro', defaultResourceScope: 'host' },
  }
})

describe('the acting site never scopes an installed dataset', () => {
  it('lands on All sites when only the site is sent — the Marketplace shape', async () => {
    const res = await install({ hostId: 'host-a' })

    expect(res.statusCode).toBe(200)
    expect(state.creates).toHaveLength(1)
    // The site still finds the org.
    expect(state.creates[0].orgId).toBe('org-1')
    // Red before the fix: ['host:host-a'], the org's first site alone.
    expect(state.creates[0].data['visibleTo']).toEqual(['org'])
  })

  it('lands on All sites when the org is named beside a site', async () => {
    const res = await install({ orgId: 'org-1', hostId: 'host-a' })

    expect(res.statusCode).toBe(200)
    expect(state.creates[0].data['visibleTo']).toEqual(['org'])
  })

  it("cannot be scoped to another org's site named beside the org", async () => {
    const res = await install({ orgId: 'org-1', hostId: 'host-foreign' })

    expect(res.statusCode).toBe(200)
    expect(state.creates[0].orgId).toBe('org-1')
    expect(state.creates[0].data['visibleTo']).toEqual(['org'])
  })

  it('lands on All sites with only the org named', async () => {
    const res = await install({ orgId: 'org-1' })

    expect(res.statusCode).toBe(200)
    expect(state.creates[0].data['visibleTo']).toEqual(['org'])
  })
})

describe('a reference relinks only to a dataset every site can see', () => {
  const referenceTarget = (fieldId: string) => {
    const field = (state.creates[0].data['model'] as any).fields[fieldId]
    return field.type === 'reference' ? field.reference.datasetId : null
  }

  it('relinks to an org-wide dataset and degrades one shared with the acting site alone', async () => {
    state.existing['org-1'] = [
      { $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['org'] },
      // Visible to the acting site, so the old relink offered it — to a
      // dataset every other site can see, where the reference would resolve
      // to nothing.
      { $id: 'ds-venues', displayName: 'Venues', visibleTo: ['host:host-a'] },
    ]
    const res = await install({ hostId: 'host-a' })

    expect(res.statusCode).toBe(200)
    expect(referenceTarget('speaker')).toBe('ds-speakers')
    expect(referenceTarget('venue')).toBeNull()
    // And the installer is told, as the route always told them.
    expect(res.body.degradedFieldIds).toEqual(['venue'])
  })

  it('prefers the org-wide dataset when a restricted one shares its name', async () => {
    state.existing['org-1'] = [
      { $id: 'ds-speakers-internal', displayName: 'Speakers', visibleTo: ['host:host-a'] },
      { $id: 'ds-speakers', displayName: 'Speakers', visibleTo: ['org'] },
    ]
    const res = await install({ hostId: 'host-a' })

    expect(res.statusCode).toBe(200)
    expect(referenceTarget('speaker')).toBe('ds-speakers')
  })

  it('never relinks to a dataset with no sharing stored', async () => {
    // Visible to no site at all, so it covers nothing.
    state.existing['org-1'] = [{ $id: 'ds-speakers', displayName: 'Speakers' }]
    const res = await install({ orgId: 'org-1' })

    expect(res.statusCode).toBe(200)
    expect(referenceTarget('speaker')).toBeNull()
    expect(res.body.degradedFieldIds).toEqual(['speaker', 'venue'])
  })
})
