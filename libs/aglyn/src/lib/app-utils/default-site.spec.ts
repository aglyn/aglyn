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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDefaultHomeScreen,
  buildDefaultSiteLayout,
  DEFAULT_HOME_CONTACT_SECTION_ID,
  DEFAULT_SITE_IMAGES,
  DEFAULT_SITE_THEME,
  defaultSiteSeo,
} from './default-site'
import { nodeIdFromInteractionSelector } from './node-interactions'
import { validateThemeForPublish } from './site-theme'

/**
 * AGL-3497: the website a new site is born with.
 *
 * What is pinned is what breaks silently: a scroll that names a section the
 * page does not have does nothing, a photo whose file is missing from one app
 * draws in the Besigner and not on the live site (or the reverse), and a
 * theme the publish validator refuses would be refused the first time the
 * owner touched it.
 */

const REPO = join(__dirname, '..', '..', '..', '..', '..')

const home = buildDefaultHomeScreen('Paperlink')
const layout = buildDefaultSiteLayout('home-screen-id')

type StoredNode = {
  componentId: string
  props: Record<string, unknown>
  interactions?: Array<{ steps: Array<{ type: string; selector?: string }> }>
}
const nodesOf = (map: Record<string, StoredNode>) =>
  Object.entries(map).filter(([id]) => id !== '_@_')

const scrollTargets = (map: Record<string, StoredNode>) =>
  nodesOf(map).flatMap(([, node]) =>
    (node.interactions ?? []).flatMap((interaction) =>
      interaction.steps
        .filter((step) => step.type === 'scrollTo')
        .map((step) => nodeIdFromInteractionSelector(step.selector)),
    ),
  )

describe('AGL-3497 · the default home page', () => {
  it('opens with the site name as its one h1', () => {
    const h1s = nodesOf(home.nodes).filter(([, node]) => node.props['variant'] === 'h1')
    expect(h1s.map(([, node]) => node.props['children'])).toEqual(['Paperlink'])
  })

  it('scrolls only to sections the page has', () => {
    const targets = scrollTargets(home.nodes)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) expect(home.nodes[target as string]).toBeDefined()
  })

  it('carries its SEO title and description', () => {
    expect(home.seo).toEqual({
      title: 'Paperlink',
      description: expect.stringContaining('Paperlink'),
    })
  })

  it('names the forms bundle on the contact form, so it draws with the page', () => {
    const forms = nodesOf(home.nodes).filter(([, node]) =>
      ['form', 'formField'].includes(node.componentId),
    )
    expect(forms.length).toBe(4)
    for (const [, node] of forms) expect((node as { pluginId?: string }).pluginId).toBe('forms')
  })
})

describe('AGL-3497 · the default header and footer', () => {
  it('has exactly one slot for the page', () => {
    const slots = nodesOf(layout.nodes).filter(([, node]) => node.componentId === 'layoutSlot')
    expect(slots).toHaveLength(1)
  })

  it('leaves the h1 to the page', () => {
    const h1s = nodesOf(layout.nodes).filter(([, node]) => node.props['variant'] === 'h1')
    expect(h1s).toHaveLength(0)
  })

  it('links home by id, and scrolls to the home page’s contact section', () => {
    const brand = layout.nodes['dl_brand'] as StoredNode
    expect(brand.props['screenId']).toBe('home-screen-id')
    expect(scrollTargets(layout.nodes)).toEqual([DEFAULT_HOME_CONTACT_SECTION_ID])
    expect(home.nodes[DEFAULT_HOME_CONTACT_SECTION_ID]).toBeDefined()
  })
})

describe('AGL-3497 · the default photos', () => {
  const images = Object.values(DEFAULT_SITE_IMAGES)

  it.each(['apps/tenant/public', 'apps/console/public'])(
    'ships every photo in %s, so it draws on the live site and in the Besigner',
    (root) => {
      for (const image of images) expect(existsSync(join(REPO, root, image.src))).toBe(true)
    },
  )

  it('states each photo’s real size', () => {
    for (const image of images) {
      const bytes = readFileSync(join(REPO, 'apps/tenant/public', image.src))
      expect(jpegSize(bytes)).toEqual({ width: image.width, height: image.height })
    }
  })

  it('places every photo the page uses', () => {
    const used = new Set(
      nodesOf(home.nodes)
        .filter(([, node]) => node.componentId === 'image')
        .map(([, node]) => node.props['src']),
    )
    expect([...used].sort()).toEqual(images.map((image) => image.src).sort())
  })

  it('shares the hero as the site’s social image', () => {
    expect(defaultSiteSeo('Paperlink')).toMatchObject({
      title: 'Paperlink',
      image: DEFAULT_SITE_IMAGES.hero.src,
      imageWidth: DEFAULT_SITE_IMAGES.hero.width,
      imageHeight: DEFAULT_SITE_IMAGES.hero.height,
    })
  })
})

describe('AGL-3497 · the default theme', () => {
  it('passes the validator a theme is published through, without warnings', () => {
    const verdict = validateThemeForPublish(DEFAULT_SITE_THEME)
    expect(verdict.errors).toEqual([])
    expect(verdict.warnings).toEqual([])
  })
})

/** A baseline or progressive JPEG's pixel size, from its first SOF marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}
