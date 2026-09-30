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

import type { PublisherAgreementState } from './publisher-agreement'

/**
 * The machine-readable half of an agreement refusal (AGL-3407).
 *
 * Every publish route refuses through `publishPreconditionRefusal`, which
 * answers 412 with `{ error, agreement }`. `error` is prose for a person;
 * `agreement` is this, for the console — the version in force, the one the
 * org accepted, which of the two problems it is, and which org is being asked.
 */
export interface PublisherAgreementRefusal {
  /** The version in force, which an acceptance must name. */
  required: string
  /** The version the org accepted, or null when it never has. */
  accepted: string | null
  /** `none` or `outdated` — a refusal is never `current`. */
  state: Exclude<PublisherAgreementState, 'current'>
  /** The org the acceptance binds; absent from a route that predates it. */
  orgId?: string
}

/**
 * The agreement refusal in a response body, or null when the body is anything
 * else.
 *
 * Reads the structured field and never the prose: the message is rewritten
 * whenever the copy is, and a client that matched on it would stop
 * recognizing the refusal on the day someone improved a sentence. A body with
 * a `state` of `current`, or none at all, is not this refusal whatever else it
 * says.
 */
export function publisherAgreementRefusalOf(
  payload: unknown,
): PublisherAgreementRefusal | null {
  const agreement = (payload as { agreement?: unknown } | null | undefined)
    ?.agreement
  if (!agreement || typeof agreement !== 'object') return null
  const { required, accepted, state, orgId } = agreement as Record<
    string,
    unknown
  >
  if (state !== 'none' && state !== 'outdated') return null
  if (typeof required !== 'string' || !required) return null
  return {
    required,
    accepted: typeof accepted === 'string' && accepted ? accepted : null,
    state,
    ...(typeof orgId === 'string' && orgId ? { orgId } : {}),
  }
}
