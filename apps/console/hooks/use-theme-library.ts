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

import {
  THEME_LIBRARY_COLLECTION,
  type ThemeLibraryEntry,
} from '@aglyn/aglyn/app-utils/theme-library'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import useFirestoreCollection from './use-firestore-collection'

/**
 * Well above what a site holds — `THEME_LIBRARY_MAX_CUSTOM` custom themes, a
 * stash per built-in theme and one entry per marketplace theme — and a bound
 * on the read however the collection grows.
 */
const LIBRARY_READ_LIMIT = 100

/**
 * A site's theme library (AGL-3404), live, by entry id. `undefined` until the
 * first snapshot, so the picker does not list a library it has not read.
 */
export function useThemeLibrary(
  hostId: string | undefined,
): Record<string, ThemeLibraryEntry> | undefined {
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<
    ThemeLibraryEntry & { $id: string }
  >(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, THEME_LIBRARY_COLLECTION),
            limit(LIBRARY_READ_LIMIT),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  return useMemo(() => {
    // A refused read lists nothing rather than holding the picker on a
    // spinner: the built-in themes and the current one still render.
    if (status === 'loading') return undefined
    const entries: Record<string, ThemeLibraryEntry> = {}
    for (const { $id, ...entry } of data ?? []) entries[$id] = entry
    return entries
  }, [data, status])
}

export default useThemeLibrary
