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
  AI_BUILD_PLAN_TOOL,
  type AiBuildItem,
  type AiBuildPlan,
  type AiBuildPlanScreen,
} from './ai-build-plan'
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
