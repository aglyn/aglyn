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
 * PER-TENANT SENDING REPUTATION — the policy half.
 *
 * Every tenant's marketing mail leaves on one shared sending domain under
 * `p=reject`. A mailbox provider grades that domain, not the tenant, so one
 * merchant's bad list is felt by every other merchant's campaigns AND by the
 * transactional mail — password resets, receipts, booking reminders — that
 * shares the domain with them. Nothing in the product computed a rate at any
 * scope, so there was no number to act on and no point at which anything
 * stopped.
 *
 * This module is the decision, as a pure function of counts. The durable
 * counters live in `@aglyn/tenant-data-admin` (`email-sender-reputation.ts`),
 * which is the only layer that may hold the Admin SDK — the same split
 * `send-rate.ts` draws beside it, for the same reason.
 *
 * ## What it may do, and what it may never do
 *
 * **It refuses a SEND. It never touches a person or their data.** No contact
 * is deleted, no audience is trimmed, nobody is unsubscribed and no list
 * membership changes. That is the enforce-at-the-reduction rule
 * (`over-limit.ts`): a limit that refuses a person or their data leaks, so a
 * capacity control gates the DROP and never the holding. A send is a flow —
 * refusing one strands nobody's data, and the merchant can send it after
 * cleaning the list.
 *
 * **It may only ever refuse a CAMPAIGN.** A transactional message can never
 * reach this decision: {@link emailReputationVerdict} is consulted from the campaign
 * sender alone, and both layers underneath it — `emailSendRateVerdict` and
 * `sendEmail` itself — independently refuse to drop a transactional priority
 * whatever a control above them says. A password reset refused by a
 * reputation breaker converts a deliverability risk into an outage on
 * somebody else's business, and the mail explaining why is itself mail that
 * would not send.
 *
 * ## The three numbers, and the two that are not rates
 *
 * A rate on its own is not evidence. Two guards stand in front of every
 * threshold and both have to clear:
 *
 *  - {@link EMAIL_REPUTATION_MIN_VOLUME} — a denominator below which a rate
 *    is noise. One complaint out of four is 25% and means nothing.
 *  - {@link EMAIL_REPUTATION_MIN_EVENTS} — a numerator below which a rate is
 *    one person having a bad day. M3AAWG's own sizing caveat is that test
 *    sends below ten thousand recipients do not yield statistically
 *    significant results; at our volumes the honest response is not to pretend
 *    otherwise but to require that the signal be repeated before it bites.
 *
 * A threshold crossed with either guard unmet is reported as a FINDING and
 * changes nothing. That is deliberate: the operator surface has to show a
 * rate climbing before it trips, or the first anybody hears of the control is
 * a refused campaign.
 *
 * ## The thresholds
 *
 * `complaintRate` is graded against Google's published bulk-sender rule —
 * keep spam complaints under 0.10% and never at or above 0.30% — so the watch
 * level and the trip level are the two numbers Google itself names rather
 * than two we picked.
 *
 * `bounceRate` has no published cross-provider number; 5% watch and 10% trip
 * is the shape Amazon SES enforces on its own senders, and it is the one
 * decision here taken from a vendor rather than from a standard.
 */

/** Days of history a rate is computed over. */
export const EMAIL_REPUTATION_WINDOW_DAYS = 7

/**
 * Messages a window must carry before any rate in it is actionable.
 *
 * 200 is the first ramp step (see {@link EMAIL_RAMP_STEPS}), so a brand-new
 * tenant cannot be tripped by its very first day of sending — it has to send
 * a second day, by which time there is a real denominator.
 */
export const EMAIL_REPUTATION_MIN_VOLUME = 200

/** Bad events a finding must carry before it is actionable. */
export const EMAIL_REPUTATION_MIN_EVENTS = 3

/** Google's "keep it under this" spam rate. */
export const EMAIL_COMPLAINT_RATE_WATCH = 0.001

/** Google's "never reach this" spam rate. */
export const EMAIL_COMPLAINT_RATE_TRIP = 0.003

/** Bounce rate that earns a warning. */
export const EMAIL_BOUNCE_RATE_WATCH = 0.05

/** Bounce rate that stops the sender. */
export const EMAIL_BOUNCE_RATE_TRIP = 0.1

/**
 * What a tenant's findings are allowed to do to it.
 *
 * The three Amazon SES publishes for its own tenant isolation, and the names
 * are theirs because the behaviors are theirs. **These are persisted values**
 * — they are stored on the org — so they are added to and never renamed.
 */
export type EmailReputationPolicy =
  /** Stop the sender on a high-severity finding. The default. */
  | 'standard'
  /** Stop the sender on any finding at all. */
  | 'strict'
  /** Record only. Never stops anything. */
  | 'none'

export const EMAIL_REPUTATION_POLICIES: readonly EmailReputationPolicy[] = [
  'standard',
  'strict',
  'none',
]

/** The default when an org has configured nothing. */
export const EMAIL_REPUTATION_DEFAULT_POLICY: EmailReputationPolicy = 'standard'

/**
 * Reads a stored policy, falling back to the default.
 *
 * Never falls back to `'none'`. An unreadable policy that parked the breaker
 * would be a control switched off by a typo, which is the shape where a
 * ceiling silently stops existing.
 */
export function normalizeEmailReputationPolicy(
  raw: unknown,
): EmailReputationPolicy {
  const value = String(raw ?? '')
  return (EMAIL_REPUTATION_POLICIES as readonly string[]).includes(value)
    ? (value as EmailReputationPolicy)
    : EMAIL_REPUTATION_DEFAULT_POLICY
}

/**
 * WHICH POLICY THIS SENDER IS ACTUALLY GRADED ON, given whose domain it is.
 *
 * A pooled sender shares one domain with every other site that has no domain
 * of its own, so a complaint it earns is charged to their receipts as much as
 * to its own. That asymmetry used to be handled by keeping marketing off the
 * pool altogether. It is handled here instead: on the pool a campaign is
 * graded `strict`, which stops it on the WATCH thresholds — Google's "keep
 * under" 0.10% complaint rate and a 5% bounce rate — rather than waiting for
 * the trip levels three and two times higher.
 *
 * On a domain the merchant owns, the org's own setting stands. The reputation
 * being spent there is theirs alone, and how fast they spend it is theirs to
 * decide.
 *
 * ## The pool overrides `none`, and that is the point
 *
 * A workspace that has switched its own breaker off must not thereby switch
 * off the one protecting the other sites on its pool member. Same posture as
 * the platform marketing frequency ceiling, which is the same number on every
 * plan for the same reason: a control that exists to protect tenants from each
 * other cannot be something one tenant sets aside.
 *
 * @param source the resolved {@link SendingIdentitySource}. Anything that is
 *        not `'shared'` — a custom domain, the platform's own identity, or an
 *        unresolved send — takes the configured policy, because only the pool
 *        spends somebody else's reputation.
 */
export function effectiveReputationPolicy(
  source: string | null | undefined,
  configured: unknown,
): EmailReputationPolicy {
  if (source === 'shared') return 'strict'
  return normalizeEmailReputationPolicy(configured)
}

/** Which measurement produced a finding. */
export type EmailReputationFindingCode = 'complaint-rate' | 'bounce-rate'

/** How badly. `high` is what a `standard` policy stops on. */
export type EmailReputationSeverity = 'low' | 'high'

/** One measurement that crossed a threshold, with the numbers behind it. */
export interface EmailReputationFinding {
  code: EmailReputationFindingCode
  severity: EmailReputationSeverity
  /** The measured rate, as a fraction. */
  rate: number
  /** The threshold it crossed, as a fraction. */
  threshold: number
  /** Events in the window — the numerator. */
  events: number
  /** Messages in the window — the denominator. */
  volume: number
  /**
   * False when a guard was unmet, so this finding is reported and cannot
   * stop anything. See the header for why both guards exist.
   */
  actionable: boolean
  /** Human-readable, and the text a surface may show verbatim. */
  detail: string
}

/** The counts a window holds. Every field is a message count. */
export interface EmailReputationCounts {
  /** Campaign messages handed to the sender in the window. The denominator. */
  accepted: number
  /** Permanent bounces reported against them. */
  bounced: number
  /** Spam complaints reported against them. */
  complained: number
}

/** A tenant's reputation state. */
export type EmailReputationState =
  /** No finding, or none actionable. */
  | 'ok'
  /** A finding this policy does not stop on. */
  | 'watch'
  /** The sender is stopped. */
  | 'tripped'
  /**
   * Findings stand but a grace period is ignoring them, so a tenant that has
   * fixed its list can send again without an operator having to time the
   * moment the window rolls off. SES's own `Reinstated`.
   */
  | 'reinstated'

/** The reconciled reputation of one tenant. */
export interface EmailReputationVerdict {
  state: EmailReputationState
  /** True only when a campaign may not go out. */
  blocked: boolean
  policy: EmailReputationPolicy
  complaintRate: number
  bounceRate: number
  /** Messages the window measured. */
  volume: number
  /** Days the window covers. */
  windowDays: number
  /** Every threshold crossed, actionable or not. */
  findings: EmailReputationFinding[]
  /**
   * Why a merchant cannot send, in words they can act on. Empty when
   * {@link blocked} is false — a surface must never show a reason for a
   * state that is not blocking.
   */
  reason: string
  /** When a grace period ends, ms. Null unless {@link state} is `reinstated`. */
  reinstatedUntilMs: number | null
}

/** A count clamped to a non-negative integer. A corrupt counter reads as 0. */
function count(raw: unknown): number {
  const value = Math.floor(Number(raw))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** `events / volume`, or 0 when there is no denominator. */
export function emailReputationRate(events: number, volume: number): number {
  const numerator = count(events)
  const denominator = count(volume)
  return denominator > 0 ? numerator / denominator : 0
}

/** A fraction as the percentage a person reads, to two places. */
export function formatReputationRate(rate: number): string {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${(value * 100).toFixed(2)}%`
}

function buildFinding(input: {
  code: EmailReputationFindingCode
  rate: number
  events: number
  volume: number
  watch: number
  trip: number
  noun: string
}): EmailReputationFinding | null {
  const { rate, events, volume, watch, trip } = input
  if (rate < watch) return null
  const severity: EmailReputationSeverity = rate >= trip ? 'high' : 'low'
  const threshold = severity === 'high' ? trip : watch
  const actionable =
    volume >= EMAIL_REPUTATION_MIN_VOLUME && events >= EMAIL_REPUTATION_MIN_EVENTS
  return {
    code: input.code,
    severity,
    rate,
    threshold,
    events,
    volume,
    actionable,
    detail:
      `${events.toLocaleString()} ${input.noun} in ` +
      `${volume.toLocaleString()} messages is ${formatReputationRate(rate)}, ` +
      `against a limit of ${formatReputationRate(threshold)}` +
      (actionable
        ? '.'
        : ' — too little volume to act on yet, so this is recorded and ' +
          'nothing is stopped.'),
  }
}

export interface EmailReputationVerdictInput {
  counts: EmailReputationCounts
  policy?: EmailReputationPolicy
  /** Days the counts cover, for the message. */
  windowDays?: number
  /** A grace period that ignores active findings, ms since epoch. */
  reinstatedUntilMs?: number | null
  /** Injectable for tests. */
  now?: number
}

/**
 * Grades one tenant's window, and says whether a campaign may go out.
 *
 * Pure and total: no input throws, because this runs on the path that decides
 * whether a campaign sends and a thrown grade would be an outage caused by
 * bookkeeping. That is the posture `describeEmailCeilings` takes beside it.
 *
 * A tenant with no history at all grades `ok` — an absent counter is a tenant
 * that has not sent, not a tenant with a perfect record and not one to
 * refuse. The direction matters: the opposite reading would refuse every
 * first campaign on the platform, which is the stubbed-resolver failure where
 * a clamp goes green having stopped everything.
 */
export function emailReputationVerdict(
  input: EmailReputationVerdictInput,
): EmailReputationVerdict {
  const policy = normalizeEmailReputationPolicy(input.policy)
  const accepted = count(input.counts?.accepted)
  const bounced = count(input.counts?.bounced)
  const complained = count(input.counts?.complained)
  const windowDays = count(input.windowDays) || EMAIL_REPUTATION_WINDOW_DAYS
  const complaintRate = emailReputationRate(complained, accepted)
  const bounceRate = emailReputationRate(bounced, accepted)

  const findings = [
    buildFinding({
      code: 'complaint-rate',
      rate: complaintRate,
      events: complained,
      volume: accepted,
      watch: EMAIL_COMPLAINT_RATE_WATCH,
      trip: EMAIL_COMPLAINT_RATE_TRIP,
      noun: 'spam complaints',
    }),
    buildFinding({
      code: 'bounce-rate',
      rate: bounceRate,
      events: bounced,
      volume: accepted,
      watch: EMAIL_BOUNCE_RATE_WATCH,
      trip: EMAIL_BOUNCE_RATE_TRIP,
      noun: 'permanent bounces',
    }),
  ].filter((finding): finding is EmailReputationFinding => finding !== null)

  const actionable = findings.filter((finding) => finding.actionable)
  const stopping =
    policy === 'none'
      ? []
      : policy === 'strict'
        ? actionable
        : actionable.filter((finding) => finding.severity === 'high')

  const now = Number(input.now ?? Date.now())
  const reinstatedUntilMs = Number(input.reinstatedUntilMs ?? 0)
  const reinstated =
    Number.isFinite(reinstatedUntilMs) && reinstatedUntilMs > now
      ? Math.floor(reinstatedUntilMs)
      : null

  const base = {
    policy,
    complaintRate,
    bounceRate,
    volume: accepted,
    windowDays,
    findings,
  }

  if (stopping.length && reinstated !== null) {
    return {
      ...base,
      state: 'reinstated',
      blocked: false,
      reason: '',
      reinstatedUntilMs: reinstated,
    }
  }
  if (stopping.length) {
    return {
      ...base,
      state: 'tripped',
      blocked: true,
      reason:
        'Campaign sending is paused for this workspace because the mail it ' +
        `has sent in the last ${windowDays} days is being rejected or ` +
        `reported as spam too often. ${stopping
          .map((finding) => finding.detail)
          .join(' ')} Nobody has been removed from your audience and no ` +
        'contact has been changed. Remove the addresses that bounced, send ' +
        'only to people who asked for this mail, and campaign sending ' +
        'resumes as the last ' +
        `${windowDays} days roll off. Transactional mail — receipts, ` +
        'booking reminders, password resets — keeps sending.',
      reinstatedUntilMs: null,
    }
  }
  return {
    ...base,
    state: actionable.length ? 'watch' : 'ok',
    blocked: false,
    reason: '',
    reinstatedUntilMs: reinstated,
  }
}

/*==========================================
 * THE NEW-SENDER RAMP.
 *
 * A brand-new, unvetted signup and a customer with a year of clean sending
 * got the same share of the platform hour. Public self-serve signup makes
 * that the shape by which a shared domain gets blocked: nothing in the
 * product stopped a tenant created five minutes ago from putting its whole
 * first import onto the domain every other tenant's receipts leave on.
 *
 * The pattern the industry ships for this is a sandbox, and two documented
 * versions bracket it. Postmark reviews each new account by hand, typically
 * inside a day, and until then the account may only mail domains it has
 * verified. Amazon SES makes it mechanical and publishes the numbers: 200
 * messages per 24 hours until a request lifts it.
 *
 * The SES shape is the one taken here, for three reasons: it needs no human
 * in the loop on a Sept-1 public signup, it is a number rather than a
 * judgement, and it is legible to the merchant — "your workspace is new, so
 * it sends 200 a day this week" is a sentence, where "an operator has not
 * reviewed you yet" is a wait with no end.
 *
 * ## It is PACING, not an entitlement
 *
 * The ramp never reduces what a plan includes; it spreads the first week of
 * it. A campaign over the day's step is DEFERRED, not refused — it resumes
 * on the next day exactly as it resumes on the next hour, through the same
 * batching the send path already has. Nothing is lost and nothing is
 * removed.
 *
 * ## Why a step needs BOTH a day count and a volume
 *
 * A ramp gated on age alone is a ramp you skip by waiting: sign up, do
 * nothing for a week, then send the whole import at full speed on day eight
 * with no delivery history at all. A step therefore has to be EARNED by
 * clean volume as well as reached in time — which is what a warm-up is.
 *
 * ## What an org with no creation date gets
 *
 * GRADUATED, not throttled. An unreadable age must resolve to the permissive
 * answer here, and that is not a preference: an org record whose `createdAt`
 * is missing is an EXISTING customer, and reading a missing field as "brand
 * new" would ramp every paying tenant on the platform down to 200 a day on
 * the deploy. The direction to be wrong in is the one that does not throttle
 * a customer who has been sending for a year.
 *=========================================*/

/** One step of the ramp. */
export interface EmailRampStep {
  /** Days since the workspace was created before this step is reachable. */
  minAgeDays: number
  /** Campaign messages it must have delivered before this step is reachable. */
  minDelivered: number
  /** Campaign messages a day at this step. */
  perDay: number
}

/**
 * The ramp, lowest step first.
 *
 * The first step is SES's published sandbox figure. Each step after it is
 * roughly a five-fold increase gated on having actually delivered most of the
 * step below it, which is the warm-up curve every deliverability guide
 * describes and the one a mailbox provider's own reputation model is built to
 * see.
 */
export const EMAIL_RAMP_STEPS: readonly EmailRampStep[] = [
  { minAgeDays: 0, minDelivered: 0, perDay: 200 },
  { minAgeDays: 1, minDelivered: 100, perDay: 1_000 },
  { minAgeDays: 3, minDelivered: 800, perDay: 5_000 },
]

/**
 * Age at which the ramp stops binding entirely.
 *
 * Past this the hourly share and the plan are the only ceilings, which is
 * what they were before the ramp existed. Seven days matches the last step's
 * reach and is short enough that it is a warm-up rather than a tier.
 */
export const EMAIL_RAMP_GRADUATION_DAYS = 7

/** What the ramp allows a tenant today. */
export interface EmailRampVerdict {
  /** True when the ramp no longer binds and the hourly share is the ceiling. */
  graduated: boolean
  /** Campaign messages this tenant may send today. */
  perDay: number
  /** Which step it is on, 0-based. Equals the step count when graduated. */
  step: number
  /** Days until the next step is reachable on age alone. Null when graduated. */
  daysToNextStep: number | null
  /** Human-readable, and the text a surface may show verbatim. */
  detail: string
}

export interface EmailRampInput {
  /**
   * Days since the workspace was created. A negative, unreadable or absent
   * value GRADUATES — see the header for why that direction is the only safe
   * one.
   */
  ageDays: number | null | undefined
  /** Campaign messages this workspace has delivered, all time. */
  deliveredLifetime: number
  /**
   * The hourly share expressed as a day, which is the ceiling a graduated
   * tenant has. A ramp step is never allowed to exceed it — a step above the
   * ceiling underneath it would be a number that can never be reached.
   */
  graduatedPerDay: number
}

/**
 * The daily campaign ceiling for one tenant.
 *
 * Pure and total, like every other ceiling in this library.
 */
export function emailRampVerdict(input: EmailRampInput): EmailRampVerdict {
  const graduatedPerDay = Math.max(1, count(input.graduatedPerDay))
  const rawAge = Number(input.ageDays)
  const graduate = (): EmailRampVerdict => ({
    graduated: true,
    perDay: graduatedPerDay,
    step: EMAIL_RAMP_STEPS.length,
    daysToNextStep: null,
    detail:
      'This workspace is past its first week of sending, so the new-sender ' +
      'ramp no longer applies.',
  })
  /*
   * `null` and `undefined` are checked BEFORE the coercion, because
   * `Number(null)` is 0 — a finite, non-negative number that reads as "created
   * today" and would put every org whose record predates the creation
   * timestamp onto the first ramp step. The absent case has to be caught as
   * itself; a numeric guard cannot see it.
   */
  if (input.ageDays === null || input.ageDays === undefined) return graduate()
  if (!Number.isFinite(rawAge) || rawAge < 0) return graduate()
  const ageDays = Math.floor(rawAge)
  if (ageDays >= EMAIL_RAMP_GRADUATION_DAYS) return graduate()

  const delivered = count(input.deliveredLifetime)
  let step = 0
  for (let index = 1; index < EMAIL_RAMP_STEPS.length; index += 1) {
    const candidate = EMAIL_RAMP_STEPS[index]
    if (ageDays >= candidate.minAgeDays && delivered >= candidate.minDelivered) {
      step = index
    } else {
      break
    }
  }
  const next = EMAIL_RAMP_STEPS[step + 1]
  // Never above the ceiling underneath it: a graduated tenant's day is the
  // hardest number in this arithmetic, and a ramp step over it would promise
  // a new tenant more than an established one may send.
  const perDay = Math.min(graduatedPerDay, EMAIL_RAMP_STEPS[step].perDay)
  return {
    graduated: false,
    perDay,
    step,
    daysToNextStep: next ? Math.max(0, next.minAgeDays - ageDays) : null,
    detail:
      `This workspace was created ${ageDays === 0 ? 'today' : `${ageDays} ` + `day${ageDays === 1 ? '' : 's'} ago`}, ` +
      `so it may send ${perDay.toLocaleString()} campaign emails a day while ` +
      'it establishes a sending history. The rest of a campaign is not lost — ' +
      'it goes out automatically on the following days.',
  }
}

/** Days between two instants, floored. Negative inputs read as 0. */
export function daysBetween(fromMs: number, toMs: number): number {
  const from = Number(fromMs)
  const to = Number(toMs)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return 0
  return Math.max(0, Math.floor((to - from) / 86_400_000))
}

/** The UTC day a timestamp falls in, as `YYYY-MM-DD`. */
export function reputationDayKey(atMs: number = Date.now()): string {
  const value = Number(atMs)
  const date = new Date(Number.isFinite(value) && value > 0 ? value : Date.now())
  return date.toISOString().slice(0, 10)
}

/** The `YYYY-MM-DD` keys of the window ending on `atMs`, oldest first. */
export function reputationWindowDayKeys(
  atMs: number = Date.now(),
  windowDays: number = EMAIL_REPUTATION_WINDOW_DAYS,
): string[] {
  const days = Math.max(1, count(windowDays) || EMAIL_REPUTATION_WINDOW_DAYS)
  const end = Number(atMs)
  const at = Number.isFinite(end) && end > 0 ? end : Date.now()
  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(reputationDayKey(at - offset * 86_400_000))
  }
  return keys
}
