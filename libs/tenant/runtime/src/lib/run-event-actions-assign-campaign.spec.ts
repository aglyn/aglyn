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
 *  3. **It writes inside the site's own facet.** A contact row is shared by
 *     every site in the org. Written at the top of the document, one
 *     merchant's segmentation of a person would be readable by every other
 *     site in an agency's account — the disclosure the facets exist to end.
 */

const HOST_ID = 'site-1'
const GROUP_ID = 'group-1'

/** Actions returned by the trigger query. */
let mockActions: { id: string; data: Record<string, any> }[] = []
/** `hosts/{id}/emailCampaigns` — the containers this site holds. */
let mockCampaigns: Record<string, Record<string, any>> = {}
/** Every `update()` the run made on the contact, in order. */
let contactUpdates: Record<string, any>[] = []
/** Everything added to `hosts/{id}/activity`. */
let mockActivity: Record<string, any>[] = []
/** Whether the org holds a contact for the payload address at all. */
let contactExists = true
/** The one contact the org holds, when it holds one. */
let mockContactData: Record<string, any> = {}
/** `orgs/{org}/emailIndex/{personKey}` → `{ email, contactId }` (AGL-2625). */
let mockEmailIndex: Record<string, Record<string, any>> = {}

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

/**
 * The contact the run finds, and the writes it makes on it.
 *
 * `update` rather than `set`, because a dotted field path is a PATH to
 * `update()` and a literal key with dots in it to `set()`. A double that
 * offered both would let a write of the wrong shape pass.
 */
const contactRef = {
  update: async (patch: Record<string, any>) => {
    contactUpdates.push(patch)
  },
}

const collectionHandle = (path: string): any => {
  const query = (matcher: (data: Record<string, any>) => boolean): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query(
        (data) =>
          field.split('.').reduce<any>((node, key) => node?.[key], data) ===
          value,
      ),
    limit: () => query(matcher),
    get: async () => {
      if (path.endsWith('actions')) {
        return {
          docs: mockActions.map((entry) => docSnapshot(entry.id, entry.data)),
          empty: mockActions.length === 0,
        }
      }
      if (path.endsWith('emailCampaigns')) {
        const docs = Object.entries(mockCampaigns)
          .filter(([, data]) => matcher(data))
          .map(([id, data]) => docSnapshot(id, data))
        return { docs, empty: docs.length === 0 }
      }
      if (path.endsWith('contacts')) {
        // Matched on the address, as the real query is: a double that
        // answered the contact for any address could never show an
        // alternate address being resolved.
        const docs =
          contactExists && matcher(mockContactData)
            ? [{ ...docSnapshot('contact-1', mockContactData), ref: contactRef }]
            : []
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
        path.endsWith('emailCampaigns') && mockCampaigns[id]
          ? docSnapshot(id, mockCampaigns[id] as Record<string, any>)
          : path.endsWith('contacts') && contactExists && id === 'contact-1'
            ? { ...docSnapshot(id, mockContactData), ref: contactRef }
            : path.endsWith('emailIndex') && mockEmailIndex[id]
              ? docSnapshot(id, mockEmailIndex[id])
              : { id, exists: false, data: () => undefined, get: () => undefined },
      set: async (data: Record<string, any>) => {
        if (path.endsWith('emailIndex')) {
          mockEmailIndex[id] = { ...(mockEmailIndex[id] ?? {}), ...data }
        }
      },
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
  // `{ ref, query }`, the shape the helper answers with: the run destructures
  // the scoped QUERY off it, and a double handing back a bare collection
  // would fail before the branch under test ever ran.
  orgDataQueryForHost: async () => ({
    ref: collectionHandle('orgs/o1/contacts'),
    query: collectionHandle('orgs/o1/contacts'),
  }),
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

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { CAMPAIGN_MEMBERSHIP_FIELD } from '@aglyn/aglyn/server'
import { runEventActions } from './run-event-actions'

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
  contactUpdates = []
  contactExists = true
  // Scoped to the org, as a stamped contact is: the lookup narrows to what
  // the site may see, and a row with no `visibleTo` is visible to nobody.
  mockContactData = { email: 'ada@example.com', visibleTo: ['org'] }
  mockEmailIndex = {}
  mockCampaigns = { 'spring-2026': { name: 'Spring sale' } }
})

describe('assigning a contact to a campaign', () => {
  it('files them under the campaign named by id', async () => {
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(contactUpdates).toHaveLength(1)
    expect(
      contactUpdates[0][`facets.${GROUP_ID}.${CAMPAIGN_MEMBERSHIP_FIELD}`],
    ).toEqual({ __arrayUnion: ['spring-2026'] })
    expect(mockActivity[0].result).toBe('succeeded')
  })

  it('stores the ID for a step that names the campaign by NAME', async () => {
    // The control for property (1). A run that stored `step.campaignName`
    // would put "Spring sale" into an array of ids.
    mockActions = [assigning({ campaignName: 'Spring sale' })]

    await run()

    expect(
      contactUpdates[0][`facets.${GROUP_ID}.${CAMPAIGN_MEMBERSHIP_FIELD}`],
    ).toEqual({ __arrayUnion: ['spring-2026'] })
  })

  it('adds to the campaigns already on the record', async () => {
    // `arrayUnion`, so a person filed under the spring push stays filed under
    // it when the summer automation reaches them.
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    const patch =
      contactUpdates[0][`facets.${GROUP_ID}.${CAMPAIGN_MEMBERSHIP_FIELD}`]
    expect(patch).toHaveProperty('__arrayUnion')
  })

  it('writes inside the site’s facet, never at the top of the document', async () => {
    // The control for property (3).
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(Object.keys(contactUpdates[0])).toContain(
      `facets.${GROUP_ID}.${CAMPAIGN_MEMBERSHIP_FIELD}`,
    )
    expect(Object.keys(contactUpdates[0])).not.toContain('campaigns')
    expect(Object.keys(contactUpdates[0])).not.toContain(
      CAMPAIGN_MEMBERSHIP_FIELD,
    )
  })
})

describe('finding the person (AGL-2633)', () => {
  it('files the survivor when the event carries an address a merge folded in', async () => {
    mockContactData['alternateEmails'] = ['ada@gmail.com']
    mockEmailIndex[personKey('ada@gmail.com')!] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run('ada@gmail.com')

    expect(contactUpdates).toHaveLength(1)
    expect(contactUpdates[0][`facets.${GROUP_ID}.${CAMPAIGN_MEMBERSHIP_FIELD}`]).toEqual({
      __arrayUnion: ['spring-2026'],
    })
  })

  it('reports an alternate whose survivor this site cannot see as no contact', async () => {
    mockContactData['visibleTo'] = ['host:other-site']
    mockContactData['alternateEmails'] = ['ada@gmail.com']
    mockEmailIndex[personKey('ada@gmail.com')!] = {
      email: 'ada@gmail.com',
      contactId: 'contact-1',
    }
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run('ada@gmail.com')

    expect(contactUpdates).toHaveLength(0)
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

    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('unknown campaign "Autumn sale"')
  })

  it('reports an id that names no campaign', async () => {
    mockActions = [assigning({ campaignId: 'never-existed' })]

    await run()

    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
  })

  it('reports an address the org holds no contact for', async () => {
    contactExists = false
    mockActions = [assigning({ campaignId: 'spring-2026' })]

    await run()

    expect(contactUpdates).toHaveLength(0)
    expect(mockActivity[0].result).toBe('failed')
    expect(mockActivity[0].action).toContain('no contact for')
  })
})
