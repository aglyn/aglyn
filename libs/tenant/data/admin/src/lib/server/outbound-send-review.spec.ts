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
 * Held for review (AGL-3356): what happens after the phishing screen says a
 * young workspace's message is suspect — the review row, the staff alert,
 * and the release or rejection that decides it. The screen itself is real;
 * only the store is faked.
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
let failWrites = false


const isIncrement = (value: unknown): value is { __increment: number } =>
  Boolean(value) && typeof (value as { __increment?: unknown }).__increment === 'number'

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function write(path: string, value: Doc) {
  if (failWrites) throw new Error('firestore unavailable')
  const next: Doc = { ...(store.get(path) ?? {}) }
  for (const [key, entry] of Object.entries(value)) {
    if ((entry as { __delete?: boolean })?.__delete === true) delete next[key]
    else if (isIncrement(entry)) next[key] = Number(next[key] ?? 0) + entry.__increment
    else if (entry === 'server-timestamp') next[key] = 1
    else next[key] = entry
  }
  store.set(path, next)
}

const docRef = (path: string) => ({
  path,
  get: async () => snapshotOf(path),
  set: async (value: Doc) => write(path, value),
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
jest.mock('./notifications', () => ({
  __esModule: true,
  notifyStaff: (payload: unknown) => mockNotifyStaff(payload),
}))

import {
  decideHeldOutboundSend,
  HELD_SEND_AT_MS,
  heldOutboundReviewId,
  isYoungWorkspace,
  screenOutboundSend,
  type OutboundScreenRequest,
} from './outbound-send-review'

const NOW = Date.UTC(2026, 8, 28)
const DAY = 24 * 60 * 60 * 1000
const SEND_PATH = 'orgs/org-1/campaigns/send-1'

/** The incident's workflow email, from a workspace two days old. */
const request = (overrides: Partial<OutboundScreenRequest> = {}): OutboundScreenRequest => ({
  kind: 'workflow',
  path: 'hosts/host-1/workflows/wf-1',
  hostId: 'host-1',
  orgId: 'org-1',
  org: { name: 'Frank Rothe', createdAt: NOW - 2 * DAY },
  host: { subdomain: 'rklp' },
  subject: 'Poshmark Order #88213',
  bodies: [
    'One of the items from your Seller Account has finally sold. ' +
      'Details: https://poshmark.id63835663.shop/o/88213',
  ],
  nowMs: NOW,
  ...overrides,
})

/** The one review row the store holds. */
const reviewRow = () => {
  const key = [...store.keys()].find((entry) => entry.startsWith('abuseReports/'))
  return key ? store.get(key) : undefined
}

beforeEach(() => {
  store.clear()
  failWrites = false
  mockNotifyStaff.mockClear()
})

describe('who is screened', () => {
  it('a workspace under fourteen days old', () => {
    expect(isYoungWorkspace({ createdAt: NOW - 13 * DAY }, NOW)).toBe(true)
    expect(isYoungWorkspace({ createdAt: NOW - 15 * DAY }, NOW)).toBe(false)
  })

  it('not an org whose creation date cannot be read — that is an existing customer', () => {
    expect(isYoungWorkspace({}, NOW)).toBe(false)
    expect(isYoungWorkspace(null, NOW)).toBe(false)
  })

  it('sends an established workspace’s mail without screening it', async () => {
    const answer = await screenOutboundSend(
      request({ org: { name: 'Acme', createdAt: NOW - 90 * DAY } }),
    )
    expect(answer).toEqual({ outcome: 'send' })
    expect(store.size).toBe(0)
  })

  it('sends a young workspace’s clean mail', async () => {
    const answer = await screenOutboundSend(
      request({ subject: 'Welcome!', bodies: ['Thanks for signing up.'] }),
    )
    expect(answer).toEqual({ outcome: 'send' })
    expect(store.size).toBe(0)
  })
})

describe('a hold', () => {
  it('files an urgent phishing row in the abuse queue and tells staff once', async () => {
    const first = await screenOutboundSend(request())
    expect(first).toMatchObject({ outcome: 'held' })
    const row = reviewRow()
    expect(row).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      source: 'outbound-screen',
      status: 'open',
      hostId: 'host-1',
      orgId: 'org-1',
      reportedHostname: 'poshmark.id63835663.shop',
      reportCount: 1,
      reporterEmail: null,
    })
    expect(row?.['heldSend']).toMatchObject({
      kind: 'workflow',
      state: 'held',
      ageDays: 2,
      signals: expect.arrayContaining([
        expect.objectContaining({ code: 'lookalike-link', brand: 'poshmark' }),
      ]),
    })
    expect(String(row?.['details'])).toContain('Dismiss to release')
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    expect(mockNotifyStaff.mock.calls[0][0]).toMatchObject({
      type: 'system.abuseReportUrgent',
      link: '/admin/abuse-reports',
    })

    // The workflow fires again on the next contact: counted, not re-alerted.
    await expect(screenOutboundSend(request())).resolves.toMatchObject({ outcome: 'held' })
    expect(reviewRow()?.['reportCount']).toBe(2)
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('fails OPEN when the queue cannot be written', async () => {
    failWrites = true
    await expect(screenOutboundSend(request())).resolves.toEqual({ outcome: 'send' })
  })
})

describe('the staff decision', () => {
  it('a release lets exactly this content send', async () => {
    const held = await screenOutboundSend(request())
    const reviewId = (held as { reviewId: string }).reviewId
    await expect(
      decideHeldOutboundSend({ reviewId, decision: 'release', actorUid: 'staff-1', actorEmail: null }),
    ).resolves.toBe('released')
    await expect(screenOutboundSend(request())).resolves.toEqual({ outcome: 'send' })

    // Different words are a different review: screened afresh, held again.
    const edited = await screenOutboundSend(
      request({ subject: 'Poshmark Order #99999' }),
    )
    expect(edited).toMatchObject({ outcome: 'held' })
  })

  it('a rejection keeps it from ever sending', async () => {
    const held = await screenOutboundSend(request())
    const reviewId = (held as { reviewId: string }).reviewId
    await decideHeldOutboundSend({ reviewId, decision: 'reject', actorUid: 'staff-1', actorEmail: null })
    await expect(screenOutboundSend(request())).resolves.toMatchObject({ outcome: 'rejected' })
  })

  it('puts a parked campaign back on the clock, or cancels it', async () => {
    const campaign = request({ kind: 'campaign', path: SEND_PATH })
    const held = (await screenOutboundSend(campaign)) as { reviewId: string }
    const park = () =>
      store.set(SEND_PATH, {
        status: 'scheduled',
        sendAtMs: HELD_SEND_AT_MS,
        staffReview: { reviewId: held.reviewId, state: 'held' },
      })

    park()
    await expect(
      decideHeldOutboundSend({
        reviewId: held.reviewId,
        decision: 'release',
        actorUid: 'staff-1',
        actorEmail: 'staff@aglyn.com',
        nowMs: NOW,
      }),
    ).resolves.toBe('released')
    expect(store.get(SEND_PATH)).toMatchObject({
      status: 'scheduled',
      sendAtMs: NOW,
      staffReview: { state: 'released', decidedByEmail: 'staff@aglyn.com' },
    })

    park()
    await decideHeldOutboundSend({
      reviewId: held.reviewId,
      decision: 'reject',
      actorUid: 'staff-1',
      actorEmail: null,
    })
    expect(store.get(SEND_PATH)?.['status']).toBe('canceled')
    expect(store.get(SEND_PATH)?.['sendAtMs']).toBeUndefined()
  })

  it('leaves a campaign alone once it is no longer the parked send', async () => {
    const campaign = request({ kind: 'campaign', path: SEND_PATH })
    const held = (await screenOutboundSend(campaign)) as { reviewId: string }
    store.set(SEND_PATH, { status: 'sent', staffReview: { reviewId: held.reviewId } })
    await expect(
      decideHeldOutboundSend({
        reviewId: held.reviewId,
        decision: 'release',
        actorUid: 'staff-1',
        actorEmail: null,
      }),
    ).resolves.toBe('campaign-moved')
    expect(store.get(SEND_PATH)?.['status']).toBe('sent')
  })

  it('answers not-held for an ordinary intake row', async () => {
    store.set(`abuseReports/${heldOutboundReviewId('x', 'y')}`, { category: 'spam' })
    await expect(
      decideHeldOutboundSend({
        reviewId: heldOutboundReviewId('x', 'y'),
        decision: 'release',
        actorUid: 'staff-1',
        actorEmail: null,
      }),
    ).resolves.toBe('not-held')
  })
})
