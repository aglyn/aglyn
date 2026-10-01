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
import { HOST_EVENT_TYPES, hostEventRecipientActed } from './host-events'

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
 * server steps, flows, recipes and webhooks.
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
  step: Pick<Extract<HostActionStep, { type: 'sendEmail' }>, 'topicId' | 'toField'>,
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
  step: Pick<Extract<HostActionStep, { type: 'sendEmail' }>, 'topicId' | 'toField' | 'transactional'>,
  context: { event: string | null | undefined; afterWait: boolean },
): boolean {
  return step.transactional !== false && sendEmailReplyIneligibility(step, context) === null
}

/** Longest tag an automation may write — the console's own tag field cap. */
export const CONTACT_TAG_MAX_LENGTH = 60

/*
 * THE RECIPES (AGL-2626).
 *
 * A recipe is a ready-to-edit action — a trigger, its conditions and an
 * ordered step list — built from the vocabulary the editor already offers
 * and handed to the editor as a draft. Nothing is written until the person
 * saves, and every field is theirs to change first: the recipe decides
 * where the editor starts, not what the site runs.
 *
 * Defined here, beside the step catalog, rather than in the builder, so the
 * docs page that lists the recipes and the menu that offers them read ONE
 * list, and so a step the catalog renames or retires breaks a recipe at
 * compile time rather than in a menu nobody tests.
 *
 * Definitions only. Three of the four are complete as written. `tagByForm`
 * needs a form, and a form belongs to a site (`hosts/{hostId}/forms`), so
 * the picker that supplies it is the builder's business and host-scoped by
 * nature. That is the seam an org-level mount keeps: the recipes are the
 * same at either level, and only the form picker knows where it is.
 */
export const CRM_ACTION_RECIPE_IDS = [
  'welcomeNewLead',
  'followUpWonDeal',
  'reengageStaleLead',
  'tagByForm',
] as const

export type CrmActionRecipeId = (typeof CRM_ACTION_RECIPE_IDS)[number]

/** What a recipe is handed before it builds — today only the form `tagByForm` reads. */
export interface CrmActionRecipeInput {
  form?: {
    id: string
    name: string
    /**
     * Whether the form files its people as LEADS (`routing.lead`, AGL-3458).
     * Such a form makes a lead and no contact, so a recipe keyed on it
     * listens for a new lead rather than a new contact.
     */
    routesLeads?: boolean
  }
}

export interface CrmActionRecipe {
  id: CrmActionRecipeId
  /** How the recipe reads in the menu; also the action's starting name. */
  title: string
  /** One sentence under the title. */
  description: string
  /**
   * What must be picked before the recipe can be built. A recipe that needs
   * nothing opens the editor at once; one that needs a form opens a picker
   * first. Built WITHOUT its pick, such a recipe yields an action the
   * validator refuses — a condition with no value — rather than one that
   * saves and then silently matches nothing.
   */
  needs?: 'form'
  /**
   * A fresh action each call, because the draft is edited in place. The
   * action carries `recipe: id` — the provenance is the builder's to stamp,
   * so a writer that saves what it was handed cannot forget it.
   */
  build: (input?: CrmActionRecipeInput) => HostAction
}

/**
 * How long the stale-lead recipe holds before it decides a lead has gone
 * quiet. A week: long enough that a rep who is working the lead has had a
 * chance to move its stage, short enough that a lead nobody touched is
 * still warm when the reminder lands.
 */
export const STALE_LEAD_WAIT_MINUTES = 7 * 24 * 60

/**
 * The tag a form's captures get: the form's own name, cut to the tag cap.
 * The name is what the person calls the form, so it is the tag they would
 * have typed; the editor is open to change it before anything is saved.
 */
export function crmRecipeTagForForm(formName: string): string {
  return formName.trim().slice(0, CONTACT_TAG_MAX_LENGTH)
}

export const CRM_ACTION_RECIPES: readonly CrmActionRecipe[] = [
  {
    id: 'welcomeNewLead',
    title: 'Welcome a new lead',
    description:
      'When a form makes a new lead: rotate in an owner, book a call for ' +
      'tomorrow, send a thank-you, and tag them website.',
    /*
     * ON A NEW LEAD (AGL-3458), because that is the record a lead-routed form
     * makes. Since the one-record model (AGL-3232) a form with lead routing
     * on files a LEAD and no contact, so this recipe — which listened for a
     * new contact — never reached the people it is named for. `formId` is
     * on the `lead` event exactly when a form filed the lead, so the
     * condition keeps the recipe to forms and leaves a booking request to
     * the booking's own confirmation. Every step below acts on the lead the
     * event names when the workspace holds no contact for the person.
     *
     * The owner first, because the task that follows names no assignee and
     * so goes to whoever owns the lead when it is created — the member the
     * rotation just chose. Round robin rather than a named member: a recipe
     * cannot know who is on the team, and the pool under CRM → Settings is
     * the one place that does. On a workspace with no pool the step fails
     * and the run continues, so the call, the email and the tag still land
     * and the run history says who was not assigned.
     *
     * The email comes before any wait, which makes it an immediate reply to
     * what the visitor just did — a transactional reply, sent from the org's
     * own identity to the address the event carries, with no unsubscribe.
     *
     * Its words promise no response time. The org hub installs this recipe
     * into a site without its editor opening, so the business never reads
     * the sentence it is sending, and a "within a day" written here would be
     * a commitment made on its behalf that nothing in the run keeps.
     */
    build: () => ({
      recipe: 'welcomeNewLead',
      name: 'Welcome a new lead',
      trigger: {
        event: 'lead',
        conditions: [{ field: 'formId', op: 'notEmpty' }],
        combinator: 'and',
      },
      steps: [
        { type: 'assignContactOwner', roundRobin: true },
        {
          type: 'createCrmTask',
          title: 'Call the new lead',
          kind: 'call',
          dueInDays: 1,
        },
        {
          type: 'sendEmail',
          subject: 'Thanks for getting in touch',
          body:
            'Hi {{firstName|there}},\n\nThanks for reaching out. We have your ' +
            'message and will reply to this email address.',
        },
        { type: 'addContactTag', tag: 'website' },
      ],
      enabled: true,
    }),
  },
  {
    id: 'followUpWonDeal',
    title: 'Follow up a won deal',
    description:
      'When a deal is won — which makes the contact a Customer on its own — ' +
      'book a check-in call a week out.',
    /*
     * No stage step (AGL-2641): the win itself floors the contact at
     * `customer` before `dealWon` is announced, so a step setting the stage
     * here would at best repeat the write and at worst move an evangelist
     * back to customer — a SET, which is what the step is, and not the
     * floor the win applies. The recipe books the follow-up and nothing
     * else.
     */
    build: () => ({
      recipe: 'followUpWonDeal',
      name: 'Follow up a won deal',
      trigger: { event: 'dealWon' },
      steps: [
        {
          type: 'createCrmTask',
          title: 'Check in with the new customer',
          kind: 'call',
          dueInDays: 7,
        },
      ],
      enabled: true,
    }),
  },
  {
    id: 'reengageStaleLead',
    title: 'Re-engage a stale lead',
    description:
      'When a contact becomes a lead: wait a week, and if their stage has ' +
      'not moved, book a call to bring them back.',
    /*
     * "Unless the stage moved on" is the wait's own event: the flow watches
     * for the next stage change on this person and gives up after a week.
     * Resumed by the clock, the run carries `_waitTimedOut`, and the task
     * step's guard reads it; resumed by the event, the field is absent and
     * the task is skipped — the lead was worked, and nobody is told to
     * re-engage somebody who just moved to Sales qualified.
     */
    build: () => ({
      recipe: 'reengageStaleLead',
      name: 'Re-engage a stale lead',
      trigger: {
        event: 'contactStageChanged',
        conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'lead' }],
        combinator: 'and',
      },
      steps: [
        {
          type: 'waitForEvent',
          eventName: 'contactStageChanged',
          timeoutMinutes: STALE_LEAD_WAIT_MINUTES,
        },
        {
          type: 'createCrmTask',
          title: 'Re-engage a lead that has gone quiet',
          kind: 'call',
          dueInDays: 1,
          when: {
            conditions: [{ field: FLOW_TIMED_OUT_FIELD, op: 'notEmpty' }],
          },
        },
      ],
      enabled: true,
    }),
  },
  {
    id: 'tagByForm',
    title: 'Tag by form',
    description:
      'When a form you pick makes a new lead or contact: tag them with the ' +
      'form’s name.',
    needs: 'form',
    /*
     * The event follows the form's routing (AGL-3458): a lead-routed form
     * makes a lead and no contact, so keyed on `contactCreated` it would
     * never fire. Both events carry `formId` when a form made the record.
     */
    build: (input) => {
      const form = input?.form
      return {
        recipe: 'tagByForm',
        name: form ? `Tag ${form.name.trim()} submissions` : 'Tag by form',
        trigger: {
          event: form?.routesLeads ? 'lead' : 'contactCreated',
          conditions: [{ field: 'formId', op: 'equals', value: form?.id ?? '' }],
          combinator: 'and',
        },
        steps: [
          { type: 'addContactTag', tag: form ? crmRecipeTagForForm(form.name) : '' },
        ],
        enabled: true,
      }
    },
  },
]

/** The recipe with this id, or null for a string that names none. */
export function crmActionRecipe(id: unknown): CrmActionRecipe | null {
  return CRM_ACTION_RECIPES.find((recipe) => recipe.id === id) ?? null
}

/**
 * The recipe a STORED action came from, read off its document (AGL-2639).
 *
 * Three answers, and the third is the one that matters. A known id: the
 * action was installed from, or begun as, that recipe. `null`: the action
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
): CrmActionRecipeId | null | undefined {
  const stamp = action?.recipe
  if (stamp === undefined) return undefined
  return crmActionRecipe(stamp)?.id ?? null
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
  recipe?: CrmActionRecipeId | null
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
  if (action.recipe != null && !crmActionRecipe(action.recipe)) {
    return 'Unknown recipe'
  }
  // The trigger, the step guards, the client steps and every declared step's
  // pick are the platform's to check; the server steps are this module's.
  const problem = validateInteraction(action, {
    validateStep: (step, label) => serverStepProblem(step as HostActionStep, label),
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
