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
  type CrmViewSection,
  crmDefaultViewId,
  crmDefaultViewPatch,
} from '@aglyn/aglyn'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useMemo } from 'react'

/**
 * The view a section opens on for THIS reader (AGL-2617).
 *
 * Read from and written to the reader's own profile document, beside the
 * notification mutes that live there, because it is the same kind of fact:
 * one person's preference for their own console, which the rules let them
 * and nobody else write. A merged write keeps the other organizations' and
 * sections' defaults on the same document, and the mutes beside them.
 *
 * One document read per reader per session — the profile listener the
 * avatar and name hooks already hold — rather than a field on the view,
 * where "default" would have to mean everybody's.
 */
export function useCrmDefaultView(options: {
  uid: string | null | undefined
  orgId: string | null
  section: CrmViewSection
}): {
  defaultViewId: string | null
  ready: boolean
  setDefault: (viewId: string | null) => Promise<void>
} {
  const { uid, orgId, section } = options
  const firestore = useFirestore()
  const { data: profile, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (uid ? doc(firestore, 'users', uid) : null),
    [firestore, uid],
  )
  const defaultViewId = useMemo(
    () => crmDefaultViewId(profile ?? null, orgId, section),
    [profile, orgId, section],
  )
  const setDefault = useCallback(
    async (viewId: string | null) => {
      if (!uid || !orgId) return
      await setDoc(
        doc(firestore, 'users', uid),
        crmDefaultViewPatch(orgId, section, viewId),
        { merge: true },
      )
    },
    [firestore, uid, orgId, section],
  )
  return {
    defaultViewId,
    ready: !uid || status !== 'loading',
    setDefault,
  }
}

export default useCrmDefaultView
