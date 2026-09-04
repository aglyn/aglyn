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
 * RE-CHECKING A VERIFIED SENDING DOMAIN.
 *
 * `verifySendingDomain` runs when an admin presses Verify and never again, so
 * a domain that proved itself once was trusted for as long as the record
 * existed. DNS does not hold still: a customer migrates their zone, prunes an
 * unrecognized TXT record, or lets the domain lapse, and the platform keeps
 * signing mail as a name whose owner has withdrawn permission to.
 *
 * ## The failure this must not become
 *
 * The obvious sweep — re-run the check nightly, write what it says — is worse
 * than no sweep. A DNS lookup cannot tell "the record is gone" from "nobody
 * answered", so the obvious sweep un-verifies every customer at once during a
 * resolver outage and every one of them silently stops being able to mail.
 * That is a platform-wide, self-inflicted outage in exchange for closing a
 * slow leak.
 *
 * Two independent things stop it:
 *
 * 1. **The probe's third outcome.** `assessSendingRecords` answers
 *    `inconclusive` unless all three lookups ANSWERED, and `dns-probe.ts` asks
 *    public resolvers before the runtime's own precisely so a stale local
 *    resolver cannot manufacture a conclusive miss. An inconclusive pass here
 *    writes nothing but the check time.
 * 2. **The drift discipline.** Even a conclusive miss is counted rather than
 *    acted on, through the same {@link assessDomainDrift} the SSO domain sweep
 *    uses. An unattended sweep is not an admin watching a button: nobody sees
 *    its verdict, so it needs more evidence than one answer before it costs a
 *    customer their sending.
 *
 * ## Where this diverges from the SSO sweep, and why
 *
 * `assessDomainDrift` has no `revoke` — its strongest verdict is `report`,
 * because revoking an SSO domain locks people out of their own account and
 * that is a human's call. Here the same verdict DOES change the status, and
 * the asymmetry is in what the change costs: an un-verified sending domain
 * makes the site's sends REFUSE, and a refusal is recoverable by publishing
 * the record and pressing Verify. It never quietly moves the tenant's mail
 * back onto the shared platform domain, which is the outcome the whole feature
 * exists to prevent and which no amount of drift would justify.
 *
 * ## What it does not do
 *
 * It re-checks `verified` domains only. Walking `records-issued` domains to
 * see whether a customer has published yet is a different job with a different
 * cadence and a different failure mode (an onboarding poller, not a trust
 * expiry), and folding the two together would mean one interval serving
 * neither.
 */

import { assessDomainDrift, type DomainProbeStatus } from './sso-drift-logic'
import firebaseAdmin from './firebase-admin'
import {
  probeSendingRecords,
  readSendingDomainRecord,
  SENDING_DOMAINS_COLLECTION,
} from './sending-domains'

/**
 * How stale a verified domain's last check must be before it is re-read.
 *
 * Daily. The thing being detected — a customer editing their zone — happens on
 * a human timescale, and a tighter cadence buys hours of detection for a
 * multiple of the DNS traffic and the write volume. It also sets the floor on
 * how long a genuinely removed record keeps sending: three conclusive misses
 * at a day apart, which the age floor below holds to at least three days.
 */
export const SENDING_DOMAIN_RECHECK_AFTER_MS = 24 * 60 * 60_000

/**
 * Conclusive failures in a row before a verified domain is un-verified.
 *
 * Three. The evidence for each one is already strong — all three lookups
 * answered, across pinned public resolvers — so this is not compensating for a
 * weak probe. It is compensating for the one failure the probe cannot see: the
 * resolvers agreeing on a wrong answer, which `dns-probe.ts` documents having
 * happened once already with a stale zone.
 */
export const SENDING_DOMAIN_FAILURES_BEFORE_REVOKE = 3

/**
 * And the wall-clock floor the same run must clear, independent of the count.
 *
 * Both, for the reason the SSO threshold gives: a count alone can be run up in
 * minutes by a beat firing more often than anyone intended, or by somebody
 * re-running the sweep by hand, and "we checked three times" then reads as
 * diligence while meaning nothing.
 *
 * Three days is what three daily checks ought to take. It is not a long time
 * to keep signing for a domain whose records are gone: once the DKIM record is
 * removed our signature stops validating anyway, so the mail is already
 * failing — un-verifying is how the product stops PRETENDING otherwise, not
 * what stops the bad mail.
 */
export const SENDING_DOMAIN_DRIFT_MIN_AGE_MS = 3 * 24 * 60 * 60_000

/** Domains one beat will re-check. The rest are picked up on the next one. */
export const SENDING_DOMAIN_RECHECK_BATCH = 25

/** What one pass settled. */
export interface SendingDomainRecheckSummary {
  /** Domains probed. */
  checked: number
  /** Probes that established nothing, and changed nothing. */
  held: number
  /** Domains still publishing their records; any failure run ended. */
  cleared: number
  /** Conclusive misses recorded, without acting on them yet. */
  counted: number
  /** Domains moved out of `verified`. */
  revoked: number
}

const EMPTY: SendingDomainRecheckSummary = {
  checked: 0,
  held: 0,
  cleared: 0,
  counted: 0,
  revoked: 0,
}

/**
 * A probe verdict as the drift assessor's vocabulary.
 *
 * The mapping is the whole safety property of this module written in three
 * lines, which is why it is a named function rather than a ternary inside the
 * loop: `inconclusive` becomes `unreachable`, which `assessDomainDrift` holds
 * on — it neither counts the failure nor clears a run already gathered. An
 * outage must not manufacture evidence, and must not launder away evidence
 * either.
 */
export function driftProbeStatus(
  verdict: 'verified' | 'failed' | 'inconclusive',
): DomainProbeStatus {
  if (verdict === 'inconclusive') return 'unreachable'
  return verdict === 'verified' ? 'proven' : 'missing'
}

export interface SendingDomainRecheckOptions {
  nowMs?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: any
  batch?: number
  recheckAfterMs?: number
  failuresBeforeRevoke?: number
  minAgeMs?: number
}

/**
 * Re-check the verified sending domains whose last check has gone stale.
 *
 * Bounded and idempotent, as every handler on the job beat must be: each pass
 * stamps `lastCheckedAtMs`, which moves the domain to the back of the queue,
 * so the sweep resumes without carrying a cursor and an overlapping beat
 * re-checks at worst a domain that was just checked.
 *
 * Never throws for one bad zone. A single unresolvable domain must not stop
 * the platform's other customers from being checked, and the runner's error
 * isolation is a coarser tool than that — it would lose the rest of the batch.
 */
export async function recheckSendingDomains(
  options: SendingDomainRecheckOptions = {},
): Promise<SendingDomainRecheckSummary> {
  const nowMs = options.nowMs ?? Date.now()
  const store = options.firestore ?? firebaseAdmin.app().firestore()
  const cutoff =
    nowMs - (options.recheckAfterMs ?? SENDING_DOMAIN_RECHECK_AFTER_MS)

  /*
   * The staleness bound is IN the query, not applied after it. A beat with
   * nothing due then bills one empty read instead of reading a batch of
   * freshly-checked documents to discard them — the standing rule about reads
   * that nobody asked for, on a path that fires unattended forever.
   *
   * Ordered by the same field the inequality is on, so the least recently
   * checked come first and no domain can be starved by a busier neighbour.
   * Needs the (status, lastCheckedAtMs) collection-group index; without it
   * this throws and the runner isolates the failure.
   *
   * The order also decides which documents are VISIBLE: Firestore drops a
   * document that has no `lastCheckedAtMs` at all. Nothing writes
   * `status: 'verified'` except `verifySendingDomain`, which stamps
   * `lastCheckedAtMs` in the same `set`, so no verified document can lack it —
   * an invariant `sending-domain-recheck.spec.ts` pins, because a future
   * second writer of that status would silently make its domains invisible
   * here rather than failing.
   */
  let due: any[]
  try {
    const snapshot = await store
      .collectionGroup(SENDING_DOMAINS_COLLECTION)
      .where('status', '==', 'verified')
      .where('lastCheckedAtMs', '<', cutoff)
      .orderBy('lastCheckedAtMs', 'asc')
      .limit(options.batch ?? SENDING_DOMAIN_RECHECK_BATCH)
      .get()
    due = snapshot?.docs ?? []
  } catch (error) {
    // A missing index reads exactly like this. Reported and returned empty
    // rather than thrown: the runner's isolation would be the same outcome
    // with a less specific log line.
    console.error('[sending-domains] re-check query failed', error)
    return { ...EMPTY }
  }

  const summary: SendingDomainRecheckSummary = { ...EMPTY }
  for (const doc of due) {
    try {
      summary.checked += 1
      await recheckOneDomain(doc, nowMs, options, summary)
    } catch (error) {
      // Counted as checked and not as anything else: the domain keeps its
      // status and its failure run, and the next beat tries again.
      console.error(
        `[sending-domains] re-check failed for ${doc?.id ?? 'unknown'}`,
        error,
      )
    }
  }
  return summary
}

async function recheckOneDomain(
  doc: any,
  nowMs: number,
  options: SendingDomainRecheckOptions,
  summary: SendingDomainRecheckSummary,
): Promise<void> {
  const record = readSendingDomainRecord(doc)
  if (!record) return

  const verdict = await probeSendingRecords(record)
  const data = doc.data?.() ?? {}
  const drift = assessDomainDrift(
    { status: driftProbeStatus(verdict.status), records: [] },
    {
      consecutiveFailures: Number(data.recheckFailures) || 0,
      firstFailureAtMs: Number(data.recheckFirstFailureAtMs) || null,
    },
    nowMs,
    options.failuresBeforeRevoke ?? SENDING_DOMAIN_FAILURES_BEFORE_REVOKE,
    options.minAgeMs ?? SENDING_DOMAIN_DRIFT_MIN_AGE_MS,
  )

  const del = firebaseAdmin.firestore.FieldValue.delete()

  if (drift.action === 'hold') {
    // The check happened, so the timestamp moves; nothing else does. Moving it
    // is what keeps an unreachable domain from monopolizing every batch while
    // a resolver is down, and it costs at most one delayed re-check.
    summary.held += 1
    await doc.ref.set({ lastCheckedAtMs: nowMs }, { merge: true })
    return
  }

  if (drift.action === 'clear') {
    summary.cleared += 1
    await doc.ref.set(
      {
        lastCheckedAtMs: nowMs,
        // A run that ended leaves no trace. Keeping a stale count would make
        // the NEXT unrelated failure the third one.
        recheckFailures: del,
        recheckFirstFailureAtMs: del,
        lastMissing: del,
      },
      { merge: true },
    )
    return
  }

  if (drift.action === 'count') {
    summary.counted += 1
    await doc.ref.set(
      {
        lastCheckedAtMs: nowMs,
        recheckFailures: drift.consecutiveFailures,
        recheckFirstFailureAtMs: drift.firstFailureAtMs,
        // Recorded while the domain is still verified and still sending, so
        // the console can say WHICH record went missing before the deadline
        // rather than only after it.
        lastMissing: verdict.missing,
      },
      { merge: true },
    )
    return
  }

  summary.revoked += 1
  await doc.ref.set(
    {
      status: 'failed',
      lastCheckedAtMs: nowMs,
      lastMissing: verdict.missing,
      // The run is spent. A domain that is re-verified and drifts again starts
      // its own count rather than inheriting this one.
      recheckFailures: del,
      recheckFirstFailureAtMs: del,
    },
    { merge: true },
  )
  console.warn(
    `[sending-domains] un-verified ${record.domain}: ${verdict.missing.join(', ')}`,
  )
}

export default recheckSendingDomains
