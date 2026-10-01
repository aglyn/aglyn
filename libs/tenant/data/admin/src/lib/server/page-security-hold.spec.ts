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
 * A held page from a young workspace asks for an automatic security hold
 * (AGL-3450); an established workspace's held page does not. The page screen
 * and the review are real; only the store and the workspace reads are faked.
 * Placing the hold is the console's half (`apps/console/specs/page-security-hold.spec.ts`).
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
let failTransactions = false

const isIncrement = (value: unknown): value is { __increment: number } =>
  Boolean(value) && typeof (value as { __increment?: unknown }).__increment === 'number'

function snapshotOf(path: string) {
  const data = store.get(path)
  return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
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

const docRef = (path: string): Record<string, unknown> => ({
  path,
  get: async () => snapshotOf(path),
  set: async (value: Doc) => write(path, value),
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${path}/${name}/${id}`),
    where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
  }),
})

const db = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  doc: (path: string) => docRef(path),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) => {
    if (failTransactions) throw new Error('firestore unavailable')
    return work({
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      set: (ref: { path: string }, value: Doc) => write(ref.path, value),
    })
  },
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

jest.mock('./risk-notice', () => ({
  __esModule: true,
  notifyRiskEvent: async () => undefined,
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 1)
let mockOrg: Doc = { name: 'Review', createdAt: NOW - 3 * DAY, hosts: { 'host-1': true } }
const mockHost: Doc = { name: 'Review', subdomain: 'review' }
jest.mock('./organizations', () => ({
  __esModule: true,
  getHostDocAdmin: async () => mockHost,
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
}))

import { resetHostedPageReviewMemoForTests, reviewHostedPage } from './hosted-page-review'
import {
  requestPageSecurityHold,
  resetPageSecurityHoldMemoForTests,
  SECURITY_HOLD_COLLECTION,
} from './page-security-hold'

const node = (componentId: string, props: Doc) => ({ componentId, props })
/** The 2026-10-01 incidents' shape: a document-share portal asking for a password. */
const HARVESTER_PAGE = {
  a: node('muiTypography', { children: 'Secure Document Access Portal' }),
  b: node('formTextField', { fieldType: 'password', label: 'Email password' }),
  c: node('muiButton', { children: 'View file', href: 'https://temps-juenes.example/login' }),
}

const review = (screenId = 'screen-1', versionId = 'v1') =>
  reviewHostedPage({ hostId: 'host-1', screenId, versionId, nodes: HARVESTER_PAGE, nowMs: NOW })

const holdDocs = () => [...store.keys()].filter((key) => key.startsWith(`${SECURITY_HOLD_COLLECTION}/`))

beforeEach(() => {
  store.clear()
  failTransactions = false
  mockOrg = { name: 'Review', createdAt: NOW - 3 * DAY, hosts: { 'host-1': true } }
  delete process.env['PLATFORM_MARKETING_HOST_ID']
  resetHostedPageReviewMemoForTests()
  resetPageSecurityHoldMemoForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a held page and the automatic security hold', () => {
  it('a young workspace’s held page records one pending hold, naming the page, the signal and the abuse row', async () => {
    const outcome = await review()
    expect(outcome).toMatchObject({ outcome: 'held' })
    expect(holdDocs()).toEqual([`${SECURITY_HOLD_COLLECTION}/org-1`])
    const hold = store.get(`${SECURITY_HOLD_COLLECTION}/org-1`) as Doc
    expect(hold).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      screenId: 'screen-1',
      versionId: 'v1',
      state: 'pending',
      ageDays: 3,
      reviewId: (outcome as { reviewId: string }).reviewId,
      reference: (outcome as { reference: string }).reference,
    })
    expect(String(hold['evidence'])).toContain('password')
    expect((hold['signals'] as Array<{ code: string }>).map((signal) => signal.code)).toContain('credential-field')
  })

  it('a second held page from the same workspace does not ask again', async () => {
    await review('screen-1')
    const first = { ...(store.get(`${SECURITY_HOLD_COLLECTION}/org-1`) as Doc) }
    resetHostedPageReviewMemoForTests()
    resetPageSecurityHoldMemoForTests()
    await review('screen-2', 'v9')
    expect(holdDocs()).toHaveLength(1)
    expect(store.get(`${SECURITY_HOLD_COLLECTION}/org-1`)).toEqual(first)
  })

  it('an established workspace’s held page records no hold', async () => {
    mockOrg = { name: 'Review', createdAt: NOW - 400 * DAY }
    // New content (no version ever served clean, page new) still holds…
    store.set('hosts/host-1/screens/screen-1', { createdAt: NOW - DAY })
    await expect(review()).resolves.toMatchObject({ outcome: 'held' })
    // …and places no lock.
    expect(holdDocs()).toEqual([])
  })

  it('never holds the house workspace', async () => {
    process.env['PLATFORM_MARKETING_HOST_ID'] = 'host-1'
    await expect(review()).resolves.toMatchObject({ outcome: 'held' })
    expect(holdDocs()).toEqual([])
  })

  it('answers each request without throwing, whatever the store does', async () => {
    const request = {
      orgId: 'org-9',
      hostId: 'host-9',
      screenId: 's',
      versionId: 'v',
      reviewId: 'r',
      reference: 'HS-R',
      signals: [],
      ageDays: 1,
      pageLabel: 'the page',
      pageUrl: null,
      siteName: null,
    }
    await expect(requestPageSecurityHold({ ...request, ageDays: 30 })).resolves.toBe('not-young')
    await expect(requestPageSecurityHold({ ...request, ageDays: null })).resolves.toBe('not-young')
    await expect(requestPageSecurityHold({ ...request, orgId: '' })).resolves.toBe('no-workspace')
    failTransactions = true
    await expect(requestPageSecurityHold(request)).resolves.toBe('failed')
    failTransactions = false
    await expect(requestPageSecurityHold(request)).resolves.toBe('requested')
    resetPageSecurityHoldMemoForTests()
    await expect(requestPageSecurityHold(request)).resolves.toBe('exists')
  })
})
