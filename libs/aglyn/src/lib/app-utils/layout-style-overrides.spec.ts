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

import type { AglynNodeSchema } from '../foundation'
import { CanvasManager } from '../canvas-manager/canvas-manager'
import {
  LAYOUT_SLOT_COMPONENT_ID,
  layoutNodeIdPrefix,
} from './compose-layout-nodes'
import { composeLayoutChainWithProps } from './compose-layout-props'
import {
  applyLayoutStyleOverrides,
  extractLayoutStyleOverrides,
  injectLayoutStyleOverrides,
  layoutStyleOverridesFor,
  normalizeLayoutStyleOverrides,
  replaceUnderMerge,
  SCREEN_LAYOUT_STYLE_OVERRIDES_KEY,
} from './layout-style-overrides'
import { SX_SCHEME_DARK_KEY } from './scheme-sx'

/** A screen restyling its shared layout's elements for itself (AGL-3286). */

const ROOT = '_@_'

const SITE: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['nav', 'slot', 'footer'] },
  nav: {
    $id: 'nav',
    componentId: 'muiAppBar',
    parentId: ROOT,
    sx: {
      bgcolor: 'primary.main',
      py: 2,
      [SX_SCHEME_DARK_KEY]: { bgcolor: 'grey.900', color: 'common.white' },
    },
  },
  slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
  footer: {
    $id: 'footer',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: { refId: 'siteFooter' },
    styleOverrides: { root: { color: 'text.secondary' } },
  } as AglynNodeSchema,
}

/** An outer layout the site layout renders inside. */
const SHELL: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['banner', 'slot'] },
  banner: {
    $id: 'banner',
    componentId: 'muiAlert',
    parentId: ROOT,
    sx: { bgcolor: 'warning.main' },
  },
  slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
}

const SCREEN: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero'] },
  hero: { $id: 'hero', componentId: 'muiBox', parentId: ROOT },
}

describe('composeLayoutChainWithProps with layout style overrides', () => {
  it('merges a page override over one layout element, leaving its siblings', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE }],
      SCREEN,
      undefined,
      { site: { nav: { bgcolor: 'transparent', position: 'absolute' } } },
    )
    // One spelling after the merge (AGL-2209): `bgcolor` reads back as
    // `backgroundColor`, `py` as its two edges.
    expect(composed[`${layoutNodeIdPrefix(1)}nav`].sx).toEqual({
      backgroundColor: 'transparent',
      position: 'absolute',
      paddingTop: 2,
      paddingBottom: 2,
      [SX_SCHEME_DARK_KEY]: {
        backgroundColor: 'grey.900',
        color: 'common.white',
      },
    })
    // The layout's content is untouched, and the input is never mutated.
    expect(composed[`${layoutNodeIdPrefix(1)}nav`].componentId).toBe('muiAppBar')
    expect(SITE['nav'].sx).toEqual({
      bgcolor: 'primary.main',
      py: 2,
      [SX_SCHEME_DARK_KEY]: { bgcolor: 'grey.900', color: 'common.white' },
    })
  })

  it('keeps the base `@scheme dark` slice and merges an override slice into it', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE }],
      SCREEN,
      undefined,
      { site: { nav: { [SX_SCHEME_DARK_KEY]: { bgcolor: 'transparent' } } } },
    )
    expect(
      (composed[`${layoutNodeIdPrefix(1)}nav`].sx as Record<string, unknown>)[
        SX_SCHEME_DARK_KEY
      ],
    ).toEqual({ backgroundColor: 'transparent', color: 'common.white' })
  })

  it('styles an element of an OUTER layout by that layout id', () => {
    const composed = composeLayoutChainWithProps(
      [
        { layoutId: 'site', nodes: SITE },
        { layoutId: 'shell', nodes: SHELL },
      ],
      SCREEN,
      undefined,
      {
        shell: { banner: { bgcolor: 'info.main' } },
        site: { nav: { bgcolor: 'transparent' } },
      },
    )
    expect(composed[`${layoutNodeIdPrefix(2)}banner`].sx).toEqual({
      backgroundColor: 'info.main',
    })
    expect(
      (composed[`${layoutNodeIdPrefix(1)}nav`].sx as Record<string, unknown>)[
        'backgroundColor'
      ],
    ).toBe('transparent')
  })

  it('never hands one layout the overrides keyed by another', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE }],
      SCREEN,
      undefined,
      { other: { nav: { bgcolor: 'transparent' } } },
    )
    expect(
      (composed[`${layoutNodeIdPrefix(1)}nav`].sx as Record<string, unknown>)[
        'bgcolor'
      ],
    ).toBe('primary.main')
  })

  it('ignores a node id the layout no longer has', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE }],
      SCREEN,
      undefined,
      { site: { removedLongAgo: { bgcolor: 'red' } } },
    )
    expect(composed).toEqual(
      composeLayoutChainWithProps([{ layoutId: 'site', nodes: SITE }], SCREEN),
    )
    expect(
      Object.keys(composed).some((id) => id.includes('removedLongAgo')),
    ).toBe(false)
  })

  it('restyles a component instance through its root override slice', () => {
    const composed = composeLayoutChainWithProps(
      [{ layoutId: 'site', nodes: SITE }],
      SCREEN,
      undefined,
      { site: { footer: { bgcolor: 'grey.100' } } },
    )
    const footer = composed[`${layoutNodeIdPrefix(1)}footer`]
    expect((footer as { styleOverrides?: unknown }).styleOverrides).toEqual({
      root: { color: 'text.secondary', backgroundColor: 'grey.100' },
    })
    expect(footer.sx).toBeUndefined()
  })
})

describe('layout style override helpers', () => {
  it('names the persisted key', () => {
    expect(SCREEN_LAYOUT_STYLE_OVERRIDES_KEY).toBe('layoutStyleOverrides')
  })

  it('reads one layout, dropping empty and malformed entries', () => {
    expect(
      layoutStyleOverridesFor(
        { site: { nav: { color: 'red' }, footer: {}, bad: 'x' } },
        'site',
      ),
    ).toEqual({ nav: { color: 'red' } })
    expect(layoutStyleOverridesFor({ site: {} }, 'site')).toBeUndefined()
    expect(layoutStyleOverridesFor(undefined, 'site')).toBeUndefined()
    expect(layoutStyleOverridesFor({ site: ['x'] }, 'site')).toBeUndefined()
    expect(normalizeLayoutStyleOverrides({ a: { b: {} } })).toBeUndefined()
  })

  it('returns the nodes by identity when nothing applies', () => {
    expect(applyLayoutStyleOverrides(SITE, undefined)).toBe(SITE)
    expect(applyLayoutStyleOverrides(SITE, { gone: { color: 'red' } })).toBe(
      SITE,
    )
  })
})

describe('the editor round trip of layout style overrides', () => {
  const stored = { site: { nav: { bgcolor: 'transparent' } } }

  it('parks the overrides on the root and lifts them back out', () => {
    const injected = injectLayoutStyleOverrides(SCREEN, stored)!
    expect(injected[ROOT]).toMatchObject({ layoutStyleOverrides: stored })
    expect(SCREEN[ROOT]).not.toHaveProperty('layoutStyleOverrides')
    const { nodes, layoutStyleOverrides } = extractLayoutStyleOverrides(injected)
    expect(nodes).toEqual(SCREEN)
    expect(layoutStyleOverrides).toEqual(stored)
  })

  it('injects nothing when there is nothing to inject', () => {
    expect(injectLayoutStyleOverrides(SCREEN, undefined)).toBe(SCREEN)
    expect(injectLayoutStyleOverrides(SCREEN, { site: {} })).toBe(SCREEN)
    expect(extractLayoutStyleOverrides(SCREEN).nodes).toBe(SCREEN)
  })

  it('survives the canvas: loaded, edited nowhere, serialized unchanged', () => {
    const canvas = new CanvasManager(undefined as any)
    const injected = injectLayoutStyleOverrides(
      SCREEN as Record<string, any>,
      stored,
    )!
    canvas.setNodes(canvas.processNodesToDenormalized(injected as any))
    const json = canvas.toJSON().nodes as Record<string, any>
    expect(json[ROOT].layoutStyleOverrides).toEqual(stored)
    expect(extractLayoutStyleOverrides(json).layoutStyleOverrides).toEqual(
      stored,
    )
  })

  it('writes a merge-set that replaces the stored map exactly', () => {
    const REMOVE = Symbol('remove')
    expect(
      replaceUnderMerge(
        { site: { nav: { bgcolor: 'x', color: 'y' }, footer: { p: 1 } } },
        { site: { nav: { bgcolor: 'z' } } },
        () => REMOVE,
      ),
    ).toEqual({ site: { nav: { bgcolor: 'z', color: REMOVE }, footer: REMOVE } })
    expect(replaceUnderMerge({ site: {} }, undefined, () => REMOVE)).toBe(REMOVE)
    expect(replaceUnderMerge(undefined, undefined, () => REMOVE)).toBeUndefined()
    expect(replaceUnderMerge(undefined, { a: 1 }, () => REMOVE)).toEqual({ a: 1 })
  })
})
