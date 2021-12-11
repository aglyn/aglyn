/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import type {IconData} from '@aglyn/shared-data-mdi'
import {FindWithFuzzy} from '@aglyn/shared-util-vendor'
import {useCallback, useMemo, useState} from 'react'


export type MdiIcon = IconData
export type ApplyFilterFn = (query: string) => void
export type ClearFilterFn = () => void
export type UseMdiIconsReturn = [MdiIcon[], ApplyFilterFn, ClearFilterFn]

export function useMemoizedMdiIcons(iconIds?: string[]): (MdiIcon | undefined)[] {
  return useMemo(() => {
    const mdi = require('@aglyn/shared-data-mdi')
    const mdiIds = mdi?.icons?.iconIds || []
    const mdiIcons = mdi?.icons?.byIconId || {}

    return (iconIds || mdiIds).map((id) => {
      const icon = mdiIcons[id]
      return !icon ? undefined : ({
        ...icon,
        id: id,
        alias: Object.keys(icon.alias || {}),
      })
    })
  }, [iconIds])
}


export function useMdiIcons(): UseMdiIconsReturn {
  const allIcons = useMemoizedMdiIcons()

  const fuzzy = useMemo(() => {
    return new FindWithFuzzy<MdiIcon>(allIcons, {
      keys: [
        {name: 'name', weight: 0.7},
        {name: 'alias', weight: 0.3},
      ],
      includeScore: true,
      shouldSort: true,
      // threshold: 0.25,
      // minMatchCharLength: 3
    })
  }, [allIcons])

  const [iconResults, setIconResults] = useState(() => allIcons)

  const clearFilter: ClearFilterFn = useCallback(() => {
    setIconResults(allIcons)
  }, [allIcons, setIconResults])

  const applyFilter: ApplyFilterFn = useCallback((query: string) => {
    const results = fuzzy.search(query)
    setIconResults(results.map((i) => i.item))
  }, [fuzzy, setIconResults])

  return useMemo(() => {
    return [iconResults, applyFilter, clearFilter]
  }, [iconResults, applyFilter, clearFilter])
}

export default useMdiIcons
