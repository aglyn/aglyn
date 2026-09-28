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

import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import useFirestoreDoc from '../../hooks/use-firestore-doc'

/** How the media library draws its files: thumbnails, or a table. */
export type MediaLibraryView = 'grid' | 'list'

/**
 * The user-document field holding the reader's choice (AGL-3327).
 *
 * On `users/{uid}` beside the other console preferences a person keeps for
 * themselves — the dashboard arrangement, the CRM's default views — because
 * it is the same kind of fact: one person's way of reading their own
 * console, which the rules let them and nobody else write. One value for
 * every library they open, the org's, each site's and the pickers': a person
 * who reads media as a table reads it that way everywhere.
 */
export const MEDIA_LIBRARY_VIEW_FIELD = 'mediaLibraryView'

/** The stored choice, or the thumbnail grid for anything else. */
export function readMediaLibraryView(profile: unknown): MediaLibraryView {
  const stored = (profile as Record<string, unknown> | null | undefined)?.[
    MEDIA_LIBRARY_VIEW_FIELD
  ]
  return stored === 'list' ? 'list' : 'grid'
}

/**
 * The reader's view, remembered across sessions and devices.
 *
 * Optimistic: the toggle answers the click, and the write follows. Nothing
 * here decides access, so a failed write costs a reload that opens on the
 * other view. Until the profile arrives the library draws the grid, the
 * view every library opened on before this existed.
 */
export function useMediaLibraryView(): [
  MediaLibraryView,
  (view: MediaLibraryView) => void,
] {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const { data: profile } = useFirestoreDoc<Record<string, unknown>>(
    () => (uid ? doc(firestore, 'users', uid) : null),
    [firestore, uid],
  )
  const [chosen, setChosen] = useState<MediaLibraryView | null>(null)
  const view = chosen ?? readMediaLibraryView(profile)
  const setView = useCallback(
    (next: MediaLibraryView) => {
      setChosen(next)
      if (!uid) return
      void setDoc(
        doc(firestore, 'users', uid),
        { [MEDIA_LIBRARY_VIEW_FIELD]: next },
        { merge: true },
      ).catch(console.error)
    },
    [firestore, uid],
  )
  return [view, setView]
}

export default useMediaLibraryView
