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
 * A published page held for review (AGL-3362): the review row, the staff
 * decision, the last-clean-version hint, and a lookalike custom domain. The
 * screen is real; only the store and the workspace reads are faked.
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
let failWrites = false

const isIncrement = (value: unknown): value is { __increment: number } =>
  Boolean(value) && typeof (value as { __increment?: unknown }).__increment === 'number'

function snapshotOf(path: string) {
  const data = store.get(path)
  return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function write(path: string, value: Doc) {
  if (failWrites) throw new Error('firestore unavailable')
  const next: Doc = { ...(store.get(path) ?? {}) }
  for (const [key, entry] of Object.entries(value)) {
    if (isIncrement(entry)) next[key] = Number(next[key] ?? 0) + entry.__increment
    else if (entry === 'server-timestamp') next[key] = 1
    else next[key] = entry
  }
  store.set(path, next)
}

/** `where(field, '==', value).limit(n).get()` over one subcollection — the collection-template lookup. */
const whereEquals = (collectionPath: string, field: string, value: unknown) => {
  const query = {
    limit: () => query,
    get: async () => ({
      docs: [...store.keys()]
        .filter(
          (key) =>
            key.startsWith(`${collectionPath}/`) &&
            key.split('/').length === collectionPath.split('/').length + 1 &&
            store.get(key)?.[field] === value,
        )
        .map((key) => snapshotOf(key)),
    }),
  }
  return query
}

const docRef = (path: string): Record<string, unknown> => ({
  path,
  get: async () => snapshotOf(path),
  set: async (value: Doc) => write(path, value),
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${path}/${name}/${id}`),
    where: (field: string, _op: string, value: unknown) => whereEquals(`${path}/${name}`, field, value),
  }),
})

const db = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  doc: (path: string) => docRef(path),
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
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    delete: () => ({ __delete: true }),
  },
}))

// Every hold tells owners and staff through the risk notice seam (AGL-3368).
const mockNotifyRisk = jest.fn(async (_input: unknown) => undefined)
jest.mock('./risk-notice', () => ({
  __esModule: true,
  notifyRiskEvent: (input: unknown) => mockNotifyRisk(input),
}))

import { renderOwnerRiskNotice } from '@aglyn/shared-util-email/risk-notice-catalog'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 28)
let mockOrg: Doc = { name: 'Harbor View', createdAt: NOW - 400 * DAY }
const mockHost: Doc = {
  name: 'Harbor View Hotel',
  subdomain: 'harborview',
  screens: { 'screen-1': 'reviewfile' },
}
const mockGetHostDoc = jest.fn(async (_hostId: string) => mockHost)
const mockGetOrgForHost = jest.fn(async (_hostId: string) => ({ orgId: 'org-1', org: mockOrg }))
jest.mock('./organizations', () => ({
  __esModule: true,
  getHostDocAdmin: (hostId: string) => mockGetHostDoc(hostId),
  getOrgForHost: (hostId: string) => mockGetOrgForHost(hostId),
}))

import {
  flagLookalikeCustomDomain,
  flagLookalikeDomain,
  recordServedPageVersion,
  resetHostedPageReviewMemoForTests,
  reviewHostedPage,
  reviewSiteRedirect,
  servedPageVersion,
} from './hosted-page-review'
import { decideHeldOutboundSend } from './outbound-send-review'

const node = (componentId: string, props: Doc) => ({ componentId, props })
const LOOKALIKE_PAGE = {
  a: node('muiTypography', { children: 'Your item sold.' }),
  b: node('muiButton', { children: 'View', href: 'https://poshmark.id63835663.shop/o/1' }),
}
const LURE_PAGE = {
  a: node('muiTypography', { children: 'DocuSign: a document was shared with you. Review file to continue.' }),
  b: node('muiButton', { children: 'Open', href: 'https://files-share.example.top/view' }),
}
const CLEAN_PAGE = {
  a: node('muiTypography', { children: 'Welcome to Harbor View.' }),
  b: node('muiButton', { children: 'Book on Booking.com', href: 'https://www.booking.com/hotel/x' }),
}

const review = (nodes: unknown, versionId = 'v2') =>
  reviewHostedPage({ hostId: 'host-1', screenId: 'screen-1', versionId, nodes, nowMs: NOW })

const pageRow = () => {
  const key = [...store.keys()].find((entry) => entry.startsWith('abuseReports/'))
  return key ? { id: key.slice('abuseReports/'.length), ...store.get(key) } : undefined
}

beforeEach(() => {
  store.clear()
  failWrites = false
  mockOrg = { name: 'Harbor View', createdAt: NOW - 400 * DAY }
  mockNotifyRisk.mockClear()
  mockGetHostDoc.mockClear()
  mockGetOrgForHost.mockClear()
  resetHostedPageReviewMemoForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a published page', () => {
  it('serves a clean page without reading the workspace or writing anything', async () => {
    await expect(review(CLEAN_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(mockGetHostDoc).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('never takes an ESTABLISHED workspace’s live page down: it serves it, files one urgent row, and tells staff and owners once', async () => {
    await expect(review(LOOKALIKE_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      status: 'open',
      reportedHostname: 'poshmark.id63835663.shop',
      riskNotice: { kind: 'page-flagged' },
    })
    expect(pageRow()?.['heldSend']).toBeUndefined()
    // Once per page per process: a busy page is not a write per request.
    await review(LOOKALIKE_PAGE)
    expect(mockNotifyRisk).toHaveBeenCalledTimes(1)
    expect(mockNotifyRisk.mock.calls[0][0]).toMatchObject({
      kind: 'page-flagged',
      hostId: 'host-1',
      item: { path: '/host-1/screens/screen-1/versions/v2/view' },
    })
  })

  it('still HOLDS new content from an established (possibly compromised) workspace: a new version of a live page', async () => {
    store.set('hosts/host-1/pageReviews/screen-1', { servedVersionId: 'v1' })
    await expect(review(LOOKALIKE_PAGE, 'v2')).resolves.toMatchObject({ outcome: 'held' })
    expect(pageRow()?.['heldSend']).toMatchObject({ kind: 'page', state: 'held', ageDays: 400 })
  })

  it('still HOLDS a brand-new page from an established workspace: nothing was live, so nothing goes down', async () => {
    store.set('hosts/host-1/screens/screen-1', { createdAt: NOW - 1 * DAY })
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({ outcome: 'held' })
  })

  it('keeps serving the version that is already live, and flags it', async () => {
    store.set('hosts/host-1/pageReviews/screen-1', { servedVersionId: 'v2' })
    await expect(review(LOOKALIKE_PAGE, 'v2')).resolves.toEqual({ outcome: 'serve' })
    expect(pageRow()).toMatchObject({ reportedHostname: 'poshmark.id63835663.shop' })
    expect(pageRow()?.['heldSend']).toBeUndefined()
  })

  it('serves an established page that embeds its own video account, and flags nothing', async () => {
    const OWN_VIDEO = {
      a: node('muiTypography', { children: 'Watch the film' }),
      b: node('video', { src: 'https://harborview.wistia.com/medias/abc123' }),
    }
    await expect(review(OWN_VIDEO)).resolves.toEqual({ outcome: 'serve' })
    expect(store.size).toBe(0)
  })

  it('holds a lookalike link from a workspace in its first fortnight and files a `page` row with its URL', async () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
    const answer = await review(LOOKALIKE_PAGE)
    expect(answer).toMatchObject({ outcome: 'held', reference: expect.stringMatching(/^HS-/) })
    expect(pageRow()).toMatchObject({
      hostId: 'host-1',
      orgId: 'org-1',
      url: expect.stringMatching(/^https:\/\/harborview\..+\/reviewfile$/),
      reportedHostname: 'poshmark.id63835663.shop',
      heldPage: { screenId: 'screen-1', versionId: 'v2' },
      heldSend: { kind: 'page', state: 'held', path: 'hosts/host-1/screens/screen-1', ageDays: 2 },
    })
    expect(mockNotifyRisk).toHaveBeenCalledTimes(1)
    expect(mockNotifyRisk.mock.calls[0][0]).toMatchObject({
      kind: 'page-held',
      hostId: 'host-1',
      item: { path: '/host-1/screens/screen-1/versions/v2/view' },
    })
  })

  it('serves an established workspace’s page that only the soft rules flag', async () => {
    await expect(review(LURE_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(store.size).toBe(0)
  })

  it('holds the same soft-rule page from a workspace in its first fortnight', async () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
    await expect(review(LURE_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    // The brand beside the action in one element, and its one button
    // leaving the site beside "a document was shared with you" (AGL-3447).
    expect(pageRow()?.['heldSend']).toMatchObject({
      signals: [
        expect.objectContaining({ code: 'brand-action-page', brand: 'docusign' }),
        expect.objectContaining({ code: 'offsite-action-page', host: 'files-share.example.top' }),
      ],
    })
  })

  it('serves once staff release it, and stays unserved once they reject it', async () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
    await review(LOOKALIKE_PAGE)
    const id = String(pageRow()?.id)
    await decideHeldOutboundSend({ reviewId: id, decision: 'release', actorUid: 's', actorEmail: null })
    resetHostedPageReviewMemoForTests()
    await expect(review(LOOKALIKE_PAGE, 'v3')).resolves.toEqual({ outcome: 'serve' })

    await decideHeldOutboundSend({ reviewId: id, decision: 'reject', actorUid: 's', actorEmail: null })
    resetHostedPageReviewMemoForTests()
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({ outcome: 'rejected' })
  })

  /*
   * This used to fail OPEN, against the module's own header (AGL-3447). The
   * screen has already found a signal on every page that reaches the review,
   * so a review that cannot finish has cleared nothing: serving it is the
   * phishing page the screen exists to stop, and holding it costs a false
   * positive one render's wait. A clean page never reaches the review, so no
   * store error can take it down.
   */
  it('fails CLOSED when the review of a flagged page cannot finish, and tries again on the next render', async () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
    failWrites = true
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({
      outcome: 'held',
      reference: expect.stringMatching(/^HS-/),
    })
    mockGetOrgForHost.mockRejectedValueOnce(new Error('down'))
    await expect(review(LURE_PAGE)).resolves.toMatchObject({ outcome: 'held' })

    // Not remembered: once the store answers, the review runs and decides.
    failWrites = false
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    expect(pageRow()?.['heldSend']).toMatchObject({ state: 'held' })
  })

  it('a clean page is served even while the store is failing: it never reaches the review', async () => {
    failWrites = true
    await expect(review(CLEAN_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(mockGetOrgForHost).not.toHaveBeenCalled()
  })
})

/**
 * The 2026-10-01 page (AGL-3447): a 41-minute-old free workspace's "Share
 * File" header, a "Secure Document Access Portal" heading, Proofpoint's name
 * in the body and one button off the site. Brand, lure and action in three
 * elements, which the one-element rule never read together.
 */
const SHARE_FILE_PAGE = {
  a: node('muiTypography', { children: 'Share File' }),
  b: node('icon', { path: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' }),
  c: node('muiTypography', { variant: 'h3', children: 'Secure Document Access Portal' }),
  d: node('muiTypography', {
    children:
      'Proofpoint Encryption for your sensitive documents. Access, share and collaborate with confidence',
  }),
  e: node('muiButton', { children: 'Continue to Document', href: 'https://temps-juenes.com/', variant: 'contained' }),
}

describe('the document-share page (AGL-3447)', () => {
  it('is HELD for a workspace 41 minutes old, and the row names where the button went', async () => {
    mockOrg = { name: 'Docs Center', createdAt: NOW - 41 * 60 * 1000 }
    await expect(review(SHARE_FILE_PAGE, 'v1')).resolves.toMatchObject({ outcome: 'held' })
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      reportedHostname: 'temps-juenes.com',
      heldSend: { kind: 'page', state: 'held', ageDays: 0 },
    })
    expect(pageRow()?.['heldSend']).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({ code: 'brand-lure-page', brand: 'proofpoint', host: 'temps-juenes.com' }),
        expect.objectContaining({ code: 'offsite-action-page', action: 'Continue to Document' }),
      ]),
    })
    expect(mockNotifyRisk).toHaveBeenCalledWith(expect.objectContaining({ kind: 'page-held' }))
  })

  it('a law firm’s client document portal, from an established workspace, is served and files nothing', async () => {
    mockOrg = { name: 'Hale & Whitcomb LLP', createdAt: NOW - 900 * DAY }
    mockGetHostDoc.mockResolvedValueOnce({
      name: 'Hale & Whitcomb',
      subdomain: 'halewhitcomb',
      cname: 'halewhitcomb.com',
    })
    const CLIENT_PORTAL = {
      a: node('muiTypography', { variant: 'h2', children: 'Client document portal' }),
      b: node('muiTypography', {
        children:
          'Access secure documents and share files with your attorney. We use Microsoft 365 for engagement letters.',
      }),
      c: node('muiButton', { children: 'Open the client portal', href: 'https://portal.halewhitcomb.com/login' }),
    }
    await expect(review(CLIENT_PORTAL)).resolves.toEqual({ outcome: 'serve' })
    expect(store.size).toBe(0)
    expect(mockNotifyRisk).not.toHaveBeenCalled()
  })
})

describe('a site redirect (AGL-3447)', () => {
  const redirect = (source: string, destination: string) =>
    reviewSiteRedirect({ hostId: 'host-1', ruleId: 'r1', source, destination, nowMs: NOW })

  it('lets a redirect to an ordinary host fire without reading the workspace', async () => {
    await expect(redirect('/old-menu', 'https://shop.example.net/menu')).resolves.toEqual({ outcome: 'serve' })
    expect(mockGetOrgForHost).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('holds a lure path sent off the site from a workspace in its first fortnight, as a `page` row on the rule', async () => {
    mockOrg = { name: 'Docs Center', createdAt: NOW - 1 * DAY }
    await expect(redirect('/secure-document-access', 'https://temps-juenes.com/')).resolves.toMatchObject({
      outcome: 'held',
      reference: expect.stringMatching(/^HS-/),
    })
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      reportedHostname: 'temps-juenes.com',
      url: expect.stringMatching(/^https:\/\/harborview\..+\/secure-document-access$/),
      heldSend: { kind: 'page', state: 'held', path: 'hosts/host-1/redirects/r1', ageDays: 1 },
    })
    expect(mockNotifyRisk).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'page-held',
        item: { label: 'the redirect from /secure-document-access', path: '/host-1/redirects' },
      }),
    )
  })

  it('lets the same rule fire for an established workspace', async () => {
    await expect(redirect('/secure-document-access', 'https://temps-juenes.com/')).resolves.toEqual({
      outcome: 'serve',
    })
    expect(store.size).toBe(0)
  })

  it('holds a destination that wears a brand for every workspace, and fires once staff release it', async () => {
    await expect(redirect('/login', 'https://sharepoint-files.example.top/')).resolves.toMatchObject({
      outcome: 'held',
    })
    const id = String(pageRow()?.id)
    await decideHeldOutboundSend({ reviewId: id, decision: 'release', actorUid: 's', actorEmail: null })
    resetHostedPageReviewMemoForTests()
    await expect(redirect('/login', 'https://sharepoint-files.example.top/')).resolves.toEqual({
      outcome: 'serve',
    })
  })

  it('fails CLOSED when the review of a flagged rule cannot finish', async () => {
    mockGetOrgForHost.mockRejectedValueOnce(new Error('down'))
    await expect(redirect('/secure-document-access', 'https://temps-juenes.com/')).resolves.toMatchObject({
      outcome: 'held',
    })
  })
})

describe('the last clean version', () => {
  it('is noted once per version and read back as a hint', async () => {
    await expect(servedPageVersion('host-1', 'screen-1')).resolves.toBeNull()
    await recordServedPageVersion('host-1', 'screen-1', 'v1')
    await expect(servedPageVersion('host-1', 'screen-1')).resolves.toBe('v1')
    await recordServedPageVersion('host-1', 'screen-1', 'v2')
    await expect(servedPageVersion('host-1', 'screen-1')).resolves.toBe('v2')
  })
})

describe('a custom domain that wears a brand', () => {
  it('is flagged to staff, once, and an ordinary domain is not', async () => {
    await expect(
      flagLookalikeCustomDomain({ hostId: 'host-1', orgId: 'org-1', domain: 'paypal-secure.com' }),
    ).resolves.toBe('flagged')
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      reportedHostname: 'paypal-secure.com',
      status: 'open',
      reportCount: 1,
    })
    await flagLookalikeCustomDomain({ hostId: 'host-1', orgId: 'org-1', domain: 'paypal-secure.com' })
    expect(pageRow()?.['reportCount']).toBe(2)
    expect(mockNotifyRisk).toHaveBeenCalledTimes(1)

    await expect(
      flagLookalikeCustomDomain({ hostId: 'host-1', orgId: 'org-1', domain: 'harborviewhotel.com' }),
    ).resolves.toBe('clean')
  })
})

describe('a sending domain that wears a brand (AGL-3362)', () => {
  it('is flagged to staff under the workspace, once, with its own wording', async () => {
    await expect(
      flagLookalikeDomain({ kind: 'sending', hostId: null, orgId: 'org-1', domain: 'paypa1.com' }),
    ).resolves.toBe('flagged')
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      orgId: 'org-1',
      hostId: null,
      reportedHostname: 'paypa1.com',
      details: expect.stringContaining('send email from'),
    })
    await flagLookalikeDomain({ kind: 'sending', hostId: null, orgId: 'org-1', domain: 'paypa1.com' })
    expect(pageRow()?.['reportCount']).toBe(2)
    expect(mockNotifyRisk).toHaveBeenCalledTimes(1)
    expect(mockNotifyRisk.mock.calls[0][0]).toMatchObject({
      kind: 'domain-flagged',
      orgId: 'org-1',
      item: { label: 'the sending domain paypa1.com', path: '/org/emails/sending' },
      staffEvidence: expect.stringContaining('Sending domain'),
    })
    // The owners' words never name the brand the domain resembles.
    expect(JSON.stringify((mockNotifyRisk.mock.calls[0][0] as { item: unknown }).item)).not.toMatch(/paypal/i)
  })

  it('leaves an ordinary sending domain alone', async () => {
    await expect(
      flagLookalikeDomain({ kind: 'sending', hostId: null, orgId: 'org-1', domain: 'mail.harborviewhotel.com' }),
    ).resolves.toBe('clean')
    expect(store.size).toBe(0)
  })
})

describe('a commerce link that wears a brand (AGL-3363)', () => {
  it('is flagged once, and staff and the site’s managers are both told, with no rule in it', async () => {
    mockNotifyRisk.mockClear()
    const link = {
      kind: 'link' as const,
      hostId: 'host-1',
      orgId: null,
      domain: 'paypal-account-verify.com',
      where: "a product's download link",
    }
    await expect(flagLookalikeDomain(link)).resolves.toBe('flagged')
    await flagLookalikeDomain(link)
    // One notice through the seam (AGL-3368): staff and the site's managers.
    expect(mockNotifyRisk).toHaveBeenCalledTimes(1)
    const input = mockNotifyRisk.mock.calls[0][0] as {
      kind: 'link-blocked'
      hostId: string
      item: { label: string }
      staffEvidence: string
    }
    expect(input).toMatchObject({ kind: 'link-blocked', hostId: 'host-1', item: { path: '/host-1/products' } })
    expect(input.staffEvidence).toMatch(/looks like PayPal/)
    const told = renderOwnerRiskNotice('link-blocked', { 'item.label': input.item.label })
    expect(told.steps.join(' ')).toMatch(/Replace it/)
    expect(Object.values(told).flat().join(' ')).not.toMatch(/lookalike|screen|rule/i)
  })

  it('leaves the shop’s own file host alone (false-positive guard)', async () => {
    await expect(
      flagLookalikeDomain({ kind: 'link', hostId: 'host-1', orgId: null, domain: 'files.harborviewhotel.com' }),
    ).resolves.toBe('clean')
  })
})

/**
 * Every held or flagged page NAMED (AGL-3374). The row that started this
 * said "https://aglyn.com/" for a collection entry template, because the only
 * address the review looked up was the routing map's, and a template has none.
 */
describe('naming the held page', () => {
  type Notified = {
    kind: string
    item: { label: string; path: string }
    page: { kind: string; visitorView: string; source: unknown }
    staffEvidence?: string
  }
  const notified = () => mockNotifyRisk.mock.calls[0]?.[0] as Notified
  const young = () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
  }
  const reviewAs = (screenId: string, page: Parameters<typeof reviewHostedPage>[0]['page'], versionId = 'v2') =>
    reviewHostedPage({ hostId: 'host-1', screenId, versionId, nodes: LOOKALIKE_PAGE, nowMs: NOW, page })

  it('names a routed page by its name and route, not by a bare URL', async () => {
    young()
    await reviewAs('screen-1', { screen: { displayName: 'Review file' } })
    expect(notified()).toMatchObject({
      kind: 'page-held',
      item: {
        label: 'the "Review file" page (/reviewfile)',
        path: '/host-1/screens/screen-1/versions/v2/view',
      },
      page: { kind: 'screen', visitorView: 'not-found' },
    })
    expect(pageRow()?.['url']).toMatch(/^https:\/\/harborview\.[^/]+\/reviewfile$/)
  })

  it('names a collection ENTRY template by its name and route pattern, with the entry that tripped it — never the site root', async () => {
    young()
    await reviewAs('IhmjX3ymSg', {
      screen: { displayName: 'Video detail', kind: 'template' },
      template: {
        role: 'entry',
        route: '/videos/:slug',
        collectionName: 'Videos',
        entryPath: '/videos/intro',
        fallback: 'built-in-design',
      },
    })
    const row = pageRow() as Record<string, any>
    expect(notified().item).toEqual({
      label: 'the "Video detail" template (/videos/:slug)',
      path: '/host-1/screens/IhmjX3ymSg/versions/v2/view',
    })
    expect(notified().page).toMatchObject({ kind: 'entry-template', visitorView: 'built-in-design' })
    expect(row['url']).toMatch(/^https:\/\/harborview\.[^/]+\/videos\/intro$/)
    expect(row['url']).not.toMatch(/\/$/)
    expect(row['heldSend']['subject']).toBe('the "Video detail" template (/videos/:slug)')
    expect(row['details']).toContain('the "Video detail" template (/videos/:slug) of "Harbor View Hotel".')
    expect(row['details']).toMatch(/Found while showing https:\/\/harborview\.[^/]+\/videos\/intro\./)
    expect(row['heldPage']['subject']).toMatchObject({ kind: 'entry-template', route: '/videos/:slug' })
  })

  it('finds a template’s collection route itself when the caller did not say (a list template)', async () => {
    young()
    store.set('hosts/host-1/collections/c1', { slug: 'blog', displayName: 'Blog', listScreenId: 'list-1' })
    await reviewAs('list-1', { screen: { displayName: 'Blog list' } })
    expect(notified().item.label).toBe('the "Blog list" list template (/blog)')
    expect(notified().page).toMatchObject({ kind: 'list-template', visitorView: 'built-in-design' })
  })

  it('names the LAYOUT the flagged content lives in, and sends the owner there', async () => {
    young()
    await reviewAs('screen-1', {
      screen: { displayName: 'About' },
      parts: async () => [
        { type: 'screen', id: 'screen-1', nodes: CLEAN_PAGE },
        { type: 'layout', id: 'main', name: 'Main', nodes: LOOKALIKE_PAGE },
      ],
    })
    expect(notified().item).toEqual({
      label: 'the "About" page (/reviewfile)',
      path: '/host-1/layouts/main',
    })
    expect(notified().page.source).toMatchObject({ type: 'layout', id: 'main', name: 'Main' })
    expect(String(pageRow()?.['details'])).toMatch(/The flagged content is in the layout "Main"/)
  })

  it('names the COMPONENT when neither the page nor its layout carries it', async () => {
    young()
    store.set('hosts/host-1/components/hdr', { displayName: 'Header' })
    await reviewAs('screen-1', {
      screen: { displayName: 'About' },
      parts: async () => [
        { type: 'screen', id: 'screen-1', nodes: CLEAN_PAGE },
        { type: 'layout', id: 'main', name: 'Main', nodes: CLEAN_PAGE },
        { type: 'component', id: 'hdr', nodes: LOOKALIKE_PAGE },
      ],
    })
    expect(notified().item.path).toBe('/host-1/components/hdr')
    expect(notified().page.source).toMatchObject({ type: 'component', id: 'hdr', name: 'Header' })
  })

  it('blames the page itself when its own nodes carry the content', async () => {
    young()
    await reviewAs('screen-1', {
      screen: { displayName: 'About' },
      parts: async () => [
        { type: 'screen', id: 'screen-1', nodes: LOOKALIKE_PAGE },
        { type: 'layout', id: 'main', name: 'Main', nodes: LOOKALIKE_PAGE },
      ],
    })
    expect(notified().page.source).toBeNull()
    expect(notified().item.path).toBe('/host-1/screens/screen-1/versions/v2/view')
  })

  it('names an experiment VARIANT, whose visitors get the published page meanwhile', async () => {
    young()
    await reviewAs('screen-1', {
      screen: { displayName: 'Pricing' },
      variant: { experimentId: 'exp-1', variantId: 'b', name: 'B' },
    })
    expect(notified().item.label).toBe('variant "B" of the "Pricing" page (/reviewfile)')
    expect(notified().page).toMatchObject({ kind: 'variant', visitorView: 'published-version' })
  })

  it('names a flagged LIVE page too, and says it is still serving', async () => {
    await reviewAs('IhmjX3ymSg', {
      screen: { displayName: 'Video detail', kind: 'template' },
      template: { role: 'entry', route: '/videos/:slug', entryPath: '/videos/intro' },
    })
    expect(notified()).toMatchObject({
      kind: 'page-flagged',
      item: { label: 'the "Video detail" template (/videos/:slug)' },
      page: { kind: 'entry-template', visitorView: 'live' },
    })
    expect(String(pageRow()?.['details'])).toMatch(/^LIVE: the "Video detail" template/)
  })

  it('describes a row once: a later filing reuses what the row already says', async () => {
    young()
    const parts = jest.fn(async () => [{ type: 'screen' as const, id: 'screen-1', nodes: LOOKALIKE_PAGE }])
    await reviewAs('screen-1', { screen: { displayName: 'About' }, parts })
    resetHostedPageReviewMemoForTests()
    await reviewAs('screen-1', { screen: { displayName: 'About' }, parts })
    expect(parts).toHaveBeenCalledTimes(1)
  })
})
