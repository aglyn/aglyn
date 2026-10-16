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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiBuildPlan } from '../model/ai-build-plan'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiDoctrineTreeContext } from './ai-doctrine'
import {
  aiSettlePlaceholderItems,
  detectPlaceholderCopy,
  detectPlaceholderTokens,
  validateAiBuildPlan,
  validateAiDoctrineTree,
  type AiDoctrineTree,
} from './ai-doctrine-validators'
import { readAiEvalCase, scoreAiEvalControl } from './ai-eval'

/*
 * Rule 14: a template placeholder never reaches a page (AGL-3827). The live
 * golden check of 2026-10-15 built the `page-meet-the-crew` case with its two
 * testimonials' quote and name left as `{{1}}` and `{{2}}`, and no rule read
 * them. Each is refused into the re-ask a doctrine finding takes, and the one
 * case with a single answer — an item of a list that shows only placeholders,
 * beside a real one — is settled in code.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASE_FILE = 'tools/ai-eval/cases/page/meet-the-crew.json'
const crew = readAiEvalCase(JSON.parse(readFileSync(join(REPO_ROOT, CASE_FILE), 'utf8')), CASE_FILE)
const inventory = crew.inventory as AiSiteInventory
const context = aiDoctrineTreeContext(inventory, { ...(crew.assets ? { assets: crew.assets } : {}) })

type Nested = {
  id?: string
  componentId: string
  props?: Record<string, unknown>
  children?: Nested[]
}

/** A flat map from a nested literal: ids as given, else n1, n2, … in document order. */
function tree(...sections: Nested[]): AiDoctrineTree {
  const nodes: AiDoctrineTree['nodes'] = {}
  let counter = 0
  const visit = (nested: Nested, parentId: string): string => {
    const id = nested.id ?? `n${++counter}`
    const { children = [], componentId, props } = nested
    const node = { componentId, ...(props ? { props } : {}), $id: id, parentId, nodes: [] as string[] }
    nodes[id] = node
    for (const child of children) node.nodes.push(visit(child, id))
    return id
  }
  nodes[CANVAS_ROOT_ELEMENT_ID] = { componentId: 'div', nodes: sections.map((child) => visit(child, CANVAS_ROOT_ELEMENT_ID)) }
  return { rootId: CANVAS_ROOT_ELEMENT_ID, nodes }
}

const section = (label: string, ...children: Nested[]): Nested => ({
  componentId: 'section',
  props: { element: 'section', ariaLabel: label },
  children,
})
const text = (variant: string, copy: string, id?: string): Nested => ({
  ...(id ? { id } : {}),
  componentId: 'muiTypography',
  props: { variant, children: copy, ...(variant.startsWith('h') ? { component: variant } : {}) },
})
const quote = (id: string, values: { quote: string; name: string }): Nested => ({
  id,
  componentId: 'reusableInstance',
  props: { refId: 'cmp-testimonial', propValues: values },
})
const cell = (id: string, child: Nested): Nested => ({ id, componentId: 'muiGrid', props: { size: 'xs:12 md:6' }, children: [child] })
const row = (id: string, ...cells: Nested[]): Nested => ({
  id,
  componentId: 'muiGrid',
  props: { container: true, spacing: 3 },
  children: cells,
})
const DANA = { quote: 'They found the leak two other companies missed.', name: 'Dana, Harbor Point' }
const LUIS = { quote: 'On time, tidy, and the photos made the invoice easy to trust.', name: 'Luis, Old Mill Road' }

/** The page the case describes, with the given customer quotes. */
const crewPage = (...cells: Nested[]): AiDoctrineTree =>
  tree(
    section('Meet the crew', text('h1', 'Meet the crew'), text('body1', 'Six roofers who know Harbor County roofs.')),
    section('What customers say', text('h2', 'What customers say'), row('words-row', ...cells)),
  )

const findings = (input: AiDoctrineTree, kind: 'page' | 'email' = 'page', over = {}) =>
  validateAiDoctrineTree(input, kind, { ...context, ...over }).violations.filter(
    (violation) => violation.code === 'placeholder-token',
  )

describe('rule 14 — a placeholder in a page’s copy is refused', () => {
  it('names each node a placeholder sits on: a testimonial’s quote and name, a heading, a button, an alt', () => {
    const page = tree(
      section(
        'Meet the crew',
        text('h1', 'Meet {{1}}', 'title'),
        { id: 'photo', componentId: 'image', props: { src: 'media:host-harbor/asset-team', alt: '<Your crew photo>' } },
        { id: 'call', componentId: 'muiButton', props: { variant: 'contained', children: 'Call [[Business name]]', screenId: 'scr-home' } },
      ),
      section('What customers say', text('h2', 'What customers say'), row('words-row', cell('c1', quote('q1', { quote: '{{1}}', name: '{{2}}' })), cell('c2', quote('q2', DANA)))),
    )
    expect(findings(page)).toEqual([
      {
        rule: 14,
        code: 'placeholder-token',
        message:
          "This copy shows a template placeholder where its words belong, and a visitor would read it as written. Write the real words in the site's voice, from what the brief and the site already say.",
        detail:
          'Placeholders left in the copy: "{{1}}", "<Your crew photo>", "[[Business name]]", "{{2}}". {{1}}, {{2}} and on are filled only inside an item with "repeat", from one list of values a copy; anywhere else, write the words out.',
        nodeIds: expect.any(Array),
      },
    ])
    // The check mints its own ids; each names the node the copy sits on.
    const report = validateAiDoctrineTree(page, 'page', context)
    const named = report.violations.find((violation) => violation.code === 'placeholder-token')?.nodeIds ?? []
    expect(named.map((id) => report.tree?.sourceIds[id] ?? id).sort()).toEqual(['call', 'photo', 'q1', 'title'])
  })

  it('passes the page the case’s authored answer builds, and every bracketed fact the brief did not give', () => {
    expect(findings(crewPage(cell('c1', quote('q1', DANA)), cell('c2', quote('q2', LUIS))))).toEqual([])
    // The honest marker for a fact the brief left out is never a placeholder (AGL-3056).
    const facts = crewPage(
      cell('c1', quote('q1', { quote: '[What the customer said about the repair]', name: '[Customer name]' })),
      cell('c2', quote('q2', LUIS)),
    )
    expect(findings(facts)).toEqual([])
    expect(validateAiDoctrineTree(facts, 'page', context).violations).toEqual([])
  })

  it('leaves the platform’s own bindings to the checks that own them', () => {
    const page = tree(
      section(
        'Record',
        text('h1', '{{item.title}}'),
        text('body1', 'Posted {{entry.date}} by {{entry.author}}'),
      ),
    )
    expect(findings(page)).toEqual([])
  })

  it('leaves an email its own merge tokens, and still refuses a slot in one', () => {
    const email = (copy: string): AiDoctrineTree => ({
      rootId: 'root',
      nodes: {
        root: { componentId: 'emailBody', nodes: ['s'] },
        s: { componentId: 'emailSection', nodes: ['t'] },
        t: { componentId: 'emailText', props: { variant: 'body', children: copy } },
      },
    })
    expect(detectPlaceholderTokens(email('Welcome back, {{firstName}}.'), 'email')).toEqual([])
    expect(detectPlaceholderTokens(email('Welcome back, {{1}}.'), 'email').map((violation) => violation.code)).toEqual([
      'placeholder-token',
    ])
  })

  it('refuses a placeholder in a plan’s page title and search fields, by path', () => {
    const plan = crew.candidates[0].plan as AiBuildPlan
    expect(validateAiBuildPlan(plan, inventory).filter((violation) => violation.code === 'placeholder-token')).toEqual([])
    const [screen] = plan.screens
    const placeholders = {
      ...plan,
      screens: [{ ...screen, seoTitle: '{{1}} | Harbor Roofing', seoDescription: 'Meet <Your crew name>, roofers since 1998.' }],
    }
    expect(
      validateAiBuildPlan(placeholders, inventory)
        .filter((violation) => violation.code === 'placeholder-token')
        .map(({ rule, paths }) => ({ rule, paths })),
    ).toEqual([{ rule: 14, paths: ['screens[0].seoTitle', 'screens[0].seoDescription'] }])
    expect(detectPlaceholderCopy([{ at: 'title', text: 'Gutter cleaning in [service area]' }])).toEqual([])
  })
})

describe('an item that shows only placeholders is taken out where its list keeps a real one', () => {
  /** Settles, and checks the settle is idempotent and copies rather than edits. */
  const settle = (input: AiDoctrineTree): AiDoctrineTree => {
    const before = JSON.stringify(input)
    const once = aiSettlePlaceholderItems(input, 'page', context)
    expect(JSON.stringify(input)).toBe(before)
    expect(aiSettlePlaceholderItems(once, 'page', context)).toBe(once)
    return once
  }

  it('drops a testimonial whose quote and name are only slots, beside two real ones, and the page then passes', () => {
    const page = crewPage(
      cell('c1', quote('q1', DANA)),
      cell('c2', quote('q2', { quote: '{{1}}', name: '“{{2}}”' })),
      cell('c3', quote('q3', LUIS)),
    )
    const settled = settle(page)
    expect(settled.nodes['words-row'].nodes).toEqual(['c1', 'c3'])
    expect(settled.nodes).not.toHaveProperty('c2')
    expect(settled.nodes).not.toHaveProperty('q2')
    expect(JSON.stringify(settled)).not.toContain('{{')
    expect(validateAiDoctrineTree(settled, 'page', context).violations).toEqual([])
  })

  it('drops instances that sit straight in a row, and a line of only a placeholder beside real ones', () => {
    const instances = crewPage(quote('q1', DANA), quote('q2', { quote: '[[Customer quote]]', name: '<Your name>' }))
    expect(settle(instances).nodes['words-row'].nodes).toEqual(['q1'])
    const lines = tree(section('Promise', text('h2', 'Why homeowners call us back'), text('body1', 'We answer the phone.', 'p1'), text('body1', '{{3}}', 'p2')))
    expect(settle(lines).nodes['n1'].nodes).toEqual(['n2', 'p1'])
  })

  it.each<[string, AiDoctrineTree]>([
    // Every testimonial is a slot: the list would be trimmed to nothing.
    ['every item is a placeholder', crewPage(cell('c1', quote('q1', { quote: '{{1}}', name: '{{2}}' })), cell('c2', quote('q2', { quote: '{{1}}', name: '{{2}}' })))],
    // The live shape: one item written once, with nothing beside it.
    ['the only item', crewPage(cell('c1', quote('q1', { quote: '{{1}}', name: '{{2}}' })))],
    // A quote that says something is the model's to finish.
    ['copy around the slot', crewPage(cell('c1', quote('q1', DANA)), cell('c2', quote('q2', { quote: 'Thanks, {{name}}, for the quick fix.', name: 'Luis' })))],
    // A section is the plan's, never an item.
    ['a section', tree(section('A', text('h2', 'Our promise')), section('B', text('h2', '{{1}}')))],
  ])('settles nothing where %s, and the check refuses it', (_name, page) => {
    expect(settle(page)).toBe(page)
    expect(findings(page).map((violation) => violation.code)).toEqual(['placeholder-token'])
  })
})

describe('the golden case a live run broke (page-meet-the-crew)', () => {
  it('fails the recorded live shape as unreadable, and slots in other syntaxes on its rules', () => {
    const [live, other] = crew.controls
    expect(live.why).toContain('2026-10-15')
    // A slot no "repeat" fills is refused before any rule reads the page.
    expect(scoreAiEvalControl(crew, live)).toEqual(['readable', 'rules', 'budget'])
    expect(scoreAiEvalControl(crew, other)).toEqual(['rules'])
    const tree = (other.answer as { tree: AiDoctrineTree }).tree
    expect(validateAiDoctrineTree(tree, 'page', context).violations.map((violation) => violation.code)).toEqual([
      'placeholder-token',
    ])
  })
})
