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
} from '@aglyn/aglyn/app-utils/crm-kinds'
import type { CrmActivityDirection, CrmTaskPriority } from '@aglyn/aglyn/app-utils/crm'
import { HOST_EVENT_TYPES, hostEventRecipientActed } from '@aglyn/aglyn/app-utils/host-events'
import {
  CLIENT_ACTION_STEP_TYPES,
  type ClientInteractionStep,
  CUSTOM_EVENT_PATTERN,
  type InteractionCondition,
  type InteractionStepBase,
  type InteractionStepGuard,
  interactionStepLabel,
  type InteractionTrigger,
  type SiteAlert,
  type SiteInteraction,
  validateInteraction,
} from '@aglyn/aglyn/app-utils/site-interactions'

/** A task's priorities, by meaning (AGL-3517) — the `taskPriority` picklist's meanings. */
const TASK_PRIORITIES: readonly (CrmTaskPriority | undefined)[] = ['low', 'normal', 'high']

/** The directions a logged call or email takes (AGL-3517) — `CRM_ACTIVITY_DIRECTIONS`. */
const ACTIVITY_DIRECTIONS: Partial<Record<CrmActivityKind, readonly (CrmActivityDirection | undefined)[]>> = {
  call: ['outbound', 'inbound', 'internal'],
  email: ['outbound', 'inbound'],
}
/**
 * THE AUTOMATION VOCABULARY (AGL-148): HubSpot-style event → action
 * automation on top of the AGL-128 event triggers. An action listens for a
 * host event (built-in or a custom name fired by another action), optionally
 * filters on the payload, and runs an ordered step list. Pure types and
 * validation; the engine that runs them is this plugin's (`engine/`).
 *
 * An action is a SITE INTERACTION (core `site-interactions.ts`) with server
 * steps added: its trigger, its conditions, its client steps, its stored shape
 * (`siteInteractionDocument`), the slice a visitor's page receives
 * (`interactionStepsForClient`) and its recipe stamp are the platform's. What
 * is declared below is the automation's own — the server steps' shapes, the
 * flow's bounds and each server step's checks. How each step is named, which
 * steps hold a run and which fields a person types words into are declared in
 * `plugins.config.json` (`interactionSteps`), so a page, a drafter and a
 * validator read them without loading this plugin; the checks are registered
 * from this plugin's declarations (`interaction-step-checks`).
 */

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
 * Declared as the step's `holds.timeoutField` for readers that do not load
 * this plugin; this plugin's spec holds the two equal.
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
      /**
       * A TRANSACTIONAL REPLY (AGL-3458): the message answers what the
       * recipient just did — submitted a form, booked, signed up — so it goes
       * out with no unsubscribe header and no unsubscribe link, the way the
       * Inbox's reply to a submission does. Only a step that qualifies can be
       * one ({@link sendEmailReplyIneligibility}); absent reads as on for a
       * qualifying step, and `false` sends it as a mailing anyway.
       */
      transactional?: boolean
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
   * the flow continues; `interactionStepsForClient` truncates the client’s copy
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
      /** The task's Type, by meaning; the run stores the org's label for it (AGL-3517). */
      kind: CrmTaskKind
      /** Its Priority, by meaning — `normal` when absent. */
      priority?: CrmTaskPriority
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
  | {
      type: 'logCrmActivity'
      kind: CrmActivityKind
      body: string
      /** Which way a call or an email went (AGL-3517); no other kind takes one. */
      direction?: CrmActivityDirection
    }
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
 * without a person to wait for. A visitor's page and a drafter read the same
 * fact from each step's declaration (`holds`, `interactionSteps` in
 * `plugins.config.json`), which this plugin's spec holds to this set.
 */
export const FLOW_SUSPENDING_STEP_TYPES: ReadonlySet<HostActionStepType> =
  new Set(['wait', 'waitForEvent'] as const)

export function isFlowSuspendingStep(step: HostActionStep): boolean {
  return FLOW_SUSPENDING_STEP_TYPES.has(step.type)
}

/**
 * Whether the step at `index` runs after a wait — a `wait` or a
 * `waitForEvent` earlier in the list — and so on the business's schedule
 * rather than as the immediate response to the event.
 */
export function stepRunsAfterWait(
  steps: readonly HostActionStep[] | null | undefined,
  index: number,
): boolean {
  return (steps ?? []).slice(0, Math.max(0, index)).some(isFlowSuspendingStep)
}

/**
 * Why a `sendEmail` step cannot be a TRANSACTIONAL REPLY (AGL-3458), or
 * `null` when it can.
 *
 * A reply answers what the recipient just did, so all four have to hold:
 *
 *  - `event` — the trigger is the recipient's own action: a form submitted,
 *    a booking, a sign-up, a new lead (`recipientActed` on the event's
 *    declaration). A stage change or a won deal is the business acting.
 *  - `wait` — the step runs at once. After a wait it goes out on the
 *    business's schedule, to somebody who did one thing once, which is a
 *    mailing (`marketing-send.ts`).
 *  - `topic` — the step names no email topic. A topic is a stream somebody
 *    can leave, which only a mailing belongs to.
 *  - `recipient` — it goes to the address the event carries, the person who
 *    acted, rather than through `toField` to somebody else.
 */
export type SendEmailReplyIneligibility = 'event' | 'wait' | 'topic' | 'recipient'

export function sendEmailReplyIneligibility(
  step: Pick<Extract<HostActionStep, { type: 'sendEmail' }>, 'type' | 'topicId' | 'toField'>,
  context: { event: string | null | undefined; afterWait: boolean },
): SendEmailReplyIneligibility | null {
  if (!hostEventRecipientActed(context.event)) return 'event'
  if (context.afterWait) return 'wait'
  if (String(step.topicId ?? '').trim()) return 'topic'
  const toField = String(step.toField ?? '').trim()
  if (toField && toField !== 'email') return 'recipient'
  return null
}

/** What the editor and the validator say about each — see {@link sendEmailReplyIneligibility}. */
export const SEND_EMAIL_REPLY_INELIGIBLE_REASONS: Record<SendEmailReplyIneligibility, string> = {
  event:
    'only a reply to the person’s own form submission, booking or sign-up can be ' +
    'transactional',
  wait: 'an email after a wait is a mailing, so it keeps its unsubscribe link',
  topic: 'an email in a topic is a mailing, so it keeps its unsubscribe link',
  recipient: 'only an email to the person who acted can be a transactional reply',
}

/**
 * Whether a `sendEmail` step goes out as a transactional reply: it qualifies,
 * and its author did not switch the reply off. Absent is ON for a step that
 * qualifies, so the auto-reply a site already sends to a form becomes one
 * without anybody editing it.
 */
export function sendEmailIsTransactionalReply(
  step: Pick<
    Extract<HostActionStep, { type: 'sendEmail' }>,
    'type' | 'topicId' | 'toField' | 'transactional'
  >,
  context: { event: string | null | undefined; afterWait: boolean },
): boolean {
  return step.transactional !== false && sendEmailReplyIneligibility(step, context) === null
}

export type HostActionStepType = HostActionStep['type']

/**
 * `hosts/{hostId}/actions/{id}` doc: a site interaction whose steps may be
 * the automation's server steps as well as the platform's client steps.
 */
export type HostAction = SiteInteraction<HostActionStep>

/**
 * The shortest and longest a flow may wait.
 *
 * The floor is a minute because the resume beat runs on a minute, so anything
 * under one is a delay the scheduler cannot honor and would only read as
 * imprecision. The ceiling is ninety days: long enough for the win-back that
 * is the longest sequence anybody writes, and short enough that an enrollment
 * is not an unbounded lease on a document. A person waiting inside a flow is
 * storage the merchant is not looking at, and a wait measured in years is
 * indistinguishable from one nobody will ever collect. Declared as the band
 * each waiting step `holds`; this plugin's spec holds the two equal.
 */
export const FLOW_WAIT_MIN_MINUTES = 1
export const FLOW_WAIT_MAX_MINUTES = 90 * 24 * 60

/**
 * Every step an action may hold, in the order the editor's "Do" picker offers
 * them. Total over the step types: a type the vocabulary gains is a compile
 * error here until it is placed.
 */
const STEP_ORDER: Readonly<Record<HostActionStepType, number>> = {
  runWorkflow: 0,
  siteAlert: 1,
  customEvent: 2,
  datasetAppend: 3,
  webhookPost: 4,
  showOverlay: 5,
  stickyNav: 6,
  addClass: 7,
  toggleClass: 8,
  removeClass: 9,
  showElement: 10,
  hideElement: 11,
  toggleElement: 12,
  openDrawer: 13,
  closeDrawer: 14,
  toggleDrawer: 15,
  openMenu: 16,
  closeMenu: 17,
  toggleMenu: 18,
  setAttribute: 19,
  removeAttribute: 20,
  scrollTo: 21,
  playVideo: 22,
  showHtml: 23,
  runJs: 24,
  redirect: 25,
  trackGaEvent: 26,
  sendEmail: 27,
  notifyAdmins: 28,
  enrollList: 29,
  updateDataset: 30,
  assignCampaign: 31,
  wait: 32,
  waitForEvent: 33,
  exitFlow: 34,
  setContactStage: 35,
  addContactTag: 36,
  assignContactOwner: 37,
  createCrmTask: 38,
  logCrmActivity: 39,
}

/** Every step type an action may hold, in the picker's order. */
export const HOST_ACTION_STEP_TYPES: readonly HostActionStepType[] = (
  Object.keys(STEP_ORDER) as HostActionStepType[]
).sort((a, b) => STEP_ORDER[a] - STEP_ORDER[b])

/** The server steps among them: every type that is not one of the platform's client steps. */
export const SERVER_ACTION_STEP_TYPES: readonly HostActionStepType[] = HOST_ACTION_STEP_TYPES.filter(
  (type) => !CLIENT_ACTION_STEP_TYPES.has(type),
)

/**
 * How each step reads in the editor's picker, a run history and a sentence:
 * the platform's label for a client step, and the label its declaration
 * gives every other (`interactionSteps` in `plugins.config.json`), so a page,
 * a drafter and this editor name a step alike.
 */
export const HOST_ACTION_STEP_LABELS: Readonly<Record<HostActionStepType, string>> =
  Object.fromEntries(
    HOST_ACTION_STEP_TYPES.map((type) => [type, interactionStepLabel(type) ?? type]),
  ) as Record<HostActionStepType, string>

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
  // The name, the recipe stamp, the trigger, the step guards, the client
  // steps and every declared step's pick are the platform's to check; the
  // server steps are this module's.
  const problem = validateInteraction(action, {
    validateStep: (step, label) => hostActionStepProblem(step, label),
  })
  if (problem) return problem
  /*
   * A step SWITCHED to a transactional reply has to be one (AGL-3458). The
   * executor would send it as a mailing anyway — the unsubscribe is never
   * dropped from mail that is not a reply — so saving the switch would show
   * an author a promise the run does not keep.
   */
  const steps = action.steps ?? []
  for (const [index, step] of steps.entries()) {
    if (step.type !== 'sendEmail' || step.transactional !== true) continue
    const why = sendEmailReplyIneligibility(step, {
      event: action.trigger?.event,
      afterWait: stepRunsAfterWait(steps, index),
    })
    if (why) return `Step ${index + 1}: ${SEND_EMAIL_REPLY_INELIGIBLE_REASONS[why]}`
  }
  return null
}

/**
 * A server step's own complaint, or null. A `runWorkflow` step's pick is
 * checked with every other declared step's (`interactionSteps` in
 * `plugins.config.json`), by `validateInteraction`.
 *
 * Registered from this plugin's declarations as the check of every server
 * step (`interaction-step-checks`), so a plugin that writes an automation it
 * does not edit — a recipe installed into a site — refuses what this editor
 * would.
 */
export function hostActionStepProblem(candidate: InteractionStepBase, label: string): string | null {
  const step = candidate as HostActionStep
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
    if (!isCrmTaskKind(step.kind)) return `${label}: pick the type of task`
    if (step.priority !== undefined && !TASK_PRIORITIES.includes(step.priority)) {
      return `${label}: pick the task’s priority`
    }
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
    if (step.direction !== undefined) {
      const directions = ACTIVITY_DIRECTIONS[step.kind] ?? []
      if (!directions.includes(step.direction)) {
        return directions.length
          ? `${label}: pick which way the ${step.kind} went`
          : `${label}: only a call or an email takes a direction`
      }
    }
    if (!step.body?.trim()) return `${label}: write what happened`
  }
  return null
}
