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
 * AGL-1225: the composition pipeline issues its reads in ONE round-trip stage.
 *
 * `composeNodesWithChrome` is the largest measured phase of a tenant render —
 * 1577 ms cold and ~1.4-1.6 s warm on production — and it had no test at all.
 * The one spec that imports it (`compose-collection-page.spec.ts`) mocks it
 * out, so its body was entirely uncovered while being on the render path of
 * every published page.
 *
 * The property under test is CONCURRENCY, which is invisible to an
 * output-equality test: the pipeline used to `await` the layout walk, then
 * `await getComponents`, then `await Promise.all([five reads])` — three
 * sequential waits where only the first has any reason to be sequential.
 * Re-serialising them would keep every assertion about the composed output
 * green while silently restoring ~two extra round trips to every page render.
 *
 * So the reads are instrumented with a shared clock and the test asserts they
 * OVERLAP, with the sequential shape as the explicit negative control.
 */

const order: string[] = []
/** Resolves after `ticks` microtask-ish turns, recording when it started/ended. */
const tracked = <T,>(label: string, value: T, ticks = 3) => async () => {
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
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import { composeNodesWithChrome } from './compose-screen-nodes'

const SCREEN_NODES = { root: { id: 'root', type: 'box' } }

const setup = () => {
  order.length = 0
  // A two-deep layout chain: inner -> outer. Each hop is a separate read, and
  // the second is only reachable once the first resolves — the one genuinely
  // sequential thing in here.
  mockGetPublishedLayoutVersion
    .mockImplementationOnce(
      tracked('layout1', { version: { nodes: {} }, layout: { layoutId: 'L2' } }),
    )
    .mockImplementationOnce(
      tracked('layout2', { version: { nodes: {} }, layout: {} }),
    )
  mockGetComponents.mockImplementation(tracked('components', { definitions: {} }))
  mockGetVariables.mockImplementation(tracked('variables', []))
  mockGetFunctions.mockImplementation(tracked('functions', []))
  mockGetDatasets.mockImplementation(tracked('datasets', []))
  mockGetWorkflows.mockImplementation(tracked('workflows', []))
  mockGetPluginInstalls.mockImplementation(tracked('installs', []))
}

describe('composeNodesWithChrome read fan-out (AGL-1225)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  it('starts every host-scoped read before the layout walk finishes', async () => {
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: SCREEN_NODES,
    })

    // The walk is two hops; the last one ends here.
    const walkEnd = order.indexOf('layout2:end')
    expect(walkEnd).toBeGreaterThan(-1)

    // None of these consumes the layout chain — they take `hostId` and nothing
    // else — so every one must already be in flight before the walk completes.
    // This is the assertion that fails if the awaits are re-serialised.
    for (const label of [
      'components',
      'variables',
      'functions',
      'datasets',
      'workflows',
      'installs',
    ]) {
      const start = order.indexOf(`${label}:start`)
      expect(start).toBeGreaterThan(-1)
      expect(start).toBeLessThan(walkEnd)
    }
  })

  it('CONTROL — the layout walk itself stays sequential', async () => {
    // It has to: the parent id is only known once the child document is in
    // hand. If this ever overlaps, the walk is reading a layoutId it invented.
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: SCREEN_NODES,
    })
    expect(order.indexOf('layout1:end')).toBeLessThan(
      order.indexOf('layout2:start'),
    )
  })

  it('CONTROL — a screen with no layout still issues the other reads', async () => {
    // The no-layout path skips the walk entirely. Without this, the test above
    // could pass against an implementation that only parallelises when a
    // layout happens to exist.
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: null,
      screenNodes: SCREEN_NODES,
    })
    expect(mockGetPublishedLayoutVersion).not.toHaveBeenCalled()
    expect(mockGetComponents).toHaveBeenCalledWith({ hostId: 'h1' })
    expect(mockGetPluginInstalls).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('reads each host-scoped collection exactly once per compose', async () => {
    // Cheap guard against a refactor that moves a read inside a per-node loop —
    // the shape this issue was filed to rule out.
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: SCREEN_NODES,
    })
    expect(mockGetComponents).toHaveBeenCalledTimes(1)
    expect(mockGetVariables).toHaveBeenCalledTimes(1)
    expect(mockGetFunctions).toHaveBeenCalledTimes(1)
    expect(mockGetDatasets).toHaveBeenCalledTimes(1)
    expect(mockGetWorkflows).toHaveBeenCalledTimes(1)
    expect(mockGetPluginInstalls).toHaveBeenCalledTimes(1)
    // One read per layout in the chain, and no more.
    expect(mockGetPublishedLayoutVersion).toHaveBeenCalledTimes(2)
  })
})
