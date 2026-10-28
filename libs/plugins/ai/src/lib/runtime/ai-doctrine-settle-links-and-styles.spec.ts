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
import {
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  type AiPageSection,
} from '../jobs/ai-job-page-sections'
import { AI_PAGE_BRIEF_FIXTURES } from '../jobs/fixtures/ai-page-briefs'
import { aiDoctrineTreeCheck } from './ai-doctrine'
import {
  aiSettleLinksWithoutDestination,
  aiSettleMechanicalRules,
  detectHeavyDocument,
  detectLinksWithoutDestination,
  type AiDoctrineTree,
  type AiLinkSettleContext,
} from './ai-doctrine-validators'
import type { AiOutputKind } from './ai-palette'

/*
 * THREE RULES THAT STOPPED JOBS, SETTLED IN CODE (AGL-4076).
 *
 * In the 10/10 to 10/28 window 8 of the 26 page and build jobs that never
 * finished stopped at doctrine review, and 7 of the 12 findings behind them
 * were rule 10's `link-without-destination` (3) and `link-fragment` (2), and
 * rule 16's `duplicated-inline-style` (2). The answers themselves are not
 * kept, so the trees below rebuild each finding from the shapes the live
 * stops recorded: a hero call to action with no destination, one sent to an
 * anchor no section carries, a send button drawn inside a form, a footer
 * link with no page, and a row of columns that each repeat one style.
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
const stack = (...children: Nested[]): Nested => ({ componentId: 'muiStack', props: { direction: 'row' }, children })
const text = (variant: string, copy: string, sx?: Record<string, unknown>): Nested => ({
  componentId: 'muiTypography',
  props: { variant, children: copy, ...(variant === 'h1' ? { component: 'h1' } : {}) },
  ...(sx ? { sx } : {}),
})
const button = (props: Record<string, unknown>): Nested => ({ componentId: 'muiButton', props: { variant: 'contained', ...props } })
const pageLink = (props: Record<string, unknown>): Nested => ({ componentId: 'muiScreenLink', props: { renderAs: 'link', ...props } })
const codes = (violations: ReadonlyArray<{ code: string }>) => violations.map((violation) => violation.code)
const componentsOf = (settled: { nodes: Record<string, { componentId: string }> }) =>
  Object.values(settled.nodes).map((node) => node.componentId)

/** Settles links, checks the settle is idempotent and copies rather than edits, and returns the settled tree. */
function settleLinks(input: AiDoctrineTree, context: AiLinkSettleContext = {}, kind: AiOutputKind = 'page'): AiDoctrineTree {
  const before = JSON.stringify(input)
  const once = aiSettleLinksWithoutDestination(input, kind, context)
  expect(JSON.stringify(input)).toBe(before)
  expect(aiSettleLinksWithoutDestination(once, kind, context)).toBe(once)
  return once
}

/** The hero of a live Free About page (AGL-3072), with its call to action written as `cta`. */
const aboutHero = (cta: Nested) =>
  tree(
    page(
      section(
        text('h1', 'Estate planning for families'),
        text('body1', 'Wills, trusts and powers of attorney, explained in plain words.'),
        stack(cta),
      ),
      section(text('h2', 'Practice areas'), text('body1', 'Wills, trusts and probate.')),
    ),
  )

describe('rule 10, a link that goes nowhere (link-without-destination)', () => {
  it('takes a hero call to action with no destination out, and the row it was alone in with it', () => {
    const input = aboutHero(button({ children: 'Request a Consultation' }))
    expect(codes(detectLinksWithoutDestination(input, 'page'))).toEqual(['link-without-destination'])
    const settled = settleLinks(input)
    expect(componentsOf(settled)).not.toContain('muiButton')
    // The row held nothing else, so it goes too; the section and its words stay.
    expect(componentsOf(settled)).not.toContain('muiStack')
    expect(settled.nodes['n1'].nodes).toEqual(['n2', 'n3'])
    expect(detectLinksWithoutDestination(settled, 'page')).toEqual([])
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('empty-container')
  })

  it('sends a call to action that asks to get in touch to the page that places the site’s form, never this one', () => {
    const input = aboutHero(button({ children: 'Book a consultation' }))
    const settled = settleLinks(input, { formScreenIds: ['scr-about', 'scr-contact'], ownScreenIds: ['scr-about'] })
    const cta = Object.values(settled.nodes).find((node) => node.componentId === 'muiButton')
    expect(cta?.props).toEqual({ variant: 'contained', children: 'Book a consultation', screenId: 'scr-contact' })
    // Its words say nothing about getting in touch: there is no page to choose for it.
    const learn = settleLinks(aboutHero(button({ children: 'Learn more' })), { formScreenIds: ['scr-contact'] })
    expect(componentsOf(learn)).not.toContain('muiButton')
  })

  it('takes a send button drawn inside a form out, and gives its words to the form when it has none', () => {
    const form = (props: Record<string, unknown>): Nested => ({
      componentId: 'form',
      props: { formId: 'frm-consultation', ...props },
      children: [button({ children: 'Send my request', type: 'submit' })],
    })
    const unlabeled = settleLinks(tree(page(section(text('h2', 'Request a consultation'), form({})))))
    expect(unlabeled.nodes['n3'].props).toEqual({ formId: 'frm-consultation', submitLabel: 'Send my request' })
    expect(unlabeled.nodes['n3'].nodes).toEqual([])
    // A form that already says what its button says keeps its own words.
    const labeled = settleLinks(tree(page(section(text('h2', 'Request a consultation'), form({ submitLabel: 'Send' })))))
    expect(labeled.nodes['n3'].props).toEqual({ formId: 'frm-consultation', submitLabel: 'Send' })
    expect(componentsOf(labeled)).not.toContain('muiButton')
  })

  it('takes a footer link with no page out of a layout, and leaves the column its siblings are in', () => {
    const footer = tree(
      page({
        componentId: 'section',
        props: { element: 'footer' },
        children: [
          {
            componentId: 'muiStack',
            children: [
              text('subtitle2', 'Company'),
              pageLink({ children: 'About', href: '/about' }),
              pageLink({ children: 'Privacy policy' }),
            ],
          },
        ],
      }),
    )
    expect(codes(detectLinksWithoutDestination(footer, 'layout'))).toEqual(['link-without-destination'])
    const settled = settleLinks(footer, {}, 'layout')
    expect(settled.nodes['n2'].nodes).toEqual(['n3', 'n4'])
    expect(detectLinksWithoutDestination(settled, 'layout')).toEqual([])
  })

  it('never touches a link that goes somewhere, and leaves a scroll to no section to its own finding', () => {
    const sections = ['hero', 'practice areas']
    const going = tree(
      page(
        section(
          text('h1', 'Estate planning'),
          button({ children: 'Our practice areas', scrollTo: 'practice areas' }),
          button({ children: 'Call us', href: 'tel:+15125550100' }),
          button({ children: 'Our fees', href: '/fees' }),
          button({ children: 'About us', screenId: 'scr-about' }),
          {
            ...button({ children: 'See how we work' }),
            interactions: [{ enabled: true, trigger: { event: 'elementClick' }, steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:n8"]' }] }],
          } as Nested,
        ),
        section(text('h2', 'Practice areas')),
      ),
    )
    expect(aiSettleLinksWithoutDestination(going, 'page', { pageSections: sections })).toBe(going)
    const nowhere = tree(page(section(text('h1', 'Estate planning'), button({ children: 'Our team', scrollTo: 'team' }))))
    expect(aiSettleLinksWithoutDestination(nowhere, 'page', { pageSections: sections })).toBe(nowhere)
    expect(codes(detectLinksWithoutDestination(nowhere, 'page', { pageSections: sections }, (id) => nowhere.nodes[id]))).toEqual([
      'scroll-target-unknown',
    ])
  })

  it('never takes a page’s own section out, even when a link was all it held', () => {
    const input = tree(page(section(button({ children: 'Request a Consultation' })), section(text('h1', 'Estate planning'))))
    const settled = settleLinks(input)
    expect(Object.keys(settled.nodes).sort()).toEqual([CANVAS_ROOT_ELEMENT_ID, 'n1', 'n3', 'n4'].sort())
  })

  it('is settled on the stored page only when it is given the context the check reads links in', () => {
    const input = aboutHero(button({ children: 'Request a Consultation' }))
    expect(aiSettleMechanicalRules(input, 'page')).toBe(input)
    expect(componentsOf(aiSettleMechanicalRules(input, 'page', {}))).not.toContain('muiButton')
  })
})

describe('rule 10, a link to an anchor no section carries (link-fragment)', () => {
  const sections = ['hero', 'practice areas', 'consultation request form']

  // The page as stored, where the palette validator dropped the fragment, and the button as the model wrote it.
  const stored = aboutHero(button({ children: 'Request a Consultation' }))
  const written = (href: string) => (id: string) =>
    id === 'n5' ? { ...stored.nodes[id], props: { ...stored.nodes[id].props, href } } : stored.nodes[id]

  it('sends one that asks to get in touch to the form’s page, and takes any other out', () => {
    expect(codes(detectLinksWithoutDestination(stored, 'page', { pageSections: sections }, written('#contact')))).toEqual([
      'link-fragment',
    ])
    const sent = settleLinks(stored, { pageSections: sections, formScreenIds: ['scr-contact'], writtenNode: written('#contact') })
    expect(Object.values(sent.nodes).find((node) => node.componentId === 'muiButton')?.props).toEqual({
      variant: 'contained',
      children: 'Request a Consultation',
      screenId: 'scr-contact',
    })
    // Read as written, before the palette validator drops the fragment, it is settled the same way.
    const contact = aboutHero(button({ children: 'Request a Consultation', href: '#contact' }))
    const sentAsWritten = settleLinks(contact, { pageSections: sections, formScreenIds: ['scr-contact'] })
    expect(Object.values(sentAsWritten.nodes).find((node) => node.componentId === 'muiButton')?.props).toEqual({
      variant: 'contained',
      children: 'Request a Consultation',
      screenId: 'scr-contact',
    })
    const other = aboutHero(button({ children: 'Our story', href: '#story' }))
    expect(componentsOf(settleLinks(other, { pageSections: sections }))).not.toContain('muiButton')
  })

  it('leaves a fragment that names one of the page’s sections to the page step, which scrolls to it', () => {
    const input = aboutHero(button({ children: 'Request a Consultation', href: '#consultation-request-form' }))
    expect(aiSettleLinksWithoutDestination(input, 'page', { pageSections: sections })).toBe(input)
    const named = { pageSections: sections, writtenNode: written('#consultation-request-form') }
    expect(aiSettleLinksWithoutDestination(stored, 'page', named)).toBe(stored)
  })
})

describe('a link that goes nowhere through a generation (AGL-4076)', () => {
  it('is re-asked on the first answer, and settled on the last rather than stopping the job', () => {
    const answer = { tree: JSON.stringify(aboutHero(button({ children: 'Request a Consultation' }))) }
    const check = aiDoctrineTreeCheck('page')
    expect(codes(check(answer).violations)).toEqual(['link-without-destination'])
    const last = check(answer)
    expect(last.violations).toEqual([])
    expect(Object.values(last.value?.nodes ?? {}).map((node) => node.componentId)).not.toContain('muiButton')
  })

  it('takes a page section’s hero button that goes nowhere out on the pass’s last answer (AGL-3072)', () => {
    // The live Free About hero's button, written into this brief's hero.
    const fixture = AI_PAGE_BRIEF_FIXTURES[0]
    const screen = fixture.plan.screens[0]
    const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-4076', index))
    const answer = JSON.parse(JSON.stringify(fixture.answers[0])) as (typeof fixture.answers)[number]
    answer.nodes['a3'].props = { children: 'Request a quote', variant: 'contained' }
    const check = aiPageSectionCheck({
      page: aiEmptyPage(),
      sectionIds,
      index: 0,
      context: aiPageCheckContext(fixture.inventory),
      section: screen.sections[0],
      inventory: fixture.inventory,
    })
    expect(codes(check({ tree: JSON.stringify(answer) }).violations)).toEqual(['link-without-destination'])
    const last = check({ tree: JSON.stringify(answer) })
    expect(last.violations).toEqual([])
    const nodes = Object.values((last.value as AiPageSection).nodes) as Array<{ componentId: string }>
    expect(nodes.map((node) => node.componentId)).not.toContain('muiButton')
    expect(nodes.length).toBeGreaterThan(1)
  })
})

describe('rule 16, a repeated inline style (duplicated-inline-style)', () => {
  const column = (title: string, sx: Record<string, unknown>): Nested => ({
    componentId: 'muiGrid',
    props: { size: { xs: 12, md: 3 } },
    sx,
    children: [text('h3', title), text('body1', `${title}, explained.`)],
  })
  const row = (...columns: Nested[]): Nested => ({ componentId: 'muiGrid', props: { container: true, spacing: 3 }, children: columns })
  const settle = (input: AiDoctrineTree, kind: AiOutputKind = 'page'): AiDoctrineTree => {
    const before = JSON.stringify(input)
    const once = aiSettleMechanicalRules(input, kind)
    expect(JSON.stringify(input)).toBe(before)
    expect(aiSettleMechanicalRules(once, kind)).toBe(once)
    return once
  }

  it('carries a centered text alignment every column repeats once, on the row that holds them', () => {
    const style = { textAlign: 'center', p: 2 }
    const input = tree(
      page(section(text('h2', 'Practice areas'), row(...['Wills', 'Trusts', 'Probate', 'Guardianship'].map((name) => column(name, style))))),
    )
    expect(codes(detectHeavyDocument(input, 'page'))).toContain('duplicated-inline-style')
    const settled = settle(input)
    expect(settled.nodes['n3'].sx).toEqual({ textAlign: 'center' })
    for (const id of ['n4', 'n7', 'n10', 'n13']) expect(settled.nodes[id].sx).toEqual({ p: 2 })
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('duplicated-inline-style')
  })

  it('carries a muted text color every line of a list repeats once, on the box that holds them', () => {
    const style = { color: 'text.secondary', fontWeight: 500 }
    const lines = ['Free first meeting', 'Fixed fees', 'Plain words', 'Home visits'].map((line) => text('body2', line, style))
    const settled = settle(tree(page(section(text('h2', 'How we work'), { componentId: 'muiBox', children: lines }))))
    expect(settled.nodes['n3'].sx).toEqual({ color: 'text.secondary' })
    expect(settled.nodes['n4'].sx).toEqual({ fontWeight: 500 })
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('duplicated-inline-style')
  })

  it('makes a repeated Typography alignment its own align, where the lines share no frame of their own', () => {
    const style = { mb: 2, textAlign: 'center' }
    const input = tree(page(...[1, 2, 3, 4].map((n) => text('body1', `Line ${n}`, style))))
    const settled = settle(input)
    for (const id of ['n1', 'n2', 'n3', 'n4']) {
      expect(settled.nodes[id].props?.['align']).toBe('center')
      expect(settled.nodes[id].sx).toEqual({ mb: 2 })
    }
    expect(codes(detectHeavyDocument(settled, 'page'))).not.toContain('duplicated-inline-style')
  })

  it('leaves a repeat with no single place to go to the re-ask, as before', () => {
    // A card's padding and height: no frame carries them for the cards it holds.
    const card = (title: string): Nested => ({ componentId: 'muiCard', sx: { height: '100%', p: 3 }, children: [text('h3', title)] })
    const cards = tree(page(section(text('h2', 'Services'), row(...['A', 'B', 'C', 'D'].map((name) => ({ ...column(name, {}), sx: undefined, children: [card(name)] }))))))
    expect(settle(cards)).toBe(cards)
    expect(codes(detectHeavyDocument(cards, 'page'))).toContain('duplicated-inline-style')
    // A color is not carried by a frame that draws a border in its own text color.
    const bordered = tree(
      page(
        section(
          text('h2', 'How we work'),
          { componentId: 'muiBox', sx: { border: 1 }, children: [1, 2, 3, 4].map((n) => text('body2', `Step ${n}`, { color: 'text.secondary', fontWeight: 500 })) },
        ),
      ),
    )
    expect(settle(bordered)).toBe(bordered)
    // Nor a color that a sibling outside the repeat would take too.
    const mixed = tree(
      page(
        section(
          text('h2', 'How we work'),
          {
            componentId: 'muiBox',
            children: [...[1, 2, 3, 4].map((n) => text('body2', `Step ${n}`, { color: 'text.secondary', fontWeight: 500 })), text('body2', 'Ask us anything.')],
          },
        ),
      ),
    )
    expect(settle(mixed)).toBe(mixed)
  })

  it('is settled on an answer before the check reads it, on the first answer', () => {
    const style = { textAlign: 'center', p: 2 }
    const answer = {
      tree: JSON.stringify(
        tree(page(section(text('h1', 'Practice areas'), row(...['Wills', 'Trusts', 'Probate', 'Guardianship'].map((name) => column(name, style)))))),
      ),
    }
    const result = aiDoctrineTreeCheck('page')(answer)
    expect(codes(result.violations)).not.toContain('duplicated-inline-style')
  })
})
