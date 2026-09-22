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
 * The campaigns a lead was filed under go onto the contact's facet for the
 * capturing site (AGL-3254), beside what the contact already carried there;
 * a lead in no campaign writes nothing; a write that fails is reported as
 * unmeasured, never thrown.
 */

const docs = new Map<string, Record<string, any>>()
const updates: Array<{ path: string; patch: Record<string, unknown> }> = []
let failUpdate = false

/** A document reference: one read, and an update that applies the two sentinels at a dotted path. */
const docRef = (path: string): any => ({
  path,
  collection: (sub: string) => ({
    doc: (id: string) => docRef(`${path}/${sub}/${id}`),
  }),
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  update: async (patch: Record<string, unknown>) => {
    if (failUpdate) throw new Error('refused')
    const next = { ...(docs.get(path) ?? {}) }
    for (const [field, value] of Object.entries(patch)) {
      const parts = field.split('.')
      let node: Record<string, any> = next
      for (const part of parts.slice(0, -1)) {
        node[part] = { ...(node[part] ?? {}) }
        node = node[part]
      }
      const leaf = parts[parts.length - 1]
      const union = (value as { __arrayUnion?: unknown[] } | null)?.__arrayUnion
      node[leaf] = union
        ? [
            ...(Array.isArray(node[leaf]) ? node[leaf] : []),
            ...union.filter((id) => !(node[leaf] ?? []).includes(id)),
          ]
        : value
    }
    docs.set(path, next)
    updates.push({ path, patch })
  },
})
const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
  }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

// The site's consent group, for the facet the campaigns land in: the site
// alone, which is what an unpooled site resolves to.
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  consentGroupForSite: async (hostId: string) => ({
    groupId: hostId,
    hostIds: [hostId],
  }),
}))

// The Admin SDK, for the listener-shaped entry: its Firestore is the same
// fake, so the wrapper is proven to write where the direct call writes.
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))

import {
  carryLeadCampaignsOnConversion,
  carryLeadCampaignsToContact,
} from './lead-campaign-carry'

const request = {
  orgId: 'org-1',
  hostId: 'site-1',
  leadId: 'lead-key',
  contactId: 'c-1',
}

beforeEach(() => {
  docs.clear()
  updates.length = 0
  failUpdate = false
})

describe('carryLeadCampaignsToContact', () => {
  it('adds the lead’s campaigns to the contact’s facet for the site, keeping what was there', async () => {
    docs.set('hosts/site-1/leads/lead-key', {
      email: 'dana@example.com',
      campaignIds: ['founder-icp2', 'founder-icp1'],
    })
    docs.set('orgs/org-1/contacts/c-1', {
      email: 'dana@example.com',
      facets: {
        'site-1': { tags: ['vip'], campaignIds: ['spring', 'founder-icp1'] },
      },
    })
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: 2,
    })
    expect(docs.get('orgs/org-1/contacts/c-1')?.['facets']).toEqual({
      'site-1': {
        tags: ['vip'],
        campaignIds: ['spring', 'founder-icp1', 'founder-icp2'],
      },
    })
    expect(updates.map((write) => write.path)).toEqual([
      'orgs/org-1/contacts/c-1',
    ])
  })

  it('writes nothing on the contact for a lead in no campaign, or one that is gone', async () => {
    docs.set('hosts/site-1/leads/lead-key', { email: 'dana@example.com' })
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: 0,
    })
    docs.delete('hosts/site-1/leads/lead-key')
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: 0,
    })
    expect(updates).toEqual([])
  })

  it('the conversion seam’s entry resolves the Admin SDK’s Firestore itself', async () => {
    docs.set('hosts/site-1/leads/lead-key', { campaignIds: ['founder-icp2'] })
    docs.set('orgs/org-1/contacts/c-1', { facets: {} })
    expect(await carryLeadCampaignsOnConversion(request)).toEqual({
      campaigns: 1,
    })
    expect(docs.get('orgs/org-1/contacts/c-1')?.['facets']).toEqual({
      'site-1': { campaignIds: ['founder-icp2'] },
    })
  })

  it('never throws: a write that fails is logged and reported as unmeasured', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    docs.set('hosts/site-1/leads/lead-key', { campaignIds: ['founder-icp2'] })
    failUpdate = true
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: null,
    })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
