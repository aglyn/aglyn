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

import { createHash } from 'node:crypto'

/**
 * The answer cache for Aglyn Assist escalations (AGL-2486).
 *
 * An identical question asked twice must not buy two completions. Retrieval
 * deflection already takes most of the repeats — the questions people ask over
 * and over are exactly the ones the documentation answers — so what reaches
 * here is the residue: the docs-shaped questions retrieval was not confident
 * enough about, asked again a week later in the same words. The yield is
 * therefore modest by construction, and saying so is the honest framing: this
 * is the second lever, not the first.
 *
 * ## Scoped to ONE workspace, deliberately
 *
 * A cross-tenant cache would hit far more often, and it is the wrong trade.
 * An entitled answer is composed against that workspace's own name, plan and
 * current screen, and every deployment can carry white-label orgs whose
 * assistant answers under their own product name. Sharing an entry between
 * two workspaces means one workspace's facts reaching the other's panel the
 * first time a key collides, and a cache is the last place anyone looks for
 * that. `orgs/{orgId}/…` makes it impossible rather than unlikely.
 *
 * The key still carries every input that varies the answer — see
 * {@link assistAnswerCacheKey}. Scoping alone is not enough: within one
 * workspace a free member and a Pro member get different capability levels,
 * and two people on different screens get different guidance.
 *
 * ## One document, self-pruning — and why not a TTL
 *
 * Entries live in a single `counters/assistAnswerCache` document as a map,
 * pruned to {@link MAX_CACHE_ENTRIES} newest on every write. That shape was
 * chosen against a per-document collection with a TTL field, which is the
 * more obvious design and the worse one here:
 *
 * - A Firestore TTL policy is MANUAL gcloud configuration, not repo state
 *   (see `docs/FIRESTORE_MANUAL_CONFIG.md`). A new collection that assumes one
 *   grows without bound on every deployment where nobody ran the command —
 *   including every self-hoster, none of whom will know it exists.
 * - Pruning on write needs no policy, no index and no operator step, and it
 *   bounds the document on the deployment that is actually using it.
 *
 * Write contention is the cost, and it is affordable: escalations are bounded
 * by the message caps (ten a day free, a thousand a month entitled), which is
 * orders of magnitude under the per-document write ceiling.
 *
 * ## Staleness
 *
 * An entry expires after {@link CACHE_TTL_MS}. The bound exists because the
 * product moves: an answer describing a screen that has since been rebuilt is
 * worse than no cache, and unlike a docs deflection there is no live citation
 * for the user to check it against. Expiry is evaluated on READ as well as
 * pruned on write, so a stale entry cannot be served by a deployment that has
 * stopped writing.
 */

/** Cached answers kept per workspace. */
const MAX_CACHE_ENTRIES = 60

/**
 * How long a cached answer may be served — seven days.
 *
 * Long enough that a question asked on Monday and again the following Monday
 * hits, which is the recurrence pattern this exists for; short enough that an
 * answer never outlives a release cycle by much. The failure it bounds is an
 * answer that was right when it was written and is now confidently describing
 * a screen that changed.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** One doc per org, beside the other `counters/*` documents. */
const CACHE_DOC = 'assistAnswerCache'

export interface AssistCachedAnswer {
  answer: string
  docs: { title: string; url: string }[]
  /** Epoch ms the entry was written. */
  at: number
}

export interface AssistAnswerCacheInputs {
  question: string
  /** 'free' or 'entitled' — different capability levels, different answers. */
  tier: string
  /** The console route the question was asked from ('' when none). */
  route: string
  /** The serving model id. */
  model: string
  /** The product name the assistant answers under (white-label aware). */
  productName: string
  /** The workspace's plan by name (AGL-4075), which every answer is told. */
  plan?: string
}

/**
 * Normalise a question so trivially different phrasings share an entry.
 *
 * Case, surrounding whitespace, internal runs of whitespace and trailing
 * punctuation only. Deliberately NOT stemming, stop-word removal or token
 * sorting: those would make "how do I turn OFF maintenance mode" and "how do
 * I turn ON maintenance mode" the same key, and serving one for the other is
 * a wrong answer rather than a missed saving. A cache key may only ever
 * collapse differences that cannot change the answer.
 */
export function normaliseAssistQuestion(question: string): string {
  return String(question ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s?!.,;:]+$/g, '')
    .trim()
}

/**
 * The delimiter the key parts are joined on: NUL, written as an ESCAPE rather
 * than as a literal byte.
 *
 * NUL because it is the one character that cannot appear in a question, a
 * route, a model id or a product name, so no pair of different inputs can
 * concatenate into the same string — the classic way a hashed composite key
 * develops collisions that read as cache bugs.
 *
 * As an escape because a literal NUL in the source makes git classify the
 * whole file as BINARY: no diff, no review, no blame. It shipped that way once
 * and the commit carried `Bin 0 -> 9601 bytes` where the file should have been.
 */
const CACHE_KEY_DELIMITER = '\u0000'

/**
 * The cache key: a hash over EVERY input that can change the answer.
 *
 * Joined on {@link CACHE_KEY_DELIMITER}, which no part can contain.
 */
export function assistAnswerCacheKey(inputs: AssistAnswerCacheInputs): string {
  const parts = [
    normaliseAssistQuestion(inputs.question),
    String(inputs.tier ?? ''),
    String(inputs.route ?? ''),
    String(inputs.model ?? ''),
    String(inputs.productName ?? ''),
    // The plan's name rides every prompt since AGL-4075, so "what plan am I
    // on" must not be answered from before an upgrade.
    String(inputs.plan ?? ''),
  ]
  return createHash('sha256')
    .update(parts.join(CACHE_KEY_DELIMITER))
    .digest('hex')
    .slice(0, 32)
}

/** Whether an entry is still inside the freshness window. */
export function assistCacheEntryIsFresh(
  entry: AssistCachedAnswer | null | undefined,
  now = Date.now(),
): boolean {
  if (!entry || typeof entry.answer !== 'string' || !entry.answer) return false
  const at = Number(entry.at)
  // `strictNullChecks` is off repo-wide, so a missing `at` reads as NaN rather
  // than failing a null check. NaN fails every comparison, which is the right
  // way round: an entry that cannot say when it was written is not fresh.
  if (!Number.isFinite(at)) return false
  return now - at < CACHE_TTL_MS
}

/**
 * Read one cached answer, or `null`.
 *
 * Never throws: a cache is an optimisation, and an unavailable one must cost
 * a model call rather than the user's answer. The caller therefore cannot
 * tell a miss from an outage, which is correct — both mean "call the model".
 */
export async function readAssistAnswerCache(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  key: string,
  now = Date.now(),
): Promise<AssistCachedAnswer | null> {
  try {
    const snapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('counters')
      .doc(CACHE_DOC)
      .get()
    const entry = snapshot.get(key) as AssistCachedAnswer | undefined
    return assistCacheEntryIsFresh(entry, now) ? entry : null
  } catch (error) {
    console.error('assist answer cache read failed', error)
    return null
  }
}

/**
 * Store one answer, pruning the document back to {@link MAX_CACHE_ENTRIES}.
 *
 * Read-then-write rather than a blind merging set, because pruning needs to
 * see what is already there. Not a transaction: two concurrent writers can
 * lose one entry to each other, and losing a cache entry costs one model call
 * later — a transaction would cost a contended write on every escalation to
 * prevent that. The counters this module must never race are in
 * `reserveAssistMessage`, and none of them are here.
 *
 * Never throws, for the same reason the read does not.
 */
export async function writeAssistAnswerCache(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  key: string,
  value: Omit<AssistCachedAnswer, 'at'>,
  now = Date.now(),
): Promise<void> {
  try {
    const ref = firestore
      .collection('orgs')
      .doc(orgId)
      .collection('counters')
      .doc(CACHE_DOC)
    const snapshot = await ref.get()
    const existing = (snapshot.data() ?? {}) as Record<
      string,
      AssistCachedAnswer
    >
    const next: Record<string, AssistCachedAnswer> = {
      ...existing,
      [key]: { answer: value.answer, docs: value.docs ?? [], at: now },
    }
    const fresh = Object.entries(next).filter(([, entry]) =>
      assistCacheEntryIsFresh(entry, now),
    )
    fresh.sort((a, b) => Number(b[1].at) - Number(a[1].at))
    // A full `set` without merge, so pruning actually REMOVES entries. A
    // merging set can only ever add: the document would keep every key it had
    // and the cap would be a comment. This is the one place a non-merging
    // write is correct, and it is safe only because nothing else writes here.
    await ref.set(Object.fromEntries(fresh.slice(0, MAX_CACHE_ENTRIES)))
  } catch (error) {
    console.error('assist answer cache write failed', error)
  }
}

/** Exported for the spec — the bound the pruning enforces. */
export const ASSIST_ANSWER_CACHE_LIMIT = MAX_CACHE_ENTRIES
/** Exported for the spec — the freshness window in ms. */
export const ASSIST_ANSWER_CACHE_TTL_MS = CACHE_TTL_MS
