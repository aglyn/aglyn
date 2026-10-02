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
 * The creditor names a touch and a record's campaigns for a door's alert
 * (AGL-3461): what the outcome was CREDITED to, how the visitor was touched,
 * and what the record is FILED under — by name, read from the campaigns as
 * they stand, and never a campaign that has since been deleted.
 */

/** The Firestore the creditor's Admin SDK hands out, set per case. */
let mockDb: unknown = null

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host1' ? 'org1' : null),
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockDb }) },
}))

import { marketingConversionCreditor } from './conversion-creditor'

const HOST = 'host1'
const ORG = 'org1'

/** Keyed reads only: everything a description needs. */
function fakeFirestore(seed: Record<string, Record<string, unknown>>) {
  const doc = (path: string): any => ({
    get: async () => ({
      exists: path in seed,
      id: path.split('/').pop(),
      data: () => seed[path],
    }),
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string): any => ({ doc: (id: string) => doc(`${path}/${id}`) })
  return { collection }
}

function describeWith(
  seed: Record<string, Record<string, unknown>>,
  request: Record<string, unknown>,
) {
  mockDb = fakeFirestore(seed)
  return marketingConversionCreditor.describeConversion?.({ hostId: HOST, ...request })
}

const CAMPAIGNS = {
  [`orgs/${ORG}/emailCampaigns/camp_ai`]: { name: 'One job — AI' },
  [`orgs/${ORG}/emailCampaigns/camp_form`]: { name: 'Forms' },
  [`orgs/${ORG}/emailCampaigns/camp_gone`]: { name: 'Retired', deletedAt: 1 },
}

describe('describeConversion', () => {
  it('names the campaign a PAGE touch credits, and the page that touched them', async () => {
    const described = await describeWith(CAMPAIGNS, {
      touch: { channel: 'page', campaignId: 'camp_ai', path: '/ai-website-draft', touchedAtMs: 1 },
    })

    expect(described).toEqual({
      credited: {
        label: 'One job — AI',
        how: 'viewed /ai-website-draft, a page filed under it',
        containerId: 'camp_ai',
      },
      filedUnder: [],
    })
  })

  it('names what the record is FILED under, in the order asked, leaving out the deleted', async () => {
    const described = await describeWith(CAMPAIGNS, {
      containerIds: ['camp_form', 'camp_gone', 'camp_ai', 'camp_form'],
    })

    expect(described).toEqual({
      filedUnder: [
        { id: 'camp_form', label: 'Forms' },
        { id: 'camp_ai', label: 'One job — AI' },
      ],
    })
  })

  it('an EMAIL touch names the campaign its send is in', async () => {
    const described = await describeWith(
      {
        ...CAMPAIGNS,
        [`orgs/${ORG}/campaigns/send_1`]: { subject: 'Launch day', emailCampaignId: 'camp_ai' },
      },
      { touch: { channel: 'email', campaignId: 'send_1', touchedAtMs: 1 } },
    )

    expect(described?.credited).toEqual({
      label: 'One job — AI',
      how: 'clicked one of its emails',
      containerId: 'camp_ai',
    })
  })

  it('a send in no campaign is named by its subject, with nothing to link', async () => {
    const described = await describeWith(
      { [`orgs/${ORG}/campaigns/send_1`]: { subject: 'Launch day' } },
      { touch: { channel: 'email', campaignId: 'send_1', touchedAtMs: 1 } },
    )

    expect(described?.credited).toEqual({ label: 'Launch day', how: 'clicked one of its emails' })
  })

  it('a label no campaign declares is named as the labels it is', async () => {
    const described = await describeWith(CAMPAIGNS, {
      touch: { channel: 'web', source: 'google', campaign: 'sept', touchedAtMs: 1 },
    })

    expect(described?.credited).toEqual({
      label: 'google / sept',
      how: 'followed a link labeled sept',
    })
  })

  it('a label a campaign declares is named as that campaign', async () => {
    const described = await describeWith(CAMPAIGNS, {
      touch: { channel: 'web', campaignId: 'camp_ai', campaign: 'onejob-ai', touchedAtMs: 1 },
    })

    expect(described?.credited).toMatchObject({ label: 'One job — AI', containerId: 'camp_ai' })
  })

  it('answers null with nothing to name', async () => {
    expect(await describeWith(CAMPAIGNS, {})).toBe(null)
  })
})
