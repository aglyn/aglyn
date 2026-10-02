/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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
 * FILING A PERSON UNDER A CAMPAIGN, FROM AN AUTOMATION.
 *
 * `assignCampaign` is the oldest writer of the contact→campaign edge, and it
 * has to agree with the console picker that now reads the same field. Three
 * properties, each of which is a way the two could disagree silently:
 *
 *  1. **It stores the campaign's ID, whichever the step names.** A step may
 *     carry an id or a name — the picker writes the id, an imported
 *     automation may carry only the name — and a run that stored whichever it
 *     held would put names into an array every reader resolves as ids: a chip
 *     that names nothing and matches no campaign the console can find.
 *  2. **An unknown campaign is an error.** The reference audit already
 *     reports a step pointing at a campaign that does not exist; a run that
 *     wrote the dangling string anyway would make that finding untrue the
 *     moment it fired, and would leave a value the campaign's own deletion
 *     could never clear.
 *  3. **It files the person the record system found, as this site holds
 *     them.** Where the filing lives on the person is the record system's
 *     (`plugin-person-records`, AGL-3080): a contact row is shared by every
 *     site in the org, and the CRM's own spec holds that the filing lands in
 *     the site's facet rather than at the top of the document.
 */

const HOST_ID = 'site-1'
const GROUP_ID = 'group-1'

/** Actions returned by the trigger query. */
let mockActions: { id: string; data: Record<string, any> }[] = []
/** `orgs/o1/emailCampaigns` — the containers the site's org holds. */
const CAMPAIGNS_PATH = 'orgs/o1/emailCampaigns'
let mockCampaigns: Record<string, Record<string, any>> = {}
/** Every filing the run asked the record system for, in order. */
let filings: PluginPersonFileRequest[] = []
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** Whether the org holds a contact for the payload address at all. */
let contactExists = true
/** The one contact the org holds, when it holds one. */
let mockContactData: Record<string, any> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const docSnapshot = (id: string, data: Record<string, any>) => ({
  id,
  exists: true,
  data: () => data,
  get: (field: string) =>
    field.split('.').reduce<any>((value, key) => value?.[key], data),
  ref: { collection: () => collectionHandle('nested') },
})

const collectionHandle = (path: string): any => {
  const query = (matcher: (data: Record<string, any>) => boolean): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query(
        (data) =>
          field.split('.').reduce<any>((node, key) => node?.[key], data) ===
          value,
      ),
    limit: () => query(matcher),
    // A projection reads the same documents; the double hands back whole ones.
    select: () => query(matcher),
    get: async () => {
      if (path.endsWith('actions')) {
        return {
          docs: mockActions.map((entry) => docSnapshot(entry.id, entry.data)),
          empty: mockActions.length === 0,
        }
      }
      if (path === CAMPAIGNS_PATH) {
        const docs = Object.entries(mockCampaigns)
          .filter(([, data]) => matcher(data))
          .map(([id, data]) => docSnapshot(id, data))
        return { docs, empty: docs.length === 0 }
      }
      return { docs: [], empty: true }
    },
  })
  return {
    ...query(() => true),
    // The org document a subcollection hangs off, so the address lookup can
    // find `emailIndex` beside `contacts` the way it does in production.
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath
        ? { collection: (name: string) => collectionHandle(`${parentPath}/${name}`) }
        : null
    },
    doc: (id: string) => ({
      id,
      get: async () =>
        path === CAMPAIGNS_PATH && mockCampaigns[id]
          ? docSnapshot(id, mockCampaigns[id] as Record<string, any>)
          : { id, exists: false, data: () => undefined, get: () => undefined },
      collection: (name: string) => collectionHandle(`${path}/${id}/${name}`),
    }),
    add: async (data: Record<string, any>) => {
      if (path.endsWith('activity')) mockActivity.push(data)
      return { id: 'new' }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => collectionHandle(name),
        // Keyed reads in one round trip, answered in the order asked, as the
        // SDK's `getAll` does.
        getAll: (...refs: Array<{ get: () => Promise<unknown> }>) =>
          Promise.all(refs.map((ref) => ref.get())),
      }),
    }),
  },
  // The site's consent group — the holder whose facet the write addresses.
  consentGroupForSite: async () => ({
    hostId: HOST_ID,
    groupId: GROUP_ID,
    name: null,
    hostIds: [HOST_ID],
    declared: false,
  }),
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => collectionHandle('orgs/o1/datasets'),
  resolveOrgIdForHost: async () => 'o1',
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  flowEmailRefusal: async () => null,
  enrollListMember: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async () => ({ sent: true }),
  sendFailureReason: () => null,
}))

import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { PluginPersonFileRequest } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { runEventActions } from './run-event-actions'
import { standInPersonRecords } from '../testing/stand-in-person-records'

/**
 * The record system, standing in: the contact the org holds, found by its
 * address or by an alternate one a merge folded in (AGL-2633), and only as a
 * site that may see it.
 */
function standInRecordSystem(): void {
  filings = standInPersonRecords({
    find: (request) => {
      const email = String(request.email ?? '')
      const alternates: string[] = mockContactData['alternateEmails'] ?? []
      if (!contactExists || (mockContactData['email'] !== email && !alternates.includes(email))) {
        return null
      }
      if (request.onlyVisibleToSite && !visibleToHost(mockContactData['visibleTo'], String(request.hostId))) {
        return null
      }
      return { kind: 'contact', id: 'contact-1', email: mockContactData['email'], data: mockContactData }
    },
  }).filings
}

/** An action that always matches, carrying one `assignCampaign` step. */
const assigning = (step: Record<string, any>) => ({
  id: 'action-1',
  data: {
    name: 'File the lead',
    enabled: true,
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'assignCampaign', ...step }],
  },
})

const run = (email = 'ada@example.com') =>
  runEventActions(HOST_ID, 'formSubmission', { email })

beforeEach(() => {
  mockActions = []
  mockActivity = []
  contactExists = true
  // Scoped to the org, as a stamped contact is: the lookup narrows to what
  // the site may see, and a row with no `visibleTo` is visible to nobody.
  mockContactData = { email: 'ada@example.com', visibleTo: ['org'] }
  standInRecordSystem()
  mockCampaigns = { 'spring-2026': { name: 'Spring sale', visibleTo: ['org'] } }
})

describe('assigning a contact to a campaign', () => {
  it('files them under the campaign named by id', async () => {
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(filings).toHaveLength(1)
    expect(filings[0]?.ids).toEqual(['spring-2026'])
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('stores the ID for a step that names the campaign by NAME', async () => {
    // The control for property (1). A run that stored `step.campaignName`
    // would put "Spring sale" into an array of ids.
    mockActions = [assigning({ campaignName: 'Spring sale' })]

    await run()

    expect(filings[0]?.ids).toEqual(['spring-2026'])
  })

  it('files the person the record system found, as this site, under the campaign kind', async () => {
    // The control for property (3): the filing names the record the owner
    // handed back and the site it is filed as; where it lands on the person
    // is the owner's, held by the CRM's own spec.
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(filings).toEqual([
      {
        hostId: HOST_ID,
        orgId: 'o1',
        record: { kind: 'contact', id: 'contact-1' },
        containerKind: 'campaign',
        ids: ['spring-2026'],
      },
    ])
  })
})

describe('finding the person (AGL-2633)', () => {
  it('files the survivor when the event carries an address a merge folded in', async () => {
    mockContactData['alternateEmails'] = ['ada@gmail.com']
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run('ada@gmail.com')

    expect(filings).toHaveLength(1)
    expect(filings[0]?.ids).toEqual(['spring-2026'])
  })

  it('reports an alternate whose survivor this site cannot see as no contact', async () => {
    mockContactData['visibleTo'] = ['host:other-site']
    mockContactData['alternateEmails'] = ['ada@gmail.com']
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run('ada@gmail.com')

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no contact for ada@gmail.com')
  })
})

describe('what it refuses rather than storing', () => {
  it('reports a campaign this site does not have', async () => {
    // The control for property (2): the dangling name is an error, and
    // nothing is written.
    mockActions = [assigning({ campaignName: 'Autumn sale' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('unknown campaign "Autumn sale"')
  })

  it('reports an id that names no campaign', async () => {
    mockActions = [assigning({ campaignId: 'never-existed' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
  })

  it('reports an address the org holds no contact for', async () => {
    contactExists = false
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no contact for')
  })
})

describe('the organization’s campaigns, as this site sees them', () => {
  /*
   * The containers are the org's (`orgs/{orgId}/emailCampaigns`) and the run
   * is one site's, so the step honors what the site's picker offers: live
   * campaigns placed on this site. The double answers campaigns ONLY at the
   * org path, so every passing case above is also a proof of where the read
   * went.
   */
  it('files them under a campaign placed on this site alone', async () => {
    mockCampaigns = { 'site-push': { name: 'Site push', visibleTo: [`host:${HOST_ID}`] } }
    mockActions = [assigning({ campaignId: 'site-push' })]

    await run()

    expect(filings[0]?.ids).toEqual(['site-push'])
  })

  it('refuses a campaign placed only on a sibling site', async () => {
    mockCampaigns = { 'sibling-push': { name: 'Sibling push', visibleTo: ['host:site-2'] } }
    mockActions = [assigning({ campaignId: 'sibling-push' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('not placed on this site')
  })

  it('refuses a campaign nobody placed anywhere', async () => {
    // An absent `visibleTo` is no site at all — hiding is the recoverable
    // direction.
    mockCampaigns = { unplaced: { name: 'Unplaced' } }
    mockActions = [assigning({ campaignId: 'unplaced' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
  })

  it('refuses a campaign the console deleted', async () => {
    mockCampaigns = { gone: { name: 'Gone', visibleTo: ['org'], deletedAt: 1 } }
    mockActions = [assigning({ campaignId: 'gone' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('was deleted')
  })

  it('skips a deleted or sibling campaign sharing the name, and files the live one', async () => {
    mockCampaigns = {
      'old-spring': { name: 'Spring sale', visibleTo: ['org'], deletedAt: 1 },
      'sibling-spring': { name: 'Spring sale', visibleTo: ['host:site-2'] },
      'spring-2026': { name: 'Spring sale', visibleTo: ['org'] },
    }
    mockActions = [assigning({ campaignName: 'Spring sale' })]

    await run()

    expect(filings[0]?.ids).toEqual(['spring-2026'])
  })

  it('reports a name whose only match is deleted as unknown', async () => {
    mockCampaigns = { 'old-spring': { name: 'Spring sale', visibleTo: ['org'], deletedAt: 1 } }
    mockActions = [assigning({ campaignName: 'Spring sale' })]

    await run()

    expect(filings).toHaveLength(0)
    expect(mockActivity[0].action).toContain('unknown campaign "Spring sale"')
  })
})
