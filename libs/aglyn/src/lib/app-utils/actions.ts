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
  CONTACT_TAG_MAX_LENGTH,
  type ContactLifecycleStage,
  CRM_TASK_MAX_DUE_DAYS,
  type CrmActivityKind,
  type CrmTaskKind,
  isContactLifecycleStage,
  isCrmActivityKind,
  isCrmTaskKind,
} from './crm-kinds'
import {
  type ClientInteractionStep,
  CUSTOM_EVENT_PATTERN,
  type InteractionCondition,
  type InteractionStepGuard,
  type InteractionTrigger,
  type SiteAlert,
  type SiteInteraction,
  type TriggerCombinator,
  validateInteraction,
} from './site-interactions'
import { HOST_EVENT_TYPES } from './host-events'
import { isKnownInteractionRecipe } from '../plugin-manager/interaction-recipes'

/**
 * Actions builder (AGL-148): HubSpot-style event → action automation on
 * top of the AGL-128 event triggers. An action listens for a host event
 * (built-in or a custom name fired by another action), optionally filters
 * on the payload, and runs an ordered step list. Pure types + validation
 * here; the executor lives in the workflows plugin, where the I/O is.
 *
 * An action is a SITE INTERACTION (`site-interactions.ts`) with server steps
 * added: its trigger, its conditions, its client steps and its storage are
 * the platform's, and are re-exported here for the readers that take both
 * from this module. What is declared below is the automation's own — the
 * server steps, flows and the stored shape. The recipes that open the editor
 * prefilled are the plugins' that write them (`interaction-recipes`).
 */
export * from './site-interactions'

/** The automation's names for the platform's interaction shapes. */
export type HostActionTriggerCondition = InteractionCondition
export type HostActionTrigger = InteractionTrigger
export type HostActionStepGuard = InteractionStepGuard
/** Alert produced by a `siteAlert` step, surfaced to the emitting client. */
export type HostActionAlert = SiteAlert

/**
 * The scope key a resumed flow carries to say the wait ended on the CLOCK
 * rather than on the event it was watching for.
 *
 * This is how a `waitForEvent` gets its timeout branch without a nested step
 * list: the flow resumes either way, and the step after it carries a `when`
 * naming this field. Underscored because it shares a namespace with the
 * event payload's own fields, which are merchant-authored form field names.
 */
export const FLOW_TIMED_OUT_FIELD = '_waitTimedOut'

/** The steps an automation adds to the platform's client steps: the server's, run by the workflows plugin. */
type ServerActionStep = (
  // Entity references carry a doc id (AGL-261, rename-safe) with the name
  // kept as a display hint; pre-AGL-261 docs have only the name and the
  // executor resolves either.
  | { type: 'runWorkflow'; workflowId?: string; workflowName?: string }
  | { type: 'customEvent'; eventName: string }
  | { type: 'datasetAppend'; datasetId?: string; datasetName?: string }
  | { type: 'webhookPost'; webhookId?: string; webhookName?: string }
  // Server-side steps (AGL-257).
  | {
      type: 'sendEmail'
      subject: string
      body: string
      toField?: string
      /**
       * The stream this message belongs to, so a recipient who left it is not
       * mailed. Absent on every step authored before topics reached the
       * actions editor, which the executor resolves to the default topic.
       */
      topicId?: string
    }
  | { type: 'notifyAdmins'; title: string; body?: string }
  | { type: 'enrollList'; listId?: string; listName?: string }
  | { type: 'updateDataset'; datasetId?: string; datasetName?: string }
  | { type: 'assignCampaign'; campaignId?: string; campaignName?: string }
  /*
   * THE THREE FLOW STEPS.
   *
   * `wait` is the one that matters: without a durable delay an automation is
   * always trigger → immediate actions, so no welcome series, win-back or
   * post-purchase follow-up can exist at all. The other two are what make a
   * delay useful — something to end the flow early, and a wait that ends on
   * an event instead of on the clock.
   *
   * All three are SERVER steps. A delay outlives the page view that started
   * it by days, so the browser that fired the trigger is long gone by the time
   * the flow continues; `hostActionStepsForClient` truncates the client's copy
   * of the step list at the first of these for that reason.
   */
  | {
      type: 'wait'
      /** Whole minutes to hold before the next step. */
      delayMinutes: number
    }
  | {
      type: 'waitForEvent'
      /** The host or custom event that resumes this person's flow. */
      eventName: string
      /**
       * Whole minutes after which the flow continues anyway, with
       * {@link FLOW_TIMED_OUT_FIELD} true in scope. There is always a
       * deadline: a wait with no timeout is an enrollment that lives forever.
       */
      timeoutMinutes: number
    }
  /** Ends the enrollment here. Paired with a `when`, this is the exit branch. */
  | { type: 'exitFlow' }
  /*
   * THE CRM STEPS (AGL-2605).
   *
   * Server steps, every one, because each writes a record only the Admin
   * SDK may write on a visitor's behalf. Each acts on ONE person — the
   * contact the event names, resolved by `contactId` when the payload
   * carries one and by `email` otherwise — and each writes inside the
   * site's own facet or stamps the site's own scope, for the reason
   * `assignCampaign` gives: a contact row is shared by every site in the
   * org, and a stage or a tag is one holder's business record. A step whose
   * event names nobody the site can see does nothing and says so in the run.
   *
   * None of them carries a doc-id reference for the reference audit to
   * check: a stage and a kind are fixed vocabularies, a tag is free text,
   * and an owner is a member who is resolved at run time.
   */
  | { type: 'setContactStage'; lifecycleStage: ContactLifecycleStage }
  | { type: 'addContactTag'; tag: string }
  /**
   * The owner by uid when a member id was typed or a picker wrote the step,
   * by email when an address was typed; the executor resolves either against
   * the org's roster, and only the roster (AGL-2614).
   * Or `roundRobin`, and the owner is the next member of the pool the CRM's
   * settings keep (AGL-2618) — a step that names nobody and hands the
   * choice to the rotation, so a stage change can spread its follow-ups
   * across a team rather than pile them on one rep. The two are exclusive:
   * a rotation step carries no member, and the validator refuses one that
   * names both.
   */
  | {
      type: 'assignContactOwner'
      ownerUid?: string
      ownerEmail?: string
      roundRobin?: boolean
    }
  | {
      type: 'createCrmTask'
      title: string
      kind: CrmTaskKind
      /** Days from the run to the due date; `0` is due today. */
      dueInDays: number
      /**
       * Who gets it — by uid or by an address, both resolved against the
       * roster the way the owner step's are. Neither named, the task goes
       * to the contact's owner, then to nobody.
       */
      assigneeUid?: string
      assigneeEmail?: string
    }
  | { type: 'logCrmActivity'; kind: CrmActivityKind; body: string }
) & {
  /** See {@link InteractionStepGuard}. Absent means the step always runs. */
  when?: InteractionStepGuard | null
}

/** A step of an automation: one of the platform's client steps, or one of its server steps. */
export type HostActionStep = ClientInteractionStep | ServerActionStep

/**
 * The steps that suspend a run and continue it later, from a job beat.
 *
 * Named as a set rather than checked inline because three surfaces have to
 * agree on it: the executor stops here and writes an enrollment, the client
 * payload is truncated here, and the validator refuses a flow that waits
 * without a person to wait for.
 */
export const FLOW_SUSPENDING_STEP_TYPES: ReadonlySet<HostActionStepType> =
  new Set(['wait', 'waitForEvent'] as const)

export function isFlowSuspendingStep(step: HostActionStep): boolean {
  return FLOW_SUSPENDING_STEP_TYPES.has(step.type)
}

/**
 * The recipe a STORED action came from, read off its document (AGL-2639).
 *
 * Three answers, and the third is the one that matters. A known id: the
 * action was installed from, or begun as, that recipe — one a plugin declares
 * or registered (`isKnownInteractionRecipe`). `null`: the action
 * was begun blank, or from a recipe this build no longer knows — the
 * editor wrote the field and said "no recipe". `undefined`: the document
 * carries no `recipe` field at all, which is every action saved before the
 * stamp existed. Such an action may well have started from a recipe — the
 * menu opened the editor prefilled long before anything recorded it — so a
 * reader that needs to know whether a site has a recipe treats `undefined`
 * as UNKNOWN, never as absent, and never writes a `null` over it.
 */
export function hostActionRecipeId(
  action: { recipe?: unknown } | null | undefined,
): string | null | undefined {
  const stamp = action?.recipe
  if (stamp === undefined) return undefined
  return isKnownInteractionRecipe(stamp) ? stamp : null
}

/**
 * A HostAction as the document at `hosts/{hostId}/actions/{id}` holds it.
 *
 * Every optional trigger key is written OUT — a boolean cap as `false`, a
 * cleared list as `null` — because the editor saves with a merge-set, and
 * a merge keeps whatever key the payload omits: a frequency cap switched
 * off, left out of the payload, would stay on. The legacy single
 * `condition` is always nulled; `conditions` has been canonical since the
 * list shape arrived and a document that carried both would have the
 * reader pick. Everything else is the action, unchanged.
 *
 * `recipe` rides along only when the action SAYS something about it: an
 * id or `null`. An action that carries no stamp (an older document, edited
 * and saved again) keeps carrying none — see {@link hostActionRecipeId}
 * for why an absent stamp must not become a `null` one.
 */
export interface HostActionDocument extends HostAction {
  trigger: HostActionTrigger & {
    oncePerVisitor: boolean
    oncePerSession: boolean
    cooldownMinutes: number | null
    everyTime: boolean
    condition: null
    conditions: HostActionTriggerCondition[] | null
    combinator: TriggerCombinator | null
  }
  enabled: boolean
}

export function hostActionDocument(action: HostAction): HostActionDocument {
  const { recipe, ...rest } = action
  const trigger = action.trigger
  return {
    ...rest,
    trigger: {
      ...trigger,
      oncePerVisitor: trigger.oncePerVisitor === true,
      oncePerSession: trigger.oncePerSession === true,
      cooldownMinutes:
        Number(trigger.cooldownMinutes) >= 1 ? Number(trigger.cooldownMinutes) : null,
      everyTime: trigger.everyTime === true,
      condition: null,
      conditions: trigger.conditions ?? null,
      combinator: trigger.combinator ?? null,
    },
    enabled: action.enabled !== false,
    ...(recipe !== undefined ? { recipe } : {}),
  }
}

/**
 * The step list as the visitor's browser may see it.
 *
 * A client step AFTER a wait must never reach the page. The client engine
 * runs its slice of the list immediately, so shipping the whole list would
 * make "wait three days, then show the popup" show the popup at once — the
 * delay would appear to work on the server, be ignored in the browser, and
 * the two halves of one authored flow would disagree about when it happened.
 *
 * Truncating rather than filtering: everything past the first wait belongs to
 * a run that has not happened yet, whichever side would have executed it.
 */
export function hostActionStepsForClient(
  steps: readonly HostActionStep[] | undefined | null,
): HostActionStep[] {
  const list = steps ?? []
  const suspendAt = list.findIndex(isFlowSuspendingStep)
  return [...(suspendAt < 0 ? list : list.slice(0, suspendAt))]
}

export type HostActionStepType = HostActionStep['type']

/**
 * `hosts/{hostId}/actions/{id}` doc: a site interaction whose steps may be
 * the automation's server steps as well as the platform's client steps.
 */
export interface HostAction extends SiteInteraction<HostActionStep> {
  /**
   * The recipe this action was installed from or begun as (AGL-2639), or
   * `null` for one begun blank. Absent on a document from before the stamp
   * existed — read it through {@link hostActionRecipeId}, which keeps the
   * three cases apart.
   */
  recipe?: string | null
}

/**
 * The shortest and longest a flow may wait.
 *
 * The floor is a minute because the resume beat runs on a minute, so anything
 * under one is a delay the scheduler cannot honor and would only read as
 * imprecision. The ceiling is ninety days: long enough for the win-back that
 * is the longest sequence anybody writes, and short enough that an enrollment
 * is not an unbounded lease on a document. A person waiting inside a flow is
 * storage the merchant is not looking at, and a wait measured in years is
 * indistinguishable from one nobody will ever collect.
 */
export const FLOW_WAIT_MIN_MINUTES = 1
export const FLOW_WAIT_MAX_MINUTES = 90 * 24 * 60

export const HOST_ACTION_STEP_LABELS: Record<HostActionStepType, string> = {
  runWorkflow: 'Run a workflow',
  siteAlert: 'Show a site alert',
  customEvent: 'Fire a custom event',
  datasetAppend: 'Write to a dataset',
  webhookPost: 'Send a webhook (Business)',
  showOverlay: 'Show a popup or bar',
  stickyNav: 'Make navigation sticky',
  addClass: 'Add a CSS class',
  toggleClass: 'Toggle a CSS class',
  removeClass: 'Remove a CSS class',
  showElement: 'Show an element',
  hideElement: 'Hide an element',
  toggleElement: 'Show/hide an element',
  openDrawer: 'Open a drawer',
  closeDrawer: 'Close a drawer',
  toggleDrawer: 'Open/close a drawer',
  openMenu: 'Open a menu',
  closeMenu: 'Close a menu',
  toggleMenu: 'Open/close a menu',
  setAttribute: 'Set an ARIA or data attribute',
  removeAttribute: 'Remove an ARIA or data attribute',
  scrollTo: 'Scroll to element',
  playVideo: 'Play a video',
  showHtml: 'Show custom HTML',
  runJs: 'Run custom JS (Business)',
  redirect: 'Redirect the visitor',
  trackGaEvent: 'Track an analytics event',
  sendEmail: 'Send an email',
  notifyAdmins: 'Notify site admins',
  enrollList: 'Enroll in a list',
  updateDataset: 'Update a dataset record',
  assignCampaign: 'Assign to a campaign',
  wait: 'Wait',
  waitForEvent: 'Wait for something to happen',
  exitFlow: 'End the flow here',
  setContactStage: 'Set the contact’s lifecycle stage',
  addContactTag: 'Tag the contact',
  assignContactOwner: 'Assign the contact an owner',
  createCrmTask: 'Create a CRM task',
  logCrmActivity: 'Log a CRM activity',
}

/** A whole number of minutes inside the wait band. */
export function isFlowWaitMinutes(value: unknown): boolean {
  return (
    Number.isInteger(value) &&
    (value as number) >= FLOW_WAIT_MIN_MINUTES &&
    (value as number) <= FLOW_WAIT_MAX_MINUTES
  )
}

/** True for a custom (non-built-in) event name an action may fire. */
export function isCustomEventName(event: string): boolean {
  return (
    !HOST_EVENT_TYPES.includes(event as any) &&
    CUSTOM_EVENT_PATTERN.test(event)
  )
}

/**
 * Validates an action doc shape; returns a human-readable error or null.
 * Server and console share this so bad steps never persist or run.
 */
export function validateHostAction(action: HostAction): string | null {
  if (!action.name?.trim()) return 'Name the action'
  // A stamp is provenance, and provenance naming a recipe that does not
  // exist is a document nothing can read back; `null` and absent both pass.
  if (action.recipe != null && !isKnownInteractionRecipe(action.recipe)) {
    return 'Unknown recipe'
  }
  // The trigger, the step guards, the client steps and every declared step's
  // pick are the platform's to check; the server steps are this module's.
  return validateInteraction(action, {
    validateStep: (step, label) => serverStepProblem(step as HostActionStep, label),
  })
}

/**
 * A server step's own complaint, or null. A `runWorkflow` step's pick is
 * checked with every other declared step's (`interactionSteps` in
 * `plugins.config.json`), by `validateInteraction`.
 */
function serverStepProblem(step: HostActionStep, label: string): string | null {
  if (step.type === 'wait' && !isFlowWaitMinutes(step.delayMinutes)) {
    return `${label}: wait between ${FLOW_WAIT_MIN_MINUTES} minute and ${FLOW_WAIT_MAX_MINUTES} minutes`
  }
  if (step.type === 'waitForEvent') {
    const waited = step.eventName?.trim() ?? ''
    if (
      !waited ||
      (!HOST_EVENT_TYPES.includes(waited as any) && !isCustomEventName(waited))
    ) {
      return `${label}: pick the event to wait for`
    }
    if (!isFlowWaitMinutes(step.timeoutMinutes)) {
      return `${label}: give up after ${FLOW_WAIT_MIN_MINUTES}–${FLOW_WAIT_MAX_MINUTES} minutes`
    }
  }
  if (step.type === 'customEvent') {
    if (!isCustomEventName(step.eventName?.trim() ?? '')) {
      return `${label}: custom event names are 2–40 letters, digits, dashes`
    }
  }
  if (
    step.type === 'datasetAppend' &&
    !step.datasetId?.trim() &&
    !step.datasetName?.trim()
  ) {
    return `${label}: pick a dataset`
  }
  if (
    step.type === 'webhookPost' &&
    !step.webhookId?.trim() &&
    !step.webhookName?.trim()
  ) {
    return `${label}: pick a webhook`
  }
  if (step.type === 'sendEmail') {
    if (!step.subject?.trim()) return `${label}: enter the subject`
    if (!step.body?.trim()) return `${label}: enter the email body`
  }
  if (step.type === 'notifyAdmins' && !step.title?.trim()) {
    return `${label}: enter the notification title`
  }
  if (
    step.type === 'enrollList' &&
    !step.listId?.trim() &&
    !step.listName?.trim()
  ) {
    return `${label}: pick a list`
  }
  if (
    step.type === 'updateDataset' &&
    !step.datasetId?.trim() &&
    !step.datasetName?.trim()
  ) {
    return `${label}: pick a dataset`
  }
  if (
    step.type === 'assignCampaign' &&
    !step.campaignId?.trim() &&
    !step.campaignName?.trim()
  ) {
    return `${label}: pick a campaign`
  }
  // CRM steps (AGL-2605). A stage or a kind outside its vocabulary is
  // refused here rather than stored: the executor treats the value as
  // trusted and would write it into a facet every stage report counts.
  if (
    step.type === 'setContactStage' &&
    !isContactLifecycleStage(step.lifecycleStage)
  ) {
    return `${label}: pick a lifecycle stage`
  }
  if (step.type === 'addContactTag') {
    const tag = step.tag?.trim() ?? ''
    if (!tag) return `${label}: enter the tag`
    if (tag.length > CONTACT_TAG_MAX_LENGTH) {
      return `${label}: tags are at most ${CONTACT_TAG_MAX_LENGTH} characters`
    }
  }
  if (step.type === 'assignContactOwner') {
    const named = Boolean(step.ownerUid?.trim() || step.ownerEmail?.trim())
    if (step.roundRobin === true && named) {
      return `${label}: pick round robin or a member, not both`
    }
    if (
      step.roundRobin !== true &&
      !step.ownerUid?.trim() &&
      !step.ownerEmail?.trim().includes('@')
    ) {
      return `${label}: enter the owner’s email address`
    }
  }
  if (step.type === 'createCrmTask') {
    if (!step.title?.trim()) return `${label}: give the task a title`
    if (!isCrmTaskKind(step.kind)) return `${label}: pick the kind of task`
    if (
      !Number.isInteger(step.dueInDays) ||
      step.dueInDays < 0 ||
      step.dueInDays > CRM_TASK_MAX_DUE_DAYS
    ) {
      return `${label}: due in 0–${CRM_TASK_MAX_DUE_DAYS} days`
    }
    // Optional — but an address that is not one would resolve to nobody at
    // run time, and the task would land unassigned with no word why.
    const assigneeEmail = step.assigneeEmail?.trim() ?? ''
    if (assigneeEmail && !assigneeEmail.includes('@')) {
      return `${label}: enter the assignee’s email address`
    }
  }
  if (step.type === 'logCrmActivity') {
    if (!isCrmActivityKind(step.kind)) {
      return `${label}: pick the kind of activity`
    }
    if (!step.body?.trim()) return `${label}: write what happened`
  }
  return null
}

/** The most webhooks one site keeps; the site create route enforces it. */
export const WEBHOOK_MAX_PER_HOST = 5
