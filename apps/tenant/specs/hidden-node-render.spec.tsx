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
 * THE HIERARCHY EYE HIDES AN ELEMENT ON THE PUBLISHED PAGE (AGL-2873).
 *
 * The eye stores `hidden: true` on a node, and `Leaf` turns that into
 * `display: none` wherever it renders. The besigner canvas renders the node the
 * author clicked. The published page renders a COMPOSED node instead: grafted
 * into a layout, copied out of a component definition, or collapsed into the
 * placement that stands for a component. The flag only reaches `Leaf` if every
 * one of those stages carries it, so a check against the canvas, or against a
 * top-level section alone, cannot see a stage that drops it.
 *
 * This suite drives the tenant's own path end to end:
 *
 * - the published version and the host's layout and components through
 *   `composeScreenNodes`, with only the Firestore reads doubled;
 * - the client handoff through `deferLazyPanelNodes` and a JSON round trip,
 *   which is what crosses into the flight payload;
 * - the render through `CatchAllPage`, the component the published route
 *   renders on the server and hydrates in the browser.
 *
 * Every hidden element is asserted on its own computed style, beside a visible
 * sibling at the same level. The visible siblings are the controls: a selector
 * that matched nothing, or a page that committed nothing, fails them rather
 * than reading as hidden.
 */

jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

const mockGetScreenVersion = jest.fn()
const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()

jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreenVersion(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-layout-version', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetPublishedLayoutVersion(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-components', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetComponents(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
  getFunctions: jest.fn(async () => []),
  getWorkflows: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-plugin-installs', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-datasets', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-forms', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ forms: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-media-asset-facts', () => ({
  __esModule: true,
  default: jest.fn(async () => new Map()),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(async () => null),
}))

import { components } from '@aglyn/aglyn/aglyn'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import { deferLazyPanelNodes } from '@aglyn/tenant-runtime/defer-lazy-panels'
import Box from '@mui/material/Box'
import { act, render } from '@testing-library/react'
import { forwardRef } from 'react'
import CatchAllPage from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'
import type { Props } from '../app/[host]/[scheme]/[[...slug]]/types'

const HOST_ID = 'host1'
const SCREEN_ID = 'home'
const ROOT = '_@_'

/**
 * The published `section` component's shape: an MUI `Box` that forwards the
 * leaf's `sx` and attributes to the element it renders. Registered under the
 * persisted id so these nodes render through a registered factory the way a
 * published page's do. Everything else in the tree renders through `Leaf`'s
 * default factory, which honors `sx` the same way.
 */
const SectionStandIn = forwardRef<HTMLElement, Record<string, unknown>>(
  ({ element: _element, ariaLabel, ...rest }, ref) => (
    <Box
      ref={ref}
      component="section"
      aria-label={(ariaLabel as string) || undefined}
      {...rest}
    />
  ),
)
SectionStandIn.displayName = 'SectionStandIn'

/** A section as the besigner stores one; a definition's root has no parent. */
const section = (
  $id: string,
  parentId: string | undefined,
  extra: Record<string, unknown> = {},
) => ({
  $id,
  type: 'node',
  pluginId: 'mui',
  componentId: 'section',
  ...(parentId ? { parentId } : {}),
  props: { element: 'section', ariaLabel: $id },
  sx: { py: 11 },
  nodes: [] as string[],
  ...extra,
})

const text = (
  $id: string,
  parentId: string,
  extra: Record<string, unknown> = {},
) => ({
  $id,
  type: 'node',
  pluginId: 'mui',
  componentId: 'muiTypography',
  parentId,
  props: { children: $id },
  ...extra,
})

const placement = (
  $id: string,
  refId: string,
  extra: Record<string, unknown> = {},
) => ({
  $id,
  type: 'node',
  pluginId: 'mui',
  componentId: 'reusableInstance',
  parentId: ROOT,
  props: { refId, name: refId },
  nodes: [] as string[],
  ...extra,
})

/** Site chrome: a hidden band and a visible one around the content slot. */
const LAYOUT_NODES = {
  [ROOT]: {
    $id: ROOT,
    componentId: 'div',
    nodes: ['chromeHidden', 'chromeShown', 'slot'],
  },
  chromeHidden: section('chromeHidden', ROOT, { hidden: true }),
  chromeShown: section('chromeShown', ROOT),
  slot: {
    $id: 'slot',
    type: 'node',
    pluginId: 'mui',
    componentId: 'layoutSlot',
    parentId: ROOT,
    nodes: [],
  },
}

/**
 * Reusable component definitions, as the host's component documents hold
 * their published trees.
 *
 * - `card`: one child hidden inside the definition, one visible beside it.
 * - `hero`: nothing hidden inside; the page hides its PLACEMENT.
 * - `ghost`: the definition hides its own root; the page places it visibly.
 */
const DEFINITIONS = {
  card: {
    rootId: 'cardRoot',
    nodes: {
      cardRoot: section('cardRoot', undefined, {
        nodes: ['cardTitle', 'cardBadge'],
      }),
      cardTitle: text('cardTitle', 'cardRoot'),
      cardBadge: text('cardBadge', 'cardRoot', { hidden: true }),
    },
  },
  hero: {
    rootId: 'heroRoot',
    nodes: {
      heroRoot: section('heroRoot', undefined, { nodes: ['heroCopy'] }),
      heroCopy: text('heroCopy', 'heroRoot'),
    },
  },
  ghost: {
    rootId: 'ghostRoot',
    nodes: {
      ghostRoot: section('ghostRoot', undefined, {
        nodes: ['ghostCopy'],
        hidden: true,
      }),
      ghostCopy: text('ghostCopy', 'ghostRoot'),
    },
  },
}

/** The published version of the screen. */
const SCREEN_NODES = {
  [ROOT]: {
    $id: ROOT,
    componentId: 'div',
    nodes: [
      'promo',
      'faq',
      'cardPlacement',
      'heroPlacement',
      'shownHeroPlacement',
      'ghostPlacement',
    ],
  },
  promo: section('promo', ROOT, { hidden: true }),
  faq: section('faq', ROOT),
  cardPlacement: placement('cardPlacement', 'card'),
  heroPlacement: placement('heroPlacement', 'hero', { hidden: true }),
  shownHeroPlacement: placement('shownHeroPlacement', 'hero'),
  ghostPlacement: placement('ghostPlacement', 'ghost'),
}

let shipped: Props['nodes']
let container: HTMLElement

/** The element `Leaf` rendered for a composed node id. */
const leaf = (id: string) => {
  const found = container.querySelector<HTMLElement>(
    `[data-aglyn="leaf:${id}"]`,
  )
  if (!found) throw new Error(`nothing rendered for leaf:${id}`)
  return found
}

const ownDisplay = (id: string) => getComputedStyle(leaf(id)).display

/** Whether the element, or anything above it, takes it off the page. */
const isOffPage = (id: string) => {
  for (
    let element: HTMLElement | null = leaf(id);
    element && element !== container;
    element = element.parentElement
  ) {
    if (getComputedStyle(element).display === 'none') return true
  }
  return false
}

beforeAll(async () => {
  components.registerComponent(SectionStandIn as never, {
    $id: 'section',
    pluginId: 'mui',
  } as never)
  mockGetScreenVersion.mockResolvedValue({
    version: { nodes: SCREEN_NODES, layoutId: 'layout1' },
    error: null,
  })
  mockGetPublishedLayoutVersion.mockResolvedValue({
    version: { nodes: LAYOUT_NODES },
    layout: {},
  })
  mockGetComponents.mockResolvedValue({ definitions: DEFINITIONS })

  const composed = await composeScreenNodes({
    hostId: HOST_ID,
    screenId: SCREEN_ID,
    screen: { $id: SCREEN_ID, versionId: 'v1' } as never,
  })
  // What the published route hands the client component: the lazy-panel
  // prune, then the flight payload, which is JSON.
  shipped = JSON.parse(JSON.stringify(deferLazyPanelNodes(composed).nodes))
})

/**
 * Rendered per test because the testing library unmounts after each one.
 * `CatchAllPage` opens by suspending on its plugin gate, so the render is
 * flushed inside `act` or the container is still empty when it is read.
 */
beforeEach(async () => {
  await act(async () => {
    container = render(
      <CatchAllPage data={{ host: { $id: HOST_ID } as never }} nodes={shipped} />,
    ).container
  })
})

afterAll(() => {
  components.unregisterComponent('section')
})

describe('the hierarchy eye on the published page (AGL-2873)', () => {
  it('rendered the composed page at all', () => {
    // Every assertion below reads a `data-aglyn` leaf, so a page that
    // committed nothing would otherwise fail them all for the wrong reason.
    expect(
      container.querySelectorAll('[data-aglyn^="leaf:"]').length,
    ).toBeGreaterThan(10)
  })

  it('hides a top-level section of the screen', () => {
    expect(ownDisplay('promo')).toBe('none')
    expect(isOffPage('faq')).toBe(false)
  })

  it('hides a node of the layout the screen renders inside', () => {
    expect(ownDisplay('layout__chromeHidden')).toBe('none')
    expect(isOffPage('layout__chromeShown')).toBe(false)
    expect(isOffPage('layout__slot')).toBe(false)
  })

  it('hides a node inside a reusable component definition', () => {
    expect(ownDisplay('cmp__cardPlacement__cardBadge')).toBe('none')
    expect(isOffPage('cmp__cardPlacement__cardTitle')).toBe(false)
    expect(isOffPage('cardPlacement')).toBe(false)
  })

  it('hides a placed component whose placement the page hid', () => {
    expect(ownDisplay('heroPlacement')).toBe('none')
    expect(isOffPage('cmp__heroPlacement__heroCopy')).toBe(true)
    // The same component placed without the flag stays on the page.
    expect(isOffPage('shownHeroPlacement')).toBe(false)
    expect(isOffPage('cmp__shownHeroPlacement__heroCopy')).toBe(false)
  })

  it('hides a placed component whose definition hid its own root', () => {
    expect(ownDisplay('ghostPlacement')).toBe('none')
    expect(isOffPage('cmp__ghostPlacement__ghostCopy')).toBe(true)
  })
})
