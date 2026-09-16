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
import { ESTIMATED_PAGE_TRANSFER_BYTES } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiBuildPlan, AiBuildPlanScreen } from '../model/ai-build-plan'
import {
  aiPlanCapabilitiesForJob,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import {
  AI_DOCTRINE_RULE_NUMBERS,
  AI_DOCTRINE_RULES,
  AI_TYPED_LIST_MIN_ITEMS,
  aiDoctrineViolationText,
  aiNamesMatch,
  aiTreeCopy,
  detectAdHocWidths,
  detectCreateBeforeReuse,
  detectDocumentStructure,
  detectHeavyDocument,
  detectImageSources,
  detectInlineForms,
  detectLayoutRegions,
  detectLiteralStyles,
  detectMissedDuplicate,
  detectMissingNavAndSeo,
  detectOffBrandEmail,
  detectOffVoiceCopy,
  detectOverBudget,
  detectPlanInlineForms,
  detectPlanLayoutRegions,
  detectPlanLiteralColors,
  detectPlanRepeats,
  detectPlanTypedData,
  detectPlanUncreatable,
  detectPublishIntent,
  detectRepeatedSubtrees,
  detectTypedData,
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
      'The plan creates a component named "Service card", and this workspace\'s plan does not include reusable components. Draw the item in its own section instead.',
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

describe('validateAiBuildPlan', () => {
  it('passes a plan that reuses the site’s layout for one fresh screen', () => {
    expect(validateAiBuildPlan(planOf(), INVENTORY)).toEqual([])
  })

  it('reports every rule a plan breaks, in rule order', () => {
    const found = validateAiBuildPlan(
      planOf({
        reuse: [{ kind: 'component', id: 'cmp-missing', purpose: 'cards' }],
        screens: [
          screen({ title: 'Lorem ipsum', layout: null, slug: 'Bad Slug', sections: [{ name: 'price grid', uses: [], items: 9 }] }),
        ],
      }),
      INVENTORY,
    )
    expect(found.map((violation) => violation.rule)).toEqual([1, 2, 7, 8, 10, 14])
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
