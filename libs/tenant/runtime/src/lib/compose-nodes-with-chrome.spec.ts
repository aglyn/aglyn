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

import { formatCollectionEntryDate } from '@aglyn/aglyn/server'
import { composeNodesWithChrome } from './compose-screen-nodes'
import { getPublishedCollectionSource } from './get-collection-content'

const mockCollectionSource = getPublishedCollectionSource as jest.Mock

/**
 * A screen that repeats over a dataset.
 *
 * Since AGL-1440 the datasets read is gated on the composed tree containing a
 * repeatable, so the AGL-1225 concurrency assertions below have to run against
 * a screen that actually wants datasets — otherwise they would be asserting
 * that a read nobody issues starts early, which is vacuously true.
 */
const ROOT = '_@_'

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

/** The same screen with nothing to repeat over — the common page. */
const PLAIN_SCREEN_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] },
}

/**
 * A layout that repeats: a real one, with the root and the `layoutSlot` the
 * graft needs. Without both, `composeLayoutChainAndScreenNodes` returns the
 * screen unchanged — so a sloppier fixture would have "passed" by never
 * putting the layout's repeatable into the composed tree at all.
 */
const layoutWithRepeat = (dataset = 'Team') => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['lRepeat', 'lSlot'] },
  lRepeat: {
    $id: 'lRepeat',
    componentId: 'muiStack',
    parentId: ROOT,
    props: { repeatDataset: dataset },
    nodes: [],
  },
  lSlot: {
    $id: 'lSlot',
    componentId: 'layoutSlot',
    parentId: ROOT,
    nodes: [],
  },
})

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
 * AGL-1440: the datasets read is paid for only by pages that repeat.
 *
 * `getDatasets` is the largest single term in a cold tenant render — every
 * dataset the host may see plus up to 100 records each, up to ~5,050 Firestore
 * reads — and it was issued on EVERY render of EVERY path, then handed to
 * `expandRepeatables`, which returns its input untouched when nothing on the
 * page carries `repeatDataset`.
 *
 * Two properties have to hold together, and only one of them is about cost:
 *
 *  - a page with no repeatable must issue NO datasets read, and
 *  - a page with one must still get its rows — including when the repeatable
 *    arrives from a LAYOUT or a reusable component, which the screen document
 *    alone cannot tell you.
 *
 * The second is why the gate is evaluated after grafting rather than on
 * `screenNodes`, and why the screen-level fast path below exists at all: it
 * keeps the AGL-1225 single-round-trip shape for the common case without
 * making the screen document the arbiter of correctness.
 */
describe('composeNodesWithChrome gates the datasets read (AGL-1440)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  it('issues NO datasets read for a page with no repeatable', async () => {
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: PLAIN_SCREEN_NODES,
    })
    expect(mockGetDatasets).not.toHaveBeenCalled()
  })

  it('CONTROL — the same compose with a repeatable does read datasets', async () => {
    // Without this the test above passes against a compose that never reads
    // datasets at all, which would be the bug and not the fix.
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: SCREEN_NODES,
    })
    expect(mockGetDatasets).toHaveBeenCalledTimes(1)
    expect(mockGetDatasets).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('still reads datasets when the repeatable comes from the LAYOUT', async () => {
    // The screen is plain; the layout carries the repeat. A gate that only read
    // `screenNodes` would drop every row on this page.
    mockGetPublishedLayoutVersion.mockReset()
    mockGetPublishedLayoutVersion.mockImplementationOnce(
      tracked('layout1', { version: { nodes: layoutWithRepeat() }, layout: {} }),
    )
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: PLAIN_SCREEN_NODES,
    })
    expect(mockGetDatasets).toHaveBeenCalledTimes(1)
  })

  it('still reads datasets when the repeatable is grafted in from a component', async () => {
    // A reusable component instance is an empty node until `getComponents`
    // grafts its definition in, so this repeatable does not exist anywhere in
    // the inputs — only in the composed tree the gate is evaluated against.
    mockGetComponents.mockImplementation(
      tracked('components', {
        definitions: {
          cmp1: {
            rootId: 'cRoot',
            nodes: {
              cRoot: {
                $id: 'cRoot',
                componentId: 'muiStack',
                props: { repeatDataset: 'Team' },
                nodes: [],
              },
            },
          },
        },
      }),
    )
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: null,
      screenNodes: {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['inst'] },
        inst: {
          $id: 'inst',
          componentId: 'reusableInstance',
          parentId: ROOT,
          props: { refId: 'cmp1' },
          nodes: [],
        },
      },
    })
    expect(mockGetDatasets).toHaveBeenCalledTimes(1)
  })

  it('reads datasets at most once even when screen AND layout repeat', async () => {
    mockGetPublishedLayoutVersion.mockReset()
    mockGetPublishedLayoutVersion.mockImplementationOnce(
      tracked('layout1', {
        version: { nodes: layoutWithRepeat('Other') },
        layout: {},
      }),
    )
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: SCREEN_NODES,
    })
    expect(mockGetDatasets).toHaveBeenCalledTimes(1)
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
  // 2025-08-09T05:29:16Z, which is the PREVIOUS day in every American zone.
  // Derived from the shared formatter rather than a bare
  // `toLocaleDateString()` (AGL-1926): the stamped prop is whatever the ONE
  // formatter produces, and asserting the ambient runtime instead made this
  // a test of the developer's time zone.
  const expectedDate = formatCollectionEntryDate({ seconds: 1_754_714_956 })

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

describe('composeNodesWithChrome fills Collection Search blocks (AGL-1516)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  /** As dropped into a listing toolbar beside the pills and the RSS button. */
  const withSearch = () => ({
    root: { $id: 'root', componentId: 'div', nodes: ['box'] },
    box: {
      $id: 'box',
      componentId: 'collectionSearch',
      parentId: 'root',
      props: {},
      nodes: [],
    },
  })

  const entries = [
    { $id: 'e1', title: 'Design it live', slug: 'design-it-live', excerpt: 'besigner' },
    { $id: 'e2', title: 'One platform', slug: 'one-platform', excerpt: 'commerce' },
  ]

  it('stamps the collection’s index onto the block', async () => {
    // The wiring, not the expansion: the block only ever reaches
    // `expandCollectionSearch` if the pipeline counts it as a reason to
    // resolve a collection source and then runs the stage. A composed page
    // that skipped either would render an element that silently shows
    // nothing — the exact failure this issue spent three passes on.
    const composed = (await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withSearch(),
      collection: { slug: 'blog', entries },
    })) as any

    expect(composed['box'].props.searchIndex).toEqual([
      { title: 'Design it live', excerpt: 'besigner', url: '/blog/design-it-live' },
      { title: 'One platform', excerpt: 'commerce', url: '/blog/one-platform' },
    ])
    expect(composed['box'].props.searchTotal).toBe(2)
  })

  it('CONTROL — the block carries none of it beforehand', () => {
    const json = JSON.stringify(withSearch())
    expect(json).not.toContain('searchIndex')
    expect(json).not.toContain('design-it-live')
  })

  it('leaves the block alone with no collection in context', async () => {
    const composed = (await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withSearch(),
    })) as any
    expect('searchIndex' in composed['box'].props).toBe(false)
  })

  it('carries a bounded read all the way to `searchCapped`', async () => {
    // The last hop of the chain, and the one with no other witness. The
    // loader knows the read stopped at its limit and the component knows how
    // to say so; if the pipeline drops the fact in between, both halves stay
    // green while the page tells a reader it searched a collection it only
    // saw the first hundred of. Two entries here — deliberately nowhere near
    // the bound — because a version that re-derives the flag by counting
    // would pass a fixture built at 100 and fail this one.
    const composed = (await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withSearch(),
      collection: { slug: 'blog', entries, entriesReachedBound: true },
    })) as any
    expect(composed['box'].props.searchCapped).toBe(true)
  })

  it('carries a bound off a FETCHED collection as well', async () => {
    // The other half of the source assembly: a box pointed at a collection
    // the URL did not route (a changelog search on the homepage) fetches its
    // own source, and that read is bounded by the same `.limit()`.
    const nodes = withSearch()
    nodes.box.props = { collectionSlug: 'changelog' }
    mockCollectionSource.mockResolvedValue({
      entries: [
        { $id: 'c1', title: 'Shipped', slug: 'shipped', excerpt: 'notes' },
      ],
      categories: [],
      reachedBound: true,
    })
    const composed = (await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: nodes,
    })) as any
    expect(composed['box'].props.searchCapped).toBe(true)
  })

  it('leaves `searchCapped` off a read that came back complete', async () => {
    const composed = (await composeNodesWithChrome({
      hostId: 'h1',
      screenNodes: withSearch(),
      collection: { slug: 'blog', entries },
    })) as any
    expect('searchCapped' in composed['box'].props).toBe(false)
  })
})

/**
 * AGL-1152: the collection source read OVERLAPS the chrome bundle.
 *
 * `getPublishedCollectionSource` is three SEQUENTIAL round trips
 * (`findContentCollection` → `listLiveEntries` → `attachEntryAuthors`), and it
 * used to be issued from `expandCollectionEntryBlocks` — which runs after the
 * chrome bundle has already been awaited. So every page carrying a Collection
 * entries block paid the whole read as a serial TAIL on the compose phase.
 *
 * The measurement that motivated this: a page with no collection block
 * composes in ~20 ms and one with a block in ~572 ms, while the tree work
 * itself — every expansion, binding and denormalize pass, benchmarked at 50
 * entries — accounts for under 2 ms. The gap was never the tree. It was this
 * read, queued behind reads it shares nothing with.
 *
 * Like every other concurrency property in this file, it is invisible to an
 * output-equality test: re-serialising the read leaves every assertion about
 * the composed nodes green. So the ordering is asserted directly, with the
 * old sequential shape as the explicit negative control.
 */
describe('composeNodesWithChrome overlaps the collection read (AGL-1152)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setup()
  })

  /** A press/blog rail: a block naming its collection on a plain screen. */
  const withRail = (slug = 'press') => ({
    root: { $id: 'root', componentId: 'div', nodes: ['rail'] },
    rail: {
      $id: 'rail',
      componentId: 'collectionEntries',
      parentId: 'root',
      props: { collectionSlug: slug },
      nodes: ['tpl'],
    },
    tpl: {
      $id: 'tpl',
      componentId: 'typography',
      parentId: 'rail',
      props: { children: '{{entry.title}}' },
      nodes: [],
    },
  })

  const source = { entries: [], categories: [], reachedBound: false }

  it('THE REGRESSION GUARD: the read STARTS before the chrome bundle ENDS', async () => {
    mockCollectionSource.mockImplementation(tracked('collection', source))

    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: withRail(),
    })

    const started = order.indexOf('collection:start')
    expect(started).toBeGreaterThan(-1)
    // Every chrome read that is still outstanding when the collection read is
    // issued. Under the old shape this was empty: the collection read could
    // not begin until all of them had already resolved.
    const overlapped = ['components', 'variables', 'installs', 'layout1'].filter(
      (label) => order.indexOf(`${label}:end`) > started,
    )
    expect(overlapped).toEqual(['components', 'variables', 'installs', 'layout1'])
  })

  it('reads the collection exactly ONCE — the prefetch is consumed, not added to', async () => {
    // The prefetch is a reschedule, not a second read. Getting this wrong
    // doubles the cost of the very thing being optimised, and no output
    // assertion would notice.
    mockCollectionSource.mockResolvedValue(source)

    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: withRail(),
    })

    expect(mockCollectionSource).toHaveBeenCalledTimes(1)
    expect(mockCollectionSource).toHaveBeenCalledWith({
      hostId: 'h1',
      collectionSlug: 'press',
    })
  })

  it('issues NO collection read for a page with no collection block', async () => {
    mockCollectionSource.mockResolvedValue(source)
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: PLAIN_SCREEN_NODES,
    })
    expect(mockCollectionSource).not.toHaveBeenCalled()
  })

  it('does NOT prefetch the routed collection whose entries are already in hand', async () => {
    // The expansion answers this slug from `collection.entries` without
    // reading at all, so a prefetch here would buy a read nobody awaits.
    mockCollectionSource.mockResolvedValue(source)
    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: withRail('blog'),
      collection: { slug: 'blog', entries: [] },
    })
    expect(mockCollectionSource).not.toHaveBeenCalled()
  })

  it('STILL fetches a block that only appears after LAYOUT grafting', async () => {
    // The screen-level scan is a fast path, never the correctness gate. A
    // block living in a layout is invisible to the prefetch, and dropping it
    // would render an empty rail on a page that has posts.
    mockCollectionSource.mockResolvedValue(source)
    mockGetPublishedLayoutVersion.mockReset()
    mockGetPublishedLayoutVersion.mockImplementationOnce(
      tracked('layout1', {
        version: {
          nodes: {
            [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['lRail', 'lSlot'] },
            lRail: {
              $id: 'lRail',
              componentId: 'collectionEntries',
              parentId: ROOT,
              props: { collectionSlug: 'press' },
              nodes: [],
            },
            lSlot: {
              $id: 'lSlot',
              componentId: 'layoutSlot',
              parentId: ROOT,
              nodes: [],
            },
          },
        },
        layout: {},
      }),
    )

    await composeNodesWithChrome({
      hostId: 'h1',
      layoutId: 'L1',
      screenNodes: PLAIN_SCREEN_NODES,
    })

    expect(mockCollectionSource).toHaveBeenCalledWith({
      hostId: 'h1',
      collectionSlug: 'press',
    })
  })
})
