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

/** The entries the carry filed on the contact's timeline (AGL-3274), by path. */
const filed = (): Array<Record<string, any>> =>
  [...docs.entries()]
    .filter(([path]) => path.startsWith('orgs/org-1/crmActivities/'))
    .map(([path, data]) => ({ path, ...data }))

/** A document reference: one read, and an update that applies the two sentinels at a dotted path. */
const docRef = (path: string): any => ({
  path,
  collection: (sub: string) => ({
    doc: (id: string) => docRef(`${path}/${sub}/${id}`),
  }),
  get: async () => ({
    exists: docs.has(path),
    data: () => docs.get(path),
    get: (field: string) => docs.get(path)?.[field],
  }),
  // A keyed entry is written once: the second create finds the first.
  create: async (value: Record<string, unknown>) => {
    if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
    docs.set(path, { ...value })
  },
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
  getAll: async (...refs: Array<{ path: string }>) => Promise.all(refs.map((ref) => docRef(ref.path).get())),
}

// The record's activity ceiling (AGL-3274), never reached here.
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({
  __esModule: true,
  countCrmActivitiesForRecord: async () => 0,
}))

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

/*
 * A lead is read through the seam now (AGL-3275), which prefers the org row
 * and falls back to a site row the backfill has not reached. This file's
 * subject is what a CONVERSION carries across, so the double reads the same
 * fake by the org path and leaves the fallback to `org-leads.spec.ts`.
 */
jest.mock('@aglyn/tenant-data-admin/server/org-leads', () => ({
  __esModule: true,
  readLeadForHost: async (_hostId: string, leadId: string) => {
    const path = `orgs/org-1/leads/${leadId}`
    return docs.has(path)
      ? { exists: true, data: () => docs.get(path), get: (f: string) => docs.get(path)?.[f] }
      : null
  },
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
    docs.set('orgs/org-1/leads/lead-key', {
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

  it('files "Filed under" on the contact per campaign carried, by the conversion, once across runs (AGL-3274)', async () => {
    docs.set('hosts/site-1/emailCampaigns/founder-icp2', { name: 'Founder · ICP 2' })
    docs.set('orgs/org-1/leads/lead-key', { campaignIds: ['founder-icp2', 'gone'] })
    docs.set('orgs/org-1/contacts/c-1', { facets: {} })
    await carryLeadCampaignsToContact(firestore, request)
    const entries = filed()
    expect(entries.map((entry) => entry.body).sort()).toEqual(['Filed under Founder · ICP 2', 'Filed under gone'])
    expect(entries[0]).toMatchObject({
      kind: 'note',
      contactId: 'c-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      byUid: '',
      byName: 'Lead conversion',
      sourcePluginId: 'crm',
    })
    expect(entries.map((entry) => entry.campaignId).sort()).toEqual(['founder-icp2', 'gone'])
    // A door that converts twice files once: the keyed create finds its own.
    await carryLeadCampaignsToContact(firestore, request)
    expect(filed()).toHaveLength(2)
  })

  it('writes nothing on the contact for a lead in no campaign, or one that is gone', async () => {
    docs.set('orgs/org-1/leads/lead-key', { email: 'dana@example.com' })
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: 0,
    })
    docs.delete('orgs/org-1/leads/lead-key')
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: 0,
    })
    expect(updates).toEqual([])
  })

  it('the conversion seam’s entry resolves the Admin SDK’s Firestore itself', async () => {
    docs.set('orgs/org-1/leads/lead-key', { campaignIds: ['founder-icp2'] })
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
    docs.set('orgs/org-1/leads/lead-key', { campaignIds: ['founder-icp2'] })
    failUpdate = true
    expect(await carryLeadCampaignsToContact(firestore, request)).toEqual({
      campaigns: null,
    })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
