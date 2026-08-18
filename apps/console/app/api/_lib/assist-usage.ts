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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Aglyn Assist metering + the data loop (AGL-1860, phase 1).
 *
 * Collections (org-scoped, ABSENT from firebase-firestore.rules on purpose —
 * default-deny, the forumThreads precedent: every read/write passes the
 * assist API route via the Admin SDK):
 *
 *   orgs/{orgId}/assistUsage/{YYYY-MM}     per-org monthly cost telemetry:
 *     { month, messages, inputTokens, outputTokens, cacheReadTokens,
 *       cacheWriteTokens, estCostUsd, updatedAt }
 *   orgs/{orgId}/counters/assistMessagesDaily
 *     fields keyed YYYY-MM-DD → integer (the free-tier daily cap counter;
 *       same field-per-period shape as the other `counters/*` docs)
 *   orgs/{orgId}/assistExchanges/{id}      the VERBATIM half of one exchange:
 *     { uid, question, answer, hostId, createdAt, expiresAt }
 *   orgs/{orgId}/assistSignals/{id}        the DERIVED half, same id:
 *     { route, hostId, model, tier, inputTokens, outputTokens,
 *       cacheReadTokens, cacheWriteTokens, estCostUsd, docsPaths,
 *       stopReason, feedback: 'up'|'down'|null, createdAt }
 *
 * Costs are OUR cost estimates at list rates (pricing-tunable telemetry),
 * mirrored after ORG_COGS_UNIT_RATES_USD's posture: cost visibility per org
 * from day one so the paid gate and caps can be tuned with data — Zach's
 * "must not eat margins" constraint.
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
 * deploy of new code paths; the default is deliberately small — a free org
 * at the cap costs well under a cent a day at Sonnet list rates, so the
 * free tier can never eat margin even fleet-wide.
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

export interface AssistTokenRates {
  inputPerToken: number
  outputPerToken: number
  cacheReadPerToken: number
  cacheWritePerToken: number
}

/** List price per MTok → per-token rates, cache read at 0.1x, write 1.25x. */
function rates(inputPerMTok: number, outputPerMTok: number): AssistTokenRates {
  return {
    inputPerToken: inputPerMTok / 1_000_000,
    outputPerToken: outputPerMTok / 1_000_000,
    cacheReadPerToken: (inputPerMTok * 0.1) / 1_000_000,
    cacheWritePerToken: (inputPerMTok * 1.25) / 1_000_000,
  }
}

/**
 * List-rate unit costs (USD per token) BY MODEL. Telemetry estimates for
 * margin tuning, not billing.
 *
 * Keyed by model rather than fixed at Sonnet's rates because `ASSIST_MODEL`
 * is an env override: a one-line incident swap to an Opus-class model would
 * otherwise keep reporting Sonnet money, and per-org cost would read as
 * roughly right — the failure mode this whole meter exists to prevent. An
 * unknown id falls back to the most EXPENSIVE known tier on purpose: a
 * cost estimate that errs low is worse than one that errs high.
 */
export const ASSIST_MODEL_RATES_USD: Record<string, AssistTokenRates> = {
  'claude-sonnet-5': rates(3, 15),
  'claude-sonnet-4-6': rates(3, 15),
  'claude-haiku-4-5': rates(1, 5),
  'claude-opus-5': rates(5, 25),
  'claude-opus-4-8': rates(5, 25),
}

/** Rates for the assist tier's default model — Sonnet class. */
export const ASSIST_TOKEN_RATES_USD = ASSIST_MODEL_RATES_USD['claude-sonnet-5']

/** The dearest known tier, used when a model id is not in the table. */
const FALLBACK_RATES: AssistTokenRates = rates(10, 50)

export function assistRatesForModel(model: string): AssistTokenRates {
  return ASSIST_MODEL_RATES_USD[model] ?? FALLBACK_RATES
}

export interface AssistTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Estimated cost in USD for one exchange, at the SERVING model's list
 * rates, rounded to 6dp. `model` is optional only so the older call shape
 * keeps working; the route always passes it.
 */
export function estimateAssistCostUsd(
  usage: AssistTokenUsage,
  model = 'claude-sonnet-5',
): number {
  const rate = assistRatesForModel(model)
  const raw =
    usage.inputTokens * rate.inputPerToken +
    usage.outputTokens * rate.outputPerToken +
    usage.cacheReadTokens * rate.cacheReadPerToken +
    usage.cacheWriteTokens * rate.cacheWritePerToken
  return Math.round(raw * 1_000_000) / 1_000_000
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
 */
export async function reserveAssistMessage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  entitled: boolean,
  now = new Date(),
): Promise<AssistReservation> {
  const increment = firebaseAdmin.firestore.FieldValue.increment
  const serverTimestamp = firebaseAdmin.firestore.FieldValue.serverTimestamp
  const orgRef = firestore.collection('orgs').doc(orgId)
  const day = assistUsageDay(now)
  const month = assistUsageMonth(now)
  const dailyRef = orgRef.collection('counters').doc('assistMessagesDaily')
  const monthlyRef = orgRef.collection('assistUsage').doc(month)
  const limit = entitled ? assistEntitledMonthlyLimit() : assistFreeDailyLimit()
  const period: 'day' | 'month' = entitled ? 'month' : 'day'
  const gateRef = entitled ? monthlyRef : dailyRef
  const gateField = entitled ? 'messages' : day

  return firestore.runTransaction(async (tx) => {
    // The one read, before any write — Firestore requires that ordering, and
    // it is also what makes check-and-increment a single atomic step.
    const snapshot = await tx.get(gateRef)
    const used = Number(snapshot.get(gateField) ?? 0)
    if (!(used < limit)) {
      return {
        allowed: false,
        period,
        dayKey: day,
        monthKey: month,
        used,
        limit,
        remaining: 0,
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
    return {
      allowed: true,
      period,
      dayKey: day,
      monthKey: month,
      used: used + 1,
      limit,
      remaining: Math.max(0, limit - (used + 1)),
    }
  })
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
  reservation: Pick<AssistReservation, 'allowed' | 'dayKey' | 'monthKey'>,
): Promise<void> {
  if (!reservation.allowed) return
  const increment = firebaseAdmin.firestore.FieldValue.increment
  const orgRef = firestore.collection('orgs').doc(orgId)
  const dailyRef = orgRef.collection('counters').doc('assistMessagesDaily')
  const monthlyRef = orgRef.collection('assistUsage').doc(reservation.monthKey)
  await firestore.runTransaction(async (tx) => {
    const dailySnapshot = await tx.get(dailyRef)
    const monthlySnapshot = await tx.get(monthlyRef)
    if (Number(dailySnapshot.get(reservation.dayKey) ?? 0) > 0) {
      tx.set(dailyRef, { [reservation.dayKey]: increment(-1) }, { merge: true })
    }
    if (Number(monthlySnapshot.get('messages') ?? 0) > 0) {
      tx.set(monthlyRef, { messages: increment(-1) }, { merge: true })
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

export interface AssistExchangeRecord {
  uid: string
  question: string
  answer: string
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
  const increment = firebaseAdmin.firestore.FieldValue.increment
  const serverTimestamp = firebaseAdmin.firestore.FieldValue.serverTimestamp
  const orgRef = firestore.collection('orgs').doc(orgId)
  const exchangeRef = orgRef.collection('assistExchanges').doc()
  const signalRef = orgRef.collection('assistSignals').doc(exchangeRef.id)
  const estCostUsd = estimateAssistCostUsd(record.usage, record.model)

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
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadTokens: record.usage.cacheReadTokens,
    cacheWriteTokens: record.usage.cacheWriteTokens,
    estCostUsd,
    docsPaths: record.docsPaths,
    stopReason: record.stopReason,
    feedback: null,
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
      inputTokens: increment(record.usage.inputTokens),
      outputTokens: increment(record.usage.outputTokens),
      cacheReadTokens: increment(record.usage.cacheReadTokens),
      cacheWriteTokens: increment(record.usage.cacheWriteTokens),
      estCostUsd: increment(estCostUsd),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  await batch.commit()
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
