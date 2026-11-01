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
 * The server's filing entries roll up like any activity (AGL-4123): the
 * record the entry is filed on names the company, through the holder of the
 * site it was filed from.
 */

const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({
  __esModule: true,
  countCrmActivitiesForRecord: async () => 0,
}))
jest.mock('@aglyn/tenant-data-admin/server/org-containers', () => ({
  __esModule: true,
  readOrgContainers: async () => [],
}))

import { fileCampaignFilingActivities } from './campaign-filing-activity'

const docRef = (path: string): Record<string, unknown> => ({
  id: path.split('/').pop(),
  get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
  create: async (data: Record<string, unknown>) => void mockDocs.set(path, data),
  collection: (name: string) => collectionRef(`${path}/${name}`),
})
const collectionRef = (path: string) => ({ doc: (id: string) => docRef(`${path}/${id}`) })
const firestore = { collection: collectionRef } as unknown as FirebaseFirestore.Firestore

const filed = () =>
  [...mockDocs.entries()].filter(([path]) => path.includes('/crmActivities/')).map(([, row]) => row)

describe('fileCampaignFilingActivities', () => {
  beforeEach(() => {
    mockDocs.clear()
    mockDocs.set('orgs/org-1', { plan: 'pro' })
  })

  const file = (link: Record<string, string>) =>
    fileCampaignFilingActivities(firestore, {
      orgId: 'org-1',
      hostId: 'site-1',
      link,
      action: 'filed',
      campaigns: [{ id: 'spring', name: 'Spring' }],
      atMs: 1_750_000_000_000,
      byUid: 'u-1',
    })

  it('rolls an entry on a contact up to the company the site files them under', async () => {
    mockDocs.set('orgs/org-1/contacts/c-1', { facets: { 'site-1': { companyId: 'co-1' } } })
    await expect(file({ contactId: 'c-1' })).resolves.toBe(1)
    expect(filed()).toEqual([
      expect.objectContaining({ contactId: 'c-1', companyId: 'co-1', campaignId: 'spring' }),
    ])
  })

  it('leaves an entry on a lead on the lead alone', async () => {
    await file({ leadId: 'l-1' })
    const [row] = filed()
    expect(row).toMatchObject({ leadId: 'l-1' })
    expect('companyId' in row).toBe(false)
  })
})
