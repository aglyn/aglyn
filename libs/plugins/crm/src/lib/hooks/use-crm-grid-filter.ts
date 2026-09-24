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

'use client'

import type { CrmViewFilterClause } from '@aglyn/aglyn'
import type { GridFilterItem, GridFilterModel } from '@mui/x-data-grid'
import { useCallback, useMemo, useState } from 'react'
import {
  type CrmGridFilterCodec,
  crmPlainCodec,
  crmSelectCodec,
  crmUpsertClause,
} from '../model/crm-grid-filter'

export interface CrmGridFilterOptions {
  /** The clauses the list is narrowed by — the saved view's working filters. */
  clauses: readonly CrmViewFilterClause[]
  onChange: (clauses: CrmViewFilterClause[]) => void
  /** Fields whose values are picked, which the panel shows as a select. */
  selectFields?: readonly string[]
  /** A field whose stored clauses predate the panel, translated its own way. */
  codecs?: Readonly<Record<string, CrmGridFilterCodec>>
  /**
   * The query serves ONE clause, so the panel's replaces every other — a
   * server-paged list, which has no loaded window to narrow further.
   * `keepAlongside` names the clauses that do narrow the loaded page and so
   * may stand beside it ("No next activity").
   */
  single?: boolean
  keepAlongside?: (clause: CrmViewFilterClause) => boolean
  /**
   * The quick search's words, held by the list when it needs them before
   * the grid's columns exist; the hook holds them itself otherwise.
   */
  search?: { words: string[]; onChange: (words: string[]) => void }
}

/** What the grid is handed, and what the list filters its rows by. */
export interface CrmGridFilter {
  /** Controlled: the panel's one item, and the quick search's words. */
  filterModel: GridFilterModel
  onFilterModelChange: (model: GridFilterModel) => void
  /** The quick search's words, for the list to match its rows against. */
  searchWords: string[]
}

/**
 * The grid's Filters panel and quick search, bound to a list's view clauses
 * (AGL-3313). See `model/crm-grid-filter.ts` for the shape both sides keep.
 *
 * ## One field, one clause; the panel edits one at a time
 *
 * The community data grid's panel holds a single item, while a saved view
 * holds several clauses. So each FIELD holds one clause, and the panel is a
 * window onto whichever field was last filtered: setting a value writes
 * that field's clause, clearing it or deleting the row removes it, and
 * choosing another column in the panel moves the window without touching
 * the clause the reader just set. Filtering Lead source and then Status is
 * therefore both, which is what a reader who does it means; the chips over
 * the grid (`CrmFilterBar`) show every clause and remove any of them.
 *
 * ## The list answers, never the grid
 *
 * Every list passes `filterMode="server"`: the grid holds one page, or a
 * window the query already narrowed, so a filter the grid ran itself would
 * answer "no match" for a row on the next page. The list reads the clauses
 * — onto its query where it can, over its loaded rows where it cannot —
 * and the quick search's words, and hands the grid the rows that answer.
 */
export function useCrmGridFilter(options: CrmGridFilterOptions): CrmGridFilter {
  const { clauses, onChange, selectFields = [], codecs = {}, single = false, keepAlongside } =
    options

  const codecFor = useCallback(
    (field: string): CrmGridFilterCodec =>
      codecs[field] ?? (selectFields.includes(field) ? crmSelectCodec : crmPlainCodec),
    [codecs, selectFields],
  )

  /** The field the panel shows, once the reader has pointed it anywhere. */
  const [focus, setFocus] = useState<string | null>(null)
  /** The panel's row while it holds no value yet — a column chosen, a value not. */
  const [pending, setPending] = useState<GridFilterItem | null>(null)
  const [ownWords, setOwnWords] = useState<string[]>([])
  const searchWords = options.search?.words ?? ownWords
  const setSearchWords = options.search?.onChange ?? setOwnWords

  /** Whatever the panel last pointed at, else the newest clause it can show. */
  const shownField = useMemo(() => {
    if (focus) return focus
    for (let at = clauses.length - 1; at >= 0; at -= 1) {
      if (codecFor(clauses[at].field).toItem(clauses[at])) return clauses[at].field
    }
    return null
  }, [focus, clauses, codecFor])

  const filterModel = useMemo<GridFilterModel>(() => {
    const clause = shownField
      ? clauses.find((entry) => entry.field === shownField)
      : undefined
    const shown = clause ? codecFor(clause.field).toItem(clause) : null
    const item: GridFilterItem | null =
      pending && pending.field === shownField
        ? pending
        : clause && shown
          ? { id: 'crm', field: clause.field, ...shown }
          : null
    return { items: item ? [item] : [], quickFilterValues: searchWords }
  }, [shownField, clauses, codecFor, pending, searchWords])

  const onFilterModelChange = useCallback(
    (model: GridFilterModel) => {
      const words = (model.quickFilterValues ?? []).map((word) => String(word))
      if (words.join(' ') !== searchWords.join(' ')) setSearchWords(words)

      const item = model.items[0]
      // The row deleted: the field it showed is no longer filtered.
      if (!item) {
        if (shownField && clauses.some((clause) => clause.field === shownField)) {
          onChange(crmUpsertClause(clauses, shownField, null))
        }
        setPending(null)
        setFocus(null)
        return
      }
      const field = String(item.field)
      const moved = field !== shownField
      setFocus(field)
      const clause = codecFor(field).toClause(item)
      if (!clause) {
        // No value yet. A value cleared on the field already shown removes
        // its clause; a column just chosen leaves the last one standing.
        setPending({ ...item, id: 'crm' })
        if (!moved && clauses.some((entry) => entry.field === field)) {
          onChange(crmUpsertClause(clauses, field, null))
        }
        return
      }
      setPending(null)
      // A clause that stands alongside the served one is added beside it;
      // any other replaces whatever the query was serving.
      const base =
        single && !keepAlongside?.(clause)
          ? clauses.filter((entry) => entry.field === field || keepAlongside?.(entry))
          : clauses
      const next = crmUpsertClause(base, field, clause)
      const same =
        next.length === clauses.length &&
        next.every(
          (entry, at) =>
            entry.field === clauses[at].field &&
            entry.op === clauses[at].op &&
            entry.value === clauses[at].value,
        )
      if (!same) onChange(next)
    },
    [searchWords, setSearchWords, shownField, clauses, onChange, codecFor, single, keepAlongside],
  )

  return { filterModel, onFilterModelChange, searchWords }
}

export default useCrmGridFilter
