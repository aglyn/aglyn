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
 * REPEAT-INFRINGER POLICY — the §512(i) condition, with a counter behind it
 * (AGL-1983).
 *
 * §512(i)(1)(A) conditions the ENTIRE safe harbour — every limitation in
 * §512, not just the hosting one — on a provider having "adopted and
 * reasonably implemented" a policy for terminating repeat infringers, and on
 * informing subscribers of it. This is the condition providers most often
 * lose on, and they lose on the second half: courts have declined to credit a
 * policy that existed as prose while nothing in the product counted anything.
 * A policy page alone would not close AGL-1983 and the issue says so.
 *
 * So this module is the counting. It answers three questions and nothing else:
 * what is a strike, when does one go away, and what happens at the threshold.
 *
 * ## A strike is an ACTIONED notice, counted against the ACCOUNT
 *
 * Not a received notice — anyone can send one, and counting receipts would
 * let a competitor terminate a customer by filing three complaints. A strike
 * is recorded when staff action a DMCA report: the point at which a human
 * looked and took content down.
 *
 * Counted against the **org**, not the site. A repeat infringer who loses one
 * site and opens another inside the same workspace has not been terminated in
 * any sense the statute would recognise, and the org is the account we bill,
 * suspend and close. {@link STRIKE_LEDGER_SUBCOLLECTION} therefore hangs off
 * `orgs/{orgId}`.
 *
 * ## A strike is keyed by its report, which is what makes withdrawal work
 *
 * One ledger document per actioned report, with the report's id AS the
 * document id. Two properties fall out of that and both are load-bearing:
 *
 *  - **Idempotence.** Staff re-actioning a report they already actioned — or
 *    a route retried — cannot inflate the count. A counter that can be pumped
 *    by clicking twice is not one anybody should terminate an account on.
 *  - **Exact withdrawal.** When a notice is withdrawn, or a counter-notice
 *    leads to a restoration, the strike it created has to come off — and only
 *    that one. §512(g) restoration means the takedown is being reversed; a
 *    strike surviving it would count an infringement the process just
 *    declined to affirm, which is the shape of unfairness that makes a policy
 *    look unreasonable rather than reasonable. Deleting by report id removes
 *    exactly the right strike without recomputing anything.
 *
 * {@link strikeWithdrawalReason} names the three ways a strike comes off, so
 * the ledger records WHY rather than silently shrinking.
 *
 * ## The threshold has to do something
 *
 * "Reasonably implemented" is the whole fight, so the escalation is defined
 * here as data rather than left to whoever reads the queue:
 * {@link repeatInfringerVerdict} maps a count onto a level, and each level
 * names the consequence in terms of levers this product actually has. At
 * `terminate` the staff queue refuses to close a DMCA report without an
 * explicit recorded decision — see the admin route — so the threshold cannot
 * be passed silently. That refusal is the difference between a counter and a
 * policy.
 *
 * What this module deliberately does NOT do is suspend anything by itself. An
 * automatic termination on a third strike would be a product that closes a
 * paying customer's account on three unverified assertions by strangers, with
 * no human in the loop — and §512 nowhere asks for that. The policy is
 * "terminate in appropriate circumstances", and judging the circumstances is
 * exactly the part a person must do. The counter makes the decision
 * unavoidable and recorded; it does not make it automatically.
 */

/** Per-org strike ledger. One document per actioned DMCA report. */
export const STRIKE_LEDGER_SUBCOLLECTION = 'dmcaStrikes'

/**
 * Strikes at which each consequence begins.
 *
 * Three is the termination threshold, which is the number the phrase "repeat
 * infringer" is conventionally read against and the number our published
 * policy will state. The two below it exist so termination is never the first
 * thing a customer hears about a problem: a subscriber who does not know they
 * are on a strike cannot correct their behaviour, and a policy that only
 * speaks at the end is one a court can call unreasonable in its
 * implementation.
 */
export const STRIKE_WARN_AT = 1
export const STRIKE_FINAL_AT = 2
export const STRIKE_TERMINATE_AT = 3

export type RepeatInfringerLevel = 'none' | 'warn' | 'final' | 'terminate'

export interface RepeatInfringerVerdict {
  /** Strikes currently standing against the account. */
  strikes: number
  level: RepeatInfringerLevel
  /**
   * Does the account-level consequence require a recorded human decision
   * before any further DMCA report on this org can be closed?
   */
  decisionRequired: boolean
  /** One line naming the consequence, shown to staff and quoted to the org. */
  consequence: string
}

/**
 * Strikes → verdict.
 *
 * A pure function of the count, so the staff surface, the admin route and the
 * docs cannot disagree about where the line is. Anything at or above
 * {@link STRIKE_TERMINATE_AT} is `terminate`, including a count that somehow
 * ran past it — a fourth strike must not read as less serious than the third.
 */
export function repeatInfringerVerdict(strikes: unknown): RepeatInfringerVerdict {
  const count =
    typeof strikes === 'number' && Number.isFinite(strikes) && strikes > 0
      ? Math.floor(strikes)
      : 0
  if (count >= STRIKE_TERMINATE_AT) {
    return {
      strikes: count,
      level: 'terminate',
      decisionRequired: true,
      consequence:
        'Termination threshold reached. A staff decision to terminate or to ' +
        'record why not is required before any further copyright report on ' +
        'this account can be closed.',
    }
  }
  if (count >= STRIKE_FINAL_AT) {
    return {
      strikes: count,
      level: 'final',
      decisionRequired: false,
      consequence:
        'Final warning. One more upheld copyright notice reaches the ' +
        'termination threshold.',
    }
  }
  if (count >= STRIKE_WARN_AT) {
    return {
      strikes: count,
      level: 'warn',
      decisionRequired: false,
      consequence:
        'Warned. The account has one upheld copyright notice on record.',
    }
  }
  return {
    strikes: 0,
    level: 'none',
    decisionRequired: false,
    consequence: 'No upheld copyright notices on record.',
  }
}

/** Why a strike came off the ledger. Recorded, never silent. */
export const STRIKE_WITHDRAWAL_REASONS = [
  /** The complainant retracted the notice. */
  'noticeWithdrawn',
  /** A §512(g) counter-notice ran its course and access was restored. */
  'counterNoticeRestored',
  /** Staff decided the notice should not have been actioned. */
  'staffReversed',
] as const
export type StrikeWithdrawalReason = (typeof STRIKE_WITHDRAWAL_REASONS)[number]

export function isStrikeWithdrawalReason(
  value: unknown,
): value is StrikeWithdrawalReason {
  return (
    typeof value === 'string' &&
    (STRIKE_WITHDRAWAL_REASONS as readonly string[]).includes(value)
  )
}

/**
 * Does moving a DMCA report to `status` earn a strike?
 *
 * `actioned` only. `dismissed` is staff saying the notice did not hold up, so
 * it must not count — and neither must `open` or `reviewing`, which are a
 * report nobody has adjudicated yet. Counting anything but `actioned` would
 * make the ledger a record of accusations rather than of upheld ones.
 *
 * The category gate matters as much as the status: the queue carries phishing
 * and malware reports too, and a phishing takedown is not a copyright
 * infringement. §512(i) is about infringement, so only `dmca` reports reach
 * the ledger.
 */
export function strikeEarnedBy(category: unknown, status: unknown): boolean {
  return category === 'dmca' && status === 'actioned'
}

/**
 * Does moving a DMCA report to `status` REMOVE a strike it previously earned?
 *
 * The mirror of {@link strikeEarnedBy}, and the reason the pair is written as
 * two functions rather than one: a report that goes `actioned` → `dismissed`
 * has to give its strike back, and a naive "recount the actioned ones"
 * implementation would get that right by accident while getting the
 * counter-notice case wrong, because a restored counter-notice leaves the
 * report `actioned` and reverses it by a different route.
 */
export function strikeRemovedBy(category: unknown, status: unknown): boolean {
  return (
    category === 'dmca' && (status === 'dismissed' || status === 'open' || status === 'reviewing')
  )
}

/**
 * Count the strikes standing, given ledger rows.
 *
 * Rows carry a `withdrawnAt` when they have been reversed rather than being
 * deleted, so the ledger stays a complete history — "did we know, and when"
 * is the question the abuse queue exists to answer, and a strike that was
 * lifted is part of that answer. Only rows without one count.
 */
export function countStandingStrikes(
  rows: readonly { withdrawnAt?: unknown }[] | null | undefined,
): number {
  if (!rows) return 0
  return rows.filter((row) => row?.withdrawnAt == null).length
}

export default repeatInfringerVerdict
