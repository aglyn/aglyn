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

import {
  AI_MENU_LABEL_MAX,
  aiLayoutWithMenuChanges,
  aiMenuChangesEmpty,
  aiMenuChangesOf,
  aiMenuNewRefs,
  aiMenusOf,
  type AiMenuChanges,
} from './ai-layout-menus'

/*
 * A site's menus are the Besigner's own elements in its layout (AGL-3728):
 * a header whose bar and phone menu each hold the same Page Links, and a
 * footer's list of them. The layout below is the shape the layout compiler
 * writes (`ai-layout-frame.ts`): the brand, a `nav` row, a call to action and
 * a Drawer whose `nav` stack closes the drawer when a link is followed.
 */

type Nodes = Record<string, { $id: string; componentId: string; parentId?: string; props?: Record<string, unknown>; nodes?: string[]; [key: string]: unknown }>

const CLOSE = [{ trigger: 'click', action: 'closeDrawer' }]

const link = (id: string, parentId: string, children: string, to: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  $id: id,
  componentId: 'muiScreenLink',
  pluginId: 'mui',
  parentId,
  props: { children, renderAs: 'link', color: 'inherit', ...to },
  sx: { textDecoration: 'none' },
  nodes: [],
  ...extra,
})

function frame(): Nodes {
  return {
    root: { $id: 'root', componentId: 'div', nodes: ['bar', 'slot', 'footer'] },
    bar: { $id: 'bar', componentId: 'muiAppBar', parentId: 'root', nodes: ['toolbar'] },
    toolbar: { $id: 'toolbar', componentId: 'muiToolbar', parentId: 'bar', nodes: ['row'] },
    row: { $id: 'row', componentId: 'muiContainer', parentId: 'toolbar', nodes: ['ll1-brand', 'nav', 'cta', 'account', 'drawer'] },
    'll1-brand': link('ll1-brand', 'row', 'Juniper Clay', { screenId: 'home' }),
    nav: { $id: 'nav', componentId: 'muiStack', parentId: 'row', props: { component: 'nav', ariaLabel: 'Main', direction: 'row' }, nodes: ['n-home', 'n-about', 'n-blog'] },
    'n-home': link('n-home', 'nav', 'Home', { screenId: 'home' }),
    'n-about': link('n-about', 'nav', 'About', { screenId: 'about' }),
    'n-blog': link('n-blog', 'nav', 'Blog', { href: '/blog' }),
    cta: { $id: 'cta', componentId: 'muiButton', parentId: 'row', props: { children: 'Book a class' } },
    account: link('account', 'row', 'Account', { href: '/account' }),
    drawer: { $id: 'drawer', componentId: 'muiDrawer', parentId: 'row', nodes: ['menu'] },
    menu: { $id: 'menu', componentId: 'muiStack', parentId: 'drawer', props: { component: 'nav', ariaLabel: 'Menu' }, nodes: ['m-home', 'm-about', 'm-blog', 'm-cta'] },
    'm-home': link('m-home', 'menu', 'Home', { screenId: 'home' }, { interactions: CLOSE }),
    'm-about': link('m-about', 'menu', 'About', { screenId: 'about' }, { interactions: CLOSE }),
    'm-blog': link('m-blog', 'menu', 'Blog', { href: '/blog' }, { interactions: CLOSE }),
    'm-cta': { $id: 'm-cta', componentId: 'muiButton', parentId: 'menu', props: { children: 'Book a class' } },
    slot: { $id: 'slot', componentId: 'layoutSlot', parentId: 'root' },
    footer: { $id: 'footer', componentId: 'section', parentId: 'root', props: { element: 'footer' }, nodes: ['f-links', 'f-copy'] },
    'f-links': { $id: 'f-links', componentId: 'muiStack', parentId: 'footer', nodes: ['f-home', 'f-about', 'f-blog'] },
    'f-home': link('f-home', 'f-links', 'Home', { screenId: 'home' }),
    'f-about': link('f-about', 'f-links', 'About', { screenId: 'about' }),
    'f-blog': link('f-blog', 'f-links', 'Blog', { href: '/blog' }),
    'f-copy': { $id: 'f-copy', componentId: 'muiTypography', parentId: 'footer', props: { children: '© Juniper Clay' } },
  }
}

const none = (): AiMenuChanges => ({ add: [], remove: [], rename: [], relink: [], order: [] })
const labels = (nodes: Nodes | null, list: string) =>
  (nodes?.[list]?.nodes ?? []).map((id) => {
    const node = nodes?.[id]
    return String(node?.componentId === 'muiNavMenu' ? `[${node?.props?.['label']}]` : node?.props?.['children'] ?? node?.componentId)
  })

describe('a site’s menus, changed by code (AGL-3728)', () => {
  it('adds an item to the bar and the phone menu alike, each a copy of its neighbours', () => {
    const changes = { ...none(), add: [{ parent: null, label: 'Pricing', to: { screenId: 'pricing' } }] }
    const result = aiLayoutWithMenuChanges(frame(), ['header'], changes)
    const nodes = result.nodes as Nodes
    expect(labels(nodes, 'nav')).toEqual(['Home', 'About', 'Blog', 'Pricing'])
    // After the phone menu's links, before its call to action.
    expect(labels(nodes, 'menu')).toEqual(['Home', 'About', 'Blog', 'Pricing', 'Book a class'])
    const added = nodes['menu'].nodes?.[3] as string
    expect(nodes[added]).toMatchObject({
      componentId: 'muiScreenLink',
      parentId: 'menu',
      props: { children: 'Pricing', screenId: 'pricing', renderAs: 'link' },
      // A link followed from the phone menu closes it, as its neighbours do.
      interactions: CLOSE,
    })
    expect(nodes[added].props).not.toHaveProperty('href')
    // The brand, the call to action, the account link and the footer are left as they were.
    expect(labels(nodes, 'row')).toEqual(['Juniper Clay', 'muiStack', 'Book a class', 'Account', 'muiDrawer'])
    expect(labels(nodes, 'f-links')).toEqual(['Home', 'About', 'Blog'])
    expect(result).toMatchObject({ found: { header: true }, done: ['Added “Pricing” to the header.'], notDone: [] })
  })

  it('takes out, renames, relinks and reorders, in the header and the footer', () => {
    const changes: AiMenuChanges = {
      add: [],
      remove: [{ parent: null, label: 'blog' }],
      rename: [{ parent: null, label: 'About', name: 'Our story' }],
      relink: [{ parent: null, label: 'Home', to: { href: '/' } }],
      order: ['Our story'],
    }
    const result = aiLayoutWithMenuChanges(frame(), ['header', 'footer'], changes)
    const nodes = result.nodes as Nodes
    expect(labels(nodes, 'nav')).toEqual(['Our story', 'Home'])
    expect(labels(nodes, 'menu')).toEqual(['Our story', 'Home', 'Book a class'])
    expect(labels(nodes, 'f-links')).toEqual(['Our story', 'Home'])
    // The removed links are gone from the store, not only from their lists.
    for (const id of ['n-blog', 'm-blog', 'f-blog']) expect(nodes[id]).toBeUndefined()
    expect(nodes['n-home'].props).toEqual(expect.objectContaining({ href: '/' }))
    expect(nodes['n-home'].props).not.toHaveProperty('screenId')
    expect(result.notDone).toEqual([])
    expect(result.done).toEqual(
      expect.arrayContaining([
        'Took “blog” out of the header.',
        'Took “blog” out of the footer.',
        'Renamed “About” to “Our story” in the footer.',
        'Put “Our story” in its place in the header.',
      ]),
    )
  })

  it('puts an item under a dropdown in the bar, made from the link of that name, and flat in the phone menu', () => {
    const changes = { ...none(), add: [{ parent: 'About', label: 'Our team', to: { screenId: 'team' } }] }
    const nodes = aiLayoutWithMenuChanges(frame(), ['header'], changes).nodes as Nodes
    expect(labels(nodes, 'nav')).toEqual(['Home', '[About]', 'Blog'])
    const dropdown = nodes['nav'].nodes?.[1] as string
    expect(nodes[dropdown]).toMatchObject({ componentId: 'muiNavMenu', pluginId: 'mui', parentId: 'nav', props: { label: 'About' } })
    // The old About link is the dropdown's first entry, the new one after it.
    expect(labels(nodes, dropdown)).toEqual(['About', 'Our team'])
    expect(nodes['n-about'].parentId).toBe(dropdown)
    // A phone menu holds no dropdowns: the entry follows its parent.
    expect(labels(nodes, 'menu')).toEqual(['Home', 'About', 'Our team', 'Blog', 'Book a class'])
    // A second entry under the same parent joins the same dropdown.
    const again = aiLayoutWithMenuChanges(nodes, ['header'], { ...none(), add: [{ parent: 'About', label: 'Press', to: { href: '/press' } }] }).nodes as Nodes
    expect(labels(again, dropdown)).toEqual(['About', 'Our team', 'Press'])
    // …and it can be taken out and renamed by its place.
    const out = aiLayoutWithMenuChanges(again, ['header'], {
      ...none(),
      remove: [{ parent: 'About', label: 'Press' }],
      rename: [{ parent: null, label: 'About', name: 'Studio' }],
    }).nodes as Nodes
    expect(labels(out, 'nav')).toEqual(['Home', '[Studio]', 'Blog'])
    expect(labels(out, dropdown)).toEqual(['About', 'Our team'])
  })

  it('never touches the brand, and says what it could not find', () => {
    const result = aiLayoutWithMenuChanges(frame(), ['header'], {
      ...none(),
      remove: [{ parent: null, label: 'Juniper Clay' }],
      relink: [{ parent: null, label: 'Shop', to: { href: '/shop' } }],
      order: ['Gallery'],
    })
    expect(result.nodes).toBeNull()
    expect(result.notDone).toEqual([
      'No “Juniper Clay” in the header to take out.',
      'No “Shop” in the header to relink.',
      'No “Gallery” in the header to put in order.',
    ])
  })

  it('adds nothing twice, and leaves a layout with no menu list as it is, saying so', () => {
    const twice = aiLayoutWithMenuChanges(frame(), ['header'], { ...none(), add: [{ parent: null, label: 'about', to: { screenId: 'about' } }] })
    expect(twice.nodes).toBeNull()
    expect(twice.done).toEqual(['“about” was already in the header.'])
    const bare = { root: { $id: 'root', componentId: 'div', nodes: ['slot'] }, slot: { $id: 'slot', componentId: 'layoutSlot' } }
    const result = aiLayoutWithMenuChanges(bare, ['header', 'footer'], { ...none(), add: [{ parent: null, label: 'About', to: { screenId: 'about' } }] })
    expect(result).toMatchObject({ nodes: null, found: { header: false, footer: false } })
    expect(result.notDone).toEqual([
      'The header has no list of links to change: add them in the layout by hand.',
      'The footer has no list of links to change: add them in the layout by hand.',
    ])
  })

  it('reads the Besigner’s Mobile Nav preset, whose row is no `nav` landmark', () => {
    const preset: Nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['bar'] },
      bar: { $id: 'bar', componentId: 'section', props: { element: 'header' }, nodes: ['row'] },
      row: { $id: 'row', componentId: 'muiStack', parentId: 'bar', props: { direction: 'row' }, nodes: ['a', 'b', 'c'] },
      a: link('a', 'row', 'Home', { screenId: 'home' }),
      b: link('b', 'row', 'About', {}),
      c: link('c', 'row', 'Contact', {}),
    }
    const nodes = aiLayoutWithMenuChanges(preset, ['header'], { ...none(), relink: [{ parent: null, label: 'Contact', to: { screenId: 'contact' } }], order: ['Contact'] }).nodes as Nodes
    expect(labels(nodes, 'row')).toEqual(['Contact', 'Home', 'About'])
    expect(nodes['c'].props).toMatchObject({ screenId: 'contact' })
  })

  it('leaves the nodes it was given as they were', () => {
    const given = frame()
    const before = JSON.stringify(given)
    aiLayoutWithMenuChanges(given, ['header', 'footer'], { ...none(), remove: [{ parent: null, label: 'Blog' }], add: [{ parent: 'X', label: 'Y', to: { href: '/y' } }] })
    expect(JSON.stringify(given)).toBe(before)
  })
})

describe('a menu change as an item’s arguments carry it (AGL-3728)', () => {
  const target = (destination: string) =>
    destination === 'new:Pricing' ? { screenId: 'p-pricing' } : destination.startsWith('/') ? { href: destination } : null

  it('reads each entry’s words, and leaves out what it cannot link, with a sentence', () => {
    const read = aiMenuChangesOf(
      {
        menu: 'both',
        add: ['Pricing => new:Pricing', 'Services > Roofing => /roofing', 'Elsewhere => javascript:alert(1)', 'No destination'],
        remove: ['Blog', 'Services > Old'],
        rename: ['About => Our story', 'Broken'],
        relink: ['Home => /'],
        order: ['Home', 'Pricing'],
      },
      target,
    )
    expect(read.changes).toEqual({
      add: [
        { parent: null, label: 'Pricing', to: { screenId: 'p-pricing' } },
        { parent: 'Services', label: 'Roofing', to: { href: '/roofing' } },
      ],
      remove: [
        { parent: null, label: 'Blog' },
        { parent: 'Services', label: 'Old' },
      ],
      rename: [{ parent: null, label: 'About', name: 'Our story' }],
      relink: [{ parent: null, label: 'Home', to: { href: '/' } }],
      order: ['Home', 'Pricing'],
    })
    expect(read.problems).toEqual([
      '“Elsewhere” links “javascript:alert(1)”, which is no page or address on this site, so it was left out.',
      '“No destination” is not “Label => page or address”, so it was left out.',
      '“Broken” is not “Old name => New name”, so it was left out.',
    ])
    expect(aiMenuChangesEmpty(read.changes)).toBe(false)
    expect(aiMenuChangesEmpty(aiMenuChangesOf({ add: 'not a list' }, target).changes)).toBe(true)
  })

  it('caps a label, and names the menus and the pages an item links', () => {
    const long = 'L'.repeat(80)
    expect(aiMenuChangesOf({ remove: [long] }, target).changes.remove[0].label).toHaveLength(AI_MENU_LABEL_MAX)
    expect(aiMenusOf('footer')).toEqual(['footer'])
    expect(aiMenusOf('both')).toEqual(['header', 'footer'])
    expect(aiMenusOf(undefined)).toEqual(['header'])
    expect(aiMenuNewRefs({ add: ['Pricing => new:Pricing', 'Team => /team'], relink: ['Home => new:Home', 'Again => new:Pricing'] })).toEqual([
      'new:Pricing',
      'new:Home',
    ])
  })
})
