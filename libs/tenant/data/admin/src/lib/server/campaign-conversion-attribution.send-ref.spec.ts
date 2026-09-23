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
 * The lookup every link-driven reader goes through: the org first, the old
 * site location second, nothing third. The fallback is the part with
 * consequences — an unsubscribe or a bounce dropped in the migration window
 * is an address that gets mailed again — so it is asserted by path, against
 * a store that holds exactly the documents each case names.
 */

const resolveOrgIdForHost = jest.fn()
jest.mock('./organizations', () => ({
  resolveOrgIdForHost: (...args: unknown[]) => resolveOrgIdForHost(...args),
}))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => null }) },
}))

import type { Firestore } from 'firebase-admin/firestore'
import {
  orgCampaignSendRef,
  orgCampaignSequenceReportRef,
  resolveCampaignSendRef,
} from './campaign-conversion-attribution'

/** A path-only Firestore double: a document exists when its path is listed. */
function fakeFirestore(existing: string[]): { db: Firestore; reads: string[] } {
  const reads: string[] = []
  const docRef = (path: string): unknown => ({
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => {
      reads.push(path)
      return { exists: existing.includes(path) }
    },
  })
  const collectionRef = (path: string) => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return { db: { collection: collectionRef } as unknown as Firestore, reads }
}

beforeEach(() => resolveOrgIdForHost.mockReset())

it('builds the org paths', () => {
  const { db } = fakeFirestore([])
  expect(orgCampaignSendRef('org-1', 'send-1', db).path).toBe('orgs/org-1/campaigns/send-1')
  expect(orgCampaignSequenceReportRef('org-1', 'camp-1', db).path).toBe(
    'orgs/org-1/campaignSequenceReports/camp-1',
  )
})

it('answers the org document when it exists, without reading the site', async () => {
  const { db, reads } = fakeFirestore(['orgs/org-1/campaigns/send-1'])
  resolveOrgIdForHost.mockResolvedValue('org-1')
  const ref = await resolveCampaignSendRef({ hostId: 'host-1', sendId: 'send-1', firestore: db })
  expect(ref?.path).toBe('orgs/org-1/campaigns/send-1')
  expect(reads).toEqual(['orgs/org-1/campaigns/send-1'])
})

it('uses a carried org id instead of the host index', async () => {
  const { db } = fakeFirestore(['orgs/org-9/campaigns/send-1'])
  const ref = await resolveCampaignSendRef({
    hostId: 'host-1',
    sendId: 'send-1',
    orgId: 'org-9',
    firestore: db,
  })
  expect(ref?.path).toBe('orgs/org-9/campaigns/send-1')
  expect(resolveOrgIdForHost).not.toHaveBeenCalled()
})

it('falls back to the site document the migration has not reached', async () => {
  const { db, reads } = fakeFirestore(['hosts/host-1/campaigns/send-1'])
  resolveOrgIdForHost.mockResolvedValue('org-1')
  const ref = await resolveCampaignSendRef({ hostId: 'host-1', sendId: 'send-1', firestore: db })
  expect(ref?.path).toBe('hosts/host-1/campaigns/send-1')
  expect(reads).toEqual(['orgs/org-1/campaigns/send-1', 'hosts/host-1/campaigns/send-1'])
})

it('falls back to the site for a host the index does not know', async () => {
  const { db } = fakeFirestore(['hosts/host-1/campaigns/send-1'])
  resolveOrgIdForHost.mockResolvedValue(null)
  const ref = await resolveCampaignSendRef({ hostId: 'host-1', sendId: 'send-1', firestore: db })
  expect(ref?.path).toBe('hosts/host-1/campaigns/send-1')
})

it('answers null when neither location holds the send', async () => {
  const { db } = fakeFirestore([])
  resolveOrgIdForHost.mockResolvedValue('org-1')
  expect(await resolveCampaignSendRef({ hostId: 'host-1', sendId: 'gone', firestore: db })).toBeNull()
})

it('refuses an id that would address a different path', async () => {
  const { db, reads } = fakeFirestore([])
  expect(
    await resolveCampaignSendRef({ hostId: 'host-1', sendId: 'a/b', firestore: db }),
  ).toBeNull()
  expect(
    await resolveCampaignSendRef({ hostId: 'h/x', sendId: 'send-1', firestore: db }),
  ).toBeNull()
  expect(await resolveCampaignSendRef({ hostId: '', sendId: 'send-1', firestore: db })).toBeNull()
  expect(reads).toEqual([])
})
