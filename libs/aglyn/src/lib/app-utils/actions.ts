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

export type HostActionStep =
  | { type: 'runWorkflow'; workflowName: string }
  | {
      type: 'siteAlert'
      message: string
      severity?: 'info' | 'success' | 'warning' | 'error'
    }
  | { type: 'customEvent'; eventName: string }
  | { type: 'datasetAppend'; datasetName: string }
  | { type: 'webhookPost'; webhookName: string }

export type HostActionStepType = HostActionStep['type']

/** `hosts/{hostId}/actions/{id}` doc. */
export interface HostAction {
  name: string
  /**
   * Event the action enrolls on: one of HOST_EVENT_TYPES or a custom
   * event name fired by another action's `customEvent` step.
   */
  trigger: { event: string; filter?: string }
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
  if (!HOST_EVENT_TYPES.includes(event as any) && !isCustomEventName(event)) {
    return 'Custom event names are 2–40 letters, digits, dashes'
  }
  const steps = action.steps ?? []
  if (!steps.length) return 'Add at least one step'
  if (steps.length > ACTION_MAX_STEPS) {
    return `Actions are capped at ${ACTION_MAX_STEPS} steps`
  }
  for (const [index, step] of steps.entries()) {
    const label = `Step ${index + 1}`
    if (step.type === 'runWorkflow' && !step.workflowName?.trim()) {
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
    if (step.type === 'datasetAppend' && !step.datasetName?.trim()) {
      return `${label}: pick a dataset`
    }
    if (step.type === 'webhookPost' && !step.webhookName?.trim()) {
      return `${label}: pick a webhook`
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
