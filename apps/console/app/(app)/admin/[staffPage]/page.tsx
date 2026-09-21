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
import AdminStaffPluginPage from '../../../../components/admin-staff-plugin-page.component'

/**
 * The staff area's generic plugin route (AGL-2939): a page a plugin adds to
 * the staff area renders here at `/admin/{id}`, the way a plugin's site page
 * renders through the host route. The console's own staff routes are static
 * segments and win theirs.
 *
 * The body is shared with the subtree route beside it (AGL-3080) — see
 * `components/admin-staff-plugin-page.component`.
 */
const AdminStaffPluginRoute: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ staffPage: string }>()
  return <AdminStaffPluginPage id={String(params?.staffPage ?? '')} segments={[]} />
}
AdminStaffPluginRoute.displayName = 'Page:AdminStaffPluginPage'

export default AdminStaffPluginRoute
