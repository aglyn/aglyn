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

import { useCallback, useEffect, useState } from 'react'
import { rankPickerItems } from '../utils/rank-picker-results'

/** The single group search results collapse into (AGL-2486). */
export const RESULTS_CATEGORY_ID = 'aglyn:picker-results'
export const RESULTS_CATEGORY_LABEL = 'Best matches'

/**
 * The fields the fuzzy pass looks at. Fuse decides WHAT matches (it is the
 * only thing here with any typo tolerance); `rankPickerItems` decides the
 * ORDER.
 */
const FUSE_KEYS = [
  'displayName',
  'label',
  'title',
  'description',
  'subtitle',
  'category',
  // Authored synonyms. `rankPickerItems` has always ranked these; until
  // AGL-2486 nothing could SET them and the fuzzy pass never looked at
  // them, so the ranking was scoring a field that did not exist.
  'tags',
  'keywords',
  'pluginId',
  'kind',
  '$id',
]

/** A category group as both element pickers consume it. */
export interface PickerCategory<TItem = any> {
  $id: string
  label?: string
  items?: TItem[]
}

export interface PickerFilterResult<TCategory> {
  /** Current query text; empty when nothing is being searched. */
  filter: string
  /** Categories unfiltered, or the single flat "Best matches" group. */
  items: TCategory[]
  /**
   * `onChange` for the search field. Also serves the clear button: an
   * IconButton has no `currentTarget.value`, so the query falls back to ''.
   */
  handleFilterChange: (e: { currentTarget?: { value?: string } }) => void
}

/**
 * The element picker's search, shared by the Choose-element dialog and the
 * Elements panel (AGL-2486).
 *
 * Both surfaces MUST agree about what a query matches and in what order.
 * Two pickers that disagree about what `icon` means would be worse than one
 * of them having no search at all, which is why this lives in one place
 * rather than being written twice.
 *
 * Results are FLAT while a filter is active, deliberately. A name hit has to
 * outrank a description hit, and that cannot hold inside category
 * accordions: `Icon` lives in Media, so grouping would drag every Media
 * entry — Avatar, "shows a picture, initials or an icon" — above `Icon
 * button` in Input. Unfiltered, the curated categories come back untouched.
 *
 * @param allItems the visible categories, freshly derived each render
 * @param onFiltered optional side effect run on every query change (the
 *   dialog drops its pending selection, which the new results no longer show)
 */
export function usePickerFilter<TCategory extends PickerCategory>(
  allItems: TCategory[],
  onFiltered?: () => void,
): PickerFilterResult<TCategory> {
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState(allItems)

  // Presets can register after mount (per-host reusable components load
  // from Firestore) — refresh the unfiltered list when the registry
  // changes. `allItems` is a fresh array every render, so key on a stable
  // signature to avoid a setState loop.
  const registrySignature = allItems
    .map((category) => `${category.$id}:${category.items?.length ?? 0}`)
    .join('|')
  useEffect(() => {
    if (!filter) setItems(allItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrySignature, filter])

  const handleFilterChange = useCallback(
    async (e: { currentTarget?: { value?: string } }) => {
      const filter = e.currentTarget?.value || ''
      setFilter(filter)
      onFiltered?.()
      let items = allItems

      if (filter) {
        try {
          // Dynamically load fuse.js
          const Fuse = (await import('fuse.js')).default
          const fuse = new Fuse<TCategory['items'][number]>([], {
            shouldSort: true,
            keys: FUSE_KEYS,
          })

          // Fuse's own `shouldSort` weights every key alike, which is what
          // put `Icon` below everything whose description merely mentions
          // an icon (AGL-2486). `rankPickerItems` re-orders name-first.
          const matched = allItems.flatMap((category) => {
            fuse.setCollection(category.items)
            return fuse.search(filter).map((result) => result.item)
          })
          items = matched.length
            ? [
                {
                  $id: RESULTS_CATEGORY_ID,
                  label: RESULTS_CATEGORY_LABEL,
                  items: rankPickerItems(matched, filter),
                } as unknown as TCategory,
              ]
            : []
        } catch (error) {
          console.error('Failed to load fuse.js', error)
        }
      }

      setItems(items)
    },
    [allItems, onFiltered],
  )

  return { filter, items, handleFilterChange }
}

export default usePickerFilter
