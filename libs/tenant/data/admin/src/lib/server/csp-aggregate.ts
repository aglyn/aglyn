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
 * Durable CSP-violation aggregates (AGL-1799).
 *
 * The collectors were delivering reports into a sink that forgets: the Vercel
 * runtime log retains ~60 minutes and there is no log drain, so AGL-1702's
 * "a week of signed-in traffic" and AGL-1726's "a business week of visitor
 * traffic" were gated on evidence that structurally could not exist. This
 * module is the durable half — the log lines stay exactly as they were (they
 * are still the right tool for the last hour), and every accepted violation
 * ALSO compounds into a Firestore counter that holds for the retention window.
 *
 * ## Shape: counters, never report bodies
 *
 * One document per (UTC day x app x directive x disposition x blocked origin),
 * with `FieldValue.increment` — NOT one document per report. AGL-523 made a
 * deliberate choice not to write report bodies to Firestore from an
 * unauthenticated route, and AGL-1799 argued the distinction explicitly: "a
 * counter with a bounded key space is a different proposition from storing
 * report bodies". The bound is what this module is careful about, because
 * every key ingredient except the day is attacker-influenced:
 *
 *  - the DIRECTIVE is normalized into a closed set (a real browser can only
 *    ever send a spec directive; anything else lands in `other` rather than
 *    minting a document per invented directive);
 *  - the ORIGIN is reduced to the host of `blocked-uri` (or its bare keyword
 *    — `inline`, `eval`, `data`), sanitized to a fixed character set, and
 *    capped: at most {@link MAX_DISTINCT_ORIGINS_PER_DAY} distinct origins per
 *    (day x app x directive) may mint documents per instance per day. Beyond
 *    that, new origins are dropped while known ones keep counting — a flood
 *    of unique URLs (the AGL-1769 lesson: never let request content mint
 *    unbounded documents) saturates the cap instead of the collection;
 *  - WRITES are budgeted per instance per minute, so a POST flood cannot turn
 *    an unauthenticated beacon into a Firestore write bill even against
 *    already-minted documents.
 *
 * Every cap here is per instance, like the tenant collector's `keyStore`: the
 * fleet-wide worst case is (instances x cap), which is bounded and small,
 * and an instance recycle merely re-counts an origin against a fresh cap —
 * the merge write is idempotent about which document it lands in.
 *
 * ## Ids are attacker-derived, so they go through `isDocumentId`
 *
 * Key parts are sanitized to `[a-z0-9.:_-]` and joined with `|`, then the
 * whole id is checked with {@link isDocumentId} (the AGL-1771 predicate —
 * imported from its leaf, `./document-id`, which imports nothing). Belt and
 * braces: the sanitizer already removes `/` and the joiner makes a reserved
 * `__x__` form impossible, but the predicate is the contract and it is
 * cheaper to check than to argue.
 *
 * ## Retention is TTL, not a sweep
 *
 * `expiresAt` (a Timestamp — TTL refuses numbers) is set
 * {@link CSP_AGGREGATE_RETENTION_DAYS} days past the day bucket. The TTL
 * policy is a gcloud action plus a `fieldOverrides` entry in
 * `cloud/firebase-firestore.indexes.json` — see
 * docs/FIRESTORE_MANUAL_CONFIG.md (AGL-1793): the entry ships with this
 * module and the gcloud enable is owed at deploy time.
 *
 * ## Fail-soft, like everything on this path
 *
 * A collector must never turn an observed problem into a served one. Every
 * failure here — no credential, Firestore down, a hostile id that survives
 * sanitization — drops the aggregate (one `console.error` line, tagged) and
 * returns. The log lines the collectors already emit are unaffected.
 *
 * No client ever reads or writes this collection: there is no rules `match`
 * for it, and Firestore denies what nothing matches, so the Admin SDK is the
 * only path in. The staff read-back is `/api/admin/csp-reports` on the
 * console.
 */

import { FieldValue } from 'firebase-admin/firestore'
import type { CspViolation } from '@aglyn/aglyn/app-utils/csp-report'
import { isDocumentId } from './document-id'

/** Top-level collection of counter documents. Server-only; no rules match. */
export const CSP_AGGREGATE_COLLECTION = 'cspViolationDaily'

/**
 * Long enough that "a week of traffic" (AGL-1702 condition 1, AGL-1726
 * condition 3) is readable with room to be read late, short enough that the
 * collection stays a working set rather than an archive.
 */
export const CSP_AGGREGATE_RETENTION_DAYS = 60

/**
 * Distinct blocked origins that may mint documents per (day x app x
 * directive), per instance. A legitimate policy violates against a handful of
 * hosts; thirty is generous headroom for a real regression while keeping a
 * flood of attacker-invented origins from minting unbounded documents.
 */
export const MAX_DISTINCT_ORIGINS_PER_DAY = 30

/**
 * Aggregate writes allowed per instance per minute. Distinct-origin capping
 * bounds document COUNT; this bounds write OPS, which are billed even when
 * they land on existing documents. Sized far above what real browsers on one
 * instance produce and far below what makes a flood expensive.
 */
const WRITE_BUDGET_PER_MINUTE = 120

/**
 * The directives a browser can actually report, per the CSP3 registry. An
 * unrecognized directive is a non-browser caller (or a future spec revision)
 * and shares one bucket rather than minting its own key space.
 */
const KNOWN_DIRECTIVES = new Set([
  'base-uri',
  'block-all-mixed-content',
  'child-src',
  'connect-src',
  'default-src',
  'font-src',
  'form-action',
  'frame-ancestors',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'prefetch-src',
  'script-src',
  'script-src-attr',
  'script-src-elem',
  'style-src',
  'style-src-attr',
  'style-src-elem',
  'upgrade-insecure-requests',
  'worker-src',
])

/**
 * Per-instance mint tracker: (day|app|directive) to the origin|disposition
 * pairs that have been allowed to mint documents. Cleared wholesale at the
 * cap, like the tenant collector's `keyStore`: the failure mode of clearing
 * is a brief widening of the mint cap, strictly better than an unbounded map
 * fed by attacker-chosen keys.
 */
const mintTracker = new Map<string, Set<string>>()
const MAX_TRACKED_GROUPS = 512

/** Per-instance write budget window. */
let budgetWindowStartMs = 0
let budgetUsed = 0

/** Test seam: module-scope state would otherwise leak across cases. */
export function resetCspAggregateStateForTests(): void {
  mintTracker.clear()
  budgetWindowStartMs = 0
  budgetUsed = 0
}

/** One id/field component: lowercase, fixed charset, never empty. */
function sanitizePart(value: string, max: number): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9.:_-]+/g, '-')
    .slice(0, max)
  return cleaned || 'unknown'
}

/**
 * `blocked-uri` reduced to the coarsest thing worth counting: the HOST for a
 * URL, the bare keyword (`inline`, `eval`, `data`, ...) otherwise. Paths are
 * deliberately dropped — twelve chunk URLs off one CDN are one origin-level
 * fact (the AGL-1779 shape), and a path would both explode the key space and
 * hand the id to whoever controls the URL.
 */
export function cspBlockedOrigin(blockedUri: string): string {
  if (!blockedUri) return 'none'
  try {
    return sanitizePart(new URL(blockedUri).host, 120)
  } catch {
    return sanitizePart(blockedUri, 40)
  }
}

/** UTC day bucket, `YYYY-MM-DD`. */
export function cspAggregateDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

function normalizeDirective(directive: string): string {
  return KNOWN_DIRECTIVES.has(directive) ? directive : 'other'
}

export interface RecordCspViolationsOptions {
  /** Which collector this came through — part of the counter key. */
  app: 'console' | 'tenant'
  /**
   * The reporting site (tenant only), REQUEST-derived and already clamped by
   * the caller. Stored as a sample field, never in the id: distinct sites
   * must not multiply the key space.
   */
  site?: string
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: any
}

/**
 * Compound `violations` into the daily counters. Never throws; returns how
 * many documents were written (0 on any failure, budget exhaustion included).
 */
export async function recordCspViolations(
  violations: readonly CspViolation[],
  options: RecordCspViolationsOptions,
): Promise<number> {
  try {
    if (!violations.length) return 0
    const now = options.now ?? Date.now()
    const day = cspAggregateDay(now)
    const dayStartMs = Date.parse(`${day}T00:00:00.000Z`)

    // Group first: N occurrences of one key in a batch are ONE write carrying
    // increment(N), so a page that repeats itself costs one op, not N.
    const grouped = new Map<
      string,
      { n: number; directive: string; origin: string; violation: CspViolation }
    >()
    for (const violation of violations) {
      const directive = normalizeDirective(violation.effectiveDirective)
      const origin = cspBlockedOrigin(violation.blockedUri)
      const disposition = sanitizePart(violation.disposition || 'report', 16)
      const id = [
        day,
        options.app,
        sanitizePart(directive, 64),
        disposition,
        origin,
      ].join('|')
      // Belt and braces — the AGL-1771 contract for anything handed to
      // `.doc()`. The sanitizer above should make this unreachable.
      if (!isDocumentId(id)) continue

      const existing = grouped.get(id)
      if (existing) {
        existing.n += 1
        continue
      }

      // Distinct-origin cap, per (day x app x directive). Known pairs keep
      // counting; new pairs beyond the cap are dropped — bounded documents
      // is the property, not perfect counts.
      const groupKey = `${day}|${options.app}|${directive}`
      if (mintTracker.size > MAX_TRACKED_GROUPS) mintTracker.clear()
      let minted = mintTracker.get(groupKey)
      if (!minted) {
        minted = new Set()
        mintTracker.set(groupKey, minted)
      }
      const pair = `${disposition}|${origin}`
      if (!minted.has(pair)) {
        if (minted.size >= MAX_DISTINCT_ORIGINS_PER_DAY) continue
        minted.add(pair)
      }

      grouped.set(id, { n: 1, directive, origin, violation })
    }
    if (!grouped.size) return 0

    // Write budget: fixed one-minute window per instance.
    if (now - budgetWindowStartMs >= 60_000) {
      budgetWindowStartMs = now
      budgetUsed = 0
    }
    const room = WRITE_BUDGET_PER_MINUTE - budgetUsed
    if (room <= 0) return 0
    const entries = [...grouped.entries()].slice(0, room)
    budgetUsed += entries.length

    const firestore =
      options.firestore ??
      // Lazily resolved so this module stays inert at load: route specs and
      // this module's own spec inject a fake, and nothing initializes
      // firebase-admin just by importing the barrel.
      (await import('./firebase-admin')).firebaseAdmin.app().firestore()

    await Promise.all(
      entries.map(([id, { n, directive, origin, violation }]) =>
        firestore
          .collection(CSP_AGGREGATE_COLLECTION)
          .doc(id)
          .set(
            {
              day,
              app: options.app,
              directive,
              origin,
              disposition: sanitizePart(violation.disposition || 'report', 16),
              count: FieldValue.increment(n),
              lastSeenMs: now,
              // Samples, not keys: enough to find the surface, no power to
              // mint documents. Already clamped by the parser; clamped again
              // because this module's contract should not depend on that.
              lastPath: violation.documentPath.slice(0, 200),
              ...(options.site ? { lastSite: options.site.slice(0, 253) } : {}),
              // Timestamp-typed via Date — Firestore TTL refuses numbers.
              expiresAt: new Date(
                dayStartMs + CSP_AGGREGATE_RETENTION_DAYS * 86_400_000,
              ),
            },
            { merge: true },
          ),
      ),
    )
    return entries.length
  } catch (error) {
    // Fail-soft: the aggregate is an observer, and `console.error` rather
    // than `console.warn` on purpose — the collectors' own log lines are
    // warns, and their specs count warns.
    console.error(
      JSON.stringify({
        tag: 'AGL-1799:csp-aggregate',
        error: String(error).slice(0, 200),
      }),
    )
    return 0
  }
}
