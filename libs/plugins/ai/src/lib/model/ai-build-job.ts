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

import {
  pluginAiCapabilityArgsProblems,
  type PluginAiCapability,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  AI_PLAN_NEW_REF_PREFIX,
  isAiPlanNewRef,
  type AiBuildItem,
  type AiBuildPlan,
  type AiBuildPlanCreate,
  type AiBuildPlanCreateKind,
  type AiBuildPlanScreen,
} from './ai-build-plan'
import type { AiJobItemLedger, AiJobItemStatus } from './ai-jobs.types'
import {
  AI_SITE_HOME_FIRST_LABEL,
  AI_SITE_MAX_SECTIONS,
  AI_SITE_PASS_CREDITS,
  aiCreationMeasuredCredits,
  aiJobPlanCreditEstimate,
  aiJobPlanCreditRange,
  aiSitePlanIsHome,
  aiStandaloneScreenCreditRange,
} from './ai-site-job'
import {
  AI_CREDIT_RANGE_ZERO,
  AI_MEASURED_PASS_CREDITS,
  aiCreditRangeAdd,
  aiCreditRangeOf,
  aiCreditRangeOrdered,
  type AiCreditRange,
  type AiCreditsSmaller,
} from './ai-credit-estimate'

/**
 * What a `build` job is (AGL-3616): one request — "a few pages, a contact
 * form and a way to book me" — planned as creations, pages and items, built
 * one UNIT a pass in dependency order, and settled ITEM BY ITEM.
 *
 * A build is a generalized site scaffold. Every unit is handed to what
 * already builds that kind of thing — a page to the page step, a form to the
 * form step, another plugin's resource to that plugin's draft writer — so a
 * build cannot drift from what it builds. What is new is the settlement: one
 * failed unit does not end the job. It gives back its own spend, the units
 * that depended on it are built without it (or skipped, when they cannot
 * stand without it), and the job is `done` when anything was delivered.
 *
 * This module is the build's MODEL — its units, their order, how a failure
 * travels to what depends on it, what it is estimated to cost, and the
 * ledger arithmetic — and does no I/O, so the step, the machine, the doors
 * and the console read one vocabulary.
 */

/** How much one build holds: what one proposal can describe and one person can read. */
export const AI_BUILD_LIMITS = {
  /** Creations, pages and items together. */
  units: 16,
  pages: 8,
  /** A Free workspace's pages. */
  freePages: 2,
} as const

/**
 * What a Free build's plan card says when it holds as many pages as a Free
 * build makes (AGL-3722): the plan is told the cap and plans the first pages
 * a request asks for, so a request for three — "About us, Custom cakes and
 * Catering", 2026-10-10 — came back as two with nothing saying why. `null`
 * when the plan holds fewer, or on a paid workspace.
 */
export function aiBuildFreePageCapNote(plan: Pick<AiBuildPlan, 'screens'>, freeTaste: boolean): string | null {
  const cap = AI_BUILD_LIMITS.freePages
  if (!freeTaste || plan.screens.length < cap) return null
  return `A Free workspace’s build makes up to ${cap} pages at a time. If you asked for more, ask Assist for the rest once this build is done.`
}

/** What a build creates through its `create` list; everything else beyond pages is an item. */
export const AI_BUILD_CREATE_KINDS: readonly AiBuildPlanCreateKind[] = ['layout', 'form', 'component', 'email']

/**
 * The operations a build plans through `create` and `screens` rather than
 * `items`: an item naming one is a plan that put it in the wrong list.
 */
export const AI_BUILD_STRUCTURAL_OPS: readonly string[] = ['page', ...AI_BUILD_CREATE_KINDS]

/** The job input a build's Assist proposal sets when the brief asked to publish. */
export const AI_BUILD_PUBLISH_INPUT = 'publish'

/** A unit of a build: a creation, a page, or an item. */
export interface AiBuildUnit {
  slot: string
  /** The capability operation that builds it. */
  op: string
  label: string
  creation?: AiBuildPlanCreate
  screen?: AiBuildPlanScreen
  item?: AiBuildItem
  /** The slots it is built after, in plan order. */
  deps: string[]
}

/** The operation a creation is built as. */
function creationOp(creation: AiBuildPlanCreate): string {
  return creation.kind
}

/** A plan's `new:<name>` names, each to the slot that builds it. */
function namedSlots(plan: AiBuildPlan): Map<string, string> {
  const slots = new Map<string, string>()
  plan.create.forEach((creation, index) => {
    if (AI_BUILD_CREATE_KINDS.includes(creation.kind)) slots.set(creation.name.toLowerCase(), `c${index}`)
  })
  for (const item of plan.items ?? []) slots.set(item.name.toLowerCase(), item.slot)
  return slots
}

/** The name a `new:<name>` reference gives, lowercased. */
export function aiBuildRefName(ref: string): string {
  return ref.slice(AI_PLAN_NEW_REF_PREFIX.length).trim().toLowerCase()
}

/** Every reference a page makes: its layout, template, starting page and what its sections place. */
export function aiBuildScreenRefs(screen: AiBuildPlanScreen): string[] {
  return [
    screen.layout,
    screen.template,
    screen.duplicateOf,
    ...screen.sections.flatMap((section) => section.uses),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
}

/**
 * The units a plan implies, in plan order: creations, then items, then
 * pages — the order a member reads them in, and the one a page that places
 * a creation or an item is built after anyway. `aiBuildOrder` sorts them on
 * their dependencies.
 */
export function aiBuildUnits(plan: AiBuildPlan): AiBuildUnit[] {
  const slots = namedSlots(plan)
  const depsOf = (refs: readonly (string | null)[], self: string): string[] => {
    const deps: string[] = []
    for (const ref of refs) {
      if (!isAiPlanNewRef(ref)) continue
      const slot = slots.get(aiBuildRefName(ref))
      if (slot && slot !== self && !deps.includes(slot)) deps.push(slot)
    }
    return deps
  }
  const units: AiBuildUnit[] = []
  plan.create.forEach((creation, index) => {
    if (!AI_BUILD_CREATE_KINDS.includes(creation.kind)) return
    const slot = `c${index}`
    units.push({ slot, op: creationOp(creation), label: creation.name, creation, deps: depsOf([creation.duplicateOf], slot) })
  })
  for (const item of plan.items ?? []) {
    units.push({ slot: item.slot, op: item.op, label: item.name, item, deps: depsOf(item.dependsOn, item.slot) })
  }
  plan.screens.forEach((screen, index) => {
    const slot = `p${index}`
    units.push({ slot, op: 'page', label: screen.title, screen, deps: depsOf(aiBuildScreenRefs(screen), slot) })
  })
  return units
}

/**
 * The units in an order that builds every dependency before what depends on
 * it, plan order otherwise; `null` when the dependencies hold a cycle.
 */
export function aiBuildOrder(units: readonly AiBuildUnit[]): AiBuildUnit[] | null {
  const ordered: AiBuildUnit[] = []
  const placed = new Set<string>()
  const known = new Set(units.map((unit) => unit.slot))
  while (ordered.length < units.length) {
    const next = units.find(
      (unit) => !placed.has(unit.slot) && unit.deps.every((dep) => placed.has(dep) || !known.has(dep)),
    )
    if (!next) return null
    ordered.push(next)
    placed.add(next.slot)
  }
  return ordered
}

/**
 * What is wrong with a plan's references as a build reads them: a
 * `new:<name>` an item depends on that nothing in the plan makes, and a
 * cycle. Each is a sentence the plan's one re-ask carries.
 */
export function aiBuildGraphProblems(plan: AiBuildPlan): string[] {
  const problems: string[] = []
  const slots = namedSlots(plan)
  for (const item of plan.items ?? []) {
    for (const ref of item.dependsOn) {
      if (!isAiPlanNewRef(ref)) continue
      if (!slots.has(aiBuildRefName(ref))) {
        problems.push(`The item "${item.name}" depends on ${ref}, which the plan never makes. Declare it, or take it out of dependsOn.`)
      } else if (aiBuildRefName(ref) === item.name.toLowerCase()) {
        problems.push(`The item "${item.name}" depends on itself. Take it out of its own dependsOn.`)
      }
    }
  }
  if (!aiBuildOrder(aiBuildUnits(plan))) {
    problems.push('The plan’s dependencies go round in a circle, so nothing in the circle can be built first. Make one of them depend on nothing.')
  }
  return problems
}

/** The operations a build may plan, as the registry and the gates left them, by op. */
export type AiBuildOps = ReadonlyMap<string, PluginAiCapability>

/** How many pages a build may hold on this workspace. */
export function aiBuildPageLimit(freeTaste: boolean | null | undefined): number {
  return freeTaste ? AI_BUILD_LIMITS.freePages : AI_BUILD_LIMITS.pages
}

/**
 * Why a build cannot build a plan of this shape, in a sentence a member
 * reads; `null` when it can. Held to the plan with the one re-ask (the plan
 * step's scope), and again by the doors before a confirmed plan runs.
 * `ops` is what may be planned on this site; absent, items are not judged
 * against the registry (a console reading a kept plan).
 */
export function aiBuildPlanShapeRefusal(
  plan: AiBuildPlan,
  options: { freeTaste?: boolean; ops?: AiBuildOps } = {},
): string | null {
  const units = aiBuildUnits(plan)
  if (!units.length) return 'This plan builds nothing. Describe what to build again.'
  if (units.length > AI_BUILD_LIMITS.units) {
    return `This plan builds ${units.length} things, and one build holds ${AI_BUILD_LIMITS.units}. Ask for the rest in a second request.`
  }
  const pages = aiBuildPageLimit(options.freeTaste)
  if (plan.screens.length > pages) {
    return options.freeTaste
      ? `This plan builds ${plan.screens.length} pages, and a Free workspace's build makes at most ${pages}. Paid plans can build more.`
      : `This plan builds ${plan.screens.length} pages, and one build makes at most ${pages}.`
  }
  const slugs = new Set<string>()
  for (const screen of plan.screens) {
    if (!screen.sections.length) return `The page “${screen.title}” has no sections to build.`
    if (screen.sections.length > AI_SITE_MAX_SECTIONS) {
      return `The page “${screen.title}” has ${screen.sections.length} sections, and a built page holds ${AI_SITE_MAX_SECTIONS}.`
    }
    const slug = screen.slug.trim().toLowerCase()
    if (slugs.has(slug)) return `Two pages in this plan share the address ${screen.slug}.`
    slugs.add(slug)
  }
  for (const creation of plan.create) {
    if (!AI_BUILD_CREATE_KINDS.includes(creation.kind)) {
      return `A build does not create ${creation.kind === 'theme-change' ? 'theme changes' : `${creation.kind}s`} (“${creation.name}”). Take it out of create.`
    }
  }
  const graph = aiBuildGraphProblems(plan)
  if (graph.length) return graph[0]
  const ops = options.ops
  const counts = new Map<string, number>()
  for (const unit of units) counts.set(unit.op, (counts.get(unit.op) ?? 0) + 1)
  for (const item of plan.items ?? []) {
    if (AI_BUILD_STRUCTURAL_OPS.includes(item.op)) {
      return item.op === 'page'
        ? `“${item.name}” is a page: plan it in screens, not items.`
        : `“${item.name}” is ${item.op === 'email' ? 'an' : 'a'} ${item.op}: plan it in create, not items.`
    }
    if (!ops) continue
    const capability = ops.get(item.op)
    if (!capability) return `Nothing on this site can make “${item.name}” (${item.op}). Take it out of items.`
    if (options.freeTaste && !capability.freeAllowed) {
      return `A Free workspace cannot have ${aiArticle(capability.noun)} made (“${item.name}”). Take it out of items.`
    }
    const problems = pluginAiCapabilityArgsProblems(capability.argsSchema, item.args)
    if (problems.length) return `The arguments of “${item.name}” do not read: ${problems.join('; ')}.`
  }
  if (ops) {
    for (const [op, count] of counts) {
      const capability = ops.get(op)
      if (capability && count > capability.maxPerPlan) {
        return `This plan makes ${count} of “${capability.noun}”, and one build makes at most ${capability.maxPerPlan}.`
      }
    }
  }
  return null
}

/** "a booking service", "an email design". */
export function aiArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** The passes one unit is estimated at: a page's sections and its listing, one for a creation. */
function unitPasses(unit: AiBuildUnit): number {
  if (unit.screen) return unit.screen.sections.length + 1
  return 1
}

/**
 * About what one unit costs, in credits: a page or a creation by the passes
 * it implies at the nominal credits a pass is held against, as a site's are;
 * an item by its capability's own estimate, recorded on the plan when it was
 * kept.
 */
export function aiBuildUnitCreditEstimate(unit: AiBuildUnit, ops?: AiBuildOps): number {
  if (unit.item) {
    if (typeof unit.item.credits === 'number') return unit.item.credits
    const capability = ops?.get(unit.item.op)
    if (capability) return Math.max(0, Math.floor(capability.estimateCredits(unit.item.args)))
    return AI_SITE_PASS_CREDITS
  }
  return unitPasses(unit) * AI_SITE_PASS_CREDITS
}

/**
 * About what a build costs, in credits: every unit's estimate, or only the
 * units named in `slots` — what Try again shows. The ceiling a member
 * confirms; the meter charges what actually runs.
 */
export function aiBuildCreditEstimate(
  plan: AiBuildPlan,
  options: { ops?: AiBuildOps; slots?: ReadonlySet<string> } = {},
): number {
  return aiBuildUnits(plan)
    .filter((unit) => !options.slots || options.slots.has(unit.slot))
    .reduce((total, unit) => total + aiBuildUnitCreditEstimate(unit, options.ops), 0)
}

/**
 * About what a job of this kind costs to build from its plan: a build's
 * units, every other planned kind as `aiJobPlanCreditEstimate` counts it.
 */
export function aiJobCreditEstimate(kind: string, plan: AiBuildPlan): number {
  return kind === 'build' ? aiBuildCreditEstimate(plan) : aiJobPlanCreditEstimate(kind, plan)
}

/**
 * What one unit is likely to cost, its p90 and its ceiling (AGL-3722): a page
 * as a page written on its own measured (a fixed cost and one per section), a creation at what its kind
 * measured, an item at the measured pass times the passes its capability
 * estimates (none for a draft another plugin writes, which asks no model).
 * The ceiling is `aiBuildUnitCreditEstimate`, unchanged.
 */
export function aiBuildUnitCreditRange(unit: AiBuildUnit, ops?: AiBuildOps): AiCreditRange {
  const ceiling = aiBuildUnitCreditEstimate(unit, ops)
  // A build writes each page on its own, never in a site start's warm run (AGL-3722).
  if (unit.screen) return aiStandaloneScreenCreditRange(unit.screen.sections.length)
  if (unit.creation) return aiCreditRangeOf(aiCreationMeasuredCredits(unit.creation.kind, { standalone: true }), ceiling)
  const passes = Math.ceil(ceiling / AI_SITE_PASS_CREDITS)
  return aiCreditRangeOf(
    { median: passes * AI_MEASURED_PASS_CREDITS.median, p90: passes * AI_MEASURED_PASS_CREDITS.p90 },
    ceiling,
  )
}

/**
 * What a build is likely to cost, its p90 and its ceiling (AGL-3722): every
 * unit's range, or only the units named in `slots` — what Try again runs.
 * The plan card, Try again and the Free admission all read this; the meter
 * charges what actually runs.
 */
export function aiBuildCreditRange(
  plan: AiBuildPlan,
  options: { ops?: AiBuildOps; slots?: ReadonlySet<string> } = {},
): AiCreditRange {
  return aiCreditRangeOrdered(
    aiBuildUnits(plan)
      .filter((unit) => !options.slots || options.slots.has(unit.slot))
      .reduce((total, unit) => aiCreditRangeAdd(total, aiBuildUnitCreditRange(unit, options.ops)), AI_CREDIT_RANGE_ZERO),
  )
}

/** `aiJobCreditEstimate` as a range (AGL-3722). */
export function aiJobCreditRange(kind: string, plan: AiBuildPlan): AiCreditRange {
  return kind === 'build' ? aiBuildCreditRange(plan) : aiJobPlanCreditRange(kind, plan)
}

/**
 * A smaller first build (AGL-3722): the plan's home page — its first page
 * where it has no home — and only what that page needs, transitively: the
 * layout it is drawn in, the form and anything else its sections place.
 * Every other page, and what only they needed, waits for a later request.
 * `null` when the plan has no page, or when the smaller plan is the whole one.
 */
export function aiBuildFirstPagePlan<T extends AiBuildPlan>(plan: T): T | null {
  if (!plan.screens.length) return null
  const index = Math.max(0, plan.screens.findIndex(aiSitePlanIsHome))
  const units = aiBuildUnits(plan)
  const bySlot = new Map(units.map((unit) => [unit.slot, unit]))
  const keep = new Set<string>()
  const queue = [`p${index}`]
  while (queue.length) {
    const slot = queue.shift() as string
    if (keep.has(slot)) continue
    keep.add(slot)
    for (const dep of bySlot.get(slot)?.deps ?? []) queue.push(dep)
  }
  if (keep.size === units.length) return null
  const screen = plan.screens[index]
  const create = plan.create.filter((creation, at) => !AI_BUILD_CREATE_KINDS.includes(creation.kind) || keep.has(`c${at}`))
  const items = (plan.items ?? []).filter((item) => keep.has(item.slot))
  const kept = new Set([screen.slug, ...create.map((entry) => `${AI_PLAN_NEW_REF_PREFIX}${entry.name}`)])
  return {
    ...plan,
    create,
    screens: [screen],
    ...(plan.items ? { items } : {}),
    ...(plan.embeds ? { embeds: plan.embeds.filter((embed) => kept.has(embed.where)) } : {}),
  }
}

/** The smaller first build a build that does not fit is offered (AGL-3722), with its range; `null` when there is none. */
export function aiBuildSmaller(plan: AiBuildPlan, ops?: AiBuildOps): AiCreditsSmaller | null {
  const smaller = aiBuildFirstPagePlan(plan)
  if (!smaller) return null
  const screen = smaller.screens[0]
  const label = aiSitePlanIsHome(screen) ? AI_SITE_HOME_FIRST_LABEL : `Build the ${screen.title} page first`
  return { label, ...aiBuildCreditRange(smaller, { ops }) }
}

/** A fresh ledger: one pending row per unit, first attempt. */
export function aiBuildInitialLedger(units: readonly AiBuildUnit[]): AiJobItemLedger[] {
  return units.map((unit) => ({
    slot: unit.slot,
    op: unit.op,
    label: unit.label,
    status: 'pending',
    attempt: 1,
    creditsSpent: 0,
    attemptCredits: 0,
    creditsRefunded: 0,
    failure: null,
    outputs: [],
  }))
}

const OPEN: readonly AiJobItemStatus[] = ['pending', 'running']

/** Whether an item is still to be built. */
export function aiBuildItemOpen(row: Pick<AiJobItemLedger, 'status'>): boolean {
  return OPEN.includes(row.status)
}

/** Whether an item delivered: built as planned, or built without something that failed. */
export function aiBuildItemDelivered(row: Pick<AiJobItemLedger, 'status'>): boolean {
  return row.status === 'succeeded' || row.status === 'degraded'
}

/**
 * The next unit to build: the first in build order whose row is still open.
 * Its dependencies come before it, so by then each is settled one way or the
 * other. `null` when nothing is left.
 */
export function aiBuildNextUnit(
  ordered: readonly AiBuildUnit[],
  ledger: readonly AiJobItemLedger[],
): AiBuildUnit | null {
  const rows = new Map(ledger.map((row) => [row.slot, row]))
  return ordered.find((unit) => {
    const row = rows.get(unit.slot)
    return !row || aiBuildItemOpen(row)
  }) ?? null
}

/** How a unit is built given what its dependencies came to. */
export interface AiBuildDegradation {
  /** The unit is not built at all, with the sentence why; nothing is spent. */
  skip: string | null
  /** The failed dependencies that change how it is built. */
  degradedBy: string[]
  /** What the person reads about the change; one per failed dependency. */
  notes: string[]
  /** `new:<name>` references (lowercased names) to leave out. */
  dropped: Set<string>
  /** Brief lines for the unit's own job: what to leave out, and what to place. */
  briefLines: string[]
}

/**
 * How a unit is built when some of what it depends on failed (AGL-3616).
 *
 * A PAGE is always built: a failed layout falls back to the site's own, a
 * failed form or component is left out of its section, and a failed item a
 * section places (a booking service) takes its block out of the page — each
 * with a note. Any OTHER unit whose dependency failed is skipped when that
 * dependency's capability says `omit` (a campaign whose email design failed
 * has nothing to send), and built without it when it says `fallback`.
 */
export function aiBuildDegradation(
  unit: AiBuildUnit,
  context: {
    units: readonly AiBuildUnit[]
    ledger: readonly AiJobItemLedger[]
    ops?: AiBuildOps
  },
): AiBuildDegradation {
  const rows = new Map(context.ledger.map((row) => [row.slot, row]))
  const bySlot = new Map(context.units.map((one) => [one.slot, one]))
  const result: AiBuildDegradation = { skip: null, degradedBy: [], notes: [], dropped: new Set(), briefLines: [] }
  for (const slot of unit.deps) {
    const dep = bySlot.get(slot)
    const row = rows.get(slot)
    if (!dep || !row || aiBuildItemDelivered(row)) continue
    const noun = dep.creation
      ? aiBuildCreationNoun(dep.creation.kind)
      : (context.ops?.get(dep.op)?.noun ?? dep.op)
    const capability = dep.item ? context.ops?.get(dep.op) : undefined
    const degrade = dep.item?.degrade ?? capability?.degrade ?? (dep.creation?.kind === 'layout' ? 'fallback' : 'omit')
    if (!unit.screen && degrade === 'omit') {
      result.skip = `Not built: the ${noun} “${dep.label}” it needs could not be created.`
      result.degradedBy.push(slot)
      return result
    }
    result.degradedBy.push(slot)
    result.dropped.add(dep.label.toLowerCase())
    if (dep.creation?.kind === 'layout') {
      result.notes.push(`Built inside the site’s own layout: the layout “${dep.label}” could not be created.`)
      continue
    }
    if (unit.screen) {
      const section = unit.screen.sections.find((one) =>
        one.uses.some((ref) => isAiPlanNewRef(ref) && aiBuildRefName(ref) === dep.label.toLowerCase()),
      )
      const blocks = capability?.pageBlocks?.length ? ` the ${capability.pageBlocks.join(' or ')} block` : ''
      result.notes.push(
        `Built without${blocks || ` the ${noun}`}: the ${noun} “${dep.label}” could not be created.`,
      )
      result.briefLines.push(
        `${section ? `Build the “${section.name}” section` : 'Build the page'} without the ${noun} “${dep.label}”${blocks ? ` and without${blocks}` : ''}: it could not be created.`,
      )
    } else {
      result.notes.push(`Built without the ${noun} “${dep.label}”: it could not be created.`)
    }
  }
  return result
}

/** What each creation is called in a note. */
export function aiBuildCreationNoun(kind: AiBuildPlanCreateKind): string {
  return kind === 'email' ? 'email design' : kind === 'theme-change' ? 'theme change' : kind
}

/**
 * The brief lines a page is told about the items its sections place and
 * that were built: the block to put there, in the owner's words.
 */
export function aiBuildPlacedItemLines(
  unit: AiBuildUnit,
  context: { units: readonly AiBuildUnit[]; ledger: readonly AiJobItemLedger[]; ops?: AiBuildOps },
): string[] {
  if (!unit.screen) return []
  const rows = new Map(context.ledger.map((row) => [row.slot, row]))
  const lines: string[] = []
  for (const section of unit.screen.sections) {
    for (const ref of section.uses) {
      if (!isAiPlanNewRef(ref)) continue
      const dep = context.units.find((one) => one.item && one.item.name.toLowerCase() === aiBuildRefName(ref))
      if (!dep?.item) continue
      const row = rows.get(dep.slot)
      if (!row || !aiBuildItemDelivered(row)) continue
      const capability = context.ops?.get(dep.op)
      const blocks = capability?.pageBlocks ?? []
      if (!blocks.length) continue
      lines.push(
        `In the “${section.name}” section, place the ${blocks.join(' or ')} block for the ${capability?.noun ?? dep.op} “${dep.label}”.`,
      )
    }
  }
  return lines
}

/** What a build came to: whether anything was delivered, and whether anything is left. */
export function aiBuildSettlement(ledger: readonly AiJobItemLedger[]): {
  delivered: boolean
  open: boolean
  failed: number
} {
  return {
    delivered: ledger.some(aiBuildItemDelivered),
    open: ledger.some(aiBuildItemOpen),
    failed: ledger.filter((row) => row.status === 'failed').length,
  }
}

/**
 * The ledger Try again runs (AGL-3616): every failed item back to `pending`
 * on its next attempt, with the items left unbuilt because of it — skipped,
 * or degraded with no draft — and every item the build never reached. An
 * item that succeeded is never run again, and a degraded page that has its
 * draft keeps it, with a note that the page needs an edit. `retried` names
 * the slots that will run, which is what the estimate is shown for.
 */
export function aiBuildRetryLedger(
  ledger: readonly AiJobItemLedger[],
  units: readonly AiBuildUnit[],
): { ledger: AiJobItemLedger[]; retried: string[] } {
  const failed = new Set(ledger.filter((row) => row.status === 'failed').map((row) => row.slot))
  const dependents = new Map<string, string[]>()
  for (const unit of units) {
    for (const dep of unit.deps) dependents.set(dep, [...(dependents.get(dep) ?? []), unit.slot])
  }
  // Everything downstream of a failed item, transitively.
  const downstream = new Set<string>()
  const queue = [...failed]
  while (queue.length) {
    const slot = queue.shift() as string
    for (const next of dependents.get(slot) ?? []) {
      if (downstream.has(next)) continue
      downstream.add(next)
      queue.push(next)
    }
  }
  const retried: string[] = []
  const next = ledger.map((row): AiJobItemLedger => {
    const again =
      row.status === 'failed' ||
      (row.status === 'skipped' && (downstream.has(row.slot) || !(row.degradedBy ?? []).length)) ||
      (row.status === 'degraded' && downstream.has(row.slot) && !row.outputs.length)
    if (again) {
      retried.push(row.slot)
      return {
        ...row,
        status: 'pending',
        attempt: row.attempt + 1,
        attemptCredits: 0,
        failure: null,
        note: null,
        degradedBy: [],
        settledAt: null,
      }
    }
    if (row.status === 'degraded' && downstream.has(row.slot) && row.outputs.length) {
      return {
        ...row,
        note: `${row.note ? `${row.note} ` : ''}It keeps its draft: once the rest is built, edit this page to add what it is missing.`,
      }
    }
    return row
  })
  return { ledger: next, retried }
}

/**
 * Units read back off a ledger alone (AGL-3616), for a job whose units are
 * not a build plan's — a site scaffold's: each row as its unit, and every
 * page built after the layouts and forms the ledger holds.
 */
export function aiLedgerUnits(ledger: readonly AiJobItemLedger[]): AiBuildUnit[] {
  const creations = ledger.filter((row) => row.op === 'layout' || row.op === 'form').map((row) => row.slot)
  return ledger.map((row) => ({
    slot: row.slot,
    op: row.op,
    label: row.label,
    deps: row.op === 'page' ? creations : [],
  }))
}
