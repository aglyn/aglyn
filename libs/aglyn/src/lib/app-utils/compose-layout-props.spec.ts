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

import type {
  AglynNodeSchema,
  ReusableComponentProp,
} from '../foundation'
import {
  LAYOUT_SLOT_COMPONENT_ID,
  layoutNodeIdPrefix,
} from './compose-layout-nodes'
import {
  applyLayoutProps,
  composeLayoutChainWithProps,
  layoutPropValuesFor,
  SCREEN_LAYOUT_PROP_VALUES_KEY,
} from './compose-layout-props'
import { composeReusableComponentNodes } from './compose-reusable-components'

/**
 * A shared layout's properties, set by each screen rendering inside it
 * (AGL-2893).
 */

const ROOT = '_@_'

/** The marketing chrome: a banner each screen can hide and retitle. */
const SITE_LAYOUT: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['banner', 'nav', 'slot'] },
  banner: {
    $id: 'banner',
    componentId: 'muiAlert',
    parentId: ROOT,
    props: {
      children: '{{prop.bannerText}}',
      severity: '{{prop.bannerTone}}',
      hideUnless: '{{prop.showBanner}}',
    },
  },
  nav: {
    $id: 'nav',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: {
      refId: 'siteNav',
      propValues: { dark: '{{prop.darkNav}}', cta: '{{prop.ctaLabel}}' },
    },
    nodes: [],
  },
  slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
}

const SITE_PROPS: ReusableComponentProp[] = [
  { name: 'showBanner', type: 'boolean', defaultValue: false },
  {
    name: 'bannerText',
    type: 'text',
    defaultValue: 'We are hiring',
    condition: { when: 'showBanner', is: true },
  },
  {
    name: 'bannerTone',
    type: 'radio',
    options: [{ value: 'info' }, { value: 'success' }],
    defaultValue: 'info',
  },
  { name: 'darkNav', type: 'boolean' },
  { name: 'ctaLabel', type: 'text', defaultValue: 'Start free' },
]

/** A screen whose copy mentions a token of the same name, which is its own. */
const SCREEN: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['copy'] },
  copy: {
    $id: 'copy',
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'Write {{prop.bannerText}} to use it' },
  },
}

const prefixed = (id: string, depth = 1) => `${layoutNodeIdPrefix(depth)}${id}`

describe('layout properties set per screen (AGL-2893)', () => {
  it('is stored beside the layout binding, keyed by layout', () => {
    expect(SCREEN_LAYOUT_PROP_VALUES_KEY).toBe('layoutPropValues')
    expect(layoutPropValuesFor({ site: { showBanner: true } }, 'site')).toEqual({
      showBanner: true,
    })
    // Values for another layout are never read for this one.
    expect(layoutPropValuesFor({ other: { showBanner: true } }, 'site')).toBeUndefined()
    expect(layoutPropValuesFor(undefined, 'site')).toBeUndefined()
    expect(layoutPropValuesFor({ site: ['x'] }, 'site')).toBeUndefined()
  })

  it('renders the defaults for a screen that sets nothing, hiding what they hide', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE_LAYOUT, props: SITE_PROPS }],
      SCREEN,
    ) as Record<string, any>
    // `showBanner` defaults to no, so the banner is not on the page at all.
    expect(composed[prefixed('banner')]).toBeUndefined()
    expect(composed[ROOT].nodes).toEqual([prefixed('nav'), prefixed('slot')])
    expect(composed[prefixed('nav')].props.propValues).toEqual({
      cta: 'Start free',
    })
  })

  it("renders the screen's own values, typed as the layout declares them", () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE_LAYOUT, props: SITE_PROPS }],
      SCREEN,
      {
        site: {
          showBanner: true,
          bannerText: 'Launch week',
          bannerTone: 'success',
          darkNav: true,
        },
      },
    ) as Record<string, any>
    expect(composed[prefixed('banner')].props).toEqual({
      children: 'Launch week',
      severity: 'success',
    })
    // A value handed on to a component the layout places keeps its type.
    expect(composed[prefixed('nav')].props.propValues).toEqual({
      dark: true,
      cta: 'Start free',
    })
  })

  it("never touches a token in the screen's own copy", () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE_LAYOUT, props: SITE_PROPS }],
      SCREEN,
      { site: { showBanner: true } },
    ) as Record<string, any>
    expect(composed['copy'].props.children).toBe('Write {{prop.bannerText}} to use it')
    expect(composed['copy'].parentId).toBe(prefixed('slot'))
  })

  it('applies each layout of a chain its own values', () => {
    const outer: Record<string, AglynNodeSchema> = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['footer', 'slot'] },
      footer: {
        $id: 'footer',
        componentId: 'muiTypography',
        parentId: ROOT,
        props: { children: '{{prop.footerNote}}' },
      },
      slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
    }
    const composed = composeLayoutChainWithProps(
      [
        { layoutId: 'site', nodes: SITE_LAYOUT, props: SITE_PROPS },
        {
          layoutId: 'brand',
          nodes: outer,
          props: [{ name: 'footerNote', type: 'text', defaultValue: '© Aglyn' }],
        },
      ],
      SCREEN,
      { brand: { footerNote: 'Made in Austin' } },
    ) as Record<string, any>
    expect(composed[prefixed('footer', 2)].props.children).toBe('Made in Austin')
    expect(composed[prefixed('nav')].props.propValues.cta).toBe('Start free')
  })

  it('leaves a layout that declares nothing exactly as it was', () => {
    const plain = { ...SITE_LAYOUT, banner: { ...SITE_LAYOUT['banner'], props: {} } }
    delete (plain as Record<string, unknown>)['nav']
    plain[ROOT] = { ...plain[ROOT], nodes: ['banner', 'slot'] }
    expect(applyLayoutProps(plain, undefined, undefined)).toBe(plain)
    expect(applyLayoutProps(undefined, SITE_PROPS, {})).toBeUndefined()
  })

  it('hands a placed component its typed value, which its graft then renders', () => {
    const laidOut = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE_LAYOUT, props: SITE_PROPS }],
      SCREEN,
      { site: { darkNav: true } },
    )
    const grafted = composeReusableComponentNodes(laidOut, {
      siteNav: {
        rootId: 'n-root',
        nodes: {
          'n-root': {
            $id: 'n-root',
            componentId: 'muiAppBar',
            props: { enableColorOnDark: '{{prop.dark}}', title: '{{prop.cta}}' },
          },
        },
        props: [
          { name: 'dark', type: 'boolean', defaultValue: 'false' },
          { name: 'cta', type: 'text' },
        ],
      },
    }) as Record<string, any>
    expect(grafted[prefixed('nav')].props).toMatchObject({
      enableColorOnDark: true,
      title: 'Start free',
    })
  })
})
