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
 * The create-and-publish verdicts, pure (AGL-2586).
 *
 * Separated from the probe for the reason every verdict in
 * `health-report.ts` is: the probe reads Firestore and the rules control
 * plane, this decides, and a spec exercises every branch — including the
 * 2026-09-04 one — with no network and no admin credential. A red-proof that
 * needed production access to run would not be a proof anyone could run.
 */
import type { HealthCheck } from '@aglyn/aglyn/server'

import {
  PUBLISH_OUTBOX_COLLECTION,
  PUBLISH_OUTBOX_FIELDS,
  PUBLISH_OUTBOX_MAX_ATTEMPTS,
  PUBLISH_OUTBOX_STALE_MS,
} from '../../../../constants/publish-outbox'

// ── create ──────────────────────────────────────────────────────────────

export type CreateOutcome =
  /** Every preflight answered, and nothing platform-wide is refusing. */
  | { kind: 'open' }
  /** A platform lockdown is refusing writes — every create returns 423. */
  | { kind: 'platform-locked' }
  /** The org slug reservation could not be read. */
  | { kind: 'slugs-unavailable' }
  /** The subdomain uniqueness query could not be run. */
  | { kind: 'subdomains-unavailable' }
  /**
   * A probe subject EXISTS. Nothing here is broken, but this check would be
   * asserting something other than what it claims from now on, so it says so
   * rather than quietly measuring the wrong thing.
   */
  | { kind: 'subject-squatted' }
  | { kind: 'unavailable' }

export type CreateCheck = HealthCheck

export function createJourneyHealth(
  outcome: CreateOutcome,
  ms: number,
): CreateCheck {
  switch (outcome.kind) {
    case 'open':
      return { ok: true, ms }
    case 'platform-locked':
      return { ok: false, ms, code: 'platform-locked' }
    case 'slugs-unavailable':
      return { ok: false, ms, code: 'org-slugs-unavailable' }
    case 'subdomains-unavailable':
      return { ok: false, ms, code: 'subdomain-lookup-unavailable' }
    case 'subject-squatted':
      return { ok: false, ms, code: 'probe-subject-exists' }
    case 'unavailable':
    default:
      return { ok: false, ms, code: 'create-unavailable' }
  }
}

// ── publishRules ────────────────────────────────────────────────────────

export interface PublishRulesCheck extends HealthCheck {
  /**
   * Which of the publish batch's writes the LIVE rules do not cover. Rule
   * BLOCK NAMES and FIELD NAMES only — both are already public in the sense
   * that matters (they describe our own schema, not anyone's data), and
   * without them a red says "publishing is refused" and nothing about why.
   */
  uncovered: string[]
  /**
   * Present, and always `false`, only when the live ruleset could not be
   * read at all (AGL-1843's shape, as `BackupsCheck` uses it). An
   * indeterminate check reports `ok: true` and does not page — see
   * `publishRulesHealth` for why that is bounded rather than silent.
   */
  determinate?: false
}

/**
 * Everything the publish batch writes, as the live rules must name it.
 *
 * Derived from the constants the client actually writes rather than
 * hand-listed, so a change to either side of the contract shows up here. The
 * `hosts` blocks predate the outbox by a long way and have never been the
 * thing that shipped late — they are listed because "the write set" is the
 * unit worth asserting, and a rules refactor that dropped one would be the
 * same outage.
 */
export const PUBLISH_BATCH_RULE_BLOCKS = [
  // The routing map itself — `hosts/{hostId}.screens.{screenId}`.
  'match /hosts/{hostId} {',
  // The per-screen document, whose `slug` and `publishedAt` ride the same
  // batch. NESTED under the host block in the rules file, so it is spelled
  // the way the file spells it rather than as the full document path.
  'match /screens/{screenId} {',
  // The durable announce. The one that was not live on 2026-09-04.
  `match /${PUBLISH_OUTBOX_COLLECTION}/`,
] as const

/**
 * Does this rules source still admit the publish batch?
 *
 * A STRUCTURAL assertion, and deliberately not an evaluation: it asks
 * whether the live source declares a block for each document the batch
 * writes, and whether the outbox block's field pin still names every field
 * the client sends. That is exactly the drift that has actually happened —
 * a block that had not been deployed yet — and it needs no simulated
 * identity, no test-ruleset call and no interpretation of a rule's logic,
 * which is where a checker of this kind would otherwise start disagreeing
 * with the engine.
 *
 * `source` is null when the live ruleset could not be read.
 */
export function publishRulesHealth(
  source: string | null,
  ms: number,
): PublishRulesCheck {
  if (source === null) {
    /*
     * INDETERMINATE, not degraded, and this is the one place in this file
     * that does not page on a failure.
     *
     * Reading the live ruleset needs the deployment's credential to carry
     * `firebaserules.releases.get`, which is granted outside this repo and
     * cannot be asserted from it. A deployment without it would otherwise
     * answer 503 forever — a permanent red about our own configuration,
     * which is the false alarm that teaches everyone to ignore the board.
     *
     * It is bounded rather than silent because the same guarantee has a
     * second, independent path: `publish-probe-can-go-red.spec.ts` asserts
     * the REPO's rules cover this write set at review time, and the `Rules
     * drift` workflow asserts the live ruleset matches the promoted repo
     * file daily and on every push to `production`. This check is the
     * continuous one of the three, not the only one.
     */
    return { ok: true, ms, code: 'rules-unreadable', uncovered: [], determinate: false }
  }
  const uncovered: string[] = []
  for (const block of PUBLISH_BATCH_RULE_BLOCKS) {
    if (!source.includes(block)) uncovered.push(block)
  }
  // The field pin, checked only when the block is there at all — otherwise a
  // missing block reports four faults for one fact.
  if (!uncovered.length) {
    const outbox = outboxBlock(source)
    for (const field of PUBLISH_OUTBOX_FIELDS) {
      if (!outbox.includes(`'${field}'`)) uncovered.push(`${PUBLISH_OUTBOX_COLLECTION}.${field}`)
    }
  }
  if (uncovered.length) {
    return { ok: false, ms, code: 'publish-rules-uncovered', uncovered }
  }
  return { ok: true, ms, uncovered: [] }
}

/**
 * The outbox match block's text, from its opening to the end of the source.
 *
 * Deliberately not a brace-matched parse. The field pin lives in the create
 * arm, which is the first thing in the block, and a rules file is not a
 * grammar this probe should try to own — a parser that got it subtly wrong
 * would fail closed on a perfectly good ruleset, which is worse than the
 * looser match. The `uncovered` list names what was not found either way.
 */
function outboxBlock(source: string): string {
  const at = source.indexOf(`match /${PUBLISH_OUTBOX_COLLECTION}/`)
  return at < 0 ? '' : source.slice(at)
}

// ── publishAnnounce ─────────────────────────────────────────────────────

/** One outbox entry, reduced to the two facts the verdict needs. */
export interface OutboxEntryFacts {
  ageMs: number
  attempts: number
}

export interface PublishAnnounceCheck extends HealthCheck {
  /** Entries pending at all. In flight is normal and is not a fault. */
  pending: number
  /** Entries older than `PUBLISH_OUTBOX_STALE_MS` — something is refusing. */
  stale: number
  /** Entries that spent their attempts. A publish that never reached the site. */
  stalled: number
}

/**
 * Grade the outbox.
 *
 * ## Why absence reads healthy here, and is not the AGL-1843 mistake
 *
 * A successful publish deletes its own entry, so an empty collection means
 * every announce landed. That is the opposite shape from a count that goes
 * quiet because nobody tried: the entries are written by the SAME batch that
 * publishes, so a publish that happened always left something, and a publish
 * that did not happen is a different check's job (`publishRules` above, and
 * the org-creation volume alarm for the funnel above that).
 *
 * `entries` is null when the collection could not be read, which is degraded
 * by contract — an alarm that cannot see the thing it watches must not
 * report calm.
 */
export function publishAnnounceHealth(
  entries: OutboxEntryFacts[] | null,
  ms: number,
): PublishAnnounceCheck {
  if (!entries) {
    return { ok: false, ms, code: 'outbox-unavailable', pending: 0, stale: 0, stalled: 0 }
  }
  const stalled = entries.filter(
    (entry) => entry.attempts >= PUBLISH_OUTBOX_MAX_ATTEMPTS,
  ).length
  const stale = entries.filter(
    (entry) => entry.ageMs >= PUBLISH_OUTBOX_STALE_MS,
  ).length
  const base = { ms, pending: entries.length, stale, stalled }
  if (stalled > 0) return { ...base, ok: false, code: 'announce-stalled' }
  if (stale > 0) return { ...base, ok: false, code: 'announce-stale' }
  return { ...base, ok: true }
}
