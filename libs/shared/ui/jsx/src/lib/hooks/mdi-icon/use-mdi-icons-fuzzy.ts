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

import type { Icon, IconId } from '@aglyn/shared-data-mdi'
import { Fuse } from '@aglyn/shared-util-vendor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApplyFilterFn, ClearFilterFn } from '../../types'
import { useMdiIcons } from './use-mdi-icons'

type UseMdiIconsReturn = [
  filteredIcons: Icon[],
  allIcons: Icon[],
  applyFilter: ApplyFilterFn,
  clearFilter: ClearFilterFn,
]
export function useMdiIconsFuzzy(iconId?: IconId[]): UseMdiIconsReturn {
  const allIcons = useMdiIcons(iconId)
  const [filteredIcons, setFilteredIcons] = useState(allIcons)

  // The catalog arrives async (AGL-189): when the icon set materializes
  // after mount, refresh the unfiltered view or the grid stays empty.
  useEffect(() => {
    setFilteredIcons(allIcons)
  }, [allIcons])

  const fuzzy = useMemo(() => {
    return new Fuse(allIcons, {
      keys: [
        { name: 'name', weight: 0.5 },
        { name: 'as', weight: 0.25 },
        { name: 'tags', weight: 0.25 },
      ],
      includeScore: true,
      shouldSort: true,
      // threshold: 0.25,
      // minMatchCharLength: 3
    })
  }, [allIcons])

  const clearFilter: ClearFilterFn = useCallback(() => {
    setFilteredIcons(allIcons)
  }, [allIcons, setFilteredIcons])

  const applyFilter: ApplyFilterFn = useCallback(
    async (query: string) => {
      const results = fuzzy.search(query)
      setFilteredIcons(results.map((i) => i.item))
    },
    [fuzzy, setFilteredIcons],
  )

  return [filteredIcons, allIcons, applyFilter, clearFilter]
}
export default useMdiIconsFuzzy
