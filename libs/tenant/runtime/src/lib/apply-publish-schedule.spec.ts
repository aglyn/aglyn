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
 * AGL-1185 — a due schedule refused for lack of entitlement must be RECORDED,
 * not left pending.
 *
 * The refusal was always correct; what was missing is that it left no trace, so
 * the schedule stayed permanently due and the next beat published it the moment
 * the org upgraded to Business.
 *
 * The case that would be worst to get wrong is the opposite one: marking a
 * schedule that is not due yet. That would cancel a legitimate future publish
 * on any org that happens to be unentitled at the moment a beat runs, and it
 * would look like the feature quietly not working.
 */

// Declares the update payload it is called with, so the cases below can read
// `call[0]` — a zero-arg stub types `mock.calls` as `[][]` (AGL-1323).
const updateMock = jest.fn(async (_data?: Record<string, unknown>) => undefined)
const batchUpdateMock = jest.fn(
  (_ref?: unknown, _data?: Record<string, unknown>) => undefined,
)
const commitMock = jest.fn(async () => undefined)
const ga4Mock = jest.fn(async (_input?: { hostId: string }) => ({
  sent: true,
  synthesizedClientId: true,
}))
let entitled = true

/**
 * Firestore fixture (AGL-1589). The executor now READS before it writes — the
 * host's routing map, then the screen and its ancestors — so the mock has to
 * carry documents rather than only record writes.
 *
 * `routingMap` defaults to an entry for `screen-1`, i.e. a screen whose route
 * is already live. That is the REPUBLISH case, which is what every case
 * predating this issue meant by "a due publish", and keeping it the default
 * is what makes those cases still assert what they were written to assert.
 */
let routingMap: Record<string, string> = {}
let screenDocs: Record<string, Record<string, unknown>> = {}

const docSnapshot = (data?: Record<string, unknown>) => ({
  exists: data !== undefined,
  get: (field: string) => data?.[field],
})

jest.mock('@aglyn/tenant-data-admin', () => {
  const subDoc = (id: string) => ({
    id,
    get: async () => docSnapshot(screenDocs[id]),
    update: updateMock,
  })
  const hostDoc = {
    get: async () => docSnapshot({ screens: routingMap }),
    update: updateMock,
    collection: () => ({ doc: subDoc }),
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({ doc: () => hostDoc }),
          batch: () => ({ update: batchUpdateMock, commit: commitMock }),
        }),
      }),
    },
    getOrgForHost: jest.fn(async () => ({ org: {} })),
    sendGa4SitePublished: (input: { hostId: string }) => ga4Mock(input),
  }
})

// The route helpers are the REAL ones — path composition is the logic this
// issue turns on, and a stubbed `composeScreenRoutePath` would assert nothing.
// Required from the source module rather than through `requireActual` on the
// whole `/server` barrel, which drags in the realm server and the API adapter.
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../aglyn/src/lib/app-utils/screen-route'),
  checkEntitlement: () => entitled,
}))

import { applyDuePublishSchedule } from './apply-publish-schedule'

const schedule = (overrides: Record<string, unknown> = {}) => ({
  versionId: 'v-scheduled',
  action: 'publish' as const,
  // Due an hour ago unless a case says otherwise.
  publishAt: { seconds: Math.floor(Date.now() / 1000) - 3600 },
  status: 'pending' as const,
  ...overrides,
})

const run = (parent: Record<string, unknown>) =>
  applyDuePublishSchedule({
    hostId: 'h1' as never,
    collectionName: 'screens',
    docId: 'screen-1',
    parent: parent as never,
  })

beforeEach(() => {
  updateMock.mockClear()
  batchUpdateMock.mockClear()
  commitMock.mockClear()
  ga4Mock.mockClear()
  entitled = true
  // Already live at /about — see the fixture note above.
  routingMap = { 'screen-1': 'about' }
  screenDocs = { 'screen-1': { slug: 'about' } }
})

describe('a due schedule on an unentitled plan (AGL-1185)', () => {
  beforeEach(() => {
    entitled = false
  })

  it('records the refusal instead of leaving it pending', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unentitled',
    })
  })

  it('still refuses to publish', async () => {
    // The entitlement check is the authority and this must not weaken it: the
    // live pointer stays where it was.
    const result = await run({
      versionId: 'v-live',
      publishSchedule: schedule(),
    })
    expect(result).toBe('v-live')
  })

  it('never flips the version pointer as a side effect of marking', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    for (const call of updateMock.mock.calls) {
      expect(call[0]).not.toHaveProperty('versionId')
    }
  })

  it('does NOT touch a schedule that is not due yet', async () => {
    // The guard that matters most. Marking a future schedule would cancel a
    // legitimate publish and read as the feature silently not working.
    const future = schedule({
      publishAt: { seconds: Math.floor(Date.now() / 1000) + 3600 },
    })
    const result = await run({ versionId: 'v-live', publishSchedule: future })
    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toBe('v-live')
  })

  it('does not reconsider one it has already skipped', async () => {
    // Terminal by design — upgrading must not resurrect a stale publish.
    await run({
      versionId: 'v-live',
      publishSchedule: schedule({ status: 'skipped-unentitled' }),
    })
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('a due schedule on an entitled plan', () => {
  it('still publishes — the refusal path must not have broken the happy one', async () => {
    const result = await run({
      versionId: 'v-live',
      publishSchedule: schedule(),
    })
    expect(result).toBe('v-scheduled')
    expect(updateMock).toHaveBeenCalledWith({
      versionId: 'v-scheduled',
      'publishSchedule.status': 'applied',
    })
  })

  it('never writes the skipped status', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    for (const call of updateMock.mock.calls) {
      expect(call[0]).not.toEqual({
        'publishSchedule.status': 'skipped-unentitled',
      })
    }
  })
})

/**
 * AGL-1562 asked whether a due schedule should report the `site_published`
 * activation event over the Measurement Protocol, since this executor runs
 * with no browser and client-side GA cannot see it.
 *
 * The answer WAS no, and it rested on a fact that turned out to be a bug: a
 * due publish wrote the version pointer and the schedule status and nothing
 * else, never the host's `screens` routing map — so it could only ever swap
 * which saved version an ALREADY-LIVE route served, which AGL-1561 excludes
 * from the activation metric ("only a route going live counts").
 *
 * It was pinned as a spec rather than a comment precisely so the reasoning
 * could not expire quietly, and AGL-1589 expired it: the executor now
 * registers the routing entry, a scheduled FIRST publish genuinely makes a
 * page reachable, and it is an activation no browser is present to report.
 *
 * So the cases below now assert the OTHER half of the same argument — that
 * the distinction between a first publish and a republish is real and is what
 * the event is gated on. A republish must still send nothing, or one
 * activated org looks like many.
 */
describe('activation reporting follows the routing map (AGL-1562, AGL-1589)', () => {
  it('reports nothing for a REPUBLISH — the route was already live', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(updateMock).toHaveBeenCalledWith({
      versionId: 'v-scheduled',
      'publishSchedule.status': 'applied',
    })
    // No routing-map key: the entry exists already and nothing went live.
    for (const call of [...updateMock.mock.calls, ...batchUpdateMock.mock.calls])
      for (const key of Object.keys((call[0] ?? {}) as object))
        expect(key.startsWith('screens.')).toBe(false)
    expect(ga4Mock).not.toHaveBeenCalled()
  })

  it('reports the activation for a FIRST publish — no browser will', async () => {
    routingMap = {}
    screenDocs = { 'screen-1': { slug: 'about' } }

    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(ga4Mock).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('publishes nothing at all for a layout, which has no route to go live', async () => {
    const result = await applyDuePublishSchedule({
      hostId: 'h1' as never,
      collectionName: 'layouts',
      docId: 'layout-1',
      parent: {
        versionId: 'v-live',
        publishSchedule: schedule({ action: 'unpublish' }),
      } as never,
    })

    // The unpublish branch is screens-only; a layout keeps serving and the
    // routing map is not involved either way.
    expect(result).toBe('v-live')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('never registers a route for a layout, which has no address', async () => {
    const result = await applyDuePublishSchedule({
      hostId: 'h1' as never,
      collectionName: 'layouts',
      docId: 'layout-1',
      parent: { versionId: 'v-live', publishSchedule: schedule() } as never,
    })

    expect(result).toBe('v-scheduled')
    expect(updateMock).toHaveBeenCalledWith({
      versionId: 'v-scheduled',
      'publishSchedule.status': 'applied',
    })
    expect(batchUpdateMock).not.toHaveBeenCalled()
    expect(ga4Mock).not.toHaveBeenCalled()
  })
})

/**
 * AGL-1589 — a scheduled FIRST publish has to make the page reachable.
 *
 * The bug was silent in the worst direction: the schedule flipped to
 * `applied`, the version pointer moved, the activity log said published, and
 * the URL kept 404ing because the host's routing map — the only thing that
 * decides which paths exist — was never written. A republish worked, which is
 * why nobody reported it.
 *
 * The refusals matter as much as the happy path. A publish the executor
 * cannot give an address to must SAY so; a silent no-op is the bug, and
 * re-introducing it in a new shape (declining without recording) would be the
 * same failure with better manners.
 */
describe('a scheduled first publish registers the route (AGL-1589)', () => {
  beforeEach(() => {
    routingMap = {}
  })

  it('writes the composed path, the pointer and publishedAt in ONE commit', async () => {
    screenDocs = { 'screen-1': { slug: 'about' } }

    const result = await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(result).toBe('v-scheduled')
    expect(batchUpdateMock).toHaveBeenCalledTimes(2)
    const [hostCall, screenCall] = batchUpdateMock.mock.calls
    expect(hostCall[1]).toEqual({ 'screens.screen-1': 'about' })
    expect(screenCall[1]).toMatchObject({
      versionId: 'v-scheduled',
      'publishSchedule.status': 'applied',
    })
    // `publishedAt` mirrors `publishScreenRoute` — the route went live now.
    expect(screenCall[1]).toHaveProperty('publishedAt')
    expect(commitMock).toHaveBeenCalledTimes(1)
    // Atomic on purpose: `applied` is terminal, so an `applied` status with no
    // routing entry would be permanent. Nothing may be written outside the
    // batch.
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('publishes a home page at the root path, agreeing with AGL-1575', async () => {
    screenDocs = { 'screen-1': { slug: '/' } }

    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(batchUpdateMock.mock.calls[0][1]).toEqual({ 'screens.screen-1': '/' })
  })

  it('composes the ancestor chain, not just the screen’s own slug', async () => {
    screenDocs = {
      'screen-1': { slug: 'about', parentId: 'parent-1' },
      'parent-1': { slug: 'company' },
    }

    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(batchUpdateMock.mock.calls[0][1]).toEqual({
      'screens.screen-1': 'company/about',
    })
  })

  it('declines and RECORDS it when the screen has no address', async () => {
    screenDocs = { 'screen-1': {} }

    const result = await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unroutable',
    })
    // Declined means declined: the live pointer does not move, so the console
    // cannot show a version as published at a path that does not exist.
    expect(result).toBe('v-live')
    expect(commitMock).not.toHaveBeenCalled()
    expect(ga4Mock).not.toHaveBeenCalled()
  })

  it('declines when an ancestor has no slug — the path cannot compose', async () => {
    screenDocs = {
      'screen-1': { slug: 'about', parentId: 'parent-1' },
      'parent-1': {},
    }

    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unroutable',
    })
  })

  it('declines rather than take an address another screen already holds', async () => {
    // The interactive path refuses this with a message. Registering it anyway
    // would put two screens at one path and could take a LIVE page off the
    // site — a worse bug than the one being fixed.
    routingMap = { 'screen-9': 'about' }
    screenDocs = { 'screen-1': { slug: 'about' } }

    const result = await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unroutable',
    })
    expect(result).toBe('v-live')
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('never routes an email document, which has no URL and would become billable', async () => {
    screenDocs = { 'screen-1': { slug: 'newsletter', kind: 'email' } }

    await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unroutable',
    })
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('leaves the schedule PENDING when the routing read fails', async () => {
    // Fail-open: an unanswerable routing question must not become an
    // `applied` status, because `applied` never retries. The next beat does.
    screenDocs = {
      get 'screen-1'(): Record<string, unknown> {
        throw new Error('unavailable')
      },
    } as never

    const result = await run({ versionId: 'v-live', publishSchedule: schedule() })

    expect(result).toBe('v-live')
    expect(updateMock).not.toHaveBeenCalled()
    expect(commitMock).not.toHaveBeenCalled()
  })
})
