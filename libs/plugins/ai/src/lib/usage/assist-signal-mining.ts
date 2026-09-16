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

import {
  assistProviderCostUsd,
  ASSIST_PROVIDER_COST_FIELD,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { aiCacheHitRate } from '../model/ai-tokens'
import { aiUsageKindFromRoute } from '../model/ai-usage-by-user'

/**
 * The read side of the Aglyn Assist data loop (AGL-1860, AGL-2252).
 *
 * `orgs/{id}/assistSignals/{id}` is written on every assist turn and, until
 * this module, was read by nothing. That is a specific kind of failure: the
 * signal document exists BECAUSE AGL-1972 split the prose from the analytics
 * so the corpus could outlive the 180-day expiry on what people typed. A
 * corpus preserved for a reader that does not exist is just retention.
 *
 * Three questions, answered from one pass:
 *
 *  1. **Where are the docs thin?** Rank the cited docs paths by how often a
 *     question landed on them and how often the answer was rated down. A
 *     page cited constantly and rated down is a page that is being FOUND and
 *     is not answering — the single most actionable row in the set, and the
 *     one AGL-1860 wants turned into a docs issue.
 *  2. **What did retrieval miss entirely?** A turn with no `docsPaths` is a
 *     question the corpus could not match at all, so the model answered
 *     ungrounded. That is a sharper gap signal than a low rating, and it is
 *     invisible in any ranking keyed on paths — a missing page cites nothing,
 *     so it appears nowhere. It is counted separately, by ROUTE, so the gap
 *     comes with the screen the person was looking at when they hit it.
 *  3. **What is this costing, and to whom?** Per-org and fleet-wide token and
 *     dollar rollups, plus the cache-read rate. That last one settles a
 *     question the chat route could only pose: the cached system prefix
 *     measures 1,030–1,190 tokens against Sonnet 5's 1,024-token minimum, so
 *     whether it caches at all is an empirical question and `cacheReadTokens`
 *     is the only evidence. A prefix under the minimum caches silently not at
 *     all, and the bill is the only place it shows.
 *
 * Pure and free of Firestore, so it can be tested on fixtures rather than on
 * a mocked SDK — the route does the reading, this does the arithmetic.
 */

/** One `assistSignals` document, as the route projects it. */
export interface AssistSignalRow {
  orgId: string
  /**
   * The signal's document id, which IS the exchange's id (AGL-2314).
   *
   * `recordAssistExchange` mints one id and writes both halves under it —
   * `assistExchanges/{id}` for the prose that expires and `assistSignals/{id}`
   * for the analytics that do not — deliberately, "so an exchange and its
   * signal are joinable for as long as both exist, without storing a second
   * pointer that could rot". Nothing ever made the join. This is the field
   * that lets the corpus be read.
   */
  exchangeId: string
  route: string
  /**
   * What the turn was for, as the rollups name it (AGL-2937): `assist`, a
   * besigner mode, or a job kind. A signal written before the field is read
   * by its route, where a generation job's step reads as `job`.
   */
  kind?: string
  model: string
  tier: 'free' | 'entitled' | string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /**
   * What this turn cost us, at the serving model's provider rates. Every
   * dollar mined out of this module is that figure: the signals page asks
   * one money question and it is "what are we spending" (AGL-3015).
   */
  providerCostUsd: number
  docsPaths: string[]
  stopReason: string | null
  feedback: 'up' | 'down' | null
  /** Served with no model call — docs retrieval or a cache hit (AGL-2486). */
  deflected: boolean
}

export interface DocsGapRow {
  path: string
  /** Turns that cited this path. */
  questions: number
  up: number
  down: number
  /** Distinct orgs that landed here — a gap one org has is not a gap. */
  orgs: number
  providerCostUsd: number
  /** `down / (up + down)`, or null when nobody rated. */
  downRate: number | null
}

export interface UngroundedRoute {
  route: string
  questions: number
  down: number
}

/**
 * A turn whose PROSE is worth reading (AGL-2314).
 *
 * `assistExchanges` holds the verbatim half — the question a customer typed
 * and the answer we gave — for 180 days, and the module header calls it "the
 * data loop's corpus". No corpus consumer existed: nothing in the repo read
 * the collection, so we were retaining customers' words, and publicly
 * promising to, for zero product value.
 *
 * The shortlist is deliberately NOT every turn. Prose is fetched only for
 * turns that FAILED — rated thumbs-down, or grounded in no documentation at
 * all — because those are the ones where the counts cannot say what went
 * wrong and the words can. Reading the successful ones would be surveillance
 * with a dashboard on it.
 */
export interface ProseCandidate {
  orgId: string
  /**
   * That workspace by name, filled in by the route.
   *
   * Optional because this module is pure and Firestore-free: it can count a
   * workspace's turns and it cannot know what the workspace is called. The
   * route resolves the labels and the reader falls back to the id, so a
   * workspace outside the lookup is still a lead somebody can search for.
   */
  orgLabel?: string | null
  exchangeId: string
  /** The console screen the question was asked from. */
  route: string
  feedback: 'up' | 'down' | null
  /** False when retrieval cited no documentation at all. */
  grounded: boolean
}

export interface OrgCostRow {
  orgId: string
  /** That workspace by name — see {@link ProseCandidate.orgLabel}. */
  orgLabel?: string | null
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  providerCostUsd: number
  down: number
}

/** One row of a cost breakdown — see `totals.byTier` / `totals.byModel`. */
export interface CostSplit {
  messages: number
  providerCostUsd: number
}

/** One kind of model turn, summed (AGL-2937) — see `totals.byKind`. */
export interface KindTokenSplit {
  messages: number
  providerCostUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /**
   * The output 95 of every 100 turns of this kind stayed within, by nearest
   * rank — the figure a kind's `max_tokens` is sized against.
   */
  outputP95: number
  /** The share of this kind's prompt tokens the cache served — `aiCacheHitRate`. */
  cacheHitRate: number | null
}

/** The kinds as the board lists them, dearest first. */
export function kindTokenRows(
  split: Record<string, KindTokenSplit>,
): Array<KindTokenSplit & { kind: string }> {
  return Object.entries(split)
    .map(([kind, value]) => ({ kind, ...value }))
    .sort(
      (a, b) =>
        b.providerCostUsd - a.providerCostUsd || b.messages - a.messages || a.kind.localeCompare(b.kind),
    )
}

/** A sample's value at a percentile by nearest rank — always one that was seen; 0 for none. */
export function nearestRankPercentile(values: readonly number[], percentile: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)))
  return sorted[rank - 1]
}

/**
 * A cost breakdown as a sorted, labelled list — dearest first (AGL-2340).
 *
 * Exported because the ordering is the readable half. A breakdown in
 * whatever order the keys happened to be inserted is a table you have to
 * scan; the point of the panel is that the expensive line is the top line.
 */
export function costSplitRows(
  split: Record<string, CostSplit>,
): { key: string; messages: number; providerCostUsd: number }[] {
  return Object.entries(split)
    .map(([key, value]) => ({
      key,
      messages: value.messages,
      providerCostUsd: value.providerCostUsd,
    }))
    .sort((a, b) => b.providerCostUsd - a.providerCostUsd || a.key.localeCompare(b.key))
}

/**
 * One workspace on the month's spend leaderboard (AGL-2930).
 *
 * Read off `assistUsage/{month}` rather than off the signals: the signals
 * carry every turn ever recorded and no month, so ranking them answers
 * "who has spent the most since the beginning", and the board's question is
 * "who is spending the most NOW". The month document is also where the
 * refusal counter lives, so the row can say how often the org was refused
 * beside how much it spent — the two numbers a staff reader compares.
 */
export interface AssistSpendRow {
  orgId: string
  orgLabel?: string | null
  plan: string
  aiAddon: boolean
  /** Credits drawn this month, from the measured spend. */
  credits: number
  providerCostUsd: number
  refusals: {
    band: number
    cap: number
    messages: number
    budget: number
    /** A hard AI allotment a manager set (AGL-2942). */
    allotment: number
    /** The Free taste's rungs (AGL-2925); zero on every paid workspace. */
    account: number
    requests: number
    refusals: number
    platform: number
    total: number
  }
}

/** The Free taste's refusals as one figure: the board names the wall, not each rung. */
export function freeTasteRefusals(refusals: AssistSpendRow['refusals']): number {
  return refusals.account + refusals.requests + refusals.refusals + refusals.platform
}

/**
 * The leaderboard's ordering: dearest first, then most credits, then by id
 * so two equal rows render in one stable order rather than the order the
 * scan happened to return them in. Returns the top `limit` and how many
 * were ranked, so the page can say "top 25 of 140" rather than imply the
 * cut is the whole fleet.
 */
export function rankAssistSpend(
  rows: readonly AssistSpendRow[],
  limit: number,
): { rows: AssistSpendRow[]; ranked: number } {
  const sorted = [...rows].sort(
    (a, b) =>
      b.providerCostUsd - a.providerCostUsd ||
      b.credits - a.credits ||
      a.orgId.localeCompare(b.orgId),
  )
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : sorted.length
  return { rows: sorted.slice(0, cap), ranked: sorted.length }
}

/**
 * Today's platform-wide free-tier AI spend against its daily ceiling
 * (AGL-2925), as the route reads it beside the mined signals. Declared here,
 * where the page's report type lives, so the client page needs no import
 * from the admin library to name it.
 */
export interface AssistFreeSpendReadout {
  /** The UTC day the figures describe. */
  day: string
  /**
   * The day's free spend as the CEILING measures it — the billed figure,
   * because the ceiling this is compared against was sized against it and
   * the reservation refuses on the same reading (AGL-3015). The one dollar
   * on this page that is not our provider bill, and it is a wall rather than
   * a cost.
   */
  estCostUsd: number
  requests: number
  refusals: number
  ceilingUsd: number
  /** True once staff were mailed at 80% today. */
  alerted: boolean
  /** True while every Free workspace is refused generation for the day. */
  paused: boolean
}

export interface AssistMiningReport {
  scanned: number
  /** True when the read hit its ceiling — see `mineAssistSignals`. */
  truncated: boolean
  totals: {
    messages: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    providerCostUsd: number
    /**
     * Turns answered with NO model call — docs retrieval or an answer-cache
     * hit (AGL-2486). Counted separately from `messages`, which is every
     * turn, so `deflected / messages` is the deflection rate.
     */
    deflected: number
    /**
     * That rate, or `null` when nothing was scanned.
     *
     * Nullable rather than 0 for the reason `costUsd` on a reservation is:
     * "no turns were scanned" and "every turn cost a model call" are opposite
     * findings, and 0 says the second one when the truth is the first. This
     * is the headline number for whether Assist is affordable to leave on,
     * and it must not be able to report a false alarm on an idle month.
     */
    deflectionRate: number | null
    /**
     * Share of prompt tokens served from cache — reads over everything the
     * prompts were billed as, cache writes included (`aiCacheHitRate`) — or
     * null at zero.
     */
    cacheReadRate: number | null
    /**
     * Cost split by entitlement tier, then by model (AGL-2340).
     *
     * Both carried as `{ messages, providerCostUsd }` rather than a bare turn
     * count, because the questions these answer are money questions and a
     * count cannot answer either of them. `byTier` settles "is the free tier
     * eating the margin, or are paying orgs?" — the free tier can be a
     * minority of turns and a majority of spend, and a count says the
     * opposite of the truth in exactly that case. `byModel` settles "would a
     * cheaper model on the common path fix this?", where the whole point is
     * that turns and dollars do not move together.
     */
    byTier: Record<string, CostSplit>
    byModel: Record<string, CostSplit>
    /**
     * Model turns split by what they were for (AGL-2937): cost, the four
     * token counts, the p95 output and the cache hit rate of each kind. A
     * turn answered with no model call has no tokens to split and is left
     * out.
     */
    byKind: Record<string, KindTokenSplit>
    stopReasons: Record<string, number>
    feedback: { up: number; down: number; none: number }
  }
  docsGaps: DocsGapRow[]
  /**
   * How tall each ranking was BEFORE it was cut to `limit`.
   *
   * `truncated` reports only that the SCAN hit its ceiling. It says nothing
   * about the rankings built from what was scanned, and those are cut too —
   * every list below is sliced to `limit`. A table showing twenty-five of a
   * hundred and thirty-seven cited pages looks exactly like one showing all
   * twenty-five there are, which is the AGL-2220 shape the scan ceiling was
   * given a banner to avoid, reproduced one layer down.
   *
   * Counted rather than inferred from `length === limit`: a ranking that is
   * exactly `limit` rows tall is the case where the guess is wrong in both
   * directions.
   */
  ranked: {
    docsGaps: number
    ungroundedRoutes: number
    orgs: number
  }
  /**
   * Today's free-tier spend against the platform ceiling (AGL-2925).
   * Optional because the miner is pure and does not produce it — the route
   * reads it from Firestore and attaches it beside the mined report.
   */
  freeSpend?: AssistFreeSpendReadout
  /** Turns whose words are worth reading — see {@link ProseCandidate}. */
  proseCandidates: ProseCandidate[]
  ungrounded: {
    questions: number
    down: number
    routes: UngroundedRoute[]
  }
  orgs: OrgCostRow[]
}

const number = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A signal's kind: the field once it is written, else read off its route (AGL-2937). */
function signalKind(data: Record<string, unknown>, route: string): string {
  const kind = data['kind']
  if (typeof kind === 'string' && kind) return kind
  // A job step was metered under this route before its signal named the kind.
  return route === 'ai/jobs' ? 'job' : aiUsageKindFromRoute(route)
}

/**
 * Normalize one raw signal document. Every field is defaulted, because a
 * signal written by an older build is still evidence and dropping it would
 * bias the ranking toward whatever shipped most recently.
 */
export function assistSignalRow(
  orgId: string,
  exchangeId: string,
  data: Record<string, unknown>,
): AssistSignalRow {
  const rawPaths = Array.isArray(data['docsPaths']) ? data['docsPaths'] : []
  const feedback = data['feedback']
  const route = String(data['route'] ?? '')
  return {
    orgId,
    exchangeId,
    route,
    kind: signalKind(data, route),
    model: String(data['model'] ?? 'unknown'),
    tier: String(data['tier'] ?? 'unknown'),
    inputTokens: number(data['inputTokens']),
    outputTokens: number(data['outputTokens']),
    cacheReadTokens: number(data['cacheReadTokens']),
    cacheWriteTokens: number(data['cacheWriteTokens']),
    // What the turn COST US (AGL-3015). The stored `estCostUsd` beside it
    // is the same turn at BILLED rates — the figure the customer's credits
    // came out of — and every dollar on the signals page is asking the other
    // question. A signal written before the split carries only the billed
    // figure, which over-reads our bill rather than under-reads it.
    providerCostUsd: assistProviderCostUsd(
      data['estCostUsd'],
      data[ASSIST_PROVIDER_COST_FIELD],
    ),
    docsPaths: rawPaths.map((path) => String(path)).filter(Boolean),
    stopReason: data['stopReason'] == null ? null : String(data['stopReason']),
    feedback: feedback === 'up' || feedback === 'down' ? feedback : null,
    // Strict `=== true`, so a signal written before the field existed reads
    // as "served by a model" rather than as deflected. Defaulting the other
    // way would credit historic turns with a saving that never happened and
    // make the rate look best on the day it shipped.
    deflected: data['deflected'] === true,
  }
}

/** Accumulate one turn's spend into a `byTier`/`byModel` bucket. */
function addToSplit(
  split: Record<string, CostSplit>,
  key: string,
  providerCostUsd: number,
) {
  const bucket = split[key] ?? { messages: 0, providerCostUsd: 0 }
  bucket.messages += 1
  bucket.providerCostUsd += providerCostUsd
  split[key] = bucket
}

/**
 * Rank the docs gaps and roll the money up.
 *
 * `truncated` is carried through rather than hidden. A sweep that quietly
 * stops at a ceiling and presents the remainder as the whole is the AGL-2220
 * defect, and it is worse here than there: a partial sample of a RANKING
 * looks exactly like a complete one, and the thing being ranked is where to
 * spend documentation effort.
 */
export function mineAssistSignals(
  rows: AssistSignalRow[],
  options: { truncated?: boolean; limit?: number } = {},
): AssistMiningReport {
  const limit = options.limit ?? 25
  const totals = {
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    providerCostUsd: 0,
    deflected: 0,
    deflectionRate: null as number | null,
    cacheReadRate: null as number | null,
    byTier: {} as Record<string, CostSplit>,
    byModel: {} as Record<string, CostSplit>,
    byKind: {} as Record<string, KindTokenSplit>,
    stopReasons: {} as Record<string, number>,
    feedback: { up: 0, down: 0, none: 0 },
  }

  const gaps = new Map<
    string,
    { row: Omit<DocsGapRow, 'orgs' | 'downRate'>; orgs: Set<string> }
  >()
  const ungroundedRoutes = new Map<string, UngroundedRoute>()
  const orgs = new Map<string, OrgCostRow>()
  const proseCandidates: ProseCandidate[] = []
  const kinds = new Map<
    string,
    Omit<KindTokenSplit, 'outputP95' | 'cacheHitRate'> & { outputs: number[] }
  >()
  let ungroundedQuestions = 0
  let ungroundedDown = 0

  for (const row of rows) {
    totals.messages += 1
    totals.inputTokens += row.inputTokens
    totals.outputTokens += row.outputTokens
    totals.cacheReadTokens += row.cacheReadTokens
    totals.cacheWriteTokens += row.cacheWriteTokens
    totals.providerCostUsd += row.providerCostUsd
    if (row.deflected) totals.deflected += 1
    addToSplit(totals.byTier, row.tier, row.providerCostUsd)
    addToSplit(totals.byModel, row.model, row.providerCostUsd)
    if (!row.deflected) {
      const kind = row.kind || 'unknown'
      const bucket = kinds.get(kind) ?? {
        messages: 0,
        providerCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputs: [],
      }
      bucket.messages += 1
      bucket.providerCostUsd += row.providerCostUsd
      bucket.inputTokens += row.inputTokens
      bucket.outputTokens += row.outputTokens
      bucket.cacheReadTokens += row.cacheReadTokens
      bucket.cacheWriteTokens += row.cacheWriteTokens
      bucket.outputs.push(row.outputTokens)
      kinds.set(kind, bucket)
    }
    const stop = row.stopReason ?? 'none'
    totals.stopReasons[stop] = (totals.stopReasons[stop] ?? 0) + 1
    if (row.feedback === 'up') totals.feedback.up += 1
    else if (row.feedback === 'down') totals.feedback.down += 1
    else totals.feedback.none += 1

    const org = orgs.get(row.orgId) ?? {
      orgId: row.orgId,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      providerCostUsd: 0,
      down: 0,
    }
    org.messages += 1
    org.inputTokens += row.inputTokens
    org.outputTokens += row.outputTokens
    org.cacheReadTokens += row.cacheReadTokens
    org.cacheWriteTokens += row.cacheWriteTokens
    org.providerCostUsd += row.providerCostUsd
    if (row.feedback === 'down') org.down += 1
    orgs.set(row.orgId, org)

    /**
     * A FAILING turn. Thumbs-down, or nothing retrieved at all (AGL-2314).
     *
     * Collected before the `continue` below, so an ungrounded turn — the case
     * that leaves the loop early — is not silently excluded from the very
     * shortlist it most belongs on.
     */
    if (row.feedback === 'down' || !row.docsPaths.length) {
      proseCandidates.push({
        orgId: row.orgId,
        exchangeId: row.exchangeId,
        route: row.route || '(unknown)',
        feedback: row.feedback,
        grounded: row.docsPaths.length > 0,
      })
    }

    if (!row.docsPaths.length) {
      // Retrieval matched nothing. Counted here and NOT in `docsGaps` — a
      // question with no citation has no path to rank under, which is
      // precisely why a path-keyed ranking cannot see a missing page.
      ungroundedQuestions += 1
      if (row.feedback === 'down') ungroundedDown += 1
      const route = row.route || '(unknown)'
      const entry = ungroundedRoutes.get(route) ?? {
        route,
        questions: 0,
        down: 0,
      }
      entry.questions += 1
      if (row.feedback === 'down') entry.down += 1
      ungroundedRoutes.set(route, entry)
      continue
    }

    // Cost is attributed to EVERY path the turn cited, so the column is
    // "what did questions touching this page cost", not a partition of the
    // total. Splitting a turn's cost across its citations would understate
    // an expensive page that is always cited alongside others, and the
    // column exists to find pages worth rewriting, not to balance a ledger.
    for (const path of new Set(row.docsPaths)) {
      const entry = gaps.get(path) ?? {
        row: { path, questions: 0, up: 0, down: 0, providerCostUsd: 0 },
        orgs: new Set<string>(),
      }
      entry.row.questions += 1
      entry.row.providerCostUsd += row.providerCostUsd
      if (row.feedback === 'up') entry.row.up += 1
      if (row.feedback === 'down') entry.row.down += 1
      entry.orgs.add(row.orgId)
      gaps.set(path, entry)
    }
  }

  /**
   * Thumbs-down first, then the ungrounded ones.
   *
   * A rated failure is somebody telling us the answer was wrong; an
   * ungrounded turn is us telling ourselves we had nothing to answer with.
   * Both are worth reading, and the first is worth reading first.
   */
  proseCandidates.sort((a, b) => {
    const rank = (candidate: ProseCandidate) =>
      candidate.feedback === 'down' ? 0 : 1
    return rank(a) - rank(b)
  })

  totals.cacheReadRate = aiCacheHitRate({
    input: totals.inputTokens,
    cached: totals.cacheReadTokens,
    cacheWrite: totals.cacheWriteTokens,
  })
  for (const [kind, { outputs, ...bucket }] of kinds) {
    totals.byKind[kind] = {
      ...bucket,
      outputP95: nearestRankPercentile(outputs, 0.95),
      cacheHitRate: aiCacheHitRate({
        input: bucket.inputTokens,
        cached: bucket.cacheReadTokens,
        cacheWrite: bucket.cacheWriteTokens,
      }),
    }
  }
  totals.deflectionRate = totals.messages
    ? totals.deflected / totals.messages
    : null

  const docsGaps = [...gaps.values()]
    .map(({ row, orgs: orgSet }) => {
      const rated = row.up + row.down
      return {
        ...row,
        orgs: orgSet.size,
        downRate: rated ? row.down / rated : null,
      }
    })
    // Thumbs-down first, then volume. Ranking on volume alone surfaces the
    // pages people read most, which is a popularity list and not a gap list;
    // ranking on rate alone puts a single grumpy rating above a page that
    // failed forty people. Down count leads, volume breaks the tie.
    .sort((a, b) => b.down - a.down || b.questions - a.questions)
    .slice(0, limit)

  const ungroundedRouteRows = [...ungroundedRoutes.values()].sort(
    (a, b) => b.questions - a.questions || b.down - a.down,
  )
  const orgRows = [...orgs.values()].sort(
    (a, b) => b.providerCostUsd - a.providerCostUsd || b.messages - a.messages,
  )

  return {
    scanned: rows.length,
    truncated: Boolean(options.truncated),
    totals,
    docsGaps,
    ranked: {
      // `gaps` rather than `docsGaps`: the latter is already sliced, so
      // measuring it would report the cap as the total and the disclosure
      // would agree with itself forever.
      docsGaps: gaps.size,
      ungroundedRoutes: ungroundedRoutes.size,
      orgs: orgs.size,
    },
    proseCandidates: proseCandidates.slice(0, limit),
    ungrounded: {
      questions: ungroundedQuestions,
      down: ungroundedDown,
      routes: ungroundedRouteRows.slice(0, limit),
    },
    orgs: orgRows.slice(0, limit),
  }
}
