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
 * WHERE THE `main` LANDMARK LANDS (AGL-2486).
 *
 * Measured on `https://aglyn.com/blog/…` before this: one `main`, emitted by
 * the tenant root layout, wrapping the site nav and the site footer along with
 * the article. The landmark existed and named the whole document, which is the
 * same as naming nothing.
 */

import type { AglynNodeSchema } from '../foundation'
import { LAYOUT_SLOT_COMPONENT_ID } from './compose-layout-nodes'
import { stampDocumentLandmark } from './document-landmark'

const ROOT = '_@_'

const elementOf = (node: AglynNodeSchema | undefined) =>
  (node?.props as { component?: string } | undefined)?.component

const withLayout = (
  slotProps: Record<string, unknown> = {},
  rootProps: Record<string, unknown> = {},
): Record<string, AglynNodeSchema> => ({
  [ROOT]: {
    $id: ROOT,
    componentId: 'div',
    nodes: ['layout__nav', 'layout__slot', 'layout__footer'],
    props: rootProps,
  },
  layout__nav: { $id: 'layout__nav', componentId: 'muiBox', parentId: ROOT },
  layout__slot: {
    $id: 'layout__slot',
    componentId: LAYOUT_SLOT_COMPONENT_ID,
    parentId: ROOT,
    props: slotProps,
  },
  layout__footer: {
    $id: 'layout__footer',
    componentId: 'muiBox',
    parentId: ROOT,
  },
})

const withoutLayout = (
  rootProps: Record<string, unknown> = {},
): Record<string, AglynNodeSchema> => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero'], props: rootProps },
  hero: { $id: 'hero', componentId: 'muiContainer', parentId: ROOT },
})

describe('stampDocumentLandmark (AGL-2486)', () => {
  it('puts it on the slot, so the chrome is outside it', () => {
    // The whole point: the nav and the footer are siblings of the landmark,
    // not children of it.
    const nodes = stampDocumentLandmark(withLayout())
    expect(elementOf(nodes['layout__slot'])).toBe('main')
    expect(elementOf(nodes[ROOT])).toBeUndefined()
  })

  it('puts it on the screen root when there is no layout', () => {
    // With no slot the root IS the page's content region.
    const nodes = stampDocumentLandmark(withoutLayout())
    expect(elementOf(nodes[ROOT])).toBe('main')
  })

  it('honours an author who claimed it on the Document layer', () => {
    const nodes = stampDocumentLandmark(withLayout({}, { component: 'main' }))
    expect(elementOf(nodes[ROOT])).toBe('main')
    // The slot does not also take one — that is the invariant.
    expect(elementOf(nodes['layout__slot'])).toBeUndefined()
  })

  it('leaves an author’s non-main choice on the slot alone', () => {
    // A layout whose slot is genuinely not the page's main content says so,
    // and the landmark falls back to the root rather than overruling them.
    const nodes = stampDocumentLandmark(withLayout({ component: 'section' }))
    expect(elementOf(nodes['layout__slot'])).toBe('section')
    expect(elementOf(nodes[ROOT])).toBe('main')
  })

  it('never ships two, even when both nodes ask for it', () => {
    const nodes = stampDocumentLandmark(
      withLayout({ component: 'main' }, { component: 'main' }),
    )
    expect(elementOf(nodes[ROOT])).toBe('main')
    expect(elementOf(nodes['layout__slot'])).toBe('div')
    const mains = Object.values(nodes).filter(
      (node) => elementOf(node) === 'main',
    )
    expect(mains).toHaveLength(1)
  })

  it('ships no landmark when the author chose one away everywhere', () => {
    // Both pickers were moved off `main` deliberately. Reinstating it would
    // make the field a suggestion rather than a choice.
    const nodes = stampDocumentLandmark(
      withLayout({ component: 'article' }, { component: 'div' }),
    )
    expect(
      Object.values(nodes).filter((node) => elementOf(node) === 'main'),
    ).toHaveLength(0)
  })

  it('leaves a layout-less root that chose a landmark alone (AGL-2514)', () => {
    // The Document layer offers the sectioning elements now, not just
    // `div` and `main`. A document that IS one region — a layout that is
    // nothing but chrome — must keep the element it was given rather than
    // being overwritten with the landmark it declined.
    const nodes = stampDocumentLandmark(withoutLayout({ component: 'header' }))
    expect(elementOf(nodes[ROOT])).toBe('header')
    expect(
      Object.values(nodes).filter((node) => elementOf(node) === 'main'),
    ).toHaveLength(0)
  })

  it('does not mutate its input', () => {
    const nodes = withLayout()
    const before = JSON.stringify(nodes)
    stampDocumentLandmark(nodes)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  it('invents nothing for a tree that is not a page', () => {
    // A subtree preview has neither root nor slot; a landmark stamped there
    // would be the second one on whatever document renders it.
    const fragment = {
      hero: { $id: 'hero', componentId: 'muiContainer' },
    } as Record<string, AglynNodeSchema>
    expect(stampDocumentLandmark(fragment)).toBe(fragment)
  })
})
