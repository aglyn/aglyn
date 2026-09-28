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

import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE RUN HISTORY, AS A QUERY (AGL-3321).
 *
 * A run is an entry in `hosts/{hostId}/activity` that carries a verdict:
 * `result` is `succeeded`, `failed` or `skipped`, beside the `trigger` event
 * and the `summary` of what each step did. The activity feed also holds
 * publishes, media saves and member changes, so the history's query is
 * scoped to the automation (`target.id`) AND to runs (`result`) — and every
 * clause the Filters panel accepts, and the search word, is another
 * predicate on that same query. Pages come from the query, so a page of ten
 * is ten runs and a filtered page is ten matches, however far back they sit.
 *
 * Every run writer stamps `summaryTokens` beside the summary
 * ({@link runSummaryFields}), and `tools/scripts/backfill-activity-run-fields.mjs`
 * completes the entries written before: `result`, `trigger` and `summary`
 * from the prose line of a run recorded before those fields existed, and the
 * tokens on every run. A run without a `result` is invisible to the query,
 * which is why the backfill is part of shipping this.
 */

/** A run's verdict, as every run writer stores it. */
export const RUN_RESULTS = ['succeeded', 'failed', 'skipped'] as const
export type RunResultValue = (typeof RUN_RESULTS)[number]

/** The written word-prefix tokens of a run's summary, for the search box. */
export const RUN_SUMMARY_TOKENS = 'summaryTokens'

/**
 * What a run writer spreads beside `summary`: the summary itself and its
 * search tokens, so the two cannot be written apart.
 */
export function runSummaryFields(summary: string): {
  summary: string
  summaryTokens: string[]
} {
  return { summary, summaryTokens: nameSearchTokens(summary) }
}

/**
 * What the Filters panel offers, each a predicate the query serves beneath
 * its newest-first order: Time is that order's own field, so its ranges cost
 * no index of their own; Trigger and Result are equalities.
 *
 * `What happened` has no column filter: its words are the search box's,
 * which reads the same tokens, and a `contains` beside the search would be a
 * second array clause the query cannot hold.
 */
export const RUN_HISTORY_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'createdAtMs',
      kind: 'date',
      path: 'createdAt',
      operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
    },
    {
      column: 'trigger',
      kind: 'exact',
      path: 'trigger',
      operators: ['equals', 'isAnyOf'],
    },
    {
      column: 'result',
      kind: 'exact',
      path: 'result',
      operators: ['equals', 'isAnyOf'],
    },
  ] satisfies ListFilterField[],
  sorts: [{ path: 'createdAt', direction: 'desc', column: 'createdAtMs' }],
  search: { tokensPath: RUN_SUMMARY_TOKENS },
}

export const RUN_HISTORY_HEADERS: Readonly<Record<string, string>> = {
  createdAtMs: 'Time',
  trigger: 'Trigger',
  result: 'Result',
}

/** A clause on Result the query serves — which is then what keeps it to runs. */
const namesResult = (clause: ListFilterClause): boolean =>
  clause.field === 'result' &&
  (clause.op === 'equals' || clause.op === 'isAnyOf') &&
  clause.value.trim() !== ''

/**
 * The history's scope: this automation's entries, and only runs.
 *
 * "Only runs" is `result in [all three]` — unless the reader has asked for
 * a Result, whose own equality already names nothing but runs. The two are
 * never both on the query: a second predicate on the same field would only
 * repeat the first, and the plan serves an `equals` or `isAnyOf` on Result
 * unconditionally, so dropping the scope never lets a non-run through.
 */
export function runHistoryBase(
  targetId: string | undefined,
  clauses: readonly ListFilterClause[],
): ListQueryFilter[] {
  const base: ListQueryFilter[] = []
  if (targetId) base.push({ path: 'target.id', op: '==', value: targetId })
  if (!clauses.some(namesResult))
    base.push({ path: 'result', op: 'in', value: [...RUN_RESULTS] })
  return base
}

/** The base's shape, for the index enumeration. */
export const RUN_HISTORY_BASE_PATHS = [
  { path: 'target.id' },
  { path: 'result' },
] as const

/** A run entry as stored, as far as completing it is concerned. */
export interface RunEntryLike {
  action?: unknown
  result?: unknown
  trigger?: unknown
  summary?: unknown
  summaryTokens?: unknown
}

/**
 * What a stored activity entry lacks to be found by the run history's query,
 * or `null` when it is not a run or already complete. The definition the
 * backfill restates (`tools/scripts/backfill-activity-run-fields.mjs`), held
 * to the same worked examples (`tools/scripts/lib/activity-run-fields.fixtures.json`).
 *
 * A run recorded before its structured fields carried only the prose line
 * `Action ran on <event>` — with ` with errors: <what failed>` when it
 * failed — so the verdict, the event and the summary are read back from it,
 * the way the history has always shown such a row. An entry that is neither
 * a stored verdict nor that prose is not a run and is left alone.
 */
export function runEntryCompletion(
  entry: RunEntryLike,
): Record<string, unknown> | null {
  const stored = String(entry.result ?? '').trim()
  const action = String(entry.action ?? '').trim()
  const legacy = action.startsWith('Action ran on')
  if (!(RUN_RESULTS as readonly string[]).includes(stored) && !legacy)
    return null
  const patch: Record<string, unknown> = {}
  if (!(RUN_RESULTS as readonly string[]).includes(stored)) {
    patch['result'] = action.includes('with errors:') ? 'failed' : 'succeeded'
  }
  if (typeof entry.trigger !== 'string' || !entry.trigger) {
    const event = legacy ? /^Action ran on (\S+)/.exec(action)?.[1] : undefined
    if (event) patch['trigger'] = event
  }
  let summary = typeof entry.summary === 'string' ? entry.summary.trim() : ''
  if (!summary) {
    const errors = /with errors:\s*(.+)$/.exec(action)
    summary = errors ? errors[1] : legacy ? 'Ran' : action
    patch['summary'] = summary
  }
  const tokens = nameSearchTokens(summary)
  const held = Array.isArray(entry.summaryTokens) ? entry.summaryTokens : null
  if (
    !held ||
    held.length !== tokens.length ||
    held.some((token, at) => token !== tokens[at])
  ) {
    patch['summaryTokens'] = tokens
  }
  return Object.keys(patch).length ? patch : null
}
