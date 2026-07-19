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
  'exitIntent',
  'timeOnPage',
  'pageVisit',
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
}

export type HostActionStep =
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
  | { type: 'sendEmail'; subject: string; body: string; toField?: string }
  | { type: 'notifyAdmins'; title: string; body?: string }
  | { type: 'enrollList'; listId?: string; listName?: string }
  | { type: 'updateDataset'; datasetId?: string; datasetName?: string }
  | { type: 'assignCampaign'; campaignId?: string; campaignName?: string }

/** Steps the tenant page runtime executes client-side (AGL-257). */
export const CLIENT_ACTION_STEP_TYPES: ReadonlySet<HostActionStepType> =
  new Set([
    'showOverlay',
    'stickyNav',
    'addClass',
    'removeClass',
    'toggleClass',
    'showHtml',
    'runJs',
    'redirect',
    'trackGaEvent',
    'siteAlert',
  ] as const)

export function isClientActionStep(step: HostActionStep): boolean {
  return CLIENT_ACTION_STEP_TYPES.has(step.type)
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
/** Custom event names: short, no collision with built-ins. */
export const CUSTOM_EVENT_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/

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
  showHtml: 'Show custom HTML',
  runJs: 'Run custom JS (Business)',
  redirect: 'Redirect the visitor',
  trackGaEvent: 'Track an analytics event',
  sendEmail: 'Send an email',
  notifyAdmins: 'Notify site admins',
  enrollList: 'Enroll in a list',
  updateDataset: 'Update a dataset record',
  assignCampaign: 'Assign to a campaign',
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
  // Site-event trigger config (AGL-256).
  if (
    ['scrollToElement', 'elementClick', 'elementVisible'].includes(event) &&
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
  // Structured payload condition (AGL-557).
  const condition = action.trigger?.condition
  if (condition) {
    if (!TRIGGER_CONDITION_OPS.includes(condition.op)) {
      return 'Pick a condition operator'
    }
    if (!condition.field?.trim()) {
      return 'Name the field the condition checks'
    }
    if (condition.op !== 'notEmpty' && !condition.value?.trim()) {
      return 'Enter the value the condition compares against'
    }
  }
  const steps = action.steps ?? []
  if (!steps.length) return 'Add at least one step'
  if (steps.length > ACTION_MAX_STEPS) {
    return `Actions are capped at ${ACTION_MAX_STEPS} steps`
  }
  for (const [index, step] of steps.entries()) {
    const label = `Step ${index + 1}`
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
    if (step.type === 'showHtml' && !step.html?.trim()) {
      return `${label}: enter the HTML`
    }
    if (step.type === 'runJs' && !step.code?.trim()) {
      return `${label}: enter the JavaScript`
    }
    if (step.type === 'redirect' && !step.url?.trim() && !step.screenId) {
      return `${label}: pick a screen or enter the destination URL`
    }
    if (step.type === 'trackGaEvent' && !step.eventName?.trim()) {
      return `${label}: name the analytics event`
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
/** Outbound URLs must be public https — first-line SSRF guard. */
export const WEBHOOK_URL_PATTERN =
  /^https:\/\/(?!localhost)(?!127\.)(?!0\.)(?!10\.)(?!172\.(1[6-9]|2\d|3[01])\.)(?!192\.168\.)(?!169\.254\.)[^\s]+$/i
