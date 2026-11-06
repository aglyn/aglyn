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

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import {
  listPluginConsoleCrons,
  pluginConsoleCronScheduledJobs,
  resetPluginConsoleCronsForTests,
  runPluginConsoleCrons,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { registerMarketplaceDeclarations } from '../../declarations'
import { registerMarketplaceConsoleServerDeclarations } from '../../declarations.console-server'
import {
  PLUGIN_CONNECTIONS_API_ROUTES,
  pluginConnectionRecipients,
  pluginConnectionRecordDocId,
  type PluginConnectionRecordDoc,
} from '../../model/plugin-connections'
import { PLUGIN_CONNECTIONS_TOKEN_KEY_ENV } from './config'
import { pinConnections, reconcileListingConnections } from './cleanup'
import { newConnectionRecord, readConnection, type PluginConnectionRecord } from './connection-store'
import { saveCredentials, sealCredentials } from './credentials-store'
import { pluginConnectionRuntime } from './provider-http'
import { mapPluginConnectionField, mapPluginConnectionRecord, PLUGIN_CONNECTION_RECORD_MAX_BYTES } from './record-mapping'
import { disconnectRoute, syncNowRoute } from './routes'
import {
  PLUGIN_CONNECTION_SYNC_JOB_ID,
  PLUGIN_CONNECTION_SYNC_MAX_PER_TICK,
  pluginConnectionSyncBackoffMs,
  runConnectionSync,
  runPluginConnectionSyncJob,
} from './sync'

/**
 * The declared sync (AGL-4194): the console job that runs every due
 * connection's declared requests under the PINNED version, maps the answers
 * into the typed record, and records the outcome; "Sync now"; and the
 * clean-up when the plugin that declared a connection goes. Every provider
 * answer is a fake: nothing here leaves the process.
 */

const HOST = 'host-acme'
const FREE_HOST = 'host-free'
const LISTING = 'listing_Reviews-1'
const PUBLISHER_ORG = 'org-publisher'
const CONSOLE = 'https://app.example.com'
const NOW = Date.UTC(2026, 10, 6, 15)
const HOUR = 60 * 60 * 1000
const REVIEWS_URL = 'https://mybusiness.example.com/v4/accounts/1/locations/9/reviews'

const SYNC = {
  intervalHours: 6,
  requests: [
    {
      id: 'reviews',
      method: 'GET',
      url: 'https://mybusiness.example.com/v4/{{resource.accounts}}/{{resource.locations}}/reviews',
      itemsPath: 'reviews',
      pagination: { cursorPath: 'nextPageToken', cursorParam: 'pageToken', maxPages: 3 },
    },
  ],
  record: {
    fields: {
      averageRating: { request: 'reviews', type: 'number', path: 'averageRating' },
      total: { request: 'reviews', type: 'number', path: 'totalReviewCount' },
    },
    items: {
      request: 'reviews',
      maxItems: 5,
      fields: {
        reviewer: { type: 'string', path: 'reviewer.displayName', maxLength: 10 },
        photo: { type: 'url', path: 'reviewer.profilePhotoUrl', maxLength: 200 },
        rating: { type: 'number', path: 'starRating', map: { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } },
        createdAt: { type: 'datetime', path: 'createTime' },
      },
    },
  },
}

const CONNECTION = {
  id: 'reviews',
  provider: 'google',
  label: 'Google Business Profile',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  revocationUrl: 'https://oauth2.example.com/revoke',
  scopes: ['business.manage'],
  apiHosts: ['mybusiness.example.com'],
  resources: [
    {
      id: 'accounts',
      label: 'Account',
      request: { method: 'GET', url: 'https://mybusiness.example.com/v1/accounts', itemsPath: 'accounts' },
      idPath: 'name',
      labelPath: 'accountName',
    },
    {
      id: 'locations',
      label: 'Location',
      request: { method: 'GET', url: 'https://mybusiness.example.com/v1/{{resource.accounts}}/locations', itemsPath: 'locations' },
      idPath: 'name',
      labelPath: 'title',
    },
  ],
  sync: SYNC,
}

let db: MemoryFirestore
let clock = NOW
let keyring = parseSecretBoxKeyring(randomBytes(32).toString('base64'))

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email_verified: true },
}

const firebaseAdminFake = {
  app: () => ({
    firestore: () => db,
    auth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = TOKENS[token]
        if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' })
        return decoded
      },
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  getOrgForHost: async (hostId: string) => {
    if (hostId === 'host-acme') return { orgId: 'org-acme', org: { plan: 'starter', subscription: { status: 'active' } } }
    if (hostId === 'host-free') return { orgId: 'org-free', org: { plan: 'free' } }
    return null
  },
  logHostActivity: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

type Answer = { status: number; body: unknown }
let calls: Array<{ url: string; authorization: string | null }> = []
let tokenAnswer: Answer
/** The reviews endpoint, by page cursor (`''` for the first page). */
let reviewPages: Record<string, Answer>
/** Answers queued ahead of `reviewPages` for the reviews endpoint, one per call. */
let reviewQueue: Answer[]

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const authorization = new Headers(init.headers).get('authorization')
  calls.push({ url, authorization })
  if (url === 'https://oauth2.example.com/token') return json(tokenAnswer.status, tokenAnswer.body)
  if (url === 'https://oauth2.example.com/revoke') return json(200, {})
  const parsed = new URL(url)
  if (`${parsed.origin}${parsed.pathname}` === REVIEWS_URL) {
    const queued = reviewQueue.shift()
    if (queued) return json(queued.status, queued.body)
    const page = reviewPages[parsed.searchParams.get('pageToken') ?? '']
    return page ? json(page.status, page.body) : json(404, { error: { message: 'no such page' } })
  }
  return json(404, { error: { message: 'not found' } })
}

const review = (n: number, extra: Record<string, unknown> = {}) => ({
  reviewId: `r${n}`,
  reviewer: { displayName: `Reviewer ${n}`, profilePhotoUrl: `https://lh3.example.com/p${n}.jpg` },
  starRating: 'FIVE',
  createTime: '2026-11-01T12:00:00Z',
  ...extra,
})

const ENV_KEYS = [PLUGIN_CONNECTIONS_TOKEN_KEY_ENV]
const savedEnv: Record<string, string | undefined> = {}
const savedRuntime = { ...pluginConnectionRuntime }

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  registerMarketplaceDeclarations()
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  Object.assign(pluginConnectionRuntime, savedRuntime)
})

const pin = (manifest: Record<string, unknown> = { connections: [CONNECTION] }, version = '1.0.0') => ({
  listingId: LISTING,
  displayName: 'Reviews widget',
  version,
  manifest: { id: 'reviews-widget', name: 'Reviews widget', version, ...manifest },
})

/** A connected site with both resources chosen, its access token good for an hour. */
function seedConnection(hostId = HOST, overrides: Partial<PluginConnectionRecord> = {}): PluginConnectionRecord {
  const record = {
    ...newConnectionRecord({
      keyring,
      hostId,
      orgId: hostId === HOST ? 'org-acme' : 'org-free',
      listingId: LISTING,
      connection: CONNECTION as never,
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAtMs: clock + HOUR, scopes: ['business.manage'] },
      uid: 'uid-admin',
      nowMs: clock,
      previous: null,
    }),
    choices: { accounts: { id: 'accounts/1', label: 'Acme' }, locations: { id: 'locations/9', label: 'Main Street' } },
    nextSyncAtMs: clock,
    ...overrides,
  }
  db.docs.set(`hosts/${hostId}/pluginConnections/${LISTING}__reviews`, JSON.parse(JSON.stringify(record)))
  return record
}

const connectionDoc = (hostId = HOST) =>
  readConnection(db.docs.get(`hosts/${hostId}/pluginConnections/${LISTING}__reviews`)) as PluginConnectionRecord
const recordDoc = (hostId = HOST) =>
  db.docs.get(`hosts/${hostId}/pluginConnections/${pluginConnectionRecordDocId(LISTING, 'reviews')}`) as
    | PluginConnectionRecordDoc
    | undefined
const apiCalls = () => calls.filter((call) => call.url.startsWith('https://mybusiness.example.com/'))

beforeEach(async () => {
  db = createMemoryFirestore()
  clock = NOW
  calls = []
  reviewQueue = []
  tokenAnswer = { status: 200, body: { access_token: 'access-2', expires_in: 3600, scope: 'business.manage' } }
  reviewPages = {
    '': { status: 200, body: { averageRating: 4.8, totalReviewCount: 2, reviews: [review(1), review(2)] } },
  }
  const key = randomBytes(32).toString('base64')
  keyring = parseSecretBoxKeyring(key)
  process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV] = key
  Object.assign(pluginConnectionRuntime, { fetch: fakeFetch, now: () => clock, sleep: async () => undefined })
  for (const hostId of [HOST, FREE_HOST]) {
    db.docs.set(`hosts/${hostId}`, { orgId: hostId === HOST ? 'org-acme' : 'org-free', memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor' } })
    db.docs.set(`hosts/${hostId}/installs/${LISTING}`, pin())
  }
  db.docs.set(`marketplaceListings/${LISTING}`, { profileId: PUBLISHER_ORG, latestVersion: '1.0.0' })
  db.docs.set(`marketplaceListings/${LISTING}/pluginVersions/1.0.0`, { version: '1.0.0', manifest: pin().manifest })
  await saveCredentials(
    db as never,
    sealCredentials(keyring, {
      orgId: PUBLISHER_ORG,
      listingId: LISTING,
      connectionId: 'reviews',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      uid: 'uid-publisher',
      nowMs: NOW,
    }),
  )
})

const tick = () => runPluginConnectionSyncJob({ nowMs: clock, deadlineMs: clock + 5 * 60 * 1000 })

/* ------------------------------------------------------------------ */

describe('mapping a sync’s answers into the record (AGL-4194)', () => {
  const field = (type: string, extra: Record<string, unknown> = {}) => ({ type, path: 'v', ...extra }) as never

  it('cuts a string to its maxLength and coerces numbers, booleans and dates', () => {
    expect(mapPluginConnectionField(field('string', { maxLength: 3 }), { v: 'abcdef' })).toBe('abc')
    expect(mapPluginConnectionField(field('string', { maxLength: 5 }), { v: 42 })).toBe('42')
    expect(mapPluginConnectionField(field('number'), { v: '4.5' })).toBe(4.5)
    expect(mapPluginConnectionField(field('number'), { v: 'many' })).toBeNull()
    expect(mapPluginConnectionField(field('boolean'), { v: 'true' })).toBe(true)
    expect(mapPluginConnectionField(field('datetime'), { v: '2026-11-01T12:00:00Z' })).toBe(Date.UTC(2026, 10, 1, 12))
    expect(mapPluginConnectionField(field('datetime'), { v: 'yesterday' })).toBeNull()
  })

  it('keeps only an https url that fits whole, never one with credentials or another scheme', () => {
    expect(mapPluginConnectionField(field('url', { maxLength: 40 }), { v: 'https://a.example.com/x.jpg' })).toBe('https://a.example.com/x.jpg')
    expect(mapPluginConnectionField(field('url', { maxLength: 10 }), { v: 'https://a.example.com/x.jpg' })).toBeNull()
    expect(mapPluginConnectionField(field('url', { maxLength: 40 }), { v: 'javascript:alert(1)' })).toBeNull()
    expect(mapPluginConnectionField(field('url', { maxLength: 40 }), { v: 'http://a.example.com/' })).toBeNull()
    expect(mapPluginConnectionField(field('url', { maxLength: 40 }), { v: 'https://u:p@a.example.com/' })).toBeNull()
  })

  it('treats a map as a whitelist: an unlisted value is dropped, never passed through raw', () => {
    const rating = field('number', { map: { FIVE: 5 } })
    expect(mapPluginConnectionField(rating, { v: 'FIVE' })).toBe(5)
    expect(mapPluginConnectionField(rating, { v: 'SIX' })).toBeNull()
    expect(mapPluginConnectionField(rating, { v: 'toString' })).toBeNull()
  })

  it('writes only the declared keys, every declared key on every entry, and stops at maxItems', () => {
    const answer = {
      averageRating: 4.8,
      totalReviewCount: 9,
      secret: 'leak',
      reviews: Array.from({ length: 9 }, (_, n) => review(n, { reviewer: { displayName: 'A very long name indeed', email: 'x' } })),
    }
    const doc = mapPluginConnectionRecord(SYNC as never, { reviews: { pages: [answer], items: answer.reviews } }, {
      listingId: LISTING,
      connectionId: 'reviews',
      version: '1.0.0',
      syncedAtMs: NOW,
    })
    expect(doc.fields).toEqual({ averageRating: 4.8, total: 9 })
    expect(doc.items).toHaveLength(5)
    expect(doc.items[0]).toEqual({ reviewer: 'A very lon', photo: null, rating: 5, createdAt: Date.UTC(2026, 10, 1, 12) })
    expect(JSON.stringify(doc)).not.toMatch(/leak|email|reviewId/)
  })

  it('drops trailing items until the record fits its byte ceiling', () => {
    const big = {
      record: {
        items: {
          request: 'r',
          maxItems: 100,
          fields: {
            text: { type: 'string', path: 'text', maxLength: 5000 },
            more: { type: 'string', path: 'text', maxLength: 5000 },
          },
        },
      },
    }
    const items = Array.from({ length: 100 }, () => ({ text: 'x'.repeat(5000) }))
    const doc = mapPluginConnectionRecord(big as never, { r: { pages: [{}], items } }, {
      listingId: LISTING,
      connectionId: 'reviews',
      version: '1.0.0',
      syncedAtMs: NOW,
    })
    expect(doc.items.length).toBeLessThan(100)
    expect(doc.items.length).toBeGreaterThan(45)
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThanOrEqual(PLUGIN_CONNECTION_RECORD_MAX_BYTES)
  })
})

describe('the scheduled sync (AGL-4194)', () => {
  it('runs a due connection under its pinned version, writes the record whole and schedules the next run', async () => {
    seedConnection()
    db.docs.set(`hosts/${HOST}/pluginConnections/${pluginConnectionRecordDocId(LISTING, 'reviews')}`, {
      kind: 'record',
      stale: 'a key the new schema does not have',
    })
    const report = await tick()
    expect(report).toMatchObject({ configured: true, due: 1, synced: 1, errors: 0 })
    expect(apiCalls()).toEqual([{ url: REVIEWS_URL, authorization: 'Bearer access-1' }])
    expect(recordDoc()).toEqual({
      kind: 'record',
      listingId: LISTING,
      connectionId: 'reviews',
      version: '1.0.0',
      syncedAtMs: NOW,
      fields: { averageRating: 4.8, total: 2 },
      items: [
        { reviewer: 'Reviewer 1', photo: 'https://lh3.example.com/p1.jpg', rating: 5, createdAt: Date.UTC(2026, 10, 1, 12) },
        { reviewer: 'Reviewer 2', photo: 'https://lh3.example.com/p2.jpg', rating: 5, createdAt: Date.UTC(2026, 10, 1, 12) },
      ],
    })
    expect(connectionDoc()).toMatchObject({ status: 'connected', lastSyncAtMs: NOW, nextSyncAtMs: NOW + 6 * HOUR, lastError: null })
    // Not due again until the interval passes.
    calls = []
    clock += HOUR
    expect(await tick()).toMatchObject({ due: 0 })
    expect(apiCalls()).toHaveLength(0)
  })

  it('stamps its own last-ran mark through the console job runner, and has its own health row', async () => {
    resetPluginConsoleCronsForTests()
    registerMarketplaceConsoleServerDeclarations()
    expect(listPluginConsoleCrons()).toEqual([
      expect.objectContaining({ pluginId: 'marketplace', id: PLUGIN_CONNECTION_SYNC_JOB_ID }),
    ])
    expect(pluginConsoleCronScheduledJobs()[0]).toMatchObject({ id: 'marketplace-connection-sync', cron: '*/15 * * * *' })
    seedConnection()
    const beats: Array<[string, number]> = []
    const reports = await runPluginConsoleCrons({
      nowMs: NOW,
      deadlineMs: NOW + 60_000,
      jobIds: [PLUGIN_CONNECTION_SYNC_JOB_ID],
      beat: async (jobId, nowMs) => {
        beats.push([jobId, nowMs])
      },
    })
    expect(beats).toEqual([[PLUGIN_CONNECTION_SYNC_JOB_ID, NOW]])
    expect(reports[PLUGIN_CONNECTION_SYNC_JOB_ID]).toMatchObject({ synced: 1 })
    resetPluginConsoleCronsForTests()
  })

  it('follows the declared pagination and stops at the declared maxPages, however many pages the provider offers', async () => {
    reviewPages = {
      '': { status: 200, body: { averageRating: 5, reviews: [review(1)], nextPageToken: 'p2' } },
      p2: { status: 200, body: { reviews: [review(2)], nextPageToken: 'p3' } },
      p3: { status: 200, body: { reviews: [review(3)], nextPageToken: 'p4' } },
      p4: { status: 200, body: { reviews: [review(4)], nextPageToken: 'p5' } },
    }
    seedConnection()
    await tick()
    expect(apiCalls().map((call) => new URL(call.url).searchParams.get('pageToken'))).toEqual([null, 'p2', 'p3'])
    expect(recordDoc()?.items.map((item) => item['reviewer'])).toEqual(['Reviewer 1', 'Reviewer 2', 'Reviewer 3'])
  })

  it('stops paging once the record has its maxItems', async () => {
    reviewPages = {
      '': { status: 200, body: { reviews: [1, 2, 3, 4, 5, 6].map((n) => review(n)), nextPageToken: 'p2' } },
      p2: { status: 200, body: { reviews: [review(7)] } },
    }
    seedConnection()
    await tick()
    expect(apiCalls()).toHaveLength(1)
    expect(recordDoc()?.items).toHaveLength(5)
  })

  it('refreshes an access token near expiry before the first request', async () => {
    seedConnection(HOST, { accessExpiresAtMs: NOW + 60_000 })
    await tick()
    expect(calls[0].url).toBe('https://oauth2.example.com/token')
    expect(apiCalls()).toEqual([{ url: REVIEWS_URL, authorization: 'Bearer access-2' }])
    expect(connectionDoc()).toMatchObject({ status: 'connected', accessExpiresAtMs: NOW + HOUR })
  })

  it('refreshes once on a 401 from the API and carries on with the fresh token', async () => {
    reviewQueue = [{ status: 401, body: { error: { message: 'Request had invalid authentication credentials.' } } }]
    seedConnection()
    expect(await tick()).toMatchObject({ synced: 1 })
    expect(apiCalls().map((call) => call.authorization)).toEqual(['Bearer access-1', 'Bearer access-2'])
  })

  it('marks reconnect_required when the provider refuses the refresh (invalid_grant), and stops scheduling it', async () => {
    tokenAnswer = { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
    seedConnection(HOST, { accessExpiresAtMs: NOW - 1 })
    expect(await tick()).toMatchObject({ reconnectRequired: 1, synced: 0 })
    expect(connectionDoc()).toMatchObject({ status: 'reconnect_required', nextSyncAtMs: null, lastError: 'Token has been expired or revoked.' })
    expect(apiCalls()).toHaveLength(0)
    expect(recordDoc()).toBeUndefined()
    clock += 7 * 24 * HOUR
    expect(await tick()).toMatchObject({ due: 0 })
  })

  it('marks reconnect_required on a 401 that a fresh token does not cure', async () => {
    reviewQueue = [
      { status: 401, body: { error: { message: 'invalid credentials' } } },
      { status: 401, body: { error: { message: 'invalid credentials' } } },
    ]
    seedConnection()
    expect(await tick()).toMatchObject({ reconnectRequired: 1 })
    expect(connectionDoc()).toMatchObject({ status: 'reconnect_required', nextSyncAtMs: null })
  })

  it('records any other failure with the provider’s sentence and backs off, keeping the last good record', async () => {
    seedConnection()
    await tick()
    const good = recordDoc()
    clock = NOW + 6 * HOUR
    reviewPages[''] = { status: 500, body: { error: { message: 'Backend Error' } } }
    expect(await tick()).toMatchObject({ errors: 1 })
    expect(connectionDoc()).toMatchObject({
      status: 'error',
      lastError: 'Google Business Profile did not answer: Backend Error',
      nextSyncAtMs: clock + 15 * 60 * 1000,
      syncFailures: 1,
    })
    expect(recordDoc()).toEqual(good)
    clock += 15 * 60 * 1000
    await tick()
    expect(connectionDoc()).toMatchObject({ status: 'error', nextSyncAtMs: clock + 30 * 60 * 1000, syncFailures: 2 })
    // Recovers: back to connected, the count reset, on the declared interval.
    clock += 30 * 60 * 1000
    reviewPages[''] = { status: 200, body: { averageRating: 4, reviews: [] } }
    await tick()
    expect(connectionDoc()).toMatchObject({ status: 'connected', lastError: null, syncFailures: 0, nextSyncAtMs: clock + 6 * HOUR })
  })

  it('doubles the backoff from fifteen minutes and never past the declared interval', () => {
    expect(pluginConnectionSyncBackoffMs(1, 6)).toBe(15 * 60 * 1000)
    expect(pluginConnectionSyncBackoffMs(3, 6)).toBe(60 * 60 * 1000)
    expect(pluginConnectionSyncBackoffMs(30, 6)).toBe(6 * HOUR)
  })

  it('never sends a request off the declared hosts, even for a declaration that skipped validation', async () => {
    const record = seedConnection()
    const offHost = {
      ...CONNECTION,
      sync: { ...SYNC, requests: [{ ...SYNC.requests[0], url: 'https://evil.example.net/v4/{{resource.accounts}}/reviews' }] },
    }
    const outcome = await runConnectionSync({
      keyring,
      record,
      connection: offHost as never,
      version: '1.0.0',
      client: { clientId: 'client-abc', clientSecret: 'secret-xyz' },
      deadlineMs: NOW + 60_000,
    })
    expect(outcome).toBe('error')
    expect(calls.filter((call) => call.url.includes('evil.example.net'))).toHaveLength(0)
    expect(connectionDoc().lastError).toMatch(/declared hosts/)
  })

  it('does not run a pin whose manifest no longer validates (an off-host sync), and deletes nothing', async () => {
    const offHost = { ...CONNECTION, sync: { ...SYNC, requests: [{ ...SYNC.requests[0], url: 'https://evil.example.net/reviews' }] } }
    db.docs.set(`hosts/${HOST}/installs/${LISTING}`, pin({ connections: [offHost] }))
    seedConnection()
    expect(await tick()).toMatchObject({ deferred: 1, synced: 0 })
    expect(calls).toHaveLength(0)
    expect(connectionDoc()).toMatchObject({ status: 'connected', nextSyncAtMs: NOW + 6 * HOUR })
  })

  it('skips the whole tick quietly without the sealing key: no query, no request, no write', async () => {
    seedConnection()
    const before = JSON.stringify([...db.docs.entries()])
    delete process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV]
    expect(await tick()).toEqual({ configured: false })
    expect(calls).toHaveLength(0)
    expect(JSON.stringify([...db.docs.entries()])).toBe(before)
  })

  it('defers a site whose plan has no connections, without touching its status or calling the provider', async () => {
    seedConnection(FREE_HOST)
    expect(await tick()).toMatchObject({ deferred: 1, synced: 0 })
    expect(calls).toHaveLength(0)
    expect(connectionDoc(FREE_HOST)).toMatchObject({ status: 'connected', lastError: null, nextSyncAtMs: NOW + 6 * HOUR })
  })

  it('defers a version the kill switch revoked, and keeps the connection', async () => {
    seedConnection()
    db.docs.set(`revocations/${LISTING}`, { versions: ['1.0.0'] })
    expect(await tick()).toMatchObject({ deferred: 1, forgotten: 0 })
    expect(connectionDoc()).toMatchObject({ status: 'connected' })
  })

  it('takes a connection off the schedule while a resource is not chosen', async () => {
    seedConnection(HOST, { choices: { accounts: { id: 'accounts/1', label: 'Acme' } } })
    expect(await tick()).toMatchObject({ notReady: 1 })
    expect(connectionDoc().nextSyncAtMs).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('syncs at most a bounded number of connections per tick, oldest first', async () => {
    for (let n = 0; n < PLUGIN_CONNECTION_SYNC_MAX_PER_TICK + 3; n += 1) {
      const hostId = `host-acme`
      db.docs.set(`hosts/${hostId}-${n}/pluginConnections/${LISTING}__reviews`, {
        ...JSON.parse(JSON.stringify(seedConnection(hostId))),
        hostId: `${hostId}-${n}`,
        nextSyncAtMs: NOW - n,
      })
    }
    db.docs.delete(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`)
    const report = await tick()
    expect(report['due']).toBe(PLUGIN_CONNECTION_SYNC_MAX_PER_TICK)
  })
})

describe('Sync now — POST plugin-connections/sync (AGL-4194)', () => {
  const post = (body: Record<string, unknown>, token?: string) =>
    new Request(`${CONSOLE}/api/${PLUGIN_CONNECTIONS_API_ROUTES.sync}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  const SITE = { hostId: HOST, listingId: LISTING, connectionId: 'reviews' }

  it('keeps the path the console card calls', () => {
    expect(PLUGIN_CONNECTIONS_API_ROUTES.sync).toBe('plugin-connections/sync')
  })

  it('runs the sync for a member with the key and answers the connection’s view, never a token', async () => {
    seedConnection(HOST, { nextSyncAtMs: NOW + 6 * HOUR })
    const response = await syncNowRoute(post(SITE, 'tok-admin'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { connection: Record<string, unknown>; synced: boolean }
    expect(body.synced).toBe(true)
    expect(body.connection).toMatchObject({ status: 'connected', lastSyncAtMs: NOW, lastError: null, ready: true })
    expect(JSON.stringify(body)).not.toMatch(/access-1|refresh-1|sealed/)
    expect(recordDoc()?.fields).toEqual({ averageRating: 4.8, total: 2 })
  })

  it('answers a provider failure as the view with its error, not a 5xx', async () => {
    seedConnection()
    reviewPages[''] = { status: 500, body: { error: { message: 'Backend Error' } } }
    const response = await syncNowRoute(post(SITE, 'tok-admin'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ synced: false, connection: { status: 'error' } })
  })

  it('refuses without a sign-in, without the site key, on Free, and without the sealing key', async () => {
    seedConnection()
    seedConnection(FREE_HOST)
    expect((await syncNowRoute(post(SITE))).status).toBe(401)
    const editor = await syncNowRoute(post(SITE, 'tok-editor'))
    expect(editor.status).toBe(403)
    expect(await editor.json()).toMatchObject({ permission: 'marketplace.siteConnections' })
    const free = await syncNowRoute(post({ ...SITE, hostId: FREE_HOST }, 'tok-admin'))
    expect(free.status).toBe(403)
    expect(await free.json()).toMatchObject({ reason: 'plan' })
    delete process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV]
    expect((await syncNowRoute(post(SITE, 'tok-admin'))).status).toBe(503)
    expect(apiCalls()).toHaveLength(0)
  })

  it('refuses before it is connected, while reconnect is required, and before every resource is chosen', async () => {
    expect(await (await syncNowRoute(post(SITE, 'tok-admin'))).json()).toMatchObject({ reason: 'not-connected' })
    seedConnection(HOST, { status: 'reconnect_required' })
    expect(await (await syncNowRoute(post(SITE, 'tok-admin'))).json()).toMatchObject({ reason: 'reconnect' })
    seedConnection(HOST, { choices: { accounts: { id: 'accounts/1', label: 'Acme' } } })
    const response = await syncNowRoute(post(SITE, 'tok-admin'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ reason: 'choose-first', resource: 'locations' })
    expect(apiCalls()).toHaveLength(0)
  })

  it('answers 429 within a minute of the last sync, with the view, and only POST', async () => {
    seedConnection(HOST, { lastSyncAtMs: NOW - 10_000 })
    const response = await syncNowRoute(post(SITE, 'tok-admin'))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ reason: 'too-soon', connection: { lastSyncAtMs: NOW - 10_000 } })
    expect((await syncNowRoute(new Request(`${CONSOLE}/api/plugin-connections/sync`))).status).toBe(405)
  })
})

describe('when the plugin that declared a connection goes (AGL-4194)', () => {
  it('disconnect deletes the record with the grant', async () => {
    seedConnection()
    await tick()
    expect(recordDoc()).toBeDefined()
    const response = await disconnectRoute(
      new Request(`${CONSOLE}/api/plugin-connections/disconnect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok-admin' },
        body: JSON.stringify({ hostId: HOST, listingId: LISTING, connectionId: 'reviews' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(recordDoc()).toBeUndefined()
  })

  it('an uninstall revokes the grant with the endpoint the old pin declared, and deletes the connection and its record', async () => {
    seedConnection()
    await tick()
    const previous = pinConnections(db.docs.get(`hosts/${HOST}/installs/${LISTING}`))
    db.docs.delete(`hosts/${HOST}/installs/${LISTING}`)
    calls = []
    expect(await reconcileListingConnections(db as never, { hostIds: [HOST], orgId: 'org-acme', listingId: LISTING, previous })).toBe(1)
    expect(calls.map((call) => call.url)).toEqual(['https://oauth2.example.com/revoke'])
    expect(db.docs.has(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`)).toBe(false)
    expect(recordDoc()).toBeUndefined()
  })

  it('a re-pin to a version that no longer declares the connection does the same', async () => {
    seedConnection()
    const previous = pinConnections(db.docs.get(`hosts/${HOST}/installs/${LISTING}`))
    db.docs.set(`hosts/${HOST}/installs/${LISTING}`, pin({}, '2.0.0'))
    expect(await reconcileListingConnections(db as never, { hostIds: [HOST], orgId: 'org-acme', listingId: LISTING, previous })).toBe(1)
    expect(db.docs.has(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`)).toBe(false)
  })

  it('keeps the connection of a site that still runs the listing through the workspace’s pin', async () => {
    seedConnection()
    const previous = pinConnections(db.docs.get(`hosts/${HOST}/installs/${LISTING}`))
    db.docs.set(`orgs/org-acme/installs/${LISTING}`, pin())
    db.docs.delete(`hosts/${HOST}/installs/${LISTING}`)
    expect(await reconcileListingConnections(db as never, { hostIds: [HOST], orgId: 'org-acme', listingId: LISTING, previous })).toBe(0)
    expect(connectionDoc()).toMatchObject({ status: 'connected' })
  })

  it('the scheduled sync forgets an orphan it meets: revoked, and both documents deleted', async () => {
    seedConnection()
    db.docs.set(`hosts/${HOST}/pluginConnections/${pluginConnectionRecordDocId(LISTING, 'reviews')}`, { kind: 'record' })
    db.docs.delete(`hosts/${HOST}/installs/${LISTING}`)
    expect(await tick()).toMatchObject({ forgotten: 1, synced: 0 })
    expect(calls.map((call) => call.url)).toEqual(['https://oauth2.example.com/revoke'])
    expect([...db.docs.keys()].filter((path) => path.startsWith(`hosts/${HOST}/pluginConnections/`))).toEqual([])
  })

  it('the site eraser takes the record too: it deletes the whole collection', async () => {
    const { pluginConnectionsSiteEraser } = await import('./erasure')
    seedConnection()
    await tick()
    await pluginConnectionsSiteEraser.erase({ hostId: HOST, orgId: 'org-acme' } as never)
    expect([...db.docs.keys()].filter((path) => path.startsWith(`hosts/${HOST}/pluginConnections/`))).toEqual([])
  })
})

describe('where a listing’s connections send data (AGL-4194)', () => {
  it('derives each connection’s hosts from its declaration: the OAuth endpoints and every API host', () => {
    expect(pluginConnectionRecipients([CONNECTION as never])).toEqual([
      {
        connectionId: 'reviews',
        provider: 'google',
        label: 'Google Business Profile',
        hosts: ['accounts.example.com', 'mybusiness.example.com', 'oauth2.example.com'],
      },
    ])
  })
})

describe('the due-connection query’s index (AGL-4194)', () => {
  it('declares the COLLECTION_GROUP index on pluginConnections (kind, status, nextSyncAtMs)', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    ) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }> }
    const found = config.indexes.find(
      (index) =>
        index.collectionGroup === 'pluginConnections' &&
        index.queryScope === 'COLLECTION_GROUP' &&
        index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(',') ===
          'kind:ASCENDING,status:ASCENDING,nextSyncAtMs:ASCENDING',
    )
    expect(found).toBeDefined()
  })
})
