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
  route: string
  model: string
  tier: 'free' | 'entitled' | string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estCostUsd: number
  docsPaths: string[]
  stopReason: string | null
  feedback: 'up' | 'down' | null
}

export interface DocsGapRow {
  path: string
  /** Turns that cited this path. */
  questions: number
  up: number
  down: number
  /** Distinct orgs that landed here — a gap one org has is not a gap. */
  orgs: number
  estCostUsd: number
  /** `down / (up + down)`, or null when nobody rated. */
  downRate: number | null
}

export interface UngroundedRoute {
  route: string
  questions: number
  down: number
}

export interface OrgCostRow {
  orgId: string
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estCostUsd: number
  down: number
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
    estCostUsd: number
    /** Share of billable prompt tokens served from cache, or null at zero. */
    cacheReadRate: number | null
    byTier: Record<string, number>
    byModel: Record<string, number>
    stopReasons: Record<string, number>
    feedback: { up: number; down: number; none: number }
  }
  docsGaps: DocsGapRow[]
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

/**
 * Normalize one raw signal document. Every field is defaulted, because a
 * signal written by an older build is still evidence and dropping it would
 * bias the ranking toward whatever shipped most recently.
 */
export function assistSignalRow(
  orgId: string,
  data: Record<string, unknown>,
): AssistSignalRow {
  const rawPaths = Array.isArray(data['docsPaths']) ? data['docsPaths'] : []
  const feedback = data['feedback']
  return {
    orgId,
    route: String(data['route'] ?? ''),
    model: String(data['model'] ?? 'unknown'),
    tier: String(data['tier'] ?? 'unknown'),
    inputTokens: number(data['inputTokens']),
    outputTokens: number(data['outputTokens']),
    cacheReadTokens: number(data['cacheReadTokens']),
    cacheWriteTokens: number(data['cacheWriteTokens']),
    estCostUsd: number(data['estCostUsd']),
    docsPaths: rawPaths.map((path) => String(path)).filter(Boolean),
    stopReason: data['stopReason'] == null ? null : String(data['stopReason']),
    feedback: feedback === 'up' || feedback === 'down' ? feedback : null,
  }
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
    estCostUsd: 0,
    cacheReadRate: null as number | null,
    byTier: {} as Record<string, number>,
    byModel: {} as Record<string, number>,
    stopReasons: {} as Record<string, number>,
    feedback: { up: 0, down: 0, none: 0 },
  }

  const gaps = new Map<
    string,
    { row: Omit<DocsGapRow, 'orgs' | 'downRate'>; orgs: Set<string> }
  >()
  const ungroundedRoutes = new Map<string, UngroundedRoute>()
  const orgs = new Map<string, OrgCostRow>()
  let ungroundedQuestions = 0
  let ungroundedDown = 0

  for (const row of rows) {
    totals.messages += 1
    totals.inputTokens += row.inputTokens
    totals.outputTokens += row.outputTokens
    totals.cacheReadTokens += row.cacheReadTokens
    totals.cacheWriteTokens += row.cacheWriteTokens
    totals.estCostUsd += row.estCostUsd
    totals.byTier[row.tier] = (totals.byTier[row.tier] ?? 0) + 1
    totals.byModel[row.model] = (totals.byModel[row.model] ?? 0) + 1
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
      estCostUsd: 0,
      down: 0,
    }
    org.messages += 1
    org.inputTokens += row.inputTokens
    org.outputTokens += row.outputTokens
    org.cacheReadTokens += row.cacheReadTokens
    org.cacheWriteTokens += row.cacheWriteTokens
    org.estCostUsd += row.estCostUsd
    if (row.feedback === 'down') org.down += 1
    orgs.set(row.orgId, org)

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
        row: { path, questions: 0, up: 0, down: 0, estCostUsd: 0 },
        orgs: new Set<string>(),
      }
      entry.row.questions += 1
      entry.row.estCostUsd += row.estCostUsd
      if (row.feedback === 'up') entry.row.up += 1
      if (row.feedback === 'down') entry.row.down += 1
      entry.orgs.add(row.orgId)
      gaps.set(path, entry)
    }
  }

  const billablePrompt = totals.inputTokens + totals.cacheReadTokens
  totals.cacheReadRate = billablePrompt
    ? totals.cacheReadTokens / billablePrompt
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

  return {
    scanned: rows.length,
    truncated: Boolean(options.truncated),
    totals,
    docsGaps,
    ungrounded: {
      questions: ungroundedQuestions,
      down: ungroundedDown,
      routes: [...ungroundedRoutes.values()]
        .sort((a, b) => b.questions - a.questions || b.down - a.down)
        .slice(0, limit),
    },
    orgs: [...orgs.values()]
      .sort((a, b) => b.estCostUsd - a.estCostUsd || b.messages - a.messages)
      .slice(0, limit),
  }
}
