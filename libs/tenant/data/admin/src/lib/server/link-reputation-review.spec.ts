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
 * Google Web Risk on pages and redirects (AGL-3451): a page or a redirect
 * that points at a listed host is held through the page review, at any
 * workspace age; a lookup that fails holds nothing; and the daily re-check
 * finds a host listed after the page went live and sends the page back
 * through the same review. In `'url'` mode (AGL-3459) a listing that names
 * one page on a clean site holds too, and the re-check walks the addresses
 * the review noted. The screen, the review, the cache and the re-check are
 * real; the store, the workspace reads and Google are faked.
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()

const isIncrement = (value: unknown): value is { __increment: number } =>
  Boolean(value) && typeof (value as { __increment?: unknown }).__increment === 'number'

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function write(path: string, value: Doc) {
  const next: Doc = { ...(store.get(path) ?? {}) }
  for (const [key, entry] of Object.entries(value)) {
    if (isIncrement(entry)) next[key] = Number(next[key] ?? 0) + entry.__increment
    else if (entry === 'server-timestamp') next[key] = 1
    else next[key] = entry
  }
  store.set(path, next)
}

/** The direct children of a collection path. */
const childrenOf = (collectionPath: string) =>
  [...store.keys()]
    .filter(
      (key) =>
        key.startsWith(`${collectionPath}/`) &&
        key.split('/').length === collectionPath.split('/').length + 1,
    )
    .sort()

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: childrenOf(path)
            .filter((key) => {
              const actual = store.get(key)?.[field]
              if (op === '>') return Number(actual) > Number(value)
              if (op === '<') return Number(actual) < Number(value)
              return actual === value
            })
            .map(snapshotOf),
        }),
      }),
    }),
    orderBy: () => {
      let after: string | null = null
      let take = Infinity
      const query: any = {
        select: () => query,
        limit: (n: number) => {
          take = n
          return query
        },
        startAfter: (id: string) => {
          after = id
          return query
        },
        get: async () => {
          const docs = childrenOf(path)
            .filter((key) => after === null || (key.split('/').pop() as string) > after)
            .slice(0, take)
            .map(snapshotOf)
          return { docs, size: docs.length }
        },
      }
      return query
    },
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => snapshotOf(path),
    set: async (value: Doc) => write(path, value),
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

const db = {
  collection: (name: string) => collectionRef(name),
  doc: (path: string) => docRef(path),
  getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshotOf(ref.path)),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
    work({
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      set: (ref: { path: string }, value: Doc) => write(ref.path, value),
    }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => db }) },
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    delete: () => ({ __delete: true }),
  },
}))

const mockNotifyRisk = jest.fn(async (_input: unknown) => undefined)
jest.mock('./risk-notice', () => ({
  __esModule: true,
  notifyRiskEvent: (input: unknown) => mockNotifyRisk(input),
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
let mockOrg: Doc = {}
const mockHost: Doc = { name: 'Review', subdomain: 'review', cname: 'review-files.example' }
jest.mock('./organizations', () => ({
  __esModule: true,
  getHostDocAdmin: async () => mockHost,
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
}))

import { recordServedPageVersion, resetHostedPageReviewMemoForTests, reviewHostedPage, reviewSiteRedirect } from './hosted-page-review'
import { recheckLivePageLinks } from './link-reputation-review'
import { screenOutboundSend } from './outbound-send-review'
import { resetPageSecurityHoldMemoForTests } from './page-security-hold'
import {
  resetWebRiskForTests,
  WEB_RISK_URL_CACHE_COLLECTION,
  WEB_RISK_URL_VERDICT_GRACE_MS,
  type WebRiskClient,
} from './web-risk'

const HARVESTER = 'conservascaorvi.example'
const listed = new Set<string>([HARVESTER])
/** Addresses Web Risk lists on hosts it does not (AGL-3459). */
const listedUrls = new Set<string>()
const asked: string[] = []
let failing = false
const client: WebRiskClient = {
  searchUri: async (uri) => {
    asked.push(uri)
    if (failing) throw new Error('deadline exceeded')
    const host = new URL(uri).hostname
    return listed.has(host) || listedUrls.has(uri)
      ? { threats: ['SOCIAL_ENGINEERING'], expireTimeMs: Date.now() + 5 * 60_000 }
      : { threats: [], expireTimeMs: null }
  },
}

const node = (componentId: string, props: Doc) => ({ componentId, props })
/** No lookalike, no credential field, no brand: only the link is bad. */
const PLAIN_PAGE = {
  a: node('muiTypography', { children: 'Our catalogue' }),
  b: node('muiButton', { children: 'Browse', href: `https://${HARVESTER}/wp-content/files/` }),
}

const review = (nodes: unknown, versionId = 'v2', screenId = 'screen-1') =>
  reviewHostedPage({ hostId: 'host-1', screenId, versionId, nodes, nowMs: NOW })

const rows = () => [...store.keys()].filter((key) => key.startsWith('abuseReports/')).map((key) => store.get(key) as Doc)

beforeEach(() => {
  store.clear()
  asked.length = 0
  failing = false
  listed.clear()
  listed.add(HARVESTER)
  listedUrls.clear()
  mockOrg = { name: 'Review', createdAt: NOW - 400 * DAY }
  mockNotifyRisk.mockClear()
  resetHostedPageReviewMemoForTests()
  resetPageSecurityHoldMemoForTests()
  resetWebRiskForTests(client)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a page that links to a listed host', () => {
  it('is held for a young workspace, with a web-risk-link signal and a security hold', async () => {
    mockOrg = { name: 'Review', createdAt: NOW - 2 * DAY }
    await expect(review(PLAIN_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    const [row] = rows()
    expect(row).toMatchObject({ category: 'phishing', severity: 'urgent', reportedHostname: HARVESTER })
    expect((row['heldSend'] as Doc)['signals']).toEqual([
      { code: 'web-risk-link', host: HARVESTER, threats: ['SOCIAL_ENGINEERING'] },
    ])
    expect(String(row['details'])).toContain('Google Web Risk lists as phishing or social engineering')
    expect(store.get('securityHolds/org-1')).toMatchObject({ state: 'pending' })
    // Only the host was asked about — never the path.
    expect(asked).toEqual([`https://${HARVESTER}/`])
  })

  it('is held for an established workspace too when it is new content — the signal is strong', async () => {
    store.set('hosts/host-1/pageReviews/screen-1', { servedVersionId: 'v1' })
    await expect(review(PLAIN_PAGE, 'v2')).resolves.toMatchObject({ outcome: 'held' })
    expect(store.has('securityHolds/org-1')).toBe(false)
  })

  it('keeps serving an established workspace’s LIVE page and flags it to staff, as every strong signal does', async () => {
    store.set('hosts/host-1/pageReviews/screen-1', { servedVersionId: 'v2' })
    await expect(review(PLAIN_PAGE, 'v2')).resolves.toEqual({ outcome: 'serve' })
    expect(rows()[0]).toMatchObject({ riskNotice: { kind: 'page-flagged' }, reportedHostname: HARVESTER })
  })

  it('does not count a listing of the workspace’s own domain as a link away', async () => {
    listed.add('review-files.example')
    const own = { a: node('muiButton', { children: 'Home', href: 'https://review-files.example/' }) }
    await expect(review(own)).resolves.toEqual({ outcome: 'serve' })
    expect(rows()).toEqual([])
  })

  it('serves a page whose lookup failed: a timeout is not evidence', async () => {
    failing = true
    await expect(review(PLAIN_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(rows()).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })

  it('notes the page’s foreign hosts beside the version it serves, for the daily re-check', async () => {
    listed.clear()
    await expect(review(PLAIN_PAGE, 'v7')).resolves.toEqual({ outcome: 'serve' })
    await recordServedPageVersion('host-1', 'screen-1', 'v7')
    expect(store.get('hosts/host-1/pageReviews/screen-1')).toMatchObject({
      servedVersionId: 'v7',
      foreignHosts: [HARVESTER],
      foreignHostCount: 1,
    })
  })
})

describe('a campaign that links to a listed host', () => {
  it('is held before it is claimed, for an established workspace', async () => {
    const outcome = await screenOutboundSend({
      kind: 'campaign',
      path: 'orgs/org-1/emailSends/send-1',
      hostId: 'host-1',
      orgId: 'org-1',
      org: mockOrg,
      host: mockHost,
      subject: 'This week',
      bodies: [`<p>New arrivals.</p><a href="https://${HARVESTER}/shop">Shop</a>`],
      nowMs: NOW,
    })
    expect(outcome).toMatchObject({ outcome: 'held' })
    expect((rows()[0]['heldSend'] as Doc)['signals']).toEqual([
      { code: 'web-risk-link', host: HARVESTER, threats: ['SOCIAL_ENGINEERING'] },
    ])
  })
})

describe('a redirect to a listed host', () => {
  it('does not fire, for any workspace, and lands in the queue as the redirect rule', async () => {
    await expect(
      reviewSiteRedirect({
        hostId: 'host-1',
        ruleId: 'rule-1',
        source: '/catalogue',
        destination: `https://${HARVESTER}/start`,
        nowMs: NOW,
      }),
    ).resolves.toMatchObject({ outcome: 'held' })
    expect((rows()[0]['heldSend'] as Doc)['path']).toBe('hosts/host-1/redirects/rule-1')
  })

  it('fires when the destination is not listed', async () => {
    await expect(
      reviewSiteRedirect({
        hostId: 'host-1',
        ruleId: 'rule-2',
        source: '/menu',
        destination: 'https://bakery.example/menu',
        nowMs: NOW,
      }),
    ).resolves.toEqual({ outcome: 'serve' })
  })
})

describe('the daily re-check', () => {
  const seed = () => {
    store.set('hosts/host-1', { name: 'Review' })
    store.set('hosts/host-1/pageReviews/screen-1', {
      servedVersionId: 'v3',
      foreignHosts: [HARVESTER, 'bakery.example'],
      foreignHostCount: 2,
    })
    store.set('hosts/host-1/pageReviews/screen-2', { servedVersionId: 'v1', foreignHosts: [], foreignHostCount: 0 })
    store.set('hosts/host-2', { name: 'Locked', suspendedAt: 1 })
    store.set('hosts/host-2/pageReviews/screen-9', {
      servedVersionId: 'v1',
      foreignHosts: [HARVESTER],
      foreignHostCount: 1,
    })
  }

  it('holds a young workspace’s live page whose link was listed after it went live, and asks for its security hold', async () => {
    mockOrg = { name: 'Review', createdAt: NOW - 5 * DAY }
    seed()
    const chunk = await recheckLivePageLinks({ nowMs: NOW })
    expect(chunk).toMatchObject({
      sites: 2,
      pages: 1,
      hosts: 2,
      listed: 1,
      reviewed: 1,
      held: 1,
      heldHostIds: ['host-1'],
      done: true,
      nextCursor: null,
    })
    expect((rows()[0]['heldSend'] as Doc)['signals']).toEqual([
      { code: 'web-risk-link', host: HARVESTER, threats: ['SOCIAL_ENGINEERING'] },
    ])
    expect(store.get('securityHolds/org-1')).toMatchObject({ state: 'pending', screenId: 'screen-1', versionId: 'v3' })
  })

  it('flags an established workspace’s live page instead of taking it down', async () => {
    seed()
    const chunk = await recheckLivePageLinks({ nowMs: NOW })
    expect(chunk).toMatchObject({ reviewed: 1, held: 0, heldHostIds: [] })
    expect(rows()[0]).toMatchObject({ riskNotice: { kind: 'page-flagged' } })
  })

  it('walks a chunk at a time, and a dry run looks nothing up', async () => {
    seed()
    const first = await recheckLivePageLinks({ sitesPerChunk: 1, dryRun: true })
    expect(first).toMatchObject({ sites: 1, pages: 1, hosts: 2, done: false, nextCursor: 'host-1' })
    expect(asked).toEqual([])
    const second = await recheckLivePageLinks({ sitesPerChunk: 1, cursor: 'host-1', dryRun: true })
    expect(second).toMatchObject({ sites: 1, pages: 0, done: false, nextCursor: 'host-2' })
    const last = await recheckLivePageLinks({ sitesPerChunk: 1, cursor: 'host-2', dryRun: true })
    expect(last).toMatchObject({ sites: 0, done: true, nextCursor: null })
  })

  it('holds nothing on a host it could not look up', async () => {
    mockOrg = { name: 'Review', createdAt: NOW - 5 * DAY }
    seed()
    failing = true
    const chunk = await recheckLivePageLinks({ nowMs: NOW })
    expect(chunk).toMatchObject({ listed: 0, unknown: 2, reviewed: 0, held: 0 })
    expect(rows()).toEqual([])
  })
})

describe("a listed page on a clean site ('url' mode, AGL-3459)", () => {
  const SITE = 'old-bakery.example'
  const KIT = `https://${SITE}/wp-includes/js/secure/login.html`
  /** A clean, established site, compromised at one path. */
  const KIT_PAGE = {
    a: node('muiTypography', { children: 'Your invoice' }),
    b: node('muiButton', { children: 'View', href: `${KIT}?invoice=4471&email=jane@doe.example#pay` }),
  }
  const urlMode = () => store.set('platformSettings/webRisk', { lookupMode: 'url' })

  beforeEach(() => {
    listedUrls.add(KIT)
  })

  it('holds the page, asking about the host first and then the address — without its query or fragment', async () => {
    urlMode()
    mockOrg = { name: 'Review', createdAt: NOW - 2 * DAY }
    await expect(review(KIT_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    expect(asked).toEqual([`https://${SITE}/`, KIT])
    const [row] = rows()
    expect((row['heldSend'] as Doc)['signals']).toEqual([
      { code: 'web-risk-link', host: SITE, url: KIT, threats: ['SOCIAL_ENGINEERING'] },
    ])
    expect(String(row['details'])).toContain(`Links to ${KIT}, which Google Web Risk lists`)
    expect(JSON.stringify(row)).not.toContain('jane@doe.example')
  })

  it("serves the same page in the default 'host' mode, having sent only the host", async () => {
    mockOrg = { name: 'Review', createdAt: NOW - 2 * DAY }
    await expect(review(KIT_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(asked).toEqual([`https://${SITE}/`])
    expect(rows()).toEqual([])
  })

  it('notes the addresses beside the hosts for the re-check, without their query strings', async () => {
    listedUrls.clear()
    listed.clear()
    await expect(review(KIT_PAGE, 'v8')).resolves.toEqual({ outcome: 'serve' })
    await recordServedPageVersion('host-1', 'screen-1', 'v8')
    expect(store.get('hosts/host-1/pageReviews/screen-1')).toMatchObject({
      servedVersionId: 'v8',
      foreignHosts: [SITE],
      foreignHostCount: 1,
      foreignLinks: [KIT],
    })
  })

  it('re-checks the noted addresses, and sends a page whose address was listed later back through the review', async () => {
    urlMode()
    mockOrg = { name: 'Review', createdAt: NOW - 5 * DAY }
    store.set('hosts/host-1', { name: 'Review' })
    store.set('hosts/host-1/pageReviews/screen-1', {
      servedVersionId: 'v3',
      foreignHosts: [SITE],
      foreignHostCount: 1,
      foreignLinks: [KIT, `https://${SITE}/menu`],
    })
    const chunk = await recheckLivePageLinks({ nowMs: NOW })
    expect(chunk).toMatchObject({ pages: 1, hosts: 1, addresses: 2, listed: 1, reviewed: 1, held: 1 })
    expect((rows()[0]['heldSend'] as Doc)['signals']).toEqual([
      { code: 'web-risk-link', host: SITE, url: KIT, threats: ['SOCIAL_ENGINEERING'] },
    ])
  })

  it("re-checks hosts only in 'host' mode, whatever addresses were noted", async () => {
    store.set('hosts/host-1', { name: 'Review' })
    store.set('hosts/host-1/pageReviews/screen-1', {
      servedVersionId: 'v3',
      foreignHosts: [SITE],
      foreignHostCount: 1,
      foreignLinks: [KIT],
    })
    const chunk = await recheckLivePageLinks({ nowMs: NOW })
    expect(chunk).toMatchObject({ addresses: 0, listed: 0, reviewed: 0 })
    expect(asked).toEqual([`https://${SITE}/`])
  })

  it('deletes addresses’ answers long expired on the first chunk of a walk, and not on a later one', async () => {
    const stale = `${WEB_RISK_URL_CACHE_COLLECTION}/stale`
    store.set(stale, { url: KIT, expiresAtMs: NOW - WEB_RISK_URL_VERDICT_GRACE_MS - 1 })
    await expect(recheckLivePageLinks({ nowMs: NOW, cursor: 'host-0' })).resolves.toMatchObject({
      reapedAddressVerdicts: 0,
    })
    expect(store.has(stale)).toBe(true)
    await expect(recheckLivePageLinks({ nowMs: NOW })).resolves.toMatchObject({ reapedAddressVerdicts: 1 })
    expect(store.has(stale)).toBe(false)
  })
})
