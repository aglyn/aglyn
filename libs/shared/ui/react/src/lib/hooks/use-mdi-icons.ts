/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useCallback, useState, useMemo } from 'react'

import Fuse from 'fuse.js'

import { Icons, icons as mdiIcons } from '@aglyn/shared/data/mdi'

import { _isArr } from '@aglyn/shared/util/helpers'

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
    [ids]
  )
}

const defaultKeys = ['id', 'name', 'aliases']

export function useMdiIcons(initialQuery?: string, opts?: FilterOpts): UseMdiIconsReturn {
  const allIcons = useMemoizedMdiIcons()
  const options = { keys: opts?.keys ?? defaultKeys }
  const fuse = new Fuse(allIcons, options)
  const searchItems = (query: string) => fuse.search(query ?? '').map((i) => i.item)
  const [query, setQuery] = useState(initialQuery ?? '')
  const filteredIcons = useMemo<MdiIcon[]>(() => {
    return query ? searchItems(query) : allIcons
  }, [query, allIcons])

  const applyFilter: ApplyFilterFn = useCallback((query: string) => setQuery(query), [])
  const clearFilter: ClearFilterFn = useCallback(() => setQuery(''), [])

  return useMemo(() => [filteredIcons, { applyFilter, clearFilter }, mdiIcons], [filteredIcons])
}

export default useMdiIcons
