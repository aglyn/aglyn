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
  validateAiDoctrineTree,
  walkTree,
  type AiDoctrineTree,
} from '../runtime/ai-doctrine-validators'
import { AI_ICON_WORDS } from '../runtime/ai-icon-library'
import {
  aiCompileLayoutPage,
  aiLayoutSpans,
  type AiLayoutPagePlan,
} from './ai-layout-compiler'
import { aiCompileLayoutFrame } from './ai-layout-frame'
import {
  AI_LAYOUT_ALIGNS,
  AI_LAYOUT_BANDS,
  AI_LAYOUT_BLOCK_KINDS,
  AI_LAYOUT_STYLES,
  aiReadLayoutFrame,
  aiReadLayoutPage,
  type AiLayoutBlock,
  type AiLayoutSection,
} from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'
import { aiLayoutStoredTree } from './ai-layout-store'

/**
 * The compiler's promise (AGL-3660): every page and every frame the layout
 * language can describe compiles into a tree the doctrine admits as it is —
 * a page on a Free workspace and on a paid one, a layout — with nothing the
 * palette validator has to repair. Held over thousands of documents drawn at
 * random from the whole language, sloppy ones included, and over the cases a
 * person reads.
 */

const HOME = 'pg-home'
const CONTACT = 'pg-contact'
const SERVICES = 'pg-services'
const FORM = 'form-contact'
const CARD = 'cmp-service-card'

const TARGETS: AiLayoutTargets = {
  pageId: HOME,
  pages: [
    { id: HOME, label: 'Home', slug: '/' },
    { id: SERVICES, label: 'Services', slug: '/services' },
    { id: CONTACT, label: 'Contact', slug: '/contact' },
  ],
  homeIds: [HOME],
  forms: [{ id: FORM, name: 'Contact form' }],
  formPageId: CONTACT,
  components: [
    {
      id: CARD,
      name: 'Service card',
      props: { title: 'text', description: 'text' },
    },
  ],
  facts:
    'A dog groomer in Austin. Call 512-555-0199. https://example.com/booking',
}

/** What the page's checks are given, as the page step gives them. */
function checkContext(
  plan: AiLayoutPagePlan,
  reusableComponents: boolean,
  sectionIds: string[],
) {
  return {
    screenIds: TARGETS.pages.map((page) => page.id),
    formIds: [FORM],
    componentIds: [CARD],
    componentProps: { [CARD]: { title: 'text', description: 'text' } },
    homeScreenIds: [HOME],
    pageSections: plan.sections.map((section) => section.name),
    scrollTargetIds: sectionIds,
    ...(reusableComponents ? {} : { reusableComponents: false }),
    codeBuilt: true,
  }
}

/** A page compiled, stored as the page step stores it, and checked as its last pass checks it. */
function build(
  sections: readonly AiLayoutSection[],
  plan: AiLayoutPagePlan,
  reusableComponents: boolean,
  targets = TARGETS,
) {
  const sectionIds = plan.sections.map((_, index) => `sec-${index + 1}`)
  const compiled = aiCompileLayoutPage(sections, plan, targets, {
    reusableComponents,
    sectionIds,
  })
  const stored = aiLayoutStoredTree(
    compiled.tree,
    'screen',
    checkContext(plan, reusableComponents, sectionIds),
    sectionIds,
  )
  if (stored.ok === false) throw new Error(stored.error)
  const report = validateAiDoctrineTree(
    { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes },
    'page',
    checkContext(plan, reusableComponents, sectionIds),
  )
  return { compiled, stored, report, sectionIds }
}

// ── A seeded generator over the whole language ───────────────────────────

/** mulberry32: a small seeded generator, so a failure names the seed that made it. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(values: readonly T[]): T =>
      values[Math.floor(next() * values.length)],
    chance: (p: number) => next() < p,
  }
}
type Random = ReturnType<typeof random>

const WORDS = [
  'gentle',
  'grooming',
  'for',
  'every',
  'dog',
  'and',
  'the',
  'calm',
  'bath',
  'trim',
  'Austin',
  'owners',
  'book',
  'today',
  'a',
  'with',
  'care',
  'nails',
  'coat',
  'fresh',
  'appointments',
  'weekly',
  'of',
  'to',
  'or',
]
const SPICE = [
  '**bold**',
  '# Heading',
  '- bullet',
  'call (512) 555-0100',
  'mail hello@groomer.test',
  'Call 512-555-0199',
  '[price]',
  '“quoted”',
  'and',
  'the',
  '—',
  'lorem',
  '15+ years',
  '100%',
]

/** Words with nothing a page would refuse: what a plan, already held to its rules, carries. */
function plainPhrase(r: Random, min: number, max: number): string {
  const words = Array.from({ length: r.int(min, max) }, () =>
    r.pick(WORDS.filter((word) => word.length > 3)),
  )
  return words.join(' ').replace(/^./, (first) => first.toUpperCase())
}

function phrase(r: Random, min: number, max: number): string {
  const count = r.int(min, max)
  const words = Array.from({ length: count }, () =>
    r.chance(0.08) ? r.pick(SPICE) : r.pick(WORDS),
  )
  const text = words.join(' ')
  return r.chance(0.5)
    ? `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}${r.pick(['.', '', '!', ','])}`
    : text
}

const LINKS = [
  'page:pg-contact',
  'page:pg-services',
  'page:Services',
  'page:pg-home',
  '#1',
  '#2',
  '#3',
  '#9',
  'form',
  'https://example.com/booking',
  'https://elsewhere.test/x',
  '/contact',
  'nowhere',
  '',
  FORM,
  CARD,
]

function item(r: Random) {
  return {
    title: r.chance(0.9) ? phrase(r, 1, r.chance(0.1) ? 30 : 6) : '',
    text: r.chance(0.8) ? phrase(r, 0, r.chance(0.1) ? 80 : 20) : '',
    ...(r.chance(0.15) ? { to: r.pick(LINKS) } : {}),
    ...(r.chance(0.4)
      ? { icon: r.chance(0.9) ? r.pick(AI_ICON_WORDS) : 'unicorn' }
      : {}),
  }
}

function block(r: Random, cols: number): Record<string, unknown> {
  const kind = r.chance(0.03) ? 'banner' : r.pick(AI_LAYOUT_BLOCK_KINDS)
  return {
    kind,
    ...(cols && r.chance(0.7)
      ? { col: r.int(0, cols + (r.chance(0.1) ? 2 : 0)) }
      : {}),
    ...(r.chance(0.92) ? { text: phrase(r, 1, r.chance(0.1) ? 120 : 14) } : {}),
    ...(r.chance(0.5) ? { to: r.pick(LINKS) } : {}),
    ...(r.chance(0.3) ? { style: r.pick(AI_LAYOUT_STYLES) } : {}),
    ...(r.chance(0.3) ? { icon: r.pick(AI_ICON_WORDS) } : {}),
    ...(r.chance(0.6)
      ? { items: Array.from({ length: r.int(0, 11) }, () => item(r)) }
      : {}),
  }
}

function section(r: Random): Record<string, unknown> {
  const cols = r.chance(0.45) ? r.int(2, 5) : 0
  return {
    ...(r.chance(0.8) ? { band: r.pick(AI_LAYOUT_BANDS) } : {}),
    ...(cols
      ? {
          cols: Array.from({ length: cols }, () =>
            r.int(r.chance(0.05) ? 0 : 1, 12),
          ),
        }
      : {}),
    ...(r.chance(0.6) ? { align: r.pick(AI_LAYOUT_ALIGNS) } : {}),
    blocks: Array.from({ length: r.int(0, 9) }, () => block(r, cols)),
  }
}

function plan(r: Random, sections: number, paid: boolean): AiLayoutPagePlan {
  return {
    // A plan's own words passed the plan rules, filler included, so they are plain.
    title: plainPhrase(r, 2, 9),
    sections: Array.from({ length: sections }, (_, index) => ({
      name: plainPhrase(r, 1, 4) || `Part ${index + 1}`,
      uses: [
        ...(r.chance(0.15) ? [FORM] : []),
        ...(paid && r.chance(0.2) ? [CARD] : []),
      ],
      items: r.chance(0.3) ? r.int(3, 6) : 0,
    })),
  }
}

/** Every document drawn from one seed: the raw answer, read, then each null section filled the way a re-ask would. */
function draw(seed: number, paid: boolean) {
  const r = random(seed)
  const count = r.int(1, 8)
  const raw = {
    sections: Array.from({ length: count + (r.chance(0.1) ? 2 : 0) }, () =>
      section(r),
    ),
  }
  const reading = aiReadLayoutPage(raw, count)
  // A section the reader could not use is asked for again; here it comes back as one heading.
  const sections = reading.sections.map(
    (entry) =>
      entry ?? {
        blocks: [{ kind: 'heading' as const, text: phrase(r, 2, 6) }],
      },
  )
  return { sections, plan: plan(r, count, paid) }
}

describe('every page the language can describe compiles into a page the doctrine admits', () => {
  const RUNS = 600
  it.each([
    ['Free', false],
    ['paid', true],
  ])(
    `%s: ${RUNS} random documents, sloppy ones included, with no violation and no repair`,
    (_label, paid) => {
      const failures: string[] = []
      for (let seed = 1; seed <= RUNS; seed += 1) {
        const { sections, plan: pagePlan } = draw(
          seed * (paid ? 7919 : 104_729),
          paid,
        )
        try {
          const { report, stored } = build(sections, pagePlan, paid)
          if (stored.ok && stored.repairs.length)
            failures.push(
              `seed ${seed}: repairs ${stored.repairs.slice(0, 3).join(' | ')}`,
            )
          if (report.violations.length) {
            failures.push(
              `seed ${seed}: ${report.violations
                .map(
                  (violation) =>
                    `${violation.code}: ${violation.message}${
                      process.env['LL_DEBUG']
                        ? ` ${JSON.stringify(
                            (violation.nodeIds ?? []).slice(0, 3).map((id) => {
                              const minted = report.tree?.nodes[
                                id
                              ] as unknown as
                                | {
                                    componentId: string
                                    props?: unknown
                                    nodes?: string[]
                                  }
                                | undefined
                              return (
                                minted && {
                                  c: minted.componentId,
                                  p: minted.props,
                                  kids: (minted.nodes ?? []).map((kid) => {
                                    const k = report.tree?.nodes[
                                      kid
                                    ] as unknown as {
                                      componentId: string
                                      props?: unknown
                                    }
                                    return k && [k.componentId, k.props]
                                  }),
                                }
                              )
                            }),
                          )}`
                        : ''
                    }`,
                )
                .join(' | ')}`,
            )
          }
        } catch (error) {
          failures.push(`seed ${seed}: threw ${(error as Error).message}`)
        }
        if (failures.length >= 5) break
      }
      expect(failures).toEqual([])
    },
  )
})

describe('the outline', () => {
  const pagePlan: AiLayoutPagePlan = {
    title: 'Gentle dog grooming in Austin',
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Services', uses: [], items: 3 },
    ],
  }

  it('gives the first section the page one h1 from the plan when the design wrote none', () => {
    const { report, stored } = build(
      [
        { blocks: [{ kind: 'text', text: 'Calm baths and tidy trims.' }] },
        { blocks: [{ kind: 'heading', text: 'What we do' }] },
      ],
      pagePlan,
      false,
    )
    expect(report.violations).toEqual([])
    const ordered = stored.ok
      ? walkTree({
          rootId: stored.rootId,
          nodes: stored.nodes as unknown as AiDoctrineTree['nodes'],
        }).map((visit) => visit.node)
      : []
    const headings = ordered.filter((node) =>
      String(node.props?.['component'] ?? '').startsWith('h'),
    ) as unknown as Array<{
      props: { children: string; component: string }
    }>
    expect(
      headings.map((node) => [node.props.component, node.props.children]),
    ).toEqual([
      ['h1', 'Gentle dog grooming in Austin'],
      ['h2', 'What we do'],
    ])
  })

  it('puts a card title one level under its section heading', () => {
    const { compiled } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Grooming made calm' }] },
        {
          blocks: [
            { kind: 'heading', text: 'Services' },
            {
              kind: 'cards',
              items: [
                { title: 'Bath', text: 'Warm water.' },
                { title: 'Trim', text: 'Neat lines.' },
              ],
            },
          ],
        },
      ],
      pagePlan,
      false,
    )
    const titles = Object.values(compiled.tree.nodes).filter(
      (node) => node.props?.['variant'] === 'h5',
    )
    expect(titles.map((node) => node.props?.['component'])).toEqual([
      'h3',
      'h3',
    ])
  })
})

describe('links', () => {
  const pagePlan: AiLayoutPagePlan = {
    title: 'Home',
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Book a groom', uses: [FORM], items: 0 },
    ],
  }

  it('sends a button to a page, a section of this page by its interaction, or an address the brief gave', () => {
    const { compiled, report } = build(
      [
        {
          blocks: [
            { kind: 'heading', text: 'Calm grooming' },
            { kind: 'button', text: 'See our services', to: 'page:Services' },
            { kind: 'button', text: 'Book a groom', to: 'form' },
            {
              kind: 'button',
              text: 'Book online',
              to: 'https://example.com/booking',
            },
          ],
        },
        { blocks: [{ kind: 'heading', text: 'Book a groom' }] },
      ],
      pagePlan,
      false,
    )
    expect(report.violations).toEqual([])
    const buttons = Object.values(compiled.tree.nodes).filter(
      (node) => node.componentId === 'muiButton',
    )
    expect(
      buttons.map((node) => [
        node.props?.['children'],
        node.props?.['screenId'] ?? node.props?.['href'] ?? 'scroll',
      ]),
    ).toEqual([
      ['See our services', SERVICES],
      ['Book a groom', 'scroll'],
      ['Book online', 'https://example.com/booking'],
    ])
    expect(buttons[1].interactions).toHaveLength(1)
  })

  it('leaves out a button with nowhere to go, an address the brief never gave, and home under other words', () => {
    const { compiled } = build(
      [
        {
          blocks: [
            { kind: 'heading', text: 'Calm grooming' },
            { kind: 'button', text: 'Read our story', to: 'nowhere' },
            {
              kind: 'button',
              text: 'Our partner',
              to: 'https://elsewhere.test/x',
            },
            { kind: 'button', text: 'Learn more', to: `page:${CONTACT}` },
          ],
        },
        { blocks: [{ kind: 'heading', text: 'Book' }] },
      ],
      pagePlan,
      false,
      { ...TARGETS, pageId: SERVICES },
    )
    const labels = Object.values(compiled.tree.nodes)
      .filter((node) => node.componentId === 'muiButton')
      .map((node) => node.props?.['children'])
    expect(labels).toEqual(['Learn more'])
    expect(compiled.settled.map((entry) => entry.what)).toEqual(
      expect.arrayContaining([
        'the button "Read our story" has nowhere to go; left out',
        'the button "Our partner" has nowhere to go; left out',
      ]),
    )
  })

  it('places the form the plan names in its section even when the design forgot it', () => {
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Calm grooming' }] },
        { blocks: [{ kind: 'heading', text: 'Book' }] },
      ],
      pagePlan,
      false,
    )
    expect(report.violations).toEqual([])
    expect(
      Object.values(compiled.tree.nodes)
        .filter((node) => node.componentId === 'form')
        .map((node) => node.props?.['formId']),
    ).toEqual([FORM])
  })
})

describe('copy', () => {
  const pagePlan: AiLayoutPagePlan = {
    title: 'Home',
    sections: [{ name: 'Hero', uses: [], items: 0 }],
  }

  it('ends an over-long heading at a clean boundary, takes out markup, and writes an invented phone as a gap', () => {
    const { compiled } = build(
      [
        {
          blocks: [
            {
              kind: 'heading',
              text: '**Gentle grooming** for nervous dogs, senior dogs and the puppies who are meeting the clippers for the very first time',
            },
            {
              kind: 'text',
              text: 'Call (512) 555-0100 or 512-555-0199 to book.',
            },
          ],
        },
      ],
      pagePlan,
      false,
    )
    const texts = Object.values(compiled.tree.nodes)
      .filter((node) => node.componentId === 'muiTypography')
      .map((node) => node.props?.['children'])
    expect(texts[0]).toBe('Gentle grooming for nervous dogs')
    expect(texts[1]).toBe('Call [phone number] or 512-555-0199 to book.')
  })

  it('writes a unicode escape the model spelled out as the character it names', () => {
    const { compiled } = build([{ blocks: [{ kind: 'heading', text: 'Drop in \\u2014 no experience needed' }] }], pagePlan, false)
    const [title] = Object.values(compiled.tree.nodes)
      .filter((node) => node.componentId === 'muiTypography')
      .map((node) => node.props?.['children'])
    expect(title).toBe('Drop in \u2014 no experience needed')
  })
})

describe('repeats (rule 1)', () => {
  const pagePlan: AiLayoutPagePlan = {
    title: 'Services',
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Services', uses: [CARD], items: 3 },
    ],
  }
  const cards: AiLayoutBlock = {
    kind: 'cards',
    items: [
      { title: 'Bath', text: 'Warm water and a gentle dry.' },
      { title: 'Trim', text: 'Neat lines for every coat.' },
      { title: 'Nails', text: 'Short and smooth.' },
    ],
  }

  it('places the planned component once per item on a workspace that keeps components', () => {
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Our services' }] },
        { blocks: [cards] },
      ],
      pagePlan,
      true,
    )
    expect(report.violations).toEqual([])
    const instances = Object.values(compiled.tree.nodes).filter(
      (node) => node.componentId === 'reusableInstance',
    )
    expect(instances.map((node) => node.props?.['propValues'])).toEqual([
      { title: 'Bath', description: 'Warm water and a gentle dry.' },
      { title: 'Trim', description: 'Neat lines for every coat.' },
      { title: 'Nails', description: 'Short and smooth.' },
    ])
  })

  /*
   * The live eval's portfolio Home on a paid workspace (AGL-3660): six work
   * samples as a component placed in each of three columns, twice. Compiled
   * column by column, that was the same Grid three times, and rule 1 refused
   * the page on every ask.
   */
  it('draws a component placed in every column as one group of its instances', () => {
    const work = (title: string, description: string, col: number): AiLayoutBlock => ({
      kind: 'component',
      to: CARD,
      col,
      items: [
        { title: 'title', text: title },
        { title: 'description', text: description },
      ],
    })
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Our services' }] },
        {
          cols: [1, 1, 1],
          blocks: [
            { kind: 'heading', text: 'Selected work' },
            work('Bath', 'Warm water and a gentle dry.', 0),
            work('Trim', 'Neat lines for every coat.', 1),
            work('Nails', 'Short and smooth.', 2),
            work('Teeth', 'A fresh brush.', 0),
            work('Ears', 'Cleaned with care.', 1),
            work('Coat', 'A soft finish.', 2),
          ],
        },
      ],
      pagePlan,
      true,
    )
    expect(report.violations).toEqual([])
    expect(
      Object.values(compiled.tree.nodes)
        .filter((node) => node.componentId === 'reusableInstance')
        .map((node) => (node.props?.['propValues'] as Record<string, string>)['title']),
    ).toEqual(['Bath', 'Trim', 'Nails', 'Teeth', 'Ears', 'Coat'])
  })

  it('reads a component placed in every column whose item is the card itself', () => {
    const work = (title: string, text: string, col: number): AiLayoutBlock => ({ kind: 'component', to: CARD, col, items: [{ title, text }] })
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Our services' }] },
        { cols: [1, 1, 1], blocks: [{ kind: 'heading', text: 'Classes' }, work('Gentle Flow', 'A slow start.', 0), work('Restorative', 'Soft and quiet.', 1), work('Slow Stretch', 'Easy and unhurried.', 2)] },
      ],
      pagePlan,
      true,
    )
    expect(report.violations).toEqual([])
    expect(
      Object.values(compiled.tree.nodes)
        .filter((node) => node.componentId === 'reusableInstance')
        .map((node) => node.props?.['propValues']),
    ).toEqual([
      { title: 'Gentle Flow', description: 'A slow start.' },
      { title: 'Restorative', description: 'Soft and quiet.' },
      { title: 'Slow Stretch', description: 'Easy and unhurried.' },
    ])
  })

  /*
   * The business eval's towing Home (AGL-3660): one service a column, each a
   * cards block with no `to`, its item naming the Card component. The plan's
   * component went to the first column alone, so the row drew one boxed card
   * beside three bare ones. Every item of a cards row is drawn alike.
   */
  const itemsOf = (nodes: Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>, rowRole: string[]) =>
    Object.values(nodes)
      .filter((node) => node.componentId === 'muiGrid' && node.props?.['container'])
      .map((grid) => (grid.nodes ?? []).map((cell) => nodes[nodes[cell]?.nodes?.[0] ?? '']))
      .filter((cells) => cells.length >= 2 && cells.every(Boolean))
      .map((cells) => cells.map((node) => `${node?.componentId}:${String(node?.props?.['variant'] ?? '')}`))
      .filter((row) => rowRole.some((role) => row[0]?.startsWith(role)) || row.some((cell) => rowRole.some((role) => cell.startsWith(role))))

  it.each([
    ['the plan places the component', [CARD], true],
    ['only the items name the component', [], true],
    ['a workspace that keeps no components', [], false],
  ] as const)('draws every item of a cards row split over columns alike: %s', (_case, uses, reusable) => {
    const service = (title: string, col: number): AiLayoutBlock => ({
      kind: 'cards',
      col,
      items: [{ title, text: `${title}, any hour of the day.`, ...(reusable ? { to: CARD } : {}) }],
    })
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Help on the road' }] },
        {
          cols: [1, 1, 1, 1],
          blocks: [
            { kind: 'heading', text: 'Services' },
            service('Emergency towing', 0),
            service('Roadside assistance', 1),
            service('Fuel delivery', 2),
            service('Accident recovery', 3),
          ],
        },
      ],
      { ...pagePlan, sections: [pagePlan.sections[0], { name: 'Services', uses: [...uses], items: 4 }] },
      reusable,
    )
    expect(report.violations).toEqual([])
    const rows = itemsOf(compiled.tree.nodes as never, ['reusableInstance', 'muiCard', 'muiListItemText'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(4)
    expect(new Set(rows[0]).size).toBe(1)
  })

  /*
   * The business eval's blog Home (AGL-3660): four "Card" items of the Card
   * component, no words of their own. A published page never shows "Card":
   * such items say nothing and are left out, so the section shows none and
   * the page check asks for it again.
   */
  it('never draws an item whose only words are the name of the component that places it', () => {
    const { compiled } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Weeknight cooking' }] },
        {
          blocks: [
            { kind: 'heading', text: 'Latest recipes' },
            { kind: 'cards', items: ['Card', 'Card', 'cmp-service-card'].map((title) => ({ title, text: '', to: CARD })) },
          ],
        },
      ],
      pagePlan,
      true,
    )
    expect(JSON.stringify(compiled.tree.nodes)).not.toMatch(/"Card"|cmp-service-card"/)
    expect(compiled.itemIds[1]).toEqual([])
  })

  it('draws the same cards in full on a workspace that keeps none', () => {
    const { compiled, report } = build(
      [
        { blocks: [{ kind: 'heading', text: 'Our services' }] },
        { blocks: [cards] },
      ],
      {
        ...pagePlan,
        sections: pagePlan.sections.map((entry) => ({ ...entry, uses: [] })),
      },
      false,
    )
    expect(report.violations).toEqual([])
    expect(
      Object.values(compiled.tree.nodes).filter(
        (node) => node.componentId === 'muiCard',
      ),
    ).toHaveLength(3)
  })
})

/*
 * Live on hillside-dog-grooming.aglyn.app (beta.231, AGL-3660): a lone
 * button in a column Stack stretched across the whole column, because a
 * column Stack stretches its children. A compiled button is sized to its
 * words: it aligns itself with its section, or sits in a row of buttons.
 */
describe('buttons size to their words', () => {
  const button = (text: string, to = `page:${SERVICES}`, col?: number): AiLayoutBlock => ({ kind: 'button', text, to, ...(col !== undefined ? { col } : {}) })
  const pages: Array<[string, AiLayoutSection[]]> = [
    ['a lone button under a group', [{ blocks: [{ kind: 'heading', text: 'Grooming' }] }, { blocks: [{ kind: 'heading', text: 'Why us' }, { kind: 'cards', items: [{ title: 'Calm', text: 'Gentle hands.' }, { title: 'Local', text: 'Near you.' }] }, button('Contact us')] }]],
    ['a hero column with one button', [{ cols: [7, 5], blocks: [{ kind: 'heading', text: 'Grooming', col: 0 }, { kind: 'lede', text: 'Gentle hands.', col: 0 }, button('Book a groom', `page:${CONTACT}`, 0), { kind: 'image', text: 'A dog', col: 1 }] }]],
    ['a centered pair', [{ align: 'center', blocks: [{ kind: 'heading', text: 'Grooming' }, button('Book'), button('Services')] }]],
  ]
  it.each(pages)('%s', (_name, sections) => {
    const plan: AiLayoutPagePlan = { title: 'Home', sections: sections.map((_, index) => ({ name: `s${index}`, uses: [], items: 0 })) }
    const { compiled } = build(sections, plan, false)
    const nodes = compiled.tree.nodes as Record<string, { componentId?: string; props?: Record<string, unknown>; sx?: Record<string, unknown> | null; nodes?: string[] }>
    const parentOf = (id: string) => Object.values(nodes).find((node) => node.nodes?.includes(id))
    const buttons = Object.entries(nodes).filter(([, node]) => node.componentId === 'muiButton')
    expect(buttons.length).toBeGreaterThan(0)
    for (const [id, node] of buttons) {
      expect(node.props?.['fullWidth']).toBeUndefined()
      expect(node.sx?.['width']).toBeUndefined()
      const parent = parentOf(id)
      const inRow = parent?.componentId === 'muiStack' && parent.props?.['direction'] === 'row'
      expect([id, inRow || ['flex-start', 'center'].includes(String(node.sx?.['alignSelf']))]).toEqual([id, true])
    }
  })
})

describe('columns', () => {
  it('spans relative widths across twelve, three at the least', () => {
    expect(aiLayoutSpans([1, 1])).toEqual([6, 6])
    expect(aiLayoutSpans([7, 5])).toEqual([7, 5])
    expect(aiLayoutSpans([1, 1, 1])).toEqual([4, 4, 4])
    expect(aiLayoutSpans([10, 1])).toEqual([9, 3])
    expect(aiLayoutSpans([1, 1, 1, 1])).toEqual([3, 3, 3, 3])
  })
})

describe('the frame', () => {
  const nav = [
    { id: HOME, label: 'Home', slug: '/' },
    { id: SERVICES, label: 'Services', slug: '/services' },
    { id: CONTACT, label: 'Contact', slug: '/contact' },
  ]
  const layoutContext = {
    screenIds: nav.map((page) => page.id),
    formIds: [FORM],
    homeScreenIds: [HOME],
    codeBuilt: true,
  }

  function frame(raw: unknown) {
    const read = aiReadLayoutFrame(raw)
    const compiled = aiCompileLayoutFrame(
      read,
      { siteName: 'Hillside Dog Grooming', homeId: HOME, navPages: nav },
      TARGETS,
    )
    const stored = aiLayoutStoredTree(compiled.tree, 'layout', layoutContext)
    if (stored.ok === false) throw new Error(stored.error)
    const report = validateAiDoctrineTree(
      { rootId: stored.rootId, nodes: stored.nodes },
      'layout',
      layoutContext,
    )
    return { compiled, stored, report }
  }

  it('builds the brand, the navigation, the phone menu, the slot and the footer the doctrine admits', () => {
    const { compiled, report, stored } = frame({
      header: {
        band: 'plain',
        blocks: [{ kind: 'button', text: 'Book a groom', to: 'form' }],
      },
      footer: {
        band: 'dark',
        cols: [2, 1],
        blocks: [
          { kind: 'heading', col: 0, text: 'Hillside Dog Grooming' },
          {
            kind: 'text',
            col: 0,
            text: 'Gentle grooming for Austin dogs. Call 512-555-0199.',
          },
          {
            kind: 'list',
            col: 1,
            items: [{ title: 'Services', text: '', to: `page:${SERVICES}` }],
          },
        ],
      },
    })
    expect(report.violations).toEqual([])
    expect(stored.ok && stored.repairs).toEqual([])
    const ids = Object.values(compiled.tree.nodes).map(
      (node) => node.componentId,
    )
    expect(ids).toEqual(
      expect.arrayContaining([
        'muiAppBar',
        'muiDrawer',
        'muiDrawerToggle',
        'layoutSlot',
      ]),
    )
    const brand = Object.values(compiled.tree.nodes).find(
      (node) => node.componentId === 'muiScreenLink',
    )
    expect(brand?.props).toMatchObject({
      children: 'Hillside Dog Grooming',
      screenId: HOME,
    })
  })

  it('prints one copyright line, the bottom bar\'s, whatever the answer adds', () => {
    const block = (kind: string, text: string) => ({ kind, col: 0, text })
    const { compiled, report } = frame({
      header: { band: 'plain', blocks: [] },
      footer: {
        band: 'soft',
        cols: [2, 1],
        blocks: [
          block('text', 'Gentle grooming for Austin dogs.'),
          block('note', '© Hillside Dog Grooming. All rights reserved.'),
          block('text', 'Copyright 2026 Hillside Dog Grooming'),
          {
            kind: 'list',
            col: 1,
            items: [
              { title: 'Services', text: '', to: `page:${SERVICES}` },
              { title: 'All rights reserved', text: '' },
            ],
          },
        ],
      },
    })
    expect(report.violations).toEqual([])
    const texts = Object.values(compiled.tree.nodes)
      .map((node) => node.props?.['children'] ?? node.props?.['primary'])
      .filter((text): text is string => typeof text === 'string')
    expect(texts.filter((text) => /©|copyright|all rights reserved/i.test(text))).toEqual(['© Hillside Dog Grooming'])
    expect(texts).toContain('Gentle grooming for Austin dogs.')
  })

  // The towing footer's "Request a Tow" spanned its whole column (AGL-3660).
  it('sizes a lone footer button to its words', () => {
    const { stored } = frame({
      header: { band: 'plain', blocks: [] },
      footer: {
        cols: [2, 1],
        blocks: [
          { kind: 'heading', col: 0, text: 'Hillside Dog Grooming' },
          { kind: 'button', col: 0, text: 'Request a groom', to: `page:${CONTACT}` },
          { kind: 'list', col: 1, items: [{ title: 'Services', text: '', to: `page:${SERVICES}` }] },
        ],
      },
    })
    if (stored.ok === false) throw new Error(stored.error)
    const button = Object.values(stored.nodes).find((node) => node.props?.['children'] === 'Request a groom')
    expect(button?.props?.['fullWidth']).toBeUndefined()
    expect(button?.sx).toMatchObject({ alignSelf: 'flex-start' })
  })

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ])('compiles random frame %i with no violation', (seed) => {
    const r = random(seed * 31)
    const { report, stored } = frame({
      header: section(r),
      footer: r.chance(0.9) ? section(r) : null,
    })
    expect(report.violations).toEqual([])
    expect(stored.ok && stored.repairs).toEqual([])
  })
})

describe('reading an answer', () => {
  it('keeps a planned section where it is, leaves out what it cannot read, and names a section left empty', () => {
    const reading = aiReadLayoutPage(
      {
        sections: [
          {
            blocks: [
              { kind: 'heading', text: 'Hi' },
              { kind: 'banner', text: 'x' },
            ],
          },
          { blocks: [] },
          { blocks: [{ kind: 'text', text: 'extra' }] },
        ],
      },
      2,
    )
    expect(reading.sections[0]?.blocks).toEqual([
      { kind: 'heading', text: 'Hi' },
    ])
    expect(reading.sections[1]).toBeNull()
    expect(reading.settled.map((entry) => entry.what)).toEqual([
      '3 sections for a plan of 2; the extra left out',
      'unknown kind "banner"; left out',
    ])
  })
})

/** The doctrine reads a tree's nodes by walking them; a compiled one walks whole. */
it('a compiled page has no node outside its tree', () => {
  const { compiled } = build(
    [{ blocks: [{ kind: 'heading', text: 'Hi' }] }],
    { title: 'Hi', sections: [{ name: 'Hero', uses: [], items: 0 }] },
    false,
  )
  const walked = walkTree(compiled.tree as unknown as AiDoctrineTree).map(
    (visit) => visit.id,
  )
  expect(new Set(walked)).toEqual(new Set(Object.keys(compiled.tree.nodes)))
})
