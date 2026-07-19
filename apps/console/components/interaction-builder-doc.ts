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

import type { HostAction } from '@aglyn/aglyn'

/**
 * Deeply removes `undefined`-valued keys so a value is safe to hand to
 * Firestore's `setDoc` (AGL-570). This app's Firestore is initialized
 * WITHOUT `ignoreUndefinedProperties` (see the tenant firebase-services
 * init), so a single `undefined` anywhere in the payload rejects the
 * ENTIRE write. The interaction builder's action-type `<TextField>` reset
 * stamps every step with `className`/`message`/`drawerNodeId`/… set to
 * `undefined`, which is exactly why besigner-authored element interactions
 * silently failed to reach `hosts/{hostId}/actions` and never fired on the
 * live site.
 *
 * Plain objects and arrays recurse; class instances (Date, Firestore
 * `Timestamp`) pass through untouched, and falsy-but-defined values
 * (`0`, `''`, `false`, `null`) are preserved.
 */
export function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneUndefined(entry)) as unknown as T
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as object).constructor === Object
  ) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry !== undefined) out[key] = pruneUndefined(entry)
    }
    return out as unknown as T
  }
  return value
}

export interface InteractionCandidateInput {
  name: string
  /** Site-event trigger (elementClick / elementHoverEnter / …). */
  event: string
  /** The node's stable `[data-aglyn="leaf:<id>"]` selector. */
  selector: string
  /** every | always | session | visitor | cooldown. */
  frequency: string
  cooldownMinutes: number
  steps: Array<Record<string, unknown> & { type: string }>
}

/**
 * Builds the `hosts/{hostId}/actions/{id}` doc the interaction builder
 * persists (AGL-319/562/568). The trigger targets the element by its
 * `data-aglyn` selector on the chosen site event; the frequency maps to
 * the trigger's cap flags. The result is run through {@link pruneUndefined}
 * so the write is never rejected by Firestore for a stray `undefined`
 * (AGL-570) — the reason element interactions never persisted before.
 */
export function buildInteractionCandidate(
  input: InteractionCandidateInput,
): HostAction {
  const { name, event, selector, frequency, cooldownMinutes, steps } = input
  const trigger: Record<string, unknown> = { event, selector }
  if (frequency === 'every') trigger.everyTime = true
  if (frequency === 'session') trigger.oncePerSession = true
  if (frequency === 'visitor') trigger.oncePerVisitor = true
  if (frequency === 'cooldown') trigger.cooldownMinutes = cooldownMinutes
  return pruneUndefined({
    name,
    trigger,
    steps,
    enabled: true,
  }) as unknown as HostAction
}

export default buildInteractionCandidate
