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
 * What a delete confirmation is allowed to TELL an author about what breaks
 * (AGL-703).
 *
 * Zach: *"When we delete anything we need to make sure we show the user where
 * it is referenced (used by) … meaning things are going to break. Make sure
 * the break friendly too."*
 *
 * A separate module for the same reason `media-usage-copy.ts` is one: the
 * sentence IS the safety control, not decoration on one. The media library
 * learned this the hard way in AGL-1413 — a panel that reads
 * `references.length === 0` and prints "not used anywhere" throws the
 * information away at the last step. Artifacts had the same hole and a worse
 * version of it: `/api/hosts/where-used` reads one document past its 200-row
 * cap specifically so it can say whether there were more, and the route
 * discarded that flag before answering.
 *
 * So there are two questions here and they are kept apart:
 *
 * 1. **What is referenced?** — the dependents, listed by name.
 * 2. **What happens to them?** — the consequence, which is per KIND and is
 *    the half an author cannot look up.
 *
 * ## The consequence sentences are load-bearing, and they are true
 *
 * Every one of them describes behaviour the runtime actually has. A deleted
 * component's instances are left standing rather than throwing —
 * `composeReusableComponentNodes`: *"Unresolvable refIds leave the instance
 * untouched — a deleted definition must never take a published screen down."*
 * A screen bound to a deleted layout renders without the shared chrome rather
 * than 404ing. If either of those ever stops being true, these strings become
 * a lie told at the exact moment somebody is deciding whether to proceed.
 */

/** One thing that references the artifact being deleted. */
export interface ArtifactDependent {
  type: 'screen' | 'layout' | 'component' | 'workflow' | 'variable'
  id: string
  name: string
  versionId?: string
}

/** What `/api/hosts/where-used` answered with. */
export interface ArtifactUsageScan {
  dependents: ArtifactDependent[]
  /**
   * Whether the scan read every document it needed to.
   *
   * ABSENT means incomplete, and the default matters: an older deployment, a
   * changed response shape, a proxy that dropped the field. Every one of those
   * has to degrade to "we could not determine this", because the alternative
   * is a delete confirmation promising an artifact is unused on the strength
   * of a field that was not there.
   */
  complete: boolean
}

/** The kinds this copy covers. */
export type ArtifactUsageKind = 'component' | 'layout'

/** Coerce whatever the response carried; anything but `true` is incomplete. */
export const scanIsComplete = (value: unknown): boolean => value === true

/**
 * What happens to the things that referenced it — the FRIENDLY BREAK.
 *
 * Stated in the present tense and in terms of what the reader will see,
 * because "breaks" is not information: an author deciding whether to delete a
 * layout needs to know their pages keep serving, and an author deleting a
 * component needs to know the opposite of a white screen.
 */
export const consequenceNote = (kind: ArtifactUsageKind): string =>
  kind === 'component'
    ? 'Nothing goes down: each place it was used keeps rendering, with an ' +
      'empty space where this component was, until you replace or remove it.'
    : 'Nothing goes down: those screens keep serving, rendering without the ' +
      'shared chrome until they are bound to another layout.'

/** The lead sentence — what is being deleted. */
export const deleteConfirmationLead = (
  kind: ArtifactUsageKind,
  name: string,
): string =>
  `"${name}" will be deleted. ` +
  (kind === 'component'
    ? 'It disappears from Your components.'
    : 'It disappears from Layouts.')

/** Shown while the scan is still running. Never a blank space. */
export const SCAN_PENDING_NOTE = ' Checking where it is used…'

/**
 * The usage sentence, respecting coverage.
 *
 * FOUR outcomes, and the two easy ones are the ones that go wrong:
 *
 * - `null` — the scan failed or could not finish. Says so. A failed scan and
 *   a clean one must never read alike; that is the whole reason this returns a
 *   sentence rather than a count.
 * - INCOMPLETE and empty — "we found none, but we could not read everything".
 *   The unqualified claim is unreachable from here, which is the invariant
 *   `artifact-usage-copy.spec.ts` pins.
 * - complete and empty — the one case that may say "nothing uses it".
 * - anything found — names them, however incomplete the scan was, because
 *   everything listed is real even when the list is a lower bound.
 */
export function deleteConfirmationNote(
  scan: ArtifactUsageScan | null,
  kind: ArtifactUsageKind,
): string {
  if (!scan) {
    return (
      ' We could not check where it is used, so anything relying on it may ' +
      'change. ' + consequenceNote(kind)
    )
  }
  const { dependents, complete } = scan
  if (!dependents.length) {
    return complete
      ? ' Nothing else references it.'
      : ' Nothing found, but this site has more content than the check reads ' +
          'in one pass — something may still reference it. ' +
          consequenceNote(kind)
  }
  const names = dependents.slice(0, USAGE_NAME_LIMIT).map((item) => item.name)
  const rest = dependents.length - names.length
  const list =
    names.join(', ') + (rest > 0 ? `, and ${rest} more` : '')
  const bound = complete ? '' : ' at least'
  return (
    ` Used by${bound} ${dependents.length} ${
      dependents.length === 1 ? 'thing' : 'things'
    }: ${list}. ${consequenceNote(kind)}`
  )
}

/**
 * How many dependents to NAME before counting the rest.
 *
 * The sentence lives inside a confirmation dialog, so it has to stay readable
 * at a glance — a wall of forty screen names is the same as no answer. The
 * total is always stated, so the cap never hides how much there is.
 */
export const USAGE_NAME_LIMIT = 5
