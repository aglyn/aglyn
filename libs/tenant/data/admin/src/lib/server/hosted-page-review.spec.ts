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

const docRef = (path: string): Record<string, unknown> => ({
  path,
  get: async () => snapshotOf(path),
  set: async (value: Doc) => write(path, value),
  collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
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

const mockNotifyStaff = jest.fn(async (_payload: unknown) => undefined)
const mockNotifyManagers = jest.fn(async (_hostId: string, _payload: unknown) => undefined)
jest.mock('./notifications', () => ({
  __esModule: true,
  notifyStaff: (payload: unknown) => mockNotifyStaff(payload),
  notifyHostManagers: (hostId: string, payload: unknown) => mockNotifyManagers(hostId, payload),
}))

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
  mockNotifyStaff.mockClear()
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

  it('holds a lookalike link for an ESTABLISHED workspace and files a `page` row with its URL', async () => {
    const answer = await review(LOOKALIKE_PAGE)
    expect(answer).toMatchObject({ outcome: 'held', reference: expect.stringMatching(/^HS-/) })
    expect(pageRow()).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      status: 'open',
      hostId: 'host-1',
      orgId: 'org-1',
      url: expect.stringMatching(/^https:\/\/harborview\..+\/reviewfile$/),
      reportedHostname: 'poshmark.id63835663.shop',
      heldPage: { screenId: 'screen-1', versionId: 'v2' },
      heldSend: { kind: 'page', state: 'held', path: 'hosts/host-1/screens/screen-1', ageDays: 400 },
    })
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('serves an established workspace’s page that only the soft rules flag', async () => {
    await expect(review(LURE_PAGE)).resolves.toEqual({ outcome: 'serve' })
    expect(store.size).toBe(0)
  })

  it('holds the same soft-rule page from a workspace in its first fortnight', async () => {
    mockOrg = { name: 'Harbor View', createdAt: NOW - 2 * DAY }
    await expect(review(LURE_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    expect(pageRow()?.['heldSend']).toMatchObject({
      signals: [expect.objectContaining({ code: 'brand-action-page', brand: 'docusign' })],
    })
  })

  it('serves once staff release it, and stays unserved once they reject it', async () => {
    await review(LOOKALIKE_PAGE)
    const id = String(pageRow()?.id)
    await decideHeldOutboundSend({ reviewId: id, decision: 'release', actorUid: 's', actorEmail: null })
    resetHostedPageReviewMemoForTests()
    await expect(review(LOOKALIKE_PAGE, 'v3')).resolves.toEqual({ outcome: 'serve' })

    await decideHeldOutboundSend({ reviewId: id, decision: 'reject', actorUid: 's', actorEmail: null })
    resetHostedPageReviewMemoForTests()
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({ outcome: 'rejected' })
  })

  it('fails CLOSED for a strong signal when the store is down, OPEN for a soft one', async () => {
    failWrites = true
    await expect(review(LOOKALIKE_PAGE)).resolves.toMatchObject({ outcome: 'held' })
    mockGetOrgForHost.mockRejectedValueOnce(new Error('down'))
    await expect(review(LURE_PAGE)).resolves.toEqual({ outcome: 'serve' })
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
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)

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
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    expect(mockNotifyStaff.mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('Sending domain'),
    })
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
    mockNotifyStaff.mockClear()
    mockNotifyManagers.mockClear()
    const link = {
      kind: 'link' as const,
      hostId: 'host-1',
      orgId: null,
      domain: 'paypal-account-verify.com',
      where: "a product's download link",
    }
    await expect(flagLookalikeDomain(link)).resolves.toBe('flagged')
    await flagLookalikeDomain(link)
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    expect(mockNotifyManagers).toHaveBeenCalledTimes(1)
    const [hostId, payload] = mockNotifyManagers.mock.calls[0] as [string, { body: string }]
    expect(hostId).toBe('host-1')
    expect(payload.body).toMatch(/Replace it/)
    expect(payload.body).not.toMatch(/lookalike|screen|rule/i)
  })

  it('leaves the shop’s own file host alone (false-positive guard)', async () => {
    await expect(
      flagLookalikeDomain({ kind: 'link', hostId: 'host-1', orgId: null, domain: 'files.harborviewhotel.com' }),
    ).resolves.toBe('clean')
  })
})
