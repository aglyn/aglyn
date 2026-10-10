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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiDoctrineTreeCheck } from './ai-doctrine'
import {
  aiSettleMechanicalRules,
  aiSettleWrittenMechanicalRules,
  detectDocumentStructure,
  detectHeavyDocument,
  detectInvisibleLinks,
  detectUnresponsiveGrids,
  validateAiDoctrineTree,
  type AiDoctrineTree,
} from './ai-doctrine-validators'
import type { AiOutputKind } from './ai-palette'

/*
 * A rule whose fix is one attribute is settled in code, never asked of the
 * model again and never a reason to refuse a page (AGL-3660). A live Free
 * guided start's Portfolio page (2026-10-10) was refused for rule 16's
 * `eager-image` after its pictures step loaded every opening photo eagerly.
 */

type Nested = {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  children?: Nested[]
}

/** A flat map from a nested literal, ids n1, n2, … in document order. */
function tree(root: Nested): AiDoctrineTree {
  const nodes: AiDoctrineTree['nodes'] = {}
  let counter = 0
  const visit = (nested: Nested, parentId: string | null): string => {
    const id = parentId === null ? CANVAS_ROOT_ELEMENT_ID : `n${++counter}`
    const { children = [], ...rest } = nested
    const node = { ...rest, $id: id, parentId, nodes: [] as string[] }
    nodes[id] = node
    for (const child of children) node.nodes.push(visit(child, id))
    return id
  }
  visit(root, null)
  return { rootId: CANVAS_ROOT_ELEMENT_ID, nodes }
}

const page = (...children: Nested[]): Nested => ({ componentId: 'div', children })
const section = (...children: Nested[]): Nested => ({ componentId: 'section', props: { element: 'section' }, children })
const text = (variant: string, copy: string, component?: string): Nested => ({
  componentId: 'muiTypography',
  props: { variant, children: copy, ...(component ? { component } : {}) },
})
const photo = (alt: string, loading?: 'eager' | 'lazy'): Nested => ({
  componentId: 'image',
  props: { src: '/_static/starter/hero.jpg', alt, ...(loading ? { loading } : {}) },
})
const codes = (violations: ReadonlyArray<{ code: string }>) => violations.map((violation) => violation.code)
const propsOf = (settled: AiDoctrineTree, id: string) => settled.nodes[id].props ?? {}

/** Settles, checks the settle is idempotent and copies rather than edits, and returns the settled tree. */
function settle(input: AiDoctrineTree, kind: AiOutputKind = 'page'): AiDoctrineTree {
  const before = JSON.stringify(input)
  const once = aiSettleMechanicalRules(input, kind)
  expect(JSON.stringify(input)).toBe(before)
  expect(aiSettleMechanicalRules(once, kind)).toBe(once)
  return once
}

describe('rule 16 eager-image: only the first image loads eagerly', () => {
  const portfolio = () =>
    tree(
      page(
        section(text('h1', 'Light, held still', 'h1'), photo('A bride at dusk', 'eager'), photo('A field of wheat', 'eager')),
        section(text('h2', 'Portfolio', 'h2'), photo('A city at night', 'eager'), photo('A child laughing', 'lazy')),
      ),
    )

  it('keeps the first image eager and unsets loading on every later one, in every section', () => {
    const input = portfolio()
    expect(codes(detectHeavyDocument(input, 'page'))).toContain('eager-image')
    const settled = settle(input)
    expect(propsOf(settled, 'n3')['loading']).toBe('eager')
    for (const id of ['n4', 'n7']) expect(propsOf(settled, id)).not.toHaveProperty('loading')
    // An image already lazy is not eager, and is left as written.
    expect(propsOf(settled, 'n8')['loading']).toBe('lazy')
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('eager-image')
  })

  it('lets the whole page check pass a page it refused, with no re-ask', () => {
    const input = portfolio()
    expect(codes(validateAiDoctrineTree(input, 'page').violations)).toContain('eager-image')
    expect(validateAiDoctrineTree(settle(input), 'page').violations).toEqual([])
  })

  it('settles an answer in the tree check before the check reads it, so the model is never asked again', () => {
    const result = aiDoctrineTreeCheck('page')({ tree: JSON.stringify(portfolio()) })
    expect(result.violations).toEqual([])
    const images = Object.values(result.value?.nodes ?? {}).filter((node) => node.componentId === 'image')
    expect(images.map((node) => node.props?.['loading'])).toEqual(['eager', undefined, undefined, 'lazy'])
  })
})

describe('rule 16 autoplay-video: a film loads nothing before it is played', () => {
  it('takes autoPlay and preload auto off, and leaves a film with no poster to the re-ask', () => {
    const video = (props: Record<string, unknown>): Nested => ({ componentId: 'video', props })
    const input = tree(
      page(
        section(
          video({ src: '/media/a.mp4', poster: '/media/a.jpg', autoPlay: true, preload: 'auto', muted: true }),
          video({ src: '/media/b.mp4' }),
        ),
      ),
    )
    expect(detectHeavyDocument(input, 'page').find((violation) => violation.code === 'autoplay-video')?.nodeIds).toEqual(['n2', 'n3'])
    const settled = settle(input)
    expect(propsOf(settled, 'n2')).toEqual({ src: '/media/a.mp4', poster: '/media/a.jpg', muted: true })
    expect(detectHeavyDocument(settled, 'page').find((violation) => violation.code === 'autoplay-video')?.nodeIds).toEqual(['n3'])
  })
})

describe('rule 16 extra-font: the theme’s typography', () => {
  it('takes an sx font family off outside an email, and keeps one in an email', () => {
    const lettered = (): Nested => ({ componentId: 'muiTypography', props: { variant: 'h1', component: 'h1', children: 'Hi' }, sx: { fontFamily: 'Lobster', color: 'primary.main' } })
    const input = tree(page(section(lettered())))
    expect(codes(detectHeavyDocument(input, 'page'))).toContain('extra-font')
    const settled = settle(input)
    expect(settled.nodes['n2'].sx).toEqual({ color: 'primary.main' })
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('extra-font')
    const email = tree(page(lettered()))
    expect(aiSettleMechanicalRules(email, 'email')).toBe(email)
  })
})

describe('rule 11 multiple-h1 and skipped-heading: the outline, by element only', () => {
  it('renders every h1 after the page’s first as an h2, keeping its variant', () => {
    const input = tree(page(section(text('h1', 'Portfolio', 'h1')), section(text('h1', 'Weddings', 'h1'), text('h1', 'Portraits'))))
    expect(codes(detectDocumentStructure(input, 'page'))).toContain('multiple-h1')
    const settled = settle(input)
    expect(propsOf(settled, 'n2')).toMatchObject({ variant: 'h1', component: 'h1' })
    expect(propsOf(settled, 'n4')).toMatchObject({ variant: 'h1', component: 'h2' })
    expect(propsOf(settled, 'n5')).toMatchObject({ variant: 'h1', component: 'h2' })
    expect(detectDocumentStructure(settled, 'page')).toEqual([])
  })

  it('steps a heading after the h1 that skips a level down to one below the heading before it', () => {
    const input = tree(page(section(text('h1', 'Portfolio', 'h1'), text('h4', 'Weddings', 'h4'), text('h3', 'Spring', 'h3'), text('h2', 'Prices', 'h2'))))
    expect(codes(detectDocumentStructure(input, 'page'))).toEqual(['skipped-heading'])
    const settled = settle(input)
    expect(['n2', 'n3', 'n4', 'n5'].map((id) => propsOf(settled, id)['component'])).toEqual(['h1', 'h2', 'h3', 'h2'])
    expect(propsOf(settled, 'n3')['variant']).toBe('h4')
    expect(detectDocumentStructure(settled, 'page')).toEqual([])
  })

  it('leaves a page with no h1, and a heading before the h1, to the model', () => {
    const none = tree(page(section(text('h2', 'Portfolio', 'h2'))))
    expect(aiSettleMechanicalRules(none, 'page')).toBe(none)
    const before = tree(page(section(text('h3', 'Eyebrow', 'h3'), text('h1', 'Portfolio', 'h1'))))
    expect(aiSettleMechanicalRules(before, 'page')).toBe(before)
  })

  it('takes every h1 out of a layout and all but one out of a component', () => {
    const layout = settle(tree(page(text('h1', 'Studio', 'h1'), { componentId: 'layoutSlot' })), 'layout')
    expect(propsOf(layout, 'n1')['component']).toBe('h2')
    expect(codes(detectDocumentStructure(layout, 'layout'))).not.toContain('multiple-h1')
    const component = settle(tree(page(text('h1', 'One', 'h1'), text('h1', 'Two', 'h1'))), 'component')
    expect(['n1', 'n2'].map((id) => propsOf(component, id)['component'])).toEqual(['h1', 'h2'])
    expect(detectDocumentStructure(component, 'component')).toEqual([])
  })
})

describe('rule 11 multiple-main and landmark-in-fragment: one main landmark', () => {
  const main = (): Nested => ({ componentId: 'muiBox', props: { component: 'main' }, children: [text('h1', 'Portfolio', 'h1')] })

  it('keeps a page’s first main and unsets every later one', () => {
    const input = tree(page(main(), { componentId: 'muiBox', props: { element: 'main' }, children: [text('h2', 'More', 'h2')] }))
    expect(codes(detectDocumentStructure(input, 'page'))).toContain('multiple-main')
    const settled = settle(input)
    expect(propsOf(settled, 'n1')['component']).toBe('main')
    expect(propsOf(settled, 'n3')).not.toHaveProperty('element')
    expect(detectDocumentStructure(settled, 'page')).toEqual([])
  })

  it('unsets the landmark in a component', () => {
    const input = tree(page(main()))
    expect(codes(detectDocumentStructure(input, 'component'))).toContain('landmark-in-fragment')
    const settled = settle(input, 'component')
    expect(propsOf(settled, 'n1')).not.toHaveProperty('component')
    expect(detectDocumentStructure(settled, 'component')).toEqual([])
  })
})

describe('rule 12 grid-gap: a container is spaced by its spacing', () => {
  const item = (): Nested => ({ componentId: 'muiGrid', props: { size: 'xs:12 md:6' }, children: [text('body1', 'A photo set.')] })
  const grid = (sx: Record<string, unknown>, props: Record<string, unknown> = {}): Nested => ({
    componentId: 'muiGrid',
    props: { container: true, ...props },
    sx,
    children: [item(), item()],
  })

  it('takes the sx gap off and makes it the spacing, a number as itself and anything else 2', () => {
    const numbered = tree(page(section(grid({ gap: 3, py: 2 }))))
    expect(codes(detectUnresponsiveGrids(numbered, 'page'))).toEqual(['grid-gap'])
    const settled = settle(numbered)
    expect(settled.nodes['n2'].sx).toEqual({ py: 2 })
    expect(propsOf(settled, 'n2')['spacing']).toBe(3)
    expect(detectUnresponsiveGrids(settled, 'page')).toEqual([])
    const worded = settle(tree(page(section(grid({ columnGap: '24px' })))))
    expect(propsOf(worded, 'n2')['spacing']).toBe(2)
  })

  it('keeps a spacing the container already sets', () => {
    const settled = settle(tree(page(section(grid({ gap: 4 }, { spacing: 1 })))))
    expect(propsOf(settled, 'n2')['spacing']).toBe(1)
    expect(detectUnresponsiveGrids(settled, 'page')).toEqual([])
  })
})

describe('rule 5 link-color-on-band: a link’s words in its band’s contrast text', () => {
  it('gives a link drawn in its band’s family that family’s contrast text', () => {
    const band: Nested = {
      componentId: 'muiBox',
      sx: { bgcolor: 'primary.main' },
      children: [
        text('h2', 'Book a session', 'h2'),
        { componentId: 'muiScreenLink', props: { screenId: 'scr-contact', children: 'Get in touch' } },
        { componentId: 'muiButton', props: { screenId: 'scr-contact', variant: 'contained', children: 'Book' } },
      ],
    }
    const input = tree(page(section(band)))
    expect(detectInvisibleLinks(input, 'page')[0]?.nodeIds).toEqual(['n4'])
    const settled = settle(input)
    expect(settled.nodes['n4'].sx).toEqual({ color: 'primary.contrastText' })
    // A contained button draws its own fill, and is left as written.
    expect(settled.nodes['n5']).toBe(input.nodes['n5'])
    expect(detectInvisibleLinks(settled, 'page')).toEqual([])
  })
})

describe('a tree with nothing mechanical to settle', () => {
  it('comes back as the same object, as written or as stored', () => {
    const clean = tree(page(section(text('h1', 'Portfolio', 'h1'), photo('A bride', 'eager'), photo('A field'))))
    expect(aiSettleMechanicalRules(clean, 'page')).toBe(clean)
    expect(aiSettleWrittenMechanicalRules(clean, 'page')).toBe(clean)
    expect(aiSettleWrittenMechanicalRules('not a tree', 'page')).toBe('not a tree')
  })

  it('reads an answer as written, leaving a node that is no palette node as it was', () => {
    const written = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['a', 'b', 'odd'] },
        a: { componentId: 'image', props: { alt: 'One', loading: 'eager' } },
        b: { componentId: 'image', props: { alt: 'Two', loading: 'eager' } },
        odd: { componentId: 'image', props: 'eager' },
      },
    }
    const settled = aiSettleWrittenMechanicalRules(written, 'page') as typeof written
    expect(settled.nodes.a.props).toEqual({ alt: 'One', loading: 'eager' })
    expect(settled.nodes.b.props).toEqual({ alt: 'Two' })
    expect(settled.nodes.odd).toBe(written.nodes.odd)
  })
})
