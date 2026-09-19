/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { formatMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { ESTIMATED_PAGE_TRANSFER_BYTES, FREE_AI_TASTE_CREDITS_PER_MONTH } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  AI_FREE_PAGE_BUILT_PLAN,
  AI_FREE_PAGE_BUILT_SECTIONS,
  AI_FREE_PAGE_RECORDED_PLAN,
} from '../jobs/fixtures/ai-free-page-recording'
import type { AiBuildPlan, AiBuildPlanScreen } from '../model/ai-build-plan'
import { AI_PAGE_CREATE_KINDS } from '../model/ai-page-job'
import {
  aiPlanCapabilitiesForJob,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { aiHomeScreenIds, emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import {
  AI_DOCTRINE_RULE_NUMBERS,
  AI_DOCTRINE_RULES,
  AI_FREE_PAGE_WORST_CASE_CREDITS,
  AI_TYPED_LIST_MIN_ITEMS,
  aiBracketedFacts,
  aiDanglingWord,
  aiDoctrineViolationText,
  aiFreePageSectionsWithin,
  aiNamesMatch,
  aiTreeCopy,
  detectAdHocWidths,
  detectCreateBeforeReuse,
  detectCutLines,
  detectDanglingWords,
  detectDocumentStructure,
  detectEmptyItems,
  detectHeavyDocument,
  detectImageSources,
  detectInlineForms,
  detectInvisibleLinks,
  detectLayoutRegions,
  detectLinksWithoutDestination,
  detectLiteralStyles,
  detectMissedDuplicate,
  detectMissingNavAndSeo,
  detectOffBrandEmail,
  detectOffVoiceCopy,
  detectOverBudget,
  detectPlanInlineForms,
  detectPlanLayoutRegions,
  detectPlanLiteralColors,
  detectPlanOverFreeWall,
  detectPlanRepeats,
  detectPlanSplitLists,
  detectPlanTypedData,
  detectPlanUncreatable,
  detectPlanUndeclaredCreations,
  detectPublishIntent,
  detectRepeatedSubtrees,
  detectTypedData,
  detectUnrelatedScreenLinks,
  detectUnresponsiveGrids,
  detectUntemplatedSimilarPages,
  estimateAiOutputLoad,
  scoreAiOutput,
  validateAiBuildPlan,
  validateAiDoctrineTree,
  type AiDoctrineTree,
  type AiDoctrineViolation,
} from './ai-doctrine-validators'
import { AI_OUTPUT_BUDGETS } from './ai-palette'

/**
 * The building doctrine's validators (AGL-2935): one describe per rule, each
 * with a fixture that must go red and one that must stay green, then the
 * rule-17 scorer and the whole-tree and whole-plan checks.
 *
 * The tree fixtures are flat node maps as a model writes them. A detector is
 * driven directly where the palette validator would refuse the fixture before
 * the rule could see it (an element no surface admits, two landmarks the
 * palette cannot express); the whole-tree check is driven where it would not.
 */

type Nested = {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  children?: Nested[]
}

/** A flat map from a nested literal, ids n1, n2, … in document order. */
function tree(root: Nested): AiDoctrineTree & {
  nodes: Record<string, { $id: string; parentId: string | null; componentId: string; nodes: string[] }>
} {
  const nodes: Record<string, { $id: string; parentId: string | null; componentId: string; nodes: string[] }> = {}
  let counter = 0
  const visit = (nested: Nested, parentId: string | null): string => {
    const id = parentId === null ? CANVAS_ROOT_ELEMENT_ID : `n${++counter}`
    const { children = [], ...rest } = nested
    nodes[id] = { ...rest, $id: id, parentId, nodes: [] }
    for (const child of children) nodes[id].nodes.push(visit(child, id))
    return id
  }
  visit(root, null)
  return { rootId: CANVAS_ROOT_ELEMENT_ID, nodes }
}

const page = (...children: Nested[]): Nested => ({ componentId: 'div', children })
const section = (...children: Nested[]): Nested => ({
  componentId: 'section',
  props: { element: 'section' },
  children,
})
const text = (variant: string, copy: string, component?: string): Nested => ({
  componentId: 'muiTypography',
  props: { variant, children: copy, ...(component ? { component } : {}) },
})
const card = (title: string, body: string): Nested => ({
  componentId: 'muiCard',
  children: [
    { componentId: 'muiCardContent', children: [text('h3', title, 'h3'), text('body1', body)] },
  ],
})
const instance = (title: string): Nested => ({
  componentId: 'reusableInstance',
  props: { refId: 'cmp-card', propValues: { title } },
})
const IMAGE = formatMediaRef('host-1', 'asset-1') as string
const image = (props: Record<string, unknown>): Nested => ({ componentId: 'image', props })

const codes = (violations: readonly AiDoctrineViolation[]) => violations.map((v) => v.code)

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  components: [{ id: 'cmp-card', name: 'Service card', props: { title: 'text', image: 'image' } }],
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  templates: [{ id: 'tpl-service', name: 'Service page', kind: 'page' }],
  forms: [{ id: 'frm-contact', name: 'Contact', fields: ['name', 'email', 'message'] }],
  datasets: [{ id: 'ds-team', name: 'Team members', fields: ['name', 'role'] }],
  collections: [{ id: 'col-blog', name: 'Blog', slug: 'blog' }],
  screens: [
    { id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false },
    { id: 'scr-about', name: 'About us', slug: 'about', layoutId: 'lay-site', template: false },
  ],
  theme: { summary: ['Light and dark schemes'], colors: { 'primary.main': '#1976d2' }, fonts: ['Inter'] },
}

function screen(patch: Partial<AiBuildPlanScreen> = {}): AiBuildPlanScreen {
  return {
    title: 'Roof repair',
    slug: '/services/roof-repair',
    layout: 'lay-site',
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: 'Roof repair in Springfield',
    seoDescription: 'Same-week roof repair from a local crew.',
    sections: [{ name: 'hero', uses: [], items: 0 }],
    ...patch,
  }
}

function planOf(patch: Partial<AiBuildPlan> = {}): AiBuildPlan {
  return {
    reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site chrome' }],
    create: [],
    screens: [screen()],
    ...patch,
  }
}

/**
 * A workspace that keeps no reusable components or saved forms (AGL-3030),
 * with room for no more layouts: the Free plan's shape on a site that already
 * has the one it includes.
 */
const FREE: AiPlanCapabilities = (() => {
  const all = aiUnrestrictedPlanCapabilities()
  return {
    reusableComponents: false,
    create: {
      ...all.create,
      component: { allowed: false, left: 0, reason: "this workspace's plan does not include reusable components" },
      form: { allowed: false, left: 0, reason: "this workspace's plan does not include saved forms" },
      layout: { allowed: false, left: 0, reason: 'this site already holds the 1 shared layout its plan includes' },
      dataset: { allowed: false, left: 0, reason: "this workspace's plan does not include datasets" },
    },
  }
})()

describe('the rule catalog', () => {
  it('names seventeen rules, and a violation reads as its number, its title and its sentence', () => {
    expect(AI_DOCTRINE_RULE_NUMBERS).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))
    expect(
      aiDoctrineViolationText({ rule: 13, code: 'x', message: 'Publish it yourself.' }),
    ).toBe(`Rule 13 (${AI_DOCTRINE_RULES[13]}): Publish it yourself.`)
    expect(aiDoctrineViolationText({ rule: null, code: 'x', message: 'Unreadable.' })).toBe(
      'Unreadable.',
    )
  })
})

describe('rule 1 — repeats become one reusable component', () => {
  it('refuses a block repeated three times on a page, once, at the outermost repeat', () => {
    const input = tree(
      page(section(card('Roofs', 'Tile and slate.'), card('Gutters', 'Seamless.'), card('Siding', 'Vinyl.'))),
    )
    const found = detectRepeatedSubtrees(input)
    expect(codes(found)).toEqual(['repeated-subtree'])
    expect(found[0]).toMatchObject({ rule: 1, nodeIds: ['n2', 'n6', 'n10'] })
  })

  it('refuses a block this page shares with another page built beside it', () => {
    const shared = (): Nested =>
      section({
        componentId: 'muiStack',
        props: { direction: 'column' },
        children: [text('h2', 'Why us', 'h2'), text('body1', 'Local crews.'), { componentId: 'muiButton', props: { children: 'Call', href: '/contact' } }],
      })
    const found = detectRepeatedSubtrees(tree(page(shared())), [tree(page(shared()))])
    expect(codes(found)).toEqual(['repeated-across-pages'])
  })

  it('passes two copies, and the same block placed as instances of one component', () => {
    expect(detectRepeatedSubtrees(tree(page(section(card('A', 'a'), card('B', 'b')))))).toEqual([])
    expect(
      detectRepeatedSubtrees(tree(page(section(instance('A'), instance('B'), instance('C'))))),
    ).toEqual([])
  })

  it('in a plan: repeated items place a component, and a section two screens share is one', () => {
    const repeated = planOf({ screens: [screen({ sections: [{ name: 'services grid', uses: [], items: 6 }] })] })
    expect(codes(detectPlanRepeats(repeated, INVENTORY))).toEqual(['plan-repeated-items'])
    const placed = planOf({ screens: [screen({ sections: [{ name: 'services grid', uses: ['cmp-card'], items: 6 }] })] })
    expect(detectPlanRepeats(placed, INVENTORY)).toEqual([])

    const twoScreens = (uses: string[]) =>
      planOf({
        screens: [
          screen({ sections: [{ name: 'Why us', uses, items: 0 }] }),
          screen({ title: 'Gutters', slug: '/gutters', sections: [{ name: 'why us', uses, items: 0 }] }),
        ],
      })
    expect(codes(detectPlanRepeats(twoScreens([]), INVENTORY))).toEqual(['plan-section-across-screens'])
    expect(detectPlanRepeats(twoScreens(['cmp-card']), INVENTORY)).toEqual([])
  })

  it('draws a repeat where it repeats on a workspace that keeps no reusable components, and only there (AGL-3030)', () => {
    const cards = tree(
      page(section(card('Roofs', 'Tile and slate.'), card('Gutters', 'Seamless.'), card('Siding', 'Vinyl.'))),
    )
    expect(detectRepeatedSubtrees(cards, [], { reusableComponents: false })).toEqual([])
    expect(codes(detectRepeatedSubtrees(cards, [], { reusableComponents: true }))).toEqual(['repeated-subtree'])
    const repeated = planOf({ screens: [screen({ sections: [{ name: 'services grid', uses: [], items: 6 }] })] })
    expect(detectPlanRepeats(repeated, INVENTORY, FREE)).toEqual([])
    expect(codes(detectPlanRepeats(repeated, INVENTORY, aiUnrestrictedPlanCapabilities()))).toEqual([
      'plan-repeated-items',
    ])
  })
})

describe('rule 1 — a list is one section whose items repeat (AGL-3071)', () => {
  const sections = (...entries: Array<[string, string[], number]>) =>
    planOf({ screens: [screen({ sections: entries.map(([name, uses, items]) => ({ name, uses, items })) })] })

  it('refuses the live Free plan’s four practice areas, each planned as a section of one item, and gives the one section to plan', () => {
    expect(detectPlanSplitLists(AI_FREE_PAGE_BUILT_PLAN, emptyAiSiteInventory('host-brightwater-law'), FREE)).toEqual([
      {
        rule: 1,
        code: 'plan-split-list',
        message:
          'The sections "practice area: business & corporate law", "practice area: real estate law", "practice area: family law" and "practice area: estate planning" each show one item of the same kind, so they are one list split apart. Plan them as one section whose 4 items repeat: {"name":"practice areas","uses":[],"items":4}.',
        paths: ['screens[0].sections[2]', 'screens[0].sections[3]', 'screens[0].sections[4]', 'screens[0].sections[5]'],
      },
    ])
  })

  it('asks a workspace that keeps components to place one for a split list long enough for rule 1, and a Free one only to join the sections', () => {
    const tiers = sections(['tier: basic', [], 1], ['tier: standard', [], 1], ['tier: premium', [], 1])
    const paid = detectPlanSplitLists(tiers, INVENTORY, aiUnrestrictedPlanCapabilities())
    expect(paid).toMatchObject([
      {
        message:
          'The sections "tier: basic", "tier: standard" and "tier: premium" each show one item of the same kind, so they are one list split apart. Plan them as one section whose 3 items repeat, placing one reusable component for the item: reuse one the site has by its id, or declare one in create and place it as new:<name>, as in {"name":"tiers","uses":["new:<name>"],"items":3}.',
      },
    ])
    expect(detectPlanSplitLists(tiers, INVENTORY)).toEqual(paid)
    expect(detectPlanSplitLists(tiers, INVENTORY, FREE)).toMatchObject([
      { message: expect.stringContaining('Plan them as one section whose 3 items repeat: {"name":"tiers","uses":[],"items":3}.') },
    ])
    // Two items are fewer than rule 1 asks a component for.
    expect(detectPlanSplitLists(sections(['tier: basic', [], 1], ['tier: premium', [], 1]), INVENTORY)).toMatchObject([
      { message: expect.stringContaining('Plan them as one section whose 2 items repeat: {"name":"tiers","uses":[],"items":2}.') },
    ])
  })

  it('refuses one-item sections that place the same component, naming the component’s items and keeping it placed', () => {
    const found = detectPlanSplitLists(sections(['hero', [], 0], ['Roofs', ['cmp-card'], 1], ['Gutters', ['cmp-card'], 1], ['Siding', ['cmp-card'], 1]), INVENTORY)
    expect(found).toMatchObject([
      {
        code: 'plan-split-list',
        message: expect.stringContaining('Plan them as one section whose 3 items repeat: {"name":"Service cards","uses":["cmp-card"],"items":3}.'),
        paths: ['screens[0].sections[1]', 'screens[0].sections[2]', 'screens[0].sections[3]'],
      },
    ])
    const created = planOf({
      create: [{ kind: 'component', name: 'Attorney card', why: 'The site has no card for a person.', duplicateOf: null, fields: ['name:text'] }],
      screens: [screen({ sections: [{ name: 'Jane Doe', uses: ['new:Attorney card'], items: 1 }, { name: 'John Roe', uses: ['new:attorney card'], items: 1 }] })],
    })
    expect(detectPlanSplitLists(created, INVENTORY)).toMatchObject([
      { message: expect.stringContaining('{"name":"Attorney cards","uses":["new:Attorney card"],"items":2}') },
    ])
  })

  it('passes two lists of several items that share a card, one-item sections of different kinds or apart, and a lone one (AGL-3061)', () => {
    expect(detectPlanSplitLists(sections(['practice areas', [], 4], ['how we work', [], 4]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['services', ['cmp-card'], 4], ['more services', ['cmp-card'], 6]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['team: Jane', [], 1], ['office: Main Street', [], 1]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['team: Jane', [], 1], ['our story', [], 0], ['team: John', [], 1]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['featured testimonial', [], 1], ['call to action', [], 1]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['practice area: family law', [], 1]), INVENTORY)).toEqual([])
    expect(detectPlanSplitLists(sections(['team: Jane', ['ds-team'], 1], ['team: John', ['ds-team'], 1]), INVENTORY)).toEqual([])
  })
})

describe('the Free wall — a Free plan asks for no more sections than its credits pay for at their worst (AGL-3070)', () => {
  const FREE_TASTE: AiPlanCapabilities = { ...FREE, freeTaste: true }
  /** A Free site with no layout yet, where the job may create the one its plan includes. */
  const BARE: AiSiteInventory = { ...INVENTORY, layouts: [] }
  const FREE_BARE: AiPlanCapabilities = { ...FREE_TASTE, create: { ...FREE.create, layout: { allowed: true, left: 1, reason: null } } }
  const sections = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `part ${index + 1}`, uses: [], items: 0 }))
  const LAYOUT = { kind: 'layout' as const, name: 'Site layout', why: 'The site has no layout yet.', duplicateOf: null, fields: [] }

  it('fits nine sections beside the plan, the first pass and the listing, and six when the job builds the layout first', () => {
    const { plan, layout, firstSection, laterSection, listing } = AI_FREE_PAGE_WORST_CASE_CREDITS
    expect(aiFreePageSectionsWithin({ layouts: 0 })).toBe(1 + Math.floor((FREE_AI_TASTE_CREDITS_PER_MONTH - plan - firstSection - listing) / laterSection))
    expect([aiFreePageSectionsWithin({ layouts: 0 }), aiFreePageSectionsWithin({ layouts: 1 })]).toEqual([9, 6])
    expect(aiFreePageSectionsWithin({ layouts: 1, pages: 3 })).toBe(
      1 + Math.floor((FREE_AI_TASTE_CREDITS_PER_MONTH - plan - layout - 3 * listing - firstSection) / laterSection),
    )
    expect(aiFreePageSectionsWithin({ layouts: 4 })).toBe(0)
  })

  it('refuses a plan past the wall, saying how many sections to plan and how to get there', () => {
    expect(detectPlanOverFreeWall(planOf({ screens: [screen({ sections: sections(10) })] }), INVENTORY, FREE_TASTE)).toEqual([
      {
        rule: null,
        code: 'plan-over-free-wall',
        message: `This plan asks for 10 sections, and a Free page fits 9 in the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits a Free workspace has a month. Plan at most 9: draw a list's repeated items in one section, and leave out a section the brief does not ask for.`,
        paths: ['screens[0].sections'],
      },
    ])
    expect(detectPlanOverFreeWall(planOf({ create: [LAYOUT], screens: [screen({ layout: 'new:Site layout', sections: sections(7) })] }), BARE, FREE_BARE)).toMatchObject([
      { code: 'plan-over-free-wall', message: expect.stringContaining('This plan asks for 7 sections, and a Free page that creates its layout fits 6 in the') },
    ])
    // A plan that has not yet declared the layout its bare site needs is held to the layout rule 2 asks it for.
    expect(detectPlanOverFreeWall(planOf({ reuse: [], screens: [screen({ layout: null, sections: sections(7) })] }), BARE, FREE_BARE)).toMatchObject([
      { message: expect.stringContaining('a Free page that creates its layout fits 6') },
    ])
    const twoPages = planOf({ screens: [screen({ sections: sections(5) }), screen({ title: 'Team', slug: '/team', sections: sections(5) })] })
    expect(detectPlanOverFreeWall(twoPages, INVENTORY, FREE_TASTE)).toMatchObject([
      {
        message: expect.stringContaining(`This plan asks for 10 sections, and a Free plan of 2 pages fits ${aiFreePageSectionsWithin({ layouts: 0, pages: 2 })} in the`),
        paths: ['screens[0].sections', 'screens[1].sections'],
      },
    ])
  })

  it('admits what the wall fits, counts no layout the workspace may not make, and holds no workspace but a Free one', () => {
    expect(detectPlanOverFreeWall(planOf({ screens: [screen({ sections: sections(9) })] }), INVENTORY, FREE_TASTE)).toEqual([])
    expect(detectPlanOverFreeWall(planOf({ create: [LAYOUT], screens: [screen({ layout: 'new:Site layout', sections: sections(6) })] }), BARE, FREE_BARE)).toEqual([])
    // Its one layout is the site's already, so a layout the plan still names is refused by rule 7 and never built.
    expect(detectPlanOverFreeWall(planOf({ create: [LAYOUT], screens: [screen({ sections: sections(9) })] }), INVENTORY, FREE_TASTE)).toEqual([])
    expect(detectPlanOverFreeWall(planOf({ screens: [screen({ sections: sections(16) })] }), INVENTORY, FREE)).toEqual([])
    expect(detectPlanOverFreeWall(planOf({ screens: [screen({ sections: sections(16) })] }), INVENTORY, null)).toEqual([])
  })
})

describe('rule 2 — site-wide regions live in the layout', () => {
  it('refuses an app bar or a footer near the top of a page', () => {
    const input = tree(
      page(
        { componentId: 'muiAppBar', props: { position: 'static' }, children: [{ componentId: 'muiToolbar', children: [text('h6', 'Acme')] }] },
        { componentId: 'section', props: { element: 'footer' }, children: [text('body2', 'Acme Roofing')] },
      ),
    )
    const found = detectLayoutRegions(input, 'page')
    expect(found).toMatchObject([{ rule: 2, code: 'layout-region-in-screen', nodeIds: ['n1', 'n4'] }])
    expect(found[0].message).toContain('site header and footer')
  })

  it('leaves an article’s own header alone, and a layout is where the regions belong', () => {
    const article = tree(
      page({
        componentId: 'section',
        props: { element: 'article' },
        children: [{ componentId: 'section', props: { element: 'header' }, children: [text('h1', 'Post', 'h1')] }],
      }),
    )
    expect(detectLayoutRegions(article, 'page')).toEqual([])
    const chrome = tree(page({ componentId: 'muiAppBar', children: [text('h6', 'Acme')] }))
    expect(detectLayoutRegions(chrome, 'layout')).toEqual([])
  })

  it('in a plan: every screen names a layout, and no section copies a region', () => {
    const unlaid = planOf({ screens: [screen({ layout: null, sections: [{ name: 'Site header', uses: [], items: 0 }] })] })
    expect(codes(detectPlanLayoutRegions(unlaid, INVENTORY))).toEqual([
      'plan-screen-without-layout',
      'plan-layout-region-section',
    ])
    const created = planOf({
      create: [{ kind: 'layout', name: 'Main layout', why: 'The site has none yet.', duplicateOf: null, fields: [] }],
      screens: [screen({ layout: 'new:Main layout' })],
    })
    expect(detectPlanLayoutRegions(created, emptyAiSiteInventory('host-1'))).toEqual([])
  })

  it('in a plan: names no layout only on a site with none, where the job may not create one (AGL-3030)', () => {
    const unlaid = planOf({ reuse: [], screens: [screen({ layout: null })] })
    const bare = emptyAiSiteInventory('host-1')
    // Nothing to name and nothing this job may make: the screen names none.
    expect(detectPlanLayoutRegions(unlaid, bare, FREE)).toEqual([])
    // A layout the site does not have is still refused, with the way out.
    const invented = planOf({ reuse: [], screens: [screen({ layout: 'lay-invented' })] })
    expect(detectPlanLayoutRegions(invented, bare, FREE)).toMatchObject([
      { code: 'plan-screen-without-layout', message: expect.stringContaining('Leave the layout empty') },
    ])
    // Where one may be created, or the site has one, a screen names a layout.
    expect(codes(detectPlanLayoutRegions(unlaid, bare, aiUnrestrictedPlanCapabilities()))).toEqual([
      'plan-screen-without-layout',
    ])
    expect(codes(detectPlanLayoutRegions(unlaid, INVENTORY, FREE))).toEqual(['plan-screen-without-layout'])
  })
})

describe('rule 3 — forms are built on the Forms page, then placed', () => {
  const field = (name: string): Nested => ({ componentId: 'formField', props: { fieldName: name, fieldType: 'text' } })

  it('refuses loose fields and a form bound to nothing', () => {
    const loose = detectInlineForms(tree(page(section(field('email')))), 'page')
    expect(loose).toMatchObject([{ rule: 3, code: 'inline-form', nodeIds: ['n2'] }])
    const unbound = detectInlineForms(tree(page(section({ componentId: 'form', children: [field('email')] }))), 'page')
    expect(unbound).toMatchObject([{ code: 'inline-form', nodeIds: ['n2'] }])
  })

  it('refuses fields drawn inside a form placed by its id', () => {
    const shadowed = detectInlineForms(
      tree(page(section({ componentId: 'form', props: { formId: 'frm-contact' }, children: [field('email')] }))),
      'page',
    )
    expect(codes(shadowed)).toEqual(['fields-inside-bound-form'])
  })

  it('passes a form placed by id, and a form’s own design', () => {
    expect(
      detectInlineForms(tree(page(section({ componentId: 'form', props: { formId: 'frm-contact' } }))), 'page'),
    ).toEqual([])
    expect(
      detectInlineForms(tree({ componentId: 'form', children: [field('email'), field('name')] }), 'form'),
    ).toEqual([])
  })

  it('in a plan: a section that collects answers places a form', () => {
    const inline = planOf({ screens: [screen({ sections: [{ name: 'Contact form', uses: [], items: 0 }] })] })
    expect(codes(detectPlanInlineForms(inline, INVENTORY))).toEqual(['plan-form-not-placed'])
    const placed = planOf({ screens: [screen({ sections: [{ name: 'Contact form', uses: ['frm-contact'], items: 0 }] })] })
    expect(detectPlanInlineForms(placed, INVENTORY)).toEqual([])
  })

  describe('on a workspace that keeps no saved forms (AGL-3030)', () => {
    const inline = { reusableComponents: false }

    it('passes a form the page carries itself, with its fields inside it', () => {
      const carried = tree(page(section({ componentId: 'form', props: { formName: 'Quote' }, children: [field('email'), field('name')] })))
      expect(detectInlineForms(carried, 'page', inline)).toEqual([])
      // The same form on a workspace that keeps saved forms is drawn inline.
      expect(codes(detectInlineForms(carried, 'page'))).toEqual(['inline-form'])
    })

    it('still refuses loose fields, and a form with no field to send', () => {
      const loose = detectInlineForms(tree(page(section(field('email')))), 'page', inline)
      expect(loose).toMatchObject([{ rule: 3, code: 'loose-form-field', nodeIds: ['n2'] }])
      const empty = detectInlineForms(
        tree(page(section({ componentId: 'form', children: [text('body1', 'Tell us more.')] }))),
        'page',
        inline,
      )
      expect(empty).toMatchObject([{ rule: 3, code: 'form-without-fields', nodeIds: ['n2'] }])
    })

    it('in a plan: a section that collects answers is not refused for placing no saved form', () => {
      const collects = planOf({ screens: [screen({ sections: [{ name: 'Contact form', uses: [], items: 0 }] })] })
      expect(detectPlanInlineForms(collects, INVENTORY, FREE)).toEqual([])
    })

    it('holds the whole tree check to the same rules', () => {
      const carried = tree(
        page(
          section(
            text('h1', 'Get a quote', 'h1'),
            { componentId: 'form', props: { formName: 'Quote request' }, children: [field('email'), field('name')] },
          ),
        ),
      )
      expect(validateAiDoctrineTree(carried, 'page', { reusableComponents: false }).violations).toEqual([])
      expect(codes(validateAiDoctrineTree(carried, 'page').violations)).toEqual(['inline-form'])
    })
  })
})

describe('rule 4 — similar pages share one template', () => {
  const shaped = (template: string | null) =>
    planOf({
      screens: ['roofs', 'gutters', 'siding'].map((slug) =>
        screen({
          title: slug,
          slug: `/services/${slug}`,
          template,
          sections: [
            { name: 'hero', uses: [], items: 0 },
            { name: 'details', uses: [], items: 0 },
          ],
        }),
      ),
    })

  it('refuses three screens of one shape built by hand', () => {
    expect(detectUntemplatedSimilarPages(shaped(null))).toMatchObject([
      { rule: 4, code: 'plan-similar-pages', paths: ['screens[0].template', 'screens[1].template', 'screens[2].template'] },
    ])
  })

  it('passes the same three applying one template', () => {
    expect(detectUntemplatedSimilarPages(shaped('tpl-service'))).toEqual([])
  })
})

describe('rule 5 — colors, spacing and type come from the theme', () => {
  it('refuses a color, a length or a type size written by value', () => {
    const found = detectLiteralStyles(
      tree(
        page(
          { ...text('h1', 'Roofs', 'h1'), sx: { color: '#ff0000' } },
          { ...section(text('body1', 'Tile.')), sx: { border: '1px solid red', p: '16px' } },
          { ...text('body1', 'Slate.'), sx: { fontSize: 18 } },
        ),
      ),
      'page',
    )
    expect(found).toMatchObject([
      { rule: 5, code: 'literal-color', nodeIds: ['n1', 'n2'] },
      { rule: 5, code: 'literal-length', nodeIds: ['n2', 'n4'] },
    ])
  })

  it('passes theme tokens, spacing-scale numbers and a border in a token color', () => {
    expect(
      detectLiteralStyles(
        tree(page({ ...section(text('body1', 'Tile.')), sx: { color: 'primary.main', p: 2, border: '1px solid divider', bgcolor: { xs: 'background.paper' } } })),
        'page',
      ),
    ).toEqual([])
  })

  it('in a plan: a color value belongs only in a theme change', () => {
    const literal = planOf({
      create: [{ kind: 'component', name: 'Banner', why: 'An orange #ff6600 strip.', duplicateOf: null, fields: [] }],
    })
    expect(codes(detectPlanLiteralColors(literal))).toEqual(['plan-literal-color'])
    const themed = planOf({
      create: [{ kind: 'theme-change', name: 'Accent', why: 'The brand orange.', duplicateOf: null, fields: ['secondary.main=#ff6600'] }],
    })
    expect(detectPlanLiteralColors(themed)).toEqual([])
  })
})

describe('rule 5 — a link on a colored band draws its words in a color the band does not have (AGL-3056)', () => {
  const link = (props: Record<string, unknown> = {}, sx?: Record<string, unknown>): Nested => ({
    componentId: 'muiScreenLink',
    props: { children: 'Request a consultation', screenId: 'scr-about', ...props },
    ...(sx ? { sx } : {}),
  })
  const band = (background: unknown, ...children: Nested[]): Nested => ({
    componentId: 'section',
    props: { element: 'footer' },
    sx: { backgroundColor: background, color: 'background.paper' },
    children,
  })

  it('refuses the live footer: a link that sets no color on a band in its own family, with a re-ask to inherit or set the contrast text', () => {
    expect(detectInvisibleLinks(tree(page(band('primary.main', link()))), 'layout')).toEqual([
      {
        rule: 5,
        code: 'link-color-on-band',
        message:
          'A link or button on a primary.main band draws its words in the theme\'s primary color, the band\'s own, so they cannot be read. Give it "color": "inherit" under a band whose sx color is primary.contrastText, or set its own sx color to primary.contrastText.',
        nodeIds: ['n2'],
      },
    ])
  })

  it('refuses a text link, an outlined button and a link in an App Bar that names no color, each in the band’s own family', () => {
    const found = detectInvisibleLinks(
      tree(
        page(
          band({ xs: 'secondary.dark' }, link({ renderAs: 'link', color: 'secondary' }), { componentId: 'muiButton', props: { children: 'Call us', variant: 'outlined', color: 'secondary' } }),
          { componentId: 'muiAppBar', props: { position: 'static' }, children: [{ componentId: 'muiToolbar', children: [link({ children: 'About' })] }] },
          band('primary.light', link({}, { color: 'primary.main' })),
        ),
      ),
      'page',
    )
    expect(found.map(({ code, nodeIds }) => [code, nodeIds])).toEqual([['link-color-on-band', ['n2', 'n3', 'n6', 'n8']]])
  })

  it('passes a link that inherits, sets a color of its own, fills its button, sits on paper or on a band of another family', () => {
    const found = detectInvisibleLinks(
      tree(
        page(
          band(
            'primary.main',
            link({ color: 'inherit' }),
            link({}, { color: 'primary.contrastText' }),
            { componentId: 'muiButton', props: { children: 'Book', variant: 'contained' } },
            { componentId: 'muiCard', children: [{ componentId: 'muiCardContent', children: [link()] }] },
            link({ color: 'secondary' }),
          ),
          band('background.paper', link()),
          { componentId: 'muiAppBar', props: { color: 'default' }, children: [link()] },
        ),
      ),
      'layout',
    )
    expect(found).toEqual([])
    expect(detectInvisibleLinks(tree(page(band('primary.main', link()))), 'email')).toEqual([])
  })
})

describe('rule 6 — emails use the brand', () => {
  const brand = { colors: { 'primary.main': '#1976d2' }, fonts: ['Inter'] }
  const email = (backgroundColor: string) =>
    tree({ componentId: 'div', children: [{ componentId: 'emailButton', props: { children: 'Shop', href: 'https://acme.test', backgroundColor } }] })

  it('refuses a color outside the brand', () => {
    expect(detectOffBrandEmail(email('#FF00AA'), 'email', brand)).toMatchObject([
      { rule: 6, code: 'off-brand-email', nodeIds: ['n1'] },
    ])
  })

  it('passes the brand’s own color in any spelling, and is not a page rule', () => {
    expect(detectOffBrandEmail(email('#1976D2'), 'email', brand)).toEqual([])
    expect(detectOffBrandEmail(email('#FF00AA'), 'page', brand)).toEqual([])
  })
})

describe('rule 7 — reuse before creating', () => {
  it('refuses reusing what the site does not have, or under the wrong kind', () => {
    const found = detectCreateBeforeReuse(
      planOf({
        reuse: [
          { kind: 'component', id: 'cmp-missing', purpose: 'cards' },
          { kind: 'form', id: 'lay-site', purpose: 'contact' },
        ],
      }),
      INVENTORY,
    )
    expect(found).toMatchObject([{ rule: 7, code: 'plan-reuse-unknown', paths: ['reuse[0]', 'reuse[1]'] }])
  })

  it('refuses creating a second copy of something the site has, and a creation with no reason', () => {
    const found = detectCreateBeforeReuse(
      planOf({
        create: [
          { kind: 'component', name: 'Service cards', why: 'For the grid.', duplicateOf: null, fields: [] },
          { kind: 'dataset', name: 'Prices', why: ' ', duplicateOf: null, fields: [] },
        ],
      }),
      INVENTORY,
    )
    expect(codes(found)).toEqual(['plan-create-without-why', 'plan-duplicates-existing'])
    expect(found[1].message).toContain('"Service card"')
  })

  it('passes reusing what is listed, and a creation that explains itself', () => {
    expect(
      detectCreateBeforeReuse(
        planOf({
          reuse: [{ kind: 'component', id: 'cmp-card', purpose: 'the grid' }],
          create: [{ kind: 'component', name: 'Price table', why: 'Nothing lists prices.', duplicateOf: null, fields: [] }],
        }),
        INVENTORY,
      ),
    ).toEqual([])
  })

  it('matches names on their words, not their spelling', () => {
    expect(aiNamesMatch('Our services', 'Services page')).toBe(true)
    expect(aiNamesMatch('Contact form', 'Contact')).toBe(false)
    expect(aiNamesMatch('Team members', 'Members of the team')).toBe(true)
  })
})

describe('rule 8 — data is bound, not typed', () => {
  const item = (copy: string): Nested => ({
    componentId: 'muiListItem',
    children: [{ componentId: 'muiListItemText', props: { primary: copy } }],
  })

  it('refuses a long list typed out by hand, and one component filled in the same way', () => {
    const list = tree(page({ componentId: 'muiList', children: Array.from({ length: AI_TYPED_LIST_MIN_ITEMS }, (_, i) => item(`Member ${i}`)) }))
    expect(codes(detectTypedData(list))).toEqual(['typed-list'])
    const instances = tree(page(section(...Array.from({ length: AI_TYPED_LIST_MIN_ITEMS }, (_, i) => instance(`Member ${i}`)))))
    expect(detectTypedData(instances)).toMatchObject([{ rule: 8, code: 'typed-instances' }])
  })

  it('passes a short list', () => {
    const short = tree(page({ componentId: 'muiList', children: Array.from({ length: AI_TYPED_LIST_MIN_ITEMS - 1 }, (_, i) => item(`Member ${i}`)) }))
    expect(detectTypedData(short)).toEqual([])
  })

  it('counts a list within its own section, as a plan counts a section’s items (AGL-3061)', () => {
    const cards = (count: number, name: string) => Array.from({ length: count }, (_, i) => card(`${name} ${i}`, 'What it covers.'))
    const grid = (...children: Nested[]): Nested => ({ componentId: 'muiGrid', children })
    // Two short lists that share a card are not one long one.
    expect(detectTypedData(tree(page(section(grid(...cards(4, 'Area'))), section(grid(...cards(4, 'Step'))))))).toEqual([])
    expect(detectTypedData(tree(page(section(grid(...cards(4, 'Area'))), section(grid(...cards(6, 'Service'))))))).toEqual([])
    // One section's long list is one list, in one grid or split across two.
    const one = tree(page(section(grid(...cards(AI_TYPED_LIST_MIN_ITEMS, 'Area')))))
    expect(codes(detectTypedData(one))).toEqual(['typed-list'])
    const split = tree(page(section(grid(...cards(4, 'Area')), grid(...cards(AI_TYPED_LIST_MIN_ITEMS - 4, 'More')))))
    expect(detectTypedData(split)).toMatchObject([{ rule: 8, code: 'typed-list', nodeIds: expect.arrayContaining([]) }])
    expect(detectTypedData(split)[0].nodeIds).toHaveLength(AI_TYPED_LIST_MIN_ITEMS)
    // A tree with no Section is one list, wherever its items sit.
    const loose = tree(page(grid(...cards(4, 'Area')), grid(...cards(AI_TYPED_LIST_MIN_ITEMS - 4, 'More'))))
    expect(codes(detectTypedData(loose))).toEqual(['typed-list'])
  })

  it('in a plan: a long list is bound, and a list the site already holds is bound to it', () => {
    const typed = planOf({ screens: [screen({ sections: [{ name: 'price list', uses: [], items: 12 }] })] })
    expect(codes(detectPlanTypedData(typed, INVENTORY))).toEqual(['plan-typed-list'])
    const copied = planOf({ screens: [screen({ sections: [{ name: 'Team members', uses: ['cmp-card'], items: 4 }] })] })
    expect(codes(detectPlanTypedData(copied, INVENTORY))).toEqual(['plan-existing-data-unbound'])
    const bound = planOf({ screens: [screen({ sections: [{ name: 'Team members', uses: ['ds-team', 'cmp-card'], items: 12 }] })] })
    expect(detectPlanTypedData(bound, INVENTORY)).toEqual([])
  })

  it('in a plan: asks for a shorter list, not a dataset, where the job may not create one (AGL-3030)', () => {
    const typed = planOf({ screens: [screen({ sections: [{ name: 'price list', uses: [], items: 12 }] })] })
    expect(detectPlanTypedData(typed, INVENTORY, FREE)).toMatchObject([
      { code: 'plan-typed-list', message: expect.stringContaining(`fewer than ${AI_TYPED_LIST_MIN_ITEMS} items`) },
    ])
    expect(detectPlanTypedData(typed, INVENTORY)[0].message).toContain('plan a dataset')
  })
})

describe('rule 7 — a plan creates only what the job may create on its site (AGL-3030)', () => {
  const creation = (kind: AiBuildPlan['create'][number]['kind'], name: string) => ({
    kind,
    name,
    why: 'Nothing the site has will do.',
    duplicateOf: null,
    fields: [],
  })

  it('refuses each creation the workspace or the job cannot make, saying why and what to do instead', () => {
    const plan = planOf({
      create: [creation('component', 'Service card'), creation('form', 'Quote request'), creation('template', 'Service page')],
    })
    const found = detectPlanUncreatable(plan, FREE)
    expect(found.map((violation) => [violation.rule, violation.code, violation.paths])).toEqual([
      [7, 'plan-create-not-allowed', ['create[0]']],
      [7, 'plan-create-not-allowed', ['create[1]']],
    ])
    expect(found[0].message).toBe(
      'The plan creates a component named "Service card", and this workspace\'s plan does not include reusable components. Draw a list\'s repeated items in one section instead.',
    )
    expect(found[1].message).toContain('Draw the form on the page instead')
    // Narrowed to what a job builds, a creation outside it says so.
    const pageJob = aiPlanCapabilitiesForJob(aiUnrestrictedPlanCapabilities(), { noun: 'a page job', creates: [] })
    expect(detectPlanUncreatable(planOf({ create: [creation('component', 'Service card')] }), pageJob)).toMatchObject([
      { message: expect.stringContaining('a page job does not build one. Place a component the site already has.') },
    ])
  })

  it('refuses only the creations past what the site has room for', () => {
    const room: AiPlanCapabilities = {
      ...aiUnrestrictedPlanCapabilities(),
      create: { ...aiUnrestrictedPlanCapabilities().create, layout: { allowed: true, left: 1, reason: null } },
    }
    const plan = planOf({ create: [creation('layout', 'Main'), creation('layout', 'Landing')] })
    expect(detectPlanUncreatable(plan, room)).toMatchObject([
      { paths: ['create[1]'], message: expect.stringContaining('this site has room for 1 more') },
    ])
  })

  it('restricts nothing where no capabilities were read', () => {
    expect(detectPlanUncreatable(planOf({ create: [creation('component', 'Service card')] }), null)).toEqual([])
  })
})

describe('rule 9 — images come from the media library, with alt text', () => {
  it('refuses an image linked from another website, and one with no alt text', () => {
    const found = detectImageSources(
      tree(page(image({ src: 'https://cdn.example.com/roof.jpg', alt: 'A roof' }), image({ src: IMAGE }))),
    )
    expect(found).toMatchObject([
      { rule: 9, code: 'hotlinked-image', nodeIds: ['n1'] },
      { rule: 9, code: 'missing-alt', nodeIds: ['n2'] },
    ])
  })

  it('reads a component’s declared image props too', () => {
    const found = detectImageSources(
      tree(page({ componentId: 'reusableInstance', props: { refId: 'cmp-card', propValues: { image: 'https://cdn.example.com/a.jpg' } } })),
      { componentProps: { 'cmp-card': { image: 'image' } } },
    )
    expect(codes(found)).toEqual(['hotlinked-image'])
  })

  it('passes a library image with alt text, a decorative one, and an empty slot', () => {
    expect(
      detectImageSources(tree(page(image({ src: IMAGE, alt: 'A roof' }), image({ src: IMAGE, decorative: true }), image({ alt: 'To upload' })))),
    ).toEqual([])
  })
})

describe('rule 10 — navigation and SEO travel with a page', () => {
  it('refuses an unusable address, a taken one, and a missing or long search title', () => {
    const found = detectMissingNavAndSeo(
      planOf({
        screens: [
          screen({ slug: 'Our Services!' }),
          screen({ slug: '/about/' }),
          screen({ slug: '/new-page', seoTitle: 'x'.repeat(71) }),
          screen({ slug: '/new-page', seoDescription: '' }),
        ],
      }),
      INVENTORY,
    )
    expect(found).toMatchObject([
      { rule: 10, code: 'plan-slug', paths: ['screens[0].slug'] },
      { rule: 10, code: 'plan-slug-taken', paths: ['screens[1].slug', 'screens[3].slug'] },
      { rule: 10, code: 'plan-seo', paths: ['screens[2].seoTitle', 'screens[3].seoDescription'] },
    ])
  })

  it('passes a fresh address with both search fields', () => {
    expect(detectMissingNavAndSeo(planOf(), INVENTORY)).toEqual([])
  })
})

describe('rule 10 — a link goes to a screen that does what its words say, or is left out (AGL-3056)', () => {
  const home = { homeScreenIds: aiHomeScreenIds(INVENTORY) }
  const link = (children: string, props: Record<string, unknown> = { screenId: 'scr-home' }): Nested => ({
    componentId: 'muiScreenLink',
    props: { children, ...props },
  })
  const footer = (...children: Nested[]): Nested => ({ componentId: 'section', props: { element: 'footer' }, children })

  it('names the site’s home screens: at the root, at home, or named Home, and never a template', () => {
    expect(aiHomeScreenIds(INVENTORY)).toEqual(['scr-home'])
    const seeded: AiSiteInventory = {
      ...INVENTORY,
      screens: [
        { id: 'seed-home', name: 'Welcome', slug: 'home', layoutId: null, template: false },
        { id: 'scr-start', name: 'Home page', slug: 'start', layoutId: null, template: false },
        { id: 'tpl-root', name: 'Home', slug: '/', layoutId: null, template: true },
        { id: 'scr-about', name: 'About', slug: '/about', layoutId: null, template: false },
      ],
    }
    expect(aiHomeScreenIds(seeded)).toEqual(['seed-home', 'scr-start'])
    expect(aiHomeScreenIds(null)).toEqual([])
  })

  it('refuses the live footer’s consultation link sent home, naming its words and saying to link the screen that does or leave it out', () => {
    expect(detectUnrelatedScreenLinks(tree(page(footer(link('Request a Consultation')))), 'layout', home)).toEqual([
      {
        rule: 10,
        code: 'link-unrelated-screen',
        message:
          '"Request a Consultation" links the home page, which does not do what its words say. Link the screen that does, or leave the link out when the site has none.',
        nodeIds: ['n2'],
      },
    ])
    const button = { componentId: 'muiButton', props: { children: 'Get a quote', href: '/' } }
    expect(detectUnrelatedScreenLinks(tree(page(section(button))), 'page', home).map((violation) => violation.nodeIds)).toEqual([['n2']])
  })

  it('passes a link home that says so, the header’s and the navigation’s links, a link elsewhere, and a site with no home known', () => {
    const passing = tree(
      page(
        footer(link('Back to home'), link('Homepage'), link('Request a Consultation', { screenId: 'scr-about' })),
        { componentId: 'muiAppBar', children: [{ componentId: 'muiToolbar', children: [link('Harborline Law')] }] },
        { componentId: 'muiStack', props: { component: 'nav' }, children: [link('Our story')] },
      ),
    )
    expect(detectUnrelatedScreenLinks(passing, 'layout', home)).toEqual([])
    expect(detectUnrelatedScreenLinks(tree(page(footer(link('Request a Consultation')))), 'layout')).toEqual([])
    expect(detectUnrelatedScreenLinks(tree(page(footer(link('Request a Consultation')))), 'email', home)).toEqual([])
  })
})

describe('rule 10 — a link that goes nowhere (AGL-3072)', () => {
  const button = (props: Record<string, unknown> = {}): Nested => ({
    componentId: 'muiButton',
    props: { children: 'Request a Consultation', variant: 'contained', ...props },
  })

  it('refuses the live hero’s button with no destination, naming its words and every destination it may take', () => {
    expect(detectLinksWithoutDestination(tree(page(section(button()))), 'page')).toEqual([
      {
        rule: 10,
        code: 'link-without-destination',
        message:
          '"Request a Consultation" goes nowhere. Give it the "screenId" of a screen the site has that does what its words say, or an "href" that is a path on this site or an https: address the brief gives. When the site has no page for it, take it out: a form on this page is sent by its own button, and no element can be reached by an anchor.',
        nodeIds: ['n2'],
      },
    ])
    const unlabeled = { componentId: 'muiScreenLink', props: { renderAs: 'link' } }
    expect(detectLinksWithoutDestination(tree(page(section(unlabeled))), 'layout')).toMatchObject([
      { code: 'link-without-destination', message: expect.stringMatching(/^A Screen Link goes nowhere\./), nodeIds: ['n2'] },
    ])
  })

  it('tells a button drawn inside a Form that the Form draws its own send button from its submitLabel', () => {
    const form: Nested = {
      componentId: 'form',
      props: { formName: 'Consultation request' },
      children: [{ componentId: 'formField', props: { fieldName: 'email', label: 'Email', fieldType: 'email' } }, button({ children: 'Send' })],
    }
    expect(detectLinksWithoutDestination(tree(page(section(form))), 'page')).toMatchObject([
      {
        code: 'link-without-destination',
        message: expect.stringContaining('A Form draws its own send button from its "submitLabel", so take out a button drawn inside one and set that label instead.'),
        nodeIds: ['n4'],
      },
    ])
  })

  it('passes a link to a screen the site has, a path on the site, an https address and a bound one, and leaves an email’s buttons to the email door', () => {
    const linked = tree(
      page(
        section(
          button({ screenId: 'scr-about' }),
          button({ href: '/contact' }),
          button({ href: 'https://calendly.com/brightwater' }),
          { componentId: 'muiScreenLink', props: { children: 'Read more', href: '{{prop.link}}' } },
        ),
      ),
    )
    expect(detectLinksWithoutDestination(linked, 'component')).toEqual([])
    expect(detectLinksWithoutDestination(tree(page(section(button()))), 'email')).toEqual([])
  })

  it('refuses a link whose only destination was an anchor, which the palette validator drops and no element on a page could answer', () => {
    const anchored = tree(page(section(text('h1', 'About Brightwater Law', 'h1'), button({ href: '#consultation' }))))
    const report = validateAiDoctrineTree(anchored, 'page')
    expect(report.tree?.repairs).toEqual(['n3.href is neither an https: URL nor a path on this site; dropped'])
    expect(report.violations.map((violation) => [violation.code, violation.nodeIds])).toEqual([
      ['link-without-destination', [Object.keys(report.tree?.sourceIds ?? {}).find((id) => report.tree?.sourceIds[id] === 'n3')]],
    ])
  })
})

describe('rule 14 — the facts in square brackets a draft asks the member to fill (AGL-3056)', () => {
  it('reads each fact once whatever its case, in the order it first appears, and nothing that is not one', () => {
    expect(
      aiBracketedFacts([
        'Visit us at [Office address], open [Office hours].',
        'Call [office phone number] or [Office Address].',
        'Wills and trusts {{1}}, [ ], [[nested]] and arrays [] stay copy.',
        '[Office phone number]',
      ]),
    ).toEqual(['[Office address]', '[Office hours]', '[office phone number]', '[nested]'])
  })
})

describe('rule 14 — a line cut short (AGL-3072)', () => {
  it('reads a line as unfinished on an article or a joining conjunction, and on a word that opens a phrase after a comma or a dash', () => {
    expect(
      [
        'We are a client-focused law firm guiding individuals, families and businesses through the moments that matter most, with',
        'Wills, trusts and',
        'Meet the',
        'We are a',
        'Business &',
        'Serving [city] families, from',
        'Plain answers — about',
        'Plain answers - for',
      ].map(aiDanglingWord),
    ).toEqual(['with', 'and', 'the', 'a', '&', 'from', 'about', 'for'])
  })

  it('reads a line as finished when it closes, strands a word a title may end on, ends on a name, a hyphenated word, a bracketed fact or a binding', () => {
    expect(
      [
        'What we help with',
        'Who we work for',
        'Plan A',
        'Drop-in hours',
        'Check-in',
        'We work with families.',
        'Our services include:',
        'Call us at [Office phone number]',
        'Hi {{contact.firstName}}',
        'Estate planning and wills',
        '',
      ].map(aiDanglingWord),
    ).toEqual([null, null, null, null, null, null, null, null, null, null, null])
  })

  it('refuses a heading, a subhead or a body line cut short, naming each node and quoting the first line’s end', () => {
    const found = detectDanglingWords(
      tree(
        page(
          section(
            text('h1', 'About Brightwater Law and', 'h1'),
            text('h5', 'Guiding families through the moments that matter most, with', 'p'),
            { componentId: 'muiList', children: [{ componentId: 'muiListItem', children: [{ componentId: 'muiListItemText', props: { primary: 'Wills', secondary: 'Written so your family knows the' } }] }] },
            { componentId: 'muiCard', children: [{ componentId: 'muiCardHeader', props: { title: 'Real estate', subheader: 'Closings, leases and' } }] },
          ),
        ),
      ),
    )
    expect(found).toEqual([
      {
        rule: 14,
        code: 'dangling-word',
        message:
          '"About Brightwater Law and" has no closing punctuation, and its last word, "and", leaves the sentence unfinished. Finish the sentence, or end the line before "and".',
        nodeIds: ['n2', 'n3', 'n6', 'n8'],
      },
    ])
  })

  it('holds no button, link, label, caption or run of inline text to how it ends', () => {
    const labels = tree(
      page(
        section(
          text('h1', 'Contact', 'h1'),
          { componentId: 'muiButton', props: { children: 'Sign up for', href: '/signup' } },
          { componentId: 'muiScreenLink', props: { children: 'Read about', screenId: 'scr-about' } },
          text('caption', 'Photo by the'),
          text('overline', 'Serving families and'),
          { componentId: 'formField', props: { fieldName: 'topic', label: 'Tell us about the', fieldType: 'text' } },
          { componentId: 'muiInlineText', props: { children: 'We work with the' } },
        ),
      ),
    )
    expect(detectDanglingWords(labels)).toEqual([])
  })
})

describe('rule 14 — a line cut at its ceiling (AGL-3076)', () => {
  /** The live hero subhead as the model most likely wrote it: the palette validator cut it at 120 characters to what the page stored. */
  const WHOLE =
    'We are a client-focused law firm guiding individuals, families and businesses through the moments that matter most, with clear advice and steady support.'
  const idOf = (report: ReturnType<typeof validateAiDoctrineTree>, source: string) =>
    Object.keys(report.tree?.sourceIds ?? {}).find((id) => report.tree?.sourceIds[id] === source)

  it('refuses a heading-styled line the palette validator cut at 120 characters, naming the ceiling and a subtitle or body style', () => {
    const report = validateAiDoctrineTree(tree(page(section(text('h1', 'About Brightwater Law', 'h1'), text('h5', WHOLE, 'p')))), 'page')
    expect(report.tree?.nodes[idOf(report, 'n3') as string]?.props?.['children']).toBe(
      'We are a client-focused law firm guiding individuals, families and businesses through the moments that matter most, with',
    )
    expect(report.violations.map((violation) => [violation.code, violation.nodeIds])).toEqual([
      ['copy-cut-at-ceiling', [idOf(report, 'n3')]],
      ['dangling-word', [idOf(report, 'n3')]],
    ])
    expect(report.violations[0]).toMatchObject({
      rule: 14,
      message:
        'A line in a heading style holds at most 120 characters, and "We are a client-focused law firm guiding individuals,…" runs past them, so it was cut off where they end. Write it whole within 120 characters, or give a longer line a subtitle or body style.',
    })
  })

  it('refuses a cut that falls inside a word, which no word list can see, and a button label cut at its own ceiling', () => {
    const report = validateAiDoctrineTree(
      tree(
        page(
          section(
            text('h1', 'About Brightwater Law', 'h1'),
            text('h5', 'Plain answers for families, landlords and small businesses across the county, from the first phone call to the final signature.', 'p'),
            { componentId: 'muiButton', props: { children: 'Request a free consultation with one of our attorneys', href: '/contact' } },
          ),
        ),
      ),
      'page',
    )
    expect(report.violations.map((violation) => [violation.code, violation.nodeIds])).toEqual([
      ['copy-cut-at-ceiling', [idOf(report, 'n3'), idOf(report, 'n4')]],
    ])
    const button = detectCutLines(
      ['n4.children was over 40 characters; truncated'],
      { n4: { componentId: 'muiButton', props: { children: 'Request a free consultation with one of our attorneys' } } },
    )
    expect(button).toEqual([
      {
        rule: 14,
        code: 'copy-cut-at-ceiling',
        message:
          '"Request a free consultation with one of our…" runs past the 40 characters its element holds, so it was cut off where they end. Write it whole within 40 characters.',
        nodeIds: ['n4'],
      },
    ])
  })

  it('keeps the same line written within its ceiling, and reads no repair of a prop a reader does not read as a line', () => {
    const whole = 'We are a client-focused law firm guiding families and businesses through the moments that matter most.'
    expect(validateAiDoctrineTree(tree(page(section(text('h1', 'About Brightwater Law', 'h1'), text('h5', whole, 'p')))), 'page').violations).toEqual([])
    expect(
      detectCutLines(
        ['n2.alt was over 200 characters; truncated', 'n3.href is neither an https: URL nor a path on this site; dropped', 'n9.children was over 120 characters; truncated'],
        { n2: { componentId: 'image', props: { alt: 'x'.repeat(240) } }, n3: { componentId: 'muiButton', props: { href: 'ftp://x' } } },
      ),
    ).toEqual([])
  })
})

describe('rule 11 — one main landmark and an ordered outline', () => {
  it('refuses a page with no h1, two h1s, or a skipped level', () => {
    expect(codes(detectDocumentStructure(tree(page(section(text('h2', 'Services', 'h2')))), 'page'))).toEqual([
      'missing-h1',
      'skipped-heading',
    ])
    expect(codes(detectDocumentStructure(tree(page(text('h1', 'A', 'h1'), text('h1', 'B', 'h1'))), 'page'))).toEqual([
      'multiple-h1',
    ])
    expect(codes(detectDocumentStructure(tree(page(text('h1', 'A', 'h1'), text('h3', 'B', 'h3'))), 'page'))).toEqual([
      'skipped-heading',
    ])
  })

  it('refuses two landmarks, a landmark in a component, and a layout without its one slot or with an h1', () => {
    const twoMains = tree({ componentId: 'div', props: { component: 'main' }, children: [{ componentId: 'layoutSlot', props: { component: 'main' } }, text('h1', 'A', 'h1')] })
    expect(codes(detectDocumentStructure(twoMains, 'page'))).toEqual(['multiple-main'])
    const fragment = tree({ componentId: 'div', props: { component: 'main' }, children: [text('h2', 'Card', 'h2')] })
    expect(codes(detectDocumentStructure(fragment, 'component'))).toEqual(['landmark-in-fragment'])
    expect(codes(detectDocumentStructure(tree(page(text('h1', 'Site', 'h1'))), 'layout'))).toEqual([
      'layout-slot',
      'multiple-h1',
    ])
  })

  it('passes an ordered page, and a layout with one slot and no h1', () => {
    expect(
      detectDocumentStructure(tree(page(text('h1', 'Roofs', 'h1'), section(text('h2', 'Tile', 'h2'), text('h3', 'Clay', 'h3')))), 'page'),
    ).toEqual([])
    expect(
      detectDocumentStructure(tree(page({ componentId: 'muiAppBar', children: [text('h6', 'Acme')] }, { componentId: 'layoutSlot' })), 'layout'),
    ).toEqual([])
  })
})

describe('rule 12 — responsive by the theme’s breakpoints', () => {
  it('refuses a fixed pixel width or a width past a fraction', () => {
    expect(
      detectAdHocWidths(tree(page({ ...section(), sx: { width: '640px' } }, { ...section(), sx: { maxWidth: 960 } })), 'page'),
    ).toMatchObject([{ rule: 12, code: 'fixed-width', nodeIds: ['n1', 'n2'] }])
  })

  it('passes percentages, fractions and breakpoint objects, and an email’s fixed column', () => {
    expect(
      detectAdHocWidths(tree(page({ ...section(), sx: { width: '100%', maxWidth: 1, minWidth: { xs: '100%', md: '50%' } } })), 'page'),
    ).toEqual([])
    expect(detectAdHocWidths(tree(page({ ...section(), sx: { width: '600px' } })), 'email')).toEqual([])
  })
})

describe('rule 12 — a Grid of columns is a container of items sized for every width (AGL-3055)', () => {
  const grid = (props: Record<string, unknown>, children: Nested[], sx?: Record<string, unknown>): Nested => ({
    componentId: 'muiGrid',
    props,
    ...(sx ? { sx } : {}),
    children,
  })
  const item = (size: unknown, child: Nested = card('Estate planning', 'Wills and trusts.')): Nested => ({
    componentId: 'muiGrid',
    props: size === undefined ? {} : { size },
    children: [child],
  })
  const areas = ['Estate planning', 'Real estate', 'Business formation']
  const cells = (size: unknown) => areas.map((title) => item(size, card(title, 'What it covers.')))
  const found = (root: Nested, kind: Parameters<typeof detectUnresponsiveGrids>[1] = 'page') =>
    detectUnresponsiveGrids(tree(page(section(root))), kind).map(({ rule, code, nodeIds }) => ({ rule, code, nodeIds }))

  it('refuses the live About page’s shape: items sized 4 under a Grid that is not a container, naming the Grid and saying what to set', () => {
    const live = detectUnresponsiveGrids(tree(page(section(grid({ ariaLabel: 'Practice areas' }, cells('4'))))), 'page')
    expect(live).toEqual([
      {
        rule: 12,
        code: 'grid-not-container',
        message:
          'A Grid lays out columns only as a container: this one is not, so what it holds stacks at every width. Set "container": true on it, and put each column in a Grid item sized like "xs:12 md:4".',
        nodeIds: ['n2'],
      },
    ])
  })

  it('refuses the goldens’ old shape, a row direction on a Grid that is not a container, and a bare Grid holding several elements', () => {
    const cardsOf = areas.map((title) => card(title, 'What it covers.'))
    expect(found(grid({ direction: 'row' }, cardsOf, { gap: 3 }))).toEqual([{ rule: 12, code: 'grid-not-container', nodeIds: ['n2'] }])
    expect(found(grid({}, cardsOf))).toEqual([{ rule: 12, code: 'grid-not-container', nodeIds: ['n2'] }])
    // One element is no row, and an item of a container holds what it likes.
    expect(found(grid({}, [card('One', 'Only.')]))).toEqual([])
    expect(found(grid({ container: true, spacing: '3' }, [grid({ size: 'xs:12 md:6' }, [text('h3', 'A', 'h3'), text('body1', 'B')])]))).toEqual([])
  })

  it('refuses a container’s child that is not an item full width on a phone, with the size for that many columns', () => {
    const fixed = detectUnresponsiveGrids(tree(page(section(grid({ container: true, spacing: '3' }, cells('4'))))), 'page')
    expect(fixed.map(({ code, nodeIds }) => [code, nodeIds])).toEqual([['grid-item-size', ['n3', 'n8', 'n13']]])
    expect(fixed[0].message).toBe(
      'Every child of a Grid container is a Grid item whose size is full width on a phone and steps up to columns at a larger width, written as one string. Size these like "xs:12 md:4", and wrap any other element in such an item.',
    )
    // A card placed straight in the container, an item with no size, one whose phone size is not full width, and one the renderer cannot read.
    const mixed = grid({ container: true }, [card('Loose', 'No item.'), item(undefined), item('sm:6 md:3'), item('4 columns')])
    expect(found(mixed)).toEqual([{ rule: 12, code: 'grid-item-size', nodeIds: ['n3', 'n7', 'n12', 'n17'] }])
    expect(detectUnresponsiveGrids(tree(page(section(mixed))), 'page')[0].message).toContain('like "xs:12 sm:6 md:3"')
    // Full width at every width is one column at every width.
    expect(found(grid({ container: true }, cells('xs:12')))).toEqual([{ rule: 12, code: 'grid-item-size', nodeIds: ['n3', 'n8', 'n13'] }])
    // A container of its own column count is sized against it.
    expect(found(grid({ container: true, columns: '6' }, cells('xs:6 md:2')))).toEqual([])
  })

  it('refuses a container spaced by an sx gap its items’ widths do not count, with the spacing to set instead', () => {
    const gapped = detectUnresponsiveGrids(tree(page(section(grid({ container: true }, cells('xs:12 md:4'), { gap: 3 })))), 'page')
    expect(gapped).toEqual([
      {
        rule: 12,
        code: 'grid-gap',
        message:
          'A Grid container\'s items are sized by its "spacing", so an sx gap pushes its last column onto a row of its own. Remove the sx gap and set "spacing": 3.',
        nodeIds: ['n2'],
      },
    ])
    expect(found(grid({ container: true }, cells('xs:12 md:4'), { columnGap: 2 }))).toEqual([{ rule: 12, code: 'grid-gap', nodeIds: ['n2'] }])
    // A row gap spaces rows, which the item widths never count.
    expect(found(grid({ container: true, spacing: '3' }, cells('xs:12 md:4'), { rowGap: 4 }))).toEqual([])
  })

  it('passes a responsive row on every document a Grid is built in, and holds a layout and a component the same way', () => {
    const responsive = grid({ container: true, spacing: '3' }, [
      item('xs:12'),
      ...areas.map((title) => item('xs:12 sm:6 md:4', card(title, 'What it covers.'))),
    ])
    for (const kind of ['page', 'template', 'layout', 'component'] as const) {
      expect([kind, found(responsive, kind)]).toEqual([kind, []])
    }
    const live = grid({ ariaLabel: 'Practice areas' }, cells('4'))
    for (const kind of ['layout', 'component'] as const) {
      expect([kind, found(live, kind).map((violation) => violation.code)]).toEqual([kind, ['grid-not-container']])
    }
    expect(found(live, 'email')).toEqual([])
  })

  it('runs on every tree the doctrine checks, after the palette validator has read the sizes', () => {
    // A switch written as text and a size written as a number arrive as the palette reads them.
    const answer = tree(page(section(text('h1', 'About', 'h1')), section(text('h2', 'What we help with', 'h2'), grid({ container: 'true', spacing: 3 }, cells(4)))))
    const report = validateAiDoctrineTree(answer, 'page', { reusableComponents: false })
    expect(report.violations.map((violation) => violation.code)).toEqual(['grid-item-size'])
  })
})

describe('rule 12 — each Grid that is not a container is told what its own shape needs (AGL-3078)', () => {
  const grid = (props: Record<string, unknown>, children: Nested[]): Nested => ({ componentId: 'muiGrid', props, children })
  const cells = (size: string) =>
    ['Estate planning', 'Real estate', 'Business formation'].map((title) => grid({ size }, [card(title, 'What it covers.')]))
  const group = [text('h3', 'How we work', 'h3'), text('body1', 'Plain advice and fixed fees.')]
  const found = (root: Nested) =>
    detectUnresponsiveGrids(tree(page(section(root))), 'page').map(({ rule, code, nodeIds }) => ({ rule, code, nodeIds }))
  /** A page's rule 12 findings as the whole-tree check makes them, named by the ids the fixture wrote. */
  const checked = (root: Nested) => {
    const report = validateAiDoctrineTree(tree(page(section(text('h1', 'About', 'h1')), section(root))), 'page', { reusableComponents: false })
    return report.violations
      .filter((violation) => violation.rule === 12)
      .map((violation) => ({ ...violation, nodeIds: violation.nodeIds?.map((id) => report.tree?.sourceIds[id]) }))
  }

  it('tells a Grid that only stacks a group to use a Stack or a Box, or to become a container of sized items, and passes either', () => {
    expect(detectUnresponsiveGrids(tree(page(section(grid({ spacing: '2' }, group)))), 'page')).toEqual([
      {
        rule: 12,
        code: 'grid-as-stack',
        message:
          'A Grid that is not a container lays nothing out, so this one only stacks what it holds. Use a Stack (or a Box) for a group that only stacks, such as a heading over its text, or make it a container of sized items: set "container": true on it, and put each column in a Grid item sized like "xs:12 md:4".',
        nodeIds: ['n2'],
      },
    ])
    // A bare Grid holding the group, and an item of a container spacing its own group, are the same shape.
    expect(found(grid({}, group))).toEqual([{ rule: 12, code: 'grid-as-stack', nodeIds: ['n2'] }])
    expect(found(grid({ container: true }, [grid({ size: 'xs:12 md:6', spacing: '2' }, group)]))).toEqual([
      { rule: 12, code: 'grid-as-stack', nodeIds: ['n3'] },
    ])
    // A row keeps the container re-ask: cards of one shape, or a row direction, are columns.
    expect(found(grid({}, cells('4').map((cell) => (cell.children ?? [])[0])))).toEqual([
      { rule: 12, code: 'grid-not-container', nodeIds: ['n2'] },
    ])
    expect(found(grid({ direction: 'row' }, group))).toEqual([{ rule: 12, code: 'grid-not-container', nodeIds: ['n2'] }])
    // Mended either way, the group passes.
    expect(found({ componentId: 'muiStack', props: { spacing: '2' }, children: group })).toEqual([])
    expect(found(grid({ container: true, spacing: '3' }, [grid({ size: 'xs:12 md:6' }, group)]))).toEqual([])
  })

  it('reads a column direction the palette validator drops from what the model wrote, and tells it a Grid has none', () => {
    const [stack, ...others] = checked(grid({ direction: 'column' }, group))
    expect(others).toEqual([])
    expect(stack).toEqual({
      rule: 12,
      code: 'grid-as-stack',
      message:
        'A Grid lays out rows and has no "column" direction, so this one only stacks what it holds. Use a Stack (or a Box) for a group that only stacks, such as a heading over its text, or make it a container of sized items: set "container": true on it, and put each column in a Grid item sized like "xs:12 md:4".',
      nodeIds: ['n4'],
    })
    // A column of cards is a group that only stacks too; the Stack it asks for passes.
    expect(checked(grid({ direction: 'column-reverse' }, cells('xs:12 md:4').map((cell) => (cell.children ?? [])[0])))).toEqual([
      expect.objectContaining({ code: 'grid-as-stack', message: expect.stringContaining('no "column" direction') }),
    ])
    expect(checked({ componentId: 'muiStack', props: { direction: 'column' }, children: group })).toEqual([])
  })

  it('tells a sized item in a Box or a Stack inside its container to move directly under it, where the wrapper was refused as no item', () => {
    const boxed = detectUnresponsiveGrids(
      tree(page(section(grid({ container: true, spacing: '3' }, [{ componentId: 'muiBox', children: cells('xs:12 md:4') }])))),
      'page',
    )
    expect(boxed).toEqual([
      {
        rule: 12,
        code: 'grid-item-outside-container',
        message:
          'A Grid item is sized only by the Grid container it sits directly in, and this one sits in a Box, so its size does nothing and it stacks at every width. Move it directly under its Grid container, or, where it has none, put it and the items beside it in one ("container": true).',
        nodeIds: ['n4', 'n9', 'n14'],
      },
    ])
    // Items that hold a group, in a Stack, are the same shape.
    const inStack = grid({ container: true }, [{ componentId: 'muiStack', children: [grid({ size: 'xs:12 md:6' }, group), grid({ size: 'xs:12 md:6' }, group)] }])
    expect(found(inStack)).toEqual([{ rule: 12, code: 'grid-item-outside-container', nodeIds: ['n4', 'n7'] }])
    // Their sizes are read against the container they belong in.
    expect(found(grid({ container: true }, [{ componentId: 'muiBox', children: cells('4') }]))).toEqual([
      { rule: 12, code: 'grid-item-outside-container', nodeIds: ['n4', 'n9', 'n14'] },
      { rule: 12, code: 'grid-item-size', nodeIds: ['n4', 'n9', 'n14'] },
    ])
    // A Box holding anything but items is still no item of its container.
    expect(found(grid({ container: true }, [{ componentId: 'muiBox', children: [text('h3', 'Areas', 'h3'), ...cells('xs:12 md:4')] }]))).toEqual([
      { rule: 12, code: 'grid-item-size', nodeIds: ['n3'] },
    ])
    // Sized items that hold a group in a Box with no container at all are told the same, and nothing new is refused.
    expect(found({ componentId: 'muiBox', children: [grid({ size: 'xs:12 md:6' }, group), grid({ size: 'xs:12 md:6' }, group)] })).toEqual([
      { rule: 12, code: 'grid-item-outside-container', nodeIds: ['n3', 'n6'] },
    ])
    expect(found({ componentId: 'muiBox', children: cells('xs:12 md:4') })).toEqual([])
    // Moved under the container, they pass.
    expect(found(grid({ container: true, spacing: '3' }, cells('xs:12 md:4')))).toEqual([])
  })

  it('names a container written as a value the palette cannot read as the fault, and passes the switch it reads', () => {
    expect(checked(grid({ container: 'True', spacing: '3' }, cells('xs:12 md:4')))).toEqual([
      {
        rule: 12,
        code: 'grid-container-text',
        message:
          'This Grid\'s "container" is the text "True", not true, so it is not a container and what it holds stacks at every width. Write "container": true, with no quotes around true.',
        nodeIds: ['n4'],
      },
    ])
    expect(checked(grid({ container: 1, spacing: '3' }, cells('xs:12 md:4')))).toEqual([
      expect.objectContaining({
        code: 'grid-container-text',
        message: 'This Grid\'s "container" is 1, not true, so it is not a container and what it holds stacks at every width. Write "container": true.',
      }),
    ])
    // The text "true" is read as the switch, and a switch the model wrote passes.
    expect(checked(grid({ container: 'true', spacing: '3' }, cells('xs:12 md:4')))).toEqual([])
    expect(checked(grid({ container: true, spacing: '3' }, cells('xs:12 md:4')))).toEqual([])
    // With nothing written to read, the same Grid is a row that is not a container.
    expect(found(grid({ spacing: '3' }, cells('xs:12 md:4')))).toEqual([{ rule: 12, code: 'grid-not-container', nodeIds: ['n2'] }])
  })
})

describe('rule 13 — drafts only', () => {
  it('refuses an answer that asks to publish, wherever it says so', () => {
    expect(detectPublishIntent({ rootId: 'n1', publish: true })).toMatchObject([
      { rule: 13, code: 'publish-intent', paths: ['publish'] },
    ])
    expect(detectPublishIntent({ screens: [{ status: 'Published' }] })).toMatchObject([
      { paths: ['screens[0].status'] },
    ])
  })

  it('passes a draft, and never reads page content as an instruction', () => {
    expect(detectPublishIntent({ publish: false, status: 'draft' })).toEqual([])
    expect(detectPublishIntent({ nodes: { n1: { props: { publish: true } } } })).toEqual([])
  })
})

describe('rule 14 — the site’s voice, with no filler', () => {
  it('refuses lorem ipsum and “your text here”, from a tree or a plan', () => {
    expect(detectOffVoiceCopy([{ at: 'n1', text: 'Lorem ipsum dolor sit amet' }])).toMatchObject([
      { rule: 14, code: 'filler-copy', nodeIds: ['n1'] },
    ])
    expect(detectOffVoiceCopy([{ at: 'screens[0].title', text: 'Your headline here' }])).toMatchObject([
      { code: 'filler-copy', paths: ['screens[0].title'] },
    ])
    expect(aiTreeCopy(tree(page(text('body1', 'Lorem ipsum'))))).toEqual([{ at: 'n1', text: 'Lorem ipsum' }])
  })

  it('refuses judgment words only for agency and enterprise copy', () => {
    const samples = [{ at: 'n1', text: 'Simply drag and drop.' }]
    expect(codes(detectOffVoiceCopy(samples, 'agency'))).toEqual(['judgment-words'])
    expect(detectOffVoiceCopy(samples, null)).toEqual([])
  })

  it('passes a bracketed gap for a fact the brief never gave', () => {
    expect(detectOffVoiceCopy([{ at: 'n1', text: 'Call [phone number] for a same-week visit.' }])).toEqual([])
  })
})

describe('rule 15 — start from a duplicate of the nearest thing', () => {
  it('refuses rebuilding a screen the site has, and duplicating one it does not', () => {
    const found = detectMissedDuplicate(
      planOf({
        screens: [screen({ title: 'About us', slug: '/about-us' }), screen({ slug: '/x', duplicateOf: 'scr-missing' })],
        create: [{ kind: 'template', name: 'Service pages', why: 'For services.', duplicateOf: null, fields: [] }],
      }),
      INVENTORY,
    )
    expect(codes(found)).toEqual(['plan-missed-duplicate', 'plan-missed-duplicate', 'plan-duplicate-unknown'])
  })

  it('passes a screen that starts from the site’s own copy', () => {
    expect(
      detectMissedDuplicate(planOf({ screens: [screen({ title: 'About us', slug: '/about-us', duplicateOf: 'scr-about' })] }), INVENTORY),
    ).toEqual([])
  })
})

describe('rule 16 — the smallest document that does the job', () => {
  it('refuses a wrapper around a wrapper, an empty container, a font, an eager image, an embed and a repeated style', () => {
    const repeatedStyle = { mb: 2, textAlign: 'center' }
    const found = detectHeavyDocument(
      tree(
        page(
          { componentId: 'muiBox', children: [{ componentId: 'muiStack', props: { direction: 'column' }, children: [text('body1', 'x')] }] },
          { componentId: 'muiStack', props: { direction: 'row' } },
          { ...text('body1', 'Hand-set.'), sx: { fontFamily: 'Comic Sans MS' } },
          image({ src: IMAGE, alt: 'first' }),
          image({ src: IMAGE, alt: 'second', loading: 'eager' }),
          { componentId: 'videoEmbed', props: { url: 'https://video.example.com/x' } },
          ...[1, 2, 3, 4].map((n) => ({ ...text('body1', `Line ${n}`), sx: repeatedStyle })),
        ),
      ),
      'page',
    )
    expect(codes(found)).toEqual([
      'wrapper-in-wrapper',
      'empty-container',
      'duplicated-inline-style',
      'extra-font',
      'eager-image',
      'third-party-embed',
    ])
    expect(found.every((violation) => violation.rule === 16)).toBe(true)
  })

  it('refuses a video that loads before anyone plays it', () => {
    const video = tree(page({ componentId: 'video', props: { src: IMAGE, autoPlay: true } }))
    expect(codes(detectHeavyDocument(video, 'page'))).toEqual(['autoplay-video'])
  })

  it('passes an embed the plan named, and a lean section', () => {
    expect(
      detectHeavyDocument(tree(page(section(text('h1', 'Roofs', 'h1')), { componentId: 'videoEmbed', props: { url: 'https://video.example.com/x' } })), 'page', { allowEmbeds: true }),
    ).toEqual([])
  })
})

describe('rule 16 — an item with nothing in it (AGL-3072)', () => {
  const listItem = (props: Record<string, unknown>): Nested => ({
    componentId: 'muiListItem',
    children: [{ componentId: 'muiListItemText', props }],
  })

  it('refuses the live list’s last item, whose List Item Text has no words, saying to write them or take the item out', () => {
    const list = tree(page(section({ componentId: 'muiList', children: [listItem({ primary: 'Wills & Trusts' }), listItem({})] })))
    expect(detectEmptyItems(list)).toEqual([
      {
        rule: 16,
        code: 'empty-item',
        message: 'A list item holds no words, so its row shows empty. Write the words of its List Item Text, or take the item out.',
        nodeIds: ['n5'],
      },
    ])
  })

  it('refuses a card that frames only blank words, and names a list item and a card together', () => {
    const blankCard: Nested = {
      componentId: 'muiCard',
      children: [{ componentId: 'muiCardContent', children: [text('h3', '  ', 'h3'), { componentId: 'muiStack', children: [text('body2', '')] }] }],
    }
    expect(detectEmptyItems(tree(page(section(blankCard))))).toMatchObject([
      { code: 'empty-item', message: 'A card holds nothing to read or see. Give it its words, or take the card out.', nodeIds: ['n2'] },
    ])
    const both = detectEmptyItems(tree(page(section(blankCard, { componentId: 'muiList', children: [listItem({ primary: '' })] }))))
    expect(both).toMatchObject([
      { message: 'A list item and a card hold nothing to read or see. Give each its words, or take it out.', nodeIds: ['n2', 'n8'] },
    ])
  })

  it('passes an item with words or a picture, and leaves an item that holds no element at all to the empty-container rule', () => {
    const filled = tree(
      page(
        section(
          { componentId: 'muiList', children: [listItem({ secondary: 'Probate and trust administration' })] },
          { componentId: 'muiCard', children: [image({ alt: 'The office on Main Street' })] },
          { componentId: 'muiCard', children: [{ componentId: 'muiCardHeader', props: { title: 'Family law' } }] },
        ),
      ),
    )
    expect(detectEmptyItems(filled)).toEqual([])
    const bare = tree(page(section({ componentId: 'muiCard' })))
    expect(detectEmptyItems(bare)).toEqual([])
    expect(codes(detectHeavyDocument(bare, 'page'))).toEqual(['empty-container'])
  })
})

describe('rule 17 — a measured budget for every output', () => {
  it('scores what a tree weighs, in the save’s bytes and the library’s recorded sizes', () => {
    const measured = tree(
      page(
        image({ src: IMAGE, alt: 'wide', width: '1280' }),
        image({ src: formatMediaRef('host-1', 'asset-unknown'), alt: 'unsized' }),
        { componentId: 'videoEmbed', props: { url: 'https://video.example.com/x' } },
        { ...text('body1', 'Set.'), sx: { fontFamily: 'Georgia' } },
      ),
    )
    const score = scoreAiOutput(measured, 'page', {
      assets: { 'asset-1': { sizeBytes: 4_000_000, width: 4_000 } },
    })
    // A 1,280-wide slot is served the 1,280 variant: (1280 / 4000)² of the original.
    expect(score).toMatchObject({
      nodes: 5,
      imageBytes: 409_600,
      imagesUnmeasured: 1,
      embeds: 1,
      fontFamilies: 1,
      emailHtmlBytes: null,
    })
    expect(score.bytes).toBeGreaterThan(0)
  })

  it('refuses an output over its budget with the figure, the budget and the heaviest parts', () => {
    const fields = tree({
      componentId: 'form',
      children: Array.from({ length: AI_OUTPUT_BUDGETS.form.nodes }, (_, i) => ({
        componentId: 'formField',
        props: { fieldName: `field${i}`, fieldType: 'text' },
      })),
    })
    const found = detectOverBudget(scoreAiOutput(fields, 'form'), 'form', fields)
    expect(found).toMatchObject([
      {
        rule: 17,
        code: 'over-budget-nodes',
        figure: { metric: 'nodes', value: AI_OUTPUT_BUDGETS.form.nodes + 1, budget: AI_OUTPUT_BUDGETS.form.nodes },
        nodeIds: ['n1', 'n2', 'n3'],
      },
    ])
    expect(found[0].message).toContain(`against a budget of ${AI_OUTPUT_BUDGETS.form.nodes}`)

    const chrome = tree(page({ componentId: 'layoutSlot' }, image({ src: IMAGE, alt: 'hero' })))
    const heavy = detectOverBudget(
      scoreAiOutput(chrome, 'layout', { assets: { 'asset-1': { sizeBytes: 900_000 } } }),
      'layout',
      chrome,
    )
    expect(codes(heavy)).toEqual(['over-budget-imageBytes'])
  })

  it('measures an email as a mail client receives it, against the clipping threshold', () => {
    const long = 'Every roof we fix is inspected twice. '.repeat(52)
    const email = tree({
      componentId: 'div',
      children: Array.from({ length: 60 }, () => ({ componentId: 'emailText', props: { children: long.slice(0, 2_000) } })),
    })
    const score = scoreAiOutput(email, 'email')
    expect(score.emailHtmlBytes).toBeGreaterThan(AI_OUTPUT_BUDGETS.email.emailHtmlBytes as number)
    expect(codes(detectOverBudget(score, 'email', email))).toContain('over-budget-emailHtmlBytes')
  })

  it('estimates a first visit on the platform’s measured page weight, and a fragment by what it adds', () => {
    const small = tree(page(text('h1', 'Roofs', 'h1')))
    const pageScore = scoreAiOutput(small, 'page')
    expect(estimateAiOutputLoad(pageScore, 'page')).toEqual({
      pageBytes: ESTIMATED_PAGE_TRANSFER_BYTES,
      documentBytes: pageScore.bytes,
      imageBytes: 0,
      imagesUnmeasured: 0,
      embeds: 0,
      totalBytes: Math.round(ESTIMATED_PAGE_TRANSFER_BYTES + pageScore.bytes),
    })
    expect(estimateAiOutputLoad(pageScore, 'component')?.pageBytes).toBe(0)
    expect(estimateAiOutputLoad(pageScore, 'email')).toBeNull()
  })
})

describe('validateAiDoctrineTree — the palette first, then every rule', () => {
  const golden = () =>
    tree(
      page(
        section({
          componentId: 'muiContainer',
          props: { maxWidth: 'md' },
          children: [
            {
              componentId: 'muiStack',
              props: { direction: 'column', spacing: '3' },
              sx: { py: 8, textAlign: 'center' },
              children: [
                text('h1', 'Plans for teams that ship', 'h1'),
                text('body1', 'One workspace for every site, every campaign and every customer record.'),
                { componentId: 'muiButton', props: { variant: 'contained', children: 'Start free', href: '/signup' } },
                image({ src: IMAGE, alt: 'A team at a whiteboard' }),
              ],
            },
          ],
        }),
      ),
    )

  it('admits a page built the way the doctrine asks, with its score and its weight', () => {
    const report = validateAiDoctrineTree(golden(), 'page')
    expect(report.violations).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.tree?.repairs).toEqual([])
    expect(report.score?.nodes).toBe(8)
    expect(report.load?.pageBytes).toBe(ESTIMATED_PAGE_TRANSFER_BYTES)
  })

  it('reports each broken rule on a tree the palette admitted', () => {
    const broken = golden()
    const heading = Object.values(broken.nodes).find((node) => node.componentId === 'muiTypography') as unknown as { sx?: Record<string, unknown> }
    heading.sx = { color: '#ff0000' }
    const report = validateAiDoctrineTree(broken, 'page')
    expect(report.ok).toBe(false)
    expect(codes(report.violations)).toEqual(['literal-color'])
  })

  it('holds a link to its band and to the home screen the inventory names, on every tree the doctrine checks (AGL-3056)', () => {
    const footer = tree(
      page({
        componentId: 'section',
        props: { element: 'footer' },
        sx: { bgcolor: 'primary.main', color: 'background.paper' },
        children: [{ componentId: 'muiScreenLink', props: { children: 'Request a Consultation', screenId: 'scr-home' } }],
      }),
    )
    const report = validateAiDoctrineTree(footer, 'component', { screenIds: ['scr-home'], homeScreenIds: ['scr-home'] })
    expect(report.violations.map((violation) => [violation.rule, violation.code])).toEqual([
      [5, 'link-color-on-band'],
      [10, 'link-unrelated-screen'],
    ])
  })

  it('refuses the live Free About page for its three defects and nothing else, by the ids it stored them under (AGL-3072)', () => {
    const report = validateAiDoctrineTree(AI_FREE_PAGE_BUILT_SECTIONS, 'page', { reusableComponents: false })
    expect(report.tree?.repairs).toEqual([])
    expect(
      report.violations.map((violation) => [
        violation.rule,
        violation.code,
        violation.nodeIds?.map((id) => report.tree?.sourceIds[id]),
      ]),
    ).toEqual([
      [10, 'link-without-destination', ['Jgquy_nSMC']],
      [14, 'dangling-word', ['IxdLHxS6ds']],
      [16, 'empty-item', ['Z-lpdjMIZb']],
    ])
    expect(report.violations[1].message).toContain('"…the moments that matter most, with" has no closing punctuation')
  })

  it('turns a tree the palette refuses into one unreadable-output finding, and still holds rule 13', () => {
    const report = validateAiDoctrineTree(
      { ...tree(page({ componentId: 'marketplacePlugin' })), publish: true },
      'page',
    )
    expect(report.tree).toBeNull()
    expect(report.violations).toMatchObject([
      { rule: null, code: 'tree-component', message: 'The answer could not be used as a page.' },
      { rule: 13, code: 'publish-intent' },
    ])
  })
})

describe('what a plan places, it reuses or creates (AGL-3040)', () => {
  const PAGE_JOB = { noun: 'a page job', creates: AI_PAGE_CREATE_KINDS }
  /** A workspace that keeps everything, narrowed to what a page job builds. */
  const PAID_PAGE = aiPlanCapabilitiesForJob(aiUnrestrictedPlanCapabilities(), PAGE_JOB)
  const creation = (kind: AiBuildPlan['create'][number]['kind'], name: string) => ({
    kind,
    name,
    why: 'Nothing the site has will do.',
    duplicateOf: null,
    fields: [],
  })

  it('rule 2: refuses a section that places a layout, the site’s or one the plan creates', () => {
    const placed = planOf({
      create: [creation('layout', 'Main layout')],
      screens: [
        screen({
          layout: 'new:Main layout',
          sections: [
            { name: 'hero', uses: ['new:Main layout'], items: 0 },
            { name: 'services grid', uses: ['cmp-card', 'lay-site'], items: 3 },
          ],
        }),
      ],
    })
    expect(detectPlanLayoutRegions(placed, INVENTORY)).toEqual([
      {
        rule: 2,
        code: 'plan-layout-in-section',
        message:
          "A section places a layout. A layout frames a whole screen and is never placed inside one: name it as the screen's layout, and take it out of the section's uses.",
        paths: ['screens[0].sections[0].uses[0]', 'screens[0].sections[1].uses[1]'],
      },
    ])
    expect(detectPlanLayoutRegions(planOf(), INVENTORY)).toEqual([])
  })

  it('rule 2: refuses a screen’s undeclared layout once, saying what this workspace may do instead', () => {
    const undeclared = planOf({ screens: [screen({ layout: 'new:Site frame' })] })
    // The site holds its one layout, and this workspace may create no other.
    expect(detectPlanLayoutRegions(undeclared, INVENTORY, FREE)).toEqual([
      {
        rule: 2,
        code: 'plan-screen-without-layout',
        message:
          'A screen names no layout the site has, and this job may not create one. Put every screen in a layout the site has.',
        paths: ['screens[0].layout'],
      },
    ])
    expect(detectPlanLayoutRegions(undeclared, INVENTORY)[0].message).toContain('or plan one')
    // Rule 7 leaves a screen's layout to rule 2.
    expect(detectPlanUndeclaredCreations(undeclared, INVENTORY, FREE)).toEqual([])
  })

  it('rule 4: refuses a section that places a template, which only a whole screen applies', () => {
    const placed = planOf({ screens: [screen({ sections: [{ name: 'hero', uses: ['tpl-service'], items: 0 }] })] })
    expect(detectUntemplatedSimilarPages(placed, INVENTORY)).toEqual([
      {
        rule: 4,
        code: 'plan-template-in-section',
        message:
          "A section places a template. A template is applied to a whole screen and is never placed inside one: take it out of the section's uses, and name it as the screen's template only when the whole screen is built from it.",
        paths: ['screens[0].sections[0].uses[0]'],
      },
    ])
    const created = planOf({
      create: [creation('template', 'Service page v2')],
      screens: [screen({ sections: [{ name: 'body', uses: ['new:Service page v2'], items: 0 }] })],
    })
    expect(codes(detectUntemplatedSimilarPages(created))).toEqual(['plan-template-in-section'])
    expect(detectUntemplatedSimilarPages(planOf({ screens: [screen({ template: 'tpl-service' })] }), INVENTORY)).toEqual([])
  })

  it('rule 7: refuses a creation a section places and the plan never declares, and tells a workspace that may make it to declare it', () => {
    const plan = planOf({
      screens: [
        screen({
          sections: [
            { name: 'contact form', uses: ['new:Contact request'], items: 0 },
            { name: 'services grid', uses: ['new:Service tile'], items: 6 },
          ],
        }),
      ],
    })
    expect(detectPlanUndeclaredCreations(plan, INVENTORY, PAID_PAGE)).toEqual([
      {
        rule: 7,
        code: 'plan-creation-undeclared',
        message:
          'The "contact form" section places a creation named "Contact request", but the plan never creates it. Declare it in create as a form, with why nothing the site has will do, or place a form the site already has by its id.',
        paths: ['screens[0].sections[0].uses[0]'],
      },
      {
        rule: 7,
        code: 'plan-creation-undeclared',
        message:
          'The "services grid" section places a creation named "Service tile", but the plan never creates it. Declare it in create as a component, with why nothing the site has will do, or place a component the site already has by its id.',
        paths: ['screens[0].sections[1].uses[0]'],
      },
    ])
    // With no capabilities read, the doctrine applies whole, and the way out is the same.
    expect(detectPlanUndeclaredCreations(plan, INVENTORY)).toEqual(detectPlanUndeclaredCreations(plan, INVENTORY, PAID_PAGE))
    // A form section that already places its form placed something else beside it.
    const beside = planOf({
      screens: [screen({ sections: [{ name: 'contact form', uses: ['frm-contact', 'new:Office map'], items: 0 }] })],
    })
    expect(detectPlanUndeclaredCreations(beside, INVENTORY, PAID_PAGE)[0].message).toContain(
      'Declare it in create as a component',
    )
  })

  it('rule 7: tells a workspace that cannot make the creation to build the page without it', () => {
    const plan = planOf({
      screens: [
        screen({
          sections: [
            { name: 'quote request', uses: ['new:Quote form'], items: 0 },
            { name: 'services grid', uses: ['new:Service tile'], items: 6 },
          ],
        }),
      ],
    })
    expect(
      detectPlanUndeclaredCreations(plan, INVENTORY, aiPlanCapabilitiesForJob(FREE, PAGE_JOB)).map((found) => found.message),
    ).toEqual([
      'The "quote request" section places a creation named "Quote form", but the plan never creates it, and this workspace\'s plan does not include saved forms. Draw the form on the page instead, as a Form element holding its Form Fields. Take it out of the section\'s uses.',
      'The "services grid" section places a creation named "Service tile", but the plan never creates it, and this workspace\'s plan does not include reusable components. Draw a list\'s repeated items in one section instead. Take it out of the section\'s uses.',
    ])
  })

  it('rule 7: never tells a plan to declare a creation the site has no room left for', () => {
    const oneForm: AiPlanCapabilities = {
      ...PAID_PAGE,
      create: { ...PAID_PAGE.create, form: { allowed: true, left: 1, reason: null } },
    }
    const plan = planOf({
      create: [creation('form', 'Newsletter')],
      screens: [
        screen({
          sections: [
            { name: 'newsletter signup', uses: ['new:Newsletter'], items: 0 },
            { name: 'contact form', uses: ['new:Contact'], items: 0 },
          ],
        }),
      ],
    })
    expect(detectPlanUndeclaredCreations(plan, INVENTORY, oneForm)).toEqual([
      {
        rule: 7,
        code: 'plan-creation-undeclared',
        message:
          'The "contact form" section places a creation named "Contact", but the plan never creates it, and this site has room for 1 more. Place a form the site already has. Take it out of the section\'s uses.',
        paths: ['screens[0].sections[1].uses[0]'],
      },
    ])
  })

  it('rule 7: refuses a template a screen applies and the plan never declares', () => {
    const plan = planOf({ screens: [screen({ template: 'new:Service page' })] })
    expect(detectPlanUndeclaredCreations(plan, INVENTORY, PAID_PAGE)).toEqual([
      {
        rule: 7,
        code: 'plan-creation-undeclared',
        message:
          'The screen "Roof repair" applies a template named "Service page", but the plan never creates it, and a page job does not build one. Leave the screen\'s template empty, or apply a template the site already has.',
        paths: ['screens[0].template'],
      },
    ])
    expect(detectPlanUndeclaredCreations(plan, INVENTORY)[0].message).toBe(
      'The screen "Roof repair" applies a template named "Service page", but the plan never creates it. Declare it in create as a template, with why nothing the site has will do, or leave the screen\'s template empty.',
    )
  })

  it('rule 7: reports a name once however often it is placed, and nothing for a plan that declares what it places', () => {
    const plan = planOf({
      screens: [
        screen({ sections: [{ name: 'cards', uses: ['new:Card'], items: 3 }] }),
        screen({ title: 'Gutters', slug: '/gutters', sections: [{ name: 'more cards', uses: ['new:card'], items: 3 }] }),
      ],
    })
    expect(detectPlanUndeclaredCreations(plan, INVENTORY, PAID_PAGE)).toMatchObject([
      { code: 'plan-creation-undeclared', paths: ['screens[0].sections[0].uses[0]', 'screens[1].sections[0].uses[0]'] },
    ])
    const declared = planOf({ ...plan, create: [creation('component', 'Card')] })
    expect(detectPlanUndeclaredCreations(declared, INVENTORY, PAID_PAGE)).toEqual([])
  })

  describe('the plan the first live recording of the Free brief kept', () => {
    /**
     * The brief's workspace as its eval case describes it: no reusable
     * components, saved forms or datasets, and room for the one layout its
     * site does not have yet — narrowed to what a page job builds.
     */
    const FREE_BRIEF = aiPlanCapabilitiesForJob(
      {
        reusableComponents: false,
        create: {
          ...aiUnrestrictedPlanCapabilities().create,
          component: { allowed: false, left: 0, reason: "this workspace's plan does not include reusable components" },
          layout: { allowed: true, left: 1, reason: null },
          template: { allowed: true, left: 10, reason: null },
          form: { allowed: false, left: 0, reason: "this workspace's plan does not include saved forms" },
          dataset: { allowed: false, left: 0, reason: "this workspace's plan does not include datasets" },
        },
      },
      PAGE_JOB,
    )
    const SITE: AiSiteInventory = {
      ...emptyAiSiteInventory('host-brightwater-law'),
      screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: null, template: false }],
    }

    it('is refused on the Free workspace it was recorded for: the layout off the hero section, the form drawn on the page', () => {
      expect(validateAiBuildPlan(AI_FREE_PAGE_RECORDED_PLAN, SITE, null, FREE_BRIEF)).toEqual([
        {
          rule: 2,
          code: 'plan-layout-in-section',
          message:
            "A section places a layout. A layout frames a whole screen and is never placed inside one: name it as the screen's layout, and take it out of the section's uses.",
          paths: ['screens[0].sections[0].uses[0]'],
        },
        {
          rule: 7,
          code: 'plan-creation-undeclared',
          message:
            'The "consultation request form" section places a creation named "consultation-form", but the plan never creates it, and this workspace\'s plan does not include saved forms. Draw the form on the page instead, as a Form element holding its Form Fields. Take it out of the section\'s uses.',
          paths: ['screens[0].sections[4].uses[0]'],
        },
      ])
    })

    it('is refused on a paid workspace as well, where the form it places is declared and its repeats are components', () => {
      const found = validateAiBuildPlan(AI_FREE_PAGE_RECORDED_PLAN, SITE, null, PAID_PAGE)
      expect(found.map(({ rule, code, paths }) => [rule, code, paths])).toEqual([
        [1, 'plan-repeated-items', ['screens[0].sections[2]', 'screens[0].sections[3]']],
        [2, 'plan-layout-in-section', ['screens[0].sections[0].uses[0]']],
        [3, 'plan-form-not-placed', ['screens[0].sections[4]']],
        [7, 'plan-creation-undeclared', ['screens[0].sections[4].uses[0]']],
      ])
      expect(found[3].message).toBe(
        'The "consultation request form" section places a creation named "consultation-form", but the plan never creates it. Declare it in create as a form, with why nothing the site has will do, or place a form the site already has by its id.',
      )
    })
  })
})

describe('validateAiBuildPlan', () => {
  it('passes a plan that reuses the site’s layout for one fresh screen', () => {
    expect(validateAiBuildPlan(planOf(), INVENTORY)).toEqual([])
  })

  it('reports every rule a plan breaks, in rule order', () => {
    const found = validateAiBuildPlan(
      planOf({
        reuse: [{ kind: 'component', id: 'cmp-missing', purpose: 'cards' }],
        screens: [
          screen({
            title: 'Lorem ipsum',
            layout: null,
            slug: 'Bad Slug',
            sections: [{ name: 'price grid', uses: ['tpl-service', 'new:Price tile'], items: 9 }],
          }),
        ],
      }),
      INVENTORY,
    )
    expect(found.map((violation) => violation.rule)).toEqual([1, 2, 4, 7, 7, 8, 10, 14])
  })

  it('holds a plan to what its job may create, and to the inline doctrine where the workspace keeps no reusable components (AGL-3030)', () => {
    const free = planOf({
      create: [{ kind: 'component', name: 'Price tier', why: 'Tiers repeat.', duplicateOf: null, fields: [] }],
      screens: [
        screen({
          sections: [
            { name: 'price tiers', uses: [], items: 4 },
            { name: 'contact form', uses: [], items: 0 },
          ],
        }),
      ],
    })
    expect(validateAiBuildPlan(free, INVENTORY, null, FREE).map((violation) => violation.code)).toEqual([
      'plan-create-not-allowed',
    ])
    expect(validateAiBuildPlan(free, INVENTORY).map((violation) => violation.code)).toEqual([
      'plan-repeated-items',
      'plan-form-not-placed',
    ])
  })
})
