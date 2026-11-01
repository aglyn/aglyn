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

import { aiLayoutFrameBrandOf, aiLayoutFrameCheck, aiLayoutHostBrandOf, AI_LAYOUT_SITE_BRAND_INPUT } from './ai-job-layout-language'

/**
 * AGL-4119: the logo a person brought to Create site, in a frame the AI start
 * builds. No model and no prompt moves: this is what the code around the
 * model draws, from the site's own document.
 */

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[] }

const PAGES = ['Home', 'About', 'Contact'].map((label, at) => ({ id: `page${at}`, label, slug: at ? label.toLowerCase() : '/' }))

const build = (brand: ReturnType<typeof aiLayoutHostBrandOf>, footer: unknown = null) => {
  const built = aiLayoutFrameCheck({
    siteName: 'Rosie’s Bakery',
    homeId: 'page0',
    pages: PAGES,
    targets: { pageId: null, pages: [], homeIds: ['page0'], forms: [], formPageId: null, components: [], facts: '' } as never,
    extend: () => [],
    ...(brand ? { brand } : {}),
  })({ header: { band: 'plain', align: 'start', cols: [], blocks: [] }, footer } as never)
  expect(built.violations).toEqual([])
  return built.value?.nodes as unknown as Record<string, Node>
}
const images = (nodes: Record<string, Node>) => Object.values(nodes).filter((node) => node.componentId === 'image')
const FOOTER = { band: 'soft', blocks: [{ kind: 'text', text: 'Fresh bread every day.' }] }

describe('the brand a site’s own logo gives its frame', () => {
  it('is nothing on a site with no logo, so its frame carries its name as before', () => {
    expect(aiLayoutHostBrandOf({})).toBeNull()
    expect(aiLayoutHostBrandOf(null)).toBeNull()
    expect(aiLayoutFrameBrandOf({}, {})).toBeNull()
    expect(images(build(aiLayoutFrameBrandOf({}, {})))).toEqual([])
  })

  it('is the logo alone, by token, so a logo changed later follows', () => {
    expect(aiLayoutHostBrandOf({ logoUrl: 'media:h/logo' })).toEqual({
      logo: { src: '{{host.logo}}' },
      name: false,
      footer: true,
    })
  })

  it('names the dark logo only where the site has one', () => {
    expect(aiLayoutHostBrandOf({ logoUrl: 'media:h/logo', logoDarkUrl: 'media:h/dark' })?.logoDark).toEqual({
      src: '{{host.logoDark}}',
    })
  })

  it('gives way to the logo a site brought in draws', () => {
    const inputs = { [AI_LAYOUT_SITE_BRAND_INPUT]: { logo: { src: 'media:h/source' }, name: false } }
    expect(aiLayoutFrameBrandOf(inputs, { logoUrl: 'media:h/logo' })?.logo?.src).toBe('media:h/source')
  })

  it('stands in where a site brought in has its name and no logo', () => {
    const inputs = { [AI_LAYOUT_SITE_BRAND_INPUT]: { logo: null, name: true } }
    expect(aiLayoutFrameBrandOf(inputs, { logoUrl: 'media:h/logo' })?.logo?.src).toBe('{{host.logo}}')
    expect(aiLayoutFrameBrandOf(inputs, {})).toEqual({ name: true })
  })
})

describe('a frame with the site’s logo', () => {
  it('draws it in the header, named as the site, linking home, and not the name', () => {
    const nodes = build(aiLayoutHostBrandOf({ logoUrl: 'media:h/logo' }))
    const [logo] = images(nodes)
    expect(logo.props).toMatchObject({
      src: '{{host.logo}}',
      alt: 'Rosie’s Bakery',
      screenId: 'page0',
      height: '40px',
      width: 'auto',
    })
  })

  it('draws it at the head of the footer too', () => {
    const nodes = build(aiLayoutHostBrandOf({ logoUrl: 'media:h/logo' }), FOOTER)
    expect(images(nodes)).toHaveLength(2)
    const stack = Object.values(nodes).find((node) => node.componentId === 'muiStack' && node.nodes?.length === 3)
    expect(stack).toBeDefined()
  })

  it('shows one logo in each scheme where the site keeps a dark one, behind one link', () => {
    const nodes = build(aiLayoutHostBrandOf({ logoUrl: 'media:h/logo', logoDarkUrl: 'media:h/dark' }))
    const [light, dark] = images(nodes)
    expect(light.props?.['src']).toBe('{{host.logo}}')
    expect(light.props?.['screenId']).toBeUndefined()
    expect(light.sx).toEqual({ '@scheme dark': { display: 'none' } })
    expect(dark.props?.['src']).toBe('{{host.logoDark}}')
    expect(dark.sx).toEqual({ display: 'none', '@scheme dark': { display: 'block' } })
    const link = Object.values(nodes).filter((node) => node.componentId === 'muiLinkBox')
    expect(link).toHaveLength(1)
    expect(link[0].props?.['screenId']).toBe('page0')
  })

  it('CONTROL — a site brought in keeps its footer free of the logo it drew', () => {
    const nodes = build({ logo: { src: 'media:h/source' }, name: false }, FOOTER)
    expect(images(nodes)).toHaveLength(1)
  })
})
