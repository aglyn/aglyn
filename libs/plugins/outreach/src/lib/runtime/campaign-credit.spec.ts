/**
 * @jest-environment node
 *
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
 * What a lead's conversion credits, and under which organization.
 *
 * The sequences report is the org's (`orgs/{orgId}/campaignSequenceReports`),
 * so a credit names the org whenever the caller holds it. The conversion seam
 * is handed the org with the lead, so it passes it on rather than leaving the
 * platform to look the site up once per enrollment.
 */

import type { OutreachCampaignCredit } from './runtime-deps'
import { creditOutreachLeadConversion } from './campaign-credit'

const ORG = 'org-1'
const HOST = 'site-1'
const AT = Date.UTC(2026, 8, 23, 15, 0)

/** `orgs/{orgId}/outreachEnrollments`, as rows the lead query answers. */
let enrollments: Array<{ id: string; data: Record<string, unknown> }> = []
let queried: Array<{ path: string; field: string; value: unknown }> = []
let credits: Array<Parameters<OutreachCampaignCredit['credit']>[0]> = []

const firestore = {
  collection: (root: string) => ({
    doc: (orgId: string) => ({
      collection: (name: string) => ({
        where: (field: string, _op: string, value: unknown) => ({
          get: async () => {
            queried.push({ path: `${root}/${orgId}/${name}`, field, value })
            return {
              docs: enrollments
                .filter((row) => row.data[field] === value)
                .map((row) => ({ id: row.id, data: () => row.data })),
            }
          },
        }),
      }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

const deps = {
  firestore: () => firestore,
  now: () => AT,
  campaignCredit: {
    credit: async (input: Parameters<OutreachCampaignCredit['credit']>[0]) => {
      credits.push(input)
    },
  } as unknown as OutreachCampaignCredit,
}

beforeEach(() => {
  queried = []
  credits = []
  enrollments = [
    { id: 'seq-1_lead-a', data: { sequenceId: 'seq-1', leadId: 'lead-a', hostId: HOST, campaignIds: ['c1', 'c2'] } },
    // Another site's enrollment of the same person: converted there, not here.
    { id: 'seq-2_lead-a', data: { sequenceId: 'seq-2', leadId: 'lead-a', hostId: 'site-2', campaignIds: ['c3'] } },
    // In no campaign: nothing to credit, silently.
    { id: 'seq-3_lead-a', data: { sequenceId: 'seq-3', leadId: 'lead-a', hostId: HOST, campaignIds: [] } },
  ]
})

describe('creditOutreachLeadConversion', () => {
  it('credits `converted` to this site’s enrollments’ campaigns, under the org it was handed', async () => {
    const credited = await creditOutreachLeadConversion(deps, { orgId: ORG, hostId: HOST, leadId: 'lead-a' })

    expect(credited).toBe(1)
    expect(queried[0]).toMatchObject({ path: `orgs/${ORG}/outreachEnrollments`, field: 'leadId', value: 'lead-a' })
    expect(credits).toEqual([
      { hostId: HOST, orgId: ORG, campaignIds: ['c1', 'c2'], outcome: 'converted', atMs: AT },
    ])
  })
})
