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

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  AI_BUILD_LIMITS,
  aiBuildCreditEstimate,
  aiBuildDegradation,
  aiBuildGraphProblems,
  aiBuildInitialLedger,
  aiBuildNextUnit,
  aiBuildOrder,
  aiBuildPlacedItemLines,
  aiBuildPlanMissingInput,
  aiBuildPlanShapeRefusal,
  aiBuildRetryLedger,
  aiBuildSettlement,
  aiBuildUnits,
  aiJobCreditEstimate,
  type AiBuildOps,
} from './ai-build-job'
import {
  aiPlanUndeclaredRefs,
  parseAiBuildPlan,
  withBuildItems,
  AI_BUILD_PLAN_LIMITS,
  AI_BUILD_PLAN_TOOL,
  type AiBuildItem,
  type AiBuildPlan,
  type AiBuildPlanScreen,
} from './ai-build-plan'
import { aiJobPlanLines } from './ai-job-plan-lines'
import type { AiJobItemLedger } from './ai-jobs.types'

/**
 * A build's model (AGL-3616): the units a plan implies, their order, how a
 * failure travels to what depends on it, the estimate and the ledger
 * arithmetic — the canonical request being "a few new pages, forms for
 * bookings and a contact form, then an about page".
 */

const capability = (op: string, overrides: Partial<PluginAiCapability> = {}): PluginAiCapability => ({
  op,
  noun: op.replace(/-/g, ' '),
  where: 'Somewhere',
  intents: [op],
  argsSchema: { type: 'object', properties: {}, additionalProperties: false },
  maxPerPlan: 4,
  freeAllowed: true,
  runnerKind: op,
  estimateCredits: () => 50,
  degrade: 'omit',
  ...overrides,
})

const OPS: AiBuildOps = new Map([
  ['page', capability('page')],
  ['form', capability('form')],
  ['layout', capability('layout', { degrade: 'fallback' })],
  ['email', capability('email', { freeAllowed: false })],
  ['campaign', capability('campaign', { noun: 'email campaign', freeAllowed: false })],
  [
    'booking-service',
    capability('booking-service', {
      runnerKind: undefined,
      draftResource: 'bookingService',
      pageBlocks: ['Booking'],
      argsSchema: {
        type: 'object',
        properties: { durationMinutes: { type: 'integer', description: 'Length', minimum: 5, maximum: 480 } },
        required: ['durationMinutes'],
        additionalProperties: false,
      },
      estimateCredits: () => 0,
    }),
  ],
])

function screen(title: string, slug: string, uses: string[] = [], layout: string | null = null): AiBuildPlanScreen {
  return {
    title,
    slug,
    layout,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: title,
    seoDescription: title,
    sections: [{ name: `${title} main`, uses, items: 0 }],
    record: null,
  }
}

function item(index: number, overrides: Partial<AiBuildItem>): AiBuildItem {
  return { slot: `i${index}`, op: 'booking-service', name: 'Consult', why: '', dependsOn: [], degrade: 'omit', args: { durationMinutes: 30 }, ...overrides }
}

/** The canonical request's plan: three pages, a layout reused, a contact form, a booking service. */
function canonical(): AiBuildPlan {
  return {
    reuse: [{ kind: 'layout', id: 'site-layout', purpose: 'the site’s header and footer' }],
    create: [{ kind: 'form', name: 'Contact', why: 'People write in.', duplicateOf: null, fields: ['email'] }],
    screens: [
      screen('Book', '/book', ['new:Consult'], 'site-layout'),
      screen('Contact', '/contact', ['new:Contact'], 'site-layout'),
      screen('About', '/about', [], 'site-layout'),
    ],
    items: [item(0, {})],
  }
}

const ledgerOf = (plan: AiBuildPlan, statuses: Record<string, AiJobItemLedger['status']>, outputs: Record<string, string[]> = {}) =>
  aiBuildInitialLedger(aiBuildUnits(plan)).map((row) => ({
    ...row,
    status: statuses[row.slot] ?? row.status,
    outputs: outputs[row.slot] ?? row.outputs,
  }))

describe('units and their order', () => {
  it('names a unit per creation, item and page, and builds what a page places before the page', () => {
    const units = aiBuildUnits(canonical())
    expect(units.map((unit) => [unit.slot, unit.op, unit.deps])).toEqual([
      ['c0', 'form', []],
      ['i0', 'booking-service', []],
      ['p0', 'page', ['i0']],
      ['p1', 'page', ['c0']],
      ['p2', 'page', []],
    ])
    expect(aiBuildOrder(units)?.map((unit) => unit.slot)).toEqual(['c0', 'i0', 'p0', 'p1', 'p2'])
  })

  it('sorts on dependencies, plan order otherwise', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [{ kind: 'email', name: 'Welcome', why: '', duplicateOf: null, fields: [] }],
      screens: [],
      items: [
        item(0, { op: 'campaign', name: 'Launch', dependsOn: ['new:Second'], args: {} }),
        item(1, { op: 'campaign', name: 'Second', dependsOn: ['new:Welcome'], args: {} }),
      ],
    }
    expect(aiBuildOrder(aiBuildUnits(plan))?.map((unit) => unit.slot)).toEqual(['c0', 'i1', 'i0'])
  })

  it('names a cycle and a reference nothing makes, for the plan’s one re-ask', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [],
      screens: [],
      items: [
        item(0, { name: 'A', dependsOn: ['new:B'] }),
        item(1, { name: 'B', dependsOn: ['new:A', 'new:Ghost'] }),
      ],
    }
    expect(aiBuildOrder(aiBuildUnits(plan))).toBeNull()
    expect(aiBuildGraphProblems(plan)).toEqual([
      expect.stringContaining('depends on new:Ghost, which the plan never makes'),
      expect.stringContaining('go round in a circle'),
    ])
    expect(aiBuildPlanShapeRefusal(plan)).toContain('new:Ghost')
  })
})

/*
 * Several items one block shows (AGL-3743): a section listing a bakery's
 * events uses each event, and places the Event List once. One event that
 * could not be made leaves the block in place for the others.
 */
describe('a section that places one block for several items', () => {
  const EVENT_OPS: AiBuildOps = new Map([
    ['page', capability('page')],
    [
      'event',
      capability('event', { runnerKind: undefined, draftResource: 'event', pageBlocks: ['eventList'], estimateCredits: () => 0 }),
    ],
  ])
  const plan: AiBuildPlan = {
    reuse: [],
    create: [],
    screens: [screen('Events', '/events', ['new:Sourdough workshop', 'new:Pie social', 'new:Bread tasting'])],
    items: [
      item(0, { op: 'event', name: 'Sourdough workshop', args: {} }),
      item(1, { op: 'event', name: 'Pie social', args: {} }),
      item(2, { op: 'event', name: 'Bread tasting', args: {} }),
    ],
  }
  const units = aiBuildUnits(plan)
  const page = units.find((one) => one.slot === 'p0') as (typeof units)[number]

  it('places the block once, naming every built item', () => {
    const ledger = ledgerOf(plan, { i0: 'succeeded', i1: 'succeeded', i2: 'succeeded' }, { i0: ['e0'], i1: ['e1'], i2: ['e2'] })
    expect(aiBuildPlacedItemLines(page, { units, ledger, ops: EVENT_OPS })).toEqual([
      'In the “Events main” section, place the eventList block for the events “Sourdough workshop”, “Pie social” and “Bread tasting”.',
    ])
  })

  it('keeps the block when one item failed and another was built, leaving out only the failed one', () => {
    const ledger = ledgerOf(plan, { i0: 'succeeded', i1: 'failed', i2: 'succeeded' }, { i0: ['e0'], i2: ['e2'] })
    const degradation = aiBuildDegradation(page, { units, ledger, ops: EVENT_OPS })
    expect(degradation).toMatchObject({ skip: null, degradedBy: ['i1'] })
    expect(degradation.notes).toEqual(['Built without the event “Pie social”: it could not be created.'])
    expect(degradation.briefLines).toEqual(['Leave the event “Pie social” out of the “Events main” section: it could not be created.'])
    expect(degradation.briefLines.join(' ')).not.toContain('without the eventList block')
    expect(aiBuildPlacedItemLines(page, { units, ledger, ops: EVENT_OPS })).toEqual([
      'In the “Events main” section, place the eventList block for the events “Sourdough workshop” and “Bread tasting”.',
    ])
  })

  it('takes the block out when none of its items was built', () => {
    const ledger = ledgerOf(plan, { i0: 'failed', i1: 'failed', i2: 'failed' })
    const degradation = aiBuildDegradation(page, { units, ledger, ops: EVENT_OPS })
    expect(degradation.notes).toHaveLength(3)
    expect(degradation.briefLines.every((line) => line.includes('without the eventList block'))).toBe(true)
    expect(aiBuildPlacedItemLines(page, { units, ledger, ops: EVENT_OPS })).toEqual([])
  })
})

describe('the shape a build holds', () => {
  it('admits the canonical request', () => {
    expect(aiBuildPlanShapeRefusal(canonical(), { ops: OPS })).toBeNull()
  })

  it('holds a Free workspace to two pages and to operations it may use', () => {
    expect(aiBuildPlanShapeRefusal(canonical(), { freeTaste: true, ops: OPS })).toContain('Free workspace')
    const two = { ...canonical(), screens: canonical().screens.slice(0, 2), items: [item(0, { op: 'campaign', args: {} })] }
    expect(aiBuildPlanShapeRefusal(two, { freeTaste: true, ops: OPS })).toContain('cannot have an email campaign made')
  })

  it('refuses an unknown op, arguments its schema refuses, a page or form planned as an item, and too much', () => {
    const plan = canonical()
    expect(aiBuildPlanShapeRefusal({ ...plan, items: [item(0, { op: 'teleport' })] }, { ops: OPS })).toContain('Nothing on this site can make')
    expect(aiBuildPlanShapeRefusal({ ...plan, items: [item(0, { args: { durationMinutes: 2 } })] }, { ops: OPS })).toContain('"durationMinutes" must be at least 5')
    expect(aiBuildPlanShapeRefusal({ ...plan, items: [item(0, { op: 'page' })] }, { ops: OPS })).toContain('plan it in screens')
    expect(aiBuildPlanShapeRefusal({ ...plan, items: [item(0, { op: 'form' })] }, { ops: OPS })).toContain('plan it in create')
    const many = Array.from({ length: AI_BUILD_LIMITS.pages + 1 }, (_, index) => screen(`P${index}`, `/p${index}`))
    expect(aiBuildPlanShapeRefusal({ ...plan, screens: many, items: [] })).toContain('at most 8')
    expect(aiBuildPlanShapeRefusal({ reuse: [], create: [], screens: [] })).toContain('builds nothing')
  })
})

describe('what a plan leaves out that only the person can give (AGL-3751)', () => {
  const asks = capability('tracking', {
    // Asks unless the item names an id: what a tracking change does.
    missingInput: (one) => (one.args['id'] ? null : `What is the ${one.name} id?`),
  })
  const ops: AiBuildOps = new Map([...OPS, ['tracking', asks]])
  const plan = (args: Record<string, string>[]) => ({
    ...canonical(),
    items: [...(canonical().items ?? []), ...args.map((one, index) => item(index + 1, { op: 'tracking', name: `Tag ${index}`, args: one }))],
  })

  it('asks each question an item’s operation asks, once each, and nothing when every item can be built', () => {
    expect(aiBuildPlanMissingInput(plan([{ id: 'x' }]), ops)).toBeNull()
    expect(aiBuildPlanMissingInput(plan([{}, { id: 'x' }]), ops)).toBe('What is the Tag 0 id?')
    expect(aiBuildPlanMissingInput(plan([{}, {}]), ops)).toBe('What is the Tag 0 id? What is the Tag 1 id?')
  })

  it('asks nothing of an operation with no such check, or with no operations to read', () => {
    expect(aiBuildPlanMissingInput(canonical(), OPS)).toBeNull()
    expect(aiBuildPlanMissingInput(plan([{}]), null)).toBeNull()
  })

  it('is not a shape problem the plan is re-asked about', () => {
    expect(aiBuildPlanShapeRefusal(plan([{}]), { ops })).toBeNull()
  })
})

describe('what a failure does to what depends on it', () => {
  const plan = canonical()
  const units = aiBuildUnits(plan)
  const unit = (slot: string) => units.find((one) => one.slot === slot) as (typeof units)[number]

  it('a failed booking service takes the Booking block out of its page, with a note', () => {
    const ledger = ledgerOf(plan, { c0: 'succeeded', i0: 'failed' })
    const degradation = aiBuildDegradation(unit('p0'), { units, ledger, ops: OPS })
    expect(degradation).toMatchObject({ skip: null, degradedBy: ['i0'] })
    expect(degradation.notes[0]).toBe('Built without the Booking block: the booking service “Consult” could not be created.')
    expect(degradation.briefLines[0]).toContain('without the Booking block')
    expect(aiBuildPlacedItemLines(unit('p0'), { units, ledger, ops: OPS })).toEqual([])
  })

  it('a built booking service tells its page to place the Booking block', () => {
    const ledger = ledgerOf(plan, { i0: 'succeeded' }, { i0: ['svc-1'] })
    expect(aiBuildPlacedItemLines(unit('p0'), { units, ledger, ops: OPS })).toEqual([
      'In the “Book main” section, place the Booking block for the booking service “Consult”.',
    ])
  })

  it('a failed form leaves the page without it; a page with no failed dependency is untouched', () => {
    const ledger = ledgerOf(plan, { c0: 'failed' })
    expect(aiBuildDegradation(unit('p1'), { units, ledger, ops: OPS })).toMatchObject({
      degradedBy: ['c0'],
      notes: ['Built without the form: the form “Contact” could not be created.'],
    })
    expect(aiBuildDegradation(unit('p2'), { units, ledger, ops: OPS }).degradedBy).toEqual([])
  })

  it('a failed layout falls back to the site’s own', () => {
    const withLayout: AiBuildPlan = {
      ...plan,
      create: [{ kind: 'layout', name: 'Main', why: '', duplicateOf: null, fields: [] }],
      screens: [screen('About', '/about', [], 'new:Main')],
      items: [],
    }
    const layoutUnits = aiBuildUnits(withLayout)
    const degradation = aiBuildDegradation(layoutUnits[1], { units: layoutUnits, ledger: ledgerOf(withLayout, { c0: 'failed' }), ops: OPS })
    expect(degradation.notes).toEqual(['Built inside the site’s own layout: the layout “Main” could not be created.'])
  })

  it('a campaign whose email design failed is skipped, spending nothing', () => {
    const emailPlan: AiBuildPlan = {
      reuse: [],
      create: [{ kind: 'email', name: 'Welcome', why: '', duplicateOf: null, fields: [] }],
      screens: [],
      items: [item(0, { op: 'campaign', name: 'Launch', dependsOn: ['new:Welcome'], args: {} })],
    }
    const emailUnits = aiBuildUnits(emailPlan)
    expect(aiBuildDegradation(emailUnits[1], { units: emailUnits, ledger: ledgerOf(emailPlan, { c0: 'failed' }), ops: OPS }).skip).toBe(
      'Not built: the email design “Welcome” it needs could not be created.',
    )
  })

  it('a menu is built with the pages that were made and without the one that failed, and skipped only when none was made (AGL-3832)', () => {
    const menuPlan: AiBuildPlan = {
      reuse: [],
      create: [],
      screens: [screen('About', '/about'), screen('Contact', '/get-in-touch'), screen('Book a tasting', '/book-a-tasting')],
      items: [
        item(0, {
          op: 'navigation',
          name: 'Add new pages to header and footer',
          args: { menu: 'both', add: ['About => new:About', 'Contact us => new:Contact', 'Book a tasting => new:Book a tasting'] },
        }),
      ],
    }
    const menuUnits = aiBuildUnits(menuPlan)
    const menu = menuUnits.find((one) => one.slot === 'i0') as (typeof menuUnits)[number]
    expect(menu.deps).toEqual(['p0', 'p1', 'p2'])
    const ops: AiBuildOps = new Map([...OPS, ['navigation', capability('navigation', { estimateCredits: () => 0 })]])
    const someFailed = aiBuildDegradation(menu, {
      units: menuUnits,
      ledger: ledgerOf(menuPlan, { p0: 'failed', p1: 'failed', p2: 'succeeded' }),
      ops,
    })
    expect(someFailed).toMatchObject({
      skip: null,
      degradedBy: ['p0', 'p1'],
      notes: ['Built without the page “About”: it could not be created.', 'Built without the page “Contact”: it could not be created.'],
    })
    expect([...someFailed.dropped]).toEqual(['about', 'contact'])
    expect(
      aiBuildDegradation(menu, { units: menuUnits, ledger: ledgerOf(menuPlan, { p0: 'failed', p1: 'failed', p2: 'failed' }), ops }).skip,
    ).toBe('Not built: the page “About” it needs could not be created.')
  })
})

describe('the ledger', () => {
  it('builds the next open unit in order, and settles on what was delivered', () => {
    const plan = canonical()
    const ordered = aiBuildOrder(aiBuildUnits(plan)) ?? []
    expect(aiBuildNextUnit(ordered, ledgerOf(plan, { c0: 'failed', i0: 'running' }))?.slot).toBe('i0')
    expect(aiBuildNextUnit(ordered, ledgerOf(plan, { c0: 'failed', i0: 'succeeded', p0: 'degraded', p1: 'succeeded', p2: 'skipped' }))).toBeNull()
    expect(aiBuildSettlement(ledgerOf(plan, { c0: 'failed', i0: 'failed', p0: 'failed', p1: 'failed', p2: 'failed' }))).toEqual({
      delivered: false,
      open: false,
      failed: 5,
    })
    expect(aiBuildSettlement(ledgerOf(plan, { c0: 'degraded' })).delivered).toBe(true)
  })

  it('Try again: failed items and what they left unbuilt, never what succeeded, a drafted page kept', () => {
    const plan = canonical()
    const ledger = ledgerOf(plan, { c0: 'failed', i0: 'failed', p0: 'degraded', p1: 'degraded', p2: 'succeeded' }, { p0: ['page-0'] })
    const { ledger: next, retried } = aiBuildRetryLedger(ledger, aiBuildUnits(plan))
    expect(retried).toEqual(['c0', 'i0', 'p1'])
    expect(next.map((row) => [row.slot, row.status, row.attempt])).toEqual([
      ['c0', 'pending', 2],
      ['i0', 'pending', 2],
      ['p0', 'degraded', 1],
      ['p1', 'pending', 2],
      ['p2', 'succeeded', 1],
    ])
    expect(next[2].note).toContain('edit this page')
  })
})

describe('the estimate', () => {
  it('counts each page by its passes, each creation as one, each item by its capability', () => {
    const plan = canonical()
    // Three pages of one section (2 passes each), one form (1), a booking service (0).
    expect(aiBuildCreditEstimate(plan, { ops: OPS })).toBe((3 * 2 + 1) * 50)
    expect(aiBuildCreditEstimate(plan, { ops: OPS, slots: new Set(['c0']) })).toBe(50)
    expect(aiJobCreditEstimate('build', { ...plan, items: [{ ...plan.items![0], credits: 7 }] })).toBe(7 + 350)
  })
})

describe('items in the plan model', () => {
  it('reads items whose arguments the model wrote as one JSON string, slots in plan order', () => {
    const parsed = parseAiBuildPlan({
      reuse: [],
      create: [{ kind: 'form', name: 'Contact', why: 'x', duplicateOf: null, fields: [] }],
      screens: [],
      items: [{ op: 'booking-service', name: 'Consult', why: 'y', dependsOn: [], degrade: 'omit', args: '{"durationMinutes":30}' }],
    })
    expect(parsed).toMatchObject({ ok: true, plan: { items: [{ slot: 'i0', args: { durationMinutes: 30 } }] } })
    expect(parseAiBuildPlan({ reuse: [], create: [], screens: [], items: [{ op: 'x', name: 'A', args: 'not json' }] })).toMatchObject({ ok: false })
    expect(
      parseAiBuildPlan({
        reuse: [],
        create: [{ kind: 'form', name: 'Same', why: '', duplicateOf: null, fields: [] }],
        screens: [],
        items: [{ op: 'x', name: 'same', args: '{}' }],
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('used twice') })
  })

  it('a page placing an item is not an undeclared creation', () => {
    expect(aiPlanUndeclaredRefs(canonical())).toEqual([])
  })

  it('offers items only on a build’s tool, as a JSON-string argument, the same bytes whatever is registered', () => {
    const tool = withBuildItems(AI_BUILD_PLAN_TOOL)
    expect(tool.inputSchema['required']).toContain('items')
    expect(JSON.stringify(tool)).toBe(JSON.stringify(withBuildItems(AI_BUILD_PLAN_TOOL)))
    expect(AI_BUILD_PLAN_TOOL.inputSchema['required']).not.toContain('items')
  })
})

// AGL-4087: what a build's brief asks for that its plan does not build is said, never dropped quietly.
describe('what a build leaves out', () => {
  const HELPER = {
    asked: 'Review helper page',
    why: 'The site cannot write a review draft from a customer’s choices or copy it for them.',
  }
  const answer = (leftOut: unknown) => ({ ...canonical(), items: [], leftOut })

  it('is asked of a build’s tool alone, a closed object of what was asked and why', () => {
    const tool = withBuildItems(AI_BUILD_PLAN_TOOL)
    expect(tool.inputSchema['required']).toContain('leftOut')
    const schema = (tool.inputSchema['properties'] as Record<string, { items: Record<string, unknown> }>)['leftOut']
    expect(schema.items['additionalProperties']).toBe(false)
    expect(schema.items['required']).toEqual(['asked', 'why'])
    expect(AI_BUILD_PLAN_TOOL.inputSchema['properties']).not.toHaveProperty('leftOut')
  })

  it('keeps each entry, and carries no list when nothing is left out', () => {
    expect(parseAiBuildPlan(answer([HELPER]))).toMatchObject({ ok: true, plan: { leftOut: [HELPER] } })
    const none = parseAiBuildPlan(answer([]))
    expect(none.ok && 'leftOut' in none.plan).toBe(false)
    const absent = parseAiBuildPlan({ ...canonical(), items: [] })
    expect(absent.ok && 'leftOut' in absent.plan).toBe(false)
  })

  it('cuts a list past its limit and drops an entry that names nothing, instead of refusing the plan', () => {
    const many = Array.from({ length: AI_BUILD_PLAN_LIMITS.leftOut + 2 }, (_, index) => ({ asked: `Page ${index}`, why: '' }))
    const parsed = parseAiBuildPlan(answer([{ asked: ' ', why: 'Nothing.' }, ...many]))
    expect(parsed.ok && parsed.plan.leftOut?.map((entry) => entry.asked)).toEqual(
      many.slice(0, AI_BUILD_PLAN_LIMITS.leftOut - 1).map((entry) => entry.asked),
    )
    expect(parsed.ok && parsed.repairs).toContain(`leftOut listed ${many.length + 1}; kept the first ${AI_BUILD_PLAN_LIMITS.leftOut}`)
    expect(parseAiBuildPlan(answer('Review helper page'))).toEqual({ ok: false, error: 'leftOut is not a list' })
  })

  it('is the last thing the plan card lists, read before Confirm', () => {
    const parsed = parseAiBuildPlan(answer([HELPER, { asked: 'A members area', why: '' }]))
    if (!parsed.ok) throw new Error('the plan did not read')
    const lines = aiJobPlanLines({
      ...parsed.plan,
      status: 'proposed',
      labels: {},
      proposedAt: null,
      confirmedAt: null,
      confirmedBy: null,
    })
    expect(lines.slice(-2)).toEqual([
      {
        key: 'left-out-0',
        text: 'Leaves out Review helper page — The site cannot write a review draft from a customer’s choices or copy it for them.',
      },
      { key: 'left-out-1', text: 'Leaves out A members area' },
    ])
  })
})

// AGL-4077: one theme change a plan, proposed for the owner to apply in Setup → Theme.
describe('a theme change in a build', () => {
  const THEMED: AiBuildOps = new Map([...OPS, ['theme', capability('theme', { noun: 'theme change', maxPerPlan: 1, freeAllowed: false })]])
  const warmer = (overrides: Partial<AiBuildItem> = {}) =>
    item(1, { op: 'theme', name: 'Warmer look', why: 'The request asks for a warmer look.', args: {}, ...overrides })
  const themeChange = { kind: 'theme-change' as const, name: 'Warmer look', why: 'The request asks for a warmer look.', duplicateOf: null, fields: ['palette.primary.main'] }

  it('is a unit built by the theme operation, as an item or as the plan’s theme-change creation', () => {
    const asItem = { ...canonical(), items: [item(0, {}), warmer()] }
    expect(aiBuildUnits(asItem).map((unit) => [unit.slot, unit.op])).toContainEqual(['i1', 'theme'])
    const asCreation = { ...canonical(), create: [...canonical().create, themeChange] }
    const units = aiBuildUnits(asCreation)
    expect(units.map((unit) => [unit.slot, unit.op, unit.deps])).toContainEqual(['c1', 'theme', []])
    expect(units.find((unit) => unit.slot === 'c1')?.creation?.kind).toBe('theme-change')
  })

  it('admits one on a paid plan, whichever list the plan put it in, instead of refusing it', () => {
    expect(aiBuildPlanShapeRefusal({ ...canonical(), items: [item(0, {}), warmer()] }, { ops: THEMED })).toBeNull()
    expect(aiBuildPlanShapeRefusal({ ...canonical(), create: [...canonical().create, themeChange] }, { ops: THEMED })).toBeNull()
    // A console reading a kept plan has no operations to judge it against.
    expect(aiBuildPlanShapeRefusal({ ...canonical(), create: [...canonical().create, themeChange] })).toBeNull()
  })

  it('refuses it on a Free workspace, and where the site has no theme operation, saying so', () => {
    const two = { ...canonical(), screens: canonical().screens.slice(0, 2) }
    const free = new Map([...THEMED].filter(([op]) => op !== 'theme'))
    expect(aiBuildPlanShapeRefusal({ ...two, items: [item(0, {}), warmer()] }, { freeTaste: true, ops: free })).toBe(
      'A Free workspace cannot have a theme change made (“Warmer look”). Take it out of items.',
    )
    expect(aiBuildPlanShapeRefusal({ ...two, create: [...two.create, themeChange] }, { freeTaste: true, ops: free })).toBe(
      'A Free workspace cannot have a theme change made (“Warmer look”). Take it out of create.',
    )
    expect(aiBuildPlanShapeRefusal({ ...canonical(), create: [...canonical().create, themeChange] }, { ops: OPS })).toBe(
      'Nothing on this site can make “Warmer look” (theme change). Take it out of create.',
    )
  })

  it('holds a plan to one theme change, counting both lists', () => {
    const both = { ...canonical(), create: [...canonical().create, themeChange], items: [item(0, {}), warmer({ name: 'Bolder look' })] }
    expect(aiBuildPlanShapeRefusal(both, { ops: THEMED })).toBe('This plan makes 2 of “theme change”, and one build makes at most 1.')
  })

  it('is estimated at one pass', () => {
    const plan = { ...canonical(), items: [item(0, {}), warmer()] }
    expect(aiBuildCreditEstimate(plan, { ops: THEMED, slots: new Set(['i1']) })).toBe(50)
    const created = { ...canonical(), create: [...canonical().create, themeChange] }
    expect(aiBuildCreditEstimate(created, { ops: THEMED, slots: new Set(['c1']) })).toBe(50)
  })
})
