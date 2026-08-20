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

/**
 * Did the read that produced this list actually SUCCEED? (AGL-1066)
 *
 * A zero-state is a claim about the customer's DATA — "you have no sites",
 * "your library is empty". A refused or unfinished read supports no such
 * claim; all it establishes is that we could not look. `media-library` states
 * the rule at its own call site (AGL-1062): *"no media" is a claim about the
 * library, and a failed read is a claim about us.* This module is that rule
 * made shared, because the console had it in exactly one place and every
 * other list surface reached the opposite conclusion from the same evidence.
 *
 * ## Why a three-valued type and not a boolean
 *
 * Because two of the three states produce an empty array, and only one of
 * them licenses the sentence. `loading` and `unavailable` both look like
 * `items.length === 0` from the outside, which is precisely how a load window
 * and a dead session both rendered as "No sites yet".
 *
 * ## Why it must be passed EXPLICITLY, and never defaulted
 *
 * A default answers the question for a caller who never asked it. That is the
 * AGL-1380 bug shape — a loading default that reads as data — and it is the
 * one this type exists to make unrepresentable. `EmptyState` therefore takes
 * `read` as a REQUIRED prop: a surface cannot render a zero-state without
 * first stating, in code, that its read succeeded.
 *
 * ## Reading a hook's state
 *
 * The console's list hooks converged on `{ ready, error }` (`useOrgHosts`,
 * `useOrgScope`), where `error` means "this read gave up", not "this read
 * returned nothing". {@link readOutcome} is the one translation from that
 * pair, so the precedence — an error outranks a pending read — is decided
 * once instead of at every call site.
 */

/**
 * `loaded` is the ONLY value that licenses a zero-state. The other two mean
 * "the list is empty because we do not know", which is a different sentence
 * and a different UI.
 */
export type ReadOutcome = 'loading' | 'loaded' | 'unavailable'

export interface ReadState {
  /** The read settled — succeeded or gave up. */
  ready: boolean
  /** The read gave up. Says nothing about what exists. */
  error: boolean
}

/**
 * Translate a list hook's `{ ready, error }` into a {@link ReadOutcome}.
 *
 * `=== true` / `=== false` rather than truthiness on purpose:
 * `strictNullChecks` is off repo-wide, so an `undefined` from a hook that has
 * not adopted the pair yet must fall to `loading` — the conservative value —
 * instead of silently reading as "loaded, and empty".
 *
 * `error` is checked first: a read that gave up is not still in flight, and a
 * hook that latches `ready` alongside `error` (both of ours do) would
 * otherwise be ambiguous.
 */
export function readOutcome(state: Partial<ReadState> | undefined): ReadOutcome {
  if (state?.error === true) return 'unavailable'
  if (state?.ready === true) return 'loaded'
  return 'loading'
}

export default readOutcome
