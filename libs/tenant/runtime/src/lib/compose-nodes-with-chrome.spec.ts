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

/**
 * AGL-1022: `host.*` tokens resolve inside the real pipeline.
 *
 * `resolveNodesHostTokens` is unit-tested on its own, but a pure resolver that
 * nothing calls substitutes nothing. What is untested without this is the CALL
 * SITE: that compose passes the host through, and does it in an order where the
 * substitution actually lands in the output rather than being overwritten by a
 * later stage.
 */
describe('composeNodesWithChrome resolves host tokens (AGL-1022)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  const withToken = {
    root: { $id: 'root', componentId: 'div', nodes: ['t'] },
    t: {
      $id: 't',
      componentId: 'text',
      parentId: 'root',
      props: { children: 'Welcome to {{host.businessName}}' },
      nodes: [],
    },
  }
  /** The composed output, flattened to the strings it actually renders. */
  const textOf = (composed: unknown) => JSON.stringify(composed)

  it('substitutes the installing site’s value into the composed tree', async () => {
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withToken,
      host: { displayName: 'Northwind Coffee' },
    })
    expect(textOf(composed)).toContain('Welcome to Northwind Coffee')
    expect(textOf(composed)).not.toContain('{{host.')
  })

  it('CONTROL — the token is present before compose, so a pass is not vacuous', () => {
    expect(textOf(withToken)).toContain('{{host.businessName}}')
  })

  it('never leaves the literal token when the site has no value', async () => {
    // The failure the whole feature exists to prevent: a visitor seeing
    // `{{host.businessName}}` on a published page.
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withToken,
      host: {},
    })
    expect(textOf(composed)).not.toContain('{{host.')
  })

  it('composes normally when no host is passed', async () => {
    // Callers that predate this option must not break — they simply resolve
    // nothing, which is the same as a site with nothing set.
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withToken,
    })
    expect(composed).toBeTruthy()
    expect(textOf(composed)).not.toContain('{{host.')
  })
})

/**
 * AGL-1385: an Entry Meta block on an entry template renders its entry.
 *
 * `expandCollectionEntryMeta` is unit-tested on its own, and — exactly as with
 * the host tokens above — a pure stamper that nothing calls stamps nothing.
 * What only a call-site test can catch is the ORDER: the stamp has to land
 * after the per-entry clones exist (so it can skip them) and before binding
 * resolution and denormalization (so the values reach the output).
 *
 * The negative control is the shape MEASURED on the live blog: a block with
 * the three switches on and nothing bound, composed to an empty div.
 */
describe('composeNodesWithChrome fills Entry Meta blocks (AGL-1385)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  /** As stored on `blogEntryTmpl`: three switches, zero values. */
  const withMeta = () => ({
    root: { $id: 'root', componentId: 'div', nodes: ['meta'] },
    meta: {
      $id: 'meta',
      componentId: 'collectionEntryMeta',
      parentId: 'root',
      props: { showDate: true, showCategory: true, showTags: true },
      nodes: [],
    },
  })

  const entry = {
    $id: 'e1',
    title: 'From a form to a dataset in five minutes',
    slug: 'from-a-form-to-a-dataset-in-five-minutes',
    categoryId: 'guides',
    tags: ['forms'],
    publishedAt: { seconds: 1_754_714_956 },
  }
  const collection = {
    slug: 'blog',
    entry,
    categories: [{ id: 'guides', name: 'Guides' }],
  }
  const expectedDate = new Date(1_754_714_956 * 1000).toLocaleDateString()

  it('stamps the routed entry’s date, category and tags into the tree', async () => {
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withMeta(),
      collection,
    })

    const json = JSON.stringify(composed)
    expect(json).toContain(expectedDate)
    expect(json).toContain('Guides')
    expect(json).toContain('forms')
  })

  it('CONTROL — the block carries none of it beforehand, so a pass is not vacuous', () => {
    const json = JSON.stringify(withMeta())
    expect(json).not.toContain(expectedDate)
    expect(json).not.toContain('Guides')
  })

  it('leaves the block empty on a LIST route, where there is no current entry', async () => {
    // A list template has no routed entry: the block must stay unbound rather
    // than borrow whichever entry happened to be first.
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withMeta(),
      collection: { slug: 'blog', entries: [entry], categories: collection.categories },
    })

    expect(JSON.stringify(composed)).not.toContain(expectedDate)
  })

  it('composes normally with no collection context at all', async () => {
    const composed = await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withMeta(),
    })
    expect(composed).toBeTruthy()
  })
})
