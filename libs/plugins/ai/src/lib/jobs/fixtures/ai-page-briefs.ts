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

import type { AiBuildPlan, AiBuildPlanReuse, AiBuildPlanSection } from '../../model/ai-build-plan'
import type { AiPageType } from '../../model/ai-page-job'
import {
  emptyAiSiteInventory,
  type AiInventoryComponent,
  type AiInventoryForm,
  type AiInventoryLayout,
  type AiInventoryScreen,
  type AiSiteInventory,
} from '../../model/ai-site-inventory'

/**
 * Ten page briefs across the ICPs, with golden answers (AGL-2907): four agency
 * client sites, three multi-brand businesses and three single small
 * businesses, over seven page types.
 *
 * GOLDEN, NOT RECORDED. Each answer is written by hand in the shape a model
 * answers a section in — the tree a `submit_section` call carries — and no
 * provider produced it. The evals replay them through the real page step,
 * plan rules, doctrine and draft writer, so they prove the step and the
 * rules, never a model's quality, and the credits they add up to are an
 * estimate from their size, labeled as one wherever it is quoted.
 *
 * Every plan is one a page job can build: one screen that places what its
 * site already has — components by id, forms by id, links to its screens —
 * and creates nothing. Rows that repeat are a component the site keeps, as
 * the plan rules require. Copy leaves every fact a brief would not give in
 * square brackets, as the building rules ask a model to.
 */

/** One node as a model writes it: its own id is the key it sits under. */
export interface AiGoldenNode {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
  /**
   * A repeated item written once (AGL-3053): each copy's values, in the order
   * of the `{{1}}`, `{{2}}` placeholders its subtree carries.
   */
  repeat?: string[][]
}

/** A section as the model answers it: the document wrapper holding one Section. */
export interface AiGoldenSection {
  rootId: string
  nodes: Record<string, AiGoldenNode>
}

export interface AiPageBriefFixture {
  id: string
  icp: 'agency' | 'multi-brand' | 'small-business'
  pageType: AiPageType
  brief: string
  inventory: AiSiteInventory
  /** The plan a member confirmed: one screen, reusing what the site has, creating nothing. */
  plan: AiBuildPlan
  /** The golden answer to each section pass, in the plan's order. */
  answers: AiGoldenSection[]
  /** The listing the golden SEO answer proposes. */
  seo: { title: string; description: string }
}

interface Built {
  answer: AiGoldenSection
  section: AiBuildPlanSection
}

type Add = (node: AiGoldenNode, id?: string) => string

function section(prefix: string, name: string, uses: string[], items: number, build: (add: Add) => AiGoldenNode): Built {
  const nodes: Record<string, AiGoldenNode> = {}
  let counter = 0
  const add: Add = (node, id) => {
    const key = id ?? `${prefix}${++counter}`
    nodes[key] = node
    return key
  }
  const root = add(build(add), `${prefix}section`)
  nodes['root'] = { componentId: 'div', nodes: [root] }
  return { answer: { rootId: 'root', nodes }, section: { name, uses, items } }
}

const typography = (variant: string, children: string, component?: string): AiGoldenNode => ({
  componentId: 'muiTypography',
  props: { variant, children, ...(component ? { component } : {}) },
})

/** A Section holding a Container holding a column Stack: the frame every golden section uses. */
function framed(add: Add, children: string[], maxWidth: string, py: number, stack: Record<string, unknown> = {}): AiGoldenNode {
  const column = add({ componentId: 'muiStack', props: { direction: 'column', ...stack }, sx: { gap: 2 }, nodes: children })
  const container = add({ componentId: 'muiContainer', props: { maxWidth }, sx: { py }, nodes: [column] })
  return { componentId: 'section', props: { element: 'section' }, nodes: [container] }
}

function hero(prefix: string, input: { name?: string; title: string; lead: string; cta?: { label: string; screenId: string }; image?: string }): Built {
  return section(prefix, input.name ?? 'hero', input.cta ? [input.cta.screenId] : [], 0, (add) => {
    const children = [add(typography('h1', input.title, 'h1')), add(typography('body1', input.lead))]
    if (input.cta) {
      children.push(add({ componentId: 'muiButton', props: { children: input.cta.label, variant: 'contained', screenId: input.cta.screenId } }))
    }
    if (input.image) children.push(add({ componentId: 'image', props: { alt: input.image } }))
    return framed(add, children, 'md', 8, { alignItems: 'flex-start' })
  })
}

/**
 * The size each item of a golden row takes (AGL-3055): full width on a phone,
 * two across from sm where four or more share the row, and two, three or four
 * across from md, as the stored string the Grid renderer reads.
 */
function span(items: number): string {
  if (items <= 2) return 'xs:12 md:6'
  if (items === 3) return 'xs:12 md:4'
  return items === 4 ? 'xs:12 sm:6 md:3' : 'xs:12 sm:6 md:4'
}

/** A Grid item of a row of `items`, holding one element. */
function cell(add: Add, items: number, child: string, repeat?: string[][]): string {
  return add({ componentId: 'muiGrid', props: { size: span(items) }, nodes: [child], ...(repeat ? { repeat } : {}) })
}

/** A row of Grid items: a Grid container spaced by its own spacing (AGL-3055). */
function row(add: Add, cells: string[]): string {
  return add({ componentId: 'muiGrid', props: { container: true, spacing: 3 }, nodes: cells })
}

function cards(prefix: string, input: { name: string; heading: string; intro?: string; componentId: string; items: Array<Record<string, string>> }): Built {
  return section(prefix, input.name, [input.componentId], input.items.length, (add) => {
    const cells = input.items.map((propValues) =>
      cell(add, input.items.length, add({ componentId: 'reusableInstance', props: { refId: input.componentId, propValues } })),
    )
    const children = [add(typography('h2', input.heading, 'h2'))]
    if (input.intro) children.push(add(typography('body1', input.intro)))
    children.push(row(add, cells))
    return framed(add, children, 'lg', 8)
  })
}

/** A short list: fewer rows than the plan rules count as repeated items. */
function list(prefix: string, input: { name: string; heading: string; items: Array<{ primary: string; secondary?: string }> }): Built {
  return section(prefix, input.name, [], input.items.length, (add) => {
    const rows = input.items.map((item) =>
      add({
        componentId: 'muiListItem',
        nodes: [add({ componentId: 'muiListItemText', props: { primary: item.primary, ...(item.secondary ? { secondary: item.secondary } : {}) } })],
      }),
    )
    return framed(add, [add(typography('h2', input.heading, 'h2')), add({ componentId: 'muiList', props: { dense: false }, nodes: rows })], 'md', 6)
  })
}

function prose(prefix: string, input: { name: string; heading: string; paragraphs: string[] }): Built {
  return section(prefix, input.name, [], 0, (add) =>
    framed(add, [add(typography('h2', input.heading, 'h2')), ...input.paragraphs.map((copy) => add(typography('body1', copy)))], 'md', 6),
  )
}

function form(prefix: string, input: { name: string; heading: string; intro: string; formId: string }): Built {
  return section(prefix, input.name, [input.formId], 0, (add) =>
    framed(
      add,
      [add(typography('h2', input.heading, 'h2')), add(typography('body1', input.intro)), add({ componentId: 'form', props: { formId: input.formId } })],
      'sm',
      8,
    ),
  )
}

/**
 * Items drawn where they repeat, each a Card: what a workspace that keeps no
 * reusable components builds instead of placing a component (AGL-3030).
 */
function inlineCards(prefix: string, input: { name: string; heading: string; items: Array<{ title: string; summary: string }> }): Built {
  return section(prefix, input.name, [], input.items.length, (add) => {
    const cells = input.items.map((item) =>
      cell(
        add,
        input.items.length,
        add({
          componentId: 'muiCard',
          props: { variant: 'outlined' },
          nodes: [add({ componentId: 'muiCardContent', nodes: [add(typography('h3', item.title, 'h3')), add(typography('body2', item.summary))] })],
        }),
      ),
    )
    return framed(add, [add(typography('h2', input.heading, 'h2')), row(add, cells)], 'lg', 8)
  })
}

/**
 * The same cards written once (AGL-3053): one Grid item holding a Card whose
 * title is `{{1}}` and whose summary is `{{2}}`, with every card's pair listed
 * on the item, which the section check draws into exactly the cells
 * `inlineCards` writes out.
 */
function inlineCardsOnce(prefix: string, input: { name: string; heading: string; items: Array<{ title: string; summary: string }> }): Built {
  return section(prefix, input.name, [], input.items.length, (add) => {
    const item = cell(
      add,
      input.items.length,
      add({
        componentId: 'muiCard',
        props: { variant: 'outlined' },
        nodes: [add({ componentId: 'muiCardContent', nodes: [add(typography('h3', '{{1}}', 'h3')), add(typography('body2', '{{2}}'))] })],
      }),
      input.items.map((entry) => [entry.title, entry.summary]),
    )
    return framed(add, [add(typography('h2', input.heading, 'h2')), row(add, [item])], 'lg', 8)
  })
}

/**
 * A form the page carries itself: a Form with no formId, holding its Form
 * Fields — what a workspace that keeps no saved forms builds instead of
 * placing one (AGL-3030). The site's submit route collects it by its name.
 */
function inlineForm(
  prefix: string,
  input: {
    name: string
    heading: string
    intro: string
    formName: string
    submitLabel: string
    fields: Array<{ fieldName: string; label: string; fieldType: string; required?: boolean }>
  },
): Built {
  return section(prefix, input.name, [], 0, (add) =>
    framed(
      add,
      [
        add(typography('h2', input.heading, 'h2')),
        add(typography('body1', input.intro)),
        add({
          componentId: 'form',
          props: { formName: input.formName, submitLabel: input.submitLabel },
          nodes: input.fields.map((field) => add({ componentId: 'formField', props: { ...field } })),
        }),
      ],
      'sm',
      8,
    ),
  )
}

function callToAction(prefix: string, input: { name: string; heading: string; body: string; label: string; screenId: string }): Built {
  return section(prefix, input.name, [input.screenId], 0, (add) =>
    framed(
      add,
      [
        add(typography('h2', input.heading, 'h2')),
        add(typography('body1', input.body)),
        add({ componentId: 'muiButton', props: { children: input.label, variant: 'contained', screenId: input.screenId } }),
      ],
      'md',
      8,
      { alignItems: 'center' },
    ),
  )
}

const THEME = { summary: ['Light scheme with the theme’s default type'], colors: { 'primary.main': '#1f5fa8', 'secondary.main': '#c2410c' }, fonts: ['Inter'] }
const SITE_LAYOUT: AiInventoryLayout = { id: 'lay-site', name: 'Site layout', parentId: null }
const HOME: AiInventoryScreen = { id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }

function site(
  hostId: string,
  parts: {
    components?: AiInventoryComponent[]
    forms?: AiInventoryForm[]
    layouts?: AiInventoryLayout[]
    screens?: AiInventoryScreen[]
  },
): AiSiteInventory {
  return {
    ...emptyAiSiteInventory(hostId),
    components: parts.components ?? [],
    forms: parts.forms ?? [],
    layouts: parts.layouts ?? [SITE_LAYOUT],
    screens: [HOME, ...(parts.screens ?? [])],
    theme: THEME,
  }
}

function brief(input: {
  id: string
  icp: AiPageBriefFixture['icp']
  pageType: AiPageType
  brief: string
  inventory: AiSiteInventory
  title: string
  slug: string
  layout: string
  nav: boolean
  seo: { title: string; description: string }
  sections: Built[]
}): AiPageBriefFixture {
  const components = new Set(input.inventory.components.map((row) => row.id))
  const forms = new Set(input.inventory.forms.map((row) => row.id))
  const screens = new Set(input.inventory.screens.map((row) => row.id))
  const reuse: AiBuildPlanReuse[] = [{ kind: 'layout', id: input.layout, purpose: 'the page renders inside it' }]
  const seen = new Set<string>([input.layout])
  for (const { section: planned } of input.sections) {
    for (const ref of planned.uses) {
      if (seen.has(ref)) continue
      seen.add(ref)
      if (components.has(ref)) reuse.push({ kind: 'component', id: ref, purpose: planned.name })
      else if (forms.has(ref)) reuse.push({ kind: 'form', id: ref, purpose: planned.name })
      else if (screens.has(ref)) reuse.push({ kind: 'screen', id: ref, purpose: `linked from ${planned.name}` })
    }
  }
  return {
    id: input.id,
    icp: input.icp,
    pageType: input.pageType,
    brief: input.brief,
    inventory: input.inventory,
    plan: {
      reuse,
      create: [],
      screens: [
        {
          title: input.title,
          slug: input.slug,
          layout: input.layout,
          template: null,
          duplicateOf: null,
          nav: input.nav,
          seoTitle: input.seo.title,
          seoDescription: input.seo.description,
          sections: input.sections.map((entry) => entry.section),
        },
      ],
    },
    answers: input.sections.map((entry) => entry.answer),
    seo: input.seo,
  }
}

export const AI_PAGE_BRIEF_FIXTURES: readonly AiPageBriefFixture[] = [
  // ── Agency client sites ─────────────────────────────────────────────────
  brief({
    id: 'agency-roofing-landing',
    icp: 'agency',
    pageType: 'landing',
    brief: 'A landing page for our spring roof inspection offer in Springfield: what the inspection covers, two customer quotes, and the quote request form.',
    inventory: site('host-acme-roofing', {
      components: [
        { id: 'cmp-service-card', name: 'Service card', props: { title: 'text', summary: 'text' } },
        { id: 'cmp-testimonial', name: 'Testimonial', props: { quote: 'text', name: 'text', role: 'text' } },
      ],
      forms: [{ id: 'frm-quote', name: 'Quote request', fields: ['name', 'email', 'phone', 'message'] }],
      screens: [{ id: 'scr-contact', name: 'Contact', slug: 'contact', layoutId: 'lay-site', template: false }],
    }),
    title: 'Spring roof inspections',
    slug: '/spring-roof-inspection',
    layout: 'lay-site',
    nav: false,
    seo: {
      title: 'Spring Roof Inspections in Springfield',
      description: 'A licensed roofer checks shingles, flashing and gutters, then sends photos and a written report within two days.',
    },
    sections: [
      hero('a', {
        title: 'Spring roof inspections in Springfield',
        lead: 'A licensed roofer checks shingles, flashing and gutters, and sends you photos and a written report within two days.',
        cta: { label: 'Request a quote', screenId: 'scr-contact' },
        image: 'A roofer inspecting shingles on a two-story house',
      }),
      cards('b', {
        name: 'what the inspection covers',
        heading: 'What the inspection covers',
        componentId: 'cmp-service-card',
        items: [
          { title: 'Shingles and flashing', summary: 'Lifted, cracked or missing shingles, and the seals around chimneys and vents.' },
          { title: 'Gutters and drainage', summary: 'Clogs, sagging runs and downspouts that send water toward the foundation.' },
          { title: 'Attic and ventilation', summary: 'Signs of leaks, damp insulation and blocked soffit vents.' },
        ],
      }),
      cards('c', {
        name: 'customer quotes',
        heading: 'What homeowners say',
        componentId: 'cmp-testimonial',
        items: [
          { quote: 'They found a failed vent boot before it leaked into the bedroom.', name: '[customer name]', role: 'Homeowner, Springfield' },
          { quote: 'The report had photos of every problem and a price for each fix.', name: '[customer name]', role: 'Homeowner, Riverton' },
        ],
      }),
      form('d', {
        name: 'quote request form',
        heading: 'Book your inspection',
        intro: 'Tell us about your roof and when you are home. We confirm a time within one business day.',
        formId: 'frm-quote',
      }),
    ],
  }),
  brief({
    id: 'agency-dental-implants-service',
    icp: 'agency',
    pageType: 'service',
    brief: 'A service page for dental implants: how treatment works step by step, our two implant dentists, and the appointment request form.',
    inventory: site('host-lakeside-dental', {
      components: [
        { id: 'cmp-dentist-card', name: 'Dentist card', props: { name: 'text', credentials: 'text', bio: 'text' } },
        { id: 'cmp-treatment-step', name: 'Treatment step', props: { step: 'text', detail: 'text' } },
      ],
      forms: [{ id: 'frm-appointment', name: 'Appointment request', fields: ['name', 'email', 'phone', 'preferred time'] }],
    }),
    title: 'Dental implants',
    slug: '/dental-implants',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'Dental Implants at Lakeside Dental',
      description: 'Permanent tooth replacement placed and restored in one office, from the first 3D scan to the final crown.',
    },
    sections: [
      hero('a', {
        title: 'Dental implants at Lakeside Dental',
        lead: 'A permanent tooth replacement placed and restored in one office, from the first scan to the final crown.',
        image: 'A dentist showing a patient an implant model',
      }),
      cards('b', {
        name: 'how treatment works',
        heading: 'How treatment works',
        componentId: 'cmp-treatment-step',
        items: [
          { step: 'Consultation and 3D scan', detail: 'We check bone density and plan the implant position.' },
          { step: 'Implant placement', detail: 'A short procedure under local anesthetic.' },
          { step: 'Healing', detail: 'Usually three to six months while the implant bonds with the bone.' },
          { step: 'Crown fitting', detail: 'A custom crown matched to your natural teeth.' },
        ],
      }),
      cards('c', {
        name: 'implant dentists',
        heading: 'Your implant team',
        componentId: 'cmp-dentist-card',
        items: [
          { name: '[dentist name]', credentials: 'DDS, implant fellowship', bio: 'Places and restores implants in the same office.' },
          { name: '[dentist name]', credentials: 'DMD, prosthodontist', bio: 'Designs crowns, bridges and full-arch restorations.' },
        ],
      }),
      form('d', {
        name: 'appointment request form',
        heading: 'Ask for a consultation',
        intro: 'Send a few details and we call you to find a time. Bring any X-rays you already have.',
        formId: 'frm-appointment',
      }),
    ],
  }),
  brief({
    id: 'agency-law-firm-about',
    icp: 'agency',
    pageType: 'about',
    brief: 'An about page for a family law firm: how the firm works with clients, the three attorneys and what each practices, and a link to book a consultation.',
    inventory: site('host-hart-law', {
      components: [{ id: 'cmp-attorney-card', name: 'Attorney card', props: { name: 'text', practice: 'text' } }],
      screens: [{ id: 'scr-contact', name: 'Contact', slug: 'contact', layoutId: 'lay-site', template: false }],
    }),
    title: 'About the firm',
    slug: '/about',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'About Hart & Owens Family Law',
      description: 'A family law practice in Marion County. One attorney from first meeting to final order, and a written estimate before filing.',
    },
    sections: [
      hero('a', {
        title: 'About Hart & Owens',
        lead: 'A family law practice that has represented parents and spouses in Marion County since [founding year].',
      }),
      prose('b', {
        name: 'how we work',
        heading: 'How we work',
        paragraphs: [
          'Every client works with one attorney from the first meeting to the final order, and gets a written estimate before any filing.',
          'We settle when settlement protects you, and we go to trial when it does not.',
        ],
      }),
      cards('c', {
        name: 'attorneys',
        heading: 'Our attorneys',
        componentId: 'cmp-attorney-card',
        items: [
          { name: '[attorney name]', practice: 'Divorce and property division' },
          { name: '[attorney name]', practice: 'Custody and parenting plans' },
          { name: '[attorney name]', practice: 'Adoption and guardianship' },
        ],
      }),
      callToAction('d', {
        name: 'book a consultation',
        heading: 'Talk to an attorney',
        body: 'The first consultation covers your situation, your options and what each would cost.',
        label: 'Schedule a consultation',
        screenId: 'scr-contact',
      }),
    ],
  }),
  brief({
    id: 'agency-hvac-pricing',
    icp: 'agency',
    pageType: 'pricing',
    brief: 'A pricing page for heating and cooling maintenance plans: the three plans, what every visit includes, and a button to schedule service.',
    inventory: site('host-northside-hvac', {
      components: [
        { id: 'cmp-plan-card', name: 'Plan card', props: { name: 'text', price: 'text', summary: 'text' } },
        { id: 'cmp-checklist-item', name: 'Checklist item', props: { item: 'text' } },
      ],
      screens: [{ id: 'scr-schedule', name: 'Schedule service', slug: 'schedule', layoutId: 'lay-site', template: false }],
    }),
    title: 'Maintenance plans',
    slug: '/maintenance-plans',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'Heating and Cooling Maintenance Plans',
      description: 'Two tune-ups a year, priority scheduling and a repair discount for one yearly price. Plans for one system or the whole home.',
    },
    sections: [
      hero('a', {
        title: 'Heating and cooling maintenance plans',
        lead: 'Two tune-ups a year, priority scheduling and a discount on repairs, for one flat yearly price.',
      }),
      cards('b', {
        name: 'plans',
        heading: 'Choose a plan',
        componentId: 'cmp-plan-card',
        items: [
          { name: 'Single system', price: '[price] a year', summary: 'One furnace or one air conditioner.' },
          { name: 'Whole home', price: '[price] a year', summary: 'A furnace and an air conditioner.' },
          { name: 'Multi-zone', price: '[price] a year', summary: 'Up to three systems at one address.' },
        ],
      }),
      cards('c', {
        name: 'what every visit includes',
        heading: 'Every visit includes',
        componentId: 'cmp-checklist-item',
        items: [
          { item: 'Filter change and coil cleaning' },
          { item: 'Refrigerant and pressure checks' },
          { item: 'A written report on the system’s condition' },
        ],
      }),
      callToAction('d', {
        name: 'schedule service',
        heading: 'Start with a tune-up',
        body: 'Pick a time and we sign you up at the visit.',
        label: 'Schedule service',
        screenId: 'scr-schedule',
      }),
    ],
  }),
  // ── Multi-brand businesses ──────────────────────────────────────────────
  brief({
    id: 'multibrand-restaurant-group-event',
    icp: 'multi-brand',
    pageType: 'event',
    brief: 'An event page for the Piedmont wine dinner at Osteria Lume, one of our group’s restaurants: the courses and pairings, a note about the winemaker, and the reservation form.',
    inventory: site('host-harbor-group-osteria', {
      components: [{ id: 'cmp-menu-item', name: 'Menu item', props: { dish: 'text', pairing: 'text' } }],
      layouts: [
        { id: 'lay-osteria', name: 'Osteria layout', parentId: null },
        { id: 'lay-grill', name: 'Harbor Grill layout', parentId: null },
      ],
      forms: [{ id: 'frm-reservation', name: 'Event reservation', fields: ['name', 'email', 'party size'] }],
      screens: [{ id: 'scr-menu', name: 'Menu', slug: 'menu', layoutId: 'lay-osteria', template: false }],
    }),
    title: 'Piedmont wine dinner',
    slug: '/events/piedmont-wine-dinner',
    layout: 'lay-osteria',
    nav: false,
    seo: {
      title: 'Piedmont Wine Dinner at Osteria Lume',
      description: 'Five courses paired with wines from one family vineyard, with a tasting led by the winemaker. Reserve seats online.',
    },
    sections: [
      hero('a', {
        title: 'Piedmont wine dinner at Osteria Lume',
        lead: 'Five courses paired with wines from one family vineyard, on [event date] at 7 p.m.',
        image: 'A long table set for dinner with wine glasses',
      }),
      cards('b', {
        name: 'courses and pairings',
        heading: 'The menu',
        componentId: 'cmp-menu-item',
        items: [
          { dish: 'Vitello tonnato', pairing: 'Paired with Arneis' },
          { dish: 'Agnolotti del plin', pairing: 'Paired with Dolcetto' },
          { dish: 'Braised short rib', pairing: 'Paired with Barbaresco' },
          { dish: 'Hazelnut torte', pairing: 'Paired with Moscato d’Asti' },
        ],
      }),
      prose('c', {
        name: 'about the winemaker',
        heading: 'About the winemaker',
        paragraphs: ['The vineyard’s third-generation winemaker leads a short tasting before the first course and answers questions at each table.'],
      }),
      form('d', {
        name: 'reservation form',
        heading: 'Reserve seats',
        intro: 'Seats are limited to [number of seats]. We confirm by email and hold your table until 7:15 p.m.',
        formId: 'frm-reservation',
      }),
    ],
  }),
  brief({
    id: 'multibrand-home-goods-product',
    icp: 'multi-brand',
    pageType: 'product',
    brief: 'A product page for the Hearth cast iron skillet on the Hearth brand site: three features, two reviews from home cooks, and a link to where to buy.',
    inventory: site('host-hearth-and-grain', {
      components: [
        { id: 'cmp-feature', name: 'Feature', props: { title: 'text', body: 'text' } },
        { id: 'cmp-review', name: 'Review', props: { quote: 'text', name: 'text' } },
      ],
      layouts: [
        { id: 'lay-hearth', name: 'Hearth layout', parentId: null },
        { id: 'lay-grain', name: 'Grain layout', parentId: null },
      ],
      screens: [{ id: 'scr-stores', name: 'Where to buy', slug: 'where-to-buy', layoutId: 'lay-hearth', template: false }],
    }),
    title: 'Cast iron skillet',
    slug: '/cast-iron-skillet',
    layout: 'lay-hearth',
    nav: false,
    seo: {
      title: 'Hearth 12-Inch Cast Iron Skillet',
      description: 'A seasoned 12-inch skillet with a milled cooking surface, a thick base that holds heat and a helper handle.',
    },
    sections: [
      hero('a', {
        title: 'The Hearth cast iron skillet',
        lead: 'A 12-inch skillet with a smooth-milled cooking surface, seasoned and ready to use.',
        image: 'A cast iron skillet searing vegetables on a stovetop',
      }),
      cards('b', {
        name: 'features',
        heading: 'Why it cooks evenly',
        componentId: 'cmp-feature',
        items: [
          { title: 'Milled surface', body: 'Food releases without a thick coat of oil.' },
          { title: 'Thick base', body: 'Holds heat when cold food hits the pan.' },
          { title: 'Helper handle', body: 'A second grip for lifting a full pan.' },
        ],
      }),
      cards('c', {
        name: 'reviews',
        heading: 'From home cooks',
        componentId: 'cmp-review',
        items: [
          { quote: 'Eggs slide right off after a week of use.', name: '[reviewer name]' },
          { quote: 'Heavy, but it holds a sear better than anything I own.', name: '[reviewer name]' },
        ],
      }),
      callToAction('d', {
        name: 'where to buy',
        heading: 'Find it near you',
        body: 'Hearth skillets are sold in kitchen stores and online.',
        label: 'Where to buy',
        screenId: 'scr-stores',
      }),
    ],
  }),
  brief({
    id: 'multibrand-fitness-studios-pricing',
    icp: 'multi-brand',
    pageType: 'pricing',
    brief: 'A pricing page for Pulse Cycle memberships across all Pulse Cycle studios: the three memberships, the questions riders ask most, and the free class form.',
    inventory: site('host-pulse-studios-cycle', {
      components: [
        { id: 'cmp-plan-card', name: 'Membership card', props: { name: 'text', price: 'text', summary: 'text' } },
        { id: 'cmp-faq-item', name: 'FAQ item', props: { question: 'text', answer: 'text' } },
      ],
      layouts: [
        { id: 'lay-cycle', name: 'Pulse Cycle layout', parentId: null },
        { id: 'lay-yoga', name: 'Pulse Yoga layout', parentId: null },
      ],
      forms: [{ id: 'frm-trial', name: 'Free class', fields: ['name', 'email', 'studio'] }],
    }),
    title: 'Memberships',
    slug: '/memberships',
    layout: 'lay-cycle',
    nav: true,
    seo: {
      title: 'Pulse Cycle Memberships',
      description: 'Ride at any Pulse Cycle studio with a monthly membership or a class pack. Every membership starts with a free class.',
    },
    sections: [
      hero('a', {
        title: 'Pulse Cycle memberships',
        lead: 'Ride at any Pulse Cycle studio. Every membership starts with a free class.',
      }),
      cards('b', {
        name: 'memberships',
        heading: 'Memberships',
        componentId: 'cmp-plan-card',
        items: [
          { name: 'Four classes', price: '[price] a month', summary: 'Four rides a month, booked up to a week ahead.' },
          { name: 'Unlimited', price: '[price] a month', summary: 'Ride as often as you like, booked two weeks ahead.' },
          { name: 'Class pack', price: '[price] for ten', summary: 'Ten rides to use within three months.' },
        ],
      }),
      cards('c', {
        name: 'questions riders ask',
        heading: 'Questions riders ask',
        componentId: 'cmp-faq-item',
        items: [
          { question: 'Can I pause my membership?', answer: 'Yes, for up to two months a year.' },
          { question: 'Do I need cycling shoes?', answer: 'No. Every studio lends shoes at no charge.' },
          { question: 'Can I ride at another studio?', answer: 'Yes, at every Pulse Cycle location.' },
        ],
      }),
      form('d', {
        name: 'free class form',
        heading: 'Book a free class',
        intro: 'Choose your studio and we send the schedule for the week.',
        formId: 'frm-trial',
      }),
    ],
  }),
  // ── Single small businesses ─────────────────────────────────────────────
  brief({
    id: 'smallbiz-bakery-contact',
    icp: 'small-business',
    pageType: 'contact',
    brief: 'A contact page for our bakery with the opening hours and the contact form for custom cake and wholesale questions.',
    inventory: site('host-corner-bakery', {
      forms: [{ id: 'frm-contact', name: 'Contact', fields: ['name', 'email', 'message'] }],
    }),
    title: 'Contact',
    slug: '/contact',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'Visit or Contact the Bakery',
      description: 'Opening hours for the bakery, and a form for custom cake and wholesale questions. We answer within a day.',
    },
    sections: [
      hero('a', { title: 'Visit or call the bakery', lead: 'Fresh bread from 7 a.m., six days a week, at [street address].' }),
      prose('b', {
        name: 'opening hours',
        heading: 'Opening hours',
        paragraphs: [
          'Open Tuesday to Friday from 7 a.m. to 3 p.m., and Saturday and Sunday from 8 a.m. to 2 p.m. Closed on Mondays.',
        ],
      }),
      form('c', {
        name: 'contact form',
        heading: 'Send us a message',
        intro: 'Ask about custom cakes and wholesale orders. We answer within a day.',
        formId: 'frm-contact',
      }),
    ],
  }),
  brief({
    id: 'smallbiz-yoga-teacher-about',
    icp: 'small-business',
    pageType: 'about',
    brief: 'An about page for my yoga teaching: why I teach, my training, and a link to the class schedule.',
    inventory: site('host-maya-yoga', {
      screens: [{ id: 'scr-classes', name: 'Classes', slug: 'classes', layoutId: 'lay-site', template: false }],
    }),
    title: 'About',
    slug: '/about',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'About Maya: Slow Flow and Restorative Yoga',
      description: 'Small-group slow flow and restorative yoga classes under twelve students, with room for questions in every class.',
    },
    sections: [
      hero('a', {
        title: 'About Maya',
        lead: 'I teach slow flow and restorative yoga in small groups, with room for questions in every class.',
        image: 'A yoga teacher guiding a small class in a sunlit studio',
      }),
      prose('b', {
        name: 'why I teach',
        heading: 'Why I teach',
        paragraphs: [
          'I started yoga to recover from a running injury, and kept practicing because it made the rest of my week calmer.',
          'My classes stay under twelve students, so I can offer a change for each body in the room.',
        ],
      }),
      list('c', {
        name: 'training',
        heading: 'Training',
        items: [
          { primary: '500-hour yoga teacher training', secondary: '[school name]' },
          { primary: 'Restorative yoga certificate', secondary: '[school name]' },
        ],
      }),
      callToAction('d', {
        name: 'class schedule',
        heading: 'Come to a class',
        body: 'New students can try any class at the drop-in rate.',
        label: 'See the schedule',
        screenId: 'scr-classes',
      }),
    ],
  }),
  brief({
    id: 'smallbiz-bike-repair-service',
    icp: 'small-business',
    pageType: 'service',
    brief: 'A service page for bike tune-ups and repairs: the three tune-up levels, how long repairs take, and the drop-off booking form.',
    inventory: site('host-spoke-bike-repair', {
      components: [{ id: 'cmp-service-item', name: 'Service item', props: { name: 'text', detail: 'text' } }],
      forms: [{ id: 'frm-booking', name: 'Repair booking', fields: ['name', 'email', 'bike type', 'drop-off day'] }],
    }),
    title: 'Tune-ups and repairs',
    slug: '/repairs',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'Bike Tune-Ups and Repairs',
      description: 'Drop off your bike any weekday morning. Three tune-up levels, most ready the next day, with a call before any extra cost.',
    },
    sections: [
      hero('a', {
        title: 'Bike tune-ups and repairs',
        lead: 'Drop off your bike any weekday morning and pick it up ready to ride, most often the next day.',
      }),
      cards('b', {
        name: 'tune-up levels',
        heading: 'Tune-up levels',
        componentId: 'cmp-service-item',
        items: [
          { name: 'Safety check', detail: 'Brakes, tires and a full bolt check. [price]' },
          { name: 'Standard tune-up', detail: 'Adds gear and brake adjustment and wheel truing. [price]' },
          { name: 'Overhaul', detail: 'Adds a full strip-down, cleaning and new cables. [price]' },
        ],
      }),
      prose('c', {
        name: 'how long repairs take',
        heading: 'How long it takes',
        paragraphs: ['Most tune-ups are ready the next day. We call before any repair that costs more than the estimate.'],
      }),
      form('d', {
        name: 'drop-off booking form',
        heading: 'Book a drop-off',
        intro: 'Tell us about the bike and the day you can bring it in.',
        formId: 'frm-booking',
      }),
    ],
  }),
]

/**
 * A page brief for a workspace that keeps no reusable components, answered the
 * way such a workspace answers (AGL-3053): every repeated item written once
 * with its copies' values listed. `writtenOut` is the same page with every
 * repeated item written out card by card — the control, which the section
 * check draws the golden answers into, node for node apart from ids.
 */
export interface AiFreePageFixture extends AiPageBriefFixture {
  /** The golden answers, in the plan's order, with every repeated item written out in full. */
  writtenOut: AiGoldenSection[]
}

type PracticeAreas = { name: string; heading: string; items: Array<{ title: string; summary: string }> }

/** A Free page brief whose card sections are written once, with the page written out in full beside it. */
function freeBrief(input: Omit<Parameters<typeof brief>[0], 'sections'> & { sections: Array<Built | { once: Built; full: Built }> }): AiFreePageFixture {
  const once = input.sections.map((entry) => ('once' in entry ? entry.once : entry))
  const full = input.sections.map((entry) => ('full' in entry ? entry.full : entry))
  return { ...brief({ ...input, sections: once }), writtenOut: full.map((entry) => entry.answer) }
}

/** A section of cards, written once and written out. */
function repeatedCards(prefix: string, input: PracticeAreas): { once: Built; full: Built } {
  return { once: inlineCardsOnce(prefix, input), full: inlineCards(prefix, input) }
}

/**
 * A page brief for a Free workspace (AGL-3030): a site that keeps no reusable
 * components and no saved forms, with the one layout its plan includes. Its
 * practice areas repeat and its consultation request is a form, so the page
 * is built the one way such a workspace can build it — the cards drawn where
 * they repeat, written once in the answer (AGL-3053), and the form carried by
 * the page with its fields inside it. The plan the page job keeps for it is
 * held to the Free workspace's capabilities, never the whole doctrine.
 */
export const AI_FREE_PAGE_FIXTURE: AiFreePageFixture = freeBrief({
  id: 'free-law-firm-about',
  icp: 'small-business',
  pageType: 'about',
  brief: 'An about page for Brightwater Law: who we are, the four areas we practice, how we work with clients, and a form to request a consultation.',
  inventory: site('host-brightwater-law', {}),
  title: 'About Brightwater Law',
  slug: '/about',
  layout: 'lay-site',
  nav: true,
  seo: {
    title: 'About Brightwater Law',
    description: 'A small firm for families and small businesses: estate planning, real estate, business formation and landlord-tenant matters.',
  },
  sections: [
    hero('a', {
      title: 'About Brightwater Law',
      lead: 'We are a small firm that helps families and small businesses in [city] plan ahead and settle disputes before they reach a courtroom.',
    }),
    repeatedCards('b', {
      name: 'practice areas',
      heading: 'What we help with',
      items: [
        { title: 'Estate planning', summary: 'Wills, trusts and powers of attorney, written so your family knows what you wanted.' },
        { title: 'Real estate', summary: 'Purchase agreements, title questions and closings for homes and small commercial property.' },
        { title: 'Business formation', summary: 'Choosing an entity, operating agreements and the contracts a new business signs first.' },
        { title: 'Landlord and tenant', summary: 'Leases, deposits and notices, for owners with a few units and the people who rent from them.' },
      ],
    }),
    prose('c', {
      name: 'how we work',
      heading: 'How we work with you',
      paragraphs: [
        'Your first call is with the attorney who will handle the matter. We quote a flat fee where the work allows one, and we say so before we start when it does not.',
      ],
    }),
    inlineForm('d', {
      name: 'consultation request form',
      heading: 'Request a consultation',
      intro: 'Tell us a little about what you need. We reply within one business day.',
      formName: 'Consultation request',
      submitLabel: 'Request a consultation',
      fields: [
        { fieldName: 'name', label: 'Your name', fieldType: 'text', required: true },
        { fieldName: 'email', label: 'Email', fieldType: 'email', required: true },
        { fieldName: 'phone', label: 'Phone', fieldType: 'text' },
        { fieldName: 'matter', label: 'What can we help with?', fieldType: 'textarea', required: true },
      ],
    }),
  ],
})

/**
 * A Free law firm's practice areas with copy of the length a firm writes
 * (AGL-3053): four areas for families and six for businesses and property
 * owners, 25 to 29 words a summary. A live Free About page's four practice
 * areas, drawn card by card, were cut off at their pass's ceiling on their
 * answer and on their re-ask. Written once, four and six such cards each fit a
 * balanced-tier pass; written out card by card, neither does
 * (`ai-job-page-evals.spec.ts`).
 */
export const AI_FREE_PRACTICE_AREAS_FIXTURE: AiFreePageFixture = freeBrief({
  id: 'free-law-firm-practice-areas',
  icp: 'small-business',
  pageType: 'about',
  brief: 'An about page for Cedar Point Law: who we are, the four ways we help families, and the six ways we help businesses and property owners, a few sentences on each.',
  inventory: site('host-cedar-point-law', {}),
  title: 'About Cedar Point Law',
  slug: '/about',
  layout: 'lay-site',
  nav: true,
  seo: {
    title: 'About Cedar Point Law',
    description: 'A general practice for families, businesses and property owners in [county], from estate planning and probate to leases and closings.',
  },
  sections: [
    hero('a', {
      title: 'About Cedar Point Law',
      lead: 'A general practice in [town] for families, small businesses and property owners, with the same attorney answering your calls from the first meeting to the last filing.',
    }),
    repeatedCards('b', {
      name: 'four ways we help families',
      heading: 'For families',
      items: [
        { title: 'Estate planning', summary: 'Wills, revocable trusts, powers of attorney and health care directives, drafted after a conversation about your family, your property and who should decide for you if you cannot.' },
        { title: 'Divorce and custody', summary: 'Uncontested and contested divorces, parenting plans and support, with a written estimate before anything is filed and a schedule for the children that both households can follow.' },
        { title: 'Probate', summary: 'Opening probate, listing assets, paying debts and distributing property for personal representatives, with a written timeline so heirs know what happens next and about how long it takes.' },
        { title: 'Guardianship and elder law', summary: 'Guardianship and conservatorship petitions, long-term care planning and help for adult children managing a parent’s money, with meetings at home or at a care facility when travel is hard.' },
      ],
    }),
    repeatedCards('c', {
      name: 'six ways we help businesses and property owners',
      heading: 'For businesses and property owners',
      items: [
        { title: 'Business formation', summary: 'Choosing between an LLC and a corporation, operating agreements, partner buyout terms and the first contracts a new business signs with its landlord, lenders and first employees.' },
        { title: 'Contracts', summary: 'Vendor, customer and service agreements drafted or reviewed in plain language, with the payment terms, termination rights and limits on liability explained before you sign anything.' },
        { title: 'Commercial leases', summary: 'First leases and renewals for shops, offices and restaurants, including build-out allowances, personal guarantees, rent increases and what happens when the business outgrows the space.' },
        { title: 'Real estate closings', summary: 'Purchase agreements, title review, boundary questions and closings for homes, rental property and small commercial buildings, with one attorney following the file from contract to keys.' },
        { title: 'Landlord and tenant', summary: 'Leases, security deposits, repair disputes and eviction notices, for owners with a few rental units and for tenants who need to know where they stand before they answer.' },
        { title: 'Employment matters', summary: 'Offer letters, handbooks, contractor questions and separation agreements for businesses with fewer than fifty employees, written to fit the state rules that apply to them.' },
      ],
    }),
  ],
})

/**
 * A page brief whose plan creates what its site lacks (AGL-3031): a layout, a
 * reusable component and a saved form, on a Starter site that has none of
 * them. The page job builds all three first — each through the step that
 * builds its kind, answering with the golden that step's own spec holds —
 * and then the page, which places the component and binds the form by the
 * ids the job built them under, and renders inside the layout.
 *
 * Those ids are the job's own with each creation's place in the plan, so the
 * section answers name them: the component is `<jobId>-c0`, the layout
 * `<jobId>-c1` and the form `<jobId>-c2`.
 */
export interface AiPageCreationFixture extends AiPageBriefFixture {
  /** The job the page is built under, which every creation's id derives from. */
  jobId: string
  /** The layout step's golden answer: a header of screen links, the slot and a footer. */
  layout: AiGoldenSection
  /** The component step's golden, by its file under `jobs/goldens`. */
  componentGolden: string
  /** The form step's golden, by its key in `fixtures/ai-job-form-goldens.json`. */
  formGolden: string
}

const CREATION_JOB = 'job-golden-creations'

export const AI_PAGE_CREATION_FIXTURE: AiPageCreationFixture = (() => {
  const component = `${CREATION_JOB}-c0`
  const form = `${CREATION_JOB}-c2`
  const opener = hero('a', {
    title: 'Roof repair in Harbor County',
    lead: 'A local crew that finds the leak, fixes it the same week and sends you photos of the work.',
    cta: { label: 'Meet the crew', screenId: 'scr-about' },
  })
  const quotes = section('b', 'customer words', ['new:Testimonial card'], 3, (add) => {
    // The brief names no customer's role, so each card leaves it to the card's default (AGL-3056).
    const cells = [
      { quote: 'They found the leak two other companies missed.', name: '[customer name]' },
      { quote: 'On time, tidy, and the photos made the invoice easy to trust.', name: '[customer name]' },
      { quote: 'The same crew came back to check the repair after the first storm.', name: '[customer name]' },
    ].map((propValues) => cell(add, 3, add({ componentId: 'reusableInstance', props: { refId: component, propValues } })))
    return framed(add, [add(typography('h2', 'What homeowners say', 'h2')), row(add, cells)], 'lg', 8)
  })
  const request = section('c', 'quote request form', ['new:Roof quote request'], 0, (add) =>
    framed(
      add,
      [
        add(typography('h2', 'Request a quote', 'h2')),
        add(typography('body1', 'Tell us about the roof. We call back within one business day.')),
        add({ componentId: 'form', props: { formId: form } }),
      ],
      'sm',
      8,
    ),
  )
  const seo = {
    title: 'Roof Repair in Harbor County',
    description: 'Same-week roof repair from a local crew, with photos of every fix and a callback within one business day.',
  }
  return {
    id: 'agency-roofing-creations',
    icp: 'agency',
    pageType: 'service',
    brief: 'A roof repair page for Harbor Roofing: what we fix, three things customers have said, and a form to request a quote. The site is new and has no layout, cards or forms yet.',
    inventory: site('host-harbor-new', {
      layouts: [],
      screens: [{ id: 'scr-about', name: 'About', slug: 'about', layoutId: null, template: false }],
    }),
    plan: {
      reuse: [{ kind: 'screen', id: 'scr-about', purpose: 'linked from the hero' }],
      create: [
        {
          kind: 'component',
          name: 'Testimonial card',
          why: 'Three quotes share one card, and the site has no card yet.',
          duplicateOf: null,
          fields: ['quote:richText', 'name:text', 'role:text', 'photo:image'],
        },
        {
          kind: 'layout',
          name: 'Harbor Roofing site',
          why: 'The site has no layout, so every page would otherwise carry its own header and footer.',
          duplicateOf: null,
          fields: [],
        },
        {
          kind: 'form',
          name: 'Roof quote request',
          why: 'The site has no form to request a quote.',
          duplicateOf: null,
          fields: [],
        },
      ],
      screens: [
        {
          title: 'Roof repair',
          slug: '/roof-repair',
          layout: 'new:Harbor Roofing site',
          template: null,
          duplicateOf: null,
          nav: true,
          seoTitle: seo.title,
          seoDescription: seo.description,
          sections: [opener.section, quotes.section, request.section],
        },
      ],
    },
    answers: [opener.answer, quotes.answer, request.answer],
    seo,
    jobId: CREATION_JOB,
    layout: {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['header', 'slot', 'footer'] },
        header: { componentId: 'muiAppBar', props: { position: 'static', color: 'default' }, nodes: ['bar'] },
        bar: { componentId: 'muiToolbar', nodes: ['brand', 'home', 'about'] },
        brand: { componentId: 'muiTypography', props: { variant: 'h6', component: 'p', children: 'Harbor Roofing' } },
        home: { componentId: 'muiScreenLink', props: { screenId: 'scr-home', children: 'Home' } },
        about: { componentId: 'muiScreenLink', props: { screenId: 'scr-about', children: 'About' } },
        slot: { componentId: 'layoutSlot' },
        footer: { componentId: 'section', props: { element: 'footer' }, nodes: ['tagline'] },
        tagline: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Family-run roofers in Harbor County since 1998.' } },
      },
    },
    componentGolden: 'component-testimonial-card',
    formGolden: 'roofingQuote',
  }
})()

/**
 * A page whose second section introduces two people (AGL-3042): a photo, a
 * name, a role and a short bio for each, as a law firm's About page asks for
 * its attorneys, on a paid workspace whose site keeps no card for a person.
 * Two items are fewer than a component is required for, so the section draws
 * both where they stand.
 *
 * The golden answer is the drawing a section's request asks for at the
 * balanced tier's ceiling: a Card a person holding the four, in fifteen
 * elements. `roomier` is the same two people drawn the way a model reaches for
 * with more elements to spend — a grid cell, a card body and styles a person,
 * and an introduction — in twenty, inside the twenty-three a budget counted in
 * estimated tokens allows. The page's evals measure both against the ceiling.
 */
export interface AiTwoPersonPageFixture extends AiPageBriefFixture {
  /** The introduction drawn in twenty elements: a valid section, and past the ceiling in real tokens. */
  roomier: AiGoldenSection
}

const ATTORNEYS = [
  {
    photo: 'A portrait of [attorney name], the founding partner, in the firm’s office',
    name: '[attorney name]',
    role: 'Founding partner, family law',
    bio: 'Has represented parents and spouses in [county] for [years] years, and settles most cases before they reach a courtroom.',
  },
  {
    photo: 'A portrait of [attorney name] at a conference table',
    name: '[attorney name]',
    role: 'Partner, estate planning and real estate',
    bio: 'Writes wills and trusts for young families, and handles closings for homes and small commercial property.',
  },
]

export const AI_TWO_PERSON_PAGE_FIXTURE: AiTwoPersonPageFixture = (() => {
  const introduction = section('b', 'meet our attorneys', [], ATTORNEYS.length, (add) => {
    const cards = ATTORNEYS.map((person) =>
      add({
        componentId: 'muiCard',
        props: { variant: 'outlined' },
        sx: { flex: 1 },
        nodes: [
          add({ componentId: 'image', props: { alt: person.photo } }),
          add(typography('h3', person.name, 'h3')),
          add(typography('subtitle1', person.role)),
          add(typography('body2', person.bio)),
        ],
      }),
    )
    // A Grid of two would take two more elements than the fifteen the pass
    // asks for (AGL-3055); a Stack that turns from a column into a row at md
    // is the same responsive pair in none.
    return framed(
      add,
      [
        add(typography('h2', 'Meet our attorneys', 'h2')),
        add({ componentId: 'muiStack', sx: { flexDirection: { xs: 'column', md: 'row' }, gap: 3 }, nodes: cards }),
      ],
      'lg',
      8,
    )
  })
  const roomier = section('b', 'meet our attorneys', [], ATTORNEYS.length, (add) => {
    const cells = ATTORNEYS.map((person) =>
      add({
        componentId: 'muiGrid',
        props: { size: span(ATTORNEYS.length) },
        nodes: [
          add({
            componentId: 'muiCard',
            props: { variant: 'outlined' },
            sx: { height: '100%' },
            nodes: [
              add({ componentId: 'image', props: { alt: person.photo, objectFit: 'cover', loading: 'lazy' }, sx: { width: '100%' } }),
              add({
                componentId: 'muiCardContent',
                nodes: [
                  add(typography('h3', person.name, 'h3')),
                  add({ componentId: 'muiTypography', props: { variant: 'subtitle1', children: person.role }, sx: { color: 'text.secondary' } }),
                  add(typography('body2', person.bio)),
                ],
              }),
            ],
          }),
        ],
      }),
    )
    return framed(
      add,
      [
        add(typography('h2', 'Meet our attorneys', 'h2')),
        add(typography('body1', 'Two attorneys, and one of them handles your matter from the first meeting to the final order.')),
        row(add, cells),
      ],
      'lg',
      8,
    )
  })
  const fixture = brief({
    id: 'agency-law-firm-two-attorneys',
    icp: 'agency',
    pageType: 'about',
    brief: 'An about page for Harborline Law: who we are, and our two attorneys with a photo, their role and a short bio for each.',
    inventory: site('host-harborline-law', {
      screens: [{ id: 'scr-contact', name: 'Contact', slug: 'contact', layoutId: 'lay-site', template: false }],
    }),
    title: 'About Harborline Law',
    slug: '/about',
    layout: 'lay-site',
    nav: true,
    seo: {
      title: 'About Harborline Law',
      description: 'A coastal law firm for families and homeowners: family law, estate planning and real estate closings.',
    },
    sections: [
      hero('a', {
        title: 'About Harborline Law',
        lead: 'A small coastal firm for families and homeowners, in family law, estate planning and real estate closings.',
        cta: { label: 'Request a consultation', screenId: 'scr-contact' },
      }),
      introduction,
    ],
  })
  return { ...fixture, roomier: roomier.answer }
})()
