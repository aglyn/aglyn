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

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * `/team` is the section index and renders nothing of its own (AGL-693).
 *
 * Every link into Team still points here, and a bookmark from before the
 * sections existed still resolves — both land on Members, which is what the
 * page opened with when it was one scrolling column.
 *
 * `replace`, not `push`: a redirect the reader did not ask for must not
 * become a history entry that their back button bounces off.
 */
const ManageTeam: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const orgSlug = useOrgSlug()
  useEffect(() => {
    if (!orgSlug) return
    router.replace(buildRoute(Route.MANAGE_TEAM_MEMBERS, { orgSlug }))
  }, [router, orgSlug])
  return null
}
ManageTeam.displayName = 'Page:ManageTeam'

export default ManageTeam
