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

import type { ReusableComponentProp } from '../foundation/definitions/platform.types'
import { composeLayoutChainWithProps } from './compose-layout-props'
import {
  composeReusableComponentNodes,
  detachInstanceSubtree,
  REUSABLE_INSTANCE_COMPONENT_ID,
  resolveComponentPropTokens,
} from './compose-reusable-components'

/**
 * A link or image address a property feeds is held to the URL rule at the
 * point the token becomes a value (AGL-2933).
 *
 * A published node's own `href` and `src` are held to that rule when it is
 * published; a property's value arrives later, from the page that places the
 * component or the screen inside the layout, and the graft is where it lands
 * in the prop the element spreads. Canvas, Preview, detach and the tenant all
 * run the graft, so this is the one place a `javascript:` or `data:` value set
 * on a property can be stopped before it reaches any of them.
 */

const instance = (
  id: string,
  refId: string,
  propValues?: Record<string, unknown>,
) => ({
  $id: id,
  componentId: REUSABLE_INSTANCE_COMPONENT_ID,
  props: {
    refId,
    name: 'Placed component',
    ...(propValues ? { propValues } : {}),
  },
  nodes: [] as string[],
})

/** A card whose button, image and links read their addresses from properties. */
const CARD = {
  rootId: 'card',
  nodes: {
    card: {
      $id: 'card',
      componentId: 'muiStack',
      nodes: ['cta', 'photo', 'more', 'joined'],
    },
    cta: {
      $id: 'cta',
      componentId: 'muiButton',
      parentId: 'card',
      props: { href: '{{prop.link}}', children: 'Go' },
    },
    photo: {
      $id: 'photo',
      componentId: 'image',
      parentId: 'card',
      props: { src: '{{prop.image}}', href: '{{prop.link}}', alt: 'Photo' },
    },
    more: {
      $id: 'more',
      componentId: 'muiScreenLink',
      parentId: 'card',
      props: { href: 'https://example.com/{{prop.path}}', children: 'More' },
    },
    joined: {
      $id: 'joined',
      componentId: 'muiScreenLink',
      parentId: 'card',
      props: { href: '{{prop.scheme}}{{prop.path}}', children: 'Joined' },
    },
  },
  props: [
    { name: 'link', type: 'href', defaultValue: 'https://example.com/pricing' },
    { name: 'image', type: 'image', defaultValue: 'https://cdn.example.com/a.png' },
    { name: 'path', type: 'text', defaultValue: 'docs' },
    { name: 'scheme', type: 'text', defaultValue: 'https://example.com/' },
  ] as ReusableComponentProp[],
}

const compose = (
  propValues?: Record<string, unknown>,
  definition: typeof CARD = CARD,
) =>
  composeReusableComponentNodes(
    { card: instance('card', 'card', propValues) } as never,
    { card: definition as never },
  ) as Record<string, any>

const propsOf = (nodes: Record<string, any>, id: string) =>
  nodes[`cmp__card__${id}`]?.props as Record<string, unknown> | undefined

describe('a property-fed href or src holds to the URL rule (AGL-2933)', () => {
  it('renders the addresses a component defaults to', () => {
    const nodes = compose()
    expect(propsOf(nodes, 'cta')).toEqual({
      href: 'https://example.com/pricing',
      children: 'Go',
    })
    expect(propsOf(nodes, 'photo')).toEqual({
      src: 'https://cdn.example.com/a.png',
      href: 'https://example.com/pricing',
      alt: 'Photo',
    })
    expect(propsOf(nodes, 'more')?.['href']).toBe('https://example.com/docs')
    expect(propsOf(nodes, 'joined')?.['href']).toBe('https://example.com/docs')
  })

  it.each([
    ['a javascript: link', 'javascript:alert(document.cookie)'],
    ['one in capitals', 'JavaScript:alert(1)'],
    ['one behind spaces', '   javascript:alert(1)'],
    ['one behind a control character', '\u0001javascript:alert(1)'],
    ['one split by a tab', 'java\tscript:alert(1)'],
    ['a data: document', 'data:text/html,<script>alert(1)</script>'],
    ['a vbscript: link', 'vbscript:msgbox(1)'],
    ['a relative path no linking element follows', 'pricing'],
  ])('never hands a link %s', (_label, value) => {
    const nodes = compose({ link: value })
    // The address goes, and the element stays: a button with no link is a
    // button, and a picture with no link is a picture.
    expect(propsOf(nodes, 'cta')).toEqual({ children: 'Go' })
    expect(propsOf(nodes, 'photo')).toEqual({
      src: 'https://cdn.example.com/a.png',
      alt: 'Photo',
    })
    expect(JSON.stringify(nodes)).not.toMatch(/script:|data:text/i)
  })

  it.each([
    ['a javascript: image', 'javascript:alert(1)'],
    ['a data: document', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['an http image, which no page served over TLS can load', 'http://t.example.com/p.gif'],
    ['a vbscript: image', 'vbscript:msgbox(1)'],
  ])('never hands an image %s', (_label, value) => {
    const nodes = compose({ image: value })
    expect(propsOf(nodes, 'photo')).toEqual({
      href: 'https://example.com/pricing',
      alt: 'Photo',
    })
  })

  it.each([
    'https://example.com/pricing',
    'http://example.com/pricing',
    '/pricing',
    '#top',
    'mailto:hello@example.com',
    'tel:+15555550123',
    'screen:abc123',
    'collection:blog',
  ])('keeps the link %s', (value) => {
    expect(propsOf(compose({ link: value }), 'cta')?.['href']).toBe(value)
  })

  it.each([
    'https://cdn.example.com/b.png',
    '/api/media/cdn/host-1/abc123',
    'media:host-1/abc123',
    'data:image/png;base64,AAAA',
  ])('keeps the image %s', (value) => {
    expect(propsOf(compose({ image: value }), 'photo')?.['src']).toBe(value)
  })

  it('leaves a value opening with a host token to the stage that resolves it', () => {
    // `{{host.url}}` has no scheme until the host tokens resolve, after the
    // graft; the page composes it into the site's own address.
    expect(propsOf(compose({ link: '{{host.url}}/about' }), 'cta')?.['href']).toBe(
      '{{host.url}}/about',
    )
    expect(propsOf(compose({ image: '{{host.logo}}' }), 'photo')?.['src']).toBe(
      '{{host.logo}}',
    )
    // An unknown host token resolves to nothing, so what follows one is judged
    // as the whole address.
    for (const smuggled of [
      '{{host.nothing}}javascript:alert(1)',
      '{{host.nothing}} java\tscript:alert(1)',
      '{{var:x}}data:text/html,<script>alert(1)</script>',
    ]) {
      expect(propsOf(compose({ link: smuggled }), 'cta')).toEqual({ children: 'Go' })
    }
  })

  it('judges the address the whole value makes, not the token alone', () => {
    // Behind a literal scheme, a value is only ever a path on that site.
    expect(propsOf(compose({ path: 'javascript:alert(1)' }), 'more')?.['href']).toBe(
      'https://example.com/javascript:alert(1)',
    )
    // Two values that spell a scheme between them are refused together.
    const joined = compose({ scheme: 'javascript:', path: 'alert(1)' })
    expect(propsOf(joined, 'joined')).toEqual({ children: 'Joined' })
  })

  it('refuses a default no install ever checked', () => {
    const planted = {
      ...CARD,
      props: [
        { name: 'link', type: 'href', defaultValue: 'javascript:alert(1)' },
        { name: 'image', type: 'image', defaultValue: 'data:text/html,<b>' },
        ...CARD.props.slice(2),
      ] as ReusableComponentProp[],
    }
    const nodes = compose(undefined, planted)
    expect(propsOf(nodes, 'cta')).toEqual({ children: 'Go' })
    expect(propsOf(nodes, 'photo')).toEqual({ alt: 'Photo' })
  })

  it('leaves the stored definition as it was', () => {
    const before = JSON.stringify(CARD)
    compose({ link: 'javascript:alert(1)' })
    expect(JSON.stringify(CARD)).toBe(before)
  })

  it('holds a value handed on to a component placed inside to the same rule', () => {
    const OUTER = {
      rootId: 'o-root',
      nodes: {
        'o-root': { $id: 'o-root', componentId: 'muiStack', nodes: ['o-card'] },
        'o-card': {
          ...instance('o-card', 'card', { link: '{{prop.outerLink}}' }),
          parentId: 'o-root',
        },
      },
      props: [{ name: 'outerLink', type: 'href' }] as ReusableComponentProp[],
    }
    const nodes = composeReusableComponentNodes(
      { outer: instance('outer', 'outer', { outerLink: 'javascript:alert(1)' }) } as never,
      { outer: OUTER as never, card: CARD as never },
    ) as Record<string, any>
    const cta = Object.values(nodes).find(
      (node: any) => node?.componentId === 'muiButton',
    ) as any
    expect(cta?.props).toEqual({ children: 'Go' })
  })

  it('detaches into the addresses the instance was rendering', () => {
    let counter = 0
    const detached = detachInstanceSubtree(
      { card: instance('card', 'card', { link: 'javascript:alert(1)' }) } as never,
      'card',
      CARD as never,
      () => `n${++counter}`,
    ) as Record<string, any>
    const cta = Object.values(detached).find(
      (node: any) => node?.componentId === 'muiButton',
    ) as any
    expect(cta?.props).toEqual({ children: 'Go' })
  })

  it('holds a layout’s values to the same rule', () => {
    const ROOT = '_@_'
    const composeShell = (homeLink?: string) =>
      Object.values(
        composeLayoutChainWithProps(
          [
            {
              layoutId: 'shell',
              nodes: {
                [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['home', 'slot'] },
                home: {
                  $id: 'home',
                  componentId: 'muiScreenLink',
                  parentId: ROOT,
                  props: { href: '{{prop.homeLink}}', children: 'Home' },
                },
                slot: { $id: 'slot', componentId: 'layoutSlot', parentId: ROOT },
              } as never,
              props: [{ name: 'homeLink', type: 'href', defaultValue: '/' }],
            },
          ],
          { [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] } } as never,
          homeLink === undefined ? undefined : { shell: { homeLink } },
        ) as Record<string, any>,
      ).find((node: any) => node?.props?.children === 'Home') as any

    expect(composeShell()?.props).toEqual({ href: '/', children: 'Home' })
    expect(composeShell('javascript:alert(1)')?.props).toEqual({ children: 'Home' })
  })

  it('draws no address for a token nothing substituted', () => {
    // The component editor's raw-token view hands no values at all.
    const drawn = resolveComponentPropTokens(
      CARD.nodes as never,
      CARD.props,
      undefined,
    ) as Record<string, any>
    expect(drawn['cta'].props).toEqual({ children: 'Go' })
    expect(drawn['photo'].props).toEqual({ alt: 'Photo' })
    // A literal scheme ahead of the token is an address either way.
    expect(drawn['more'].props.href).toBe('https://example.com/{{prop.path}}')
  })
})
