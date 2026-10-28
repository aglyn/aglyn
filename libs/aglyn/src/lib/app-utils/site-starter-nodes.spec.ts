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

import { buildDefaultHomeScreen, buildDefaultSiteLayout } from './default-site'
import { PORTABLE_COMPONENT_ID_ALLOWLIST } from './node-definition-sanitizer'
import { NODE_MAX_INTERACTIONS } from './node-interactions'
import {
  sanitizeSiteStarterNodes,
  SITE_STARTER_COMPONENT_IDS,
  SITE_STARTER_INTERACTION_STEP_TYPES,
  SITE_STARTER_LAYOUT_COMPONENT_IDS,
} from './site-starter-nodes'

const ROOT = '_@_'

/** A one-element page: the root wrapper and `node` under it as `n1`. */
const page = (node: Record<string, unknown>) => ({
  rootId: ROOT,
  nodes: {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['n1'] },
    n1: { $id: 'n1', parentId: ROOT, pluginId: 'mui', props: {}, nodes: [] as string[], ...node },
  },
})

const componentIdsOf = (nodes: Record<string, any>) =>
  [...new Set(Object.entries(nodes).filter(([id]) => id !== ROOT).map(([, node]) => node.componentId))]

/** What the pass stores for nodes it keeps whole: the root gains `parentId: null`. */
const keptWhole = (nodes: Record<string, any>) =>
  Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { ...node, parentId: node.parentId ?? null }]))

const scroll = { type: 'scrollTo', selector: '[data-node="n2"]' }
const interaction = (steps: unknown[]) => [
  { id: 'i1', name: 'Go', enabled: true, trigger: { event: 'elementClick', everyTime: true }, steps },
]

describe('what a site starter may hold (AGL-4049)', () => {
  it('names every component the default site is built from', () => {
    const home = buildDefaultHomeScreen('Corner bistro')
    const layout = buildDefaultSiteLayout('home')
    expect(componentIdsOf(home.nodes).filter((id) => !SITE_STARTER_COMPONENT_IDS.includes(id))).toEqual([])
    expect(componentIdsOf(layout.nodes).filter((id) => !SITE_STARTER_LAYOUT_COMPONENT_IDS.includes(id))).toEqual([])
  })

  it('keeps the default site whole: every node, its styles and its interactions', () => {
    const home = buildDefaultHomeScreen('Corner bistro')
    const layout = buildDefaultSiteLayout('home')
    const storedHome = sanitizeSiteStarterNodes({ rootId: ROOT, nodes: home.nodes })
    const storedLayout = sanitizeSiteStarterNodes({ rootId: ROOT, nodes: layout.nodes }, { layout: true })
    expect(storedHome).toEqual({ ok: true, rootId: ROOT, nodes: keptWhole(home.nodes) })
    expect(storedLayout).toEqual({ ok: true, rootId: ROOT, nodes: keptWhole(layout.nodes) })
  })

  it('widens nothing for the other artifact types: the portable rule is unchanged and smaller', () => {
    for (const id of PORTABLE_COMPONENT_ID_ALLOWLIST) expect(SITE_STARTER_COMPONENT_IDS).toContain(id)
    expect(PORTABLE_COMPONENT_ID_ALLOWLIST).not.toContain('muiGrid')
    expect(PORTABLE_COMPONENT_ID_ALLOWLIST).not.toContain('themeModeSwitcher')
  })

  it('allows the layout slot in a layout only', () => {
    expect(SITE_STARTER_COMPONENT_IDS).not.toContain('layoutSlot')
    expect(sanitizeSiteStarterNodes(page({ componentId: 'layoutSlot' })).ok).toBe(false)
    expect(sanitizeSiteStarterNodes(page({ componentId: 'layoutSlot' }), { layout: true }).ok).toBe(true)
  })

  it.each(['html', 'reusableInstance', 'collectionEntries', 'product-grid', 'booking'])(
    'refuses %s: raw markup, a reference, or something bound to the source site or a plugin',
    (componentId) => {
      const result = sanitizeSiteStarterNodes(page({ componentId }))
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`"${componentId}" cannot be published`) })
    },
  )

  it('still hardens props as the portable rule does', () => {
    const result = sanitizeSiteStarterNodes(
      page({ componentId: 'muiButton', props: { children: 'Go', onClick: 'steal()', href: 'javascript:alert(1)' } }),
    )
    expect(result.ok && result.nodes['n1'].props).toEqual({ children: 'Go' })
  })
})

describe('a starter’s styles (AGL-4049)', () => {
  it.each([
    ['a site path', 'url(/_static/starter/hero.jpg)'],
    ['a quoted https image', "url('https://cdn.example/hero.jpg')"],
    ['an inline image', 'url(data:image/png;base64,AAAA)'],
    ['a gradient', 'linear-gradient(90deg, #000, #fff)'],
  ])('keeps a background from %s', (_case, backgroundImage) => {
    const result = sanitizeSiteStarterNodes(page({ componentId: 'muiBox', sx: { backgroundImage, p: { xs: 2, md: 4 } } }))
    expect(result.ok && result.nodes['n1'].sx).toEqual({ backgroundImage, p: { xs: 2, md: 4 } })
  })

  it.each([
    ['a protocol-relative address', 'url(//beacon.example/pixel.gif)', 'beacon.example'],
    ['a script', 'url(javascript:alert(1))', 'javascript:'],
    ['plain http', 'url(http://beacon.example/pixel.gif)', 'http://beacon.example'],
  ])('refuses a background from %s, naming it', (_case, backgroundImage, named) => {
    const result = sanitizeSiteStarterNodes(
      page({ componentId: 'muiBox', sx: { '&:hover': { backgroundImage } } }),
    )
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(named) })
  })

  it('never shares an object with the source', () => {
    const sx = { p: 2 }
    const result = sanitizeSiteStarterNodes(page({ componentId: 'muiBox', sx }))
    expect(result.ok && result.nodes['n1'].sx).not.toBe(sx)
  })
})

describe('a starter’s interactions (AGL-4049)', () => {
  it('keeps the steps that act on the page itself', () => {
    const interactions = interaction([scroll, { type: 'toggleClass', selector: '#menu', className: 'open' }])
    const result = sanitizeSiteStarterNodes(page({ componentId: 'muiButton', interactions }))
    expect(result.ok && result.nodes['n1'].interactions).toEqual(interactions)
  })

  it.each([
    ['runJs', 'Run custom JS'],
    ['showHtml', 'Show custom HTML'],
    ['redirect', 'Redirect the visitor'],
    ['trackGaEvent', 'Track an analytics event'],
    ['setAttribute', 'Set an ARIA or data attribute'],
    ['sendEmail', 'sendEmail'],
  ])('refuses a %s step, by its name', (type, label) => {
    const result = sanitizeSiteStarterNodes(
      page({ componentId: 'muiButton', interactions: interaction([scroll, { type }]) }),
    )
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`runs "${label}`) })
  })

  it('refuses more interactions than an element may carry, or one that is not a list', () => {
    const many = Array.from({ length: NODE_MAX_INTERACTIONS + 1 }, () => interaction([scroll])[0])
    expect(sanitizeSiteStarterNodes(page({ componentId: 'muiButton', interactions: many })).ok).toBe(false)
    expect(sanitizeSiteStarterNodes(page({ componentId: 'muiButton', interactions: { steps: [] } })).ok).toBe(false)
  })

  it('carries no step a plugin declares', () => {
    expect([...SITE_STARTER_INTERACTION_STEP_TYPES].every((type) => /^[a-z][A-Za-z]+$/.test(type))).toBe(true)
    expect(SITE_STARTER_INTERACTION_STEP_TYPES.has('runJs')).toBe(false)
  })
})
