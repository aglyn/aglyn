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

import { type HostDocumentLike, holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { doc } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useUser } from './firebase/firebase-services'
import { useFirestoreDoc } from './use-firestore-doc'

/** A key's site-role preset, as the plugin that declares it tables it. */
export type SiteKeyPreset = Readonly<Partial<Record<HostAccessRole, boolean>>>

export interface SiteKeys {
  /**
   * Whether this member is known NOT to hold the key on the site, so a control
   * switches off with the permission named beside it. `false` until the answer
   * is in, so nobody sees a control flash off while it loads; `false` too for a
   * reader who is not on the site's roster, who is staff, whom the doors admit:
   * there the server answers.
   */
  blocked(key: string, preset: SiteKeyPreset): boolean
}

/**
 * The signed-in member's verdict on a site's keys (AGL-4047), read as the doors
 * read them: the site's `memberPermissions` stamp, else the preset of their
 * `memberRoles` entry (`holdsStampedSiteKey`). For a plugin's card, which cannot
 * reach the console's permission context. One listener on the host document,
 * which the Firestore client shares with every other reader of it on the page.
 */
export function useSiteKeys(hostId: string | null | undefined): SiteKeys {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const site = hostId || ''
  const hostRead = useFirestoreDoc<{ memberRoles?: Record<string, unknown>; memberPermissions?: unknown }>(
    () => (site ? doc(firestore, 'hosts', site) : null),
    [firestore, site],
  )
  const known = hostRead.status === 'success'
  const host = known ? hostRead.data : null
  const onRoster = Boolean(uid && host?.memberRoles?.[uid])
  const blocked = useCallback(
    (key: string, preset: SiteKeyPreset) =>
      known && onRoster && !holdsStampedSiteKey(host as HostDocumentLike, uid, key, preset),
    [known, onRoster, host, uid],
  )
  return { blocked }
}
