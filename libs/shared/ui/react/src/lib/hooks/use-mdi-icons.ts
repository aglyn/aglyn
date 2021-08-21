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

import { useCallback, useMemo, useState } from 'react'

import { Icons, icons as mdiIcons } from '@aglyn/shared/data/mdi'

import { _isArr } from '@aglyn/shared/util/guards'
import { SearchFuzzy } from '@aglyn/shared/util/helpers'


export type MdiIcon = {
  id: string
  name: string
  aliases: string[]
  path: string
}
export type FilterOpts = {
  keys?: string[]
}
export type ApplyFilterFn = (query: string) => void
export type ClearFilterFn = () => void
export type UseMdiIconsReturn = [MdiIcon[], { applyFilter: ApplyFilterFn; clearFilter: ClearFilterFn }, Icons]

export function useMemoizedMdiIcons(iconIds?: string[]): (MdiIcon | null)[] {
  const allIds = Array.from(mdiIcons.iconIds)
  const ids = _isArr(iconIds) ? Array.from(iconIds) : allIds
  return useMemo(
    () =>
      ids.map((id) => {
        const icon = mdiIcons.byIconId[id]
        return !icon
          ? null
          : {
            id,
            name: icon.name,
            path: icon.path,
            aliases: Object.keys(icon.alias).filter((i) => icon.alias[i] === true),
          }
      }),
    [ids],
  )
}

const defaultKeys = ['id', 'name', 'aliases']

export function useMdiIcons(initialQuery?: string, opts?: FilterOpts): UseMdiIconsReturn {
  const allIcons = useMemoizedMdiIcons()
  const options = {keys: opts?.keys ?? defaultKeys}
  const fuzzy = new SearchFuzzy(allIcons, options)
  const searchItems = (query: string) => fuzzy.search(query ?? '').map((i) => i.item)
  const [query, setQuery] = useState(initialQuery ?? '')
  const filteredIcons = useMemo<MdiIcon[]>(() => {
    return query ? searchItems(query) : allIcons
  }, [query, allIcons])

  const applyFilter: ApplyFilterFn = useCallback((query: string) => setQuery(query), [])
  const clearFilter: ClearFilterFn = useCallback(() => setQuery(''), [])

  return useMemo(() => [filteredIcons, {applyFilter, clearFilter}, mdiIcons], [filteredIcons])
}

export default useMdiIcons
