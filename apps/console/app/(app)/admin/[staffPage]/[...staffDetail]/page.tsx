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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useParams } from 'next/navigation'
import AdminStaffPluginPage from '../../../../../components/admin-staff-plugin-page.component'

/**
 * A ROW of a staff page that claims its subtree (AGL-3080):
 * `/admin/{id}/{…}` for a plugin whose `staffPages` entry declared
 * `ownsSubtree`. The case is a queue — the list is the page, and each row
 * opens one submission.
 *
 * ## Why a deeper route and not a catch-all
 *
 * Replacing `[staffPage]` with `[[...staffPage]]` would have put every
 * `/admin/*` URL through one dynamic segment, and the staff area is full of
 * console-owned routes with their own depth — `/admin/orgs/{orgId}`,
 * `/admin/users/{uid}`, `/admin/orgs/{orgId}/host/{hostId}`. A second,
 * DEEPER route changes none of them: Next resolves segment by segment and a
 * static segment beats a dynamic one, so `orgs` keeps winning `orgs`. This
 * file can only ever catch a path that was a 404 before it existed.
 *
 * A page that never claimed its subtree still 404s here — the shared
 * component refuses it rather than serving the list under a URL naming
 * something else.
 */
const AdminStaffPluginDetailRoute: NextPageWithLayout<
  Record<string, never>
> = () => {
  const params = useParams<{
    staffPage: string
    staffDetail?: string | string[]
  }>()
  const raw = params?.staffDetail
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
  return (
    <AdminStaffPluginPage
      id={String(params?.staffPage ?? '')}
      segments={segments}
    />
  )
}
AdminStaffPluginDetailRoute.displayName = 'Page:AdminStaffPluginDetail'

export default AdminStaffPluginDetailRoute
