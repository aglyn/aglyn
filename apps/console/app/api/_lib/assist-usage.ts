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
 *   orgs/{orgId}/assistExchanges/{id}      one doc per Q&A exchange:
 *     { uid, question, answer, route, hostId, model, tier,
 *       inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
 *       estCostUsd, docsPaths, feedback: 'up'|'down'|null, createdAt }
 *
 * Costs are OUR cost estimates at list rates (pricing-tunable telemetry),
 * mirrored after ORG_COGS_UNIT_RATES_USD's posture: cost visibility per org
 * from day one so the paid gate and caps can be tuned with data — Zach's
 * "must not eat margins" constraint.
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

/**
 * List-rate unit costs (USD per token) for the assist model tier — Sonnet
 * class. These are telemetry estimates for margin tuning, not billing.
 */
export const ASSIST_TOKEN_RATES_USD = {
  inputPerToken: 3 / 1_000_000,
  outputPerToken: 15 / 1_000_000,
  cacheReadPerToken: 0.3 / 1_000_000,
  cacheWritePerToken: 3.75 / 1_000_000,
}

export interface AssistTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Estimated cost in USD for one exchange, at list rates, rounded to 6dp. */
export function estimateAssistCostUsd(usage: AssistTokenUsage): number {
  const rates = ASSIST_TOKEN_RATES_USD
  const raw =
    usage.inputTokens * rates.inputPerToken +
    usage.outputTokens * rates.outputPerToken +
    usage.cacheReadTokens * rates.cacheReadPerToken +
    usage.cacheWriteTokens * rates.cacheWritePerToken
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
 * Pre-flight quota check — runs BEFORE the model request so a capped org
 * never spends tokens. Free orgs meter per UTC day; entitled orgs carry the
 * monthly runaway guard. Reads are strongly consistent (no cache): a cap
 * must not be laundered by a stale counter.
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
}

/**
 * The data loop + meters, one batch: writes the exchange doc, bumps the
 * daily counter, and folds tokens/cost into the monthly usage doc. Returns
 * the new exchange id (the feedback route addresses it later). Callers
 * `await` this — an exchange that fails to record should surface in logs,
 * but the batch is one round trip so it does not add meaningful latency.
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
  const estCostUsd = estimateAssistCostUsd(record.usage)

  const batch = firestore.batch()
  batch.set(exchangeRef, {
    uid: record.uid,
    question: record.question,
    answer: record.answer,
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
    feedback: null,
    createdAt: serverTimestamp(),
  })
  batch.set(
    orgRef.collection('counters').doc('assistMessagesDaily'),
    { [assistUsageDay(now)]: increment(1) },
    { merge: true },
  )
  batch.set(
    orgRef.collection('assistUsage').doc(assistUsageMonth(now)),
    {
      month: assistUsageMonth(now),
      messages: increment(1),
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
    .collection('assistExchanges')
    .doc(exchangeId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return false
  await ref.update({ feedback })
  return true
}
