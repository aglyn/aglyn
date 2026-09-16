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
 * `FieldValue` comes straight from the SDK rather than through the admin
 * barrel (AGL-2073). This module serves every metered AI door — the chat
 * door, the besigner copy assistant and the generation jobs — and importing
 * the admin lib's `firebase-admin` module would drag the default-app
 * initialization (cert credential, RTDB, AppCheck) into every unit test that
 * touches a counter; `FieldValue`'s statics need no app at all.
 */
import { FieldValue } from 'firebase-admin/firestore'
import {
  ASSIST_PROVIDER_COST_FIELD,
  assistBandRefuses,
  assistCreditsFromUsd,
  assistMonthOverage,
  assistOverageCapReached,
  publicAssistCredits,
  resolveAssistBudgetUsd,
  resolveAssistOverageCapUsd,
  resolveAssistOverageRateUsdPer1k,
  type PublicAssistCredits,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  aiOverageRefusal,
  type AiOverageCapReason,
} from '../billing/ai-overage-gate'
import {
  aiOverageBillsByInvoice,
  aiOverageGuardsApply,
} from '../billing/ai-overage-cutover'
import {
  AI_BILLING_STANDING_DOC,
  AI_BILLING_SUBCOLLECTION,
  readAiOverageMonthLedger,
} from '../billing/ai-overage-ledger'
import { readAiOverageStanding } from '../billing/ai-overage-standing'
import type { AiRefusedBy } from '../model/ai-allotments'
import {
  AI_HOST_CREDITS_FIELD,
  readAiAllotmentGate,
  type AiAllotmentGate,
  type AiAllotmentRequestSubject,
} from './ai-allotments'
import {
  assistOperatorCeilingUsd,
  assistOrgMonthlyCostLimitUsd,
} from '@aglyn/aglyn/app-utils/usage-budget'
import { isUncappedPlanComp } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { estimateAiBilledUsd, estimateAiProviderCostUsd } from '../providers/catalog'
import { recordAssistRefusal } from './assist-refusals'
import {
  announcePlatformFreeSpend,
  freeAccountReservationWrite,
  freeAccountUsageRef,
  freeAssistAccount,
  freeTasteMeterWrites,
  freeTasteReadsFrom,
  freeTasteRefusal,
  platformFreeSpendRef,
  type AssistMeteredOrg,
  type FreeAssistAccount,
} from './assist-free-taste'
import { aiTokenIncrements, recordUserAiUsage } from './ai-usage-by-user'
import { AI_USAGE_MONTH_KINDS_FIELD, AI_USAGE_TOKENS_FIELD } from '../model/ai-tokens'
import {
  aiUsageKindFromRoute,
  type AiUsageKind,
} from '../model/ai-usage-by-user'

/**
 * Aglyn Assist metering + the data loop (AGL-1860, phase 1).
 *
 * Collections (org-scoped, ABSENT from firebase-firestore.rules on purpose —
 * default-deny, the forumThreads precedent: every read/write passes the
 * assist API route via the Admin SDK):
 *
 *   orgs/{orgId}/assistUsage/{YYYY-MM}     per-org monthly cost telemetry:
 *     { month, messages, inputTokens, outputTokens, cacheReadTokens,
 *       cacheWriteTokens, estCostUsd, byHost: { hostId: credits },
 *       kinds: { kind: { requests, estCostUsd, tokens } }, updatedAt }
 *     (`byHost` is each site's credits, which a site's AI allotment is
 *     measured against — AGL-2942; `kinds` splits the tokens and the
 *     measured spend by what each model request was for — AGL-2937)
 *   orgs/{orgId}/counters/assistMessagesDaily
 *     fields keyed YYYY-MM-DD → integer (the free-tier daily cap counter;
 *       same field-per-period shape as the other `counters/*` docs)
 *   orgs/{orgId}/assistExchanges/{id}      the VERBATIM half of one exchange:
 *     { uid, question, answer, hostId, createdAt, expiresAt }
 *   orgs/{orgId}/assistSignals/{id}        the DERIVED half, same id:
 *     { route, hostId, model, tier, kind, inputTokens, outputTokens,
 *       cacheReadTokens, cacheWriteTokens, estCostUsd, docsPaths,
 *       stopReason, feedback: 'up'|'down'|null, createdAt }
 *
 * The Free taste (AGL-2925) adds two more, one under the workspace OWNER's
 * user document and one platform-wide, both documented and both closed to
 * clients in `assist-free-taste.ts`.
 *
 * Costs are OUR cost estimates at list rates (pricing-tunable telemetry),
 * mirrored after ORG_COGS_UNIT_RATES_USD's posture: cost visibility per org
 * from day one so the paid gate and caps can be tuned with data — the * "must not eat margins" constraint.
 *
 * ── Why the exchange is split in two (AGL-1972) ────────────────────────────
 *
 * One document carrying both halves forces one retention period onto two
 * kinds of data with opposite needs. The prose is what a person typed; the
 * data loop is what it cited and what it cost. Keeping them together means
 * either the prose is retained forever so the loop keeps its corpus, or the
 * loop's corpus is destroyed so the prose can expire. Neither is the answer,
 * and picking one number for both is how that false choice gets made.
 *
 * So: `assistExchanges` holds the question, the answer and the asking `uid`,
 * and carries `expiresAt` — a TTL policy reaps it after
 * ASSIST_EXCHANGE_RETENTION_DAYS. `assistSignals` holds no prose and NO uid,
 * carries no expiry, and is what the docs-gap view, the thumbs loop and the
 * cost meters actually read. The corpus the loop needs outlives the words
 * that produced it, because the corpus was never the words.
 *
 * Both subcollections sit under the org, so `recursiveDelete(orgRef)` still
 * takes them and an erasure still clears everything with no extra sweep. And
 * both are ABSENT from firebase-firestore.rules deliberately: the org block
 * matches its subcollections BY NAME and has no wildcard, so an unmatched
 * name is default-deny for every client (verified against the live ruleset —
 * the `{subcollection}/{document=**}` catch-all is under `hosts/{hostId}`,
 * not here).
 *
 * ⚠️ The TTL policy is MANUAL gcloud configuration, not repo state. It is
 * documented in `docs/FIRESTORE_MANUAL_CONFIG.md` and declared as a
 * `fieldOverrides` entry in `cloud/firebase-firestore.indexes.json` — the
 * declaration is not decoration, it is what stops the next unrelated index
 * deploy from DELETING the policy. `apps/console/specs/retention-ttl-config.spec.ts`
 * fails the build if either half goes missing.
 */

/** Current billing month key, `YYYY-MM`, matching the usage rollup. */
export function assistUsageMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** Current day key, `YYYY-MM-DD` (UTC — same clock as the month key). */
export function assistUsageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * How long the VERBATIM half of an exchange is kept — the question, the
 * answer and the asking uid (AGL-1972).
 *
 * 180 days, and the number is chosen against what actually reads this data
 * rather than against a round figure:
 *
 * - The docs-gap loop mines `docsPaths` and the thumbs rating. Both live on
 *   the signal document, which has no expiry, so shortening this period
 *   costs the loop nothing. That separation is what makes 180 affordable;
 *   without it the honest answer would have been "forever".
 * - Two full quarters is long enough to read a quarter's questions LATE, and
 *   long enough to diff what people asked before and after a docs rewrite —
 *   the one analysis that genuinely needs the prose and not the citations.
 * - It is short enough that a workspace open for years is not an indefinite
 *   archive of what its people typed into a text box.
 *
 * ⚠️ TTL deletion is best-effort within ~72h of expiry, so nothing may treat
 * an exchange's absence OR its presence as exact at the boundary. Nothing
 * does: the only reader addresses an exchange by id and tolerates a miss.
 */
export const ASSIST_EXCHANGE_RETENTION_DAYS = 180

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When an exchange written at `now` expires. A `Date` rather than a number:
 * a TTL policy keys on a Firestore **Timestamp** and silently governs
 * nothing when the field is a number (`bookings.expiresAtMs` is the
 * documented non-target for exactly this reason). The Admin SDK converts a
 * JS `Date` to a Timestamp on write, which is how `cspViolationDaily` does
 * it and is why this module needs no firebase-admin type here.
 */
export function assistExchangeExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ASSIST_EXCHANGE_RETENTION_DAYS * DAY_MS)
}

/**
 * Free-tier daily message cap (level-1 answers only). Env-tunable without a
 * deploy of new code paths.
 *
 * What ten messages actually cost: about **$0.28 a day** at Sonnet list
 * rates, taking the worst case the clamps allow (see
 * `ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD` for the same arithmetic
 * carried to the monthly ceiling). A typical question costs a fraction of
 * that, because the worst case assumes a full 8,000-character history and a
 * 4,000-character question on every one of the ten.
 *
 * This docstring used to claim "well under a cent a day", which was the
 * pre-AGL-2441 figure and wrong by ~28x once the history clamp was measured
 * rather than assumed. It is restated here because it is the stated
 * justification for the size of this cap, and a justification that is off by
 * that much is how a cap ends up set by a number nobody re-derived.
 */
export function assistFreeDailyLimit(): number {
  const raw = process.env.ASSIST_FREE_DAILY_LIMIT
  // `Number('')` is 0, so an unset/empty var must fall through to the
  // default rather than silently zeroing the free tier.
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 10
}

/**
 * Entitled (Pro+/aiAssist) monthly message cap — a runaway guard, not a
 * product limit: high enough that no real user hits it, low enough that a
 * scripted client cannot turn one subscription into unbounded token spend.
 */
export function assistEntitledMonthlyLimit(): number {
  const raw = process.env.ASSIST_ENTITLED_MONTHLY_LIMIT
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000
}

/**
 * The ceiling one reservation is actually measured against, given the org's
 * plan band.
 *
 * ## Why the repo default must not bind an org that has a band
 *
 * `ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD` (in `usage-budget.ts`, beside
 * the alert that announces the ceiling) is $40, which was sized as a
 * runaway guard back when every org's assist spend was bounded by a message
 * cap. It is BELOW what Agency and Enterprise include, so applying it to a
 * plan band would refuse those workspaces partway through capacity they are
 * paying for. The rule is not about which tiers happen to clear $40 today: a
 * band that is sold is a product limit, and a default nobody typed is not
 * allowed to undercut one at any size.
 *
 * ## Why an operator's explicit figure still does
 *
 * A self-hoster paying their own provider bill, or an operator responding to
 * an incident, sets `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD` on purpose. The lower
 * of the two wins there, because that is what setting it means.
 *
 * `off` removes the operator's ceiling and does NOT remove a plan band: the
 * word turns off a backstop, and the band is not one.
 *
 * An org with no band (`budgetUsd === null` — Starter without the AI add-on,
 * and any org whose plan sells no assist band) is unchanged in every case: it
 * gets exactly the ceiling it got before, default and all.
 *
 * ## When the band is a line rather than a wall (AGL-2653)
 *
 * `bandRefuses` is `assistBandRefuses(org)`: false on a plan that sells
 * credits past its band unless the org's `assistOverage.hardCap` is on. A
 * band that does not refuse is not a ceiling, so it drops out of the
 * composition and the operator's explicit figure is the only thing left that
 * can bind — the repo default stays off, for the reason above, and `off`
 * leaves nothing. The message cap is still there either way, so a workspace
 * buying overage is bounded by messages a month rather than by nothing; the
 * overage it buys is priced by `report-usage` at the plan's rate.
 *
 * ## An uncapped staff comp (AGL-3049)
 *
 * `uncapped` is `isUncappedPlanComp(org)`. Its band resolves `null` — there
 * is no band — but it is not a workspace that was never sold one, so the
 * repo default must not stand in for a band here any more than it may
 * undercut a sold one: a $40 wall on the workspace staff uncapped is exactly
 * the cap uncapping removes. It composes like a band that does not refuse:
 * the operator's explicit figure binds, because that is an incident
 * decision about every workspace, and nothing else does. The message cap
 * still applies, as it does to every entitled workspace.
 */
export function assistMonthlyCeilingUsd(
  budgetUsd: number | null,
  bandRefuses = true,
  uncapped = false,
): number | null {
  const configured = process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
  if (uncapped) {
    const operator = assistOperatorCeilingUsd(configured)
    return typeof operator === 'number' ? operator : null
  }
  if (budgetUsd === null) return assistOrgMonthlyCostLimitUsd(configured)
  const operator = assistOperatorCeilingUsd(configured)
  if (!bandRefuses) return typeof operator === 'number' ? operator : null
  return typeof operator === 'number'
    ? Math.min(budgetUsd, operator)
    : budgetUsd
}

export interface AssistTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * What one exchange DRAWS FROM THE CUSTOMER, at the serving model's billed
 * rates, rounded to 6dp — the figure `assistCreditsFromUsd` turns into
 * credits and the one the band, the cap and the invoice are measured in.
 *
 * The rates are the model catalog's (AGL-2939), keyed by model rather than
 * fixed at one model's because `ASSIST_MODEL` is an env override: a
 * one-line incident swap to a dearer model would otherwise keep reporting
 * the cheaper money, and per-org cost would read as roughly right — the
 * failure mode this whole meter exists to prevent. An unknown id is priced
 * at the dearest known tier on purpose, because an estimate that errs low is
 * worse than one that errs high, and a docs-only answer is metered under a
 * zero-priced sentinel (`AI_METER_SENTINELS`) so it lands in the same rollup
 * as a served one.
 *
 * NOT A COST (AGL-3015). A model may be billed above what its provider
 * charges, so this overstates what the exchange cost us by exactly that
 * markup. `estimateAssistProviderCostUsd` is the figure a margin or a spend
 * meter takes.
 */
export function estimateAssistCostUsd(
  usage: AssistTokenUsage,
  model: string,
): number {
  return estimateAiBilledUsd(usage, model)
}

/**
 * What one exchange COST US, at the serving model's provider rates, rounded
 * to 6dp — real money, recorded beside the billed figure so a margin is
 * taken against a bill we actually pay rather than against a price we
 * charge.
 *
 * At or below `estimateAssistCostUsd` for the same tokens, and equal to it
 * on every model billed at its provider's list.
 */
export function estimateAssistProviderCostUsd(
  usage: AssistTokenUsage,
  model: string,
): number {
  return estimateAiProviderCostUsd(usage, model)
}

export interface AssistQuotaVerdict {
  allowed: boolean
  /** Which limit applied: free orgs meter daily, entitled orgs monthly. */
  period: 'day' | 'month'
  used: number
  limit: number
  remaining: number
}

/**
 * A reservation taken against the cap, carrying BOTH counter keys so it can
 * be handed back against the periods it actually moved rather than against
 * "now". A request that reserves at 23:59:59 and fails at 00:00:01 would
 * otherwise credit the NEXT day — capacity nobody paid for, arriving by the
 * one route a cap must never have.
 */
export interface AssistReservation extends AssistQuotaVerdict {
  /** UTC day the daily counter was incremented for (`YYYY-MM-DD`). */
  dayKey: string
  /** Month the `assistUsage` doc was incremented for (`YYYY-MM`). */
  monthKey: string
  /**
   * Which ceiling refused, or `null` when the message was reserved. The
   * refusals need different words at the surface: a message cap resets on a
   * clock the user can be told about, a spend ceiling does not, and the
   * plan's own band (`'band'`, AGL-2653) is a line the org could have chosen
   * to buy past — so its refusal has to name the switch that made it a wall.
   * `'band'` is answered only when the figure that refused IS the band; an
   * operator's lower figure refuses as `'budget'` even on a plan with one.
   * `'cap'` (AGL-2898) is the org's own dollar ceiling on the overage it
   * buys past the band — reachable only on a plan that sells past it.
   * `'requests'`, `'refusals'`, `'account'` and `'platform'` (AGL-2925) are
   * the Free taste's own precautions, and only a Free workspace can hear
   * them. `'allotment'` (AGL-2942) is a hard allotment the person or the
   * site has spent — see `allotment` for which.
   *
   * Only on the reservation, not on `AssistQuotaVerdict` — `checkAssistQuota`
   * is a reporting read that never consults the spend ceiling, and widening
   * the shared type would let a caller believe it had.
   */
  refusedBy: AiRefusedBy
  /**
   * WHICH dollar ceiling refused, when `refusedBy` is `'cap'` (AGL-3011).
   *
   * `'customer'` is the workspace's own ceiling (AGL-2898) and keeps the
   * sentence and the 402 it has always had. The other four are Aglyn's own
   * guards on the overage it extends between invoices: no card on file,
   * accrual paused, this month's ceiling, and the unpaid balance at its
   * limit. Absent on every other refusal and on an admitted request.
   *
   * The doors need it because the four answer differently: a missing card
   * and a paused workspace are 402s a person can act on, and a ceiling or a
   * settling balance are 429s they can only wait out.
   */
  capReason?: AiOverageCapReason | null
  /**
   * The figure the `cap` refusal was measured against — the month's ceiling
   * for `'limit'`, the unpaid limit for `'settling'` — so the sentence the
   * door renders quotes the number that actually refused rather than
   * re-deriving one that could differ.
   */
  overageLimitUsd?: number | null
  /** Overage accrued and not yet paid for, at the instant of the refusal. */
  overageUnpaidUsd?: number | null
  /**
   * The allotments that applied to the person asking, measured (AGL-2942):
   * which one refused, which one binds the usage strip, the caller's own
   * credits this month, and the model allowlists. `null` when the request
   * named nobody, and when a ceiling of the workspace's own refused before
   * any allotment was read.
   */
  allotment?: AiAllotmentGate | null
  /**
   * The account the workspace's FREE spend is attributed to, or `null` for
   * a workspace that is not on the Free plan (AGL-2925).
   *
   * Carried on the reservation so the door that meters the turn can hand
   * the same attribution to `recordAssistCost` without resolving it twice:
   * the reservation decided which account's allowance this request drew
   * on, and the record must charge that account and no other.
   */
  free: FreeAssistAccount | null
  /**
   * Measured provider spend for `monthKey` in USD as read inside the
   * transaction, or `null` when the transaction did not consult it.
   *
   * Nullable rather than defaulted to 0, and the difference is the whole
   * point: an entitled reservation reads the monthly document anyway (it is
   * the gate), but a free one gates on the daily counter and only opens the
   * monthly document when a ceiling is configured — so there is a path with
   * no figure to report. Reporting `0` there would be a constant wearing a
   * measurement's name, and a caller could not tell "this org has spent
   * nothing" from "nobody looked".
   */
  costUsd: number | null
  /**
   * The ceiling this reservation was measured against, or `null` when none
   * applied — the plan's band, the operator's figure, or the lower of the
   * two. See `assistMonthlyCeilingUsd`.
   */
  costLimitUsd: number | null
  /**
   * The org's PLAN assist band in USD, or `null` when its plan sells none.
   *
   * Separate from `costLimitUsd` because they answer different questions and
   * a surface needs both. `costLimitUsd` is what refused; this is whether the
   * org has a band at all, and therefore whether it can be shown a credit
   * balance. An org with no band that met the operator's backstop must not be
   * told it used up credits it was never sold, and an org whose band was
   * undercut by an operator's figure must not be told it has credits left
   * while being refused.
   */
  budgetUsd: number | null
}

/**
 * Reserve one assist message BEFORE the model is called (AGL-2057).
 *
 * This replaces `checkAssistQuota` on the request path, and the difference is
 * the whole point. `checkAssistQuota` READ the counter and let the request
 * through; the counter only moved in `recordAssistExchange`, at stream
 * COMPLETION. Two ways out of the cap followed, both of which spend real
 * provider tokens for an org that has no invoice to put them on:
 *
 * 1. **Concurrency.** N in-flight requests each read `used < limit` before any
 *    of them recorded. The per-uid rate limiter (20/min) was the only bound.
 * 2. **Abandoned streams.** Recording ran in the stream's completion handler,
 *    so a client that opened a request and dropped it never counted at all.
 *    Looped, that is UNBOUNDED spend on a free workspace — the cap simply
 *    never advanced. This is the fail-open that costs money silently.
 *
 * So the count moves to the front, inside a transaction: read and increment
 * are one atomic step, and a refused request never reaches the provider. The
 * lesson is AGL's own — fix WHEN the quota is evaluated, not how the counting
 * is done.
 *
 * Both counters move here (the daily one AND monthly `messages`) so message
 * counting has exactly one home. `recordAssistExchange` therefore records the
 * exchange, its tokens and its cost, and counts NO messages; calling it after
 * a reservation must not double-count.
 *
 * A plan-less org resolves as free upstream, so an unknown org gets the
 * SMALLER cap. That direction is deliberate.
 *
 * ## The spend gate is the one that matters now
 *
 * The message caps above are a runaway guard. The gate that decides what a
 * paying workspace gets is the SPEND ceiling, because assist actions differ
 * in cost by up to two orders of magnitude: a question is a few thousand
 * tokens and generating a screen carries a node tree, a component catalog and
 * theme tokens in and structured markup out. Counting both as one message
 * would let ten screen builds outspend a thousand questions while both read
 * as being within allowance.
 *
 * `org` is the billing document the caller already resolved `entitled` from.
 * It is optional and defaults to no org, which resolves as free — a band of
 * none, and therefore exactly the operator-backstop behaviour that predates
 * plan bands. Passing it is what makes a plan's own band bind.
 *
 * ## Refusal is legitimate here, unlike the transactional email carve-out
 *
 * A campaign send is refusable at its band and transactional mail is not,
 * because a blocked password reset locks somebody out of their own account.
 * Nothing assist does is that. It is help, not a person's data and not their
 * access: a refused question means the answer is not given, and a refused
 * build means the screen is built by hand in a besigner that still works. So
 * assist refuses at the band with no carve-out.
 *
 * What is never refused is what costs nothing. A docs-deflected answer and a
 * cache hit spend no tokens and take NO RESERVATION AT ALL — they return
 * before this function is reached — so a workspace at its band keeps getting
 * every answer the docs index can give it. That is not a carve-out inside
 * this gate; it is the reason those paths are ahead of it.
 *
 * ## The band is sold past by default (AGL-2653)
 *
 * Refusing at the band is legitimate; it is no longer the default. A plan
 * with an `extraAssistCreditsUsdPer1k` keeps reserving past its band and
 * `report-usage` bills the excess at that rate, unless the org's own
 * `assistOverage.hardCap` asks for the wall — `assistBandRefuses` is the one
 * place that rule lives. The ceiling below is composed from that answer, and
 * `refusedBy: 'band'` is how a refusal the switch caused is told apart from
 * one the operator's figure caused.
 *
 * ## The Free taste is metered twice (AGL-2925)
 *
 * A Free workspace's band is a wall, and a wall per workspace is not a
 * bound per person. So when `org` resolves to the Free plan the SAME
 * transaction also reads the workspace owner's account document and the
 * platform's day of free spend, and refuses on the account's daily request
 * cap, its refusal pause, its monthly allowance and the platform ceiling —
 * see `assist-free-taste.ts` for each. An admitted free reservation counts
 * the request on the account beside the org's own counters, so the release
 * path hands both back together.
 *
 * ## Allotments sit inside the band (AGL-2942)
 *
 * `subject` names the person asking and the site the request named. Once
 * the workspace's own ceilings — the message cap, the band or budget, the
 * overage cap — have admitted the request, the SAME transaction reads the
 * allotments that apply to that person and site and refuses as `allotment`
 * when a hard one is spent. After the workspace's rungs, so a workspace at
 * its band hears about its band and an allotment can never admit what the
 * band refused; before the Free taste's, which are precautions about the
 * account rather than decisions a manager made. Refusing moves no counter,
 * like every refusal above it. A soft allotment at 80% or 100% admits the
 * request and is announced once the transaction has committed.
 */
export async function reserveAssistMessage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  entitled: boolean,
  now = new Date(),
  org: AssistMeteredOrg | null = null,
  subject: AiAllotmentRequestSubject | null = null,
): Promise<AssistReservation> {
  const reservation = await reserveInTransaction(
    firestore,
    orgId,
    entitled,
    now,
    org,
    subject,
  )
  if (reservation.allotment?.alerts.length) {
    announceAllotmentAlerts(firestore, orgId, org, reservation)
  }
  return reservation
}

/**
 * A soft allotment's crossing, told through the alert pipeline — off the
 * reservation's await path and never failing it: the request was admitted,
 * and a notification is not a reason to take that back. Loaded when the
 * first crossing arrives, so the modules that write notifications and send
 * mail are not part of every metered request.
 */
function announceAllotmentAlerts(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: AssistMeteredOrg | null,
  reservation: AssistReservation,
): void {
  const alerts = reservation.allotment?.alerts ?? []
  void import('./ai-allotment-alerts')
    .then(({ announceAiAllotmentAlerts }) =>
      announceAiAllotmentAlerts(firestore, {
        orgId,
        orgSlug: typeof (org as { slug?: unknown } | null)?.slug === 'string'
          ? String((org as { slug?: unknown }).slug)
          : null,
        month: reservation.monthKey,
        alerts,
      }),
    )
    .catch((error) => console.error('[ai-allotments] alert failed', orgId, error))
}

/**
 * The charge this turn may have earned (AGL-3011).
 *
 * Off the await path and never able to fail the turn: the tokens are already
 * spent, and making the answer wait on a Stripe round trip — or losing it to
 * one — would turn a billing problem into a product one. Loaded when the
 * first chargeable turn arrives, so the modules that read org billing and
 * call Stripe are not part of every metered request.
 *
 * Returns before loading anything at all while `AI_OVERAGE_INVOICED_FROM`
 * names no month, which is how this ships: AI overage bills through the
 * monthly meter exactly as it does today, and this costs one string compare.
 *
 * A turn whose process ends before this finishes is covered three ways: the
 * next turn tries again, the reconcile sweep finishes a half-made charge,
 * and the gate refuses at the unpaid limit regardless.
 */
function chargeAccruedOverage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
  now: Date,
): void {
  if (!aiOverageBillsByInvoice(month)) return
  void import('../billing/ai-overage-trigger')
    .then(({ chargeAccruedAiOverage }) =>
      chargeAccruedAiOverage(firestore, orgId, month, now),
    )
    .catch((error) => console.error('[ai-overage] charge failed', orgId, error))
}

async function reserveInTransaction(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  entitled: boolean,
  now: Date,
  org: AssistMeteredOrg | null,
  subject: AiAllotmentRequestSubject | null,
): Promise<AssistReservation> {
  const increment = FieldValue.increment
  const serverTimestamp = FieldValue.serverTimestamp
  const orgRef = firestore.collection('orgs').doc(orgId)
  const day = assistUsageDay(now)
  const month = assistUsageMonth(now)
  const dailyRef = orgRef.collection('counters').doc('assistMessagesDaily')
  const monthlyRef = orgRef.collection('assistUsage').doc(month)
  const limit = entitled ? assistEntitledMonthlyLimit() : assistFreeDailyLimit()
  const period: 'day' | 'month' = entitled ? 'month' : 'day'
  const gateRef = entitled ? monthlyRef : dailyRef
  const gateField = entitled ? 'messages' : day
  // The Free taste's attribution, resolved once and carried on every
  // answer below: `null` for any paid plan, and for the paths that never
  // consult it.
  const free = freeAssistAccount(org)
  const accountRef =
    free?.accountUid ? freeAccountUsageRef(firestore, free.accountUid, month) : null

  // The plan's band first, then whether it refuses at all, then whatever the
  // operator did about it. Resolved OUTSIDE the transaction: it is pure
  // arithmetic over a document the caller already holds, and a transaction
  // that retries must not re-derive a ceiling that could have moved between
  // attempts.
  const budgetUsd = resolveAssistBudgetUsd(org)
  const bandRefuses = assistBandRefuses(org)
  // An uncapped staff comp has no band and no backstop default (AGL-3049).
  const costLimitUsd = assistMonthlyCeilingUsd(
    budgetUsd,
    bandRefuses,
    isUncappedPlanComp(org),
  )
  // The ceiling IS the band when the band refuses and nothing lower undercut
  // it. That is the refusal the surface has to attribute to the org's own
  // switch (or to a plan that sells no overage); a lower operator figure is
  // the operator's decision and keeps the operator's word.
  const ceilingIsBand =
    bandRefuses && budgetUsd !== null && costLimitUsd === budgetUsd
  // The org's own ceiling on the overage it buys (AGL-2898). Only a band
  // that is SOLD past has an overage to cap, so a band that refuses leaves
  // no ceiling to consult: past a wall there is nothing to be over.
  const overageCapUsd = bandRefuses ? null : resolveAssistOverageCapUsd(org)
  // AGLYN'S OWN GUARDS ON THE OVERAGE IT EXTENDS (AGL-3011), resolved here
  // for the same reason the ceilings above are: pure arithmetic over a
  // document the caller already holds, and a transaction that retries must
  // not re-derive them.
  //
  // They apply only where there IS overage to guard — a band that is sold
  // past, at a rate — and only from the month the platform bills that
  // overage by invoice. Before that month nothing charges, so nothing is
  // ever paid for, so an unpaid-balance guard would refuse every workspace
  // with no invoice to pay. See `ai-overage-cutover.ts`.
  const guardsOverage =
    !bandRefuses &&
    budgetUsd !== null &&
    resolveAssistOverageRateUsdPer1k(org) !== null &&
    aiOverageGuardsApply(month)

  return firestore.runTransaction(async (tx) => {
    // Every read before any write — Firestore requires that ordering, and it
    // is also what makes check-and-increment a single atomic step.
    const snapshot = await tx.get(gateRef)
    // The spend ceiling reads the SAME monthly document the entitled gate
    // already read, so an entitled reservation costs no extra read at all
    // and a free one costs a second read only when a ceiling is configured.
    const monthlySnapshot = entitled
      ? snapshot
      : costLimitUsd === null
        ? null
        : await tx.get(monthlyRef)
    // The taste's two extra reads, only for a Free workspace: the owner's
    // account month (when the org names an owner) and the platform's day.
    // Inside the transaction with everything else, so the rungs they feed
    // are decided against the same snapshot the counters move under.
    // The workspace's overage standing (AGL-3011): one document, read only
    // where the guards apply, beside the reads the gate already makes. The
    // allotment gate reads a plugin document in this transaction the same
    // way, and for the same reason — a guard decided against a snapshot the
    // transaction did not take is a guard a concurrent burst walks past.
    const standingSnapshot = guardsOverage
      ? await tx.get(
          orgRef.collection(AI_BILLING_SUBCOLLECTION).doc(AI_BILLING_STANDING_DOC),
        )
      : null
    const accountSnapshot = accountRef ? await tx.get(accountRef) : null
    const platformSnapshot = free
      ? await tx.get(platformFreeSpendRef(firestore, day))
      : null
    const used = Number(snapshot.get(gateField) ?? 0)
    const costUsd = monthlySnapshot
      ? Number(monthlySnapshot.get('estCostUsd') ?? 0)
      : null
    if (!(used < limit)) {
      recordAssistRefusal(firestore, orgId, month, 'messages')
      return {
        allowed: false,
        refusedBy: 'messages' as const,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: 0,
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
      }
    }
    // The dollar ceiling, checked AFTER the message cap so the cheaper and
    // more explicable refusal wins when both apply. Refusing here leaves both
    // counters untouched, exactly like the message refusal above: the point
    // of a spend ceiling is that the org above it spends nothing more.
    if (costLimitUsd !== null && costUsd !== null && !(costUsd < costLimitUsd)) {
      recordAssistRefusal(firestore, orgId, month, ceilingIsBand ? 'band' : 'budget')
      return {
        allowed: false,
        refusedBy: ceilingIsBand ? ('band' as const) : ('budget' as const),
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
      }
    }
    // The org's ceiling on its OVERAGE (AGL-2898), checked after the band
    // because it only exists on a band that is sold past. Same shape as the
    // refusals above — inside the transaction, against the spend the
    // transaction read, moving no counter — so a burst of concurrent
    // requests at the ceiling cannot each read "under" and all proceed.
    // `assistOverageCapReached` prices the month's overage the way the
    // invoice will, so the figure that stops here is the figure that would
    // have been billed.
    if (
      overageCapUsd !== null &&
      costUsd !== null &&
      assistOverageCapReached(org, costUsd)
    ) {
      recordAssistRefusal(firestore, orgId, month, 'cap')
      return {
        allowed: false,
        refusedBy: 'cap' as const,
        // Whose ceiling, for the doors (AGL-3011). This one is the
        // workspace's own, and it keeps the sentence and the 402 it has had
        // since AGL-2898 — the four below are Aglyn's and have their own.
        capReason: 'customer' as const,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
      }
    }
    // AGLYN'S OWN OVERAGE GUARDS (AGL-3011), after the workspace's own
    // ceiling so a workspace that set a limit is told about ITS limit.
    //
    // Four refusals, all `refusedBy: 'cap'` with a `capReason`: no card on
    // file, accrual paused, this month's ceiling reached, and the unpaid
    // balance at its limit. The last is the one that makes the bound a
    // bound — it compares what the month accrued against what it PAID, so
    // overage stops at the unpaid limit whether or not any charge ever ran.
    //
    // Inside the transaction, against the figures the transaction read,
    // moving no counter: a burst of concurrent requests at the limit cannot
    // each read "under" and all proceed.
    const overageGuard =
      guardsOverage && costUsd !== null && budgetUsd !== null && costUsd >= budgetUsd
        ? aiOverageRefusal({
            // Priced the way the invoice prices it, so the figure that
            // stops here is the figure that would have been charged.
            overageUsd: assistMonthOverage(org, costUsd).overageMonthlyUsd,
            paidUsd: readAiOverageMonthLedger(
              monthlySnapshot?.data() ?? null,
            ).paidUsd,
            standing: readAiOverageStanding(
              standingSnapshot?.exists ? (standingSnapshot.data() ?? null) : null,
            ),
            now,
          })
        : null
    if (overageGuard) {
      recordAssistRefusal(firestore, orgId, month, 'cap')
      return {
        allowed: false,
        refusedBy: 'cap' as const,
        capReason: overageGuard.capReason,
        overageLimitUsd: overageGuard.limitUsd,
        overageUnpaidUsd: overageGuard.unpaidUsd,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
      }
    }
    // The allotments that apply to the person asking (AGL-2942): read only
    // now that the workspace's own ceilings admitted the request, so an
    // allotment is decided inside the band and a refusal at the band costs
    // no allotment read. Reads, still — every write waits below.
    const allotment = subject
      ? await readAiAllotmentGate(
          (ref) => tx.get(ref),
          orgRef,
          subject,
          month,
          monthlySnapshot,
        )
      : null
    if (allotment?.refusal) {
      recordAssistRefusal(firestore, orgId, month, 'allotment')
      return {
        allowed: false,
        refusedBy: 'allotment' as const,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
        allotment,
      }
    }
    // The Free taste's own rungs (AGL-2925), AFTER the workspace's, so a
    // workspace at its own band is told about its own band. Same shape:
    // decided inside the transaction, against what it read, moving nothing.
    const tasteRefusal = free
      ? freeTasteRefusal(freeTasteReadsFrom(accountSnapshot, platformSnapshot, day))
      : null
    if (tasteRefusal) {
      recordAssistRefusal(firestore, orgId, month, tasteRefusal)
      return {
        allowed: false,
        refusedBy: tasteRefusal,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        costUsd,
        costLimitUsd,
        budgetUsd,
        free,
        allotment,
      }
    }
    // `set(…, { merge: true })` and never `update()`: the counter document
    // does not exist before an org's first message, and `update()` throws
    // NOT_FOUND on a missing doc where a merging set conjures it.
    tx.set(dailyRef, { [day]: increment(1) }, { merge: true })
    tx.set(
      monthlyRef,
      { month, messages: increment(1), updatedAt: serverTimestamp() },
      { merge: true },
    )
    // The account's request, counted in the same commit as the org's
    // message — one atomic step, or the daily request cap has the same
    // read-then-write hole the message cap was moved here to close.
    if (accountRef) {
      tx.set(accountRef, freeAccountReservationWrite(month, day), { merge: true })
    }
    return {
      allowed: true,
      refusedBy: null,
      period,
      dayKey: day,
      monthKey: month,
      used: used + 1,
      limit,
      remaining: Math.max(0, limit - (used + 1)),
      costUsd,
      costLimitUsd,
      budgetUsd,
      free,
      allotment,
    }
  })
}

/** A reservation with every dollar of provider spend removed. */
export interface PublicAssistQuota {
  allowed: boolean
  period: 'day' | 'month'
  used: number
  limit: number
  remaining: number
  refusedBy: AiRefusedBy
  /**
   * The credit standing, or `null` when the org's plan sells no assist band.
   *
   * Null rather than a converted backstop, because a Free workspace refused
   * at the operator's ceiling has no credit balance to report and telling it
   * "0 of 40,000 credits left" names a band it was never sold.
   */
  credits: PublicAssistCredits | null
}

/**
 * The reservation as a CUSTOMER may see it.
 *
 * `AssistReservation` carries `costUsd`, `costLimitUsd` and `budgetUsd`, and
 * all three are our provider bill at the serving model's list rates. Handing
 * the reservation itself to a browser publishes our model costs, and they
 * would move under customers on every model swap. Assist is surfaced in
 * CREDITS, whose meaning is fixed, and this is the one function that crosses
 * that boundary — every route returning quota to a client returns this.
 *
 * `limit` and `remaining` stay MESSAGES, unchanged: the free tier's daily
 * message cap is a real, separately-worded limit that the panel already
 * renders, and folding it into credits would make "10 messages a day"
 * unsayable.
 *
 * The credit view reads against the LOWER of the plan band and the effective
 * ceiling. The band, because it is the quantity the org was sold and the line
 * `report-usage` bills past — an org buying overage (AGL-2653) has no ceiling
 * at all, and reading against `null` would blank its standing at "used 900 of
 * nothing". The ceiling, because an org whose band was undercut by an
 * operator's figure must not be told it has credits left while being refused.
 * `remaining` clamps at zero, so a workspace past its band reads as spent
 * rather than as owed.
 */
export function publicAssistQuota(
  reservation: AssistReservation,
): PublicAssistQuota {
  const { budgetUsd, costLimitUsd, costUsd } = reservation
  const ceilingUsd =
    budgetUsd === null
      ? null
      : costLimitUsd === null
        ? budgetUsd
        : Math.min(budgetUsd, costLimitUsd)
  return {
    allowed: reservation.allowed,
    period: reservation.period,
    used: reservation.used,
    limit: reservation.limit,
    remaining: reservation.remaining,
    refusedBy: reservation.refusedBy,
    credits: ceilingUsd === null ? null : publicAssistCredits(costUsd, ceilingUsd),
  }
}

/**
 * Hand a reservation back when the provider was never reached (AGL-2057): an
 * upstream 502 spent no tokens, so it must not spend one of a free
 * workspace's ten messages a day either.
 *
 * Released against the keys the RESERVATION recorded — see
 * `AssistReservation`. Each counter is read first so neither can be driven
 * below zero, even if the same reservation were released twice: a negative
 * counter is extra capacity, and the release path must not become the
 * laundering route the reservation was added to close.
 */
export async function releaseAssistMessage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  reservation: Pick<AssistReservation, 'allowed' | 'dayKey' | 'monthKey'> &
    Partial<Pick<AssistReservation, 'free'>>,
): Promise<void> {
  if (!reservation.allowed) return
  const increment = FieldValue.increment
  const orgRef = firestore.collection('orgs').doc(orgId)
  const dailyRef = orgRef.collection('counters').doc('assistMessagesDaily')
  const monthlyRef = orgRef.collection('assistUsage').doc(reservation.monthKey)
  // The account's request goes back with the org's message (AGL-2925) —
  // against the same keys, read first for the same reason.
  const accountRef = reservation.free?.accountUid
    ? freeAccountUsageRef(firestore, reservation.free.accountUid, reservation.monthKey)
    : null
  await firestore.runTransaction(async (tx) => {
    const dailySnapshot = await tx.get(dailyRef)
    const monthlySnapshot = await tx.get(monthlyRef)
    const accountSnapshot = accountRef ? await tx.get(accountRef) : null
    if (Number(dailySnapshot.get(reservation.dayKey) ?? 0) > 0) {
      tx.set(dailyRef, { [reservation.dayKey]: increment(-1) }, { merge: true })
    }
    if (Number(monthlySnapshot.get('messages') ?? 0) > 0) {
      tx.set(monthlyRef, { messages: increment(-1) }, { merge: true })
    }
    if (accountRef && accountSnapshot) {
      const days = (accountSnapshot.get('days') ?? {}) as Record<
        string,
        { requests?: unknown } | undefined
      >
      const today = Number(days[reservation.dayKey]?.requests ?? 0)
      const month = Number(accountSnapshot.get('requests') ?? 0)
      if (today > 0 || month > 0) {
        tx.set(
          accountRef,
          {
            ...(month > 0 ? { requests: increment(-1) } : {}),
            ...(today > 0
              ? { days: { [reservation.dayKey]: { requests: increment(-1) } } }
              : {}),
          },
          { merge: true },
        )
      }
    }
  })
}

/**
 * READ-ONLY view of where an org stands against its cap.
 *
 * ⚠️ NOT the enforcement path any more (AGL-2057) — `reserveAssistMessage` is.
 * A read that is followed by a separate write is exactly the shape that let
 * concurrent requests and abandoned streams past the cap; this function is
 * kept for reporting and for tests that want the standing without consuming a
 * message. **Anything that decides whether to call the model must reserve.**
 *
 * Free orgs meter per UTC day; entitled orgs carry the monthly runaway guard.
 */
export async function checkAssistQuota(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  entitled: boolean,
  now = new Date(),
): Promise<AssistQuotaVerdict> {
  if (entitled) {
    const limit = assistEntitledMonthlyLimit()
    const month = assistUsageMonth(now)
    const snapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('assistUsage')
      .doc(month)
      .get()
    const used = Number(snapshot.get('messages') ?? 0)
    return {
      allowed: used < limit,
      period: 'month',
      used,
      limit,
      remaining: Math.max(0, limit - used),
    }
  }
  const limit = assistFreeDailyLimit()
  const day = assistUsageDay(now)
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('counters')
    .doc('assistMessagesDaily')
    .get()
  const used = Number(snapshot.get(day) ?? 0)
  return {
    allowed: used < limit,
    period: 'day',
    used,
    limit,
    remaining: Math.max(0, limit - used),
  }
}

/**
 * The DERIVED half of one assist turn: what it cost, what it cited, how it
 * stopped. No prose and no uid, by construction — see the module header.
 *
 * Split out of `AssistExchangeRecord` (AGL-2073) because the besigner copy
 * assistant at `/api/ai/assist` needs the meters WITHOUT the verbatim half.
 * What a customer types into that surface is their own site copy and blog
 * bodies, and retaining it for 180 days is a data flow the published privacy
 * disclosure does not describe. The margin question — what did this org's
 * assist usage cost us — is answered entirely by this record.
 */
export interface AssistSignalRecord {
  /** Console route the user asked from, e.g. `/org/acme/hosts`. */
  route: string
  hostId: string | null
  model: string
  /** Capability tier served: 'free' (level 1) or 'entitled' (level 1–2). */
  tier: 'free' | 'entitled'
  usage: AssistTokenUsage
  /** Docs paths cited in grounding, for the docs-gap mining view. */
  docsPaths: string[]
  /**
   * The model's own `stop_reason` (`end_turn` | `refusal` | `max_tokens` |
   * …), or null when the stream ended without one. Stored because a
   * refusal and a truncation both look like a short answer in the data —
   * and a rising refusal rate is a prompt problem, while a rising
   * max_tokens rate is a ceiling problem. They need different fixes.
   */
  stopReason: string | null
  /**
   * True when the answer came from the docs index with NO model call
   * (AGL-2486).
   *
   * Optional only so the two existing callers need not be edited in the same
   * breath; it is written as an explicit boolean either way, never left
   * undefined on the document. An absent field would make "this turn used no
   * model" and "this turn predates the flag" the same value, and the whole
   * point of the field is that an operator can tell how much of the month was
   * free.
   */
  deflected?: boolean
  /**
   * The Free taste's attribution (AGL-2925), copied from the reservation
   * that admitted this turn: `null` or absent for a paid workspace, and for
   * a turn that took no reservation. Present, the turn's cost also lands on
   * the platform's day of free spend and — unless the model refused — on
   * the owner's account allowance.
   */
  free?: FreeAssistAccount | null
  /**
   * Who asked, for the per-user rollup (AGL-2928) and NOTHING else: the
   * signal document never carries it, for the reason the module header
   * gives. Optional because a meter that cannot say who asked still owes
   * the org its cost; such a request attributes to nobody.
   */
  uid?: string | null
  /**
   * What the request was for, as the per-user rollup buckets it. A job
   * step names its job's kind; a meter without one is read off `route`.
   */
  kind?: AiUsageKind
  /**
   * How many canvas edits the answer proposed (AGL-2906), on a turn that
   * proposed any. A count and nothing of the edits: the applied-edit door
   * reads it back as the evidence that this turn issued a proposal, and a
   * turn that proposed none carries no field at all.
   */
  editOps?: number
}

/** A signal PLUS the verbatim half — the question, the answer, the asker. */
export interface AssistExchangeRecord extends AssistSignalRecord {
  uid: string
  question: string
  answer: string
}

/**
 * The signal document and the monthly cost rollup — the two writes every
 * assist turn owes regardless of whether its prose is kept. Shared by
 * `recordAssistExchange` and `recordAssistCost` so the meter has exactly one
 * writer and the two entrypoints can never drift into reporting different
 * money for the same tokens.
 */
function writeSignalAndRollup(
  firestore: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  orgRef: FirebaseFirestore.DocumentReference,
  signalRef: FirebaseFirestore.DocumentReference,
  record: AssistSignalRecord,
  now: Date,
  /** What the request was for, as the caller's own rollup names it. */
  kind: AiUsageKind,
): void {
  const increment = FieldValue.increment
  const serverTimestamp = FieldValue.serverTimestamp
  const estCostUsd = estimateAssistCostUsd(record.usage, record.model)
  // What the same tokens COST US (AGL-3015). Recorded beside the billed
  // figure rather than derived from it later: a month is a sum over models
  // and a markup lives on the model, so once the exchanges are added up the
  // mix is gone and the two can no longer be told apart.
  const providerCostUsd = estimateAssistProviderCostUsd(record.usage, record.model)
  const deflected = record.deflected === true
  const free = record.free ?? null
  // On the Free taste a `refusal` stop draws no credits (AGL-2925): the
  // org's band and the account's allowance stay where they were, and the
  // cost goes to the platform's day instead, where it is still our money.
  // Everywhere else the tokens are metered as they always were.
  const refusedFree = free !== null && record.stopReason === 'refusal'
  // The site's credits for its allotment (AGL-2942), rounded as the person's
  // own `byHost` rounds them, so a site's month equals the sum of its
  // people's months on it. Not zeroed for a declined Free turn, for the same
  // reason the person's month is not: the site did spend it.
  const hostId = String(record.hostId ?? '').trim()
  const hostCredits = hostId ? assistCreditsFromUsd(estCostUsd) : 0
  // The analytic half. No prose and NO uid — deliberately, because a signal
  // row that names the asker is just the exchange with the words removed,
  // and would re-create as an access-request obligation exactly what the
  // expiry was meant to retire. What survives answers "which docs gaps, at
  // what cost, rated how", which is the whole of the data loop.
  batch.set(signalRef, {
    route: record.route,
    hostId: record.hostId,
    model: record.model,
    tier: record.tier,
    kind,
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadTokens: record.usage.cacheReadTokens,
    cacheWriteTokens: record.usage.cacheWriteTokens,
    estCostUsd,
    [ASSIST_PROVIDER_COST_FIELD]: providerCostUsd,
    docsPaths: record.docsPaths,
    stopReason: record.stopReason,
    deflected,
    feedback: null,
    ...(record.editOps && record.editOps > 0
      ? { editOps: Math.floor(record.editOps) }
      : {}),
    createdAt: serverTimestamp(),
  })
  // NO message counting here (AGL-2057). Both message counters are moved by
  // `reserveAssistMessage`, BEFORE the provider is called — which is what
  // makes the cap a cap. Counting again here would double every message, and
  // more importantly would restore the belief that this is where the cap
  // advances: it is not, and an exchange that never reaches this function
  // (an abandoned stream) has already been counted.
  batch.set(
    orgRef.collection('assistUsage').doc(assistUsageMonth(now)),
    {
      month: assistUsageMonth(now),
      // The free half of the month, counted where the paid half already is
      // (AGL-2486). `messages` counts what the RESERVATION moved — model
      // turns — and a deflected turn takes no reservation because it spends
      // nothing, so without this counter the questions Assist answered for
      // free are invisible and the deflection rate can only be guessed at.
      // Total questions asked is `messages + deflected`; neither field alone
      // is that number, and reading `messages` as it would understate usage
      // by exactly the amount this work was done to create.
      deflected: increment(deflected ? 1 : 0),
      inputTokens: increment(record.usage.inputTokens),
      outputTokens: increment(record.usage.outputTokens),
      cacheReadTokens: increment(record.usage.cacheReadTokens),
      cacheWriteTokens: increment(record.usage.cacheWriteTokens),
      estCostUsd: increment(refusedFree ? 0 : estCostUsd),
      // Our bill for the same turns, credited and refused alike on the same
      // rule as `estCostUsd` above, so the month's two dollar figures always
      // describe the same set of exchanges and a margin taken across them is
      // a margin over one period.
      [ASSIST_PROVIDER_COST_FIELD]: increment(refusedFree ? 0 : providerCostUsd),
      // The refused half of a Free month, kept beside the credited half so
      // the rollup still says what the month cost us in total. Its own field
      // name (AGL-2986): `refusals` on this document is the gate's map of
      // refusal counts by reason (`recordAssistRefusal`), and an increment
      // over a map replaces the map with the operand.
      refusedTurns: increment(refusedFree ? 1 : 0),
      refusedCostUsd: increment(refusedFree ? estCostUsd : 0),
      // What each model request was for, with its tokens (AGL-2937): cost
      // per generation, tokens per kind and the cache hit rate are read off
      // this map. A docs answer bought nothing and is left out. Both dollar
      // figures are kept — what the kind drew and what it cost us — because
      // the staff card reading this map is asking the second question and
      // the credit meter beside it is asking the first.
      // A declined Free turn is counted in both.
      ...(deflected
        ? {}
        : {
            [AI_USAGE_MONTH_KINDS_FIELD]: {
              [kind]: {
                requests: increment(1),
                estCostUsd: increment(estCostUsd),
                [ASSIST_PROVIDER_COST_FIELD]: increment(providerCostUsd),
                [AI_USAGE_TOKENS_FIELD]: aiTokenIncrements(record.usage),
              },
            },
          }),
      ...(hostCredits > 0
        ? { [AI_HOST_CREDITS_FIELD]: { [hostId]: increment(hostCredits) } }
        : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  if (free) {
    const day = assistUsageDay(now)
    const writes = freeTasteMeterWrites({
      estCostUsd,
      refused: refusedFree,
      day,
      month: assistUsageMonth(now),
    })
    batch.set(platformFreeSpendRef(firestore, day), writes.platform, { merge: true })
    if (free.accountUid) {
      batch.set(
        freeAccountUsageRef(firestore, free.accountUid, assistUsageMonth(now)),
        writes.account,
        { merge: true },
      )
    }
  }
}

/**
 * After a Free turn's batch commits: the ceiling's announcements, which
 * need the figure the batch just moved and must never fail the turn.
 */
async function announceFreeTurn(
  firestore: FirebaseFirestore.Firestore,
  record: AssistSignalRecord,
  now: Date,
): Promise<void> {
  if (!record.free) return
  await announcePlatformFreeSpend(firestore, assistUsageDay(now)).catch((error) =>
    console.error('[ai-free-spend] announcement failed', error),
  )
}

/**
 * Meter one assist turn that keeps NO verbatim record (AGL-2073) — the
 * besigner copy assistant at `/api/ai/assist`.
 *
 * Writes the signal and folds tokens/cost into the monthly rollup, and writes
 * nothing to `assistExchanges`. Same reason the console route splits the two:
 * the loop's corpus was never the words. Here there is no loop to feed and no
 * thumbs to collect, so the words are simply not taken.
 *
 * Like `recordAssistExchange` it counts NO message — the reservation did that
 * before the tokens were spent. Callers should not let a metering failure fail
 * the request: the tokens are already spent either way, and refusing the
 * answer the customer paid for would make an accounting problem a product one.
 */
export async function recordAssistCost(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  record: AssistSignalRecord,
  now = new Date(),
): Promise<string> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const signalRef = orgRef.collection('assistSignals').doc()
  const batch = firestore.batch()
  const kind = record.kind ?? aiUsageKindFromRoute(record.route)
  writeSignalAndRollup(firestore, batch, orgRef, signalRef, record, now, kind)
  // The person's month, on the SAME batch as the org's (AGL-2928), so the
  // two rollups commit together or not at all.
  recordUserAiUsage(batch, orgRef, {
    uid: record.uid,
    month: assistUsageMonth(now),
    estCostUsd: estimateAssistCostUsd(record.usage, record.model),
    hostId: record.hostId,
    kind,
    usage: record.usage,
  })
  await batch.commit()
  chargeAccruedOverage(firestore, orgId, assistUsageMonth(now), now)
  await announceFreeTurn(firestore, record, now)
  return signalRef.id
}

/**
 * The data loop + meters, one batch: writes the two halves of the exchange
 * and folds tokens/cost into the monthly usage doc. It does NOT count the
 * message — `reserveAssistMessage` already did, before the tokens were spent.
 * Returns the shared id (the feedback route addresses it later). Callers
 * `await` this — an exchange that fails to record should surface in logs,
 * but the batch is one round trip so it does not add meaningful latency.
 *
 * The two halves share one id ON PURPOSE. It is what lets the feedback route
 * keep its single-id signature, and it is what makes an exchange and its
 * signal joinable for as long as both exist — without storing a second
 * pointer that could rot.
 */
export async function recordAssistExchange(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  record: AssistExchangeRecord,
  now = new Date(),
): Promise<string> {
  const serverTimestamp = FieldValue.serverTimestamp
  const orgRef = firestore.collection('orgs').doc(orgId)
  const exchangeRef = orgRef.collection('assistExchanges').doc()
  const signalRef = orgRef.collection('assistSignals').doc(exchangeRef.id)

  const batch = firestore.batch()
  // The personal half. Everything a person typed, everything we said back,
  // and who asked — and nothing else. Expires.
  batch.set(exchangeRef, {
    uid: record.uid,
    question: record.question,
    answer: record.answer,
    hostId: record.hostId,
    createdAt: serverTimestamp(),
    expiresAt: assistExchangeExpiry(now),
  })
  // A chat turn is an `assist` request whatever console route it was asked
  // from — on the signal, the org's month and the asker's month alike.
  const kind = record.kind ?? 'assist'
  // The analytic half plus the meters — the same writer `recordAssistCost`
  // uses, so the two assist entrypoints can never report different money for
  // the same tokens.
  writeSignalAndRollup(firestore, batch, orgRef, signalRef, record, now, kind)
  // And the asker's month, on the same batch (AGL-2928).
  recordUserAiUsage(batch, orgRef, {
    uid: record.uid,
    month: assistUsageMonth(now),
    estCostUsd: estimateAssistCostUsd(record.usage, record.model),
    hostId: record.hostId,
    kind,
    usage: record.usage,
  })
  await batch.commit()
  chargeAccruedOverage(firestore, orgId, assistUsageMonth(now), now)
  await announceFreeTurn(firestore, record, now)
  return exchangeRef.id
}

/**
 * Record explicit thumbs feedback on an exchange. Only the exchange's own
 * org path is addressable, and only the two literal values are accepted —
 * the route validates membership before calling this.
 *
 * The rating lands on the SIGNAL document, not the exchange (AGL-1972). A
 * thumbs-down is the single most valuable row in the data loop and it is not
 * personal content, so it must not be reaped along with the prose that
 * earned it. Existence is checked on the signal too: it is the document
 * being written, and after the exchange expires it is the only one left.
 */
export async function recordAssistFeedback(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  exchangeId: string,
  feedback: 'up' | 'down',
): Promise<boolean> {
  const ref = firestore
    .collection('orgs')
    .doc(orgId)
    .collection('assistSignals')
    .doc(exchangeId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return false
  await ref.update({ feedback })
  return true
}
