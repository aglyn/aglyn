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
  ACTION_MAX_CONDITIONS,
  ACTION_MAX_STEPS,
  HOST_ACTION_STEP_LABELS,
  type HostActionStep,
  type HostActionStepType,
  type HostActionTriggerCondition,
  TRIGGER_COMBINATORS,
  TRIGGER_CONDITION_OPS,
  type TriggerCombinator,
  validateHostAction,
} from '@aglyn/aglyn/app-utils/actions'
import {
  normalizeVisibleTo,
  type ScopeToken,
  visibleToHost,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import type { HostEventType } from '@aglyn/aglyn/app-utils/workflows'

/**
 * ORG AUTOMATIONS (AGL-3302): one automation the organization writes once and
 * places on the sites it chooses.
 *
 * A site's own actions stay where they are, at `hosts/{hostId}/actions`. They
 * are not moved here, and the reasons are the four things a site action can
 * do that an org automation must not:
 *
 *  - call the site's functions and variables through a workflow step — the
 *    working set a computed variable binds to, which is one site's;
 *  - run the steps only a visitor's page can run (overlays, drawers, class
 *    toggles, a redirect to a screen), which the `actions` collection also
 *    holds for element interactions;
 *  - be fired by `/api/events/dispatch`, which is unauthenticated and ties an
 *    action id to a site only by its path;
 *  - wait, with the resume beat reading a missing document as the kill
 *    switch, so a migration would stop every person already inside a flow.
 *
 * An org automation is therefore its own document with a narrower
 * vocabulary: triggers only the server raises, and steps that mean the same
 * thing on whichever site they run. Each run executes AS the site the event
 * happened on — that site's sender, suppressions, consent group, meters and
 * run allowance — so placing one automation on five sites is five sites each
 * running it for themselves, never one site acting for the others.
 *
 * Pure and client-safe: the console's editor, the server routes and the
 * engine read the same definitions from here.
 */

/** `orgs/{orgId}/automations/{automationId}`. */
export const ORG_AUTOMATIONS_COLLECTION = 'automations'

/**
 * The two server doors onto the collection, under the plugin's `automations`
 * API prefix: the organization's (`manage`) and a site's own pause
 * (`pause`). Named here so the console's caller and the server's registration
 * read one spelling.
 */
export const ORG_AUTOMATION_API_ROUTES = {
  manage: 'automations/manage',
  pause: 'automations/pause',
} as const

/**
 * How many live org automations one organization may hold.
 *
 * A flat platform cap in the shape `ACTIONS_MAX_PER_HOST` takes, and smaller,
 * because the two are different things: a site action is authored per site
 * and per element, where an org automation is a shared building block placed
 * on many sites at once. A hundred is far past what an organization writes by
 * hand and keeps the org hub's list — which reads every live one — a single
 * bounded window. Soft-deleted documents do not count.
 */
export const ORG_AUTOMATIONS_MAX = 100

/**
 * How many org automations one event may run on one site: the same fan-out
 * bound the site's own actions take (`MAX_TRIGGERED_ACTIONS`), counted
 * separately so the two cannot crowd each other out of the query.
 */
export const MAX_TRIGGERED_ORG_AUTOMATIONS = 10

/**
 * The run history's target type for a run of an org automation, on the
 * activity feed of the site it ran on.
 */
export const ORG_AUTOMATION_RUN_TARGET = 'orgAutomation'

/**
 * The org activity target an org automation's own lifecycle rows are filed
 * under: the plugin's namespaced resource (`pluginId:noun`), which the org's
 * feed reads as "Automation" — core's target list names only core's resources.
 */
export const ORG_AUTOMATION_ACTIVITY_TARGET = 'workflows:automation'

/**
 * The events an org automation may start on: every host event the SERVER
 * raises and a person can be the subject of.
 *
 * Listed rather than derived from `HOST_EVENT_TYPES`, deliberately. The engine
 * queries the organization's automations on every event in this list, so a
 * new host event must not become an org trigger — and a new read on every
 * occurrence of it — by being added to the platform's list. Two are left out
 * on purpose: `pageView` fires on every request to every published page, and
 * an org query on it would be a read per visitor; `memberSignOut` is raised
 * by no door today.
 */
export const ORG_AUTOMATION_TRIGGER_EVENTS = [
  'formSubmission',
  'lead',
  'contactCreated',
  'contactStageChanged',
  'booking',
  'memberSignUp',
  'memberSignIn',
  'dealStageChanged',
  'dealWon',
  'dealLost',
  'taskCompleted',
] as const satisfies readonly HostEventType[]

export type OrgAutomationTriggerEvent =
  (typeof ORG_AUTOMATION_TRIGGER_EVENTS)[number]

const ORG_TRIGGER_SET: ReadonlySet<string> = new Set(
  ORG_AUTOMATION_TRIGGER_EVENTS,
)

/** Whether an org automation may start on this event. */
export function isOrgAutomationTriggerEvent(
  event: unknown,
): event is OrgAutomationTriggerEvent {
  return typeof event === 'string' && ORG_TRIGGER_SET.has(event)
}

/**
 * The steps an org automation may hold: the server steps that read the same
 * on every site.
 *
 * What is left out, and why:
 *  - every step the visitor's page runs — overlays, drawers, menus, class
 *    toggles, custom HTML and JavaScript, analytics, redirects, the site
 *    alert — because an org trigger is a server event with no page to act on;
 *  - `runWorkflow`, because a workflow is one site's and calls that site's
 *    functions and variables;
 *  - `webhookPost`, because a webhook's address and secret are one site's.
 *
 * `customEvent` stays: it fires a custom event ON the site the run is on,
 * which that site's own actions may listen for — the documented way for an
 * org automation to hand over to something site-specific.
 */
export const ORG_AUTOMATION_STEP_TYPES = [
  'sendEmail',
  'notifyAdmins',
  'enrollList',
  'assignCampaign',
  'datasetAppend',
  'updateDataset',
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
  'customEvent',
  'wait',
  'waitForEvent',
  'exitFlow',
] as const satisfies readonly HostActionStepType[]

export type OrgAutomationStepType = (typeof ORG_AUTOMATION_STEP_TYPES)[number]

const ORG_STEP_SET: ReadonlySet<string> = new Set(ORG_AUTOMATION_STEP_TYPES)

/** Whether an org automation may run a step of this type. */
export function isOrgAutomationStepType(
  type: unknown,
): type is OrgAutomationStepType {
  return typeof type === 'string' && ORG_STEP_SET.has(type)
}

/** The org editor's "Do" picker: each allowed step with its label, in order. */
export const ORG_AUTOMATION_STEP_KINDS: ReadonlyArray<{
  value: OrgAutomationStepType
  label: string
}> = ORG_AUTOMATION_STEP_TYPES.map((value) => ({
  value,
  label: HOST_ACTION_STEP_LABELS[value],
}))

/**
 * Why an org automation cannot hold this step, or null when it can.
 *
 * Shared by the save route, which refuses it, and by the engine, which
 * refuses to run one a writer stored anyway.
 */
export function orgAutomationStepRefusal(step: {
  type?: unknown
}): string | null {
  if (isOrgAutomationStepType(step?.type)) return null
  const label = HOST_ACTION_STEP_LABELS[step?.type as HostActionStepType]
  if (!label) return `“${String(step?.type ?? '')}” is not a step`
  return (
    `“${label}” belongs to one site, so an org automation cannot run it — ` +
    'build it as an action on that site'
  )
}

/** The trigger an org automation starts on, as it is stored. */
export interface OrgAutomationTrigger {
  event: OrgAutomationTriggerEvent
  /** Optional expression over the payload; runs only when truthy. */
  filter?: string
  conditions: HostActionTriggerCondition[] | null
  combinator: TriggerCombinator | null
}

/**
 * The fields an org automation is written with — by the save route, and by
 * nothing else: the collection is closed to client writes.
 */
export interface OrgAutomationFields {
  name: string
  trigger: OrgAutomationTrigger
  steps: HostActionStep[]
  enabled: boolean
  /**
   * The sites it runs on, as scope tokens: `['org']` is every site of the
   * organization, now and later; `['host:{id}', …]` names up to thirty.
   */
  visibleTo: ScopeToken[]
}

/** `orgs/{orgId}/automations/{id}`, as it is stored. */
export interface OrgAutomation extends OrgAutomationFields {
  /**
   * The sites that have paused it for themselves — each a site id, never a
   * scope token. The "host level control": a site's admin or editor adds or
   * removes their own site here, and only their own.
   */
  pausedHostIds: string[]
  createdBy?: string
  updatedBy?: string
  /**
   * Set when it was deleted. Always written — `null` while live — so the
   * org hub's list can ask for the live ones by equality.
   */
  deletedAt: unknown
}

/** A stored org automation with its id, as the console lists it. */
export type OrgAutomationRow = OrgAutomation & { $id: string }

/** Longest name an org automation may carry: the actions editor's cap. */
export const ORG_AUTOMATION_NAME_MAX = 60

/** Longest trigger filter expression. */
const FILTER_MAX = 500

/** Longest a condition's field or value may be. */
const CONDITION_FIELD_MAX = 64
const CONDITION_VALUE_MAX = 200

/**
 * Every field a step of each type may carry beyond `type` and `when`, with
 * the longest a string in it may be. What the save route stores is exactly
 * this: a key a step's type does not list is dropped, so the document holds
 * the vocabulary and nothing a caller made up.
 *
 * The caps follow what the engine reads — it cuts a subject at 200 and a body
 * at 5,000 before sending — so nothing is stored that could not be run.
 */
const STEP_FIELDS: Record<
  OrgAutomationStepType,
  Readonly<Record<string, 'string' | 'number' | 'boolean' | number>>
> = {
  sendEmail: { subject: 200, body: 5000, toField: 64, topicId: 128 },
  notifyAdmins: { title: 200, body: 500 },
  enrollList: { listId: 128, listName: 200 },
  assignCampaign: { campaignId: 128, campaignName: 200 },
  datasetAppend: { datasetId: 128, datasetName: 200 },
  updateDataset: { datasetId: 128, datasetName: 200 },
  setContactStage: { lifecycleStage: 64 },
  addContactTag: { tag: 200 },
  assignContactOwner: {
    ownerUid: 128,
    ownerEmail: 320,
    roundRobin: 'boolean',
  },
  createCrmTask: {
    title: 200,
    kind: 64,
    dueInDays: 'number',
    assigneeUid: 128,
    assigneeEmail: 320,
  },
  logCrmActivity: { kind: 64, body: 2000 },
  customEvent: { eventName: 64 },
  wait: { delayMinutes: 'number' },
  waitForEvent: { eventName: 64, timeoutMinutes: 'number' },
  exitFlow: {},
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** A condition as it is stored, or null for a row that is not one. */
function readCondition(raw: unknown): HostActionTriggerCondition | null {
  const row = asObject(raw)
  if (!row) return null
  const op = row['op']
  if (!(TRIGGER_CONDITION_OPS as readonly unknown[]).includes(op)) {
    // Kept as written so the validator names the missing operator rather
    // than the row silently vanishing.
    return {
      field: String(row['field'] ?? '').trim().slice(0, CONDITION_FIELD_MAX),
      op: op as never,
    }
  }
  return {
    field: String(row['field'] ?? '').trim().slice(0, CONDITION_FIELD_MAX),
    op: op as HostActionTriggerCondition['op'],
    ...(op !== 'notEmpty'
      ? { value: String(row['value'] ?? '').trim().slice(0, CONDITION_VALUE_MAX) }
      : {}),
  }
}

function readConditions(raw: unknown): HostActionTriggerCondition[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, ACTION_MAX_CONDITIONS + 1)
    .map(readCondition)
    .filter((row): row is HostActionTriggerCondition => row !== null)
}

function readCombinator(raw: unknown): TriggerCombinator | null {
  return (TRIGGER_COMBINATORS as readonly unknown[]).includes(raw)
    ? (raw as TriggerCombinator)
    : null
}

/** One step as it would be stored: its own fields only, strings capped. */
function readStep(raw: unknown): HostActionStep | { type: unknown } {
  const source = asObject(raw) ?? {}
  const type = source['type']
  if (!isOrgAutomationStepType(type)) return { type }
  const step: Record<string, unknown> = { type }
  for (const [key, kind] of Object.entries(STEP_FIELDS[type])) {
    const value = source[key]
    if (value === undefined || value === null) continue
    if (kind === 'boolean') {
      if (typeof value === 'boolean') step[key] = value
    } else if (kind === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) step[key] = value
    } else if (typeof value === 'string') {
      step[key] = value.slice(0, Number(kind))
    }
  }
  const when = asObject(source['when'])
  if (when) {
    const conditions = readConditions(when['conditions'])
    if (conditions.length) {
      step['when'] = {
        conditions,
        combinator: readCombinator(when['combinator']) ?? 'and',
      }
    }
  }
  return step as HostActionStep
}

/** What a caller sends to create or replace an org automation. */
export type OrgAutomationInput = Record<string, unknown>

/**
 * Reads an org automation out of an untrusted request body: the fields it may
 * hold, in the shape they are stored, or the first reason it cannot be saved.
 *
 * The rules are the actions builder's own — `validateHostAction` checks the
 * name, the trigger's conditions and every step's fields — and on top of them
 * the two this vocabulary adds: the trigger must be an org trigger and every
 * step an org step. The placement must be a scope a save can store:
 * `normalizeVisibleTo` refuses an empty one and one over thirty sites rather
 * than guessing between sharing wider and taking access away.
 *
 * Whether each named site belongs to the organization is the route's to ask,
 * because it takes a read.
 */
export function readOrgAutomation(
  input: unknown,
): { ok: true; value: OrgAutomationFields } | { ok: false; problem: string } {
  const body = asObject(input) ?? {}
  const name = String(body['name'] ?? '')
    .trim()
    .slice(0, ORG_AUTOMATION_NAME_MAX)
  if (!name) return { ok: false, problem: 'Name the automation' }
  const trigger = asObject(body['trigger']) ?? {}
  const event = String(trigger['event'] ?? '').trim()
  if (!isOrgAutomationTriggerEvent(event)) {
    return {
      ok: false,
      problem:
        'Pick a trigger an org automation can start on — a form, a lead, a ' +
        'booking, a member or a CRM event',
    }
  }
  const filter = String(trigger['filter'] ?? '')
    .trim()
    .slice(0, FILTER_MAX)
  const conditions = readConditions(trigger['conditions'])
  const combinator = readCombinator(trigger['combinator'])
  const rawSteps = Array.isArray(body['steps']) ? body['steps'] : []
  if (rawSteps.length > ACTION_MAX_STEPS) {
    return {
      ok: false,
      problem: `Org automations are capped at ${ACTION_MAX_STEPS} steps`,
    }
  }
  const steps = rawSteps.map(readStep)
  for (const [index, step] of steps.entries()) {
    const refusal = orgAutomationStepRefusal(step)
    if (refusal) return { ok: false, problem: `Step ${index + 1}: ${refusal}` }
  }
  const problem = validateHostAction({
    name,
    trigger: {
      event,
      ...(filter ? { filter } : {}),
      ...(conditions.length ? { conditions } : {}),
      ...(combinator ? { combinator } : {}),
    },
    steps: steps as HostActionStep[],
  })
  if (problem) return { ok: false, problem }
  const visibleTo = normalizeVisibleTo(
    Array.isArray(body['visibleTo'])
      ? (body['visibleTo'] as unknown[]).filter(
          (token): token is string => typeof token === 'string',
        )
      : [],
  )
  if (!visibleTo) {
    return {
      ok: false,
      problem: 'Choose every site, or up to 30 sites, for it to run on',
    }
  }
  return {
    ok: true,
    value: {
      name,
      trigger: {
        event,
        ...(filter ? { filter } : {}),
        conditions: conditions.length ? conditions : null,
        combinator: conditions.length ? (combinator ?? 'and') : null,
      },
      steps: steps as HostActionStep[],
      enabled: body['enabled'] !== false,
      visibleTo,
    },
  }
}

/** A stored document's pause list, read defensively. */
export function orgAutomationPausedHostIds(
  automation: { pausedHostIds?: unknown } | null | undefined,
): string[] {
  const paused = automation?.pausedHostIds
  return Array.isArray(paused)
    ? paused.filter((id): id is string => typeof id === 'string')
    : []
}

/**
 * Why a stored org automation will not run on this site, or null when it
 * will — the one answer the engine asks when an event arrives and again when
 * a person waiting inside the automation is due.
 *
 * Deleted, switched off, taken off the site and paused there are the four
 * ways an organization or a site says "not here", and every one of them
 * stops the people already waiting on this site as well as the next run: the
 * kill switch a site action's resume applies, for the same reason.
 */
export function orgAutomationStopReason(
  automation:
    | {
        deletedAt?: unknown
        enabled?: unknown
        visibleTo?: unknown
        pausedHostIds?: unknown
      }
    | null
    | undefined,
  hostId: string,
): string | null {
  if (!automation || automation.deletedAt) {
    return 'the org automation was deleted'
  }
  if (automation.enabled === false) {
    return 'the org automation was switched off'
  }
  if (!visibleToHost(automation.visibleTo as string[] | undefined, hostId)) {
    return 'the org automation no longer runs on this site'
  }
  if (orgAutomationPausedHostIds(automation).includes(hostId)) {
    return 'the org automation is paused on this site'
  }
  return null
}

/** Whether a stored org automation runs on this site. */
export function orgAutomationRunsOnHost(
  automation: Parameters<typeof orgAutomationStopReason>[0],
  hostId: string,
): boolean {
  return orgAutomationStopReason(automation, hostId) === null
}

/**
 * A pause list after the placement changed: a site the automation no longer
 * runs on has nothing left to pause, so its entry goes with it, and a site
 * placed on it again later starts unpaused.
 */
export function prunePausedHostIds(
  pausedHostIds: readonly string[],
  visibleTo: readonly string[],
): string[] {
  return pausedHostIds.filter((hostId) => visibleToHost(visibleTo, hostId))
}
