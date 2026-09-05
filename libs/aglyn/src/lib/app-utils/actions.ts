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
  resolveAuthoredEventName,
  sanitizeEventParams,
} from './analytics-events'
import { type AuthorHtmlRemoval, sanitizeAuthorHtml } from './author-html'
import {
  type ContactLifecycleStage,
  CRM_TASK_MAX_DUE_DAYS,
  type CrmActivityKind,
  type CrmTaskKind,
  isContactLifecycleStage,
  isCrmActivityKind,
  isCrmTaskKind,
} from './crm'
import { HOST_EVENT_TYPES } from './workflows'

/**
 * Actions builder (AGL-148): HubSpot-style event → action automation on
 * top of the AGL-128 event triggers. An action listens for a host event
 * (built-in or a custom name fired by another action), optionally filters
 * on the payload, and runs an ordered step list. Pure types + validation
 * here; the executor lives server-side where the I/O is (tenant utils).
 */

/**
 * Client-side site events (AGL-256) the tenant page runtime emits:
 * element interactions, scroll behavior, dwell time, and exit intent.
 * Trigger config (selector/threshold/path) rides the action's trigger.
 */
export const SITE_EVENT_TYPES = [
  'scrollDepth',
  'scrollToElement',
  'elementClick',
  'elementVisible',
  // Hover choreography (AGL-562): delegated enter/leave on the trigger
  // selector — the nav-menu/drawer show-hide building blocks.
  'elementHoverEnter',
  'elementHoverLeave',
  'exitIntent',
  'timeOnPage',
  'pageVisit',
] as const

/** Site events that watch a specific element and need a selector. */
export const ELEMENT_SCOPED_SITE_EVENTS = [
  'scrollToElement',
  'elementClick',
  'elementVisible',
  'elementHoverEnter',
  'elementHoverLeave',
] as const

export type SiteEventType = (typeof SITE_EVENT_TYPES)[number]

export function isSiteEventType(event: string): event is SiteEventType {
  return SITE_EVENT_TYPES.includes(event as SiteEventType)
}

/** Structured condition operators (AGL-557). */
export const TRIGGER_CONDITION_OPS = [
  'equals',
  'contains',
  'notEmpty',
] as const

export type TriggerConditionOp = (typeof TRIGGER_CONDITION_OPS)[number]

/**
 * Structured per-action condition over the event payload (AGL-557): the
 * no-code sibling of the free-text `filter` expression, e.g. "only run
 * when the `subscribe` field is not empty". Evaluated against the same
 * scope as the filter (event name + payload fields); the action is
 * skipped when unmet.
 */
export interface HostActionTriggerCondition {
  /** Payload field the condition reads (a submitted form field name). */
  field: string
  op: TriggerConditionOp
  /** Comparison value for `equals`/`contains`; unused by `notEmpty`. */
  value?: string
}

/**
 * Evaluates a structured trigger condition (AGL-557). String-coerces the
 * payload value; `equals`/`contains` compare trimmed + case-insensitive
 * so checkbox values like "Yes" match an author-typed "yes". A missing
 * field never matches (and is "empty" for `notEmpty`); an absent or
 * field-less condition always passes, mirroring the filter's default.
 */
export function evaluateTriggerCondition(
  condition: HostActionTriggerCondition | undefined | null,
  payload: Record<string, unknown>,
): boolean {
  const field = condition?.field?.trim()
  if (!condition || !field) return true
  const raw = (payload ?? {})[field]
  const actual = (raw == null ? '' : String(raw)).trim().toLowerCase()
  if (condition.op === 'notEmpty') return actual.length > 0
  const expected = String(condition.value ?? '')
    .trim()
    .toLowerCase()
  if (condition.op === 'equals') return actual === expected
  if (condition.op === 'contains') {
    return expected.length > 0 && actual.includes(expected)
  }
  return false
}

/** How chained trigger conditions combine (AGL-565). */
export const TRIGGER_COMBINATORS = ['and', 'or'] as const

export type TriggerCombinator = (typeof TRIGGER_COMBINATORS)[number]

/** Cap on chained conditions per trigger (AGL-565). */
export const ACTION_MAX_CONDITIONS = 5

/**
 * Normalizes a trigger's condition clauses to a list (AGL-565): the
 * `conditions` array wins when present; a legacy single `condition`
 * (AGL-557) becomes a one-element list. Read-time only — persisted docs
 * are never migrated, so pre-565 single-condition docs keep working
 * unchanged.
 */
export function normalizeTriggerConditions(
  trigger:
    | Pick<HostActionTrigger, 'condition' | 'conditions'>
    | undefined
    | null,
): HostActionTriggerCondition[] {
  const conditions = trigger?.conditions
  if (Array.isArray(conditions)) return conditions.filter(Boolean)
  return trigger?.condition ? [trigger.condition] : []
}

/**
 * Evaluates a trigger's condition list with its combinator (AGL-565):
 * `and` (the default) requires every condition to pass, `or` any one.
 * Per-condition semantics are unchanged from AGL-557
 * (`evaluateTriggerCondition`), and an empty list always passes — which
 * covers every pre-565 doc without conditions.
 */
export function evaluateTriggerConditions(
  trigger:
    | Pick<HostActionTrigger, 'condition' | 'conditions' | 'combinator'>
    | undefined
    | null,
  payload: Record<string, unknown>,
): boolean {
  const conditions = normalizeTriggerConditions(trigger)
  if (!conditions.length) return true
  return trigger?.combinator === 'or'
    ? conditions.some((condition) =>
        evaluateTriggerCondition(condition, payload),
      )
    : conditions.every((condition) =>
        evaluateTriggerCondition(condition, payload),
      )
}

export interface HostActionTrigger {
  /**
   * Event the action enrolls on: a HOST_EVENT_TYPE (server-emitted), a
   * SITE_EVENT_TYPE (client-emitted, AGL-256), or a custom name fired by
   * another action's `customEvent` step.
   */
  event: string
  /** Optional expression over the payload; runs only when truthy. */
  filter?: string
  /** Optional structured payload condition (AGL-557); null clears it. */
  condition?: HostActionTriggerCondition | null
  /**
   * Chained payload conditions (AGL-565), combined with `combinator`.
   * When present this list wins over the legacy single `condition`
   * (see `normalizeTriggerConditions`); null clears it.
   */
  conditions?: HostActionTriggerCondition[] | null
  /** How the chained conditions combine (AGL-565); default `and`. */
  combinator?: TriggerCombinator | null
  /** CSS selector for element-scoped site events (click/visible/scroll-to). */
  selector?: string
  /** Percent 0-100 (scrollDepth) or seconds (timeOnPage). */
  threshold?: number
  /** Path pattern the site event listens on (overlay glob rules); empty = all. */
  pathPattern?: string
  /**
   * Fire at most once per visitor (AGL-266, localStorage-keyed) instead
   * of once per pageview. Site events only.
   */
  oncePerVisitor?: boolean
  /**
   * Fire at most once per browser session (AGL-274,
   * sessionStorage-keyed). Site events only.
   */
  oncePerSession?: boolean
  /**
   * Minimum minutes between fires for the same visitor (AGL-274,
   * localStorage timestamp). Site events only; ignored when
   * `oncePerVisitor` is set.
   */
  cooldownMinutes?: number
  /**
   * Fire on EVERY occurrence instead of once per pageview (AGL-562) —
   * required for repeatable UI choreography (menu toggles, drawer
   * open/close, hover show/hide). Site events only; the explicit
   * per-session/visitor/cooldown caps above still win when set.
   */
  everyTime?: boolean
}

/**
 * A per-STEP condition, and the difference between an automation and a flow.
 *
 * `HostActionTrigger.conditions` gates the whole action: every step runs or
 * none does. That is enough for "when a form is submitted, do these three
 * things" and not enough for anything with a shape — "wait three days, then,
 * only if they have not ordered, send the reminder" needs the condition to
 * belong to the step rather than to the run.
 *
 * Same clause type and the same combinator as the trigger's, evaluated
 * against the same scope, so an author learns one condition editor and the
 * two can never disagree about what `contains` means.
 */
export interface HostActionStepGuard {
  conditions: HostActionTriggerCondition[]
  /** How the clauses combine; default `and`, as on the trigger. */
  combinator?: TriggerCombinator | null
}

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

/**
 * Evaluates a step's own guard, with the trigger's semantics.
 *
 * An absent or clause-less guard passes, exactly as an absent trigger
 * condition does — so every step written before guards existed keeps running.
 */
export function evaluateStepGuard(
  guard: HostActionStepGuard | undefined | null,
  scope: Record<string, unknown>,
): boolean {
  const conditions = (guard?.conditions ?? []).filter(Boolean)
  if (!conditions.length) return true
  return guard?.combinator === 'or'
    ? conditions.some((condition) => evaluateTriggerCondition(condition, scope))
    : conditions.every((condition) => evaluateTriggerCondition(condition, scope))
}

export type HostActionStep = (
  // Entity references carry a doc id (AGL-261, rename-safe) with the name
  // kept as a display hint; pre-AGL-261 docs have only the name and the
  // executor resolves either.
  | { type: 'runWorkflow'; workflowId?: string; workflowName?: string }
  | {
      type: 'siteAlert'
      message: string
      severity?: 'info' | 'success' | 'warning' | 'error'
    }
  | { type: 'customEvent'; eventName: string }
  | { type: 'datasetAppend'; datasetId?: string; datasetName?: string }
  | { type: 'webhookPost'; webhookId?: string; webhookName?: string }
  // Client-side UI steps (AGL-257): run in the visitor's page by the
  // tenant automations engine; the server executor skips them.
  | { type: 'showOverlay'; overlayId?: string; overlayName?: string }
  | { type: 'stickyNav'; selector?: string }
  // Selectors accept CSS or a node id via [data-node-id="…"] — the
  // besigner element picker emits the latter (AGL-314/319).
  | { type: 'addClass'; selector: string; className: string }
  | { type: 'removeClass'; selector: string; className: string }
  | { type: 'toggleClass'; selector: string; className: string }
  // Element show/hide choreography (AGL-562): sugar over the shared
  // hidden class (see element-ui.ts) so authors never type class names.
  // The besigner target picker emits the node's stable data-aglyn
  // selector; any CSS selector works.
  // Element visibility (AGL-562) with menu-grade choreography (AGL-589):
  // `delayMs` defers the change and a later visibility step on the same
  // selector cancels the pending one (the hover grace period), and
  // `dismissOn` self-dismisses a shown element on Escape / outside click.
  | {
      type: 'showElement'
      selector: string
      delayMs?: number
      dismissOn?: ElementDismissOption[]
    }
  | { type: 'hideElement'; selector: string; delayMs?: number }
  | {
      type: 'toggleElement'
      selector: string
      delayMs?: number
      dismissOn?: ElementDismissOption[]
    }
  // Drawer commands (AGL-562): delivered to muiDrawer instances over the
  // window event bus keyed by node id; an empty target addresses the
  // page's first drawer.
  // Attribute steps (AGL-2546): the semantics half of a hand-built
  // disclosure. `showElement` opens the panel; these are what let it say so.
  //
  // `selector`, deliberately, and NOT a new targeting field. Two mechanisms
  // key off that exact name: `regraftStepSelectors` rewrites it to the
  // grafted `cmp__{instance}__{id}` when an interaction is authored inside a
  // reusable component, and the runtime wraps it in `expandLeafSelector`.
  // The menu steps took `menuNodeId` instead, get neither, and compensate at
  // run time — one concept should not have three targeting models.
  //
  // Two verbs rather than one with an empty value: `""` does not mean
  // "absent" uniformly. `hidden=""` is true, `aria-expanded=""` is invalid
  // and discarded, `data-x=""` is a real value an attribute selector still
  // matches. Overloading it would make the step's meaning depend on which
  // attribute the author picked.
  | { type: 'setAttribute'; selector: string; name: string; value: string }
  | { type: 'removeAttribute'; selector: string; name: string }
  | { type: 'openDrawer'; drawerNodeId?: string }
  | { type: 'closeDrawer'; drawerNodeId?: string }
  | { type: 'toggleDrawer'; drawerNodeId?: string }
  // Menu commands (AGL-568): the drawer pattern for Dropdown/Mega Menu
  // elements — delivered over their own window event bus keyed by node
  // id; an empty target addresses the page's first menu. Hover-triggered
  // opens carry a hover flag so the menu closes on pointer leave.
  | { type: 'openMenu'; menuNodeId?: string }
  | { type: 'closeMenu'; menuNodeId?: string }
  | { type: 'toggleMenu'; menuNodeId?: string }
  | { type: 'showHtml'; html: string }
  | { type: 'runJs'; code: string }
  // Screen targets are rename-safe (AGL-339): the tenant resolves the
  // screen id against the host routing map at run time; `url` is the
  // external/manual fallback.
  | { type: 'redirect'; url?: string; screenId?: string }
  | {
      type: 'trackGaEvent'
      eventName: string
      params?: Record<string, string>
    }
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
   * The owner by uid when a picker wrote the step, by email when a person
   * typed it; the executor resolves the email against the org's members.
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
       * Who gets it — by uid, or by an address the executor resolves against
       * the roster the way the owner step's is. Neither named, the task goes
       * to the contact's owner, then to nobody.
       */
      assigneeUid?: string
      assigneeEmail?: string
    }
  | { type: 'logCrmActivity'; kind: CrmActivityKind; body: string }
) & {
  /** See {@link HostActionStepGuard}. Absent means the step always runs. */
  when?: HostActionStepGuard | null
}

/** Steps the tenant page runtime executes client-side (AGL-257). */
export const CLIENT_ACTION_STEP_TYPES: ReadonlySet<HostActionStepType> =
  new Set([
    'showOverlay',
    'stickyNav',
    'addClass',
    'removeClass',
    'toggleClass',
    'showElement',
    'hideElement',
    'toggleElement',
    'openDrawer',
    'closeDrawer',
    'toggleDrawer',
    'openMenu',
    'closeMenu',
    'toggleMenu',
    'setAttribute',
    'removeAttribute',
    'showHtml',
    'runJs',
    'redirect',
    'trackGaEvent',
    'siteAlert',
  ] as const)

export function isClientActionStep(step: HostActionStep): boolean {
  return CLIENT_ACTION_STEP_TYPES.has(step.type)
}

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
 * The steps that act on the CRM (AGL-2605) — named as a set because the
 * executor dispatches all five to one module and the docs list them as one
 * group, and a step added to the union but not here would be a server step
 * the executor silently skipped.
 */
export const CRM_ACTION_STEP_TYPES: ReadonlySet<HostActionStepType> = new Set([
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
] as const)

/** The CRM steps, as the type the executor narrows to. */
export type CrmActionStep = Extract<
  HostActionStep,
  {
    type:
      | 'setContactStage'
      | 'addContactTag'
      | 'assignContactOwner'
      | 'createCrmTask'
      | 'logCrmActivity'
  }
>

export function isCrmActionStep(step: HostActionStep): step is CrmActionStep {
  return CRM_ACTION_STEP_TYPES.has(step.type)
}

/** Longest tag an automation may write — the console's own tag field cap. */
export const CONTACT_TAG_MAX_LENGTH = 60

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

/**
 * Basic presentational interactions (AGL-577): the subset of client steps
 * that are pure DOM choreography — menu/drawer open-close, element
 * show/hide, class toggles, sticky nav, navigation, and client-only
 * alerts. They carry NO server cost and touch NO data, so they run on
 * every plan (the `interactions` feature, on by default everywhere).
 *
 * The powerful client steps stay behind the `actions` entitlement:
 * `showOverlay` (marketing overlays), `showHtml` (arbitrary HTML
 * injection), and `trackGaEvent` (analytics). `runJs` keeps its own
 * higher `webhooks` (Business) gate. Server steps
 * (sendEmail/notifyAdmins/enrollList/updateDataset/assignCampaign) are
 * re-checked against `actions` server-side in `runEventActions`.
 */
export const BASIC_CLIENT_ACTION_STEP_TYPES: ReadonlySet<HostActionStepType> =
  new Set([
    'stickyNav',
    'addClass',
    'removeClass',
    'toggleClass',
    'showElement',
    'hideElement',
    'toggleElement',
    'openDrawer',
    'closeDrawer',
    'toggleDrawer',
    'openMenu',
    'closeMenu',
    'toggleMenu',
    'setAttribute',
    'removeAttribute',
    'redirect',
    'siteAlert',
  ] as const)

/** A client step available on all plans (no `actions` entitlement). */
export function isBasicClientActionStep(step: HostActionStep): boolean {
  return BASIC_CLIENT_ACTION_STEP_TYPES.has(step.type)
}

/**
 * Whether a client step may run for the given entitlement tier (AGL-577).
 * This is the single source of truth the page enricher uses to trim the
 * client-automation payload per plan:
 *
 * - Basic presentational steps → always (every plan).
 * - `runJs` → `allowJs` (Business `webhooks` tier).
 * - Remaining advanced client steps (overlay / showHtml / analytics) →
 *   `actionsEntitled` (`actions` tier).
 *
 * Server steps are not client steps and always return false here; they
 * are dispatched and re-authorized server-side.
 */
export function isClientStepEntitled(
  step: HostActionStep,
  entitlements: { actionsEntitled: boolean; allowJs: boolean },
): boolean {
  if (!isClientActionStep(step)) return false
  if (isBasicClientActionStep(step)) return true
  if (step.type === 'runJs') return entitlements.allowJs
  return entitlements.actionsEntitled
}

export type HostActionStepType = HostActionStep['type']

/** `hosts/{hostId}/actions/{id}` doc. */
export interface HostAction {
  name: string
  trigger: HostActionTrigger
  steps: HostActionStep[]
  /** Disabled actions never run; new actions default enabled. */
  enabled?: boolean
}

export const ACTION_MAX_STEPS = 10
/** Custom-event chaining depth cap (mirrors CROSS_MAX_DEPTH). */
export const ACTION_MAX_EVENT_DEPTH = 3

/**
 * Cap on the parameters one `trackGaEvent` step may carry (AGL-1587).
 *
 * Not a storage concern. These pairs are the least trustworthy analytics
 * input on the platform — both halves are typed by a site author and land in
 * that site's own GA4 property — and a bounded list is one an author can read
 * back in full before publishing, which is the only review a parameter ever
 * gets. GA4 caps custom parameters per event as well and drops the overflow
 * without saying so, so an unbounded editor would let an author configure
 * parameters that are never delivered and never explained. Ten, the same
 * ceiling {@link ACTION_MAX_STEPS} puts on the step list itself.
 */
export const ACTION_MAX_EVENT_PARAMS = 10

/**
 * Longest analytics parameter NAME GA4 accepts; it drops a longer one on
 * arrival, so a name over this is silence rather than a truncated dimension.
 * The value half is capped by `ANALYTICS_PARAM_MAX_LENGTH`, which truncates
 * instead of dropping.
 */
export const ACTION_EVENT_PARAM_NAME_MAX_LENGTH = 40

/** Self-dismiss triggers for shown elements (AGL-589). */
export const ELEMENT_DISMISS_OPTIONS = ['escape', 'outsideClick'] as const
export type ElementDismissOption = (typeof ELEMENT_DISMISS_OPTIONS)[number]
/** Visibility grace-delay ceiling — enough for hover travel, no dead UIs. */
export const ELEMENT_VISIBILITY_MAX_DELAY_MS = 5000
/** Custom event names: short, no collision with built-ins. */
export const CUSTOM_EVENT_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/

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

/**
 * The attribute names an interaction may write (AGL-2546).
 *
 * An unrestricted attribute setter is a self-XSS vector authored through the
 * interactions UI: it reaches `href`, `src`, `onclick`, `formaction` and
 * `style`, and on a site with collaborators the author and the victim need
 * not be the same person. `aria-*` and `data-*` carry the entire
 * accessibility use case and none of that exposure.
 *
 * Deliberately NOT solved by an entitlement gate. `runJs` is Business-gated
 * because it is dangerous at any tier; this has to work on every plan,
 * because a screen-reader user's access to a menu is not a paid feature.
 */
export const INTERACTION_ATTRIBUTE_NAME_PATTERN = /^(?:aria|data)-[a-z][a-z0-9-]*$/

/**
 * Whether an interaction is allowed to write this attribute name.
 *
 * Case-insensitive because HTML attribute names are, and a rejected name is
 * a no-op rather than an error: a step that cannot run must not break the
 * steps after it in the same automation.
 */
export function isInteractionAttributeAllowed(name: unknown): boolean {
  return (
    typeof name === 'string' &&
    INTERACTION_ATTRIBUTE_NAME_PATTERN.test(name.trim().toLowerCase())
  )
}

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

/**
 * Past-tense phrases for a run summary (AGL-2171).
 *
 * `HOST_ACTION_STEP_LABELS` above names what a step WILL do, in the
 * imperative, for a `Do` select — "Send an email". A run history is the
 * opposite tense and a different audience: it says what already happened,
 * on one line, several steps at a time. `/product/workflows` advertises
 * exactly that shape — `Sent email · saved to Leads · webhook 200`.
 *
 * Two maps rather than one derived from the other, because "Send a webhook
 * (Business)" cannot be mechanically turned into "webhook" — the plan
 * suffix is part of the picker's label and has no business in a log line.
 * Only the steps a SERVER run can perform appear here; the client-side
 * steps run in the visitor's browser and never reach the activity write.
 */
export const HOST_ACTION_STEP_OUTCOMES: Partial<
  Record<HostActionStepType, string>
> = {
  runWorkflow: 'ran workflow',
  siteAlert: 'showed an alert',
  customEvent: 'fired an event',
  datasetAppend: 'saved to dataset',
  updateDataset: 'updated dataset',
  webhookPost: 'webhook',
  sendEmail: 'sent email',
  notifyAdmins: 'notified admins',
  enrollList: 'enrolled in list',
  assignCampaign: 'assigned to campaign',
  wait: 'waiting',
  waitForEvent: 'waiting for',
  exitFlow: 'ended the flow',
  setContactStage: 'set stage',
  addContactTag: 'tagged',
  assignContactOwner: 'assigned owner',
  createCrmTask: 'created task',
  logCrmActivity: 'logged activity',
}

/**
 * One step's line in a run summary, with the detail that makes it useful.
 *
 * `saved to Leads` beats `saved to dataset`, and `webhook 200` beats
 * `webhook` — the status code is the entire reason anyone opens a run
 * history after a webhook, and it was being discarded on the line it
 * arrived.
 */
export function describeStepOutcome(
  type: HostActionStepType,
  detail?: string,
): string {
  const base = HOST_ACTION_STEP_OUTCOMES[type] ?? String(type)
  const trimmed = detail?.trim()
  if (!trimmed) return base
  if (type === 'datasetAppend' || type === 'updateDataset') {
    // `saved to dataset` + `Leads` reads as `saved to Leads`, not
    // `saved to dataset Leads`.
    return `${base.replace(/ dataset$/, '')} ${trimmed}`
  }
  return `${base} ${trimmed}`
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
  const event = action.trigger?.event?.trim() ?? ''
  if (!event) return 'Pick a trigger event'
  if (
    !HOST_EVENT_TYPES.includes(event as any) &&
    !isSiteEventType(event) &&
    !isCustomEventName(event)
  ) {
    return 'Custom event names are 2–40 letters, digits, dashes'
  }
  // Site-event trigger config (AGL-256; hover events AGL-562).
  if (
    (ELEMENT_SCOPED_SITE_EVENTS as readonly string[]).includes(event) &&
    !action.trigger?.selector?.trim()
  ) {
    return 'This trigger needs a CSS selector'
  }
  if (
    ['scrollDepth', 'timeOnPage'].includes(event) &&
    !(Number(action.trigger?.threshold) > 0)
  ) {
    return event === 'scrollDepth'
      ? 'Set the scroll percentage (1–100)'
      : 'Set the seconds on page'
  }
  // Frequency caps (AGL-274).
  if (
    action.trigger?.cooldownMinutes != null &&
    !(Number(action.trigger.cooldownMinutes) >= 1)
  ) {
    return 'Cooldown must be at least 1 minute'
  }
  // Structured payload conditions (AGL-557; chained AGL-565).
  const combinator = action.trigger?.combinator
  if (combinator != null && !TRIGGER_COMBINATORS.includes(combinator)) {
    return 'Combine conditions with AND or OR'
  }
  const conditions = normalizeTriggerConditions(action.trigger)
  if (conditions.length > ACTION_MAX_CONDITIONS) {
    return `Conditions are capped at ${ACTION_MAX_CONDITIONS}`
  }
  for (const [index, condition] of conditions.entries()) {
    // Single-condition messages stay exactly as AGL-557 shipped them;
    // the row marker only appears once there are rows to tell apart.
    const where = conditions.length > 1 ? ` (condition ${index + 1})` : ''
    if (!TRIGGER_CONDITION_OPS.includes(condition.op)) {
      return `Pick a condition operator${where}`
    }
    if (!condition.field?.trim()) {
      return `Name the field the condition checks${where}`
    }
    if (condition.op !== 'notEmpty' && !condition.value?.trim()) {
      return `Enter the value the condition compares against${where}`
    }
  }
  const steps = action.steps ?? []
  if (!steps.length) return 'Add at least one step'
  if (steps.length > ACTION_MAX_STEPS) {
    return `Actions are capped at ${ACTION_MAX_STEPS} steps`
  }
  for (const [index, step] of steps.entries()) {
    const label = `Step ${index + 1}`
    // A step's own guard, checked with the same messages the trigger's
    // clauses get — one condition editor, one set of complaints about it.
    const guardClauses = (step.when?.conditions ?? []).filter(Boolean)
    if (guardClauses.length > ACTION_MAX_CONDITIONS) {
      return `${label}: conditions are capped at ${ACTION_MAX_CONDITIONS}`
    }
    if (
      step.when?.combinator != null &&
      !TRIGGER_COMBINATORS.includes(step.when.combinator)
    ) {
      return `${label}: combine conditions with AND or OR`
    }
    for (const clause of guardClauses) {
      if (!TRIGGER_CONDITION_OPS.includes(clause.op)) {
        return `${label}: pick a condition operator`
      }
      if (!clause.field?.trim()) {
        return `${label}: name the field the condition checks`
      }
      if (clause.op !== 'notEmpty' && !clause.value?.trim()) {
        return `${label}: enter the value the condition compares against`
      }
    }
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
    if (
      step.type === 'runWorkflow' &&
      !step.workflowId?.trim() &&
      !step.workflowName?.trim()
    ) {
      return `${label}: pick a workflow`
    }
    if (step.type === 'siteAlert' && !step.message?.trim()) {
      return `${label}: enter the alert message`
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
    // Client + server steps (AGL-257).
    if (
      step.type === 'addClass' ||
      step.type === 'removeClass' ||
      step.type === 'toggleClass'
    ) {
      if (!step.selector?.trim()) return `${label}: enter a CSS selector`
      if (!step.className?.trim()) return `${label}: enter the class name`
    }
    // Element show/hide steps (AGL-562) always target a selector; drawer
    // (AGL-562) and menu (AGL-568) commands may omit the target (the
    // page's first drawer/menu answers).
    if (
      (step.type === 'showElement' ||
        step.type === 'hideElement' ||
        step.type === 'toggleElement') &&
      !step.selector?.trim()
    ) {
      return `${label}: pick the element to show or hide`
    }
    if (
      step.type === 'showElement' ||
      step.type === 'hideElement' ||
      step.type === 'toggleElement'
    ) {
      // Choreography options (AGL-589).
      const delay = (step as { delayMs?: unknown }).delayMs
      if (
        delay != null &&
        !(
          Number.isInteger(delay) &&
          (delay as number) >= 0 &&
          (delay as number) <= ELEMENT_VISIBILITY_MAX_DELAY_MS
        )
      ) {
        return `${label}: delay must be 0–${ELEMENT_VISIBILITY_MAX_DELAY_MS}ms`
      }
      const dismiss = (step as { dismissOn?: unknown }).dismissOn
      if (
        dismiss != null &&
        !(
          Array.isArray(dismiss) &&
          dismiss.every((option) =>
            (ELEMENT_DISMISS_OPTIONS as readonly string[]).includes(
              option as string,
            ),
          )
        )
      ) {
        return `${label}: dismiss options are escape and outsideClick`
      }
    }
    if (step.type === 'showHtml') {
      if (!step.html?.trim()) return `${label}: enter the HTML`
      // AGL-2486: the author-facing half of the runtime sanitizer, exactly as
      // the reserved analytics name below is the author-facing half of the
      // runtime refusal. `site-runtime.tsx` runs this HTML through
      // `sanitizeAuthorHtml` for a VISITOR, where the only thing it can do
      // with markup it refuses is drop it and say nothing — so an author who
      // pastes an embed snippet gets a step that runs, reports success, and
      // shows nothing. The refusal is reported HERE, where the person who
      // can fix it is looking, and it is the SAME function that will run at
      // render rather than a second description of its rules.
      const removals: AuthorHtmlRemoval[] = []
      const safe = sanitizeAuthorHtml(step.html, removals)
      if (!safe.trim()) {
        return `${label}: none of this HTML can be shown on a published page — ${removals[0]?.message ?? 'it is removed by the sanitizer.'}`
      }
      if (removals.length) {
        return `${label}: ${removals[0].message}${removals.length > 1 ? ` (+${removals.length - 1} more)` : ''}`
      }
    }
    if (step.type === 'runJs' && !step.code?.trim()) {
      return `${label}: enter the JavaScript`
    }
    if (step.type === 'redirect' && !step.url?.trim() && !step.screenId) {
      return `${label}: pick a screen or enter the destination URL`
    }
    if (step.type === 'trackGaEvent') {
      if (!step.eventName?.trim()) {
        return `${label}: name the analytics event`
      }
      // AGL-1587: the author-facing half of the runtime refusal. The runtime
      // can only drop a bad name silently — it is executing for a VISITOR —
      // so the name is checked HERE, where the person who can fix it is.
      const resolved = resolveAuthoredEventName(step.eventName)
      if (resolved.reason === 'reserved') {
        return `${label}: "${step.eventName.trim()}" is a reserved analytics event name — pick another`
      }
      if (!resolved.name) {
        return `${label}: the analytics event name must start with a letter`
      }
      const params = Object.entries(step.params ?? {})
      if (params.length > ACTION_MAX_EVENT_PARAMS) {
        return `${label}: analytics parameters are capped at ${ACTION_MAX_EVENT_PARAMS}`
      }
      for (const [key, value] of params) {
        if (!key.trim()) return `${label}: name every analytics parameter`
        if (key.trim().length > ACTION_EVENT_PARAM_NAME_MAX_LENGTH) {
          return `${label}: the "${key.trim().slice(0, 16)}…" parameter name is over ${ACTION_EVENT_PARAM_NAME_MAX_LENGTH} characters, which GA4 drops`
        }
        if (!String(value ?? '').trim()) {
          return `${label}: enter a value for the "${key.trim()}" parameter`
        }
      }
      // The author-facing half of the runtime sanitizer, the same shape the
      // reserved name above and the `showHtml` check take. `trackAuthoredEvent`
      // strips a parameter that can carry personal data and says nothing about
      // it, because it is executing for a VISITOR — so an author who binds a
      // form field into a parameter gets a step that runs, reports success,
      // and delivers an event missing the dimension it was created for. The
      // strip is reported HERE, by running the REAL `sanitizeEventParams`
      // rather than a second description of its rules, so the two can never
      // disagree about which parameter survives.
      const kept = sanitizeEventParams(step.params ?? undefined)
      const stripped = params.find(([key]) => !(key in kept))
      if (stripped) {
        return `${label}: the "${stripped[0]}" parameter is never sent — an analytics parameter must not carry a visitor's own details`
      }
    }
    if (step.type === 'sendEmail') {
      if (!step.subject?.trim()) return `${label}: enter the subject`
      if (!step.body?.trim()) return `${label}: enter the email body`
    }
    if (step.type === 'notifyAdmins' && !step.title?.trim()) {
      return `${label}: enter the notification title`
    }
    if (
      step.type === 'showOverlay' &&
      !step.overlayId?.trim() &&
      !step.overlayName?.trim()
    ) {
      return `${label}: pick an overlay`
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
  }
  return null
}

/** Alert produced by a `siteAlert` step, surfaced to the emitting client. */
export interface HostActionAlert {
  message: string
  severity: 'info' | 'success' | 'warning' | 'error'
}

/**
 * Webhooks (AGL-149) at `hosts/{hostId}/webhooks/{id}`. Outbound entries
 * are targets a `webhookPost` action step delivers to (HMAC-signed);
 * inbound entries mint `/api/hooks/{hostId}/{hookId}` endpoints that run
 * a workflow with the posted JSON in scope. Business tier (`webhooks`
 * flag); Pro can be enabled per-tenant via entitlement overrides.
 */
export interface HostWebhook {
  name: string
  direction: 'outbound' | 'inbound'
  /** Outbound delivery URL (https only; checked again at send time). */
  url?: string
  /** Shared secret: signs outbound bodies, verifies inbound callers. */
  secret?: string
  /** Inbound: workflow (by name) enrolled with the payload in scope. */
  workflowName?: string
  enabled?: boolean
}

export const WEBHOOK_MAX_PER_HOST = 5

/**
 * How many LIVE action documents one host may hold (AGL-2266).
 *
 * `hosts/{hostId}/actions` was in NO exclusion list in
 * `cloud/firebase-firestore.rules`, so the host catch-all's `allow create`
 * granted it to any editor, client-direct, on any plan — and the import
 * route's own table said so in as many words: *"no `RESOURCES` entry and no
 * quota key anywhere; all three creators write the document client-direct."*
 * A free org could therefore mint unbounded Firestore documents from the
 * browser against a $0 subscription. Unbounded infrastructure, not a bypass of
 * anything we sell, which is `WEBHOOK_MAX_PER_HOST`'s (AGL-1360) and
 * `NON_PAGE_SCREEN_MAX_PER_HOST`'s (AGL-1399) shape exactly: a flat PLATFORM
 * cap with no `OrgEntitlements` key, no variation by plan, and nothing on the
 * price list to explain.
 *
 * ## Not gated on the `actions` entitlement, deliberately
 *
 * `actions` is a Pro feature and `interactions` is free, and BOTH write this
 * collection — the interaction builder and the besigner's preset wiring create
 * the same document type the Pro actions card does. Gating creation on the
 * paid flag would take element interactions away from every free and starter
 * site, which is a pricing change wearing a cap's clothes. The runtime already
 * checks the entitlement where it decides what may RUN
 * (`run-event-actions.ts`), which is the right place for it.
 *
 * ## Why 500
 *
 * Sized to the busiest plausible site rather than to today's data. An action
 * is authored per interactive element, so a heavy marketing site with dropdown
 * choreography on every section reaches tens; presets wire a handful at a
 * time. 500 is far past anything authoring produces and well short of what a
 * script in a loop wants, which is the only property a flat cap needs. Live
 * documents only — the interactions provider soft-deletes with `deletedAt`, so
 * counting tombstones would be AGL-1173's bug one collection over, where
 * removing an interaction never frees its slot.
 */
export const ACTIONS_MAX_PER_HOST = 500
/** Outbound URLs must be public https — first-line SSRF guard. */
export const WEBHOOK_URL_PATTERN =
  /^https:\/\/(?!localhost)(?!127\.)(?!0\.)(?!10\.)(?!172\.(1[6-9]|2\d|3[01])\.)(?!192\.168\.)(?!169\.254\.)[^\s]+$/i
