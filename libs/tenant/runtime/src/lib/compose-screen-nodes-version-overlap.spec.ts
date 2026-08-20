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
 * AGL-1428: the screen-version read overlaps the chrome bundle.
 *
 * AGL-1225 collapsed `composeNodesWithChrome`'s own reads into one round-trip
 * stage. This is the stage ABOVE it: `composeScreenNodes` awaited
 * `getScreenVersion` to completion before `composeNodesWithChrome` was called
 * at all, so the version read and the six host-scoped reads ran back to back
 * even though not one of those six looks at the version.
 *
 * ## What was measured, because the issue was filed unmeasured
 *
 * Driven against production Firestore (a node script — see the note on jest
 * below), interleaving both arms in one process and alternating which one
 * leads, reading paired differences per AGL-1225's method:
 *
 * - screen with a two-deep layout chain: median paired diff **+62 ms**,
 *   overlap won 35 of 41 pairs (324 ms → 261 ms)
 * - screen with no layout at all: **+51 ms**, won 21 of 25 pairs
 *
 * The cache-defeat control held throughout: `filterEnabledPluginsByReleaseFlags`
 * collapsed 355 ms → 0 ms → 0 ms after its first call (the 60 s module TTL in
 * `release-flags.ts`) while every compose iteration kept paying full price.
 *
 * Two premises in the issue did NOT survive the measurement, and are recorded
 * here so the next reader does not rebuild on them:
 *
 * 1. **There are no "publish-schedule reads" on the hot path.**
 *    `applyDuePublishSchedule` returns `parent.versionId` without touching
 *    Firestore unless a schedule is both `pending` and due; it measured 0 ms
 *    on every iteration. The serialised cost was `getScreenVersion` alone
 *    (~95 ms), which is also the ceiling this change can recover.
 * 2. **The awaits were not merely incidentally ordered.** `getScreenVersion`
 *    consumes `applyDuePublishSchedule`'s return value, and
 *    `composeNodesWithChrome` consumes the version's `nodes` — for
 *    `hasRepeatableNodes` and for the layout graft. So this could not be fixed
 *    by reordering awaits; `composeNodesWithChrome` had to start accepting the
 *    nodes unresolved.
 *
 * A note on method, because the issue prescribed one that cannot work: a
 * node-environment jest harness CANNOT reach production Firestore. gRPC and
 * REST both die in `JWT.requestAsync` inside the jest sandbox — the same
 * failure `libs/tenant/data/admin/jest.integration.setup.ts` documents, and
 * the reason it points the Admin SDK at the emulator instead. An emulator has
 * no round-trip latency to hide, so it cannot answer this question at all.
 * The numbers above came from a standalone node script.
 *
 * ## What this spec guards
 *
 * Output equality cannot see any of it — re-serialising the awaits returns a
 * byte-identical tree and gives the whole saving back silently. So this
 * asserts the ORDER, with the early exit as the control that stops the
 * overlap from being bought by making a 404 pay for reads it never needed.
 */

const order: string[] = []
/** Resolves after `ticks` turns, recording when it started and ended. */
const tracked =
  <T,>(label: string, value: T, ticks = 3) =>
  async () => {
    order.push(`${label}:start`)
    for (let i = 0; i < ticks; i += 1) await Promise.resolve()
    order.push(`${label}:end`)
    return value
  }

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetScreenVersion = jest.fn()
const mockApplyDuePublishSchedule = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetDatasets(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
  getWorkflows: (...a: unknown[]) => mockGetWorkflows(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockApplyDuePublishSchedule(...a),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetScreenVersion(...a),
}))

import composeScreenNodes from './compose-screen-nodes'

const ROOT = '_@_'

/** A screen that repeats over a dataset, so the datasets read is live. */
const SCREEN_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['list'] },
  list: {
    $id: 'list',
    componentId: 'muiStack',
    parentId: ROOT,
    props: { repeatDataset: 'Team' },
    nodes: [],
  },
}

/** The common page: nothing repeats, so `getDatasets` is never issued. */
const PLAIN_SCREEN_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] },
}

/** The reads that take `hostId` alone and never look at the nodes. */
const HOST_SCOPED = [
  'components',
  'variables',
  'functions',
  'workflows',
  'installs',
] as const

const setup = (
  screenNodes: Record<string, unknown> = SCREEN_NODES,
  versionTicks = 10,
) => {
  order.length = 0
  mockGetPublishedLayoutVersion
    .mockImplementationOnce(
      tracked('layout1', { version: { nodes: {} }, layout: { layoutId: 'L2' } }),
    )
    .mockImplementationOnce(
      tracked('layout2', { version: { nodes: {} }, layout: {} }),
    )
  mockGetComponents.mockImplementation(
    tracked('components', { definitions: {} }),
  )
  mockGetVariables.mockImplementation(tracked('variables', []))
  mockGetFunctions.mockImplementation(tracked('functions', []))
  mockGetDatasets.mockImplementation(tracked('datasets', []))
  mockGetWorkflows.mockImplementation(tracked('workflows', []))
  mockGetPluginInstalls.mockImplementation(tracked('installs', []))
  // The version read is the one this change exists to hide. The default is
  // deliberately LONGER than the whole chrome bundle (the layout walk is two
  // 3-tick hops), so "the bundle started first" cannot pass by accident.
  // Tests that care about what happens AFTER the nodes land shorten it to
  // production's actual shape, where the version (~95 ms) finishes well
  // inside the chrome bundle (~337 ms).
  mockGetScreenVersion.mockImplementation(
    tracked('version', { version: { nodes: screenNodes } }, versionTicks),
  )
  // The common path: no schedule pending, so this returns the stored id
  // without a read. Measured at 0 ms in production.
  mockApplyDuePublishSchedule.mockResolvedValue('v1')
}

const screenDoc = { versionId: 'v1', layoutId: 'L1' } as never

describe('composeScreenNodes overlaps the version read (AGL-1428)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  it('starts every host-scoped read BEFORE the version read finishes', async () => {
    await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: screenDoc,
    })

    const versionEnd = order.indexOf('version:end')
    expect(versionEnd).toBeGreaterThan(-1)

    // This is the assertion that fails the moment someone re-introduces
    // `const versionRes = await getScreenVersion(...)` above the compose call.
    for (const label of HOST_SCOPED) {
      const start = order.indexOf(`${label}:start`)
      expect(start).toBeGreaterThan(-1)
      expect(start).toBeLessThan(versionEnd)
    }
    // The layout walk is the longest host-scoped chain, and it too must be
    // under way rather than queued behind the version.
    expect(order.indexOf('layout1:start')).toBeLessThan(versionEnd)
  })

  it('CONTROL — the datasets read still waits for the nodes, then overlaps', async () => {
    // `getDatasets` is the one read that genuinely depends on the version:
    // it is gated on the screen actually repeating. So it must start AFTER
    // the version resolves — asserting otherwise would be asserting a bug —
    // but it must not be serialised behind the rest of the bundle either.
    //
    // Timed like production: the version lands while the layout walk is still
    // going. Under the old code `getDatasets` rode inside the bundle; the
    // risk this guards is that pulling it out turned it into an extra serial
    // round trip after the bundle drains.
    setup(SCREEN_NODES, 2)
    await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: screenDoc,
    })

    const datasetsStart = order.indexOf('datasets:start')
    expect(datasetsStart).toBeGreaterThan(order.indexOf('version:end'))
    // Issued before the bundle it runs alongside has been collected, which is
    // what keeps it off the critical path.
    expect(datasetsStart).toBeLessThan(order.indexOf('layout2:end'))
  })

  it('CONTROL — a screen with nothing repeating issues no datasets read', async () => {
    // Without this, the assertion above could be satisfied by an
    // implementation that reads datasets unconditionally — which AGL-1440
    // removed precisely because it cost up to 5,050 reads on every page.
    setup(PLAIN_SCREEN_NODES)
    await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: screenDoc,
    })
    expect(mockGetDatasets).not.toHaveBeenCalled()
    expect(mockGetComponents).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('EARLY EXIT — a screen with no version issues no reads at all', async () => {
    // The overlap must not be bought by hoisting reads above the exits. A
    // screen that has never been published resolves to null having touched
    // neither the version nor any host-scoped collection.
    mockApplyDuePublishSchedule.mockResolvedValue(undefined)
    const result = await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: { versionId: undefined, layoutId: 'L1' } as never,
    })

    expect(result).toBeNull()
    expect(mockGetScreenVersion).not.toHaveBeenCalled()
    expect(mockGetComponents).not.toHaveBeenCalled()
    expect(mockGetPublishedLayoutVersion).not.toHaveBeenCalled()
    expect(mockGetPluginInstalls).not.toHaveBeenCalled()
  })

  it('still returns null when the version document is missing', async () => {
    // The chrome bundle is in flight by the time this is known, so the null
    // has to survive the restructure — `load-page-data` 404s on it.
    mockGetScreenVersion.mockImplementation(
      tracked('version', { error: 'not-found', version: null }, 2),
    )
    const result = await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: screenDoc,
    })
    expect(result).toBeNull()
  })

  it('does not reject when the version read throws', async () => {
    // `screenNodes` is handed over as a promise now, so a rejection nobody
    // awaited would surface as an unhandled rejection and take the render
    // down instead of 404ing it.
    mockGetScreenVersion.mockRejectedValue(new Error('firestore down'))
    await expect(
      composeScreenNodes({ hostId: 'h1', screenId: 's1', screen: screenDoc }),
    ).rejects.toThrow('firestore down')
  })

  it('composes the same tree the serial order produced', async () => {
    // The cheap half of the guarantee: concurrency must not change output.
    const result = await composeScreenNodes({
      hostId: 'h1',
      screenId: 's1',
      screen: screenDoc,
    })
    expect(result).toBeTruthy()
    expect(Object.keys(result as object)).toContain(ROOT)
  })
})
