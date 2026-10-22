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

import { setDefaultEventParameters } from 'firebase/analytics'

/**
 * The console's ONE owner of GA4 default event parameters (AGL-2087).
 *
 * ## Why an owner rather than call sites
 *
 * `setDefaultEventParameters` is the only Firebase API that rides *every*
 * event the SDK emits, automatic ones included — which is exactly why two
 * unrelated concerns want it: the internal-traffic stamp (AGL-1582) and the
 * badge-stripped `page_title` (AGL-2087). It is also, verbatim from
 * `@firebase/analytics`, unsafe to call from two places:
 *
 * ```js
 * function setDefaultEventParameters(customParams) {
 *   if (wrappedGtagFunction) wrappedGtagFunction('set', customParams)
 *   else _setDefaultEventParametersForInit(customParams)   // bare ASSIGNMENT
 * }
 * ```
 *
 * Before gtag is wrapped — i.e. for the whole boot window, which is when both
 * of those effects first run — the second branch **replaces** the pending
 * default set instead of merging into it. Two callers racing there means the
 * loser's parameters are silently dropped, with no error and no missing hit
 * to notice: the events still ship, just without `traffic_type`. GA4's
 * internal-traffic data filter then stops matching, our own browsing rejoins
 * the launch metrics, and because data filters are **not retroactive** none
 * of it is recoverable after the fact. A fix for a reporting nuisance would
 * have broken a reporting control.
 *
 * So this module keeps the composed set and re-sends the WHOLE of it on every
 * update. Each caller patches only the keys it owns and cannot express
 * "drop everyone else's"; the bare-assignment branch is then handed the full
 * object, which is precisely what it wants.
 *
 * ## Why a third contributor cannot reintroduce the race
 *
 * Not by remembering. `analytics-default-params.spec.ts` asserts this file is
 * the only place in `apps/console` that imports `setDefaultEventParameters`
 * from `firebase/analytics` at all — so the naive second caller, which is the
 * shape the fix for AGL-2087 was originally deferred over, fails the suite
 * rather than the property.
 *
 * ## `undefined` is a value here, not an omission
 *
 * Clearing a stamp is as load-bearing as setting one: the console does not
 * remount across a re-auth (AGL-664), so a staff session followed by a
 * customer signing in on the same document must actively lose the stamp
 * rather than inherit it. Patching a key to `undefined` therefore KEEPS the
 * key in the composed object with an undefined value — the same payload the
 * per-call-site code sent before this module existed — instead of deleting it
 * and leaving the previous value standing.
 */

export type AnalyticsDefaultParams = Record<string, string | undefined>

let composed: AnalyticsDefaultParams = {}

/**
 * Merge `patch` into the composed default set and re-send all of it.
 *
 * Returns the composed set, which is what the guards assert on — the point of
 * the whole module is a single object carrying every owner's keys at once.
 */
export function setAnalyticsDefaultParams(
  patch: AnalyticsDefaultParams,
): AnalyticsDefaultParams {
  composed = { ...composed, ...patch }
  setDefaultEventParameters({ ...composed })
  return composed
}

/** The composed set as last sent. Read-only copy; for tests and debugging. */
export function readAnalyticsDefaultParams(): AnalyticsDefaultParams {
  return { ...composed }
}

/**
 * Drop the composed set without sending anything.
 *
 * Module state outlives a component in the browser deliberately (that is the
 * point — the set has to survive the effects that write it), so tests need a
 * way back to a clean slate between cases.
 */
export function resetAnalyticsDefaultParams(): void {
  composed = {}
}
