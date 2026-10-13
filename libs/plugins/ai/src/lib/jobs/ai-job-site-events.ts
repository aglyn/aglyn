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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  type PluginAiCapability,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  aiLayoutEventsPlacements,
  aiLayoutListingId,
  type AiLayoutListing,
  type AiLayoutListingScreen,
} from '../layout-language/ai-layout-listings'
import { aiBuildItemOutputNote, type AiBuildOps } from '../model/ai-build-job'
import type { AiBuildItem, AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { aiSiteWords } from '../model/ai-site-job'
import { aiModelForStep } from '../providers/routing'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AiJobAdmissionContext } from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiUnspentOutcome } from './ai-job-generation'
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

/**
 * A GUIDED START'S FIRST EVENTS (AGL-3755).
 *
 * A guided start for a business that holds dated events — a venue, a club, a
 * studio with classes, a meetup, a church, a theater — drafts its first few
 * upcoming events and lists them on the page about them, so the site opens
 * with its calendar rather than with events written out as copy.
 *
 * Nothing here knows what an event is. The events-calendar plugin owns the
 * `event` operation (its capability on `core.ai-capabilities`) and the
 * `event` writer (on `core.resource-drafts`); this module plans its items and
 * runs them exactly as a build does, so every rule is the owner's:
 *
 *  - THE GATE is the build's: the operation as `aiBuildOps` admits it on this
 *    site and plan (the `eventCalendar` add-on, the plugin on and released,
 *    a Free start only if the operation allows it), and the writer admits
 *    this member now. A start that cannot have events plans none, and its
 *    plan's turn is told nothing about them.
 *  - THE PLAN is told only for a brief that reads as event-led
 *    ({@link aiSiteEventLed}), how many (at most {@link AI_SITE_EVENTS_MAX}),
 *    today's date, the business's time zone where the site or workspace has
 *    one, and that the events are named in the uses of a section the plan
 *    already has, so the plan's section caps stay its budget.
 *  - THE BUILD writes each through the owner's writer before the pages,
 *    published where the member may publish, with its stock cover; the site's
 *    own zone wins over the plan's, so an event lands in the business's time.
 *  - THE PAGES list them: the section that names them places the Event List
 *    (`events` listing), with the events that were written.
 */

/** The operation and resource the events-calendar plugin registers; named, never imported. */
export const AI_SITE_EVENT_OP = 'event'
export const AI_SITE_EVENT_RESOURCE = 'event'

/** What the site's plugin list calls the events plugin, for a refusal a person reads. */
const EVENTS_PLUGIN_LABEL = 'Events'

/** How many events a start drafts: its first few. */
export const AI_SITE_EVENTS_MAX = 3

/** The unit input an event unit's item travels in. */
export const AI_SITE_EVENT_INPUT = 'siteEvent'

/** What the ledger calls an event unit when its item names none. */
export const AI_SITE_EVENT_LABEL = 'An event'

/**
 * A brief that reads as a business holding dated events. A gate on whether
 * the plan's turn mentions events at all, not the decision: the plan is told
 * to plan none for a business that holds none.
 */
const EVENT_LED =
  /\b(venues?|clubs?|class(?:es)?|meetups?|meet-ups?|church(?:es)?|parish|congregation|ministr(?:y|ies)|theat(?:re|er)s?|playhouse|concerts?|live music|gigs?|workshops?|festivals?|comedy|open mic|dance|choir|community (?:center|centre)|events?|tastings?|book club|trivia|seminars?|retreats?|lessons|courses?|performances?|shows)\b/i

/** Whether a site start's brief and answers read as an event-led business. */
export function aiSiteEventLed(job: Pick<AiJob, 'brief' | 'inputs'>): boolean {
  const { about } = aiSiteWords(job.inputs)
  return EVENT_LED.test(`${about} ${job.brief ?? ''}`)
}

/** The site start's events, as its plan holds them: the `event` items, its first few. */
export function aiSitePlanEvents(plan: Pick<AiBuildPlan, 'items'>): AiBuildItem[] {
  return (plan.items ?? []).filter((item) => item.op === AI_SITE_EVENT_OP).slice(0, AI_SITE_EVENTS_MAX)
}

/** What a site start may plan of events here, or `null` where it plans none. */
export interface AiSiteEventPlanning {
  /** The `event` operation alone, as the build's gate admits it. */
  ops: AiBuildOps
  /** The business's IANA zone where the site or its workspace has one. */
  timeZone: string | null
}

/** The site's or its workspace's own zone, or `null` where neither names one. */
export function aiSiteEventZone(
  org: { timeZone?: string } | null | undefined,
  host: { timeZone?: string } | null | undefined,
): string | null {
  const zone = resolveSiteTimeZone(org, host)
  return [host?.timeZone, org?.timeZone].some((said) => String(said ?? '').trim() === zone) ? zone : null
}

/** Whether this member may have events drafted on the job's site now; the writer's sentence where not. */
export async function aiSiteEventRefusal(
  context: Pick<AiJobStepContext, 'firestore' | 'org' | 'now'> & { job: Pick<AiJob, 'orgId' | 'hostId' | 'createdBy'> },
  deps: { admission?: typeof aiPluginDraftAdmissionRefusal; writerFor?: AiPluginDraftWriterLookup } = {},
): Promise<string | null> {
  const { job } = context
  if (!job.hostId) return 'Open the site first.'
  const admission: AiJobAdmissionContext = {
    firestore: context.firestore,
    orgId: job.orgId,
    hostId: job.hostId,
    inputs: {},
    org: context.org ?? null,
    uid: job.createdBy,
  }
  const refused = await (deps.admission ?? aiPluginDraftAdmissionRefusal)(admission, {
    kind: 'site',
    drafts: [{ resource: AI_SITE_EVENT_RESOURCE, label: EVENTS_PLUGIN_LABEL }],
    ...(deps.writerFor ? { writerFor: deps.writerFor } : {}),
    now: context.now,
  })
  return refused?.error ?? null
}

/**
 * What a site start may plan of events (AGL-3755): `null` unless the job is
 * a site start whose brief reads as event-led, the build's gate admits the
 * `event` operation on this site and plan, and the writer admits this member.
 */
export async function readAiSiteEventPlanning(
  input: {
    job: AiJob
    org: Partial<AglynOrgBilling> | null
    firestore: FirebaseFirestore.Firestore
    now: Date
    /** The build's gated operations for the job's site. */
    readOps: () => Promise<AiBuildOps>
  },
  deps: { refusal?: typeof aiSiteEventRefusal } = {},
): Promise<AiSiteEventPlanning | null> {
  const { job } = input
  if (job.kind !== 'site' || !job.hostId || !aiSiteEventLed(job)) return null
  try {
    const event = (await input.readOps()).get(AI_SITE_EVENT_OP)
    if (!event) return null
    const refused = await (deps.refusal ?? aiSiteEventRefusal)({ firestore: input.firestore, org: input.org, now: input.now, job })
    if (refused) return null
    const host = (await input.firestore.collection('hosts').doc(job.hostId).get()).data() ?? null
    return {
      ops: new Map([[AI_SITE_EVENT_OP, event]]),
      timeZone: aiSiteEventZone(input.org as { timeZone?: string } | null, host as { timeZone?: string } | null),
    }
  } catch (error) {
    // Events are a start's extra: a read that fails plans none, and the start goes on.
    console.warn('ai site events: not offered', { orgId: job.orgId, jobId: job.$id, error: String(error) })
    return null
  }
}

/** The lines a site plan's turn is told where it may plan events. */
export function aiSiteEventPlanLines(planning: AiSiteEventPlanning, now: Date): string[] {
  const event = planning.ops.get(AI_SITE_EVENT_OP)
  if (!event) return []
  const zone = planning.timeZone
  const args = Object.entries(event.argsSchema.properties).map(([name, property]) => {
    const required = event.argsSchema.required?.includes(name) ? '' : ' (optional)'
    return `${name}: ${property.type}${required} — ${property.description}`
  })
  return [
    `If this business holds dated events (a venue, a club, a studio's classes, a meetup, a church's services, a theater's shows), plan its first ${AI_SITE_EVENTS_MAX} upcoming events in items, each with op ${AI_SITE_EVENT_OP}, dated after today within the next two months, on days and at hours it would hold them. A day, date or time the brief gives is kept exactly as given; never date an event against it. If it holds none, leave items empty.`,
    zone
      ? `The business's time zone is ${zone}: every event's timezone is ${zone}.`
      : "Every event's timezone is the IANA zone of the business's city.",
    "Put every event's new:<name> in the uses of the one section that lists them, on the page about the events or else the home page: the platform lists them there. That section is one of the sections the plan already has, never an extra one.",
    `- ${event.op}: one event; ${event.intents[0] ?? 'a dated event'}. Args: { ${args.join('; ')} }.`,
    `Today is ${now.toISOString().slice(0, 10)} (UTC). Every event falls after today.`,
  ]
}

/**
 * What a site plan with events is held to (AGL-3755): its items are only
 * events, its first few, with arguments the operation's schema admits, each
 * named in a section's uses, and built after nothing.
 */
export function aiSiteEventItemsCheck(planning: AiSiteEventPlanning | null): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  return (plan) => {
    const items = plan.items ?? []
    if (!items.length) return []
    const event = planning?.ops.get(AI_SITE_EVENT_OP)
    const fail = (message: string): AiDoctrineViolation[] => [{ rule: null, code: 'plan-job-shape', message }]
    if (!event) return fail('This site plan makes no items: leave items empty.')
    const other = items.find((item) => item.op !== AI_SITE_EVENT_OP)
    if (other) return fail(`items[${items.indexOf(other)}] is "${other.op}": a site plan's items are only ${AI_SITE_EVENT_OP} items.`)
    if (items.length > AI_SITE_EVENTS_MAX) return fail(`Plan at most ${AI_SITE_EVENTS_MAX} events, not ${items.length}.`)
    const uses = new Set(plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses.map((ref) => ref.trim().toLowerCase()))))
    for (const [index, item] of items.entries()) {
      const problems = pluginAiCapabilityArgsProblems(event.argsSchema, item.args)
      if (problems.length) return fail(`items[${index}] ("${item.name}"): ${problems.join('; ')}.`)
      if (item.dependsOn.length) return fail(`items[${index}] ("${item.name}") depends on nothing: leave its dependsOn empty.`)
      if (!uses.has(`new:${item.name}`.trim().toLowerCase())) {
        return fail(`items[${index}] ("${item.name}") is listed nowhere: put new:${item.name} in the uses of the section that lists the events.`)
      }
    }
    return []
  }
}

/** The item an event unit's derived job carries. */
export function aiSiteEventItemOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiBuildItem | null {
  const raw = inputs?.[AI_SITE_EVENT_INPUT] as Partial<AiBuildItem> | undefined
  return raw && typeof raw.name === 'string' && raw.name.trim() && raw.args && typeof raw.args === 'object'
    ? (raw as AiBuildItem)
    : null
}

/** The events this start wrote, by their output's draft resource. */
function eventOutputs(outputs: readonly AiJobOutput[]): AiJobOutput[] {
  return outputs.filter((output) => output.resource === 'draft' && output.draftResource === AI_SITE_EVENT_RESOURCE)
}

/**
 * The site's events as its pages list them (AGL-3755): one `events` listing
 * naming the events this start wrote, placed in each section whose plan
 * names any of them. None where no event was written or no section names one.
 */
export function aiSiteEventListings(input: {
  outputs: readonly AiJobOutput[]
  items: readonly AiBuildItem[]
  screens: readonly AiLayoutListingScreen[]
}): AiLayoutListing[] {
  return aiEventsListings({
    written: eventOutputs(input.outputs).map((output) => output.label),
    planned: input.items.map((item) => item.name),
    screens: input.screens,
  })
}

/**
 * The `events` listing for events a job wrote (AGL-3755): placed in each
 * section whose plan names any event the job planned, naming the ones it
 * wrote. None where it wrote none or no section names one. A guided start's
 * and a build's alike.
 */
export function aiEventsListings(input: {
  written: readonly string[]
  planned: readonly string[]
  screens: readonly AiLayoutListingScreen[]
}): AiLayoutListing[] {
  const written = input.written.filter(Boolean)
  if (!written.length || !input.planned.length) return []
  const placements = aiLayoutEventsPlacements(input.planned, input.screens)
  if (!placements.length) return []
  return [
    {
      id: aiLayoutListingId('events'),
      kind: 'events',
      name: 'the events',
      records: written.slice(0, 12),
      placements,
    },
  ]
}

export interface AiSiteEventRunnerDeps {
  writerFor?: AiPluginDraftWriterLookup
  /** The `event` capability; the registry's otherwise. */
  capability?: () => PluginAiCapability | null
}

/**
 * An event unit's pass: the item's content from the owner's capability, the
 * site's own time zone over the plan's, held to the owner's check, and
 * written by the owner's writer as the member who started the job. No model
 * runs and nothing is spent.
 */
export function createAiSiteEventRunner(deps: AiSiteEventRunnerDeps = {}): AiJobStepRunner {
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  const capabilityOf = deps.capability ?? (() => pluginAiCapability(AI_SITE_EVENT_OP)?.capability ?? null)
  return async (context): Promise<AiJobStepOutcome> => {
    const { job } = context
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const unspent = aiUnspentOutcome(model)
    const item = aiSiteEventItemOf(job.inputs)
    const writer = writerFor(AI_SITE_EVENT_RESOURCE)
    const capability = capabilityOf()
    if (!item || !writer || !capability || !job.hostId) {
      return { ...unspent, failure: 'Events are not available on this site.' }
    }
    const host = (await context.firestore.collection('hosts').doc(job.hostId).get()).data() ?? null
    const zone = aiSiteEventZone(context.org as { timeZone?: string } | null, host as { timeZone?: string } | null)
    const content = {
      ...(capability.draftContent?.({ name: item.name, args: item.args }, { hostId: job.hostId, dependencies: {} }) ?? item.args),
      // The event lands in the business's own time zone where the site names one.
      ...(zone ? { timezone: zone } : {}),
    }
    const checked = writer.check(content, { hostId: job.hostId })
    if (checked.ok === false) return { ...unspent, failure: checked.problems[0] ?? 'The event could not be read.' }
    const written = await writer.write({
      orgId: job.orgId,
      hostId: job.hostId,
      uid: job.createdBy,
      org: (context.org ?? null) as Readonly<Record<string, unknown>> | null,
      now: context.now,
      act: { id: aiOriginJobId(job), business: aiSiteWords(job.inputs).about || job.brief || '' },
      id: job.$id,
      name: item.name,
      content,
    })
    if (written.ok === false) return { ...unspent, failure: written.error }
    return {
      ...unspent,
      outputs: [
        {
          resource: 'draft',
          id: written.id,
          versionId: written.versionId,
          hostId: job.hostId,
          label: written.name,
          draftResource: AI_SITE_EVENT_RESOURCE,
          note: aiBuildItemOutputNote(capability, written),
        },
      ],
    }
  }
}

export const runAiSiteEventUnit = createAiSiteEventRunner()

/** ASSUMED: an event's pass — one draft write and its cover photo's search and copy, no model. */
export const AI_SITE_EVENT_MINIMUM_MS = 45_000
