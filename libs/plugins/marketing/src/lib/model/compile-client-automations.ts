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
  isClientActionStep,
  isClientStepEntitled,
  isSiteEventType,
  type HostAction,
} from '@aglyn/aglyn'
import { overlayMatchesPath } from './overlays'
import type { ClientAutomation } from './site-contract'

/** A raw `hosts/{hostId}/actions` doc paired with its id. */
export interface RawHostAction {
  id: string
  action: HostAction
}

export interface CompileClientAutomationsOptions {
  /** Leading-slash page path for pathPattern targeting. */
  path: string
  /**
   * `actions` entitlement (AGL-577). Basic presentational steps
   * (menu/drawer/show-hide/class/nav/alert) always load; advanced client
   * steps (overlay/showHtml/analytics) and server steps drop when false.
   */
  actionsEntitled: boolean
  /** Business-tier gate for `runJs` steps (dropped when false). */
  allowJs: boolean
  /**
   * Ignore each action's `pathPattern` (AGL-830). The besigner Preview shows
   * a single composed screen and scopes relevance by selector match, so it
   * skips path filtering rather than resolve the composed path.
   */
  matchAllPaths?: boolean
}

/**
 * Pure action→client-automation mapping (AGL-256/577, extracted AGL-830):
 * the single place the trigger config + entitlement-trimmed client steps are
 * shaped. Both the server page-enricher (admin fetch) and the editor Preview
 * (client fetch) feed their loaded action docs through this, so live and
 * preview stay byte-for-byte consistent. No I/O, no firebase — safe on the
 * client. Malformed entries are skipped, never thrown.
 */
export function compileClientAutomations(
  actions: RawHostAction[],
  options: CompileClientAutomationsOptions,
): ClientAutomation[] {
  const automations: ClientAutomation[] = []
  for (const { id, action } of actions) {
    if ((action as { deletedAt?: unknown }).deletedAt || action.enabled === false) {
      continue
    }
    const event = String(action.trigger?.event ?? '')
    if (!isSiteEventType(event)) continue
    const pathPattern = action.trigger?.pathPattern?.trim()
    if (
      !options.matchAllPaths &&
      pathPattern &&
      !overlayMatchesPath({ pathPatterns: [pathPattern] }, options.path)
    ) {
      continue
    }
    // Step-level entitlement tiering (AGL-577): basic presentational steps
    // load on every plan; advanced client steps need `actions` and runJs
    // needs `webhooks` — see isClientStepEntitled.
    const clientSteps = (action.steps ?? []).filter((step) =>
      isClientStepEntitled(step, {
        actionsEntitled: options.actionsEntitled,
        allowJs: options.allowJs,
      }),
    )
    // Server steps only dispatch (and are only re-authorized) when the org is
    // actions-entitled — never advertise them otherwise, so basic-tier pages
    // don't POST to /api/events/dispatch for a no-op.
    const hasServerSteps =
      options.actionsEntitled &&
      (action.steps ?? []).some((step) => !isClientActionStep(step))
    if (!clientSteps.length && !hasServerSteps) continue
    automations.push({
      id,
      event,
      ...(action.trigger?.selector ? { selector: action.trigger.selector } : {}),
      ...(Number(action.trigger?.threshold) > 0
        ? { threshold: Number(action.trigger.threshold) }
        : {}),
      ...(action.trigger?.oncePerVisitor === true ? { oncePerVisitor: true } : {}),
      ...(action.trigger?.oncePerSession === true ? { oncePerSession: true } : {}),
      ...(Number(action.trigger?.cooldownMinutes) >= 1
        ? { cooldownMinutes: Number(action.trigger?.cooldownMinutes) }
        : {}),
      // Repeatable UI choreography (AGL-562): menu/drawer interactions fire on
      // every occurrence instead of once per pageview.
      ...(action.trigger?.everyTime === true ? { everyTime: true } : {}),
      steps: clientSteps,
      hasServerSteps,
    })
  }
  return automations
}

export default compileClientAutomations
