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
 * A store's links added to a layout the site already has (AGL-3676): Account
 * (and Cart where the header has none) beside the header's links, the account
 * and policies in the footer's list, each like its neighbours, never twice,
 * and nothing where the layout has no list to add to.
 */

import { aiLayoutWithStoreLinks, type AiStoreLayoutLinks } from './ai-layout-store-links'

type Nodes = Record<string, { $id: string; componentId: string; parentId?: string; nodes?: string[]; props?: Record<string, unknown>; sx?: Record<string, unknown>; interactions?: unknown[] }>

const LINKS: AiStoreLayoutLinks = {
  header: [{ label: 'Account', href: '/account' }],
  cart: { label: 'Cart', href: '/cart' },
  footer: [
    { label: 'Your account', href: '/account' },
    { label: 'Shipping & returns', href: '/shipping-returns' },
    { label: 'Privacy policy', href: '/privacy' },
    { label: 'Terms of sale', href: '/terms' },
  ],
}

const link = (id: string, parentId: string, props: Record<string, unknown>, extra: Partial<Nodes[string]> = {}) => ({
  [id]: { $id: id, componentId: 'muiScreenLink', parentId, props: { renderAs: 'link', color: 'inherit', ...props }, sx: { textDecoration: 'none' }, nodes: [], ...extra },
})

/** A header and footer as an AI layout draws them: brand, links and a cart in the bar; the menu's links; the footer's list. */
function aiLayout(): Nodes {
  return {
    _root: { $id: '_root', componentId: 'div', nodes: ['header', 'footer'] },
    header: { $id: 'header', componentId: 'muiAppBar', parentId: '_root', props: { component: 'header' }, nodes: ['toolbar'] },
    toolbar: { $id: 'toolbar', componentId: 'muiToolbar', parentId: 'header', nodes: ['row'] },
    row: { $id: 'row', componentId: 'muiContainer', parentId: 'toolbar', nodes: ['brand', 'middle', 'cart', 'drawer'] },
    ...link('brand', 'row', { children: 'Ember & Oak', screenId: 'home' }),
    middle: { $id: 'middle', componentId: 'muiStack', parentId: 'row', nodes: ['nav1', 'nav2', 'nav3'] },
    ...link('nav1', 'middle', { children: 'Shop', screenId: 'shop' }),
    ...link('nav2', 'middle', { children: 'About', screenId: 'about' }),
    ...link('nav3', 'middle', { children: 'Contact', screenId: 'contact' }),
    cart: { $id: 'cart', componentId: 'cart', parentId: 'row', props: { variant: 'button' }, nodes: [] },
    drawer: { $id: 'drawer', componentId: 'muiStack', parentId: 'row', nodes: ['menu1', 'menu2'] },
    ...link('menu1', 'drawer', { children: 'Shop', screenId: 'shop' }, { interactions: [{ on: 'click', do: 'closeDrawer' }] }),
    ...link('menu2', 'drawer', { children: 'About', screenId: 'about' }, { interactions: [{ on: 'click', do: 'closeDrawer' }] }),
    footer: { $id: 'footer', componentId: 'section', parentId: '_root', props: { element: 'footer' }, nodes: ['footerLinks', 'copyright'] },
    footerLinks: { $id: 'footerLinks', componentId: 'muiStack', parentId: 'footer', nodes: ['f1', 'f2', 'f3'] },
    ...link('f1', 'footerLinks', { children: 'Shop', screenId: 'shop' }),
    ...link('f2', 'footerLinks', { children: 'About', screenId: 'about' }),
    ...link('f3', 'footerLinks', { children: 'Privacy', screenId: 'privacy-page' }),
    copyright: { $id: 'copyright', componentId: 'muiTypography', parentId: 'footer', props: { children: '© Ember & Oak' }, nodes: [] },
  }
}

describe('a store’s links in the site’s own layout (AGL-3676)', () => {
  it('adds Account after the header’s links and in the phone menu, like its neighbours; no Cart beside a cart', () => {
    const result = aiLayoutWithStoreLinks(aiLayout(), LINKS, { 'privacy-page': 'privacy' })
    expect(result).toMatchObject({ header: true, footer: true })
    const nodes = result.nodes as Nodes
    expect(nodes['middle'].nodes).toEqual(['nav1', 'nav2', 'nav3', 'ai_store_header0_account'])
    expect(nodes['ai_store_header0_account']).toMatchObject({
      componentId: 'muiScreenLink',
      parentId: 'middle',
      props: { children: 'Account', href: '/account', renderAs: 'link', color: 'inherit' },
      sx: { textDecoration: 'none' },
    })
    expect(nodes['ai_store_header0_account'].props).not.toHaveProperty('screenId')
    const menu = nodes['drawer'].nodes ?? []
    expect(menu.slice(2).map((id) => [nodes[id].props?.['href'], nodes[id].interactions])).toEqual([
      ['/account', [{ on: 'click', do: 'closeDrawer' }]],
    ])
    expect(Object.values(nodes).some((node) => node.props?.['href'] === '/cart')).toBe(false)
  })

  it('adds the account and the policies to the footer’s list, skipping one already linked to the page at its address', () => {
    const nodes = aiLayoutWithStoreLinks(aiLayout(), LINKS, { 'privacy-page': 'privacy' }).nodes as Nodes
    expect((nodes['footerLinks'].nodes ?? []).map((id) => nodes[id].props?.['children'])).toEqual([
      'Shop',
      'About',
      'Privacy',
      'Your account',
      'Shipping & returns',
      'Terms of sale',
    ])
    expect(nodes['footer'].nodes).toEqual(['footerLinks', 'copyright'])
  })

  it('adds the Cart to a header with no cart of its own, in a Toolbar holding one link', () => {
    const starter: Nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['toolbar'] },
      toolbar: { $id: 'toolbar', componentId: 'muiToolbar', parentId: 'root', nodes: ['brand', 'search'] },
      ...link('brand', 'toolbar', { children: 'Hillside', screenId: 'home' }),
      search: { $id: 'search', componentId: 'searchBox', parentId: 'toolbar', nodes: [] },
    }
    const result = aiLayoutWithStoreLinks(starter, LINKS)
    expect(result).toMatchObject({ header: true, footer: false, added: ['/account', '/cart'] })
    const nodes = result.nodes as Nodes
    expect(nodes['toolbar'].nodes).toEqual(['brand', 'ai_store_header0_account', 'ai_store_header0_cart', 'search'])
  })

  it('leaves a layout with no header or footer list as it is', () => {
    const bare: Nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['text'] },
      text: { $id: 'text', componentId: 'muiTypography', parentId: 'root', props: { children: 'Hello' }, nodes: [] },
    }
    expect(aiLayoutWithStoreLinks(bare, LINKS)).toEqual({ nodes: null, header: false, footer: false, added: [] })
  })

  it('adds nothing a second time', () => {
    const once = aiLayoutWithStoreLinks(aiLayout(), LINKS).nodes as Nodes
    expect(aiLayoutWithStoreLinks(once, LINKS)).toMatchObject({ nodes: null, header: true, footer: true })
  })
})
