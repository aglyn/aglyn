/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import {
  accountSectionHrefForTab,
  DEFAULT_ACCOUNT_SECTION_HREF,
} from '../../../../constants/account-sections'

/**
 * `/manage/user` is the section index and renders nothing of its own
 * (AGL-693).
 *
 * ## It DOES carry a `?tab=` map, unlike the settings and admin indexes
 *
 * Those dropped theirs because nothing shipped holds an old link. One thing
 * does here: the new-device security alert, which `security-alerts.ts` has
 * been sending with a `/manage/user?tab=security` button. A delivered email
 * cannot be edited, and its reader has just been told a stranger signed in —
 * so that link has to keep reaching Security, not the default section and not
 * a 404. The map lives in `constants/account-sections.ts` beside the rail it
 * mirrors, and `account-section-links.spec.tsx` fails if it stops working.
 *
 * The map covers all six ids rather than `security` alone. Five of them cost
 * one line each in a list that already exists, and a map that handles the
 * emailed link while silently dropping its five neighbours is a trap for
 * whoever links to a section next.
 *
 * `replace`, not `push`: a redirect the reader did not ask for must not become
 * a history entry their back button bounces off.
 */
const ManageUser: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get('tab') ?? null
  const href = accountSectionHrefForTab(requestedTab)
  useEffect(() => {
    // An unknown id lands on the default section rather than nowhere: the tab
    // param is now only ever a legacy link, and a stale one should still open
    // the account.
    router.replace(href ?? DEFAULT_ACCOUNT_SECTION_HREF)
  }, [router, href])
  return null
}
ManageUser.displayName = 'Page:ManageUser'

export default ManageUser
