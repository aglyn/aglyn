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

import type { RealmPluginInstall } from '@aglyn/aglyn/plugin-manager/realm-plugins'
import { PLUGIN_CONNECTION_RECORDS_PROP } from '@aglyn/aglyn/app-utils/plugin-connection-records'
import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { registerMarketplaceDeclarations } from '../../declarations'
import {
  createConnectionRecordsEnricher,
  createConnectionVariableComputer,
  createPluginImageHostsSource,
  readSiteConnectionRecords,
  signedElementOwners,
  siteDeclaredImageHosts,
  type SiteConnectionRecordEntry,
} from './site-records'

/**
 * What a published site shows of its plugins' declared connections
 * (AGL-4195): the records the page hands its signed elements, the variables
 * from their summary fields, and the image hosts the site's plugins declare.
 * Fixture records stand in for the sync (AGL-4194).
 */

const HOST = 'host-acme'
const REVIEWS_LISTING = 'listingReviews'
const EVENTS_LISTING = 'listingEvents'

const REVIEWS = {
  id: 'reviews',
  provider: 'google',
  label: 'Google Business Profile',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  scopes: ['business.manage'],
  apiHosts: ['mybusiness.example.com'],
  sync: {
    intervalHours: 6,
    requests: [{ id: 'reviews', method: 'GET', url: 'https://mybusiness.example.com/v4/reviews', itemsPath: 'reviews' }],
    record: {
      fields: {
        rating: { request: 'reviews', type: 'number', path: 'averageRating' },
        reviewCount: { request: 'reviews', type: 'number', path: 'totalReviewCount' },
      },
      items: {
        request: 'reviews',
        maxItems: 2,
        fields: { author: { type: 'string', path: 'reviewer.displayName', maxLength: 100 } },
      },
    },
  },
}

const EVENTS = {
  ...REVIEWS,
  id: 'events',
  label: 'Calendar',
  sync: {
    ...REVIEWS.sync,
    record: { fields: { nextEvent: { request: 'reviews', type: 'string', path: 'next', maxLength: 100 } } },
  },
}

const record = (listingId: string, connectionId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'record',
  listingId,
  connectionId,
  version: '1.0.0',
  syncedAtMs: 1_700_000_000_000,
  fields: {},
  items: [],
  ...extra,
})

let db: MemoryFirestore
let orgPlan = 'starter'
let orgReads = 0

const deps = () => ({
  firestore: db as unknown as FirebaseFirestore.Firestore,
  orgForHost: async (hostId: string) => {
    orgReads += 1
    return hostId === HOST ? { orgId: 'org-acme', org: { plan: orgPlan, subscription: { status: 'active' } } } : null
  },
})

beforeAll(() => {
  // The plan feature's defaults, as every app registers them at boot.
  registerMarketplaceDeclarations()
})

beforeEach(() => {
  db = createMemoryFirestore()
  orgPlan = 'starter'
  orgReads = 0
  db.docs.set(`hosts/${HOST}/installs/${REVIEWS_LISTING}`, {
    listingId: REVIEWS_LISTING,
    version: '1.0.0',
    manifest: { id: 'reviews-widget', connections: [REVIEWS] },
  })
  db.docs.set(`hosts/${HOST}/installs/${EVENTS_LISTING}`, {
    listingId: EVENTS_LISTING,
    version: '2.0.0',
    manifest: { id: 'events-widget', connections: [EVENTS] },
  })
  db.docs.set(
    `hosts/${HOST}/pluginConnections/record-${REVIEWS_LISTING}__reviews`,
    record(REVIEWS_LISTING, 'reviews', {
      fields: { rating: 4.8, reviewCount: 212, leaked: 'not declared' },
      items: [{ author: 'Sam', email: 'never shown' }, { author: 'Ada' }, { author: 'Third' }],
    }),
  )
  db.docs.set(
    `hosts/${HOST}/pluginConnections/record-${EVENTS_LISTING}__events`,
    record(EVENTS_LISTING, 'events', { fields: { nextEvent: 'Open house' } }),
  )
  // The connection itself sits beside its record and is never read as one.
  db.docs.set(`hosts/${HOST}/pluginConnections/${REVIEWS_LISTING}__reviews`, { kind: 'connection', listingId: REVIEWS_LISTING, connectionId: 'reviews' })
})

describe('readSiteConnectionRecords (AGL-4195)', () => {
  it('reads each record, held to what the pinned version declares', async () => {
    const entries = await readSiteConnectionRecords(deps(), HOST)
    const reviews = entries.find((entry) => entry.listingId === REVIEWS_LISTING)
    expect(reviews?.record).toEqual({
      fields: { rating: 4.8, reviewCount: 212 },
      items: [{ author: 'Sam' }, { author: 'Ada' }],
      syncedAtMs: 1_700_000_000_000,
    })
    expect(reviews?.variables).toEqual({
      [`${REVIEWS_LISTING}__reviews-rating`]: { name: `${REVIEWS_LISTING}__reviews-rating`, type: 'number', value: '4.8' },
      [`${REVIEWS_LISTING}__reviews-reviewCount`]: { name: `${REVIEWS_LISTING}__reviews-reviewCount`, type: 'number', value: '212' },
    })
    expect(entries.map((entry) => `${entry.listingId}/${entry.connectionId}`).sort()).toEqual([
      `${EVENTS_LISTING}/events`,
      `${REVIEWS_LISTING}/reviews`,
    ])
  })

  it('reads one query and nothing else for a site with no records', async () => {
    const empty = await readSiteConnectionRecords(deps(), 'host-none')
    expect(empty).toEqual([])
    expect(orgReads).toBe(0)
  })

  it('shows nothing on a plan without connections', async () => {
    orgPlan = 'free'
    expect(await readSiteConnectionRecords(deps(), HOST)).toEqual([])
  })

  it('drops the record of a plugin uninstalled, revoked, or no longer declaring the connection', async () => {
    db.docs.delete(`hosts/${HOST}/installs/${EVENTS_LISTING}`)
    db.docs.set(`revocations/${REVIEWS_LISTING}`, { versions: ['1.0.0'] })
    expect(await readSiteConnectionRecords(deps(), HOST)).toEqual([])
    // The same record shows again once the version is no longer revoked.
    db.docs.delete(`revocations/${REVIEWS_LISTING}`)
    expect((await readSiteConnectionRecords(deps(), HOST)).map((entry) => entry.listingId)).toEqual([REVIEWS_LISTING])
  })

  it('drops the record of a connection the pinned version no longer declares', async () => {
    db.docs.set(`hosts/${HOST}/installs/${REVIEWS_LISTING}`, {
      listingId: REVIEWS_LISTING,
      version: '1.1.0',
      manifest: { id: 'reviews-widget', connections: [{ ...EVENTS, id: 'other' }] },
    })
    expect((await readSiteConnectionRecords(deps(), HOST)).map((entry) => entry.listingId)).toEqual([EVENTS_LISTING])
  })

  it('refuses a record whose body names another connection than its id', async () => {
    db.docs.set(
      `hosts/${HOST}/pluginConnections/record-${REVIEWS_LISTING}__reviews`,
      record(EVENTS_LISTING, 'events', { fields: { nextEvent: 'smuggled' } }),
    )
    const entries = await readSiteConnectionRecords(deps(), HOST)
    expect(entries.filter((entry) => entry.listingId === EVENTS_LISTING)).toHaveLength(1)
    expect(entries.find((entry) => entry.listingId === REVIEWS_LISTING)).toBeUndefined()
  })
})

const install = (listingId: string, identity: string): RealmPluginInstall => ({
  listingId,
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  trust: 'realm',
  signature: 'sig',
  identity,
})

const INSTALLS = [install(REVIEWS_LISTING, 'acme.reviews'), install(EVENTS_LISTING, 'acme.reviews.events')]

const NODES = {
  root: { $id: 'root', componentId: 'MuiBox' },
  r1: { $id: 'r1', componentId: 'acme.reviews.badge' },
  e1: { $id: 'e1', componentId: 'acme.reviews.events.next' },
  stranger: { $id: 'stranger', componentId: 'someone.else.widget' },
}

describe('the page enricher (AGL-4195)', () => {
  const entries = async (): Promise<SiteConnectionRecordEntry[]> => readSiteConnectionRecords(deps(), HOST)

  it('hands each signed element its own listing’s records, keyed by node', async () => {
    const enrich = createConnectionRecordsEnricher({ realmInstalls: async () => INSTALLS, records: entries })
    const out = (await enrich({ hostId: HOST, host: {}, path: '/', slugSegments: [], nodes: NODES })) as Record<string, any>
    const data = out[PLUGIN_CONNECTION_RECORDS_PROP]
    expect(data.nodes).toEqual({ r1: REVIEWS_LISTING, e1: EVENTS_LISTING })
    expect(Object.keys(data.records[REVIEWS_LISTING])).toEqual(['reviews'])
    expect(Object.keys(data.records[EVENTS_LISTING])).toEqual(['events'])
  })

  it('attributes an element to the LONGEST namespace, so a prefix identity reads only its own', () => {
    // `acme.reviews.events.next` starts with `acme.reviews.` too.
    expect(signedElementOwners(NODES, INSTALLS)).toEqual({ r1: REVIEWS_LISTING, e1: EVENTS_LISTING })
  })

  it('ships no listing’s records for a page that places none of its elements', async () => {
    const enrich = createConnectionRecordsEnricher({ realmInstalls: async () => INSTALLS, records: entries })
    const out = (await enrich({ hostId: HOST, host: {}, path: '/', slugSegments: [], nodes: { r1: NODES.r1 } })) as Record<string, any>
    expect(Object.keys(out[PLUGIN_CONNECTION_RECORDS_PROP].records)).toEqual([REVIEWS_LISTING])
  })

  it('reads nothing at all on a page with no marketplace element', async () => {
    const realmInstalls = jest.fn(async () => INSTALLS)
    const records = jest.fn(entries)
    const enrich = createConnectionRecordsEnricher({ realmInstalls, records })
    expect(await enrich({ hostId: HOST, host: {}, path: '/', slugSegments: [], nodes: { root: NODES.root } })).toBeUndefined()
    expect(await enrich({ hostId: HOST, host: {}, path: '/', slugSegments: [] })).toBeUndefined()
    expect(realmInstalls).not.toHaveBeenCalled()
    expect(records).not.toHaveBeenCalled()
  })

  it('contributes nothing when the page’s elements have no records', async () => {
    const enrich = createConnectionRecordsEnricher({ realmInstalls: async () => INSTALLS, records: async () => [] })
    expect(await enrich({ hostId: HOST, host: {}, path: '/', slugSegments: [], nodes: NODES })).toBeUndefined()
  })
})

describe('the variable computer (AGL-4195)', () => {
  it('adds each record’s summary fields beside the site’s own variables, replacing none', async () => {
    const computer = createConnectionVariableComputer({ records: () => readSiteConnectionRecords(deps(), HOST) })
    const compute = await computer.prepare(HOST)
    const own = { abc123: { name: 'phone', type: 'text' as const, value: '555' } }
    const out = compute({ variables: own, functions: {} })
    expect(out['abc123']).toBe(own.abc123)
    expect(out[`${REVIEWS_LISTING}__reviews-rating`]).toEqual({ name: `${REVIEWS_LISTING}__reviews-rating`, type: 'number', value: '4.8' })
    expect(out[`${EVENTS_LISTING}__events-nextEvent`]?.value).toBe('Open house')
    const clash = compute({ variables: { [`${REVIEWS_LISTING}__reviews-rating`]: { name: 'mine', type: 'text', value: 'kept' } }, functions: {} })
    expect(clash[`${REVIEWS_LISTING}__reviews-rating`]?.value).toBe('kept')
  })

  it('leaves a site with no records exactly as it was', async () => {
    const compute = await createConnectionVariableComputer({ records: async () => [] }).prepare(HOST)
    const variables = { a: { name: 'a', type: 'text' as const, value: '1' } }
    expect(compute({ variables, functions: {} })).toBe(variables)
  })
})

describe('the image hosts a site’s signed plugins declare (AGL-4195)', () => {
  const declared: Record<string, unknown> = {
    [REVIEWS_LISTING]: ['lh3.googleusercontent.com', '*.ggpht.com'],
    [EVENTS_LISTING]: ['*.*.evil.example.com'],
  }
  const imageDeps = (installs: RealmPluginInstall[]) => ({
    realmInstalls: async () => installs,
    declaredImageHosts: async (listingId: string) => declared[listingId],
  })

  it('names each valid declaration’s hosts, and none of a declaration that no longer validates', async () => {
    expect(await siteDeclaredImageHosts(imageDeps(INSTALLS), HOST)).toEqual(['lh3.googleusercontent.com', '*.ggpht.com'])
  })

  it('names nothing for a site that runs none of the plugins', async () => {
    const source = createPluginImageHostsSource((hostId) => siteDeclaredImageHosts(imageDeps(hostId === HOST ? INSTALLS : []), hostId))
    expect(await source.hosts({ hostId: HOST, orgId: 'org-acme' })).toEqual({ img: ['lh3.googleusercontent.com', '*.ggpht.com'] })
    expect(await source.hosts({ hostId: 'host-other', orgId: 'org-acme' })).toEqual({})
  })
})
